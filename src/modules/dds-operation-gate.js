"use strict";
// Set the gate synchronously before the first await. Every DDS write and launch
// uses this same instance, including the snapshot phase before engine.busy.
let owner = null, coolingUntil = 0;
const waiters=[];
async function run(label,action,options={}) {
  if (owner || Date.now()<coolingUntil) throw Error("游戏启动或 DDS 操作正在进行，请稍后重试");
  owner=label;
  let completed=false;
  try {const result=await action();completed=true;return result;}
  finally {owner=null;if(completed&&options.cooldownMs)coolingUntil=Date.now()+options.cooldownMs;for(const done of waiters.splice(0))done();}
}
module.exports={run,whenIdle:()=>owner?new Promise(resolve=>waiters.push(resolve)):Promise.resolve(),get busy(){return Boolean(owner)||Date.now()<coolingUntil;},get owner(){return owner;}};
