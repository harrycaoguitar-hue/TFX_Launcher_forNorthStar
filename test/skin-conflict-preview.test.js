"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), fsp = fs.promises, path = require("node:path"), os = require("node:os");
const {DdsEngine} = require("../src/modules/dds-engine"), {VtfEngine, INDEX_NAME, archiveName} = require("../src/modules/vtf-engine");
const {SkinSwitchCoordinator} = require("../src/modules/skin-switch");
const {hash, serializeIndex, parseIndex} = require("../src/modules/vtf-vpk");
const {rangeKey} = require("../src/modules/dds-replacement");
const {createPreview, forStatus, scanEnabledModFiles, readOnlyCoordinator} = require("../src/modules/skin-conflict-preview");

async function fixture(t) {
  const home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "tfx-preview-")));
  t.after(() => fsp.rm(home, {recursive: true, force: true}));
  const game = path.join(home, "game"), resources = path.join(game, "r2/paks/Win64"), vpk = path.join(game, "vpk"), profileDirectory = path.join(game, "R2Northstar");
  await fsp.mkdir(resources, {recursive: true}); await fsp.mkdir(vpk); await fsp.mkdir(path.join(profileDirectory, "mods"), {recursive: true});
  await fsp.writeFile(path.join(game, "Titanfall2.exe"), "fixture");
  const stock = Buffer.alloc(256, 7), target = path.join(resources, "pc_stream.starpak"); await fsp.writeFile(target, stock);
  const entries = ["car/car_col", "car/car_ao", "volt/volt_col"].map((name, i) => ({path: "materials/models/weapons/" + name + ".vtf", index: 0, crc: 0, chunks: [{flags: 0x101, textureFlags: 0, offset: i * 4, compressedSize: 4, size: 4}]}));
  const index = serializeIndex(entries), indexFile = path.join(vpk, INDEX_NAME); await fsp.writeFile(indexFile, index); await fsp.writeFile(path.join(vpk, archiveName(0)), stock);
  const dds = new DdsEngine({baseDir: path.join(home, "dds"), manifestProvider: async () => null}), vtf = new VtfEngine({baseDir: path.join(home, "vtf"), manifestProvider: async () => null});
  vtf.externalGameLock = true; await dds.initialize(); await vtf.initialize();
  const originalRows = ["col", "ao"].map((kind, i) => ({name: `car_default_${kind}.dds`, family: "car_default", target: "pc_stream.starpak", offset: 64 + i * 16, length: 4, width: 256, height: 256, bytes: stock.subarray(64 + i * 16, 68 + i * 16)}));
  dds.originals.prepare = async () => ({status: {complete: true}, originals: new Map(originalRows.map(row => [rangeKey(row), row]))});
  vtf.originals.prepare = async () => ({status: {complete: true}, entries: parseIndex(index).entries});
  const coordinator = new SkinSwitchCoordinator({baseDir: path.join(home, "switch"), dds, vtf, acquireLock: async () => async () => {}, originalProvider: async ({files}) => new Map(files.map(row => [rangeKey(row), {...row, bytes: stock.subarray(row.offset, row.offset + row.length)}]))});
  const addDds = async (id, kinds = ["col"]) => {
    const dir = path.join(dds.baseDir, "packages", id); await fsp.mkdir(dir, {recursive: true}); const files = [];
    for (const kind of kinds) {const original = originalRows.find(row => row.name === `car_default_${kind}.dds`), file = path.join(dir, original.name), data = Buffer.from((id + kind).slice(0, 4).padEnd(4, "!")); await fsp.writeFile(file, data); files.push({...original, path: file, sha256: hash(data), skip: 0});}
    const pkg = {id, name: id, dir, files, count: files.length, bytes: files.length * 4}; dds.packages.set(id, pkg); return pkg;
  };
  const addVtf = async (id, weapon = "car", kinds = ["col"]) => {
    const dir = path.join(home, id);
    for (const kind of kinds) {const file = path.join(dir, "materials/models/weapons", weapon, `${weapon}_${kind}.vtf`); await fsp.mkdir(path.dirname(file), {recursive: true}); const bytes = Buffer.alloc(84); bytes.write("VTF\0"); bytes.writeUInt32LE(7, 4); bytes.writeUInt32LE(2, 8); bytes.writeUInt32LE(80, 12); bytes.writeUInt16LE(1, 16); bytes.writeUInt16LE(1, 18); bytes.writeUInt16LE(1, 24); bytes.writeInt32LE(0, 52); bytes[56] = 1; bytes.writeInt32LE(-1, 57); bytes.writeUInt16LE(1, 63); bytes.write("skin", 80); await fsp.writeFile(file, bytes);}
    const result = await vtf.inspect(dir); return vtf.packages.get(result.id);
  };
  const preview = (format, pkg, options = {}) => createPreview({format, engine: format === "dds" ? dds : vtf, coordinator, gamePath: game, packageId: pkg.id, profileDirectory, ...options});
  const unchanged = async before => {assert.deepEqual(await fsp.readFile(target), before.dds); assert.deepEqual(await fsp.readFile(indexFile), before.vtf);};
  const snapshot = async () => ({dds: await fsp.readFile(target), vtf: await fsp.readFile(indexFile)});
  return {home, game, dds, vtf, coordinator, target, indexFile, profileDirectory, addDds, addVtf, preview, snapshot, unchanged};
}

