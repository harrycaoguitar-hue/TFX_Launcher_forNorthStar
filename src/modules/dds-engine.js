"use strict";
// Import, validation and writes are implemented here. Game resource locations
// use our declarative compatibility resolver; no native installer is loaded.
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const layout = require("./dds-layout");
const {extractZip}=require('./local-mod-import');
const { inspectTextureCoverage } = require("./dds-coverage");
const { readJournals, summarizeBackups, prepareReplacement, overlaps, retired } = require("./dds-replacement");
const { DdsOriginals } = require("./dds-originals");
const { DdsLayoutCompatibility } = require("./dds-layout-compatibility");
const { DdsResourceRecovery } = require("./dds-resource-recovery");
const { DdsResourceTransaction } = require("./dds-resource-transaction");
const {deletionPolicy,readBackupManifest,removeBackupDirectory,ddsBoundaryRequired,assertUnlinkedAncestors} = require("./backup-records");

const MAX_FILES = 500;
const MAX_BYTES = 512 * 1024 * 1024;
const TARGETS = new Set(["pc_stream.starpak", "pc_stream(03).starpak", "pc_stream(05).starpak", "pc_stream(06).starpak", "pc_stream(07).starpak"]);
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const id = () => crypto.randomUUID();
const validId = value => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const errorText = err => err.message || String(err);
const resourcePathError = "皮肤资源路径包含链接或非普通文件，已停止资源读写。";

async function openResource(file, mode) {
  await assertUnlinkedAncestors(file, resourcePathError);
  const before=await fsp.lstat(file);
  if(!before.isFile()||before.nlink!==1)throw Error(resourcePathError);
  const handle=await fsp.open(file,mode);
  try{const opened=await handle.stat();if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.nlink!==1)throw Error(resourcePathError);return handle;}
  catch(error){await handle.close();throw error;}
}

function readDds(data, name) {
  if(data.toString("ascii",0,4)==="VTF\u0000")throw Error("这不是 DDS 皮肤，而是 VTF 皮肤。请到「VTF 安装」导入。");
  if (data.length < 128 || data.toString("ascii", 0, 4) !== "DDS " || data.readUInt32LE(4) !== 124 || data.readUInt32LE(76) !== 32) throw Error(`${name} 不是有效的 DDS 文件`);
  const height = data.readUInt32LE(12), width = data.readUInt32LE(16);
  if (![128, 256, 512, 1024, 2048, 4096].includes(height) || ![256, 512, 1024, 2048, 4096].includes(width) || (height !== width && width !== height * 2)) throw Error(`${name} 的尺寸 ${width}×${height} 不受支持`);
  const fourcc = data.toString("ascii", 84, 88);
  let format = fourcc, blockBytes, skip = 128;
  if (["DXT1", "ATI1", "BC4U", "BC4S"].includes(fourcc)) blockBytes = 8;
  else if (["DXT3", "DXT5", "ATI2", "BC5U", "BC5S"].includes(fourcc)) blockBytes = 16;
  else if (fourcc === "DX10") {
    if (data.length < 148) throw Error(`${name} 的 DX10 标头不完整`);
    const dxgi = data.readUInt32LE(128);
    const formats = {71:["BC1",8],72:["BC1 sRGB",8],74:["BC2",16],75:["BC2 sRGB",16],77:["BC3",16],78:["BC3 sRGB",16],80:["BC4",8],81:["BC4 SNORM",8],83:["BC5",16],84:["BC5 SNORM",16],98:["BC7",16],99:["BC7 sRGB",16]};
    if ((data.readUInt32LE(136) & 4) !== 0) throw Error(`${name} 使用了不支持的立方体或体积皮肤`);
    if (!formats[dxgi] || data.readUInt32LE(132) !== 3 || data.readUInt32LE(140) !== 1) throw Error(`${name} 使用了不支持的 DX10 格式、数组或资源类型`);
    [format, blockBytes] = formats[dxgi]; skip = 148;
  } else throw Error(`${name} 的压缩格式 ${fourcc || "未知"} 不受支持`);
  const payloadLength = Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes;
  if (data.length < skip + payloadLength) throw Error(`${name} 的皮肤数据不完整`);
  if ((data.readUInt32LE(112) & 0xfe00) !== 0 || data.readUInt32LE(24) > 1) throw Error(`${name} 使用了不支持的立方体或体积皮肤`);
  return {width, height, format, skip, payloadLength};
}

