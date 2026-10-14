"use strict";

// Valve KeyValues text as used by Steam libraryfolders.vdf and app manifests.
// This parser is deliberately data-only: no includes or conditional execution.
function parse(source) {
  if (typeof source !== "string" || source.length > 8 * 1024 * 1024) throw Error("Invalid KeyValues input");
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  function token() {
    while (offset < source.length) {
      if (/\s/.test(source[offset])) {offset++; continue;}
      if (source.slice(offset, offset + 2) === "//") {
        const end = source.indexOf("\n", offset + 2);
        offset = end < 0 ? source.length : end + 1;
        continue;
      }
      break;
    }
    if (offset === source.length) return null;
    const first = source[offset++];
    if (first === "{" || first === "}") return {brace: first};
    if (first === '"') {
      let value = "";
      while (offset < source.length) {
        const ch = source[offset++];
        if (ch === '"') return {value};
        if (ch === "\\" && offset < source.length) {
          const next = source[offset];
          if (next === "\\" || next === '"') {value += next; offset++; continue;}
        }
        value += ch;
      }
      throw Error("Unterminated KeyValues string");
    }
    const start = offset - 1;
    while (offset < source.length && !/[\s{}]/.test(source[offset])) offset++;
    return {value: source.slice(start, offset)};
  }
  function object(nested, depth) {
    if (depth > 32) throw Error("KeyValues nesting limit exceeded");
    const result = Object.create(null);
    for (;;) {
      const key = token();
      if (!key) {if (nested) throw Error("Unterminated KeyValues object"); return result;}
      if (key.brace === "}") {if (!nested) throw Error("Unexpected KeyValues closing brace"); return result;}
      if (key.brace || !key.value) throw Error("Invalid KeyValues key");
      const value = token();
      if (!value || value.brace === "}") throw Error("Missing KeyValues value");
      if (Object.hasOwn(result, key.value)) throw Error("Duplicate KeyValues key");
      result[key.value] = value.brace === "{" ? object(true, depth + 1) : value.value;
    }
  }
  return object(false, 0);
}

module.exports = {parse};
