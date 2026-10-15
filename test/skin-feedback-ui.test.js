'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const elements=new Map(),timers=new Map();let clock=0,nextTimer=0;
 function element(){return{hidden:true,dataset:{},style:{},attributes:{},textContent:'',classList:{values:new Set(),add(v){this.values.add(v);},remove(v){this.values.delete(v);},toggle(v,on){on?this.values.add(v):this.values.delete(v);},contains(v){return this.values.has(v);}},setAttribute(k,v){this.attributes[k]=String(v);},removeAttribute(k){delete this.attributes[k];},append(v){v.parentElement=this;},querySelector(){return this.track;}};}
 for(const kind of ['dds','vtf'])for(const suffix of ['PackageInfo','PackageName','PackageMeta','Progress','ProgressLabel','ProgressValue','ProgressBar','Install']){const el=element();el.id=kind+suffix;if(suffix==='PackageName')el.parentElement=element();if(suffix==='Progress')el.track=element();if(suffix==='Install'){el.label=element();el.querySelector=selector=>selector==='[data-skin-install-label]'?el.label:null;}elements.set(el.id,el);}
 const events=new Map(),context={window:{addEventListener(name,handler){events.set(name,handler);}},document:{getElementById:id=>elements.get(id),createElement(){const el=element();Object.defineProperty(el,'id',{set(value){elements.set(value,el);}});return el;}},I18n:{current:'en-US',t:key=>key,text:value=>value},Intl,Date:{now:()=>clock},setInterval(callback){timers.set(++nextTimer,callback);return nextTimer;},clearInterval(id){timers.delete(id);}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/app/js/skin-feedback.js'),'utf8'),context);
 return{api:context.window.SkinFeedback,elements,context,events,timers,advance(ms){clock+=ms;for(const callback of timers.values())callback();}};
}
test('file receipt is synchronous, uses basename only, and an invalid new import keeps its own filename',()=>{
 const f=fixture(),$=id=>f.elements.get('dds'+id);
 f.api.beginImport('dds',{path:'D:\\Private\\first.zip'});assert.equal($('PackageInfo').hidden,false);assert.equal($('PackageName').textContent,'first.zip');assert.equal($('PackageInfo').dataset.receiptState,'pending');
 f.api.importResult('dds',{ok:true,package:{id:'a',name:'first.zip',count:2,bytes:2000}});assert.equal($('PackageInfo').dataset.receiptState,'ready');
 f.api.beginImport('dds',{path:'D:/Private/wrong-vtf.7z'});f.api.importResult('dds',{ok:false});f.api.sync('dds',{package:null});assert.equal($('PackageName').textContent,'wrong-vtf.7z');assert.equal($('PackageInfo').dataset.receiptState,'failed');assert.equal($('Progress').dataset.feedbackState,'failed');
 f.api.clear('dds');assert.equal($('PackageInfo').hidden,true);assert.equal($('Progress').hidden,true);
 f.api.beginImport('dds',{picking:true});f.api.importResult('dds',{ok:true,cancelled:true});assert.equal($('PackageInfo').hidden,true);
});
test('installation always has a bounded numeric value and only the final successful result reaches 100%',()=>{
 const f=fixture(),$=id=>f.elements.get('vtf'+id);
 f.api.beginInstall('vtf');assert.equal($('Progress').hidden,false);assert.equal($('ProgressValue').textContent,'≈ 0%');assert.equal($('Progress').track.attributes['aria-valuenow'],'0');assert.equal($('Install').dataset.feedbackState,'pending');
 assert.equal($('Install').label.textContent,'skinFeedback.installStarting');
 f.api.progress('vtf',{phase:'backup',message:'Preparing'});f.advance(30000);assert.match($('ProgressValue').textContent,/^≈ [1-7]%$/);assert.match($('Progress').track.attributes['aria-valuetext'],/^≈ [1-7]% · Preparing$/);
 f.api.progress('vtf',{percent:37,message:'Writing'});assert.equal($('ProgressValue').textContent,'37%');
 f.api.progress('vtf',{percent:100,phase:'complete'});assert.equal($('ProgressValue').textContent,'99%');assert.equal($('Progress').dataset.feedbackState,'pending');assert.equal($('ProgressLabel').textContent,'skinFeedback.finalizing');
 f.advance(600000);assert.equal($('ProgressValue').textContent,'99%');
 f.api.finish('vtf',{ok:false});assert.equal($('Progress').dataset.feedbackState,'failed');assert.notEqual($('ProgressValue').textContent,'100%');
 assert.equal(f.timers.size,0);assert.equal($('Progress').track.attributes['aria-busy'],'false');
 f.api.beginInstall('vtf');f.api.finish('vtf',{ok:true});f.api.sync('vtf',{});assert.equal($('ProgressValue').textContent,'100%');assert.equal($('Progress').dataset.feedbackState,'success');
 assert.equal($('Install').label.textContent,'skinFeedback.installed');
 assert.equal(f.api.progress('vtf',{percent:0,message:'Background status'}),false);assert.equal($('ProgressValue').textContent,'100%');
 assert.equal(f.timers.size,0);
});
test('missing, malformed and out-of-order updates never erase or decrease installation progress',()=>{
 const f=fixture(),value=()=>f.elements.get('ddsProgressValue').textContent,number=()=>Number(value().replace(/[^\d]/g,''));
 f.api.beginInstall('dds');f.api.progress('dds',{phase:'install',percent:40});assert.equal(value(),'40%');
 for(const update of [{phase:'install'},{phase:'install',percent:NaN},{phase:'install',percent:Infinity},{phase:'backup',percent:0}]){f.api.progress('dds',update);assert.equal(number(),40);assert.match(value(),/%$/);}
 f.advance(15000);assert(number()>40&&number()<49);assert.match(value(),/^≈ /);
 f.api.beginInstall('dds');assert(number()>40,'repeated install wrappers must not restart feedback');
 f.api.progress('dds',{phase:'install',percent:95});f.advance(600000);assert(number()>=95&&number()<=98);
 f.api.finish('dds',{ok:true,cancelled:true});assert.equal(f.elements.get('ddsProgress').dataset.feedbackState,'cancelled');assert(number()<100);assert.equal(f.timers.size,0);
 f.api.beginInstall('dds');assert.equal(number(),0);f.api.clearProgress('dds');assert.equal(f.timers.size,0);
});
test('resource downloads and two download stages reserve progress for repair and installation',()=>{
 const f=fixture(),bar=f.elements.get('vtfProgress');f.api.beginInstall('vtf');let previous=0;
 const updates=[{phase:'helper'},{phase:'auth',stage:1,stages:2},{phase:'download',percent:100},{phase:'verify',index:1,count:2,stage:1},{phase:'verify',index:2,count:2,stage:1},{phase:'stage-plan',stage:2},{phase:'auth',stage:2,stages:2},{phase:'download',percent:0},{phase:'download',percent:100},{phase:'complete',totalBytes:4000},{phase:'repair',canCancel:false},{phase:'repair',percent:100},{phase:'complete',percent:100},{phase:'install',canCancel:false},{phase:'backup',percent:0},{phase:'install',percent:80},{phase:'verify',percent:90},{phase:'complete',percent:100}];
 for(const update of updates){f.api.progress('vtf',update);const current=Number(bar.track.attributes['aria-valuenow']);assert(current>=previous,JSON.stringify(update));assert(current<100);previous=current;assert.notEqual(f.elements.get('vtfProgressValue').textContent,'—');}
 assert.equal(previous,99);assert.equal(bar.dataset.feedbackState,'pending');f.api.finish('vtf',{ok:true});assert.equal(bar.track.attributes['aria-valuenow'],'100');
});
test('confirmation pauses estimated progress, resumes without a reset and stops all timers on clear',()=>{
 const f=fixture(),value=()=>f.elements.get('ddsProgressValue').textContent;
 f.api.beginInstall('dds');f.advance(30000);const before=value();f.api.waiting('dds');assert.equal(f.timers.size,0);f.advance(30000);assert.equal(value(),before);
 f.api.beginInstall('dds');assert.equal(value(),before);assert.equal(f.timers.size,1);f.api.beginInstall('vtf');assert.equal(f.timers.size,1,'both installers share one low-frequency timer');f.api.clear('dds');assert.equal(f.timers.size,1);f.api.clear('vtf');assert.equal(f.timers.size,0);
});
test('confirmation and cancellation are distinct from completion and all new messages have five languages',()=>{
 const f=fixture(),$=id=>f.elements.get('dds'+id);f.api.beginInstall('dds');f.api.waiting('dds');assert.equal($('Progress').dataset.feedbackState,'waiting');f.api.finish('dds',{ok:false,cancelled:true});assert.equal($('Progress').dataset.feedbackState,'cancelled');assert.notEqual($('ProgressValue').textContent,'100%');
 f.context.window.VyraLocales={messages:{}};vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/app/js/skin-feedback-copy.js'),'utf8'),f.context);
 for(const pair of Object.values(f.context.window.VyraLocales.messages)){assert(pair[0]&&pair[1]);for(const locale of ['zh-TW','de-DE','fr-FR']){const doc=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/lang/ui-'+locale+'.json')));assert.ok(doc.strings[pair[1]]);}}
});
