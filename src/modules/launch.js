"use strict";
const path = require("path");
const fs = require("fs");
const {spawn, execFile} = require("child_process");
const {app, ipcMain} = require("electron");
const lang = require("../lang");
const settings = require("./settings");
const console = require("./console");
const protection = require("./dds-guard");
const win = require("../win");
const gate = require("./dds-operation-gate");
const running = require("./is_running");
const findgame = require("./findgame");
const {LaunchConfirmation, splitArguments, hasGame} = require("./launch-session");
const network = require("./northstar-region");
const clients = require("./northstar-clients");
const modState = require("./mod-enabled-state");
const modCompatibility = require("./mod-compatibility");
const {NorthstarReadiness} = require("./northstar-readiness");

let launching = false, latestDiagnostic = null, activeReadiness = null;
function send(channel, result) {try {const window = win(); if (!window.isDestroyed?.()) window.send(channel, result);} catch (error) {console.error(error.message || String(error));}}
function diagnose(record, change) {
  Object.assign(record, change, {updatedAt: new Date().toISOString()});
  if (latestDiagnostic !== record) return;
  try {
    const directory = app.getPath("userData"), filename = path.join(directory, "launch-diagnostics.json");
    fs.mkdirSync(directory, {recursive: true});
    const saved = {...record, root: record.root?.slice(0, 4096), args: record.args?.slice(0, 64).map(value => value.slice(0, 512)), error: record.error?.slice(0, 2000)};
    fs.writeFileSync(filename + ".tmp", JSON.stringify(saved, null, 2), "utf8");
    fs.renameSync(filename + ".tmp", filename);
  } catch (error) {console.warn("Launch diagnostics could not be saved:", error.message);}
}
const confirmation = new LaunchConfirmation({speedUp: until => running.speedUp(until), refresh: () => running.snapshot()});
running.onSnapshot(value => {probeReadiness(); confirmation.observe(value);});

