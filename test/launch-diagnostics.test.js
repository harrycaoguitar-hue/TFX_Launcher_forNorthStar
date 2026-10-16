"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {LaunchDiagnostics, sanitizeReport, failureOutcome} = require("../src/modules/launch-diagnostics");
const {diagnosticJSON, createExporter, trustedSender, register, PREVIEW_TTL_MS} = require("../src/modules/diagnostic-export");
function fixture() {
  let now = 1700000000000, serial = 0; const events = [], saved = [];
  const id = () => "00000000-0000-4000-8000-" + String(++serial).padStart(12, "0");
  const manager = new LaunchDiagnostics({now:() => now, id, appVersion:"1.0.3-beta.1", onChange:value => events.push(value), persist:value => saved.push(value)});
  manager.begin("northstar");
  return {manager, events, saved, id, now:() => now, advance:value => {now += value;}};
}
test("only observed stages are facts; spawning is not game or Northstar menu confirmation", () => {
  const f = fixture(); f.manager.update({region:"global", clientVersion:"1.31.13", attempts:1});
  f.manager.stage("spawn", "active"); f.advance(20); f.manager.stage("spawn", "observed");
  let report = f.manager.report(); assert.equal(report.stages.find(s => s.code === "spawn").status, "observed");
  assert.equal(report.stages.find(s => s.code === "game").status, "pending"); assert.equal(report.stages.find(s => s.code === "northstar").status, "pending");
  const session = {spawned:true, childPid:"101", baselinePids:new Set(["99"]), entered:false, ready:false};
  f.manager.observe({ok:true, processes:[{image:"NorthstarLauncher.exe", pid:101}, {image:"Titanfall2.exe", pid:99}]}, session);
  assert.equal(f.manager.report().stages.find(s => s.code === "game").status, "pending");
  f.manager.observe({ok:false, processes:[{image:"Titanfall2.exe", pid:102}]}, session);
  assert.equal(f.manager.report().stages.find(s => s.code === "game").status, "pending");
  f.manager.observe({ok:true, processes:[{image:"Titanfall2.exe", pid:102}]}, session);
  report = f.manager.report(); assert.equal(report.stages.find(s => s.code === "game").status, "observed");
  assert.equal(report.stages.find(s => s.code === "northstar").status, "pending"); assert.equal(report.state, "starting");
});
test("stable success retains actual timing; vanilla omits inapplicable Northstar stages", () => {
  const f = fixture(); f.advance(1500); f.manager.stage("northstar", "observed"); f.advance(1000); f.manager.finish();
  const report = f.manager.report(); assert.equal(report.state, "confirmed"); assert.equal(report.elapsedMs, 2500);
  assert.equal(report.stages.find(s => s.code === "northstar").elapsedMs, 1500); assert.equal(report.outcome.code, "confirmed");
  f.manager.begin("vanilla"); f.manager.update({region:"cn"}); f.manager.finish();
  assert.equal(f.manager.report().region, null); assert(!f.manager.report().stages.some(s => ["northstar", "client"].includes(s.code)));
});
test("official Mod diagnostics retain component and readiness stages, while clean and legacy records stay vanilla", () => {
  const f = fixture();
  f.manager.begin("vanilla", {officialMods:true});
  assert.equal(f.manager.report().officialMods, true);
  assert.equal(f.manager.report().schema, 1);
  assert(f.manager.report().stages.some(s => s.code === "client"));
  assert(f.manager.report().stages.some(s => s.code === "northstar"));
  f.manager.stage("client", "observed"); f.advance(200); f.manager.stage("northstar", "observed"); f.manager.finish();
  assert.equal(f.manager.report().stages.find(s => s.code === "northstar").status, "observed");
  assert.equal(f.manager.report().stages.find(s => s.code === "northstar").elapsedMs, 200);
  const persisted = f.manager.report(), restored = new LaunchDiagnostics();
  assert.deepEqual(restored.load(persisted), persisted);
  const legacy = {...persisted}; delete legacy.officialMods;
  assert.equal(sanitizeReport(legacy).officialMods, false);
  for (const value of ["true",1,{},null]) assert.equal(sanitizeReport({...persisted,officialMods:value}).officialMods, false);
  assert.equal(sanitizeReport({...persisted,gameVersion:"northstar",officialMods:true}).officialMods, false);
  f.manager.begin("northstar", {officialMods:true}); assert.equal(f.manager.report().officialMods, false);
  f.manager.begin("vanilla"); assert.equal(f.manager.report().officialMods, false);
  assert(!f.manager.report().stages.some(s => ["client", "northstar"].includes(s.code)));
});
test("official readiness failures preserve bounded evidence and Mod/client recovery actions", () => {
  for (const [code,outcome,known,phase] of [["OFFICIAL_MOD_NOT_READY","official-mod-not-ready",false,"northstar"],["VANILLA_CLIENT_NOT_INSTALLED","client-failed",true,"client"],["VANILLA_RUNTIME_OUTDATED","client-failed",true,"client"]]) {
    const f = fixture(); f.manager.begin("vanilla", {officialMods:true}); f.manager.stage(phase,"active");
    f.manager.finish(Object.assign(Error("private official Mod details"), {code}));
    const report = f.manager.report();
    assert.equal(report.outcome.code,outcome); assert.equal(report.outcome.evidenceCode,code); assert.equal(report.outcome.causeKnown,known);
    assert(report.outcome.actions.includes("client"));
    if(code === "OFFICIAL_MOD_NOT_READY") assert(report.outcome.actions.includes("mods"));
    assert(!JSON.stringify(report).includes("private official Mod details"));
    assert.equal(report.stages.find(s => s.code === phase).status,"failed");
  }
  const f = fixture(); f.manager.begin("vanilla"); f.manager.finish(Object.assign(Error(), {code:"VANILLA_CLIENT_NOT_INSTALLED"}));
  assert(!f.manager.report().outcome.actions.includes("client"));
  assert(f.manager.report().outcome.actions.includes("settings"));
});
test("clean proxy recovery has explicit evidence and local settings/retry actions", () => {
  const f=fixture(); f.manager.begin("vanilla"); f.manager.stage("client","active");
  f.manager.finish(Object.assign(Error("private recovery location"),{code:"CLEAN_PROXY_RECOVERY"}));
  const report=f.manager.report();
  assert.equal(report.outcome.code,"preflight-failed");assert.equal(report.outcome.causeKnown,true);assert.equal(report.outcome.evidenceCode,"CLEAN_PROXY_RECOVERY");
  assert.deepEqual(report.outcome.actions,["settings","retry"]);assert.doesNotMatch(JSON.stringify(report),/private recovery location/);
});
test("timeouts, unconfirmed core and early close never pretend the root cause is known", () => {
  for (const [code, outcome] of [["LAUNCH_TIMEOUT", "timeout"], ["NORTHSTAR_NOT_READY", "northstar-not-ready"], ["LAUNCH_EARLY_EXIT", "game-closed"], ["LAUNCHER_EARLY_EXIT", "spawn-failed"], ["EA_START_TIMEOUT", "ea-failed"]]) {
    const f = fixture(); f.manager.stage("game", "active"); f.advance(120000); f.manager.finish(Object.assign(Error("private detail must not enter record"), {code}));
    const report = f.manager.report(); assert.equal(report.state, "failed"); assert.equal(report.outcome.code, outcome); assert.equal(report.outcome.causeKnown, false);
    assert(!JSON.stringify(report).includes("private detail")); assert(!report.stages.some(s => s.status === "pending" || s.status === "active"));
  }
  assert.equal(failureOutcome({code:"NORTHSTAR_CORE_DISABLED"}, "northstar").causeKnown, true);
  assert.equal(failureOutcome({code:"NORTHSTAR_CORE_DUPLICATE"}, "northstar").causeKnown, true);
  assert.equal(failureOutcome({code:"EA_NOT_INSTALLED"}, "ea").causeKnown, true);
});
test("early game and launcher exits offer Mod troubleshooting only for loader-based launches", () => {
  for (const [gameVersion, options, expected] of [
    ["northstar", {}, ["retry", "mods", "platform", "issue"]],
    ["vanilla", {officialMods:true}, ["retry", "mods", "platform", "issue"]],
    ["vanilla", {}, ["retry", "platform", "issue"]]
  ]) {
    const f = fixture(); f.manager.begin(gameVersion, options);
    f.manager.finish(Object.assign(Error("private Mod details"), {code:"LAUNCH_EARLY_EXIT"}));
    const report = f.manager.report();
    assert.deepEqual(report.outcome.actions, expected);
    assert.equal(report.outcome.causeKnown, false);
    assert.equal(report.outcome.code, "game-closed");
    assert.equal(report.outcome.evidenceCode, "LAUNCH_EARLY_EXIT");
    assert.deepEqual(sanitizeReport(report).outcome, report.outcome);
    assert(!JSON.stringify(report).includes("private Mod details"));
    f.manager.begin(gameVersion, options);
    f.manager.finish(Object.assign(Error(), {code:"LAUNCHER_EARLY_EXIT"}));
    const launcherReport = f.manager.report();
    assert.equal(launcherReport.outcome.actions.includes("mods"), gameVersion === "northstar" || options.officialMods === true);
    assert.equal(launcherReport.outcome.code, "spawn-failed");
    assert.equal(launcherReport.outcome.causeKnown, false);
    assert.equal(launcherReport.outcome.evidenceCode, "LAUNCHER_EARLY_EXIT");
  }
});
test("retry replaces the prior report without accumulating histories and deduplicates polling updates", () => {
  const f = fixture(), previous = f.manager.report().id; f.manager.stage("skins", "active"); f.manager.stage("client", "active"); f.manager.stage("client", "observed"); f.manager.stage("skins", "active");
  f.manager.finish(Error("failure")); assert.equal(f.manager.report().outcome.code, "skins-failed");
  f.manager.begin("northstar"); assert.notEqual(f.manager.report().id, previous); assert.equal(f.manager.report().attempts, 0); assert.equal(f.manager.report().outcome.code, "launching");
  f.manager.stage("game", "observed"); const count = f.events.length;
  for (let i = 0; i < 100; i++) f.manager.stage("game", "observed");
  assert.equal(f.events.length, count); f.manager.update({attempts:2}); assert.equal(f.manager.report().attempts, 2);
});
test("Northstar launcher counts as game only with owned engine evidence; vanilla bootstrap is excluded", () => {
  const f = fixture(), s = {spawned:true, childPid:"101", baselinePids:new Set(), entered:true, ready:false};
  f.manager.observe({ok:true, processes:[{image:"NorthstarLauncher.exe", pid:999}]}, s);
  assert.equal(f.manager.report().stages.find(v => v.code === "game").status, "pending");
  f.manager.observe({ok:true, processes:[{image:"NorthstarLauncher.exe", pid:101}]}, s);
  assert.equal(f.manager.report().stages.find(v => v.code === "game").status, "observed");
  f.manager.begin("vanilla"); s.bootstrapHandoff = true;
  f.manager.observe({ok:true, processes:[{image:"Titanfall2.exe", pid:101}]}, s);
  assert.equal(f.manager.report().stages.find(v => v.code === "game").status, "pending");
});
test("strict export projection drops arbitrary nested secrets and free-form errors instead of pattern guessing", () => {
  const f = fixture(), report = f.manager.report(), secret = "person@example.test|C:\\Users\\Harry\\private|192.168.1.4|Bearer abcdefghijk|steam-password";
  report.root = secret; report.args = [secret]; report.error = secret; report.token = secret; report.modNames = [secret]; report.account = {nested:{password:secret}};
  report.stages[0].rawLog = secret; report.stages.push({code:secret, status:"active", elapsedMs:20}); report.outcome.actions.push(secret);
  report.outcome.evidenceCode = secret; report.outcome.password = secret; report.clientVersion = "1.0.0+private-token";
  const result = diagnosticJSON(report); assert(result); assert(!result.includes(secret)); assert(!result.includes("private-token"));
  assert(!/"(?:root|args|error|token|account|password|modNames|rawLog)"\s*:/.test(result)); assert(Buffer.byteLength(result) < 32768);
  const roundtrip = JSON.parse(result); assert.equal(roundtrip.report.clientVersion, null); assert.equal(roundtrip.report.outcome.evidenceCode, null);
  assert.equal(diagnosticJSON({root:secret, args:[secret], version:1}), null); assert.equal(sanitizeReport(null), null);
});
test("a persisted structured snapshot can be loaded without reintroducing unknown properties", () => {
  const f = fixture(); f.manager.finish(Object.assign(Error("private"), {code:"LAUNCH_TIMEOUT"}));
  const report = f.saved.at(-1), loaded = new LaunchDiagnostics(); assert.deepEqual(loaded.load({...report, root:"secret"}), report);
  assert.equal(loaded.load({version:1, error:"legacy private", root:"private"}), null);
});
test("export requires preview and writes exactly what was previewed after subsequent launches", async () => {
  const f = fixture(), writes = [], choices = []; const exporter = createExporter({getReport:() => f.manager.report(), id:f.id, now:f.now, getWindow:() => ({}), showSaveDialog:async (_window, options) => {choices.push(options); return {filePath:"chosen-file.json"};}, write:async (file, json) => writes.push({file, json})});
  assert.equal((await exporter.save({previewId:"00000000-0000-4000-8000-999999999999"})).errorCode, "PREVIEW_REQUIRED"); assert.equal(choices.length, 0);
  const preview = exporter.preview(); assert.equal(preview.ok, true); assert.equal(preview.preview.bytes, Buffer.byteLength(preview.preview.json));
  f.manager.begin("vanilla"); f.manager.finish(); const result = await exporter.save({previewId:preview.preview.id});
  assert.equal(result.ok, true); assert.equal(writes[0].json, preview.preview.json); assert.equal(JSON.parse(writes[0].json).report.gameVersion, "northstar");
  assert.equal((await exporter.save({previewId:preview.preview.id, filePath:"untrusted-target"})).errorCode, "PREVIEW_REQUIRED"); assert.equal(choices.length, 1);
  f.advance(PREVIEW_TTL_MS + 1); assert.equal((await exporter.save({previewId:preview.preview.id})).errorCode, "PREVIEW_REQUIRED");
});
test("cancel and write failures are explicit and never expose native paths or errors", async () => {
  const f = fixture(); let cancelled = true, writes = 0;
  const exporter = createExporter({getReport:() => f.manager.report(), id:f.id, now:f.now, getWindow:() => ({}), showSaveDialog:async () => cancelled ? {canceled:true} : {filePath:"secret-location"}, write:async () => {writes++; throw Error("secret-location");}});
  const p = exporter.preview(); assert.deepEqual(await exporter.save({previewId:p.preview.id}), {ok:true, cancelled:true}); assert.equal(writes, 0);
  cancelled = false; assert.deepEqual(await exporter.save({previewId:p.preview.id}), {ok:false, errorCode:"SAVE_FAILED"});
});
test("only the owned local document main frame may preview or export", async () => {
  const f = fixture(), handles = new Map(), frame = {}, contents = {mainFrame:frame, isDestroyed:() => false, getURL:() => "file:///app/index.html"}, window = {webContents:contents, isDestroyed:() => false}, event = {sender:contents, senderFrame:frame};
  assert.equal(trustedSender(event, window), true); assert.equal(trustedSender({...event, senderFrame:{}}, window), false); assert.equal(trustedSender({...event, sender:{}}, window), false);
  contents.getURL = () => "https://malicious.test"; assert.equal(trustedSender(event, window), false); contents.getURL = () => "file:///app/index.html";
  register({ipcMain:{handle:(key, fn) => handles.set(key, fn)}, dialog:{showSaveDialog:async () => ({canceled:true})}, getWindow:() => window, getReport:() => f.manager.report(), now:f.now, id:f.id});
  assert.equal(handles.get("launch-diagnostic-get")({}).errorCode, "UNTRUSTED_SENDER"); assert.equal((await handles.get("launch-diagnostic-export")({}, {})).errorCode, "UNTRUSTED_SENDER");
  const p = handles.get("launch-diagnostic-get")(event); assert.equal(p.ok, true); assert.equal((await handles.get("launch-diagnostic-export")(event, {previewId:p.preview.id})).cancelled, true);
});
test("empty diagnostics and overlapping save requests stay bounded", async () => {
  const f = fixture(); let release;
  const none = createExporter({getReport:() => null, getWindow:() => ({}), showSaveDialog:async () => ({canceled:true})}); assert.deepEqual(none.preview(), {ok:true, report:null, preview:null});
  const exporter = createExporter({getReport:() => f.manager.report(), now:f.now, id:f.id, getWindow:() => ({}), showSaveDialog:() => new Promise(resolve => {release = resolve;})});
  const p = exporter.preview(); const pending = exporter.save({previewId:p.preview.id}); assert.equal((await exporter.save({previewId:p.preview.id})).errorCode, "SAVE_PENDING"); release({canceled:true}); await pending;
});
