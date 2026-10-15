"use strict";
const os = require("node:os");
const assert = require("node:assert/strict"), EventEmitter = require("node:events"), path = require("node:path"), fs = require("node:fs"), {Readable} = require("node:stream"), test = require("node:test");
const {downloadArchive, downloadPackage} = require("../src/modules/thunderstore-install");
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

test("a connection that never returns headers rejects even when destroy emits no error", async () => {
	let destroyed=false;
	const request=()=>{const value=new EventEmitter();value.destroy=()=>{destroyed=true;};return value;};
	const file=path.join(fixture,"connect-timeout.zip");
	await assert.rejects(downloadArchive(url,file,{request,connectTimeoutMs:25,timeoutMs:500}),{code:"DOWNLOAD_TIMEOUT"});
	assert.equal(destroyed,true);assert.equal(fs.existsSync(file),false);
});

test("an idle response that stops sending bytes is discarded and may be retried", async () => {
	const file=path.join(fixture,"idle.zip");
	const request=(_url,_options,callback)=>{const value=new EventEmitter(),response=new Readable({read(){}});value.destroy=()=>{};response.statusCode=200;response.headers={"content-length":"100"};response.complete=false;setImmediate(()=>{callback(response);response.push(Buffer.alloc(1));});return value;};
	await assert.rejects(downloadArchive(url,file,{request,idleTimeoutMs:25,timeoutMs:500}),{code:"DOWNLOAD_TIMEOUT"});
	assert.equal(fs.existsSync(file),false);
});

test("a failed official endpoint falls back to the same package on an official CDN", async () => {
	const visited=[],file=path.join(fixture,"fallback.zip"),progress=[];
	const request=(address,_options,callback)=>{visited.push(address);const value=new EventEmitter();value.destroy=()=>{};setImmediate(()=>{if(visited.length===1){value.emit("error",Object.assign(Error("connection reset"),{code:"ECONNRESET"}));return;}const response=Readable.from([Buffer.from("1234")]);response.statusCode=200;response.headers={"content-length":"4"};response.complete=true;callback(response);});return value;};
	await downloadPackage(url,file,{request,expectedBytes:4,progress:value=>progress.push(value)});
	assert.deepEqual(visited,[url,"https://gcdn.thunderstore.io/live/repository/packages/SomeAuthor-SomePackage-1.0.0.zip"]);
	assert.equal(fs.readFileSync(file,"utf8"),"1234");assert.equal(progress.at(-1).progress,100);
});

test("fallback never retries an untrusted redirect or a package size mismatch", async () => {
	for(const mode of ["redirect","size"]){let attempts=0;const file=path.join(fixture,mode+"-refused.zip");
		const request=(_address,_options,callback)=>{attempts++;const value=new EventEmitter();value.destroy=()=>{};setImmediate(()=>{const response=Readable.from([Buffer.from("bad")]);response.statusCode=mode==="redirect"?302:200;response.headers=mode==="redirect"?{location:"https://example.invalid/mod.zip"}:{"content-length":"3"};response.complete=true;callback(response);});return value;};
		await assert.rejects(downloadPackage(url,file,{request,expectedBytes:4}),{code:mode==="redirect"?"DOWNLOAD_REDIRECT":"DOWNLOAD_LENGTH"});assert.equal(attempts,1);assert.equal(fs.existsSync(file),false);
	}
});

test.after(() => {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("tfx-package-download-"));
  const stat = fs.lstatSync(root); assert(stat.isDirectory() && !stat.isSymbolicLink());
  fs.rmSync(root, {recursive: true, force: true});
});
