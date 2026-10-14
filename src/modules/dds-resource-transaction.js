"use strict";
const fsp=require("fs").promises;
const path=require("path");
const {assertUnlinkedAncestors}=require("./backup-records");
const unsafe="皮肤资源路径包含链接或非普通文件，已停止资源读写。";
const changed="游戏皮肤资源在操作期间发生变化，操作已取消";
const targets=new Set(["pc_stream.starpak","pc_stream(03).starpak","pc_stream(05).starpak","pc_stream(06).starpak","pc_stream(07).starpak"]);
const same=(a,b)=>a.isFile()&&a.nlink===1&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;

// Handles and metadata belong to one protected operation only. Every range is
// still read and SHA-checked; flushing once per container removes redundant OS
// flushes without committing an installed journal before the data is durable.
class DdsResourceTransaction{
  constructor(root){this.directory=path.resolve(root,"r2","paks","Win64");this.handles=new Map();this.closed=false;}
  async entry(file){
    if(this.closed)throw Error(changed);file=path.resolve(file);
    if(path.dirname(file)!==this.directory||!targets.has(path.basename(file)))throw Error(unsafe);
    if(this.handles.has(file))return this.handles.get(file);
    await assertUnlinkedAncestors(file,unsafe);const expected=await fsp.lstat(file);
    if(!expected.isFile()||expected.nlink!==1)throw Error(unsafe);
    const handle=await fsp.open(file,"r+");
    try{const stat=await handle.stat();if(!same(stat,expected))throw Error(changed);const entry={file,handle,stat,dirty:false};this.handles.set(file,entry);return entry;}
    catch(error){await handle.close();throw error;}
  }
  async check(entry,allowOwnWrite=false,checkPath=true){
    const held=await entry.handle.stat(),live=checkPath?await fsp.lstat(entry.file):held;
    if(!live.isFile()||live.nlink!==1||!held.isFile()||held.nlink!==1)throw Error(unsafe);
    if(live.dev!==entry.stat.dev||live.ino!==entry.stat.ino||held.dev!==entry.stat.dev||held.ino!==entry.stat.ino||live.size!==entry.stat.size||held.size!==entry.stat.size||!same(live,held)||!allowOwnWrite&&!same(held,entry.stat))throw Error(changed);
    if(allowOwnWrite)entry.stat=held;
  }
  range(entry,offset,length){if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<=0||length>128*1024*1024||offset+length>entry.stat.size)throw Error("游戏包内的皮肤区域不完整");}
  async read(file,offset,length){
    const entry=await this.entry(file);this.range(entry,offset,length);await this.check(entry);const bytes=Buffer.allocUnsafe(length);let done=0;
    while(done<length){const result=await entry.handle.read(bytes,done,length-done,offset+done);if(!result.bytesRead)throw Error("游戏包内的皮肤区域不完整");done+=result.bytesRead;}
    await this.check(entry,false,false);return bytes;
  }
  async write(file,offset,bytes,onStart=()=>{}){
    const entry=await this.entry(file);this.range(entry,offset,bytes.length);await this.check(entry);onStart();entry.dirty=true;let done=0;
    while(done<bytes.length){const result=await entry.handle.write(bytes,done,bytes.length-done,offset+done);if(!result.bytesWritten)throw Error("皮肤区域写入失败");done+=result.bytesWritten;}
    await this.check(entry,true,false);
  }
  async flush(){for(const entry of this.handles.values())if(entry.dirty){await assertUnlinkedAncestors(entry.file,unsafe);await this.check(entry);await entry.handle.sync();await this.check(entry);entry.dirty=false;}}
  async close(){this.closed=true;let first;for(const entry of this.handles.values())try{await entry.handle.close();}catch(error){first??=error;}this.handles.clear();if(first)throw first;}
}
module.exports={DdsResourceTransaction};
