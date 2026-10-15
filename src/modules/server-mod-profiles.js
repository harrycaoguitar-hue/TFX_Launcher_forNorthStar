"use strict";

// Only enabledmods.json is projected for the selected network. Installed Mod
// folders, plugin binaries and DDS/VTF resources are deliberately shared.
const fs = require("fs"), path = require("path");
const state = require("./mod-enabled-state"), region = require("./northstar-region");
const {splitArguments} = require("./launch-session");
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);
const error = message => Object.assign(Error(message), {code: "MOD_PROFILE_STATE"});
function context(conf) {
  if (!conf.gamepath || !fs.existsSync(conf.gamepath)) return null;
  const profile = region.resolveProfile(conf.gamepath, splitArguments(conf.nsargs || ""));
  if (!fs.existsSync(profile)) return null;
  state.checked(path.join(profile, ".tfx-path-check"));
  return {profile: fs.realpathSync(profile), region: region.normalize(conf.northstarRegion)};
}
function filename(profile) {return path.join(profile, ".tfx-server-mods.json");}
function read(profile) {
  const bytes = state.checked(filename(profile));
  if (!bytes) return {bytes: null, value: null};
  let value; try {value = JSON.parse(bytes.toString("utf8"));} catch (_) {throw error("Independent Mod settings are invalid; the original files were preserved.");}
  if (!Buffer.from(bytes.toString("utf8")).equals(bytes) || value?.schemaVersion !== 1 || typeof value.profile !== "string" || path.resolve(value.profile).toLowerCase() !== path.resolve(profile).toLowerCase() || !["cn", "global"].includes(value.activeRegion)) throw error("Independent Mod settings do not match the selected profile.");
  for (const server of ["cn", "global"]) {
    const choices = value[server];
    if (!choices || typeof choices !== "object" || Array.isArray(choices) || Object.keys(choices).length > 12000 || Object.entries(choices).some(([name, on]) => !name || /[\x00-\x1f]/.test(name) || typeof on !== "boolean")) throw error("Independent Mod choices are invalid; the original files were preserved.");
  }
  return {bytes, value};
}
function choices(document, mods, fallback) {
  const selected = Object.create(null);
  for (const mod of mods) {
    // A Mod version upgrade keeps this server's choice by Mod identity. An
    // exact current version wins; a unique older choice is a safe fallback.
    let on = state.enabled(document, mod.name, mod.version);
    if (document.format === "versioned" && own(document.states, mod.name) && !own(document.states[mod.name], mod.version)) {
      const values = Object.values(document.states[mod.name]);
      if (values.length && values.every(value => value === values[0])) on = values[0];
      else if (fallback && own(fallback, mod.name)) on = fallback[mod.name];
      else if (values.length) throw Object.assign(Error("This Mod has conflicting historical version choices. Set its current version explicitly before enabling independent server Mods: " + mod.name), {code: "AMBIGUOUS_MOD_PROFILE"});
    }
    on = mod.required || on;
    if (own(selected, mod.name) && selected[mod.name] !== on) throw Object.assign(Error("Multiple installed versions of this Mod have different enabled states. Remove the duplicate before enabling independent server Mods: " + mod.name), {code: "AMBIGUOUS_MOD_PROFILE"});
    selected[mod.name] = on;
  }
  return selected;
}
function project(value, selectedRegion, mods) {
  if (state.CORE_NAMES.some(name => mods.filter(mod => mod.name === name).length > 1)) throw error("Duplicate Northstar core Mods were found. Remove duplicate core Mods first.");
  const document = state.parse(selectedRegion === "cn" ? {} : {Version: 1});
  for (const mod of mods) state.set(document, mod.name, mod.version, mod.required || value[selectedRegion][mod.name] === true);
  return document;
}
function reconcile(value, document, mods, activeRegion) {
  const observed = choices(document, mods, value[activeRegion]), other = activeRegion === "cn" ? "global" : "cn";
  for (const [name, on] of Object.entries(observed)) {
    Object.defineProperty(value[activeRegion], name, {value: on, enumerable: true, writable: true, configurable: true});
    if (!own(value[other], name)) Object.defineProperty(value[other], name, {value: false, enumerable: true, writable: true, configurable: true});
  }
  for (const mod of mods.filter(mod => mod.required)) for (const server of ["cn", "global"]) value[server][mod.name] = true;
}
function plansFor(before, next) {
  if (!before.independentServerMods && !next.independentServerMods) return [];
  const oldContext = context(before), nextContext = context(next), plans = new Map();
  function load(ctx) {
    if (!ctx) return null;
    if (plans.has(ctx.profile)) return plans.get(ctx.profile);
    const source = read(ctx.profile), file = path.join(ctx.profile, "enabledmods.json"), original = state.checked(file), document = state.parse(original), mods = state.installed(ctx.profile, {requireVersion: true});
    const plan = {ctx, source, file, original, document, mods, value: source.value && JSON.parse(JSON.stringify(source.value)), intended: original};
    plans.set(ctx.profile, plan); return plan;
  }
  if (before.independentServerMods && oldContext) {
    const old = load(oldContext);
    if (!old.value) {const selected = choices(old.document, old.mods); old.value = {schemaVersion: 1, profile: oldContext.profile, activeRegion: oldContext.region, cn: {...selected}, global: {...selected}};}
    // If a process stopped between the Mod-state and preference commits, its
    // marker identifies the live file. Do not attribute that file to the old
    // persisted region and leak choices across the two servers.
    if (old.value.activeRegion === oldContext.region) reconcile(old.value, old.document, old.mods, oldContext.region);
    else {
      old.intended = state.serialize(project(old.value, oldContext.region, old.mods));
      old.value.activeRegion = oldContext.region;
    }
  }
  if (next.independentServerMods && nextContext) {
    const incoming = load(nextContext);
    if (!incoming.value) {
      const selected = choices(incoming.document, incoming.mods);
      incoming.value = {schemaVersion: 1, profile: nextContext.profile, activeRegion: nextContext.region, cn: {...selected}, global: {...selected}};
    } else if (!before.independentServerMods) {
      // Re-enabling adopts the currently shared choices only on the selected
      // side. A previously saved other side remains independent.
      reconcile(incoming.value, incoming.document, incoming.mods, nextContext.region);
    } else if (!oldContext || oldContext.profile !== nextContext.profile) {
      reconcile(incoming.value, incoming.document, incoming.mods, incoming.value.activeRegion);
    }
    incoming.intended = state.serialize(project(incoming.value, nextContext.region, incoming.mods));
    incoming.value.activeRegion = nextContext.region;
  }
  const writes = [];
  for (const plan of plans.values()) if (plan.value) {
    const metadata = Buffer.from(JSON.stringify(plan.value, null, 2) + "\n");
    if (metadata.length > 4 * 1024 * 1024) throw error("Independent Mod settings exceed the supported size limit.");
    if (!same(plan.source.bytes, metadata)) writes.push({file: filename(plan.ctx.profile), before: plan.source.bytes, after: metadata});
    if (!same(plan.original, plan.intended)) writes.push({file: plan.file, before: plan.original, after: plan.intended});
  }
  return writes;
}
function apply(writes, commit = () => {}) {
  const applied = [];
  try {
    for (const write of writes) {state.write(write.file, write.before, write.after); applied.push(write);}
    return commit();
  } catch (failure) {
    for (const write of applied.reverse()) {
      try {
        if (!same(state.checked(write.file), write.after)) throw error("Mod configuration changed during rollback; the recovery data was preserved.");
        if (write.before === null) fs.unlinkSync(write.file); else state.write(write.file, write.after, write.before);
      } catch (rollback) {failure.message += "; " + rollback.message; failure.code = "MOD_PROFILE_ROLLBACK";}
    }
    throw failure;
  }
}
function transition(before, next, commit) {return apply(plansFor(before, next), commit);}
function view(profile, selectedRegion, document) {
  const metadata = read(profile).value;
  return metadata && metadata.activeRegion !== selectedRegion ? project(metadata, selectedRegion, state.installed(profile, {requireVersion: true})) : document;
}
async function prepare(profile, selectedRegion, {guard, coreEnabled = true} = {}) {
  await guard?.();
  const mods = state.installed(profile, {requireVersion: true});
  if (coreEnabled && mods.filter(mod => mod.required).length !== state.CORE_NAMES.length) throw error("Northstar core Mods are incomplete. Repair the selected client first.");
  const conf = {gamepath: profile, nsargs: "-profile .", northstarRegion: selectedRegion, independentServerMods: true};
  // resolveProfile(profile, -profile .) preserves the exact validated profile.
  const writes = plansFor(conf, conf);
  await guard?.();
  return apply(writes, () => ({...state.assertReady(profile, selectedRegion, {coreEnabled}), independent: true, changed: writes.length > 0}));
}
module.exports = {context, filename, read, choices, project, plansFor, apply, transition, view, prepare};
