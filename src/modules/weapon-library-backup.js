"use strict";
const fs=require("fs"),fsp=fs.promises,path=require("path");
const {readJournals,rangeKey}=require("./dds-replacement"),{readBackupManifest,assertUnlinkedAncestors}=require("./backup-records");
const {belongs,packageWeapons,weaponsFor}=require("./skin-switch-weapons");
const {hash,hashFile,readIndexFile,parseIndex,serializeIndex}=require("./vtf-vpk"),{INDEX_NAME,archiveName}=require("./vtf-engine");
const {readRange}=require("./dds-engine"),{restoreWithPlan}=require("./weapon-library-recovery");
const {annotateBackupAvailability}=require("./weapon-backup-scopes");
const RECORD=/^(dds|vtf):([a-f0-9-]{36})$/;
const entryHash=entry=>entry?hash(entry.raw||serializeIndex([entry])):null;
const indexMap=bytes=>new Map(parseIndex(bytes).entries.map(entry=>[entry.path.toLowerCase(),entry]));
async function payload(file,expected,length){
 await assertUnlinkedAncestors(file);const stat=await fsp.lstat(file);
 if(!stat.isFile()||stat.size>128*1024*1024||length!==undefined&&stat.size!==length)throw Error("WEAPON_BACKUP_PAYLOAD_INVALID");
 const bytes=await fsp.readFile(file);if(hash(bytes)!==expected)throw Error("WEAPON_BACKUP_PAYLOAD_INVALID");return bytes;
}
async function verifyReferencedArchives(root,entries,manifests){
 const extents=new Map();for(const entry of entries)for(const chunk of entry.chunks)extents.set(entry.index,Math.max(extents.get(entry.index)||0,chunk.offset+chunk.compressedSize));
 for(const [index,extent]of extents){
  const file=path.join(root,"vpk",archiveName(index));let stat;try{await assertUnlinkedAncestors(file);stat=await fsp.lstat(file);}catch(error){if(error.code==="ENOENT")throw Error("WEAPON_BACKUP_ARCHIVE_MISSING");throw error;}if(!stat.isFile()||stat.size<extent)throw Error("WEAPON_BACKUP_ARCHIVE_MISSING");
  const managed=manifests.filter(m=>m.archiveIndex===index&&m.archiveHash);if(managed.length&&managed.some(m=>m.archiveHash!==managed[0].archiveHash))throw Error("WEAPON_BACKUP_ARCHIVE_CONFLICT");
  if(managed.length&&await hashFile(file)!==managed[0].archiveHash)throw Error("WEAPON_BACKUP_ARCHIVE_INVALID");
 }
}
async function planBackup({coordinator,root,recordId,weaponId}){
 const match=RECORD.exec(recordId);if(!match)throw Error("WEAPON_RECOVERY_INVALID_RECORD");const [,format,id]=match;
 const transactions=await coordinator.transactions(root),journals=await readJournals(coordinator.dds.baseDir,root),manifests=await coordinator.vtf.manifests(root);
 if(journals.some(entry=>["pending","preparing"].includes(entry.manifest.state))||manifests.some(m=>["pending","preparing"].includes(m.state)))throw Error("WEAPON_BACKUP_PENDING");
 const items=[...journals.filter(entry=>entry.manifest.state==="installed").map(entry=>({id:"dds:"+entry.manifest.id,format:"dds",installedAt:entry.manifest.createdAt,weaponIds:packageWeapons("dds",{files:entry.manifest.records})})),...manifests.filter(m=>m.state==="installed").map(m=>({id:"vtf:"+m.id,format:"vtf",installedAt:m.createdAt,weaponIds:packageWeapons("vtf",m)}))];
 annotateBackupAvailability(items,transactions.map(entry=>entry.value));const item=items.find(row=>row.id===recordId);
 if(!item?.backupRestoreWeaponIds.includes(weaponId))throw Error("WEAPON_BACKUP_NOT_AVAILABLE:"+(item?.backupUnavailableReasons[weaponId]||"unassigned"));
 const core=await readBackupManifest(coordinator[format].baseDir,id,root),m=core.manifest;
 if(format==="vtf")coordinator.vtf.validateManifest(m,id,root);
 else if(!journals.some(entry=>entry.manifest.id===id))throw Error("WEAPON_RECOVERY_INVALID_RECORD");
 const linked=transactions.find(entry=>entry.value.format===format&&entry.value.incomingBackupId===id);
 if(m.skinSwitchId&&linked?.value.id!==m.skinSwitchId)throw Error("WEAPON_BACKUP_LINK_MISSING");
 if(linked&&linked.value.state!=="installed")throw Error("WEAPON_BACKUP_NOT_AVAILABLE:already-restored");
 if(linked&&format==="dds"&&m.records.some(row=>belongs(row.family||row.name,[weaponId],"dds")&&!linked.value.ranges.some(range=>rangeKey(range)===rangeKey(row)&&range.finalHash===row.afterHash)))throw Error("WEAPON_BACKUP_LINK_INCOMPLETE");
 const rows=[],rangeSource=linked?linked.value.ranges:format==="dds"?m.records:[],sourceDir=linked?linked.dir:core.dir;
 for(let i=0;i<rangeSource.length;i++){
  const row=rangeSource[i];if(!belongs(row.family||row.name,[weaponId],"dds"))continue;
  const saved=await payload(path.join(sourceDir,i+".before.bin"),row.beforeHash,row.length),expectedHash=linked?row.finalHash:row.afterHash;
  await payload(path.join(sourceDir,i+(linked?".final.bin":".after.bin")),expectedHash,row.length);
  const current=await readRange(path.join(root,"r2/paks/Win64",row.target),row.offset,row.length);if(hash(current)!==expectedHash)throw Error("WEAPON_BACKUP_CURRENT_CHANGED");
  if(hash(current)!==hash(saved))rows.push({...row,before:current,after:saved});
 }
 let vpk=null;
 const beforeHash=linked?linked.value.indexBeforeHash:format==="vtf"?m.beforeHash:null,finalHash=linked?linked.value.indexFinalHash:format==="vtf"?m.afterHash:null;
 if(beforeHash){
  const before=await payload(path.join(sourceDir,"before-index.vpk"),beforeHash),final=await payload(path.join(sourceDir,linked?"final-index.vpk":"after-index.vpk"),finalHash),prior=indexMap(before),expected=indexMap(final),currentBytes=await readIndexFile(path.join(root,"vpk",INDEX_NAME)),current=indexMap(currentBytes),paths=[],targets=[];
  for(const key of new Set([...prior.keys(),...expected.keys()])){
   if(entryHash(prior.get(key))===entryHash(expected.get(key)))continue;
   const owners=weaponsFor(key);if(owners.includes(weaponId)&&owners.length!==1)throw Error("WEAPON_BACKUP_SCOPE_AMBIGUOUS");if(!belongs(key,[weaponId]))continue;
   if(entryHash(current.get(key))!==entryHash(expected.get(key)))throw Error("WEAPON_BACKUP_CURRENT_CHANGED");
   if(prior.has(key)){current.set(key,prior.get(key));targets.push(prior.get(key));}else current.delete(key);paths.push(key);
  }
  await verifyReferencedArchives(root,targets,manifests);
  if(paths.length)vpk={before:currentBytes,after:serializeIndex([...current.values()]),paths};
 }
 if(typeof coordinator.dds.assertLayout==="function"&&rows.length)await coordinator.dds.assertLayout(root,rows);
 return {rows,vpk,sourceSwitchId:linked?.value.id};
}
async function restoreBackup(options={}){
 if(typeof options.recordId!=="string"||!RECORD.test(options.recordId))throw Error("WEAPON_RECOVERY_INVALID_RECORD");
 return restoreWithPlan({...options,purpose:"weapon-backup",planner:root=>planBackup({...options,root})});
}
module.exports={restoreBackup,planBackup,verifyReferencedArchives};
