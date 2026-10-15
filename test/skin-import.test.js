'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {SkinImporter,classify,parseListing,scanDirectory,messages}=require('../src/modules/skin-import');
const listing=entries=>entries.map(entry=>`Path = ${entry.name}\nSize = ${entry.bytes??4}\nFolder = ${entry.directory?'+':'-'}\nEncrypted = -\n${entry.extra||''}`).join('\n\n');
async function fixture(t){
  const home=await fsp.mkdtemp(path.join(os.tmpdir(),'tfx-shared-intake-'));t.after(()=>fsp.rm(home,{recursive:true,force:true}));
  const calls=[],engines={};
  for(const kind of ['dds','vtf'])engines[kind]={baseDir:path.join(home,kind),packages:new Map(),selected:'previous-'+kind,active:false,
    invalidateSelection(){this.selected=null;calls.push(['clear',kind]);},isImportBusy(){return this.active;},
    async importSelection(_event,source){calls.push(['inspect',kind,source]);this.selected='new-'+kind;return {ok:true,package:{id:this.selected,name:path.basename(source),files:[],count:1,bytes:4},selectionRevision:2};}
  };
  engines.vtf.tool=async args=>{calls.push(['tool',args]);if(args[0]==='l')return engines.listing;throw Error('Unexpected extraction');};
  const mods={active:false,isImportBusy(){return this.active;},async install(source,options){calls.push(['install-mod',source,options]);return {ok:true,name:'Example.Mod',names:['Example.Mod'],modCount:1};}};
  return {home,calls,engines,mods,importer:new SkinImporter({...engines,mods,stagingDir:path.join(home,'stage')})};
}
test('archive classification rejects DDS/VTF mixtures, unsupported payloads and metadata-only bundles',()=>{
  assert.equal(classify([{name:'skin/car.dds',bytes:4}]),'dds');
  assert.equal(classify([{name:'skin/car.dds',bytes:4},{name:'说明/注意.docx',bytes:64}]),'dds');
  assert.equal(classify([{name:'materials/car.vtf',bytes:4},{name:'materials/car.vmt',bytes:8}]),'vtf');
  assert.throws(()=>classify([{name:'car.dds',bytes:4},{name:'materials/car.vtf',bytes:4}]),new RegExp(messages.mixed));
  assert.throws(()=>classify([{name:'materials/car.vtf',bytes:4},{name:'run.exe',bytes:4}]),new RegExp(messages.unsupported));
  assert.throws(()=>classify([{name:'readme.txt',bytes:4}]),new RegExp(messages.empty));
});
test('archive preflight rejects traversal, duplicate paths, links, encryption, ancestor collisions and oversized files',()=>{
  for(const value of [listing([{name:'../escape.dds'}]),listing([{name:'car.dds'},{name:'CAR.dds'}]),listing([{name:'car.dds',extra:'Symbolic Link = elsewhere'}]),listing([{name:'materials'},{name:'materials/car.vtf'}])])assert.throws(()=>parseListing(value),new RegExp(messages.unsafe));
  assert.throws(()=>parseListing(listing([{name:'car.dds',extra:'Encrypted = +'}])),new RegExp(messages.archive));
  assert.throws(()=>classify(parseListing(listing([{name:'car.dds',bytes:600*1024**2}]))),new RegExp(messages.limit));
});
test('a renamed archive is routed using contents and VTF extraction remains solely owned by its engine',async t=>{
  const f=await fixture(t),source=path.join(f.home,'skin.bin');await fsp.writeFile(source,'archive');f.engines.listing=listing([{name:'materials/car.vtf'}]);
  const result=await f.importer.run({},()=>source);assert.equal(result.ok,true);assert.equal(result.format,'vtf');
  assert.deepEqual(f.calls.filter(call=>call[0]==='tool').map(call=>call[1][0]),['l']);
  assert.deepEqual(f.calls.filter(call=>call[0]==='inspect').map(call=>call.slice(1)),[['vtf',source]]);assert.equal(f.engines.dds.selected,null);
});
test('DDS ZIP preflight never performs a duplicate extraction',async t=>{
  const f=await fixture(t),source=path.join(f.home,'skin.zip');await fsp.writeFile(source,Buffer.from([0x50,0x4b,0x03,0x04]));f.engines.listing=listing([{name:'car.dds'}]);
  const result=await f.importer.run({},()=>source);assert.equal(result.ok,true);assert.equal(result.format,'dds');
  assert.deepEqual(f.calls.filter(call=>call[0]==='tool').map(call=>call[1][0]),['l']);
  assert.equal(f.calls.find(call=>call[0]==='inspect')[2],source);
});
test('VTF archive named DDS receives a neutral private archive name without duplicate extraction',async t=>{
  const f=await fixture(t),source=path.join(f.home,'skin.dds');await fsp.writeFile(source,'7z header');f.engines.listing=listing([{name:'materials/car.vtf'}]);
  const result=await f.importer.run({},()=>source);assert.equal(result.ok,true);assert.equal(result.format,'vtf');
  assert.deepEqual(f.calls.filter(call=>call[0]==='tool').map(call=>call[1][0]),['l']);const input=f.calls.find(call=>call[0]==='inspect')[2];assert.match(input,/\.archive$/);assert.equal(fs.existsSync(input),false);assert.equal(result.state.package.name,'skin.dds');
});
test('DDS 7z/RAR is extracted once into bounded staging and removed after engine adoption',async t=>{
  const f=await fixture(t),source=path.join(f.home,'skin.rar');await fsp.writeFile(source,'archive');f.engines.listing=listing([{name:'nested/car.dds'}]);
  f.engines.vtf.tool=async args=>{f.calls.push(['tool',args]);if(args[0]==='l')return f.engines.listing;const output=args.find(value=>value.startsWith('-o')).slice(2);await fsp.mkdir(path.join(output,'nested'),{recursive:true});await fsp.writeFile(path.join(output,'nested/car.dds'),'DDS ');};
  const result=await f.importer.run({},()=>source);assert.equal(result.ok,true);assert.equal(result.state.package.name,'skin.rar');
  assert.deepEqual(f.calls.filter(call=>call[0]==='tool').map(call=>call[1][0]),['l','x']);
  assert.equal(fs.existsSync(f.calls.find(call=>call[0]==='inspect')[2]),false);assert.deepEqual(await fsp.readdir(path.join(f.home,'stage')),[]);
});
test('a 7z archive named ZIP is extracted by content-capable tool and loose DDS renamed ZIP gets a normalized private copy',async t=>{
  const f=await fixture(t),archive=path.join(f.home,'skin.zip');await fsp.writeFile(archive,'7z header');f.engines.listing=listing([{name:'car.dds'}]);
  f.engines.vtf.tool=async args=>{f.calls.push(['tool',args]);if(args[0]==='l')return f.engines.listing;const output=args.find(value=>value.startsWith('-o')).slice(2);await fsp.writeFile(path.join(output,'car.dds'),'DDS ');};
  assert.equal((await f.importer.run({},()=>archive)).ok,true);assert.deepEqual(f.calls.filter(call=>call[0]==='tool').map(call=>call[1][0]),['l','x']);
  const loose=path.join(f.home,'car.zip');await fsp.writeFile(loose,'DDS ');const result=await f.importer.run({},()=>loose);assert.equal(result.ok,true);const input=f.calls.filter(call=>call[0]==='inspect').at(-1)[2];assert.match(input,/car\.dds$/);assert.equal(fs.existsSync(input),false);
});
test('mixed package rejection invalidates both prior selections without engine inspection',async t=>{
  const f=await fixture(t),source=path.join(f.home,'mixed.zip');await fsp.writeFile(source,'archive');f.engines.listing=listing([{name:'car.dds'},{name:'materials/car.vtf'}]);
  const result=await f.importer.run({},()=>source);assert.equal(result.ok,false);assert.match(result.error,/同时包含 DDS 和 VTF/);
  assert.equal(f.engines.dds.selected,null);assert.equal(f.engines.vtf.selected,null);assert.equal(f.calls.some(call=>call[0]==='inspect'),false);
});
test('engine header/layout rejection clears both selections after correct filename classification',async t=>{
  const f=await fixture(t),source=path.join(f.home,'bad.zip');await fsp.writeFile(source,Buffer.from([0x50,0x4b,0x03,0x04]));f.engines.listing=listing([{name:'car.dds'}]);
  f.engines.dds.importSelection=async()=>({ok:false,error:'DDS header invalid'});
  const result=await f.importer.run({},()=>source);assert.equal(result.ok,false);assert.equal(result.error,'DDS header invalid');assert.equal(f.engines.dds.selected,null);assert.equal(f.engines.vtf.selected,null);
});
test('picker cancellation clears previous selections and never attempts inspection',async t=>{
  const f=await fixture(t),result=await f.importer.run({},()=>null);assert.equal(result.cancelled,true);assert.equal(f.engines.dds.selected,null);assert.equal(f.engines.vtf.selected,null);assert.equal(f.calls.some(call=>call[0]==='inspect'),false);
});
test('a second rapid import cannot replace an in-flight selection or install a previous package',async t=>{
  const f=await fixture(t);let release;const wait=new Promise(resolve=>{release=resolve;});const first=f.importer.run({},()=>wait);
  assert.equal(f.engines.dds.selected,null);assert.equal(f.engines.vtf.selected,null);
  const second=await f.importer.run({},()=>'/must-not-be-read.zip');assert.equal(second.ok,false);assert.match(second.error,/另一个皮肤操作/);release(null);assert.equal((await first).cancelled,true);
});
test('shared import reserves both legacy engine endpoints for its complete picker/probe operation',async t=>{
  const f=await fixture(t);let release;const wait=new Promise(resolve=>{release=resolve;});const operation=f.importer.run({},()=>wait);
  assert.equal(f.engines.dds.sharedImportBusy,true);assert.equal(f.engines.vtf.sharedImportBusy,true);release(null);await operation;
  assert.equal(f.engines.dds.sharedImportBusy,false);assert.equal(f.engines.vtf.sharedImportBusy,false);
  const dds=await fsp.readFile(path.join(__dirname,'../src/modules/dds.js'),'utf8'),vtf=await fsp.readFile(path.join(__dirname,'../src/modules/vtf.js'),'utf8');
  assert.match(dds,/engine\.busy\|\|engine\.sharedImportBusy/);assert.match(dds,/engine\.sharedImportBusy&&!sharedImport/);assert.match(dds,/gate\.busy\|\|engine\.sharedImportBusy/);assert.match(vtf,/engine\.sharedImportBusy&&!sharedImport/);
});
test('a running skin operation preserves its live selection and rejects intake',async t=>{
  const f=await fixture(t);f.engines.vtf.active=true;const result=await f.importer.run({},()=>null);
  assert.equal(result.ok,false);assert.equal(f.engines.vtf.selected,'previous-vtf');assert.equal(f.calls.length,0);
});
test('loose DDS uses its magic header while loose VTF receives the path-preserving folder explanation',async t=>{
  const f=await fixture(t),dds=path.join(f.home,'car.dds'),vtf=path.join(f.home,'car.vtf');await fsp.writeFile(dds,'DDS ');await fsp.writeFile(vtf,'VTF\0');
  assert.equal((await f.importer.run({},()=>dds)).format,'dds');const bad=await f.importer.run({},()=>vtf);assert.equal(bad.ok,false);assert.equal(bad.error,messages.looseVtf);assert.equal(f.engines.dds.selected,null);
});
test('folder detection scans actual files and rejects DDS/VTF mixtures before any engine work',async t=>{
  const f=await fixture(t),folder=path.join(f.home,'folder');await fsp.mkdir(path.join(folder,'materials'),{recursive:true});await fsp.writeFile(path.join(folder,'car.dds'),'DDS ');await fsp.writeFile(path.join(folder,'materials/car.vtf'),'VTF\0');
  assert.equal((await scanDirectory(folder)).length,2);const result=await f.importer.run({},()=>folder);assert.equal(result.ok,false);assert.match(result.error,/同时包含 DDS 和 VTF/);assert.equal(f.calls.some(call=>call[0]==='inspect'),false);
});
test('a linked parent is rejected before scanning and folder changes during engine adoption invalidate selections',async t=>{
  const f=await fixture(t),folder=path.join(f.home,'folder');await fsp.mkdir(folder);await fsp.writeFile(path.join(folder,'car.dds'),'DDS ');
  const linked=path.join(f.home,'linked');await fsp.symlink(folder,linked,process.platform==='win32'?'junction':'dir');const linkedResult=await f.importer.run({},()=>linked);assert.equal(linkedResult.ok,false);assert.match(linkedResult.error,/不安全/);
  f.engines.dds.importSelection=async()=>{await fsp.writeFile(path.join(folder,'car.dds'),'changed');return {ok:true,package:{id:'new',name:'folder',files:[]}};};
  const changed=await f.importer.run({},()=>folder);assert.equal(changed.ok,false);assert.equal(changed.error,messages.changed);assert.equal(f.engines.dds.selected,null);assert.equal(f.engines.vtf.selected,null);
});

