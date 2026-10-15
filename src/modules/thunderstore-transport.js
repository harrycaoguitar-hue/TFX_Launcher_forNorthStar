"use strict";

// Chromium's streaming transport uses the user's system network settings. Keep
// the installer's small HTTPS request boundary and validate every redirect.
const {EventEmitter} = require("events");
const {Transform} = require("stream");
const {trustedDownloadURL} = require("./thunderstore-install");

function transportError(code, message) {return Object.assign(new Error(message), {code});}

function createRequest(net) {
	if (!net || typeof net.request !== "function") throw new TypeError("A streaming Electron network transport is required.");
	return function request(address, options = {}, callback) {
		if (!trustedDownloadURL(String(address))) throw transportError("DOWNLOAD_URL", "The package URL is not a Thunderstore HTTPS endpoint.");
		const client = new EventEmitter();
		const underlying = net.request({method: "GET", url: String(address), redirect: "manual"});
		let response, source, redirects = 0, stopped = false, completed = false, timeout = 0, idleTimer, timeoutCallback;
		function clearIdle() {clearTimeout(idleTimer); idleTimer = null;}
		function armIdle() {
			clearIdle();
			if (timeout > 0 && !stopped && !completed) idleTimer = setTimeout(() => {
				idleTimer = null;
				if (timeoutCallback) timeoutCallback(); else client.emit("timeout");
			}, timeout);
		}
		client.setTimeout = (milliseconds, listener) => {
			timeout = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
			timeoutCallback = typeof listener === "function" ? listener : null;
			armIdle(); return client;
		};
		client.destroy = error => {
			if (stopped) return client;
			stopped = true; client.destroyed = true; clearIdle();
			if (!completed) {
				try {underlying.abort();} catch (_) {}
				try {underlying.destroy();} catch (_) {}
				if (source && !source.destroyed) source.destroy();
				if (response && !response.destroyed) response.destroy(error);
			}
			if (error) process.nextTick(() => client.emit("error", error));
			return client;
		};
		underlying.on("error", error => {
			if (!error.code) error = Object.assign(transportError("NETWORK", error.message || "Could not connect to the mod download server."), {cause: error});
			client.destroy(error);
		});
		underlying.on("redirect", (_status, method, target) => {
			if (stopped) return;
			if (method !== "GET" || !trustedDownloadURL(target) || ++redirects > 4) {
				client.destroy(transportError("DOWNLOAD_REDIRECT", "Thunderstore redirected to an untrusted download host or too many times."));
				return;
			}
			armIdle();
			try {underlying.followRedirect();} catch (error) {client.destroy(error);}
		});
		underlying.on("response", incoming => {
			if (stopped) {incoming.destroy(); return;}
			source = incoming;
			// Count incoming activity without putting the source into flowing mode
			// before the installer's pipeline has attached its listeners.
			response = new Transform({transform(chunk, _encoding, done) {armIdle(); done(null, chunk);}});
			response.statusCode = incoming.statusCode;
			response.headers = incoming.headers;
			// Electron's IncomingMessage has no Node-compatible `complete` field.
			response.complete = false;
			response.once("end", () => {response.complete = true; completed = true; clearIdle();});
			response.once("error", clearIdle);
			response.once("close", () => {clearIdle(); if (!source.destroyed) source.destroy();});
			incoming.once("error", error => response.destroy(error));
			incoming.once("aborted", () => {clearIdle(); client.destroy(transportError("DOWNLOAD_TRUNCATED", "The package download ended early."));});
			armIdle(); callback(response); incoming.pipe(response);
		});
		for (const [name, value] of Object.entries(options.headers || {})) underlying.setHeader(name, value);
		underlying.end();
		return client;
	};
}

module.exports = {createRequest};
