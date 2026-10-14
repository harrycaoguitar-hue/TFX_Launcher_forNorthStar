"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const {app,ipcMain} = require("electron");
const settings = require("./settings"), network = require("./northstar-region");
const {splitArguments,hasGame} = require("./launch-session");
const {createClientSwitcher,validateManifest} = require("./northstar-client");
const {ClientBundleCache} = require("./northstar-client-cache");
const win = require("../win");
const gate = require("./dds-operation-gate");
const external = value => value.replace(/app\.asar([\\/])/,"app.asar.unpacked$1");
const dataRoot = fs.existsSync("D:/") ? "D:/TFX-Launcher-Data/northstar-clients" : path.join(app.getPath("userData"),"northstar-clients");
function send(channel,payload) {try {win().send(channel,payload);} catch (_) {}}
let activeRegion = null, singleton;
const cache = new ClientBundleCache({sourceRoot:external(path.join(__dirname,"../tools/clients")),toolsDir:external(path.join(__dirname,"../tools/vtf")),cacheRoot:path.join(dataRoot,"bundles"),validateURL:(...args)=>require("./releases").isClientAssetURL(...args),progress:payload=>send("ns-update-event",{key:"cli.update.downloading",progress:payload.percent,btn_text:payload.percent+"%"})});
function engine() {
  if (!singleton) singleton = createClientSwitcher({bundleRoot:cache.sourceRoot,stateRoot:path.join(dataRoot,"transactions"),bundleProvider:channel=>cache.descriptor(channel),processCheck:()=>require("./is_running").snapshot(),progress:payload=>send("northstar-client-progress",{...payload,region:payload.channel||activeRegion,phase:payload.phase==="recovering"?"checking":payload.phase})});
  return singleton;
}
function context(conf = settings()) {
  const gameRoot = require("./findgame").validateGamePath(conf.gamepath);
  if (!gameRoot) throw Error("游戏目录已失效或缺少 Titanfall2.exe，请重新选择游戏安装目录。");
  const profilePath = network.resolveProfile(gameRoot,splitArguments(conf.nsargs||""));
  if(path.resolve(profilePath).toLowerCase()===path.resolve(gameRoot).toLowerCase())throw Error("北极星配置目录必须位于游戏目录内");
  return {gameRoot,profile:path.relative(gameRoot,profilePath).split(path.sep).join("/")};
}
async function metadata(filename) {
  const stat=await fs.promises.lstat(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error("北极星客户端清单体积无效");
  return JSON.parse(await fs.promises.readFile(filename,"utf8"));
}
async function targetVersion(region,info,conf) {
  let manifest=validateManifest(await metadata(path.join(cache.sourceRoot,region,"manifest.json")),region);
  const pointer=path.join(cache.cacheRoot,"updates",region+".json");
  await cache.safeCachePath(pointer);
  if(fs.existsSync(pointer)){
    const ref=await metadata(pointer);
    if(ref.channel!==region||!/^[a-f0-9]{64}$/.test(ref.directory))throw Error("北极星更新缓存索引无效");
    const candidatePath=path.join(cache.cacheRoot,"updates",ref.directory,"manifest.json");
    await cache.safeCachePath(candidatePath);
    const candidate=validateManifest(await metadata(candidatePath),region);
    if(crypto.createHash("sha256").update(JSON.stringify(candidate)).digest("hex")!==ref.directory)throw Error("北极星更新缓存索引无效");
    manifest=candidate;
  }
  let version=manifest.version;
  const snapshot=info?.backupRoot&&path.join(info.backupRoot,"channel-cache",region,"manifest.json");
  if(snapshot&&fs.existsSync(snapshot)){
    const local=validateManifest(await metadata(snapshot),region), ctx=context(conf);
    if(local.provenance?.kind!=="private-installed-snapshot"||path.resolve(local.provenance.gameRoot).toLowerCase()!==path.resolve(ctx.gameRoot).toLowerCase()||local.provenance.profile.toLowerCase()!==ctx.profile.toLowerCase())throw Error("北极星本地客户端快照来源无效");
    if(require("./releases").compareVersions(local.version,version)>0)version=local.version;
  }
  if(region==="cn"&&info?.installed?.channel==="cn"&&info.installed.recognized&&require("./releases").compareVersions(info.installed.version,version)>0)version=info.installed.version;
  return version;
}
async function status(region, configuration) {
  const conf={...(configuration||settings())};
  region = network.normalize(region || conf.northstarRegion);
  try {
    const info = await engine().inspect({...context(conf),includeAvailable:false}), version=await targetVersion(region,info,conf);
    const selected=info.available?.[region]||info.channels?.[region];
    const active=selected?.active ?? (info.installed?.channel===region);
    const installed=selected?.installed ?? active;
    const error=selected?.error||info.availableError;
    const damaged=selected?.damaged===true || selected?.installState==="damaged" || Boolean(error) || Boolean(active&&!info.ready&&!info.pending?.length);
    return {ok:true,region,version,installed:Boolean(installed),active:Boolean(active),installState:damaged?"damaged":installed?"installed":"not-installed",state:damaged?"needs-repair":installed?(active?"active":"standby"):"missing",selectedVersion:selected?.version|| (active?info.installed?.version:null),installedRegion:info.installed?.channel||null,installedVersion:info.installed?.version||"unknown",ready:Boolean(info.ready&&active&&!damaged),pending:info.pending?.length>0,...(error?{error}:{})};
  } catch(error) {
    // Display the bundled target even before the game directory is selected;
    // status never downloads, changes game files or captures an installed client.
    let version="unknown";try {version=JSON.parse(await fs.promises.readFile(path.join(cache.sourceRoot,region,"manifest.json"),"utf8")).version;}catch(_){}
    return {ok:false,region,version,installed:false,active:false,installState:"not-installed",state:"missing",selectedVersion:null,installedRegion:null,installedVersion:"unknown",ready:false,pending:false,error:error.message};
  }
}
async function ensure({conf=settings(),directory,repair=false,allowInstall=false,refresh=false,guard}={}) {
  conf=Object.freeze({...conf});
  let selectionGuard=guard;
  const guardSelection=async()=>{
    if(!selectionGuard)return;
    try {await selectionGuard();}
    catch(error) {
      // Stop the write once, then let rollback check only the actual game
      // processes. A changed UI selection must never block safe restoration.
      selectionGuard=null;throw error;
    }
  };
  const region=network.normalize(conf.northstarRegion);
  activeRegion=region;
  try {
    send("northstar-client-progress",{region,phase:"checking",percent:0});
    await guardSelection();
    const args={...context(conf),channel:region,repair:repair===true,allowInstall:allowInstall===true,refresh:refresh===true,refreshClient:Boolean(directory)};
    const switcher=directory||guard?createClientSwitcher({bundleRoot:cache.sourceRoot,stateRoot:path.join(dataRoot,"transactions"),bundleProvider:async channel=>directory&&channel===region?{directory,preferSnapshot:false}:cache.descriptor(channel),processCheck:async()=>{await guardSelection();const snapshot=await require("./is_running").snapshot();await guardSelection();return snapshot;},progress:payload=>send("northstar-client-progress",{...payload,region:payload.channel||region,phase:payload.phase==="recovering"?"checking":payload.phase})}):engine();
    const result=await switcher.ensure(args);await switcher.assertReady(args);
    ipcMain.emit("get-version");ipcMain.emit("gui-getmods");return result;
  } catch(error) {
    send("northstar-client-progress",{region,phase:"failed",percent:0,message:error.message});throw error;
  } finally {activeRegion=null;}
}
async function assertReady(conf=settings()) {return engine().assertReady(context(conf));}
async function recover(conf=settings()) {return engine().recover(context(conf));}
async function stopped() {
  const snapshot=await require("./is_running").snapshot();
  if(!snapshot?.ok)throw Error("无法确认游戏进程，已停止北极星文件切换");
  if(hasGame(snapshot))throw Error("请先退出游戏及北极星进程，再安装客户端");
}
function selectedUnchanged(conf) {
  const current=settings();
  if(network.normalize(current.northstarRegion)!==conf.northstarRegion||current.gamepath!==conf.gamepath||current.nsargs!==conf.nsargs)throw Error("客户端选择或游戏目录已改变，请重新安装所选客户端。");
}
async function install(options={}) {
  const original={...settings()}, region=options.region===undefined?network.normalize(original.northstarRegion):options.region;
  if(!["cn","global"].includes(region))return {ok:false,region,error:"请选择国服或全球服北极星客户端",code:"INVALID_REGION"};
  const conf=Object.freeze({...original,northstarRegion:region});
  let result;
  try {
    result=await gate.run("client-install",async()=>{
      selectedUnchanged(conf);context(conf);await stopped();
      // Explicit install is offline-capable. A validated newer cached release
      // may be used; a distribution cache alone is never an installed client.
      const value=await ensure({conf,allowInstall:true,refresh:true,repair:options.repair===true,guard:()=>selectedUnchanged(conf)});
      return {ok:true,region,...value};
    });
  } catch(error) {
    send("northstar-client-progress",{region,phase:"failed",percent:0,message:error.message});
    result={ok:false,region,error:error.message,code:error.code||"INSTALL_FAILED"};
  }
  // Refresh from the captured game/profile rather than a different selection
  // made while the operation was completing. No installation ever spawns.
  result.status=await status(region,conf);
  return result;
}
ipcMain.handle("northstar-client-status",(_event,options={})=>status(options.region));
ipcMain.handle("northstar-client-install",(_event,options={})=>install(options));
module.exports={status,ensure,assertReady,recover,install,cache,context};
