"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const KEYS = ["setting.stream_memory", "setting.mat_picmip"];
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const samePath = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const message = e => e.message || String(e);

function validValue(key, value) {
  if (typeof value !== "string") return false;
  if (key === KEYS[0]) return /^\d{1,10}$/.test(value) && Number(value) <= 0xffffffff;
  return /^-?\d{1,2}$/.test(value) && Number(value) >= -1 && Number(value) <= 16;
}
function parseConfig(bytes) {
  if (bytes.length > 1024*1024) throw Error("画面配置超过支持的大小");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text,"utf8").equals(bytes)) throw Error("画面配置不是有效的 UTF-8 文件");
  if (!/"VideoConfig"\s*\{/.test(text) || !/\}\s*$/.test(text)) throw Error("画面配置结构不完整，未修改文件");
  const fields = {};
  for (const key of KEYS) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const matches = [...text.matchAll(new RegExp('(^[\\t ]*"' + escaped + '"[\\t ]+")([^"\\r\\n]*)("[^\\r\\n]*$)',"gm"))];
    if (matches.length !== 1 || !validValue(key,matches[0][2])) throw Error("皮肤兼容性设置缺失、重复或格式不正确，未修改文件");
    const m = matches[0];
    fields[key] = {value:m[2],start:m.index+m[1].length,end:m.index+m[1].length+m[2].length};
  }
  return {text,fields,values:Object.fromEntries(KEYS.map(k=>[k,fields[k].value]))};
}
function replaceValues(parsed, values) {
  let result = parsed.text;
  for (const key of [...KEYS].sort((a,b)=>parsed.fields[b].start-parsed.fields[a].start)) {
    if (!validValue(key,values[key])) throw Error("记录的皮肤兼容性设置无效");
    const f = parsed.fields[key];
    result = result.slice(0,f.start)+values[key]+result.slice(f.end);
  }
  return Buffer.from(result,"utf8");
}
async function readOptional(file) {
  try {return await fsp.readFile(file);} catch(e) {if (e.code === "ENOENT") return null; throw e;}
}
async function publishJson(file, value) {
  await fsp.mkdir(path.dirname(file),{recursive:true});
  const temporary = file+"."+crypto.randomUUID()+".tmp";
  try {await fsp.writeFile(temporary,JSON.stringify(value,null,2)+"\n",{encoding:"utf8",flag:"wx"});await fsp.rename(temporary,file);}
  finally {await fsp.rm(temporary,{force:true});}
}

