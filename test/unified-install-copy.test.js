'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('unified intake messages load from the real locale strings table with preserved placeholders',()=>{
 const root=path.join(__dirname,'../src'),window={};vm.runInNewContext(fs.readFileSync(path.join(root,'app/js/locales.js'),'utf8'),{window});
 vm.runInNewContext(fs.readFileSync(path.join(root,'app/js/skin-import-copy.js'),'utf8'),{window});
 const copy=Object.entries(window.VyraLocales.messages).filter(([key])=>key.startsWith('skinImport.'));
 assert(copy.some(([key])=>key==='skinImport.heading'));
 for(const [key,[,en]] of copy)assert.doesNotMatch(en,/\bMy mods\b/,key+' must use My Mods');
 assert.doesNotMatch(fs.readFileSync(path.join(root,'app/js/locales.js'),'utf8'),/My mods/);
 for(const locale of ['zh-TW','de-DE','fr-FR']){
  const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lang/ui-'+locale+'.json'),'utf8'));
  assert.deepEqual(Object.keys(dictionary).sort(),['locale','strings']);
  for(const[key,[zh,en]]of copy){
   if(zh===en)continue;
   const localized=dictionary.strings[en];assert.equal(typeof localized,'string',locale+' missing '+key);assert(localized.trim());
   assert.deepEqual((localized.match(/\{\w+\}|\$\d/g)||[]).sort(),(en.match(/\{\w+\}|\$\d/g)||[]).sort(),locale+' placeholders '+key);
  }
  const heading=dictionary.strings[window.VyraLocales.messages['skinImport.heading'][1]];
  assert.notEqual(heading,window.VyraLocales.messages['skinImport.heading'][1],locale+' must not fall back to English');
  assert.match(heading,/Mod/);
 }
});
