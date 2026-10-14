"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),path=require("path"),vm=require("vm"),{createRequire}=require("module");
const rules=require("../src/locale");
test("initial system language selects Chinese variants or English without a location request",()=>{
  for(const[system,expected]of [["zh-CN","zh-CN"],["zh-SG","zh-CN"],["zh-TW","zh-TW"],["zh-Hant-HK","zh-TW"],["en-GB","en-US"],["de-DE","en-US"],["fr-FR","en-US"],["ja-JP","en-US"],[undefined,"en-US"]])assert.equal(rules.systemDefault(system),expected);
});
test("saved supported languages normalize region variants without overriding personal choices",()=>{
  for(const[tag,expected]of [["zh_HK","zh-TW"],["zh-Hant","zh-TW"],["de-AT","de-DE"],["fr-CA","fr-FR"],["en-AU","en-US"],["zh-Hans","zh-CN"]])assert.equal(rules.normalize(tag,"zh-CN"),expected);
  assert.equal(rules.normalize("../outside","zh-CN"),"zh-CN");
});
test("system language detection tolerates unavailable Electron APIs",()=>{
  assert.equal(rules.detectSystemLanguage({getPreferredSystemLanguages:()=>["fr-FR"],getSystemLocale:()=>"zh-CN"}),"fr-FR");
  assert.equal(rules.detectSystemLanguage({getPreferredSystemLanguages:()=>{throw Error("not ready");},getSystemLocale:()=>"zh-TW"}),"zh-TW");
});
function loadLang(system,saved){
  const file=path.join(__dirname,"../src/lang.js"),req=createRequire(file),config=saved?{uiLanguage:saved}:{};
  const json=name=>path.basename(name)==="fold.json"?config:JSON.parse(fs.readFileSync(name,"utf8"));
  const context={require:id=>id==="electron"?{app:{getPreferredSystemLanguages:()=>[system]}}:id==="./modules/json"?json:req(id),module:{exports:{}},__dirname:path.dirname(file),process:{cwd:()=>"D:/Isolated-Language-Preferences"}};
  vm.runInNewContext(fs.readFileSync(file,"utf8"),context,{filename:file});return context.module.exports;
}
test("actual language module uses first-run defaults and preserves saved multilingual preferences",()=>{
  assert.equal(loadLang("en-GB").getLocale(),"en-US");assert.equal(loadLang("zh-TW").getLocale(),"zh-TW");assert.equal(loadLang("de-DE").getLocale(),"en-US");
  const french=loadLang("zh-CN","fr-FR"),german=loadLang("zh-CN","de-DE"),traditional=loadLang("en-US","zh-TW");
  assert.equal(french.getLocale(),"fr-FR");assert.equal(german.getLocale(),"de-DE");assert.equal(traditional.getLocale(),"zh-TW");
  assert.equal(french("gui.launch"),"Jouer");
});
