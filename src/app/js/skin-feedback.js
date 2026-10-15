/* Shared feedback: measured progress where available, bounded estimates while
 * the engine is quiet. Only the coordinator's successful result reaches 100%. */
(() => {
  'use strict';
  const entries=new Map(),t=key=>I18n.t('skinFeedback.'+key);
  let ticker=null;
  const $=(kind,suffix)=>document.getElementById(kind+suffix);
  function state(kind){if(!entries.has(kind))entries.set(kind,{receipt:null,operation:null});return entries.get(kind);}
  const basename=value=>String(value||'').replace(/[\\/]+$/u,'').split(/[\\/]/u).at(-1).replace(/[\u0000-\u001f\u007f]/gu,'').slice(0,240);
  function anchor(operation,limit){
    operation.anchor=operation.percent;operation.anchorTime=Date.now();
    operation.limit=Math.max(operation.percent,Math.min(98,limit??operation.percent+8));
  }
  function pending(type,key){const operation={type,state:'pending',percent:0,estimated:true,key};anchor(operation,8);return operation;}
  function updateTicker(){
    const active=[...entries.values()].some(entry=>entry.operation?.state==='pending');
    if(active&&ticker===null)ticker=setInterval(()=>{
      for(const[kind,entry]of entries){
        const operation=entry.operation;if(operation?.state!=='pending')continue;
        const elapsed=Math.max(0,Date.now()-operation.anchorTime);
        const next=Math.floor(operation.anchor+(operation.limit-operation.anchor)*(1-Math.exp(-elapsed/15000)));
        if(next>operation.percent){operation.percent=next;operation.estimated=true;renderProgress(kind);}
      }
    },500);
    else if(!active&&ticker!==null){clearInterval(ticker);ticker=null;}
  }
  function receiptStatus(kind){
    let label=$(kind,'ReceiptStatus');if(label)return label;
    const name=$(kind,'PackageName');if(!name)return null;
    label=document.createElement('small');label.id=kind+'ReceiptStatus';label.className='skin-receipt-status';label.setAttribute('data-i18n-ignore','');label.setAttribute('role','status');label.setAttribute('aria-live','polite');name.parentElement.append(label);return label;
  }
  function renderReceipt(kind){
    const entry=state(kind),receipt=entry.receipt,card=$(kind,'PackageInfo');if(!card)return;
    const label=receiptStatus(kind);
    card.hidden=!receipt;card.dataset.receiptState=receipt?.state||'empty';
    if(!receipt){if(label)label.textContent='';return;}
    $(kind,'PackageName').textContent=receipt.name||t(receipt.state==='picking'?'picking':'unnamed');
    $(kind,'PackageName').title=receipt.name||'';
    $(kind,'PackageName').setAttribute('data-i18n-ignore','');
    $(kind,'PackageMeta').setAttribute('data-i18n-ignore','');
    $(kind,'PackageMeta').textContent=receipt.state==='ready'?receipt.meta:t(receipt.state==='failed'?'invalidHint':receipt.state==='picking'?'pickerHint':'checking');
    if(label)label.textContent=t(receipt.state==='ready'?'validated':receipt.state==='failed'?'invalid':receipt.state==='picking'?'picking':'received');
  }
  function renderProgress(kind){
    updateTicker();const operation=state(kind).operation,box=$(kind,'Progress');if(!box)return;
    const install=$(kind,'Install');
    if(!operation||operation.type!=='install'){if(install){delete install.dataset.feedbackState;install.removeAttribute('aria-busy');}}
    box.hidden=!operation;if(!operation){box.classList.remove('skin-feedback-indeterminate');return;}
    box.dataset.feedbackState=operation.state;box.setAttribute('data-i18n-ignore','');
    const active=operation.state==='pending',percent=operation.percent;
    box.classList.remove('skin-feedback-indeterminate');
    box.classList.toggle('skin-feedback-success',operation.state==='success');
    box.classList.toggle('skin-feedback-failed',operation.state==='failed');
    const label=operation.key?t(operation.key):I18n.text(operation.message||t('working'));
    $(kind,'ProgressLabel').textContent=label;
    $(kind,'ProgressLabel').setAttribute('role','status');$(kind,'ProgressLabel').setAttribute('aria-live','polite');
    const amount=(operation.estimated?'≈ ':'')+Math.round(percent)+'%';
    $(kind,'ProgressValue').textContent=amount;
    const track=box.querySelector('.fold-progress-track');
    if(track){track.setAttribute('role','progressbar');track.setAttribute('aria-label',label);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-busy',String(active));track.setAttribute('aria-valuenow',String(percent));track.setAttribute('aria-valuetext',amount+' · '+label);}
    $(kind,'ProgressBar').style.width=percent+'%';
    if(install&&operation.type==='install'){
      install.dataset.feedbackState=operation.state;install.setAttribute('aria-busy',String(active));
      const text=install.querySelector('[data-skin-install-label]');
      if(text)text.textContent=t(active?'installStarting':operation.state==='success'?'installed':operation.state==='waiting'?'confirmation':operation.state==='cancelled'?'cancelled':'retry');
    }
  }
  function beginImport(kind,{path,name,picking=false}={}){
    const entry=state(kind);entry.receipt={name:basename(name||path),state:picking?'picking':'pending',meta:''};
    entry.operation=picking?null:pending('import','checking');renderReceipt(kind);renderProgress(kind);
  }
  function importResult(kind,result){
    const entry=state(kind);
    if(result?.cancelled){entry.receipt=null;entry.operation=null;renderReceipt(kind);renderProgress(kind);return;}
    if(result?.ok&&result.package){
      const pkg=result.package,bytes=Number(pkg.bytes)||0;
      const amount=new Intl.NumberFormat(I18n.current,{maximumFractionDigits:1}).format(bytes/1024**2)+' MB';
      entry.receipt={state:'ready',name:basename(pkg.name||entry.receipt?.name),meta:(pkg.count??pkg.files?.length??0)+' · '+amount};entry.operation=null;
    }else if(result?.stale){return;}
    else{entry.receipt={...(entry.receipt||{}),state:'failed'};entry.operation={type:'import',state:'failed',percent:entry.operation?.percent??0,estimated:entry.operation?.estimated??false,key:'importFailed'};}
    renderReceipt(kind);renderProgress(kind);
  }
  function sync(kind,value){
    const entry=state(kind);
    if(!entry.receipt&&value?.package){
      const pkg=value.package;entry.receipt={state:'ready',name:basename(pkg.name),meta:(pkg.count??pkg.files?.length??0)+' · '+new Intl.NumberFormat(I18n.current,{maximumFractionDigits:1}).format((Number(pkg.bytes)||0)/1024**2)+' MB'};
    }
    renderReceipt(kind);renderProgress(kind);
  }
  function beginInstall(kind){
    const entry=state(kind);
    if(entry.operation?.type==='install'&&entry.operation.state==='pending')return;
    if(entry.operation?.type==='install'&&entry.operation.state==='waiting'){
      entry.operation.state='pending';entry.operation.key='installStarting';anchor(entry.operation);
    }else entry.operation=pending('install','installStarting');
    renderProgress(kind);
  }
  function installationPercent(operation,value,percent){
    const phase=value.phase;
    // Resource download, repair and installation each report their own 0–100.
    // Reserve room for the later stages instead of showing 100% at download end.
    if(['helper','auth','authenticated','download','stage-plan','repair'].includes(phase))operation.recovery=true;
    if(!operation.recovery)return {percent:phase==='complete'?99:percent,finalizing:phase==='complete'};
    if(Number.isSafeInteger(value.stages)&&value.stages>0)operation.stages=value.stages;
    if(Number.isSafeInteger(value.stage)&&value.stage>0)operation.stage=value.stage;
    if(phase==='install')operation.applying=true;
    if(phase==='repair')operation.repairing=true;
    if(operation.applying)return {percent:phase==='complete'?99:percent===null?null:75+percent*.24,finalizing:phase==='complete',estimated:true};
    if(phase==='complete')return {percent:operation.repairing?75:64,estimated:true};
    if(phase==='repair'||phase==='originals')return {percent:percent===null?64:64+percent*.11,estimated:true};
    const stages=Math.max(operation.stages||1,operation.stage||1),stage=Math.min(operation.stage||1,stages);
    const start=8+(stage-1)*52/stages,span=52/stages;
    if(phase==='download')return {percent:percent===null?null:start+percent/100*span*.85,estimated:true};
    if(phase==='verify'&&Number.isFinite(value.index)&&Number.isFinite(value.count)&&value.count>0)return {percent:start+span*(.85+.15*Math.max(0,Math.min(1,(value.index-1)/value.count))),estimated:true};
    if(phase==='auth'||phase==='authenticated'||phase==='stage-plan')return {percent:start,estimated:true};
    return {percent:null,estimated:true};
  }
  function progress(kind,value={}){
    const entry=state(kind),operation=entry.operation;
    if(!operation||operation.state!=='pending')return false;
    const raw=Number.isFinite(value.percent)?Math.max(0,Math.min(100,value.percent)):null;
    const measured=operation.type==='install'?installationPercent(operation,value,raw):{percent:raw};
    const previous=operation.percent,phaseChanged=operation.phase!==value.phase;
    if(measured.percent!==null){operation.percent=Math.max(previous,Math.min(99,Math.round(measured.percent)));operation.estimated=Boolean(measured.estimated||measured.percent<previous);}
    else operation.estimated=true;
    operation.phase=value.phase;
    // A completed inner engine still awaits coordinator checks or rollback.
    operation.key=measured.finalizing?'finalizing':null;
    operation.message=value.message||t(operation.type==='import'?'checking':'working');
    if(operation.percent>previous||phaseChanged)anchor(operation,measured.finalizing?99:undefined);
    renderProgress(kind);return true;
  }
  function waiting(kind,key='confirmation'){
    const entry=state(kind);entry.operation={...entry.operation,type:'install',state:'waiting',percent:entry.operation?.percent??0,key};renderProgress(kind);
  }
  function finish(kind,result){
    const entry=state(kind);
    if(result?.confirmationRequired){waiting(kind);return;}
    const cancelled=result?.cancelled===true;
    const success=result?.ok&&!cancelled;
    entry.operation={type:'install',state:cancelled?'cancelled':success?'success':'failed',percent:success?100:Math.min(99,entry.operation?.percent??0),estimated:!success&&Boolean(entry.operation?.estimated),key:cancelled?'cancelled':success?'installed':'installFailed'};
    renderProgress(kind);
  }
  function clear(kind){const entry=state(kind);entry.receipt=null;entry.operation=null;const install=$(kind,'Install');if(install){delete install.dataset.feedbackState;install.removeAttribute('aria-busy');}renderReceipt(kind);renderProgress(kind);}
  function clearProgress(kind){state(kind).operation=null;renderProgress(kind);}
  window.SkinFeedback=Object.freeze({beginImport,importResult,sync,beginInstall,progress,waiting,finish,clear,clearProgress,basename});
  window.addEventListener('vyra-language-changed',()=>{for(const kind of entries.keys()){renderReceipt(kind);renderProgress(kind);}});
})();
