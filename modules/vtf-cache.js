"use strict";
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto");
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const QUARANTINE=/^reclaim-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-[a-f0-9-]{36}$/;
const OWNER="owner.json";
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
async function owner(directory){
  const stat=await fsp.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())return null;
  const marker=path.join(directory,OWNER),info=await fsp.lstat(marker);if(!info.isFile()||info.isSymbolicLink()||info.size>2048)return null;
  const value=JSON.parse(await fsp.readFile(marker,"utf8"));
  return value.version===1&&UUID.test(value.token)&&Number.isSafeInteger(value.pid)&&value.pid>0&&Number.isFinite(Date.parse(value.createdAt))?value:null;
}
function alive(pid){try{process.kill(pid,0);return true;}catch(err){return err.code!=="ESRCH";}}

// Only private imports live here. Persistent installation backups remain in
// baseDir/backups and never participate in cache cleanup.
class VtfImportCache{
  constructor(baseDir){this.root=path.join(baseDir,"packages","sessions");this.token=crypto.randomUUID();this.sessionDir=path.join(this.root,this.token);this.closed=false;this.initializing=null;this.warnings=[];}
  initialize(){if(!this.initializing)this.initializing=this.start();return this.initializing;}
  async start(){
    await fsp.mkdir(this.root,{recursive:true});
    // Unknown legacy package folders and malformed markers are deliberately
    // retained. A live PID always wins, including possible PID reuse.
    for(const entry of await fsp.readdir(this.root,{withFileTypes:true})){
      const expectedToken=UUID.test(entry.name)?entry.name:entry.name.match(QUARANTINE)?.[1];
      if(!entry.isDirectory()||entry.isSymbolicLink()||!expectedToken)continue;
      const directory=path.join(this.root,entry.name);
      try{
        const first=await owner(directory);if(!first||first.token!==expectedToken||alive(first.pid))continue;
        const latest=await owner(directory);if(!latest||latest.token!==first.token||latest.pid!==first.pid||latest.createdAt!==first.createdAt||alive(latest.pid))continue;
        // Claim an immutable, dead session namespace before removing it. Other
        // cleaners can only lose this rename; no live session name is reused.
        const claimed=path.join(this.root,"reclaim-"+first.token+"-"+crypto.randomUUID());
        await fsp.rename(directory,claimed);await fsp.rm(claimed,{recursive:true,force:true});
      }catch(err){if(err.code!=="ENOENT")this.warnings.push(err.message);}
    }
    await fsp.mkdir(this.sessionDir,{recursive:false});
    await fsp.writeFile(path.join(this.sessionDir,OWNER),JSON.stringify({version:1,pid:process.pid,token:this.token,createdAt:new Date().toISOString()}),{flag:"wx"});
    return this;
  }
  owns(directory){return same(path.dirname(directory),this.sessionDir)&&UUID.test(path.basename(directory));}
  async releaseExcept(engine,keepId){
    const errors=[];
    for(const [id,pkg]of engine.packages){
      if(id===keepId)continue;
      if(!this.owns(pkg.dir)){errors.push("临时皮肤路径不属于当前导入会话，已保留");continue;}
      try{await fsp.rm(pkg.dir,{recursive:true,force:true});engine.packages.delete(id);}catch(err){errors.push(err.message);}
    }
    return errors;
  }
  async close(engine){
    if(this.closed)return [];await this.initialize();
    const current=await owner(this.sessionDir);if(!current||current.token!==this.token||current.pid!==process.pid)throw Error("VTF 临时会话归属已改变，已保留缓存");
    await fsp.rm(this.sessionDir,{recursive:true,force:true});engine.packages.clear();this.closed=true;return [];
  }
}
module.exports={VtfImportCache};
