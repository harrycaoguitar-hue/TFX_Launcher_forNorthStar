"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fsp=fs.promises,path=require("node:path"),os=require("node:os");
const {DdsEngine}=require("../src/modules/dds-engine");
const {VtfEngine,INDEX_NAME,archiveName}=require("../src/modules/vtf-engine");
const {SkinSwitchCoordinator}=require("../src/modules/skin-switch");
const {weaponsFor}=require("../src/modules/skin-switch-weapons");
const {serializeIndex,parseIndex,hash}=require("../src/modules/vtf-vpk");

test("Smart Pistol resource identifiers are distinct from P2016 and CAR",()=>{
 for(const resource of ["models/weapons/p2011sp/w_p2011sp.mdl","models/weapons/p2011sp/ptpov_p2011sp.mdl","materials/models/weapons/p2011sp/p2011sp_col.vtf","scripts/weapons/mp_weapon_smart_pistol.txt","materials/models/weapons/smartpistol/smartpistol_col.vtf"]){
  assert.deepEqual(weaponsFor(resource),["smartpistol"]);
 }
 assert.deepEqual(weaponsFor("models/weapons/p2011/w_p2011.mdl"),["p2016"]);
 assert.deepEqual(weaponsFor("models/weapons/car101/w_car101.mdl"),["car"]);
 assert.deepEqual(weaponsFor("materials/models/weapons/p2011spread/other.vtf"),[]);
});

test("Smart Pistol VTF → DDS → VTF clears both formats and restores exactly while preserving P2016 and CAR",async t=>{
 const home=await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-smartpistol-switch-")));
 t.after(async()=>{assert.equal(path.dirname(home),await fsp.realpath(os.tmpdir()));assert(path.basename(home).startsWith("tfx-smartpistol-switch-"));await fsp.rm(home,{recursive:true,force:true});});
 const game=path.join(home,"game"),resources=path.join(game,"r2/paks/Win64"),vpk=path.join(game,"vpk");
 await fsp.mkdir(resources,{recursive:true});await fsp.mkdir(vpk);await fsp.writeFile(path.join(game,"Titanfall2.exe"),"fixture");
 const target=path.join(resources,"pc_stream.starpak"),stockDDS=Buffer.alloc(256,7);stockDDS.write("P201",96);stockDDS.write("CAR!",128);await fsp.writeFile(target,stockDDS);
 const smartPath="materials/models/weapons/p2011sp/p2011sp_col.vtf",p2016Path="materials/models/weapons/p2011/p2011_col.vtf",carPath="materials/models/weapons/car101/car101_col.vtf";
 const entries=[smartPath,p2016Path,carPath].map((asset,i)=>({path:asset,index:0,crc:0,chunks:[{flags:0x101,textureFlags:0,offset:i*4,compressedSize:4,size:4}]}));
 const indexFile=path.join(vpk,INDEX_NAME),stockIndex=serializeIndex(entries);await fsp.writeFile(indexFile,stockIndex);await fsp.writeFile(path.join(vpk,archiveName(0)),"old!P201CAR!");
 const dds=new DdsEngine({baseDir:path.join(home,"dds")}),vtf=new VtfEngine({baseDir:path.join(home,"vtf")});vtf.externalGameLock=true;await dds.initialize();await vtf.initialize();
 const stockEntries=parseIndex(stockIndex).entries;vtf.originals.prepare=async()=>({entries:stockEntries,status:{state:"ready",complete:true}});
 const dir=path.join(dds.baseDir,"packages/fixture"),ddsFile=path.join(dir,"smartpistol_default_col.dds"),incoming=Buffer.from("new!");await fsp.mkdir(dir,{recursive:true});await fsp.writeFile(ddsFile,incoming);
 const row={name:"smartpistol_default_col.dds",path:ddsFile,sha256:hash(incoming),target:"pc_stream.starpak",offset:64,length:4,skip:0,width:256,height:256};
 dds.packages.set("fixture",{id:"fixture",name:"Smart Pistol fixture",dir,files:[row],count:1,bytes:4});
 dds.originals.prepare=async()=>({status:{complete:true},originals:new Map([["pc_stream.starpak|64|4",{...row,bytes:stockDDS.subarray(64,68)}]])});
 const skinDir=path.join(home,"skin"),skinFile=path.join(skinDir,smartPath);await fsp.mkdir(path.dirname(skinFile),{recursive:true});
 const skin=Buffer.alloc(84);skin.write("VTF\0",0,"ascii");skin.writeUInt32LE(7,4);skin.writeUInt32LE(2,8);skin.writeUInt32LE(80,12);skin.writeUInt16LE(1,16);skin.writeUInt16LE(1,18);skin.writeUInt16LE(1,24);skin.writeInt32LE(0,52);skin[56]=1;skin.writeInt32LE(-1,57);skin.writeUInt16LE(1,63);skin.write("skin",80);await fsp.writeFile(skinFile,skin);
 const vtfId=(await vtf.inspect(skinDir)).id,c=new SkinSwitchCoordinator({baseDir:path.join(home,"switch"),dds,vtf,acquireLock:async()=>async()=>{},originalProvider:async({files})=>new Map(files.map(r=>[[r.target,r.offset,r.length].join("|"),{...r,bytes:stockDDS.subarray(r.offset,r.offset+r.length)}]))});
 const unchangedOthers=async()=>{
  const current=await fsp.readFile(target);assert.deepEqual(current.subarray(0,64),stockDDS.subarray(0,64));assert.deepEqual(current.subarray(68),stockDDS.subarray(68));
  const indexed=parseIndex(await fsp.readFile(indexFile)).entries;for(const asset of [p2016Path,carPath])assert.deepEqual(indexed.find(e=>e.path===asset).raw,stockEntries.find(e=>e.path===asset).raw);
 };
 const firstVtf=await c.install("vtf",game,vtfId),firstIndex=await fsp.readFile(indexFile);assert.notDeepEqual(firstIndex,stockIndex);assert.deepEqual(await fsp.readFile(target),stockDDS);await unchangedOthers();
 const firstDds=await c.install("dds",game,"fixture"),ddsBytes=await fsp.readFile(target);assert.equal(ddsBytes.subarray(64,68).toString(),"new!");assert.deepEqual(await fsp.readFile(indexFile),stockIndex);assert.equal(firstDds.crossFormatReset.vtfPaths,1);await unchangedOthers();
 const secondVtf=await c.install("vtf",game,vtfId);assert.deepEqual(await fsp.readFile(target),stockDDS);assert.notDeepEqual(await fsp.readFile(indexFile),stockIndex);assert.equal(secondVtf.crossFormatReset.ddsRanges,1);await unchangedOthers();
 await c.restore("vtf",game,secondVtf.backupId);assert.deepEqual(await fsp.readFile(target),ddsBytes);assert.deepEqual(await fsp.readFile(indexFile),stockIndex);await unchangedOthers();
 await c.restore("dds",game,firstDds.backupId);assert.deepEqual(await fsp.readFile(target),stockDDS);assert.deepEqual(await fsp.readFile(indexFile),firstIndex);await unchangedOthers();
 await c.restore("vtf",game,firstVtf.backupId);assert.deepEqual(await fsp.readFile(target),stockDDS);assert.deepEqual(await fsp.readFile(indexFile),stockIndex);await unchangedOthers();assert.deepEqual(await c.pending(game),[]);
});
