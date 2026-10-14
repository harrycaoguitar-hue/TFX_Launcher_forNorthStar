'use strict';
// Compatibility boundary for release metadata callers. TFX owns the bounded
// transport and cache; mod catalog requests delegate to Thunderstore.
const {ipcMain}=require('electron'),{requestBuffer}=require('./http-resource'),thunderstore=require('./thunderstore');
const hosts=new Set(['api.github.com','gitee.com','nscn.wolf109909.top']);
const entries=new Map(),inflight=new Map();
function resource(host,route){if(!hosts.has(host)||typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||/[\x00-\x20\\]/.test(route))throw Error('Unsupported public metadata address');const u=new URL('https://'+host+route);if(u.hostname!==host)throw Error('Unsupported public metadata host');return u;}
function isCatalog(host,route){return ['northstar.thunderstore.io','thunderstore.io'].includes(host)&&['/api/v1/package/','/c/northstar/api/v1/package/'].includes(route);}
function cached(key,minutes=5){const entry=entries.get(key);return entry&&(minutes===false||Date.now()-entry.time<minutes*60000)?entry.data:false;}
async function get(host,route,cacheKey,offlineFallback=true,minutes=5){
  if(isCatalog(host,route))return JSON.stringify(await thunderstore.getCatalog());
  const u=resource(host,route),key=u.href+'|'+String(cacheKey||'');
  const prior=cacheKey?cached(key,minutes):false;if(prior!==false)return prior;if(inflight.has(key))return inflight.get(key);
  const promise=(async()=>{try{const result=await requestBuffer(u.href,{allowURL:x=>x.hostname===host,maxBytes:10*1024*1024,headers:host==='api.github.com'?{Accept:'application/vnd.github+json'}:{}});const value=result.bytes.toString('utf8');JSON.parse(value);if(cacheKey)entries.set(key,{data:value,time:Date.now()});return value;}catch(error){if(offlineFallback&&cacheKey){const old=cached(key,false);if(old!==false)return old;}throw error;}})().finally(()=>inflight.delete(key));inflight.set(key,promise);return promise;
}
const remove=key=>{for(const entry of entries.keys())if(entry.endsWith('|'+key))entries.delete(entry);};remove.all=()=>{entries.clear();thunderstore.clearCache();};
ipcMain.handle('request',async(_event,...args)=>{try{return await get(...args);}catch{return false;}});
ipcMain.on('delete-request-cache',()=>remove.all());
module.exports={get,cache:{get:(key,minutes)=>{for(const name of entries.keys())if(name.endsWith('|'+key))return cached(name,minutes);return false;},set:(key,data)=>entries.set('compat|'+key,{time:Date.now(),data}),delete:remove}};
