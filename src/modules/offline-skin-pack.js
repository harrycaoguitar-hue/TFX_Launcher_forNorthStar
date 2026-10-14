"use strict";
// A read-only, independently pinned source. User caches remain bound to their
// original game directory; only this exported pack can travel between machines.
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto"),zlib=require("zlib");
const {assertUnlinkedAncestors}=require("./backup-records");
const {fingerprint}=require("./dds-layout-compatibility");
const {MAX_INDEX_BYTES}=require("./vtf-vpk");
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const key=row=>[row.target,row.offset,row.length].join("|");
const failure="离线原皮包已损坏或与当前游戏资源版本不兼容，未修改游戏。";
const unsafe="离线原皮包路径包含链接或非普通文件，已停止读取。";
const targets=new Set(["pc_stream.starpak","pc_stream(03).starpak","pc_stream(05).starpak","pc_stream(06).starpak","pc_stream(07).starpak"]);
const maximumRange=128*1024*1024;
const payloadError=value=>value.message===unsafe?value:Error(failure);
async function bytes(file,size,maximum){
 await assertUnlinkedAncestors(file,unsafe);const stat=await fsp.lstat(file);
 if(!stat.isFile()||stat.size>maximum||(size!==undefined&&stat.size!==size))throw Error(failure);
 const handle=await fsp.open(file,"r");try{const opened=await handle.stat();if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw Error(failure);const data=await handle.readFile();if(data.length!==stat.size)throw Error(failure);await assertUnlinkedAncestors(file,unsafe);return data;}finally{await handle.close();}
}
function validate(value){
 if(![1,2].includes(value?.version)||!value.resources||!Array.isArray(value.dds)||value.dds.length>3000||!value.vtf)throw Error(failure);
 const rows=new Map(),payloads=new Map();for(const row of value.dds){if(!targets.has(row.target)||!Number.isSafeInteger(row.offset)||row.offset<0||!Number.isSafeInteger(row.length)||row.length<=0||row.length>maximumRange||!Number.isSafeInteger(row.offset+row.length)||!/^[a-f0-9]{64}$/.test(row.SHA256||"")||rows.has(key(row)))throw Error(failure);
  if(value.version===1){if(row.file!=="dds/"+sha(Buffer.from(key(row)))+".bin")throw Error(failure);}
  else{if(!["identity","brotli"].includes(row.encoding)||!Number.isSafeInteger(row.storedLength)||row.storedLength<=0||row.storedLength>maximumRange||row.file!=="dds/"+row.SHA256+(row.encoding==="brotli"?".br":".bin")||(row.encoding==="identity"&&row.storedLength!==row.length))throw Error(failure);const identity=[row.length,row.SHA256,row.encoding,row.storedLength].join("|");if(payloads.has(row.file)&&payloads.get(row.file)!==identity)throw Error(failure);payloads.set(row.file,identity);}
  const info=value.resources["r2/paks/win64/"+row.target.toLowerCase()];if(!info||!Number.isSafeInteger(info.size)||info.size<row.offset+row.length||!/^[a-f0-9]{64}$/.test(info.fingerprint||""))throw Error(failure);rows.set(key(row),row);}
 if(value.vtf.file!=="vtf/common-index.vpk"||!Number.isSafeInteger(value.vtf.bytes)||value.vtf.bytes<=0||value.vtf.bytes>MAX_INDEX_BYTES||!/^[a-f0-9]{64}$/.test(value.vtf.SHA256||""))throw Error(failure);
 return {...value,rows};
}
class OfflineSkinPack{
 constructor({directories=[],trustedCatalogueSHA256}={}){this.directories=[...new Set(directories.filter(value=>typeof value==="string"&&path.isAbsolute(value)).map(value=>path.resolve(value)))];this.trust=trustedCatalogueSHA256;}
 async catalogues(){
  if(!this.directories.length)return [];
  const expected=this.trust||require("./data/offline-skin-pack.json").catalogueSHA256;if(!/^[a-f0-9]{64}$/.test(expected||""))throw Error(failure);
  const result=[];let error;for(const directory of this.directories)try{const data=await bytes(path.join(directory,"catalogue.json"),undefined,2*1024*1024);if(sha(data)!==expected)throw Error(failure);result.push({directory,catalogue:validate(JSON.parse(data.toString("utf8")))});}catch(value){if(value.code!=="ENOENT")error=value instanceof SyntaxError?Error(failure):value;}
  if(!result.length&&error)throw error;return result;
 }
 async dds(row,manifest){
  if(!manifest)return null;let error;
  for(const {directory,catalogue}of await this.catalogues())try{const record=catalogue.rows.get(key(row));if(!record)continue;const name="r2/paks/win64/"+row.target.toLowerCase(),current=manifest.files.get(name),expected=catalogue.resources[name];if(!current||current.size!==expected.size||fingerprint(current)!==expected.fingerprint)throw Error(failure);const stored=await bytes(path.join(directory,record.file),catalogue.version===2?record.storedLength:record.length,maximumRange),payload=catalogue.version===2&&record.encoding==="brotli"?zlib.brotliDecompressSync(stored,{maxOutputLength:record.length}):stored;if(payload.length!==record.length||sha(payload)!==record.SHA256)throw Error(failure);return {...row,bytes:payload,origin:{version:1,target:row.target,offset:row.offset,length:row.length,SHA256:record.SHA256,manifestSHA256:manifest.SHA256,source:path.join(directory,record.file),offlinePack:true}};}catch(value){error=payloadError(value);}
  if(error)throw error;return null;
 }
 async vtf(info){
  if(!info)return null;let error;
  for(const {directory,catalogue}of await this.catalogues())try{const file=path.join(directory,catalogue.vtf.file),payload=await bytes(file,catalogue.vtf.bytes,MAX_INDEX_BYTES);if(sha(payload)!==catalogue.vtf.SHA256)throw Error(failure);const {authenticate}=require("./vtf-originals");if(!authenticate(payload,info))throw Error(failure);return {file,bytes:payload};}catch(value){error=payloadError(value);}
  if(error)throw error;return null;
 }
}
function productionDirectories({resourcesPath=process.resourcesPath,portableDirectory=process.env.PORTABLE_EXECUTABLE_DIR}={}){return [portableDirectory,resourcesPath].filter(value=>typeof value==="string"&&path.isAbsolute(value)).map(value=>path.join(value,"TFX-Original-Skins"));}
module.exports={OfflineSkinPack,productionDirectories};
