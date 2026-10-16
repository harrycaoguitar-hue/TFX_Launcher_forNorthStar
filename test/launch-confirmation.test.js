"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{LaunchConfirmation,splitArguments}=require("../src/modules/launch-session");
function fixture(mode="northstar",options={}){
  let now=0,next=0,snapshot={ok:true,processes:[]},queryError=false;const timers=new Map(),speed=[];
  const schedule=(fn,delay)=>{const t={id:++next,unref(){}};timers.set(t.id,{fn,at:now+delay});return t;};
  const clock={async advance(amount){const until=now+amount;for(let loop=0;loop<1000;loop++){const item=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;now=item[1].at;timers.delete(item[0]);await item[1].fn();await Promise.resolve();}now=until;}};
  const c=new LaunchConfirmation({now:()=>now,schedule,clear:t=>timers.delete(t?.id),refresh:async()=>{if(queryError)throw Error("process query unavailable");return snapshot;},speedUp:x=>speed.push(x)}),s=c.begin(snapshot,{gameVersion:mode,...options});c.spawned(s,101);
  return {c,s,clock,speed,timers,observe(value){snapshot=value;c.observe(value);},ready(){c.ready(s);},exit(code=0,signal){c.launcherExited(s,code,signal);},rejectQueries(){queryError=true;}};
}
test("quick close of observed game unlocks within disappearance grace without waiting full timeout",async()=>{const f=fixture();f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(500);f.observe({ok:true,processes:[]});await f.clock.advance(2600);const r=await f.s.promise;assert.equal(r.ok,false);assert.match(r.error,/退出/);assert.equal(f.c.current,null);assert.equal(f.speed.at(-1),0);assert.equal(f.timers.size,0);});
test("zero launcher exit permits delayed Steam handoff and game confirmation",async()=>{const f=fixture("vanilla");f.exit();await f.clock.advance(10000);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});assert.equal((await f.s.promise).ok,true);});
test("Northstar child PID is never successful without core/menu readiness",async()=>{const f=fixture();f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});await f.clock.advance(120001);assert.equal((await f.s.promise).code,"NORTHSTAR_NOT_READY");});

test("official Mod launch cannot accept a bare game without VanillaPlus menu evidence",async()=>{
  const f=fixture("vanilla",{requireReady:true,officialMods:true});f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});
  await f.clock.advance(120000);assert.equal((await f.s.promise).code,"OFFICIAL_MOD_NOT_READY");assert.equal(f.timers.size,0);
});

test("official Mod bootstrap permits delayed purchased-game handoff but still requires VanillaPlus readiness",async()=>{
  const f=fixture("vanilla",{requireReady:true,officialMods:true,allowBootstrapHandoff:true});
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:101}]});f.exit(100010);
  await f.clock.advance(23000);assert.equal(f.c.current,f.s);
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(5100);
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});assert.equal(f.c.current,f.s);
  f.ready();await f.clock.advance(1000);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});
  assert.equal((await f.s.promise).pid,102);assert.equal(f.timers.size,0);
});

test("official Mod purchased-game handoff without component evidence reports the Mod readiness failure",async()=>{
  const f=fixture("vanilla",{requireReady:true,officialMods:true,allowBootstrapHandoff:true});f.exit(100010);
  await f.clock.advance(23000);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});
  await f.clock.advance(97000);assert.equal((await f.s.promise).code,"OFFICIAL_MOD_NOT_READY");
});

test("successful Steam dispatch waits for a separate verified official Mod game without replay",async()=>{
  let replay=0;const f=fixture("vanilla",{requireReady:true,officialMods:true,platformDispatch:true,retryHandoff:async()=>{replay++;}});
  f.exit(0);await f.clock.advance(23000);assert.equal(f.c.current,f.s);assert.equal(replay,0);
  f.observe({ok:true,processes:[{image:"Steam.exe",pid:101}]});assert.equal(f.c.current,f.s);
  f.ready();f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(1000);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});
  assert.equal((await f.s.promise).pid,102);assert.equal(replay,0);
});

