/* Update checks are user-triggered; the main process validates GitHub results. */
(() => {
  'use strict';
  const check=document.getElementById('launcherUpdateCheck'),open=document.getElementById('launcherUpdateOpen');
  const status=document.getElementById('launcherUpdateStatus'),checked=document.getElementById('launcherUpdateChecked');
  if(!check||!open||!status||!checked)return;
  let state=null,busy=false,opening=false,openError=false;
  function render() {
    check.disabled=busy;open.disabled=busy||opening;check.textContent=I18n.t(busy?'appUpdate.checking':'appUpdate.check');
    check.setAttribute('aria-busy',String(busy));
    status.removeAttribute('data-i18n');
    const result=state?.status;
    const key=busy?'checking':openError?'openFailed':result==='available'?'available':result==='up-to-date'?'current':result==='no-release'?'noRelease':result==='error'?({RATE_LIMIT:'rateLimit',NETWORK:'offline',TIMEOUT:'offline',INVALID_JSON:'invalid',UNSUPPORTED_RELEASE:'invalid',UNTRUSTED_RELEASE:'invalid',VERSION:'invalid',CURRENT_VERSION:'invalid'}[state.errorCode]||'failed'):'ready';
    status.textContent=I18n.t('appUpdate.'+key,{version:state?.latestVersion||''});
    status.classList.toggle('is-error',result==='error'||openError);
    open.hidden=result!=='available'||!(state?.assetUrl||state?.releaseUrl);
    open.textContent=I18n.t(state?.assetUrl?'appUpdate.download':'appUpdate.release');
    checked.hidden=!state?.checkedAt;
    if(!checked.hidden){const date=new Date(state.checkedAt);checked.textContent=I18n.t('appUpdate.checked',{time:Number.isNaN(date.getTime())?'—':date.toLocaleString(I18n.current,{hour12:false})});}
  }
  async function checkNow() {
    if(busy)return;busy=true;openError=false;render();
    try {const result=await ipcRenderer.invoke('launcher-update-check',{force:true});state=result||{status:'error'};}
    catch {state={status:'error',errorCode:'NETWORK'};}
    finally {busy=false;render();}
  }
  check.addEventListener('click',checkNow);
  open.addEventListener('click',async()=>{
    if(opening||busy||state?.status!=='available')return;opening=true;openError=false;render();
    try {const result=await ipcRenderer.invoke('launcher-update-open',{kind:state.assetUrl?'download':'release'});if(!result?.ok)openError=true;}
    catch {openError=true;}
    finally {opening=false;render();}
  });
  window.addEventListener('vyra-language-changed',render);
  window.TfxAppUpdate=Object.freeze({check:checkNow,get state(){return state?{...state}:null;}});
  render();
})();
