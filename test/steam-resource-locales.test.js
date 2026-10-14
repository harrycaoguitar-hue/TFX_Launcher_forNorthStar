"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.join(__dirname,"../src");
function translationRuntime(){
  const window={addEventListener(){},dispatchEvent(){}},document={body:null},context={window,document,fold:{normalizeUiLanguage:value=>value,loadSettings:()=>({data:{uiLanguage:"en-US"}}),loadLocale:locale=>JSON.parse(fs.readFileSync(path.join(root,"lang","ui-"+locale+".json"),"utf8")).strings,translateText:value=>value,setUiLanguage(){},translate:value=>value},ipcRenderer:{on(){}},MutationObserver:class{observe(){}disconnect(){}},CustomEvent:class{},requestAnimationFrame:()=>0};
  vm.createContext(context);for(const file of ["locales.js","i18n.js"])vm.runInContext(fs.readFileSync(path.join(root,"app/js",file),"utf8"),context,{filename:file});return window;
}
const moduleSource=fs.readFileSync(path.join(root,"modules/steam-resource-download.js"),"utf8");
const diagnostics=[...new Set([...moduleSource.matchAll(/"([^"\\\r\n]* [^"\\\r\n]*)"/g)].map(match=>match[1]).filter(value=>/^[A-Z][a-z]/.test(value)&&value!=="Use the Steam Mobile App to sign in with this QR code:"))];
test("every selective Steam downloader diagnostic renders in all five actual UI languages",()=>{
  const runtime=translationRuntime();assert.ok(diagnostics.length>=30);
  for(const english of diagnostics){
    assert.equal(runtime.I18n.text(english,"en-US"),english);
    const chinese=runtime.I18n.text(english,"zh-CN");assert.match(chinese,/\p{Script=Han}/u,english);
    for(const locale of ["zh-TW","de-DE","fr-FR"]){const output=runtime.I18n.text(english,locale);assert.notEqual(output,english,locale+": "+english);assert.ok(output.length>4);if(locale!=="zh-TW")assert.doesNotMatch(output,/\p{Script=Han}/u);assert.equal(runtime.I18n.text(output,"en-US"),english);assert.equal(runtime.I18n.text(output,"zh-CN"),chinese);}
  }
});
test("original VTF index and original-skin cache diagnostics use matching multilingual copy",()=>{
  const runtime=translationRuntime(),messages=["缺少经校验的原版 VTF 资源索引。请选择原版资源来源，补齐同一武器的缺失皮肤部分。","原版 VTF 索引缓存与当前游戏版本不匹配或已损坏，请重新选择原版资源。","所选资源未通过当前 Steam 版本的原版 VTF 索引校验，未修改游戏。","原版皮肤缓存路径包含链接，已停止读取"];
  for(const chinese of messages)for(const locale of ["en-US","de-DE","fr-FR"]){const output=runtime.I18n.text(chinese,locale);assert.notEqual(output,chinese);assert.doesNotMatch(output,/\p{Script=Han}/u);}
});
test("original-resource actions describe selective downloads without resetting existing skins",()=>{
  const runtime=translationRuntime();
  for(const locale of ["zh-CN","en-US","zh-TW","de-DE","fr-FR"]){runtime.I18n.preview(locale);for(const key of ["ddsOriginal.steam","ddsOriginal.confirmText","ddsOriginal.confirm","ddsOriginal.installBlockedHint"]){const output=runtime.I18n.t(key);assert.notEqual(output,key);if(locale==="de-DE"||locale==="fr-FR"||locale==="en-US")assert.doesNotMatch(output,/\p{Script=Han}/u);}}
  runtime.I18n.preview("en-US");assert.equal(runtime.I18n.t("ddsOriginal.confirm"),"Start separate download");assert.match(runtime.I18n.t("ddsOriginal.confirmText"),/does not verify the whole installation or reset existing skins/);
});

test("one-click repair instructions, budgets and progress labels are complete in five languages",()=>{
 const runtime=translationRuntime(),keys=['autoInstall','downloadInstall','fileDetails','guideTitle','guide1','guide2','guide3','authHint','steamPrivacyTitle','steamPrivacyData','steamPrivacySession','budget','stagedBudget','stagedConfirm','sourceHint','confirm','checking','helper','authWaiting','authenticated','downloading','verifying','repairing','installing','verified','stagePlan'];
 for(const locale of ['zh-CN','en-US','zh-TW','de-DE','fr-FR']){runtime.I18n.preview(locale);for(const key of keys){const output=runtime.I18n.t('skinRecovery.'+key,{count:2,size:'10 MB',space:'20 MB'});assert(output.length>4,key);assert(!output.includes('skinRecovery.'),key);assert(!/\{(?:count|size|space)\}/.test(output),key);if(!['zh-CN','zh-TW'].includes(locale))assert.doesNotMatch(output,/\p{Script=Han}/u);}}
 runtime.I18n.preview('en-US');assert.match(runtime.I18n.t('skinRecovery.guide2'),/Steam Guard/);assert.match(runtime.I18n.t('skinRecovery.guide2'),/owns Titanfall 2/);assert.match(runtime.I18n.t('skinRecovery.guide3'),/another QR code/);assert.match(runtime.I18n.t('skinRecovery.confirm'),/whole game is not validated/);
});
