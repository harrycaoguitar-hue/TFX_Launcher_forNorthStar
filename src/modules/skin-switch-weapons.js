"use strict";
// Only explicit game resource identifiers establish ownership. Package names,
// readmes and references to shared sights/attachments never widen the scope.
const ALIASES=Object.freeze({
 car:["car","car101","car_smg"],alternator:["alternator","alternator_smg"],r97:["r97","r97_smg"],
 r201:["r201","r201_rifle","r101"],r101:["r101_sfp"],flatline:["flatline","v47flatline","vinson","vinson_rifle"],hemlok:["hemlok","hemlok_bfr_ar","hemlokbfr"],
 spitfire:["spitfire","spitfire_lmg","lmg_hemlok"],devotion:["devotion","hemlok_br"],lstar:["lstar","l_star"],
 g2:["g2","g2a4"],doubletake:["doubletake","double_take"],longbow:["longbow","dmr"],kraber:["kraber"],
 eva8:["eva8","eva_8","eva8_stgn"],mastiff:["mastiff","mastiff_stgn"],wingman:["wingman","b3_wingman"],wingmanelite:["wingman_pstl"],p2016:["p2016","p2011","p2011_pstl"],
 re45:["re45","autopistol"],mozambique:["mozambique","pstl_sa3"],volt:["volt","hemlock_smg"],smartpistol:["smartpistol","smart_pistol","p2011sp"],
 epg:["epg"],coldwar:["coldwar","cold_war"],softball:["softball"],smr:["smr"],archer:["archer"],
 thunderbolt:["thunderbolt","arc_launcher"],charge_rifle:["charge_rifle","charge_rifle_mp","charge_rifle_at"],mgl:["mgl_at"]
});
const DDS_NAMES=Object.freeze({r201:'r201',r101:'r101',hemlokbfr:'hemlok',v47flatline:'flatline',g2a5:'g2',alternator:'alternator',car:'car',r97:'r97',volt:'volt',devotion:'devotion',devotion_clip:'devotion',lstar:'lstar',spitfire:'spitfire',doubletake:'doubletake',kraber:'kraber',longbowdmr:'longbow',eva8:'eva8',mastiff:'mastiff',coldwar:'coldwar',epg:'epg',smr:'smr',softball:'softball',mozambique:'mozambique',p2016:'p2016',re45:'re45',smartpistol:'smartpistol',wingman:'wingman',wingmanelite:'wingmanelite',archer:'archer',chargerifle:'charge_rifle',mgl:'mgl',thunderbolt:'thunderbolt',broadsword:'broadsword',primesword:'primesword',leadwall:'leadwall',plasmarailgun:'plasmarailgun',predatorcannon:'predatorcannon',splitterrifle:'splitterrifle',thermitelauncher:'thermitelauncher',trackercannon:'trackercannon',xo16:'xo16',xo16_clip:'xo16',sword:'sword',kunai:'kunai'});
function weaponsFor(value,format='vtf'){
 if(format==='dds'){const name=String(value||'').replace(/\\/g,'/').split('/').at(-1).toLowerCase().replace(/\.dds$/,'').split('_default')[0];return DDS_NAMES[name]?[DDS_NAMES[name]]:[];}
 const clean=String(value||"").replace(/\\/g,"/").toLowerCase(),matches=[];
 for(const [weapon,aliases] of Object.entries(ALIASES))for(const alias of aliases){
  const pattern=new RegExp('(^|[/_.-])('+alias+')(?![^/_.-])','g');let match;
  while((match=pattern.exec(clean)))matches.push({weapon,start:match.index+match[1].length,end:match.index+match[0].length});
 }
 // r101_sfp and hemlok_br must beat the shorter r101/hemlok token at the
 // same resource site. Separate resource sites still produce an ambiguity.
 return [...new Set(matches.filter(a=>!matches.some(b=>b.start<=a.start&&b.end>=a.end&&(b.end-b.start)>(a.end-a.start))).map(m=>m.weapon))];
}
function packageWeapons(format,pkg){const found=new Set();for(const f of pkg.files){const names=weaponsFor(format==='dds'?f.name:f.path,format);if(names.length>1)throw Error("皮肤武器归属不明确，已停止跨格式替换");for(const name of names)found.add(name);}return [...found];}
function belongs(value,weapons,format='vtf'){const owners=weaponsFor(value,format);return owners.length===1&&weapons.includes(owners[0]);}
// This reverse mapping names only measured DDS families already supported by
// the installer. Resource paths, rather than archive titles, choose the weapon.
function ddsFamiliesForWeapons(weapons){return Object.entries(DDS_NAMES).filter(([,weapon])=>weapons.includes(weapon)).map(([name])=>name+"_default");}
module.exports={ALIASES,DDS_NAMES,weaponsFor,packageWeapons,belongs,ddsFamiliesForWeapons};
