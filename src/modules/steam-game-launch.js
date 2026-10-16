"use strict";

const fs = require("fs"), fsp = fs.promises, path = require("path");
const findgame = require("./findgame"), keyvalues = require("./keyvalues");

const APP_ID = "1237970";
function field(object, name) {
  if (!object || typeof object !== "object") return undefined;
  const keys = Object.keys(object).filter(key => key.toLowerCase() === name.toLowerCase());
  return keys.length === 1 ? object[keys[0]] : undefined;
}
function uniquePaths(values) {
  const found = new Set();
  return values.map(findgame.normalizeGamePath).filter(value => {
    if (!value) return false;
    const key = process.platform === "win32" ? value.toLowerCase() : value;
    if (found.has(key)) return false;
    found.add(key); return true;
  });
}
async function readableFile(filename) {
  try {if (!(await fsp.stat(filename)).isFile()) return false; await fsp.access(filename, fs.constants.R_OK); return true;}
  catch (_) {return false;}
}
async function canonicalDirectory(directory) {
  try {return (await fsp.stat(directory)).isDirectory() ? await fsp.realpath(directory) : null;}
  catch (_) {return null;}
}
function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
async function manifestGame(library) {
  const manifest = path.join(library, "steamapps", `appmanifest_${APP_ID}.acf`);
  try {
    const stat = await fsp.stat(manifest);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return null;
    const state = field(keyvalues.parse(await fsp.readFile(manifest, "utf8")), "AppState");
    if (field(state, "appid") !== APP_ID) return null;
    const install = field(state, "installdir");
    if (typeof install !== "string" || !install.trim() || /[\x00-\x1f]/.test(install) || path.isAbsolute(install) || path.win32.isAbsolute(install) || install.split(/[\\/]/).some(part => !part || part === "." || part === "..")) return null;
    const common = path.resolve(library, "steamapps", "common"), candidate = path.resolve(common, install);
    const relative = path.relative(common, candidate);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return null;
    const gamepath = await canonicalDirectory(candidate);
    if (!gamepath || !await readableFile(path.join(gamepath, "Titanfall2.exe"))) return null;
    return {gamepath, manifest};
  } catch (_) {return null;}
}

// Resolve only an exact manifest-owned installation. Merely finding a folder
// named Titanfall2 is insufficient: dispatching Steam could launch another copy.
// roots replaces default root discovery; registry may be a value or async reader.
// All operations are read-only. The caller supplies already-controlled game args
// after argsPrefix, and still confirms the new game PID and menu independently.
async function resolve(gamepath, options = {}) {
  const selected = findgame.normalizeGamePath(gamepath);
  if (!selected) return null;
  const canonical = await canonicalDirectory(selected);
  if (!canonical || !await readableFile(path.join(canonical, "Titanfall2.exe"))) return null;
  let registry = options.registry;
  try {
    if (typeof registry === "function") registry = await registry();
    else if (registry === undefined && options.roots === undefined) registry = await findgame.registryPaths();
  } catch (_) {registry = null;}
  const defaults = options.roots === undefined ? [
    ...(Array.isArray(registry?.steamPaths) ? registry.steamPaths : []),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Steam"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Steam"),
    "C:\\Program Files (x86)\\Steam"
  ] : options.roots;
  for (const root of uniquePaths(Array.isArray(defaults) ? defaults : [])) {
    const executable = path.join(root, "Steam.exe");
    if (!await readableFile(executable)) continue;
    const libraries = uniquePaths([root,
      ...findgame.libraryPaths(path.join(root, "steamapps", "libraryfolders.vdf")),
      ...findgame.libraryPaths(path.join(root, "config", "libraryfolders.vdf"))
    ]);
    for (const library of libraries) {
      const match = await manifestGame(library);
      if (match && samePath(match.gamepath, canonical)) return {
        executable, appId: APP_ID, argsPrefix: ["-applaunch", APP_ID],
        gamepath: canonical, library, manifest: match.manifest
      };
    }
  }
  return null;
}

module.exports = {resolve};
