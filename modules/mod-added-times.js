"use strict";

const fs = require("fs");
const path = require("path");

// Keep the first added time outside the game files. Package versions share
// one identity, so updating a mod does not make it look newly installed.
class ModAddedTimes {
	constructor(file) {
		this.file = file;
		this.records = {};
		this.dirty = false;
		try {
			const saved = JSON.parse(fs.readFileSync(file, "utf8"));
			if (saved && saved.version === 1 && saved.records && typeof saved.records === "object" && !Array.isArray(saved.records)) {
				this.records = saved.records;
			}
		} catch (_) {}
	}

	profile(gamepath) {
		return path.resolve(gamepath).replace(/\\/g, "/").toLowerCase();
	}

	get(gamepath, identity, folder) {
		const profile = this.profile(gamepath);
		const key = profile + "\n" + identity.toLowerCase();
		const existing = this.records[key];
		if (Number.isFinite(existing) && existing > 0) return existing;
		let addedAt = Date.now();
		try {
			const stats = fs.statSync(folder);
			if (Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0) addedAt = stats.birthtimeMs;
		} catch (_) {}
		this.records[key] = addedAt;
		this.dirty = true;
		return addedAt;
	}

	forget(gamepath, identity) {
		const prefix = this.profile(gamepath) + "\n";
		for (const key of Object.keys(this.records)) {
			if (key.startsWith(prefix) && (!identity || key === prefix + identity.toLowerCase())) {
				delete this.records[key];
				this.dirty = true;
			}
		}
	}

	flush() {
		if (!this.dirty) return;
		fs.mkdirSync(path.dirname(this.file), {recursive: true});
		const temporary = this.file + "." + process.pid + ".tmp";
		fs.writeFileSync(temporary, JSON.stringify({version: 1, records: this.records}), "utf8");
		fs.renameSync(temporary, this.file);
		this.dirty = false;
	}
}

module.exports = ModAddedTimes;