class DdsProtection {
  constructor(options) {
    this.baseDir = options.baseDir;
    this.documentsPath = options.documentsPath;
    this.getActiveBackups = options.getActiveBackups || (async()=>[]);
    this.isGameRunning = options.isGameRunning || (async()=>false);
    this.busy = false;
  }
  configPath() {return path.join(typeof this.documentsPath === "function" ? this.documentsPath() : this.documentsPath,"Respawn","Titanfall2","local","videoconfig.txt");}
  stateFile(gamePath) {return path.join(this.baseDir,"texture-settings",hash(path.resolve(gamePath).toLowerCase()),"settings.json");}
  async readState(gamePath) {
    const bytes = await readOptional(this.stateFile(gamePath));
    if (!bytes) return {version:1,gamePath:path.resolve(gamePath),enabled:true,snapshot:null};
    if (bytes.length > 64*1024) throw Error("皮肤保护设置记录超过支持的大小");
    let value; try {const body=bytes.toString("utf8");if(!Buffer.from(body).equals(bytes))throw Error();value=JSON.parse(body);} catch(e) {throw Error("皮肤保护设置记录无法读取，请保留记录并重新检查");}
    if (!value || value.version !== 1 || typeof value.gamePath!=="string" || !samePath(value.gamePath,gamePath) || typeof value.enabled !== "boolean") throw Error("皮肤保护设置记录与当前目录不匹配");
    if (value.snapshot) {
      if (typeof value.snapshot.configPath!=="string" || !samePath(value.snapshot.configPath,this.configPath()) || !Number.isFinite(Date.parse(value.snapshot.capturedAt)) || KEYS.some(k=>!validValue(k,value.snapshot.values?.[k]))) throw Error("皮肤兼容性设置快照无效，请重新记录当前设置");
    }
    return value;
  }
  async active(gamePath) {
    return (await this.getActiveBackups(gamePath)).filter(b=>["installed","pending","preparing"].includes(b.state)&&(!b.gamePath||samePath(b.gamePath,gamePath)));
  }
  counts(active) {return {activeCount:active.length,ddsCount:active.filter(b=>!b.format||b.format==="dds").length,vtfCount:active.filter(b=>b.format==="vtf").length,pendingCount:active.filter(b=>["pending","preparing"].includes(b.state)).length};}
  async readConfig() {
    const file = this.configPath(), bytes = await readOptional(file);
    if (!bytes) throw Error("未找到游戏画面配置，请先运行一次游戏再记录皮肤兼容性设置");
    return {file,bytes,parsed:parseConfig(bytes)};
  }
  async status(gamePath) {
    if (!gamePath) return {enabled:true,gamePath:"",...this.counts([]),state:"inactive",snapshot:null,configPath:this.configPath()};
    let active=[];
    try {
      active=await this.active(gamePath);
      const stored=await this.readState(gamePath);
      const common={enabled:stored.enabled,gamePath:path.resolve(gamePath),...this.counts(active),snapshot:stored.snapshot,configPath:this.configPath()};
      if (!active.length) return {...common,state:"inactive"};
      if (common.pendingCount) return {...common,state:"error",reason:"有未完成的皮肤安装，请先在“皮肤安装 → 武器库”恢复未完成的操作"};
      let current;
      try {current=await this.readConfig();} catch(e) {return {...common,state:e.message.startsWith("未找到")?"missing-config":"error",reason:message(e)};}
      if (!stored.snapshot) return {...common,state:"unrecorded"};
      const changed=KEYS.some(k=>current.parsed.values[k]!==stored.snapshot.values[k]);
      return {...common,state:changed?"changed":"ready",currentValues:current.parsed.values};
    } catch(e) {return {enabled:true,gamePath:path.resolve(gamePath),...this.counts(active),state:"error",snapshot:null,configPath:this.configPath(),reason:message(e)};}
  }
  async exclusive(action) {
    if (this.busy) throw Error("皮肤保护设置正在检查，请稍后重试");
    this.busy=true;
    try {return await action();} finally {this.busy=false;}
  }
  async prepareCapture(gamePath) {
    const stored=await this.readState(gamePath), active=await this.active(gamePath);
    if (active.some(b=>["pending","preparing"].includes(b.state))) throw Error("请先恢复未完成的皮肤安装");
    if (active.length && stored.snapshot) return {reuse:true,snapshot:stored.snapshot};
    const config=await this.readConfig();
    return {reuse:false,snapshot:{capturedAt:new Date().toISOString(),configPath:config.file,values:config.parsed.values,sourceHash:hash(config.bytes)}};
  }
  async commitCapture(gamePath,candidate) {
    return this.exclusive(async()=>{
      if (!candidate?.snapshot || !samePath(candidate.snapshot.configPath,this.configPath()) || KEYS.some(k=>!validValue(k,candidate.snapshot.values[k]))) throw Error("皮肤兼容性设置快照无效");
      const stored=await this.readState(gamePath);
      if (candidate.reuse && stored.snapshot) return this.status(gamePath);
      await publishJson(this.stateFile(gamePath),{...stored,snapshot:candidate.snapshot});
      return this.status(gamePath);
    });
  }
  async capture(gamePath) {
    return this.exclusive(async()=>{
      if (await this.isGameRunning()) throw Error("请先退出游戏，再记录皮肤兼容性设置");
      const active=await this.active(gamePath);
      if (!active.length) throw Error("安装 DDS 或 VTF 皮肤后才能记录当前皮肤兼容性设置");
      if (active.some(b=>["pending","preparing"].includes(b.state))) throw Error("请先恢复未完成的皮肤安装");
      const stored=await this.readState(gamePath), config=await this.readConfig();
      if (await this.isGameRunning()) throw Error("游戏已启动，皮肤兼容性设置记录已取消");
      await publishJson(this.stateFile(gamePath),{...stored,snapshot:{capturedAt:new Date().toISOString(),configPath:config.file,values:config.parsed.values,sourceHash:hash(config.bytes)}});
      return this.status(gamePath);
    });
  }
  async setEnabled(gamePath,enabled) {
    return this.exclusive(async()=>{
      if (typeof enabled !== "boolean") throw Error("皮肤保护开关无效");
      if (!gamePath) throw Error("请先选择游戏目录");
      const stored=await this.readState(gamePath);
      await publishJson(this.stateFile(gamePath),{...stored,enabled});
      return this.status(gamePath);
    });
  }
  async beforeLaunch(gamePath) {
    return this.exclusive(async()=>{
      if (!gamePath) return {ok:true,restored:false,state:"inactive"};
      const active=await this.active(gamePath);
      if (!active.length) return {ok:true,restored:false,state:"inactive"};
      // Incomplete writes of either format must be recovered even if disabled.
      if (active.some(b=>["pending","preparing"].includes(b.state))) throw Error("有未完成的皮肤安装，请在“皮肤安装 → 武器库”恢复未完成的操作后再启动游戏");
      const stored=await this.readState(gamePath);
      if (!stored.enabled) return {ok:true,restored:false,state:"disabled"};
      if (!stored.snapshot) return {ok:true,restored:false,state:"unrecorded",reason:"已安装皮肤，但尚未记录兼容性设置；可在偏好设置中记录当前设置"};
      const current=await this.readConfig();
      if (KEYS.every(k=>current.parsed.values[k]===stored.snapshot.values[k])) return {ok:true,restored:false,state:"ready"};
      if (await this.isGameRunning()) throw Error("游戏正在运行，无法恢复皮肤兼容性设置；请先退出游戏");
      const next=replaceValues(current.parsed,stored.snapshot.values);
      const receipt=path.join(path.dirname(this.stateFile(gamePath)),"restores",crypto.randomUUID());
      await fsp.mkdir(receipt,{recursive:true});
      await fsp.writeFile(path.join(receipt,"before.bin"),current.bytes,{flag:"wx"});
      await publishJson(path.join(receipt,"receipt.json"),{version:1,configPath:current.file,createdAt:new Date().toISOString(),beforeHash:hash(current.bytes),afterHash:hash(next),fields:KEYS,state:"prepared"});
      const temporary=path.join(path.dirname(current.file),".vyra-texture-"+crypto.randomUUID()+".tmp");
      let published=false;
      try {
        const stat=await fsp.stat(current.file);
        await fsp.access(current.file,fs.constants.W_OK);
        const handle=await fsp.open(temporary,"wx",stat.mode);
        try {await handle.writeFile(next);await handle.sync();} finally {await handle.close();}
        if (await this.isGameRunning()) throw Error("游戏已启动，设置恢复已取消");
        if (!fs.readFileSync(current.file).equals(current.bytes)) throw Error("画面配置被其他程序修改，请重试启动");
        await fsp.rename(temporary,current.file);published=true;
        if (!fs.readFileSync(current.file).equals(next)) throw Error("皮肤兼容性设置恢复后校验失败，请检查配置文件");
        await publishJson(path.join(receipt,"receipt.json"),{version:1,configPath:current.file,createdAt:new Date().toISOString(),beforeHash:hash(current.bytes),afterHash:hash(next),fields:KEYS,state:"restored"});
        return {ok:true,restored:true,state:"ready",fields:KEYS,receipt};
      } catch(e) {
        // Never overwrite an intervening third-party edit during recovery.
        if (published && fs.readFileSync(current.file).equals(next)) {
          await fsp.writeFile(temporary,current.bytes,{flag:"wx"});
          await fsp.rename(temporary,current.file);
          if (!fs.readFileSync(current.file).equals(current.bytes)) throw Error("皮肤兼容性设置恢复失败且撤销未通过校验，原文件备份已保留："+receipt);
        }
        throw Error("皮肤启动前检查未完成："+message(e));
      } finally {await fsp.rm(temporary,{force:true});}
    });
  }
}
module.exports={DdsProtection,SkinProtection:DdsProtection,parseConfig,replaceValues,KEYS};
