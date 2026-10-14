"use strict";
const os = require("node:os");
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const adapter=require("../src/modules/mod-enabled-state");
const root=fs.mkdtempSync(path.join(os.tmpdir(), "tfx-mod-enabled-state-"));
function fixture(input={}) {
  const base=fs.mkdtempSync(path.join(root,"case-")),profile=path.join(base,"game","R2Northstar"),backupRoot=path.join(base,"backup");
  fs.mkdirSync(profile,{recursive:true});
  const put=(name,version="1.0",folder=name,packageName)=>{const file=path.join(profile,packageName?"packages":"mods",...(packageName?[packageName,"mods"]:[]),folder,"mod.json");fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({Name:name,Version:version}));return file;};
  for(const name of adapter.CORE_NAMES)put(name,"1.18.0");
  put("Personal.Off");put("Personal.On");
  const file=path.join(profile,"enabledmods.json");fs.writeFileSync(file,typeof input==="string"?input:JSON.stringify(input));
  return {base,profile,backupRoot,file,put,read:()=>JSON.parse(fs.readFileSync(file)),prepare:region=>adapter.prepare(profile,region,{backupRoot})};
}
test("Global release semantics: missing names/versions enable; exact false disables",()=>{
  const d=adapter.parse({Version:1,A:{old:false}});
  assert.equal(adapter.enabled(d,"A","old"),false);assert.equal(adapter.enabled(d,"A","new"),true);assert.equal(adapter.enabled(d,"B","1"),true);
});
test("CN repair preserves personal choices and backs up exact original plus old migration bytes",async()=>{
  const f=fixture({Version:1,"Northstar.Client":{"1.31.13":true},"Northstar.Custom":{"1.31.13":true},"Northstar.CustomServers":{"1.31.13":true},"Personal.Off":{"1.0":false},"Personal.On":{"1.0":true}});
  const original=fs.readFileSync(f.file),legacy=Buffer.from("{\"historical\": false}\r\n");fs.writeFileSync(path.join(f.profile,"enabledmods.old.json"),legacy);
  const r=await f.prepare("cn");assert.equal(r.format,"flat");assert.equal(f.read()["Personal.Off"],false);assert.equal(f.read()["Personal.On"],true);
  for(const name of adapter.CORE_NAMES)assert.equal(f.read()[name],true);
  assert.deepEqual(fs.readFileSync(r.backup),original);assert.deepEqual(fs.readFileSync(r.legacyBackup),legacy);assert.deepEqual(fs.readFileSync(path.join(f.profile,"enabledmods.old.json")),legacy);
  assert.equal((await f.prepare("cn")).changed,false);
});
test("CN to Global to CN preserves version history and uninstalled flat choices",async()=>{
  const f=fixture({Version:1,"Personal.Off":{"0.8":true,"1.0":false},"Personal.On":{"0.9":false,"1.0":true},"Uninstalled":{"2.0":false}});
  await f.prepare("cn");let flat=f.read();flat["Personal.Off"]=true;flat["Personal.On"]=false;flat["Flat.Orphan"]=false;fs.writeFileSync(f.file,JSON.stringify(flat));
  for(const name of adapter.CORE_NAMES)f.put(name,"1.31.13");
  await f.prepare("global");let global=f.read();assert.deepEqual(global["Personal.Off"],{"0.8":true,"1.0":true});assert.deepEqual(global["Personal.On"],{"0.9":false,"1.0":false});assert.deepEqual(global.Uninstalled,{"2.0":false});
  for(const name of adapter.CORE_NAMES)f.put(name,"1.18.0");
  await f.prepare("cn");assert.equal(f.read()["Personal.Off"],true);assert.equal(f.read()["Personal.On"],false);assert.equal(f.read()["Flat.Orphan"],false);
  for(const name of adapter.CORE_NAMES)f.put(name,"1.31.13");await f.prepare("global");assert.deepEqual(f.read()["Personal.On"],global["Personal.On"]);
});
test("projection carries one old choice and uses official true default for ambiguous versions",async()=>{
  const f=fixture({Version:1,"Personal.Off":{"old":false},"Personal.On":{"old":false,"older":true}});await f.prepare("cn");assert.equal(f.read()["Personal.Off"],false);assert.equal(f.read()["Personal.On"],true);
});
test("flat or versioned required core false is reenabled, without enabling personal mods",async()=>{
  for(const global of [false,true]){
    const f=fixture(global?{Version:1,"Northstar.Client":{"1.18.0":false},"Personal.Off":{"1.0":false}}:{"Northstar.Client":false,"Personal.Off":false});const r=await f.prepare(global?"global":"cn");assert.equal(r.coreReenabled,true);const d=adapter.parse(fs.readFileSync(f.file));assert.equal(adapter.enabled(d,"Northstar.Client","1.18.0"),true);assert.equal(adapter.enabled(d,"Personal.Off","1.0"),false);
  }
});
test("invalid, mixed, future, oversized, and malformed UTF8 documents are rejected intact",async()=>{
  for(const input of ["{bad",'[]','{"Version":2}', '{"Version":1,"A":false}','{"A":{"1":true}}', ' '.repeat(4*1024*1024+1),Buffer.from([0xff,0xfe])]){
    const f=fixture();fs.writeFileSync(f.file,input);const bytes=fs.readFileSync(f.file);await assert.rejects(f.prepare("cn"));assert.deepEqual(fs.readFileSync(f.file),bytes);
  }
});
test("incomplete or duplicate official core rejects before any configuration write",async()=>{
  const f=fixture({"Personal.Off":false}),original=fs.readFileSync(f.file);f.put("Northstar.Client","1","spoof","Fake-Package-1");await assert.rejects(f.prepare("cn"),/重复/);assert.deepEqual(fs.readFileSync(f.file),original);
  fs.unlinkSync(path.join(f.profile,"mods","Northstar.Client","mod.json"));await assert.rejects(f.prepare("cn"),/不完整/);assert.deepEqual(fs.readFileSync(f.file),original);
});
test("symbolic/junction profile and mod paths reject without touching target",async()=>{
  const f=fixture(),original=fs.readFileSync(f.file),link=path.join(f.base,"linked-profile");fs.symlinkSync(f.profile,link,"junction");await assert.rejects(adapter.prepare(link,"cn",{backupRoot:f.backupRoot}),/链接/);assert.deepEqual(fs.readFileSync(f.file),original);
  fs.symlinkSync(path.join(f.profile,"mods","Personal.Off"),path.join(f.profile,"mods","Linked.Mod"),"junction");await assert.rejects(f.prepare("cn"),/链接/);assert.deepEqual(fs.readFileSync(f.file),original);
});
test("asynchronous guard rejection prevents config commit; persisted metadata supports safe retry",async()=>{
  const f=fixture({Version:1,"Personal.Off":{"1.0":false}}),original=fs.readFileSync(f.file);let awaited=0;
  await assert.rejects(adapter.prepare(f.profile,"cn",{backupRoot:f.backupRoot,guard:async()=>{await Promise.resolve();awaited++;if(fs.readdirSync(f.profile).some(name=>name.startsWith("enabledmods.json.tfx-")))throw Error("game is starting");}}),/game is starting/);
  assert.ok(awaited>=5);assert.deepEqual(fs.readFileSync(f.file),original);assert.equal(fs.readdirSync(f.profile).filter(name=>name.endsWith(".tmp")).length,0);
  await f.prepare("cn");assert.equal(f.read()["Personal.Off"],false);
});
test("CAS detects a foreign config edit during async guard and preserves foreign bytes",async()=>{
  const f=fixture({Version:1,"Personal.Off":{"1.0":false}}),foreign=Buffer.from('{"other":false}');
  await assert.rejects(adapter.prepare(f.profile,"cn",{backupRoot:f.backupRoot,guard:async()=>{await Promise.resolve();if(fs.readdirSync(f.profile).some(name=>name.startsWith("enabledmods.json.tfx-")))fs.writeFileSync(f.file,foreign);}}),/其他程序/);assert.deepEqual(fs.readFileSync(f.file),foreign);
});
test("backup stores and history reject corrupted provenance and retain current bytes",async()=>{
  const f=fixture({"Personal.Off":false}),r=await f.prepare("cn"),before=fs.readFileSync(f.file),history=JSON.parse(fs.readFileSync(r.history));history.profile="D:/another/profile";fs.writeFileSync(r.history,JSON.stringify(history));await assert.rejects(f.prepare("global"),/来源/);assert.deepEqual(fs.readFileSync(f.file),before);
});
test("prototype-shaped names preserve boolean values without modifying object prototypes",()=>{
  const d=adapter.parse('{"Version":1,"__proto__":{"1":false},"constructor":{"2":true}}');assert.equal(adapter.enabled(d,"__proto__","1"),false);assert.equal(adapter.enabled(adapter.parse(adapter.serialize(d)),"constructor","2"),true);assert.equal({}.polluted,undefined);
});
test("spawn-time readiness is read-only, format-specific, and allows disabled personal mods",async()=>{
  const f=fixture({Version:1,"Personal.Off":{"1.0":false}});assert.throws(()=>adapter.assertReady(f.profile,"cn"),/不兼容/);assert.throws(()=>adapter.assertReady(f.profile,"global"),/未全部启用/);
  await f.prepare("cn");const bytes=fs.readFileSync(f.file);assert.equal(adapter.assertReady(f.profile,"cn").format,"flat");assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.read()["Personal.Off"],false);
  const d=f.read();d["Northstar.Client"]=false;fs.writeFileSync(f.file,JSON.stringify(d));assert.throws(()=>adapter.assertReady(f.profile,"cn"),/未全部启用/);
});

