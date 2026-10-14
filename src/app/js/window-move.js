/* Single pointer-driven window path; native app-region dragging is disabled. */
(() => {
	"use strict";
	const interactive = "button,a,input,textarea,select,summary,[role='button'],[contenteditable],.popup,#winbtns";
	const regions = ".fold-titlebar,.fold-sidebar,.fold-page-header";
	let active = null;
	function point(event) { return {x: event.screenX, y: event.screenY}; }
	function isDragTarget(target) { return target instanceof Element && target.closest(regions) && !target.closest(interactive); }
	async function finish() {
		if (!active) return;
		const previous = active;
		active = null;
		document.body.classList.remove("vyra-window-moving");
		try { if (previous.element.hasPointerCapture(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId); } catch (_) {}
		await ipcRenderer.invoke("window-move-end").catch(() => {});
	}
	document.addEventListener("pointerdown", async event => {
		if (event.button !== 0 || active) return;
		const handle = event.target.closest("[data-window-resize]");
		if (!handle && !isDragTarget(event.target)) return;
		event.preventDefault();
		const element = handle || event.target.closest(regions);
		const session = {element, pointerId: event.pointerId, ready: false, pending: null};
		active = session;
		try { element.setPointerCapture(event.pointerId); } catch (_) {}
		document.body.classList.add("vyra-window-moving");
		const accepted = await ipcRenderer.invoke("window-move-begin", {...point(event), edge: handle?.dataset.windowResize || ""}).catch(() => false);
		if (active !== session) return;
		if (!accepted) { await finish(); return; }
		session.ready = true;
		if (session.pending) await ipcRenderer.invoke("window-move-update", session.pending).catch(() => finish());
	});
	document.addEventListener("pointermove", event => {
		if (!active || event.pointerId !== active.pointerId) return;
		event.preventDefault();
		if (!active.ready) { active.pending = point(event); return; }
		ipcRenderer.invoke("window-move-update", point(event)).catch(() => finish());
	});
	document.addEventListener("pointerup", event => { if (active && event.pointerId === active.pointerId) finish(); });
	document.addEventListener("pointercancel", finish);
	document.addEventListener("lostpointercapture", event => { if (active && event.pointerId === active.pointerId) finish(); });
	window.addEventListener("blur", finish);
	document.addEventListener("dblclick", event => {
		if (!isDragTarget(event.target)) return;
		event.preventDefault();
		finish();
		ipcRenderer.invoke("window-toggle-maximize").catch(() => {});
	});
	const maximize = document.createElement("div");
	maximize.id = "maximize";
	maximize.setAttribute("role", "button");
	maximize.setAttribute("tabindex", "0");
	maximize.setAttribute("aria-label", "最大化窗口");
	maximize.setAttribute("title", "最大化窗口（也可双击顶部）");
	maximize.innerHTML = '<svg class="fold-icon nv-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 8 5-4h11v11l-5 5H4Z"/><path d="M8 8h8v8M8 16l8-8"/></svg>';
	maximize.addEventListener("click", () => ipcRenderer.invoke("window-toggle-maximize").catch(() => {}));
	maximize.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); maximize.click(); } });
	document.getElementById("winbtns")?.insertBefore(maximize, document.getElementById("close"));
	ipcRenderer.on("window-state", (_event, value) => {
		document.body.classList.toggle("vyra-window-maximized", value.maximized);
		maximize.setAttribute("aria-label", value.maximized ? "还原窗口" : "最大化窗口");
		maximize.setAttribute("title", value.maximized ? "还原窗口" : "最大化窗口（也可双击顶部）");
	});
	for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
		const handle = document.createElement("div");
		handle.className = "vyra-window-resize vyra-window-resize-" + edge;
		handle.dataset.windowResize = edge;
		handle.setAttribute("aria-hidden", "true");
		document.body.append(handle);
	}
})();
