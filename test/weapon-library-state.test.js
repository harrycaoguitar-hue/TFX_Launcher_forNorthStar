"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),fsp=fs.promises,path=require("path"),os=require("os"),crypto=require("crypto");
const {DdsEngine}=require("../src/modules/dds-engine"),{VtfEngine,INDEX_NAME,archiveName}=require("../src/modules/vtf-engine");
const {SkinSwitchCoordinator}=require("../src/modules/skin-switch"),{serializeIndex,parseIndex,hash}=require("../src/modules/vtf-vpk"),{rangeKey}=require("../src/modules/dds-replacement");
const {restoreState,planState}=require("../src/modules/weapon-library-state"),{buildLibrary,register}=require("../src/modules/weapon-library"),{stateHistory}=require("../src/modules/weapon-backup-scopes");
const gate=require("../src/modules/dds-operation-gate");
async function put(file,bytes){await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.writeFile(file,bytes);}
async function fixture(t){
 const home=await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-state-")));t.after(()=>fsp.rm(home,{recursive:true,force:true}));
 const game=path.join(home,"game"),target=path.join(game,"r2/paks/Win64/pc_stream.starpak"),indexFile=path.join(game,"vpk",INDEX_NAME),stock=Buffer.alloc(256,7),entries=["car","volt"].map((weapon,i)=>({path:`materials/models/weapons/${weapon}/${weapon}_col.vtf`,index:0,crc:0,chunks:[{flags:0x101,textureFlags:0,offset:i*4,compressedSize:4,size:4}]})),originalIndex=serializeIndex(entries);
 await put(path.join(game,"Titanfall2.exe"),"isolated state fixture");await put(target,stock);await put(indexFile,originalIndex);await put(path.join(game,"vpk",archiveName(0)),stock);
 const dds=new DdsEngine({baseDir:path.join(home,"dds"),compatibilityValidator:async()=>({ready:true,layoutVerified:false,issues:[]})}),vtf=new VtfEngine({baseDir:path.join(home,"vtf")});await dds.initialize();await vtf.initialize();
 dds.gameStatus=async()=>({ready:true,path:game});vtf.gameStatus=async()=>({ready:true,path:game});
 dds.originals.prepare=async pkg=>({status:{complete:true},originals:new Map(pkg.files.map(row=>[rangeKey(row),{...row,bytes:stock.subarray(row.offset,row.offset+row.length)}]))});
 vtf.originals={prepare:async()=>({entries:parseIndex(originalIndex).entries,status:{complete:true}})};
 const coordinator=new SkinSwitchCoordinator({dds,vtf,baseDir:path.join(home,"switch"),acquireLock:async()=>async()=>{},originalProvider:async({files})=>new Map(files.map(row=>[rangeKey(row),{bytes:stock.subarray(row.offset,row.offset+row.length)}]))});
 const channels=new Map(),progress=[];let selected=game;
 register({dds,vtf,mods:{list:()=>({all:[]})},settings:()=>({gamepath:selected}),switchDir:coordinator.baseDir,getCoordinator:()=>coordinator,ipcMain:{handle:(name,fn)=>channels.set(name,fn)}});
 const invoke=input=>channels.get("weapon-library-restore")({sender:{isDestroyed:()=>false,send:(_name,event)=>progress.push(event)}},input),library=()=>buildLibrary({gamePath:game,dds,vtf,switchDir:coordinator.baseDir});
 async function install(format,name,values){
  const dir=path.join(home,"input",name),files=[];
  for(const [weapon,text]of Object.entries(values))if(format==="dds"){
   const data=Buffer.from(text),file=path.join(dir,"256x256",weapon+"_default_col.dds");await put(file,data);files.push({name:weapon+"_default_col.dds",family:weapon+"_default",path:file,target:"pc_stream.starpak",offset:weapon==="car"?64:160,length:4,skip:0,width:256,height:256,sha256:hash(data)});
  }else{
   const data=Buffer.alloc(84);data.write("VTF\0");data.writeUInt32LE(7,4);data.writeUInt32LE(2,8);data.writeUInt32LE(80,12);data.writeUInt16LE(1,16);data.writeUInt16LE(1,18);data.writeUInt16LE(1,24);data.writeInt32LE(0,52);data[56]=1;data.writeInt32LE(-1,57);data.writeUInt16LE(1,63);data.write(text,80);await put(path.join(dir,"materials/models/weapons",weapon,weapon+"_col.vtf"),data);
  }
  let id=name;if(format==="dds")dds.packages.set(id,{id,name,dir,files,count:files.length,bytes:files.length*4});else id=(await vtf.inspect(dir)).id;
  const result=await coordinator.install(format,game,id);return {...result,recordId:format+":"+result.backupId,format};
 }
 const live=async()=>({dds:await fsp.readFile(target),index:await fsp.readFile(indexFile)}),archives=async()=>Object.fromEntries(await Promise.all((await fsp.readdir(path.join(game,"vpk"))).filter(name=>name!==INDEX_NAME).sort().map(async name=>[name,hash(await fsp.readFile(path.join(game,"vpk",name)))])));
 const restore=recordId=>invoke({weaponId:"car",targetMode:"installed",recordId}),original=()=>invoke({weaponId:"car",targetMode:"original"});
 async function chain(first="dds"){const A=await install(first,"A",{car:"AAA!",volt:"VVVA"}),stateA=await live(),B=await install(first==="dds"?"vtf":"dds","B",{car:"BBB!"}),stateB=await live(),C=await install(first,"C",{car:"CCC!"}),stateC=await live();return{A,B,C,stateA,stateB,stateC};}
 return {home,game,target,indexFile,stock,originalIndex,dds,vtf,coordinator,channels,progress,invoke,library,install,live,archives,restore,original,chain,setSelected:value=>selected=value};
}
function unaffected(before,after){assert.deepEqual(after.dds.subarray(160,164),before.dds.subarray(160,164));const entry=bytes=>parseIndex(bytes).entries.find(row=>row.path.includes("/volt/"));assert.deepEqual(entry(after.index).raw,entry(before.index).raw);}
for(const first of ["dds","vtf"])test(first+" C → A → B restores each selected skin itself in one durable WAL, preserving other weapons and all archives",async t=>{
 const f=await fixture(t),{A,B,C,stateA,stateB,stateC}=await f.chain(first),archiveHashes=await f.archives();
 for(const [target,expected]of [[A,stateA],[B,stateB],[C,stateC],[A,stateA]]){
  const prior=(await f.coordinator.transactions(f.game)).length,result=await f.restore(target.recordId);assert.equal(result.ok,true,result.error);assert.equal(result.stateRestored,true);assert.equal(result.recordId,target.recordId);assert.equal(result.targetMode,"installed");assert.deepEqual(await f.live(),expected);assert.deepEqual(await f.archives(),archiveHashes);
  const tx=await f.coordinator.transactions(f.game);assert.equal(tx.length,prior+1);assert.equal(tx.at(-1).value.purpose,"weapon-state");assert.equal(tx.at(-1).value.targetRecordId,target.recordId);assert.equal(tx.at(-1).value.state,"restored");
  const library=await f.library();assert.equal(library.stateCurrentRecordByWeapon.car,target.recordId);assert(library.items.find(row=>row.id===target.recordId).currentWeaponIds.includes("car"));assert(!library.items.find(row=>row.id===target.recordId).stateRestoreWeaponIds.includes("car"));assert(f.progress.filter(event=>event.phase==="complete").at(-1).targetMode==="installed");
 }
 unaffected(stateC,await f.live());assert.deepEqual(await f.coordinator.pending(f.game),[]);
});
test("restoring A then installing D creates a branch; B, D and C remain selectable across stock",async t=>{
 const f=await fixture(t),{A,B,C,stateB,stateC}=await f.chain();assert((await f.restore(A.recordId)).ok);const D=await f.install("dds","D",{car:"DDD!"}),stateD=await f.live();
 for(const [target,expected]of [[B,stateB],[D,stateD],[C,stateC]]){const result=await f.restore(target.recordId);assert(result.ok,result.error);assert.deepEqual(await f.live(),expected);}
 const original=await f.original();assert(original.ok,original.error);assert.equal(original.targetMode,"original");const stockState=await f.live();assert.deepEqual(stockState.dds.subarray(64,68),f.stock.subarray(64,68));assert.equal(parseIndex(stockState.index).entries.find(row=>row.path.includes("/car/")).index,0);unaffected(stateC,stockState);
 const library=await f.library();assert.equal(library.stateCurrentRecordByWeapon.car,null);assert(library.stateOriginalCurrentWeaponIds.includes("car"));assert(library.items.filter(row=>row.weaponIds.includes("car")).every(row=>row.stateRestoreWeaponIds.includes("car")));
 const again=await f.restore(B.recordId);assert(again.ok,again.error);assert.deepEqual(await f.live(),stateB);const E=await f.install("dds","E",{car:"EEE!"});assert(E.backupId);assert((await f.restore(D.recordId)).ok);assert.deepEqual(await f.live(),stateD);
});
test("new state selection does not rewrite or consume any historical core manifest",async t=>{
 const f=await fixture(t),{A,B}=await f.chain();const snapshot={};for(const engine of [f.dds,f.vtf])for(const id of await fsp.readdir(path.join(engine.baseDir,"backups"))){const file=path.join(engine.baseDir,"backups",id,"manifest.json");snapshot[file]=await fsp.readFile(file);}
 assert((await f.restore(A.recordId)).ok);assert((await f.restore(B.recordId)).ok);for(const[file,bytes]of Object.entries(snapshot))assert.deepEqual(await fsp.readFile(file),bytes);
});
test("a full old coordinator undo retains linked final payloads for forward state selection",async t=>{
 const f=await fixture(t),{B,C,stateB,stateC}=await f.chain();await f.coordinator.restore(C.format,f.game,C.backupId);assert.deepEqual(await f.live(),stateB);const library=await f.library();assert(library.items.find(row=>row.id===C.recordId).stateRestoreWeaponIds.includes("car"));const result=await f.restore(C.recordId);assert(result.ok,result.error);assert.deepEqual(await f.live(),stateC);assert.equal((await f.library()).stateCurrentRecordByWeapon.car,C.recordId);assert(B.backupId);
});
for(const first of ["dds","vtf"])test("a reselected old restored "+first+" skin participates in the next cross-format install without changing the other weapon",async t=>{
 const f=await fixture(t),{C,stateC}=await f.chain(first);await f.coordinator.restore(C.format,f.game,C.backupId);assert((await f.restore(C.recordId)).ok);const other=first==="dds"?"vtf":"dds",D=await f.install(other,"D after old restored",{car:"DDD!"}),stateD=await f.live();unaffected(stateC,stateD);if(other==="vtf")assert.deepEqual(stateD.dds.subarray(64,68),f.stock.subarray(64,68));else assert.equal(parseIndex(stateD.index).entries.find(row=>row.path.includes("/car/")).index,0);
 await f.coordinator.restore(D.format,f.game,D.backupId);assert.deepEqual(await f.live(),stateC);const result=await f.restore(D.recordId);assert(result.ok,result.error);assert.deepEqual(await f.live(),stateD);
});
test("corrupt payload, changed live DDS, unknown VTF override and missing target archives stop without writes",async t=>{
 for(const failure of ["payload","dds","index","archive"]){const f=await fixture(t),{A,B,C}=await f.chain();
  if(failure==="payload")await fsp.writeFile(path.join(f.coordinator.baseDir,C.skinSwitchId,"0.final.bin"),"bad!");
  if(failure==="dds"){const bytes=await fsp.readFile(f.target);bytes.write("else",64);await fsp.writeFile(f.target,bytes);}
  if(failure==="index"){const rows=parseIndex(await fsp.readFile(f.indexFile)).entries;rows.push({...rows[0],path:"materials/models/weapons/car/unknown_col.vtf"});await fsp.writeFile(f.indexFile,serializeIndex(rows));}
  if(failure==="archive")await fsp.unlink(path.join(f.game,"vpk",B.archive));
  const before=await f.live(),result=await f.restore(failure==="archive"?B.recordId:A.recordId);assert.equal(result.ok,false);assert.match(result.error,/PAYLOAD_INVALID|CURRENT_CHANGED|archive-unavailable|chain-incomplete|ARCHIVE_MISSING/);assert.deepEqual(await f.live(),before);assert.deepEqual(await f.coordinator.pending(f.game),[]);
 }
});
test("post-write failure rolls back exact prior state and leaves every historical target selectable",async t=>{
 const f=await fixture(t),{A,C,stateC}=await f.chain(),archives=await f.archives(),commit=f.coordinator.commitClean.bind(f.coordinator);f.coordinator.commitClean=async(...args)=>{await commit(...args);throw Error("injected state failure");};const result=await f.restore(A.recordId);assert.equal(result.ok,false);assert.match(result.error,/injected state failure/);assert.deepEqual(await f.live(),stateC);assert.deepEqual(await f.archives(),archives);assert.deepEqual(await f.coordinator.pending(f.game),[]);assert.equal((await f.library()).stateCurrentRecordByWeapon.car,C.recordId);f.coordinator.commitClean=commit;assert((await f.restore(A.recordId)).ok);
});
test("an interrupted state WAL disables targets until existing recovery restores its exact before state",async t=>{
 const f=await fixture(t),{A,stateC}=await f.chain();await f.coordinator.locked(f.game,async root=>{const id=crypto.randomUUID(),dir=path.join(f.coordinator.baseDir,id);await fsp.mkdir(dir);const plan=await planState({coordinator:f.coordinator,root,weaponId:"car",targetMode:"installed",recordId:A.recordId,staging:dir}),tx={version:1,id,purpose:"weapon-state",format:"dds",name:"car",gamePath:root,weapons:["car"],createdAt:new Date(Date.now()+100).toISOString(),state:"prepared",ranges:[],incomingBackupId:null,...plan.stateMetadata};for(const row of plan.rows)await f.coordinator.saveRange(tx,dir,row);if(plan.vpk){await put(path.join(dir,"before-index.vpk"),plan.vpk.before);await put(path.join(dir,"clean-index.vpk"),plan.vpk.after);tx.indexBeforeHash=hash(plan.vpk.before);tx.indexCleanHash=hash(plan.vpk.after);}await f.coordinator.commitClean(root,tx,dir);});
 const library=await f.library();assert.equal(library.recoveries.length,1);assert(!library.items.some(row=>row.canRestoreState));assert.deepEqual(library.stateRestoreWeaponIds,[]);const result=await f.invoke({recoveryId:library.recoveries[0].id});assert(result.ok,result.error);assert.deepEqual(await f.live(),stateC);assert.deepEqual(await f.coordinator.pending(f.game),[]);
});
test("invalid, current, busy, running-game and stale target requests never change live state",async t=>{
 const f=await fixture(t),{A,C,stateC}=await f.chain(),count=(await f.coordinator.transactions(f.game)).length;
 for(const input of [{weaponId:"car",targetMode:"installed",recordId:C.recordId},{weaponId:"car",targetMode:"original",recordId:A.recordId},{weaponId:"car",targetMode:"unknown"},{weaponId:"car",targetMode:"installed",recordId:"mod:bad"},{weaponId:"../car",targetMode:"installed",recordId:A.recordId}])assert.equal((await f.invoke(input)).ok,false);
 await gate.run("state-test-busy",async()=>assert.equal((await f.restore(A.recordId)).error,"WEAPON_RECOVERY_BUSY"));f.dds.isGameRunning=async()=>true;assert.match((await f.restore(A.recordId)).error,/请先退出游戏/);f.dds.isGameRunning=async()=>false;
 let checks=0;await assert.rejects(restoreState({coordinator:f.coordinator,gamePath:f.game,weaponId:"car",targetMode:"installed",recordId:A.recordId,stillCurrent:()=>++checks<2}),/STALE_WEAPON_LIBRARY/);assert.deepEqual(await f.live(),stateC);assert.equal((await f.coordinator.transactions(f.game)).length,count);
});
test("history ordering is deterministic and dangling or malformed state references fail closed",()=>{
 const A="dds:"+crypto.randomUUID(),B="vtf:"+crypto.randomUUID(),stamp="2026-10-15T00:00:00.000Z",items=[A,B].sort().map(id=>({id,format:id.slice(0,3),weaponIds:["car"],installedAt:stamp}));const history=stateHistory(items,[],"car");assert.equal(history.current,items.at(-1).id);assert.deepEqual(history.lineage(history.current),items.map(row=>row.id).reverse());
 assert.equal(stateHistory(items,[{purpose:"weapon-state",state:"restored",createdAt:"2026-10-16T00:00:00.000Z",weapons:["car"],targetMode:"installed",targetRecordId:A,stateRecordIds:[A,B],activeRecordIds:[]}],"car").complete,false);
 assert.equal(stateHistory(items,[{state:"installed",format:"dds",incomingBackupId:crypto.randomUUID(),createdAt:stamp,weapons:["car"]}],"car").complete,false);
});
test("registered maintenance IPC applies both shared operation and game locks, leaving valid history intact",async t=>{
 const f=await fixture(t);await f.chain();const run=input=>f.channels.get("weapon-library-prune")({},input),before=await f.live();
 assert.equal((await run({recordId:"dds:any"})).ok,false);await gate.run("prune-test-busy",async()=>assert.equal((await run({})).error,"WEAPON_RECOVERY_BUSY"));f.dds.isGameRunning=async()=>true;assert.match((await run({})).error,/请先退出游戏/);f.dds.isGameRunning=async()=>false;
 const result=await run({});assert.equal(result.ok,true,result.error);assert.deepEqual(result.deleted,[]);assert.equal(result.gameFilesRemoved,0);assert.deepEqual(await f.live(),before);
});
