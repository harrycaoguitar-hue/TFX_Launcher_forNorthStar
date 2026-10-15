"use strict";
// Titanfall VPK 2.3: leave old compressed entry records untouched and describe
// new, uncompressed assets in 1 MiB chunks. No proprietary GUI tool is run.
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const {crc32}=require("zlib");
const fsp=fs.promises;
const {assertUnlinkedAncestors}=require('./backup-records');
const CHUNK_BYTES=1024*1024,MAX_INDEX_BYTES=32*1024*1024;
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function updateCRC(crc,buffer){
  // zlib uses the finalized CRC convention; our streaming state is unfinalized.
  // Retain the table implementation for Node 22 runtimes without crc32.
  if(typeof crc32==="function")return (crc32(buffer,(crc^0xffffffff)>>>0)^0xffffffff)>>>0;
  for(const b of buffer)crc=crcTable[(crc^b)&255]^(crc>>>8);return crc>>>0;
}
const hash=data=>crypto.createHash("sha256").update(data).digest("hex");
async function hashFile(file){const h=crypto.createHash("sha256");for await(const b of fs.createReadStream(file,{highWaterMark:CHUNK_BYTES}))h.update(b);return h.digest("hex");}
async function readIndexFile(file){
  await assertUnlinkedAncestors(file,"皮肤资源路径包含链接或非普通文件，已停止资源读写。");
  const expected=await fsp.lstat(file);
  if(!expected.isFile()||expected.nlink!==1||expected.size>MAX_INDEX_BYTES)throw Error("游戏 common 索引文件无效或超过支持的大小");
  const handle=await fsp.open(file,'r');
  try{
    const opened=await handle.stat();
    if(!opened.isFile()||opened.dev!==expected.dev||opened.ino!==expected.ino||opened.size!==expected.size||opened.nlink!==1)throw Error("common 索引被其他程序修改，安装已取消");
    const bytes=Buffer.alloc(opened.size);let offset=0;
    while(offset<bytes.length){const read=await handle.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)throw Error("VPK 索引已截断");offset+=read.bytesRead;}
    const after=await handle.stat();
    if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)throw Error("common 索引被其他程序修改，安装已取消");
    return bytes;
  }finally{await handle.close();}
}
function safeAssetPath(value){
  if(typeof value!=="string"||value.length>512||value.includes("\0")||/[\x00-\x1f:]/.test(value))throw Error("VPK 资源路径无效");
  const clean=value.replace(/\\/g,"/");const parts=clean.split("/");
  if(clean.startsWith("/")||parts.some(p=>!p||p==="."||p===".."||/[. ]$/.test(p)||/[<>\"|?*]/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error("VPK 资源路径不安全");
  return clean;
}
function parseIndex(data){return decodeIndex(data,false);}
// Recover complete records only; an unfinished record is never interpreted.
function parseTruncatedIndex(data){return decodeIndex(data,true);}
function decodeIndex(data,partial){
  if(!Buffer.isBuffer(data)||data.length<16||data.length>MAX_INDEX_BYTES||data.readUInt32LE(0)!==0x55aa1234||data.readUInt16LE(4)!==2||data.readUInt16LE(6)!==3)throw Error("游戏 common 索引不是受支持的 Titanfall VPK 2.3");
  const treeSize=data.readUInt32LE(8),dataSize=data.readUInt32LE(12);if(dataSize!==0||treeSize>MAX_INDEX_BYTES-16||(partial?treeSize<=data.length-16:treeSize!==data.length-16))throw Error("VPK 索引含有不受支持的预载区域或长度不正确");
  let p=16;const entries=[],seen=new Set();
  const truncated=()=>Object.assign(Error("VPK 索引已截断"),{code:"VPK_TRUNCATED"});
  const need=n=>{if(p+n>data.length)throw truncated();};
  const z=()=>{const end=data.indexOf(0,p);if(end<0)throw truncated();if(end-p>512)throw Error("VPK 索引路径不完整");const result=data.toString("utf8",p,end);p=end+1;return result;};
  try{for(let extension;(extension=z());)for(let directory;(directory=z());)for(let name;(name=z());){
    const assetPath=safeAssetPath((directory===" "?"":directory+"/")+name+"."+extension),key=assetPath.toLowerCase();
    if(seen.has(key))throw Error("VPK 索引含有重名资源");seen.add(key);need(8);
    const start=p,crc=data.readUInt32LE(p),preload=data.readUInt16LE(p+4),index=data.readUInt16LE(p+6);p+=8;
    if(preload!==0||index>=0x7fff)throw Error("VPK 索引使用了不受支持的预载方式");const chunks=[];
    for(;;){need(32);const numbers=[6,14,22].map(offset=>data.readBigUInt64LE(p+offset));if(numbers.some(x=>x>BigInt(Number.MAX_SAFE_INTEGER)))throw Error("VPK 资源偏移超出支持范围");
      const chunk={flags:data.readUInt32LE(p),textureFlags:data.readUInt16LE(p+4),offset:Number(numbers[0]),compressedSize:Number(numbers[1]),size:Number(numbers[2])};
      if(!chunk.compressedSize||!chunk.size||chunk.size>CHUNK_BYTES||!Number.isSafeInteger(chunk.offset+chunk.compressedSize))throw Error("VPK 资源块长度不正确");chunks.push(chunk);p+=30;
      const terminator=data.readUInt16LE(p);p+=2;if(terminator===0xffff)break;if(terminator!==index)throw Error("VPK 资源块编号不一致");if(chunks.length>65536)throw Error("VPK 资源块过多");
    }
    entries.push({path:assetPath,crc,index,chunks,raw:Buffer.from(data.subarray(start,p))});if(entries.length>100000)throw Error("VPK 资源数量过多");
  }
  if(p!==data.length||partial)throw Error("VPK 索引目录长度不一致");
  }catch(error){if(!partial||error.code!=="VPK_TRUNCATED")throw error;return {entries,bytes:data.length,sha256:hash(data),truncated:true};}
  return {entries,bytes:data.length,sha256:hash(data)};
}
function serializeIndex(entries){
  const parts=[],groups=new Map(),seen=new Set();const z=s=>parts.push(Buffer.from(s+"\0","utf8"));
  for(const e of entries){const clean=safeAssetPath(e.path),key=clean.toLowerCase();if(seen.has(key))throw Error("不能向 VPK 写入重名资源");seen.add(key);
    const ext=path.posix.extname(clean).slice(1),dir=path.posix.dirname(clean),name=path.posix.basename(clean,"."+ext);if(!ext)throw Error("VPK 资源缺少扩展名");
    if(!groups.has(ext))groups.set(ext,new Map());const dirs=groups.get(ext);if(!dirs.has(dir))dirs.set(dir,[]);dirs.get(dir).push({...e,name});
  }
  // Map insertion order preserves the original grouped tree and file order.
  for(const [ext,dirs]of groups){z(ext);for(const [dir,files]of dirs){z(dir==="."?" ":dir);for(const e of files){z(e.name);if(e.raw){parts.push(e.raw);continue;}
      const first=Buffer.alloc(8);first.writeUInt32LE(e.crc>>>0,0);first.writeUInt16LE(e.index,6);parts.push(first);
      for(let i=0;i<e.chunks.length;i++){const c=e.chunks[i],b=Buffer.alloc(32);b.writeUInt32LE(c.flags>>>0,0);b.writeUInt16LE(c.textureFlags,4);b.writeBigUInt64LE(BigInt(c.offset),6);b.writeBigUInt64LE(BigInt(c.compressedSize),14);b.writeBigUInt64LE(BigInt(c.size),22);b.writeUInt16LE(i===e.chunks.length-1?0xffff:e.index,30);parts.push(b);}
    }z("");}z("");}z("");
  const tree=Buffer.concat(parts);if(tree.length>MAX_INDEX_BYTES-16)throw Error("安装后的 VPK 索引过大");const head=Buffer.alloc(16);head.writeUInt32LE(0x55aa1234,0);head.writeUInt16LE(2,4);head.writeUInt16LE(3,6);head.writeUInt32LE(tree.length,8);return Buffer.concat([head,tree]);
}
function createAssetLookup(entries){
  const paths=new Map(),extensions=new Map();
  for(const entry of entries){const key=entry.path.toLowerCase(),extension=path.posix.extname(key);if(!paths.has(key))paths.set(key,entry);if(!extensions.has(extension))extensions.set(extension,entry);}
  return {paths,extensions};
}
function flagsFor(assetPath,entries,lookup){
  const key=assetPath.toLowerCase(),existing=lookup?lookup.paths.get(key):entries.find(e=>e.path.toLowerCase()===key);
  const extension=path.posix.extname(key),similar=existing||(lookup?lookup.extensions.get(extension):entries.find(e=>path.posix.extname(e.path).toLowerCase()===extension));
  if(!similar)throw Error(`游戏 common 索引中没有 ${extension} 类型的参考资源，无法确定加载方式`);
  const first=similar.chunks[0];if(similar.chunks.some(c=>c.flags!==first.flags||c.textureFlags!==first.textureFlags))throw Error("参考资源的加载标志不一致");
  return {flags:first.flags,textureFlags:first.textureFlags,flagSource:existing?"原同名资源":"原同格式资源"};
}
async function streamArchive(files,output,index,originalEntries,progress=()=>{}){
  const handle=await fsp.open(output,"wx"),entries=[];let position=0;const total=files.reduce((n,f)=>n+f.bytes,0);const archiveHash=crypto.createHash("sha256");
  const lookup=createAssetLookup(originalEntries);
  try{for(const file of files){const flags=flagsFor(file.path,originalEntries,lookup),chunks=[];let crc=0xffffffff;const fileHash=crypto.createHash("sha256");let received=0;
      for await(const b of fs.createReadStream(file.source,{highWaterMark:CHUNK_BYTES})){crc=updateCRC(crc,b);fileHash.update(b);archiveHash.update(b);
        const offset=position;let written=0;while(written<b.length){const result=await handle.write(b,written,b.length-written,position);if(!result.bytesWritten)throw Error("VPK 归档写入失败");written+=result.bytesWritten;position+=result.bytesWritten;}
        chunks.push({flags:flags.flags,textureFlags:flags.textureFlags,offset,compressedSize:b.length,size:b.length});received+=b.length;progress(position,total,file.path);
      }
      if(received!==file.bytes||fileHash.digest("hex")!==file.sha256)throw Error("校验后的皮肤文件发生了变化，请重新导入");entries.push({path:file.path,crc:(crc^0xffffffff)>>>0,index,chunks,flagSource:flags.flagSource});
    }await handle.sync();
  }finally{await handle.close();}
  return {entries,bytes:position,sha256:archiveHash.digest("hex")};
}
async function verifyArchive(entries,archivePath,expectedFiles,progress=()=>{},archiveExpectation){
  await assertUnlinkedAncestors(archivePath,"皮肤资源路径包含链接或非普通文件，已停止资源读写。");
  const expected=await fsp.lstat(archivePath);
  if(!expected.isFile())throw Error("写入后的 VPK 不是普通文件");
  const fd=await fsp.open(archivePath,"r");let finished=0;const total=expectedFiles.reduce((n,f)=>n+f.bytes,0),archiveHash=archiveExpectation?crypto.createHash("sha256"):null;
  const lookup=createAssetLookup(entries);
  try{const opened=await fd.stat();
    const same=(a,b)=>a.isFile()&&b.isFile()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.nlink===b.nlink;
    if(!same(opened,expected)||archiveExpectation&&(opened.size!==archiveExpectation.bytes||opened.nlink!==archiveExpectation.links||total!==archiveExpectation.bytes))throw Error("发布后的皮肤归档在校验期间发生变化");
    const buffer=Buffer.allocUnsafe(CHUNK_BYTES);
    for(const f of expectedFiles){const e=lookup.paths.get(f.path.toLowerCase());if(!e)throw Error("写入后的 VPK 缺少皮肤资源");if(archiveExpectation&&e.index!==archiveExpectation.index)throw Error("写入后的 VPK 资源归档编号不一致");let crc=0xffffffff;const h=crypto.createHash("sha256");let bytes=0;
      for(const c of e.chunks){if(c.compressedSize!==c.size||c.size>CHUNK_BYTES||!Number.isSafeInteger(c.offset)||c.offset<0||c.offset+c.size>opened.size||archiveExpectation&&c.offset!==finished)throw Error("写入后的 VPK 资源块不正确");const b=buffer.subarray(0,c.size);let done=0;while(done<b.length){const read=await fd.read(b,done,b.length-done,c.offset+done);if(!read.bytesRead)throw Error("写入后的 VPK 资源不完整");done+=read.bytesRead;}h.update(b);archiveHash?.update(b);crc=updateCRC(crc,b);bytes+=b.length;finished+=b.length;progress(finished,total,f.path);}
      if(bytes!==f.bytes||h.digest("hex")!==f.sha256||((crc^0xffffffff)>>>0)!==e.crc)throw Error("写入后的皮肤数据或校验码不一致");
    }
    if(archiveExpectation&&(finished!==archiveExpectation.bytes||archiveHash.digest("hex")!==archiveExpectation.sha256))throw Error("发布后的皮肤归档校验失败");
    await assertUnlinkedAncestors(archivePath,"皮肤资源路径包含链接或非普通文件，已停止资源读写。");
    if(!same(await fd.stat(),opened)||!same(await fsp.lstat(archivePath),opened))throw Error("发布后的皮肤归档在校验期间发生变化");
  }finally{await fd.close();}
}
module.exports={CHUNK_BYTES,MAX_INDEX_BYTES,parseIndex,parseTruncatedIndex,serializeIndex,safeAssetPath,flagsFor,createAssetLookup,streamArchive,verifyArchive,hash,hashFile,updateCRC,readIndexFile};
