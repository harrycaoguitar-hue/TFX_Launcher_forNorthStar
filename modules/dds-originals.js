"use strict";
const fs = require("fs"), fsp = fs.promises, path = require("path"), crypto = require("crypto");
const {legacyCatalogue, textureFamily, rangeKey} = require("./dds-replacement");
const sha = (b, algorithm = "sha256") => crypto.createHash(algorithm).update(b).digest("hex");
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const MAX_MANIFEST = 32 * 1024 * 1024;

function protobuf(bytes) {
  let offset = 0; const result = [];
  const integer = () => {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      if (offset >= bytes.length) throw Error("Steam 资源清单不完整");
      const byte = bytes[offset++]; value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
    }
    throw Error("Steam 资源清单整数无效");
  };
  while (offset < bytes.length) {
    const tag = integer(); if (typeof tag !== "number" || tag < 8) throw Error("Steam 资源清单字段无效");
    const field = Math.floor(tag / 8), wire = tag & 7; let value;
    if (wire === 0) value = integer();
    else {
      const length = wire === 2 ? integer() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw Error("Steam 资源清单长度无效");
      value = bytes.subarray(offset, offset + length); offset += length;
    }
    result.push({field, value});
  }
  return result;
}

function parseManifest(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_MANIFEST || bytes.length < 8 || bytes.readUInt32LE(0) !== 0x71f617d0) throw Error("不是受支持的 Steam 资源清单");
  const length = bytes.readUInt32LE(4); if (length > bytes.length - 8) throw Error("Steam 资源清单不完整");
  const files = new Map();
  for (const item of protobuf(bytes.subarray(8, 8 + length))) {
    if (item.field !== 1 || !Buffer.isBuffer(item.value)) continue;
    const fields = protobuf(item.value), get = n => fields.find(f => f.field === n)?.value;
    const name = get(1); if (!Buffer.isBuffer(name)) continue;
    const key = name.toString("utf8").replace(/\\/g, "/").toLowerCase();
    if (!/^r2\/paks\/win64\/pc_stream(?:\(0[3567]\))?\.starpak$/.test(key)) continue;
    const size = get(2), chunks = [];
    if (!Number.isSafeInteger(size) || size <= 0 || files.has(key)) throw Error("Steam 资源条目无效");
    for (const field of fields.filter(f => f.field === 6)) {
      const c = protobuf(field.value), val = n => c.find(f => f.field === n)?.value;
      const hash = val(1), start = val(3), count = val(4);
      if (!Buffer.isBuffer(hash) || hash.length !== 20 || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count <= 0 || count > 4 * 1024 * 1024 || start + count > size) throw Error("Steam 资源区块无效");
      chunks.push({offset:start, length:count, SHA1:hash.toString("hex")});
    }
    chunks.sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < chunks.length; i++) if (i && chunks[i].offset < chunks[i-1].offset + chunks[i-1].length) throw Error("Steam 资源区块重叠");
    if (!chunks.length) throw Error("Steam 资源条目缺少区块");
    files.set(key, {size, chunks});
  }
  if (!files.size) throw Error("Steam 资源清单未包含 DDS 游戏包，或文件名尚未解密");
  return {files, SHA256:sha(bytes)};
}

async function findManifest(gamePath) {
  const steamapps = path.resolve(gamePath, "../.."), appFile = path.join(steamapps, "appmanifest_1237970.acf");
  let state; try {state = await fsp.readFile(appFile, "utf8");} catch(e) {if (e.code === "ENOENT") return null; throw e;}
  const installed = /"installdir"\s*"([^"\r\n]+)"/i.exec(state);
  if (!installed || !same(path.join(steamapps, "common", installed[1]), gamePath)) return null;
  const depots = /"InstalledDepots"\s*\{([\s\S]*?)\n\s*\}\s*\n\s*"InstallScripts"/i.exec(state)?.[1] || state;
  const candidates = [...depots.matchAll(/"(\d+)"\s*\{\s*"manifest"\s*"(\d+)"/g)];
  for (const [, depot, manifest] of candidates) {
    for (const cache of [path.join(steamapps, "../depotcache"), path.join(steamapps, "depotcache")]) {
      const file = path.join(cache, `${depot}_${manifest}.manifest`);
      try {
        const stat = await fsp.stat(file); if (stat.size > MAX_MANIFEST) throw Error("Steam 资源清单超过支持大小");
        const value = parseManifest(await fsp.readFile(file));
        return {...value, path:file, depot, manifest};
      } catch(e) {if (e.code !== "ENOENT" && !String(e.message).includes("未包含 DDS")) throw e;}
    }
  }
  return null;
}

async function read(file, offset, length) {
  const handle = await fsp.open(file, "r"); const bytes = Buffer.alloc(length);
  try {let done = 0; while (done < length) {const result = await handle.read(bytes, done, length-done, offset+done); if (!result.bytesRead) throw Error("原版资源不完整"); done += result.bytesRead;} return bytes;} finally {await handle.close();}
}

