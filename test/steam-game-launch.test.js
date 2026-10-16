"use strict";

const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), fsp = fs.promises, path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const {resolve} = require("../src/modules/steam-game-launch");
const APP_ID = "1237970";
const quote = value => '"' + value.replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"';
const manifestText = (install = "Titanfall2", id = APP_ID) => `"AppState" { "appid" ${quote(id)} "installdir" ${quote(install)} }`;
async function write(filename, bytes) {await fsp.mkdir(path.dirname(filename),{recursive:true}); await fsp.writeFile(filename,bytes);}
async function fixture(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(),"tfx-steam-game-"));
  t.after(() => fsp.rm(home,{recursive:true,force:true}));
  const root = path.join(home,"Steam"), game = path.join(root,"steamapps","common","Titanfall2"), manifest = path.join(root,"steamapps",`appmanifest_${APP_ID}.acf`), executable = path.join(root,"Steam.exe");
  await write(executable,"fixture Steam executable"); await write(path.join(game,"Titanfall2.exe"),"fixture game executable"); await write(manifest,manifestText());
  return {home,root,game,manifest,executable,options:{roots:[root]}};
}
async function secondary(f, {legacy = false, config = false} = {}) {
  const library = path.join(f.home,"Game Library"), game = path.join(library,"steamapps","common","Titanfall2"), manifest = path.join(library,"steamapps",`appmanifest_${APP_ID}.acf`);
  await write(path.join(game,"Titanfall2.exe"),"secondary game executable"); await write(manifest,manifestText());
  await write(path.join(f.root,config?"config":"steamapps","libraryfolders.vdf"),`"libraryfolders" { "0" { "path" ${quote(f.root)} } "1" ${legacy?quote(library):`{ "path" ${quote(library)} "apps" { "${APP_ID}" "100" } }`} }`);
  return {library,game,manifest};
}

test("an exact primary-library manifest resolves Steam CLI without writing installation files", async t => {
  const f = await fixture(t), files = [f.manifest,f.executable,path.join(f.game,"Titanfall2.exe")];
  const hashes = await Promise.all(files.map(async name => crypto.createHash("sha256").update(await fsp.readFile(name)).digest("hex")));
  const result = await resolve(f.game,f.options);
  assert.deepEqual(result,{executable:f.executable,appId:APP_ID,argsPrefix:["-applaunch",APP_ID],gamepath:await fsp.realpath(f.game),library:f.root,manifest:f.manifest});
  assert.deepEqual(await Promise.all(files.map(async name => crypto.createHash("sha256").update(await fsp.readFile(name)).digest("hex"))),hashes);
});
test("modern secondary Steam libraries use their owning root's Steam executable", async t => {
  const f = await fixture(t), s = await secondary(f), result = await resolve(s.game,f.options);
  assert.equal(result.executable,f.executable); assert.equal(result.library,s.library); assert.equal(result.manifest,s.manifest);
});
test("legacy numeric library entries in config/libraryfolders.vdf remain supported", async t => {
  const f = await fixture(t), s = await secondary(f,{legacy:true,config:true});
  assert.equal((await resolve(s.game,f.options)).gamepath,await fsp.realpath(s.game));
});
test("a same-named directory without a matching manifest is never assumed to be Steam-owned", async t => {
  const f = await fixture(t); await fsp.unlink(f.manifest);
  assert.equal(await resolve(f.game,f.options),null);
  await write(f.manifest,manifestText("Other copy")); assert.equal(await resolve(f.game,f.options),null);
});
test("missing or incorrect app IDs do not authorize Steam dispatch", async t => {
  const f = await fixture(t);
  for (const source of [manifestText("Titanfall2","1237971"),'"AppState" { "installdir" "Titanfall2" }','"AppState" { "appid" "1237970 " "installdir" "Titanfall2" }']) {
    await write(f.manifest,source); assert.equal(await resolve(f.game,f.options),null,source);
  }
});
test("malformed, ambiguous and escaping manifest paths fail closed", async t => {
  const f = await fixture(t);
  for (const source of ['"AppState" {','"AppState" { "appid" "1237970" "APPID" "1237970" "installdir" "Titanfall2" }',...['','.',"..","../common/Titanfall2","nested/../Titanfall2","C:\\Titanfall2","\\\\host\\share\\Titanfall2","/Titanfall2","Titanfall2\0extra"].map(install => manifestText(install))]) {
    await write(f.manifest,source); assert.equal(await resolve(f.game,f.options),null,source);
  }
});
test("missing or directory-shaped Steam executables do not enable the Steam route", async t => {
  const f = await fixture(t); await fsp.unlink(f.executable);
  assert.equal(await resolve(f.game,f.options),null);
  await fsp.mkdir(f.executable); assert.equal(await resolve(f.game,f.options),null);
});
test("a selected copy without Titanfall2.exe cannot match an otherwise valid manifest", async t => {
  const f = await fixture(t); await fsp.unlink(path.join(f.game,"Titanfall2.exe"));
  assert.equal(await resolve(f.game,f.options),null);
});
test("an unrelated EA installation keeps its original executable route", async t => {
  const f = await fixture(t), other = path.join(f.home,"EA Games","Titanfall2"); await write(path.join(other,"Titanfall2.exe"),"EA game");
  assert.equal(await resolve(other,f.options),null);
});
test("canonical directory aliases match the exact installation", async t => {
  const f = await fixture(t), alias = path.join(f.home,"Game alias");
  await fsp.symlink(f.game,alias,process.platform==="win32"?"junction":"dir");
  assert.equal((await resolve(alias,f.options)).gamepath,await fsp.realpath(f.game));
});
test("full game executable selections and normalized directory paths resolve identically", async t => {
  const f = await fixture(t);
  assert.deepEqual(await resolve(path.join(f.game,"Titanfall2.exe"),f.options),await resolve(f.game+path.sep,f.options));
  if (process.platform==="win32") assert.deepEqual(await resolve(f.game.toUpperCase(),f.options),await resolve(f.game,f.options));
});
test("a secondary library's arbitrary Steam.exe is never substituted for the owning root", async t => {
  const f = await fixture(t), s = await secondary(f); await fsp.unlink(f.executable); await write(path.join(s.library,"Steam.exe"),"unregistered executable");
  assert.equal(await resolve(s.game,f.options),null);
});
test("registry injection supports read-only values and asynchronous discovery", async t => {
  const f = await fixture(t), registry = {steamPaths:[f.root],gamePaths:[f.game]};
  const expected = await resolve(f.game,f.options); let reads = 0;
  assert.deepEqual(await resolve(f.game,{registry}),expected);
  assert.deepEqual(await resolve(f.game,{registry:async () => {reads++;return registry;}}),expected); assert.equal(reads,1);
});
test("invalid inputs, missing roots and failed registry readers return no route", async t => {
  const f = await fixture(t);
  for (const input of [undefined,null,"relative/path","bad\0path",f.home]) assert.equal(await resolve(input,f.options),null);
  assert.equal(await resolve(f.game,{roots:[]}),null);
  assert.equal(await resolve(f.game,{roots:[null,"relative/path",path.join(f.home,"missing")]}),null);
  assert.equal(await resolve(f.game,{roots:[],registry:async () => {throw Error("registry unavailable");}}),null);
});
