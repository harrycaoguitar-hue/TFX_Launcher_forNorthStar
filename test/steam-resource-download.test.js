"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs/promises"),path=require("path"),os=require("os"),crypto=require("crypto"),{EventEmitter}=require("events"),{PassThrough}=require("stream");
const {SteamResourceDownload,DepotOutput,HELPER,resourcePath,normalizedFiles,profileProbe}=require("../src/modules/steam-resource-download");
const fixtureOptions={probeProfile:async({env})=>({local:env.LOCALAPPDATA,roaming:env.APPDATA})};
const fixture=()=>{const bytes=Buffer.from("known original skin resource"),name="r2/paks/win64/pc_stream.starpak";return {bytes,name,manifest:{depot:"1237971",manifest:"2801113779391264796",SHA256:"b".repeat(64),files:new Map([[name,{size:bytes.length,chunks:[{offset:0,length:bytes.length,SHA1:crypto.createHash("sha1").update(bytes).digest("hex")}]}]])}};};
async function workspace(t){const directory=await fs.mkdtemp(path.join(process.env.TFX_TEST_TMP||os.tmpdir(),"tfx-steam-resource-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const game=path.join(directory,"game");await fs.mkdir(game);return {directory,game,base:path.join(directory,"cache")};}
function child(){const value=new EventEmitter();value.stdout=new PassThrough();value.stderr=new PassThrough();value.killed=false;value.kill=()=>{value.killed=true;setImmediate(()=>value.emit("close",null));return true;};return value;}
function successSpawn(f,events,{corrupt=false,exit=0,delay=0}={}){return (exe,args,options)=>{events.push({exe,args,options});const process=child();setTimeout(async()=>{try{const destination=args[args.indexOf("-dir")+1],file=path.join(destination,...f.name.split("/"));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,corrupt?Buffer.alloc(f.bytes.length):f.bytes);await fs.writeFile(path.join(options.cwd,"account.config"),"NOT A REAL CREDENTIAL");await fs.mkdir(path.join(destination,".DepotDownloader"));await fs.writeFile(path.join(destination,".DepotDownloader","depot.config"),"fixture");process.stdout.write(`Using filelist: '${args[args.indexOf("-filelist")+1]}'.\nGot 2 licenses for account!\n 31.25% file\n`);process.emit("close",exit);}catch(error){process.emit("error",error);}},delay);return process;};}

test("Steam plan selects only exact known resources and validates installed manifest without network",async t=>{
  const w=await workspace(t),f=fixture();let fetched=0;
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,fetch:async()=>{fetched++;throw Error();}});
  const plan=await downloader.plan({root:w.game,files:[f.name.toUpperCase(),f.name],manifest:f.manifest});
  assert.deepEqual(plan.files,[{path:f.name,size:f.bytes.length}]);assert.equal(plan.totalBytes,f.bytes.length);assert.equal(plan.depot,"1237971");assert.equal(plan.helperDownloadBytes,33474005);assert.equal(fetched,0);
  await assert.rejects(()=>fs.stat(w.base),{code:"ENOENT"});
});
test("Steam selection rejects unsafe or unbounded filenames, wrong depot and incomplete chunks",async t=>{
  const w=await workspace(t),f=fixture(),downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest});
  for(const files of [[],new Array(21).fill(f.name),["regex:.*"],["../"+f.name],["vpk/client_mp_common.bsp.pak000_9999.vpk"],["r2/paks/win64/NorthstarLauncher.exe"],[null]])await assert.rejects(()=>downloader.plan({root:w.game,files}),{code:"RESOURCE_SELECTION"});
  await assert.rejects(()=>downloader.plan({root:w.game,files:["vpk/client_mp_common.bsp.pak000_999.vpk"]}),{code:"RESOURCE_MANIFEST"});
  await assert.rejects(()=>downloader.plan({root:w.game,files:[f.name],manifest:{...f.manifest,SHA256:"c".repeat(64)}}),{code:"RESOURCE_MANIFEST_CHANGED"});
  f.manifest.depot="999";await assert.rejects(()=>downloader.plan({root:w.game,files:[f.name]}),{code:"RESOURCE_MANIFEST"});
  f.manifest.depot="1237971";f.manifest.files.get(f.name).chunks[0].offset=1;await assert.rejects(()=>downloader.plan({root:w.game,files:[f.name]}),{code:"RESOURCE_MANIFEST"});
  assert.equal(resourcePath("vpk/englishclient_mp_common.bsp.pak000_dir.vpk"),true);assert.equal(normalizedFiles(["vpk\\client_mp_common.bsp.pak000_013.vpk"])[0],"vpk/client_mp_common.bsp.pak000_013.vpk");
});
test("QR parser preserves fragmented UTF-8 block rows and emits before login completes",()=>{
  const events=[],parser=new DepotOutput(value=>events.push(value));const bytes=Buffer.from("Logging in with QR code...\nUse the Steam Mobile App to sign in with this QR code:\n    \n  ██  ▀▄  \n  █▀  ▄█  \n    \n");
  for(let i=0;i<bytes.length;i+=2)parser.write(bytes.subarray(i,i+2));
  assert.ok(events.some(event=>event.qrLines?.includes("  ██  ▀▄  ")));assert.ok(!events.some(event=>JSON.stringify(event).includes("�")));
  parser.write("Got 4 licenses for account!\n 51.25% secret/account/file\nAccessToken=not-real-private-token\n");parser.end();
  assert.ok(events.some(event=>event.phase==="authenticated"));assert.ok(events.some(event=>event.percent===51.25));assert.ok(!JSON.stringify(events).includes("not-real-private-token"));assert.ok(!JSON.stringify(events).includes("secret/account"));
});
test("selective Steam download verifies actual file chunks, keeps game unchanged, clears session files",async t=>{
  const w=await workspace(t),f=fixture(),events=[],progress=[];await fs.writeFile(path.join(w.game,"user-skin"),"existing installed skin");
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"owned-helper.exe",spawn:successSpawn(f,events),progress:value=>progress.push(value)});
  const result=await downloader.download({root:w.game,files:[f.name],manifest:f.manifest});
  assert.deepEqual(await fs.readFile(path.join(result.sourceDir,...f.name.split("/"))),f.bytes);assert.equal(await fs.readFile(path.join(w.game,"user-skin"),"utf8"),"existing installed skin");assert.deepEqual(await fs.readdir(w.game),["user-skin"]);
  const call=events[0];assert.equal(call.args[call.args.indexOf("-app")+1],"1237970");assert.equal(call.args[call.args.indexOf("-depot")+1],"1237971");assert.equal(call.args[call.args.indexOf("-manifest")+1],f.manifest.manifest);assert.equal(call.args[call.args.indexOf("-dir")+1],result.sourceDir);assert.ok(call.args.includes("-qr"));assert.ok(!call.args.some(arg=>["-validate","-verify-all","-remember-password","-username","-password"].includes(arg)));assert.ok(Number(call.args[call.args.indexOf("-loginid")+1])>0);assert.equal(call.options.windowsHide,true);assert.equal(call.options.shell,false);assert.deepEqual(call.options.stdio,["ignore","pipe","pipe"]);
  assert.equal(await fs.readFile(call.args[call.args.indexOf("-filelist")+1],"utf8"),f.name+"\n");
  assert.equal(path.dirname(call.options.env.USERPROFILE),call.options.cwd);assert.equal(call.options.env.APPDATA,path.join(call.options.env.USERPROFILE,"AppData","Roaming"));assert.equal(call.options.env.LOCALAPPDATA,path.join(call.options.env.USERPROFILE,"AppData","Local"));assert.ok(call.options.env.USERPROFILE.startsWith(w.base));assert.ok(!call.options.env.USERPROFILE.startsWith(w.game));
  await assert.rejects(()=>fs.stat(path.join(path.dirname(result.sourceDir),"account.config")),{code:"ENOENT"});await assert.rejects(()=>fs.stat(path.join(result.sourceDir,".DepotDownloader")),{code:"ENOENT"});assert.ok(progress.some(value=>value.phase==="verify"));assert.equal(progress.at(-1).phase,"complete");assert.equal(downloader.active,null);
  await assert.rejects(()=>fs.stat(call.options.env.USERPROFILE),{code:"ENOENT"});
});
test("corrupt or missing downloaded resource cannot be offered as a repair source",async t=>{
  const w=await workspace(t),f=fixture(),events=[],downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:successSpawn(f,events,{corrupt:true})});
  await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),/Steam/);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);assert.equal(downloader.active,null);
});
test("auth failure returns a safe error and deletes the isolated download, never credentials",async t=>{
  const w=await workspace(t),f=fixture();
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:()=>{const value=child();setImmediate(()=>{value.stdout.write("RefreshToken=SECRET-EXAMPLE\n");value.stderr.write("account PRIVATE-EXAMPLE\n");value.emit("close",1);});return value;}});
  await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),error=>error.code==="STEAM_AUTH_FAILED"&&!/SECRET|PRIVATE/.test(error.message));assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);
});
test("cancel terminates only the active hidden helper and cleans its fresh staging directory",async t=>{
  const w=await workspace(t),f=fixture();let running,started;const ready=new Promise(resolve=>started=resolve);
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:()=>{running=child();started();return running;}});
  const operation=downloader.download({root:w.game,files:[f.name]});await ready;await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),{code:"DOWNLOAD_BUSY"});assert.equal(downloader.cancel(),true);await assert.rejects(()=>operation,{code:"CANCELLED"});assert.equal(running.killed,true);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);assert.equal(downloader.cancel(),false);
});
test("auth and idle timeouts terminate the helper instead of leaving a locked install",async t=>{
  const w=await workspace(t),f=fixture();let running;
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:()=>running=child(),authTimeoutMs:20,idleTimeoutMs:1000});
  await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),{code:"STEAM_AUTH_TIMEOUT"});assert.equal(running.killed,true);assert.equal(downloader.active,null);
});
test("helper download is pinned and rejected before extraction on an altered ZIP",async t=>{
  const w=await workspace(t),f=fixture();let spawned=0;
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,fetch:async(url,options)=>{assert.equal(url,HELPER.url);assert.equal(options.allowURL(new URL("https://example.org/private")),false);return {bytes:Buffer.from("wrong zip")};},spawn:()=>{spawned++;throw Error("must not start");}});
  await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),{code:"HELPER_INTEGRITY"});assert.equal(spawned,0);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);
});
test("manifest changes while downloading invalidate the staged repair result",async t=>{
  const w=await workspace(t),f=fixture(),events=[];let calls=0;
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>++calls===1?f.manifest:{...f.manifest,SHA256:"e".repeat(64)},helperProvider:async()=>"fixture",spawn:successSpawn(f,events)});
  await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),{code:"RESOURCE_MANIFEST_CHANGED"});assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);
});
test("cache inside game and linked cache are rejected before any game directory is created",async t=>{
  const w=await workspace(t),f=fixture();
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:path.join(w.game,"cache"),manifestProvider:async()=>f.manifest,helperProvider:async()=>{throw Error("must not start");}});
  await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),{code:"CACHE_PATH"});assert.deepEqual(await fs.readdir(w.game),[]);
  const target=path.join(w.directory,"elsewhere");await fs.mkdir(target);await fs.symlink(target,w.base,process.platform==="win32"?"junction":"dir");
  const linked=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest});await assert.rejects(()=>linked.download({root:w.game,files:[f.name]}),/link/);assert.deepEqual(await fs.readdir(target),[]);
});
test("insufficient cache space is detected before the helper or login starts",async t=>{
  const w=await workspace(t),f=fixture();let called=false;
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,diskSpace:async()=>({bsize:1n,bavail:1n}),helperProvider:async()=>{called=true;throw Error();}});
  await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),{code:"DISK_SPACE"});assert.equal(called,false);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);
});
test("Windows known-folder redirection outside the job prevents helper login",async t=>{
  const w=await workspace(t),f=fixture();let called=false;
  const downloader=new SteamResourceDownload({baseDir:w.base,manifestProvider:async()=>f.manifest,probeProfile:async()=>({local:w.game,roaming:w.game}),helperProvider:async()=>{called=true;throw Error();}});
  await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),{code:"PROFILE_ISOLATION"});assert.equal(called,false);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);assert.deepEqual(await fs.readdir(w.game),[]);
});
test("Windows profile probe reports private known folders with the isolated helper environment",{skip:process.platform!=="win32"},async t=>{
  const w=await workspace(t),profile=path.join(w.base,"profile"),local=path.join(profile,"AppData","Local"),roaming=path.join(profile,"AppData","Roaming");await fs.mkdir(local,{recursive:true});await fs.mkdir(roaming,{recursive:true});
  const result=await profileProbe({env:{...process.env,USERPROFILE:profile,LOCALAPPDATA:local,APPDATA:roaming},cwd:w.directory});assert.equal(result.local.toLowerCase(),local.toLowerCase());assert.equal(result.roaming.toLowerCase(),roaming.toLowerCase());
});
test("missing or unconfirmed helper file list stops the job before QR authentication",async t=>{
  const w=await workspace(t),f=fixture();let running;
  const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:()=>{running=child();setImmediate(()=>running.stdout.write("Warning: Unable to load filelist: private-path\nLogging in with QR code...\n"));return running;}});
  await assert.rejects(()=>downloader.download({root:w.game,files:[f.name]}),{code:"RESOURCE_SELECTION_FAILED"});assert.equal(running.killed,true);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);
  const parser=new DepotOutput(()=>{},{fileList:"required-list.txt"});assert.throws(()=>parser.write("Using filelist: 'another-list.txt'.\nLogging in with QR code...\n"),{code:"RESOURCE_SELECTION_FAILED"});
});

