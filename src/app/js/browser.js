/* TFX community catalog. Metadata comes from Thunderstore; all view state is local. */
var packages = [];
var mod_versions = Object.create(null);
var catalog_loaded = false;
var Browser;

function normalize(value) {
  const compact = entry => String(entry ?? "").normalize("NFKC").replace(/[\s._-]+/gu, "").toLowerCase();
  return Array.isArray(value) ? value.map(compact) : compact(value);
}

(() => {
  "use strict";
  const panel = document.getElementById("browser");
  const entries = document.getElementById("browserEntries");
  const input = panel.querySelector(".search");
  const filterPanel = document.getElementById("filters");
  const filterButton = document.getElementById("filter");
  const choices = [...filterPanel.querySelectorAll(".check")];
  const state = {request:null, error:false, query:"", models:[], results:[], shown:0, active:null, detail:null};
  const toastKeys = new Map();
  const localMatches = new Map();
  const cardModels = new WeakMap();
  const words = text => String(text ?? "").normalize("NFKC").toLocaleLowerCase();
  const identity = (owner, name) => String(owner ?? "") + "/" + String(name ?? "");
  const copy = (key, fallback) => window.I18n ? I18n.t(key) : fallback;
  const legacy = key => lang("gui." + key);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function urlAllowed(value, purpose) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return false;
      return purpose === "image" || ["thunderstore.io", "northstar.thunderstore.io"].includes(url.hostname);
    } catch { return false; }
  }

  function modelFor(data) {
    const latest = Array.isArray(data?.versions) ? data.versions[0] : data?.pkg || data;
    if (!latest) return null;
    const owner = String(data.owner || data.author || latest.owner || "");
    const name = String(data.name || data.title || latest.name || "");
    const versionNumber = String(data.version || latest.version_number || "").replace(/^v/, "");
    if (!owner || !name || !versionNumber) return null;
    return {
      source:data, id:identity(owner, name), owner, name, version:versionNumber,
      description:String(data.description || latest.description || ""),
      image:data.image || latest.icon || "", website:data.url || data.package_url || latest.package_url || "",
      download:data.download || latest.download_url || "",
      categories:Array.isArray(data.categories) ? data.categories : [],
      search:words([owner, name, data.full_name, latest.description].filter(Boolean).join(" "))
    };
  }

  function accepts(categories) {
    const enabled = new Set(choices.filter(choice => choice.classList.contains("checked")).map(choice => choice.getAttribute("value")));
    if (!enabled.size) return false;
    const content = categories.filter(category => category === "Mods" || category === "Skins");
    const runtime = categories.filter(category => category === "Client-side" || category === "Server-side");
    return (content.length ? content.some(category => enabled.has(category)) : enabled.has("Mods"))
      && (runtime.length ? runtime.some(category => enabled.has(category)) : enabled.has("Client-side") || enabled.has("Server-side"));
  }

  function selection() {
    const terms = words(state.query).split(/\s+/u).filter(Boolean);
    const selected = state.models.filter(model => accepts(model.categories));
    if (!terms.length) return selected;
    return selected.filter(model => terms.every(term => model.search.includes(term)))
      .sort((a, b) => Number(words(b.name).startsWith(terms[0])) - Number(words(a.name).startsWith(terms[0])));
  }

  function notice(message, retry = false) {
    entries.replaceChildren();
    const node = element("div", "loading", message);
    if (retry) {
      const button = element("button", "fold-button compact", copy("browser.retry", "Retry"));
      button.type = "button";
      button.addEventListener("click", () => Browser.loadfront());
      node.append(button);
    }
    entries.append(node);
  }

  function labelButton(button, label, icon) {
    button.replaceChildren();
    if (icon) {
      const image = element("img");
      image.src = "icons/" + icon + ".png";
      image.alt = "";
      button.append(image);
    }
    button.append(element("span", "", label));
  }

  function updateAction(button, model) {
    const active = state.active;
    const ownsJob = active?.id === model.id;
    button.disabled = Boolean(active && !ownsJob);
    button.classList.toggle("disabled", button.disabled);
    button.classList.toggle("downloading", ownsJob);
    button.title = ownsJob ? legacy("browser.cancel_hint") : "";
    if (ownsJob) {
      if (Number.isFinite(active.progress) && active.progress >= 0) button.style.setProperty("--progress", Math.min(100, active.progress) + "%");
      else button.style.removeProperty("--progress");
      const phase = {resolving:"browser.resolving", connecting:"browser.connecting", extracting:"browser.preparing", verifying:"browser.checkingPackage", installing:"browser.installing"}[active.phase];
      const status = phase ? copy(phase, "Installing") : legacy("browser.downloading");
      const amount = active.progress >= 0 ? Math.min(100, active.progress) + "%" : formatBytes(active.received);
      labelButton(button, active.phase && active.phase !== "downloading" ? status : copy("browser.downloadProgress", "Downloading {amount}").replaceAll("{amount}",amount), "close");
      return;
    }
    button.style.removeProperty("--progress");
    const local = localMatches.get(model.id);
    labelButton(button, local ? legacy(local.has_update ? "browser.update" : "browser.reinstall") : copy("browser.install", legacy("browser.install")), local && !local.has_update ? "redo" : "downloads");
  }

  function refreshActions() {
    for (const card of entries.querySelectorAll(".el")) {
      const model = cardModels.get(card);
      if (model) updateAction(card.querySelector(".install"), model);
    }
    if (state.detail && !state.detail.node.hidden) updateAction(state.detail.node.querySelector(".browser-detail-install"), state.detail.model);
  }

  function activate(model) {
    if (state.active) {
      if (state.active.id === model.id && !state.active.cancelling) {
        state.active.cancelling = true;
        ipcRenderer.send("cancel-download", state.active.name);
      }
      return false;
    }
    if (!urlAllowed(model.download, "download")) return false;
    state.active = {id:model.id, name:model.name, progress:-1, received:0, phase:"resolving", cancelling:false};
    setButtons(false);
    refreshActions();
    ipcRenderer.send("install-from-url", model.download, model.owner, model.name, model.version);
    return true;
  }

  function makeCard(model) {
    const card = element("div", "el");
    card.id = "mod-" + encodeURIComponent(model.id).replace(/_/g, "%5F").replace(/%/g, "_");
    card.dataset.packageId = model.id;
    cardModels.set(card, model);
    const artwork = element("div", "image");
    for (const className of ["", "blur"]) {
      const image = element("img", className);
      image.src = urlAllowed(model.image, "image") ? model.image : "icons/no-image.png";
      image.alt = "";
      image.loading = "lazy";
      artwork.append(image);
    }
    const body = element("div", "text");
    const actions = element("div", "browser-card-actions");
    const install = element("button", "install");
    install.type = "button";
    install.addEventListener("click", () => activate(model));
    const details = element("button", "info");
    details.type = "button";
    labelButton(details, copy("browser.details", legacy("browser.view")), "open");
    details.addEventListener("click", () => showDetails(model, details));
    actions.append(install, details);
    const meta = element("div", "browser-card-meta");
    for (const [className, text] of [["version", "v" + model.version], ["author", legacy("browser.made_by") + " " + model.owner]]) {
      const badge = element("button", "visual " + className, text);
      badge.type = "button";
      meta.append(badge);
    }
    const title = element("div", "title", model.name), description = element("div", "description", model.description);
    for (const dynamic of [title, description, ...meta.children]) dynamic.dataset.i18nIgnore = "";
    body.append(title, description, actions, meta);
    card.append(artwork, body);
    updateAction(install, model);
    return card;
  }

  function pagination() {
    entries.querySelector(".message")?.remove();
    if (!state.results.length) return;
    const footer = element("div", "message");
    if (state.shown < state.results.length) {
      const next = element("button", "fold-button compact browser-load-more");
      next.id = "loadmore";
      next.type = "button";
      const label = element("span", "", copy("browser.loadMore", legacy("browser.load_more")));
      label.dataset.i18n = "browser.loadMore";
      next.append(label);
      next.addEventListener("click", appendPage);
      footer.append(next);
    } else {
      footer.dataset.i18n = "browser.allLoaded";
      footer.textContent = copy("browser.allLoaded", legacy("browser.end_of_list"));
    }
    entries.append(footer);
  }

  function appendPage() {
    entries.querySelector(".message")?.remove();
    const next = Math.min(state.results.length, state.shown + Browser.maxentries);
    const fragment = document.createDocumentFragment();
    for (let index = state.shown; index < next; index++) fragment.append(makeCard(state.results[index]));
    state.shown = next;
    entries.append(fragment);
    pagination();
  }

  function renderResults() {
    if (!panel.classList.contains("shown")) return;
    state.results = selection();
    state.shown = 0;
    entries.replaceChildren();
    if (!state.results.length) notice(legacy("browser.no_results"));
    else appendPage();
  }

  function closeDetails() {
    if (!state.detail || state.detail.node.hidden) return;
    state.detail.node.hidden = true;
    entries.hidden = false;
    panel.querySelector(".misc").classList.remove("hidden");
    window.VyraMotion?.cancel(state.detail.node);
    if (panel.classList.contains("shown")) window.VyraMotion?.reveal(entries, {offset:4, duration:200});
    if (state.detail.trigger?.isConnected) state.detail.trigger.focus({preventScroll:true});
  }

  function detailSection() {
    const node = element("section", "browser-package-detail");
    node.setAttribute("role", "region");
    node.setAttribute("aria-labelledby", "browserDetailTitle");
    const back = element("button", "fold-button compact browser-detail-back");
    back.type = "button";
    back.dataset.i18n = "browser.back";
    back.addEventListener("click", closeDetails);
    const heading = element("div", "browser-detail-header");
    const image = element("img"); image.alt = "";
    const description = element("div");
    const title = element("h3"); title.id = "browserDetailTitle";
    description.append(title, element("p", "browser-detail-byline"));
    heading.append(image, description);
    const hint = element("p", "browser-detail-hint"); hint.dataset.i18n = "browser.detailHint";
    const actions = element("div", "browser-detail-actions");
    const install = element("button", "fold-button fold-primary browser-detail-install disable-when-installing"); install.type = "button";
    const external = element("button", "fold-button browser-detail-external"); external.type = "button"; external.dataset.i18n = "browser.website";
    actions.append(install, external);
    node.append(back, heading, element("p", "browser-detail-description"), hint, actions);
    for (const selector of ["h3", ".browser-detail-byline", ".browser-detail-description"]) node.querySelector(selector).dataset.i18nIgnore = "";
    panel.append(node);
    return node;
  }

  function showDetails(model, trigger) {
    const node = state.detail?.node || detailSection();
    state.detail = {node, model, trigger};
    node.querySelector("h3").textContent = model.name;
    node.querySelector(".browser-detail-byline").textContent = model.owner + " · v" + model.version;
    node.querySelector(".browser-detail-description").textContent = model.description;
    node.querySelector("img").src = urlAllowed(model.image, "image") ? model.image : "icons/no-image.png";
    node.querySelector(".browser-detail-install").onclick = () => activate(model);
    const external = node.querySelector(".browser-detail-external");
    external.hidden = !urlAllowed(model.website, "website");
    external.onclick = () => {if (urlAllowed(model.website, "website")) fold.openExternal(model.website);};
    entries.hidden = true;
    panel.querySelector(".misc").classList.add("hidden");
    node.hidden = false;
    window.I18n?.apply(node);
    refreshActions();
    window.VyraMotion?.cancel(entries);
    window.VyraMotion?.reveal(node, {offset:4, duration:200});
    node.querySelector(".browser-detail-back").focus({preventScroll:true});
  }

  function reconcile() {
    localMatches.clear();
    mod_versions = Object.create(null);
    const snapshot = Array.isArray(modsobj?.all) ? modsobj.all : [];
    const indexed = new Map(), loose = new Map();
    for (const mod of snapshot) {
      const collection = mod.package ? indexed : loose;
      const id = mod.package ? identity(mod.package.author, mod.package.package_name) : normalize(mod.manifest_name || mod.name);
      if (!collection.has(id)) collection.set(id, []);
      collection.get(id).push(mod);
    }
    for (const model of state.models) {
      const entry = model.source;
      const local = [...(indexed.get(model.id) || []), ...(loose.get(normalize(model.name)) || [])];
      if (!local.length) continue;
      const info = {has_update:local.some(mod => version.is_newer(model.version, mod.package?.manifest?.version_number || mod.version)), local_version:local[0].version, local_name:local[0].name, package:entry, install:() => activate(model)};
      localMatches.set(model.id, info);
      mod_versions[model.id] = info;
      for (const mod of local) if (!mod.package) mod_versions[normalize(mod.name)] = info;
    }
    refreshActions();
  }

  async function loadCatalog() {
    if (!catalog_loaded) {
      if (!state.request) {
        state.request = (async () => {
          const response = await request("northstar.thunderstore.io", "/api/v1/package/", "thunderstore-packages");
          const parsed = typeof response === "string" ? JSON.parse(response) : response;
          if (!Array.isArray(parsed)) throw new Error("Invalid community catalog");
          packages = parsed;
          state.models = packages.map(modelFor).filter(Boolean);
          catalog_loaded = true;
          reconcile();
          if (window.mods?.latest) mods.load(mods.latest);
        })().finally(() => {state.request = null;});
      }
      await state.request;
    }
  }

  function hideFilters() {filterPanel.classList.remove("shown");}
  function toggleFilters(show) {
    const visible = show === undefined ? !filterPanel.classList.contains("shown") : Boolean(show);
    filterPanel.classList.toggle("shown", visible);
    if (!visible) return;
    const bounds = filterButton.getBoundingClientRect();
    filterPanel.style.top = bounds.bottom + 8 + "px";
    filterPanel.style.right = Math.max(12, window.innerWidth - bounds.right) + "px";
  }

  Browser = {
    maxentries:50,
    filters:{
      get:() => ({unfiltered:choices.filter(choice => choice.classList.contains("checked")).map(choice => choice.getAttribute("value")), filtered:choices.filter(choice => !choice.classList.contains("checked")).map(choice => choice.getAttribute("value"))}),
      isfiltered:categories => !accepts(Array.isArray(categories) ? categories : []),
      getpkgs:() => packages.filter(entry => accepts(entry.categories || [])),
      toggle:toggleFilters
    },
    toggle(show) {
      if (show && !localStorage.getItem("ns_notice_ack")) {popups.show("#nsnotice"); return;}
      popups.set("#browser", Boolean(show));
      if (!show) {closeDetails(); hideFilters(); return;}
      if (!catalog_loaded || !entries.querySelector(".el")) return Browser.loadfront();
      refreshActions();
    },
    async loadfront() {
      state.error = false;
      if (!catalog_loaded) notice(legacy("browser.loading"));
      try {await loadCatalog(); renderResults(); return true;}
      catch (error) {
        state.error = true;
        console.warn("Community catalog:", error?.message || error);
        if (panel.classList.contains("shown")) notice(copy("browser.loadFailed", "Could not load community mods. Try again."), true);
        return false;
      }
    },
    async search(value) {state.query = String(value ?? ""); return Browser.loadfront();},
    install(data) {const model = modelFor(data); return model ? activate(model) : false;},
    closeDetails,
    showDetails(data, entry) {const model = modelFor(data); if (model) showDetails(model, entry?.querySelector(".info"));},
    add_pkg_properties:reconcile,
    lookup(mod) {return mod.package ? localMatches.get(identity(mod.package.author, mod.package.package_name)) : mod_versions[normalize(mod.name)];},
    loading:text => notice(text || legacy("browser.loading")),
    endoflist:pagination,
    loadpkgs:appendPage,
    setbutton() {reconcile();},
    get activeDownload() {return state.active && {...state.active};}
  };

  function formatBytes(value) {
    let amount = Number.isFinite(value) && value > 0 ? value : 0;
    const units = ["B", "KB", "MB", "GB"];
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {amount /= 1024; unit++;}
    return amount.toFixed(unit ? 1 : 0) + " " + units[unit];
  }

  function feedback(key, options) {
    if (toastKeys.has(key)) return;
    toastKeys.set(key, setTimeout(() => toastKeys.delete(key), 3000));
    new Toast(options);
  }

  function finishJob() {
    state.active = null;
    setButtons(true);
    reconcile();
    if (window.mods?.latest) mods.load(mods.latest);
  }

  ipcRenderer.on("pkg-progress", (_event, progress) => {
    if (!state.active || !progress || (progress.root_package_name || progress.package_name) !== state.active.name) return;
    Object.assign(state.active, {progress:progress.progress, received:progress.received, phase:progress.phase || "downloading"});
    refreshActions();
  });
  ipcRenderer.on("set-buttons", () => {if (state.active) refreshActions();});
  ipcRenderer.on("installed-mod", (_event, result) => {
    if (!result) return;
    const name = result.fancy_name || result.name || "";
    if (result.source !== "local") finishJob();
    else {setButtons(true); reconcile(); if (window.mods?.latest) mods.load(mods.latest);}
    if (result.importOrigin === "unified") return;
    if (result.malformed) feedback("malformed:" + name, {scheme:"warning", title:legacy("toast.title.malformed"), description:name + " " + legacy("toast.desc.malformed"), timeout:8000});
    feedback("installed:" + name, {scheme:"success", title:legacy("toast.title.installed"), description:name + " " + legacy("toast.desc.installed")});
  });
  ipcRenderer.on("failed-mod", (_event, result) => {
    const local = result && typeof result === "object" && result.source === "local";
    if (!local) finishJob();
    else if (result.code !== "busy") setButtons(true);
    let description = legacy("toast.desc.failed");
    if (result && typeof result === "object") {
      const key = (local ? "mods.importError." : "mods.catalogError.") + result.code;
      description = window.VyraLocales?.messages?.[key] ? I18n.t(key) : String(result.error || description);
    }
    feedback("failed:" + JSON.stringify(result), {scheme:"error", title:local ? copy("mods.importFailed", legacy("toast.title.failed")) : legacy("toast.title.failed"), description, timeout:10000});
  });
  ipcRenderer.on("download-cancelled", (_event, name) => {
    finishJob();
    feedback("cancelled:" + name, {scheme:"warning", title:legacy("toast.title.cancelled"), description:name + " " + legacy("toast.desc.cancelled"), timeout:5000});
  });
  ipcRenderer.on("removed-mod", () => {setButtons(true); reconcile(); if (window.mods?.latest) mods.load(mods.latest);});
  const duplicate = (_event, name) => {finishJob(); feedback("duplicate:" + name, {scheme:"warning", title:legacy("toast.title.duped"), description:name + " " + legacy("toast.desc.duped"), timeout:10000});};
  ipcRenderer.on("duped-mod", duplicate);
  ipcRenderer.on("legacy-duped-mod", duplicate);
  ipcRenderer.on("no-internet", () => {finishJob(); feedback("offline", {scheme:"error", title:legacy("toast.title.no_internet"), description:legacy("toast.desc.no_internet"), timeout:10000});});

  let searchTimer;
  input.addEventListener("input", () => {
    hideFilters();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => Browser.search(input.value), 180);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape" && input.value) {
      event.preventDefault();event.stopImmediatePropagation();
      consumeSearchEscape=true;input.value = ""; clearTimeout(searchTimer); Browser.search("");
    }
  });
  let consumeSearchEscape=false;
  document.addEventListener("keyup",event=>{if(event.key==="Escape"&&consumeSearchEscape){consumeSearchEscape=false;event.preventDefault();event.stopImmediatePropagation();}},true);
  window.addEventListener("blur",()=>{consumeSearchEscape=false;});
  choices.forEach(choice => choice.addEventListener("click", () => {choice.classList.toggle("checked"); Browser.loadfront();}));
  document.addEventListener("pointerdown", event => {if (!filterPanel.contains(event.target) && !filterButton.contains(event.target)) hideFilters();});
  panel.addEventListener("scroll", hideFilters, {passive:true});
  window.addEventListener("resize", hideFilters);
  window.addEventListener("vyra-language-changed", () => {
    if (state.error && panel.classList.contains("shown")) notice(copy("browser.loadFailed", "Could not load community mods. Try again."), true);
    else {
      for (const card of entries.querySelectorAll(".el")) {
        const model = cardModels.get(card);
        if (!model) continue;
        labelButton(card.querySelector(".info"), copy("browser.details", legacy("browser.view")), "open");
        card.querySelector(".author").textContent = legacy("browser.made_by") + " " + model.owner;
      }
      refreshActions(); pagination();
      if (state.detail) window.I18n?.apply(state.detail.node);
    }
  });
})();

function acknowledge_ns_notice() {
  localStorage.setItem("ns_notice_ack", "1");
  popups.hide("#nsnotice");
  return Browser.toggle(true);
}
