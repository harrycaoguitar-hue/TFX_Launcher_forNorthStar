const path = require("path");
const fs = require("fs-extra");
const win = require("../win");
const {dialog, ipcMain} = require("electron");
const version = require("./version");
const settings = require("./settings");
const findgame = require("./findgame");

const gamepath = {setting:false};
function validPath(value) {
 const candidate = findgame.normalizeGamePath(value);
 return candidate && findgame.validateGamePath(candidate) ? candidate : false;
}
function selectedPath(value) {
 const candidate = findgame.normalizeGamePath(value);
 if (!candidate) return false;
 const direct = validPath(candidate);
 if (direct) return direct;
 const library = findgame.gameInLibrary(candidate);
 if (library) return library;
 const name = path.basename(candidate).toLowerCase();
 if (name === "steamapps") return findgame.gameInLibrary(path.dirname(candidate));
 if (name === "common") return findgame.gameInLibrary(path.dirname(path.dirname(candidate)));
 return validPath(path.dirname(candidate));
}
gamepath.exists = folder => Boolean(validPath(folder === undefined ? settings().gamepath : folder));
gamepath.has_perms = folder => {
 const candidate = validPath(folder === undefined ? settings().gamepath : folder);
 if (!candidate) return false;
 try {fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK); return true;}
 catch (_) {return false;}
};
function publish(window, selected, source, checking=false) {
 const candidate = validPath(selected);
 window.send("gamepath-status", {
  path:typeof selected === "string" ? selected : "", valid:Boolean(candidate), checking, source,
  writable:candidate ? gamepath.has_perms(candidate) : false,
  northstarInstalled:!!candidate && (()=>{try{const stat=fs.lstatSync(path.join(candidate,"NorthstarLauncher.exe"));return stat.isFile()&&!stat.isSymbolicLink();}catch(_){return false;}})()
 });
}
async function accept(window, folder, source) {
 await settings().save({gamepath:folder, zip:path.join(folder,"northstar.zip")});
 publish(window, folder, source);
 window.send("newpath", folder);
 version.send_info();
 if (!window.isVisible()) window.show();
 // Update only after the selected directory has actually been validated.
 require("./update").northstar_autoupdate();
}
// Visibility does not decide whether startup validation is automatic or manual.
ipcMain.on("setpath", (_event, _loaded, forceDialog=false) => {
 if (!gamepath.setting) void gamepath.set(win(), forceDialog === true);
});
gamepath.set = async (window, forceDialog=false) => {
 if (!window || gamepath.setting) return false;
 gamepath.setting = true;
 const saved = settings().gamepath;
 try {
  if (!forceDialog) {
   publish(window, saved, "checking", true);
   const existing = validPath(saved);
   if (existing) {await accept(window, existing, "saved"); return true;}
   const detected = validPath(await findgame());
   if (detected) {await accept(window, detected, "automatic"); return true;}
  }
  publish(window, saved, "manual");
  // Cancel keeps the app open and preserves a previously valid selection.
  const defaultPath = validPath(saved) || undefined;
  while (true) {
   const result = await dialog.showOpenDialog(window, {
    title:forceDialog ? "选择泰坦陨落 2 游戏目录" : "未自动识别到游戏，请选择泰坦陨落 2 游戏目录",
    buttonLabel:"使用此目录", properties:["openDirectory"], ...(defaultPath ? {defaultPath} : {})
   });
   if (result.canceled || !result.filePaths.length) {publish(window, saved, "cancelled"); return false;}
   const selected = selectedPath(result.filePaths[0]);
   if (!selected) {
    await window.alert("所选目录中未找到 Titanfall2.exe。请选择游戏安装根目录（也可选择 Steam 游戏库，TFX 会查找其中的泰坦陨落 2）。");
    continue;
   }
   await accept(window, selected, "manual"); return true;
  }
 } catch (error) {
  console.error("Game directory selection failed:", error);
  publish(window, saved, "error");
  window.send("gamepath-error", "无法读取游戏目录，请点击“更改目录”重新选择。");
  return false;
 } finally {gamepath.setting = false;}
};
let lost = false;
setInterval(async () => {
 if (gamepath.setting || !settings().gamepath) return;
 if (gamepath.exists()) {
  if (lost) {try {await accept(win(),validPath(settings().gamepath),"restored"); lost=false;} catch (_) {}}
  return;
 }
 if (!lost) {lost=true; publish(win(),settings().gamepath,"unavailable"); win().send("gamepath-lost");}
},15000);
module.exports = gamepath;
