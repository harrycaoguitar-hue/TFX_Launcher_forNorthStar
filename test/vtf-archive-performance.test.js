'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {streamArchive,verifyArchive,hash,CHUNK_BYTES,serializeIndex,parseIndex}=require('../src/modules/vtf-vpk');
const {VtfEngine,INDEX_NAME,archiveName}=require('../src/modules/vtf-engine');
async function fixture(t,size=2*CHUNK_BYTES+17){
 const home=await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(),'tfx-vtf-throughput-')));t.after(()=>fsp.rm(home,{recursive:true,force:true}));
 const source=path.join(home,'source.vtf'),bytes=Buffer.alloc(size);for(let i=0;i<bytes.length;i++)bytes[i]=(i*37+(i>>>8))&255;await fsp.writeFile(source,bytes);
 const file={path:'materials/models/weapons/car/car_col.vtf',source,bytes:bytes.length,sha256:hash(bytes)},reference={path:file.path,index:0,crc:0,chunks:[{flags:0x101,textureFlags:0,offset:0,compressedSize:4,size:4}]},stage=path.join(home,'stage.vpk'),published=path.join(home,'published.vpk');
 const packed=await streamArchive([file],stage,1,[reference]);await fsp.link(stage,published);const expected={bytes:packed.bytes,sha256:packed.sha256,index:1,links:2};return{home,source,bytes,file,reference,stage,published,packed,expected};
}
test('published VTF readback checks asset SHA, CRC and full archive SHA in one bounded pass',async t=>{
 const f=await fixture(t),open=fsp.open;let readBytes=0,readCalls=0;
 fsp.open=async function(file,...args){const handle=await open.call(this,file,...args);if(path.resolve(file)===f.published){const read=handle.read.bind(handle);handle.read=async(...values)=>{const result=await read(...values);readCalls++;readBytes+=result.bytesRead;return result;};}return handle;};
 try{await verifyArchive(f.packed.entries,f.published,[f.file],()=>{},f.expected);}finally{fsp.open=open;}
 assert.equal(readBytes,f.bytes.length);assert.equal(readCalls,3);assert(f.packed.entries[0].chunks.every(chunk=>chunk.size<=CHUNK_BYTES));
});
test('published VTF readback rejects changed SHA, CRC, archive number, uncovered bytes and extra links',async t=>{
 const f=await fixture(t,65539);
 await assert.rejects(verifyArchive(f.packed.entries,f.published,[{...f.file,sha256:'0'.repeat(64)}],()=>{},f.expected),/校验码不一致/);
 await assert.rejects(verifyArchive([{...f.packed.entries[0],crc:1}],f.published,[f.file],()=>{},f.expected),/校验码不一致/);
 await assert.rejects(verifyArchive(f.packed.entries,f.published,[f.file],()=>{},{...f.expected,sha256:'0'.repeat(64)}),/归档校验失败/);
 await assert.rejects(verifyArchive(f.packed.entries,f.published,[f.file],()=>{},{...f.expected,index:2}),/归档编号/);
 const shifted=[{...f.packed.entries[0],chunks:f.packed.entries[0].chunks.map(chunk=>({...chunk,offset:chunk.offset+1}))}];await assert.rejects(verifyArchive(shifted,f.published,[f.file],()=>{},f.expected),/资源块不正确/);
 await fsp.appendFile(f.stage,'extra');await assert.rejects(verifyArchive(f.packed.entries,f.published,[f.file],()=>{},f.expected),/发生变化/);
 await fsp.truncate(f.stage,f.bytes.length);await fsp.link(f.published,path.join(f.home,'third-link'));await assert.rejects(verifyArchive(f.packed.entries,f.published,[f.file],()=>{},f.expected),/发生变化/);
});
test('published VTF readback handles partial reads and detects metadata changes before commit',async t=>{
 const f=await fixture(t,1027),open=fsp.open;let tamper=false,reads=0;
 fsp.open=async function(file,...args){const handle=await open.call(this,file,...args);if(path.resolve(file)===f.published){const read=handle.read.bind(handle),stat=handle.stat.bind(handle);handle.read=async(buffer,offset,length,position)=>{reads++;return read(buffer,offset,Math.min(length,97),position);};handle.stat=async()=>{const value=await stat();if(tamper&&reads){const changed=Object.create(value);changed.mtimeMs=value.mtimeMs+1000;return changed;}return value;};}return handle;};
 try{await verifyArchive(f.packed.entries,f.published,[f.file],()=>{},f.expected);assert(reads>1);reads=0;tamper=true;await assert.rejects(verifyArchive(f.packed.entries,f.published,[f.file],()=>{},f.expected),/发生变化/);}finally{fsp.open=open;}
});
async function engineFixture(t){
 const f=await fixture(t,84),skin=path.join(f.home,'skin/materials/models/weapons/car/car_col.vtf'),bytes=Buffer.alloc(84);bytes.write('VTF\0');bytes.writeUInt32LE(7,4);bytes.writeUInt32LE(2,8);bytes.writeUInt32LE(80,12);bytes.writeUInt16LE(1,16);bytes.writeUInt16LE(1,18);bytes.writeUInt16LE(1,24);bytes.writeInt32LE(0,52);bytes[56]=1;bytes.writeInt32LE(-1,57);bytes.writeUInt16LE(1,63);bytes.write('skin',80);await fsp.mkdir(path.dirname(skin),{recursive:true});await fsp.writeFile(skin,bytes);
 const game=path.join(f.home,'game'),vpk=path.join(game,'vpk');await fsp.mkdir(vpk,{recursive:true});await fsp.writeFile(path.join(game,'Titanfall2.exe'),'isolated fixture');const before=serializeIndex([f.reference]);await fsp.writeFile(path.join(vpk,INDEX_NAME),before);await fsp.writeFile(path.join(vpk,archiveName(0)),'old!');
 const engine=new VtfEngine({baseDir:path.join(f.home,'data'),manifestProvider:async()=>null});engine.externalGameLock=true;const pkg=await engine.inspect(path.join(f.home,'skin'));return{...f,engine,pkg,game,vpk,before};
}
test('actual VTF install reads back the published payload once before index publication and remains restorable',async t=>{
 const f=await engineFixture(t),open=fsp.open;let publishedReads=0,stageReads=0;
 fsp.open=async function(file,...args){const handle=await open.call(this,file,...args);if(args[0]==='r'&&path.dirname(path.resolve(file))===f.vpk){if(/\.archive\.tmp$/.test(file))stageReads++;if(path.basename(file)===archiveName(1)){const read=handle.read.bind(handle);handle.read=async(...values)=>{assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.before);const result=await read(...values);publishedReads+=result.bytesRead;return result;};}}return handle;};
 let installed;try{installed=await f.engine.install(f.game,f.pkg.id);}finally{fsp.open=open;}
 assert.equal(stageReads,0);assert.equal(publishedReads,f.pkg.bytes);assert.notDeepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.before);await f.engine.restore(f.game,installed.backupId);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.before);
});
test('VTF corruption after packing rolls back its own unreferenced inode and permits a valid retry',async t=>{
 const f=await engineFixture(t);
 await assert.rejects(f.engine.install(f.game,f.pkg.id,{beforeWrite:async({manifest})=>{const target=path.join(f.vpk,manifest.stageArchive),fd=await fsp.open(target,'r+');try{await fd.write(Buffer.from('bad!'),0,4,80);}finally{await fd.close();}}}),/归档|校验/);
 assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.before);const backup=(await f.engine.manifests(f.game))[0];assert.equal(backup.state,'rolled-back');assert.equal(backup.recoveryError,undefined);assert.equal(parseIndex(await fsp.readFile(path.join(f.vpk,INDEX_NAME))).entries.length,1);assert.equal(fs.existsSync(path.join(f.vpk,archiveName(1))),false);
 const retried=await f.engine.install(f.game,f.pkg.id);assert.equal((await f.engine.manifests(f.game))[0].state,'installed');await f.engine.restore(f.game,retried.backupId);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.before);
});
test('VTF failed publication preserves an unrelated archive that replaces the published name',async t=>{
 const f=await engineFixture(t),link=fsp.link,published=path.join(f.vpk,archiveName(1));let replaced=false;
 fsp.link=async function(source,target){const result=await link.call(this,source,target);if(path.resolve(target)===published){await fsp.unlink(target);await fsp.writeFile(target,'unrelated replacement');replaced=true;}return result;};
 try{await assert.rejects(f.engine.install(f.game,f.pkg.id),/身份|归档|恢复备份/);}finally{fsp.link=link;}
 assert.equal(replaced,true);assert.equal(await fsp.readFile(published,'utf8'),'unrelated replacement');assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.before);assert((await f.engine.manifests(f.game))[0].recoveryError);
});

