"use strict";
// Download authenticated originals into a separate cache. Never ask Steam to
// validate the live installation: that would discard unrelated installed skins.
const path=require("path");
const {app,ipcMain}=require("electron");
const {findManifest}=require("./dds-originals");
const {legacyCatalogue}=require("./dds-replacement");
const {SteamResourceDownload}=require("./steam-resource-download");
const {planVtfResources}=require("./vtf-resource-download-plan");
const {verifyComplete}=require("./dds-resource-recovery");
const gate=require("./dds-operation-gate"),running=require("./is_running");
const allowed=name=>/^r2\/paks\/win64\/pc_stream(?:\(0[3567]\))?\.starpak$/.test(name)||/^vpk\/(?:englishclient_mp_common\.bsp\.pak000_dir|client_mp_common\.bsp\.pak000_\d+)\.vpk$/.test(name);
let active=null;
app.on("before-quit",()=>{if(active){active.cancelled=true;active.downloader?.cancel();}});
function register(kind,{engine,currentPackage,revision,gamePath,status,response,install}){
 const plans=new WeakMap();
 const stamp=prepared=>JSON.stringify({selection:prepared.selection,manifest:prepared.options.manifest?.SHA256||null,files:prepared.options.files,installAfterRepair:prepared.installAfterRepair,staged:prepared.plan.staged===true,additionalFiles:prepared.options.additionalFiles||[],indexSignature:prepared.indexSignature,skinRepair:prepared.skinRepairSignature});
 function identity(input){return {id:currentPackage(input),revision:revision(),root:gamePath()};}
 function assertCurrent(value){if(value.root!==gamePath()||value.revision!==revision()||value.id!==currentPackage({packageId:value.id,selectionRevision:value.revision}))throw Error("游戏目录或皮肤选择已改变，请重新确认后再安装。");}
 async function prepare(input){
  const selection=identity(input),pkg=engine.packages.get(selection.id),installAfterRepair=input.installAfterRepair===true;
  if(!pkg)throw Error("请重新选择并校验皮肤包");
  if(installAfterRepair&&typeof install!=="function")throw Error("皮肤安装操作不可用，请更新启动器后重试。");
  if(await running.game())throw Error("请先退出游戏，再修复皮肤资源。");
  const game=await engine.gameStatus(selection.root,pkg);
  let original,vPlan;
  if(kind==="dds")original=await engine.replacementStatus(selection.root,selection.id);
  else original=await engine.originals.prepare(selection.root);
  const skinRepair=engine.skinRepairRequirements?await engine.skinRepairRequirements(selection.root,pkg):{ready:true};
  if(skinRepair.state==="error")throw Error(skinRepair.reason||"皮肤资源版本不兼容，未修改游戏。");
  const readyLocally=game.ready&&skinRepair.ready&&(kind==="dds"?original?.state==="ready":original?.status?.state==="ready");
  const manifest=await findManifest(selection.root,{include:allowed});
  if(!manifest&&!readyLocally)throw Error("未找到当前游戏的官方资源清单，无法验证补齐文件。请先获取对应版本的资源清单。");
  const files=new Set();
  async function verifiedLocalDdsSource(issue,name){
   if(issue.repairable!==true||!engine.resources?.sources)return false;
   for(const source of await engine.resources.sources(selection.root,issue.target)){
    assertCurrent(selection);if(active?.cancelled)throw Error("下载已取消，当前皮肤选择已保留。");
    try{await verifyComplete(source,manifest.files.get(name));}
    catch(error){if(error.message==="皮肤资源路径包含链接或非普通文件，已停止资源读写。")throw error;continue;}
    assertCurrent(selection);return true;
   }
   return false;
  }
  if(kind==="dds"){
   for(const issue of game.issues||[]){
    if(!["missing","truncated"].includes(issue.code))continue;
    const name=("r2/paks/Win64/"+issue.target).replace(/\\/g,"/").toLowerCase();
    if(!allowed(name)||!manifest.files.has(name))throw Error("缺失的是自定义皮肤文件，请重新导入对应皮肤包；原版资源无法替代它。");
    if(!await verifiedLocalDdsSource(issue,name))files.add(name);
   }
   if(original?.state!=="ready"){
    const rows=await legacyCatalogue(pkg.files,(...args)=>engine.plan(...args),pkg.dir);
    for(const row of rows.values())files.add("r2/paks/win64/"+row.target.toLowerCase());
   }
  }
  if(manifest&&(kind==="vtf"||skinRepair.vtfOriginal?.state!=="ready"&&skinRepair.vtfOriginal)){
   const stockDiscovery=Boolean(engine.skinRepairRequirements&&skinRepair.vtfOriginal?.state!=="ready");
   vPlan=await planVtfResources({root:selection.root,engine:kind==="vtf"?engine:{},game:kind==="vtf"?game:{issues:[]},manifest,original:kind==="vtf"?original:{status:skinRepair.vtfOriginal},stockDiscovery,resolveStockTargets:stockDiscovery?async source=>{
    assertCurrent(selection);const requirement=await engine.skinRepairRequirements(selection.root,pkg,source);
    if(requirement.state==="error")throw Error(requirement.reason||"皮肤资源版本不兼容，未修改游戏。");
    return requirement.vtfTargets||[];
   }:undefined});
   for(const name of vPlan.files)files.add(name);
  }
  for(const target of skinRepair.ddsTargets||[]){
   const name=(target.includes("/")?target:"r2/paks/win64/"+target).replace(/\\/g,"/").toLowerCase();
   if(!allowed(name)||!manifest?.files.has(name))throw Error("未找到当前游戏的官方资源清单，无法验证补齐文件。请先获取对应版本的资源清单。");
   files.add(name);
  }
  for(const target of skinRepair.vtfTargets||[]){
   const name=target.replace(/\\/g,"/").toLowerCase();
   if(name==="vpk/englishclient_mp_common.bsp.pak000_dir.vpk"&&skinRepair.vtfOriginal?.state==="ready")continue;
   if(!/^vpk\/(?:englishclient_mp_common\.bsp\.pak000_dir|client_mp_common\.bsp\.pak000_\d{3})\.vpk$/.test(name)||!manifest?.files.has(name))throw Error("缺失的是自定义皮肤文件，请重新导入对应皮肤包；原版资源无法替代它。");
   files.add(name);
  }
  if(skinRepair.vtfOriginal&&skinRepair.vtfOriginal.state!=="ready")files.add("vpk/englishclient_mp_common.bsp.pak000_dir.vpk");
  assertCurrent(selection);
  const downloader=new SteamResourceDownload({baseDir:path.join(path.dirname(path.resolve(selection.root)),".tfx-resource-cache"),progress:value=>{
   if(active?.downloader===downloader&&!active.sender.isDestroyed())active.sender.send("skin-resource-progress",{kind,...value});
  }});
  const options={root:selection.root,files:[...files],manifest,...(vPlan?.staged?{additionalFiles:vPlan.additionalFiles,resolveAdditionalFiles:async source=>{assertCurrent(selection);if(active?.cancelled)throw Error("下载已取消，当前皮肤选择已保留。");if(await running.game())throw Error("游戏已启动，资源修复已取消。");return vPlan.resolveAdditionalFiles(source);}}:{})};
  let plan=files.size?await downloader.plan(options):{files:[],count:0,totalBytes:0,requiredCacheBytes:0,localRepair:true};
  if(vPlan?.staged){
   const initialBytes=plan.totalBytes,additionalBytes=vPlan.additionalFiles.filter(name=>!files.has(name)).reduce((n,name)=>n+manifest.files.get(name).size,0),maximumBytes=initialBytes+additionalBytes;
   plan={...plan,staged:true,initialBytes,stagedMaxBytes:maximumBytes,maxTotalBytes:maximumBytes,maximumBytes,totalBytes:maximumBytes,requiredCacheBytes:maximumBytes*2+512*1024*1024,additionalFileCount:vPlan.additionalFiles.length,stages:2};
  }
  return {selection,downloader,options,plan,installAfterRepair,indexSignature:vPlan?.indexSignature||null,skinRepairSignature:JSON.stringify({ready:skinRepair.ready,state:skinRepair.state,ddsTargets:skinRepair.ddsTargets||[],vtfTargets:skinRepair.vtfTargets||[],vtfOriginal:skinRepair.vtfOriginal?.state||null})};
 }
 ipcMain.handle(kind+"-resource-plan",async(event,input={})=>response(event,async()=>{
  const prepared=await prepare(input);plans.set(event.sender,stamp(prepared));return {plan:prepared.plan};
 }));
 ipcMain.handle(kind+"-resource-download",async(event,input={})=>response(event,async()=>gate.run(kind+"-resource-download",async()=>{
  if(active)throw Error("另一个皮肤操作正在执行");
  const job={kind,sender:event.sender,downloader:null,cancelled:false};active=job;
  try{
   const prepared=await prepare(input);job.downloader=prepared.downloader;
   if(job.cancelled)throw Error("下载已取消，当前皮肤选择已保留。");
   if(plans.get(event.sender)!==stamp(prepared))throw Error("游戏目录或皮肤选择已改变，请重新确认后再安装。");plans.delete(event.sender);
   const result=prepared.plan.localRepair?{}:await prepared.downloader.download(prepared.options);
   if(job.cancelled)throw Error("下载已取消，当前皮肤选择已保留。");
   assertCurrent(prepared.selection);
   if(await running.game())throw Error("游戏已启动，资源修复已取消。");
   job.phase="repair";
   if(!event.sender.isDestroyed())event.sender.send("skin-resource-progress",{kind,phase:"repair",canCancel:false,message:"正在准备独立资源下载…"});
   if(engine.prepareSkinRepairSource)await engine.prepareSkinRepairSource(prepared.selection.root,engine.packages.get(prepared.selection.id),result.sourceDir);
   assertCurrent(prepared.selection);
   if(kind==="dds"){
    if(result.sourceDir)await engine.importOriginals(prepared.selection.root,prepared.selection.id,result.sourceDir);
    else await engine.repairResources(prepared.selection.root,prepared.selection.id);
   }else await engine.repairResources(prepared.selection.root,prepared.selection.id,result.sourceDir);
   assertCurrent(prepared.selection);
   if(!prepared.installAfterRepair)return {result:{repaired:true},...await status(prepared.selection.root)};
   if(await running.game())throw Error("游戏已启动，皮肤安装已取消。");
   const repairedStatus=await status(prepared.selection.root);
   if(!repairedStatus.game?.ready||repairedStatus.original&&repairedStatus.original.state!=="ready"||repairedStatus.skinRepair&&!repairedStatus.skinRepair.ready)throw Error(repairedStatus.game?.error||repairedStatus.original?.reason||repairedStatus.skinRepair?.reason||"所需皮肤资源尚未补齐，请重新检查后再安装。");
   assertCurrent(prepared.selection);job.phase="install";
   if(!event.sender.isDestroyed())event.sender.send("skin-resource-progress",{kind,phase:"install",canCancel:false});
   const installed=await install(prepared.selection.root,prepared.selection.id,{...input,packageId:prepared.selection.id,selectionRevision:prepared.selection.revision});
   const installation=installed?.result;
   return {installed:true,result:{...(installation&&typeof installation==="object"?installation:{installation}),repaired:true,installed:true},...await status(prepared.selection.root),...(installed?.protectionWarning?{protectionWarning:installed.protectionWarning}:{})};
  }finally{active=null;}
 })));
 ipcMain.handle(kind+"-resource-cancel",async event=>{
  if(!active||["repair","install"].includes(active.phase)||active.kind!==kind||active.sender!==event.sender)return {ok:true,cancelled:false};
  active.cancelled=true;active.downloader?.cancel();return {ok:true,cancelled:true};
 });
}
module.exports={register};
