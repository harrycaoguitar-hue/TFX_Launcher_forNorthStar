"use strict";
const os = require("node:os");
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const compatibility=require("../src/modules/mod-compatibility"),state=require("../src/modules/mod-enabled-state");
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex"),root=fs.mkdtempSync(path.join(os.tmpdir(), "tfx-mod-compatibility-"));
function fixture(){
 const base=fs.mkdtempSync(path.join(root,"case-")),profile=path.join(base,"game","R2Northstar"),folder=path.join(profile,"mods","Test.Ghost"),file=path.join(folder,"mod.json"),backupRoot=path.join(base,"backups");fs.mkdirSync(path.join(folder,"paks"),{recursive:true});
 const original=Buffer.from('{\r\n    "Name" : "Ghost (MW2 2022)",\r\n    "Description": "keep 1 unchanged",\r\n    "LoadPriority": 1,\r\n    "Authors": ["test"],\r\n    "Version": "1.0"\r\n}\r\n');fs.writeFileSync(file,original);
 const assets={};for(const name of ["ghost_head","ghost_lowerbody","ghost_upperbody"]){const bytes=Buffer.from("fixture:"+name),relative="paks/"+name+".rpak";fs.writeFileSync(path.join(folder,relative),bytes);assets[relative]=sha(bytes);}const pakConfig=Buffer.from('{"Postload":{"ghost_head.rpak":"common.rpak"}}');fs.writeFileSync(path.join(folder,"paks/rpak.json"),pakConfig);assets["paks/rpak.json"]=sha(pakConfig);
 const rule={...compatibility.RULES[0],manifestSHA256:sha(original),assets},rules=[rule];
 const enableFile=path.join(profile,"enabledmods.json"),enableBytes=Buffer.from('{"Ghost (MW2 2022)":false}\r\n');fs.writeFileSync(enableFile,enableBytes);
 const manager=compatibility.createManager({rules}),prepare=(region="global",options={})=>manager.prepare(profile,region,{clientVersion:"1.31.13",backupRoot,...options});
 return {base,profile,folder,file,backupRoot,original,rule,rules,enableFile,enableBytes,manager,prepare,read:()=>JSON.parse(fs.readFileSync(file)),bytes:()=>fs.readFileSync(file)};
}
test("production rules and injected rules reject malformed SHA values before any file inspection",()=>{
 for(const rule of compatibility.RULES){assert.match(rule.manifestSHA256,/^[a-f0-9]{64}$/);for(const digest of Object.values(rule.assets))assert.match(digest,/^[a-f0-9]{64}$/);}
 const f=fixture();assert.throws(()=>compatibility.createManager({rules:[{...f.rule,manifestSHA256:"a".repeat(63)}]}),/规则/);assert.throws(()=>compatibility.createManager({rules:[{...f.rule,assets:{"paks/ghost_head.rpak":"a".repeat(63)}}]}),/规则/);assert.deepEqual(f.bytes(),f.original);
});
test("exact known fingerprint changes only priority digits, snapshots bytes, and never edits enable choices",async()=>{
 const f=fixture(),r=await f.prepare();assert.equal(r.changed,true);assert.deepEqual(r.applied.map(x=>[x.name,x.fromPriority,x.toPriority]),[[f.rule.name,1,100]]);assert.equal(f.read().LoadPriority,100);
 const intended=Buffer.from(f.original.toString().replace('"LoadPriority": 1','"LoadPriority": 100'));assert.deepEqual(f.bytes(),intended);assert.deepEqual(fs.readFileSync(r.applied[0].backup),f.original);assert.deepEqual(fs.readFileSync(f.enableFile),f.enableBytes);
 const journal=JSON.parse(fs.readFileSync(r.journal));assert.equal(journal.entries[0].phase,"applied");assert.equal(journal.entries[0].originalSHA256,sha(f.original));assert.equal(journal.entries[0].modifiedSHA256,sha(intended));assert.equal(journal.entries[0].path,"mods/Test.Ghost/mod.json");
 const again=await f.prepare();assert.equal(again.changed,false);assert.deepEqual(again.applied,[]);assert.deepEqual(again.active,[{name:f.rule.name,version:"1.0",priority:100}]);assert.deepEqual(f.bytes(),intended);
});
test("CN and vanilla restore exact original, and subsequent Global reuses protected snapshot",async()=>{
 for(const region of ["cn","vanilla"]){const f=fixture(),r=await f.prepare(),restored=await f.prepare(region,{clientVersion:undefined});assert.equal(restored.changed,true);assert.deepEqual(restored.restored,[{name:f.rule.name,version:"1.0"}]);assert.deepEqual(f.bytes(),f.original);assert.deepEqual(fs.readFileSync(r.applied[0].backup),f.original);assert.equal((await f.prepare(region,{clientVersion:undefined})).changed,false);assert.equal((await f.prepare()).applied.length,1);assert.equal(f.read().LoadPriority,100);assert.deepEqual(fs.readFileSync(f.enableFile),f.enableBytes);}
});
test("unknown client, name, version, priority, manifest byte and assets leave files untouched",async()=>{
 for(const mutation of [f=>{const m=f.read();m.Name="Another.Ghost";fs.writeFileSync(f.file,JSON.stringify(m));},f=>{const m=f.read();m.Version="2.0";fs.writeFileSync(f.file,JSON.stringify(m));},f=>{const m=f.read();m.LoadPriority=2;fs.writeFileSync(f.file,JSON.stringify(m));},f=>fs.appendFileSync(f.file," "),f=>fs.writeFileSync(path.join(f.folder,"paks/ghost_head.rpak"),"unknown"),f=>fs.writeFileSync(path.join(f.folder,"paks/rpak.json"),'{"Postload":{}}')]){const f=fixture();mutation(f);const bytes=f.bytes(),r=await f.prepare();assert.equal(r.changed,false);assert.deepEqual(r.applied,[]);assert.deepEqual(r.active,[]);assert.equal(r.journal,null);assert.deepEqual(f.bytes(),bytes);}
 const f=fixture(),bytes=f.bytes();const r=await f.prepare("global",{clientVersion:"1.31.14"});assert.equal(r.changed,false);assert.equal(r.journal,null);assert.deepEqual(f.bytes(),bytes);
});
test("foreign manifest edit conflicts with managed entry and is never overwritten",async()=>{
 const f=fixture(),r=await f.prepare();fs.appendFileSync(f.file," // user's external edit");const bytes=f.bytes();await assert.rejects(f.prepare("cn"),error=>error.code==="MOD_COMPATIBILITY_CONFLICT");assert.deepEqual(f.bytes(),bytes);assert.deepEqual(fs.readFileSync(r.applied[0].backup),f.original);
});
test("awaited process guard stops commits if game starts during target write",async()=>{
 const f=fixture();let calls=0;await assert.rejects(f.prepare("global",{guard:async()=>{await Promise.resolve();calls++;if(fs.readdirSync(f.folder).some(name=>name.startsWith("mod.json.tfx-")))throw Error("game now running");}}),/game now running/);assert.ok(calls>3);assert.deepEqual(f.bytes(),f.original);assert.equal(fs.readdirSync(f.folder).some(name=>name.endsWith(".tmp")),false);
 const retry=await f.prepare();assert.equal(retry.applied.length,1);assert.equal(f.read().LoadPriority,100);
});
test("failed journal creation prevents manifest commit and retains immutable snapshot",async()=>{
 const f=fixture(),manager=compatibility.createManager({rules:f.rules,storage:{...state,writeGuarded:async(file,...args)=>{if(path.basename(file)==="journal.json")throw Error("disk full journal");return state.writeGuarded(file,...args);}}});await assert.rejects(manager.prepare(f.profile,"global",{clientVersion:"1.31.13",backupRoot:f.backupRoot}),/disk full journal/);assert.deepEqual(f.bytes(),f.original);
 const r=await f.prepare();assert.deepEqual(fs.readFileSync(r.applied[0].backup),f.original);assert.equal(f.read().LoadPriority,100);
});
test("failed manifest write leaves recoverable prepared journal and clean original bytes",async()=>{
 const f=fixture(),manager=compatibility.createManager({rules:f.rules,storage:{...state,writeGuarded:async(file,...args)=>{if(file===f.file)throw Error("manifest locked");return state.writeGuarded(file,...args);}}});await assert.rejects(manager.prepare(f.profile,"global",{clientVersion:"1.31.13",backupRoot:f.backupRoot}),/manifest locked/);assert.deepEqual(f.bytes(),f.original);assert.equal((await f.prepare()).applied.length,1);assert.equal(f.read().LoadPriority,100);
});
test("interruption after manifest commit is recovered from durable prepared journal",async()=>{
 for(const region of ["global","vanilla"]){const f=fixture();let journalWrites=0;const manager=compatibility.createManager({rules:f.rules,storage:{...state,writeGuarded:async(file,...args)=>{if(path.basename(file)==="journal.json"&&++journalWrites===2)throw Error("interrupted final journal");return state.writeGuarded(file,...args);}}});await assert.rejects(manager.prepare(f.profile,"global",{clientVersion:"1.31.13",backupRoot:f.backupRoot}),/interrupted final journal/);assert.equal(f.read().LoadPriority,100);const result=await f.prepare(region);assert.equal(JSON.parse(fs.readFileSync(result.journal)).entries[0].phase,region==="global"?"applied":"restored");if(region==="global"){assert.equal(result.changed,false);assert.equal(result.active.length,1);}else{assert.equal(result.restored.length,1);assert.deepEqual(f.bytes(),f.original);}}
});
test("asset mutation during write guard prevents adjustment and retains current manifest",async()=>{
 const f=fixture();await assert.rejects(f.prepare("global",{guard:async()=>{if(fs.readdirSync(f.folder).some(name=>name.startsWith("mod.json.tfx-")))fs.writeFileSync(path.join(f.folder,"paks/ghost_head.rpak"),"external asset edit");}}),/资源.*发生变化/);assert.deepEqual(f.bytes(),f.original);
});
test("managed active asset replacement is reported as a conflict and can restore safely for CN",async()=>{
 const f=fixture();await f.prepare();fs.writeFileSync(path.join(f.folder,"paks/rpak.json"),"external configuration");const current=f.bytes();await assert.rejects(f.prepare(),error=>error.code==="MOD_COMPATIBILITY_CONFLICT");assert.deepEqual(f.bytes(),current);const restored=await f.prepare("cn");assert.equal(restored.restored.length,1);assert.deepEqual(f.bytes(),f.original);
});
test("restore CAS rejects a concurrent manifest edit while retaining foreign bytes",async()=>{
 const f=fixture();await f.prepare();const foreign=Buffer.from('{"user":"new manifest"}');await assert.rejects(f.prepare("cn",{guard:async()=>{if(fs.readdirSync(f.folder).some(name=>name.startsWith("mod.json.tfx-")))fs.writeFileSync(f.file,foreign);}}),/其他程序/);assert.deepEqual(f.bytes(),foreign);
});
test("profile and asset junction paths reject without following links",async()=>{
 const f=fixture(),linked=path.join(f.base,"linked-profile");fs.symlinkSync(f.profile,linked,"junction");await assert.rejects(f.manager.prepare(linked,"global",{clientVersion:"1.31.13",backupRoot:f.backupRoot}),/链接/);assert.deepEqual(f.bytes(),f.original);
 const asset=path.join(f.folder,"paks/ghost_head.rpak"),other=path.join(f.base,"external.rpak");fs.writeFileSync(other,fs.readFileSync(asset));fs.unlinkSync(asset);fs.symlinkSync(other,asset,"file");await assert.rejects(f.prepare(),/路径无效/);assert.deepEqual(f.bytes(),f.original);
});
test("journal profile corruption and snapshot corruption cannot restore arbitrary bytes",async()=>{
 const f=fixture(),r=await f.prepare(),bytes=f.bytes();const journal=JSON.parse(fs.readFileSync(r.journal));journal.profile=path.join(f.base,"elsewhere");fs.writeFileSync(r.journal,JSON.stringify(journal));await assert.rejects(f.prepare("cn"),/来源无效/);assert.deepEqual(f.bytes(),bytes);
 const g=fixture(),s=await g.prepare(),current=g.bytes();fs.writeFileSync(s.applied[0].backup,"damaged");await assert.rejects(g.prepare("vanilla"),/校验失败/);assert.deepEqual(g.bytes(),current);
});
test("uninstalling a managed mod never recreates it or blocks another region",async()=>{
 const f=fixture(),r=await f.prepare();fs.unlinkSync(f.file);
 for(const region of ["global","cn","vanilla"]){const result=await f.prepare(region);assert.equal(result.changed,false);assert.deepEqual(result.active,[]);assert.equal(fs.existsSync(f.file),false);assert.equal(JSON.parse(fs.readFileSync(r.journal)).entries[0].phase,"restored");}
 fs.writeFileSync(f.file,f.original);const reinstall=await f.prepare();assert.equal(reinstall.applied.length,1);assert.equal(f.read().LoadPriority,100);
});
test("overlapping prepares on the same profile reject before a second manifest transaction",async()=>{
 const f=fixture();let release,ready,calls=0;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>ready=resolve);
 const first=f.prepare("global",{guard:async()=>{if(++calls===2){ready();await gate;}}});await started;
 await assert.rejects(f.prepare(),/正在执行/);assert.deepEqual(f.bytes(),f.original);release();assert.equal((await first).applied.length,1);assert.equal(f.read().LoadPriority,100);
});

test.after(() => {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("tfx-mod-compatibility-"));
  const stat = fs.lstatSync(root); assert(stat.isDirectory() && !stat.isSymbolicLink());
  fs.rmSync(root, {recursive: true, force: true});
});
