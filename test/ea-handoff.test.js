"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {prepare} = require("../src/modules/ea-handoff");
function fixture({warm = false, respondAt = 3000, gameAt = Infinity, failAt = Infinity, rejectStart = false, installed = true} = {}) {
  let now = 0, starts = 0, guards = 0; const stages = [];
  const snapshot = async () => ({ok: now < failAt, processes: [...(warm || starts ? [{image: "eadesktop.exe", pid: 10}] : []), ...(now >= gameAt ? [{image: "Titanfall2.exe", pid: 20}] : [])]});
  return {options: {snapshot, guard: () => {guards++;}, find: async () => installed ? "C:\\EA\\EADesktop.exe" : null, start: async () => {starts++; if (rejectStart) throw Object.assign(Error("denied"), {code: "EACCES"});}, responsive: async p => now >= respondAt ? p.map(x => x.pid) : [], now: () => now, sleep: async delay => {now += delay;}, onStage: (...value) => stages.push(value), timeoutMs: 20000, settleMs: 4000, pollMs: 1000}, counts: () => ({now, starts, guards}), stages};
}
test("cold EA is started once and game waits for stable responsive UI", async () => {
  const f = fixture(), result = await prepare(f.options);
  assert.equal(result.cold, true); assert.equal(result.ready, true);
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().now, 7000);
  assert.deepEqual(f.stages.map(x => x[0]), ["starting", "waiting", "ready"]);
});
test("warm EA launch does not start another desktop or add cold initialization wait", async () => {
  const f = fixture({warm: true, respondAt: 0}), result = await prepare(f.options);
  assert.equal(result.cold, false); assert.equal(f.counts().starts, 0); assert.equal(f.counts().now, 0);
});
test("missing EA installation and rejected spawn provide explicit bounded failures", async () => {
  for (const [options, code] of [[{installed: false}, "EA_NOT_INSTALLED"], [{rejectStart: true}, "EA_START_FAILED"]]) {
    const f = fixture(options); await assert.rejects(prepare(f.options), error => error.code === code); assert.equal(f.counts().now, 0);
  }
});
test("delayed client readiness is awaited and readiness failures remain bounded", async () => {
  const delayed = fixture({respondAt: 12000}); await prepare(delayed.options); assert.equal(delayed.counts().now, 16000);
  const absent = fixture({respondAt: Infinity}); await assert.rejects(prepare(absent.options), error => error.code === "EA_START_TIMEOUT"); assert.equal(absent.counts().now, 20000);
  const failed = fixture({failAt: 5000}); await assert.rejects(prepare(failed.options), error => error.code === "EA_START_TIMEOUT");
});
test("external game or changed selection cancels EA preparation without a duplicate game request", async () => {
  const game = fixture({gameAt: 4000}); await assert.rejects(prepare(game.options), error => error.code === "GAME_ALREADY_RUNNING");
  const changed = fixture(); changed.options.guard = () => {if (changed.counts().now >= 2000) throw Error("selection changed");};
  await assert.rejects(prepare(changed.options), /selection changed/);
});
test("forced replay readiness checks an already running EA without opening a second copy", async () => {
  const f = fixture({warm: true}); await prepare({...f.options, forceWait: true}); assert.equal(f.counts().starts, 0); assert.equal(f.counts().now, 7000);
});
test("an existing EA process that is still initializing waits instead of consuming the game request", async () => {
  const f = fixture({warm: true, respondAt: 3000}); await prepare(f.options); assert.equal(f.counts().starts, 0); assert.equal(f.counts().now, 7000);
});
test("EA background service alone does not count as a launch-ready desktop", async () => {
  const f = fixture(); const snapshot = f.options.snapshot;
  f.options.snapshot = async () => {const state = await snapshot(); return {...state, processes: [...state.processes, {image: "EABackgroundService.exe", pid: 99}]};};
  await prepare(f.options); assert.equal(f.counts().starts, 1);
});

test("default cold preparation observes a responsive client twice without an eight-second delay", async () => {
  const f = fixture(); delete f.options.settleMs; delete f.options.pollMs;
  let observations = 0;
  const responsive = f.options.responsive;
  f.options.responsive = async p => {const ready = await responsive(p); if (ready.length) observations++; return ready;};
  await prepare(f.options);
  assert.equal(f.counts().now, 4500); assert.equal(f.counts().starts, 1);
  assert(observations >= 2);
});

test("a responsive PID change resets the shortened readiness observation window", async () => {
  const f = fixture({respondAt: 0}); delete f.options.settleMs; delete f.options.pollMs;
  f.options.responsive = async p => p.length ? [f.counts().now < 750 ? 10 : 11] : [];
  await prepare(f.options);
  assert.equal(f.counts().now, 2250); assert.equal(f.counts().starts, 1);
});
