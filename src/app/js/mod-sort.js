/* Theme-aware mod sorting menu; the hidden select retains the saved value. */
(() => {
  'use strict';
  const select=document.getElementById('modSort');
  if(!select)return;
  const trigger=document.createElement('button'),label=document.createElement('span'),mark=document.createElement('span');
  trigger.id='modSortTrigger';trigger.type='button';trigger.className='mod-sort-trigger';
  trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-controls','modSortMenu');trigger.setAttribute('aria-expanded','false');
  mark.className='mod-sort-mark';mark.setAttribute('aria-hidden','true');trigger.append(label,mark);select.after(trigger);select.hidden=true;select.tabIndex=-1;
  const menu=document.createElement('div');menu.id='modSortMenu';menu.className='mod-sort-menu';menu.setAttribute('role','listbox');menu.hidden=true;document.body.append(menu);
  const options=Array.from(select.options,option=>{
    const button=document.createElement('button');button.type='button';button.className='mod-sort-option';button.dataset.value=option.value;button.setAttribute('role','option');button.tabIndex=-1;
    button.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close(true);});
    menu.append(button);return button;
  });
  let opened=false,closeTimer;
  function sync(){
    const selected=select.options[select.selectedIndex]||select.options[0];label.textContent=selected.textContent;
    const title=window.I18n?I18n.t('mods.sortLabel'):'排列';trigger.setAttribute('aria-label',title+'：'+selected.textContent);menu.setAttribute('aria-label',title);
    options.forEach((button,index)=>{button.textContent=select.options[index].textContent;button.setAttribute('aria-selected',String(button.dataset.value===select.value));});
  }
  function position(){
    const rect=trigger.getBoundingClientRect(),width=Math.max(184,rect.width);
    menu.style.width=width+'px';menu.style.left=Math.max(12,Math.min(rect.right-width,innerWidth-width-12))+'px';
    const height=menu.offsetHeight;menu.style.top=(rect.bottom+8+height<=innerHeight-12?rect.bottom+8:Math.max(12,rect.top-height-8))+'px';
  }
  function open(last=false){
    clearTimeout(closeTimer);sync();menu.hidden=false;opened=true;position();trigger.setAttribute('aria-expanded','true');
    requestAnimationFrame(()=>{if(opened)menu.classList.add('is-open');});
    (last?options[options.length-1]:options.find(button=>button.dataset.value===select.value)||options[0]).focus({preventScroll:true});
  }
  function close(focus=false){
    if(!opened)return;opened=false;trigger.setAttribute('aria-expanded','false');menu.classList.remove('is-open');
    closeTimer=setTimeout(()=>{if(!opened)menu.hidden=true;},160);if(focus)trigger.focus({preventScroll:true});
  }
  trigger.addEventListener('click',()=>opened?close():open());
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open(event.key==='End');if(event.key==='Home')options[0].focus();}else if(event.key==='Escape')close(true);});
  menu.addEventListener('keydown',event=>{
    const at=options.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(at+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus();}
    else if(event.key==='Escape'){event.preventDefault();close(true);}else if(event.key==='Tab')close();
  });
  document.addEventListener('pointerdown',event=>{if(opened&&!menu.contains(event.target)&&!trigger.contains(event.target))close();},true);
  document.addEventListener('focusin',event=>{if(opened&&!menu.contains(event.target)&&!trigger.contains(event.target))close();});
  document.addEventListener('scroll',event=>{if(opened&&!menu.contains(event.target))close();},true);
  window.addEventListener('resize',()=>close());window.addEventListener('vyra-language-changed',()=>{sync();if(opened)position();});
  window.addEventListener('vyra-view-change',()=>close());
  if(typeof events==='object')events.on('popup-changed',({new_state:shown})=>{if(shown)close();});
  window.ModSort=Object.freeze({sync,close});sync();
})();
