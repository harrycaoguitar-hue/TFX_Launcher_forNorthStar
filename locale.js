"use strict";
const supported = Object.freeze(["zh-CN", "zh-TW", "en-US", "de-DE", "fr-FR"]);
function normalize(value, fallback = "en-US") {
  if (typeof value !== "string") return supported.includes(fallback) ? fallback : "en-US";
  const tag = value.trim().replace(/_/g, "-");
  if (/^zh(?:-(?:TW|HK|MO|Hant)(?:-|$))/i.test(tag)) return "zh-TW";
  if (/^zh(?:-|$)/i.test(tag)) return "zh-CN";
  if (/^en(?:-|$)/i.test(tag)) return "en-US";
  if (/^de(?:-|$)/i.test(tag)) return "de-DE";
  if (/^fr(?:-|$)/i.test(tag)) return "fr-FR";
  return supported.includes(fallback) ? fallback : "en-US";
}
function systemDefault(systemLanguage) {
  return typeof systemLanguage === "string" && /^zh(?:[-_]|$)/i.test(systemLanguage) ? normalize(systemLanguage) : "en-US";
}
function detectSystemLanguage(app) {
  for (const read of [() => app?.getPreferredSystemLanguages?.()?.[0], () => app?.getSystemLocale?.(), () => Intl.DateTimeFormat().resolvedOptions().locale]) {
    try {const value = read(); if (typeof value === "string" && value) return value;} catch (_) {}
  }
  return "en-US";
}
module.exports = {supported, normalize, systemDefault, detectSystemLanguage};
