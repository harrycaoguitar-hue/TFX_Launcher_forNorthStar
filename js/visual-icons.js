/* Original orbital/faceted glyphs for the launcher. No icon-font dependency.
 * Decoration is visual only: labels, disabled state and action handlers stay on
 * the original controls. The observer only watches the three dynamic lists. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const glyphs = Object.freeze({
    vtf: '<path d="m4 7 8-4 8 4-8 5Z"/><path d="M4 11v6l8 4 8-4v-6M12 12v9"/><path d="m8 8 5-2 3 2-5 2Z"/><path class="nv-facet" d="m16 13 4-2v4l-4 2Z"/>',
    home: '<path d="m4 10 6-6h9l2 4-6 6H6Z"/><path d="M4 14v5h12l4-4"/><path class="nv-facet" d="m10 8 3-1 2 2-3 3-2-1Z"/>',
    cube: '<path d="m4 9 7-5 9 3-7 5Z"/><path d="m4 13 9 3 7-5M4 17l9 3 7-5"/><path class="nv-facet" d="m10 7 4 1-3 2-3-1Z"/>',
    texture: '<path d="m4 8 7-4 9 4v8l-7 4-9-4Z"/><path d="m5 14 10-6M9 18l10-6M5 10l7-4"/><path class="nv-facet" d="m14 17 4-2v2l-4 2Z"/>',
    shop: '<path d="M5 8c2-4 9-6 13-2M20 10c1 5-5 10-10 10M5 17c-2-2-2-5-1-7"/><path d="m7 13 4-5 6 3-4 5Z"/><path class="nv-facet" d="m18 4 3 2-2 3-3-2ZM3 16l3 1-1 3-3-1Z"/>',
    settings: '<path d="m5 5 5 2M14 9l5 2M5 13l6 2M15 17l4 2"/><path d="m10 4 4 2-2 4-4-2ZM11 12l4 2-2 4-4-2Z"/><path class="nv-facet" d="m18 3 3 2-2 3-3-2Z"/>',
    folder: '<path d="m4 8 5-4h7l4 4-4 4H4v8h13l4-5v-3"/><path d="M5 16h11l3-3M11 8h8"/><path class="nv-facet" d="m4 8 3 1 2-2-3-1Z"/>',
    arrow: '<path d="M3 16 17 8M11 6l9 1-3 9"/><path class="nv-facet" d="m3 10 5-2-2 5Z"/>',
    external: '<path d="M4 9v10h11l3-3M9 4H5l-1 1M11 13l9-9M14 4h6v6"/><path class="nv-facet" d="m5 13 3-1 2 2-3 3-2-1Z"/>',
    cross: '<path d="M7 4 3 8v7l4 5M17 4l4 4v7l-4 5M9 3h6M9 21h6"/><path d="m8 12 4-5 4 5-4 5Z"/><path class="nv-facet" d="m11 11 2-1 1 2-2 2-1-1Z"/>',
    upload: '<path d="m6 9 6-5 6 5M12 4v11M4 14v5l4 2h8l4-2v-5"/><path class="nv-facet" d="m6 14 3 1-2 3-3-1Z"/>',
    clock: '<path d="M9 3h6l6 6v6l-6 6H9l-6-6V9l3-3"/><path d="M12 7v6l5 2"/><path class="nv-facet" d="m5 4 3-1 1 3-3 1Z"/>',
    check: '<path d="m4 12 6 6L20 6M4 8l3-3h6M20 12v4l-5 5"/><path class="nv-facet" d="m7 11 3 1-1 3-3-1Z"/>',
    backup: '<path d="M5 9 9 4h7l5 5v7l-5 5H9l-4-4M3 5v6h6M12 8v5l4 2"/><path class="nv-facet" d="m16 17 3-1-1 3-3 1Z"/>',
    search: '<path d="m5 4 7-1 5 5-1 7-7 2-6-5Z"/><path d="m16 16 5 5M7 8l4-2M6 11l3 3"/><path class="nv-facet" d="m18 14 3 1-1 3-3-1Z"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v4l4 2h8l4-2v-4"/><path class="nv-facet" d="m5 5 3-1-1 4-3 1Z"/>',
    trash: '<path d="m5 7 14-2M8 4l6-1M6 10l2 10h8l2-10M10 11v5M14 10v6"/><path class="nv-facet" d="m19 16 3-1-1 3-3 1Z"/>',
    refresh: '<path d="M5 8 9 4h7l5 5M19 16l-4 4H8l-5-5M21 4v5h-5M3 20v-5h5"/><path class="nv-facet" d="m10 10 3-1 2 2-3 3-2-1Z"/>',
    minimize: '<path d="M4 15h6l2 2h8M4 18h4"/>',
    close: '<path d="m5 5 14 14M19 5 5 19M5 5v4M19 15v4"/>',
    save: '<path d="m4 8 5-4h7l4 4v8l-5 5H8l-4-5Z"/><path d="m8 12 3 3 6-7M5 17l4-2"/><path class="nv-facet" d="m16 4 3 3-3 1-2-2Z"/>',
    restart: '<path d="M5 8 9 4h7l5 5v7l-5 5H9l-5-5M3 4v6h6"/><path d="m11 9 5 3-5 3Z"/>',
    network: '<path d="m4 7 8-4 8 4M7 11l5-3 5 3M10 15l2-1 2 1"/><path class="nv-facet" d="m10 19 2-2 2 2-2 2Z"/>',
    sweep: '<path d="m5 16 7-8 7 5-5 7H7ZM12 8l5-5M8 13l7 5M3 21h17"/><path class="nv-facet" d="m18 5 3-1-1 3-3 1Z"/>',
    palette: '<path d="m4 8 7-4 9 4v8l-7 4-9-4Z"/><path d="m4 8 9 4 7-4M13 12v8M8 6v4M17 6v5"/><path class="nv-facet" d="m7 13 3 1v3l-3-1Z"/>',
    stop: '<path d="m6 4 12 2 2 12-12 2-4-6Z"/><path class="nv-facet" d="m9 9 6 1-1 5-5-1Z"/>',
    toggle: '<path d="m3 10 5-5h10l3 5-5 9H6Z"/><path d="m6 11 3-3 4 3-3 4Z"/><path d="M17 9v4"/>',
    down: '<path d="m5 7 7 8 7-8M9 18h6"/>',
    game: '<path d="m4 9 5-5h7l4 5v8l-4 4H9l-5-4ZM9 8l3 4-3 4M15 8v8"/><path class="nv-facet" d="m17 17 2-1v2l-2 2Z"/>',
    filter: '<path d="m4 5 7 7v7l3 2v-9l6-7M6 8h12"/><path class="nv-facet" d="m15 3 3-1 2 2-3 1Z"/>'
  });
  const brand = '<path class="nv-brand-orbit" d="M53 28c2 11-10 24-25 26M12 38C7 24 19 11 35 9"/><path class="nv-brand-main" d="m18 15 25-2 8 10-23 25-10-7 19-19-14 1Z"/><path class="nv-brand-veil" d="m28 48 23-25-8-10-6 9 6 3-24 21Z"/><path class="nv-brand-shard" d="m9 43 7-3 5 5-7 5Z"/>';

  function create(name, className = '') {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('data-nv-glyph', name);
    svg.classList.add('fold-icon', 'nv-icon');
    if (className) className.split(/\s+/).filter(Boolean).forEach(value => svg.classList.add(value));
    svg.innerHTML = glyphs[name] || glyphs.cross;
    return svg;
  }

  function definitions() {
    let defs = document.querySelector('.fold-svg-defs defs');
    if (!defs) {
      const host = document.createElementNS(NS, 'svg');
      host.classList.add('fold-svg-defs'); host.setAttribute('aria-hidden', 'true');
      defs = document.createElementNS(NS, 'defs'); host.append(defs); document.body.prepend(host);
    }
    for (const [name, paths] of Object.entries(glyphs)) {
      let symbol = document.getElementById('i-' + name);
      if (!symbol) { symbol = document.createElementNS(NS, 'symbol'); symbol.id = 'i-' + name; defs.append(symbol); }
      symbol.setAttribute('viewBox', '0 0 24 24');
      symbol.innerHTML = paths;
    }
    for (const host of document.querySelectorAll('.fold-brand-emblem')) {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true');
      svg.classList.add('nv-brand-mark'); svg.innerHTML = brand; host.replaceChildren(svg);
    }
    document.body.classList.add('nv-custom-icons');
  }

  function decorate(button, name, replace = false) {
    if (!button || button.classList.contains('switch') || button.classList.contains('visual')) return;
    const existing = Array.from(button.children).find(node => node.getAttribute('data-nv-glyph'));
    if (existing && existing.getAttribute('data-nv-glyph') === name) return;
    if (existing) existing.remove();
    if (replace) button.replaceChildren(create(name));
    else {
      const prior = button.querySelector('svg');
      if (prior) prior.replaceWith(create(name));
      else button.prepend(create(name));
    }
    button.classList.add('nv-icon-control');
  }

  const imageNames = Object.freeze({
    apply: 'save', check: 'check', close: 'close', down: 'down', download: 'download', downloads: 'download',
    filter: 'filter', game: 'game', minimize: 'minimize', open: 'external', redo: 'restart', search: 'search',
    settings: 'settings', toggles: 'toggle', trash: 'trash', updates: 'refresh'
  });

  function decorateImages(root) {
    const images = root.matches && root.matches('img') ? [root] : Array.from(root.querySelectorAll('button img,#options summary .title img'));
    for (const img of images) {
      if (!img.closest('button,#options summary .title')) continue;
      const match = /(?:^|\/)icons\/([a-z-]+)\.png(?:[?#].*)?$/i.exec(img.getAttribute('src') || '');
      const name = match && imageNames[match[1].toLowerCase()];
      if (!name) continue;
      const icon = create(name);
      icon.classList.add(img.closest('summary') ? 'nv-category-icon' : 'nv-legacy-action-icon');
      if (img.closest('button')) img.closest('button').classList.add('nv-icon-control');
      img.replaceWith(icon);
    }
  }

  const staticControls = Object.freeze({
    minimize: ['minimize', true], close: ['close', true], ddsClearPackage: ['close', true],
    playNsBtn: ['arrow'], playTfBtn: ['arrow'], toggleall: ['toggle'], removeall: ['trash'],
    ddsRefresh: ['refresh'], ddsSelectFolder: ['folder'], apply: ['save'], filter: ['filter']
  });
  const actionGlyphs = Object.freeze({
    delete_request_cache: 'sweep', force_update_ns: 'refresh', delete_install_cache: 'sweep',
    set_system_dns: 'network', flush_dns_cache: 'sweep', relaunch: 'restart', reset_config: 'backup',
    open_gamepath: 'folder', kill_game: 'stop', kill_origin: 'stop', setpath: 'folder',
    acknowledge_ns_notice: 'check', installmod: 'upload'
  });

  function staticActions() {
    for (const [id, [name, replace]] of Object.entries(staticControls)) decorate(document.getElementById(id), name, replace);
    for (const button of document.querySelectorAll('button[onclick]')) {
      if (button.querySelector('svg') || button.classList.contains('switch')) continue;
      const action = button.getAttribute('onclick') || '';
      const functionName = (action.match(/^\s*([a-z_]+)\s*\(/i) || [])[1];
      if (actionGlyphs[functionName]) decorate(button, actionGlyphs[functionName]);
      else if (button.classList.contains('fold-icon-button') && button.textContent.trim() === '×') decorate(button, 'close', true);
      else if (button.textContent.trim() === '取消') decorate(button, 'close');
    }
    for (const button of document.querySelectorAll('.dns-select-toggle')) decorate(button, 'down');
    for (const button of document.querySelectorAll('.fold-mode button')) decorate(button, button.dataset.mode === 'vanilla' ? 'game' : 'cross');
  }

  function dynamicActions(root) {
    decorateImages(root);
    const buttons = root.matches && root.matches('button') ? [root] : Array.from(root.querySelectorAll('button'));
    for (const button of buttons) {
      if (button.closest('#ddsBackupList,#vtfBackupList')) {
        const glyph = {delete:'trash','confirm-delete':'trash','cancel-delete':'close',restore:'backup'}[button.dataset.backupAction];
        if (glyph) decorate(button,glyph);
        else if (button.classList.contains('backup-history-toggle')) decorate(button,'down');
      }
      else if (button.id === 'loadmore') decorate(button, 'down');
      else if (button.closest('#modsdiv,#browserEntries') && !button.querySelector('svg')) {
        if (button.classList.contains('remove')) decorate(button, 'trash');
        else if (button.classList.contains('update')) decorate(button, 'refresh');
        else if (button.classList.contains('install')) decorate(button, button.classList.contains('downloading') ? 'close' : 'download');
        else if (button.classList.contains('info')) decorate(button, 'external');
      }
    }
  }

  function init() {
    definitions(); decorateImages(document); staticActions();
    const pending = new Set(); let scheduled = false;
    const flush = () => {
      scheduled = false;
      for (const root of pending) if (root.isConnected) dynamicActions(root);
      pending.clear();
    };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        // Added glyph children do not schedule another pass.
        const onlyGlyphs = Array.from(record.addedNodes).every(node => node.nodeType !== 1 || node.namespaceURI === NS);
        const textOnlyButton = record.target.nodeType === 1 && record.target.matches('button') && !record.target.querySelector('svg');
        if (onlyGlyphs && !textOnlyButton) continue;
        if (record.target.nodeType === 1) pending.add(record.target);
      }
      if (pending.size && !scheduled) { scheduled = true; queueMicrotask(flush); }
    });
    for (const id of ['modsdiv', 'browserEntries', 'ddsBackupList', 'vtfBackupList']) {
      const root = document.getElementById(id);
      if (root) { dynamicActions(root); observer.observe(root, {childList: true, subtree: true}); }
    }
    window.VyraIcons = Object.freeze({create, names: Object.freeze(Object.keys(glyphs)), decorate: staticActions});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
