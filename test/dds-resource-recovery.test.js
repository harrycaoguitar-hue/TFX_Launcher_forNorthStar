"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fsp=fs.promises,path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const {DdsEngine,readRange,writeRange}=require("../src/modules/dds-engine");
const {verifyComplete}=require("../src/modules/dds-resource-recovery");
const {SkinSwitchCoordinator}=require("../src/modules/skin-switch");
const sha=(bytes,algorithm="sha256")=>crypto.createHash(algorithm).update(bytes).digest("hex");
async function fixture(t){
  const home=await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-resource-recovery-"));
  t.after(async()=>{for(const file of [path.join(home,"game/r2/paks/Win64/pc_stream.starpak"),path.join(home,"peer.starpak")])await fsp.chmod(file,0o600).catch(()=>{});await fsp.rm(home,{recursive:true,force:true});});
  const game=path.join(home,"game"),directory=path.join(game,"r2/paks/Win64"),target=path.join(directory,"pc_stream.starpak"),bytes=Buffer.alloc(256,7),row={target:"pc_stream.starpak",offset:64,length:4,name:"car_default_col.dds",width:256,height:256,skip:0};
  await fsp.mkdir(directory,{recursive:true});await fsp.writeFile(path.join(game,"Titanfall2.exe"),"fixture");await fsp.writeFile(target,bytes);
  const info={size:bytes.length,chunks:[{offset:0,length:128,SHA1:sha(bytes.subarray(0,128),"sha1")},{offset:128,length:128,SHA1:sha(bytes.subarray(128),"sha1")}]},manifest={SHA256:sha(Buffer.from("fixture-manifest")),files:new Map([["r2/paks/win64/pc_stream.starpak",info]])};
  const engine=new DdsEngine({baseDir:path.join(home,"dds"),manifestProvider:async()=>manifest});
  await engine.initialize();const dir=path.join(engine.baseDir,"packages/fixture"),source=path.join(dir,row.name),incoming=Buffer.from("new!");await fsp.mkdir(dir,{recursive:true});await fsp.writeFile(source,incoming);
  engine.packages.set("fixture",{id:"fixture",name:"CAR fixture",dir,files:[{...row,path:source,sha256:sha(incoming)}],count:1,bytes:4});engine.originals.prepare=async()=>({status:{complete:true,canSteamRepair:true},originals:new Map()});
  return {home,game,directory,target,bytes,row,info,manifest,engine};
}

test("a linked resource is detached before DDS install and peer bytes stay exact",async t=>{
  const f=await fixture(t),peer=path.join(f.home,"peer.starpak");await fsp.link(f.target,peer);
  const before=await f.engine.gameStatus(f.game,f.engine.packages.get("fixture"));assert.equal(before.ready,false);assert.equal(before.canRepair,true);assert.equal(before.issues[0].code,"linked");
  const installed=await f.engine.install(f.game,"fixture");assert(installed.backupId);assert.equal((await fsp.lstat(f.target)).nlink,1);assert.notEqual((await fsp.lstat(f.target)).ino,(await fsp.lstat(peer)).ino);assert.deepEqual(await fsp.readFile(peer),f.bytes);assert.equal((await readRange(f.target,64,4)).toString(),"new!");
  await f.engine.restore(f.game,installed.backupId);assert.deepEqual(await fsp.readFile(f.target),f.bytes);assert.deepEqual(await fsp.readFile(peer),f.bytes);
});

test("missing container can be supplied from a complete current Steam-verified source",async t=>{
  const f=await fixture(t),source=path.join(f.home,"pc_stream.starpak");await fsp.writeFile(source,f.bytes);await fsp.unlink(f.target);
  const before=await f.engine.gameStatus(f.game,f.engine.packages.get("fixture"));assert.equal(before.issues[0].code,"missing");assert.equal(before.canSteamRepair,true);assert.equal(before.canRepair,false);
  const repaired=await f.engine.repairResources(f.game,"fixture",source);assert.equal(repaired.game.ready,true);assert.equal(repaired.repaired[0].SHA256,sha(f.bytes));assert.deepEqual(await fsp.readFile(f.target),f.bytes);
  await f.engine.install(f.game,"fixture");assert.equal((await readRange(f.target,64,4)).toString(),"new!");
});

test("importing original resources repairs a truncated container before preparing skin originals",async t=>{
  const f=await fixture(t),source=path.join(f.home,"pc_stream.starpak");await fsp.writeFile(source,f.bytes);await fsp.truncate(f.target,32);let originalPrepared=false;
  f.engine.originals.prepare=async()=>{originalPrepared=true;assert.deepEqual(await fsp.readFile(f.target),f.bytes);return {status:{complete:true},originals:new Map()};};
  await f.engine.importOriginals(f.game,"fixture",source);assert.equal(originalPrepared,true);assert.equal((await fsp.lstat(f.target)).nlink,1);
});

