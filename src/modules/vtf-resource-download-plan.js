"use strict";
// Derive common archives from the index that recovery will actually publish.
// A missing index is fetched first; it never justifies downloading every VPK.
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto");
const {parseIndex,parseTruncatedIndex,readIndexFile,MAX_INDEX_BYTES}=require("./vtf-vpk");
const {verifyComplete}=require("./dds-resource-recovery");
const {assertUnlinkedAncestors}=require("./backup-records");
const INDEX="englishclient_mp_common.bsp.pak000_dir.vpk",INDEX_PATH="vpk/"+INDEX;
const archivePath=index=>`vpk/client_mp_common.bsp.pak000_${String(index).padStart(3,"0")}.vpk`;
const officialArchive=name=>/^vpk\/client_mp_common\.bsp\.pak000_\d{3}\.vpk$/.test(name);
const unsafe="皮肤资源路径包含链接或非普通文件，已停止资源读写。";
const customMissing="缺失的是自定义皮肤文件，请重新导入对应皮肤包；原版资源无法替代它。";
const signature=entries=>crypto.createHash("sha256").update(JSON.stringify(entries.map(e=>({path:e.path,index:e.index,chunks:e.chunks})))).digest("hex");
function mergeEntries(stock,retained){
 const replacements=new Map(retained.map(e=>[e.path.toLowerCase(),e]));
 const result=stock.map(e=>{const key=e.path.toLowerCase(),replacement=replacements.get(key);replacements.delete(key);return replacement||e;});
 return [...result,...replacements.values()];
}
async function retainedEntries(root,issue){
 if(issue?.code!=="truncated")return [];
 const file=path.join(root,"vpk",INDEX);await assertUnlinkedAncestors(file,unsafe);
 const stat=await fsp.lstat(file);if(!stat.isFile()||stat.size>MAX_INDEX_BYTES)throw Error(unsafe);
 const bytes=await fsp.readFile(file),after=await fsp.lstat(file);
 if(stat.dev!==after.dev||stat.ino!==after.ino||stat.size!==after.size||stat.mtimeMs!==after.mtimeMs||stat.ctimeMs!==after.ctimeMs)throw Error("common 索引被其他程序修改，安装已取消");
 return bytes.length<16?[]:parseTruncatedIndex(bytes).entries;
}
async function fileExtent(root,name){
 const file=path.join(root,...name.split("/"));
 try{await assertUnlinkedAncestors(file,unsafe);const stat=await fsp.lstat(file);if(!stat.isFile())throw Error(unsafe);return stat.size;}
 catch(error){if(error.code==="ENOENT")return 0;throw error;}
}
async function availableSource(root,name,info,resources){
 if(!resources?.sources)return false;
 for(const source of await resources.sources(root,path.posix.basename(name)))try{await verifyComplete(source,info);return true;}catch(error){if(error.message===unsafe)throw error;}
 return false;
}
async function missingArchives({root,entries,manifest,resources}){
 const extents=new Map();
 for(const entry of entries)for(const chunk of entry.chunks){const name=archivePath(entry.index);extents.set(name,Math.max(extents.get(name)||0,chunk.offset+chunk.compressedSize));}
 const files=[];
 for(const [name,extent]of extents){
  const info=manifest.files.get(name),required=Math.max(extent,info?.size||0);
  if(info&&extent>info.size)throw Error("common 索引中的资源范围超出当前官方文件，未修改游戏。");
  if(await fileExtent(root,name)>=required)continue;
  if(!info||!officialArchive(name))throw Error(customMissing);
  if(!await availableSource(root,name,info,resources))files.push(name);
 }
 return files;
}
async function planVtfResources({root,engine,game,manifest,original,stockDiscovery=false,resolveStockTargets}){
 const issue=(game.issues||[]).find(e=>e.target.toLowerCase()===INDEX_PATH&&["missing","truncated"].includes(e.code));
 const files=new Set();
 for(const value of game.issues||[]){
  if(!["missing","truncated"].includes(value.code)||value.target.toLowerCase()===INDEX_PATH)continue;
  const name=value.target.replace(/\\/g,"/").toLowerCase();
  if(!officialArchive(name)||!manifest.files.has(name))throw Error(customMissing);
  if(value.repairable!==true||!await availableSource(root,name,manifest.files.get(name),engine.resources))files.add(name);
 }
 const stockReady=original?.status?.state==="ready"&&Array.isArray(original.entries);
 if(original?.status?.state!=="ready")files.add(INDEX_PATH);
 const discoverStock=stockDiscovery&&original?.status?.state!=="ready";
 if(!issue&&!discoverStock)return {files:[...files],staged:false,indexSignature:null,additionalFiles:[]};
 const retained=await retainedEntries(root,issue);
 const history=engine.resources?.historyIndex?await engine.resources.historyIndex(root):null;
 const base=history?parseIndex(history.bytes).entries:stockReady?original.entries:null;
 if(base&&!discoverStock){
  const entries=mergeEntries(base,retained);
  for(const name of await missingArchives({root,entries,manifest,resources:engine.resources}))files.add(name);
  return {files:[...files],staged:false,indexSignature:signature(entries),additionalFiles:[]};
 }
 // Complete custom records in a truncated index remain authoritative.
 await missingArchives({root,entries:retained,manifest,resources:engine.resources});
 files.add(INDEX_PATH);
 const additionalFiles=[];
 for(const [name,info]of manifest.files){
  if(!officialArchive(name)||await fileExtent(root,name)>=info.size)continue;
  if(!await availableSource(root,name,info,engine.resources))additionalFiles.push(name);
 }
 return {files:[...files],staged:true,indexSignature:signature(retained),additionalFiles,async resolveAdditionalFiles(sourceDir){
  const file=path.join(sourceDir,...INDEX_PATH.split("/"));
  await verifyComplete(file,manifest.files.get(INDEX_PATH));
  const stock=parseIndex(await readIndexFile(file)).entries;
  const needed=issue?await missingArchives({root,entries:mergeEntries(base||stock,retained),manifest,resources:engine.resources}):[];
  if(resolveStockTargets){const targets=await resolveStockTargets(sourceDir);for(const name of targets){if(!officialArchive(name)||!manifest.files.has(name))throw Error(customMissing);needed.push(name);}}
  return [...new Set(needed)];
 }};
}
module.exports={planVtfResources,missingArchives,mergeEntries,INDEX_PATH};
