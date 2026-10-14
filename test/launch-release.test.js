"use strict";
const os = require("node:os");
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),path=require("path"),vm=require("vm"),{EventEmitter}=require("events");
const source=path.resolve(__dirname,".."),realSession=require("../src/modules/launch-session"),network=require("../src/modules/northstar-region");
const base=fs.mkdtempSync(path.join(os.tmpdir(), "tfx-launch-release-"));
function harness(changePhase){
  const root=fs.mkdtempSync(path.join(base,"game-")),profile=path.join(root,"R2Northstar"),data=path.join(root,"owned-userData"),conf={gamepath:root,nsargs:"-multiple",northstarRegion:"cn"},events=[];
  for(const name of ["Titanfall2.exe","NorthstarLauncher.exe","Northstar.dll","bin/x64_retail/launcher.dll","bin/x64_retail/tier0.dll"]){const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,name.endsWith("Northstar.dll")?"fixture -noallocconsole":"fixture");}fs.mkdirSync(path.join(root,"r2"));fs.mkdirSync(profile);
  let spawns=0,ensures=0,busy=false;
  function change(phase){events.push(phase);if(changePhase===phase)conf.northstarRegion="global";}
  class Confirmation{begin(){return {promise:Promise.resolve({ok:true,pid:900})};}spawned(){}fail(){}observe(){}entered(){}ready(){}}
  const stubs={fs,path,child_process:{spawn(){spawns++;const child=new EventEmitter();child.pid=900;child.unref=()=>{};queueMicrotask(()=>child.emit("spawn"));return child;}},electron:{app:{getPath:()=>data,quit(){}},ipcMain:{on(){},emit(){}}},"../lang":x=>x,"./settings":()=>conf,"./console":{info(){},warn(){},error(){}},"./dds-guard":{beforeLaunch:async()=>{change("skin-protection");return {ok:true};}},"../win":()=>({isDestroyed:()=>false,send(){}}),"./dds-operation-gate":{run:async(name,action)=>{busy=true;try{return await action();}finally{busy=false;}}},"./is_running":{speedUp(){},onSnapshot(){},snapshot:async()=>({ok:true,processes:[]})},"./findgame":{validateGamePath:value=>value===root?root:false},"./launch-session":{...realSession,LaunchConfirmation:Confirmation},"./northstar-region":network,"./northstar-clients":{ensure:async({guard})=>{ensures++;change("client-await");await guard?.();return {version:"1.17.7"};},recover:async()=>({})},"./mod-enabled-state":{prepare:async()=>({}),assertReady(){}},"./mod-compatibility":{prepare:async()=>({applied:[],restored:[]})},"./northstar-readiness":{NorthstarReadiness:class{}},"./dds":{busy:false},"./skin-switch":{getActive:()=>({assertReady:async()=>{}})}};
  const file=path.join(source,"src/modules/launch.js"),module={exports:{}};vm.runInNewContext("(function(require,module,exports){"+fs.readFileSync(file,"utf8")+"\n})",{Buffer,process,console,setTimeout,clearTimeout,Date,queueMicrotask},{filename:file})(id=>{if(!Object.hasOwn(stubs,id))throw Error("unstubbed "+id);return stubs[id];},module,module.exports);
  return {launch:module.exports,conf,counts:()=>({spawns,ensures,busy}),events};
}
for(const phase of ["client-await","skin-protection"])test("selection changed during "+phase+" cannot spawn captured client and releases gate",async()=>{const f=harness(phase),result=await f.launch("northstar");assert.equal(result.ok,false);assert.match(result.error,/客户端选择或游戏目录已改变/);assert.equal(f.counts().spawns,0);assert.equal(f.counts().busy,false);});
test("unchanged client and original-game launches spawn once after protection and release gate",async()=>{for(const mode of ["northstar","vanilla"]){const f=harness(),result=await f.launch(mode);assert.equal(result.ok,true);assert.equal(f.counts().spawns,1);assert.equal(f.counts().busy,false);assert.equal(f.counts().ensures,mode==="northstar"?1:0);}});

test.after(() => {
  assert.equal(path.dirname(base), path.resolve(os.tmpdir()));
  assert(path.basename(base).startsWith("tfx-launch-release-"));
  const stat = fs.lstatSync(base); assert(stat.isDirectory() && !stat.isSymbolicLink());
  fs.rmSync(base, {recursive: true, force: true});
});
