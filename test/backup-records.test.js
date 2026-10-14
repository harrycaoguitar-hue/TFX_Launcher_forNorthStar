"use strict";
const os = require("node:os");
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fsp=fs.promises,path=require("node:path"),crypto=require("node:crypto");
const {deletionPolicy,readBackupManifest,removeBackupDirectory,ddsBoundaryRequired}=require("../src/modules/backup-records");
const {DdsEngine}=require("../src/modules/dds-engine");
const {VtfEngine,archiveName,INDEX_NAME}=require("../src/modules/vtf-engine");
const {SkinSwitchCoordinator}=require("../src/modules/skin-switch");
const gate=require("../src/modules/dds-operation-gate");
const hash=data=>crypto.createHash("sha256").update(data).digest("hex");
const identity=()=>crypto.randomUUID();
async function fixture(t){
 const home=await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-backup-delete-test-"));
 t.after(()=>{assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert(path.basename(home).startsWith("tfx-backup-delete-test-"));return fsp.rm(home,{recursive:true,force:true});});
 const root=path.join(home,"game");await fsp.mkdir(root);await fsp.writeFile(path.join(root,"Titanfall2.exe"),"game sentinel");
 const dds=new DdsEngine({baseDir:path.join(home,"dds")}),vtf=new VtfEngine({baseDir:path.join(home,"vtf"),toolsDir:home});vtf.externalGameLock=true;
 let locks=0,releases=0;
 const coordinator=new SkinSwitchCoordinator({dds,vtf,baseDir:path.join(home,"switch"),acquireLock:async()=>{locks++;return async()=>{releases++;};}});
 await coordinator.initialize();
 return {home,root,dds,vtf,coordinator,locks:()=>locks,releases:()=>releases};
}
function record(createdAt="2026-10-14T00:00:00.000Z",originalReset=false){const before=Buffer.from("original"),after=Buffer.from("skinxxxx");return {target:"pc_stream.starpak",offset:32,length:8,beforeHash:hash(before),afterHash:hash(after),...(originalReset?{originalReset:true}:{})};}
async function ddsBackup(f,state,options={}){
 const id=identity(),dir=path.join(f.dds.baseDir,"backups",id),manifest={version:1,id,name:"DDS fixture",gamePath:f.root,createdAt:options.createdAt||"2026-10-14T00:00:00.000Z",state,records:[record(undefined,options.originalReset)],...options};
 await fsp.mkdir(dir);await fsp.writeFile(path.join(dir,"manifest.json"),JSON.stringify(manifest));await fsp.writeFile(path.join(dir,"0.before.bin"),"original");await fsp.writeFile(path.join(dir,"0.after.bin"),"skinxxxx");return {id,dir,manifest};
}
async function vtfBackup(f,state){
 const id=identity(),dir=path.join(f.vtf.baseDir,"backups",id),manifest={version:1,id,name:"VTF fixture",gamePath:f.root,createdAt:"2026-10-14T00:00:00.000Z",state,indexName:INDEX_NAME,beforeHash:hash("index before"),afterHash:hash("index after"),archiveIndex:41,archiveName:archiveName(41),stageArchive:`.vyra-vtf-${id}.archive.tmp`,stageIndex:`.vyra-vtf-${id}.index.tmp`,files:[]};
 await fsp.mkdir(dir);await fsp.writeFile(path.join(dir,"manifest.json"),JSON.stringify(manifest));await fsp.writeFile(path.join(dir,"before-index.vpk"),"index before");await fsp.writeFile(path.join(dir,"after-index.vpk"),"index after");return {id,dir,manifest};
}
async function transaction(f,state,format,incomingBackupId){
 const id=identity(),dir=path.join(f.coordinator.baseDir,id),value={version:1,id,name:"Cross fixture",gamePath:f.root,createdAt:"2026-10-14T01:00:00.000Z",state,format,incomingBackupId,ranges:[],weapons:["car"]};
 await fsp.mkdir(dir);await fsp.writeFile(path.join(dir,"transaction.json"),JSON.stringify(value));await fsp.writeFile(path.join(dir,"before-index.vpk"),"transaction history");return {id,dir,value};
}
async function exists(file){try{await fsp.access(file);return true;}catch(error){if(error.code==="ENOENT")return false;throw error;}}

test("only terminal recovery states can be deleted",()=>{
 for(const state of ["installed","cross-installed","preparing","pending","restoring","recovery-required","error",undefined])assert.equal(deletionPolicy({state}).canDelete,false);
 for(const state of ["restored","rolled-back","cancelled"])assert.equal(deletionPolicy({state}).canDelete,true);
 assert.equal(deletionPolicy({state:"restored"},{referenced:true}).canDelete,false);
});