test("truncation after the incoming DDS range still requires complete original resource repair",async t=>{
  const f=await fixture(t),source=path.join(f.home,"pc_stream.starpak");await fsp.writeFile(source,f.bytes);await fsp.truncate(f.target,128);
  const status=await f.engine.gameStatus(f.game,f.engine.packages.get("fixture"));assert.equal(status.ready,false);assert.equal(status.issues[0].code,"truncated");assert.equal(status.issues[0].requiredBytes,256);
  await f.engine.repairResources(f.game,"fixture",source);assert.deepEqual(await fsp.readFile(f.target),f.bytes);await f.engine.install(f.game,"fixture");assert.equal((await readRange(f.target,64,4)).toString(),"new!");
});

test("automatic recovery finds a previously selected original source and revalidates all bytes",async t=>{
  const f=await fixture(t),source=path.join(f.home,"pc_stream.starpak"),folder=f.engine.originals.folder(f.game);await fsp.writeFile(source,f.bytes);await fsp.mkdir(folder,{recursive:true});await fsp.writeFile(path.join(folder,"a".repeat(64)+".json"),JSON.stringify({target:f.row.target,source}));await fsp.unlink(f.target);
  const game=await f.engine.gameStatus(f.game,f.engine.packages.get("fixture"));assert.equal(game.canRepair,true);
  await f.engine.install(f.game,"fixture");assert.equal((await readRange(f.target,64,4)).toString(),"new!");assert.deepEqual(await fsp.readFile(source),f.bytes);
});

test("a source with valid DDS range but corruption elsewhere never fills a missing container",async t=>{
  const f=await fixture(t),source=path.join(f.home,"pc_stream.starpak"),corrupt=Buffer.from(f.bytes);corrupt[240]=99;await fsp.writeFile(source,corrupt);await fsp.unlink(f.target);
  await assert.rejects(f.engine.repairResources(f.game,"fixture",source),/完整校验/);await assert.rejects(fsp.stat(f.target),{code:"ENOENT"});assert.deepEqual(await fsp.readFile(source),corrupt);
});

test("gapped manifests and path links do not authenticate a complete original",async t=>{
  const f=await fixture(t);await assert.rejects(verifyComplete(f.target,{size:256,chunks:[f.info.chunks[1]]}),/覆盖整个/);
  const alias=path.join(f.home,"alias.starpak");await fsp.symlink(f.target,alias,"file");await assert.rejects(verifyComplete(alias,f.info),/链接/);await fsp.unlink(alias);
});

test("read-only attribute is repaired without copying or changing resource bytes",async t=>{
  const f=await fixture(t);await fsp.chmod(f.target,0o444);const inode=(await fsp.lstat(f.target)).ino;
  const status=await f.engine.gameStatus(f.game,f.engine.packages.get("fixture"));assert.equal(status.issues[0].code,"unwritable");
  const repair=await f.engine.repairResources(f.game,"fixture");assert.equal(repair.game.ready,true);assert.equal(repair.repaired[0].bytes,0);assert.equal((await fsp.lstat(f.target)).ino,inode);assert.deepEqual(await fsp.readFile(f.target),f.bytes);
});

test("detaching a read-only hard link restores its peer attribute and preserves bytes",async t=>{
  const f=await fixture(t),peer=path.join(f.home,"peer.starpak");await fsp.link(f.target,peer);await fsp.chmod(f.target,0o444);
  await f.engine.repairResources(f.game,"fixture");assert.equal((await fsp.lstat(f.target)).nlink,1);assert.equal((await fsp.lstat(f.target)).mode&0o200,0o200);assert.equal((await fsp.lstat(peer)).mode&0o200,0);assert.deepEqual(await fsp.readFile(peer),f.bytes);assert.deepEqual(await fsp.readFile(f.target),f.bytes);
});

test("a game opening during the private copy cancels publication and preserves both links",async t=>{
  const f=await fixture(t),peer=path.join(f.home,"peer.starpak");await fsp.link(f.target,peer);let running=false;f.engine.resources.isGameRunning=async()=>running;f.engine.resources.progress=()=>{running=true;};
  await assert.rejects(f.engine.repairResources(f.game,"fixture"),/游戏已启动/);assert.equal((await fsp.lstat(f.target)).ino,(await fsp.lstat(peer)).ino);assert.deepEqual(await fsp.readFile(f.target),f.bytes);assert.deepEqual(await fsp.readdir(f.directory),["pc_stream.starpak"]);
});

