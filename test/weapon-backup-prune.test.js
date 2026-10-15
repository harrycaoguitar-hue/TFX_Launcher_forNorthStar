"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fsp=fs.promises,path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const {DdsEngine}=require("../src/modules/dds-engine");
const {VtfEngine,INDEX_NAME,archiveName}=require("../src/modules/vtf-engine");
const {SkinSwitchCoordinator}=require("../src/modules/skin-switch");
const {serializeIndex,hash}=require("../src/modules/vtf-vpk");
const {pruneUnlinkedBackups,references}=require("../src/modules/weapon-backup-prune");
async function fixture(t){
 const home=await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-prune-test-")));
 t.after(async()=>{assert.equal(path.dirname(home),await fsp.realpath(os.tmpdir()));assert(path.basename(home).startsWith("tfx-prune-test-"));await fsp.rm(home,{recursive:true,force:true});});
 const root=path.join(home,"game"),paks=path.join(root,"r2/paks/Win64"),vpk=path.join(root,"vpk");
 await fsp.mkdir(paks,{recursive:true});await fsp.mkdir(vpk);await fsp.writeFile(path.join(root,"Titanfall2.exe"),"game sentinel");
 const starpak=path.join(paks,"pc_stream.starpak"),data=Buffer.alloc(128);Buffer.from("original").copy(data,32);await fsp.writeFile(starpak,data);
 const index=serializeIndex([{path:"materials/models/weapons/car/car_col.vtf",index:0,crc:0,chunks:[{flags:0x101,textureFlags:0,offset:0,compressedSize:4,size:4}]}]);
 await fsp.writeFile(path.join(vpk,INDEX_NAME),index);await fsp.writeFile(path.join(vpk,archiveName(0)),"base");
 const dds=new DdsEngine({baseDir:path.join(home,"dds")}),vtf=new VtfEngine({baseDir:path.join(home,"vtf"),toolsDir:home});dds.isGameRunning=async()=>false;vtf.isGameRunning=async()=>false;
 const coordinator=new SkinSwitchCoordinator({dds,vtf,baseDir:path.join(home,"switch"),acquireLock:async()=>async()=>{}});await coordinator.initialize();
 return {home,root,dds,vtf,coordinator,starpak,index};
}
async function ddsBackup(f,state,extra={}){
 const id=crypto.randomUUID(),dir=path.join(f.dds.baseDir,"backups",id),manifest={version:1,id,name:"Skin 1234",gamePath:f.root,createdAt:new Date().toISOString(),state,records:[{target:"pc_stream.starpak",offset:32,length:8,beforeHash:hash(Buffer.from("original")),afterHash:hash(Buffer.from("skinxxxx"))}],...extra};
 await fsp.mkdir(dir);await fsp.writeFile(path.join(dir,"manifest.json"),JSON.stringify(manifest));await fsp.writeFile(path.join(dir,"0.before.bin"),"original");await fsp.writeFile(path.join(dir,"0.after.bin"),"skinxxxx");return {id,dir,manifest};
}
async function vtfBackup(f,state,archiveIndex=41){
 const id=crypto.randomUUID(),dir=path.join(f.vtf.baseDir,"backups",id),manifest={version:1,id,name:"Skin 2345",gamePath:f.root,createdAt:new Date().toISOString(),state,indexName:INDEX_NAME,beforeHash:hash(f.index),afterHash:hash(f.index),archiveIndex,archiveName:archiveName(archiveIndex),stageArchive:`.vyra-vtf-${id}.archive.tmp`,stageIndex:`.vyra-vtf-${id}.index.tmp`,files:[]};
 await fsp.mkdir(dir);await fsp.writeFile(path.join(dir,"manifest.json"),JSON.stringify(manifest));await fsp.writeFile(path.join(dir,"before-index.vpk"),f.index);await fsp.writeFile(path.join(dir,"after-index.vpk"),f.index);return {id,dir,manifest};
}
async function transaction(f,target){
 const id=crypto.randomUUID(),dir=path.join(f.coordinator.baseDir,id),manifest={version:1,id,name:"Skin state",gamePath:f.root,createdAt:new Date().toISOString(),state:"restored",format:"dds",incomingBackupId:target,ranges:[],weapons:["car"]};
 await fsp.mkdir(dir);await fsp.writeFile(path.join(dir,"transaction.json"),JSON.stringify(manifest));return {dir,manifest};
}
const exists=file=>fsp.access(file).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;});
const prune=(f,options={})=>f.coordinator.locked(f.root,root=>pruneUnlinkedBackups({coordinator:f.coordinator,gamePath:root,...options}));
test("unlinked cancelled and rolled-back DDS imports are deleted without changing game bytes",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled"),b=await ddsBackup(f,"rolled-back"),before=await fsp.readFile(f.starpak);const result=await prune(f);
 assert.deepEqual(new Set(result.deleted.map(r=>r.id)),new Set(["dds:"+a.id,"dds:"+b.id]));assert.equal(result.gameFilesRemoved,0);assert.equal(result.files,6);assert.ok(result.bytes>32);assert.equal(await exists(a.dir),false);assert.equal(await exists(b.dir),false);assert.deepEqual(await fsp.readFile(f.starpak),before);
});
test("installed and restored skin history is retained even without a transaction link",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"installed"),b=await ddsBackup(f,"restored"),v=await vtfBackup(f,"restored");const result=await prune(f);
 assert.equal(result.deleted.length,0);assert.equal(result.skipped.length,3);assert(result.skipped.every(r=>r.reason==="history-preserved"));for(const r of [a,b,v])assert.equal(await exists(r.dir),true);
});
test("a reference from transaction metadata protects a terminal backup",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled");await transaction(f,a.id);const result=await prune(f);
 assert.deepEqual(result.skipped,[{id:"dds:"+a.id,reason:"referenced"}]);assert.equal(await exists(a.dir),true);
});
test("reference scanner follows state graph target/parent ids and excludes record identity",()=>{
 const own=crypto.randomUUID(),target=crypto.randomUUID(),parent=crypto.randomUUID();assert.deepEqual(references({id:own,targetRecordId:"vtf:"+target,parents:{car:"dds:"+parent}}),new Set([target,parent]));
});
test("DDS bytes still used by the game protect a misleading terminal record",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled"),handle=await fsp.open(f.starpak,"r+");try{await handle.write(Buffer.from("skinxxxx"),0,8,32);}finally{await handle.close();}
 const result=await prune(f);assert.deepEqual(result.skipped,[{id:"dds:"+a.id,reason:"live-resource"}]);assert.equal(await exists(a.dir),true);
});
test("unreadable DDS live range is kept rather than assumed detached",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled");await fsp.unlink(f.starpak);const result=await prune(f);assert.deepEqual(result.skipped,[{id:"dds:"+a.id,reason:"live-resource-unverified"}]);assert.equal(await exists(a.dir),true);
});
test("VTF prune keeps used archive indexes and never removes game archives",async t=>{
 const f=await fixture(t),used=await vtfBackup(f,"cancelled",0),unused=await vtfBackup(f,"rolled-back",41),archive=path.join(f.root,"vpk",archiveName(41));await fsp.writeFile(archive,"do not remove game file");const result=await prune(f);
 assert.deepEqual(result.deleted.map(r=>r.id),["vtf:"+unused.id]);assert.deepEqual(result.skipped,[{id:"vtf:"+used.id,reason:"live-resource"}]);assert.equal(await fsp.readFile(archive,"utf8"),"do not remove game file");assert.equal(await exists(used.dir),true);
});
test("invalid live VTF index preserves terminal backups",async t=>{
 const f=await fixture(t),a=await vtfBackup(f,"cancelled");await fsp.writeFile(path.join(f.root,"vpk",INDEX_NAME),"invalid");const result=await prune(f);assert.deepEqual(result.skipped,[{id:"vtf:"+a.id,reason:"live-resource-unverified"}]);assert.equal(await exists(a.dir),true);
});
test("records for another game are untouched",async t=>{
 const f=await fixture(t),other=path.join(f.home,"other-game");await fsp.mkdir(other);const a=await ddsBackup(f,"cancelled",{gamePath:other});const result=await prune(f);assert.equal(result.deleted.length,0);assert.equal(result.skipped.length,0);assert.equal(await exists(a.dir),true);
});
test("the full removal set is preflighted before any orphan is deleted",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled"),b=await ddsBackup(f,"cancelled"),outside=path.join(f.home,"outside");await fsp.mkdir(outside);await fsp.writeFile(path.join(outside,"sentinel"),"keep");const link=path.join(b.dir,"linked");await fsp.symlink(outside,link,process.platform==="win32"?"junction":"dir");
 await assert.rejects(prune(f),/包含链接/);assert.equal(await exists(a.dir),true);assert.equal(await exists(b.dir),true);assert.equal(await fsp.readFile(path.join(outside,"sentinel"),"utf8"),"keep");await fsp.unlink(link);
});
test("corrupt metadata aborts the complete cleanup without deleting earlier candidates",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled"),b=await vtfBackup(f,"cancelled");await fsp.writeFile(path.join(b.dir,"manifest.json"),"{bad json");await assert.rejects(prune(f),/记录无效/);assert.equal(await exists(a.dir),true);assert.equal(await exists(b.dir),true);
});
test("discarded terminal payload corruption is disposable only after identity and live usage checks",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled");await fsp.writeFile(path.join(a.dir,"0.before.bin"),"damaged abandoned import");const before=await fsp.readFile(f.starpak),result=await prune(f);assert.equal(result.deleted[0].id,"dds:"+a.id);assert.deepEqual(await fsp.readFile(f.starpak),before);
});
test("cleanup rejects stale context, pending imports and unlocked calls",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled");await assert.rejects(pruneUnlinkedBackups({coordinator:f.coordinator,gamePath:f.root}),/LOCK_REQUIRED/);await assert.rejects(prune(f,{stillCurrent:()=>false}),/STALE_WEAPON_LIBRARY/);const pending=await ddsBackup(f,"pending");await assert.rejects(prune(f),/WEAPON_BACKUP_PENDING/);assert.equal(await exists(a.dir),true);assert.equal(await exists(pending.dir),true);
});
test("game start during preflight stops deletion",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled");let checks=0;f.dds.isGameRunning=async()=>++checks>=3;await assert.rejects(prune(f),/GAME_RUNNING/);assert.equal(await exists(a.dir),true);
});
test("new metadata references appearing during preflight abort deletion",async t=>{
 const f=await fixture(t),a=await ddsBackup(f,"cancelled"),original=f.coordinator.transactions.bind(f.coordinator);let reads=0;f.coordinator.transactions=async root=>{if(++reads===3)await transaction(f,a.id);return original(root);};
 await assert.rejects(prune(f),/WEAPON_BACKUP_PRUNE_CHANGED/);assert.equal(await exists(a.dir),true);
});
