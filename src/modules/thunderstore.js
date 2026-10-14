'use strict';
// Thunderstore supplies catalog data; TFX owns validation and install plans.
const fs=require('fs'),path=require('path'),{requestBuffer}=require('./http-resource');
const {compareVersions}=require('./launcher-update');
const CATALOG_URL='https://thunderstore.io/c/northstar/api/v1/package/';
const MAX_PACKAGES=12000,MAX_PLAN=128,TTL=5*60*1000;
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_]+$/.test(value)&&value.length<=128;
const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value)&&compareVersions(value,value)===0;
const text=(value,max=4000)=>typeof value==='string'?value.slice(0,max):'';
const keyOf=item=>item.author+'-'+item.package_name;
function error(code,message){return Object.assign(Error(message),{code});}
function identity(author,name,number){if(!token(author)||!token(name)||!version(number))throw error('IDENTITY','Invalid Thunderstore package identity');return {id:author+'-'+name+'-'+number,author,package_name:name,version:number};}
function parseDependency(value){if(typeof value!=='string')throw error('DEPENDENCY','Invalid dependency identifier');const parts=value.split('-');if(parts.length!==3)throw error('DEPENDENCY','Invalid dependency identifier');return identity(...parts);}
function downloadURL(item){return 'https://thunderstore.io/package/download/'+[item.author,item.package_name,item.version].map(encodeURIComponent).join('/')+'/';}
function officialImage(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['ccdn.thunderstore.io','gcdn.thunderstore.io','thunderstore.io'].includes(u.hostname)?u.href:'';}catch{return '';}}
function normalizeCatalog(input){
  if(!Array.isArray(input)||input.length>MAX_PACKAGES)throw error('CATALOG','Thunderstore catalog is not a compatible package list');
  const output=[],seen=new Set();
  for(const record of input){
    if(!record||!token(record.owner)||!token(record.name)||!Array.isArray(record.versions)||record.versions.length>2000)continue;
    const key=record.owner+'-'+record.name;if(seen.has(key))throw error('CATALOG','Thunderstore catalog contains a duplicate package');seen.add(key);
    const versions=[];
    for(const v of record.versions){
      if(!v||!version(v.version_number)||!Array.isArray(v.dependencies)||v.dependencies.length>MAX_PLAN||!Number.isSafeInteger(v.file_size)||v.file_size<1||v.file_size>2*1024*1024*1024)continue;
      if(v.is_active===false)continue;
      const item=identity(record.owner,record.name,v.version_number);
      versions.push({name:record.name,full_name:item.id,description:text(v.description),icon:officialImage(v.icon),version_number:item.version,dependencies:v.dependencies.map(x=>parseDependency(x).id),download_url:downloadURL(item),downloads:Number.isFinite(v.downloads)?Math.max(0,v.downloads):0,date_created:text(v.date_created,64),website_url:text(v.website_url,2048),is_active:true,uuid4:text(v.uuid4,64),file_size:v.file_size});
    }
    versions.sort((a,b)=>compareVersions(b.version_number,a.version_number));
    if(!versions.length)continue;
    output.push({name:record.name,full_name:record.owner+'-'+record.name,owner:record.owner,package_url:'https://thunderstore.io/c/northstar/p/'+record.owner+'/'+record.name+'/',date_created:text(record.date_created,64),date_updated:text(record.date_updated,64),uuid4:text(record.uuid4,64),rating_score:Number.isFinite(record.rating_score)?record.rating_score:0,is_pinned:record.is_pinned===true,is_deprecated:record.is_deprecated===true,has_nsfw_content:record.has_nsfw_content===true,categories:Array.isArray(record.categories)?record.categories.filter(x=>typeof x==='string').slice(0,32):[],versions});
  }
  if(input.length&&!output.length)throw error('CATALOG','Thunderstore catalog contains no valid packages');
  return output;
}
function resolvePlan(selection,catalog,installed=[]){
  const root=identity(selection.author,selection.package_name||selection.name,selection.version),rootKey=keyOf(root),index=new Map(catalog.map(p=>[p.owner+'-'+p.name,p]));
  const requirements=new Map([[rootKey,root]]),queue=[root],skipped=new Map(),selected=new Map();
  function satisfied(item){return installed.some(p=>keyOf(p)===keyOf(item)&&compareVersions(p.version,item.version)!==null&&compareVersions(p.version,item.version)>=0);}
  function lookup(item){const record=index.get(keyOf(item)),v=record?.versions.find(v=>v.version_number===item.version);if(!v)throw error('DEPENDENCY_MISSING','Thunderstore package version is unavailable: '+item.id);return {...identity(record.owner,record.name,v.version_number),downloadUrl:downloadURL(identity(record.owner,record.name,v.version_number)),fileSize:v.file_size,dependencies:[...v.dependencies]};}
  for(let steps=0;queue.length;steps++){
    if(steps>MAX_PLAN*8)throw error('DEPENDENCY_LIMIT','Too many dependency transitions');
    const wanted=queue.shift(),key=keyOf(wanted);if(key.toLowerCase()==='northstar-northstar'&&key===rootKey)throw error('CLIENT_PACKAGE','Northstar clients are installed from the game page');
    if(requirements.get(key).version!==wanted.version)continue;
    const item=lookup(wanted);selected.set(key,item);
    for(const raw of item.dependencies){const dep=parseDependency(raw),depKey=keyOf(dep);
      if(depKey.toLowerCase()==='northstar-northstar'){skipped.set(dep.id,{id:dep.id,reason:'managed-client'});continue;}
      if(depKey!==rootKey&&satisfied(dep)){skipped.set(dep.id,{id:dep.id,reason:'installed-compatible-version'});continue;}
      const previous=requirements.get(depKey);
      if(depKey===rootKey&&compareVersions(dep.version,root.version)>0)throw error('DEPENDENCY_CONFLICT','A dependency requires a newer root package');
      if(!previous||compareVersions(dep.version,previous.version)>0){if(requirements.size>=MAX_PLAN)throw error('DEPENDENCY_LIMIT','Too many packages in the install plan');requirements.set(depKey,dep);queue.push(dep);}
    }
  }
  const visiting=new Set(),done=new Set(),packages=[];
  function order(key){if(visiting.has(key))throw error('DEPENDENCY_CYCLE','Thunderstore dependency cycle: '+key);if(done.has(key))return;const item=selected.get(key);if(!item)throw error('DEPENDENCY_MISSING','Dependency plan is incomplete');visiting.add(key);for(const raw of item.dependencies){const dep=parseDependency(raw),depKey=keyOf(dep);if(depKey.toLowerCase()==='northstar-northstar'||(depKey!==rootKey&&satisfied(dep)))continue;order(depKey);}visiting.delete(key);done.add(key);packages.push(item);}
  order(rootKey);return {root:selected.get(rootKey),packages,skipped:[...skipped.values()],dependencies:packages.filter(p=>keyOf(p)!==rootKey).map(p=>p.id)};
}
function createClient({fetchResource=requestBuffer,now=Date.now,cacheFile,ttl=TTL}={}){
  let cached=null,pending=null;
  const allowURL=u=>u.hostname==='thunderstore.io'&&u.pathname==='/c/northstar/api/v1/package/'&&!u.search&&!u.hash;
  function loadDisk(){if(cached||!cacheFile)return;try{const stat=fs.lstatSync(cacheFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)return;const r=JSON.parse(fs.readFileSync(cacheFile,'utf8'));if(r.schema!==1||!Number.isFinite(r.time))return;cached={time:r.time,data:normalizeCatalog(r.data)};}catch{}}
  async function getCatalog({force=false}={}){
    loadDisk();if(pending)return pending;if(!force&&cached&&now()-cached.time>=0&&now()-cached.time<ttl)return cached.data;
    pending=(async()=>{const r=await fetchResource(CATALOG_URL,{allowURL,maxBytes:12*1024*1024,timeoutMs:20000});let raw;try{raw=JSON.parse(r.bytes.toString('utf8'));}catch{throw error('CATALOG','Thunderstore returned invalid JSON');}const data=normalizeCatalog(raw);cached={time:now(),data};if(cacheFile){try{fs.mkdirSync(path.dirname(cacheFile),{recursive:true});const temp=cacheFile+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify({schema:1,...cached}));fs.renameSync(temp,cacheFile);}catch{/* A cache failure does not invalidate a live catalog. */}}return data;})().finally(()=>{pending=null;});return pending;
  }
  async function planInstall(selection,{catalog,installed=[]}={}){return resolvePlan(selection,catalog||await getCatalog(),installed);}
  function clearCache(){cached=null;if(cacheFile)try{const stat=fs.lstatSync(cacheFile);if(stat.isFile()&&!stat.isSymbolicLink())fs.unlinkSync(cacheFile);}catch{}}
  return {getCatalog,planInstall,clearCache};
}
const defaultClient=createClient({cacheFile:fs.existsSync('D:/')?'D:/TFX-Launcher-Data/public-cache/thunderstore-northstar.json':undefined});
module.exports={CATALOG_URL,createClient,normalizeCatalog,resolvePlan,identity,parseDependency,downloadURL,getCatalog:defaultClient.getCatalog,planInstall:defaultClient.planInstall,clearCache:defaultClient.clearCache};