test("low disk space preserves the original resource",async t=>{
  const f=await fixture(t),peer=path.join(f.home,"peer.starpak");await fsp.link(f.target,peer);const statfs=fsp.statfs;fsp.statfs=async()=>({bavail:0n,bsize:4096n});
  try{await assert.rejects(f.engine.repairResources(f.game,"fixture"),/可用空间/);}finally{fsp.statfs=statfs;}
  assert.deepEqual(await fsp.readFile(f.target),f.bytes);assert.equal((await fsp.lstat(f.target)).ino,(await fsp.lstat(peer)).ino);
});

test("corrupted private copy is rejected before replacing the shared live file",async t=>{
  const f=await fixture(t),peer=path.join(f.home,"peer.starpak");await fsp.link(f.target,peer);
  f.engine.resources.progress=event=>{if(event.percent===85){const temporary=fs.readdirSync(f.directory).find(name=>name.startsWith(".tfx-resource-")&&name.endsWith(".tmp"));const handle=fs.openSync(path.join(f.directory,temporary),"r+");fs.writeSync(handle,Buffer.from([99]),0,1,240);fs.closeSync(handle);}};
  await assert.rejects(f.engine.repairResources(f.game,"fixture"),/副本校验失败/);assert.equal((await fsp.lstat(f.target)).ino,(await fsp.lstat(peer)).ino);assert.deepEqual(await fsp.readFile(f.target),f.bytes);assert.deepEqual(await fsp.readdir(f.directory),["pc_stream.starpak"]);
});

test("omitted skin rows in another shared container are repaired before baseline reads",async t=>{
  const f=await fixture(t),target=path.join(f.directory,"pc_stream(03).starpak"),peer=path.join(f.home,"peer.starpak");await fsp.writeFile(target,f.bytes);await fsp.link(target,peer);
  const original={...f.row,name:"car_default_ao.dds",target:"pc_stream(03).starpak",bytes:f.bytes.subarray(64,68)};
  f.engine.originals.prepare=async()=>({status:{complete:true},originals:new Map([["pc_stream(03).starpak|64|4",original]])});
  const result=await f.engine.install(f.game,"fixture");assert.equal(result.resetCount,1);assert.equal((await fsp.lstat(target)).nlink,1);assert.deepEqual(await fsp.readFile(peer),f.bytes);
});

test("range writer continues rejecting shared files until private recovery completes",async t=>{
  const f=await fixture(t),peer=path.join(f.home,"peer.starpak");await fsp.link(f.target,peer);await assert.rejects(writeRange(f.target,64,Buffer.from("bad!")),/链接/);assert.deepEqual(await fsp.readFile(peer),f.bytes);
});

test("DDS cleanup for a following VTF skin detaches only required shared resource files",async t=>{
  const f=await fixture(t);await f.engine.install(f.game,"fixture");const peer=path.join(f.home,"peer.starpak");await fsp.link(f.target,peer);const installedBytes=await fsp.readFile(peer);
  const vtf={baseDir:path.join(f.home,"vtf"),initialize:async()=>{},install:async()=>{},restore:async()=>{}};
  const coordinator=new SkinSwitchCoordinator({dds:f.engine,vtf,baseDir:path.join(f.home,"switch"),originalProvider:async({files})=>new Map(files.map(row=>[[row.target,row.offset,row.length].join("|"),{...row,bytes:f.bytes.subarray(row.offset,row.offset+row.length)}]))});
  const rows=await coordinator.ddsPlan(f.game,["car"],path.join(f.home,"switch-fixture"));assert.equal(rows.length,1);assert.equal(rows[0].before.toString(),"new!");assert.deepEqual(rows[0].after,f.bytes.subarray(64,68));assert.notEqual((await fsp.lstat(f.target)).ino,(await fsp.lstat(peer)).ino);assert.deepEqual(await fsp.readFile(peer),installedBytes);
});

test("verified source cancellation stops before publication",async t=>{
 const f=await fixture(t),file=f.target,controller=new AbortController();controller.abort();await assert.rejects(verifyComplete(file,f.info,{signal:controller.signal}),error=>error.code==="CANCELLED");
});

test("source verification can cancel between authenticated chunks",async t=>{
 const f=await fixture(t);let reads=0;const signal={get aborted(){return ++reads>=3;}};await assert.rejects(verifyComplete(f.target,f.info,{signal}),error=>error.code==="CANCELLED");assert.deepEqual(await fsp.readFile(f.target),f.bytes);
});
