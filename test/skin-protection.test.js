"use strict";
const os = require("node:os");
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto"),{createRequire}=require("module"),{EventEmitter}=require("events");
const {parseConfig,KEYS}=require("../src/modules/dds-protection"),{serializeIndex,MAX_INDEX_BYTES}=require("../src/modules/vtf-vpk");
const root=fs.mkdtempSync(path.join(os.tmpdir(), "tfx-skin-protection-"));
const digest=bytes=>crypto.createHash("sha256").update(bytes).digest("hex"),indexName="englishclient_mp_common.bsp.pak000_dir.vpk";
const config=(stream="600000",pic="0",other="7")=>Buffer.from('"VideoConfig"\r\n{\r\n\t"setting.stream_memory"\t"'+stream+'"\r\n\t"setting.mat_picmip"\t"'+pic+'" // personal note\r\n\t"setting.unrelated"\t"'+other+'"\r\n}\r\n');
function loadGuard(base,{running=async()=>false}={}){
  const filename=path.join(__dirname,"../src/modules/dds-guard.js"),req=createRequire(filename),app={getPath:key=>path.join(base,key)},required=[];
  const context={require:id=>{required.push(id);return id==="electron"?{app}:id==="./is_running"?{game:running}:req(id);},module:{exports:{}},Buffer};
  vm.runInNewContext(fs.readFileSync(filename,"utf8"),context,{filename});return {guard:context.module.exports,required,app};
}
function fixture(options={}){
  const base=fs.mkdtempSync(path.join(root,"case-")),game=path.join(base,"game"),otherGame=path.join(base,"other-game"),appRoot=path.join(base,"appData/fold-launcher"),video=path.join(base,"documents/Respawn/Titanfall2/local/videoconfig.txt");
  fs.mkdirSync(game);fs.mkdirSync(otherGame);fs.writeFileSync(path.join(game,"Titanfall2.exe"),"fixture");fs.mkdirSync(path.dirname(video),{recursive:true});fs.writeFileSync(video,config());
  const loaded=loadGuard(base,options);
  function json(directory,filename,value){fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,filename),JSON.stringify(value));}
  const vpkEntry=(asset="materials/models/weapons/car/car_col.vtf",index=1)=>({path:asset,index,crc:0,chunks:[{flags:0x101,textureFlags:0,offset:0,compressedSize:4,size:4}]});
  function index(entries=[vpkEntry()]){fs.mkdirSync(path.join(game,"vpk"),{recursive:true});fs.writeFileSync(path.join(game,"vpk",indexName),serializeIndex(entries));}
  function vtf(state="installed",gamePath=game,asset="materials/models/weapons/car/car_col.vtf",archiveIndex=1){const id=crypto.randomUUID();const value={version:1,id,name:"VTF fixture",gamePath,createdAt:new Date().toISOString(),state,indexName,beforeHash:digest("before"),afterHash:digest("after"),archiveHash:digest("archive"),archiveIndex,archiveName:`client_mp_common.bsp.pak000_${String(archiveIndex).padStart(3,"0")}.vpk`,stageArchive:`.vyra-vtf-${id}.archive.tmp`,stageIndex:`.vyra-vtf-${id}.index.tmp`,archivePublished:true,files:[{path:asset,bytes:4,sha256:digest("skin"),type:"vtf",frames:1}]};const directory=path.join(appRoot,"vtf/backups",id);json(directory,"manifest.json",value);return {id,value,directory};}
  function dds(state="installed",gamePath=game,extra={}){const id=crypto.randomUUID();const value={version:1,id,name:"DDS fixture",gamePath,createdAt:new Date().toISOString(),state,records:state==="preparing"?[]:[{name:"car_col.dds",family:"car",target:"pc_stream.starpak",offset:128,length:4,beforeHash:digest("old!"),afterHash:digest("new!"),...extra}]};const directory=path.join(appRoot,"dds/backups",id);json(directory,"manifest.json",value);return {id,value,directory};}
  function switching(state="cleaned",format="vtf",gamePath=game){const id=crypto.randomUUID(),value={version:1,id,format,name:"Cross-format fixture",gamePath,createdAt:new Date().toISOString(),state,ranges:[],weapons:["car"],incomingBackupId:null};const directory=path.join(appRoot,"skin-switch",id);json(directory,"transaction.json",value);return {id,value,directory};}
  const update=(row,state)=>{row.value.state=state;json(row.directory,row.value.format?"transaction.json":"manifest.json",row.value);};
  return {base,game,otherGame,appRoot,video,...loaded,json,vtf,dds,switching,index,vpkEntry,update};
}
test("real journal wiring counts installed DDS and VTF in one game only, terminal records are inactive",async()=>{
  const f=fixture();f.index();f.dds();f.vtf();f.dds("restored");f.vtf("restored");f.dds("rolled-back");f.vtf("rolled-back");f.dds("installed",f.otherGame);f.vtf("installed",f.otherGame);
  const status=await f.guard.status(f.game);assert.equal(status.activeCount,2);assert.equal(status.ddsCount,1);assert.equal(status.vtfCount,1);assert.equal(status.pendingCount,0);assert.equal(status.state,"unrecorded");assert.equal(status.gamePath,path.resolve(f.game));
  assert.equal(f.required.some(id=>["./dds","./vtf","./vtf-engine","./skin-switch"].includes(id)),false);
});
test("restored/rolledback VTF-only records do not activate protection",async()=>{const f=fixture();f.vtf("restored");f.vtf("rolled-back");assert.equal((await f.guard.status(f.game)).activeCount,0);assert.equal((await f.guard.beforeLaunch(f.game)).state,"inactive");});
test("VTF active records follow surviving live index paths, not obsolete installed journals",async()=>{const f=fixture();f.vtf();f.index([f.vpkEntry(undefined,2)]);assert.equal((await f.guard.status(f.game)).vtfCount,0);f.index();assert.equal((await f.guard.status(f.game)).vtfCount,1);});
test("oversized or non-file live VPK indexes are rejected before allocating their bytes",async()=>{
  const f=fixture();f.vtf();f.index();const file=path.join(f.game,"vpk",indexName),before=fs.readFileSync(f.video),handle=fs.openSync(file,"r+");try{fs.ftruncateSync(handle,MAX_INDEX_BYTES+1);}finally{fs.closeSync(handle);}
  assert.match((await f.guard.status(f.game)).reason,/超过支持的大小/);await assert.rejects(f.guard.beforeLaunch(f.game),/超过支持的大小/);assert.deepEqual(fs.readFileSync(f.video),before);
  fs.rmSync(file);fs.mkdirSync(file);assert.match((await f.guard.status(f.game)).reason,/索引文件无效/);await assert.rejects(f.guard.beforeLaunch(f.game),/索引文件无效/);assert.deepEqual(fs.readFileSync(f.video),before);
});
test("DDS superseded and original-reset records use established coverage instead of every installed history",async()=>{
  const f=fixture(),old=f.dds();old.value.createdAt="2026-10-01T00:00:00.000Z";f.json(old.directory,"manifest.json",old.value);const recent=f.dds("restored",f.game,{originalReset:true});recent.value.createdAt="2026-10-02T00:00:00.000Z";f.json(recent.directory,"manifest.json",recent.value);assert.equal((await f.guard.status(f.game)).ddsCount,0);
});
test("pending or preparing writes in either format block launch even when protection is disabled",async()=>{
  for(const format of ["dds","vtf"])for(const state of ["pending","preparing"]){const f=fixture();f[format](state);await f.guard.setEnabled(f.game,false);const before=fs.readFileSync(f.video);const status=await f.guard.status(f.game);assert.equal(status.pendingCount,1);assert.equal(status.state,"error");await assert.rejects(f.guard.beforeLaunch(f.game),/未完成的皮肤安装/);assert.deepEqual(fs.readFileSync(f.video),before);}
});
test("an incomplete cross-format transaction blocks launch before an incoming core manifest exists",async()=>{for(const format of ["dds","vtf"]){const f=fixture();f.switching("cleaned",format);assert.equal((await f.guard.status(f.game)).pendingCount,1);await assert.rejects(f.guard.beforeLaunch(f.game),/未完成的皮肤安装/);}});
test("terminal cross-format records and other-game pending records do not block selected game",async()=>{const f=fixture();for(const state of ["installed","restored","rolled-back","cancelled"])f.switching(state);f.switching("core-pending","vtf",f.otherGame);assert.equal((await f.guard.status(f.game)).activeCount,0);assert.equal((await f.guard.beforeLaunch(f.game)).state,"inactive");});
test("VTF-only protection restores exactly the two captured values and preserves unrelated fields and line endings",async()=>{
  const f=fixture(),candidate=await f.guard.prepareCapture(f.game);f.vtf();f.index();await f.guard.commitCapture(f.game,candidate);const altered=config("100000","2","33");fs.writeFileSync(f.video,altered);assert.equal((await f.guard.status(f.game)).state,"changed");const result=await f.guard.beforeLaunch(f.game);assert.equal(result.restored,true);assert.deepEqual(Array.from(result.fields),KEYS);assert.deepEqual(fs.readFileSync(f.video),config("600000","0","33"));assert.deepEqual(fs.readFileSync(path.join(result.receipt,"before.bin")),altered);
});
test("actual VTF engine install, pending write, restore and deletion update shared protection",async()=>{
  const {VtfEngine}=require("../src/modules/vtf-engine"),f=fixture(),asset="materials/models/weapons/car/car_col.vtf",source=path.join(f.base,"skin",...asset.split("/"));
  fs.mkdirSync(path.dirname(source),{recursive:true});const bytes=Buffer.alloc(84);bytes.write("VTF\0",0,"ascii");bytes.writeUInt32LE(7,4);bytes.writeUInt32LE(2,8);bytes.writeUInt32LE(80,12);bytes.writeUInt16LE(1,16);bytes.writeUInt16LE(1,18);bytes.writeUInt16LE(1,24);bytes.writeInt32LE(0,52);bytes[56]=1;bytes.writeInt32LE(-1,57);bytes.writeUInt16LE(1,63);fs.writeFileSync(source,bytes);
  f.index([f.vpkEntry(asset,0)]);fs.writeFileSync(path.join(f.game,"vpk/client_mp_common.bsp.pak000_000.vpk"),"old!");
  const engine=new VtfEngine({baseDir:path.join(f.appRoot,"vtf"),isGameRunning:async()=>false});engine.externalGameLock=true;
  const pkg=await engine.inspect(path.join(f.base,"skin")),candidate=await f.guard.prepareCapture(f.game);let pendingObserved=false;
  const installed=await engine.install(f.game,pkg.id,{beforeWrite:async()=>{const status=await f.guard.status(f.game);assert.equal(status.pendingCount,1);await assert.rejects(f.guard.beforeLaunch(f.game),/未完成的皮肤安装/);pendingObserved=true;}});assert.equal(pendingObserved,true);
  await f.guard.commitCapture(f.game,candidate);assert.equal((await f.guard.status(f.game)).vtfCount,1);fs.writeFileSync(f.video,config("100","2","33"));assert.equal((await f.guard.beforeLaunch(f.game)).restored,true);assert.deepEqual(fs.readFileSync(f.video),config("600000","0","33"));
  await engine.restore(f.game,installed.backupId);assert.equal((await f.guard.status(f.game)).vtfCount,0);assert.equal((await f.guard.beforeLaunch(f.game)).state,"inactive");await engine.deleteBackup(f.game,installed.backupId);assert.equal((await f.guard.status(f.game)).activeCount,0);
  const beforeIndex=fs.readFileSync(path.join(f.game,"vpk",indexName));await assert.rejects(engine.install(f.game,pkg.id,{beforeWrite:async()=>{throw Error("fixture rejected pending write");}}),/fixture rejected pending write/);assert.equal((await engine.backups(f.game))[0].state,"rolled-back");assert.equal((await f.guard.status(f.game)).activeCount,0);assert.deepEqual(fs.readFileSync(path.join(f.game,"vpk",indexName)),beforeIndex);
});
test("disabled VTF-only protection never writes video configuration",async()=>{const f=fixture(),candidate=await f.guard.prepareCapture(f.game);f.vtf();f.index();await f.guard.commitCapture(f.game,candidate);await f.guard.setEnabled(f.game,false);const changed=config("10","3","88");fs.writeFileSync(f.video,changed);assert.equal((await f.guard.beforeLaunch(f.game)).state,"disabled");assert.deepEqual(fs.readFileSync(f.video),changed);});
test("existing DDS version-1 settings and captured values are reused when VTF is added",async()=>{
  const f=fixture();f.dds();await f.guard.capture(f.game);const before=fs.readFileSync(f.guard.stateFile(f.game));fs.writeFileSync(f.video,config("30","4"));const candidate=await f.guard.prepareCapture(f.game);assert.equal(candidate.reuse,true);f.vtf();f.index();await f.guard.commitCapture(f.game,candidate);assert.deepEqual(fs.readFileSync(f.guard.stateFile(f.game)),before);assert.equal((await f.guard.beforeLaunch(f.game)).restored,true);assert.deepEqual(fs.readFileSync(f.video),config());
});
test("unrecorded installed VTF returns a settings instruction without guessing compatible values",async()=>{const f=fixture();f.vtf();f.index();const before=fs.readFileSync(f.video),result=await f.guard.beforeLaunch(f.game);assert.equal(result.state,"unrecorded");assert.match(result.reason,/偏好设置/);assert.deepEqual(fs.readFileSync(f.video),before);});
test("a game starting during restoration cancels and preserves the entire original video bytes",async()=>{
  let checks=0;const f=fixture({running:async()=>++checks===2}),candidate=await f.guard.prepareCapture(f.game);f.vtf();f.index();await f.guard.commitCapture(f.game,candidate);const altered=config("100","2","99");fs.writeFileSync(f.video,altered);await assert.rejects(f.guard.beforeLaunch(f.game),/游戏已启动/);assert.deepEqual(fs.readFileSync(f.video),altered);assert.equal(fs.readdirSync(path.dirname(f.video)).some(name=>name.endsWith(".tmp")),false);
});
test("bad/missing/range-invalid video fields and malformed records never mutate configuration",async()=>{
  const f=fixture();f.vtf();f.index();await f.guard.capture(f.game);const malformed=config("4294967296","0");fs.writeFileSync(f.video,malformed);await assert.rejects(f.guard.beforeLaunch(f.game),/格式不正确/);assert.deepEqual(fs.readFileSync(f.video),malformed);assert.throws(()=>parseConfig(config("1","17")),/格式不正确/);
  const row=f.vtf("pending");row.value.archiveName="outside.vpk";f.json(row.directory,"manifest.json",row.value);assert.equal((await f.guard.status(f.game)).state,"error");await assert.rejects(f.guard.beforeLaunch(f.game));assert.deepEqual(fs.readFileSync(f.video),malformed);
});

test.after(() => {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("tfx-skin-protection-"));
  const stat = fs.lstatSync(root); assert(stat.isDirectory() && !stat.isSymbolicLink());
  fs.rmSync(root, {recursive: true, force: true});
});
