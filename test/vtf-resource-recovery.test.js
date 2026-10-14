"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fsp=fs.promises,path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const {VtfEngine,INDEX_NAME,archiveName}=require("../src/modules/vtf-engine");
const {serializeIndex,parseIndex,hash}=require("../src/modules/vtf-vpk");
const {SkinSwitchCoordinator}=require("../src/modules/skin-switch");
const info=bytes=>({size:bytes.length,chunks:[{offset:0,length:bytes.length,SHA1:crypto.createHash("sha1").update(bytes).digest("hex")}]});
async function fixture(t){
 const home=await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-vtf-resource-")));t.after(()=>fsp.rm(home,{recursive:true,force:true}));const game=path.join(home,"game"),vpk=path.join(game,"vpk"),source=path.join(home,"original/vpk");await fsp.mkdir(vpk,{recursive:true});await fsp.mkdir(source,{recursive:true});await fsp.writeFile(path.join(game,"Titanfall2.exe"),"fixture");
 const entries=[{path:"materials/models/weapons/car/car_col.vtf",index:0,crc:0,chunks:[{flags:0x101,textureFlags:0,offset:64,compressedSize:4,size:4}]}],index=serializeIndex(entries),archive=Buffer.alloc(256,7);for(const directory of [vpk,source]){await fsp.writeFile(path.join(directory,INDEX_NAME),index);await fsp.writeFile(path.join(directory,archiveName(0)),archive);}
 const manifest={SHA256:hash(Buffer.from("fixture-manifest")),files:new Map([["vpk/"+INDEX_NAME,info(index)],["vpk/"+archiveName(0),info(archive)]])},engine=new VtfEngine({baseDir:path.join(home,"vtf"),manifestProvider:async()=>manifest});engine.externalGameLock=true;await engine.initialize();
 const asset=path.join(home,"skin/materials/models/weapons/car/car_col.vtf");await fsp.mkdir(path.dirname(asset),{recursive:true});const skin=Buffer.alloc(84);skin.write("VTF\0",0);skin.writeUInt32LE(7,4);skin.writeUInt32LE(2,8);skin.writeUInt32LE(80,12);skin.writeUInt16LE(1,16);skin.writeUInt16LE(1,18);skin.writeUInt16LE(1,24);skin.writeInt32LE(0,52);skin[56]=1;skin.writeInt32LE(-1,57);skin.writeUInt16LE(1,63);skin.write("skin",80);await fsp.writeFile(asset,skin);const pkg=await engine.inspect(path.join(home,"skin"));
 return {home,game,vpk,source,index,archive,manifest,engine,pkg};
}
test("first-time VTF user can restore a missing index from original resources and install without prior backups",async t=>{
 const f=await fixture(t);await fsp.unlink(path.join(f.vpk,INDEX_NAME));assert.deepEqual(await f.engine.backups(f.game),[]);const before=await f.engine.gameStatus(f.game,f.pkg);assert.equal(before.ready,false);assert.equal(before.canRepair,false);assert.equal(before.canSteamRepair,true);assert.equal(before.issues[0].code,"missing");
 const repaired=await f.engine.repairResources(f.game,f.pkg.id,path.dirname(f.source));assert.equal(repaired.game.ready,true);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.index);const installed=await f.engine.install(f.game,f.pkg.id);assert.equal(installed.count,1);assert.equal((await f.engine.gameStatus(f.game)).ready,true);
});
test("missing VPK chunk is supplied with complete Steam verification before installation",async t=>{
 const f=await fixture(t);await fsp.unlink(path.join(f.vpk,archiveName(0)));const before=await f.engine.gameStatus(f.game,f.pkg);assert.equal(before.issues[0].target,"vpk/"+archiveName(0));await f.engine.repairResources(f.game,f.pkg.id,f.source);assert.deepEqual(await fsp.readFile(path.join(f.vpk,archiveName(0))),f.archive);assert.equal((await f.engine.install(f.game,f.pkg.id)).count,1);
});
test("chunk truncated beyond referenced skin extent still needs full original repair",async t=>{
 const f=await fixture(t);await fsp.truncate(path.join(f.vpk,archiveName(0)),128);const before=await f.engine.gameStatus(f.game);assert.equal(before.issues[0].code,"truncated");assert.equal(before.issues[0].requiredBytes,256);await f.engine.repairResources(f.game,f.pkg.id,f.source);assert.deepEqual(await fsp.readFile(path.join(f.vpk,archiveName(0))),f.archive);
});
test("missing entire VPK folder can be recreated after authentic index verification with sibling chunk files",async t=>{
 const f=await fixture(t);await fsp.rm(f.vpk,{recursive:true});const before=await f.engine.gameStatus(f.game);assert.equal(before.canSteamRepair,true);await f.engine.repairResources(f.game,f.pkg.id,path.join(f.source,INDEX_NAME));assert.equal((await f.engine.gameStatus(f.game)).ready,true);assert.deepEqual(await fsp.readFile(path.join(f.vpk,archiveName(0))),f.archive);
});
test("a corrupt selected chunk is rejected even when the skin reference range is intact",async t=>{
 const f=await fixture(t),file=path.join(f.vpk,archiveName(0)),source=path.join(f.source,archiveName(0)),bad=Buffer.from(f.archive);bad[240]=99;await fsp.writeFile(source,bad);await fsp.unlink(file);await assert.rejects(f.engine.repairResources(f.game,f.pkg.id,f.source),/完整校验/);await assert.rejects(fsp.stat(file),{code:"ENOENT"});assert.deepEqual(await fsp.readFile(source),bad);
});
test("an unknown resource cannot be fabricated without an official manifest or authenticated backup",async t=>{
 const f=await fixture(t);f.engine.resources.manifestProvider=async()=>null;await fsp.unlink(path.join(f.vpk,INDEX_NAME));const before=await f.engine.gameStatus(f.game);assert.equal(before.canSteamRepair,false);await assert.rejects(f.engine.repairResources(f.game,f.pkg.id,f.source),/原版资源/);await assert.rejects(fsp.stat(path.join(f.vpk,INDEX_NAME)),{code:"ENOENT"});
});
test("remembered original directory automatically repairs a later missing VTF chunk",async t=>{
 const f=await fixture(t);await f.engine.repairResources(f.game,f.pkg.id,f.source);await fsp.unlink(path.join(f.vpk,archiveName(0)));const before=await f.engine.gameStatus(f.game);assert.equal(before.canRepair,true);const installed=await f.engine.install(f.game,f.pkg.id);assert.equal(installed.count,1);assert.deepEqual(await fsp.readFile(path.join(f.vpk,archiveName(0))),f.archive);
});
test("verified owned after-index backup restores a missing index while preserving an existing installed skin",async t=>{
 const f=await fixture(t),installed=await f.engine.install(f.game,f.pkg.id),index=await fsp.readFile(path.join(f.vpk,INDEX_NAME)),archive=await fsp.readFile(path.join(f.vpk,installed.archive));await fsp.unlink(path.join(f.vpk,INDEX_NAME));const before=await f.engine.gameStatus(f.game);assert.equal(before.canRepair,true);await f.engine.repairResources(f.game,f.pkg.id);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),index);assert.deepEqual(await fsp.readFile(path.join(f.vpk,installed.archive)),archive);
});
test("missing managed skin archive is reported and never replaced with a fake stock archive",async t=>{
 const f=await fixture(t),installed=await f.engine.install(f.game,f.pkg.id),index=await fsp.readFile(path.join(f.vpk,INDEX_NAME));await fsp.unlink(path.join(f.vpk,installed.archive));const status=await f.engine.gameStatus(f.game);assert.equal(status.canRepair,false);assert.equal(status.canSteamRepair,true);assert.equal(status.issues[0].managed,true);await assert.rejects(f.engine.repairResources(f.game,f.pkg.id,f.source),/原版资源/);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),index);
});
test("shared index is detached before installation and linked peer remains exact",async t=>{
 const f=await fixture(t),peer=path.join(f.home,"index-peer.vpk");await fsp.link(path.join(f.vpk,INDEX_NAME),peer);const before=await f.engine.gameStatus(f.game);assert.equal(before.issues[0].code,"linked");assert.equal(before.canRepair,true);await f.engine.install(f.game,f.pkg.id);assert.deepEqual(await fsp.readFile(peer),f.index);assert.equal((await fsp.lstat(path.join(f.vpk,INDEX_NAME))).nlink,1);
});
test("linked VPK directory is never followed during recovery",async t=>{
 const f=await fixture(t),outside=path.join(f.home,"outside");await fsp.rename(f.vpk,outside);await fsp.symlink(outside,f.vpk,process.platform==="win32"?"junction":"dir");await assert.rejects(f.engine.repairResources(f.game,f.pkg.id,f.source),/链接/);assert.deepEqual(await fsp.readFile(path.join(outside,INDEX_NAME)),f.index);await fsp.unlink(f.vpk);
});
test("game opening during VTF resource copy prevents publication",async t=>{
 const f=await fixture(t);await fsp.unlink(path.join(f.vpk,INDEX_NAME));let running=false;f.engine.isGameRunning=async()=>running;f.engine.resources.copier.isGameRunning=async()=>running;f.engine.resources.copier.progress=()=>{running=true;};await assert.rejects(f.engine.repairResources(f.game,f.pkg.id,f.source),/游戏已启动/);await assert.rejects(fsp.stat(path.join(f.vpk,INDEX_NAME)),{code:"ENOENT"});assert.equal((await fsp.readdir(f.vpk)).filter(name=>name.startsWith(".tfx-resource-")).length,0);
});
test("low disk space leaves missing VTF resource untouched and imported skin reusable",async t=>{
 const f=await fixture(t);await fsp.unlink(path.join(f.vpk,INDEX_NAME));const statfs=fsp.statfs;fsp.statfs=async()=>({bavail:0n,bsize:4096n});try{await assert.rejects(f.engine.repairResources(f.game,f.pkg.id,f.source),/可用空间/);}finally{fsp.statfs=statfs;}assert(f.engine.packages.has(f.pkg.id));await assert.rejects(fsp.stat(path.join(f.vpk,INDEX_NAME)),{code:"ENOENT"});
});

