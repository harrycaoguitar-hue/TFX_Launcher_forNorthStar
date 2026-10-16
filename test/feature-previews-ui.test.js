'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=path.join(__dirname,'../src/app');
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.dataset={};this.listeners=new Map();this.attributes={};this.hidden=false;this.disabled=false;this.open=false;this._text='';this.isConnected=true;}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(item=>item.textContent).join('');}
  append(...items){for(const item of items){item.parentElement=this;this.children.push(item);}}
  after(item){const parent=this.parentElement;if(!parent)throw Error('No parent');parent.children.splice(parent.children.indexOf(this)+1,0,item);item.parentElement=parent;}
  replaceChildren(...items){this._text='';this.children=[];this.append(...items);}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  addEventListener(name,handler){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(handler);}
  dispatch(name,event={}){for(const handler of this.listeners.get(name)||[])handler(event);}
  get childElementCount(){return this.children.length;}
  querySelector(selector){return this.walk().find(item=>selector.startsWith('.')?item.className?.split(' ').includes(selector.slice(1)):false)||null;}
  walk(){return this.children.flatMap(item=>[item,...item.walk()]);}
  focus(){this.doc.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;this.dispatch('close');}
}
function fixture(){
  const listeners=new Map(),events=new Map(),windowEvents=new Map(),calls=[];
  const doc={readyState:'complete',activeElement:null,createElement(tag){return new Element(tag,this);},getElementById(id){return [this.body,...this.body.walk()].find(item=>item.id===id)||null;},querySelectorAll(selector){const all=this.body.walk();if(selector==='.fold-launch-dock')return all.filter(item=>item.className==='fold-launch-dock');if(selector==='[data-launch-diagnostics-open]')return all.filter(item=>'launchDiagnosticsOpen'in item.dataset);return [];},addEventListener(name,handler,capture){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push({handler,capture});}};
  doc.body=new Element('body',doc);
  for(const format of ['dds','vtf']){const summary=new Element('div',doc);summary.id=format+'Summary';const stats=new Element('div',doc);stats.className='fold-dds-stat-row';summary.append(stats);doc.body.append(summary);}
  const home=new Element('section',doc),dock=new Element('section',doc);dock.className='fold-launch-dock';home.append(dock);doc.body.append(home);
  const settings=new Element('section',doc);settings.id='launch-settings';doc.body.append(settings);
  const win={addEventListener(name,handler){windowEvents.set(name,handler);},VyraLocales:{messages:{}}};
  const ipc={on(name,handler){events.set(name,handler);},invoke:async(channel,input)=>{calls.push({channel,input});return {ok:true,report:null,preview:null};}};
  const context={window:win,document:doc,ipcRenderer:ipc,I18n:{t:key=>key},console};vm.createContext(context);
  return {context,doc,win,ipc,events,windowEvents,listeners,calls,load(file){vm.runInContext(fs.readFileSync(path.join(app,'js',file),'utf8'),context,{filename:file});}};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function report(id='launch-1',state='failed'){
  return {schema:1,id,state,stages:[{code:'preflight',status:'observed'},{code:'ea',status:'observed'},{code:'spawn',status:'unconfirmed'}],outcome:{code:'timeout',causeKnown:false,actions:['platform','issue']}};
}
function preview(value,id='preview-1'){return {id,json:JSON.stringify({format:'tfx-launch-diagnostic',privacy:{localOnly:true},report:value})};}
test('skin impact shows concrete actions and incomplete coverage without reading or writing files',()=>{
  const f=fixture();f.load('skin-conflicts-ui.js');
  f.win.SkinConflictPreview.render('dds',{package:{id:'skin-a'},conflictPreview:{packageId:'skin-a',format:'DDS',complete:false,blocked:false,counts:{replace:2,restore:3,modConflicts:1},items:[{action:'mod-conflict',name:'col_sample.dds',resource:'materials/<sample>.vtf',modName:'1234'}],warnings:[{code:'runtime-mods-unchecked'},{code:'unmanaged-resources'}]}});
  const panel=f.doc.getElementById('ddsConflictPreview');
  assert.equal(panel.hidden,false);assert.equal(panel.dataset.state,'partial');
  assert.match(panel.textContent,/2conflict.replace3conflict.restore1conflict.mods/);
  assert.match(panel.textContent,/conflict.runtime-mods-unchecked/);assert.match(panel.textContent,/materials\/<sample>\.vtf/);
  const resource=panel.querySelector('.skin-conflict-resource');assert.equal(resource.children[0].children[0].textContent,'col_sample.dds');assert.equal(resource.children[0].children[0].title,'materials/<sample>.vtf');
  assert.equal(f.calls.length,0);
});
test('invalidated import hides the old preview; a mismatched package never restores its old counts',()=>{
  const f=fixture();f.load('skin-conflicts-ui.js');
  const old={packageId:'old',format:'VTF',complete:true,counts:{replace:99},items:[],warnings:[]};
  f.win.SkinConflictPreview.render('vtf',{package:{id:'old'},conflictPreview:old});
  let panel=f.doc.getElementById('vtfConflictPreview');assert.match(panel.textContent,/99/);
  f.win.SkinConflictPreview.render('vtf',{package:null,conflictPreview:old});assert.equal(panel.hidden,true);
  f.win.SkinConflictPreview.render('vtf',{package:{id:'new'},conflictPreview:old});assert.equal(panel.hidden,false);assert.match(panel.textContent,/conflict.unavailable/);assert.doesNotMatch(panel.textContent,/99/);
});
test('diagnostic export remains disabled until the exact redacted preview loads and keeps that snapshot during live events',async()=>{
  const f=fixture();let finishGet;f.load('launch-diagnostics-ui.js');await flush();
  f.ipc.invoke=(channel,input)=>{f.calls.push({channel,input});if(channel==='launch-diagnostic-get')return new Promise(resolve=>{finishGet=resolve;});return Promise.resolve({ok:true,cancelled:false,bytes:200});};
  const opener=f.doc.createElement('button');f.doc.body.append(opener);opener.focus();
  const pending=f.win.LaunchDiagnostics.open();
  const save=f.doc.getElementById('launchDiagnosticExport');assert.equal(save.disabled,true);
  const first=report();finishGet({ok:true,report:first,preview:preview(first)});await pending;
  assert.equal(save.disabled,false);
  f.events.get('launch-diagnostic')({},report('launch-2','starting'));
  f.windowEvents.get('vyra-language-changed')();
  const dialog=f.doc.getElementById('launchDiagnosticDialog');
  assert.match(dialog.querySelector('.launch-diagnostic-json').textContent,/launch-1/);
  assert.doesNotMatch(dialog.querySelector('.launch-diagnostic-json').textContent,/launch-2/);
  save.dispatch('click');await flush();
  assert.equal(f.calls.at(-1).channel,'launch-diagnostic-export');assert.equal(f.calls.at(-1).input.previewId,'preview-1');
  f.context.I18n.t=key=>'fr:'+key;f.windowEvents.get('vyra-language-changed')();
  assert.equal(dialog.querySelector('.launch-diagnostic-footer').children[0].textContent,'fr:diagnostic.saved');
  assert.match(dialog.querySelector('.launch-diagnostic-json').textContent,/launch-1/);
  let stopped=false,prevented=false;
  f.listeners.get('keydown').find(item=>item.capture).handler({key:'Escape',preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  assert.equal(stopped,true);assert.equal(prevented,true);assert.equal(dialog.open,false);assert.equal(f.doc.activeElement,opener);
});
test('mismatched preview cannot be exported and unknown outcomes never claim a known cause',async()=>{
  const f=fixture();f.load('launch-diagnostics-ui.js');await flush();
  const value=report();value.outcome={code:'untrusted-raw-text',causeKnown:false,actions:['issue','arbitrary']};
  f.ipc.invoke=async()=>({ok:true,report:value,preview:preview(report('different'))});
  await f.win.LaunchDiagnostics.open();
  const dialog=f.doc.getElementById('launchDiagnosticDialog');assert.equal(f.doc.getElementById('launchDiagnosticExport').disabled,true);assert.match(dialog.textContent,/diagnostic.loadError/);
  f.events.get('launch-diagnostic')({},value);assert.equal(f.win.LaunchDiagnostics.report.outcome.code,'unknown');assert.equal(f.win.LaunchDiagnostics.report.outcome.actions.length,1);
});
test('official Mod diagnostics label Vanilla+ checks and keep the open official snapshot when a Northstar launch arrives',async()=>{
  const f=fixture();f.load('launch-diagnostics-ui.js');await flush();
  const value={...report('official-launch'),gameVersion:'vanilla',officialMods:true,stages:[{code:'client',status:'observed'},{code:'northstar',status:'failed'}],outcome:{code:'official-mod-not-ready',causeKnown:false,actions:['client','mods']}};
  f.ipc.invoke=async()=>({ok:true,report:value,preview:preview(value)});
  await f.win.LaunchDiagnostics.open();
  const dialog=f.doc.getElementById('launchDiagnosticDialog');
  assert.match(dialog.querySelector('.launch-diagnostic-evidence').textContent,/diagnostic\.official\.stage\.client/);
  assert.match(dialog.querySelector('.launch-diagnostic-evidence').textContent,/diagnostic\.official\.stage\.northstar/);
  assert.match(dialog.querySelector('.launch-diagnostic-actions').textContent,/diagnostic\.official\.action\.client/);
  assert.match(dialog.querySelector('.launch-diagnostic-outcome').textContent,/diagnostic\.outcome\.official-mod-not-ready/);
  f.events.get('launch-diagnostic')({}, {...report('northstar-launch'),gameVersion:'northstar',officialMods:true});
  assert.equal(f.win.LaunchDiagnostics.report.officialMods,false);
  f.windowEvents.get('vyra-language-changed')();
  assert.match(dialog.querySelector('.launch-diagnostic-evidence').textContent,/diagnostic\.official\.stage\.northstar/);
  assert.doesNotMatch(dialog.querySelector('.launch-diagnostic-json').textContent,/northstar-launch/);
});
test('all new product messages have all five UI languages and Northstar uncertainty does not assert an observed game process',()=>{
  const f=fixture();f.load('feature-copy.js');
  const pairs=f.win.VyraLocales.messages;assert.ok(Object.keys(pairs).length>=73);
  for(const[key,pair]of Object.entries(pairs)){
    assert.ok(pair[0].length&&pair[1].length,key);
    for(const locale of ['zh-TW','de-DE','fr-FR']){const doc=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/lang/ui-'+locale+'.json'),'utf8'));assert.ok(typeof doc.strings[pair[1]]==='string'&&doc.strings[pair[1]].length,key+' '+locale);}
  }
  assert.doesNotMatch(pairs['diagnostic.outcome.northstar-not-ready'][1],/process/i);
});
