const win = require("../win");
const { app, ipcMain } = require("electron");

const kill = require("./kill");
const settings = require("./settings");
const is_running = require("./is_running");

ipcMain.on("exit", async () => {
	if (settings().originkill) {
		if (await is_running.origin()) {
			await kill.origin();
		}
	}

	app.quit();
})

ipcMain.on("minimize", () => {
	win().minimize();
})

ipcMain.on("relaunch", () => {
	app.relaunch({
		args: process.argv.slice(1)
	})

	app.exit(0);
})
