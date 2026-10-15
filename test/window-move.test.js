"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), path = require("path"), vm = require("vm"), {EventEmitter} = require("events");
const sourcePath = path.join(__dirname, "../src/modules/window-move.js"), source = fs.readFileSync(sourcePath, "utf8");
function fixture({scale = 1.5, unreliableGetter = true, delayedRestoreResize = false, stuckNativeRestore = false} = {}) {
  const handlers = new Map(), win = new EventEmitter(), contents = new EventEmitter(), notifications = [], writes = [];
  const initial = {x: 80, y: 80, width: 1360, height: 860}, workArea = {x: 0, y: 0, width: 1706, height: 926};
  let bounds = {...initial}, nativeMax = false, destroyed = false, restoreBounds = {...initial}, maximizeCalls = 0, unmaximizeCalls = 0;
  Object.assign(contents, {isDestroyed: () => destroyed, send: (...args) => notifications.push(args)});
  Object.assign(win, {
    webContents: contents, getBounds: () => ({...bounds}), getMinimumSize: () => [1100, 720], isDestroyed: () => destroyed, isMinimized: () => false,
    isMaximized: () => unreliableGetter ? false : nativeMax,
    setBounds: next => {assert.equal(destroyed, false); bounds = {...next}; writes.push({...next}); win.emit("resize");},
    maximize: () => {maximizeCalls++; restoreBounds = {...bounds}; nativeMax = true; bounds = {...workArea}; win.emit("maximize"); win.emit("resize");},
    unmaximize: () => {
      unmaximizeCalls++; if (stuckNativeRestore) return;
      nativeMax = false; win.emit("unmaximize");
      if (delayedRestoreResize) win.emit("resize");
      bounds = {...restoreBounds}; if (!delayedRestoreResize) win.emit("resize");
    },
    restore: () => {if(stuckNativeRestore)return; nativeMax = false; win.emit("unmaximize"); bounds = {...restoreBounds}; win.emit("resize");}
  });
  const context = {module: {exports: {}}, setTimeout, require: id => {assert.equal(id, "electron"); return {ipcMain: {handle: (name, action) => handlers.set(name, action)}, screen: {getDisplayMatching: () => ({scaleFactor: scale})}};}};
  vm.runInNewContext(source, context, {filename: sourcePath}); context.module.exports(win, {width: initial.width, height: initial.height});
  const trusted = {sender: contents}, foreign = {sender: {}};
  const invoke = (name, input, event = trusted) => handlers.get(name)(event, input);
  return {win, contents, handlers, trusted, foreign, initial, workArea, writes, notifications, invoke, bounds: () => ({...bounds}), calls: () => ({maximizeCalls, unmaximizeCalls}),
    externalMaximize() {restoreBounds = {...bounds}; nativeMax = true; bounds = {...workArea}; win.emit("maximize"); win.emit("resize");},
    closed() {destroyed = true; win.emit("closed");}
  };
}
test("a native maximize event overrides a false Electron getter and blocks resize gestures", async () => {
  const f = fixture(); f.externalMaximize(); assert.equal(f.win.isMaximized(), false);
  assert.equal(f.notifications.at(-1)[0], "window-state"); assert.equal(f.notifications.at(-1)[1].maximized, true);
  for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) assert.equal(f.invoke("window-move-begin", {x: 400, y: 100, edge}), false);
  assert.deepEqual(f.bounds(), f.workArea);
  const restored = await f.invoke("window-toggle-maximize"); assert.equal(restored.maximized, false); assert.deepEqual(f.bounds(), f.initial); assert.equal(f.calls().unmaximizeCalls, 1);
});
test("maximize request protects the saved normal size while getter remains false", async () => {
  const f = fixture();
  for (let cycle = 0; cycle < 4; cycle++) {
    const max = await f.invoke("window-toggle-maximize"); assert.equal(max.maximized, true); assert.deepEqual(f.bounds(), f.workArea);
    const restored = await f.invoke("window-toggle-maximize"); assert.equal(restored.maximized, false); assert.deepEqual(f.bounds(), f.initial);
  }
  assert.equal(f.calls().maximizeCalls, 4); assert.equal(f.calls().unmaximizeCalls, 4);
});
test("stale resize events during unmaximize cannot replace the saved restore dimensions", async () => {
  const f = fixture({delayedRestoreResize: true});
  for (let cycle = 0; cycle < 3; cycle++) {
    await f.invoke("window-toggle-maximize"); const restored = await f.invoke("window-toggle-maximize");
    assert.equal(restored.maximized, false); assert.deepEqual(f.bounds(), f.initial);
  }
});
test("fractional-scale native maximize with inert unmaximize/restore falls back to exact saved bounds", async () => {
  const f = fixture({stuckNativeRestore: true}); await f.invoke("window-toggle-maximize"); assert.equal(f.win.isMaximized(), false);
  const result = await f.invoke("window-toggle-maximize"); assert.equal(result.maximized, false); assert.deepEqual(f.bounds(), f.initial);
  assert.equal(f.calls().unmaximizeCalls, 1); assert.equal(f.notifications.at(-1)[1].maximized, false);
  assert.equal(f.invoke("window-move-begin", {x: 200, y: 200, edge: "se"}), true); f.invoke("window-move-end");
});
test("dragging from maximized restores the exact saved dimensions under the pointer", async () => {
  const f = fixture(); await f.invoke("window-toggle-maximize");
  assert.equal(f.invoke("window-move-begin", {x: 840, y: 18}), true);
  const tiny = await f.invoke("window-move-update", {x: 841, y: 19}); assert.equal(tiny.maximized, true); assert.equal(f.calls().unmaximizeCalls, 0);
  const restored = await f.invoke("window-move-update", {x: 860, y: 42}); assert.equal(restored.maximized, false); assert.equal(restored.bounds.width, f.initial.width); assert.equal(restored.bounds.height, f.initial.height); assert.equal(f.calls().unmaximizeCalls, 1);
  assert(restored.bounds.x > 0 && restored.bounds.x < 860); assert(restored.bounds.y <= 42);
  const next = await f.invoke("window-move-update", {x: 900, y: 82}); assert.equal(next.bounds.width, f.initial.width); assert.equal(next.bounds.height, f.initial.height);
  f.invoke("window-move-end"); const before = f.bounds(); await f.invoke("window-move-update", {x: 999, y: 999}); assert.deepEqual(f.bounds(), before);
});
test("dragging from a getter-false native maximize uses the fallback without losing normal dimensions", async () => {
  const f = fixture({stuckNativeRestore: true}); await f.invoke("window-toggle-maximize"); f.invoke("window-move-begin", {x: 840, y: 18});
  const state = await f.invoke("window-move-update", {x: 890, y: 68}); assert.equal(state.maximized, false); assert.equal(state.bounds.width, f.initial.width); assert.equal(state.bounds.height, f.initial.height);
  f.invoke("window-move-end"); const moved = f.bounds(); await f.invoke("window-toggle-maximize"); await f.invoke("window-toggle-maximize"); assert.deepEqual(f.bounds(), moved);
});
test("fallback never forces normal bounds while Electron still confirms a genuinely maximized window", async () => {
  const f = fixture({stuckNativeRestore: true, unreliableGetter: false}); await f.invoke("window-toggle-maximize");
  const count = f.writes.length, state = await f.invoke("window-toggle-maximize"); assert.equal(state.maximized, true); assert.deepEqual(f.bounds(), f.workArea); assert.equal(f.writes.length, count);
  assert.equal(f.invoke("window-move-begin", {x: 400, y: 50, edge: "e"}), false);
});
test("120 repeated ordinary drags at fractional Windows scales never grow the window", async () => {
  for (const scale of [1, 1.25, 1.5]) {
    const f = fixture({scale});
    for (let index = 0; index < 120; index++) {
      const previous = f.bounds(), x = previous.x + 90, y = previous.y + 20;
      assert.equal(f.invoke("window-move-begin", {x, y}), true);
      for (const delta of [3, 7, 12]) {const state = await f.invoke("window-move-update", {x: x + delta, y: y + delta}); assert.equal(state.bounds.width, f.initial.width); assert.equal(state.bounds.height, f.initial.height);}
      f.invoke("window-move-end"); assert.equal(f.bounds().width, f.initial.width); assert.equal(f.bounds().height, f.initial.height);
    }
    assert.equal(f.calls().maximizeCalls, 0); assert.equal(f.calls().unmaximizeCalls, 0);
  }
});
test("ordinary edge resizing changes size deliberately and preserves minimum dimensions", async () => {
  const f = fixture(); assert.equal(f.invoke("window-move-begin", {x: 1400, y: 900, edge: "se"}), true);
  await f.invoke("window-move-update", {x: 1490, y: 990}); f.invoke("window-move-end");
  assert.equal(f.bounds().width, 1450); assert.equal(f.bounds().height, 950);
  assert.equal(f.invoke("window-move-begin", {x: 1490, y: 990, edge: "se"}), true); await f.invoke("window-move-update", {x: -500, y: -500}); f.invoke("window-move-end");
  assert.equal(f.bounds().width, 1100); assert.equal(f.bounds().height, 720);
});
test("foreign senders and malformed pointer values cannot move, resize, maximize or end a trusted gesture", async () => {
  const f = fixture(), before = f.bounds();
  assert.equal(f.invoke("window-move-begin", {x: 100, y: 100}, f.foreign), false);
  await f.invoke("window-toggle-maximize", undefined, f.foreign); await f.invoke("window-move-update", {x: 400, y: 400}, f.foreign); assert.deepEqual(f.bounds(), before); assert.equal(f.calls().maximizeCalls, 0);
  for (const input of [null, {}, {x: NaN, y: 1}, {x: 1, y: Infinity}, {x: 100000, y: 1}, {x: "100", y: 1}]) assert.equal(f.invoke("window-move-begin", input), false);
  assert.equal(f.invoke("window-move-begin", {x: 100, y: 100}), true); f.invoke("window-move-end", undefined, f.foreign); await f.invoke("window-move-update", {x: 120, y: 120}); assert.notDeepEqual(f.bounds(), before);
  f.invoke("window-move-end"); const ended = f.bounds(); await f.invoke("window-move-update", {x: 400, y: 400}); assert.deepEqual(f.bounds(), ended);
});
test("a closed window cancels gestures and ignores late asynchronous movement calls", async () => {
  const f = fixture(); f.invoke("window-move-begin", {x: 100, y: 100}); f.closed(); const before = f.bounds();
  const result = await f.invoke("window-move-update", {x: 300, y: 300}); assert.equal(result.maximized, false); assert.deepEqual(f.bounds(), before); assert.equal(f.invoke("window-move-begin", {x: 100, y: 100}), false);
});
