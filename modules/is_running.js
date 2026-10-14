"use strict";
const win = require("../win");
const {execFile} = require("child_process");
const {EventEmitter} = require("events");

const events = new EventEmitter();
const GAME_NAMES = ["northstarlauncher.exe", "titanfall2.exe", "titanfall2-unpacked.exe"];
let inFlight = null, timer = null, fastUntil = 0, lastGameState;

function parseProcesses(stdout) {
  const processes = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)"(?:,|$)/.exec(line.trim());
    if (match) processes.push({image: match[1].toLowerCase(), pid: Number(match[2])});
  }
  return processes;
}
function contains(snapshot, names) {return snapshot.ok && snapshot.processes.some(process => names.includes(process.image));}
function snapshot() {
  // Guards, UI polling, and launch confirmation share one in-flight OS query.
  if (inFlight) return inFlight;
  const request = new Promise(resolve => {
    try {
      execFile("tasklist.exe", ["/FO", "CSV", "/NH"], {windowsHide: true, timeout: 4000, maxBuffer: 2 * 1024 * 1024}, (error, stdout = "") => {
        resolve({ok: !error, processes: error ? [] : parseProcesses(stdout)});
      });
    } catch (_) {resolve({ok: false, processes: []});}
  });
  inFlight = request.then(value => {
    inFlight = null;
    const gameState = contains(value, GAME_NAMES);
    // Preserve the last UI state if tasklist temporarily fails.
    if (value.ok && gameState !== lastGameState) {
      // A query may finish before the renderer has loaded its IPC listeners.
      // Keep it pending until the window is ready rather than losing that state.
      try {
        const window = win();
        if (window.webContents && !window.isDestroyed?.() && !window.webContents.isLoading?.()) {
          window.send("is-running", gameState);
          lastGameState = gameState;
        }
      } catch (_) {}
    }
    events.emit("snapshot", value);
    return value;
  });
  return inFlight;
}
function interval() {
  if (Date.now() < fastUntil) return 1000;
  try {const window = win(); if (window.isMinimized?.() || window.isVisible?.() === false) return 15000;} catch (_) {}
  return 5000;
}
function schedule(delay = interval()) {
  clearTimeout(timer);
  timer = setTimeout(async () => {await snapshot(); schedule();}, delay);
  timer.unref?.();
}
schedule(1000);

module.exports = {
  snapshot,
  onSnapshot(listener) {events.on("snapshot", listener); return () => events.off("snapshot", listener);},
  speedUp(until) {fastUntil = until; schedule(until ? 100 : interval());},
  game: async () => contains(await snapshot(), GAME_NAMES),
  origin: async () => contains(await snapshot(), ["origin.exe", "eadesktop.exe"]),
  titanfall: async () => contains(await snapshot(), ["titanfall2.exe", "titanfall2-unpacked.exe"]),
  northstar: async () => contains(await snapshot(), ["northstarlauncher.exe"]),
  parseProcesses,
  stop() {clearTimeout(timer); timer = null;}
};