async function modFolder(f,{name='Example.Mod',invalid=false,textures=true}={}){
  const folder=path.join(f.home,'Mod '+f.calls.length);await fsp.mkdir(folder,{recursive:true});
  await fsp.writeFile(path.join(folder,'mod.json'),invalid?'invalid JSON':JSON.stringify({Name:name,Version:'1.0.0'}));
  if(textures){await fsp.mkdir(path.join(folder,'materials'));await fsp.writeFile(path.join(folder,'materials','car.vtf'),'VTF\0');await fsp.writeFile(path.join(folder,'car.dds'),'DDS ');}
  return folder;
}
test('Mod definition takes priority over its bundled DDS/VTF resources and inspection never installs',async t=>{
  const f=await fixture(t),source=await modFolder(f);const result=await f.importer.run({},()=>source);
  assert.equal(result.ok,true);assert.equal(result.format,'mod');assert.deepEqual(result.state.package.modNames,['Example.Mod']);assert.equal(result.state.package.count,3);
  assert.match(result.state.package.id,/^[a-f0-9]{36}$/);assert.equal(f.calls.some(call=>['inspect','install-mod'].includes(call[0])),false);
  assert.equal(f.engines.dds.selected,null);assert.equal(f.engines.vtf.selected,null);assert(fs.existsSync(f.importer.pendingMod.input));
});
test('valid Mod snapshot installs once via guarded manager, reports progress and leaves original input unchanged',async t=>{
  const f=await fixture(t),source=await modFolder(f),original=await fsp.readFile(path.join(source,'mod.json'));const result=await f.importer.run({},()=>source),events=[];
  f.mods.install=async(input,options)=>{assert.equal(f.mods.sharedImportBusy,true);assert.equal(f.engines.dds.sharedImportBusy,true);assert.equal(f.engines.vtf.sharedImportBusy,true);assert.notEqual(input,source);assert.deepEqual(await fsp.readFile(path.join(input,'mod.json')),original);options.onProgress({phase:'staging',percent:80});f.calls.push(['install-mod',input]);return {ok:true,name:'Example.Mod',names:['Example.Mod']};};
  const installed=await f.importer.install({sender:{send:(...args)=>events.push(args)}},{id:result.state.package.id});
  assert.equal(installed.ok,true);assert.equal(installed.format,'mod');assert.equal(f.calls.filter(call=>call[0]==='install-mod').length,1);assert.equal(f.importer.pendingMod,null);assert.equal(f.mods.sharedImportBusy,false);
  assert.deepEqual(events.filter(event=>event[0]==='skin-import-progress').map(event=>event[1].percent),[5,80,100]);assert.deepEqual(events.at(-1),['set-buttons',true]);assert.deepEqual(await fsp.readFile(path.join(source,'mod.json')),original);
  assert.equal((await f.importer.install({},{id:result.state.package.id})).ok,false);assert.equal(f.calls.filter(call=>call[0]==='install-mod').length,1);assert.deepEqual(await fsp.readdir(path.join(f.home,'stage')),[]);
});
test('malformed Mod json does not fall back to the bundled VTF or DDS and clears an older Mod',async t=>{
  const f=await fixture(t),source=await modFolder(f);const old=await f.importer.run({},()=>source);const pendingPath=f.importer.pendingMod.input;
  await fsp.writeFile(path.join(source,'mod.json'),'[]');const invalid=await f.importer.run({},()=>source);
  assert.equal(invalid.ok,false);assert.equal(invalid.format,'mod');assert.match(invalid.error,/mod\.json 无效/);assert.equal(f.importer.pendingMod,null);assert.equal(fs.existsSync(pendingPath),false);
  assert.equal((await f.importer.install({},{id:old.state.package.id})).ok,false);assert.equal(f.calls.some(call=>call[0]==='inspect'||call[0]==='install-mod'),false);
});
test('unsupported input, picker cancel, clear and skin replacement all invalidate the pending Mod token',async t=>{
  const f=await fixture(t),source=await modFolder(f),bad=path.join(f.home,'bad.txt'),dds=path.join(f.home,'car.dds');await fsp.writeFile(bad,'invalid');await fsp.writeFile(dds,'DDS ');f.engines.listing=listing([{name:'readme.txt'}]);
  for(const action of [()=>f.importer.run({},()=>bad),()=>f.importer.run({},()=>null),()=>f.importer.clear(),()=>f.importer.run({},()=>dds)]){
    const selected=await f.importer.run({},()=>source),previous=f.importer.pendingMod.input;await action();assert.equal(f.importer.pendingMod,null);assert.equal(fs.existsSync(previous),false);assert.equal((await f.importer.install({},{id:selected.state.package.id})).ok,false);
  }
  assert.equal(f.calls.some(call=>call[0]==='install-mod'),false);
});
test('RAR/7z Mod archives with misleading extensions extract once and validate before adoption',async t=>{
  const f=await fixture(t),source=path.join(f.home,'Mod.dds'),definition=JSON.stringify({Name:'Example.Mod',Version:'1'});await fsp.writeFile(source,'7z header');f.engines.listing=listing([{name:'mod.json',bytes:Buffer.byteLength(definition)},{name:'materials/car.vtf',bytes:4}]);
  f.engines.vtf.tool=async args=>{f.calls.push(['tool',args]);if(args[0]==='l')return f.engines.listing;const output=args.find(value=>value.startsWith('-o')).slice(2);await fsp.writeFile(path.join(output,'mod.json'),definition);await fsp.mkdir(path.join(output,'materials'));await fsp.writeFile(path.join(output,'materials/car.vtf'),'VTF\0');};
  const result=await f.importer.run({},()=>source);assert.equal(result.ok,true);assert.equal(result.format,'mod');assert.deepEqual(f.calls.filter(call=>call[0]==='tool').map(call=>call[1][0]),['l','x']);assert.equal(f.calls.some(call=>call[0]==='inspect'),false);
});
test('a nested or duplicate Mod is rejected before any installation',async t=>{
  const f=await fixture(t),source=await modFolder(f);await fsp.mkdir(path.join(source,'child'));await fsp.writeFile(path.join(source,'child','mod.json'),JSON.stringify({Name:'Example.Child'}));const nested=await f.importer.run({},()=>source);assert.equal(nested.ok,false);assert.match(nested.error,/嵌套/);
  const collection=path.join(f.home,'collection');for(const name of ['one','two']){await fsp.mkdir(path.join(collection,name),{recursive:true});await fsp.writeFile(path.join(collection,name,'mod.json'),JSON.stringify({Name:'Example.Same'}));}
  const duplicate=await f.importer.run({},()=>collection);assert.equal(duplicate.ok,false);assert.match(duplicate.error,/重复的模组名称/);assert.equal(f.calls.some(call=>call[0]==='install-mod'),false);
});
test('pending snapshot tampering and stale tokens cannot install a previous Mod',async t=>{
  const f=await fixture(t),source=await modFolder(f),selected=await f.importer.run({},()=>source);await fsp.writeFile(path.join(f.importer.pendingMod.input,'car.dds'),'altered');const result=await f.importer.install({},{id:selected.state.package.id});assert.equal(result.ok,false);assert.equal(result.error,messages.changed);assert.equal(f.calls.some(call=>call[0]==='install-mod'),false);assert.equal(f.importer.pendingMod,null);
});
test('Mod operations reserve shared intake; a second install, clear and import cannot mutate an active operation',async t=>{
  const f=await fixture(t),source=await modFolder(f),selected=await f.importer.run({},()=>source);let release;const wait=new Promise(resolve=>release=resolve);f.mods.install=async()=>{await wait;return {ok:true};};
  const active=f.importer.install({},{id:selected.state.package.id});while(!f.mods.sharedImportBusy)await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.importer.run({},()=>source)).ok,false);assert.equal((await f.importer.install({},{id:selected.state.package.id})).ok,false);assert.equal((await f.importer.clear()).ok,false);release();assert.equal((await active).ok,true);
  f.mods.active=true;assert.equal((await f.importer.run({},()=>source)).ok,false);assert.equal(f.mods.sharedImportBusy,false);
});