test("installed recognizes trailing-comma direct and packaged manifests without rewriting them",()=>{
  const f=fixture(),direct=f.put("Personal.Off"),packaged=f.put("Packaged.Off","2.4","skin","Local-Package");
  const directBytes=Buffer.from('{"Name":"Personal.Off","Version":"1.0","Scripts":[],}\r\n'),packageBytes=Buffer.from('\uFEFF{"Name":"Packaged.Off","Version":"2.4","Scripts":["a.nut",],}\n');
  fs.writeFileSync(direct,directBytes);fs.writeFileSync(packaged,packageBytes);
  const mods=adapter.installed(f.profile);
  assert.equal(mods.find(mod=>mod.name==="Personal.Off").version,"1.0");assert.equal(mods.find(mod=>mod.name==="Packaged.Off").version,"2.4");
  assert.deepEqual(fs.readFileSync(direct),directBytes);assert.deepEqual(fs.readFileSync(packaged),packageBytes);
});

test("CN flat to Global to CN preserves disabled trailing-comma mods, including packages",async()=>{
  const f=fixture({"Personal.Off":false,"Personal.On":true,"Packaged.Off":false}),direct=f.put("Personal.Off"),packaged=f.put("Packaged.Off","2.4","skin","Local-Package");
  fs.writeFileSync(direct,'{"Name":"Personal.Off","Version":"1.0",}');fs.writeFileSync(packaged,'{"Name":"Packaged.Off","Version":"2.4",}');
  const originals=[direct,packaged].map(file=>fs.readFileSync(file));
  await f.prepare("global");let state=f.read();assert.deepEqual(state["Personal.Off"],{"1.0":false});assert.deepEqual(state["Packaged.Off"],{"2.4":false});assert.equal(state["Personal.On"]["1.0"],true);
  assert.equal(adapter.enabled(adapter.parse(fs.readFileSync(f.file)),"Personal.Off","1.0"),false);assert.equal(adapter.enabled(adapter.parse(fs.readFileSync(f.file)),"Packaged.Off","2.4"),false);
  await f.prepare("cn");state=f.read();assert.equal(state["Personal.Off"],false);assert.equal(state["Packaged.Off"],false);assert.equal(state["Personal.On"],true);
  [direct,packaged].forEach((file,index)=>assert.deepEqual(fs.readFileSync(file),originals[index]));
});