test('VTF failed publication preserves an identical-byte replacement inode',async t=>{
 const f=await engineFixture(t),link=fsp.link,published=path.join(f.vpk,archiveName(1));let replacement;
 fsp.link=async function(source,target){const result=await link.call(this,source,target);if(path.resolve(target)===published){const bytes=await fsp.readFile(target);await fsp.unlink(target);await fsp.writeFile(target,bytes);replacement=await fsp.lstat(target);}return result;};
 try{await assert.rejects(f.engine.install(f.game,f.pkg.id),/身份|保留/);}finally{fsp.link=link;}
 const preserved=await fsp.lstat(published);assert.equal(preserved.ino,replacement.ino);assert.equal(preserved.dev,replacement.dev);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.before);assert((await f.engine.manifests(f.game))[0].recoveryError);
});

test('VTF failed publication preserves extra hardlinks even when archive bytes remain valid',async t=>{
 const f=await engineFixture(t),link=fsp.link,published=path.join(f.vpk,archiveName(1)),third=path.join(f.home,'foreign-link.vpk');
 fsp.link=async function(source,target){const result=await link.call(this,source,target);if(path.resolve(target)===published)await link.call(this,target,third);return result;};
 try{await assert.rejects(f.engine.install(f.game,f.pkg.id),/身份|保留/);}finally{fsp.link=link;}
 assert.equal((await fsp.lstat(published)).nlink,3);assert.equal((await fsp.lstat(third)).ino,(await fsp.lstat(published)).ino);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),f.before);assert((await f.engine.manifests(f.game))[0].recoveryError);
});

test('VTF failed publication preserves externally changed live index and its referenced archive',async t=>{
 const f=await engineFixture(t),link=fsp.link,published=path.join(f.vpk,archiveName(1));let externalIndex;
 fsp.link=async function(source,target){const result=await link.call(this,source,target);if(path.resolve(target)===published){externalIndex=serializeIndex([{...f.reference,index:1}]);await fsp.writeFile(path.join(f.vpk,INDEX_NAME),externalIndex);const fd=await fsp.open(target,'r+');try{await fd.write(Buffer.from('bad!'),0,4,80);}finally{await fd.close();}}return result;};
 try{await assert.rejects(f.engine.install(f.game,f.pkg.id),/索引|保留/);}finally{fsp.link=link;}
 assert.equal(fs.existsSync(published),true);assert.deepEqual(await fsp.readFile(path.join(f.vpk,INDEX_NAME)),externalIndex);assert((await f.engine.manifests(f.game))[0].recoveryError);
});
