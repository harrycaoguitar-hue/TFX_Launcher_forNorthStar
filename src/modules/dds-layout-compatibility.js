"use strict";
const crypto=require("crypto");
const supported=require("./data/dds-layout-compatibility.json");
const ERROR="当前游戏资源版本与 DDS 安装位置不匹配。请更新 TFX 以匹配当前游戏资源版本，未修改游戏。";
function fingerprint(info){return crypto.createHash("sha256").update(JSON.stringify({size:info.size,chunks:info.chunks.map(({offset,length,SHA1})=>({offset,length,SHA1}))})).digest("hex");}
class DdsLayoutCompatibility{
 constructor({manifestProvider,metadata=supported}){this.manifestProvider=manifestProvider;this.metadata=metadata;}
 async inspect(root,rows=[]){
  const targets=[...new Set(rows.map(row=>row.target))];if(!targets.length)return {ready:true,layoutVerified:false,issues:[]};const manifest=await this.manifestProvider(root);if(!manifest)return {ready:true,layoutVerified:false,issues:[]};
  const issues=[];for(const target of targets){const name="r2/paks/win64/"+target.toLowerCase(),expected=this.metadata.resources[name],info=manifest.files.get(name);if(!expected||!info||info.size!==expected.size||fingerprint(info)!==expected.fingerprint||rows.some(row=>row.target===target&&(!Number.isSafeInteger(row.offset)||!Number.isSafeInteger(row.length)||row.offset<0||row.length<=0||!Number.isSafeInteger(row.offset+row.length)||row.offset+row.length>info.size)))issues.push({target,code:"layout-incompatible",repairable:false});}
  return {ready:issues.length===0,layoutVerified:issues.length===0,issues,...(issues.length?{canRepair:false,canSteamRepair:false,error:ERROR}:{})};
 }
}
module.exports={DdsLayoutCompatibility,fingerprint,ERROR};
