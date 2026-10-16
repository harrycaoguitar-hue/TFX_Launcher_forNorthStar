'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../src');
function runtime(){
  const window={addEventListener(){},dispatchEvent(){}},document={body:null},context={window,document,fold:{normalizeUiLanguage:value=>value,loadSettings:()=>({data:{uiLanguage:'en-US'}}),loadLocale:locale=>JSON.parse(fs.readFileSync(path.join(root,'lang','ui-'+locale+'.json'),'utf8')).strings,translateText:value=>value,setUiLanguage(){},translate:value=>value},ipcRenderer:{on(){}},MutationObserver:class{observe(){}disconnect(){}},CustomEvent:class{},requestAnimationFrame:()=>0};
  vm.createContext(context);
  for(const file of ['locales.js','feature-copy.js','official-errors.js','i18n.js'])vm.runInContext(fs.readFileSync(path.join(root,'app/js',file),'utf8'),context,{filename:file});
  context.I18n=window.I18n;return {window,context};
}
test('new official-mode error literals render local recovery guidance in all five actual languages',()=>{
  const {window}=runtime();
  const messages=[...new Set(['official-launch.js','clean-loader-proxy.js','vanilla-client.js','vanilla-plus.js'].flatMap(file=>[...fs.readFileSync(path.join(root,'modules',file),'utf8').matchAll(/"([^"\n]*\p{Script=Han}[^"\n]*)"/gu)].map(match=>match[1])))];
  assert(messages.length>=55);
  for(const source of messages){
    assert.equal(window.OfficialErrors.has(source),true,source);
    for(const locale of ['zh-CN','en-US','zh-TW','de-DE','fr-FR']){
      window.I18n.preview(locale);const direct=window.I18n.text(source),coded=window.OfficialErrors.text({error:source});
      assert.ok(direct.length>8&&coded.length>8,locale+' '+source);assert.doesNotMatch(coded,/^official\./);
      if(!locale.startsWith('zh')){assert.doesNotMatch(direct,/\p{Script=Han}/u,locale+' '+source);assert.doesNotMatch(coded,/\p{Script=Han}/u,locale+' '+source);}
    }
  }
});
test('bounded official evidence codes use translated guidance and native technical details stay separate',()=>{
  const {window}=runtime();const codes=['OFFICIAL_MOD_NOT_READY','CLEAN_PROXY_RECOVERY','VANILLA_CLIENT_NOT_INSTALLED','VANILLA_RUNTIME_OUTDATED','VANILLA_PLUS_DUPLICATE','VANILLA_PLUS_FOREIGN','VANILLA_PLUS_UNSAFE','VANILLA_PLUS_DEFINITION','VANILLA_PLUS_LIMIT','VANILLA_PLUS_BUNDLE','VANILLA_PLUS_VERIFY','VANILLA_PLUS_CHANGED'];
  for(const locale of ['zh-CN','en-US','zh-TW','de-DE','fr-FR']){
    window.I18n.preview(locale);
    for(const code of codes){const output=window.OfficialErrors.text({code,error:'C:/PRIVATE/technical error'});assert.equal(window.OfficialErrors.has({code}),true);assert.doesNotMatch(output,/PRIVATE/);assert.doesNotMatch(output,/^official\./);if(!locale.startsWith('zh'))assert.doesNotMatch(output,/\p{Script=Han}/u);}
  }
  assert.equal(window.OfficialErrors.text({code:'UNRECOGNIZED',error:'Technical message at D:/private/file'}),'Technical message at D:/private/file');
  assert.equal(window.OfficialErrors.has({code:'GAME_ALREADY_RUNNING',error:'Northstar game already running'}),false);
  assert.equal(window.OfficialErrors.has({code:'SELECTION_CHANGED',error:'Northstar region changed'}),false);
});
