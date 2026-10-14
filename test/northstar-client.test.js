"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {validateManifest, ownedPath, CORE_DIRS, compareVersion} = require("../src/modules/northstar-client");
function manifest(channel) {
  const names = ["NorthstarLauncher.exe", "bin/x64_retail/wsock32.dll", ...CORE_DIRS.map(directory => directory + "/mod.json")];
  names.push(...(channel === "cn" ? ["Northstar.dll", "launcher.dll"] : ["R2Northstar/Northstar.dll", "R2Northstar/plugins/ranim.dll", "R2Northstar/LEGAL.txt"]));
  return {schemaVersion: 1, channel, version: channel === "cn" ? "1.17.7" : "1.31.13", profile: "R2Northstar", ownedDirectories: CORE_DIRS, files: names.map(path => ({path, size: 512, sha256: "a".repeat(64)}))};
}
test("client manifests bind the distinct CN and global DLL layouts", () => {
  for (const channel of ["cn", "global"]) assert.equal(validateManifest(manifest(channel), channel).channel, channel);
  const mixed = manifest("global"); mixed.files.push({path: "Northstar.dll", size: 512, sha256: "a".repeat(64)});
  assert.throws(() => validateManifest(mixed, "global"), /混合/);
  const incomplete = manifest("cn"); incomplete.files = incomplete.files.filter(file => file.path !== "launcher.dll");
  assert.throws(() => validateManifest(incomplete, "cn"), /混合/);
});
test("client ownership never includes personal content or base-game dependencies", () => {
  for (const target of ["R2Northstar/cfg/autoexec.cfg", "R2Northstar/logs/nslog.txt", "R2Northstar/save/playerdata.pdata", "R2Northstar/mods/Personal.Mod/mod.json", "R2Northstar/plugins/Personal.dll", "vpk/index.vpk", "r2/paks/Win64/pc_stream.starpak", "bin/x64_retail/launcher.dll", "Titanfall2.exe"]) assert.equal(ownedPath(target), false, target);
  for (const target of ["../Northstar.dll", "R2Northstar/mods/Northstar.Client/../Other/file", "R2Northstar/mods/Northstar.Client/NUL.txt", "R2Northstar\\Northstar.dll", "C:/Northstar.dll"]) assert.throws(() => ownedPath(target));
});
test("client manifests reject duplicate paths and file-directory collisions", () => {
  const duplicate = manifest("global"); duplicate.files.push({...duplicate.files[0], path: duplicate.files[0].path.toUpperCase()});
  assert.throws(() => validateManifest(duplicate, "global"), /重复/);
  const collision = manifest("global"); collision.files.push({path: "R2Northstar/mods/Northstar.Client/mod.json/file", size: 1, sha256: "a".repeat(64)});
  assert.throws(() => validateManifest(collision, "global"), /重名/);
  const separated = manifest("global");
  for (const suffix of ["mod/a", "mod/a-foo", "mod/a/b"]) separated.files.push({path: "R2Northstar/mods/Northstar.Client/" + suffix, size: 1, sha256: "a".repeat(64)});
  assert.throws(() => validateManifest(separated, "global"), /重名/);
});
test("snapshot version preference compares numeric components", () => {
  assert.equal(compareVersion("1.18.0", "1.17.7"), 1);
  assert.equal(compareVersion("1.31.9", "1.31.13"), -1);
  assert.equal(compareVersion("v1.18.0", "1.18.0"), 0);
});
