"use strict";
// Valid skin checkpoints are history, not cache. Only proven detached, inactive
// cancelled/rolled-back imports are disposable. The caller holds the coordinator
// lock and the shared operation gate; no live game file is ever removed here.
const fs=require("fs"),fsp=fs.promises,path=require("path");
const {readJournals}=require("./dds-replacement");
const {readRecord,inspectRemoval,removeRecord,assertUnlinkedAncestors}=require("./backup-records");
const {readRange}=require("./dds-engine");
const {hash,readIndexFile,parseIndex}=require("./vtf-vpk");
const {INDEX_NAME}=require("./vtf-engine");
const DISPOSABLE=new Set(["cancelled","rolled-back"]);
const UUID=/^[a-f0-9-]{36}$/,RECORD=/^(?:dds|vtf):([a-f0-9-]{36})$/;
function references(value,result=new Set(),depth=0){
 if(depth>40)throw Error("WEAPON_BACKUP_PRUNE_METADATA_INVALID");
 if(typeof value==="string"){const m=RECORD.exec(value);if(m)result.add(m[1]);else if(UUID.test(value))result.add(value);}
 else if(Array.isArray(value)){for(const entry of value)references(entry,result,depth+1);}
 else if(value&&typeof value==="object")for(const [key,entry]of Object.entries(value))if(key!=="id")references(entry,result,depth+1);
 return result;
}
async function snapshot(coordinator,root){
 const journals=await readJournals(coordinator.dds.baseDir,root),manifests=await coordinator.vtf.manifests(root),transactions=await coordinator.transactions(root);
 if(journals.length+manifests.length+transactions.length>9000)throw Error("WEAPON_BACKUP_PRUNE_LIMIT");
 if(journals.some(e=>["pending","preparing"].includes(e.manifest.state))||manifests.some(m=>["pending","preparing"].includes(m.state)))throw Error("WEAPON_BACKUP_PENDING");
 const records=[];
 for(const [format,list]of [["dds",journals.map(e=>e.manifest)],["vtf",manifests]])for(const m of list){
  const record=await readRecord(path.join(coordinator[format].baseDir,"backups"),m.id,root);records.push({format,...record});
 }
 const txRecords=[];for(const entry of transactions)txRecords.push(await readRecord(coordinator.baseDir,entry.value.id,root,"transaction.json"));
 const fingerprint=JSON.stringify([...records.map(r=>[r.format,r.manifest.id,r.sha256]),...txRecords.map(r=>["switch",r.manifest.id,r.sha256])].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
 const referenced=new Set();for(const r of [...records,...txRecords])references(r.manifest,referenced);
 return {records,referenced,fingerprint};
}
async function pruneUnlinkedBackups({coordinator,gamePath,stillCurrent=()=>true}={}){
 if(!coordinator||coordinator.busy!==true)throw Error("WEAPON_BACKUP_PRUNE_LOCK_REQUIRED");
 await assertUnlinkedAncestors(path.resolve(gamePath));const root=await fsp.realpath(path.resolve(gamePath));
 const current=()=>{if(!stillCurrent())throw Error("STALE_WEAPON_LIBRARY");};current();await coordinator.assertReady(root);
 if(await coordinator.dds.isGameRunning())throw Error("WEAPON_BACKUP_PRUNE_GAME_RUNNING");
 const initial=await snapshot(coordinator,root),result={deleted:[],skipped:[],bytes:0,files:0,gameFilesRemoved:0};
 const candidates=[];let vtfIndex;
 for(const record of initial.records){
  const {manifest:m,format}=record,id=format+":"+m.id;
  let reason=!DISPOSABLE.has(m.state)?"history-preserved":initial.referenced.has(m.id)?"referenced":"";
  if(!reason&&format==="dds")for(const row of m.records){
   try{const file=path.join(root,"r2/paks/Win64",row.target);await assertUnlinkedAncestors(file);if(hash(await readRange(file,row.offset,row.length))===row.afterHash){reason="live-resource";break;}}
   catch{reason="live-resource-unverified";break;}
  }
  if(!reason&&format==="vtf"){
   if(vtfIndex===undefined)try{vtfIndex=parseIndex(await readIndexFile(path.join(root,"vpk",INDEX_NAME))).entries;}catch{vtfIndex=null;}
   if(!vtfIndex)reason="live-resource-unverified";
   else if(vtfIndex.some(e=>e.index===m.archiveIndex))reason="live-resource";
  }
  if(reason){result.skipped.push({id,reason});continue;}
  await inspectRemoval(path.join(coordinator[format].baseDir,"backups"),m.id,record);
  candidates.push(record);
 }
 current();
 // Reopen every metadata source after the complete deletion preflight. External
 // changes must never turn a detached record into an unseen dependency.
 if((await snapshot(coordinator,root)).fingerprint!==initial.fingerprint)throw Error("WEAPON_BACKUP_PRUNE_CHANGED");
 for(const record of candidates){
  current();if(await coordinator.dds.isGameRunning())throw Error("WEAPON_BACKUP_PRUNE_GAME_RUNNING");
  const removed=await removeRecord(path.join(coordinator[record.format].baseDir,"backups"),record.manifest.id,record);
  result.deleted.push({id:record.format+":"+record.manifest.id,bytes:removed.bytes,files:removed.files});result.bytes+=removed.bytes;result.files+=removed.files;
 }
 return result;
}
module.exports={pruneUnlinkedBackups,references};
