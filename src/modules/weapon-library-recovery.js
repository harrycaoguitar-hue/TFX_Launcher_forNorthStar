"use strict";
// Weapon recovery reuses validated per-weapon plans and the durable write journal.
// A selected record never rolls the other weapons in its package back as one unit.
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto");
const {hash,readIndexFile}=require("./vtf-vpk");
const {readRange}=require("./dds-engine");
const {INDEX_NAME}=require("./vtf-engine");
const {weapons}=require("./weapon-library-catalogue");
const {assertUnlinkedAncestors}=require("./backup-records");
const IDS=new Set(weapons.map(weapon=>weapon.id));
async function json(file,value){
 const temporary=file+".tmp",handle=await fsp.open(temporary,"w");
 try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}
 await fsp.rename(temporary,file);
}
async function restoreWithPlan({coordinator,gamePath,weaponId,progress=()=>{},stillCurrent=()=>true,timestampFloor=0,purpose="weapon-original",recordId,targetMode,planner}={}){
 if(typeof weaponId!=="string"||!IDS.has(weaponId))throw Error("WEAPON_RECOVERY_INVALID_WEAPON");
 if(!coordinator)throw Error("WEAPON_RECOVERY_UNAVAILABLE");
 return coordinator.locked(gamePath,async root=>{
  if(!stillCurrent())throw Error("STALE_WEAPON_LIBRARY");
  await coordinator.assertReady(root);
  const emit=data=>progress({...data,...(purpose==="weapon-state"?{targetMode,...(recordId?{recordId}:{})}:{})});
  emit({phase:"preparing",percent:5,weaponId});
  const transactions=await coordinator.transactions(root),newest=transactions.reduce((value,entry)=>Math.max(value,Date.parse(entry.value.createdAt)),0);
  const id=crypto.randomUUID(),dir=path.join(coordinator.baseDir,id),staging=path.join(coordinator.baseDir,".preparing-"+id);
  await assertUnlinkedAncestors(coordinator.baseDir);await fsp.mkdir(staging);
  const tx={version:1,id,purpose,format:"dds",name:weaponId,gamePath:root,weapons:[weaponId],createdAt:new Date(Math.max(Date.now(),newest+1,Number.isFinite(timestampFloor)?timestampFloor+1:0)).toISOString(),state:"preparing",ranges:[],incomingBackupId:null,...(recordId?{sourceRecordId:recordId}:{})};
  let published=false;
  try{
   const {rows,vpk,sourceSwitchId,stateMetadata}=await planner(root,staging);
   if(purpose==="weapon-state"){
    if(!stateMetadata||!require("./weapon-backup-scopes").validStateMetadata(stateMetadata))throw Error("WEAPON_STATE_CHAIN_INVALID");
    Object.assign(tx,stateMetadata);delete tx.sourceRecordId;
   }
   if(sourceSwitchId)tx.sourceSwitchId=sourceSwitchId;
   for(const row of rows)await coordinator.saveRange(tx,staging,row);
   if(vpk&&hash(vpk.before)!==hash(vpk.after)){
    await fsp.writeFile(path.join(staging,"before-index.vpk"),vpk.before,{flag:"wx"});
    await fsp.writeFile(path.join(staging,"clean-index.vpk"),vpk.after,{flag:"wx"});
    tx.indexBeforeHash=hash(vpk.before);tx.indexCleanHash=hash(vpk.after);tx.vpkPaths=vpk.paths;
   }
   if(!stillCurrent())throw Error("STALE_WEAPON_LIBRARY");
   tx.state="prepared";await json(path.join(staging,"transaction.json"),tx);await fsp.rename(staging,dir);published=true;
   if(!stillCurrent())throw Error("STALE_WEAPON_LIBRARY");
   emit({phase:"restoring",percent:35,weaponId});
   await coordinator.commitClean(root,tx,dir);
   emit({phase:"verifying",percent:90,weaponId});
   for(const row of tx.ranges)if(hash(await readRange(path.join(root,"r2/paks/Win64",row.target),row.offset,row.length))!==row.cleanHash)throw Error("WEAPON_RECOVERY_VERIFY_FAILED");
   if(tx.indexCleanHash&&hash(await readIndexFile(path.join(root,"vpk",INDEX_NAME)))!==tx.indexCleanHash)throw Error("WEAPON_RECOVERY_VERIFY_FAILED");
   tx.state="restored";tx.restoredAt=new Date().toISOString();await json(path.join(dir,"transaction.json"),tx);
   emit({phase:"complete",percent:100,weaponId});
   return {...(purpose==="weapon-state"?{stateRestored:true,targetMode,...(recordId?{recordId}:{})}:purpose==="weapon-backup"?{backupRestored:true,recordId}:{restored:true}),weaponId,recoveryId:id,rangeCount:tx.ranges.length,vtfPathCount:tx.vpkPaths?.length||0};
  }catch(error){
   if(published){
    tx.error=error.message;
    try{if(tx.state==="prepared"){tx.state="cancelled";await json(path.join(dir,"transaction.json"),tx);}else await coordinator.rollback(root,tx,dir);}
    catch(recoveryError){tx.state="recovery-required";tx.recoveryError=recoveryError.message;await json(path.join(dir,"transaction.json"),tx);throw Error("WEAPON_RECOVERY_REQUIRED:"+id+":"+recoveryError.message);}
   }else{
    // Only our unpublished private staging folder is removed. Live game bytes
    // cannot have changed before the journal's atomic publication above.
    await assertUnlinkedAncestors(staging);await fsp.rm(staging,{recursive:true,force:true});
   }
   throw error;
  }
 });
}
async function restoreOriginal(options={}){
 const {coordinator,weaponId}=options;
 // Recover only DDS writes represented in this library, never expand unsafe
 // legacy melee metadata or implicitly repair live files outside this journal.
 return restoreWithPlan({...options,purpose:"weapon-original",planner:async(root,staging)=>({rows:await coordinator.ddsPlan(root,[weaponId],staging,{repair:false,trackedOnly:true}),vpk:await coordinator.vpkPlan(root,[weaponId])})});
}
module.exports={restoreOriginal,restoreWithPlan};
