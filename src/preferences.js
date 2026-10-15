"use strict";
const {normalize: normalizeLocale} = require("./locale");
const themes = new Set(["aurora", "abyss", "nebula", "sakura", "ember", "grove", "sandstone", "graphite", "glacier", "mist"]);
const sorts = new Set(["added", "name", "enabled"]);
const excludes = Object.freeze(["ns_startup_args.txt", "ns_startup_args_dedi.txt"]);

// Read old preferences defensively; a malformed optional value must not prevent
// opening Settings to correct it. Unknown extension fields remain compatible.
function normalize(value, defaultLocale = "en-US") {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...data,
    gamepath: typeof data.gamepath === "string" ? data.gamepath : "",
    theme: themes.has(data.theme) ? data.theme : "aurora",
    uiLanguage: normalizeLocale(data.uiLanguage || data.lang || data.forcedlang, defaultLocale),
    modSort: sorts.has(data.modSort) ? data.modSort : "added",
    northstarRegion: data.northstarRegion === "global" ? "global" : "cn",
    independentServerMods: data.independentServerMods === true,
    exitAfterLaunch: data.exitAfterLaunch === true,
    originkill: data.originkill === true,
    nsupdate: data.nsupdate !== false,
    nsargs: typeof data.nsargs === "string" ? data.nsargs : "-multiple",
    excludes: Array.isArray(data.excludes) && data.excludes.every(item => typeof item === "string") ? [...data.excludes] : [...excludes]
  };
}
module.exports = {normalize};