async function walk(dir, results = []) {
  for (const entry of await fsp.readdir(dir, {withFileTypes:true})) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file, results);
    else if (entry.isFile() && /\.dds$/i.test(entry.name)) results.push(file);
    if (results.length > MAX_FILES) throw Error(`DDS 文件数量超过 ${MAX_FILES}`);
  }
  return results;
}

async function unzipDds(file, dest) {
  await extractZip(file,dest,{include:name=>/\.dds$/i.test(name),maxBytes:MAX_BYTES,maxFiles:MAX_FILES});
  return (await walk(dest)).map(file=>({file,name:path.basename(file)}));
}

async function writeJson(file, value) {
  const temporary = file + ".tmp";
  await fsp.writeFile(temporary, JSON.stringify(value,null,2), "utf8");
  await fsp.rename(temporary,file);
}

async function readRange(file, offset, length) {
  const handle = await openResource(file,"r");
  const data = Buffer.allocUnsafe(length);
  try {
    let done = 0;
    while (done < length) {
      const result = await handle.read(data,done,length-done,offset+done);
      if (!result.bytesRead) throw Error("游戏包内的皮肤区域不完整");
      done += result.bytesRead;
    }
    return data;
  } finally {await handle.close();}
}

async function writeRange(file, offset, data) {
  const handle = await openResource(file,"r+");
  try {
    let done = 0;
    while (done < data.length) {
      const result = await handle.write(data,done,data.length-done,offset+done);
      if (!result.bytesWritten) throw Error("皮肤区域写入失败");
      done += result.bytesWritten;
    }
    await handle.sync();
  } finally {await handle.close();}
}

