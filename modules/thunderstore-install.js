"use strict";

// TFX's installer is designed around a complete dependency plan and a single
// recoverable commit. It does not infer ownership from a local mod's display name.
const fs = require("fs"), fsp = fs.promises, path = require("path"), crypto = require("crypto"), https = require("https");
const {pipeline} = require("stream/promises"), {Transform} = require("stream");
const archive = require("./local-mod-import"), state = require("./mod-enabled-state");
const MAX_ARCHIVE = 2 * 1024 * 1024 * 1024, MAX_PLAN = 128, MAX_METADATA = 4 * 1024 * 1024;
const DOWNLOAD_HOSTS = new Set(["thunderstore.io", "northstar.thunderstore.io", "ccdn.thunderstore.io", "gcdn.thunderstore.io"]);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_]+$/.test(value) && value.length <= 128;
const versionString = value => typeof value === "string" && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?(?:\+[A-Za-z0-9.]+)?$/.test(value) && value.length <= 128;
const plain = value => value && typeof value === "object" && !Array.isArray(value);
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function failure(code, message) {return Object.assign(new Error(message), {code});}
function cancelled() {return Object.assign(failure("CANCELLED", "Mod installation cancelled."), {cancelled: true});}
function abortCheck(signal) {if (signal?.aborted) throw cancelled();}
function interruptible(promise, signal) {
	return new Promise((resolve, reject) => {
		const aborted = () => {signal.removeEventListener("abort", aborted); reject(cancelled());};
		if (signal.aborted) return reject(cancelled());
		signal.addEventListener("abort", aborted, {once: true});
		Promise.resolve(promise).then(value => {signal.removeEventListener("abort", aborted); resolve(value);}, error => {signal.removeEventListener("abort", aborted); reject(error);});
	});
}
function identity(value) {
	if (!plain(value) || !identifier(value.author) || !identifier(value.package_name) || !versionString(value.version)) throw failure("PACKAGE_ID", "Invalid Thunderstore package identity.");
	return {author: value.author, package_name: value.package_name, version: value.version};
}
function formatName(author, package_name, version) {const item = identity({author, package_name, version: String(version || "").replace(/^v/, "")}); return `${item.author}-${item.package_name}-${item.version}`;}
function splitName(name) {
	if (typeof name !== "string") return false;
	const match = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)-(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?(?:\+[A-Za-z0-9.]+)?)$/.exec(name);
	return match ? {author: match[1], package_name: match[2], version: match[3]} : false;
}
function checkedPath(filename, missing = true) {
	const full = path.resolve(filename), root = path.parse(full).root;
	let current = root;
	for (const component of full.slice(root.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, component);
		let stat; try {stat = fs.lstatSync(current);} catch (error) {if (error.code === "ENOENT" && missing) return null; throw error;}
		if (stat.isSymbolicLink() || (current !== full && !stat.isDirectory())) throw failure("UNSAFE_PATH", "The package path contains a link or a file in place of a directory.");
		if (current === full) return stat;
	}
	return fs.lstatSync(root);
}
function directory(filename, missing = false) {const stat = checkedPath(filename, missing); if (stat && !stat.isDirectory()) throw failure("UNSAFE_PATH", "The package directory is not a directory."); return stat;}
function readJSON(filename, maxBytes = MAX_METADATA) {
	const stat = checkedPath(filename);
	if (!stat || !stat.isFile() || stat.size > maxBytes) throw failure("PACKAGE_MANIFEST", "Missing or oversized package manifest.");
	const bytes = fs.readFileSync(filename), text = bytes.toString("utf8");
	if (!Buffer.from(text).equals(bytes)) throw failure("PACKAGE_MANIFEST", "Package metadata must be UTF-8.");
	let data; try {data = JSON.parse(text.replace(/^\uFEFF/, ""));} catch (_) {throw failure("PACKAGE_MANIFEST", "Invalid package manifest JSON.");}
	if (!plain(data)) throw failure("PACKAGE_MANIFEST", "Package metadata must be an object.");
	return data;
}
function fingerprint(root) {
	directory(root);
	const hash = crypto.createHash("sha256"); let count = 0, bytes = 0;
	function scan(folder, relative, depth) {
		if (depth > 32) throw failure("PACKAGE_LIMIT", "Package directory nesting exceeds the supported limit.");
		const names = new Set();
		for (const entry of fs.readdirSync(folder, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
			if (names.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) throw failure("UNSAFE_PATH", "Package contains a link or duplicate file name.");
			names.add(entry.name.toLowerCase());
			const full = path.join(folder, entry.name), rel = relative ? relative + "/" + entry.name : entry.name;
			const stat = fs.lstatSync(full);
			if (stat.isSymbolicLink()) throw failure("UNSAFE_PATH", "Package contains a link.");
			if (stat.isDirectory()) {hash.update("D\0" + rel + "\0"); scan(full, rel, depth + 1);}
			else if (stat.isFile()) {
				if (++count > 20000 || (bytes += stat.size) > MAX_ARCHIVE) throw failure("PACKAGE_LIMIT", "Package exceeds the file or size limit.");
				hash.update("F\0" + rel + "\0" + stat.size + "\0");
				const fd = fs.openSync(full, "r"), buffer = Buffer.allocUnsafe(64 * 1024);
				try {let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n));} finally {fs.closeSync(fd);}
			} else throw failure("UNSAFE_PATH", "Package contains an unsupported filesystem entry.");
		}
	}
	scan(root, "", 0); return hash.digest("hex");
}
function inspectPackage(root, expected) {
	try {
		const stat = checkedPath(root); if (!stat) return {verification: "does-not-exist"};
		if (!stat.isDirectory()) return {verification: "is-file"};
		const manifest = readJSON(path.join(root, "manifest.json"));
		if (!identifier(manifest.name) || !versionString(manifest.version_number) || !Array.isArray(manifest.dependencies) || manifest.dependencies.some(value => typeof value !== "string" || !splitName(value))) throw failure("PACKAGE_MANIFEST", "Thunderstore manifest fields are invalid.");
		if (expected && (manifest.name !== expected.package_name || manifest.version_number !== expected.version)) throw failure("PACKAGE_ID", "The downloaded package does not match the selected release.");
		if (Array.isArray(expected?.dependencies) && [...manifest.dependencies].sort().join("\n") !== [...expected.dependencies].sort().join("\n")) throw failure("PACKAGE_DEPENDENCIES", "The downloaded manifest differs from the selected release's dependency declarations.");
		const modsRoot = path.join(root, "mods"), definitions = [];
		if (directory(modsRoot, true)) for (const entry of fs.readdirSync(modsRoot, {withFileTypes: true})) {
			const folder = path.join(modsRoot, entry.name); if (entry.isSymbolicLink()) throw failure("UNSAFE_PATH", "A mod directory contains a link.");
			if (!entry.isDirectory()) continue;
			const file = path.join(folder, "mod.json"); if (!checkedPath(file)) continue;
			definitions.push(archive.modDefinition(file));
		}
		if (expected && definitions.some(mod => state.CORE_NAMES.some(core => core.toLowerCase() === mod.Name.toLowerCase()))) throw failure("CORE_REQUIRED", "Northstar core components must be installed through the dedicated client installer.");
		const pluginsRoot = path.join(root, "plugins"); let hasPlugins = false;
		if (directory(pluginsRoot, true)) hasPlugins = fs.readdirSync(pluginsRoot).length > 0;
		if (!definitions.length && !hasPlugins) return {verification: "no-mods", manifest, definitions};
		const metadataFile = path.join(root, ".tfx-package.json");
		let metadata = null;
		if (checkedPath(metadataFile)) metadata = readJSON(metadataFile);
		if (metadata && (metadata.schemaVersion !== 1 || !splitName(metadata.id) || metadata.author !== splitName(metadata.id).author || metadata.name !== manifest.name || metadata.version !== manifest.version_number)) throw failure("PACKAGE_ID", "Stored package ownership does not match its manifest.");
		return {verification: hasPlugins ? "has-plugins" : true, manifest, definitions, hasPlugins, metadata};
	} catch (error) {return {verification: error.code || "invalid-manifest", error};}
}
function listPackages(root, remove) {
	const result = Object.create(null); if (!directory(root, true)) return result;
	for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
		const item = splitName(entry.name); if (!item || !entry.isDirectory() || entry.isSymbolicLink()) continue;
		const package_path = path.join(root, entry.name), info = inspectPackage(package_path, item);
		if (![true, "has-plugins"].includes(info.verification)) continue;
		if (info.metadata && info.metadata.id !== entry.name) continue;
		const icon = path.join(package_path, "icon.png"), iconStat = checkedPath(icon);
		result[entry.name] = {...item, package_path, has_plugins: info.hasPlugins, has_mods: info.definitions.length > 0, manifest: info.manifest, icon: iconStat?.isFile() ? icon : false, addedAt: info.metadata?.addedAt || fs.statSync(package_path).birthtimeMs};
		if (remove) result[entry.name].remove = () => remove(item);
	}
	return result;
}
function trustedDownloadURL(value) {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443") && !parsed.hash && DOWNLOAD_HOSTS.has(parsed.hostname);
	} catch (_) {return false;}
}
async function downloadArchive(url, destination, options = {}) {
	const signal = options.signal, maxBytes = options.maxBytes || MAX_ARCHIVE, timeoutMs = options.timeoutMs || 180000;
	const request = options.request || https.get; let received = 0, total = 0, lastProgress = 0, currentRequest = null, currentResponse = null, ownsFile = false;
	if (!trustedDownloadURL(url)) throw failure("DOWNLOAD_URL", "The package URL is not a Thunderstore HTTPS endpoint.");
	const deadline = setTimeout(() => {currentRequest?.destroy(failure("DOWNLOAD_TIMEOUT", "Package download exceeded the time limit.")); currentResponse?.destroy(failure("DOWNLOAD_TIMEOUT", "Package download exceeded the time limit."));}, timeoutMs);
	const onAbort = () => {currentRequest?.destroy(cancelled()); currentResponse?.destroy(cancelled());};
	signal?.addEventListener("abort", onAbort, {once: true});
	try {
		abortCheck(signal);
		async function connect(address, redirects) {
			abortCheck(signal);
			if (!trustedDownloadURL(address)) throw failure("DOWNLOAD_REDIRECT", "Thunderstore redirected to an untrusted download host.");
			const response = await new Promise((resolve, reject) => {
				currentRequest = request(address, {headers: {"User-Agent": "TFX-Launcher", Accept: "application/zip, application/octet-stream"}}, resolve);
				currentRequest.once("error", reject);
				currentRequest.setTimeout?.(30000, () => currentRequest.destroy(failure("DOWNLOAD_TIMEOUT", "Package download stalled.")));
			});
			currentResponse = response;
			if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
				response.resume();
				if (redirects >= 4 || typeof response.headers.location !== "string") throw failure("DOWNLOAD_REDIRECT", "Invalid or excessive download redirects.");
				return connect(new URL(response.headers.location, address).href, redirects + 1);
			}
			if (response.statusCode !== 200) {response.resume(); throw failure("DOWNLOAD_HTTP", "Package download returned HTTP " + response.statusCode + ".");}
			return response;
		}
		const response = await connect(url, 0), header = response.headers["content-length"];
		if (header !== undefined && !/^\d+$/.test(String(header))) throw failure("DOWNLOAD_LENGTH", "The server returned an invalid download size.");
		total = header === undefined ? 0 : Number(header);
		if (total > maxBytes || (options.expectedBytes > maxBytes)) throw failure("DOWNLOAD_LIMIT", "Package download exceeds the size limit.");
		const expected = options.expectedBytes > 0 ? options.expectedBytes : total;
		if (total && expected && total !== expected) throw failure("DOWNLOAD_LENGTH", "Download size differs from the Thunderstore release metadata.");
		const report = force => {const now = Date.now(); if (force || now - lastProgress >= 100) {lastProgress = now; options.progress?.({received, total: expected, progress: expected ? Math.floor(received / expected * 100) : -1});}};
		report(true);
		const limiter = new Transform({transform(chunk, _encoding, callback) {
			received += chunk.length;
			if (signal?.aborted) return callback(cancelled());
			if (received > maxBytes || (expected && received > expected)) return callback(failure("DOWNLOAD_LIMIT", "The server sent more bytes than permitted."));
			report(false); callback(null, chunk);
		}});
		const output = fs.createWriteStream(destination, {flags: "wx"}); output.once("open", () => {ownsFile = true;});
		await pipeline(response, limiter, output);
		abortCheck(signal);
		if (!response.complete || (expected && received !== expected)) throw failure("DOWNLOAD_TRUNCATED", "The package download was incomplete.");
		if (!received) throw failure("DOWNLOAD_EMPTY", "The package download was empty.");
		report(true); return destination;
	} catch (error) {
		currentRequest?.destroy(); currentResponse?.destroy();
		if (ownsFile) try {await fsp.unlink(destination);} catch (cleanup) {if (cleanup.code !== "ENOENT") error.cleanupError = cleanup.message;}
		if (signal?.aborted) throw cancelled(); throw error;
	} finally {clearTimeout(deadline); signal?.removeEventListener("abort", onAbort);}
}
function removePackageSync(root, selection) {
	if (!identifier(selection.author) || !identifier(selection.package_name) || (selection.version && !versionString(selection.version))) return false;
	const candidates = Object.values(listPackages(root)).filter(item => item.author === selection.author && item.package_name === selection.package_name && (!selection.version || item.version === selection.version));
	if (!candidates.length) return false;
	for (const item of candidates) fingerprint(item.package_path);
	for (const item of candidates) fs.rmSync(item.package_path, {recursive: true});
	return true;
}
function transactionJournal(transaction, journal) {
	const file = path.join(transaction, "transaction.json"), temporary = file + ".tmp";
	fs.writeFileSync(temporary, JSON.stringify(journal, null, 2) + "\n", {flag: "wx"}); fs.renameSync(temporary, file);
}
function recoverTransaction(root, transaction, journal) {
	if (journal.schemaVersion !== 1 || !samePath(journal.profileDirectory, path.dirname(root)) || !Array.isArray(journal.entries) || journal.entries.length > MAX_PLAN * 2) throw failure("INSTALL_RECOVERY", "An installation journal needs manual inspection: " + transaction);
	const seen = new Set();
	const entries = journal.entries.map(entry => {
		if (!splitName(entry.destination) || seen.has(entry.destination.toLowerCase()) || !/^new-\d+$/.test(entry.staged) || !/^old-\d+$/.test(entry.backup) || typeof entry.previous !== "boolean" || !/^[a-f0-9]{64}$/.test(entry.nextDigest) || (entry.previous && !/^[a-f0-9]{64}$/.test(entry.originalDigest))) throw failure("INSTALL_RECOVERY", "An installation journal has invalid recovery paths: " + transaction);
		seen.add(entry.destination.toLowerCase());
		const target = path.join(root, entry.destination), backup = path.join(transaction, entry.backup), targetExists = directory(target, true), backupExists = directory(backup, true);
		const targetDigest = targetExists ? fingerprint(target) : null;
		if (backupExists && fingerprint(backup) !== entry.originalDigest) throw failure("INSTALL_RECOVERY", "An older package backup changed; it has been preserved: " + backup);
		if (targetExists && targetDigest !== entry.nextDigest && (!entry.previous || targetDigest !== entry.originalDigest)) throw failure("INSTALL_RECOVERY", "A package changed outside the installer; it has been preserved: " + target);
		if (entry.previous && !backupExists && targetDigest !== entry.originalDigest) throw failure("INSTALL_RECOVERY", "The previous package cannot be safely restored: " + transaction);
		return {...entry, target, backup, backupExists, targetDigest};
	});
	let restoredState = null;
	if (journal.modState) {
		if (!plain(journal.modState) || ![null, "string"].includes(journal.modState.original === null ? null : typeof journal.modState.original) || typeof journal.modState.intended !== "string") throw failure("INSTALL_RECOVERY", "The mod-state recovery journal is invalid: " + transaction);
		const original = journal.modState.original === null ? null : Buffer.from(journal.modState.original, "base64"), intended = Buffer.from(journal.modState.intended, "base64");
		if ((original && original.length > MAX_METADATA) || intended.length > MAX_METADATA || (original && original.toString("base64") !== journal.modState.original) || intended.toString("base64") !== journal.modState.intended) throw failure("INSTALL_RECOVERY", "The mod-state recovery bytes are invalid: " + transaction);
		state.parse(original); state.parse(intended);
		const file = path.join(journal.profileDirectory, "enabledmods.json"), actual = state.checked(file);
		if (!((actual === null && original === null) || actual?.equals(original || Buffer.alloc(0)) || actual?.equals(intended))) throw failure("INSTALL_RECOVERY", "Mod enable choices changed outside the installer; recovery files were preserved: " + transaction);
		restoredState = {file, actual, original, intended};
	}
	for (const entry of entries.reverse()) {
		if (entry.backupExists) {if (directory(entry.target, true)) fs.rmSync(entry.target, {recursive: true}); fs.renameSync(entry.backup, entry.target);}
		else if (!entry.previous && entry.targetDigest === entry.nextDigest) fs.rmSync(entry.target, {recursive: true});
	}
	if (restoredState?.actual?.equals(restoredState.intended) && !restoredState.actual.equals(restoredState.original || Buffer.alloc(0))) {
		if (restoredState.original) state.write(restoredState.file, restoredState.intended, restoredState.original); else fs.unlinkSync(restoredState.file);
	}
	fs.rmSync(transaction, {recursive: true});
}
function recoverInterrupted(root) {
	if (!directory(root, true)) return;
	for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
		if (!/^\.tfx-install-[a-f0-9-]+$/.test(entry.name)) continue;
		const transaction = path.join(root, entry.name); directory(transaction);
		const journal = readJSON(path.join(transaction, "transaction.json"), MAX_METADATA * 3);
		if (journal.phase === "committed") {fingerprint(transaction); fs.rmSync(transaction, {recursive: true});}
		else recoverTransaction(root, transaction, journal);
	}
}
function preserveState(profileDirectory, staged) {
	const file = path.join(profileDirectory, "enabledmods.json"), original = state.checked(file), document = state.parse(original);
	if (document.format === "flat") return {file, original, intended: original};
	let changed = false;
	for (const item of staged) {
		const previousDefinitions = item.previous.flatMap(old => inspectPackage(old.package_path).definitions || []);
		for (const mod of item.info.definitions) {
			if (!mod.Version || Object.prototype.hasOwnProperty.call(document.states[mod.Name] || {}, mod.Version)) continue;
			const old = previousDefinitions.filter(definition => definition.Name === mod.Name && definition.Version);
			if (!old.length) continue;
			const choices = old.map(definition => state.enabled(document, definition.Name, definition.Version));
			if (choices.every(choice => choice === choices[0])) {state.set(document, mod.Name, mod.Version, choices[0]); changed = true;}
		}
	}
	return {file, original, intended: changed ? state.serialize(document) : original};
}
function createInstaller(options) {
	const jobs = new Map(), download = options.download || downloadArchive, extract = options.extract || archive.extractZip;
	const profile = () => {const result = options.profile(); if (!plain(result) || !path.isAbsolute(result.gamePath) || !path.isAbsolute(result.profileDirectory)) throw failure("GAME_PATH", "Invalid installed game profile."); directory(result.gamePath); directory(result.profileDirectory); return result;};
	const guarded = async captured => {
		const verify = () => {const current = profile(); if (!samePath(captured.gamePath, current.gamePath) || !samePath(captured.profileDirectory, current.profileDirectory)) throw failure("PROFILE_CHANGED", "The selected game profile changed.");};
		verify(); await options.guard?.(captured); verify();
	};
	const commit = options.commit || (action => action());
	async function install(request) {
		const selected = identity(request), key = selected.package_name;
		if (jobs.has(key)) throw failure("INSTALL_BUSY", "This package is already being installed.");
		const controller = new AbortController(); jobs.set(key, controller);
		let work, transaction = null, preserved = false;
		const signal = controller.signal;
		try {
			const captured = profile(), root = path.join(captured.profileDirectory, "packages");
			await guarded(captured); abortCheck(signal);
			const installed = Object.values(listPackages(root)).map(item => ({author: item.author, package_name: item.package_name, version: item.version}));
			const plan = await interruptible(options.planInstall(selected, {installed}), signal); abortCheck(signal);
			if (!plain(plan) || !Array.isArray(plan.packages) || !plan.packages.length || plan.packages.length > MAX_PLAN) throw failure("INSTALL_PLAN", "The dependency plan is invalid or exceeds the package limit.");
			const unique = new Set(); let bytes = 0;
			for (const item of plan.packages) {identity(item); const pair = item.author.toLowerCase() + "/" + item.package_name.toLowerCase(); if (unique.has(pair) || !trustedDownloadURL(item.downloadUrl) || (item.author.toLowerCase() === "northstar" && item.package_name.toLowerCase() === "northstar")) throw failure("INSTALL_PLAN", "The dependency plan contains a duplicate or unsupported package."); unique.add(pair); if (!Number.isSafeInteger(item.fileSize) || item.fileSize <= 0 || (bytes += item.fileSize) > MAX_ARCHIVE) throw failure("DOWNLOAD_LIMIT", "The installation plan has an invalid download size or exceeds the size limit.");}
			if (!plan.packages.some(item => formatName(item.author, item.package_name, item.version) === formatName(selected.author, selected.package_name, selected.version))) throw failure("INSTALL_PLAN", "The selected release is missing from the dependency plan.");
			const cacheRoot = path.resolve(typeof options.cacheRoot === "function" ? options.cacheRoot() : options.cacheRoot); directory(cacheRoot, true); await fsp.mkdir(cacheRoot, {recursive: true}); directory(cacheRoot);
			work = await fsp.mkdtemp(path.join(cacheRoot, "install-"));
			const staged = [];
			for (let index = 0; index < plan.packages.length; index++) {
				const item = plan.packages[index], id = formatName(item.author, item.package_name, item.version), zip = path.join(work, index + ".zip"), folder = path.join(work, "package-" + index);
				const notify = progress => options.progress?.({package_name: key, root_package_name: key, dependency_name: item.package_name, package_index: index + 1, package_count: plan.packages.length, ...progress});
				abortCheck(signal); await download(item.downloadUrl, zip, {signal, expectedBytes: item.fileSize, progress: progress => notify({...progress, phase: "downloading"})});
				abortCheck(signal); notify({phase: "extracting", progress: 100}); await fsp.mkdir(folder); await extract(zip, folder); abortCheck(signal);
				const info = inspectPackage(folder, item); if (![true, "has-plugins"].includes(info.verification)) throw info.error || failure("PACKAGE_CONTENT", "The downloaded release does not contain compatible Northstar mods.");
				fingerprint(folder); notify({phase: "verifying", progress: 100}); staged.push({item, id, folder, info});
			}
			const plugins = staged.filter(item => item.info.hasPlugins).map(item => ({...item.item, id: item.id}));
			if (plugins.length && !await options.confirmPlugins?.(plugins)) throw cancelled();
			abortCheck(signal);
			const result = await commit(async () => {
				await guarded(captured); abortCheck(signal); directory(root, true); await fsp.mkdir(root, {recursive: true}); directory(root); recoverInterrupted(root);
				const current = Object.values(listPackages(root));
				const freshPlan = await interruptible(options.planInstall(selected, {installed: current.map(item => ({author: item.author, package_name: item.package_name, version: item.version}))}), signal);
				const planIds = plan.packages.map(item => formatName(item.author, item.package_name, item.version)).sort().join("\n");
				if (!Array.isArray(freshPlan.packages) || freshPlan.packages.map(item => formatName(item.author, item.package_name, item.version)).sort().join("\n") !== planIds) throw failure("DEPENDENCY_CHANGED", "Installed dependencies changed during the download. Retry to rebuild the installation plan.");
				const families = new Set(staged.map(item => item.item.author + "/" + item.item.package_name));
				const relevantIds = values => values.filter(item => families.has(item.author + "/" + item.package_name)).map(item => formatName(item.author, item.package_name, item.version)).sort().join("\n");
				if (relevantIds(current) !== relevantIds(installed)) throw failure("PACKAGE_CHANGED", "An installed package version changed during the download. Retry installation.");
				for (const item of staged) {
					if (current.some(old => old.author.toLowerCase() === item.item.author.toLowerCase() && old.package_name.toLowerCase() === item.item.package_name.toLowerCase() && (old.author !== item.item.author || old.package_name !== item.item.package_name))) throw failure("PACKAGE_CASE_CONFLICT", "A different Thunderstore package already uses the same Windows folder name. It has been preserved.");
					item.previous = current.filter(old => old.author === item.item.author && old.package_name === item.item.package_name);
				}
				transaction = await fsp.mkdtemp(path.join(root, ".tfx-install-"));
				const entries = [], journal = {schemaVersion: 1, phase: "prepared", profileDirectory: captured.profileDirectory, entries};
				let counter = 0;
				for (const item of staged) {
					const stagedName = "new-" + counter, target = path.join(root, item.id); directory(target, true);
					if (directory(target, true) && !item.previous.some(old => samePath(old.package_path, target))) throw failure("PACKAGE_OWNERSHIP", "A directory with this package name is not a verified owned package.");
					await fsp.cp(item.folder, path.join(transaction, stagedName), {recursive: true, errorOnExist: true, force: false});
					const addedAt = item.previous.length ? Math.min(...item.previous.map(old => old.addedAt || Date.now())) : Date.now();
					fs.writeFileSync(path.join(transaction, stagedName, ".tfx-package.json"), JSON.stringify({schemaVersion: 1, id: item.id, author: item.item.author, name: item.item.package_name, version: item.item.version, addedAt, installedAt: new Date().toISOString()}, null, 2) + "\n");
					const targetOld = item.previous.find(old => samePath(old.package_path, target));
					entries.push({destination: item.id, staged: stagedName, backup: "old-" + counter, previous: Boolean(targetOld), originalDigest: targetOld ? fingerprint(targetOld.package_path) : null, nextDigest: fingerprint(path.join(transaction, stagedName))}); counter++;
					for (const old of item.previous.filter(old => old !== targetOld)) {entries.push({destination: path.basename(old.package_path), staged: "new-" + counter, backup: "old-" + counter, previous: true, originalDigest: fingerprint(old.package_path), nextDigest: fingerprint(path.join(transaction, stagedName)), obsolete: true}); counter++;}
				}
				if (entries.length > MAX_PLAN * 2) throw failure("INSTALL_PLAN", "Too many older package versions are present to replace in one transaction.");
				transactionJournal(transaction, journal); await guarded(captured); abortCheck(signal);
				const savedState = preserveState(captured.profileDirectory, staged); let stateWritten = false;
				if (savedState.intended && (!savedState.original || !savedState.original.equals(savedState.intended))) journal.modState = {original: savedState.original ? savedState.original.toString("base64") : null, intended: savedState.intended.toString("base64")};
				journal.phase = "committing"; transactionJournal(transaction, journal);
				try {
					options.progress?.({package_name: key, root_package_name: key, phase: "installing", progress: 100, package_count: staged.length});
					for (const entry of entries) {
						const target = path.join(root, entry.destination), exists = directory(target, true);
						if (exists && (!entry.previous || fingerprint(target) !== entry.originalDigest)) throw failure("PACKAGE_CHANGED", "An installed package changed while preparing the replacement.");
						if (entry.previous && !exists) throw failure("PACKAGE_CHANGED", "An installed package was removed while preparing the replacement.");
						if (entry.previous) fs.renameSync(target, path.join(transaction, entry.backup));
						if (!entry.obsolete) fs.renameSync(path.join(transaction, entry.staged), target);
					}
					if (savedState.intended && (!savedState.original || !savedState.original.equals(savedState.intended))) {state.write(savedState.file, savedState.original, savedState.intended); stateWritten = true;}
					journal.phase = "committed"; transactionJournal(transaction, journal);
				} catch (error) {
					try {
						if (stateWritten && state.checked(savedState.file)?.equals(savedState.intended)) {if (savedState.original) state.write(savedState.file, savedState.intended, savedState.original); else fs.unlinkSync(savedState.file);}
						recoverTransaction(root, transaction, journal); transaction = null;
					} catch (recovery) {preserved = true; error.code = "INSTALL_RECOVERY"; error.message += " Recovery files preserved: " + transaction + ". " + recovery.message;}
					throw error;
				}
				return {name: formatName(selected.author, selected.package_name, selected.version), fancy_name: selected.package_name, packages: staged.map(item => item.id), dependencies: plan.dependencies || [], skipped: plan.skipped || []};
			});
			return result;
		} finally {
			jobs.delete(key);
			if (transaction && !preserved) {try {await fsp.rm(transaction, {recursive: true, force: true});} catch (_) {}}
			if (work) {try {await fsp.rm(work, {recursive: true, force: true});} catch (_) {}}
		}
	}
	return {
		install,
		cancel: name => {const job = jobs.get(name); if (!job) return false; job.abort(); return true;},
		cancelAll: () => {for (const controller of jobs.values()) controller.abort();},
		remove: async selection => {const captured = profile(); return commit(async () => {await guarded(captured); return removePackageSync(path.join(captured.profileDirectory, "packages"), selection);});},
		get activeCount() {return jobs.size;}
	};
}
module.exports = {createInstaller, inspectPackage, listPackages, formatName, splitName, removePackageSync, trustedDownloadURL, downloadArchive, fingerprint, recoverInterrupted};