test("cross-format coordinator repairs a remembered missing VTF index before reading old skin entries",async t=>{
 const f=await fixture(t);await f.engine.repairResources(f.game,f.pkg.id,f.source);await fsp.unlink(path.join(f.vpk,INDEX_NAME));
 const dds={baseDir:path.join(f.home,"dds"),isGameRunning:async()=>false,initialize:async()=>{await fsp.mkdir(path.join(f.home,"dds/backups"),{recursive:true});},install:async()=>{},restore:async()=>{}};
 const coordinator=new SkinSwitchCoordinator({dds,vtf:f.engine,baseDir:path.join(f.home,"switch"),acquireLock:async()=>async()=>{}});await coordinator.initialize();const installed=await coordinator.install("vtf",f.game,f.pkg.id);assert.equal(installed.count,1);assert.equal((await f.engine.gameStatus(f.game)).ready,true);assert.equal((await coordinator.transactions(f.game))[0].value.state,"installed");
});

test("truncated VTF index repairs from authenticated stock and preserves complete custom entries",async t=>{
 const f=await fixture(t),custom={path:"materials/models/weapons/car/custom_col.vtf",index:77,crc:0,chunks:[{flags:0x101,textureFlags:0,offset:0,compressedSize:84,size:84}]};
 const original=parseIndex(f.index).entries,full=serializeIndex([custom,...original]);await fsp.writeFile(path.join(f.vpk,archiveName(77)),Buffer.alloc(84,9));const damaged=full.subarray(0,full.length-20);await fsp.writeFile(path.join(f.vpk,INDEX_NAME),damaged);
 const result=await f.engine.repairResources(f.game,f.pkg.id,f.source);assert.equal(result.game.ready,true);const restored=parseIndex(await fsp.readFile(path.join(f.vpk,INDEX_NAME)));assert(restored.entries.some(entry=>entry.path===custom.path));assert(restored.entries.some(entry=>entry.path===original[0].path));assert.equal(result.repaired[0].preservedEntries,1);assert.deepEqual(await fsp.readFile(result.repaired[0].damagedIndexBackup),damaged);assert.deepEqual(await fsp.readFile(path.join(f.source,INDEX_NAME)),f.index);
});
test("truncated managed VTF index prefers verified installed snapshot and preserves its archive",async t=>{
 const f=await fixture(t),installed=await f.engine.install(f.game,f.pkg.id),full=await fsp.readFile(path.join(f.vpk,INDEX_NAME)),archive=await fsp.readFile(path.join(f.vpk,installed.archive));await fsp.truncate(path.join(f.vpk,INDEX_NAME),full.length-3);
 await f.engine.repairResources(f.game,f.pkg.id,f.source);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),full);assert.deepEqual(await fsp.readFile(path.join(f.vpk,installed.archive)),archive);
});
test("malformed VTF index is never guessed or overwritten by stock resource repair",async t=>{
 const f=await fixture(t),damaged=Buffer.from(f.index);damaged[0]=0;await fsp.writeFile(path.join(f.vpk,INDEX_NAME),damaged);await assert.rejects(f.engine.repairResources(f.game,f.pkg.id,f.source),/VPK/);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),damaged);
});

