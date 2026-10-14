const execFile = require("child_process").execFile;
const ipcMain = require("electron").ipcMain;

ipcMain.on("kill-game", () => {
	kill.game();
})

ipcMain.on("kill-origin", () => {
	kill.origin();
})

// Terminates a Windows process by executable name.
async function kill(process_name) {
	return new Promise(resolve => {
		execFile(
			"taskkill.exe",
			["/IM", process_name, "/F"],
			{windowsHide: true},
			error => resolve(! error)
		);
	})
}

kill.process = kill;

kill.origin = async () => {
	let origin = await kill("Origin.exe");
	let eadesktop = await kill("EADesktop.exe");

	if (origin || eadesktop) {
		return true;
	}

	return false;
}

kill.game = async () => {
	let tf2 = await kill("Titanfall2.exe");
	let northstar = await kill("NorthstarLauncher.exe");
	let tf2_unpacked = await kill("Titanfall2-unpacked.exe");

	if (tf2 || northstar || tf2_unpacked) {
		return true;
	}

	return false;
}

module.exports = kill;