class DdsEngine {
  constructor(options) {
    this.baseDir = options.baseDir;
    this.isGameRunning = options.isGameRunning || (async()=>false);
    this.emit = options.progress || (()=>{});
    this.packages = new Map();
    this.busy = false;
    this.originals = new DdsOriginals({baseDir:this.baseDir,plan:(files,dir)=>this.plan(files,dir), progress:data=>this.emit(data), offlinePack:options.offlinePack, ...(options.manifestProvider?{manifestProvider:options.manifestProvider}:{})});
    this.resources = new DdsResourceRecovery({baseDir:this.baseDir,isGameRunning:this.isGameRunning,progress:data=>this.emit(data),...(options.manifestProvider?{manifestProvider:options.manifestProvider}:{})});
    const compatibility=new DdsLayoutCompatibility({manifestProvider:root=>this.resources.manifestProvider(root)});
    // Injected manifests describe isolated test layouts; production always uses
    // the verified catalogue fingerprint unless a validator is explicitly supplied.
    this.layoutCompatibility=options.compatibilityValidator||(options.manifestProvider?async()=>({ready:true,layoutVerified:false,issues:[]}):compatibility.inspect.bind(compatibility));
  }
  async assertLayout(root,rows){const state=await this.layoutCompatibility(root,rows);if(!state.ready)throw Error(state.error);return state;}
  progress(phase, percent, message) {this.emit({phase,percent,message});}
  async initialize() {await fsp.mkdir(path.join(this.baseDir,"packages"),{recursive:true}); await fsp.mkdir(path.join(this.baseDir,"backups"),{recursive:true});}
  async plan(files, dir) {
    return layout.plan(files);
  }
  async inspect(sourcePath) {
    await this.initialize();
    this.progress("inspect",0,"正在读取皮肤包");
    const packageId = id(), dir = path.join(this.baseDir,"packages",packageId);
    await fsp.mkdir(dir,{recursive:true});
    try {
      const stat=await fsp.stat(sourcePath);
      let inputs;
      if(stat.isDirectory()) inputs=(await walk(sourcePath)).map(file=>({file,name:path.basename(file)}));
      else if(/\.dds$/i.test(sourcePath)) inputs=[{file:sourcePath,name:path.basename(sourcePath)}];
      else if(/\.zip$/i.test(sourcePath)) inputs=await unzipDds(sourcePath,dir);
      else if(/\.vtf$/i.test(sourcePath))throw Error("这不是 DDS 皮肤，而是 VTF 皮肤。请到「VTF 安装」导入。");
      else throw Error("这不是 DDS 皮肤或受支持的 DDS 安装包。仅支持 .dds 文件、包含 DDS 的 ZIP 或文件夹；VTF 皮肤请到「VTF 安装」导入。");
      if(!inputs.length) throw Error("这不是 DDS 皮肤：所选项目中没有 DDS 皮肤。VTF 皮肤请到「VTF 安装」导入。");
      const metadata=[];let bytes=0;
      for(let i=0;i<inputs.length;i++) {
        const input=inputs[i];
        if(!/^[A-Za-z0-9_.-]+\.dds$/i.test(input.name))throw Error(`${input.name} 的皮肤名称格式不正确`);
        const size=(await fsp.stat(input.file)).size;bytes+=size;
        if(bytes>MAX_BYTES || size>128*1024*1024)throw Error("皮肤包体积超过支持范围");
        const data=await fsp.readFile(input.file), info=readDds(data,input.name);
        const normalized=path.join(dir,String(i),`${info.width}x${info.height}`,input.name);
        await fsp.mkdir(path.dirname(normalized),{recursive:true});await fsp.writeFile(normalized,data);
        metadata.push({path:normalized,name:input.name,bytes:size,sha256:hash(data),...info});
        this.progress("inspect",Math.round((i+1)/inputs.length*65),`校验皮肤 ${i+1}/${inputs.length}`);
      }
      const plans=await this.plan(metadata.map(item=>item.path),dir);
      const failures=plans.filter(item=>!item.ok);
      if(failures.length)throw Error(failures.map(item=>`${path.basename(item.path)}：${item.error}`).join("\n"));
      const result=metadata.map((item,i)=>({...item,...plans[i]}));
      const locations=new Map();
      for(const item of result) {
        if(!TARGETS.has(item.target)||!Number.isSafeInteger(item.offset)||!Number.isSafeInteger(item.length)||item.length!==item.payloadLength||item.skip!==metadata[result.indexOf(item)].skip)throw Error(`${item.name} 的格式或数据长度与游戏皮肤不匹配`);
        const previous=locations.get(item.target)||[];
        if(previous.some(other=>item.offset<other.offset+other.length&&other.offset<item.offset+item.length))throw Error(`${item.name} 与包中另一个皮肤文件覆盖同一区域`);
        previous.push(item);locations.set(item.target,previous);
      }
      this.progress("inspect",85,"正在检查皮肤分辨率覆盖");
      const coverage=await inspectTextureCoverage(result,(files,dir)=>this.plan(files,dir),dir);
      const pkg={id:packageId,name:path.basename(sourcePath),sourcePath,dir,files:result,count:result.length,bytes:result.reduce((sum,item)=>sum+item.length,0),coverage};
      this.packages.set(packageId,pkg);
      this.progress("inspect",100,`校验通过，${pkg.count} 个皮肤文件可安装`);
      return this.publicPackage(pkg);
    }catch(err){await fsp.rm(dir,{recursive:true,force:true});throw err;}
  }
  publicPackage(pkg) {return {id:pkg.id,name:pkg.name,sourcePath:pkg.sourcePath,count:pkg.count,bytes:pkg.bytes,coverage:pkg.coverage,files:pkg.files.map(({name,width,height,format,target,offset,length})=>({name,width,height,format,target,offset,length}))};}
  async gameStatus(gamePath, pkg) {
    if(!gamePath)return {path:"",ready:false,error:"请先选择泰坦陨落 2 游戏目录"};
    const root=path.resolve(gamePath);
    try{await assertUnlinkedAncestors(path.join(root,"Titanfall2.exe"),resourcePathError);if(!(await fsp.lstat(path.join(root,"Titanfall2.exe"))).isFile())throw Error();}catch(error){return {path:root,ready:false,error:error.message===resourcePathError?resourcePathError:"目录中未找到 Titanfall2.exe"};}
    const base=path.join(root,"r2","paks","Win64");
    try{await assertUnlinkedAncestors(base,resourcePathError);if(!(await fsp.lstat(base)).isDirectory())throw Error(resourcePathError);}catch(error){if(error.code!=="ENOENT")return {path:root,ready:false,error:error.message};}
    const compatibility=await this.layoutCompatibility(root,pkg?.files||[]);if(!compatibility.ready)return {path:root,...compatibility};
    return {path:root,...await this.resources.inspect(root,pkg?.files||[]),layoutVerified:compatibility.layoutVerified};
  }
  async backups(gamePath) {
    await this.initialize();const journals=await readJournals(this.baseDir,gamePath);
    return summarizeBackups(journals).map(row=>{const entry=journals.find(item=>item.manifest.id===row.id);return {...row,...(entry.manifest.skinSwitchId?{skinSwitchId:entry.manifest.skinSwitchId}:{}),...deletionPolicy(entry.manifest,{requiredBoundary:ddsBoundaryRequired(entry,journals)})};});
  }
  async deleteBackup(gamePath,backupId) {
    return this.exclusively(async()=>{
      const record=await readBackupManifest(this.baseDir,backupId,gamePath),journals=await readJournals(this.baseDir,gamePath),entry=journals.find(item=>item.manifest.id===backupId);
      if(!entry)throw Error("DDS 备份记录不存在");
      const policy=deletionPolicy(entry.manifest,{requiredBoundary:ddsBoundaryRequired(entry,journals)});
      if(!policy.canDelete)throw Error(policy.deleteReason);
      return removeBackupDirectory(this.baseDir,backupId,record);
    });
  }
  async activeBackups(gamePath) {return (await this.backups(gamePath)).filter(value=>value.activeCount>0);}
  async replacementStatus(gamePath, packageId) {
    const pkg=this.packages.get(packageId);if(!pkg||!gamePath)return null;
    const game=await this.gameStatus(gamePath);if(!game.ready)return null;
    try{return (await this.originals.prepare(pkg,game.path)).status;}catch(e){return {state:"error",complete:false,canSteamRepair:false,reason:errorText(e),missing:[]};}
  }
  async repairResources(gamePath,packageId,source) {return this.exclusively(async()=>{const pkg=this.packages.get(packageId);if(!pkg)throw Error("请先导入要安装的 DDS 皮肤");const game=await this.gameStatus(gamePath);if(!game.ready)throw Error(game.error);await this.assertLayout(game.path,pkg.files);return this.resources.repair(game.path,pkg.files,source);});}
  async importOriginals(gamePath, packageId, source) {return this.exclusively(async()=>{const pkg=this.packages.get(packageId);if(!pkg)throw Error("请先导入要安装的 DDS 皮肤");const game=await this.gameStatus(gamePath);if(!game.ready)throw Error(game.error);await this.assertLayout(game.path,pkg.files);const resources=await this.gameStatus(game.path,pkg);if(!resources.ready)await this.resources.repair(game.path,pkg.files,source);return (await this.originals.prepare(pkg,game.path,source)).status;});}
  async status(gamePath, packageId) {const pkg=this.packages.get(packageId);return {game:await this.gameStatus(gamePath,pkg),package:pkg?this.publicPackage(pkg):null,backups:await this.backups(gamePath),original:await this.replacementStatus(gamePath,packageId),busy:this.busy};}
  async exclusively(callback) {if(this.busy)throw Error("另一个皮肤操作正在执行");this.busy=true;try {if(await this.isGameRunning())throw Error("请先退出游戏，再安装或恢复皮肤");return await callback();}finally{this.busy=false;}}
  async install(gamePath, packageId, options = {}) {
    return this.exclusively(async()=>{
      const pkg=this.packages.get(packageId);if(!pkg)throw Error("请重新选择并校验皮肤包");
      let game=await this.gameStatus(gamePath,pkg);
      if(!game.ready&&game.canRepair){await this.resources.repair(game.path,pkg.files);game=await this.gameStatus(gamePath,pkg);}
      if(!game.ready)throw Error(game.error);
      const journals=await readJournals(this.baseDir,game.path);
      if(options.prepareJournals)options.prepareJournals(journals);
      this.progress("backup",0,"正在检查旧皮肤与覆盖安装范围");
      const originalPlan=await this.originals.prepare(pkg,game.path);
      if(!originalPlan.status.complete)throw Error(originalPlan.status.reason);
      const replacement=await prepareReplacement({pkg,journals,plan:(files,dir)=>this.plan(files,dir),dir:pkg.dir,readRange,hash,gamePath:game.path,originals:originalPlan.originals,prepareResources:async rows=>{
        let state=await this.gameStatus(game.path,{files:rows});
        if(!state.ready&&state.canRepair){await this.resources.repair(game.path,rows);state=await this.gameStatus(game.path,{files:rows});}
        if(!state.ready)throw Error(state.error);
      }});
      let unionStatus=await this.gameStatus(game.path,{files:replacement.rows});
      if(!unionStatus.ready&&unionStatus.canRepair){await this.resources.repair(game.path,replacement.rows);unionStatus=await this.gameStatus(game.path,{files:replacement.rows});}
      if(!unionStatus.ready)throw Error(unionStatus.error);
      const backupId=id(), dir=path.join(this.baseDir,"backups",backupId);
      // A monotonic timestamp keeps the restore stack deterministic even if the
      // system clock moves backwards or two installs finish in one millisecond.
      const newest=journals.reduce((value,entry)=>Math.max(value,Date.parse(entry.manifest.createdAt)),0);
      const manifest={version:1,id:backupId,name:pkg.name,gamePath:game.path,createdAt:new Date(Math.max(Date.now(),newest+1)).toISOString(),state:"preparing",records:[],coverage:pkg.coverage||null,
        replacementVersion:1,supersedes:replacement.supersedes,replacedFamilies:replacement.replacedFamilies,packageCount:pkg.count,...(options.skinSwitchId?{skinSwitchId:options.skinSwitchId}:{})};
      await fsp.mkdir(dir,{recursive:true});
      const manifestPath=path.join(dir,"manifest.json");
      this.progress("backup",0,"正在备份所有将被修改的皮肤区域");
      for(let i=0;i<replacement.rows.length;i++) {
        const item=replacement.rows[i];
        await fsp.writeFile(path.join(dir,`${i}.before.bin`),item.before);await fsp.writeFile(path.join(dir,`${i}.after.bin`),item.after);
        manifest.records.push({target:item.target,offset:item.offset,length:item.length,beforeHash:item.beforeHash,afterHash:item.afterHash,
          name:item.name,family:item.family,width:item.width,height:item.height,kind:item.kind,role:item.role,...(item.originalReset?{originalReset:true}:{})});
        this.progress("backup",Math.round((i+1)/replacement.rows.length*35),`备份 ${i+1}/${replacement.rows.length}`);
      }
      manifest.state="pending";await writeJson(manifestPath,manifest);
      if(options.beforeWrite)await options.beforeWrite({manifest,dir});
      let written=0;
      try {
        const resources=new DdsResourceTransaction(game.path);
        try{
        // Check resource layout and the entire baseline before the first write.
        await this.assertLayout(game.path,manifest.records);
        for(const record of manifest.records)if(hash(await resources.read(path.join(game.path,"r2","paks","Win64",record.target),record.offset,record.length))!==record.beforeHash)throw Error("游戏皮肤在备份后被其他程序修改，操作已取消");
        if(await this.isGameRunning())throw Error("游戏已启动，安装已取消");
        for(let i=0;i<manifest.records.length;i++) {
          const record=manifest.records[i],file=path.join(game.path,"r2","paks","Win64",record.target);
          const after=await fsp.readFile(path.join(dir,`${i}.after.bin`));if(after.length!==record.length||hash(after)!==record.afterHash)throw Error("备份中的新皮肤已损坏，安装已取消");
          await resources.write(file,record.offset,after,()=>{written=i+1;});
          if(hash(await resources.read(file,record.offset,record.length))!==record.afterHash)throw Error("安装后的皮肤校验失败");
          this.progress("install",35+Math.round((i+1)/manifest.records.length*60),`写入并验证 ${i+1}/${manifest.records.length}`);
        }
        if(await this.isGameRunning())throw Error("游戏已启动，安装已取消");
        await resources.flush();
        }finally{await resources.close();}
        manifest.state="installed";await writeJson(manifestPath,manifest);
      }catch(err){
        for(let i=written-1;i>=0;i--){
          const r=manifest.records[i],target=path.join(game.path,"r2","paks","Win64",r.target);
          await writeRange(target,r.offset,await fsp.readFile(path.join(dir,`${i}.before.bin`)));
          if(hash(await readRange(target,r.offset,r.length))!==r.beforeHash)throw Error(`安装失败且自动回滚未通过校验，已保留恢复备份：${backupId}`);
        }
        manifest.state=written?"rolled-back":"cancelled";await writeJson(manifestPath,manifest);throw err;
      }
      this.progress("complete",100,`${pkg.count} 个 DDS 皮肤文件已安装${replacement.resetCount?`，已清理 ${replacement.resetCount} 处旧皮肤残留`:""}，备份已保存`);
      return {backupId,count:pkg.count,bytes:pkg.bytes,resetCount:replacement.resetCount,supersedes:replacement.supersedes};
    });
  }
  async restore(gamePath, backupId) {
    return this.exclusively(async()=>{
      if(!validId(backupId))throw Error("备份编号无效");
      const {dir,file,manifest}=await readBackupManifest(this.baseDir,backupId,gamePath);
      if(manifest.id!==backupId||manifest.version!==1||path.resolve(manifest.gamePath)!==path.resolve(gamePath||""))throw Error("备份与当前游戏目录不匹配");
      if(!["installed","pending"].includes(manifest.state))throw Error("这个备份已经恢复或没有完成安装");
      const journals=await readJournals(this.baseDir,gamePath),index=journals.findIndex(entry=>entry.manifest.id===backupId);
      if(manifest.records.some(record=>retired(journals[index],record,journals)))throw Error("这份旧备份已被原版资源验证替代，不能再恢复旧皮肤残留");
      if(journals.slice(index+1).some(entry=>["installed","pending"].includes(entry.manifest.state)&&entry.manifest.records.some(other=>manifest.records.some(record=>overlaps(record,other)))))throw Error("这部分皮肤已被后续安装修改。请先恢复较新的备份，再恢复这个备份");
      const game=await this.gameStatus(gamePath,{files:manifest.records});if(!game.ready)throw Error(game.error);
      const before=[];
      for(let i=0;i<manifest.records.length;i++) {
        const r=manifest.records[i];if(!TARGETS.has(r.target)||!Number.isSafeInteger(r.offset)||r.offset<=0||!Number.isSafeInteger(r.length)||r.length<=0||r.length>128*1024*1024)throw Error("备份记录无效");
        const saved=await fsp.readFile(path.join(dir,`${i}.before.bin`));if(saved.length!==r.length||hash(saved)!==r.beforeHash)throw Error("备份已损坏，无法恢复");
        const current=await readRange(path.join(game.path,"r2","paks","Win64",r.target),r.offset,r.length);
        const currentHash=hash(current);
        if(manifest.state==="installed"&&currentHash!==r.afterHash)throw Error("这部分皮肤已被后续安装修改。请先恢复较新的备份，再恢复这个备份");
        if(manifest.state==="pending"&&currentHash!==r.afterHash&&currentHash!==r.beforeHash)throw Error("未完成安装的皮肤区域已被其他程序修改，请先处理冲突后再恢复");
        before.push({saved,current});
      }
      this.progress("restore",0,"备份校验通过，正在恢复皮肤");let written=0;
      if(await this.isGameRunning())throw Error("游戏已启动，请先退出游戏再恢复皮肤");
      try{
        const resources=new DdsResourceTransaction(game.path);
        try{
        for(let i=0;i<manifest.records.length;i++) {
          const r=manifest.records[i],target=path.join(game.path,"r2","paks","Win64",r.target);
          if(hash(await resources.read(target,r.offset,r.length))!==hash(before[i].current))throw Error("恢复期间游戏皮肤发生变化，恢复已取消");
          await resources.write(target,r.offset,before[i].saved,()=>{written=i+1;});
          if(hash(await resources.read(target,r.offset,r.length))!==r.beforeHash)throw Error("恢复后的皮肤校验失败");
          this.progress("restore",Math.round((i+1)/manifest.records.length*95),`恢复并验证 ${i+1}/${manifest.records.length}`);
        }
        if(await this.isGameRunning())throw Error("游戏已启动，请先退出游戏再恢复皮肤");
        await resources.flush();
        }finally{await resources.close();}
        manifest.state="restored";manifest.restoredAt=new Date().toISOString();await writeJson(file,manifest);
      }catch(err){
        for(let i=written-1;i>=0;i--){
          const r=manifest.records[i],target=path.join(game.path,"r2","paks","Win64",r.target);
          await writeRange(target,r.offset,before[i].current);
          if(hash(await readRange(target,r.offset,r.length))!==hash(before[i].current))throw Error(`恢复失败且自动撤销未通过校验，已保留恢复备份：${backupId}`);
        }
        throw err;
      }
      this.progress("complete",100,"安装前的皮肤已恢复，校验通过");return {backupId,count:manifest.records.length};
    });
  }
}
module.exports={DdsEngine,readDds,readRange,writeRange,errorText};
