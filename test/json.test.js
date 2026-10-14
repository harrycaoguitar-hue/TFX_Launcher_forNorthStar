const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const readJson = require("../src/modules/json");

test("reads valid JSON", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "viper-json-"));
	const file = path.join(directory, "valid.json");
	fs.writeFileSync(file, JSON.stringify({enabled: true}));

	try {
		assert.deepEqual(readJson(file), {enabled: true});
	} finally {
		fs.rmSync(directory, {recursive: true});
	}
});

test("repairs common JSON formatting errors", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "viper-json-"));
	const file = path.join(directory, "repairable.json");
	fs.writeFileSync(file, "{enabled: true,}");

	try {
		assert.deepEqual(readJson(file), {enabled: true});
	} finally {
		fs.rmSync(directory, {recursive: true});
	}
});

test("returns false for missing and irreparable files", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "viper-json-"));
	const file = path.join(directory, "invalid.json");
	fs.writeFileSync(file, "not json at all");

	try {
		assert.equal(readJson(file), false);
		assert.equal(readJson(path.join(directory, "missing.json")), false);
	} finally {
		fs.rmSync(directory, {recursive: true});
	}
});