function readTail(filename) {
  const fd = fs.openSync(filename, "r");
  try {
    const size = fs.fstatSync(fd).size, length = Math.min(size, 65536), bytes = Buffer.alloc(length);
    fs.readSync(fd, bytes, 0, length, Math.max(0, size - length));
    return bytes.toString("utf8");
  } finally {fs.closeSync(fd);}
}
function latestGameLog(profileDirectory) {
  const directory = path.join(profileDirectory, "logs");
  try {
    let latest = null;
    for (const name of fs.readdirSync(directory)) {
      if (!/^nslog[^/\\]*\.txt$/i.test(name)) continue;
      const filename = path.join(directory, name), stat = fs.statSync(filename);
      if (stat.isFile() && (!latest || stat.mtimeMs > latest.modified)) latest = {filename, modified: stat.mtimeMs, size: stat.size};
    }
    return latest;
  } catch (_) {return null;}
}
function probeReadiness() {
  const probe = activeReadiness;
  if (!probe || confirmation.current !== probe.session || probe.session.ready) return;
  try {
    if (/Launching the game/i.test(readTail(probe.startupLog))) {
      confirmation.entered(probe.session);
    }
    const next = latestGameLog(probe.profileDirectory), prior = probe.previousLog;
    if (!next || next.modified < probe.startedAt || (prior && next.filename === prior.filename && next.modified === prior.modified && next.size === prior.size)) return;
    if (probe.logFilename !== next.filename || next.size < probe.logOffset) {
      probe.logFilename = next.filename;
      probe.logOffset = prior && next.filename === prior.filename && next.size >= prior.size ? prior.size : 0;
      probe.runtime = new NorthstarReadiness();
    }
    const fd = fs.openSync(next.filename, "r");
    let state;
    try {
      const size = fs.fstatSync(fd).size, length = Math.min(Math.max(0, size - probe.logOffset), 1024 * 1024), bytes = Buffer.alloc(length);
      const consumed = fs.readSync(fd, bytes, 0, length, probe.logOffset);
      probe.logOffset += consumed; state = probe.runtime.consume(bytes.subarray(0, consumed));
    } finally {fs.closeSync(fd);}
    if (state?.error) {
      diagnose(probe.record, {gameStage: "northstar-core-disabled", runtimeCore: state.core});
      confirmation.fail(probe.session, state.error);
    } else if (state?.ready) {
      confirmation.ready(probe.session);
      diagnose(probe.record, {gameStage: "northstar-menu", runtimeCore: state.core, readyAt: new Date().toISOString()});
    }
  } catch (_) { /* A process can hold its log briefly; retry next snapshot. */ }
}
function createStartupLog() {
  const directory = app.getPath("userData");
  fs.mkdirSync(directory, {recursive: true});
  // Keep a small set of our own startup logs; do not alter game-generated logs.
  try {
    const entries = fs.readdirSync(directory).filter(name => /^vyra-startup-\d+-[a-f0-9]+\.log$/.test(name)).sort().reverse();
    for (const name of entries.slice(4)) fs.unlinkSync(path.join(directory, name));
  } catch (_) {}
  const filename = path.join(directory, "vyra-startup-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".log");
  return {filename, fd: fs.openSync(filename, "wx")};
}

function supportsQuietConsole(root, profileDirectory) {
  // Older community builds lack the official flag. Inspect capability rather
  // than assuming a release number or silently passing an unsupported switch.
  try {
    const preferred = path.join(profileDirectory, "Northstar.dll");
    const bytes = fs.readFileSync(fs.existsSync(preferred) ? preferred : path.join(root, "Northstar.dll"));
    return bytes.includes(Buffer.from("-noallocconsole")) || bytes.includes(Buffer.from("-noallocconsole", "utf16le"));
  } catch (_) {return false;}
}
function prepareLegacyConsole(record) {
  // Hide only the console HWND attached to this owned child PID. SW_HIDE on the
  // process startup itself can propagate to Titanfall's window in the same PID.
  // Compile before spawning the game so a late Add-Type compilation cannot
  // leave Northstar's console visible. The PID arrives over our private pipe.
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class VyraConsole { [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid); [DllImport("kernel32.dll")] public static extern bool FreeConsole(); [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command); }'; [Console]::Out.WriteLine('vyra-console-ready'); [Console]::Out.Flush(); $line=[Console]::In.ReadLine(); $gamePid=[uint32]0; if(![uint32]::TryParse($line,[ref]$gamePid) -or $gamePid -eq 0){exit}; [VyraConsole]::FreeConsole() | Out-Null; for($attempt=0;$attempt -lt 400;$attempt++){ if([VyraConsole]::AttachConsole($gamePid)){ try { $handle=[VyraConsole]::GetConsoleWindow(); if($handle -ne [IntPtr]::Zero){ [VyraConsole]::ShowWindow($handle,0) | Out-Null; Write-Output 'console-hidden'; break } } finally { [VyraConsole]::FreeConsole() | Out-Null } }; Start-Sleep -Milliseconds 10 }`;
  return new Promise(resolve => {
    let helper = null, timer = null, completed = false, bound = false, output = "";
    const cancel = () => {if (bound) return; bound = true; try {helper?.stdin?.end();} catch (_) {}};
    const finish = result => {if (completed) return; completed = true; clearTimeout(timer); resolve(result);};
    try {
      helper = execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {windowsHide: true, timeout: 10000, maxBuffer: 65536}, (error, stdout = "") => {
        diagnose(record, {consoleSuppression: error ? "helper-unavailable" : stdout.includes("console-hidden") ? "console-hidden" : "no-console", consoleError: error ? String(error.message || error).slice(0, 500) : null});
        finish(null);
      });
      helper.stdin?.on("error", () => {});
      helper.stdout?.on("data", data => {
        if (completed) return;
        output = (output + String(data)).slice(-1024);
        if (!output.includes("vyra-console-ready")) return;
        diagnose(record, {consoleSuppression: "helper-ready"});
        finish({cancel, bind(pid) {
          if (bound) return;
          if (!Number.isSafeInteger(pid) || pid <= 0) {cancel(); return;}
          bound = true;
          try {helper.stdin.end(String(pid) + "\n");} catch (_) {cancel();}
        }});
      });
      timer = setTimeout(() => {cancel(); diagnose(record, {consoleSuppression: "helper-prepare-timeout"}); finish(null);}, 6000);
      timer.unref?.();
    } catch (error) {diagnose(record, {consoleSuppression: "helper-unavailable", consoleError: error.message}); finish(null);}
  });
}

ipcMain.on("launch-ns", () => {void launch("northstar");});
ipcMain.on("launch-vanilla", () => {void launch("vanilla");});

