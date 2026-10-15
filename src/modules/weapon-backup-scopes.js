"use strict";
const {weaponsFor}=require("./skin-switch-weapons");
const RECORD=/^(dds|vtf):[a-f0-9-]{36}$/;
function consumedScopes(transactions=[]){
 const scopes=new Map();
 for(const tx of [...transactions].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))if(tx.purpose==="weapon-backup"&&tx.state==="restored"&&RECORD.test(tx.sourceRecordId)&&Array.isArray(tx.weapons)){
  if(!scopes.has(tx.sourceRecordId))scopes.set(tx.sourceRecordId,new Set());
  for(const weapon of tx.weapons)scopes.get(tx.sourceRecordId).add(weapon);
 }else if(tx.purpose==="weapon-state"&&tx.state==="restored"&&Array.isArray(tx.weapons)&&validStateMetadata(tx)){
  const active=new Set(tx.activeRecordIds);
  for(const id of tx.stateRecordIds)if(RECORD.test(id)){if(!scopes.has(id))scopes.set(id,new Set());for(const weapon of tx.weapons){if(active.has(id))scopes.get(id).delete(weapon);else scopes.get(id).add(weapon);}}
 }
 return scopes;
}
function activeStateScopes(transactions=[]){
 const active=new Map();
 const time=tx=>!tx.purpose&&tx.restoredAt||tx.createdAt;
 for(const tx of [...transactions].sort((a,b)=>time(a).localeCompare(time(b))))if(tx.state==="restored"&&Array.isArray(tx.weapons)){
  if(tx.purpose==="weapon-state"&&validStateMetadata(tx)){
   const selected=new Set(tx.activeRecordIds);for(const id of tx.stateRecordIds){if(!active.has(id))active.set(id,new Set());for(const weapon of tx.weapons){if(selected.has(id))active.get(id).add(weapon);else active.get(id).delete(weapon);}}
  }else if(tx.purpose==="weapon-original"){for(const scopes of active.values())for(const weapon of tx.weapons)scopes.delete(weapon);}
  else{const id=tx.purpose==="weapon-backup"?tx.sourceRecordId:tx.incomingBackupId?tx.format+":"+tx.incomingBackupId:null;if(active.has(id))for(const weapon of tx.weapons)active.get(id).delete(weapon);}
 }
 return active;
}
function stateHistory(items,transactions=[],weaponId){
 const nodes=new Map(),linked=new Map(transactions.filter(tx=>tx.incomingBackupId&&["installed","restored"].includes(tx.state)).map(tx=>[tx.format+":"+tx.incomingBackupId,tx]));
 const events=[];
 for(const item of items)if(["dds","vtf"].includes(item.format)&&item.weaponIds.includes(weaponId)){
  const tx=linked.get(item.id),node={id:item.id,name:item.name,format:item.format,time:tx?.createdAt||item.installedAt,parent:null};nodes.set(item.id,node);events.push({time:node.time,kind:"install",id:item.id});
 }
 for(const tx of transactions)if(tx.state==="restored"&&tx.weapons?.includes(weaponId)){
  if(tx.purpose==="weapon-original"||tx.purpose==="weapon-backup"||tx.purpose==="weapon-state")events.push({time:tx.createdAt,kind:tx.purpose,tx});
  else if(tx.incomingBackupId&&tx.restoredAt)events.push({time:tx.restoredAt,kind:"weapon-backup",tx:{sourceRecordId:tx.format+":"+tx.incomingBackupId}});
 }
 let current=null,complete=!items.some(item=>item.weaponIds.includes(weaponId)&&item.stateRecordUnavailable);const installed=new Set();
 for(const tx of transactions)if(tx.incomingBackupId&&["installed","restored"].includes(tx.state)&&tx.weapons?.includes(weaponId)&&!nodes.has(tx.format+":"+tx.incomingBackupId))complete=false;
 for(const event of events.sort((a,b)=>a.time.localeCompare(b.time)||(a.kind===b.kind?0:a.kind==="install"?-1:b.kind==="install"?1:a.kind.localeCompare(b.kind))||String(a.id||a.tx?.id||"").localeCompare(String(b.id||b.tx?.id||"")))){
  if(event.kind==="install"){nodes.get(event.id).parent=current;installed.add(event.id);current=event.id;}
  else if(event.kind==="weapon-original")current=null;
  else if(event.kind==="weapon-state"){const target=event.tx.targetRecordId||null;if(!validStateMetadata(event.tx)||target!==null&&!installed.has(target)){complete=false;continue;}const active=lineage(target);if(active.length!==event.tx.activeRecordIds.length||active.some(id=>!event.tx.activeRecordIds.includes(id))||event.tx.stateRecordIds.length!==installed.size||event.tx.stateRecordIds.some(id=>!installed.has(id))){complete=false;continue;}current=target;}
  else {const source=nodes.get(event.tx.sourceRecordId);if(!source||!installed.has(source.id)){complete=false;continue;}current=source.parent;}
 }
 function lineage(id){const result=[],seen=new Set();while(id){if(seen.has(id)||!nodes.has(id))throw Error("WEAPON_STATE_CHAIN_INVALID");seen.add(id);result.push(id);id=nodes.get(id).parent;}return result;}
 return {nodes,current,complete,lineage};
}
function validStateMetadata(tx){return ["installed","original"].includes(tx.targetMode)&&(tx.targetMode==="original"?tx.targetRecordId===null:RECORD.test(tx.targetRecordId))&&Array.isArray(tx.stateRecordIds)&&tx.stateRecordIds.length<=6000&&tx.stateRecordIds.every(id=>RECORD.test(id))&&new Set(tx.stateRecordIds).size===tx.stateRecordIds.length&&Array.isArray(tx.activeRecordIds)&&tx.activeRecordIds.every(id=>tx.stateRecordIds.includes(id))&&new Set(tx.activeRecordIds).size===tx.activeRecordIds.length&&(tx.targetRecordId===null||tx.activeRecordIds.includes(tx.targetRecordId));}
function annotateStateAvailability(items,transactions,{blockedReason="",pending=false}={}){
 const weapons=[...new Set(items.flatMap(item=>item.weaponIds))],histories=new Map(weapons.map(id=>[id,stateHistory(items,transactions,id)])),original=[];
 for(const item of items){item.stateRestoreWeaponIds=[];item.currentWeaponIds=[];item.stateUnavailableReasons={};
  for(const weapon of item.weaponIds){const history=histories.get(weapon);let reason=item.format==="mod"?"mod-managed-separately":pending?"busy-recovery":blockedReason;
   if(!reason&&item.stateRecordUnavailable)reason=item.stateRecordUnavailable;
   if(!reason&&!history.complete)reason="chain-incomplete";
   if(!reason&&history.current===item.id){item.currentWeaponIds.push(weapon);reason="current-state";}
   if(reason)item.stateUnavailableReasons[weapon]=reason;else item.stateRestoreWeaponIds.push(weapon);
  }
  item.canRestoreState=item.stateRestoreWeaponIds.length>0;
 }
 for(const[weapon,history]of histories)if(history.current&&history.complete&&!blockedReason&&!pending)original.push(weapon);
 return original;
}
function originalBoundaries(transactions=[]){
 const boundaries=new Map();
 for(const tx of transactions)if(tx.purpose==="weapon-original"&&tx.state==="restored"&&Array.isArray(tx.weapons))for(const weapon of tx.weapons)if((boundaries.get(weapon)||"")<tx.createdAt)boundaries.set(weapon,tx.createdAt);
 return boundaries;
}
function sourceTimes(transactions=[]){return new Map(transactions.filter(tx=>tx.state==="installed"&&tx.incomingBackupId).map(tx=>[tx.format+":"+tx.incomingBackupId,tx.createdAt]));}
function markConsumedDds(journals,transactions=[]){
 const consumed=consumedScopes(transactions),active=activeStateScopes(transactions);
 for(const entry of journals){const id="dds:"+entry.manifest.id,scopes=consumed.get(id),restored=entry.manifest.state==="restored",reactivated=active.get(id);
  if(restored&&reactivated?.size)entry.manifest={...entry.manifest,state:"installed"};
  if(scopes||restored&&reactivated?.size)entry.ignoredRecords=new Set(entry.manifest.records.filter(row=>weaponsFor(row.family||row.name,"dds").some(weapon=>scopes?.has(weapon)||restored&&!reactivated?.has(weapon))).map(row=>[row.target,row.offset,row.length].join("|")));
 }
 return journals;
}
function annotateBackupAvailability(items,transactions,{blockedReason="",pending=false}={}){
 const consumed=consumedScopes(transactions),boundaries=originalBoundaries(transactions),times=sourceTimes(transactions),latest=new Map();
 for(const item of items)if(["dds","vtf"].includes(item.format))for(const weapon of item.weaponIds){
  const time=times.get(item.id)||item.installedAt;
  if(consumed.get(item.id)?.has(weapon)||(boundaries.get(weapon)||"")>=time)continue;
  const previous=latest.get(weapon);if(!previous||previous.time<time||previous.time===time&&previous.id<item.id)latest.set(weapon,{id:item.id,time});
 }
 for(const item of items){
  item.backupRestoredWeaponIds=[...(consumed.get(item.id)||[])].filter(weapon=>item.weaponIds.includes(weapon));
  item.backupRestoreWeaponIds=[];item.backupUnavailableReasons={};
  for(const weapon of item.weaponIds){
   let reason=item.format==="mod"?"mod-managed-separately":pending?"busy-recovery":blockedReason;
   if(!reason&&item.sourceState==="restored")reason="already-restored";
   if(!reason&&consumed.get(item.id)?.has(weapon))reason="already-restored";
   if(!reason&&(boundaries.get(weapon)||"")>=(times.get(item.id)||item.installedAt))reason="original-boundary";
   if(!reason&&latest.get(weapon)?.id!==item.id)reason="newer-backup";
   if(reason)item.backupUnavailableReasons[weapon]=reason;else item.backupRestoreWeaponIds.push(weapon);
  }
  item.canRestoreBackup=item.backupRestoreWeaponIds.length>0;
  item.backupUnavailableReason=item.canRestoreBackup?"":Object.values(item.backupUnavailableReasons)[0]||"unassigned";
 }
 return items;
}
module.exports={consumedScopes,originalBoundaries,sourceTimes,annotateBackupAvailability,markConsumedDds,stateHistory,annotateStateAvailability,validStateMetadata,activeStateScopes};
