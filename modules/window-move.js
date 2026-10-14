const { ipcMain, screen } = require("electron");

// Frameless Windows dragging uses one path only. Keep the requested size rather
// than feeding Electron's rounded getBounds size back into every movement.
module.exports = function attachWindowMove(win, initialSize) {
	let gesture = null;
	let applying = false;
	const bounds = win.getBounds();
	function dimension(value, display) {
		const scale = display.scaleFactor || 1;
		const rounded = Math.round(value);
		for (let offset = 0; offset <= 12; offset++) {
			const candidate = rounded - offset;
			if (Math.abs(candidate * scale - Math.round(candidate * scale)) < 0.00001) return candidate;
		}
		return rounded;
	}
	function normalize(value) {
		const display = screen.getDisplayMatching(value);
		// Align both ends of the rectangle to physical pixels. Fractional screen
		// origins otherwise add an extra DIP even when width/height stay constant.
		return {...value, x: dimension(value.x, display), y: dimension(value.y, display), width: dimension(value.width, display), height: dimension(value.height, display)};
	}
	let normal = normalize({...bounds, ...initialSize});
	function setBounds(value) {
		applying = true;
		try { win.setBounds(value, false); } finally { applying = false; }
	}
	setBounds(normal);
	function state() {
		if (win.isDestroyed()) return {maximized: false, bounds: {...normal}};
		return {maximized: win.isMaximized(), bounds: win.getBounds()};
	}
	function notify() {
		if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("window-state", state());
	}
	function allowed(event) { return !win.isDestroyed() && event.sender === win.webContents; }
	function point(value) {
		return value && Number.isFinite(value.x) && Number.isFinite(value.y) && Math.abs(value.x) < 100000 && Math.abs(value.y) < 100000;
	}
	function stop() { gesture = null; }
	async function restore() {
		// Windows can defer an unmaximize while its native state transition is
		// still pending. Wait for it before writing the restored rectangle.
		if (!win.isMaximized()) return;
		win.unmaximize();
		for (let attempt = 0; attempt < 8 && win.isMaximized(); attempt++) {
			await new Promise(resolve => setTimeout(resolve, 16));
			if (win.isDestroyed()) return;
			if (attempt === 2) win.restore();
		}
	}
	win.on("blur", stop);
	win.on("closed", stop);
	win.on("maximize", notify);
	win.on("unmaximize", notify);
	win.on("resize", () => {
		if (!applying && !gesture && !win.isMaximized() && !win.isMinimized()) {
			const current = win.getBounds();
			normal = normalize(current);
		}
	});
	win.webContents.on("did-finish-load", notify);
	ipcMain.handle("window-move-begin", (event, value) => {
		if (!allowed(event) || !point(value)) return false;
		const current = win.getBounds();
		const edge = typeof value.edge === "string" && /^(n|s|e|w|ne|nw|se|sw)$/.test(value.edge) ? value.edge : "";
		if (edge && win.isMaximized()) return false;
		if (!win.isMaximized()) normal = normalize({...current, width: normal.width, height: normal.height});
		gesture = {start: {x: value.x, y: value.y}, bounds: {...normal}, edge, maximized: win.isMaximized(), ratio: Math.max(0, Math.min(1, (value.x - current.x) / current.width))};
		return true;
	});
	ipcMain.handle("window-move-update", async (event, value) => {
		if (!allowed(event) || !gesture || !point(value)) return state();
		const dx = Math.round(value.x - gesture.start.x), dy = Math.round(value.y - gesture.start.y);
		if (gesture.maximized) {
			if (Math.abs(dx) + Math.abs(dy) < 4) return state();
			const session = gesture;
			if (!session.restoring) session.restoring = restore();
			await session.restoring;
			if (gesture !== session || win.isDestroyed()) return state();
			if (win.isMaximized()) return state();
			if (session.maximized) {
				session.bounds.x = Math.round(value.x - session.bounds.width * session.ratio);
				session.bounds.y = Math.round(value.y - 20);
				session.start = {x: value.x, y: value.y};
				session.maximized = false;
			}
		}
		const start = gesture.bounds;
		let next = {...start};
		if (!gesture.edge) {
			next.x += Math.round(value.x - gesture.start.x);
			next.y += Math.round(value.y - gesture.start.y);
		} else {
			const [minWidth, minHeight] = win.getMinimumSize();
			if (gesture.edge.includes("e")) next.width = Math.max(minWidth, start.width + dx);
			if (gesture.edge.includes("s")) next.height = Math.max(minHeight, start.height + dy);
			if (gesture.edge.includes("w")) { next.width = Math.max(minWidth, start.width - dx); next.x = start.x + start.width - next.width; }
			if (gesture.edge.includes("n")) { next.height = Math.max(minHeight, start.height - dy); next.y = start.y + start.height - next.height; }
			next = normalize(next);
			if (gesture.edge.includes("w")) next.x = start.x + start.width - next.width;
			if (gesture.edge.includes("n")) next.y = start.y + start.height - next.height;
		}
		next = normalize(next);
		setBounds(next);
		normal = {...next};
		return state();
	});
	ipcMain.handle("window-move-end", (event) => {
		if (allowed(event)) stop();
		return state();
	});
	ipcMain.handle("window-toggle-maximize", async (event) => {
		if (!allowed(event)) return state();
		stop();
		if (win.isMaximized()) {
			const restored = {...normal};
			await restore();
			if (!win.isMaximized()) setBounds(restored);
		} else {
			normal = normalize({...win.getBounds(), width: normal.width, height: normal.height});
			win.maximize();
		}
		notify();
		return state();
	});
};
