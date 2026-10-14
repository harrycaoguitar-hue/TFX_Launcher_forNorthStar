'use strict';
// Each consumer supplies a policy that is checked on every redirect.
const https=require('https'),zlib=require('zlib');
class ResourceError extends Error{constructor(code,message){super(message);this.code=code;}}
function requestBuffer(address,{transport=https,allowURL=()=>false,timeoutMs=15000,maxBytes=12*1024*1024,maxRedirects=3,headers={},signal}={}){
  return new Promise((resolve,reject)=>{
    let request,response,decoder,timer,done=false,visited=0;
    const stop=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){response?.destroy();decoder?.destroy();request?.destroy();reject(error);}else resolve(value);};
    const abort=()=>stop(new ResourceError('CANCELLED','Request cancelled'));
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>stop(new ResourceError('TIMEOUT','Public metadata request timed out')),timeoutMs);
    function open(value){
      if(done)return;
      let url;try{url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!allowURL(url))throw Error();}catch{stop(new ResourceError('UNTRUSTED_URL','Public resource address is not allowed'));return;}
      try{request=transport.get(url,{headers:{'User-Agent':'TFX-Launcher','Accept':'application/json','Accept-Encoding':'gzip, deflate, br',...headers}},res=>{
        if(done){res.destroy();return;}
        response=res;
        res.on('error',()=>stop(new ResourceError('NETWORK','Public resource connection failed')));
        res.on('aborted',()=>stop(new ResourceError('TRUNCATED','Public resource connection ended early')));
        if([301,302,303,307,308].includes(res.statusCode)){
          const location=res.headers?.location;res.resume();if(!location||visited++>=maxRedirects){stop(new ResourceError('REDIRECT','Public resource redirected too many times'));return;}
          try{open(new URL(location,url).href);}catch{stop(new ResourceError('REDIRECT','Public resource redirect is invalid'));}return;
        }
        if(res.statusCode!==200){res.resume();const error=new ResourceError(res.statusCode===429?'RATE_LIMIT':'HTTP_ERROR','Public resource returned HTTP '+res.statusCode);error.statusCode=res.statusCode;stop(error);return;}
        const length=Number(res.headers?.['content-length']);if(Number.isFinite(length)&&length>maxBytes){stop(new ResourceError('RESPONSE_TOO_LARGE','Public resource exceeds the size limit'));return;}
        const encoding=String(res.headers?.['content-encoding']||'identity').toLowerCase();
        decoder=encoding==='gzip'?zlib.createGunzip():encoding==='deflate'?zlib.createInflate():encoding==='br'?zlib.createBrotliDecompress():null;
        if(!decoder&&encoding!=='identity'){stop(new ResourceError('ENCODING','Public resource encoding is unsupported'));return;}
        const stream=decoder||res,parts=[];let count=0,wireBytes=0;
        res.on('data',b=>{wireBytes+=b.length;if(wireBytes>maxBytes)stop(new ResourceError('RESPONSE_TOO_LARGE','Public resource exceeds the size limit'));});
        res.on('aborted',()=>stop(new ResourceError('TRUNCATED','Public resource connection ended early')));res.on('error',()=>stop(new ResourceError('NETWORK','Public resource connection failed')));
        stream.on('error',()=>stop(new ResourceError('ENCODING','Public resource could not be decoded')));
        stream.on('data',b=>{count+=b.length;if(count>maxBytes){stop(new ResourceError('RESPONSE_TOO_LARGE','Decoded resource exceeds the size limit'));return;}parts.push(b);});
        stream.on('end',()=>{if(Number.isFinite(length)&&length>0&&wireBytes!==length){stop(new ResourceError('TRUNCATED','Public resource length does not match'));return;}stop(null,{url:url.href,headers:res.headers,statusCode:res.statusCode,bytes:Buffer.concat(parts)});});
        if(decoder)res.pipe(decoder);
      });request.on('error',()=>stop(new ResourceError('NETWORK','Could not connect to public resource')));request.setTimeout?.(timeoutMs,()=>stop(new ResourceError('TIMEOUT','Public resource request timed out')));}catch{stop(new ResourceError('NETWORK','Could not start public resource request'));}
    }
    open(address);
  });
}
module.exports={requestBuffer,ResourceError};