class DdsOriginals {
  constructor({baseDir, plan, progress = () => {}, manifestProvider = findManifest}) {this.baseDir = baseDir; this.plan = plan; this.progress = progress; this.manifestProvider = manifestProvider;}
  folder(gamePath) {return path.join(this.baseDir, "originals", sha(Buffer.from(path.resolve(gamePath).toLowerCase())));}
  async prepare(pkg, gamePath, selectedSource) {
    const catalogue = await legacyCatalogue(pkg.files, this.plan, pkg.dir), rows = [...catalogue.values()];
    if (rows.length > 1000 || rows.reduce((sum,r) => sum+r.length,0) > 512 * 1024 * 1024) throw Error("完整材质组超过 512 MB，请分包安装");
    const incoming = new Set(pkg.files.map(rangeKey)), omitted = rows.filter(r => !incoming.has(rangeKey(r)));
    const manifest = await this.manifestProvider(gamePath), originals = new Map(), unavailable = [], verified = new Map();
    let sourceStat;
    if (selectedSource) sourceStat = await fsp.stat(selectedSource);
    const folder = this.folder(gamePath);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], key = rangeKey(r), cacheKey = sha(Buffer.from(key)), metaFile = path.join(folder, cacheKey+".json"), binFile = path.join(folder, cacheKey+".bin");
      if (!selectedSource) {
        try {
          const m = JSON.parse(await fsp.readFile(metaFile, "utf8")), bytes = await fsp.readFile(binFile);
          if (m.version !== 1 || !same(m.gamePath, gamePath) || m.target !== r.target || m.offset !== r.offset || m.length !== r.length || bytes.length !== r.length || sha(bytes) !== m.SHA256 || !manifest || m.manifestSHA256 !== manifest.SHA256) throw Error("原版皮肤缓存与当前游戏版本不匹配或已损坏，请重新选择原版资源");
          originals.set(key, {...r, bytes, origin:m}); continue;
        } catch(e) {if (e.code !== "ENOENT") throw e;}
      }
      if (!manifest) {unavailable.push(r); continue;}
      const info = manifest.files.get("r2/paks/win64/"+r.target.toLowerCase());
      if (!info) {unavailable.push(r); continue;}
      let file = path.join(gamePath, "r2/paks/Win64", r.target);
      if (selectedSource) {
        if (sourceStat.isFile()) {if (path.basename(selectedSource).toLowerCase() !== r.target.toLowerCase()) {unavailable.push(r); continue;} file = selectedSource;}
        else if (sourceStat.isDirectory()) {file = path.join(selectedSource, r.target); if (!fs.existsSync(file)) file = path.join(selectedSource, "r2/paks/Win64", r.target);}
        else throw Error("请选择原版 .starpak 文件或游戏目录");
      }
      let size; try {size = (await fsp.stat(file)).size;} catch(e) {if (e.code === "ENOENT") {unavailable.push(r); continue;} throw e;}
      if (size !== info.size) {unavailable.push(r); continue;}
      const chunks = info.chunks.filter(c => c.offset < r.offset+r.length && r.offset < c.offset+c.length);
      let covered = r.offset, good = true;
      for (const chunk of chunks) {
        if (chunk.offset > covered) {good = false; break;} covered = Math.max(covered, chunk.offset+chunk.length);
        const ck = path.resolve(file)+"|"+chunk.offset; let data = verified.get(ck);
        if (data === undefined) {data = await read(file, chunk.offset, chunk.length); if (sha(data, "sha1") !== chunk.SHA1) data = null; verified.set(ck, data);}
        if (!data) good = false;
      }
      if (!good || covered < r.offset+r.length) {unavailable.push(r); continue;}
      const bytes = Buffer.alloc(r.length);
      for (const c of chunks) {const start = Math.max(c.offset, r.offset), end = Math.min(c.offset+c.length, r.offset+r.length); verified.get(path.resolve(file)+"|"+c.offset).copy(bytes, start-r.offset, start-c.offset, end-c.offset);}
      const origin = {version:1, gamePath:path.resolve(gamePath), target:r.target, offset:r.offset, length:r.length, family:textureFamily(r.name), SHA256:sha(bytes), manifestSHA256:manifest.SHA256, source:path.resolve(file), createdAt:new Date().toISOString(), proof:chunks.map(c => ({...c}))};
      await fsp.mkdir(folder, {recursive:true});
      // Publish data first. An interrupted cache write has no trusted metadata.
      const token = crypto.randomUUID(), temporary = binFile+"."+token+".tmp", temporaryMeta = metaFile+"."+token+".tmp";
      try {await fsp.writeFile(temporary, bytes, {flag:"wx"}); await fsp.writeFile(temporaryMeta, JSON.stringify(origin), {flag:"wx"}); await fsp.rename(temporary, binFile); await fsp.rename(temporaryMeta, metaFile);} finally {await fsp.rm(temporary, {force:true}); await fsp.rm(temporaryMeta, {force:true});}
      originals.set(key, {...r, bytes, origin});
      this.progress({phase:"originals", percent:Math.round((i+1)/rows.length*100), message:`正在保存经 Steam 校验的原版皮肤 ${i+1}/${rows.length}`});
    }
    const missing = omitted.filter(r => !originals.has(rangeKey(r)));
    const result = {state:missing.length ? "needs-source" : "ready", complete:missing.length === 0, missingCount:missing.length, omittedCount:omitted.length, requiredCount:omitted.length, availableCount:omitted.length-missing.length, familyCount:new Set(rows.map(r => textureFamily(r.name))).size, originalCount:originals.size, catalogueCount:rows.length, cachePath:folder, canSteamRepair:Boolean(manifest), missing:missing.map(({name,width,height}) => ({name,width,height})), reason:missing.length ? "皮肤包未包含的部分缺少可靠的原版资源，直接覆盖会保留旧皮肤。请选择原版资源备份，或通过 Steam 验证游戏文件后刷新。" : "缺失的皮肤文件将用经校验的原版资源补齐，避免留下旧皮肤。"};
    if (selectedSource && missing.length) throw Error("所选资源不能通过当前 Steam 版本的原版校验，未修改游戏。请选择未安装 DDS 的原版资源备份。");
    return {originals, rows, status:result};
  }
}
module.exports = {DdsOriginals, parseManifest, findManifest};
