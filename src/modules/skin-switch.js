"use strict";
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto");
const {parseIndex,parseTruncatedIndex,serializeIndex,hash,hashFile,readIndexFile,MAX_INDEX_BYTES}=require("./vtf-vpk");
const {INDEX_NAME,archiveName,acquireGameLock}=require("./vtf-engine");
const {readRange,writeRange}=require("./dds-engine");
const {readJournals,textureFamily,rangeKey,retired,legacyCatalogue}=require("./dds-replacement");
const {packageWeapons,belongs,ddsFamiliesForWeapons}=require("./skin-switch-weapons");
const {terminalStates,deletionPolicy,readRecord,readBackupManifest,inspectRemoval,removeRecord,assertUnlinkedAncestors}=require("./backup-records");
const {verifyComplete,ensureResourceDirectory}=require("./dds-resource-recovery");
const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/.test(value);
const identity=value=>{try{return fs.realpathSync.native(path.resolve(value)).toLowerCase();}catch{return path.resolve(value).toLowerCase();}};
const same=(a,b)=>identity(a)===identity(b);
const missingDds="当前武器缺少可信原皮资源，请使用自动修复并安装，或选择完整原版资源来源。";
const entryHash=entry=>entry?hash(entry.raw||serializeIndex([entry])):null;
const entryMap=bytes=>new Map(parseIndex(bytes).entries.map(entry=>[entry.path.toLowerCase(),entry]));
async function json(file,value){const temporary=file+".tmp";const handle=await fsp.open(temporary,"w");try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}await fsp.rename(temporary,file);}
async function atomicIndex(file,bytes){const temporary=file+".skin-switch.tmp";const handle=await fsp.open(temporary,"w");try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await fsp.rename(temporary,file);}
class SkinSwitchCoordinator{
 constructor({baseDir,dds,vtf,acquireLock=acquireGameLock,originalProvider}){this.baseDir=baseDir;this.dds=dds;this.vtf=vtf;this.acquireLock=acquireLock;this.originalProvider=originalProvider;this.busy=false;this.core={dds:{install:dds.install.bind(dds),restore:dds.restore.bind(dds),deleteBackup:dds.deleteBackup?.bind(dds)},vtf:{install:vtf.install.bind(vtf),restore:vtf.restore.bind(vtf),deleteBackup:vtf.deleteBackup?.bind(vtf)}};}
 async initialize(){await fsp.mkdir(this.baseDir,{recursive:true});await this.dds.initialize();await this.vtf.initialize();}
 async canonical(gamePath){await assertUnlinkedAncestors(path.resolve(gamePath),"皮肤资源路径包含链接或非普通文件，已停止资源读写。");const root=await fsp.realpath(path.resolve(gamePath));if(!(await fsp.stat(path.join(root,"Titanfall2.exe"))).isFile())throw Error("目录中未找到 Titanfall2.exe");return root;}
 async transactions(gamePath){await this.initialize();const result=[];for(const item of await fsp.readdir(this.baseDir,{withFileTypes:true})){if(!item.isDirectory()||!validId(item.name))continue;const dir=path.join(this.baseDir,item.name);let value;try{value=(await readRecord(this.baseDir,item.name,gamePath,"transaction.json",{allowOtherGames:true})).manifest;}catch(error){const files=await fsp.readdir(dir);if(error.code==='ENOENT'&&files.every(name=>name==='transaction.json.tmp'))continue;throw Error("跨格式皮肤恢复记录无法读取，请保留备份并修复记录："+dir);}if(value.version!==1||value.id!==item.name||!path.isAbsolute(value.gamePath)||(value.incomingBackupId!==null&&value.incomingBackupId!==undefined&&!validId(value.incomingBackupId))||!["preparing","prepared","cleaning","cleaned","core-pending","installed","restoring","restored","rolled-back","cancelled","recovery-required"].includes(value.state)||!Array.isArray(value.ranges)||value.ranges.length>1000||!Array.isArray(value.weapons)||value.weapons.length>128||!value.weapons.every(w=>typeof w==="string"&&/^[a-z][a-z0-9_]*$/.test(w))||!['dds','vtf'].includes(value.format)||!Number.isFinite(Date.parse(value.createdAt))||!value.ranges.every(r=>['pc_stream.starpak','pc_stream(03).starpak','pc_stream(05).starpak','pc_stream(06).starpak','pc_stream(07).starpak'].includes(r.target)&&Number.isSafeInteger(r.offset)&&r.offset>0&&Number.isSafeInteger(r.length)&&r.length>0&&r.length<=128*1024*1024&&Number.isSafeInteger(r.offset+r.length)&&/^[a-f0-9]{64}$/.test(r.beforeHash)&&/^[a-f0-9]{64}$/.test(r.cleanHash)&&(r.finalHash===undefined||/^[a-f0-9]{64}$/.test(r.finalHash)))||value.ranges.some((r,i)=>value.ranges.slice(0,i).some(other=>r.target===other.target&&r.offset<other.offset+other.length&&other.offset<r.offset+r.length)))throw Error("跨格式皮肤恢复记录无效，已停止资源写入");if(same(value.gamePath,gamePath))result.push({value,dir});}return result.sort((a,b)=>a.value.createdAt.localeCompare(b.value.createdAt));}
 async pending(gamePath){const root=await this.canonical(gamePath);return (await this.transactions(root)).filter(({value})=>!["installed","restored","rolled-back","cancelled"].includes(value.state)).map(({value})=>({id:value.id,state:value.state,name:value.name,format:value.format,backupId:value.incomingBackupId||null}));}
 async assertReady(gamePath){const pending=await this.pending(gamePath);if(pending.length)throw Error("上次跨格式换肤未完成，请在 DDS 或 VTF 安装页面恢复「"+pending[0].name+"」备份后重试；恢复编号："+pending[0].id);}
 async locked(gamePath,action){if(this.busy)throw Error("另一个跨格式皮肤操作正在执行");this.busy=true;let release;try{const root=await this.canonical(gamePath);if(await this.dds.isGameRunning())throw Error("请先退出游戏，再安装或恢复皮肤");release=await this.acquireLock(root);return await action(root);}finally{try{if(release)await release();}finally{this.busy=false;}}}
 async vtfHistory(root){const result=[];for(const m of await this.vtf.manifests(root)){this.vtf.validateManifest(m,m.id,root);if(["preparing","pending"].includes(m.state))throw Error("上次 VTF 操作未完成，请先恢复该备份");if(m.state!=="installed")continue;const dir=path.join(this.vtf.baseDir,"backups",m.id),before=await fsp.readFile(path.join(dir,"before-index.vpk")),after=await fsp.readFile(path.join(dir,"after-index.vpk"));if(hash(before)!==m.beforeHash||hash(after)!==m.afterHash)throw Error("VTF 索引备份校验失败，跨格式替换已取消");if(await hashFile(path.join(root,"vpk",m.archiveName))!==m.archiveHash)throw Error("VTF 皮肤归档已被修改，跨格式替换已取消");result.push({m,before:entryMap(before),after:entryMap(after)});}return result.sort((a,b)=>a.m.createdAt.localeCompare(b.m.createdAt));}
 legacyDdsAvailable(){return !this.originalProvider&&typeof this.dds.plan==='function'&&typeof this.dds.originals?.prepare==='function';}
 async weaponDdsRows(root,weapons,dir){
  if(!this.legacyDdsAvailable())return [];
  const families=ddsFamiliesForWeapons(weapons);if(!weapons.length||weapons.some(weapon=>!ddsFamiliesForWeapons([weapon]).length))throw Error("无法确认这份皮肤的武器归属，请先恢复已有皮肤或使用受支持的原版资源，再执行跨格式替换");
  const paths=[];for(const family of families)for(const suffix of ['col','ao','gls','ilm','nml','spc','cav','opa'])for(const height of [128,256,512,1024,2048,4096])for(const ratio of [1,2]){const width=height*ratio;if(width>4096)continue;paths.push(path.join(dir,'weapon-table',`${width}x${height}`,family+'_'+suffix+'.dds'));}
  const planned=await this.dds.plan(paths,dir);if(!Array.isArray(planned)||planned.length!==paths.length)throw Error("覆盖安装的旧皮肤元数据响应不完整");const seeds=[];
  for(let i=0;i<planned.length;i++){const row=planned[i];if(!row||!same(row.path,paths[i])||typeof row.ok!=='boolean')throw Error("覆盖安装的旧皮肤元数据路径无效");if(!row.ok){if(!['没有匹配到受支持的皮肤名称与尺寸','不支持的皮肤尺寸目录','没有匹配到受支持的纹理名称与尺寸','不支持的纹理尺寸目录'].includes(String(row.error).trim()))throw Error("覆盖安装的旧皮肤元数据无效");continue;}const dimensions=/^(\d+)x(\d+)$/.exec(path.basename(path.dirname(paths[i]))),name=path.basename(paths[i]);seeds.push({...row,name,width:Number(dimensions[1]),height:Number(dimensions[2]),family:textureFamily(name)});}
  const catalogue=await legacyCatalogue(seeds,(files,base)=>this.dds.plan(files,base),dir),rows=[...catalogue.values()];if(!rows.length||rows.some(row=>!belongs(row.name,weapons,'dds')))throw Error("无法确认这份皮肤的武器归属，请先恢复已有皮肤或使用受支持的原版资源，再执行跨格式替换");
  for(let i=0;i<rows.length;i++)if(rows.slice(0,i).some(other=>rows[i].target===other.target&&rows[i].offset<other.offset+other.length&&other.offset<rows[i].offset+rows[i].length))throw Error("旧皮肤与新皮肤的皮肤区域不完全对应，请先恢复旧备份");
  if(typeof this.dds.assertLayout==='function')await this.dds.assertLayout(root,rows);return rows;
 }
 async skinRepairRequirements(root,pkg,format,source){
  if(typeof pkg==='string')pkg=this[format].packages.get(pkg);if(!pkg)throw Error("请重新导入并校验皮肤包");const weapons=packageWeapons(format,pkg),dir=pkg.dir||path.join(this.baseDir,'resource-table');let ddsRows=[],ddsOriginal=null,ddsTargets=[];
  if(format==='vtf'&&this.legacyDdsAvailable()){ddsRows=await this.weaponDdsRows(root,weapons,dir);let prepared=await this.dds.originals.prepare({files:ddsRows,dir},root);if(source&&ddsRows.some(row=>!prepared.originals.has(rangeKey(row))))prepared=await this.dds.originals.prepare({files:ddsRows,dir},root,source);const missing=ddsRows.filter(row=>!prepared.originals.has(rangeKey(row)));ddsOriginal={...prepared.status,state:missing.length?'needs-source':'ready',complete:!missing.length,missingCount:missing.length,requiredCount:ddsRows.length,availableCount:ddsRows.length-missing.length};ddsTargets=[...new Set(missing.map(row=>'r2/paks/win64/'+row.target.toLowerCase()))];}
  let stock=this.vtf.originals?await this.vtf.originals.prepare(root):null;if(source&&stock&&!stock.status.complete)stock=await this.vtf.originals.prepare(root,source);const vtfOriginal=stock?.status||null,vtfIssues=[];
  if(this.vtf.resources?.inspect){const game=await this.vtf.resources.inspect(root);for(const issue of game.issues||[])if(issue.target.toLowerCase()==='vpk/'+INDEX_NAME){if(issue.code==='unsafe')throw Error("皮肤资源路径包含链接或非普通文件，已停止资源读写。");vtfIssues.push({...issue,target:issue.target.toLowerCase()});}}
  if(stock?.entries){const extents=new Map();for(const entry of stock.entries.filter(entry=>belongs(entry.path,weapons)))for(const chunk of entry.chunks){const target='vpk/'+archiveName(entry.index);extents.set(target,Math.max(extents.get(target)||0,chunk.offset+chunk.compressedSize));}const manifest=this.vtf.resources?.manifestProvider?await this.vtf.resources.manifestProvider(root):null;
   for(const [target,extent]of extents){const info=manifest?.files.get(target.toLowerCase());if(info&&extent>info.size)throw Error("common 索引中的资源范围超出当前官方文件，未修改游戏。");const requiredBytes=Math.max(extent,info?.size||0),file=path.join(root,...target.split('/'));let size=0,code;
    try{await assertUnlinkedAncestors(file,"皮肤资源路径包含链接或非普通文件，已停止资源读写。");const stat=await fsp.lstat(file);if(!stat.isFile())throw Error("皮肤资源路径包含链接或非普通文件，已停止资源读写。");size=stat.size;if(size<requiredBytes)code='truncated';}catch(error){if(error.code==='ENOENT')code='missing';else throw error;}
    if(code)vtfIssues.push({target,code,requiredBytes,size,repairable:Boolean(info)});
   }
  }
  const vtfTargets=[];for(const issue of vtfIssues){if(!['missing','truncated'].includes(issue.code))continue;let local=issue.target==='vpk/'+INDEX_NAME&&Boolean(vtfOriginal?.complete||await this.vtf.resources.historyIndex?.(root));if(!local){const info=(await this.vtf.resources.manifestProvider(root))?.files.get(issue.target.toLowerCase());if(info)for(const candidate of await this.vtf.resources.sources(root,path.posix.basename(issue.target)))try{await verifyComplete(candidate,info);local=true;break;}catch(error){if(error.message==="皮肤资源路径包含链接或非普通文件，已停止资源读写。")throw error;}}issue.repairable=local;if(!local)vtfTargets.push(issue.target);}
  const ready=(!ddsOriginal||ddsOriginal.complete)&&(!vtfOriginal||vtfOriginal.complete||!vtfOriginal.canSteamRepair)&&!vtfIssues.length;return {ready,state:ready?'ready':'needs-source',ddsRows,ddsOriginal,ddsTargets,vtfOriginal,vtfTargets,vtfIssues,canSteamRepair:Boolean(ddsOriginal?.canSteamRepair||vtfOriginal?.canSteamRepair),reason:ddsOriginal&&!ddsOriginal.complete?missingDds:vtfOriginal&&!vtfOriginal.complete?vtfOriginal.reason:vtfIssues.length?"没有找到完整且通过校验的原版资源。请选择原版资源来源，或单独下载所需文件后继续安装。":''};
 }
 async prepareSkinRepairSource(root,pkg,format,source){
  if(await this.dds.isGameRunning())throw Error("请先退出游戏，再修复皮肤资源。");let requirements=await this.skinRepairRequirements(root,pkg,format,source);const repaired=[];
  if(requirements.vtfIssues.length){const manifest=this.vtf.resources?.manifestProvider?await this.vtf.resources.manifestProvider(root):null;
   for(const issue of requirements.vtfIssues){const info=manifest?.files.get(issue.target.toLowerCase()),target=path.join(root,...issue.target.split('/')),isIndex=issue.target==='vpk/'+INDEX_NAME;let verified,sourceFile,transform;
    if(['linked','unwritable'].includes(issue.code)){await this.vtf.resources.repair(root,source);continue;}
    const history=isIndex?await this.vtf.resources.historyIndex?.(root):null;if(history){verified=history.stat;sourceFile=history.file;}
    if(!verified){if(!info)throw Error("未找到当前游戏的官方资源清单，无法验证补齐文件。请先获取对应版本的资源清单。");const candidates=await this.vtf.resources.sources(root,path.posix.basename(issue.target),source);if(isIndex&&requirements.vtfOriginal?.complete)candidates.unshift(requirements.vtfOriginal.cachePath);for(const candidate of candidates.filter(value=>typeof value==='string'))try{verified=await verifyComplete(candidate,info);sourceFile=candidate;break;}catch(error){if(error.message==="皮肤资源路径包含链接或非普通文件，已停止资源读写。")throw error;}}if(!verified)throw Error("没有找到完整且通过校验的原版资源。请选择原版资源来源，或单独下载所需文件后继续安装。");
    if(isIndex&&issue.code==='truncated'){await assertUnlinkedAncestors(target,"皮肤资源路径包含链接或非普通文件，已停止资源读写。");const stat=await fsp.lstat(target);if(!stat.isFile()||stat.size>MAX_INDEX_BYTES)throw Error("游戏 common 索引文件无效或超过支持的大小");const damaged=await fsp.readFile(target);let retained;if(damaged.length<16){const original=await fsp.readFile(sourceFile);if(!damaged.equals(original.subarray(0,damaged.length)))throw Error("VPK 索引头与通过校验的来源不一致，未修改游戏。");retained=[];}else retained=parseTruncatedIndex(damaged).entries;const folder=path.join(this.vtf.baseDir,'resource-recovery',hash(Buffer.from(path.resolve(root).toLowerCase())));await fsp.mkdir(folder,{recursive:true});await assertUnlinkedAncestors(folder,"皮肤资源路径包含链接或非普通文件，已停止资源读写。");await fsp.writeFile(path.join(folder,crypto.randomUUID()+'.index.vpk'),damaged,{flag:'wx'});if(retained.length)transform=async file=>{const parsed=parseIndex(await fsp.readFile(file)),replacements=new Map(retained.map(entry=>[entry.path.toLowerCase(),entry])),entries=parsed.entries.map(entry=>{const replacement=replacements.get(entry.path.toLowerCase());replacements.delete(entry.path.toLowerCase());return replacement||entry;});entries.push(...replacements.values());const merged=serializeIndex(entries);parseIndex(merged);await fsp.writeFile(file,merged);};}
    await ensureResourceDirectory(root,path.dirname(target));repaired.push(await this.vtf.resources.copier.copyPrivate(root,issue,target,sourceFile,verified,{preservePrefix:issue.code==='truncated'&&!isIndex,transform}));}
   requirements=await this.skinRepairRequirements(root,pkg,format);
  }return {...requirements,repaired};
 }
 async vpkPlan(root,weapons){const history=await this.vtfHistory(root),indexPath=path.join(root,"vpk",INDEX_NAME);let before;try{before=await readIndexFile(indexPath);}catch(error){if(error.code==='ENOENT'&&!history.length)return null;throw error;}const current=entryMap(before),stock=this.vtf.originals?await this.vtf.originals.prepare(root):null;
  if(stock?.entries){
   const original=new Map(stock.entries.filter(entry=>belongs(entry.path,weapons)).map(entry=>[entry.path.toLowerCase(),entry])),paths=[];
   // Only the selected weapon family returns to authenticated stock entries.
   // Other weapons retain even unknown third-party overrides.
   for(const [key,entry]of current)if(belongs(key,weapons)){const clean=original.get(key);if(entryHash(entry)!==entryHash(clean))paths.push(key);if(clean)current.set(key,clean);else current.delete(key);original.delete(key);}
   for(const [key,entry]of original){current.set(key,entry);paths.push(key);}
   const targets=new Map();for(const entry of stock.entries.filter(value=>belongs(value.path,weapons)))for(const chunk of entry.chunks)targets.set(archiveName(entry.index),Math.max(targets.get(archiveName(entry.index))||0,chunk.offset+chunk.compressedSize));
   for(const [name,extent]of targets){const target=path.join(root,"vpk",name);await assertUnlinkedAncestors(target,"皮肤资源路径包含链接或非普通文件，已停止资源读写。");const stat=await fsp.lstat(target);if(!stat.isFile()||stat.size<extent)throw Error("原版 VTF 资源归档不完整，请先补齐对应文件："+name);}
   return {path:indexPath,before,after:serializeIndex([...current.values()]),paths};
  }
  if(stock&&!stock.status.complete&&stock.status.canSteamRepair)throw Error(stock.status.reason);
  const changes=new Map();for(const item of history)for(const file of item.m.files){if(!belongs(file.path,weapons))continue;const key=file.path.toLowerCase();if(!changes.has(key))changes.set(key,[]);changes.get(key).push(item);}
  for(const [key,chain]of changes){const currentEntry=current.get(key);let latest=-1;for(let i=chain.length-1;i>=0;i--)if(entryHash(currentEntry)===entryHash(chain[i].after.get(key))){latest=i;break;}
   if(latest<0){if(chain.some(item=>entryHash(currentEntry)===entryHash(item.before.get(key))))continue;throw Error("同一武器的 VTF 资源已被其他程序修改，未执行跨格式替换："+key);}
   let original=chain[latest].before.get(key);for(let i=latest-1;i>=0;i--){if(entryHash(original)!==entryHash(chain[i].after.get(key)))break;original=chain[i].before.get(key);}
   if(original)current.set(key,original);else current.delete(key);
  }
  // A same-weapon entry absent from every managed write must still match the
  // earliest pre-install snapshot. Unknown overrides cannot be guessed away.
  if(history.length)for(const [key,entry]of current){if(!belongs(key,weapons)||changes.has(key))continue;const baseline=history[0].before.get(key);if(entryHash(entry)!==entryHash(baseline))throw Error("检测到未记录的同武器 VTF 覆盖，请先恢复原版 VPK 索引或验证游戏文件："+key);}
  const after=serializeIndex([...current.values()]);return {path:indexPath,before,after,paths:[...changes.keys()]};
 }
 async ddsPlan(root,weapons,dir){const journals=await readJournals(this.dds.baseDir,root);if(journals.some(e=>e.manifest.state==='pending'))throw Error("上次 DDS 操作未完成，请先恢复该备份");const chains=new Map();for(const entry of journals){if(entry.manifest.state!=='installed')continue;for(let i=0;i<entry.manifest.records.length;i++){const r=entry.manifest.records[i];if(retired(entry,r,journals)||!belongs(r.family||r.name,weapons,'dds'))continue;const key=rangeKey(r);if(!chains.has(key))chains.set(key,[]);chains.get(key).push({entry,r,i});}}
  const tracked=[...chains.values()].map(chain=>{const r=chain.at(-1).r;return {...r,name:r.name,family:r.family||textureFamily(r.name),path:path.join(dir,r.name)}}),catalogue=this.legacyDdsAvailable()?await this.weaponDdsRows(root,weapons,dir):[],wanted=new Map(catalogue.map(row=>[rangeKey(row),row]));for(const row of tracked)wanted.set(rangeKey(row),row);const files=[...wanted.values()];if(!files.length)return [];
  if(typeof this.dds.assertLayout==='function')await this.dds.assertLayout(root,files);
  let resourceStatus=await this.dds.gameStatus(root,{files});
  if(!resourceStatus.ready&&resourceStatus.canRepair){await this.dds.resources.repair(root,files);resourceStatus=await this.dds.gameStatus(root,{files});}
  if(!resourceStatus.ready)throw Error(resourceStatus.error);
  const originals=this.originalProvider?await this.originalProvider({root,files,dir}):(await this.dds.originals.prepare({files,dir},root)).originals;const rows=[];
  for(const r of files){const key=rangeKey(r),chain=chains.get(key)||[],original=originals.get(key);if(!original||!Buffer.isBuffer(original.bytes)||original.bytes.length!==r.length)throw Error(missingDds);for(const item of chain)for(const side of ['before','after']){const bytes=await fsp.readFile(path.join(item.entry.dir,item.i+'.'+side+'.bin'));if(bytes.length!==item.r.length||hash(bytes)!==item.r[side+'Hash'])throw Error("DDS 备份校验失败，跨格式替换已取消");}
   const before=await readRange(path.join(root,'r2/paks/Win64',r.target),r.offset,r.length),current=hash(before);if(chain.length&&current!==chain.at(-1).r.afterHash&&current!==hash(original.bytes))throw Error("同一武器的 DDS 资源已被其他程序修改，未执行跨格式替换");if(current!==hash(original.bytes))rows.push({...r,before,after:original.bytes});
  }return rows;
 }
 async saveRange(tx,dir,row){const key=rangeKey(row);let index=tx.ranges.findIndex(r=>rangeKey(r)===key);if(index>=0)return index;index=tx.ranges.length;await fsp.writeFile(path.join(dir,index+'.before.bin'),row.before,{flag:'wx'});await fsp.writeFile(path.join(dir,index+'.clean.bin'),row.after,{flag:'wx'});tx.ranges.push({target:row.target,offset:row.offset,length:row.length,beforeHash:hash(row.before),cleanHash:hash(row.after),name:row.name,family:row.family||textureFamily(row.name)});return index;}
 async currentRanges(root,tx,dir,label){for(let i=0;i<tx.ranges.length;i++){const r=tx.ranges[i],bytes=await readRange(path.join(root,'r2/paks/Win64',r.target),r.offset,r.length);await fsp.writeFile(path.join(dir,i+'.'+label+'.bin'),bytes);r[label+'Hash']=hash(bytes);}}
 async commitClean(root,tx,dir){if(await this.dds.isGameRunning())throw Error("游戏已启动，跨格式换肤已取消");for(let i=0;i<tx.ranges.length;i++){const r=tx.ranges[i];if(hash(await readRange(path.join(root,'r2/paks/Win64',r.target),r.offset,r.length))!==r.beforeHash)throw Error("游戏资源在备份后发生变化，跨格式换肤已取消");}if(tx.indexBeforeHash&&hash(await readIndexFile(path.join(root,'vpk',INDEX_NAME)))!==tx.indexBeforeHash)throw Error("common 索引在备份后发生变化，跨格式换肤已取消");tx.state='cleaning';await json(path.join(dir,'transaction.json'),tx);
  if(tx.indexBeforeHash)await atomicIndex(path.join(root,'vpk',INDEX_NAME),await fsp.readFile(path.join(dir,'clean-index.vpk')));for(let i=0;i<tx.ranges.length;i++){const r=tx.ranges[i];await writeRange(path.join(root,'r2/paks/Win64',r.target),r.offset,await fsp.readFile(path.join(dir,i+'.clean.bin')));}tx.state='cleaned';await json(path.join(dir,'transaction.json'),tx);
 }
 async findCore(root,tx){if(tx.incomingBackupId)return tx.incomingBackupId;const base=this[tx.format].baseDir;for(const item of await fsp.readdir(path.join(base,'backups'),{withFileTypes:true})){if(!item.isDirectory()||!validId(item.name))continue;const m=JSON.parse(await fsp.readFile(path.join(base,'backups',item.name,'manifest.json'),'utf8'));if(m.skinSwitchId===tx.id&&same(m.gamePath,root))return m.id;}return null;}
 async rollback(root,tx,dir){if(tx.state==='restoring'||tx.restoreAttempt){return this.undoInterruptedRestore(root,tx,dir);}const incoming=await this.findCore(root,tx);if(incoming){const file=path.join(this[tx.format].baseDir,'backups',incoming,'manifest.json'),m=JSON.parse(await fsp.readFile(file,'utf8'));if(['installed','pending','preparing'].includes(m.state)){this.vtf.externalGameLock=true;try{await this.core[tx.format].restore(root,incoming);}finally{this.vtf.externalGameLock=false;}}}
  const restores=[];for(let i=0;i<tx.ranges.length;i++){const r=tx.ranges[i],before=await fsp.readFile(path.join(dir,i+'.before.bin')),clean=await fsp.readFile(path.join(dir,i+'.clean.bin')),now=await readRange(path.join(root,'r2/paks/Win64',r.target),r.offset,r.length);if(hash(before)!==r.beforeHash||hash(clean)!==r.cleanHash||![r.beforeHash,r.cleanHash].includes(hash(now)))throw Error("跨格式恢复校验失败，已保留恢复备份："+tx.id);restores.push({r,before});}let index;if(tx.indexBeforeHash){index=await fsp.readFile(path.join(dir,'before-index.vpk'));const current=hash(await readIndexFile(path.join(root,'vpk',INDEX_NAME)));if(hash(index)!==tx.indexBeforeHash||![tx.indexBeforeHash,tx.indexCleanHash].includes(current))throw Error("跨格式恢复的 common 索引发生冲突，已保留恢复备份："+tx.id);}
  if(await this.dds.isGameRunning())throw Error("请先退出游戏，再恢复跨格式皮肤备份");for(const {r,before}of restores)await writeRange(path.join(root,'r2/paks/Win64',r.target),r.offset,before);if(index)await atomicIndex(path.join(root,'vpk',INDEX_NAME),index);for(const {r,before}of restores)if(hash(await readRange(path.join(root,'r2/paks/Win64',r.target),r.offset,r.length))!==r.beforeHash)throw Error("跨格式恢复后的 DDS 校验失败");tx.state='rolled-back';tx.recoveredAt=new Date().toISOString();await json(path.join(dir,'transaction.json'),tx);
 }
 async install(format,gamePath,packageId){return this.locked(gamePath,async root=>{await this.assertReady(root);const engine=this[format],pkg=engine.packages.get(packageId);if(!pkg)throw Error("请重新导入并校验皮肤包");
  if(format==='dds'&&typeof this.dds.assertLayout==='function')await this.dds.assertLayout(root,pkg.files);
  if(format==='vtf'){const resource=await this.vtf.gameStatus(root,pkg);if(!resource.ready&&resource.canRepair)await this.vtf.resources.repair(root);else if(!resource.ready)throw Error(resource.error);}
  const weapons=packageWeapons(format,pkg);if(!weapons.length){const other=format==='dds'?await this.vtf.manifests(root):await readJournals(this.dds.baseDir,root);if(other.some(e=>(e.manifest||e).state==='installed'))throw Error("无法确认这份皮肤的武器归属，请先恢复已有皮肤或使用受支持的原版资源，再执行跨格式替换");}const newest=(await this.transactions(root)).reduce((value,entry)=>Math.max(value,Date.parse(entry.value.createdAt)),0);const id=crypto.randomUUID(),dir=path.join(this.baseDir,id),staging=path.join(this.baseDir,'.preparing-'+id);await fsp.mkdir(staging);const tx={version:1,id,format,name:pkg.name,gamePath:root,weapons,createdAt:new Date(Math.max(Date.now(),newest+1)).toISOString(),state:'preparing',ranges:[],incomingBackupId:null};await json(path.join(staging,'transaction.json'),tx);await fsp.rename(staging,dir);
  try{const vpk=await this.vpkPlan(root,weapons);if(vpk){await fsp.writeFile(path.join(dir,'before-index.vpk'),vpk.before);await fsp.writeFile(path.join(dir,'clean-index.vpk'),vpk.after);tx.indexBeforeHash=hash(vpk.before);tx.indexCleanHash=hash(vpk.after);tx.vpkPaths=vpk.paths;}const rows=format==='vtf'?await this.ddsPlan(root,weapons,dir):[];for(const row of rows)await this.saveRange(tx,dir,row);tx.state='prepared';await json(path.join(dir,'transaction.json'),tx);
   engine.progress('format-switch',0,'正在清理同一武器的旧皮肤入口，其他武器保持不变');await this.commitClean(root,tx,dir);
   const beforeWrite=async({manifest,dir:coreDir})=>{tx.incomingBackupId=manifest.id;if(format==='dds')for(let i=0;i<manifest.records.length;i++){const r=manifest.records[i];await this.saveRange(tx,dir,{...r,before:await fsp.readFile(path.join(coreDir,i+'.before.bin')),after:await fsp.readFile(path.join(coreDir,i+'.before.bin'))});}tx.state='core-pending';await json(path.join(dir,'transaction.json'),tx);};
   this.vtf.externalGameLock=true;let result;try{result=await this.core[format].install(root,packageId,{skinSwitchId:id,beforeWrite});}finally{this.vtf.externalGameLock=false;}
   tx.incomingBackupId=result.backupId;await this.currentRanges(root,tx,dir,'final');if(tx.indexBeforeHash){const final=await readIndexFile(path.join(root,'vpk',INDEX_NAME));tx.indexFinalHash=hash(final);await fsp.writeFile(path.join(dir,'final-index.vpk'),final);}tx.state='installed';await json(path.join(dir,'transaction.json'),tx);return {...result,skinSwitchId:id,crossFormatReset:{weapons,vtfPaths:tx.vpkPaths?.length||0,ddsRanges:rows.length},recoveryId:id};
  }catch(error){tx.error=error.message;try{if(['preparing','prepared'].includes(tx.state)){tx.state='cancelled';await json(path.join(dir,'transaction.json'),tx);}else await this.rollback(root,tx,dir);}catch(recoveryError){tx.state='recovery-required';tx.recoveryError=recoveryError.message;await json(path.join(dir,'transaction.json'),tx);throw Error("换肤未完成，请恢复跨格式皮肤备份；恢复编号："+id+"。"+recoveryError.message);}throw error;}
 });}
 async recover(gamePath,transactionId){return this.locked(gamePath,async root=>{if(!validId(transactionId))throw Error("跨格式恢复编号无效");const transactions=await this.transactions(root),entry=transactions.find(e=>e.value.id===transactionId);if(!entry)throw Error("跨格式恢复备份不存在");if(['restored','rolled-back','cancelled'].includes(entry.value.state))throw Error("这份跨格式备份已恢复");if(entry.value.state==='installed'){await this.assertReady(root);return this.restoreInstalled(root,entry,transactions);}await this.rollback(root,entry.value,entry.dir);return {backupId:transactionId,skinSwitchId:transactionId,recovered:true};});}
 async restore(format,gamePath,backupId){return this.locked(gamePath,async root=>{if(!validId(backupId))throw Error("皮肤备份编号无效");const transactions=await this.transactions(root);const linked=transactions.find(e=>(e.value.incomingBackupId===backupId&&e.value.format===format)||e.value.id===backupId);if(linked){if(['restored','rolled-back','cancelled'].includes(linked.value.state))throw Error("这份跨格式备份已恢复");if(linked.value.state!=='installed'){await this.rollback(root,linked.value,linked.dir);return {backupId,skinSwitchId:linked.value.id,recovered:true};}await this.assertReady(root);return await this.restoreInstalled(root,linked,transactions);}await this.assertReady(root);
  const file=path.join(this[format].baseDir,'backups',backupId,'manifest.json'),m=JSON.parse(await fsp.readFile(file,'utf8')),weapons=packageWeapons(format,{files:format==='dds'?m.records:m.files});if(transactions.some(e=>e.value.state==='installed'&&e.value.weapons.some(w=>weapons.includes(w))))throw Error("这份旧皮肤已被跨格式换肤替代，请先恢复较新的跨格式备份，避免重新引入旧模型或皮肤");this.vtf.externalGameLock=true;try{return await this.core[format].restore(root,backupId);}finally{this.vtf.externalGameLock=false;}
 });}
 async restoreInstalled(root,entry,transactions){const tx=entry.value,dir=entry.dir;if(transactions.some(e=>e.value.createdAt>tx.createdAt&&e.value.state==='installed'&&e.value.weapons.some(w=>tx.weapons.includes(w))))throw Error("同一武器已有较新的皮肤，请先恢复较新的跨格式备份");const rangePlan=[];for(let i=0;i<tx.ranges.length;i++){const r=tx.ranges[i],before=await fsp.readFile(path.join(dir,i+'.before.bin')),final=await fsp.readFile(path.join(dir,i+'.final.bin')),current=await readRange(path.join(root,'r2/paks/Win64',r.target),r.offset,r.length);if(hash(before)!==r.beforeHash||hash(final)!==r.finalHash||hash(current)!==r.finalHash)throw Error("跨格式恢复的 DDS 资源已变化，已停止恢复");rangePlan.push({r,before,current});}let currentIndex,restoredIndex;if(tx.indexBeforeHash){const before=await fsp.readFile(path.join(dir,'before-index.vpk')),final=await fsp.readFile(path.join(dir,'final-index.vpk'));if(hash(before)!==tx.indexBeforeHash||hash(final)!==tx.indexFinalHash)throw Error("跨格式索引备份校验失败");currentIndex=await readIndexFile(path.join(root,'vpk',INDEX_NAME));const prior=entryMap(before),expected=entryMap(final),current=entryMap(currentIndex),keys=new Set([...prior.keys(),...expected.keys()]);for(const key of keys){if(entryHash(prior.get(key))===entryHash(expected.get(key)))continue;if(entryHash(current.get(key))!==entryHash(expected.get(key)))throw Error("跨格式恢复的同一武器 VTF 入口已变化，已停止恢复");if(prior.has(key))current.set(key,prior.get(key));else current.delete(key);}restoredIndex=serializeIndex([...current.values()]);}
  if(await this.dds.isGameRunning())throw Error("请先退出游戏，再恢复跨格式皮肤备份");tx.restoreAttempt={indexCurrentHash:currentIndex?hash(currentIndex):null,indexRestoredHash:restoredIndex?hash(restoredIndex):null};if(currentIndex){await fsp.writeFile(path.join(dir,'restore-current-index.vpk'),currentIndex);await fsp.writeFile(path.join(dir,'restore-target-index.vpk'),restoredIndex);}tx.state='restoring';await json(path.join(dir,'transaction.json'),tx);try{for(const {r,before}of rangePlan)await writeRange(path.join(root,'r2/paks/Win64',r.target),r.offset,before);if(restoredIndex)await atomicIndex(path.join(root,'vpk',INDEX_NAME),restoredIndex);const file=path.join(this[tx.format].baseDir,'backups',tx.incomingBackupId,'manifest.json'),m=JSON.parse(await fsp.readFile(file,'utf8'));m.state='restored';m.restoredAt=new Date().toISOString();await json(file,m);tx.state='restored';tx.restoredAt=m.restoredAt;delete tx.restoreAttempt;await json(path.join(dir,'transaction.json'),tx);return {backupId:tx.incomingBackupId,skinSwitchId:tx.id,count:rangePlan.length,restored:true};}catch(error){await this.undoInterruptedRestore(root,tx,dir);tx.error=error.message;await json(path.join(dir,'transaction.json'),tx);throw error;}
 }
 async undoInterruptedRestore(root,tx,dir){const rows=[];for(let i=0;i<tx.ranges.length;i++){const r=tx.ranges[i],final=await fsp.readFile(path.join(dir,i+'.final.bin')),current=await readRange(path.join(root,'r2/paks/Win64',r.target),r.offset,r.length);if(hash(final)!==r.finalHash||![r.beforeHash,r.finalHash].includes(hash(current)))throw Error("中断的跨格式恢复存在 DDS 冲突，请保留恢复备份："+tx.id);rows.push({r,final});}let index;if(tx.restoreAttempt?.indexCurrentHash){index=await fsp.readFile(path.join(dir,'restore-current-index.vpk'));const current=hash(await readIndexFile(path.join(root,'vpk',INDEX_NAME)));if(hash(index)!==tx.restoreAttempt.indexCurrentHash||![tx.restoreAttempt.indexCurrentHash,tx.restoreAttempt.indexRestoredHash].includes(current))throw Error("中断的跨格式恢复存在 VTF 索引冲突，请保留恢复备份："+tx.id);}if(await this.dds.isGameRunning())throw Error("请先退出游戏，再恢复跨格式皮肤备份");for(const {r,final}of rows)await writeRange(path.join(root,'r2/paks/Win64',r.target),r.offset,final);if(index)await atomicIndex(path.join(root,'vpk',INDEX_NAME),index);const corefile=path.join(this[tx.format].baseDir,'backups',tx.incomingBackupId,'manifest.json'),m=JSON.parse(await fsp.readFile(corefile,'utf8'));m.state='installed';delete m.restoredAt;await json(corefile,m);tx.state='installed';delete tx.restoreAttempt;await json(path.join(dir,'transaction.json'),tx);return {backupId:tx.incomingBackupId,skinSwitchId:tx.id,recovered:true};}
 async backupRows(gamePath){const root=await this.canonical(gamePath),transactions=await this.transactions(root);return transactions.filter(e=>!['cancelled','rolled-back','restored'].includes(e.value.state)).map(({value})=>({id:value.id,name:value.name+' · 跨格式恢复',createdAt:value.createdAt,state:value.state==='installed'?'cross-installed':'pending',transactionState:value.state,count:value.ranges.length,bytes:0,skinSwitchId:value.id,incomingBackupId:value.incomingBackupId,crossFormat:true,...deletionPolicy(value),canRestore:value.state!=='installed'||!transactions.some(e=>e.value.id!==value.id&&(!['installed','restored','rolled-back','cancelled'].includes(e.value.state)||(e.value.state==='installed'&&e.value.createdAt>value.createdAt&&e.value.weapons.some(w=>value.weapons.includes(w)))))}));}
 async deletionRows(gamePath,rows){
  const root=await this.canonical(gamePath),transactions=await this.transactions(root);
  return rows.map(row=>{
   const linked=transactions.find(entry=>entry.value.incomingBackupId===row.id||entry.value.id===row.skinSwitchId);
   return linked&&!terminalStates.has(linked.value.state)?{...row,...deletionPolicy({state:row.state},{referenced:true})}:row;
  });
 }
 async deleteBackup(format,gamePath,backupId){
  if(!['dds','vtf'].includes(format))throw Error("皮肤格式无效");
  if(!validId(backupId))throw Error("皮肤备份编号无效");
  return this.locked(gamePath,async root=>{
   const transactions=await this.transactions(root);let entry=transactions.find(item=>item.value.id===backupId||(item.value.format===format&&item.value.incomingBackupId===backupId));
   if(!entry){const record=await readBackupManifest(this[format].baseDir,backupId,root);entry=transactions.find(item=>item.value.format===format&&item.value.id===record.manifest.skinSwitchId);}
   let transactionRecord;
   if(entry){
    const policy=deletionPolicy(entry.value);if(!policy.canDelete)throw Error(policy.deleteReason);
    transactionRecord=await readRecord(this.baseDir,entry.value.id,root,"transaction.json");
    await inspectRemoval(this.baseDir,entry.value.id,transactionRecord);
   }
   const coreId=entry?.value.incomingBackupId||(entry&&entry.value.id===backupId?await this.findCore(root,entry.value):backupId);
   let result={backupId,deleted:true,bytes:0,files:0};
   if(coreId){
    if(transactions.some(item=>item.value.id!==entry?.value.id&&item.value.incomingBackupId===coreId&&!terminalStates.has(item.value.state)))throw Error("这份备份仍用于跨格式皮肤恢复，请先恢复对应皮肤");
    this.vtf.externalGameLock=true;
    try{result=await this.core[entry?.value.format||format].deleteBackup(root,coreId);}finally{this.vtf.externalGameLock=false;}
   }
   if(transactionRecord){
    try{const removed=await removeRecord(this.baseDir,entry.value.id,transactionRecord);result={...result,skinSwitchId:entry.value.id,bytes:result.bytes+removed.bytes,files:result.files+removed.files};}
    catch(error){result={...result,cleanupWarning:"皮肤备份已删除，历史跨格式数据将在下次清理时重试："+error.message};}
   }
   return result;
  });
 }
}
let active=null;
function installEngines({dds,vtf,baseDir,...options}){
 if(active)return active;
 active=new SkinSwitchCoordinator({dds,vtf,baseDir,...options});
 for(const format of ['dds','vtf']){
  const engine=active[format];
  engine.skinRepairRequirements=(root,pkg,source)=>active.skinRepairRequirements(root,pkg,format,source);
  engine.prepareSkinRepairSource=(root,pkg,source)=>active.prepareSkinRepairSource(root,pkg,format,source);
  engine.install=(root,id)=>active.install(format,root,id);
  engine.restore=(root,id)=>active.restore(format,root,id);
  engine.deleteBackup=(root,id)=>active.deleteBackup(format,root,id);
  const backups=engine.backups.bind(engine),status=engine.status.bind(engine);
  engine.backups=async root=>{
   const rows=await backups(root);if(!root)return rows;
   try{
    const cross=await active.backupRows(root),linked=new Set(cross.map(r=>r.incomingBackupId).filter(Boolean));
    return [...cross,...await active.deletionRows(root,rows.filter(r=>!linked.has(r.id)))];
   }catch(error){
    return [...rows.map(row=>({...row,canDelete:false,deleteReason:"跨格式恢复记录无法读取，请保留备份并修复记录"})),{id:'cross-format-error',name:error.message,state:'error',count:0,bytes:0,canRestore:false,canDelete:false,deleteReason:"跨格式恢复记录无法读取，请保留备份并修复记录"}];
   }
  };
  engine.status=async(root,id)=>{
   const result=await status(root,id);
   if(!root||result.game?.ready===false)return {...result,busy:engine.busy||active.busy};
   try{
    const pending=await active.pending(root);
    const pkg=engine.packages.get(id);let skinRepair;if(pkg)try{skinRepair=await active.skinRepairRequirements(root,pkg,format);}catch(error){skinRepair={ready:false,state:'error',ddsRows:[],ddsTargets:[],canSteamRepair:false,reason:error.message};}
    return {...result,busy:engine.busy||active.busy,pending:[...new Set([...(result.pending||[]),...pending.map(r=>r.id)])],formatSwitch:{ready:!pending.length,pending},...(skinRepair?{skinRepair}:{})};
   }catch(error){return {...result,busy:engine.busy||active.busy,game:{...result.game,ready:false,error:error.message},formatSwitch:{ready:false,pending:[],error:error.message}};}
  };
 }
 return active;
}
module.exports={SkinSwitchCoordinator,installEngines,getActive:()=>active};
