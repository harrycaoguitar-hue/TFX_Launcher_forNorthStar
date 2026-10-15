"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {EventEmitter} = require("events"), {Readable, Writable} = require("stream"), {pipeline} = require("stream/promises");
const {createRequest} = require("../src/modules/thunderstore-transport");
const URL = "https://thunderstore.io/package/download/Pilot/Example/1.0.0/";
function fixture(steps) {
	const requests = [];
	const net = {request(options) {
		const request = new EventEmitter(); requests.push(request);
		Object.assign(request, {options, headers: {}, abortCount: 0, followCount: 0, destroyed: false});
		request.setHeader = (name, value) => {request.headers[name] = value;};
		request.abort = () => {request.abortCount++; request.emit("abort");};
		request.destroy = () => {request.destroyed = true;};
		let index = 0;
		const next = () => process.nextTick(() => {
			if (request.destroyed) return;
			const step = steps[index++];
			if (!step || step.stall) return;
			if (step.redirect) request.emit("redirect", 302, step.method || "GET", step.redirect, {});
			else if (step.error) request.emit("error", step.error);
			else {
				const response = step.response || Readable.from(step.chunks || [Buffer.from("PK"), Buffer.from("archive")]);
				response.statusCode = step.status || 200; response.headers = {"content-length": "9"};
				request.response = response; request.emit("response", response);
			}
		});
		request.end = next;
		request.followRedirect = () => {request.followCount++; next();};
		return request;
	}};
	return {request: createRequest(net), requests};
}
function consume(f) {return new Promise((resolve, reject) => {
	const request = f.request(URL, {headers: {"User-Agent": "TFX-Launcher"}}, response => {
		const chunks = []; const before = response.complete;
		pipeline(response, new Writable({write(chunk, _encoding, done) {chunks.push(chunk); done();}})).then(() => resolve({bytes: Buffer.concat(chunks).toString(), before, complete: response.complete}), reject);
	});
	request.once("error", reject);
});}

test("streaming Electron transport follows only validated manual redirects and marks completion", async () => {
	const f = fixture([{redirect: "https://ccdn.thunderstore.io/live/repository/packages/Pilot-Example-1.0.0.zip"}, {}]);
	assert.deepEqual(await consume(f), {bytes: "PKarchive", before: false, complete: true});
	assert.equal(f.requests[0].options.redirect, "manual");
	assert.equal(f.requests[0].followCount, 1);
	assert.equal(f.requests[0].headers["User-Agent"], "TFX-Launcher");
});

test("an untrusted redirect is rejected before Chromium is allowed to follow it", async () => {
	const f = fixture([{redirect: "https://example.invalid/stolen.zip"}]);
	await assert.rejects(consume(f), {code: "DOWNLOAD_REDIRECT"});
	assert.equal(f.requests[0].followCount, 0);
	assert.equal(f.requests[0].abortCount, 1);
});

test("redirect limit and method changes stop the underlying request", async () => {
	for (const steps of [Array.from({length: 5}, () => ({redirect: "https://ccdn.thunderstore.io/loop"})), [{redirect: "https://ccdn.thunderstore.io/archive", method: "POST"}]]) {
		const f = fixture(steps);
		await assert.rejects(consume(f), {code: "DOWNLOAD_REDIRECT"});
		assert.equal(f.requests[0].abortCount, 1);
		assert(f.requests[0].followCount <= 4);
	}
});

test("destroying a connecting request cancels Chromium and preserves the cancellation error", async () => {
	const f = fixture([{stall: true}]), cancellation = Object.assign(new Error("cancelled"), {code: "CANCELLED"});
	const result = new Promise(resolve => {
		const request = f.request(URL, {}, () => assert.fail("cancelled request cannot produce a response"));
		request.once("error", resolve); request.destroy(cancellation); request.destroy(cancellation);
	});
	assert.equal(await result, cancellation);
	assert.equal(f.requests[0].abortCount, 1);
	assert.equal(f.requests[0].destroyed, true);
});

test("idle timeout can stop a request which never receives headers", async () => {
	const f = fixture([{stall: true}]);
	await new Promise(resolve => {
		const request = f.request(URL, {}, () => assert.fail("stalled request cannot produce a response"));
		request.setTimeout(15, () => {request.destroy(); resolve();});
	});
	assert.equal(f.requests[0].abortCount, 1);
});

test("transport refuses an initial non-Thunderstore URL before opening a socket", () => {
	const f = fixture([]);
	assert.throws(() => f.request("https://example.invalid/package.zip", {}, () => {}), {code: "DOWNLOAD_URL"});
	assert.equal(f.requests.length, 0);
});

test("Chromium network errors retain their cause and receive a retryable code", async () => {
	const cause = new Error("net::ERR_CONNECTION_RESET"), f = fixture([{error: cause}]);
	await assert.rejects(consume(f), error => error.code === "NETWORK" && error.cause === cause && error.message === cause.message);
});

test("cancelling after first bytes stops the response stream and Chromium request", async () => {
	const source = new Readable({read() {}}), f = fixture([{response: source}]);
	await new Promise((resolve, reject) => {
		const request = f.request(URL, {}, response => {
			response.once("data", () => request.destroy());
			pipeline(response, new Writable({write(_chunk, _encoding, done) {done();}})).then(() => reject(new Error("cancelled stream cannot complete")), () => {
				assert.equal(response.complete, false); resolve();
			});
			source.push(Buffer.from("partial"));
		});
		request.once("error", reject);
	});
	assert.equal(source.destroyed, true);
	assert.equal(f.requests[0].abortCount, 1);
});

test("an aborted source never receives a successful completion flag", async () => {
	const source = new Readable({read() {}}), f = fixture([{response: source}]);
	const running = consume(f);
	process.nextTick(() => source.emit("aborted"));
	await assert.rejects(running, {code: "DOWNLOAD_TRUNCATED"});
	assert.equal(f.requests[0].abortCount, 1);
});
