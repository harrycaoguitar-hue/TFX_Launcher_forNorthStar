"use strict";
const path = require("path");

// This is a resolution-table check, not a guarantee about every in-game mip.
// The compatibility catalogue decides which resolutions exist for a specific
// material. No candidate DDS data is generated or written here.
const HEIGHTS = Object.freeze([128, 256, 512, 1024, 2048, 4096]);
const MAX_COVERAGE_QUERIES = 2500;
const TARGETS = new Set(["pc_stream.starpak", "pc_stream(03).starpak", "pc_stream(05).starpak", "pc_stream(06).starpak", "pc_stream(07).starpak"]);
const TABLE_INDEX_ERRORS = new Set(["索引超出了数组界限。", "Index was outside the bounds of the array.", "没有匹配到受支持的皮肤名称与尺寸", "不支持的皮肤尺寸目录"]);
const keyOf = item => [item.name.toLowerCase(), item.width, item.height, item.format, item.skip].join("|");
const pathKey = value => typeof value === "string" ? path.resolve(value).toLowerCase() : "";

async function inspectTextureCoverage(files, plan, dir) {
  const coverage = {
    version: 1, state: "unknown", scope: "metadata-table", coveredCount: Array.isArray(files) ? files.length : 0,
    supportedCount: Array.isArray(files) ? files.length : 0, missingCount: 0, materialCount: 0,
    queryCount: 0, missing: [], reason: ""
  };
  const unknown = reason => ({...coverage, state: "unknown", reason, missing: coverage.missing.map(({name, width, height}) => ({name, width, height}))});
  try {
    if (!Array.isArray(files) || !files.length || files.length > 500) return unknown("皮肤层级检查输入无效");
    const cache = new Map(), materials = new Map();
    for (const item of files) {
      const ratio = item.width / item.height;
      const blockBytes = item.payloadLength / (Math.ceil(item.width / 4) * Math.ceil(item.height / 4));
      if (![1, 2].includes(ratio) || ![8, 16].includes(blockBytes)) return unknown("无法确认皮肤压缩格式和尺寸比例");
      cache.set(keyOf(item), {existing: true, item});
      const material = [item.name.toLowerCase(), ratio, item.format, item.skip].join("|");
      if (!materials.has(material)) materials.set(material, {item, ratio, blockBytes});
    }
    coverage.materialCount = materials.size;
    const queries = [];
    for (const {item, ratio, blockBytes} of materials.values()) {
      for (const height of HEIGHTS) {
        const width = height * ratio;
        if (width < 256 || width > 4096) continue;
        const candidate = {
          name: item.name, width, height, format: item.format, skip: item.skip,
          payloadLength: Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes
        };
        const key = keyOf(candidate);
        if (cache.has(key)) continue;
        if (queries.length >= MAX_COVERAGE_QUERIES) return unknown("皮肤层级查询超过支持范围");
        candidate.path = path.join(dir, "coverage", String(queries.length), `${width}x${height}`, item.name);
        queries.push(candidate);
        // Repeated material/resolution/format combinations share one lookup.
        cache.set(key, {existing: false, item: candidate});
      }
    }
    coverage.queryCount = queries.length;
    if (!queries.length) return {...coverage, state: "complete"};
    const plans = await plan(queries.map(item => item.path), dir);
    if (!Array.isArray(plans) || plans.length !== queries.length) return unknown("皮肤层级元数据响应数量不匹配");
    const byPath = new Map();
    for (const result of plans) {
      const key = pathKey(result && result.path);
      if (!key || byPath.has(key)) return unknown("皮肤层级元数据响应路径无效");
      byPath.set(key, result);
    }
    for (const candidate of queries) {
      const result = byPath.get(pathKey(candidate.path));
      if (!result || typeof result.ok !== "boolean") return unknown("皮肤层级元数据响应不完整");
      if (!result.ok) {
        // An absent table index is expected for an unsupported resolution.
        // Other errors might indicate a broken adapter; never call that complete.
        if (TABLE_INDEX_ERRORS.has(String(result.error).trim())) continue;
        return unknown(`无法确认 ${candidate.name} ${candidate.width}×${candidate.height}：${String(result.error || "未知元数据错误").slice(0, 240)}`);
      }
      if (!TARGETS.has(result.target) || !Number.isSafeInteger(result.offset) || result.offset <= 0 ||
          !Number.isSafeInteger(result.length) || result.length !== candidate.payloadLength ||
          !Number.isSafeInteger(result.offset + result.length) || result.skip !== candidate.skip) {
        return unknown(`皮肤层级元数据无效：${candidate.name} ${candidate.width}×${candidate.height}`);
      }
      const bounds = [...files, ...coverage.missing].filter(item => item.target === result.target);
      if (bounds.some(item => result.offset < item.offset + item.length && item.offset < result.offset + result.length)) {
        return unknown(`皮肤层级元数据存在重叠：${candidate.name} ${candidate.width}×${candidate.height}`);
      }
      // Internal positions are used solely for overlap checking and removed
      // before this advisory leaves the inspection module.
      coverage.missing.push({name: candidate.name, width: candidate.width, height: candidate.height, target: result.target, offset: result.offset, length: result.length});
      coverage.missingCount++;
      coverage.supportedCount++;
    }
    coverage.missing.sort((a, b) => a.height - b.height || a.width - b.width || a.name.localeCompare(b.name, "en"));
    coverage.missing = coverage.missing.map(({name, width, height}) => ({name, width, height}));
    coverage.state = coverage.missingCount ? "partial" : "complete";
    return coverage;
  } catch (err) {
    return unknown(`皮肤层级检查暂不可用：${String(err && err.message || err).slice(0, 300)}`);
  }
}

module.exports = {inspectTextureCoverage, MAX_COVERAGE_QUERIES};