test("Steam dispatch cannot confirm an absent game, an unready game or a failed command",async()=>{
  const missing=fixture("vanilla",{requireReady:true,officialMods:true,platformDispatch:true});missing.exit(0);await missing.clock.advance(60000);assert.equal((await missing.s.promise).ok,false);
  const bare=fixture("vanilla",{requireReady:true,officialMods:true,platformDispatch:true});bare.exit(0);bare.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await bare.clock.advance(120000);assert.equal((await bare.s.promise).code,"OFFICIAL_MOD_NOT_READY");
  const failed=fixture("vanilla",{requireReady:true,officialMods:true,platformDispatch:true});failed.exit(1);await failed.clock.advance(2500);assert.equal((await failed.s.promise).ok,false);
});

test("verified official Mod menu confirms the owned loader and quick close releases the request",async()=>{
  const f=fixture("vanilla",{requireReady:true,officialMods:true});f.ready();f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});
  await f.clock.advance(1000);f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});assert.equal((await f.s.promise).pid,101);
  const closing=fixture("vanilla",{requireReady:true,officialMods:true});closing.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});closing.observe({ok:true,processes:[]});
  await closing.clock.advance(2500);assert.equal((await closing.s.promise).code,"LAUNCH_EARLY_EXIT");assert.equal(closing.timers.size,0);
});
test("ready Northstar confirms only its owned launcher PID after stable snapshots",async()=>{const f=fixture();f.ready();f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:999}]});await f.clock.advance(5100);assert.equal(f.c.current,f.s);f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});const r=await f.s.promise;assert.equal(r.ok,true);assert.equal(r.pid,101);});

test("a verified Northstar menu and owned PID confirm after one stable second",async()=>{
  const f=fixture();f.ready();f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});
  await f.clock.advance(999);f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});assert.equal(f.c.current,f.s);
  await f.clock.advance(1);f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:101}]});
  assert.equal((await f.s.promise).pid,101);assert.equal(f.timers.size,0);
});

test("a vanilla PID retains five-second bootstrap stability despite faster Northstar confirmation",async()=>{
  const f=fixture("vanilla");f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:101}]});
  await f.clock.advance(1000);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:101}]});assert.equal(f.c.current,f.s);
  await f.clock.advance(4000);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:101}]});assert.equal((await f.s.promise).pid,101);
});
test("process-query failure cannot turn pending handoff into an early-exit error",async()=>{const f=fixture("vanilla");f.exit();f.observe({ok:false,processes:[]});await f.clock.advance(16000);assert.equal(f.c.current,f.s);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});assert.equal((await f.s.promise).ok,true);});
test("early nonzero exit and bounded timeout both release all confirmation timers",async()=>{for(const code of [1,null]){const f=fixture();if(code!==null)f.exit(code);await f.clock.advance(code===null?120001:2600);assert.equal((await f.s.promise).ok,false);assert.equal(f.c.current,null);assert.equal(f.timers.size,0);}});

test("unready loader exits retain technical evidence and suggest checking recent Mods without assigning blame",async()=>{
  for(const [mode,options] of [["northstar",{}],["vanilla",{requireReady:true,officialMods:true}]]){
    for(const observed of [false,true]){
      const f=fixture(mode,options);
      if(observed)f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});
      f.exit(3221226505);f.observe({ok:true,processes:[]});await f.clock.advance(2500);
      const result=await f.s.promise;
      assert.equal(result.code,observed?"LAUNCH_EARLY_EXIT":"LAUNCHER_EARLY_EXIT");
      assert.match(result.error,/主菜单加载完成前退出（退出码 3221226505）/);
      assert.match(result.error,/若不是手动关闭，请先排查最近启用的 Mod 或皮肤/);
      assert.match(result.error,/EA App \/ Steam 登录提示与启动诊断/);
      assert.equal(f.timers.size,0);assert.equal(f.c.current,null);
    }
  }
});

