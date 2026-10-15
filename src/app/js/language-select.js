/* The saved select is data only; the visible language menu uses VYRA surfaces. */
(() => {
  'use strict';
  const select=document.getElementById('uiLanguage'),popup=document.getElementById('options');
  if(!select||!popup)return;
  const trigger=document.createElement('button'),label=document.createElement('span'),mark=document.createElement('span');
  trigger.id='uiLanguageTrigger';trigger.type='button';trigger.className='mod-sort-trigger language-select-trigger';
  trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-controls','uiLanguageMenu');trigger.setAttribute('aria-expanded','false');
  mark.className='mod-sort-mark';mark.setAttribute('aria-hidden','true');trigger.append(label,mark);select.after(trigger);select.hidden=true;select.tabIndex=-1;
  const associated=document.querySelector('label[for="uiLanguage"]');if(associated)associated.htmlFor=trigger.id;
  const menu=document.createElement('div');menu.id='uiLanguageMenu';menu.className='mod-sort-menu language-select-menu';menu.setAttribute('role','listbox');menu.hidden=true;menu.setAttribute('data-i18n-ignore','');popup.append(menu);
  let opened=false,closing,consumeEscapeRelease=false;
  const options=Array.from(select.options,(option,index)=>{const button=document.createElement('button');button.id='uiLanguageOption-'+index;button.type='button';button.className='mod-sort-option';button.dataset.value=option.value;button.setAttribute('role','option');button.tabIndex=-1;button.textContent=option.textContent;button.addEventListener('click',()=>choose(option.value));menu.append(button);return button});
  function sync(){const selected=select.options[select.selectedIndex]||select.options[0];label.textContent=selected.textContent;const name=window.I18n?I18n.t('settings.language'):'界面语言';trigger.setAttribute('aria-label',name+'：'+selected.textContent);menu.setAttribute('aria-label',name);for(const option of options)option.setAttribute('aria-selected',String(option.dataset.value===select.value));}
  function position(){const r=trigger.getBoundingClientRect(),p=popup.getBoundingClientRect(),scale=p.width/popup.offsetWidth||1,width=Math.max(176,trigger.offsetWidth);menu.style.width=width+'px';menu.style.left=Math.max(12,Math.min((r.right-p.left)/scale-width,popup.clientWidth-width-12))+'px';const height=menu.offsetHeight,below=(r.bottom-p.top)/scale+8;menu.style.top=(below+height<popup.clientHeight-12?below:Math.max(12,(r.top-p.top)/scale-height-8))+'px';}
  function open(last=false){clearTimeout(closing);sync();menu.hidden=false;opened=true;trigger.setAttribute('aria-expanded','true');position();requestAnimationFrame(()=>{if(opened)menu.classList.add('is-open')});(last?options.at(-1):options.find(o=>o.dataset.value===select.value)||options[0]).focus({preventScroll:true});}
  function close(focus=false){if(!opened)return;opened=false;trigger.setAttribute('aria-expanded','false');menu.classList.remove('is-open');closing=setTimeout(()=>{if(!opened)menu.hidden=true},150);if(focus)trigger.focus({preventScroll:true});}
  function choose(value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close(true);}
  trigger.addEventListener('click',()=>opened?close():open());
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open(event.key==='End');if(event.key==='Home')options[0].focus({preventScroll:true});}else if(event.key==='Escape'&&opened){event.preventDefault();event.stopImmediatePropagation();consumeEscapeRelease=true;close(true)}});
  menu.addEventListener('keydown',event=>{const at=options.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(at+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus({preventScroll:true});}else if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();consumeEscapeRelease=true;close(true)}else if(event.key==='Tab')close(true)});
  // Closing the nested menu must not also close its parent settings dialog.
  document.addEventListener('keyup',event=>{if(event.key==='Escape'&&consumeEscapeRelease){consumeEscapeRelease=false;event.preventDefault();event.stopImmediatePropagation();}},true);
  window.addEventListener('blur',()=>{consumeEscapeRelease=false;});
  document.addEventListener('pointerdown',event=>{if(opened&&!menu.contains(event.target)&&!trigger.contains(event.target))close()},true);
  document.addEventListener('focusin',event=>{if(opened&&!menu.contains(event.target)&&!trigger.contains(event.target))close()});
  document.addEventListener('scroll',event=>{
    if(!opened||menu.contains(event.target))return;
    const anchor=trigger.getBoundingClientRect(),bounds=popup.querySelector('.options').getBoundingClientRect();
    if(popup.classList.contains('shown')&&anchor.top>=bounds.top&&anchor.bottom<=bounds.bottom)position();
    else close();
  },true);
  window.addEventListener('resize',()=>close());window.addEventListener('vyra-language-changed',()=>{sync();if(opened)position()});
  select.addEventListener('change',sync);
  if(typeof events==='object')events.on('popup-changed',({popup:changed,new_state:shown})=>{if(changed===popup&&!shown)close()});
  const load=Settings.load,cancel=Settings.cancel;Settings.load=(...args)=>{const result=load(...args);sync();return result};Settings.cancel=(...args)=>{const result=cancel(...args);select.value=I18n.current;sync();return result};
  window.LanguageSelect=Object.freeze({sync,close,get opened(){return opened}});sync();
})();
