const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadScript(file, context = {}) {
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(file, "utf8"), context);
	return context;
}

test("compares and formats renderer versions", () => {
	const context = loadScript(path.join(__dirname, "../src/app/js/misc.js"));

	assert.equal(context.version.format("1.2.3"), "v1.2.3");
	assert.equal(context.version.format("v1.2.3", true), "1.2.3");
	assert.equal(context.version.format(undefined), "vunknown");
	assert.equal(context.version.is_newer("1.3.0", "1.2.9"), true);
	assert.equal(context.version.is_newer("1.2.0", "1.2.0"), false);
});

test("dispatches renderer events to all listeners", () => {
	const context = loadScript(path.join(__dirname, "../src/app/js/events.js"), {Map});
	const events = vm.runInContext("events", context);
	let values = [];

	events.on("change", value => values.push(value));
	events.on("change", value => values.push(value * 2));
	events.emit("change", 3);

	assert.deepEqual(values, [3, 6]);
});

function createDnsSelectDocument() {
	let listeners = [];
	let selectListeners = new Map();
	let document;
	function control(value, textContent) {
		const attributes = new Map();
		return {
			dataset: value ? {value} : {}, textContent, disabled: false,
			setAttribute(name, value) { attributes.set(name, String(value)); },
			getAttribute(name) { return attributes.get(name) ?? null; },
			focus() { document.activeElement = this; }
		};
	}
	let options = [
		control("aliyun", "Aliyun"),
		control("tencent", "Tencent")
	];
	options[0].setAttribute("aria-selected", "true");
	options[1].setAttribute("aria-selected", "false");
	let label = {textContent: "Aliyun"};
	let toggle = control(null, "DNS");
	toggle.setAttribute("aria-expanded", "false");
	let menu = {
		hidden: true,
		querySelector(query) {
			return query === '[aria-selected="true"]' ? options.find(option => option.getAttribute("aria-selected") === "true") : query === "button" ? options[0] : null;
		}
	};
	let select = {
		dataset: {value: "aliyun"},
		addEventListener(type, handler) { selectListeners.set(type, handler); },
		classList: {
			values: new Set(),
			add(name) { this.values.add(name); },
			remove(name) { this.values.delete(name); },
			contains(name) { return this.values.has(name); }
		},
		querySelector(query) {
			if (query === ".dns-select-toggle") {
				return toggle;
			}
			if (query === ".dns-select-menu") {
				return menu;
			}
			if (query === ".dns-select-label") {
				return label;
			}
			if (query.startsWith(".dns-select-menu [data-value=")) {
				let value = query.match(/data-value="([^"]+)"/)[1];
				return options.find(option => option.dataset.value === value) || null;
			}
			return null;
		},
		querySelectorAll(query) {
			if (query === ".dns-select-menu [data-value]" || query === ".dns-select-menu button") {
				return options;
			}
			return [];
		},
		contains() { return true; }
	};
	let buttons = [
		toggle,
		...options,
		{disabled: false},
		{disabled: false}
	];

	document = {
			activeElement: null,
			body: {
				addEventListener() {},
				querySelector() { return {addEventListener() {}, value: ""}; }
			},
			getElementById(id) {
				return id === "dns-preset" ? select : null;
			},
			querySelectorAll(query) {
				if (query.includes("#dns-settings")) {
					return buttons;
				}
				return [];
			},
			addEventListener(type, handler) {
				listeners.push({type, handler});
			}
		};
	return {
		document,
		select,
		label,
		menu,
		toggle,
		buttons,
		options,
		selectListeners,
		listeners
	};
}

test("uses an in-page DNS preset control and keeps it usable after apply", async () => {
	let completeRequest;
	let toasts = [];
	let fixture = createDnsSelectDocument();
	let context = loadScript(path.join(__dirname, "../src/app/js/settings.js"), {
		console,
		Event,
		CustomEvent,
		document: fixture.document,
		events: {on() {}},
		Fuse: class { search() { return []; } },
		ipcRenderer: {
			invoke() {
				return new Promise(resolve => { completeRequest = resolve; });
			}
		},
		lang: key => key,
		settings: {},
		Toast: function(properties) { toasts.push(properties); },
		window: {addEventListener() {}, dispatchEvent() {return true;}}
	});

	assert.equal(context.get_dns_preset(), "aliyun");
	context.set_dns_preset("tencent");
	assert.equal(context.get_dns_preset(), "tencent");
	assert.equal(fixture.label.textContent, "Tencent");

	context.set_dns_select_open(true);
	assert.equal(fixture.select.classList.contains("open"), true);
	assert.equal(fixture.menu.hidden, false);
	assert.equal(fixture.document.activeElement, fixture.options[1]);
	assert.equal(fixture.toggle.getAttribute("aria-expanded"), "true");
	const keydown = key => {
		const event = {key, prevented: false, stopped: false, preventDefault() {this.prevented = true;}, stopImmediatePropagation() {this.stopped = true;}};
		fixture.selectListeners.get("keydown")(event);
		return event;
	};
	assert.equal(keydown("Home").prevented, true);
	assert.equal(fixture.document.activeElement, fixture.options[0]);
	keydown("ArrowDown");
	assert.equal(fixture.document.activeElement, fixture.options[1]);
	keydown("ArrowUp");
	assert.equal(fixture.document.activeElement, fixture.options[0]);
	keydown("End");
	assert.equal(fixture.document.activeElement, fixture.options[1]);
	const escaped = keydown("Escape");
	assert.equal(escaped.prevented, true);
	assert.equal(escaped.stopped, true);
	assert.equal(fixture.menu.hidden, true);
	assert.equal(fixture.document.activeElement, fixture.toggle);
	context.set_dns_select_open(true);
	keydown("Tab");
	assert.equal(fixture.menu.hidden, true);
	context.set_dns_select_open(true);

	let operation = context.run_dns_action("set-system-dns", "success", "failure", "tencent");
	assert.equal(fixture.buttons.every(button => button.disabled), true);
	assert.equal(fixture.select.classList.contains("open"), false);

	completeRequest({ok: true});
	await operation;

	assert.equal(fixture.buttons.every(button => button.disabled), false);
	assert.equal(toasts.length, 1);
	assert.equal(toasts[0].scheme, "success");
	assert.equal(toasts[0].title, "success");
});
