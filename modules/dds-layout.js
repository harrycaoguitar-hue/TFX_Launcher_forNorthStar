"use strict";
const path = require("path");
const catalogue = require("./data/dds-layout-tf2.json");

// This resolver contains our validation and lookup implementation. Its data is
// a documented compatibility catalogue of measured game resource locations;
// it does not load or execute the reference installer.
const UNSUPPORTED_LAYOUT = "没有匹配到受支持的皮肤名称与尺寸";
const INVALID_SIZE = "不支持的皮肤尺寸目录";
const TARGETS = new Set(["pc_stream.starpak", "pc_stream(03).starpak", "pc_stream(05).starpak", "pc_stream(06).starpak", "pc_stream(07).starpak"]);
const DIMENSIONS = new Set([128, 256, 512, 1024, 2048, 4096]);
const MAX_INPUTS = 10000;
const layouts = new Map();

if (catalogue.version !== 1 || !Array.isArray(catalogue.rows) || catalogue.rows.length > 20000) throw Error("DDS 资源目录无效");
for (const row of catalogue.rows) {
  const [name, width, height, target, offset, length, skip, kind, index] = row;
  if (!/^[A-Za-z0-9_.-]+\.dds$/i.test(name) || !DIMENSIONS.has(width) || !DIMENSIONS.has(height) ||
      !TARGETS.has(target) || !Number.isSafeInteger(offset) || offset <= 0 || !Number.isSafeInteger(length) || length <= 0 ||
      length > 128 * 1024 * 1024 || !Number.isSafeInteger(offset + length) || ![128, 148].includes(skip) ||
      ![1, 2, 3].includes(kind) || !Number.isInteger(index) || index < -1 || index > 3) throw Error("DDS 资源目录存在无效位置");
  const key = name.toLowerCase() + "|" + width + "x" + height;
  if (layouts.has(key)) throw Error("DDS 资源目录存在重复位置");
  layouts.set(key, Object.freeze({offset, length, skip, target, kind, index}));
}

function dimensionsFromPath(file) {
  const directory = path.win32.basename(path.win32.dirname(file.replace(/\//g, "\\")));
  const pair = /^(\d+)x(\d+)$/i.exec(directory);
  if (pair) return [Number(pair[1]), Number(pair[2])];
  if (/^\d+$/.test(directory)) return [Number(directory), Number(directory)];
  return null;
}

function resolve(input) {
  const file = typeof input === "string" ? input : input?.path;
  if (typeof file !== "string" || file.length > 32768 || file.includes("\0")) return {path:file || "", ok:false, error:UNSUPPORTED_LAYOUT};
  const name = path.win32.basename(file.replace(/\//g, "\\"));
  if (!/^[A-Za-z0-9_.-]+\.dds$/i.test(name)) return {path:file, ok:false, error:UNSUPPORTED_LAYOUT};
  const dimensions = typeof input === "object" && input !== null && ("width" in input || "height" in input) ? [input.width, input.height] : dimensionsFromPath(file);
  if (!dimensions || !dimensions.every(value => Number.isInteger(value) && DIMENSIONS.has(value))) return {path:file, ok:false, error:INVALID_SIZE};
  const [width, height] = dimensions;
  if (width !== height && width !== height * 2) return {path:file, ok:false, error:INVALID_SIZE};
  const layout = layouts.get(name.toLowerCase() + "|" + width + "x" + height);
  return layout ? {path:file, ok:true, ...layout} : {path:file, ok:false, error:UNSUPPORTED_LAYOUT};
}

function plan(files) {
  if (!Array.isArray(files) || files.length > MAX_INPUTS) throw Error("DDS 元数据请求超过支持范围");
  return files.map(resolve);
}

module.exports = Object.freeze({plan, resolve, UNSUPPORTED_LAYOUT, INVALID_SIZE, size:layouts.size, version:catalogue.version});