test("DDS omitted-map preview matches the actual reset plan and never writes the game", async t => {
  const f = await fixture(t), old = await f.addDds("old", ["col", "ao"]), incoming = await f.addDds("new");
  await f.coordinator.install("dds", f.game, old.id); const before = await f.snapshot(), preview = await f.preview("dds", incoming);
  assert.equal(preview.blocked, false); assert.deepEqual(preview.scope.weapons, ["car"]); assert.equal(preview.counts.replace, 1); assert.equal(preview.counts.restore, 1);
  assert.match(preview.items.find(row => row.action === "restore").resource, /@80\+4$/); assert.equal(preview.items.find(row => row.action === "restore").evidence, "installer-reset-plan"); await f.unchanged(before);
  const installed = await f.coordinator.install("dds", f.game, incoming.id); assert.equal(installed.resetCount, preview.counts.restore);
});
test("DDS to VTF preview restores both managed DDS resources and matches real installation", async t => {
  const f = await fixture(t), dds = await f.addDds("old", ["col", "ao"]), vtf = await f.addVtf("vtf");
  await f.coordinator.install("dds", f.game, dds.id); const before = await f.snapshot(), preview = await f.preview("vtf", vtf);
  assert.equal(preview.blocked, false); assert.equal(preview.counts.replace, 1); assert.equal(preview.items.filter(row => row.action === "restore" && row.format === "dds").length, 2); await f.unchanged(before);
  const installed = await f.coordinator.install("vtf", f.game, vtf.id); assert.equal(installed.crossFormatReset.ddsRanges, 2);
});
test("VTF to DDS preview lists exact VPK paths, preserving a different weapon", async t => {
  const f = await fixture(t), vtf = await f.addVtf("old-vtf", "car", ["col", "ao"]), dds = await f.addDds("new-dds");
  await f.coordinator.install("vtf", f.game, vtf.id); const before = await f.snapshot(), preview = await f.preview("dds", dds);
  assert.equal(preview.blocked, false); const resets = preview.items.filter(row => row.action === "restore" && row.format === "vtf"); assert.equal(resets.length, 2); assert(resets.every(row => row.weaponId === "car")); await f.unchanged(before);
  const installed = await f.coordinator.install("dds", f.game, dds.id); assert.equal(installed.crossFormatReset.vtfPaths, resets.length);
  const volt = await f.addVtf("volt", "volt"), disjoint = await f.preview("vtf", volt); assert.equal(disjoint.counts.restore, 0); assert(!disjoint.items.some(row => row.weaponId === "car"));
});
test("enabled loose mod conflicts require the full resource path, and toggles invalidate the next scan", async t => {
  const f = await fixture(t), pkg = await f.addVtf("incoming"); const resource = pkg.files[0].path;
  const add = async (name, asset) => {const folder = path.join(f.profileDirectory, "mods", name); await fsp.mkdir(path.join(folder, "mod", path.dirname(asset)), {recursive: true}); await fsp.writeFile(path.join(folder, "mod.json"), JSON.stringify({Name: name, Version: "1"})); await fsp.writeFile(path.join(folder, "mod", asset), "fixture");};
  await add("Exact", resource); await add("Other", resource.replace("/car/", "/volt/"));
  const before = await f.snapshot(), enabled = await f.preview("vtf", pkg); assert.equal(enabled.counts.modConflicts, 1); assert.equal(enabled.items.find(row => row.action === "mod-conflict").modName, "Exact");
  await fsp.writeFile(path.join(f.profileDirectory, "enabledmods.json"), JSON.stringify({Version: 1, Exact: {"1": false}}));
  const disabled = await f.preview("vtf", pkg); assert.equal(disabled.counts.modConflicts, 0); await f.unchanged(before); assert(disabled.warnings.some(row => row.code === "unmanaged-resources")); assert.equal(disabled.complete, false);
});
test("malicious package asset paths and DDS target names cannot become preview resources", async t => {
  const f = await fixture(t), vtf = await f.addVtf("vtf"), dds = await f.addDds("dds"), before = await f.snapshot();
  vtf.files[0].path = "materials/../../outside.vtf"; const a = await f.preview("vtf", vtf); assert.equal(a.blocked, true); assert.equal(a.counts.replace, 0);
  dds.files[0].target = "../../outside"; const b = await f.preview("dds", dds); assert.equal(b.blocked, true); assert.equal(b.counts.replace, 0); await f.unchanged(before);
});
test("stale selection and changed package identity discard the complete preview", async t => {
  const f = await fixture(t), pkg = await f.addVtf("vtf");
  await assert.rejects(f.preview("vtf", pkg, {isCurrent: () => false}), {code: "STALE_SKIN_PREVIEW"});
  let current = true; const original = f.coordinator.vpkPlan; f.coordinator.vpkPlan = async (...args) => {const value = await original.apply(f.coordinator, args); current = false; return value;};
  await assert.rejects(f.preview("vtf", pkg, {isCurrent: () => current}), {code: "STALE_SKIN_PREVIEW"});
});
test("failed analysis and interrupted transactions remain blockers rather than all-clear previews", async t => {
  const f = await fixture(t), pkg = await f.addVtf("vtf"), before = await f.snapshot();
  const failed = await f.preview("vtf", pkg, {analysis: {game: {ready: false, canRepair: false, error: "fixture resource mismatch"}}}); assert.equal(failed.blocked, true); assert.equal(failed.error, "fixture resource mismatch");
  const pending = await f.preview("vtf", pkg, {analysis: {pending: ["unfinished"]}}); assert.equal(pending.blocked, true); assert.match(pending.error, /未完成/); await f.unchanged(before);
});
test("preview facade refuses the coordinator's automatic DDS repair boundary", async () => {
  let writes = 0; const original = {dds: {resources: {repair: async () => {writes++;}}}};
  const readonly = readOnlyCoordinator(original); await assert.rejects(readonly.dds.resources.repair(), {code: "PREVIEW_NEEDS_REPAIR"}); assert.equal(writes, 0); assert.notEqual(readonly.dds, original.dds);
});
test("missing DDS resources do not get repaired by a VTF preview", async t => {
  const f = await fixture(t), old = await f.addDds("old"), pkg = await f.addVtf("vtf"); await f.coordinator.install("dds", f.game, old.id); await fsp.unlink(f.target);
  let writes = 0; f.dds.resources.repair = async () => {writes++;}; const preview = await f.preview("vtf", pkg); assert.equal(preview.blocked, true); assert(preview.error); assert.equal(writes, 0); await assert.rejects(fsp.stat(f.target), {code: "ENOENT"});
});
test("bounded scans disclose incomplete coverage, and linked mod assets are not followed", async t => {
  const f = await fixture(t), folder = path.join(f.profileDirectory, "mods/Example"), wanted = new Set(["materials/car.vtf"]);
  await fsp.mkdir(path.join(folder, "mod/materials"), {recursive: true}); await fsp.writeFile(path.join(folder, "mod.json"), JSON.stringify({Name: "Example", Version: "1"})); await fsp.writeFile(path.join(folder, "mod/materials/car.vtf"), "fixture");
  const bounded = await scanEnabledModFiles({gamePath: f.game, profileDirectory: f.profileDirectory, wanted, limit: 1}); assert.equal(bounded.complete, false); assert.equal(bounded.reason, "mod-scan-incomplete");
  const external = path.join(f.home, "external"); await fsp.mkdir(external); await fsp.symlink(external, path.join(folder, "mod/materials/linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(scanEnabledModFiles({gamePath: f.game, profileDirectory: f.profileDirectory, wanted}), /链接/);
});
test("large plan previews stop before reading stock buffers and disclose omitted reset coverage", async t => {
  const f = await fixture(t), pkg = await f.addDds("dds"); let originalReads = 0; f.dds.originals.prepare = async () => {originalReads++; throw Error("must not allocate original buffers");};
  const result = await f.preview("dds", pkg, {maxPlanBytes: 1}); assert.equal(result.blocked, false); assert.equal(result.coverage.installPlan, false); assert(result.warnings.some(row => row.code === "plan-size-limit")); assert.equal(originalReads, 0); assert.equal(result.counts.replace, 1);
});
test("status discards an in-flight mod preview when custom-profile arguments change", async t => {
  const f = await fixture(t), pkg = await f.addVtf("vtf"), saved = {nsargs: "-profile R2Northstar"};
  const options = {format: "vtf", engine: f.vtf, gamePath: f.game, packageId: pkg.id, analysis: {}, settings: {...saved}, getSettings: () => saved, isCurrent: () => true};
  const baseline = await forStatus(options); assert.equal(baseline.packageId, pkg.id); assert.equal(baseline.scope.profile, "R2Northstar");
  const realpath = fsp.realpath; let changedDuringRead = false;
  fsp.realpath = async function (file, ...args) {const value = await realpath.call(this, file, ...args); if (path.resolve(file) === f.game) {saved.nsargs = "-profile OtherProfile"; changedDuringRead = true;} return value;};
  try {const stale = await forStatus(options); assert.equal(changedDuringRead, true); assert.equal(stale, null);}
  finally {fsp.realpath = realpath;}
  const current = await forStatus({...options, settings: {...saved}}); assert.equal(current.packageId, pkg.id); assert(current.warnings.some(row => row.code === "profile-unavailable"));
});