test("Global to CN to Global preserves exact version choices on trailing-comma manifests",async()=>{
  const f=fixture({Version:1,"Personal.Off":{"0.9":true,"1.0":false},"Personal.On":{"1.0":true}}),manifest=f.put("Personal.Off");
  const bytes=Buffer.from('{"Name":"Personal.Off","Version":"1.0",}\n');fs.writeFileSync(manifest,bytes);
  await f.prepare("cn");assert.equal(f.read()["Personal.Off"],false);assert.equal(f.read()["Personal.On"],true);
  await f.prepare("global");assert.deepEqual(f.read()["Personal.Off"],{"0.9":true,"1.0":false});assert.equal(f.read()["Personal.On"]["1.0"],true);assert.deepEqual(fs.readFileSync(manifest),bytes);
});

test("unrepairable, non-object, wrong-field and invalid UTF8 manifests stay skipped and intact",async()=>{
  const f=fixture({"Personal.Off":false,"Malformed.Off":false}),bad=f.put("Malformed.Off"),inputs=['{"Name":"Malformed.Off","Version":[}}','null','[]','{"Name":"Malformed.Off","Version":1,}',Buffer.from([0xff,0xfe])];
  for(const input of inputs){fs.writeFileSync(bad,input);const bytes=fs.readFileSync(bad);assert.equal(adapter.installed(f.profile).some(mod=>mod.name==="Malformed.Off"),false);await f.prepare("global");assert.equal(adapter.enabled(adapter.parse(fs.readFileSync(f.file)),"Personal.Off","1.0"),false);await f.prepare("cn");assert.equal(f.read()["Malformed.Off"],false);assert.deepEqual(fs.readFileSync(bad),bytes);}
});

test.after(() => {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("tfx-mod-enabled-state-"));
  const stat = fs.lstatSync(root); assert(stat.isDirectory() && !stat.isSymbolicLink());
  fs.rmSync(root, {recursive: true, force: true});
});
