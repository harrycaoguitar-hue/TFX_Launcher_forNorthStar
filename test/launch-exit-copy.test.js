"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {LaunchConfirmation}=require("../src/modules/launch-session");
const root=path.join(__dirname,"../src");
function runtime(){
  const window={addEventListener(){},dispatchEvent(){}},document={body:null};
  const context={window,document,fold:{normalizeUiLanguage:value=>value,loadSettings:()=>({data:{uiLanguage:"en-US"}}),loadLocale:locale=>JSON.parse(fs.readFileSync(path.join(root,"lang","ui-"+locale+".json"),"utf8")).strings,translateText:value=>value,setUiLanguage(){},translate:value=>value},ipcRenderer:{on(){}},MutationObserver:class{observe(){}disconnect(){}},CustomEvent:class{},requestAnimationFrame:()=>0};
  vm.createContext(context);
  for(const file of ["locales.js","client-copy.js","i18n.js"])vm.runInContext(fs.readFileSync(path.join(root,"app/js",file),"utf8"),context,{filename:file});
  return window.I18n;
}

test("actual unready-loader exit messages render all five languages and retain exit evidence",()=>{
  const i18n=runtime(),confirmation=new LaunchConfirmation({});
  const samples=[null,{code:3221226505},{signal:"SIGTERM"}].map(childExit=>confirmation.exitError({requireReady:true,ready:false,everCandidate:true,childExit}).message);
  for(const locale of ["zh-CN","en-US","zh-TW","de-DE","fr-FR"]){
    i18n.preview(locale);
    for(const [index,source]of samples.entries()){
      const text=i18n.text(source);assert.ok(text.length>60);assert.match(text,/Mod/);assert.match(text,/EA App \/ Steam/);
      if(index===1)assert.match(text,/3221226505/);if(index===2)assert.match(text,/SIGTERM/);
      if(locale!=="zh-CN")assert.notEqual(text,source);
      if(!locale.startsWith("zh"))assert.doesNotMatch(text,/\p{Script=Han}/u);
      if(locale==="zh-TW")assert.match(text,/主選單/);
      if(locale==="de-DE")assert.match(text,/Hauptmenü/);
      if(locale==="fr-FR")assert.match(text,/menu principal/);
    }
  }
});
