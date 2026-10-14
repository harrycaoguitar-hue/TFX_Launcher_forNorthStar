const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { buildElevationCommand } = require("../src/modules/powershell");

test("passes the encoded script to the elevated PowerShell process", () => {
	let script = "$value = 'dns-test'";
	let encodedScript = Buffer.from(script, "utf16le").toString("base64");
	let command = buildElevationCommand(script);

	assert.match(command, /Start-Process/);
	assert.match(command, /-Verb RunAs/);
	assert.match(command, /-WindowStyle Hidden/);
	assert.match(command, /-Wait -PassThru/);
	assert.ok(command.includes(`'-EncodedCommand', '${encodedScript}'`));
	assert.doesNotMatch(command, /-PassThru;\s*-ArgumentList/);
});

test("generates syntactically valid PowerShell", () => {
	let command = buildElevationCommand("$value = 'dns-test'");
	let parser = [
		"$tokens = $null",
		"$errors = $null",
		"[void][System.Management.Automation.Language.Parser]::ParseInput(" +
			"$env:VIPER_ELEVATION_COMMAND, [ref]$tokens, [ref]$errors)",
		"if ($errors.Count -gt 0) { exit 1 }"
	].join("; ");
	let result = spawnSync("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		parser
	], {
		env: {...process.env, VIPER_ELEVATION_COMMAND: command},
		encoding: "utf8"
	});

	assert.equal(result.status, 0, result.stderr);
});
