const { app, BrowserWindow, ipcMain } = require("electron");

const { elevate, run } = require("./powershell");

const dnsPresets = {
	aliyun: ["223.5.5.5", "223.6.6.6"],
	tencent: ["119.29.29.29"],
	bytedance: ["180.184.1.1", "180.184.2.2"],
	automatic: null
};

async function setDns(preset) {
	if (! Object.prototype.hasOwnProperty.call(dnsPresets, preset)) {
		throw new Error("Unknown DNS preset.");
	}

	let command = [
		"$ErrorActionPreference = 'Stop'",
		"$adapters = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' }",
		"if ($null -eq $adapters) { throw 'No active physical network adapter was found.' }"
	];

	if (dnsPresets[preset]) {
		let addresses = dnsPresets[preset].map((address) => `'${address}'`).join(", ");
		command.push(
			"foreach ($adapter in $adapters) {" +
				" Set-DnsClientServerAddress" +
				" -InterfaceIndex $adapter.ifIndex" +
				` -ServerAddresses @(${addresses})` +
				" -ErrorAction Stop" +
			" }"
		);
	} else {
		command.push(
			"foreach ($adapter in $adapters) {" +
				" Set-DnsClientServerAddress" +
				" -InterfaceIndex $adapter.ifIndex" +
				" -ResetServerAddresses" +
				" -ErrorAction Stop" +
			" }"
		);
	}

	command.push("Clear-DnsClientCache");
	await elevate(command.join("; "));
}

async function flushDnsCache() {
	await run("ipconfig.exe", ["/flushdns"]);
}

function restoreWindowFocus(event) {
	if (event.sender.isDestroyed()) {
		return;
	}

	let window = BrowserWindow.fromWebContents(event.sender);
	if (! window || window.isDestroyed()) {
		return;
	}

	if (window.isMinimized()) {
		window.restore();
	}

	window.setAlwaysOnTop(true);
	app.focus();
	window.show();
	window.focus();
	event.sender.focus();
	window.setAlwaysOnTop(false);
}

ipcMain.handle("set-system-dns", async (event, preset) => {
	try {
		await setDns(preset);
		return { ok: true };
	} catch (error) {
		console.error("Unable to set system DNS:", error);
		return { ok: false };
	} finally {
		restoreWindowFocus(event);
	}
});

ipcMain.handle("flush-dns-cache", async () => {
	try {
		await flushDnsCache();
		return { ok: true };
	} catch (error) {
		console.error("Unable to clear DNS cache:", error);
		return { ok: false };
	}
});
