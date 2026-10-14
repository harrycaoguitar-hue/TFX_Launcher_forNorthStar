/* Complete the selected material family before replacing a DDS skin. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = (key, parameters) => I18n.t('ddsOriginal.' + key, parameters);
  const state = {package:null,original:null,busy:false,actionBusy:false,error:'',confirming:false};
  const running = () => typeof is_running !== 'undefined' && Boolean(is_running);
  function canInstall(pkg = state.package, original = state.original) {
    if (!pkg) return false;
    return original?.state === 'ready';
  }
  function render() {
    const card = $('ddsOriginal'), original = state.original;
    const status = ['ready','needs-source','error'].includes(original?.state) ? original.state : 'unknown';
    const omitted = Number.isFinite(original?.omittedCount) ? original.omittedCount : null;
    const materialCount = Number.isFinite(original?.catalogueCount) ? original.catalogueCount : null;
    const busy = state.busy || state.actionBusy;
    card.hidden = !state.package;
    card.dataset.state = status;
    card.setAttribute('aria-busy',String(busy));
    for (const [id,key] of [['ddsOriginalTitle','title'],['ddsOriginalSelect','select'],['ddsOriginalSteam','steam'],['ddsOriginalCheck','check'],['ddsOriginalConfirmText','confirmText'],['ddsOriginalSteamCancel','cancel'],['ddsOriginalSteamConfirm','confirm']]) $(id).textContent = t(key);
    $('ddsOriginalStatus').textContent = t(status === 'ready' ? 'ready' : status === 'needs-source' ? 'needsSource' : status === 'error' ? 'error' : 'unknown');
    $('ddsOriginalCount').hidden = omitted === null || materialCount === null;
    $('ddsOriginalCount').textContent = omitted !== null && materialCount !== null ? t('count',{covered:Math.max(0,materialCount-omitted),total:materialCount}) : '';
    $('ddsOriginalDetail').textContent = t(omitted === 0 && status === 'ready' ? 'completeHint' : status === 'ready' ? 'readyHint' : 'needsSourceHint',{count:omitted ?? '—'});
    $('ddsOriginalReason').hidden = !original?.reason || status !== 'error';
    $('ddsOriginalReason').textContent = original?.reason ? I18n.text(original.reason) : '';
    $('ddsOriginalActions').hidden = omitted === 0 && status === 'ready';
    $('ddsOriginalSelect').disabled = busy || running();
    $('ddsOriginalSteam').disabled = busy || running() || !original?.canSteamRepair;
    $('ddsOriginalSteam').title = original?.canSteamRepair ? '' : t('steamUnavailable');
    $('ddsOriginalCheck').disabled = busy || running();
    if (running() || !state.package || (omitted === 0 && status === 'ready')) state.confirming = false;
    $('ddsOriginalConfirm').hidden = !state.confirming;
    $('ddsOriginalSteamConfirm').disabled = busy || running() || !original?.canSteamRepair;
    $('ddsOriginalSteamCancel').disabled = busy;
    $('ddsOriginalError').hidden = !state.error;
    $('ddsOriginalError').textContent = I18n.text(state.error);
    if (!canInstall() || busy) $('ddsInstall').disabled = true;
    if (busy) for (const id of ['ddsSelectPackage','ddsSelectFolder','ddsClearPackage','ddsRefresh']) if ($(id)) $(id).disabled = true;
  }
  function update(value = {}) {
    for (const key of ['package','original']) if (Object.prototype.hasOwnProperty.call(value,key)) state[key] = value[key];
    if (Object.prototype.hasOwnProperty.call(value,'busy')) state.busy = Boolean(value.busy);
    render();
  }
  async function action(channel) {
    if (state.busy || state.actionBusy || running()) return null;
    state.actionBusy = true; state.error = ''; render();
    try {
      const result = await ipcRenderer.invoke(channel,{});
      if (result?.cancelled) return result;
      if (!result?.ok) throw new Error(result?.error || t('operationError'));
      if (Object.prototype.hasOwnProperty.call(result,'original')) state.original = result.original;
      state.confirming = false;
      return result;
    } catch (error) {
      state.error = error.message;
      return {ok:false,error:error.message};
    } finally {
      state.actionBusy = false;
      await window.Fold?.DDS?.refresh();
      render();
    }
  }
  function openSteam(options = {}) {
    if (state.busy || state.actionBusy || running() || !state.original?.canSteamRepair) return null;
    if (!options.confirmed) {
      state.confirming = true; state.error = ''; render();
      $('ddsOriginalSteamConfirm').focus();
      return {confirmationRequired:true};
    }
    return action('dds-steam-repair');
  }
  $('ddsOriginalSelect').addEventListener('click',() => action('dds-originals-select'));
  $('ddsOriginalCheck').addEventListener('click',() => action('dds-status'));
  $('ddsOriginalSteam').addEventListener('click',() => openSteam());
  $('ddsOriginalSteamConfirm').addEventListener('click',() => openSteam({confirmed:true}));
  $('ddsOriginalSteamCancel').addEventListener('click',() => {state.confirming=false;render();$('ddsOriginalSteam').focus();});
  window.addEventListener('vyra-language-changed',render);
  window.DDSOriginal = Object.freeze({update,canInstall,select:()=>action('dds-originals-select'),check:()=>action('dds-status'),openSteam,get busy(){return state.actionBusy;},get state(){return {...state};}});
  render();
})();
