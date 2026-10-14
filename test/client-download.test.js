"use strict";
const os = require("node:os");
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),path=require("path"),crypto=require("crypto"),{Readable}=require("stream"),{EventEmitter}=require("events");
const {ClientBundleCache,trustedRedirect}=require("../src/modules/northstar-client-cache");
const base=fs.mkdtempSync(path.join(os.tmpdir(), "tfx-client-download-"));
function fixture({body=Buffer.from("client zip fixture"),length=String(body.length),status=200,redirect}={}){
  const root=fs.mkdtempSync(path.join(base,"fixture-")),target=path.join(root,"download.zip"),calls=[];
  const transport={get(url,options,callback){calls.push({url,options});const request=new EventEmitter();request.destroy=()=>{};request.setTimeout=()=>{};
    queueMicrotask(()=>{try{if(redirect)options.beforeRedirect(redirect);const response=Readable.from([body]);response.statusCode=status;response.headers=length===null?{}:{"content-length":length};response.complete=true;callback(response);}catch(error){request.emit("error",error);}});return request;}};
  const cache=new ClientBundleCache({sourceRoot:root,cacheRoot:root,toolsDir:root,validateURL:()=>true,transport});
  const release={region:"global",version:"v1.31.13",download_link:"https://github.com/R2Northstar/Northstar/releases/download/v1.31.13/Northstar.release.v1.31.13.zip"};
  return {cache,release,target,body,calls};
}
test("client download preserves complete bytes with declared or chunked length",async()=>{for(const length of ["18",null]){const f=fixture({length});const digest=await f.cache.download(f.release,f.target);assert.equal(digest,crypto.createHash("sha256").update(f.body).digest("hex"));assert.deepEqual(fs.readFileSync(f.target),f.body);assert.equal(f.calls[0].options.maxRedirects,5);}});
test("client download rejects truncation, malformed length, HTTP and hash failures and removes own file",async()=>{
  for(const options of [{length:"999"},{length:"1"},{length:"NaN"},{length:"1.5"},{length:"268435457"},{status:503},{body:Buffer.alloc(0),length:"0"},{digest:"0".repeat(64)}]){
    const f=fixture(options);if(options.digest)f.release.digest=options.digest;
    await assert.rejects(f.cache.download(f.release,f.target));assert.equal(fs.existsSync(f.target),false,JSON.stringify(options));
  }
});
test("preexisting download target cannot be overwritten or deleted",async()=>{const f=fixture();fs.writeFileSync(f.target,"foreign");await assert.rejects(f.cache.download(f.release,f.target),{code:"EEXIST"});assert.equal(fs.readFileSync(f.target,"utf8"),"foreign");});
test("redirect policy binds HTTPS and exact trusted CDN names to the selected channel",()=>{
  for(const hostname of ["github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"])assert.doesNotThrow(()=>trustedRedirect({protocol:"https:",hostname},"global"));
  for(const hostname of ["gitee.com","foruda.gitee.com"])assert.doesNotThrow(()=>trustedRedirect({protocol:"https:",hostname},"cn"));
  for(const value of [{protocol:"http:",hostname:"github.com"},{protocol:"https:",hostname:"github.com.evil.invalid"},{protocol:"https:",hostname:"gitee.com"},{protocol:"https:",hostname:"github.com",auth:"user:password"},{protocol:"https:",hostname:"github.com",port:444}])assert.throws(()=>trustedRedirect(value,"global"));
});
test("untrusted redirect fails before response is consumed and removes owned target",async()=>{const f=fixture({redirect:{protocol:"https:",hostname:"invalid.example"}});await assert.rejects(f.cache.download(f.release,f.target),/地址/);assert.equal(fs.existsSync(f.target),false);});

test.after(() => {
  assert.equal(path.dirname(base), path.resolve(os.tmpdir()));
  assert(path.basename(base).startsWith("tfx-client-download-"));
  const stat = fs.lstatSync(base); assert(stat.isDirectory() && !stat.isSymbolicLink());
  fs.rmSync(base, {recursive: true, force: true});
});
