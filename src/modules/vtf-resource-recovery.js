"use strict";
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto");
const {parseIndex,parseTruncatedIndex,serializeIndex,MAX_INDEX_BYTES,hash}=require("./vtf-vpk");
const {assertUnlinkedAncestors,readRecord}=require("./backup-records");
const {DdsResourceRecovery,verifyComplete}=require("./dds-resource-recovery");
const {findManifest}=require("./dds-originals");
const INDEX="englishclient_mp_common.bsp.pak000_dir.vpk",unsafe="皮肤资源路径包含链接或非普通文件，已停止资源读写。";
const accepted=name=>/^vpk\/(?:englishclient_mp_common\.bsp\.pak000_dir|client_mp_common\.bsp\.pak000_\d+)\.vpk$/i.test(name);
const archiveName=index=>`client_mp_common.bsp.pak000_${String(index).padStart(3,"0")}.vpk`;
const identity=value=>{try{return fs.realpathSync.native(path.resolve(value)).toLowerCase();}catch{return path.resolve(value).toLowerCase();}};
const equal=(a,b)=>identity(a)===identity(b);
class VtfResourceRecovery{
 constructor({baseDir,isGameRunning=async()=>false,progress=()=>{},manifestProvider=root=>findManifest(root,{include:accepted}),offlinePack}){Object.assign(this,{baseDir,isGameRunning,progress,manifestProvider,offlinePack});this.copier=new DdsResourceRecovery({baseDir,isGameRunning,progress});}
 async basic(root){await assertUnlinkedAncestors(path.join(root,"Titanfall2.exe"),unsafe);if(!(await fsp.lstat(path.join(root,"Titanfall2.exe"))).isFile())throw Error("目录中未找到 Titanfall2.exe");try{await assertUnlinkedAncestors(path.join(root,"vpk"),unsafe);if(!(await fsp.lstat(path.join(root,"vpk"))).isDirectory())throw Error(unsafe);}catch(e){if(e.code!=="ENOENT")throw e;}}
 receipt(root){return path.join(this.baseDir,"resource-sources",hash(Buffer.from(identity(root)))+".json");}
 async sources(root,name,selected){
  const result=[];
  if(selected){await assertUnlinkedAncestors(selected,unsafe);const stat=await fsp.lstat(selected);if(!stat.isFile()&&!stat.isDirectory())throw Error(unsafe);const directory=stat.isFile()?path.dirname(selected):selected;result.push(path.join(directory,name),path.join(directory,"vpk",name));}
  {
   if(name===INDEX)result.push(path.join(this.baseDir,"originals",hash(Buffer.from(identity(root))),"common-index.vpk"));
   result.push(path.resolve(root,"../../downloading/1237970/vpk",name));
   try{const receipt=this.receipt(root);await assertUnlinkedAncestors(receipt,unsafe);const stat=await fsp.lstat(receipt);if(stat.isFile()&&stat.size<32768){const data=JSON.parse(await fsp.readFile(receipt,"utf8"));if(data.version===1&&equal(data.gamePath,root)&&typeof data.directory==="string"&&path.isAbsolute(data.directory))result.push(path.join(data.directory,name),path.join(data.directory,"vpk",name));}}catch(e){if(e.code!=="ENOENT"&&e.message===unsafe)throw e;}
  }
  return [...new Set(result)].filter(value=>!equal(value,path.join(root,"vpk",name)));
 }
 async historyIndex(root){
  const folder=path.join(this.baseDir,"backups");let entries=[];try{entries=await fsp.readdir(folder);}catch(e){if(e.code!=="ENOENT")throw e;}
  const results=[];
  for(const entry of entries.filter(value=>/^[a-f0-9-]{36}$/.test(value))){
   const record=await readRecord(folder,entry,root,"manifest.json",{allowOtherGames:true});const m=record.manifest;
   if(!equal(m.gamePath,root)||!["installed","restored","rolled-back"].includes(m.state)||m.indexName!==INDEX)continue;
   const installed=m.state==="installed",expected=installed?m.afterHash:m.beforeHash,file=path.join(record.dir,installed?"after-index.vpk":"before-index.vpk");
   if(!/^[a-f0-9]{64}$/.test(expected||""))continue;
   await assertUnlinkedAncestors(file,unsafe);const stat=await fsp.lstat(file);if(!stat.isFile()||stat.size>MAX_INDEX_BYTES)continue;const bytes=await fsp.readFile(file);if(hash(bytes)!==expected)throw Error("备份中的原 common 索引已损坏");parseIndex(bytes);results.push({file,bytes,stat,createdAt:m.createdAt});
  }
  return results.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0]||null;
 }
 async inspect(root){
  await this.basic(root);let manifest;try{manifest=await this.manifestProvider(root);}catch{}
  const issues=[],requirements=new Map([[INDEX,0]]);let parsed;
  const index=path.join(root,"vpk",INDEX);
  try{await assertUnlinkedAncestors(index,unsafe);const stat=await fsp.lstat(index);if(!stat.isFile()||stat.size>MAX_INDEX_BYTES)throw Error(unsafe);parsed=parseIndex(await fsp.readFile(index));}
  catch(e){if(e.message===unsafe)issues.push({target:"vpk/"+INDEX,code:"unsafe",repairable:false});else issues.push({target:"vpk/"+INDEX,code:e.code==="ENOENT"?"missing":"truncated",repairable:false});}
  if(parsed)for(const entry of parsed.entries)for(const chunk of entry.chunks)requirements.set(archiveName(entry.index),Math.max(requirements.get(archiveName(entry.index))||0,chunk.offset+chunk.compressedSize));
  for(const [name,extent]of requirements){
   const known=issues.find(value=>value.target==="vpk/"+name),info=manifest?.files.get("vpk/"+name.toLowerCase());let stat,code=known?.code;
   if(!known)try{const file=path.join(root,"vpk",name);await assertUnlinkedAncestors(file,unsafe);stat=await fsp.lstat(file);if(!stat.isFile())code="unsafe";else if(name!==INDEX&&stat.size<Math.max(extent,info?.size||0))code="truncated";else if(name===INDEX&&stat.nlink!==1)code="linked";else if(name===INDEX&&(!(stat.mode&0o200)||await fsp.access(file,fs.constants.R_OK|fs.constants.W_OK).then(()=>false,()=>true)))code="unwritable";}catch(e){code=e.code==="ENOENT"?"missing":e.message===unsafe?"unsafe":"unwritable";}
   if(!code)continue;
   let repairable=["linked","unwritable"].includes(code),sourceAvailable=false;
   if(["missing","truncated"].includes(code)){
    if(name===INDEX)try{sourceAvailable=Boolean(await this.historyIndex(root));}catch{}
    if(name===INDEX&&!sourceAvailable&&info&&this.offlinePack)try{sourceAvailable=Boolean(await this.offlinePack.vtf(info));}catch{}
    if(info)for(const file of await this.sources(root,name))try{await assertUnlinkedAncestors(file,unsafe);const s=await fsp.lstat(file);if(s.isFile()&&s.size===info.size){sourceAvailable=true;break;}}catch{}
    repairable=sourceAvailable;
   }
   const value={target:"vpk/"+name,code,repairable,requiredBytes:Math.max(extent,info?.size||0),size:stat?.size||0,managed:!info&&name!==INDEX};if(known)Object.assign(known,value);else issues.push(value);
  }
  return {ready:issues.length===0,canRepair:issues.length>0&&issues.every(value=>value.repairable),canSteamRepair:Boolean(manifest),issues,archiveCount:Math.max(0,requirements.size-1),...(issues.length?{error:"common VPK 不完整或不兼容："+issues.map(value=>value.target).join(", ")}:{}),...(parsed?{parsed}:{})};
 }
 async repair(root,selected){
  if(await this.isGameRunning())throw Error("请先退出游戏，再修复皮肤资源。");
  await this.basic(root);const manifest=await this.manifestProvider(root);const repaired=[];
  // Restoring the index reveals the exact list and extents of chunk archives.
  for(let pass=0;pass<3;pass++){
   const status=await this.inspect(root);if(status.ready){if(selected)await this.remember(root,selected);return {repaired,game:{...status,parsed:undefined}};}
   let changed=false;
   for(const issue of status.issues){
    if(issue.code==="unsafe")throw Error(unsafe);
    const name=path.posix.basename(issue.target),target=path.join(root,"vpk",name);let source=target,sourceStat;
    if(["missing","truncated"].includes(issue.code)){
     if(name===INDEX){const backup=await this.historyIndex(root);if(backup){source=backup.file;sourceStat=backup.stat;}}
     if(name===INDEX&&!sourceStat&&!selected&&this.offlinePack){const info=manifest?.files.get(issue.target.toLowerCase()),bundled=await this.offlinePack.vtf(info);if(bundled){source=bundled.file;sourceStat=await verifyComplete(source,info);}}
     if(!sourceStat){const info=manifest?.files.get(issue.target.toLowerCase());if(!info)throw Error("没有找到完整且通过校验的原版资源。请选择原版资源来源，或单独下载所需文件后继续安装。");let lastError;for(const candidate of await this.sources(root,name,selected))try{sourceStat=await verifyComplete(candidate,info);source=candidate;break;}catch(e){if(e.code!=="ENOENT"||!lastError)lastError=e;}if(!sourceStat)throw Error(selected?(lastError?.code!=="ENOENT"?lastError?.message:null)||"所选备份不含所需的原版资源。":"没有找到完整且通过校验的原版资源。请选择原版资源来源，或单独下载所需文件后继续安装。");}
    }else{await assertUnlinkedAncestors(target,unsafe);sourceStat=await fsp.lstat(target);}
    await assertUnlinkedAncestors(root,unsafe);try{await assertUnlinkedAncestors(path.dirname(target),unsafe);}catch(e){if(e.code!=="ENOENT")throw e;await fsp.mkdir(path.dirname(target));await assertUnlinkedAncestors(path.dirname(target),unsafe);}
    if(issue.code==="unwritable"&&sourceStat.nlink===1){if(await this.isGameRunning())throw Error("游戏已启动，资源修复已取消。");await fsp.chmod(target,sourceStat.mode|0o600);await fsp.access(target,fs.constants.R_OK|fs.constants.W_OK);repaired.push({target:issue.target,code:issue.code,bytes:0});}
    else{
     let retained,damagedPath;
     if(name===INDEX&&issue.code==="truncated"){
      const damaged=await fsp.readFile(target);
      if(damaged.length<16){const verified=await fsp.readFile(source);if(!damaged.equals(verified.subarray(0,damaged.length)))throw Error("VPK 索引头与通过校验的来源不一致，未修改游戏。");retained=[];}else retained=parseTruncatedIndex(damaged).entries;
      const folder=path.join(this.baseDir,"resource-recovery",hash(Buffer.from(path.resolve(root).toLowerCase())));await fsp.mkdir(folder,{recursive:true});await assertUnlinkedAncestors(folder,unsafe);
      damagedPath=path.join(folder,crypto.randomUUID()+".index.vpk");await fsp.writeFile(damagedPath,damaged,{flag:"wx"});
     }
     const result=await this.copier.copyPrivate(root,{...issue,target:issue.target},target,source,sourceStat,{preservePrefix:issue.code==="truncated"&&name!==INDEX,transform:name===INDEX?async temporary=>{
      const stat=await fsp.lstat(temporary);if(stat.size>MAX_INDEX_BYTES)throw Error(unsafe);const bytes=await fsp.readFile(temporary),parsed=parseIndex(bytes);
      if(retained?.length){const replacements=new Map(retained.map(entry=>[entry.path.toLowerCase(),entry])),entries=parsed.entries.map(entry=>{const key=entry.path.toLowerCase(),replacement=replacements.get(key);replacements.delete(key);return replacement||entry;});entries.push(...replacements.values());const merged=serializeIndex(entries);parseIndex(merged);await fsp.writeFile(temporary,merged);}
     }:undefined});repaired.push({...result,...(damagedPath?{damagedIndexBackup:damagedPath,preservedEntries:retained.length}:{})});
    }
    changed=true;
   }
   if(!changed)break;
  }
  throw Error("没有找到完整且通过校验的原版资源。请选择原版资源来源，或单独下载所需文件后继续安装。");
 }
 async remember(root,selected){await assertUnlinkedAncestors(selected,unsafe);const stat=await fsp.lstat(selected),directory=stat.isFile()?path.dirname(selected):selected,file=this.receipt(root);await fsp.mkdir(path.dirname(file),{recursive:true});await assertUnlinkedAncestors(path.dirname(file),unsafe);const temporary=file+"."+crypto.randomUUID()+".tmp";try{await fsp.writeFile(temporary,JSON.stringify({version:1,gamePath:root,directory}),{flag:"wx"});await fsp.rename(temporary,file);}finally{await fsp.rm(temporary,{force:true});}}
}
module.exports={VtfResourceRecovery,accepted};