function preflight(conf, gameVersion, prepared = false) {
  const root = findgame.validateGamePath(conf.gamepath);
  if (!root) throw Error("游戏目录已失效或缺少 Titanfall2.exe，请重新选择游戏安装目录。");
  const directory = path.join(root, "r2");
  try {if (!fs.statSync(directory).isDirectory()) throw Error();}
  catch (_) {throw Error("游戏目录缺少 r2 资源目录，请验证游戏文件后再启动。");}
  const executable = gameVersion === "vanilla" ? "Titanfall2.exe" : "NorthstarLauncher.exe";
  const args = gameVersion === "northstar" ? network.argumentsFor(splitArguments(conf.nsargs || ""), conf.northstarRegion) : splitArguments(conf.nsargs || "");
  const profileDirectory = gameVersion === "northstar" ? network.resolveProfile(root, args) : null;
  const dll = gameVersion === "northstar" && network.normalize(conf.northstarRegion) === "global" ? path.relative(root,path.join(profileDirectory,"Northstar.dll")) : "Northstar.dll";
  const required = gameVersion === "vanilla" ? [executable] : ["Titanfall2.exe", "bin/x64_retail/launcher.dll", "bin/x64_retail/tier0.dll", ...(prepared ? [executable,dll] : [])];
  for (const name of required) {
    try {if (!fs.statSync(path.join(root, ...name.split("/"))).isFile()) throw Error(); fs.accessSync(path.join(root, ...name.split("/")), fs.constants.R_OK);}
    catch (_) {throw Error("缺少或无法读取 " + name + (gameVersion === "vanilla" ? "，请验证游戏文件。" : "，请在开始游戏页面检查或重新安装北极星客户端。"));}
  }
  const quietConsole = gameVersion === "northstar" && supportsQuietConsole(root, profileDirectory);
  if (quietConsole && !args.includes("-noallocconsole")) args.push("-noallocconsole");
  return {root, executable, args, quietConsole, profileDirectory};
}
async function baselineSnapshot() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = await running.snapshot();
    if (value?.ok) return value;
  }
  throw Error("无法读取 Windows 游戏进程，已重试三次。请稍后重试启动。");
}

