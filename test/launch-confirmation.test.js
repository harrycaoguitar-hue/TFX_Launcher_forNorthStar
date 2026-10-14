"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{LaunchConfirmation,splitArguments}=require("../src/modules/launch-session");
function fixture(mode="northstar"){
  let now=0,next=0,snapshot={ok:true,processes:[]},queryError=false;const timers=new Map(),speed=[];
  const schedule=(fn,delay)=>{const t={id:++next,unref(){}};timers.set(t.id,{fn,at:now+delay});return t;};
  const clock={async advance(amount){const until=now+amount;for(let loop=0;loop<1000;loop++){const item=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;now=item[1].at;timers.delete(item[0]);await item[1].fn();await Promise.resolve();}now=until;}};
  const c=new LaunchConfirmation({now:()=>now,schedule,clear:t=>timers.delete(t?.id),refresh:async()=>{if(queryError)throw Error("process query unavailable");return snapshot;},speedUp:x=>speed.push(x)}),s=c.begin(snapshot,{gameVersion:mode});c.spawned(s,101);
  return {c,s,clock,speed,timers,observe(value){snapshot=value;c.observe(value);},ready(){c.ready(s);},exit(code=0,signal){c.launcherExited(s,code,signal);},rejectQueries(){queryError=true;}};
}
test("quick close of observed game unlocks within disappearance grace without waiting full timeout",async()=>{const f=fixture();f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(500);f.observe({ok:true,processes:[]});await f.clock.advance(2600);const r=await f.s.promise;assert.equal(r.ok,false);assert.match(r.error,/退出/);assert.equal(f.c.current,null);assert.equal(f.speed.at(-1),0);assert.equal(f.timers.size,0);});
test("zero launcher exit permits delayed Steam handoff and game confirmation",async()=>{const f=fixture("vanilla");f.exit();await f.clock.advance(10000);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});assert.equal((await f.s.promise).ok,true);});
test("Northstar child PID is never successful without core/menu readiness",async()=>{const f=fixture();f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});await f.clock.advance(120001);assert.equal((await f.s.promise).code,"NORTHSTAR_NOT_READY");});
test("ready Northstar confirms only its owned launcher PID after stable snapshots",async()=>{const f=fixture();f.ready();f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:999}]});await f.clock.advance(5100);assert.equal(f.c.current,f.s);f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});const r=await f.s.promise;assert.equal(r.ok,true);assert.equal(r.pid,101);});
test("process-query failure cannot turn pending handoff into an early-exit error",async()=>{const f=fixture("vanilla");f.exit();f.observe({ok:false,processes:[]});await f.clock.advance(16000);assert.equal(f.c.current,f.s);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});assert.equal((await f.s.promise).ok,true);});
test("early nonzero exit and bounded timeout both release all confirmation timers",async()=>{for(const code of [1,null]){const f=fixture();if(code!==null)f.exit(code);await f.clock.advance(code===null?120001:2600);assert.equal((await f.s.promise).ok,false);assert.equal(f.c.current,null);assert.equal(f.timers.size,0);}});
test("Windows quoted arguments keep profile spaces and never execute shell metacharacters",()=>{assert.deepEqual(splitArguments('-profile "Profiles/My folder" +exec "config \\\"quoted\\\".cfg" & echo value'),["-profile","Profiles/My folder","+exec",'config "quoted".cfg',"&","echo","value"]);assert.throws(()=>splitArguments('"unclosed'));assert.throws(()=>splitArguments("a\0b"));});

test("recognized vanilla bootstrap exit permits a game that appears 23 seconds later",async()=>{
  const f=fixture("vanilla");f.exit(100010);await f.clock.advance(23000);assert.equal(f.c.current,f.s);
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});
  const r=await f.s.promise;assert.equal(r.ok,true);assert.equal(r.pid,102);assert.equal(f.timers.size,0);
});
test("an observed vanilla bootstrap PID cannot shorten its recognized handoff grace",async()=>{
  const f=fixture("vanilla");f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:101}]});await f.clock.advance(500);f.exit(100010);
  // A process snapshot may briefly retain the exited bootstrap PID.
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:101}]});await f.clock.advance(3000);f.observe({ok:true,processes:[]});await f.clock.advance(20000);assert.equal(f.c.current,f.s);
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});assert.equal((await f.s.promise).pid,102);
});
test("recognized bootstrap handoff without a game fails at the bounded 60-second deadline",async()=>{
  const f=fixture("vanilla");f.exit(100010);await f.clock.advance(59999);assert.equal(f.c.current,f.s);await f.clock.advance(1);
  const r=await f.s.promise;assert.equal(r.ok,false);assert.match(r.error,/100010/);assert.equal(f.timers.size,0);assert.equal(f.speed.at(-1),0);
});
test("a real game that quickly closes after bootstrap handoff still unlocks within 2.5 seconds",async()=>{
  const f=fixture("vanilla");f.exit(100010);await f.clock.advance(23000);assert.equal(f.c.current,f.s);
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(500);f.observe({ok:true,processes:[]});await f.clock.advance(2499);assert.equal(f.c.current,f.s);await f.clock.advance(1);
  const r=await f.s.promise;assert.equal(r.ok,false);assert.match(r.error,/确认完成前已退出/);assert.equal(f.timers.size,0);
});
test("a distinct game observed before bootstrap exit retains ordinary quick-close feedback",async()=>{
  const f=fixture("vanilla");f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(500);f.exit(100010);f.observe({ok:true,processes:[]});await f.clock.advance(2500);
  assert.equal((await f.s.promise).ok,false);assert.equal(f.c.current,null);assert.equal(f.timers.size,0);
});
test("other nonzero exits, signals and Northstar do not receive the vanilla bootstrap allowance",async()=>{
  for(const [mode,code,signal] of [["vanilla",1,null],["vanilla",100011,null],["vanilla",100010,"SIGTERM"],["northstar",100010,null]]){
    const f=fixture(mode);f.exit(code,signal);await f.clock.advance(2499);assert.equal(f.c.current,f.s);await f.clock.advance(1);assert.equal((await f.s.promise).ok,false);assert.equal(f.timers.size,0);
  }
});
test("rejected process queries during recognized handoff stay bounded by the original 120 seconds",async()=>{
  const f=fixture("vanilla");f.exit(100010);f.rejectQueries();await f.clock.advance(119999);assert.equal(f.c.current,f.s);await f.clock.advance(1);
  assert.match((await f.s.promise).error,/超时/);assert.equal(f.c.current,null);assert.equal(f.timers.size,0);
});
test("a late recognized bootstrap exit cannot extend the original overall deadline",async()=>{
  const f=fixture("vanilla");await f.clock.advance(100000);f.exit(100010);await f.clock.advance(19999);assert.equal(f.c.current,f.s);await f.clock.advance(1);
  assert.match((await f.s.promise).error,/超时/);assert.equal(f.timers.size,0);
});
