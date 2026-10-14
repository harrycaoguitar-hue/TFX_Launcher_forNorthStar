"use strict";
// Steam ownership/authentication stays in the optional community helper. This
// adapter selects exact resources in an isolated directory; it never asks Steam
// to validate or change the installed game, and never receives account secrets.
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto"),cp=require("child_process"),{StringDecoder}=require("string_decoder");
const {requestBuffer}=require("./http-resource"),{findManifest}=require("./dds-originals");
const {verifyComplete}=require("./dds-resource-recovery"),{assertUnlinkedAncestors}=require("./backup-records");
const HELPER=Object.freeze({version:"3.4.0",url:"https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_3.4.0/DepotDownloader-windows-x64.zip",zipBytes:33474005,zipSHA256:"41c9e9f0df54b3ad02e67a11726756e5c73283bd7c2e1b04acfa5ae4c2ed3767",exeSHA256:"6281279efce8f1e20db9532a58e42382f81afb9e3827a8b965ffcb43fbe4531f"});
const unsafe="Steam resource cache contains a link or unexpected file";
const failure=(code,message)=>Object.assign(Error(message),{code});
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const resourcePath=value=>typeof value==="string"&&(/^r2\/paks\/win64\/pc_stream(?:\(0[3567]\))?\.starpak$/.test(value)||/^vpk\/(?:englishclient_mp_common\.bsp\.pak000_dir|client_mp_common\.bsp\.pak000_\d{3})\.vpk$/.test(value));
function normalizedFiles(files){
  if(!Array.isArray(files)||!files.length||files.length>20)throw failure("RESOURCE_SELECTION","Select between one and twenty skin resources");
  const result=[...new Set(files.map(value=>typeof value==="string"?value.replace(/\\/g,"/").toLowerCase():value))];
  if(!result.every(resourcePath))throw failure("RESOURCE_SELECTION","Only known Titanfall 2 skin resources may be downloaded");
  return result;
}
function profileEnvironment(directory){const profile=path.join(directory,"profile"),local=path.join(profile,"AppData","Local"),roaming=path.join(profile,"AppData","Roaming");return {...process.env,HOME:profile,USERPROFILE:profile,APPDATA:roaming,LOCALAPPDATA:local,HOMEDRIVE:path.parse(profile).root.replace(/\\$/,""),HOMEPATH:profile.slice(path.parse(profile).root.length-1),TEMP:path.join(directory,"temp"),TMP:path.join(directory,"temp"),DOTNET_BUNDLE_EXTRACT_BASE_DIR:path.join(directory,"temp","bundle")};}
async function profileProbe({env,cwd,signal}){
  if(process.platform!=="win32")throw failure("HELPER_PLATFORM","Selective Steam downloads currently require Windows");
  // On Windows a custom known-folder registry path can override environment
  // values. Ask the OS with the same isolated environment before any login.
  const script='[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); @{local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData);roaming=[Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)} | ConvertTo-Json -Compress';
  const exe=path.join(process.env.SystemRoot||"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
  return new Promise((resolve,reject)=>cp.execFile(exe,["-NoProfile","-NonInteractive","-Command",script],{env,cwd,signal,windowsHide:true,timeout:20000,maxBuffer:16384,encoding:"utf8"},(error,stdout)=>{if(error)return reject(failure(signal?.aborted?"CANCELLED":"PROFILE_ISOLATION",signal?.aborted?"Resource download cancelled":"The isolated Steam sign-in profile could not be checked"));try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,"")));}catch{reject(failure("PROFILE_ISOLATION","The isolated Steam sign-in profile could not be checked"));}}));
}
async function safeDirectory(directory){
  try{await assertUnlinkedAncestors(directory,unsafe);if(!(await fsp.lstat(directory)).isDirectory())throw Error(unsafe);}
  catch(error){if(error.code!=="ENOENT")throw error;const parent=path.dirname(directory);if(parent===directory)throw error;await safeDirectory(parent);try{await fsp.mkdir(directory);}catch(e){if(e.code!=="EEXIST")throw e;}await assertUnlinkedAncestors(directory,unsafe);if(!(await fsp.lstat(directory)).isDirectory())throw Error(unsafe);}
}
async function ordinary(file){await assertUnlinkedAncestors(file,unsafe);const stat=await fsp.lstat(file);if(!stat.isFile()||stat.nlink!==1)throw Error(unsafe);return stat;}
async function hashFile(file){await ordinary(file);const digest=crypto.createHash("sha256");for await(const bytes of fs.createReadStream(file))digest.update(bytes);await ordinary(file);return digest.digest("hex");}
// Only our fresh child directory may be removed. Check every descendant before
// the first deletion so a replacement junction cannot lead into user data.
async function removeOwned(directory,boundary){
  if(path.dirname(path.resolve(directory))!==path.resolve(boundary))throw Error(unsafe);
  await assertUnlinkedAncestors(boundary,unsafe);let entries=[];
  async function collect(file){const stat=await fsp.lstat(file);if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw Error(unsafe);if(stat.isDirectory())for(const name of await fsp.readdir(file))await collect(path.join(file,name));entries.push({file,stat});}
  try{await collect(directory);}catch(e){if(e.code==="ENOENT")return;throw e;}
  for(const {file,stat} of entries){await assertUnlinkedAncestors(file,unsafe);const now=await fsp.lstat(file);if(now.dev!==stat.dev||now.ino!==stat.ino)throw Error(unsafe);if(now.isDirectory())await fsp.rmdir(file);else await fsp.unlink(file);}
}
class DepotOutput {
  constructor(emit=()=>{},{fileList}={}){this.emit=emit;this.pending="";this.rows=null;this.lastPercent=-1;this.decoder=new StringDecoder("utf8");this.fileList=fileList;this.selectionConfirmed=!fileList;}
  write(text){this.pending+=(Buffer.isBuffer(text)?this.decoder.write(text):String(text)).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,"");if(this.pending.length>128*1024)throw failure("HELPER_OUTPUT","Download helper produced an invalid output line");let index;while((index=this.pending.indexOf("\n"))!==-1){const line=this.pending.slice(0,index).replace(/\r$/,"" );this.pending=this.pending.slice(index+1);this.line(line);}if(this.rows?.some(line=>/[\u2580-\u259f]/.test(line)))this.emit({phase:"auth",qrLines:[...this.rows]});}
  line(line){
    if(this.fileList&&line===`Using filelist: '${this.fileList}'.`){this.selectionConfirmed=true;return;}
    if(this.fileList&&(/Unable to load filelist/.test(line)||!this.selectionConfirmed&&/Logging in with QR code|Use the Steam Mobile App|\d+\.\d+%|Got \d+ licenses/.test(line)))throw failure("RESOURCE_SELECTION_FAILED","The Steam helper did not confirm the exact resource file list");
    if(line.includes("Use the Steam Mobile App to sign in with this QR code:")){this.flush();this.rows=[];this.emit({phase:"auth",qrLines:[]});return;}
    if(this.rows){if(/^[ \u2580-\u259f]*$/.test(line)&&line.length<=512){if(this.rows.length<256)this.rows.push(line);return;}this.flush();}
    const percent=/^\s*(\d{1,3}\.\d{1,2})%\s+/.exec(line);if(percent){const value=Number(percent[1]);if(value>=0&&value<=100&&value!==this.lastPercent){this.lastPercent=value;this.emit({phase:"download",percent:value});}return;}
    if(/Got \d+ licenses for account!|Got depot key for \d+ result: OK/.test(line))this.emit({phase:"authenticated"});
  }
  flush(){if(this.rows){const qrLines=this.rows;this.rows=null;if(qrLines.some(line=>/[\u2580-\u259f]/.test(line)))this.emit({phase:"auth",qrLines});}}
  end(){this.pending+=this.decoder.end();if(this.pending)this.line(this.pending);this.pending="";this.flush();}
}
class SteamResourceDownload {
  constructor({baseDir,toolsDir=path.join(__dirname,"../tools/vtf").replace(/app\.asar([\\/])/,"app.asar.unpacked$1"),progress=()=>{},manifestProvider=findManifest,verify=verifyComplete,spawn=cp.spawn,fetch=requestBuffer,helperProvider,probeProfile=profileProbe,diskSpace=directory=>fsp.statfs(directory,{bigint:true}),authTimeoutMs=10*60*1000,idleTimeoutMs=20*60*1000,totalTimeoutMs=6*60*60*1000}={}){
    if(!baseDir||!path.isAbsolute(baseDir))throw failure("CACHE_PATH","An absolute resource cache directory is required");
    Object.assign(this,{baseDir:path.resolve(baseDir),toolsDir,progress,manifestProvider,verify,spawn,fetch,helperProvider,probeProfile,diskSpace,authTimeoutMs,idleTimeoutMs,totalTimeoutMs});this.active=null;
  }
  async selection({root,files,manifest}={}){
    if(typeof root!=="string"||!path.isAbsolute(root))throw failure("GAME_PATH","Select the installed Titanfall 2 directory first");
    const wanted=normalizedFiles(files),current=await this.manifestProvider(root,{include:resourcePath});
    if(!current||!/^\d{1,10}$/.test(String(current.depot))||String(current.depot)!=="1237971"||!/^\d{1,20}$/.test(String(current.manifest))||!/^[a-f0-9]{64}$/.test(current.SHA256)||!(current.files instanceof Map))throw failure("RESOURCE_MANIFEST","The installed Steam resource manifest is unavailable");
    if(manifest&&(manifest.SHA256!==current.SHA256||String(manifest.depot)!==String(current.depot)||String(manifest.manifest)!==String(current.manifest)))throw failure("RESOURCE_MANIFEST_CHANGED","The installed Steam manifest changed; refresh the repair plan");
    const selected=wanted.map(file=>{const info=current.files.get(file);if(!info||!Number.isSafeInteger(info.size)||info.size<=0||!Array.isArray(info.chunks)||!info.chunks.length)throw failure("RESOURCE_MANIFEST","The Steam manifest does not contain every selected resource");let covered=0;for(const c of info.chunks){if(c.offset!==covered||!Number.isSafeInteger(c.length)||c.length<=0||c.length>4*1024*1024||!/^[a-f0-9]{40}$/.test(c.SHA1))throw failure("RESOURCE_MANIFEST","The Steam resource chunks are incomplete");covered+=c.length;}if(covered!==info.size)throw failure("RESOURCE_MANIFEST","The Steam resource chunks are incomplete");return {path:file,size:info.size,info};});
    const totalBytes=selected.reduce((sum,file)=>sum+file.size,0);if(!Number.isSafeInteger(totalBytes))throw failure("RESOURCE_MANIFEST","The selected resource size is invalid");
    return {appId:"1237970",depot:String(current.depot),manifest:String(current.manifest),manifestSHA256:current.SHA256,files:selected,totalBytes};
  }
  async bounds(input,selection){
    if(typeof input.resolveAdditionalFiles!=="function")return selection;
    if(!Array.isArray(input.additionalFiles))throw failure("RESOURCE_SELECTION","A staged repair must declare its additional resource budget");
    return this.selection({...input,files:[...new Set([...selection.files.map(file=>file.path),...input.additionalFiles])]});
  }
  async plan(input){const result=await this.selection(input);await this.bounds(input,result);return {...result,files:result.files.map(({path,size})=>({path,size})),requiredCacheBytes:result.totalBytes*2+512*1024*1024,helperVersion:HELPER.version,helperDownloadBytes:HELPER.zipBytes};}
  emit(value){try{this.progress(value);}catch{}}
  cancel(){const active=this.active;if(!active)return false;active.controller.abort();if(active.child&&!active.child.killed)active.child.kill();return true;}
  async helper(active){
    if(this.helperProvider)return this.helperProvider({signal:active.controller.signal});
    const helpers=path.join(this.baseDir,"helpers"),directory=path.join(helpers,"DepotDownloader-"+HELPER.version),exe=path.join(directory,"DepotDownloader.exe");
    await safeDirectory(helpers);
    try{if(await hashFile(exe)===HELPER.exeSHA256)return exe;throw failure("HELPER_INTEGRITY","The cached Steam helper was modified; remove its cache and retry");}catch(e){if(e.code!=="ENOENT")throw e;}
    this.emit({phase:"helper",bytes:HELPER.zipBytes});
    let response;try{response=await this.fetch(HELPER.url,{timeoutMs:180000,maxBytes:40*1024*1024,signal:active.controller.signal,allowURL:url=>["github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"].includes(url.hostname)});}catch{throw failure(active.controller.signal.aborted?"CANCELLED":"HELPER_DOWNLOAD",active.controller.signal.aborted?"Resource download cancelled":"The DepotDownloader helper could not be downloaded. Check your network and try again.");}
    if(active.controller.signal.aborted)throw failure("CANCELLED","Resource download cancelled");
    if(response.bytes.length!==HELPER.zipBytes||hash(response.bytes)!==HELPER.zipSHA256)throw failure("HELPER_INTEGRITY","The DepotDownloader helper did not match its pinned checksum");
    const temporary=await fsp.mkdtemp(path.join(helpers,"install-"));
    try{
      const zip=path.join(temporary,"helper.zip"),unpacked=path.join(temporary,"unpacked");await fsp.writeFile(zip,response.bytes,{flag:"wx"});await safeDirectory(unpacked);
      // The exact ZIP hash above authenticates its two entries. Select the two
      // expected names explicitly; no arbitrary archive paths are extracted.
      await this.process(path.join(this.toolsDir,"7z.exe"),["x",zip,"DepotDownloader.exe","LICENSE","-o"+unpacked,"-y"],{cwd:temporary,active,timeoutMs:120000});
      if(await hashFile(path.join(unpacked,"DepotDownloader.exe"))!==HELPER.exeSHA256)throw failure("HELPER_INTEGRITY","The extracted Steam helper did not match its pinned checksum");
      await ordinary(path.join(unpacked,"LICENSE"));await assertUnlinkedAncestors(helpers,unsafe);
      try{await fsp.rename(unpacked,directory);}catch(e){if(!["EEXIST","ENOTEMPTY","EPERM"].includes(e.code)||await hashFile(exe)!==HELPER.exeSHA256)throw e;}
      return exe;
    }finally{await removeOwned(temporary,helpers);}
  }
  process(exe,args,{cwd,active,timeoutMs=this.totalTimeoutMs,output=false}={}){
    return new Promise((resolve,reject)=>{
      let child,finished=false,authenticated=false,closeTimer;const signal=active.controller.signal;
      const parser=new DepotOutput(value=>{if(value.phase==="authenticated"){authenticated=true;clearTimeout(authTimer);}this.emit(value);},{fileList:output?args[args.indexOf("-filelist")+1]:undefined});
      const finish=error=>{if(finished)return;finished=true;clearTimeout(totalTimer);clearTimeout(idleTimer);clearTimeout(authTimer);clearTimeout(closeTimer);signal.removeEventListener("abort",abort);if(active.child===child)active.child=null;if(error)reject(error);else resolve();};
      const stop=error=>{if(finished)return;active.failure=error;if(child&&!child.killed)child.kill();closeTimer=setTimeout(()=>finish(error),5000);closeTimer.unref?.();};
      const abort=()=>stop(failure("CANCELLED","Resource download cancelled"));
      let idleTimer,totalTimer=setTimeout(()=>stop(failure("DOWNLOAD_TIMEOUT","The resource download exceeded its time limit")),timeoutMs),authTimer=output?setTimeout(()=>stop(failure("STEAM_AUTH_TIMEOUT","Steam QR sign-in timed out; try again")),this.authTimeoutMs):null;
      const touch=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>stop(failure("DOWNLOAD_IDLE","The Steam download stopped responding; try again")),this.idleTimeoutMs);};
      if(signal.aborted){finish(failure("CANCELLED","Resource download cancelled"));return;}signal.addEventListener("abort",abort,{once:true});
      try{child=this.spawn(exe,args,{cwd,windowsHide:true,shell:false,stdio:["ignore","pipe","pipe"],env:profileEnvironment(cwd)});active.child=child;touch();}
      catch{finish(failure("HELPER_START","The Steam download helper could not start"));return;}
      const consume=bytes=>{touch();if(output)try{parser.write(bytes);}catch(error){stop(error);}};
      child.stdout?.on("data",consume);child.stderr?.on("data",()=>touch());
      child.once("error",()=>finish(failure("HELPER_START","The Steam download helper could not start")));
      child.once("close",code=>{if(output)try{parser.end();}catch(error){return finish(error);}if(active.failure)return finish(active.failure);if(code!==0){if(!output)return finish(failure("HELPER_EXTRACTION","The DepotDownloader helper could not be extracted. Check the cache folder and try again."));return finish(failure(authenticated?"STEAM_DOWNLOAD_FAILED":"STEAM_AUTH_FAILED",authenticated?"Steam could not download the selected resources. Check ownership, connection and free disk space.":"Steam sign-in was not completed. Use the Steam mobile app and an account that owns Titanfall 2."));}if(output&&!parser.selectionConfirmed)return finish(failure("RESOURCE_SELECTION_FAILED","The Steam helper did not confirm the exact resource file list"));finish();});
    });
  }
  async download(input){
    if(this.active)throw failure("DOWNLOAD_BUSY","A resource download is already running");
    const active={controller:new AbortController(),child:null,failure:null};this.active=active;let job,success=false;
    const jobs=path.join(this.baseDir,"downloads");
    try{
      const selection=await this.selection(input),bounds=await this.bounds(input,selection);
      const game=path.resolve(input.root),cache=path.resolve(jobs);if(cache.toLowerCase()===game.toLowerCase()||cache.toLowerCase().startsWith(game.toLowerCase()+path.sep))throw failure("CACHE_PATH","Resource downloads must be stored outside the installed game");
      await safeDirectory(jobs);
      let space;try{space=await this.diskSpace(jobs);}catch{throw failure("DISK_SPACE","Free space in the resource cache could not be checked");}
      // DepotDownloader may keep a staging copy while publishing each resource.
      // Reserve both copies and helper/runtime headroom, without touching Steam.
      const required=BigInt(bounds.totalBytes)*2n+512n*1024n*1024n;
      if(!space||BigInt(space.bavail)*BigInt(space.bsize)<required)throw failure("DISK_SPACE","There is not enough free space for the selected resources and their temporary download copies");
      job=await fsp.mkdtemp(path.join(jobs,"resources-"));const payload=path.join(job,"payload");await safeDirectory(payload);await safeDirectory(path.join(job,"temp"));
      const env=profileEnvironment(job);await safeDirectory(env.LOCALAPPDATA);await safeDirectory(env.APPDATA);
      const known=await this.probeProfile({env,cwd:job,signal:active.controller.signal});
      if(!known||path.resolve(known.local||"").toLowerCase()!==path.resolve(env.LOCALAPPDATA).toLowerCase()||path.resolve(known.roaming||"").toLowerCase()!==path.resolve(env.APPDATA).toLowerCase())throw failure("PROFILE_ISOLATION","Windows redirected the isolated Steam sign-in profile; the download was stopped before login");
      const exe=await this.helper(active);if(active.controller.signal.aborted)throw failure("CANCELLED","Resource download cancelled");
      const loginId=String(crypto.randomInt(1,0xffffffff)),allFiles=new Map(selection.files.map(file=>[file.path,file]));
      const runStage=async(stageSelection,stage)=>{
        if(active.controller.signal.aborted)throw failure("CANCELLED","Resource download cancelled");
        const list=path.join(job,stage===1?"selected-files.txt":"additional-files.txt");await fsp.writeFile(list,stageSelection.files.map(file=>file.path).join("\n")+"\n",{flag:"wx",encoding:"utf8"});
        this.emit({phase:"auth",qrLines:[],totalBytes:stageSelection.totalBytes,stage,stages:typeof input.resolveAdditionalFiles==="function"?2:1});
        // Both exact file lists use one private profile and one payload source.
        // The helper may request QR confirmation again; no credentials are
        // retained outside this job and no persistent-login flag is enabled.
        await this.process(exe,["-app",stageSelection.appId,"-depot",stageSelection.depot,"-manifest",stageSelection.manifest,"-dir",payload,"-filelist",list,"-qr","-loginid",loginId,"-max-downloads","4"],{cwd:job,active,output:true});
        for(let index=0;index<stageSelection.files.length;index++){
          if(active.controller.signal.aborted)throw failure("CANCELLED","Resource download cancelled");
          const file=stageSelection.files[index];this.emit({phase:"verify",file:file.path,index:index+1,count:stageSelection.files.length,stage});await this.verify(path.join(payload,...file.path.split("/")),file.info,{signal:active.controller.signal});
        }
        await this.selection({...input,files:stageSelection.files.map(file=>file.path),manifest:{SHA256:selection.manifestSHA256,depot:selection.depot,manifest:selection.manifest}});
      };
      await runStage(selection,1);
      if(typeof input.resolveAdditionalFiles==="function"){
        if(active.controller.signal.aborted)throw failure("CANCELLED","Resource download cancelled");
        const names=await input.resolveAdditionalFiles(payload);
        if(active.controller.signal.aborted)throw failure("CANCELLED","Resource download cancelled");
        if(!Array.isArray(names))throw failure("RESOURCE_SELECTION","The additional repair resources are invalid");
        const wanted=names.length?normalizedFiles(names):[],allowed=new Set(bounds.files.map(file=>file.path));
        if(wanted.some(name=>!allowed.has(name)))throw failure("RESOURCE_SELECTION","The additional resource selection exceeded the confirmed repair budget");
        const pending=wanted.filter(name=>!allFiles.has(name));
        if(pending.length){
          const additional=await this.selection({...input,files:pending,manifest:{SHA256:selection.manifestSHA256,depot:selection.depot,manifest:selection.manifest}});
          this.emit({phase:"stage-plan",stage:2,files:additional.files.map(({path,size})=>({path,size})),totalBytes:additional.totalBytes,maximumBytes:bounds.totalBytes});
          await runStage(additional,2);for(const file of additional.files)allFiles.set(file.path,file);
          // A later helper pass must not alter the already authenticated index.
          for(const file of selection.files)await this.verify(path.join(payload,...file.path.split("/")),file.info,{signal:active.controller.signal});
        }
      }
      // Reject an installed-manifest change before offering this source to a
      // repair engine. The engine will verify the source again when applying it.
      await this.selection({...input,manifest:{SHA256:selection.manifestSHA256,depot:selection.depot,manifest:selection.manifest}});
      await this.clearSession(job,payload);
      if(active.controller.signal.aborted)throw failure("CANCELLED","Resource download cancelled");
      const selectedFiles=[...allFiles.values()],totalBytes=selectedFiles.reduce((sum,file)=>sum+file.size,0);
      const result={sourceDir:payload,files:selectedFiles.map(({path,size})=>({path,size})),totalBytes,jobId:path.basename(job),manifestSHA256:selection.manifestSHA256};
      await fsp.writeFile(path.join(job,"resource-source.json"),JSON.stringify({...result,helperVersion:HELPER.version},null,2),{flag:"wx"});
      if(active.controller.signal.aborted)throw failure("CANCELLED","Resource download cancelled");
      success=true;this.emit({phase:"complete",totalBytes});return result;
    }finally{
      if(active.child&&!active.child.killed)active.child.kill();
      if(job&&!success)await removeOwned(job,jobs).catch(()=>{});
      this.active=null;
    }
  }
  async clearSession(job,payload){
    const account=path.join(job,"account.config");try{await ordinary(account);await fsp.unlink(account);}catch(e){if(e.code!=="ENOENT")throw e;}
    await removeOwned(path.join(payload,".DepotDownloader"),payload);
    await removeOwned(path.join(job,"temp"),job);
    await removeOwned(path.join(job,"profile"),job);
  }
}
module.exports={SteamResourceDownload,DepotOutput,HELPER,resourcePath,normalizedFiles,profileProbe,profileEnvironment};
