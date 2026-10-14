"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fsp=fs.promises,path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const {parseManifest,findManifest}=require("../src/modules/dds-originals");
const include=key=>/^vpk\/(?:englishclient_mp_common\.bsp\.pak000_dir|client_mp_common\.bsp\.pak000_\d+)\.vpk$/.test(key);
function integer(value){let number=BigInt(value),bytes=[];do{let item=Number(number&127n);number>>=7n;if(number)item|=128;bytes.push(item);}while(number);return Buffer.from(bytes);}
function field(key,value){return typeof value==="number"?Buffer.concat([integer(key*8),integer(value)]):Buffer.concat([integer(key*8+2),integer(value.length),value]);}
function entry(name,bytes,offset=0){const digest=crypto.createHash("sha1").update(bytes).digest(),chunk=Buffer.concat([field(1,digest),field(3,offset),field(4,bytes.length)]);return field(1,Buffer.concat([field(1,Buffer.from(name)),field(2,offset+bytes.length),field(6,chunk)]));}
function manifest(...entries){const body=Buffer.concat(entries),header=Buffer.alloc(8);header.writeUInt32LE(0x71f617d0);header.writeUInt32LE(body.length,4);return Buffer.concat([header,body]);}
test("DDS default parser stays scoped while VTF filter authenticates index/archive chunk metadata",()=>{
  const bytes=Buffer.from("original-resource"),data=manifest(entry("r2/paks/Win64/pc_stream.starpak",bytes),entry("vpk\\englishclient_mp_common.bsp.pak000_dir.vpk",bytes),entry("vpk/client_mp_common.bsp.pak000_000.vpk",bytes));
  assert.deepEqual([...parseManifest(data).files.keys()],["r2/paks/win64/pc_stream.starpak"]);
  const parsed=parseManifest(data,{include});assert.equal(parsed.files.size,2);assert.equal(parsed.files.get("vpk/client_mp_common.bsp.pak000_000.vpk").chunks[0].SHA1,crypto.createHash("sha1").update(bytes).digest("hex"));assert.equal(parsed.files.get("vpk/englishclient_mp_common.bsp.pak000_dir.vpk").size,bytes.length);
});
test("generic manifest cannot authenticate unsafe accepted paths, duplicate resources or invalid chunk boundaries",()=>{
  const bytes=Buffer.from("original");assert.throws(()=>parseManifest(manifest(entry("../vpk/file.vpk",bytes)),{include:()=>true}),/路径/);
  assert.throws(()=>parseManifest(manifest(entry("vpk/client_mp_common.bsp.pak000_000.vpk",bytes),entry("vpk/client_mp_common.bsp.pak000_000.vpk",bytes)),{include}),/条目无效/);
  assert.throws(()=>parseManifest(manifest(entry("another/file",bytes)),{include}),error=>error.code==="EMPTY_RESOURCE_MANIFEST");
});
test("current installed depot discovery skips unrelated depots and rejects a different game folder",async t=>{
  const base=await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-steam-manifest-"));t.after(()=>fsp.rm(base,{recursive:true,force:true}));const game=path.join(base,"steamapps/common/Titanfall2"),cache=path.join(base,"depotcache");await fsp.mkdir(game,{recursive:true});await fsp.mkdir(cache);
  await fsp.writeFile(path.join(base,"steamapps/appmanifest_1237970.acf"),'"AppState"\n{\n"installdir" "Titanfall2"\n"InstalledDepots"\n{\n"1" { "manifest" "10" }\n"2" { "manifest" "20" }\n}\n"InstallScripts" {}\n}');
  const bytes=Buffer.from("original");await fsp.writeFile(path.join(cache,"1_10.manifest"),manifest(entry("unrelated.txt",bytes)));await fsp.writeFile(path.join(cache,"2_20.manifest"),manifest(entry("vpk/client_mp_common.bsp.pak000_000.vpk",bytes)));
  const found=await findManifest(game,{include});assert.equal(found.depot,"2");assert.equal(found.manifest,"20");assert.equal(found.files.size,1);assert.equal(await findManifest(path.join(base,"steamapps/common/Other"),{include}),null);
});
test("separate Steam libraries find the authenticated manifest in the main Steam cache",async t=>{
  const base=await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-steam-library-"));t.after(()=>fsp.rm(base,{recursive:true,force:true}));const game=path.join(base,"library/steamapps/common/Titanfall2"),steam=path.join(base,"main-steam"),cache=path.join(steam,"depotcache");await fsp.mkdir(game,{recursive:true});await fsp.mkdir(cache,{recursive:true});
  const launcher=path.join(steam,"steam.exe").replace(/\\/g,"\\\\");await fsp.writeFile(path.join(base,"library/steamapps/appmanifest_1237970.acf"),'"AppState"\n{\n"LauncherPath" "'+launcher+'"\n"installdir" "Titanfall2"\n"InstalledDepots"\n{\n"1" { "manifest" "10" }\n}\n"InstallScripts" {}\n}');
  await fsp.writeFile(path.join(cache,"1_10.manifest"),manifest(entry("vpk/client_mp_common.bsp.pak000_000.vpk",Buffer.from("original"))));const result=await findManifest(game,{include});assert.equal(path.resolve(result.path),path.join(cache,"1_10.manifest"));
});
