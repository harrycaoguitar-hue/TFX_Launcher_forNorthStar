"use strict";
const os = require("node:os");
const assert = require("node:assert/strict"), EventEmitter = require("node:events"), path = require("node:path"), fs = require("node:fs"), {Readable} = require("node:stream"), test = require("node:test");
const {downloadArchive} = require("../src/modules/thunderstore-install");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tfx-package-download-"));

const fixture = fs.mkdtempSync(path.join(root, "progress-"));
test.after(() => {assert.ok(path.resolve(fixture).startsWith(path.resolve(root) + path.sep)); fs.rmSync(fixture, {recursive: true, force: true});});
function streamingRequest() {
	return (_url, _options, callback) => {
		const request = new EventEmitter(), response = new Readable({read() {}});
		let bytes = 0, stopped = false;
		request.setTimeout = () => {};
		request.destroy = error => {stopped = true; clearInterval(timer); response.destroy(error); if (error) request.emit("error", error);};
		response.statusCode = 200; response.headers = {"content-length": "1000"}; response.complete = false;
		const timer = setInterval(() => {if (stopped) return; if (bytes === 1000) {clearInterval(timer); response.complete = true; response.push(null);} else {response.push(Buffer.alloc(100)); bytes += 100;}}, 110);
		setImmediate(() => callback(response));
		return request;
	};
}
const url = "https://thunderstore.io/package/download/SomeAuthor/SomePackage/1.0.0/";
test("download reports throttled progress and resolves only after the complete ZIP is closed", async () => {
	const progress = [], zip = path.join(fixture, "complete.zip");
	assert.equal(await downloadArchive(url, zip, {request: streamingRequest(), expectedBytes: 1000, progress: value => progress.push(value)}), zip);
	assert.ok(progress.length >= 5); assert.equal(progress.at(-1).progress, 100); assert.equal(progress.at(-1).received, 1000); assert.equal(progress.at(-1).total, 1000); assert.equal(fs.statSync(zip).size, 1000);
});
test("cancelling a streamed download rejects with cancellation and removes its partial ZIP", async () => {
	const controller = new AbortController(), zip = path.join(fixture, "cancelled.zip");
	await assert.rejects(downloadArchive(url, zip, {request: streamingRequest(), signal: controller.signal, progress: value => {if (value.received >= 100) controller.abort();}}), error => error.cancelled);
	assert.equal(fs.existsSync(zip), false);
});

test.after(() => {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("tfx-package-download-"));
  const stat = fs.lstatSync(root); assert(stat.isDirectory() && !stat.isSymbolicLink());
  fs.rmSync(root, {recursive: true, force: true});
});
