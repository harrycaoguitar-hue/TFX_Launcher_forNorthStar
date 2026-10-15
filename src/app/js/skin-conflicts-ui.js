/* A read-only view of the installer's plan. No game files are read by this UI. */
(() => {
  'use strict';
  const views = new Map();
  const t = key => I18n.t('conflict.' + key);
  const actionKeys = {'replace':'replace','restore':'restore','mod-conflict':'mods'};
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function ensure(format) {
    if (views.has(format)) return views.get(format);
    const summary = document.getElementById(format + 'Summary');
    if (!summary) return null;
    const panel = node('section','skin-conflict-preview');
    panel.id = format + 'ConflictPreview';
    panel.setAttribute('data-i18n-ignore','');
    panel.setAttribute('aria-labelledby',format + 'ConflictTitle');
    const heading = node('div','skin-conflict-heading');
    const title = node('h4'); title.id = format + 'ConflictTitle';
    const state = node('span','skin-conflict-state');
    heading.append(title,state);
    const intro = node('p','skin-conflict-intro');
    const counts = node('div','skin-conflict-counts');
    const warnings = node('ul','skin-conflict-warnings');
    const details = node('details','skin-conflict-details');
    const toggle = node('summary');
    const list = node('div','skin-conflict-resources');
    const note = node('p','skin-conflict-note');
    details.append(toggle,list);panel.append(heading,intro,counts,warnings,details,note);
    summary.querySelector('.fold-dds-stat-row')?.after(panel);
    const view = {panel,title,state,intro,counts,warnings,details,toggle,list,note,selection:null};
    views.set(format,view);return view;
  }
  function render(format, state) {
    const view = ensure(format);if (!view) return;
    const pkg = state?.package;
    view.panel.hidden = !pkg;
    if (!pkg) { view.selection=null;view.details.open=false;return; }
    if (view.selection !== pkg.id) {view.details.open=false;view.selection=pkg.id;}
    const supplied = state.conflictPreview;
    const preview = supplied?.packageId === pkg.id && supplied?.format?.toLowerCase() === format ? supplied : null;
    view.title.textContent=t('title');view.intro.textContent=t('intro');
    view.toggle.textContent=t('details');view.note.textContent=t('note');
    view.panel.dataset.state=preview?.blocked?'blocked':preview?.complete?'ready':'partial';
    view.state.textContent=t(preview?.blocked?'blocked':preview?.complete?'ready':'partial');
    view.counts.replaceChildren();view.warnings.replaceChildren();view.list.replaceChildren();
    if (!preview) {
      view.counts.hidden=true;view.details.hidden=true;
      view.warnings.append(node('li','',t('unavailable')));return;
    }
    view.counts.hidden=false;view.details.hidden=false;
    for (const [key, label] of [['replace','replace'],['restore','restore'],['modConflicts','mods']]) {
      const cell=node('div');
      cell.append(node('strong','',String(Math.max(0,Number(preview.counts?.[key])||0))),node('span','',t(label)));
      view.counts.append(cell);
    }
    for (const warning of preview.warnings||[]) {
      const known = ['unknown-weapon','unmanaged-resources','mod-scan-incomplete','plan-unavailable','preview-truncated','profile-unavailable','game-unavailable','plan-size-limit','needs-repair','runtime-mods-unchecked'].includes(warning.code);
      view.warnings.append(node('li','',t(known?warning.code:'unknown-warning')));
    }
    if (!preview.complete && !view.warnings.childElementCount) view.warnings.append(node('li','',t('partial')));
    // The installer status presents the detailed localized error. Keep this
    // panel's warning bounded and translatable rather than exposing raw paths.
    if (preview.blocked && !view.warnings.childElementCount) view.warnings.append(node('li','',t('plan-unavailable')));
    view.warnings.hidden=!view.warnings.childElementCount;
    const items=Array.isArray(preview.items)?preview.items:[];
    for (const item of items) {
      const row=node('div','skin-conflict-resource');row.dataset.action=item.action;
      const body=node('div');
      const label=format==='dds'&&typeof item.name==='string'&&item.name?item.name:item.resource||'—';
      const name=node('strong','',label);name.title=item.resource||label;body.append(name);
      if(label!==item.resource&&item.resource)body.append(node('small','',item.resource));
      if(item.modName)body.append(node('small','',item.modName));
      row.append(body,node('span','skin-conflict-action',t(actionKeys[item.action]||'partial')));view.list.append(row);
    }
    if (!items.length)view.list.append(node('p','skin-conflict-empty',t('empty')));
  }
  window.SkinConflictPreview=Object.freeze({render});
})();