test("DDS restored backup removal releases payloads and leaves game bytes untouched",async t=>{
 const f=await fixture(t),backup=await ddsBackup(f,"restored"),before=await fsp.readFile(path.join(f.root,"Titanfall2.exe"));
 assert.equal((await f.dds.backups(f.root))[0].canDelete,true);
 const result=await f.dds.deleteBackup(f.root,backup.id);assert.equal(result.deleted,true);assert.equal(result.files,3);assert.ok(result.bytes>16);assert.equal(await exists(backup.dir),false);assert.deepEqual(await fsp.readFile(path.join(f.root,"Titanfall2.exe")),before);
});

test("DDS rolled-back and cancelled records can be removed",async t=>{
 const f=await fixture(t);
 for(const state of ["rolled-back","cancelled"]){const backup=await ddsBackup(f,state);await f.dds.deleteBackup(f.root,backup.id);assert.equal(await exists(backup.dir),false);}
});

test("DDS installed and interrupted records remain intact after rejected deletion",async t=>{
 const f=await fixture(t);
 for(const state of ["installed","pending","preparing"]){const backup=await ddsBackup(f,state),bytes=await fsp.readFile(path.join(backup.dir,"manifest.json"));await assert.rejects(f.dds.deleteBackup(f.root,backup.id),/先恢复皮肤/);assert.deepEqual(await fsp.readFile(path.join(backup.dir,"manifest.json")),bytes);assert.equal(await exists(path.join(backup.dir,"0.before.bin")),true);}
});

test("restored DDS original-reset boundary protects older installed chains",async t=>{
 const f=await fixture(t);await ddsBackup(f,"installed",{createdAt:"2026-10-14T00:00:00.000Z"});const boundary=await ddsBackup(f,"restored",{createdAt:"2026-10-14T01:00:00.000Z",originalReset:true});
 const row=(await f.dds.backups(f.root)).find(item=>item.id===boundary.id);assert.equal(row.canDelete,false);assert.match(row.deleteReason,/原版皮肤边界/);
 await assert.rejects(f.dds.deleteBackup(f.root,boundary.id),/原版皮肤边界/);assert.equal(await exists(boundary.dir),true);
});

test("restored original-reset record without an older installed chain is removable",async t=>{
 const f=await fixture(t),boundary=await ddsBackup(f,"restored",{originalReset:true});assert.equal(ddsBoundaryRequired({manifest:boundary.manifest},[{manifest:boundary.manifest}]),false);await f.dds.deleteBackup(f.root,boundary.id);assert.equal(await exists(boundary.dir),false);
});

test("VTF terminal records delete backup files while preserving live archive",async t=>{
 const f=await fixture(t);await fsp.mkdir(path.join(f.root,"vpk"));const live=path.join(f.root,"vpk",archiveName(41));await fsp.writeFile(live,"live skin archive");
 for(const state of ["restored","rolled-back","cancelled"]){const backup=await vtfBackup(f,state);await f.vtf.deleteBackup(f.root,backup.id);assert.equal(await exists(backup.dir),false);}
 assert.equal((await fsp.readFile(live,"utf8")),"live skin archive");
});

test("VTF active backups reject deletion",async t=>{
 const f=await fixture(t);
 for(const state of ["installed","preparing","pending"]){const backup=await vtfBackup(f,state);await assert.rejects(f.vtf.deleteBackup(f.root,backup.id),/先恢复皮肤/);assert.equal(await exists(path.join(backup.dir,"before-index.vpk")),true);}
});

test("record IDs, identity and game ownership are checked before any removal",async t=>{
 const f=await fixture(t),backup=await ddsBackup(f,"restored");await assert.rejects(readBackupManifest(f.dds.baseDir,"../outside",f.root),/编号无效/);
 await assert.rejects(f.dds.deleteBackup(path.join(f.home,"other-game"),backup.id),/当前游戏目录不匹配/);
 const file=path.join(backup.dir,"manifest.json");await fsp.writeFile(file,JSON.stringify({...backup.manifest,id:identity()}));await assert.rejects(f.dds.deleteBackup(f.root,backup.id),/当前游戏目录不匹配/);assert.equal(await exists(path.join(backup.dir,"0.before.bin")),true);
});

test("junction as a backup directory never follows or deletes external contents",async t=>{
 const f=await fixture(t),backup=await ddsBackup(f,"restored"),linkId=identity(),link=path.join(f.dds.baseDir,"backups",linkId);await fsp.symlink(backup.dir,link,process.platform==="win32"?"junction":"dir");
 await assert.rejects(readBackupManifest(f.dds.baseDir,linkId,f.root),/目录包含链接/);assert.equal(await exists(path.join(backup.dir,"0.before.bin")),true);await fsp.unlink(link);
});

