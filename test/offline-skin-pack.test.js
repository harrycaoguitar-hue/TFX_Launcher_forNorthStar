"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fsp=fs.promises,path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const {OfflineSkinPack,productionDirectories}=require("../src/modules/offline-skin-pack");
const {DdsEngine}=require("../src/modules/dds-engine");
const {DdsOriginals}=require("../src/modules/dds-originals");
const {VtfOriginals}=require("../src/modules/vtf-originals");
const {VtfEngine,INDEX_NAME,archiveName}=require("../src/modules/vtf-engine");
const {SkinSwitchCoordinator}=require("../src/modules/skin-switch");
const {serializeIndex,parseIndex}=require("../src/modules/vtf-vpk");
const {fingerprint}=require("../src/modules/dds-layout-compatibility");
const zlib=require("node:zlib");
const sha=(bytes,algorithm="sha256")=>crypto.createHash(algorithm).update(bytes).digest("hex"),rangeKey=row=>[row.target,row.offset,row.length].join("|");
const info=bytes=>({size:bytes.length,chunks:[{offset:0,length:bytes.length,SHA1:sha(bytes,"sha1")}]});
async function fixture(t){
 const home=await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-offline-originals-")));t.after(()=>fsp.rm(home,{recursive:true,force:true}));
 const bundle=path.join(home,"TFX-Original-Skins"),game=path.join(home,"different-game"),directory=path.join(game,"r2/paks/Win64"),vpk=path.join(game,"vpk"),stock=Buffer.alloc(256,7),target=path.join(directory,"pc_stream.starpak");await fsp.mkdir(directory,{recursive:true});await fsp.mkdir(vpk,{recursive:true});await fsp.mkdir(path.join(bundle,"dds"),{recursive:true});await fsp.mkdir(path.join(bundle,"vtf"));await fsp.writeFile(path.join(game,"Titanfall2.exe"),"fixture");await fsp.writeFile(target,stock);
 const incoming={target:"pc_stream.starpak",offset:64,length:4,name:"car_default_col.dds",width:256,height:256,skip:0},omitted={target:"pc_stream.starpak",offset:80,length:4,name:"car_default_ao.dds",width:256,height:256,skip:0};
 const entries=["car","volt"].map((weapon,i)=>({path:`materials/models/weapons/${weapon}/${weapon}_col.vtf`,index:0,crc:0,chunks:[{flags:0x101,textureFlags:0,offset:64+i*4,compressedSize:4,size:4}]})),index=serializeIndex(entries),indexFile=path.join(vpk,INDEX_NAME),manifest={SHA256:sha(Buffer.from("current-computer-manifest")),files:new Map([["r2/paks/win64/pc_stream.starpak",info(stock)],["vpk/"+INDEX_NAME,info(index)],["vpk/"+archiveName(0),info(stock)]])};await fsp.writeFile(indexFile,index);await fsp.writeFile(path.join(vpk,archiveName(0)),stock);
 const catalogue={version:1,manifestSHA256:sha(Buffer.from("exporter-computer-manifest")),resources:{"r2/paks/win64/pc_stream.starpak":{size:stock.length,fingerprint:fingerprint(info(stock))}},dds:[],vtf:{file:"vtf/common-index.vpk",SHA256:sha(index),bytes:index.length}};
 for(const row of [incoming,omitted]){const payload=stock.subarray(row.offset,row.offset+row.length),file="dds/"+sha(Buffer.from(rangeKey(row)))+".bin";catalogue.dds.push({target:row.target,offset:row.offset,length:row.length,SHA256:sha(payload),file});await fsp.writeFile(path.join(bundle,file),payload);}await fsp.writeFile(path.join(bundle,catalogue.vtf.file),index);
 async function publish(){const bytes=Buffer.from(JSON.stringify(catalogue));await fsp.writeFile(path.join(bundle,"catalogue.json"),bytes);return new OfflineSkinPack({directories:[bundle],trustedCatalogueSHA256:sha(bytes)});}const pack=await publish();
 const plan=async files=>files.map(file=>{const row=[incoming,omitted].find(row=>path.basename(file)===row.name&&path.basename(path.dirname(file))==="256x256");return row?{...row,path:file,ok:true}:{path:file,ok:false,error:"没有匹配到受支持的皮肤名称与尺寸"};});
 return {home,bundle,game,directory,vpk,target,stock,incoming,omitted,index,indexFile,entries,manifest,catalogue,pack,plan,publish};
}
async function ddsEngine(f){
 const engine=new DdsEngine({baseDir:path.join(f.home,"dds"),manifestProvider:async()=>f.manifest,offlinePack:f.pack});await engine.initialize();engine.plan=f.plan;const dir=path.join(engine.baseDir,"packages/fixture"),source=path.join(dir,f.incoming.name),payload=Buffer.from("new!");await fsp.mkdir(dir,{recursive:true});await fsp.writeFile(source,payload);engine.packages.set("fixture",{id:"fixture",name:"CAR fixture",dir,files:[{...f.incoming,path:source,sha256:sha(payload)}],count:1,bytes:4});return engine;
}
async function vtfEngine(f){
 const engine=new VtfEngine({baseDir:path.join(f.home,"vtf-app"),manifestProvider:async()=>f.manifest,offlinePack:f.pack});engine.externalGameLock=true;await engine.initialize();const file=path.join(f.home,"skin/materials/models/weapons/car/car_col.vtf");await fsp.mkdir(path.dirname(file),{recursive:true});const skin=Buffer.alloc(84);skin.write("VTF\0",0);skin.writeUInt32LE(7,4);skin.writeUInt32LE(2,8);skin.writeUInt32LE(80,12);skin.writeUInt16LE(1,16);skin.writeUInt16LE(1,18);skin.writeUInt16LE(1,24);skin.writeInt32LE(0,52);skin[56]=1;skin.writeInt32LE(-1,57);skin.writeUInt16LE(1,63);skin.write("skin",80);await fsp.writeFile(file,skin);const pkg=await engine.inspect(path.join(f.home,"skin"));return {engine,pkg};
}
test("portable originals are reused across game paths and overall manifests when resource layout is unchanged",async t=>{
 const f=await fixture(t);const result=await f.pack.dds(f.omitted,f.manifest);assert.deepEqual(result.bytes,Buffer.alloc(4,7));assert.equal(result.origin.offlinePack,true);assert.equal(result.origin.manifestSHA256,f.manifest.SHA256);const originals=new DdsOriginals({baseDir:path.join(f.home,"fresh-user"),plan:f.plan,manifestProvider:async()=>f.manifest,offlinePack:f.pack});const result2=await originals.prepare({files:[f.incoming],dir:path.join(f.home,"package")},f.game);assert.equal(result2.status.complete,true);assert.equal(result2.status.omittedCount,1);await assert.rejects(fsp.stat(originals.folder(f.game)),{code:"ENOENT"});
});
test("DDS installation automatically fills omitted parts from pack while another weapon and bundle stay exact",async t=>{
 const f=await fixture(t),engine=await ddsEngine(f),before=Buffer.from(f.stock);before.fill(9,64,68);before.fill(8,80,84);before.write("VOLT",160);await fsp.writeFile(f.target,before);const bundleBefore=await fsp.readFile(path.join(f.bundle,f.catalogue.dds[1].file));const installed=await engine.install(f.game,"fixture");const after=await fsp.readFile(f.target);assert.equal(after.subarray(64,68).toString(),"new!");assert.deepEqual(after.subarray(80,84),Buffer.alloc(4,7));assert.equal(after.subarray(160,164).toString(),"VOLT");const expected=Buffer.from(before);expected.write("new!",64);expected.fill(7,80,84);assert.deepEqual(after,expected);assert.deepEqual(await fsp.readFile(path.join(f.bundle,f.catalogue.dds[1].file)),bundleBefore);await engine.restore(f.game,installed.backupId);assert.deepEqual(await fsp.readFile(f.target),before);
});
test("a corrupt DDS payload is rejected before any skin or backup publication",async t=>{
 const f=await fixture(t),engine=await ddsEngine(f);await fsp.writeFile(path.join(f.bundle,f.catalogue.dds[1].file),"oops");const before=await fsp.readFile(f.target);await assert.rejects(engine.install(f.game,"fixture"),/离线原皮包/);assert.deepEqual(await fsp.readFile(f.target),before);assert.deepEqual(await fsp.readdir(path.join(engine.baseDir,"backups")),[]);
});
test("a changed resource layout cannot use the pack even if the overall manifest identifier is copied",async t=>{
 const f=await fixture(t),changed={...f.manifest,files:new Map(f.manifest.files)},resource={...info(f.stock),chunks:[{offset:0,length:256,SHA1:"0".repeat(40)}]};changed.files.set("r2/paks/win64/pc_stream.starpak",resource);await assert.rejects(f.pack.dds(f.omitted,changed),/不兼容/);assert.deepEqual(await fsp.readFile(f.target),f.stock);
});
test("the trusted catalogue pin rejects an edited manifest and traversal cannot be introduced",async t=>{
 const f=await fixture(t);f.catalogue.dds[0].file="../outside.bin";await fsp.writeFile(path.join(f.bundle,"catalogue.json"),JSON.stringify(f.catalogue));await assert.rejects(f.pack.dds(f.incoming,f.manifest),/离线原皮包/);const authenticatedBad=await f.publish();await assert.rejects(authenticatedBad.dds(f.incoming,f.manifest),/离线原皮包/);
});
test("unknown or absent official layout never authorizes portable DDS bytes",async t=>{
 const f=await fixture(t);assert.equal(await f.pack.dds(f.omitted,null),null);await assert.rejects(f.pack.dds(f.omitted,{files:new Map(),SHA256:f.manifest.SHA256}),/不兼容/);
});
test("a missing portable pack leaves ordinary source handling available",async t=>{
 const f=await fixture(t),missing=new OfflineSkinPack({directories:[path.join(f.home,"missing")],trustedCatalogueSHA256:sha(Buffer.from("fixture"))});assert.equal(await missing.dds(f.omitted,f.manifest),null);assert.equal(await missing.vtf(f.manifest.files.get("vpk/"+INDEX_NAME)),null);
});
test("an independently authenticated second pack can recover after a corrupt first pack",async t=>{
 const f=await fixture(t),second=path.join(f.home,"second-pack");await fsp.cp(f.bundle,second,{recursive:true});await fsp.writeFile(path.join(f.bundle,f.catalogue.dds[1].file),"oops");const bytes=await fsp.readFile(path.join(second,"catalogue.json")),pack=new OfflineSkinPack({directories:[f.bundle,second],trustedCatalogueSHA256:sha(bytes)});assert.deepEqual((await pack.dds(f.omitted,f.manifest)).bytes,Buffer.alloc(4,7));
});
test("VTF stock index authenticates independently of the exporter's game path",async t=>{
 const f=await fixture(t),originals=new VtfOriginals({baseDir:path.join(f.home,"new-vtf-user"),manifestProvider:async()=>f.manifest,offlinePack:f.pack});await fsp.unlink(f.indexFile);const result=await originals.prepare(f.game);assert.equal(result.status.complete,true);assert.equal(result.status.offlinePack,true);assert.deepEqual(result.entries.map(entry=>entry.path),f.entries.map(entry=>entry.path));assert.equal(result.status.bytes,f.index.length);await assert.rejects(fsp.stat(originals.folder(f.game)),{code:"ENOENT"});
});
test("VTF missing stock index repairs automatically from portable pack and installs for a new user",async t=>{
 const f=await fixture(t),{engine,pkg}=await vtfEngine(f);await fsp.unlink(f.indexFile);assert.deepEqual(await engine.backups(f.game),[]);const status=await engine.gameStatus(f.game,pkg);assert.equal(status.ready,false);assert.equal(status.canRepair,true);assert.equal(status.issues[0].code,"missing");const installed=await engine.install(f.game,pkg.id);assert.equal(installed.count,1);assert.equal((await engine.gameStatus(f.game)).ready,true);const parsed=parseIndex(await fsp.readFile(f.indexFile));assert.equal(parsed.entries.find(entry=>entry.path.includes("/volt/")).index,0);assert.deepEqual(await fsp.readFile(path.join(f.bundle,f.catalogue.vtf.file)),f.index);
});
test("verified pack bypasses corrupt path-bound DDS and VTF caches while preserving broken evidence",async t=>{
 const f=await fixture(t),dds=new DdsOriginals({baseDir:path.join(f.home,"damaged-dds"),plan:f.plan,manifestProvider:async()=>f.manifest,offlinePack:f.pack}),vtf=new VtfOriginals({baseDir:path.join(f.home,"damaged-vtf"),manifestProvider:async()=>f.manifest,offlinePack:f.pack});const ddsFolder=dds.folder(f.game),vtfFolder=vtf.folder(f.game),cacheKey=sha(Buffer.from(rangeKey(f.omitted)));await fsp.mkdir(ddsFolder,{recursive:true});await fsp.mkdir(vtfFolder,{recursive:true});await fsp.writeFile(path.join(ddsFolder,cacheKey+".json"),"{broken");await fsp.writeFile(path.join(ddsFolder,cacheKey+".bin"),"oops");await fsp.writeFile(path.join(vtfFolder,"index.json"),"{broken");await fsp.writeFile(path.join(vtfFolder,"common-index.vpk"),"oops");assert.equal((await dds.prepare({files:[f.incoming],dir:path.join(f.home,"pkg")},f.game)).status.complete,true);assert.equal((await vtf.prepare(f.game)).status.complete,true);assert.equal(await fsp.readFile(path.join(ddsFolder,cacheKey+".json"),"utf8"),"{broken");assert.equal(await fsp.readFile(path.join(vtfFolder,"index.json"),"utf8"),"{broken");
});
test("portable stock repairs a truncated VTF index while preserving its complete custom weapon record",async t=>{
 const f=await fixture(t),{engine,pkg}=await vtfEngine(f),custom={...f.entries[1],index:7};await fsp.writeFile(path.join(f.vpk,archiveName(7)),f.stock);const full=serializeIndex([custom,f.entries[0]]),damaged=full.subarray(0,full.length-20);await fsp.writeFile(f.indexFile,damaged);const result=await engine.repairResources(f.game,pkg.id);assert.equal(result.game.ready,true);assert.equal(result.repaired[0].preservedEntries,1);assert.deepEqual(await fsp.readFile(result.repaired[0].damagedIndexBackup),damaged);const recovered=parseIndex(await fsp.readFile(f.indexFile)).entries;assert.equal(recovered.find(entry=>entry.path.includes("/volt/")).index,7);assert.equal(recovered.find(entry=>entry.path.includes("/car/")).index,0);
});
test("VTF selection restores only the chosen weapon and preserves another unknown custom weapon",async t=>{
 const f=await fixture(t),{engine,pkg}=await vtfEngine(f),custom={...f.entries[1],index:7},carCustom={...f.entries[0],index:8};await fsp.writeFile(path.join(f.vpk,archiveName(7)),f.stock);await fsp.writeFile(path.join(f.vpk,archiveName(8)),f.stock);await fsp.writeFile(f.indexFile,serializeIndex([carCustom,custom]));const dds={baseDir:path.join(f.home,"unused-dds"),isGameRunning:async()=>false,initialize:async()=>{},install:async()=>{},restore:async()=>{}},coordinator=new SkinSwitchCoordinator({dds,vtf:engine,baseDir:path.join(f.home,"skin-switch")});const plan=await coordinator.vpkPlan(f.game,["car"]),entries=parseIndex(plan.after).entries;assert.equal(entries.find(entry=>entry.path.includes("/car/")).index,0);assert.equal(entries.find(entry=>entry.path.includes("/volt/")).index,7);await fsp.writeFile(f.indexFile,plan.after);await engine.install(f.game,pkg.id);assert.equal(parseIndex(await fsp.readFile(f.indexFile)).entries.find(entry=>entry.path.includes("/volt/")).index,7);
});
test("corrupt or mismatched VTF stock bytes never repair a missing common index",async t=>{
 const f=await fixture(t),{engine,pkg}=await vtfEngine(f);await fsp.unlink(f.indexFile);await fsp.writeFile(path.join(f.bundle,f.catalogue.vtf.file),Buffer.alloc(f.index.length,9));const status=await engine.gameStatus(f.game,pkg);assert.equal(status.canRepair,false);await assert.rejects(engine.repairResources(f.game,pkg.id),/离线原皮包/);await assert.rejects(fsp.stat(f.indexFile),{code:"ENOENT"});
});
test("official VTF index changes invalidate the portable stock even when its pack hash is correct",async t=>{
 const f=await fixture(t);await assert.rejects(f.pack.vtf(info(Buffer.alloc(f.index.length,8))),/不兼容/);
});
test("DDS ranges do not fabricate a missing STARPAK container",async t=>{
 const f=await fixture(t),engine=await ddsEngine(f);await fsp.unlink(f.target);const status=await engine.gameStatus(f.game,engine.packages.get("fixture"));assert.equal(status.canRepair,false);await assert.rejects(engine.install(f.game,"fixture"),/缺少游戏资源/);await assert.rejects(fsp.stat(f.target),{code:"ENOENT"});
});
test("a VTF stock index never fabricates its missing full archive",async t=>{
 const f=await fixture(t),{engine,pkg}=await vtfEngine(f);await fsp.unlink(path.join(f.vpk,archiveName(0)));const status=await engine.gameStatus(f.game,pkg);assert.equal(status.canRepair,false);await assert.rejects(engine.install(f.game,pkg.id),/common VPK/);await assert.rejects(fsp.stat(path.join(f.vpk,archiveName(0))),{code:"ENOENT"});
});
test("a VTF pack never substitutes stock for a missing unknown custom weapon archive",async t=>{
 const f=await fixture(t),{engine,pkg}=await vtfEngine(f),custom={...f.entries[1],index:7};await fsp.writeFile(f.indexFile,serializeIndex([f.entries[0],custom]));const before=await fsp.readFile(f.indexFile),status=await engine.gameStatus(f.game,pkg);assert.equal(status.canRepair,false);assert.equal(status.issues[0].managed,true);await assert.rejects(engine.install(f.game,pkg.id),/common VPK/);assert.deepEqual(await fsp.readFile(f.indexFile),before);await assert.rejects(fsp.stat(path.join(f.vpk,archiveName(7))),{code:"ENOENT"});
});
test("linked portable payload paths are rejected",async t=>{
 const f=await fixture(t),file=path.join(f.bundle,f.catalogue.dds[1].file),outside=path.join(f.home,"outside.bin");await fsp.rename(file,outside);await fsp.symlink(outside,file,"file");await assert.rejects(f.pack.dds(f.omitted,f.manifest),/链接/);await fsp.unlink(file);
});
test("production reads only resources and the portable executable's companion directory",()=>{
 assert.deepEqual(productionDirectories({resourcesPath:path.resolve("resources"),portableDirectory:path.resolve("portable")}),[path.resolve("portable/TFX-Original-Skins"),path.resolve("resources/TFX-Original-Skins")]);assert.deepEqual(productionDirectories({resourcesPath:"relative",portableDirectory:"relative"}),[]);
});
async function compact(f,{encoding="brotli",replacement}={}){
 f.catalogue.version=2;for(const row of f.catalogue.dds){const payload=replacement?.(row)||await fsp.readFile(path.join(f.bundle,row.file)),stored=encoding==="brotli"?zlib.brotliCompressSync(payload):payload;row.SHA256=sha(payload);row.file="dds/"+row.SHA256+(encoding==="brotli"?".br":".bin");row.encoding=encoding;row.storedLength=stored.length;await fsp.writeFile(path.join(f.bundle,row.file),stored);}f.pack=await f.publish();return f.pack;
}
test("schema 2 compressed content is shared by equal ranges and decoded only when requested",async t=>{
 const f=await fixture(t),pack=await compact(f);assert.equal(f.catalogue.dds[0].file,f.catalogue.dds[1].file);assert.deepEqual((await pack.dds(f.incoming,f.manifest)).bytes,Buffer.alloc(4,7));assert.deepEqual((await pack.dds(f.omitted,f.manifest)).bytes,Buffer.alloc(4,7));const engine=await ddsEngine(f),before=Buffer.from(f.stock);before.fill(9,80,84);before.write("VOLT",160);await fsp.writeFile(f.target,before);await engine.install(f.game,"fixture");const after=await fsp.readFile(f.target);assert.equal(after.subarray(64,68).toString(),"new!");assert.deepEqual(after.subarray(80,84),Buffer.alloc(4,7));assert.equal(after.subarray(160,164).toString(),"VOLT");assert.deepEqual((await pack.vtf(f.manifest.files.get("vpk/"+INDEX_NAME))).bytes,f.index);
});
test("schema 2 preserves uncompressed identity fallback with content-addressed filenames",async t=>{
 const f=await fixture(t),pack=await compact(f,{encoding:"identity"});assert.equal(f.catalogue.dds[0].storedLength,4);assert.equal(f.catalogue.dds[0].file,f.catalogue.dds[1].file);assert.deepEqual((await pack.dds(f.omitted,f.manifest)).bytes,Buffer.alloc(4,7));
});
test("catalogue discovery and a selected DDS read do not load unrelated missing compressed bytes",async t=>{
 const f=await fixture(t),pack=await compact(f,{replacement:row=>Buffer.alloc(4,row.offset===f.incoming.offset?8:7)});await fsp.unlink(path.join(f.bundle,f.catalogue.dds[0].file));assert.equal((await pack.catalogues()).length,1);assert.deepEqual((await pack.dds(f.omitted,f.manifest)).bytes,Buffer.alloc(4,7));await assert.rejects(pack.dds(f.incoming,f.manifest),{message:"离线原皮包已损坏或与当前游戏资源版本不兼容，未修改游戏。"});
});
test("compressed payload size mismatches and invalid brotli data fail before DDS publication",async t=>{
 const f=await fixture(t),pack=await compact(f),file=path.join(f.bundle,f.catalogue.dds[1].file),stored=await fsp.readFile(file);await fsp.writeFile(file,stored.subarray(0,stored.length-1));await assert.rejects(pack.dds(f.omitted,f.manifest),/离线原皮包/);await fsp.writeFile(file,Buffer.alloc(stored.length,0xff));await assert.rejects(pack.dds(f.omitted,f.manifest),/离线原皮包/);assert.deepEqual(await fsp.readFile(f.target),f.stock);
});
test("brotli expansion is bounded by the declared range length",async t=>{
 const f=await fixture(t);await compact(f);const record=f.catalogue.dds[1],bomb=zlib.brotliCompressSync(Buffer.alloc(2*1024*1024,7));for(const row of f.catalogue.dds)row.storedLength=bomb.length;await fsp.writeFile(path.join(f.bundle,record.file),bomb);const pack=await f.publish();let limit;const original=zlib.brotliDecompressSync;zlib.brotliDecompressSync=(bytes,options)=>{limit=options.maxOutputLength;return original(bytes,options);};try{await assert.rejects(pack.dds(f.omitted,f.manifest),/离线原皮包/);assert.equal(limit,4);}finally{zlib.brotliDecompressSync=original;}assert.deepEqual(await fsp.readFile(f.target),f.stock);
});
test("decoded length and content hashes remain mandatory after successful decompression",async t=>{
 const f=await fixture(t);await compact(f);for(const payload of [Buffer.alloc(3,7),Buffer.alloc(4,8)]){const stored=zlib.brotliCompressSync(payload);for(const row of f.catalogue.dds)row.storedLength=stored.length;await fsp.writeFile(path.join(f.bundle,f.catalogue.dds[0].file),stored);const pack=await f.publish();await assert.rejects(pack.dds(f.omitted,f.manifest),/离线原皮包/);}assert.deepEqual(await fsp.readFile(f.target),f.stock);
});
test("compressed schema rejects unknown codecs, unsafe file names and inconsistent shared payload sizes",async t=>{
 for(const change of [row=>{row.encoding="deflate";},row=>{row.file="../outside.br";},row=>{row.storedLength=128*1024*1024+1;},row=>{row.storedLength+=1;}]){const f=await fixture(t);await compact(f);change(f.catalogue.dds[1]);const pack=await f.publish();await assert.rejects(pack.dds(f.omitted,f.manifest),/离线原皮包/);}
});
test("schema 1 missing DDS and VTF payload files use the translated pack error",async t=>{
 const f=await fixture(t);await fsp.unlink(path.join(f.bundle,f.catalogue.dds[1].file));await fsp.unlink(path.join(f.bundle,f.catalogue.vtf.file));const expected={message:"离线原皮包已损坏或与当前游戏资源版本不兼容，未修改游戏。"};await assert.rejects(f.pack.dds(f.omitted,f.manifest),expected);await assert.rejects(f.pack.vtf(f.manifest.files.get("vpk/"+INDEX_NAME)),expected);
});
