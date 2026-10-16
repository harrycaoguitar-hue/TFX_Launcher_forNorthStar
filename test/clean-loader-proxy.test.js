"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const {createManager, PROXY} = require("../src/modules/clean-loader-proxy");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const original = Buffer.from("recognized fixture Northstar proxy, never executable");
const trustedProxies = [{size: original.length, sha256: digest(original)}];
const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tfx-clean-proxy-"));
function fixture(t, bytes = original) {
  const root = fs.mkdtempSync(path.join(suiteRoot, "game-")), proxy = path.join(root, ...PROXY.split("/")), other = path.join(root, "user-skin.vpk");
  fs.mkdirSync(path.dirname(proxy), {recursive: true}); if (bytes !== null) fs.writeFileSync(proxy, bytes); fs.writeFileSync(other, "user skin preserved");
  const manager = createManager({trustedProxies});
  const store = () => {const base = path.join(root, ".tfx/clean-loader-proxy"); return path.join(base, fs.readdirSync(base)[0]);};
  t.after(() => {assert(path.resolve(root).startsWith(path.resolve(suiteRoot) + path.sep)); fs.rmSync(root, {recursive: true, force: true});});
  return {root, proxy, other, manager, store, backup: () => path.join(store(), "wsock32.dll"), journal: () => path.join(store(), "journal.json")};
}
test("clean preparation excludes the exact recognized proxy without rewriting DLL or skin bytes, then restores it", async t => {
  const f = fixture(t), before = fs.readFileSync(f.other), lease = await f.manager.prepare(f.root);
  assert.equal(lease.changed, true); assert.equal(fs.existsSync(f.proxy), false); assert.deepEqual(fs.readFileSync(f.backup()), original);
  const record = JSON.parse(fs.readFileSync(f.journal())); assert.equal(record.sha256, digest(original)); assert.equal(record.proxy, fs.realpathSync.native(path.dirname(f.proxy)) + path.sep + "wsock32.dll");
  assert.equal((await lease.restore()).restored, true); assert.deepEqual(fs.readFileSync(f.proxy), original); assert.equal(fs.existsSync(f.backup()), false); assert.equal(fs.existsSync(f.journal()), false); assert.deepEqual(fs.readFileSync(f.other), before);
});
test("a clean installation with no proxy does not create recovery files", async t => {
  const f = fixture(t, null); assert.equal((await f.manager.prepare(f.root)).changed, false); assert.equal(fs.existsSync(path.join(f.root, ".tfx")), false); assert.equal((await f.manager.recover(f.root)).restored, false);
});
test("unknown third party proxies are preserved and receive an actionable error", async t => {
  const foreign = Buffer.from("foreign proxy"), f = fixture(t, foreign);
  await assert.rejects(f.manager.prepare(f.root), error => error.code === "CLEAN_PROXY_RECOVERY" && /未识别|wsock32/.test(error.message));
  assert.deepEqual(fs.readFileSync(f.proxy), foreign); assert.equal(fs.existsSync(path.join(f.root, ".tfx")), false);
});
test("recovery handles the journal-before-move and restored-before-journal-cleanup crash windows", async t => {
  const f = fixture(t); await f.manager.prepare(f.root); fs.renameSync(f.backup(), f.proxy);
  assert.equal((await f.manager.recover(f.root)).restored, true); assert.deepEqual(fs.readFileSync(f.proxy), original); assert.equal(fs.existsSync(f.journal()), false);
});
test("interrupted exclusive moves recover two same-inode paths while preserving exact bytes", async t => {
  const f = fixture(t); await f.manager.prepare(f.root); fs.linkSync(f.backup(), f.proxy);
  assert.equal((await f.manager.recover(f.root)).restored, true); assert.deepEqual(fs.readFileSync(f.proxy), original); assert.equal(fs.existsSync(f.backup()), false); assert.equal(fs.existsSync(f.journal()), false);
});
test("a foreign collision at the original location is never overwritten, even with identical bytes", async t => {
  for (const foreign of [Buffer.from("foreign DLL recreated by another tool"), original]) {
    const f = fixture(t); await f.manager.prepare(f.root); fs.writeFileSync(f.proxy, foreign); const record = fs.readFileSync(f.journal());
    await assert.rejects(f.manager.recover(f.root), /已有文件|外部修改/); assert.deepEqual(fs.readFileSync(f.proxy), foreign); assert.deepEqual(fs.readFileSync(f.backup()), original); assert.deepEqual(fs.readFileSync(f.journal()), record);
  }
});
test("corrupt or missing backup and journal provenance changes preserve all remaining files", async t => {
  const f = fixture(t); await f.manager.prepare(f.root); fs.writeFileSync(f.backup(), "damaged");
  await assert.rejects(f.manager.recover(f.root), /校验失败/); assert.equal(fs.existsSync(f.proxy), false); assert.equal(fs.readFileSync(f.backup(), "utf8"), "damaged");
  fs.unlinkSync(f.backup()); await assert.rejects(f.manager.recover(f.root), /缺失/); assert.equal(fs.existsSync(f.journal()), true);
  const g = fixture(t); await g.manager.prepare(g.root); const value = JSON.parse(fs.readFileSync(g.journal())); value.proxy = path.join(g.root, "outside.dll"); fs.writeFileSync(g.journal(), JSON.stringify(value));
  await assert.rejects(g.manager.recover(g.root), /不匹配/); assert.deepEqual(fs.readFileSync(g.backup()), original); assert.equal(fs.existsSync(value.proxy), false);
});
test("every asynchronous prepare guard can stop the transaction and a fresh recovery restores pristine bytes", async t => {
  for (let stop = 1; stop <= 7; stop++) {
    const f = fixture(t); let calls = 0;
    await assert.rejects(f.manager.prepare(f.root, {guard: async () => {if (++calls === stop) throw Error("guard stopped " + stop);}}), /guard stopped/);
    await f.manager.recover(f.root); assert.deepEqual(fs.readFileSync(f.proxy), original); assert.deepEqual(fs.readFileSync(f.other), Buffer.from("user skin preserved"));
  }
});
test("every restore guard can stop without losing the proxy and recovery remains retryable", async t => {
  for (let stop = 1; stop <= 4; stop++) {
    const f = fixture(t); const lease = await f.manager.prepare(f.root); let calls = 0;
    await assert.rejects(lease.restore({guard: async () => {if (++calls === stop) throw Error("restore stopped " + stop);}}), /restore stopped/);
    await f.manager.recover(f.root); assert.deepEqual(fs.readFileSync(f.proxy), original);
  }
});
test("an atomic destination collision cannot replace an external file", async t => {
  const f = fixture(t), link = fs.linkSync, foreign = Buffer.from("foreign collision");
  fs.linkSync = (from, to) => {fs.writeFileSync(to, foreign, {flag: "wx"}); return link(from, to);};
  try {await assert.rejects(f.manager.prepare(f.root), error => error.code === "EEXIST");}
  finally {fs.linkSync = link;}
  assert.deepEqual(fs.readFileSync(f.proxy), original); assert.deepEqual(fs.readFileSync(f.backup()), foreign); assert.equal(fs.existsSync(f.journal()), true);
});
test("orphan recovery files, linked proxy paths and reentrant operations are rejected intact", async t => {
  const f = fixture(t); await f.manager.prepare(f.root); fs.unlinkSync(f.journal()); await assert.rejects(f.manager.recover(f.root), /没有恢复记录/); assert.deepEqual(fs.readFileSync(f.backup()), original);
  const g = fixture(t); fs.unlinkSync(g.proxy); fs.symlinkSync(g.other, g.proxy, "file"); await assert.rejects(g.manager.prepare(g.root), /链接/); assert.equal(fs.readFileSync(g.other, "utf8"), "user skin preserved"); fs.unlinkSync(g.proxy);
  const h = fixture(t); let release, first = true; const pending = h.manager.prepare(h.root, {guard: async () => {if (first) {first = false; await new Promise(resolve => {release = resolve;});}}});
  await assert.rejects(h.manager.prepare(h.root), /正在准备或恢复/); release(); await (await pending).restore(); assert.deepEqual(fs.readFileSync(h.proxy), original);
});
test.after(() => {assert.equal(path.dirname(suiteRoot), path.resolve(os.tmpdir())); assert(path.basename(suiteRoot).startsWith("tfx-clean-proxy-")); fs.rmSync(suiteRoot, {recursive: true, force: true});});
