/* The main process supplies bounded, redacted evidence. Saving always uses the
 * immutable preview shown here; there is no network upload in this workflow. */
(() => {
  'use strict';
  const stageCodes=['preflight','client','skins','ea','spawn','game','northstar','confirmation'];
  const statusCodes=['pending','active','observed','failed','unconfirmed'];
  const outcomeCodes=['launching','confirmed','preflight-failed','client-failed','skins-failed','ea-failed','spawn-failed','game-closed','northstar-not-ready','official-mod-not-ready','timeout','unknown'];
  const actionCodes=['retry','settings','client','platform','mods','issue'];
  const t=key=>I18n.t('diagnostic.'+key);
  let latest=null,dialogReport=null,preview=null,dialog,returnFocus=null,request=0,saving=false,feedbackKey='';
  const cards=[];
  function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
  function button(className,handler){const el=node('button',className);el.type='button';el.addEventListener('click',handler);return el;}
  function normalized(report){
    if(!report||typeof report.id!=='string'||!['starting','confirmed','failed'].includes(report.state))return null;
    const stages=(Array.isArray(report.stages)?report.stages:[]).filter(item=>item&&stageCodes.includes(item.code)&&statusCodes.includes(item.status));
    const outcome=outcomeCodes.includes(report.outcome?.code)?report.outcome.code:'unknown';
    return {...report,officialMods:report.gameVersion==='vanilla'&&report.officialMods===true,stages,outcome:{...report.outcome,code:outcome,actions:(Array.isArray(report.outcome?.actions)?report.outcome.actions:[]).filter(code=>actionCodes.includes(code))}};
  }
  function stageLabel(stage,report=latest){return stage?t(report?.officialMods&&['client','northstar'].includes(stage.code)?'official.stage.'+stage.code:'stage.'+stage.code):'—';}
  function outcomeLabel(report){return t(report.outcome.evidenceCode==='CLEAN_PROXY_RECOVERY'?'outcome.clean-recovery-failed':report.officialMods&&['client-failed','northstar-not-ready'].includes(report.outcome.code)?'official.outcome.'+report.outcome.code:'outcome.'+report.outcome.code);}
  function actionLabel(action,report){return t(report.officialMods&&action==='client'?'official.action.client':'action.'+action);}
  function progress(report){
    const active=report.stages.find(stage=>stage.status==='active');
    const observed=report.stages.filter(stage=>stage.status==='observed').at(-1);
    return {stage:active||observed,label:active?'stageLabel':'observedLabel'};
  }
  function renderCards(){
    for(const card of cards){
      card.root.hidden=!latest;card.root.dataset.state=latest?.state||'idle';
      if(!latest)continue;
      card.eyebrow.textContent=t(latest.state==='starting'?'progress':'last');
      card.title.textContent=outcomeLabel(latest);
      const current=progress(latest);
      card.detail.textContent=t(current.label)+' · '+stageLabel(current.stage);
      card.open.textContent=t('open');
      card.steps.replaceChildren();
      for(const stage of latest.stages){
        const dot=node('span','launch-evidence-step');dot.dataset.status=stage.status;
        dot.textContent=stageLabel(stage);dot.title=t('status.'+stage.status);
        dot.setAttribute('aria-label',stageLabel(stage)+' · '+t('status.'+stage.status));
        card.steps.append(dot);
      }
    }
    for(const el of document.querySelectorAll('[data-launch-diagnostics-open]'))el.textContent=t('open');
    const title=document.getElementById('launchDiagnosticsSettingTitle');if(title)title.textContent=t('title');
    const desc=document.getElementById('launchDiagnosticsSettingDescription');if(desc)desc.textContent=t('description');
  }
  function ensureDialog(){
    if(dialog)return dialog;
    const root=node('dialog','launch-diagnostic-dialog');root.id='launchDiagnosticDialog';root.setAttribute('data-i18n-ignore','');
    root.setAttribute('aria-labelledby','launchDiagnosticTitle');root.setAttribute('aria-describedby','launchDiagnosticPrivacy');
    const header=node('div','launch-diagnostic-heading');
    const title=node('h2');title.id='launchDiagnosticTitle';
    const close=button('fold-icon-button',()=>root.close());close.textContent='×';
    header.append(title,close);
    const body=node('div','launch-diagnostic-body');
    const status=node('p','launch-diagnostic-status');status.setAttribute('role','status');
    const outcome=node('h3','launch-diagnostic-outcome');
    const uncertainty=node('p','launch-diagnostic-uncertainty');
    const evidenceTitle=node('h4');const evidence=node('ol','launch-diagnostic-evidence');
    const actionsTitle=node('h4');const actions=node('ul','launch-diagnostic-actions');
    const privacy=node('p','launch-diagnostic-privacy');privacy.id='launchDiagnosticPrivacy';
    const previewTitle=node('h4');
    const json=node('pre','launch-diagnostic-json');json.tabIndex=0;json.setAttribute('aria-label',t('preview'));
    body.append(status,outcome,uncertainty,evidenceTitle,evidence,actionsTitle,actions,privacy,previewTitle,json);
    const footer=node('div','launch-diagnostic-footer');
    const feedback=node('p');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
    const save=button('fold-button fold-primary',exportPreview);save.id='launchDiagnosticExport';save.disabled=true;
    footer.append(feedback,save);root.append(header,body,footer);document.body.append(root);
    root.addEventListener('click',event=>{if(event.target===root&&!saving){const box=root.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)root.close();}});
    root.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
    root.addEventListener('close',()=>{++request;preview=null;save.disabled=true;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;});
    // Capture stops the legacy popup handler from closing Settings underneath
    // this top-layer dialog. Native dialog supplies focus containment.
    document.addEventListener('keydown',event=>{
      if(!root.open)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!saving)root.close();}
      else if(event.key==='Tab')event.stopImmediatePropagation();
    },true);
    dialog={root,title,close,status,outcome,uncertainty,evidenceTitle,evidence,actionsTitle,actions,privacy,previewTitle,json,feedback,save};
    return dialog;
  }
  function renderDialog(report,loading=false){
    const d=ensureDialog();
    d.title.textContent=t('title');d.close.setAttribute('aria-label',t('close'));
    d.status.textContent=loading?t('loading'):report?'':t('empty');d.status.hidden=!!report&&!loading;
    d.outcome.hidden=!report;d.uncertainty.hidden=!report||report.state!=='failed'||report.outcome.causeKnown===true;
    d.evidenceTitle.textContent=t('evidence');d.evidenceTitle.hidden=!report;
    d.evidence.hidden=!report;d.evidence.replaceChildren();
    d.actionsTitle.textContent=t('actions');d.actionsTitle.hidden=!report?.outcome.actions.length;
    d.actions.hidden=!report?.outcome.actions.length;d.actions.replaceChildren();
    d.privacy.textContent=t('privacy');d.previewTitle.textContent=t('preview');
    d.json.setAttribute('aria-label',t('preview'));d.json.hidden=!preview;d.previewTitle.hidden=!preview;
    d.json.textContent=preview?.json||'';
    d.save.textContent=t(saving?'saving':'export');d.save.disabled=saving||!preview;
    d.feedback.textContent=feedbackKey?t(feedbackKey):'';
    if(!report)return;
    d.outcome.textContent=outcomeLabel(report);d.uncertainty.textContent=t('uncertain');
    for(const stage of report.stages){
      const item=node('li');item.dataset.status=stage.status;
      const label=node('span','',stageLabel(stage,report));
      const result=node('strong','',t('status.'+stage.status));
      item.append(label,result);d.evidence.append(item);
    }
    for(const action of report.outcome.actions)d.actions.append(node('li','',actionLabel(action,report)));
  }
  async function open(){
    const d=ensureDialog();if(saving)return;
    const ticket=++request;preview=null;feedbackKey='';renderDialog(latest,true);
    if(!d.root.open){returnFocus=document.activeElement;d.root.showModal();d.close.focus({preventScroll:true});}
    try{
      const value=await ipcRenderer.invoke('launch-diagnostic-get');
      if(ticket!==request||!d.root.open)return;
      if(!value?.ok)throw Error('diagnostic-unavailable');
      const report=normalized(value.report);
      const received=value.preview;
      if(report&&received&&typeof received.id==='string'&&typeof received.json==='string'){
        // Parse as a bounded JSON report, never as HTML or executable markup.
        const parsed=JSON.parse(received.json);
        if(parsed.report?.id!==report.id)throw Error('diagnostic-preview-mismatch');
        preview={id:received.id,json:received.json};
      }
      if(report)latest=report;
      dialogReport=report;
      renderCards();renderDialog(report);
    }catch{if(ticket!==request||!d.root.open)return;preview=null;renderDialog(null);d.status.textContent=t('loadError');}
  }
  async function exportPreview(){
    const d=ensureDialog();if(saving||!preview||!d.root.open)return;
    const input={previewId:preview.id};saving=true;feedbackKey='';d.close.disabled=true;renderDialog(dialogReport);
    try{
      const result=await ipcRenderer.invoke('launch-diagnostic-export',input);
      if(!result?.ok&&!result?.cancelled)throw Error('export-failed');
      if(result.ok&&!result.cancelled)feedbackKey='saved';
    }catch{feedbackKey='exportError';}
    finally{saving=false;d.close.disabled=false;d.feedback.textContent=feedbackKey?t(feedbackKey):'';d.save.disabled=!preview;d.save.textContent=t('export');}
  }
  function init(){
    for(const dock of document.querySelectorAll('.fold-launch-dock')){
      const root=node('section','launch-diagnostic-card glass');root.hidden=true;root.setAttribute('data-i18n-ignore','');
      const heading=node('div','launch-diagnostic-card-heading');const body=node('div');
      const eyebrow=node('span','launch-diagnostic-eyebrow'),title=node('h3'),detail=node('p');
      body.append(eyebrow,title,detail);const openButton=button('fold-button compact',open);
      heading.append(body,openButton);const steps=node('div','launch-evidence-steps');root.append(heading,steps);dock.after(root);
      cards.push({root,eyebrow,title,detail,steps,open:openButton});
    }
    const launchSettings=document.getElementById('launch-settings');
    if(launchSettings){
      const setting=node('div','buttons launch-diagnostic-setting');setting.setAttribute('data-i18n-ignore','');
      const body=node('div','text'),title=node('span'),description=node('div','desc');
      title.id='launchDiagnosticsSettingTitle';description.id='launchDiagnosticsSettingDescription';body.append(title,description);
      const actions=node('div','actions'),openButton=button('fold-button compact',open);openButton.dataset.launchDiagnosticsOpen='';actions.append(openButton);setting.append(body,actions);launchSettings.append(setting);
    }
    ipcRenderer.on('launch-diagnostic',(_event,report)=>{const value=normalized(report);if(!value)return;latest=value;renderCards();});
    window.addEventListener('vyra-language-changed',()=>{renderCards();if(dialog?.root.open)renderDialog(dialogReport);});
    renderCards();
    // Restore only a summary at startup; the complete export is requested and
    // presented when the user explicitly opens diagnostics.
    ipcRenderer.invoke('launch-diagnostic-get').then(value=>{if(!latest&&value?.ok){latest=normalized(value.report);renderCards();}}).catch(()=>{});
  }
  window.LaunchDiagnostics=Object.freeze({open,get report(){return latest;}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
