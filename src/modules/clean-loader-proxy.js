"use strict";

// Steam may append -northstar again during its ownership handoff. Temporarily
// moving the recognized injection proxy prevents those external flags from
// loading Northstar during an explicitly clean EA launch. The proxy bytes are
// never rewritten. An exclusive same-volume hard link plus verified unlink
// implements each move without overwriting a file created by another process.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const state = require("./mod-enabled-state");
const PROXY = "bin/x64_retail/wsock32.dll", MAX_PROXY_BYTES = 4 * 1024 * 1024;
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = message => Object.assign(Error(message), {code: "CLEAN_PROXY_RECOVERY"});
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);
function bundledProxies() {
  return ["cn", "global"].flatMap(channel => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../tools/clients", channel, "manifest.json"), "utf8"));
    return manifest.files.filter(file => file.path.toLowerCase() === PROXY).map(file => ({size: file.size, sha256: file.sha256}));
  });
}
function createManager({trustedProxies = bundledProxies(), trustedProxyProvider} = {}) {
  if (!Array.isArray(trustedProxies) || !trustedProxies.length || trustedProxies.some(value => !value || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_PROXY_BYTES || !/^[a-f0-9]{64}$/.test(value.sha256))) throw fail("纯净启动组件校验清单无效。");
  const trusted = new Set(trustedProxies.map(value => value.size + ":" + value.sha256)), busy = new Set();
  async function isTrusted(ctx, fingerprint) {
    if (!fingerprint || !Number.isSafeInteger(fingerprint.size) || fingerprint.size < 1 || fingerprint.size > MAX_PROXY_BYTES || !/^[a-f0-9]{64}$/.test(fingerprint.sha256)) return false;
    if (trusted.has(fingerprint.size + ":" + fingerprint.sha256)) return true;
    if (!trustedProxyProvider) return false;
    // Revalidate a private snapshot or downloaded release for each operation;
    // neither a live DLL nor the recovery journal can authorize its own hash.
    const values = await trustedProxyProvider(ctx.root, fingerprint);
    return Array.isArray(values) && values.some(value => value?.size === fingerprint.size && value?.sha256 === fingerprint.sha256);
  }
  function context(root) {
    // checked() also inspects every ancestor, refusing junctions and symlinks.
    state.checked(path.join(root, ".tfx-clean-proxy-path-check"));
    const realRoot = fs.realpathSync.native(root), stat = fs.lstatSync(realRoot);
    if (!stat.isDirectory()) throw fail("纯净启动游戏目录无效。");
    const store = path.join(realRoot, ".tfx", "clean-loader-proxy", sha(Buffer.from(realRoot.toLowerCase())).slice(0, 24));
    return {root: realRoot, proxy: path.join(realRoot, ...PROXY.split("/")), store, backup: path.join(store, "wsock32.dll"), journal: path.join(store, "journal.json")};
  }
  function checkedProxy(file) {
    const bytes = state.checked(file);
    if (bytes && (!bytes.length || bytes.length > MAX_PROXY_BYTES)) throw fail("纯净启动加载组件体积异常，已保留原文件。");
    return bytes;
  }
  async function read(ctx) {
    const bytes = state.checked(ctx.journal); if (!bytes) return null;
    let value; try {value = JSON.parse(bytes.toString("utf8"));} catch (_) {throw fail("纯净启动恢复记录无法读取，已保留加载组件。");}
    if (!Buffer.from(bytes.toString("utf8")).equals(bytes) || value?.schemaVersion !== 1 || value.root !== ctx.root || value.proxy !== ctx.proxy || value.backup !== ctx.backup || !await isTrusted(ctx, value)) throw fail("纯净启动恢复记录与已识别的加载组件不匹配，未移动任何文件。");
    return {bytes, value};
  }
  function matches(bytes, record) {return bytes !== null && bytes.length === record.size && sha(bytes) === record.sha256;}
  function sameFile(first, second) {const a = fs.lstatSync(first), b = fs.lstatSync(second); return a.isFile() && b.isFile() && !a.isSymbolicLink() && !b.isSymbolicLink() && a.dev === b.dev && a.ino === b.ino;}
  async function moveExclusive(source, destination, record, guard) {
    await guard?.();
    if (checkedProxy(destination) !== null || !matches(checkedProxy(source), record)) throw fail("加载组件在移动前发生变化，未覆盖任何文件。");
    // linkSync creates only a new path; EEXIST cannot overwrite a collision.
    fs.linkSync(source, destination);
    await guard?.();
    if (!sameFile(source, destination) || !matches(checkedProxy(source), record) || !matches(checkedProxy(destination), record)) throw fail("加载组件在移动期间发生变化，两个文件位置和恢复记录均已保留。");
    fs.unlinkSync(source);
  }
  async function removeJournal(ctx, record, guard) {
    await guard?.();
    if (!same(state.checked(ctx.journal), record.bytes)) throw fail("纯净启动恢复记录已由其他程序更改，已停止清理。");
    fs.unlinkSync(ctx.journal);
  }
  async function restore(ctx, {guard} = {}) {
    const record = await read(ctx), backup = checkedProxy(ctx.backup);
    if (!record) {
      if (backup) throw fail("发现没有恢复记录的 Northstar 加载组件，已保留文件。请检查游戏目录中的 .tfx/clean-loader-proxy 后重试。");
      return {restored: false};
    }
    const current = checkedProxy(ctx.proxy);
    if (current && backup) {
      if (!matches(current, record.value) || !matches(backup, record.value) || !sameFile(ctx.proxy, ctx.backup)) throw fail("原加载组件位置已有文件，未覆盖外部修改。请退出游戏，检查 .tfx/clean-loader-proxy 中的恢复文件后重试。");
      // A process stopped after creating the exclusive link but before unlink.
      // The original path already contains the exact same inode and bytes.
      await guard?.();
      if (!sameFile(ctx.proxy, ctx.backup) || !matches(checkedProxy(ctx.proxy), record.value) || !matches(checkedProxy(ctx.backup), record.value)) throw fail("加载组件在恢复期间发生变化，已保留恢复数据。");
      fs.unlinkSync(ctx.backup);
      await removeJournal(ctx, record, guard); return {restored: true, moved: false};
    }
    if (current) {
      if (!matches(current, record.value)) throw fail("原加载组件已由其他程序修改，恢复记录已保留，请检查游戏文件。");
      await removeJournal(ctx, record, guard); return {restored: true, moved: false};
    }
    if (!matches(backup, record.value)) throw fail("纯净启动加载组件备份缺失或校验失败，未覆盖游戏文件，请检查恢复文件。");
    await guard?.();
    if (checkedProxy(ctx.proxy) !== null || !matches(checkedProxy(ctx.backup), record.value) || !same(state.checked(ctx.journal), record.bytes)) throw fail("加载组件在恢复前发生变化，已保留恢复文件，请重试。");
    await moveExclusive(ctx.backup, ctx.proxy, record.value, guard);
    if (!matches(checkedProxy(ctx.proxy), record.value)) throw fail("加载组件恢复后校验失败，请保留恢复记录并检查游戏文件。");
    await removeJournal(ctx, record, guard);
    return {restored: true, moved: true};
  }
  async function locked(root, action) {
    const ctx = context(root), key = ctx.root.toLowerCase();
    if (busy.has(key)) throw fail("纯净启动组件正在准备或恢复，请稍后重试。");
    busy.add(key); try {return await action(ctx);} finally {busy.delete(key);}
  }
  async function recover(root, options = {}) {return locked(root, ctx => restore(ctx, options));}
  async function prepare(root, {guard} = {}) {
    return locked(root, async ctx => {
      await guard?.(); await restore(ctx, {guard});
      const original = checkedProxy(ctx.proxy);
      if (!original) return {changed: false, restore: async () => ({restored: false})};
      const fingerprint = {size: original.length, sha256: sha(original)};
      if (!await isTrusted(ctx, fingerprint)) throw fail("检测到未识别的 wsock32.dll，TFX 不会移动第三方文件。请退出游戏，先修复已安装的北极星加载组件，或手动检查 bin/x64_retail/wsock32.dll 后再选择不带 Mod 启动。");
      await guard?.();
      state.checked(path.join(ctx.store, ".tfx-path-check")); fs.mkdirSync(ctx.store, {recursive: true});
      if (checkedProxy(ctx.backup) !== null) throw fail("纯净启动恢复位置已有文件，未覆盖现有恢复数据。");
      const record = Buffer.from(JSON.stringify({schemaVersion: 1, root: ctx.root, proxy: ctx.proxy, backup: ctx.backup, ...fingerprint}) + "\n");
      await state.writeGuarded(ctx.journal, null, record, {guard});
      await guard?.();
      if (!same(checkedProxy(ctx.proxy), original) || checkedProxy(ctx.backup) !== null || !same(state.checked(ctx.journal), record)) throw fail("加载组件在准备期间发生变化，未覆盖修改，请重试。");
      await moveExclusive(ctx.proxy, ctx.backup, fingerprint, guard);
      if (!matches(checkedProxy(ctx.backup), fingerprint)) throw fail("加载组件移动后校验失败，恢复文件已保留，请退出游戏并检查恢复记录。");
      return {changed: true, sha256: fingerprint.sha256, restore: options => recover(ctx.root, options)};
    });
  }
  return {prepare, recover};
}
const manager = createManager({trustedProxyProvider: (root, fingerprint) => require("./northstar-clients").trustedProxyFingerprints(root, fingerprint)});
module.exports = {createManager, prepare: manager.prepare, recover: manager.recover, PROXY};
