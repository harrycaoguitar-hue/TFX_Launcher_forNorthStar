'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {DdsEngine}=require('../src/modules/dds-engine'),{VtfEngine}=require('../src/modules/vtf-engine'),{importLocalMod}=require('../src/modules/local-mod-import');
const usage='Usage: node test/skin-sample-inspect.cjs --dds "path/to/skin.zip" --vtf "path/to/skin.rar" [--report "path/to/report.json"]\nOr set TFX_SKIN_SAMPLES_JSON to [["dds","path"],["vtf","path"]]. Inputs are read-only; no game installation is required.';
function inputs(){
 const samples=process.env.TFX_SKIN_SAMPLES_JSON?JSON.parse(process.env.TFX_SKIN_SAMPLES_JSON):[];
 if(!Array.isArray(samples))throw Error('TFX_SKIN_SAMPLES_JSON must be an array.');
 let reportPath=process.env.TFX_SKIN_SAMPLE_REPORT||path.join(os.tmpdir(),'tfx-skin-samples-'+crypto.randomUUID()+'.json');
 const args=process.argv.slice(2);for(let i=0;i<args.length;i++){const flag=args[i];if(flag==='--help')return {help:true};if(!['--dds','--vtf','--report'].includes(flag)||!args[i+1])throw Error('Unknown or incomplete sample argument: '+flag);const value=args[++i];if(flag==='--report')reportPath=value;else samples.push([flag.slice(2),value]);}
 for(const item of samples)if(!Array.isArray(item)||item.length!==2||!['dds','vtf'].includes(item[0])||typeof item[1]!=='string'||!item[1].trim())throw Error('Each sample must contain a dds/vtf format and a file path.');
 return {samples:samples.map(([format,file])=>[format,path.resolve(file)]),reportPath:path.resolve(reportPath)};
}
async function shaFile(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
async function main(){
 const options=inputs();if(options.help||!options.samples.length){console.log(usage);return;}
 for(const[,file]of options.samples){const stat=await fsp.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Sample must be a regular archive file: '+file);}
 if(options.samples.some(([,file])=>file.toLowerCase()===options.reportPath.toLowerCase()))throw Error('Report cannot replace an input sample.');
 const work=await fsp.mkdtemp(path.join(os.tmpdir(),'tfx-skin-sample-validation-'));
 try{
  const game=path.join(work,'isolated-game');await fsp.mkdir(game);await fsp.writeFile(path.join(game,'Titanfall2.exe'),'isolated fixture');await fsp.writeFile(path.join(game,'NorthstarLauncher.exe'),'isolated fixture');
  const dds=new DdsEngine({baseDir:path.join(work,'dds')}),vtf=new VtfEngine({baseDir:path.join(work,'vtf'),toolsDir:path.resolve(__dirname,'../src/tools/vtf')}),results=[];
  for(const[format,file]of options.samples){
   const before=await shaFile(file),stat=await fsp.stat(file),engine=format==='dds'?dds:vtf,pkg=await engine.inspect(file);assert(pkg.count>0);
   const wrong=format==='dds'?vtf:dds;let wrongError;try{await wrong.inspect(file);throw Error('Wrong-format import unexpectedly succeeded');}catch(error){wrongError=error.message;assert.match(wrongError,format==='dds'?/DDS 皮肤/:/DDS.*(?:安装包|皮肤)/);}
   let modError;try{await importLocalMod(file,{gamePath:game,profileDirectory:path.join(game,'R2Northstar'),cacheRoot:path.join(work,'local-mod-cache')});throw Error('Skin unexpectedly imported as mod');}catch(error){modError=error.message;assert.match(modError,/皮肤|mod.json|ZIP/);}
   const after=await shaFile(file);assert.equal(before,after);assert.equal(fs.existsSync(path.join(game,'R2Northstar')),false);
   const result={format,path:file,bytes:stat.size,sha256:before,sourceUnchanged:true,package:{count:pkg.count,bytes:pkg.bytes,textures:pkg.textures,animated:pkg.animated,coverage:pkg.coverage},wrongFormatError:wrongError,externalModImportError:modError};results.push(result);console.log('SKIN_SAMPLE_VERIFIED '+JSON.stringify(result));
  }
  const report={schemaVersion:1,samples:results,realGameFilesTouched:false,limits:'Read-only user-provided inputs inspected in an owned temporary fixture. No real-game visual correctness claimed.',exitStatus:0};await fsp.mkdir(path.dirname(options.reportPath),{recursive:true});await fsp.writeFile(options.reportPath,JSON.stringify(report,null,2)+'\n');assert.deepEqual(JSON.parse(await fsp.readFile(options.reportPath)),JSON.parse(JSON.stringify(report)));console.log('SKIN_SAMPLES_PASS '+options.reportPath);
 }finally{assert.equal(path.dirname(work),path.resolve(os.tmpdir()));assert(path.basename(work).startsWith('tfx-skin-sample-validation-'));const stat=await fsp.lstat(work);assert(stat.isDirectory()&&!stat.isSymbolicLink());await fsp.rm(work,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
