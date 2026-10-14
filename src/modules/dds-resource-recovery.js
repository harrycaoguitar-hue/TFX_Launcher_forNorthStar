"use strict";
// Repair the resource container before editing skin ranges. A STARPAK contains
// unrelated game assets too, so only a complete authenticated source may fill
// a missing/truncated container; a hard link is detached without changing bytes.
const fs = require("fs"), fsp = fs.promises, path = require("path"), crypto = require("crypto");
const {assertUnlinkedAncestors} = require("./backup-records");
const {findManifest} = require("./dds-originals");
const {readJournals,retired,rangeKey}=require("./dds-replacement");
const TARGETS = new Set(["pc_stream.starpak", "pc_stream(03).starpak", "pc_stream(05).starpak", "pc_stream(06).starpak", "pc_stream(07).starpak"]);
const unsafe = "皮肤资源路径包含链接或非普通文件，已停止资源读写。";
const sameFile = (a,b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
const resourceDirectory = root => path.join(root,"r2","paks","Win64");
const requirements = rows => {
  const result = new Map();
  for (const row of rows) {
    if (!TARGETS.has(row.target) || !Number.isSafeInteger(row.offset) || row.offset < 0 || !Number.isSafeInteger(row.length) || row.length <= 0 || !Number.isSafeInteger(row.offset+row.length)) throw Error("DDS 资源范围无效");
    result.set(row.target, Math.max(result.get(row.target)||0,row.offset+row.length));
  }
  return result;
};

async function checkedSource(file) {
  await assertUnlinkedAncestors(file,unsafe);
  const stat = await fsp.lstat(file);
  if (!stat.isFile()) throw Error(unsafe);
  return stat;
}

async function digest(file) {
  const hash=crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file,{highWaterMark:4*1024*1024})) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyComplete(file,info,{signal}={}) {
  const checkCancelled=()=>{if(signal?.aborted)throw Object.assign(Error("操作已取消。"),{code:"CANCELLED"});};
  checkCancelled();
  const before=await checkedSource(file);
  if (!info || before.size!==info.size || !info.chunks?.length) throw Error("原版资源的大小与当前 Steam 版本不匹配，未修改游戏。");
  const handle=await fsp.open(file,"r");let covered=0;
  try {
    if(!sameFile(before,await handle.stat()))throw Error("原版资源在校验前发生变化，请重试。");
    for (const chunk of info.chunks) {
      checkCancelled();
      if(chunk.offset!==covered || !Number.isSafeInteger(chunk.length) || chunk.length<=0 || chunk.length>4*1024*1024 || covered+chunk.length>info.size)throw Error("Steam 资源清单未覆盖整个游戏文件，无法安全补齐。");
      const bytes=Buffer.allocUnsafe(chunk.length);let read=0;
      while(read<bytes.length){const result=await handle.read(bytes,read,bytes.length-read,chunk.offset+read);if(!result.bytesRead)throw Error("原版资源不完整，未修改游戏。");read+=result.bytesRead;}
      if(crypto.createHash("sha1").update(bytes).digest("hex")!==chunk.SHA1)throw Error("原版资源未通过 Steam 完整校验，未修改游戏。");
      covered+=chunk.length;
    }
    checkCancelled();
    if(covered!==info.size || !sameFile(before,await handle.stat()))throw Error("原版资源不完整或已变化，未修改游戏。");
  } finally {await handle.close();}
  if(!sameFile(before,await checkedSource(file)))throw Error("原版资源已变化，请重试。");
  return before;
}

