"use strict";
const fs = require("fs");
const {randomUUID} = require("crypto");
const {sanitizeReport} = require("./launch-diagnostics");
const MAX_BYTES = 32 * 1024, PREVIEW_TTL_MS = 30 * 60 * 1000;

// A strict allowlist is stronger than trying to recognize every possible token,
// IP address, file path or account name in arbitrary text. No raw log is read.
function diagnosticJSON(report) {
  const safe = sanitizeReport(report); if (!safe) return null;
  const json = JSON.stringify({format:"TFX launch diagnostic", privacy:"Local structured facts only. No logs, file paths, launch arguments, mod names, network addresses, account details or credentials are included.", report:safe}, null, 2) + "\n";
  return Buffer.byteLength(json, "utf8") <= MAX_BYTES ? json : null;
}
function trustedSender(event, window) {
  const contents = window?.webContents;
  try {return Boolean(contents && !window.isDestroyed?.() && !contents.isDestroyed?.() && event?.sender === contents && event.senderFrame && event.senderFrame === contents.mainFrame && /^file:/i.test(contents.getURL()));} catch (_) {return false;}
}
function createExporter({getReport, showSaveDialog, getWindow, now = Date.now, id = randomUUID, write = (filename, json) => fs.promises.writeFile(filename, json, {encoding:"utf8", mode:0o600})}) {
  const previews = new Map(); let saving = false;
  function preview() {
    const report = sanitizeReport(getReport()); if (!report) return {ok:true, report:null, preview:null};
    const json = diagnosticJSON(report); if (!json) return {ok:false, errorCode:"INVALID_REPORT"};
    const key = id(); for (const [token, entry] of previews) if (now() - entry.at > PREVIEW_TTL_MS) previews.delete(token);
    while (previews.size >= 4) previews.delete(previews.keys().next().value);
    const record = {id:key, json, bytes:Buffer.byteLength(json, "utf8")}; previews.set(key, {...record, at:now()});
    return {ok:true, report, preview:record};
  }
  async function save(input) {
    if (saving) return {ok:false, errorCode:"SAVE_PENDING"};
    const key = input && Object.keys(input).length === 1 && typeof input.previewId === "string" && /^[a-f0-9-]{36}$/.test(input.previewId) ? input.previewId : null;
    const record = key && previews.get(key); if (!record || now() - record.at > PREVIEW_TTL_MS) return {ok:false, errorCode:"PREVIEW_REQUIRED"};
    saving = true;
    try {
      const chosen = await showSaveDialog(getWindow(), {defaultPath:"TFX-launch-diagnostic.json", filters:[{name:"JSON", extensions:["json"]}], properties:["showOverwriteConfirmation"]});
      if (chosen.canceled || !chosen.filePath) return {ok:true, cancelled:true};
      // File name comes only from the native picker. The bytes are the exact
      // immutable snapshot the player saw, even if another launch has begun.
      await write(chosen.filePath, record.json); return {ok:true, cancelled:false, bytes:record.bytes};
    } catch (_) {return {ok:false, errorCode:"SAVE_FAILED"};}
    finally {saving = false;}
  }
  return {preview, save};
}
function register({ipcMain, dialog, getWindow, getReport, ...options}) {
  const exporter = createExporter({getReport, getWindow, showSaveDialog:(window, input) => dialog.showSaveDialog(window, input), ...options});
  ipcMain.handle("launch-diagnostic-get", event => trustedSender(event, getWindow()) ? exporter.preview() : {ok:false, errorCode:"UNTRUSTED_SENDER"});
  ipcMain.handle("launch-diagnostic-export", (event, input) => trustedSender(event, getWindow()) ? exporter.save(input) : {ok:false, errorCode:"UNTRUSTED_SENDER"});
  return exporter;
}
module.exports = {MAX_BYTES, PREVIEW_TTL_MS, diagnosticJSON, trustedSender, createExporter, register};
