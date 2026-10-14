const { execFile } = require("child_process");

function run(file, args) {
	return new Promise((resolve, reject) => {
		execFile(file, args, {windowsHide: true}, (error, stdout, stderr) => {
			if (error) {
				error.stderr = stderr;
				reject(error);
				return;
			}

			resolve(stdout);
		});
	});
}

function buildElevationCommand(script) {
	let encodedScript = Buffer.from(script, "utf16le").toString("base64");
	let argumentList = [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-EncodedCommand",
		encodedScript
	].map(argument => `'${argument}'`).join(", ");

	return [
		"$ErrorActionPreference = 'Stop'",
		"$process = Start-Process" +
			" -FilePath 'powershell.exe'" +
			` -ArgumentList @(${argumentList})` +
			" -Verb RunAs -WindowStyle Hidden -Wait -PassThru",
		"exit $process.ExitCode"
	].join("; ");
}

function elevate(script) {
	return run("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-Command",
		buildElevationCommand(script)
	]);
}

module.exports = {
	buildElevationCommand,
	elevate,
	run
};
