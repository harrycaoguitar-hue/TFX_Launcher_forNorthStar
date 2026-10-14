/* Shared DDS/VTF history disclosure and in-app delete confirmation. */
(() => {
  'use strict';
  const views = new WeakMap();
  const text = (zh, en) => I18n.current === 'zh-CN' ? zh : I18n.text(en);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function deleteIcon() {
    if (window.VyraIcons) return window.VyraIcons.create('trash');
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');svg.classList.add('fold-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    const glyph=document.createElementNS(ns,'path');glyph.setAttribute('d','m5 7 14-2M8 4l6-1M6 10l2 10h8l2-10M10 11v5M14 10v6');svg.append(glyph);return svg;
  }
  function render(list, records, makeRow, options = {}) {
    const view = views.get(list) || {expanded:false,confirmId:null};
    views.set(list, view);
    view.list = list; view.rows = [...records].sort((a,b) => (Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
    view.makeRow = makeRow; view.options = options;
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.closest('[data-backup-id]')?.dataset.backupId;
    const focusAction = focused?.dataset.backupAction;
    const toggleFocused = focused?.classList.contains('backup-history-toggle');
    if (!view.rows.some(row=>row.id===view.confirmId)) view.confirmId = null;
    list.replaceChildren();
    if (!view.rows.length) {
      const hint = document.createElement('p'); hint.textContent = text('安装后的备份与恢复记录会保存在这里。','Installation backups and restore records will appear here.');
      hint.setAttribute('data-i18n-ignore',''); list.append(hint); return;
    }
    for (const backup of view.rows.slice(0,5)) list.append(makeRow(backup));
    if (view.rows.length > 5) {
      const extra = document.createElement('div'); extra.className = 'backup-history-extra'; extra.id = list.id + 'More'; extra.hidden = !view.expanded;
      if (view.expanded) for (const backup of view.rows.slice(5)) extra.append(makeRow(backup));
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'fold-button compact backup-history-toggle'; toggle.setAttribute('data-i18n-ignore','');
      toggle.setAttribute('aria-controls',extra.id); toggle.setAttribute('aria-expanded',String(view.expanded)); toggle.disabled = Boolean(options.busy);
      toggle.textContent = view.expanded ? text('收起较早记录','Show recent only') : text(`展开其余 ${view.rows.length-5} 条记录`,`Show ${view.rows.length-5} older records`);
      toggle.addEventListener('click',()=>{
        if (view.options.busy) return;
        view.expanded = !view.expanded;
        if (!view.expanded && view.rows.slice(5).some(row=>row.id===view.confirmId)) view.confirmId=null;
        render(list,view.rows,view.makeRow,view.options);
        const panel = list.querySelector('.backup-history-extra');
        if (view.expanded && !reduced()) panel.animate([{opacity:0,transform:'translateY(-5px)'},{opacity:1,transform:'none'}],{duration:190,easing:'cubic-bezier(.2,.7,.2,1)'});
        list.querySelector('.backup-history-toggle')?.focus({preventScroll:true});
      });
      list.append(extra,toggle);
    }
    if (focusId && focusAction) {
      const row = [...list.querySelectorAll('[data-backup-id]')].find(row=>row.dataset.backupId===focusId);
      row?.querySelector(`[data-backup-action="${focusAction}"]`)?.focus({preventScroll:true});
    } else if (toggleFocused) list.querySelector('.backup-history-toggle')?.focus({preventScroll:true});
  }
  function addDeleteButton(list, row, backup, onDelete, busy = false) {
    const view = views.get(list);
    const actions = document.createElement('div'); actions.className = 'backup-record-actions';
    while (row.children.length > 1) actions.append(row.children[1]);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'fold-button compact backup-delete'; button.dataset.backupAction = 'delete';
    button.setAttribute('data-i18n-ignore',''); button.append(deleteIcon(),document.createTextNode(text('删除备份','Delete backup')));
    const available = backup.canDelete === true;
    button.disabled = busy || !available;
    const name = backup.name || backup.id;
    button.setAttribute('aria-label',text(`删除「${name}」的备份`,`Delete backup for ${name}`));
    if (!available) button.title = I18n.text(backup.deleteReason || '这份备份仍用于皮肤恢复，请先恢复后再删除。');
    actions.append(button); row.append(actions);
    button.addEventListener('click',()=>{
      if (busy || !available) return;
      view.confirmId = backup.id; render(list,view.rows,view.makeRow,view.options);
      [...list.querySelectorAll('[data-backup-id]')].find(item=>item.dataset.backupId===backup.id)?.querySelector('[data-backup-action="confirm-delete"]')?.focus({preventScroll:true});
    });
    if (view?.confirmId !== backup.id) return;
    const panel = document.createElement('div'); panel.className = 'backup-delete-confirm'; panel.setAttribute('data-i18n-ignore','');
    const message = document.createElement('p'); message.textContent = text('删除这份备份及其恢复文件？删除后无法再使用此记录恢复。','Delete this backup and its recovery files? This record will no longer be available for restoration.');
    const buttons = document.createElement('div');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'fold-button compact'; cancel.textContent = text('取消','Cancel'); cancel.disabled=busy; cancel.dataset.backupAction='cancel-delete';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'fold-button compact backup-delete'; confirm.textContent = text('确认删除','Delete permanently'); confirm.disabled=busy; confirm.dataset.backupAction='confirm-delete';
    cancel.addEventListener('click',()=>{view.confirmId=null;render(list,view.rows,view.makeRow,view.options);});
    confirm.addEventListener('click',async()=>{
      if (confirm.disabled) return; confirm.disabled=true;cancel.disabled=true;button.disabled=true;
      try { await onDelete(backup); } finally { view.confirmId=null;render(list,view.rows,view.makeRow,view.options); }
    });
    buttons.append(cancel,confirm);panel.append(message,buttons);row.append(panel);
    if (!reduced()) panel.animate([{opacity:0,transform:'translateY(-3px)'},{opacity:1,transform:'none'}],{duration:150,easing:'ease-out'});
  }
  window.SkinBackupHistory = Object.freeze({render,addDeleteButton});
})();
