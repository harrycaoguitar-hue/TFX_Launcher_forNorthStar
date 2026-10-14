"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {parse} = require("../src/modules/keyvalues");

test("reads old and new Steam library records, comments and escaped paths", () => {
  const data = parse('\uFEFF"libraryfolders" { // current Steam\n"0" { "path" "D:\\\\Steam" "apps" { "1237970" "50" } } "1" "E:\\\\Games" }');
  assert.equal(data.libraryfolders[0].path, "D:\\Steam");
  assert.equal(data.libraryfolders[0].apps[1237970], "50");
  assert.equal(data.libraryfolders[1], "E:\\Games");
});
test("rejects incomplete, duplicate and excessively nested manifests", () => {
  for (const text of ['"x" { "k" "v"', '"x" "y" "x" "z"', '"x" "unclosed', '}']) assert.throws(() => parse(text));
  assert.throws(() => parse('x {'.repeat(34) + '}'.repeat(34)), /nesting/);
});
test("treats prototype-like keys as plain data", () => {
  const data = parse('"__proto__" { "polluted" "true" }');
  assert.equal(Object.getPrototypeOf(data), null);
  assert.equal(data.__proto__.polluted, "true");
  assert.equal({}.polluted, undefined);
});