async function launch(gameVersion) {
  gameVersion = gameVersion === "vanilla" ? "vanilla" : "northstar";
  if (launching) return {ok: false, pending: true, error: "游戏正在启动，请等待当前请求完成"};
  launching = true;
  const record = {version: 1, gameVersion, startedAt: new Date().toISOString(), state: "starting", childExit: null, confirmation: null, error: null};
  latestDiagnostic = record;
  diagnose(record, {});
  send("launch-status", {state: "starting", gameVersion});
  let session = null, consoleController = null, clientPreparation = false;
  try {
    const result = await gate.run("launch", async () => {
      if (require("./dds").busy) throw Error("DDS 安装或恢复正在进行，请完成后再启动游戏");
      const conf = {...settings()};
      let plan = preflight(conf, gameVersion);
      let baseline = await baselineSnapshot();
      if (hasGame(baseline)) throw Error("游戏或北极星启动进程已经运行，请等待启动完成或先退出游戏。");
      // A cross-format skin switch can touch both the model index and DDS data.
      // Never start a game against an interrupted transaction between them.
      await require("./skin-switch").getActive()?.assertReady(plan.root);
      clientPreparation = true;
      const selectionGuard=()=>{
        const current=settings();
        if(current.gamepath!==conf.gamepath||current.nsargs!==conf.nsargs||network.normalize(current.northstarRegion)!==network.normalize(conf.northstarRegion))throw Error("客户端选择或游戏目录已改变，请重新启动。");
      };
      const compatibilityGuard = async () => {
        const stopped = await baselineSnapshot();
        if (hasGame(stopped)) throw Error("游戏已由其他程序启动，请先退出游戏后重试。");
        selectionGuard();
      };
      let compatibility;
      if (gameVersion === "northstar") {
        diagnose(record, {clientPreparation: "checking", region: network.normalize(conf.northstarRegion)});
        const installed = await clients.ensure({conf, allowInstall: false, guard: selectionGuard});
        diagnose(record, {clientPreparation: "ready", client: installed});
        plan = preflight(conf, gameVersion, true);
        const modConfiguration = await modState.prepare(plan.profileDirectory, network.normalize(conf.northstarRegion), {guard: compatibilityGuard});
        diagnose(record, {modConfiguration});
        compatibility = await modCompatibility.prepare(plan.profileDirectory, network.normalize(conf.northstarRegion), {clientVersion: installed.version, guard: compatibilityGuard});
        ipcMain.emit("gui-getmods");
      } else {
        await clients.recover(conf);
        const profileDirectory = network.resolveProfile(plan.root, splitArguments(conf.nsargs || ""));
        if (fs.existsSync(profileDirectory)) compatibility = await modCompatibility.prepare(profileDirectory, "vanilla", {guard: compatibilityGuard});
      }
      if (compatibility) {
        diagnose(record, {modCompatibility: compatibility});
        if (compatibility.applied.length || compatibility.restored.length) send("launch-compatibility", compatibility);
      }
      clientPreparation = false;
      diagnose(record, {root: plan.root, executable: plan.executable, args: plan.args, consoleMode: gameVersion === "northstar" ? plan.quietConsole ? "official-noallocconsole" : "owned-console-only" : "game-default"});
      const guard = await protection.beforeLaunch(plan.root);
      send("launch-guard-result", guard);
      // Protection may await disk IO. Recheck before creating a process so an
      // external launch cannot slip through the renderer's older state.
      baseline = await baselineSnapshot();
      if (hasGame(baseline)) throw Error("游戏已由其他程序启动，请等待启动完成或先退出游戏。");
      selectionGuard();
      consoleController = gameVersion === "northstar" && !plan.quietConsole ? await prepareLegacyConsole(record) : null;
      if (consoleController) {
        // Helper initialization is asynchronous. Keep the duplicate-process
        // guard adjacent to the actual spawn rather than to helper preparation.
        baseline = await baselineSnapshot();
        if (hasGame(baseline)) throw Error("游戏已由其他程序启动，请等待启动完成或先退出游戏。");
      }
      selectionGuard();
      if (gameVersion === "northstar") modState.assertReady(plan.profileDirectory, network.normalize(conf.northstarRegion));
      const previousLog = gameVersion === "northstar" ? latestGameLog(plan.profileDirectory) : null;
      const startup = createStartupLog();
      diagnose(record, {startupLog: startup.filename, windowsHide: false});
      session = confirmation.begin(baseline, {gameVersion});
      activeReadiness = gameVersion === "northstar" ? {session, record, root: plan.root, profileDirectory: plan.profileDirectory, startupLog: startup.filename, previousLog, startedAt: Date.now(), logFilename: null, logOffset: 0, runtime: new NorthstarReadiness()} : null;
      console.info(lang("general.launching"), gameVersion === "vanilla" ? "Vanilla..." : "Northstar...");
      try {
        // This is the requested game window. SW_HIDE can propagate to the
        // engine Northstar loads in this same process and hide a healthy game.
        const child = spawn(path.join(plan.root, plan.executable), plan.args, {cwd: plan.root, windowsHide: false, detached: true, stdio: ["ignore", startup.fd, startup.fd]});
        child.once("spawn", () => {
          confirmation.spawned(session, child.pid);
          diagnose(record, {spawnedAt: new Date().toISOString(), launcherPid: child.pid || null});
          consoleController?.bind(child.pid);
          child.unref();
        });
        child.once("error", error => {consoleController?.cancel(); diagnose(record, {spawnErrorCode: error.code || null}); confirmation.fail(session, error);});
        child.once("exit", (code, signal) => {
          diagnose(record, {childExit: {code, signal: signal || null, at: new Date().toISOString()}});
          confirmation.launcherExited(session, code, signal);
        });
      } catch (error) {consoleController?.cancel(); confirmation.fail(session, error);}
      finally {fs.closeSync(startup.fd);}
      const confirmed = await session.promise;
      if (!confirmed.ok) throw Object.assign(Error(confirmed.error), confirmed.code ? {code:confirmed.code} : {});
      diagnose(record, {state: "confirmed", confirmedAt: new Date().toISOString(), confirmation: {pid: confirmed.pid, image: confirmed.image}});
      send("launch-status", {state: "confirmed", gameVersion, pid: confirmed.pid});
      return confirmed;
    });
    // Release the DDS gate before optional app shutdown; manual Exit can also
    // close EA App, so use the independent application quit path here.
    if (settings().exitAfterLaunch === true) app.quit();
    return result;
  } catch (error) {
    if (session) confirmation.fail(session, error);
    const result = {ok: false, error: error.message || String(error), ...(error.code ? {code: error.code} : {})};
    diagnose(record, {state: "failed", failedAt: new Date().toISOString(), error: result.error});
    console.error(result.error);
    send("launch-status", {state: "failed", gameVersion, error: result.error, ...(result.code ? {code: result.code} : {})});
    if (clientPreparation) send("launch-guard-result", {...result,scope:"client"});
    return result;
  } finally {consoleController?.cancel(); activeReadiness = null; launching = false;}
}

module.exports = launch;
