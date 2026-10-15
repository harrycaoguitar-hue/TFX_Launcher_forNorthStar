"use strict";

// This module describes the existing installer's plan. It never repairs game
// resources, changes enabledmods.json, or promises that a preview is an install.
const fs = require("fs"), fsp = fs.promises, path = require("path");
const {prepareReplacement, readJournals, rangeKey, legacyCatalogue} = require("./dds-replacement");
const {readRange} = require("./dds-engine");
const {hash, safeAssetPath} = require("./vtf-vpk");
const {packageWeapons, weaponsFor, belongs} = require("./skin-switch-weapons");
const {assertUnlinkedAncestors} = require("./backup-records");
const modState = require("./mod-enabled-state");

const MAX_ITEMS = 200, MAX_FILES = 12000, MAX_MODS = 1000, MAX_PLAN_BYTES = 128 * 1024 * 1024;
const TARGETS = new Set(["pc_stream.starpak", "pc_stream(03).starpak", "pc_stream(05).starpak", "pc_stream(06).starpak", "pc_stream(07).starpak"]);
const inside = (root, file) => {const relative = path.relative(path.resolve(root), path.resolve(file)); return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);};
const changed = () => Object.assign(Error("皮肤选择或游戏目录已变化，请重新导入并检查。"), {code: "STALE_SKIN_PREVIEW"});
const needsRepair = () => Object.assign(Error("游戏资源需要修复；预览不会修改游戏文件，请先使用页面上的修复操作。"), {code: "PREVIEW_NEEDS_REPAIR"});
const cleanLabel = value => typeof value === "string" ? value.replace(/[\x00-\x1f]/g, "").slice(0, 160) : "";
function ddsResource(row) {
  if (!row || !TARGETS.has(row.target) || !Number.isSafeInteger(row.offset) || row.offset <= 0 || !Number.isSafeInteger(row.length) || row.length <= 0 || !Number.isSafeInteger(row.offset + row.length)) throw Error("DDS 皮肤资源范围无效，无法预览。");
  return `r2/paks/Win64/${row.target}@${row.offset}+${row.length}`;
}
function assetResource(value) {const clean = safeAssetPath(value); if (!/^(materials|models)\//i.test(clean)) throw Error("VTF 皮肤资源路径无效，无法预览。"); return clean;}
function itemFor(format, row, action, evidence, sourceLabel) {
  const resource = format === "dds" ? ddsResource(row) : assetResource(row.path), ids = weaponsFor(format === "dds" ? row.name : resource, format);
  return {action, format, resource, ...(format === "dds" && row.name ? {name: cleanLabel(row.name)} : {}), ...(ids.length === 1 ? {weaponId: ids[0]} : {}), ...(sourceLabel ? {sourceLabel: cleanLabel(sourceLabel)} : {}), evidence};
}
function warning(result, code, detail) {
  if (!result.warnings.some(value => value.code === code)) result.warnings.push({code, ...(detail ? {detail: cleanLabel(detail)} : {})});
  result.complete = false;
}
function append(result, item, seen) {
  const key = [item.action, item.format, item.resource.toLowerCase(), item.modName || ""].join("|");
  if (seen.has(key)) return;
  seen.add(key); result.counts[item.action === "mod-conflict" ? "modConflicts" : item.action]++;
  if (result.items.length < MAX_ITEMS) result.items.push(item);
  else warning(result, "preview-truncated");
}
// ddsPlan normally repairs missing containers. A facade replaces that write
// boundary while retaining the real coordinator's exact plan and validators.
function readOnlyCoordinator(coordinator) {
  const facade = Object.create(coordinator), dds = Object.create(coordinator.dds);
  if (dds.resources) {dds.resources = Object.create(dds.resources); dds.resources.repair = async () => {throw needsRepair();};}
  facade.dds = dds;
  return facade;
}
async function safeDirectory(root, directory) {
  if (!inside(root, directory)) throw Error("模组资源目录超出游戏目录，已停止检查。");
  try {await assertUnlinkedAncestors(directory, "模组资源路径包含链接，无法安全检查。"); const stat = await fsp.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("模组资源目录无效。"); return true;}
  catch (error) {if (error.code === "ENOENT") return false; throw error;}
}
// The cache lasts only for an in-flight request. An enable toggle or edited mod
// must be seen by the next preview; persistent mtime-only caches miss such edits.
async function scanEnabledModFiles({gamePath, profileDirectory, wanted, limit = MAX_FILES, modLimit = MAX_MODS}) {
  const result = {matches: [], complete: true, reason: "", scannedFiles: 0, scannedMods: 0};
  if (!profileDirectory || !await safeDirectory(gamePath, profileDirectory)) return {...result, complete: false, reason: "profile-unavailable"};
  const stateFilename = path.join(profileDirectory, "enabledmods.json");
  try {await assertUnlinkedAncestors(stateFilename, "模组开关配置路径包含链接，无法安全检查。");} catch (error) {if (error.code !== "ENOENT") throw error;}
  const snapshot = modState.checked(stateFilename);
  const document = modState.parse(snapshot);
  const mods = modState.installed(profileDirectory);
  if (mods.length > modLimit) return {...result, complete: false, reason: "mod-scan-incomplete"};
  const stack = [];
  for (const mod of mods) {
    if (!modState.enabled(document, mod.name, mod.version) || mod.required) continue;
    if (!inside(gamePath, mod.folder_path) || !await safeDirectory(gamePath, mod.folder_path)) throw Error("模组资源目录超出游戏目录或包含链接。");
    result.scannedMods++;
    // Northstar mounts a mod's mod/ directory as game-relative loose assets.
    const directory = path.join(mod.folder_path, "mod");
    if (await safeDirectory(gamePath, directory)) stack.push({directory, base: directory, mod});
    // Scripts, plugins and packed VPKs cannot be mapped to exact affected assets
    // without executing code. Their presence is a disclosed coverage limit.
    for (const name of ["vpk", "paks", "plugins"]) if (fs.existsSync(path.join(mod.folder_path, name))) result.complete = false;
  }
  while (stack.length) {
    const current = stack.pop();
    if (!await safeDirectory(gamePath, current.directory)) continue;
    const entries = await fsp.readdir(current.directory, {withFileTypes: true});
    for (const entry of entries) {
      const filename = path.join(current.directory, entry.name);
      if (++result.scannedFiles > limit) return {...result, complete: false, reason: "mod-scan-incomplete"};
      if (entry.isSymbolicLink()) throw Error("模组资源路径包含链接，无法安全检查。");
      if (entry.isDirectory()) {stack.push({...current, directory: filename}); continue;}
      if (!entry.isFile()) {result.complete = false; continue;}
      const relative = path.relative(current.base, filename).split(path.sep).join("/");
      if (!/^(materials|models)\//i.test(relative)) {if (/\.(nut|dll|rpak|vpk)$/i.test(relative)) result.complete = false; continue;}
      const resource = assetResource(relative);
      if (wanted.has(resource.toLowerCase())) result.matches.push({resource, modName: cleanLabel(current.mod.name), version: cleanLabel(current.mod.version)});
    }
  }
  const after = modState.checked(stateFilename);
  if (snapshot === null ? after !== null : after === null || !snapshot.equals(after)) throw changed();
  if (!result.complete && !result.reason) result.reason = "runtime-mods-unchecked";
  return result;
}

async function createPreview({format, engine, coordinator, gamePath, packageId, profileDirectory, analysis = {}, isCurrent = () => true, maxPlanBytes = MAX_PLAN_BYTES, scan = scanEnabledModFiles}) {
  const pkg = engine.packages.get(packageId);
  if (!pkg || !isCurrent()) throw changed();
  if (!["dds", "vtf"].includes(format) || !Array.isArray(pkg.files) || !pkg.files.length) throw Error("请先导入并校验兼容的皮肤包。");
  const result = {version: 1, packageId, format, scope: {weapons: [], profile: null}, counts: {replace: 0, restore: 0, modConflicts: 0}, items: [], warnings: [], complete: true, blocked: false, coverage: {installPlan: false, enabledModLooseFiles: false, runtimeMods: false}};
  const seen = new Set();
  try {
    result.scope.weapons = packageWeapons(format, pkg);
    if (!result.scope.weapons.length) warning(result, "unknown-weapon");
    for (const row of pkg.files) append(result, itemFor(format, row, "replace", "selected-package", pkg.name), seen);
    if (!gamePath || !path.isAbsolute(gamePath)) {warning(result, "game-unavailable"); return result;}
    await assertUnlinkedAncestors(path.resolve(gamePath), "皮肤资源路径包含链接，无法安全预览。");
    const game = await fsp.realpath(gamePath);
    if (!(await fsp.lstat(path.join(game, "Titanfall2.exe"))).isFile()) throw Error("目录中未找到 Titanfall2.exe");
    if (analysis.formatSwitch?.error) throw Error(analysis.formatSwitch.error);
    if (analysis.skinRepair?.state === "error") throw Error(analysis.skinRepair.reason || "跨格式皮肤资源检查失败。");
    if (analysis.formatSwitch?.pending?.length || analysis.pending?.length) throw Error("上次皮肤操作未完成，请先恢复对应备份。");
    if (analysis.game?.ready === false && !analysis.game?.canRepair) throw Error(analysis.game.error || "游戏皮肤资源不兼容，无法生成完整预览。");
    if (!coordinator) {warning(result, "plan-unavailable");}
    else {
      const readonly = readOnlyCoordinator(coordinator);
      // The installer always cleans the same weapon's VPK entries first.
      const vpk = await readonly.vpkPlan(game, result.scope.weapons);
      for (const resource of vpk?.paths || []) {
        if (format === "vtf" && pkg.files.some(row => row.path.toLowerCase() === resource.toLowerCase())) continue;
        append(result, itemFor("vtf", {path: resource}, "restore", "installer-reset-plan"), seen);
      }
      if (!isCurrent() || engine.packages.get(packageId) !== pkg) throw changed();
      if (format === "vtf") {
        // Read metadata before allowing ddsPlan to materialize before/stock
        // buffers. Large scopes stay explicitly incomplete instead of pausing
        // the UI or allocating the installer's full 512 MB working set.
        const candidates = new Map();
        if (readonly.legacyDdsAvailable()) {
          const catalogue = await readonly.weaponDdsRows(game, result.scope.weapons, pkg.dir);
          for (const row of catalogue) candidates.set(rangeKey(row), row);
          readonly.weaponDdsRows = async () => catalogue;
        }
        for (const journal of await readJournals(readonly.dds.baseDir, game)) if (journal.manifest.state === "installed") for (const row of journal.manifest.records) if (belongs(row.family || row.name, result.scope.weapons, "dds")) candidates.set(rangeKey(row), row);
        if ([...candidates.values()].reduce((n, row) => n + row.length, 0) > maxPlanBytes) warning(result, "plan-size-limit");
        else {
          const rows = await readonly.ddsPlan(game, result.scope.weapons, pkg.dir);
          for (const row of rows) append(result, itemFor("dds", row, "restore", "installer-reset-plan"), seen);
        }
      } else {
        await engine.assertLayout?.(game, pkg.files);
        const catalogue = await legacyCatalogue(pkg.files, (files, dir) => engine.plan(files, dir), pkg.dir);
        const size = [...catalogue.values()].reduce((n, row) => n + row.length, 0) + pkg.files.reduce((n, row) => n + row.length, 0);
        if (size > maxPlanBytes) warning(result, "plan-size-limit");
        else {
          const originals = await engine.originals.prepare(pkg, game);
          const journals = await readJournals(engine.baseDir, game);
          if (!originals.status.complete) throw Object.assign(Error(originals.status.reason || "原版皮肤资源不足，需先修复。"), {code: "PREVIEW_NEEDS_REPAIR"});
          const plan = await prepareReplacement({pkg, journals, plan: (files, dir) => engine.plan(files, dir), dir: pkg.dir, readRange, hash, gamePath: game, originals: originals.originals, prepareResources: async rows => {const status = await engine.gameStatus(game, {files: rows}); if (!status.ready) throw needsRepair();}});
          for (const row of plan.rows.filter(row => row.role === "reset")) append(result, itemFor("dds", row, "restore", "installer-reset-plan"), seen);
        }
      }
      result.coverage.installPlan = !result.warnings.some(value => value.code === "plan-size-limit");
    }
    if (!isCurrent() || engine.packages.get(packageId) !== pkg) throw changed();
    // Every actionable VPK path is compared by full game-relative resource
    // identity. Similar names or the same weapon alone never count as proof.
    const wanted = new Set(result.items.filter(row => row.format === "vtf").map(row => row.resource.toLowerCase()));
    if (profileDirectory && inside(game, profileDirectory)) {
      result.scope.profile = path.basename(profileDirectory);
      try {
        const mods = await scan({gamePath: game, profileDirectory, wanted});
        for (const match of mods.matches) append(result, {...itemFor("vtf", {path: match.resource}, "mod-conflict", "enabled-mod-file"), modName: match.modName}, seen);
        result.coverage.enabledModLooseFiles = mods.complete;
        if (!mods.complete) warning(result, mods.reason || "mod-scan-incomplete");
      } catch (error) {if (error.code === "STALE_SKIN_PREVIEW") throw error; warning(result, "mod-scan-incomplete", error.message);}
    } else warning(result, "profile-unavailable");
    // A file scan cannot prove what arbitrary mod scripts/plugins will load.
    warning(result, "unmanaged-resources");
  } catch (error) {
    if (error.code === "STALE_SKIN_PREVIEW") throw error;
    result.complete = false;
    if (error.code === "PREVIEW_NEEDS_REPAIR") warning(result, "needs-repair", error.message);
    else {result.blocked = true; result.error = cleanLabel(error.message || String(error)); warning(result, "plan-unavailable");}
  }
  if (!isCurrent() || engine.packages.get(packageId) !== pkg) throw changed();
  return result;
}

async function forStatus({format, engine, gamePath, packageId, analysis, settings, getSettings, isCurrent}) {
  const argumentsSnapshot = settings.nsargs || "";
  const stillCurrent = () => {
    if (!isCurrent()) return false;
    try {return !getSettings || (getSettings().nsargs || "") === argumentsSnapshot;}
    catch (_) {return false;}
  };
  if (!packageId || !engine.packages.has(packageId) || !stillCurrent()) return null;
  let profileDirectory;
  try {if (gamePath) profileDirectory = require("./northstar-region").resolveProfile(gamePath, require("./launch-session").splitArguments(argumentsSnapshot));} catch (_) {}
  try {return await createPreview({format, engine, gamePath, packageId, profileDirectory, analysis, isCurrent: stillCurrent, coordinator: require("./skin-switch").getActive()});}
  catch (error) {if (error.code === "STALE_SKIN_PREVIEW") return null; throw error;}
}
module.exports = {createPreview, forStatus, scanEnabledModFiles, readOnlyCoordinator, ddsResource, assetResource, MAX_ITEMS, MAX_FILES};
