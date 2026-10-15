/* Restoring preferences is immediate and persistent, guarded by a continuous
 * two-second hold. Releasing any input before completion leaves settings alone. */
(() => {
  'use strict';
  const button=document.getElementById('settingsResetButton');
  if(!button)return;
  const popup=document.getElementById('options'),label=button.querySelector('span'),status=document.getElementById('settingsResetStatus');
  const duration=2000;
  let hold=null,frame=0,busy=false,result='';
  const text=key=>I18n.t('settings.restore.'+key);
  function updateCopy(){label.textContent=text(busy?'saving':hold?'holding':'button');if(result)status.textContent=text(result);}
  function cancel(){
    if(!hold)return;
    hold=null;cancelAnimationFrame(frame);frame=0;
    button.classList.remove('is-holding');button.style.setProperty('--hold-progress','0');
    if(!busy&&!result)status.textContent='';
    updateCopy();
  }
  async function restore(){
    if(busy||Settings.saving||window.mods?.pending?.size){cancel();return;}
    cancel();busy=true;result='';button.disabled=true;button.setAttribute('aria-busy','true');
    const locks=new Map();
    for(const control of document.querySelectorAll('#options input,#options select,#options button')){locks.set(control,control.disabled);control.disabled=true;}
    Settings.saving=true;window.dispatchEvent(new Event('tfx-settings-saving-changed'));
    status.textContent=text('saving');updateCopy();
    try{
      const response=await ipcRenderer.invoke('settings-restore-defaults');
      if(!response?.ok||!response.settings)throw Error(response?.error||text('failure'));
      settings={...response.settings};
      Themes.apply(settings.theme);I18n.commit(settings.uiLanguage);Settings.load();
      if(window.mods?.latest)mods.load(mods.latest);
      window.ModSort?.sync();window.LanguageSelect?.sync();
      window.dispatchEvent(new CustomEvent('vyra-settings-restored',{detail:{settings:{...settings}}}));
      result='success';status.classList.remove('is-error');status.classList.add('is-success');
    }catch(error){
      result='failure';status.classList.remove('is-success');status.classList.add('is-error');
      status.title=error.message||String(error);
    }finally{
      Settings.saving=false;
      for(const[control,disabled]of locks)if(control.isConnected)control.disabled=disabled;
      busy=false;button.disabled=false;button.removeAttribute('aria-busy');updateCopy();
      window.dispatchEvent(new Event('tfx-settings-saving-changed'));
    }
  }
  function tick(now){
    if(!hold)return;
    if(document.hidden||button.disabled||!popup.classList.contains('shown')||document.activeElement!==button){cancel();return;}
    const progress=Math.min(1,(now-hold.started)/duration);
    button.style.setProperty('--hold-progress',String(progress));
    if(progress>=1){void restore();return;}
    frame=requestAnimationFrame(tick);
  }
  function begin(kind,value){
    if(hold||busy||Settings.saving||window.mods?.pending?.size||button.disabled||document.hidden||!popup.classList.contains('shown'))return;
    button.focus({preventScroll:true});hold={kind,value,started:performance.now()};result='';
    status.textContent=text('release');status.classList.remove('is-error','is-success');
    status.removeAttribute('title');
    button.classList.add('is-holding');updateCopy();frame=requestAnimationFrame(tick);
  }
  button.addEventListener('pointerdown',event=>{
    if(event.button!==0||!event.isPrimary)return;
    event.preventDefault();begin('pointer',event.pointerId);
  });
  document.addEventListener('pointerup',event=>{if(hold?.kind==='pointer'&&hold.value===event.pointerId)cancel();},true);
  button.addEventListener('pointerleave',cancel);button.addEventListener('pointercancel',cancel);
  button.addEventListener('keydown',event=>{
    if(![' ','Enter'].includes(event.key))return;
    event.preventDefault();if(!event.repeat)begin('key',event.key);
  });
  button.addEventListener('keyup',event=>{if(hold?.kind==='key'&&hold.value===event.key){event.preventDefault();cancel();}});
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
  button.addEventListener('blur',cancel);window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')cancel();},true);
  events.on('popup-changed',({popup:element,new_state})=>{if(element===popup&&!new_state)cancel();});
  new MutationObserver(()=>{if(button.disabled)cancel();}).observe(button,{attributes:true,attributeFilter:['disabled']});
  window.addEventListener('vyra-language-changed',updateCopy);
  updateCopy();
})();