test("clean stock common index is automatically cached and reused after unknown legacy override",async t=>{
 const f=await fixture(t),initial=await f.engine.status(f.game,f.pkg.id);assert.equal(initial.original.complete,true);assert.equal(initial.original.bytes,f.index.length);const cached=initial.original.cachePath;
 const custom={path:"materials/models/weapons/car/custom_col.vtf",index:77,crc:0,chunks:[{flags:0x101,textureFlags:0,offset:0,compressedSize:84,size:84}]},elsewhere={...custom,path:"materials/models/weapons/r97/custom_col.vtf"};await fsp.writeFile(path.join(f.vpk,archiveName(77)),Buffer.alloc(84,9));await fsp.writeFile(path.join(f.vpk,INDEX_NAME),serializeIndex([custom,elsewhere,...parseIndex(f.index).entries]));
 const dds={baseDir:path.join(f.home,"dds"),isGameRunning:async()=>false,initialize:async()=>{await fsp.mkdir(path.join(f.home,"dds/backups"),{recursive:true});},install:async()=>{},restore:async()=>{}};
 const coordinator=new SkinSwitchCoordinator({dds,vtf:f.engine,baseDir:path.join(f.home,"switch"),acquireLock:async()=>async()=>{}}),plan=await coordinator.vpkPlan(f.game,["car"]),entries=parseIndex(plan.after).entries;
 assert(!entries.some(entry=>entry.path===custom.path));assert(entries.some(entry=>entry.path===elsewhere.path));assert(entries.some(entry=>entry.path===parseIndex(f.index).entries[0].path));assert.deepEqual(await fsp.readFile(cached),f.index);
});
test("original folder fills stock index cache for a healthy customized game without changing its live index",async t=>{
 const f=await fixture(t),entries=parseIndex(f.index).entries,modified=serializeIndex(entries.map(entry=>({...entry,raw:undefined,crc:123})));await fsp.writeFile(path.join(f.vpk,INDEX_NAME),modified);const before=await f.engine.status(f.game,f.pkg.id);assert.equal(before.game.ready,true);assert.equal(before.original.complete,false);
 const result=await f.engine.repairResources(f.game,f.pkg.id,f.source);assert.equal(result.original.complete,true);assert.equal(result.repaired.length,0);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),modified);assert.deepEqual(await fsp.readFile(result.original.cachePath),f.index);
});
test("legacy VTF override without an authentic stock index requests source instead of retaining old same-weapon entries",async t=>{
 const f=await fixture(t),entries=parseIndex(f.index).entries;await fsp.writeFile(path.join(f.vpk,INDEX_NAME),serializeIndex(entries.map(entry=>({...entry,raw:undefined,crc:123}))));const dds={baseDir:path.join(f.home,"dds"),isGameRunning:async()=>false,initialize:async()=>{},install:async()=>{},restore:async()=>{}};
 const coordinator=new SkinSwitchCoordinator({dds,vtf:f.engine,baseDir:path.join(f.home,"switch")});await assert.rejects(coordinator.vpkPlan(f.game,["car"]),/原版 VTF 资源索引/);
});
test("authenticated TFX before-index snapshot supplies stock cache after an earlier managed installation",async t=>{
 const f=await fixture(t),installed=await f.engine.install(f.game,f.pkg.id),modified=await fsp.readFile(path.join(f.vpk,INDEX_NAME));const result=await f.engine.originals.prepare(f.game);assert.equal(result.status.complete,true);assert.deepEqual(await fsp.readFile(result.status.cachePath),f.index);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),modified);assert.equal((await f.engine.backups(f.game))[0].id,installed.backupId);
});
test("corrupted stock VTF cache is automatically replaced from authenticated live originals",async t=>{
 const f=await fixture(t),initial=await f.engine.originals.prepare(f.game);await fsp.writeFile(initial.status.cachePath,Buffer.alloc(f.index.length));const before=await fsp.readFile(path.join(f.vpk,INDEX_NAME)),repaired=await f.engine.originals.prepare(f.game);assert.equal(repaired.status.complete,true);assert.deepEqual(await fsp.readFile(repaired.status.cachePath),f.index);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),before);
});

