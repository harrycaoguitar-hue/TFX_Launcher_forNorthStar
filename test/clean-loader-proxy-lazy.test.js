"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const file=path.resolve(__dirname,'../src/modules/clean-loader-proxy.js');
test('missing bundled manifests do not block no-op recovery; required verification still fails closed',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tfx-lazy-proxy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let reads=0;const wrapped={...fs,readFileSync(filename,...args){if(String(filename).endsWith('manifest.json')){reads++;throw Object.assign(Error('fixture missing manifest'),{code:'ENOENT'});}return fs.readFileSync(filename,...args);}};
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:n=>n==='fs'?wrapped:n.startsWith('.')?require(path.resolve(path.dirname(file),n)):require(n),module:mod,Buffer,__dirname:path.dirname(file)});
 assert.equal(reads,0);assert.equal((await mod.exports.recover(root)).restored,false);assert.equal((await mod.exports.prepare(root)).changed,false);assert.equal(reads,0);
 const proxy=path.join(root,'bin/x64_retail/wsock32.dll');fs.mkdirSync(path.dirname(proxy),{recursive:true});fs.writeFileSync(proxy,'fixture proxy');
 await assert.rejects(mod.exports.prepare(root),e=>e.code==='CLEAN_PROXY_RECOVERY');assert.equal(reads,1);assert.equal(fs.readFileSync(proxy,'utf8'),'fixture proxy');
});
