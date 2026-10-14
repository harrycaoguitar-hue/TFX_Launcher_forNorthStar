"use strict";
// The CN and global clients use different on-disk mod-state formats. Keep
// compatibility at the boundary, without changing personal enable choices.
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const repair=require("jsonrepair");
const CORE_NAMES=Object.freeze(["Northstar.Client","Northstar.Custom","Northstar.CustomServers"]),MAX_BYTES=4*1024*1024,MAX_ENTRIES=12000;
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex"),own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const dictionary=()=>Object.create(null),plain=value=>value&&typeof value==="object"&&!Array.isArray(value);
function assign(object,key,value){Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true});}
function parse(input) {
  const bytes=input===null||input===undefined?Buffer.from("{}"):Buffer.isBuffer(input)?input:Buffer.from(typeof input==="string"?input:JSON.stringify(input));
  if(bytes.length>MAX_BYTES)throw Error("模组开关配置体积超出上限，已保留原文件。");
  const text=bytes.toString("utf8");if(!Buffer.from(text).equals(bytes))throw Error("模组开关配置不是有效 UTF-8，已保留原文件。");
  let raw;try{raw=JSON.parse(text.replace(/^\uFEFF/,""));}catch(_){throw Error("模组开关配置无法解析，已保留原文件。");}
  if(!plain(raw)||Object.keys(raw).length>MAX_ENTRIES)throw Error("模组开关配置格式无效，已保留原文件。");
  const format=own(raw,"Version")?"versioned":"flat",states=dictionary();
  if(format==="versioned"&&raw.Version!==1)throw Error("模组开关配置版本不兼容，已保留原文件。");
  for(const [name,value] of Object.entries(raw)) {
    if(format==="versioned"&&name==="Version")continue;
    if(!name||/[\x00-\x1f]/.test(name))throw Error("模组开关配置名称无效，已保留原文件。");
    if(format==="flat") {if(typeof value!=="boolean")throw Error("模组开关配置需要布尔值，已保留原文件。");assign(states,name,value);}
    else {if(!plain(value)||Object.keys(value).length>MAX_ENTRIES||Object.entries(value).some(([version,on])=>!version||/[\x00-\x1f]/.test(version)||typeof on!=="boolean"))throw Error("模组版本开关配置格式无效，已保留原文件。");const versions=dictionary();for(const [version,on] of Object.entries(value))assign(versions,version,on);assign(states,name,versions);}
  }
  return {format,states};
}
function raw(document){if(document.format==="flat")return document.states;const result={Version:1};for(const [name,versions] of Object.entries(document.states))assign(result,name,versions);return result;}
function serialize(document){const bytes=Buffer.from(JSON.stringify(raw(document),null,2)+"\n");if(bytes.length>MAX_BYTES)throw Error("模组开关配置体积超出上限，已保留原文件。");return bytes;}
function enabled(document,name,version) {
  if(!own(document.states,name))return true;
  if(document.format==="flat")return document.states[name]===true;
  return own(document.states[name],String(version))?document.states[name][String(version)]===true:true;
}
function set(document,name,version,on){if(typeof on!=="boolean")throw Error("请指定有效的模组开关状态。");if(document.format==="flat")assign(document.states,name,on);else{if(!version||version==="unknown")throw Error("无法确认模组版本，未修改开关配置。");if(!own(document.states,name))assign(document.states,name,dictionary());assign(document.states[name],String(version),on);}return document;}
function checked(filename,missing=true) {
  let current=path.parse(path.resolve(filename)).root;const parts=path.resolve(filename).slice(current.length).split(path.sep).filter(Boolean);
  for(const [index,part] of parts.entries()){current=path.join(current,part);let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==="ENOENT"&&missing)return null;throw error;}if(stat.isSymbolicLink()||(index<parts.length-1&&!stat.isDirectory()))throw Error("模组开关配置路径包含链接或同名文件，已停止写入。");if(index===parts.length-1){if(!stat.isFile()||stat.size>MAX_BYTES)throw Error("模组开关配置不是有效普通文件。");return fs.readFileSync(current);}}
}
const equal=(a,b)=>a===null?b===null:b!==null&&a.equals(b);
function write(filename,original,intended,{guard}={}) {
  const parent=path.dirname(filename);checked(path.join(parent,".tfx-state-path-check"));
  if(!equal(original,checked(filename)))throw Error("模组开关配置已由其他程序修改，请重新操作。");
  const temporary=filename+".tfx-"+crypto.randomUUID()+".tmp";let committed=false;
  try {
    guard?.();const fd=fs.openSync(temporary,"wx");try{fs.writeFileSync(fd,intended);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(!fs.readFileSync(temporary).equals(intended))throw Error("模组开关临时文件校验失败。");
    guard?.();if(!equal(original,checked(filename)))throw Error("模组开关配置已由其他程序修改，请重新操作。");
    fs.renameSync(temporary,filename);committed=true;if(!checked(filename,false).equals(intended))throw Error("模组开关写入校验失败。");
  } catch(error) {
    if(committed&&equal(intended,checked(filename))){if(original===null)fs.unlinkSync(filename);else{fs.writeFileSync(temporary,original,{flag:"wx"});fs.renameSync(temporary,filename);}}
    throw error;
  } finally {try{fs.unlinkSync(temporary);}catch(error){if(error.code!=="ENOENT")throw error;}}
}
// Launch guards may query the process list asynchronously. Await both checks
// so neither a snapshot nor a live configuration is committed while a game
// starts or the selected profile changes.
async function writeGuarded(filename,original,intended,{guard}={}) {
  const parent=path.dirname(filename);checked(path.join(parent,".tfx-state-path-check"));
  if(!equal(original,checked(filename)))throw Error("模组开关配置已由其他程序修改，请重新操作。");
  const temporary=filename+".tfx-"+crypto.randomUUID()+".tmp";let committed=false;
  try {
    await guard?.();const fd=fs.openSync(temporary,"wx");try{fs.writeFileSync(fd,intended);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(!fs.readFileSync(temporary).equals(intended))throw Error("模组开关临时文件校验失败。");
    await guard?.();if(!equal(original,checked(filename)))throw Error("模组开关配置已由其他程序修改，请重新操作。");
    fs.renameSync(temporary,filename);committed=true;if(!checked(filename,false).equals(intended))throw Error("模组开关写入校验失败。");
  } catch(error) {
    if(committed&&equal(intended,checked(filename))){if(original===null)fs.unlinkSync(filename);else{fs.writeFileSync(temporary,original,{flag:"wx"});fs.renameSync(temporary,filename);}}
    throw error;
  } finally {try{fs.unlinkSync(temporary);}catch(error){if(error.code!=="ENOENT")throw error;}}
}
function isRequired(mod,profileDirectory){return CORE_NAMES.includes(mod.name)&&path.resolve(mod.folder_path||"").toLowerCase()===path.resolve(profileDirectory,"mods",mod.name).toLowerCase();}
function installed(profileDirectory) {
  const mods=[];
  const scan=directory=>{if(!fs.existsSync(directory))return;const dirStat=fs.lstatSync(directory);if(!dirStat.isDirectory()||dirStat.isSymbolicLink())throw Error("模组目录包含链接，已停止开关转换。");for(const item of fs.readdirSync(directory,{withFileTypes:true})){if(item.isSymbolicLink())throw Error("模组目录包含链接，已停止开关转换。");if(!item.isDirectory())continue;const folder=path.join(directory,item.name),bytes=checked(path.join(folder,"mod.json"));if(!bytes)continue;const text=bytes.toString("utf8");if(!Buffer.from(text).equals(bytes))continue;let info;try{info=JSON.parse(repair(text.replace(/^\uFEFF/,"")));}catch(_){continue;}if(plain(info)&&typeof info.Name==="string"&&info.Name&&typeof info.Version==="string"&&info.Version)mods.push({name:info.Name,version:info.Version,folder_path:folder,required:isRequired({name:info.Name,folder_path:folder},profileDirectory)});if(mods.length>MAX_ENTRIES)throw Error("模组数量超出开关转换上限。");}};
  scan(path.join(profileDirectory,"mods"));const packages=path.join(profileDirectory,"packages");if(fs.existsSync(packages)){const stat=fs.lstatSync(packages);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error("模组包目录包含链接，已停止开关转换。");for(const item of fs.readdirSync(packages,{withFileTypes:true})){if(item.isSymbolicLink())throw Error("模组包目录包含链接，已停止开关转换。");if(item.isDirectory())scan(path.join(packages,item.name,"mods"));}}
  return mods;
}
function project(document,name,version) {if(document.format==="flat")return enabled(document,name,version);if(!own(document.states,name))return true;const values=document.states[name];if(own(values,version))return values[version];const entries=Object.values(values);return entries.length===1?entries[0]:true;}
function mergeVersioned(target,document){if(document.format!=="versioned")return;for(const [name,versions] of Object.entries(document.states)){if(!own(target.states,name))assign(target.states,name,dictionary());for(const [version,on] of Object.entries(versions))assign(target.states[name],version,on);}}
function assertReady(profileDirectory,region,{coreEnabled=true}={}) {
  if(!["cn","global"].includes(region))throw Error("请选择国服或全球服客户端。");
  const bytes=checked(path.join(profileDirectory,"enabledmods.json")),document=parse(bytes),mods=installed(profileDirectory),required=mods.filter(mod=>mod.required);
  if(document.format!==(region==="cn"?"flat":"versioned"))throw Error("模组开关配置与所选客户端不兼容，请重新点击启动。");
  if(CORE_NAMES.some(name=>mods.filter(mod=>mod.name===name).length>1))throw Error("发现与北极星核心组件同名的重复模组，请先移除重复项。");
  if(coreEnabled&&(required.length!==CORE_NAMES.length||required.some(mod=>!own(document.states,mod.name)||(document.format==="versioned"&&!own(document.states[mod.name],mod.version))||!enabled(document,mod.name,mod.version))))throw Error("北极星核心组件未全部启用，请重新点击启动以修复。");
  return {format:document.format,sha256:bytes?sha(bytes):null,coreNames:required.map(mod=>mod.name),personalMods:mods.filter(mod=>!mod.required).length};
}
async function prepare(profileDirectory,region,{coreEnabled=true,backupRoot,guard}={}) {
  if(!["cn","global"].includes(region))throw Error("请选择国服或全球服客户端。");
  await guard?.();
  checked(path.join(profileDirectory,"enabledmods.json"));
  const profile=fs.realpathSync(profileDirectory),file=path.join(profile,"enabledmods.json"),original=checked(file),document=parse(original),mods=installed(profile);
  const required=mods.filter(mod=>mod.required);if(coreEnabled&&required.length!==CORE_NAMES.length)throw Error("北极星核心组件不完整，请先修复所选客户端。");
  if(CORE_NAMES.some(name=>mods.filter(mod=>mod.name===name).length>1))throw Error("发现与北极星核心组件同名的重复模组，请先移除重复项。");
  const store=path.join(backupRoot||(fs.existsSync("D:/")?"D:/TFX-Launcher-Data/mod-enabled-state":path.join(profile,".tfx/mod-enabled-state")),sha(Buffer.from(profile.toLowerCase())).slice(0,24));
  checked(path.join(store,"history.json"));await guard?.();fs.mkdirSync(path.join(store,"snapshots"),{recursive:true});checked(path.join(store,"snapshots/.tfx-state-path-check"));
  const historyFile=path.join(store,"history.json"),priorHistory=checked(historyFile);let history={schemaVersion:1,profile,global:{Version:1}};
  if(priorHistory){try{history=JSON.parse(priorHistory);}catch(_){throw Error("模组开关历史无法解析，已保留原文件。");}if(history.schemaVersion!==1||typeof history.profile!=="string"||path.resolve(history.profile).toLowerCase()!==profile.toLowerCase())throw Error("模组开关历史来源不匹配，已停止转换。");}
  const global=parse(history.global);if(global.format!=="versioned")throw Error("模组开关历史格式无效。");mergeVersioned(global,document);
  const next=region==="global"?parse(serialize(global)):{format:"flat",states:dictionary()};
  if(region==="cn") {
    if(history.flat){const oldFlat=parse(history.flat);if(oldFlat.format!=="flat")throw Error("模组开关历史格式无效。");for(const [name,on] of Object.entries(oldFlat.states))assign(next.states,name,on);}
    for(const name of Object.keys(document.states)){const mod=mods.find(item=>item.name===name);assign(next.states,name,project(document,name,mod?.version));}
    for(const mod of mods)assign(next.states,mod.name,project(document,mod.name,mod.version));
  } else if(document.format==="flat") {for(const mod of mods)set(next,mod.name,mod.version,enabled(document,mod.name,mod.version));}
  let coreReenabled=false;if(coreEnabled)for(const mod of required){if(!enabled(next,mod.name,mod.version))coreReenabled=true;set(next,mod.name,mod.version,true);}
  if(region==="global")mergeVersioned(global,next);
  const intended=serialize(next),changed=!equal(original,intended),snapshot=original===null?null:path.join(store,"snapshots",sha(original)+".json");
  if(snapshot){const existing=checked(snapshot);if(existing&&!existing.equals(original))throw Error("模组开关原始备份校验失败。");if(!existing)await writeGuarded(snapshot,null,original,{guard});}
  const legacyBytes=checked(path.join(profile,"enabledmods.old.json"));let legacyBackup=null;
  if(legacyBytes){legacyBackup=path.join(store,"snapshots",sha(legacyBytes)+".legacy.json");const existing=checked(legacyBackup);if(existing&&!existing.equals(legacyBytes))throw Error("旧版模组开关备份校验失败。");if(!existing)await writeGuarded(legacyBackup,null,legacyBytes,{guard});}
  // Persist complete version history before changing the client-facing file.
  // A crash can leave extra metadata, but can never discard older choices.
  const historyBytes=Buffer.from(JSON.stringify({schemaVersion:1,profile,global:raw(global),flat:region==="cn"?raw(next):document.format==="flat"?raw(document):history.flat||{},lastInputSHA256:original?sha(original):null,lastOutputSHA256:sha(intended),lastRegion:region},null,2)+"\n");
  if(historyBytes.length>MAX_BYTES)throw Error("模组开关历史体积超出上限。");if(!equal(priorHistory,historyBytes))await writeGuarded(historyFile,priorHistory,historyBytes,{guard});
  if(changed)await writeGuarded(file,original,intended,{guard});else await guard?.();
  return {changed,format:next.format,coreReenabled,backup:snapshot,legacyBackup,history:historyFile,sha256:sha(intended),coreNames:required.map(mod=>mod.name),personalMods:mods.filter(mod=>!mod.required).length};
}
module.exports={parse,raw,serialize,enabled,set,checked,write,writeGuarded,installed,isRequired,prepare,assertReady,CORE_NAMES};
