const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

function loadSystemDns(windowOverrides = {}) {
	let calls = [];
	let handlers = new Map();
	let webContents = {
		focus() { calls.push("contents"); },
		isDestroyed() { return false; }
	};
	let window = {
		focus() { calls.push("window"); },
		isDestroyed() { return false; },
		isMinimized() { return false; },
		restore() { calls.push("restore"); },
		show() { calls.push("show"); },
		setAlwaysOnTop(state) { calls.push(state ? "aot-on" : "aot-off"); },
		...windowOverrides
	};
	let electron = {
		app: {
			focus(options) {
				calls.push(options && options.steal ? "app-steal" : "app");
			}
		},
		BrowserWindow: {fromWebContents() { return window; }},
		ipcMain: {handle(channel, handler) { handlers.set(channel, handler); }}
	};
	let originalLoad = Module._load;

	Module._load = function(request, parent, isMain) {
		if (request === "electron") {
			return electron;
		}
		if (request === "./powershell") {
			return {elevate: async () => {}, run: async () => {}};
		}
		return originalLoad.call(this, request, parent, isMain);
	};

	try {
		let modulePath = path.join(__dirname, "../src/modules/system_dns.js");
		delete require.cache[require.resolve(modulePath)];
		require(modulePath);
	} finally {
		Module._load = originalLoad;
	}

	return {calls, handlers, webContents};
}

test("restores launcher focus once after elevation", async () => {
	let {calls, handlers, webContents} = loadSystemDns();
	let result = await handlers.get("set-system-dns")({sender: webContents}, "aliyun");

	assert.deepEqual(result, {ok: true});
	assert.deepEqual(calls, [
		"aot-on",
		"app",
		"show",
		"window",
		"contents",
		"aot-off"
	]);
});

test("restores a minimized launcher before focusing it", async () => {
	let {calls, handlers, webContents} = loadSystemDns({
		isMinimized() { return true; }
	});

	await handlers.get("set-system-dns")({sender: webContents}, "aliyun");

	assert.deepEqual(calls, [
		"restore",
		"aot-on",
		"app",
		"show",
		"window",
		"contents",
		"aot-off"
	]);
});
