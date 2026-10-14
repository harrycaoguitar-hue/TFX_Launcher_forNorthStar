"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fsp=fs.promises,path=require("node:path"),os=require("node:os"),vm=require("node:vm");
const {DdsEngine}=require("../src/modules/dds-engine"),{DdsResourceTransaction}=require("../src/modules/dds-resource-transaction");
const {hash,updateCRC,flagsFor,createAssetLookup}=require("../src/modules/vtf-vpk");
async function fixture(t){
  const home=await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-speed-"));t.after(()=>fsp.rm(home,{recursive:true,force:true}));
  const game=path.join(home,"game"),target=path.join(game,"r2/paks/Win64/pc_stream.starpak"),before=Buffer.alloc(1024,7);
  await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.writeFile(target,before);await fsp.writeFile(path.join(game,"Titanfall2.exe"),"fixture");
  const engine=new DdsEngine({baseDir:path.join(home,"app"),manifestProvider:async()=>null});await engine.initialize();
  engine.gameStatus=async()=>({path:game,ready:true});engine.assertLayout=async()=>({ready:true});engine.originals.prepare=async()=>({status:{complete:true},originals:new Map()});
  const dir=path.join(engine.baseDir,"packages/fixture"),files=[];await fsp.mkdir(dir,{recursive:true});
  for(let i=0;i<4;i++){const source=path.join(dir,i+".dds"),data=Buffer.alloc(32,40+i);await fsp.writeFile(source,data);files.push({path:source,name:"car_default_col.dds",target:"pc_stream.starpak",offset:64+i*64,length:32,skip:0,width:256,height:256,sha256:hash(data)});}
  engine.packages.set("fixture",{id:"fixture",dir,name:"CAR fixture",count:files.length,bytes:128,files});return {home,game,target,before,engine,files};
}
async function intercept(target,action,hook){const open=fsp.open;fsp.open=async function(file,...args){const handle=await open.call(this,file,...args);if(path.resolve(file)===path.resolve(target))hook(handle,args[0]);return handle;};try{return await action();}finally{fsp.open=open;}}
test("DDS flushes each container once before installed and restores every range without changing unrelated bytes",async t=>{
  const f=await fixture(t);let syncs=0,writableOpens=0;
  const result=await intercept(f.target,()=>f.engine.install(f.game,"fixture"),(handle,mode)=>{if(mode!=="r+")return;writableOpens++;const sync=handle.sync.bind(handle);handle.sync=async()=>{syncs++;assert.equal((await f.engine.backups(f.game))[0].state,"pending");return sync();};});
  assert.equal(syncs,1);assert.equal(writableOpens,1);assert.equal((await f.engine.backups(f.game))[0].state,"installed");const installed=await fsp.readFile(f.target);assert.equal(hash(installed.subarray(512)),hash(f.before.subarray(512)));
  syncs=0;await intercept(f.target,()=>f.engine.restore(f.game,result.backupId),(handle,mode)=>{if(mode!=="r+")return;const sync=handle.sync.bind(handle);handle.sync=async()=>{syncs++;return sync();};});assert.equal(syncs,1);assert.equal(hash(await fsp.readFile(f.target)),hash(f.before));
});
test("DDS partial write failure rolls back all touched regions and leaves unrelated bytes intact",async t=>{
  const f=await fixture(t);let writes=0,injected=false;
  await assert.rejects(intercept(f.target,()=>f.engine.install(f.game,"fixture"),(handle,mode)=>{if(mode!=="r+")return;const write=handle.write.bind(handle);handle.write=async(...args)=>{writes++;if(!injected&&writes===3){injected=true;await write(args[0],args[1],8,args[3]);throw Error("fixture partial write failure");}return write(...args);};}),/fixture partial write/);
  assert.equal(injected,true);assert.equal(hash(await fsp.readFile(f.target)),hash(f.before));assert.equal((await f.engine.backups(f.game))[0].state,"rolled-back");
});
test("DDS flush failure cannot commit installed and rolls the same input back exactly",async t=>{
  const f=await fixture(t);let failed=false;
  await assert.rejects(intercept(f.target,()=>f.engine.install(f.game,"fixture"),(handle,mode)=>{if(mode!=="r+")return;const sync=handle.sync.bind(handle);handle.sync=async()=>{if(!failed){failed=true;throw Error("fixture flush failure");}return sync();};}),/fixture flush failure/);
  assert.equal(failed,true);assert.equal(hash(await fsp.readFile(f.target)),hash(f.before));assert.equal((await f.engine.backups(f.game))[0].state,"rolled-back");
});
test("DDS restore flush failure restores the installed state rather than committing a restored journal",async t=>{
  const f=await fixture(t),result=await f.engine.install(f.game,"fixture"),installed=await fsp.readFile(f.target);let failed=false;
  await assert.rejects(intercept(f.target,()=>f.engine.restore(f.game,result.backupId),(handle,mode)=>{if(mode!=="r+")return;const sync=handle.sync.bind(handle);handle.sync=async()=>{if(!failed){failed=true;throw Error("fixture restore flush failure");}return sync();};}),/fixture restore flush failure/);
  assert.equal(hash(await fsp.readFile(f.target)),hash(installed));assert.equal((await f.engine.backups(f.game))[0].state,"installed");await f.engine.restore(f.game,result.backupId);assert.equal(hash(await fsp.readFile(f.target)),hash(f.before));
});
test("DDS detects a game starting during range writes and reverses the completed writes",async t=>{
  const f=await fixture(t);let running=false;f.engine.isGameRunning=async()=>running;f.engine.emit=event=>{if(event.phase==="install")running=true;};
  await assert.rejects(f.engine.install(f.game,"fixture"),/游戏已启动/);assert.equal(hash(await fsp.readFile(f.target)),hash(f.before));assert.equal((await f.engine.backups(f.game))[0].state,"rolled-back");
});
test("DDS transaction never trusts a changed file identity or timestamp between ranges",async t=>{
  const f=await fixture(t),transaction=new DdsResourceTransaction(f.game),lstat=fsp.lstat;
  try{await transaction.read(f.target,64,32);fsp.lstat=async function(file,...args){const stat=await lstat.call(this,file,...args);if(path.resolve(file)===f.target){const replacement=Object.create(stat);replacement.ino=stat.ino+1;return replacement;}return stat;};await assert.rejects(transaction.write(f.target,64,Buffer.alloc(32,2)),/变化/);assert.equal(hash(await fsp.readFile(f.target)),hash(f.before));}finally{fsp.lstat=lstat;await transaction.close();}
  const second=new DdsResourceTransaction(f.game);try{await second.read(f.target,64,32);await fsp.utimes(f.target,new Date(2000,0,1),new Date(2000,0,1));await assert.rejects(second.write(f.target,64,Buffer.alloc(32,2)),/变化/);}finally{await second.close();}
});
test("DDS transaction refuses linked ancestors initially and at the durability boundary",async t=>{
  const f=await fixture(t),transaction=new DdsResourceTransaction(f.game),directory=path.dirname(f.target),moved=directory+"-moved",lstat=fsp.lstat;
  await fsp.rename(directory,moved);await fsp.symlink(moved,directory,process.platform==="win32"?"junction":"dir");
  try{await assert.rejects(transaction.read(f.target,64,32),/链接/);}finally{await fsp.unlink(directory);await fsp.rename(moved,directory);}
  try{await transaction.write(f.target,64,Buffer.alloc(32,2));fsp.lstat=async function(file,...args){const stat=await lstat.call(this,file,...args);if(path.resolve(file)===directory){const replacement=Object.create(stat);replacement.isSymbolicLink=()=>true;return replacement;}return stat;};await assert.rejects(transaction.flush(),/链接/);}finally{fsp.lstat=lstat;await transaction.close();}
});
test("DDS refuses a corrupted after backup before touching its corresponding range",async t=>{
  const f=await fixture(t);await assert.rejects(f.engine.install(f.game,"fixture",{beforeWrite:async({dir})=>{await fsp.writeFile(path.join(dir,"0.after.bin"),Buffer.alloc(32,99));}}),/新皮肤已损坏/);assert.equal(hash(await fsp.readFile(f.target)),hash(f.before));assert.equal((await f.engine.backups(f.game))[0].state,"cancelled");
});
test("VTF native CRC32 and fallback produce standard and streaming-compatible checksums",()=>{
  const code=fs.readFileSync(require.resolve("../src/modules/vtf-vpk"),"utf8"),fallback={exports:{}};vm.runInNewContext(code,{require:name=>name==="zlib"?{}:name==="./backup-records"?require("../src/modules/backup-records"):require(name),module:fallback,exports:fallback.exports,Buffer});
  const standard=Buffer.from("123456789"),bytes=Buffer.alloc(2*1024*1024+7);for(let i=0;i<bytes.length;i++)bytes[i]=(i*37+(i>>>9))&255;
  assert.equal((updateCRC(0xffffffff,standard)^0xffffffff)>>>0,0xcbf43926);assert.equal(updateCRC(0xffffffff,Buffer.alloc(0)),0xffffffff);
  for(const implementation of [updateCRC,fallback.exports.updateCRC]){let state=0xffffffff;for(let offset=0;offset<bytes.length;offset+=65536)state=implementation(state,bytes.subarray(offset,offset+65536));assert.equal(state,updateCRC(0xffffffff,bytes));}
});
test("VTF indexed flags retain exact-path precedence, first-format fallback, and invalid flag rejection",()=>{
  const entries=[{path:"materials/first.vtf",chunks:[{flags:1,textureFlags:2}]},{path:"materials/exact.vtf",chunks:[{flags:3,textureFlags:4}]},{path:"materials/bad.vtf",chunks:[{flags:3,textureFlags:4},{flags:5,textureFlags:4}]}],lookup=createAssetLookup(entries);
  for(const asset of ["materials/EXACT.VTF","materials/new.vtf"])assert.deepEqual(flagsFor(asset,entries,lookup),flagsFor(asset,entries));
  assert.equal(flagsFor("materials/EXACT.VTF",entries,lookup).flags,3);assert.equal(flagsFor("materials/new.vtf",entries,lookup).flags,1);assert.throws(()=>flagsFor("materials/bad.vtf",entries,lookup),/不一致/);assert.throws(()=>flagsFor("models/missing.mdl",entries,lookup),/参考资源/);
});
