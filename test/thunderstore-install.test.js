"use strict";
const os = require("node:os");
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), fsp = fs.promises, path = require("path"), crypto = require("crypto");
const {Readable} = require("stream"), {EventEmitter} = require("events");
const {createInstaller, inspectPackage, listPackages, formatName, splitName, removePackageSync, trustedDownloadURL, downloadArchive, fingerprint, recoverInterrupted} = require("../src/modules/thunderstore-install");
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "tfx-thunderstore-install-"));
const rootSelection = {author: "Pilot", package_name: "Warden", version: "2.0.0"};
const id = value => formatName(value.author, value.package_name, value.version);
const release = (selected = rootSelection, dependencies = []) => ({...selected, id: id(selected), downloadUrl: "https://thunderstore.io/package/download/" + selected.author + "/" + selected.package_name + "/" + selected.version + "/", fileSize: 10, dependencies});
async function fixture(t, custom = false) {
	await fsp.mkdir(BASE, {recursive: true});
	const base = await fsp.mkdtemp(path.join(BASE, "case-")), gamePath = path.join(base, "game"), profileDirectory = path.join(gamePath, custom ? "CustomPilot" : "R2Northstar"), cacheRoot = path.join(base, "cache");
	await fsp.mkdir(profileDirectory, {recursive: true});
	t.after(async () => {assert.ok(path.resolve(base).startsWith(path.resolve(BASE) + path.sep)); await fsp.rm(base, {recursive: true, force: true});});
	return {base, gamePath, profileDirectory, cacheRoot, root: path.join(profileDirectory, "packages")};
}
async function packageFolder(folder, selected, extra = {}) {
	await fsp.mkdir(folder, {recursive: true});
	const manifest = {name: selected.package_name, version_number: selected.version, dependencies: extra.dependencies || []};
	await fsp.writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest));
	if (extra.plugin) {await fsp.mkdir(path.join(folder, "plugins")); await fsp.writeFile(path.join(folder, "plugins", "example.dll"), "not executed");}
	if (!extra.pluginOnly) {await fsp.mkdir(path.join(folder, "mods", "Warden"), {recursive: true}); await fsp.writeFile(path.join(folder, "mods", "Warden", "mod.json"), JSON.stringify({Name: extra.modName || selected.package_name, Version: selected.version})); await fsp.writeFile(path.join(folder, "mods", "Warden", "script.nut"), extra.body || selected.version);}
	return folder;
}
function installerFor(f, additional = {}) {
	const progress = [], downloads = [];
	const options = {profile: () => f, cacheRoot: f.cacheRoot, guard: async () => {}, commit: fn => fn(), progress: value => progress.push(value), confirmPlugins: async () => true,
		planInstall: async selected => ({root: release(selected), packages: [release(selected)], dependencies: [], skipped: []}),
		download: async (url, file, config) => {downloads.push(url); config.progress({progress: 100, received: 10, total: 10}); await fsp.writeFile(file, JSON.stringify({url}));},
		extract: async (file, folder) => {const payload = JSON.parse(await fsp.readFile(file)); const match = /download\/([^/]+)\/([^/]+)\/([^/]+)\//.exec(payload.url); await packageFolder(folder, {author: match[1], package_name: match[2], version: match[3]});}, ...additional};
	return {engine: createInstaller(options), progress, downloads, options};
}
function crc(bytes) {let value = 0xffffffff; for (const byte of bytes) {value ^= byte; for (let i = 0; i < 8; i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;} return (value ^ 0xffffffff) >>> 0;}
function zip(entries) {
	const locals = [], central = []; let position = 0;
	for (const [name, contents] of entries) {
		const filename = Buffer.from(name), bytes = Buffer.from(contents), local = Buffer.alloc(30), directory = Buffer.alloc(46);
		local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc(bytes), 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
		directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(crc(bytes), 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(position, 42);
		locals.push(local, filename, bytes); central.push(directory, filename); position += local.length + filename.length + bytes.length;
	}
	const body = Buffer.concat(locals), index = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(body.length, 16);
	return Buffer.concat([body, index, end]);
}
function requestFixture(steps, visited = []) {
	return (url, _options, callback) => {
		visited.push(url); const request = new EventEmitter(); request.setTimeout = () => {}; let response;
		request.destroy = error => {response?.destroy(error); if (error) process.nextTick(() => request.emit("error", error));};
		process.nextTick(() => {const step = steps[visited.length - 1] || steps.at(-1); response = step.stall ? new Readable({read() {}}) : Readable.from(step.chunks || [Buffer.from(step.body || "zip")]); response.statusCode = step.status || 200; response.headers = step.headers || {}; response.complete = step.complete !== false; callback(response);});
		return request;
	};
}
test("Thunderstore identities are exact and unsafe author/path strings are rejected", () => {
	assert.equal(formatName("Pilot", "Warden", "v2.0.0"), "Pilot-Warden-2.0.0"); assert.deepEqual(splitName("Pilot-Warden-2.0.0-beta.1"), {author: "Pilot", package_name: "Warden", version: "2.0.0-beta.1"});
	assert.equal(splitName("../../Warden"), false); assert.throws(() => formatName("../Pilot", "Warden", "2.0.0"), {code: "PACKAGE_ID"});
	for (const url of ["http://thunderstore.io/package", "https://thunderstore.io.evil.invalid/a", "https://user:secret@thunderstore.io/a", "https://ccdn.thunderstore.io:444/a"]) assert.equal(trustedDownloadURL(url), false);
	assert.equal(trustedDownloadURL("https://ccdn.thunderstore.io/live/repository/packages/example.zip"), true);
});
test("upgrading a package preserves local mods, another author's same-name package, added time and flat enable choices", async t => {
	const f = await fixture(t), old = {...rootSelection, version: "1.0.0"}, other = {...old, author: "OtherPilot"};
	await packageFolder(path.join(f.root, id(old)), old); await packageFolder(path.join(f.root, id(other)), other);
	const local = path.join(f.profileDirectory, "mods", "Warden"); await packageFolder(local, old, {body: "local author content"});
	const localHash = fingerprint(local), otherHash = fingerprint(path.join(f.root, id(other))), stateFile = path.join(f.profileDirectory, "enabledmods.json"), stateBytes = Buffer.from('{"Warden":false}\n'); await fsp.writeFile(stateFile, stateBytes);
	const oldAddedAt = listPackages(f.root)[id(old)].addedAt, {engine, progress} = installerFor(f); const result = await engine.install(rootSelection);
	assert.equal(result.fancy_name, "Warden"); assert.equal(fs.existsSync(path.join(f.root, id(old))), false); assert.equal(fingerprint(local), localHash); assert.equal(fingerprint(path.join(f.root, id(other))), otherHash); assert.deepEqual(fs.readFileSync(stateFile), stateBytes);
	assert.equal(listPackages(f.root)[id(rootSelection)].addedAt, oldAddedAt); assert.ok(progress.every(item => item.package_name === "Warden")); assert.equal(engine.activeCount, 0); assert.deepEqual(fs.readdirSync(f.cacheRoot), []);
});
test("custom profile install preserves versioned disabled choice across a mod upgrade", async t => {
	const f = await fixture(t, true), old = {...rootSelection, version: "1.0.0"}; await packageFolder(path.join(f.root, id(old)), old);
	await fsp.writeFile(path.join(f.profileDirectory, "enabledmods.json"), JSON.stringify({Version: 1, Warden: {"1.0.0": false}, Other: {"4.0.0": true}}));
	await installerFor(f).engine.install(rootSelection);
	const saved = JSON.parse(fs.readFileSync(path.join(f.profileDirectory, "enabledmods.json"))); assert.equal(saved.Warden["1.0.0"], false); assert.equal(saved.Warden["2.0.0"], false); assert.equal(saved.Other["4.0.0"], true); assert.equal(fs.existsSync(path.join(f.gamePath, "R2Northstar")), false);
});
test("all dependencies are staged first and report progress under the root package", async t => {
	const f = await fixture(t), dependency = release({author: "Community", package_name: "Helper", version: "1.2.0"}), root = release(rootSelection, [dependency.id]);
	const {engine, progress} = installerFor(f, {planInstall: async () => ({root, packages: [dependency, root], dependencies: [dependency.id], skipped: []}), extract: async (file, folder) => {const match = /download\/([^/]+)\/([^/]+)\/([^/]+)\//.exec(JSON.parse(fs.readFileSync(file)).url); const selected = {author: match[1], package_name: match[2], version: match[3]}; await packageFolder(folder, selected, {dependencies: selected.package_name === "Warden" ? [dependency.id] : []});}});
	const result = await engine.install(rootSelection); assert.deepEqual(result.packages, [dependency.id, root.id]); assert.equal(Object.keys(listPackages(f.root)).length, 2); assert.ok(progress.every(value => value.package_name === "Warden")); assert.ok(progress.some(value => value.dependency_name === "Helper"));
});
test("a broken dependency prevents every replacement and leaves the installed package byte-identical", async t => {
	const f = await fixture(t), old = {...rootSelection, version: "1.0.0"}; await packageFolder(path.join(f.root, id(old)), old); const baseline = fingerprint(f.root), dependency = release({author: "Community", package_name: "Broken", version: "1.0.0"});
	const {engine} = installerFor(f, {planInstall: async () => ({packages: [release(rootSelection), dependency]}), extract: async (file, folder) => {if (JSON.parse(fs.readFileSync(file)).url.includes("Broken")) throw Error("Corrupt ZIP fixture"); await packageFolder(folder, rootSelection);}});
	await assert.rejects(engine.install(rootSelection), /Corrupt ZIP/); assert.equal(fingerprint(f.root), baseline); assert.deepEqual(fs.readdirSync(f.cacheRoot), []);
});
test("manifest release identity and dependency mismatches are refused before commit", async t => {
	for (const mode of ["name", "version", "dependency"]) {
		const f = await fixture(t), {engine} = installerFor(f, {extract: async (_file, folder) => packageFolder(folder, mode === "name" ? {...rootSelection, package_name: "Forged"} : mode === "version" ? {...rootSelection, version: "99.0.0"} : rootSelection, {dependencies: mode === "dependency" ? ["Unknown-Required-1.0.0"] : []})});
		await assert.rejects(engine.install(rootSelection), error => ["PACKAGE_ID", "PACKAGE_DEPENDENCIES"].includes(error.code)); assert.equal(fs.existsSync(f.root), false);
	}
});
test("core-client and duplicate family plans cannot enter the package installer", async t => {
	const f = await fixture(t);
	for (const packages of [[release(rootSelection), release({author: "Northstar", package_name: "Northstar", version: "1.0.0"})], [release(rootSelection), release({...rootSelection, version: "1.0.0"})]]) {
		const {engine, downloads} = installerFor(f, {planInstall: async () => ({packages})}); await assert.rejects(engine.install(rootSelection), {code: "INSTALL_PLAN"}); assert.deepEqual(downloads, []);
	}
});
test("cancellation after catalog resolution stops before creating game or cache content", async t => {
	const f = await fixture(t); let resolvePlan; const planned = new Promise(resolve => {resolvePlan = resolve;}); const {engine, downloads} = installerFor(f, {planInstall: () => planned}); const pending = engine.install(rootSelection);
	await new Promise(resolve => setImmediate(resolve)); assert.equal(engine.cancel("Warden"), true); resolvePlan({packages: [release(rootSelection)]}); await assert.rejects(pending, error => error.cancelled); assert.deepEqual(downloads, []); assert.equal(fs.existsSync(f.root), false); assert.equal(fs.existsSync(f.cacheRoot), false);
});
test("cancelling an unresolved catalog request returns immediately without waiting for its network response", async t => {
	const f = await fixture(t), {engine} = installerFor(f, {planInstall: () => new Promise(() => {})}); const pending = engine.install(rootSelection);
	await new Promise(resolve => setImmediate(resolve)); engine.cancel("Warden"); await assert.rejects(pending, error => error.cancelled); assert.equal(engine.activeCount, 0); assert.equal(fs.existsSync(f.root), false);
});
test("case-sensitive Thunderstore ownership cannot remove a different package on Windows", async t => {
	const f = await fixture(t), other = {...rootSelection, package_name: "warden", version: "1.0.0"}; await packageFolder(path.join(f.root, id(other)), other); const original = fingerprint(f.root);
	await assert.rejects(installerFor(f).engine.install(rootSelection), {code: "PACKAGE_CASE_CONFLICT"}); assert.equal(fingerprint(f.root), original);
});
test("core component names inside a community package are rejected before touching the profile", async t => {
	const f = await fixture(t), {engine} = installerFor(f, {extract: async (_file, folder) => packageFolder(folder, rootSelection, {modName: "Northstar.Client"})});
	await assert.rejects(engine.install(rootSelection), {code: "CORE_REQUIRED"}); assert.equal(fs.existsSync(f.root), false);
});
test("dependency changes during a download rebuild the plan without committing stale packages", async t => {
	const f = await fixture(t); let plans = 0; const {engine} = installerFor(f, {planInstall: async () => ({packages: ++plans === 1 ? [release(rootSelection)] : [release({author: "Helpers", package_name: "Dependency", version: "1.0.0"}), release(rootSelection)]})});
	await assert.rejects(engine.install(rootSelection), {code: "DEPENDENCY_CHANGED"}); assert.equal(Object.keys(listPackages(f.root)).length, 0);
});
test("cancellation during an extraction discards its snapshot and leaves game files untouched", async t => {
	const f = await fixture(t); let engine; const built = installerFor(f, {extract: async (_file, folder) => {await packageFolder(folder, rootSelection); engine.cancel("Warden");}}); engine = built.engine;
	await assert.rejects(engine.install(rootSelection), error => error.cancelled); assert.equal(fs.existsSync(f.root), false); assert.deepEqual(fs.readdirSync(f.cacheRoot), []);
});
test("a changed profile or game-process guard rejection aborts before replacement", async t => {
	for (const change of [true, false]) {
		const f = await fixture(t), old = {...rootSelection, version: "1.0.0"}; await packageFolder(path.join(f.root, id(old)), old); const baseline = fingerprint(f.root); let selected = f, calls = 0;
		const {engine} = installerFor(f, {profile: () => selected, guard: async () => {if (++calls > 1 && !change) throw Object.assign(Error("Game running"), {code: "GAME_RUNNING"});}, extract: async (_file, folder) => {await packageFolder(folder, rootSelection); if (change) {const next = path.join(f.gamePath, "Changed"); await fsp.mkdir(next); selected = {...f, profileDirectory: next};}}});
		await assert.rejects(engine.install(rootSelection), error => ["PROFILE_CHANGED", "GAME_RUNNING"].includes(error.code)); assert.equal(fingerprint(f.root), baseline);
	}
});
test("profile changes while the asynchronous process guard is pending are rejected", async t => {
	const f = await fixture(t), next = path.join(f.gamePath, "OtherProfile"); await fsp.mkdir(next); let selected = f;
	const {engine} = installerFor(f, {profile: () => selected, guard: async () => {await Promise.resolve(); selected = {...f, profileDirectory: next};}});
	await assert.rejects(engine.install(rootSelection), {code: "PROFILE_CHANGED"}); assert.equal(fs.existsSync(f.root), false); assert.equal(fs.existsSync(path.join(next, "packages")), false);
});
test("plugin packages require one confirmation for the complete plan and declining cancels everything", async t => {
	const f = await fixture(t); let confirmations = 0; const {engine} = installerFor(f, {extract: async (_file, folder) => packageFolder(folder, rootSelection, {plugin: true}), confirmPlugins: async packages => {confirmations++; assert.equal(packages.length, 1); return false;}});
	await assert.rejects(engine.install(rootSelection), error => error.cancelled); assert.equal(confirmations, 1); assert.equal(fs.existsSync(f.root), false);
});
test("compatible ZIP content installs through TFX's CRC and path-validating archive reader", async t => {
	const f = await fixture(t), bytes = zip([["manifest.json", JSON.stringify({name: "Warden", version_number: "2.0.0", dependencies: []})], ["mods/Warden/mod.json", '{"Name":"Warden","Version":"2.0.0"}'], ["mods/Warden/mod/scripts/client.nut", "// independently staged fixture"]]);
	const {engine} = installerFor(f, {download: async (_url, filename) => fsp.writeFile(filename, bytes), extract: require("../src/modules/local-mod-import").extractZip}); await engine.install(rootSelection); assert.equal(inspectPackage(path.join(f.root, id(rootSelection)), rootSelection).verification, true);
});
test("ZIP path traversal and corrupt CRC cannot change a current installation", async t => {
	for (const traversal of [true, false]) {
		const f = await fixture(t), old = {...rootSelection, version: "1.0.0"}; await packageFolder(path.join(f.root, id(old)), old); const baseline = fingerprint(f.root);
		const bytes = zip(traversal ? [["../outside.txt", "escape"]] : [["manifest.json", "{}"]]);
		if (!traversal) bytes[30 + Buffer.byteLength("manifest.json")] ^= 1;
		const {engine} = installerFor(f, {download: async (_url, filename) => fsp.writeFile(filename, bytes), extract: require("../src/modules/local-mod-import").extractZip}); await assert.rejects(engine.install(rootSelection)); assert.equal(fingerprint(f.root), baseline); assert.equal(fs.existsSync(path.join(f.base, "outside.txt")), false);
	}
});
test("a failed rename during a multi-package commit restores every old package", async t => {
	const f = await fixture(t), old = {...rootSelection, version: "1.0.0"}; await packageFolder(path.join(f.root, id(old)), old); const baseline = fingerprint(f.root), originalRename = fs.renameSync;
	const {engine} = installerFor(f); fs.renameSync = function (from, to) {if (path.basename(from) === "new-0" && path.basename(to) === id(rootSelection)) throw Object.assign(Error("Injected access denied"), {code: "EACCES"}); return originalRename.apply(this, arguments);};
	try {await assert.rejects(engine.install(rootSelection), /Injected access denied/);} finally {fs.renameSync = originalRename;}
	assert.equal(fingerprint(f.root), baseline); assert.equal(fs.readdirSync(f.root).some(name => name.startsWith(".tfx-install-")), false);
});
test("an externally changed installed package is preserved and recovery snapshots are retained", async t => {
	const f = await fixture(t), old = {...rootSelection, version: "1.0.0"}; const oldFolder = await packageFolder(path.join(f.root, id(old)), old);
	const {engine} = installerFor(f, {progress: value => {if (value.phase === "installing") fs.writeFileSync(path.join(oldFolder, "external.txt"), "another program's change");}});
	await assert.rejects(engine.install(rootSelection), {code: "INSTALL_RECOVERY"}); assert.equal(fs.readFileSync(path.join(oldFolder, "external.txt"), "utf8"), "another program's change"); assert.ok(fs.readdirSync(f.root).some(name => name.startsWith(".tfx-install-"))); assert.equal(fs.existsSync(path.join(f.root, id(rootSelection))), true);
});
test("interrupted commit recovery restores the old tree using its exact recorded digest", async t => {
	const f = await fixture(t), old = {...rootSelection, version: "1.0.0"}; const oldFolder = await packageFolder(path.join(f.root, id(old)), old), originalDigest = fingerprint(oldFolder), transaction = path.join(f.root, ".tfx-install-" + crypto.randomUUID()); await fsp.mkdir(transaction);
	const next = await packageFolder(path.join(f.root, id(rootSelection)), rootSelection), nextDigest = fingerprint(next); await fsp.rename(oldFolder, path.join(transaction, "old-1"));
	await fsp.writeFile(path.join(transaction, "transaction.json"), JSON.stringify({schemaVersion: 1, phase: "committing", profileDirectory: f.profileDirectory, entries: [{destination: id(rootSelection), staged: "new-0", backup: "old-0", previous: false, originalDigest: null, nextDigest}, {destination: id(old), staged: "new-1", backup: "old-1", previous: true, originalDigest, nextDigest, obsolete: true}]}));
	recoverInterrupted(f.root); assert.equal(fingerprint(oldFolder), originalDigest); assert.equal(fs.existsSync(next), false); assert.equal(fs.existsSync(transaction), false);
});
test("interrupted commit recovery also restores the previous versioned enable choices", async t => {
	const f = await fixture(t), old = {...rootSelection, version: "1.0.0"}, oldFolder = await packageFolder(path.join(f.root, id(old)), old), originalDigest = fingerprint(oldFolder), transaction = path.join(f.root, ".tfx-install-" + crypto.randomUUID()); await fsp.mkdir(transaction);
	const next = await packageFolder(path.join(f.root, id(rootSelection)), rootSelection), nextDigest = fingerprint(next); await fsp.rename(oldFolder, path.join(transaction, "old-1"));
	const original = Buffer.from('{"Version":1,"Warden":{"1.0.0":false}}\n'), intended = Buffer.from('{"Version":1,"Warden":{"1.0.0":false,"2.0.0":false}}\n'); await fsp.writeFile(path.join(f.profileDirectory, "enabledmods.json"), intended);
	await fsp.writeFile(path.join(transaction, "transaction.json"), JSON.stringify({schemaVersion: 1, phase: "committing", profileDirectory: f.profileDirectory, modState: {original: original.toString("base64"), intended: intended.toString("base64")}, entries: [{destination: id(rootSelection), staged: "new-0", backup: "old-0", previous: false, originalDigest: null, nextDigest}, {destination: id(old), staged: "new-1", backup: "old-1", previous: true, originalDigest, nextDigest, obsolete: true}]}));
	recoverInterrupted(f.root); assert.deepEqual(fs.readFileSync(path.join(f.profileDirectory, "enabledmods.json")), original); assert.equal(fingerprint(oldFolder), originalDigest); assert.equal(fs.existsSync(next), false);
});
test("removal uses exact package author identity and never deletes local mod folders", async t => {
	const f = await fixture(t), other = {...rootSelection, author: "OtherPilot"}; await packageFolder(path.join(f.root, id(rootSelection)), rootSelection); await packageFolder(path.join(f.root, id(other)), other); const local = await packageFolder(path.join(f.profileDirectory, "mods", "Warden"), rootSelection), localHash = fingerprint(local);
	assert.equal(removePackageSync(f.root, rootSelection), true); assert.equal(removePackageSync(f.root, rootSelection), false); assert.equal(Object.keys(listPackages(f.root)).length, 1); assert.equal(fingerprint(local), localHash); assert.equal(fs.existsSync(path.join(f.root, id(other))), true);
});
test("download follows the official ccdn redirect, validates sizes and reports completion", async t => {
	const f = await fixture(t), file = path.join(f.base, "package.zip"), visited = [], progress = []; const request = requestFixture([{status: 302, headers: {location: "https://ccdn.thunderstore.io/live/repository/packages/Pilot-Warden-2.0.0.zip"}}, {body: "12345", headers: {"content-length": "5"}}], visited);
	await downloadArchive(release().downloadUrl, file, {request, expectedBytes: 5, progress: value => progress.push(value)}); assert.equal(fs.readFileSync(file, "utf8"), "12345"); assert.equal(visited.length, 2); assert.equal(progress.at(-1).progress, 100);
});
test("download errors cannot delete a file the downloader did not create", async t => {
	const f = await fixture(t), file = path.join(f.base, "existing.zip"), bytes = Buffer.from("pre-existing user file"); await fsp.writeFile(file, bytes);
	await assert.rejects(downloadArchive(release().downloadUrl, file, {request: requestFixture([{body: "12345", headers: {"content-length": "5"}}]), expectedBytes: 5}), {code: "EEXIST"}); assert.deepEqual(fs.readFileSync(file), bytes);
});
test("download refuses untrusted redirects, HTTP failure, metadata mismatch and truncated content", async t => {
	for (const [step, expectedBytes, code] of [[{status: 302, headers: {location: "https://evil.invalid/payload.zip"}}, 0, "DOWNLOAD_REDIRECT"], [{status: 404}, 0, "DOWNLOAD_HTTP"], [{body: "abc", headers: {"content-length": "3"}}, 5, "DOWNLOAD_LENGTH"], [{body: "abc", complete: false, headers: {"content-length": "3"}}, 3, "DOWNLOAD_TRUNCATED"]]) {
		const f = await fixture(t), file = path.join(f.base, "package.zip"); await assert.rejects(downloadArchive(release().downloadUrl, file, {request: requestFixture([step]), expectedBytes}), {code}); assert.equal(fs.existsSync(file), false);
	}
});
test("oversized or stalled downloads stop and remove the incomplete file", async t => {
	for (const stall of [true, false]) {
		const f = await fixture(t), file = path.join(f.base, "package.zip"); await assert.rejects(downloadArchive(release().downloadUrl, file, {request: requestFixture([stall ? {stall: true} : {body: "12345"}]), maxBytes: 3, timeoutMs: 30}), error => ["DOWNLOAD_TIMEOUT", "DOWNLOAD_LIMIT"].includes(error.code)); assert.equal(fs.existsSync(file), false);
	}
});
test("cancelled streaming download closes its streams and discards its incomplete file", async t => {
	const f = await fixture(t), file = path.join(f.base, "package.zip"), controller = new AbortController(); const pending = downloadArchive(release().downloadUrl, file, {request: requestFixture([{stall: true}]), signal: controller.signal}); setTimeout(() => controller.abort(), 20); await assert.rejects(pending, error => error.cancelled); assert.equal(fs.existsSync(file), false);
});

test.after(() => {
  assert.equal(path.dirname(BASE), path.resolve(os.tmpdir()));
  assert(path.basename(BASE).startsWith("tfx-thunderstore-install-"));
  const stat = fs.lstatSync(BASE); assert(stat.isDirectory() && !stat.isSymbolicLink());
  fs.rmSync(BASE, {recursive: true, force: true});
});