test("verified local original-index cache automatically restores a missing live index without downloading",async t=>{
 const f=await fixture(t),cached=await f.engine.originals.prepare(f.game);assert.equal(cached.status.complete,true);await fsp.unlink(path.join(f.vpk,INDEX_NAME));
 const status=await f.engine.gameStatus(f.game);assert.equal(status.canRepair,true);await f.engine.repairResources(f.game,f.pkg.id);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.index);assert.deepEqual(await fsp.readFile(cached.status.cachePath),f.index);
});
test("damaged VTF cache with customized live index requests a source and can be rebuilt from a selected original",async t=>{
 const f=await fixture(t),initial=await f.engine.originals.prepare(f.game);await fsp.writeFile(initial.status.cachePath,Buffer.alloc(f.index.length));const modified=serializeIndex(parseIndex(f.index).entries.map(entry=>({...entry,raw:undefined,crc:123})));await fsp.writeFile(path.join(f.vpk,INDEX_NAME),modified);const unavailable=await f.engine.originals.prepare(f.game);assert.equal(unavailable.status.state,"needs-source");assert.equal(unavailable.status.canSteamRepair,true);assert.equal(unavailable.entries,null);const repaired=await f.engine.originals.prepare(f.game,f.source);assert.equal(repaired.status.complete,true);assert.deepEqual(await fsp.readFile(repaired.status.cachePath),f.index);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),modified);
});
test("an old VTF manifest cache is rebuilt only after authenticating the current version",async t=>{
 const f=await fixture(t),initial=await f.engine.originals.prepare(f.game);f.manifest.SHA256=hash(Buffer.from("new-version"));const rebuilt=await f.engine.originals.prepare(f.game);assert.equal(rebuilt.status.complete,true);const meta=JSON.parse(await fsp.readFile(path.join(path.dirname(initial.status.cachePath),"index.json"),"utf8"));assert.equal(meta.manifestSHA256,f.manifest.SHA256);const wrong=Buffer.from(f.index);wrong[wrong.length-2]=1;f.manifest.files.set("vpk/"+INDEX_NAME,info(wrong));assert.equal((await f.engine.originals.prepare(f.game)).status.state,"needs-source");
});
test("damaged VTF cache can rebuild from a genuine prior before-index while live skin remains installed",async t=>{
 const f=await fixture(t),initial=await f.engine.originals.prepare(f.game),installed=await f.engine.install(f.game,f.pkg.id),live=await fsp.readFile(path.join(f.vpk,INDEX_NAME));await fsp.writeFile(initial.status.cachePath,Buffer.alloc(f.index.length));const rebuilt=await f.engine.originals.prepare(f.game);assert.equal(rebuilt.status.complete,true);assert.deepEqual(await fsp.readFile(rebuilt.status.cachePath),f.index);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),live);assert.equal((await f.engine.backups(f.game))[0].id,installed.backupId);
});

test("empty or authenticated partial VTF index headers can be completed from original resources",async t=>{
 for(const length of [0,8]){const f=await fixture(t);await fsp.writeFile(path.join(f.vpk,INDEX_NAME),f.index.subarray(0,length));const result=await f.engine.repairResources(f.game,f.pkg.id,f.source);assert.equal(result.game.ready,true);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.index);}
});
test("unknown partial VTF index header is rejected without replacing its bytes",async t=>{
 const f=await fixture(t),bytes=Buffer.from("wrong");await fsp.writeFile(path.join(f.vpk,INDEX_NAME),bytes);await assert.rejects(f.engine.repairResources(f.game,f.pkg.id,f.source),/索引头/);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),bytes);
});