function stagedFixture(){
 const index="vpk/englishclient_mp_common.bsp.pak000_dir.vpk",archive="vpk/client_mp_common.bsp.pak000_001.vpk",other="vpk/client_mp_common.bsp.pak000_002.vpk";
 const bytes=new Map([[index,Buffer.from("authenticated stock index")],[archive,Buffer.from("required original archive")],[other,Buffer.from("unrelated archive")]]);
 const files=new Map([...bytes].map(([name,data])=>[name,{size:data.length,chunks:[{offset:0,length:data.length,SHA1:crypto.createHash("sha1").update(data).digest("hex")}]}]));
 return {index,archive,other,bytes,manifest:{depot:"1237971",manifest:"2801113779391264796",SHA256:"b".repeat(64),files}};
}
function stagedSpawn(f,events,{secondFailure=false,corruptInitialOnSecond=false}={}){
 return(exe,args,options)=>{
  const number=events.length+1,value=child();events.push({exe,args,options,number});
  setImmediate(async()=>{try{
   const list=args[args.indexOf("-filelist")+1],names=(await fs.readFile(list,"utf8")).trim().split("\n"),destination=args[args.indexOf("-dir")+1];
   if(number===2)assert.equal(await fs.readFile(path.join(options.cwd,"account.config"),"utf8"),"EPHEMERAL-FIXTURE");
   await fs.writeFile(path.join(options.cwd,"account.config"),"EPHEMERAL-FIXTURE");await fs.mkdir(path.join(destination,".DepotDownloader"),{recursive:true});
   value.stdout.write(`Using filelist: '${list}'.\nLogging in with QR code...\nUse the Steam Mobile App to sign in with this QR code:\n  ██ ▀▄  \n\n`);
   if(number===2&&secondFailure){value.stderr.write("PRIVATE LOGIN DETAIL\n");value.emit("close",1);return;}
   value.stdout.write("Got 2 licenses for account!\n");
   for(const name of names){const file=path.join(destination,...name.split("/"));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,f.bytes.get(name));}
   if(number===2&&corruptInitialOnSecond)await fs.writeFile(path.join(destination,...f.index.split("/")),Buffer.alloc(f.bytes.get(f.index).length));
   value.emit("close",0);
  }catch(error){value.emit("error",error);}});return value;
 };
}
test("staged download authenticates each exact pass in one private job and clears the session once",async t=>{
 const w=await workspace(t),f=stagedFixture(),events=[],progress=[];let resolutions=0,clears=0;
 const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:stagedSpawn(f,events),progress:value=>progress.push(value)});
 const originalClear=downloader.clearSession.bind(downloader);downloader.clearSession=async(...args)=>{clears++;return originalClear(...args);};
 const result=await downloader.download({root:w.game,files:[f.index],additionalFiles:[f.archive,f.other],manifest:f.manifest,resolveAdditionalFiles:async source=>{resolutions++;assert.deepEqual(await fs.readFile(path.join(source,...f.index.split("/"))),f.bytes.get(f.index));return [f.archive];}});
 assert.equal(events.length,2);assert.equal(resolutions,1);assert.equal(clears,1);assert.equal(events[0].options.cwd,events[1].options.cwd);assert.equal(events[0].options.env.USERPROFILE,events[1].options.env.USERPROFILE);assert.equal(events[0].args[events[0].args.indexOf("-loginid")+1],events[1].args[events[1].args.indexOf("-loginid")+1]);assert.equal(events[0].args[events[0].args.indexOf("-dir")+1],events[1].args[events[1].args.indexOf("-dir")+1]);
 assert.equal(await fs.readFile(events[0].args[events[0].args.indexOf("-filelist")+1],"utf8"),f.index+"\n");assert.equal(await fs.readFile(events[1].args[events[1].args.indexOf("-filelist")+1],"utf8"),f.archive+"\n");
 assert.deepEqual(result.files.map(file=>file.path),[f.index,f.archive]);assert.equal(result.totalBytes,f.bytes.get(f.index).length+f.bytes.get(f.archive).length);await assert.rejects(()=>fs.stat(path.join(result.sourceDir,...f.other.split("/"))),{code:"ENOENT"});
 assert.ok(progress.some(value=>value.phase==="stage-plan"&&value.stage===2));assert.ok(progress.filter(value=>value.phase==="auth"&&value.qrLines?.length).length>=2);assert.ok(!JSON.stringify(progress).includes("PRIVATE LOGIN"));await assert.rejects(()=>fs.stat(events[0].options.env.USERPROFILE),{code:"ENOENT"});await assert.rejects(()=>fs.stat(path.join(events[0].options.cwd,"account.config")),{code:"ENOENT"});assert.deepEqual(await fs.readdir(w.game),[]);
});
test("staged second-pass sign-in failure does not publish a partial source and cleans private state",async t=>{
 const w=await workspace(t),f=stagedFixture(),events=[],downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:stagedSpawn(f,events,{secondFailure:true})});
 await assert.rejects(()=>downloader.download({root:w.game,files:[f.index],additionalFiles:[f.archive],resolveAdditionalFiles:async()=>[f.archive]}),error=>error.code==="STEAM_AUTH_FAILED"&&!error.message.includes("PRIVATE"));assert.equal(events.length,2);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);assert.equal(downloader.active,null);assert.deepEqual(await fs.readdir(w.game),[]);
});
test("cancel during staged index resolution prevents second sign-in and deletes the private source",async t=>{
 const w=await workspace(t),f=stagedFixture(),events=[];let release,started;const ready=new Promise(r=>started=r);
 const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:stagedSpawn(f,events)});
 const operation=downloader.download({root:w.game,files:[f.index],additionalFiles:[f.archive],resolveAdditionalFiles:()=>{started();return new Promise(r=>release=r);}});await ready;assert.equal(downloader.cancel(),true);release([f.archive]);await assert.rejects(()=>operation,{code:"CANCELLED"});assert.equal(events.length,1);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);assert.equal(downloader.active,null);
});
test("staged resolver cannot add an unconfirmed resource even when it exists in the same manifest",async t=>{
 const w=await workspace(t),f=stagedFixture(),events=[],downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:stagedSpawn(f,events)});
 await assert.rejects(()=>downloader.download({root:w.game,files:[f.index],additionalFiles:[f.archive],resolveAdditionalFiles:async()=>[f.other]}),{code:"RESOURCE_SELECTION"});assert.equal(events.length,1);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);
});
test("staged space reservation includes the declared maximum before any helper authentication",async t=>{
 const w=await workspace(t),f=stagedFixture();let helpers=0;
 const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,diskSpace:async()=>({bsize:1n,bavail:512n*1024n*1024n+BigInt(f.bytes.get(f.index).length)*2n}),helperProvider:async()=>{helpers++;throw Error("must not login");}});
 await assert.rejects(()=>downloader.download({root:w.game,files:[f.index],additionalFiles:[f.archive],resolveAdditionalFiles:async()=>[f.archive]}),{code:"DISK_SPACE"});assert.equal(helpers,0);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);
});
test("a second pass cannot change the verified first-stage index unnoticed",async t=>{
 const w=await workspace(t),f=stagedFixture(),events=[],downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:stagedSpawn(f,events,{corruptInitialOnSecond:true})});
 await assert.rejects(()=>downloader.download({root:w.game,files:[f.index],additionalFiles:[f.archive],resolveAdditionalFiles:async()=>[f.archive]}),/Steam/);assert.equal(events.length,2);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);
});
test("staged discovery with healthy archives performs only the small index pass",async t=>{
 const w=await workspace(t),f=stagedFixture(),events=[],downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:stagedSpawn(f,events)});
 const result=await downloader.download({root:w.game,files:[f.index],additionalFiles:[f.archive,f.other],resolveAdditionalFiles:async()=>[]});assert.equal(events.length,1);assert.deepEqual(result.files.map(file=>file.path),[f.index]);
});
test("cancel during second-pass sign-in kills only that helper and deletes both partial resources",async t=>{
 const w=await workspace(t),f=stagedFixture(),events=[];let second,started;const ready=new Promise(r=>started=r),firstSpawn=stagedSpawn(f,events);
 const downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:(exe,args,options)=>{if(events.length===0)return firstSpawn(exe,args,options);events.push({exe,args,options});second=child();second.stdout.write(`Using filelist: '${args[args.indexOf("-filelist")+1]}'.\nLogging in with QR code...\n`);started();return second;}});
 const operation=downloader.download({root:w.game,files:[f.index],additionalFiles:[f.archive],resolveAdditionalFiles:async()=>[f.archive]});await ready;assert.equal(downloader.cancel(),true);await assert.rejects(()=>operation,{code:"CANCELLED"});assert.equal(second.killed,true);assert.equal(events.length,2);assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);assert.deepEqual(await fs.readdir(w.game),[]);
});
test("cancel arriving during private-session cleanup cannot publish a repair source",async t=>{
 const w=await workspace(t),f=stagedFixture(),events=[],downloader=new SteamResourceDownload({...fixtureOptions,baseDir:w.base,manifestProvider:async()=>f.manifest,helperProvider:async()=>"fixture",spawn:stagedSpawn(f,events)});
 const clear=downloader.clearSession.bind(downloader);downloader.clearSession=async(...args)=>{await clear(...args);downloader.cancel();};
 await assert.rejects(()=>downloader.download({root:w.game,files:[f.index]}),{code:"CANCELLED"});assert.deepEqual(await fs.readdir(path.join(w.base,"downloads")),[]);assert.equal(downloader.active,null);
});