class DdsResourceRecovery {
  constructor({baseDir,manifestProvider=findManifest,isGameRunning=async()=>false,progress=()=>{}}) {Object.assign(this,{baseDir,manifestProvider,isGameRunning,progress});}
  async sources(root,target,selected) {
    if(selected) {
      const stat=await checkedSourceOrDirectory(selected);
      return stat.isFile() ? (path.basename(selected).toLowerCase()===target.toLowerCase()?[selected]:[]) : [path.join(selected,target),path.join(selected,"r2","paks","Win64",target)];
    }
    const result=[path.resolve(root,"../../downloading/1237970/r2/paks/Win64",target)];
    // A previous original import can be reused even when the live resource was
    // removed later. The full Steam manifest is verified again before use.
    const folder=path.join(this.baseDir,"originals",crypto.createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex"));
    let entries=[];try{entries=await fsp.readdir(folder);}catch(e){if(e.code!=="ENOENT")throw e;}
    for(const entry of entries.filter(value=>/^[a-f0-9]{64}\.json$/.test(value)).slice(0,1000)) {
      try {const metadata=path.join(folder,entry);await assertUnlinkedAncestors(metadata,unsafe);const stat=await fsp.lstat(metadata);if(!stat.isFile()||stat.size>64*1024)continue;const data=JSON.parse(await fsp.readFile(metadata,"utf8"));if(data.target===target&&typeof data.source==="string"&&path.isAbsolute(data.source)&&path.resolve(data.source).toLowerCase()!==path.join(resourceDirectory(root),target).toLowerCase())result.push(data.source);}catch{}
    }
    return [...new Set(result)];
  }
  async inspect(root,rows) {
    const issues=[],directory=resourceDirectory(root);
    try{await assertUnlinkedAncestors(directory,unsafe);if(!(await fsp.lstat(directory)).isDirectory())throw Error(unsafe);}catch(e){if(e.code!=="ENOENT")return {ready:false,canRepair:false,issues:[{code:"unsafe",target:"r2/paks/Win64",repairable:false}],error:e.message};}
    let manifest;try{manifest=await this.manifestProvider(root);}catch{}
    for(const [target,skinBytes] of requirements(rows)) {
      const requiredBytes=Math.max(skinBytes,manifest?.files.get("r2/paks/win64/"+target.toLowerCase())?.size||0);
      const file=path.join(directory,target);let stat,code;
      try {
        await assertUnlinkedAncestors(path.dirname(file),unsafe);stat=await fsp.lstat(file);
        if(!stat.isFile()||stat.isSymbolicLink())code="unsafe";
        else if(stat.size<requiredBytes)code="truncated";
        else if(stat.nlink!==1)code="linked";
        else {try{await fsp.access(file,fs.constants.R_OK|fs.constants.W_OK);if(!(stat.mode&0o200))code="unwritable";}catch{code="unwritable";}}
      } catch(e){code=e.code==="ENOENT"?"missing":e.message===unsafe?"unsafe":"unwritable";}
      if(!code)continue;
      let repairable=code==="linked"||code==="unwritable"&&Boolean(stat?.isFile());
      if((code==="missing"||code==="truncated")&&manifest?.files.has("r2/paks/win64/"+target.toLowerCase())) {
        for(const source of await this.sources(root,target))try{const sourceStat=await checkedSource(source);if(sourceStat.size===manifest.files.get("r2/paks/win64/"+target.toLowerCase()).size){repairable=true;break;}}catch{}
      }
      issues.push({target,code,requiredBytes,size:stat?.size||0,repairable});
    }
    const messages={missing:"缺少游戏资源，请选择原版资源来源补齐缺失文件",truncated:"游戏资源不完整，将保留现有内容并补齐缺失部分",linked:"游戏资源被多个目录共享，安装前会生成独立副本，避免改动其他目录",unwritable:"游戏资源不可写，安装前将尝试恢复可写状态",unsafe:"皮肤资源路径包含链接或非普通文件，已停止资源读写。"};
    return {ready:issues.length===0,canRepair:issues.length>0&&issues.every(value=>value.repairable),canSteamRepair:Boolean(manifest),issues,...(issues.length?{error:issues.map(issue=>`${issue.target}：${messages[issue.code]}`).join("\n")}:{} )};
  }
  async repair(root,rows,selected) {
    if(await this.isGameRunning())throw Error("请先退出游戏，再修复皮肤资源。");
    const status=await this.inspect(root,rows),manifest=await this.manifestProvider(root);
    if(!status.issues.length)return {repaired:[],game:status};
    const repaired=[];
    for(const issue of status.issues) {
      if(issue.code==="unsafe")throw Error(unsafe);
      const target=path.join(resourceDirectory(root),issue.target);let source=target,sourceStat;
      if(issue.code==="missing"||issue.code==="truncated") {
        const info=manifest?.files.get("r2/paks/win64/"+issue.target.toLowerCase());if(!info)throw Error("未找到当前游戏的官方资源清单，无法验证补齐文件。请先获取对应版本的资源清单。");
        let lastError;
        for(const candidate of await this.sources(root,issue.target,selected)) {
          try {sourceStat=await verifyComplete(candidate,info);source=candidate;break;}catch(e){lastError=e;}
        }
        if(!sourceStat)throw Error(selected?lastError?.message||"所选备份不含所需的原版资源。":"没有找到完整且通过校验的原版资源。请选择原版资源来源，或单独下载所需文件后继续安装。");
      } else sourceStat=await checkedSource(source);
      if(await this.isGameRunning())throw Error("游戏已启动，资源修复已取消。");
      if(issue.code==="unwritable"&&sourceStat.nlink===1&&sourceStat.mode&0o400) {
        // On Windows chmod only controls the read-only attribute. Do not copy
        // an 11 GB resource solely to clear that attribute on an owned file.
        await assertUnlinkedAncestors(target,unsafe);
        if(!sameFile(sourceStat,await fsp.lstat(target)))throw Error("游戏资源在修复期间发生变化，请重试。");
        try {await fsp.chmod(target,sourceStat.mode|0o600);await fsp.access(target,fs.constants.R_OK|fs.constants.W_OK);}
        catch(e){await fsp.chmod(target,sourceStat.mode).catch(()=>{});throw Error("游戏资源的写入权限无法自动恢复，请关闭占用该文件的程序或检查目录权限。");}
        repaired.push({target:issue.target,code:issue.code,bytes:0});continue;
      }
      await ensureResourceDirectory(root,resourceDirectory(root));
      repaired.push(await this.copyPrivate(root,issue,target,source,sourceStat,{preservePrefix:issue.code==="truncated",transform:["missing","truncated"].includes(issue.code)?temporary=>this.replayManaged(root,issue.target,temporary,issue.code==="truncated"?issue.size:0):undefined}));
    }
    return {repaired,game:await this.inspect(root,rows)};
  }
  async replayManaged(root,target,temporary,preservedBytes=0) {
    const journals=await readJournals(this.baseDir,root),active=new Map();
    if(journals.some(entry=>entry.manifest.state==="pending"))throw Error("上次 DDS 操作尚未完成，请先恢复对应备份，再安装新皮肤");
    for(const entry of journals)if(entry.manifest.state==="installed")for(let index=0;index<entry.manifest.records.length;index++){const row=entry.manifest.records[index];if(row.target===target&&!retired(entry,row,journals))active.set(rangeKey(row),{entry,index,row});}
    const handle=await fsp.open(temporary,"r+");try{const stat=await handle.stat();for(const {entry,index,row} of active.values()){if(row.offset+row.length<=preservedBytes)continue;if(row.offset+row.length>stat.size)throw Error("备份与当前游戏目录不匹配");const file=path.join(entry.dir,index+".after.bin");await assertUnlinkedAncestors(file,unsafe);const payload=await fsp.lstat(file);if(!payload.isFile()||payload.size!==row.length)throw Error("备份已损坏，无法恢复");const bytes=await fsp.readFile(file);if(bytes.length!==row.length||crypto.createHash("sha256").update(bytes).digest("hex")!==row.afterHash)throw Error("备份已损坏，无法恢复");let done=Math.max(0,preservedBytes-row.offset);while(done<bytes.length){const result=await handle.write(bytes,done,bytes.length-done,row.offset+done);if(!result.bytesWritten)throw Error("资源修复写入失败。");done+=result.bytesWritten;}}await handle.sync();}finally{await handle.close();}
  }
  async copyPrivate(root,issue,target,source,sourceStat,options={}) {
    const directory=path.dirname(target),token=crypto.randomUUID(),temporary=path.join(directory,`.tfx-resource-${token}.tmp`),rollback=path.join(directory,`.tfx-resource-${token}.before`);
    await assertUnlinkedAncestors(directory,unsafe);
    const available=await fsp.statfs(directory,{bigint:true});if(available.bavail*available.bsize<BigInt(sourceStat.size)+64n*1024n*1024n)throw Error(`修复 ${issue.target} 需要约 ${Math.ceil(sourceStat.size/1024/1024)} MB 可用空间，请先释放游戏所在磁盘的空间。`);
    const original=await fsp.lstat(target).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
    const input=await fsp.open(source,"r"),output=await fsp.open(temporary,"wx",0o600),hash=crypto.createHash("sha256");let copied=0,moved=false,published=false;
    try {
      if(!sameFile(sourceStat,await input.stat()))throw Error("资源在复制前发生变化，请重试。");
      const buffer=Buffer.allocUnsafe(4*1024*1024);
      while(copied<sourceStat.size){const {bytesRead}=await input.read(buffer,0,Math.min(buffer.length,sourceStat.size-copied),copied);if(!bytesRead)throw Error("原版资源不完整，未修改游戏。");let written=0;while(written<bytesRead){const result=await output.write(buffer,written,bytesRead-written,copied+written);if(!result.bytesWritten)throw Error("资源修复写入失败。");written+=result.bytesWritten;}hash.update(buffer.subarray(0,bytesRead));copied+=bytesRead;this.progress({phase:"repair",percent:Math.round(copied/sourceStat.size*85),message:`正在修复 ${issue.target}`});}
      await output.sync();await output.close();await input.close();
      if(!sameFile(sourceStat,await checkedSource(source)))throw Error("复制期间原版资源发生变化，修复已取消。");
      const originalCopyHash=hash.digest("hex");if(await digest(temporary)!==originalCopyHash)throw Error("修复副本校验失败，未修改游戏。");
      if(options.preservePrefix&&original){
        await assertUnlinkedAncestors(target,unsafe);const existing=await fsp.open(target,"r"),candidate=await fsp.open(temporary,"r+");
        try{if(!sameFile(original,await existing.stat()))throw Error("游戏资源在修复期间发生变化，请重试。");const buffer=Buffer.allocUnsafe(4*1024*1024);let offset=0;while(offset<original.size){const count=Math.min(buffer.length,original.size-offset),{bytesRead}=await existing.read(buffer,0,count,offset);if(bytesRead!==count)throw Error("游戏资源在修复期间发生变化，请重试。");let written=0;while(written<count){const result=await candidate.write(buffer,written,count-written,offset+written);if(!result.bytesWritten)throw Error("资源修复写入失败。");written+=result.bytesWritten;}offset+=count;}if(!sameFile(original,await existing.stat()))throw Error("游戏资源在修复期间发生变化，请重试。");await candidate.sync();}finally{await existing.close();await candidate.close();}
      }
      if(options.transform)await options.transform(temporary);
      const finalSize=(await fsp.lstat(temporary)).size;
      const SHA256=options.preservePrefix||options.transform?await digest(temporary):originalCopyHash;
      if(await this.isGameRunning())throw Error("游戏已启动，资源修复已取消。");
      await assertUnlinkedAncestors(directory,unsafe);
      const current=await fsp.lstat(target).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
      if(original?!current||!sameFile(original,current):current)throw Error("游戏资源在修复期间发生变化，请重试。");
      // Keep one directory entry to the old bytes until the new entry has been
      // atomically published. An interruption never leaves the live file absent.
      if(original){await fsp.link(target,rollback);moved=true;}
      try{
        if(original&&!(original.mode&0o200))await fsp.chmod(target,original.mode|0o600);
        await fsp.rename(temporary,target);published=true;await fsp.chmod(target,0o600);
        const result=await checkedSource(target);if(result.nlink!==1||result.size!==finalSize)throw Error("修复文件未通过最终检查。");
      }catch(e){if(moved){await fsp.rename(rollback,target);moved=false;if(original)await fsp.chmod(target,original.mode).catch(()=>{});}else if(published)await fsp.unlink(target);throw e;}
      // Only the superseded directory entry is deleted. Its hard-link peers
      // retain their original bytes; range backups remain the install rollback.
      if(moved){
        // Windows refuses deleting a read-only directory entry. Clear it only
        // for replacement, then restore the attribute on surviving peer links
        // through the old inode handle after releasing our temporary entry.
        const retained=!(original.mode&0o200)&&original.nlink>1?await fsp.open(rollback,"r"):null;
        try{await fsp.unlink(rollback);moved=false;if(retained)await retained.chmod(original.mode);}finally{if(retained)await retained.close();}
      }
      this.progress({phase:"repair",percent:100,message:`${issue.target} 已修复并校验`});
      return {target:issue.target,code:issue.code,bytes:finalSize,SHA256};
    } finally {await input.close().catch(()=>{});await output.close().catch(()=>{});await fsp.rm(temporary,{force:true}).catch(()=>{});if(moved&&!published)await fsp.unlink(rollback).catch(()=>{});}
  }
}
async function checkedSourceOrDirectory(file) {await assertUnlinkedAncestors(file,unsafe);const stat=await fsp.lstat(file);if(!stat.isFile()&&!stat.isDirectory())throw Error(unsafe);return stat;}
async function ensureResourceDirectory(root,directory){
  const relative=path.relative(path.resolve(root),path.resolve(directory));if(relative.startsWith("..")||path.isAbsolute(relative))throw Error(unsafe);let current=path.resolve(root);await assertUnlinkedAncestors(current,unsafe);
  for(const part of relative.split(path.sep).filter(Boolean)){current=path.join(current,part);try{await assertUnlinkedAncestors(current,unsafe);if(!(await fsp.lstat(current)).isDirectory())throw Error(unsafe);}catch(e){if(e.code!=="ENOENT")throw e;await fsp.mkdir(current);await assertUnlinkedAncestors(current,unsafe);}}
}
module.exports={DdsResourceRecovery,verifyComplete,requirements,ensureResourceDirectory};
