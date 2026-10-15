"use strict";
// A history record denotes the skin after installation. Build the whole target
// in memory, then publish one recovery journal and perform one recoverable commit.
const fs=require("fs"),fsp=fs.promises,path=require("path");
const {readJournals,rangeKey}=require("./dds-replacement");
const {readBackupManifest,assertUnlinkedAncestors}=require("./backup-records");
const {packageWeapons,weaponsFor}=require("./skin-switch-weapons");
const {hash,readIndexFile,parseIndex,serializeIndex}=require("./vtf-vpk");
const {INDEX_NAME}=require("./vtf-engine"),{readRange}=require("./dds-engine");
const {restoreWithPlan}=require("./weapon-library-recovery");
const {stateHistory}=require("./weapon-backup-scopes");
const {verifyReferencedArchives}=require("./weapon-library-backup");
const RECORD=/^(dds|vtf):([a-f0-9-]{36})$/,MAX_BYTES=512*1024*1024;
const entryHash=entry=>entry?hash(entry.raw||serializeIndex([entry])):null;
const indexMap=bytes=>new Map(parseIndex(bytes).entries.map(entry=>[entry.path.toLowerCase(),entry]));
async function payload(file,expected,length){
 await assertUnlinkedAncestors(file);const stat=await fsp.lstat(file);
 if(!stat.isFile()||stat.size>128*1024*1024||length!==undefined&&stat.size!==length)throw Error("WEAPON_BACKUP_PAYLOAD_INVALID");
 const bytes=await fsp.readFile(file);if(hash(bytes)!==expected)throw Error("WEAPON_BACKUP_PAYLOAD_INVALID");return bytes;
}
function scope(value,weaponId,format){const owners=weaponsFor(value,format);if(owners.includes(weaponId)&&owners.length!==1)throw Error("WEAPON_BACKUP_SCOPE_AMBIGUOUS");return owners.includes(weaponId);}
function sameScope(a,b,weaponId){for(const key of new Set([...a.keys(),...b.keys()]))if(scope(key,weaponId)&&entryHash(a.get(key))!==entryHash(b.get(key)))return false;return true;}
async function transition({coordinator,root,id,weaponId,transactions,journals}){
 const match=RECORD.exec(id);if(!match)throw Error("WEAPON_RECOVERY_INVALID_RECORD");const [,format,sourceId]=match;
 const core=await readBackupManifest(coordinator[format].baseDir,sourceId,root),m=core.manifest;
 if(!["installed","restored"].includes(m.state))throw Error("WEAPON_STATE_CHAIN_INCOMPLETE");
 if(format==="vtf")coordinator.vtf.validateManifest(m,sourceId,root);
 else if(!journals.some(entry=>entry.manifest.id===sourceId))throw Error("WEAPON_RECOVERY_INVALID_RECORD");
 const links=transactions.filter(entry=>entry.value.format===format&&entry.value.incomingBackupId===sourceId);
 if(links.length>1)throw Error("WEAPON_BACKUP_LINK_INCOMPLETE");const linked=links[0];
 if(m.skinSwitchId&&linked?.value.id!==m.skinSwitchId)throw Error("WEAPON_BACKUP_LINK_MISSING");
 if(linked&&!["installed","restored"].includes(linked.value.state))throw Error("WEAPON_STATE_CHAIN_INCOMPLETE");
 if(linked&&format==="dds"&&m.records.some(row=>scope(row.family||row.name,weaponId,"dds")&&!linked.value.ranges.some(range=>rangeKey(range)===rangeKey(row)&&range.finalHash===row.afterHash&&scope(range.family||range.name,weaponId,"dds"))))throw Error("WEAPON_BACKUP_LINK_INCOMPLETE");
 const source=linked?linked.value.ranges:format==="dds"?m.records:[],directory=linked?linked.dir:core.dir,rows=[];
 for(let i=0;i<source.length;i++){
  const row=source[i];if(!scope(row.family||row.name,weaponId,"dds"))continue;
  const before=await payload(path.join(directory,i+".before.bin"),row.beforeHash,row.length),after=await payload(path.join(directory,i+(linked?".final.bin":".after.bin")),linked?row.finalHash:row.afterHash,row.length);
  rows.push({...row,before,after});
 }
 let before=null,after=null;
 const beforeHash=linked?linked.value.indexBeforeHash:format==="vtf"?m.beforeHash:null,afterHash=linked?linked.value.indexFinalHash:format==="vtf"?m.afterHash:null;
 if(beforeHash){before=indexMap(await payload(path.join(directory,"before-index.vpk"),beforeHash));after=indexMap(await payload(path.join(directory,linked?"final-index.vpk":"after-index.vpk"),afterHash));}
 if(format==="vtf"&&(!before||!after||m.files.some(file=>scope(file.path,weaponId)&&after.get(file.path.toLowerCase())?.index!==m.archiveIndex)))throw Error("WEAPON_BACKUP_LINK_INCOMPLETE");
 return {id,rows,before,after};
}
async function composeRanges(root,steps){
 const touched=steps.flatMap(step=>step.value.rows).sort((a,b)=>a.target.localeCompare(b.target)||a.offset-b.offset),regions=[];
 for(const row of touched){const previous=regions.at(-1);if(previous&&previous.target===row.target&&previous.offset+previous.length>row.offset){previous.length=Math.max(previous.length,row.offset+row.length-previous.offset);}else regions.push({...row});}
 if(regions.reduce((total,row)=>total+row.length,0)>MAX_BYTES||regions.some(row=>row.length>128*1024*1024))throw Error("WEAPON_STATE_PLAN_TOO_LARGE");
 for(const region of regions){region.before=await readRange(path.join(root,"r2/paks/Win64",region.target),region.offset,region.length);region.after=Buffer.from(region.before);}
 for(const step of steps)for(const row of step.value.rows){const region=regions.find(value=>value.target===row.target&&value.offset<=row.offset&&value.offset+value.length>=row.offset+row.length),offset=row.offset-region.offset,expected=step.forward?row.before:row.after,target=step.forward?row.after:row.before;
  if(!region.after.subarray(offset,offset+row.length).equals(expected))throw Error("WEAPON_STATE_CURRENT_CHANGED");target.copy(region.after,offset);
 }
 return regions.filter(row=>!row.before.equals(row.after));
}
async function planState({coordinator,root,weaponId,targetMode,recordId,staging}){
 if(!["installed","original"].includes(targetMode)||targetMode==="installed"&&!RECORD.test(recordId)||targetMode==="original"&&recordId!==undefined)throw Error("WEAPON_RECOVERY_INVALID_REQUEST");
 const transactions=await coordinator.transactions(root),journals=await readJournals(coordinator.dds.baseDir,root),manifests=await coordinator.vtf.manifests(root);
 if(journals.some(entry=>["pending","preparing"].includes(entry.manifest.state))||manifests.some(m=>["pending","preparing"].includes(m.state)))throw Error("WEAPON_BACKUP_PENDING");
 const items=[...journals.filter(entry=>["installed","restored"].includes(entry.manifest.state)).map(entry=>({id:"dds:"+entry.manifest.id,format:"dds",installedAt:entry.manifest.createdAt,weaponIds:packageWeapons("dds",{files:entry.manifest.records.filter(row=>row.role!=="reset")})})),...manifests.filter(m=>["installed","restored"].includes(m.state)).map(m=>({id:"vtf:"+m.id,format:"vtf",installedAt:m.createdAt,weaponIds:packageWeapons("vtf",m)}))];
 const history=stateHistory(items,transactions.map(entry=>entry.value),weaponId),target=targetMode==="installed"?recordId:null;
 if(!history.complete)throw Error("WEAPON_STATE_CHAIN_INCOMPLETE");if(target&&!history.nodes.has(target))throw Error("WEAPON_RECOVERY_INVALID_RECORD");if(history.current===target)throw Error("WEAPON_STATE_NO_CHANGE");
 const metadata={targetMode,targetRecordId:target,fromRecordId:history.current,stateRecordIds:[...history.nodes.keys()],activeRecordIds:history.lineage(target)};
 if(targetMode==="original")return {rows:await coordinator.ddsPlan(root,[weaponId],staging,{repair:false,trackedOnly:true}),vpk:await coordinator.vpkPlan(root,[weaponId]),stateMetadata:metadata};
 const from=history.lineage(history.current),to=history.lineage(target),common=from.find(id=>to.includes(id))||null;
 const undo=from.slice(0,common?from.indexOf(common):from.length),forward=to.slice(0,common?to.indexOf(common):to.length).reverse(),ids=[...new Set([...undo,...forward])],loaded=new Map();
 for(const id of ids)loaded.set(id,await transition({coordinator,root,id,weaponId,transactions,journals}));
 const steps=[...undo.map(id=>({value:loaded.get(id),forward:false})),...forward.map(id=>({value:loaded.get(id),forward:true}))],rows=await composeRanges(root,steps);
 let vpk=null;const indexSteps=steps.filter(step=>step.value.before);
 if(indexSteps.length){
  const bytes=await readIndexFile(path.join(root,"vpk",INDEX_NAME)),current=indexMap(bytes),paths=new Set();
  for(const step of indexSteps){const expected=step.forward?step.value.before:step.value.after,targetIndex=step.forward?step.value.after:step.value.before;
   if(!sameScope(current,expected,weaponId))throw Error("WEAPON_STATE_CURRENT_CHANGED");
   for(const key of new Set([...current.keys(),...targetIndex.keys()]))if(scope(key,weaponId)){if(entryHash(current.get(key))!==entryHash(targetIndex.get(key)))paths.add(key);if(targetIndex.has(key))current.set(key,targetIndex.get(key));else current.delete(key);}
  }
  await verifyReferencedArchives(root,[...current.values()].filter(entry=>scope(entry.path,weaponId)),manifests);
  const after=serializeIndex([...current.values()]);if(hash(bytes)!==hash(after))vpk={before:bytes,after,paths:[...paths]};
 }
 if(typeof coordinator.dds.assertLayout==="function"&&rows.length)await coordinator.dds.assertLayout(root,rows);
 return {rows,vpk,stateMetadata:metadata};
}
async function restoreState(options={}){return restoreWithPlan({...options,purpose:"weapon-state",planner:(root,staging)=>planState({...options,root,staging})});}
module.exports={restoreState,planState};