test("nested junction aborts before the first payload deletion",async t=>{
 const f=await fixture(t),backup=await ddsBackup(f,"restored"),outside=path.join(f.home,"outside");await fsp.mkdir(outside);await fsp.writeFile(path.join(outside,"keep.txt"),"keep");const link=path.join(backup.dir,"link");await fsp.symlink(outside,link,process.platform==="win32"?"junction":"dir");
 await assert.rejects(f.dds.deleteBackup(f.root,backup.id),/目录包含链接/);assert.equal(await exists(path.join(backup.dir,"0.before.bin")),true);assert.equal(await fsp.readFile(path.join(outside,"keep.txt"),"utf8"),"keep");await fsp.unlink(link);
});

test("changed manifest aborts shared removal",async t=>{
 const f=await fixture(t),backup=await ddsBackup(f,"restored"),record=await readBackupManifest(f.dds.baseDir,backup.id,f.root);await fsp.writeFile(record.file,JSON.stringify({...backup.manifest,name:"changed"}));await assert.rejects(removeBackupDirectory(f.dds.baseDir,backup.id,record),/记录已变化/);assert.equal(await exists(path.join(backup.dir,"0.before.bin")),true);
});

test("active cross-format dependency protects an otherwise restored core record",async t=>{
 const f=await fixture(t),backup=await ddsBackup(f,"restored"),tx=await transaction(f,"installed","dds",backup.id);
 const row=(await f.coordinator.deletionRows(f.root,await f.dds.backups(f.root)))[0];assert.equal(row.canDelete,false);
 await assert.rejects(f.coordinator.deleteBackup("dds",f.root,backup.id),/先恢复皮肤/);await assert.rejects(f.coordinator.deleteBackup("vtf",f.root,tx.id),/先恢复皮肤/);assert.equal(await exists(backup.dir),true);assert.equal(await exists(tx.dir),true);assert.equal(f.locks(),f.releases());
});

test("terminal cross-format deletion removes core and transaction together",async t=>{
 const f=await fixture(t),backup=await ddsBackup(f,"restored"),tx=await transaction(f,"restored","dds",backup.id);const result=await f.coordinator.deleteBackup("dds",f.root,backup.id);assert.equal(result.deleted,true);assert.equal(result.skinSwitchId,tx.id);assert.equal(result.files,5);assert.equal(await exists(backup.dir),false);assert.equal(await exists(tx.dir),false);assert.equal(f.locks(),f.releases());
});

test("skinSwitchId protects an interrupted dependency before incomingBackupId is committed",async t=>{
 const f=await fixture(t),backup=await ddsBackup(f,"restored"),tx=await transaction(f,"recovery-required","dds",null);
 backup.manifest.skinSwitchId=tx.id;await fsp.writeFile(path.join(backup.dir,"manifest.json"),JSON.stringify(backup.manifest));
 const row=(await f.coordinator.deletionRows(f.root,await f.dds.backups(f.root)))[0];assert.equal(row.canDelete,false);
 await assert.rejects(f.coordinator.deleteBackup("dds",f.root,backup.id),/先恢复皮肤/);assert.equal(await exists(backup.dir),true);assert.equal(await exists(tx.dir),true);
});

test("cross-format transaction ID resolves its actual format from either page",async t=>{
 const f=await fixture(t),backup=await vtfBackup(f,"restored"),tx=await transaction(f,"restored","vtf",backup.id);await f.coordinator.deleteBackup("dds",f.root,tx.id);assert.equal(await exists(backup.dir),false);assert.equal(await exists(tx.dir),false);
});

test("cross-format terminal cleanup still preserves a required DDS retirement boundary",async t=>{
 const f=await fixture(t);await ddsBackup(f,"installed");const backup=await ddsBackup(f,"restored",{createdAt:"2026-10-14T01:00:00.000Z",originalReset:true}),tx=await transaction(f,"restored","dds",backup.id);
 await assert.rejects(f.coordinator.deleteBackup("dds",f.root,backup.id),/原版皮肤边界/);assert.equal(await exists(backup.dir),true);assert.equal(await exists(tx.dir),true);
});

test("a linked transaction junction aborts before deleting a valid core",async t=>{
 const f=await fixture(t),backup=await ddsBackup(f,"restored"),tx=await transaction(f,"restored","dds",backup.id),link=path.join(tx.dir,"unsafe");await fsp.symlink(f.root,link,process.platform==="win32"?"junction":"dir");
 await assert.rejects(f.coordinator.deleteBackup("dds",f.root,backup.id),/目录包含链接/);assert.equal(await exists(backup.dir),true);assert.equal(await exists(path.join(f.root,"Titanfall2.exe")),true);await fsp.unlink(link);
});

test("shared gate refuses deletion while launch owns the operation",async()=>{
 let release,entered=false;const pending=gate.run("launch",()=>new Promise(resolve=>{release=resolve;}));await assert.rejects(gate.run("dds-delete-backup",async()=>{entered=true;}),/操作正在进行/);assert.equal(entered,false);release();await pending;assert.equal(gate.busy,false);
});