test("loader disappearance and signal guidance remain specific while clean and ready exits keep their existing copy",async()=>{
  const missing=fixture();missing.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});missing.observe({ok:true,processes:[]});await missing.clock.advance(2500);
  assert.match((await missing.s.promise).error,/主菜单加载完成前退出。若不是手动关闭/);
  const signal=fixture();signal.exit(null,"SIGTERM");await signal.clock.advance(2500);assert.match((await signal.s.promise).error,/主菜单加载完成前退出（SIGTERM）/);
  for(const ready of [false,true]){
    const f=fixture(ready?"northstar":"vanilla");if(ready)f.ready();f.exit(3221226505);await f.clock.advance(2500);
    const result=await f.s.promise;assert.doesNotMatch(result.error,/最近启用/);assert.match(result.error,/登录或授权提示/);
  }
});
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

test("cold vanilla lost handoff replays once and confirms the eventual game",async()=>{
  let f,replays=0; f=fixture("vanilla",{retryHandoff:async s=>{replays++;f.c.spawned(s,202);}});
  f.exit(100010);await f.clock.advance(14999);assert.equal(replays,0);await f.clock.advance(1);assert.equal(replays,1);
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:203}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:203}]});
  assert.equal((await f.s.promise).pid,203);assert.equal(f.timers.size,0);
});
test("cold Northstar zero/recognized handoff replays exact selected launch once",async()=>{
  for(const code of [0,100010]){
    let f,replays=0;f=fixture("northstar",{retryHandoff:async s=>{replays++;f.c.spawned(s,202);}});
    f.exit(code);await f.clock.advance(15000);assert.equal(replays,1);
    f.ready();f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:202}]});await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:202}]});
    assert.equal((await f.s.promise).pid,202);
  }
});
test("handoff retry never duplicates a real game, retries a quick close, or retries arbitrary crash",async()=>{
  for(const kind of ["game","entered","ready","crash"]){
    let replays=0;const f=fixture("northstar",{retryHandoff:async()=>{replays++;}});
    if(kind==="game")f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});
    if(kind==="entered")f.c.entered(f.s);if(kind==="ready")f.ready();
    f.exit(kind==="crash"?1:0);f.observe({ok:true,processes:[]});await f.clock.advance(15000);
    assert.equal(replays,0);assert.equal((await f.s.promise).ok,false);
  }
});
test("pending retry is cancelled if a real game appears then closes during grace",async()=>{
  let replays=0;const f=fixture("vanilla",{retryHandoff:async()=>{replays++;}});f.exit(100010);await f.clock.advance(1000);
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:102}]});await f.clock.advance(500);f.observe({ok:true,processes:[]});await f.clock.advance(2500);
  assert.equal(replays,0);assert.match((await f.s.promise).error,/确认完成前已退出/);
});
test("one failed replay is bounded and stale exited first child cannot affect second child",async()=>{
  let f,replays=0;f=fixture("northstar",{retryHandoff:async s=>{replays++;f.c.spawned(s,202);}});f.exit(0);await f.clock.advance(15000);
  f.c.launcherExited(f.s,1,null,101);assert.equal(f.s.childExit,null);
  f.exit(0);await f.clock.advance(15000);assert.equal(replays,1);assert.equal((await f.s.promise).ok,false);assert.equal(f.timers.size,0);
});
test("external Northstar process blocks replay rather than spawning another instance",async()=>{
  let replays=0;const f=fixture("northstar",{retryHandoff:async()=>{replays++;}});f.exit(0);
  f.observe({ok:true,processes:[{image:"NorthstarLauncher.exe",pid:999}]});await f.clock.advance(20000);assert.equal(replays,0);
  f.observe({ok:true,processes:[]});await f.clock.advance(2500);assert.equal(replays,1);
  f.c.fail(f.s,"fixture complete");await f.s.promise;
});
test("original handoff game remains observable while asynchronous replay guard is checking EA",async()=>{
  let f,release,checking=false;const guard=new Promise(resolve=>{release=resolve;});
  f=fixture("vanilla",{retryHandoff:async()=>{checking=true;await guard;}});f.exit(100010);
  const ticking=f.clock.advance(15000);for(let n=0;n<10;n++)await Promise.resolve();assert.equal(checking,true);
  f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:303}]});release();await ticking;
  await f.clock.advance(5100);f.observe({ok:true,processes:[{image:"Titanfall2.exe",pid:303}]});
  assert.equal((await f.s.promise).pid,303);assert.equal(f.timers.size,0);
});
