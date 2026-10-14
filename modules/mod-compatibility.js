"use strict";
// Fingerprinted compatibility adjustments keep the user's enable choices and
// original manifest bytes. A durable intent precedes every manifest write.
const fs=require("fs"),path=require("path"),crypto=require("crypto"),state=require("./mod-enabled-state");
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex"),HASH=/^[a-f0-9]{64}$/;
const RULES=Object.freeze([Object.freeze({id:"global-1.31.13-ghost-1.0-order",region:"global",clientVersion:"1.31.13",name:"Ghost (MW2 2022)",version:"1.0",fromPriority:1,toPriority:100,manifestSHA256:"644004af0d150e9b3c24613fe53e01882e32aedfc7244396e17f8f5b5862eaaf",assets:Object.freeze({"paks/ghost_head.rpak":"bc3d0ee3131d36a15a89a9266a4019732a569c02f1b8446799cf363e43ed3817","paks/ghost_lowerbody.rpak":"ee9c6328f8ec61805f11547c551051dc61b63e8c73e42b0e90dedfeb7a8e9ab0","paks/ghost_upperbody.rpak":"6866b88895e7b4b42136580ee5d5acc40770f1712add979b8e5866b1c88ccbd1","paks/rpak.json":"0182d115fcead986be57ee2289add48b797c93b2bfb947e45d7184d4106a819c"})})]);
function relative(value){return typeof value==="string"&&value&&!value.includes("\\")&&!path.isAbsolute(value)&&!value.split("/").some(part=>!part||part==="."||part===".."||/[<>:"|?*\x00-\x1f]/.test(part));}
function changedBytes(original,rule){
  if(sha(original)!==rule.manifestSHA256)throw Error("皮肤兼容性原始文件校验失败。");
  const text=original.toString("utf8");if(!Buffer.from(text).equals(original))throw Error("皮肤兼容性文件不是有效 UTF-8。");
  const mod=JSON.parse(text.replace(/^\uFEFF/,""));if(mod.Name!==rule.name||mod.Version!==rule.version||mod.LoadPriority!==rule.fromPriority)throw Error("皮肤兼容性文件的名称、版本或加载顺序不匹配。");
  const pattern=/"LoadPriority"\s*:\s*(-?\d+(?:\.\d+)?)/g,matches=[...text.matchAll(pattern)];
  if(matches.length!==1||Number(matches[0][1])!==rule.fromPriority)throw Error("皮肤兼容性加载顺序字段无法安全修改。");
  const start=matches[0].index+matches[0][0].length-matches[0][1].length;
  return Buffer.concat([original.subarray(0,Buffer.byteLength(text.slice(0,start))),Buffer.from(String(rule.toPriority)),original.subarray(Buffer.byteLength(text.slice(0,start+matches[0][1].length)))]);
}
async function assetHash(filename){
  state.checked(path.join(path.dirname(filename),".tfx-compat-path-check"));
  let stat;try{stat=fs.lstatSync(filename);}catch(error){if(error.code==="ENOENT")return null;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw Error("皮肤兼容性资源路径无效。");
  const digest=crypto.createHash("sha256");for await(const chunk of fs.createReadStream(filename))digest.update(chunk);return digest.digest("hex");
}
function createManager({rules=RULES,storage=state}={}){
  if(!Array.isArray(rules)||rules.length>100||new Set(rules.map(rule=>rule?.id)).size!==rules.length||rules.some(rule=>!rule||typeof rule.id!=="string"||!rule.id||typeof rule.name!=="string"||!rule.name||typeof rule.version!=="string"||!rule.version||rule.region!=="global"||!/^\d+\.\d+\.\d+$/.test(rule.clientVersion)||!Number.isInteger(rule.fromPriority)||!Number.isInteger(rule.toPriority)||!HASH.test(rule.manifestSHA256)||!rule.assets||typeof rule.assets!=="object"||Array.isArray(rule.assets)||!Object.keys(rule.assets).length||Object.entries(rule.assets).some(([name,digest])=>!relative(name)||!HASH.test(digest))))throw Error("皮肤兼容性规则的路径或校验值无效。");
  rules=rules.map(rule=>Object.freeze({...rule,assets:Object.freeze({...rule.assets})}));
  const busy=new Set();
  async function prepare(profileDirectory,region,{clientVersion,backupRoot,guard}={}){
    if(!["cn","global","vanilla"].includes(region))throw Error("皮肤兼容性检查的客户端类型无效。");
    await guard?.();state.checked(path.join(profileDirectory,".tfx-compat-path-check"));
    const profile=fs.realpathSync(profileDirectory),key=profile.toLowerCase();if(busy.has(key))throw Error("皮肤兼容性调整正在执行，请稍后重试。");busy.add(key);
    try{
      const base=backupRoot||(fs.existsSync("D:/")?"D:/TFX-Launcher-Data/mod-compatibility":path.join(profile,".tfx/mod-compatibility")),store=path.join(base,sha(Buffer.from(key)).slice(0,24)),journalFile=path.join(store,"journal.json");
      let journalBytes=storage.checked(journalFile),journal={schemaVersion:1,profile,entries:[]};
      if(journalBytes){try{journal=JSON.parse(journalBytes);}catch(_){throw Error("皮肤兼容性恢复记录无法解析，已保留现有文件。");}if(journal.schemaVersion!==1||typeof journal.profile!=="string"||path.resolve(journal.profile).toLowerCase()!==key||!Array.isArray(journal.entries)||journal.entries.length>12000)throw Error("皮肤兼容性恢复记录来源无效。");}
      const seen=new Set();for(const entry of journal.entries){const rule=rules.find(rule=>rule.id===entry.ruleId);if(!rule||!relative(entry.path)||!entry.path.endsWith("/mod.json")||seen.has(entry.path.toLowerCase())||entry.originalSHA256!==rule.manifestSHA256||!HASH.test(entry.modifiedSHA256)||entry.backup!=="snapshots/"+entry.originalSHA256+".json"||!["prepared","applied","restored"].includes(entry.phase))throw Error("皮肤兼容性恢复记录路径或校验值无效。");seen.add(entry.path.toLowerCase());}
      const result={applied:[],restored:[],active:[],skipped:[],changed:false,journal:journalBytes?journalFile:null};
      const save=async()=>{const next=Buffer.from(JSON.stringify(journal,null,2)+"\n");if(journalBytes?.equals(next))return;await guard?.();state.checked(path.join(store,".tfx-compat-path-check"));fs.mkdirSync(path.join(store,"snapshots"),{recursive:true});await storage.writeGuarded(journalFile,journalBytes,next,{guard});journalBytes=next;result.journal=journalFile;};
      const targetRule=rule=>region===rule.region&&String(clientVersion||"").replace(/^v/,"")===rule.clientVersion;
      // Recover prepared intents before discovering fresh candidates. A
      // foreign manifest is never overwritten or adopted as a baseline.
      for(const entry of journal.entries){
        const rule=rules.find(rule=>rule.id===entry.ruleId),file=path.join(profile,...entry.path.split("/")),original=storage.checked(path.join(store,...entry.backup.split("/")),false),intended=changedBytes(original,rule);
        if(sha(intended)!==entry.modifiedSHA256)throw Error("皮肤兼容性备份与恢复记录不一致。");
        const bytes=storage.checked(file),current=bytes?sha(bytes):null;
        if(current===null){entry.phase="restored";await save();continue;} // Uninstalled mods stay uninstalled; a later exact reinstall can be matched again.
        if(current!==entry.originalSHA256&&current!==entry.modifiedSHA256){if(entry.phase==="restored")continue;const error=Error("皮肤文件已由其他程序修改，未覆盖外部修改。请检查兼容性恢复记录。");error.code="MOD_COMPATIBILITY_CONFLICT";throw error;}
        if(targetRule(rule)){
          if(!await assetsMatch(path.dirname(file),rule)){if(current===entry.originalSHA256){result.skipped.push({name:rule.name,version:rule.version,reason:"assets-changed"});continue;}const error=Error("已调整加载顺序的皮肤资源发生变化，请恢复原始皮肤或切回国服后重新安装。");error.code="MOD_COMPATIBILITY_CONFLICT";throw error;}await guard?.();
          if(current===entry.originalSHA256){entry.phase="prepared";await save();await storage.writeGuarded(file,bytes,intended,{guard:async()=>{await guard?.();if(!await assetsMatch(path.dirname(file),rule))throw Error("皮肤资源在兼容性检查后发生变化，已停止调整。");await guard?.();}});result.changed=true;result.applied.push(summary(rule,path.join(store,...entry.backup.split("/"))));}
          entry.phase="applied";await save();result.active.push({name:rule.name,version:rule.version,priority:rule.toPriority});
        }else{
          if(current===entry.modifiedSHA256){await storage.writeGuarded(file,bytes,original,{guard});result.changed=true;result.restored.push({name:rule.name,version:rule.version});}
          entry.phase="restored";await save();
        }
      }
      const eligible=rules.filter(targetRule);if(!eligible.length)return result;
      for(const mod of state.installed(profile))for(const rule of eligible){
        if(mod.name!==rule.name||mod.version!==rule.version)continue;
        const file=path.join(mod.folder_path,"mod.json"),name=path.relative(profile,file).split(path.sep).join("/");if(!relative(name)||seen.has(name.toLowerCase()))continue;
        const original=storage.checked(file);if(!original||sha(original)!==rule.manifestSHA256){result.skipped.push({name:rule.name,version:rule.version,reason:"manifest-changed"});continue;}if(!await assetsMatch(mod.folder_path,rule)){result.skipped.push({name:rule.name,version:rule.version,reason:"assets-changed"});continue;}await guard?.();
        const intended=changedBytes(original,rule),backup="snapshots/"+sha(original)+".json",backupFile=path.join(store,...backup.split("/"));
        await guard?.();state.checked(path.join(store,".tfx-compat-path-check"));fs.mkdirSync(path.join(store,"snapshots"),{recursive:true});
        const snapshot=storage.checked(backupFile);if(snapshot&&!snapshot.equals(original))throw Error("皮肤兼容性原始备份已损坏。");if(!snapshot)await storage.writeGuarded(backupFile,null,original,{guard});
        const entry={ruleId:rule.id,name:rule.name,version:rule.version,fromPriority:rule.fromPriority,toPriority:rule.toPriority,path:name,originalSHA256:sha(original),modifiedSHA256:sha(intended),backup,phase:"prepared"};journal.entries.push(entry);seen.add(name.toLowerCase());await save();
        await storage.writeGuarded(file,original,intended,{guard:async()=>{await guard?.();if(!await assetsMatch(mod.folder_path,rule))throw Error("皮肤资源在兼容性检查后发生变化，已停止调整。");await guard?.();}});
        result.changed=true;result.applied.push(summary(rule,backupFile));entry.phase="applied";await save();result.active.push({name:rule.name,version:rule.version,priority:rule.toPriority});
      }
      return result;
    }finally{busy.delete(key);}
  }
  return {prepare};
}
async function assetsMatch(folder,rule){for(const [relativePath,expected] of Object.entries(rule.assets)){if(!relative(relativePath)||await assetHash(path.join(folder,...relativePath.split("/")))!==expected)return false;}return true;}
function summary(rule,backup){return {name:rule.name,version:rule.version,fromPriority:rule.fromPriority,toPriority:rule.toPriority,backup};}
const manager=createManager();module.exports={prepare:manager.prepare,RULES,createManager};
