"use strict";
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto");
const {parseIndex,hash,MAX_INDEX_BYTES}=require("./vtf-vpk");
const {assertUnlinkedAncestors}=require("./backup-records");
const {findManifest}=require("./dds-originals");
const INDEX="englishclient_mp_common.bsp.pak000_dir.vpk",unsafe="皮肤资源路径包含链接或非普通文件，已停止资源读写。";
const identity=value=>{try{return fs.realpathSync.native(path.resolve(value)).toLowerCase();}catch{return path.resolve(value).toLowerCase();}};
const originalInfo=manifest=>manifest?.files.get("vpk/"+INDEX);
function authenticate(bytes,info){
 if(!info||bytes.length!==info.size||bytes.length>MAX_INDEX_BYTES||!info.chunks?.length)return false;
 let offset=0;for(const chunk of info.chunks){if(chunk.offset!==offset||!Number.isSafeInteger(chunk.length)||chunk.length<=0||chunk.length>4*1024*1024||chunk.offset+chunk.length>bytes.length)return false;if(crypto.createHash("sha1").update(bytes.subarray(chunk.offset,chunk.offset+chunk.length)).digest("hex")!==chunk.SHA1)return false;offset+=chunk.length;}return offset===bytes.length;
}
class VtfOriginals{
 constructor({baseDir,manifestProvider=root=>findManifest(root,{include:key=>key==="vpk/"+INDEX}),offlinePack}){Object.assign(this,{baseDir,manifestProvider,offlinePack});}
 folder(root){return path.join(this.baseDir,"originals",hash(Buffer.from(identity(root))));}
 async prepare(root,selected){
  const unavailable={state:"needs-source",complete:false,reason:"缺少经校验的原版 VTF 资源索引。请选择原版资源来源，补齐同一武器的缺失皮肤部分。"};
  const manifest=await this.manifestProvider(root),info=originalInfo(manifest);if(!info)return {status:{...unavailable,canSteamRepair:false},entries:null};
  const folder=this.folder(root),data=path.join(folder,"common-index.vpk"),metadata=path.join(folder,"index.json");
  if(!selected)try{
   await assertUnlinkedAncestors(data,unsafe);await assertUnlinkedAncestors(metadata,unsafe);const stat=await fsp.lstat(data),metaStat=await fsp.lstat(metadata);if(!stat.isFile()||!metaStat.isFile())throw Error(unsafe);if(stat.size>MAX_INDEX_BYTES||metaStat.size>16384)throw Error("原版 VTF 索引缓存与当前游戏版本不匹配或已损坏，请重新选择原版资源。");
   const meta=JSON.parse(await fsp.readFile(metadata,"utf8")),bytes=await fsp.readFile(data);if(meta.version!==1||identity(meta.gamePath)!==identity(root)||meta.manifestSHA256!==manifest.SHA256||meta.SHA256!==hash(bytes)||!authenticate(bytes,info))throw Error("原版 VTF 索引缓存与当前游戏版本不匹配或已损坏，请重新选择原版资源。");
   return {entries:parseIndex(bytes).entries,status:{state:"ready",complete:true,bytes:bytes.length,cachePath:data,canSteamRepair:true}};
  }catch(error){if(error.message===unsafe)throw error;}
  if(!selected&&this.offlinePack){const bundled=await this.offlinePack.vtf(info);if(bundled)return {entries:parseIndex(bundled.bytes).entries,status:{state:"ready",complete:true,bytes:bundled.bytes.length,cachePath:bundled.file,canSteamRepair:true,offlinePack:true}};}
  let candidates=[path.join(root,"vpk",INDEX)];
  if(!selected){const backups=path.join(this.baseDir,"backups");await assertUnlinkedAncestors(backups,unsafe).catch(error=>{if(error.code!=="ENOENT")throw error;});let names=[];try{names=await fsp.readdir(backups);}catch(error){if(error.code!=="ENOENT")throw error;}for(const name of names.filter(value=>/^[a-f0-9-]{36}$/.test(value)).slice(0,1000))candidates.push(path.join(backups,name,"before-index.vpk"));}
  if(selected){await assertUnlinkedAncestors(selected,unsafe);const stat=await fsp.lstat(selected);if(stat.isFile())candidates=path.basename(selected).toLowerCase()===INDEX?[selected]:[];else if(stat.isDirectory())candidates=[path.join(selected,INDEX),path.join(selected,"vpk",INDEX)];else throw Error(unsafe);}
  for(const file of candidates){
   let bytes;try{await assertUnlinkedAncestors(file,unsafe);const stat=await fsp.lstat(file);if(!stat.isFile()||stat.size>MAX_INDEX_BYTES)throw Error(unsafe);bytes=await fsp.readFile(file);if(!authenticate(bytes,info))continue;}catch(error){if(error.code==="ENOENT")continue;throw error;}
   const entries=parseIndex(bytes).entries;await fsp.mkdir(folder,{recursive:true});await assertUnlinkedAncestors(folder,unsafe);for(const output of [data,metadata])await assertUnlinkedAncestors(output,unsafe).catch(error=>{if(error.code!=="ENOENT")throw error;});const token=crypto.randomUUID(),tmp=data+"."+token+".tmp",tmpMeta=metadata+"."+token+".tmp";
   try{await fsp.writeFile(tmp,bytes,{flag:"wx"});await fsp.writeFile(tmpMeta,JSON.stringify({version:1,gamePath:path.resolve(root),manifestSHA256:manifest.SHA256,SHA256:hash(bytes),bytes:bytes.length,createdAt:new Date().toISOString()}),{flag:"wx"});await fsp.rename(tmp,data);await fsp.rename(tmpMeta,metadata);}finally{await fsp.rm(tmp,{force:true});await fsp.rm(tmpMeta,{force:true});}
   return {entries,status:{state:"ready",complete:true,bytes:bytes.length,cachePath:data,canSteamRepair:true}};
  }
  if(selected)throw Error("所选资源未通过当前 Steam 版本的原版 VTF 索引校验，未修改游戏。");return {entries:null,status:{...unavailable,canSteamRepair:true}};
 }
}
module.exports={VtfOriginals,authenticate};
