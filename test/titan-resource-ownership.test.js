"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {weaponsFor,packageWeapons,belongs}=require("../src/modules/skin-switch-weapons");
const {vtfItems,modItems}=require("../src/modules/weapon-library");
const verified={
 splitterrifle:["materials/models/weapons/titan_particle_accelerator/titan_particle_accelerator_heat_col.vtf","materials/models/weapons/titan_particle_accelerator/titan_particle_accelerator_heat_charge.vmt","models/weapons/titan_particle_accelerator/w_titan_particle_accelerator.mdl","models/weapons/titan_particle_accelerator/atpov_titan_particle_accelerator.mdl"],
 leadwall:["models/weapons/titan_triple_threat/w_titan_triple_threat.mdl","models/weapons/titan_triple_threat/atpov_titan_triple_threat.mdl"],
 predatorcannon:["models/weapons/titan_predator/w_titan_predator.mdl","models/weapons/titan_predator/titan_predator_barrel_hot.mdl","models/weapons/titan_predator/titan_predator_barrel_glow.mdl","models/weapons/titan_predator/titan_predator_barrel_blur.mdl","models/weapons/titan_predator/titan_predator_barrel_charge.mdl","models/weapons/titan_predator/atpov_titan_predator_siege.mdl","models/weapons/titan_predator/atpov_titan_predator.mdl"],
 trackercannon:["models/weapons/thr_40mm/w_thr_40mm.mdl","models/weapons/thr_40mm/atpov_thr_40mm.mdl"],
 plasmarailgun:["materials/models/weapons_r2/titan_plasma_railgun/plasma_railgun_charge_col.vtf","materials/models/weapons_r2/titan_plasma_railgun/titan_sniper_charge_fx.vmt","materials/models/weapons/titan_sniper_rifle/titan_sniper_rifle_fx.vmt","models/weapons/titan_sniper_rifle/w_titan_sniper_rifle.mdl","models/weapons/titan_sniper_rifle/titan_sniper_rifle_fx.mdl","models/weapons/atpov_titan_sniper_rifle/atpov_titan_sniper_rifle.mdl"],
 thermitelauncher:["models/weapons/titan_thermite_launcher/w_titan_thermite_launcher.mdl","models/weapons/titan_thermite_launcher/atpov_titan_thermite_launcher.mdl"],
 xo16:["models/weapons/titan_xo16_shorty/w_xo16shorty.mdl","models/weapons/titan_xo16_shorty/atpov_xo16shorty_offhand.mdl","models/weapons/titan_xo16_shorty/atpov_xo16shorty.mdl"],
 broadsword:["models/weapons/titan_sword/w_titan_sword.mdl","models/weapons/titan_sword/atpov_titan_sword.mdl","models/weapons/titan_sword/atpov_titan_sword_emp_wave.mdl","models/weapons/titan_sword/atpov_titan_sword_block.mdl"],
 primesword:["models/weapons/titan_sword/w_titan_sword_prime.mdl","models/weapons/titan_sword/atpov_titan_sword_prime.mdl","models/weapons/titan_sword/atpov_titan_sword_prime_emp_wave.mdl","models/weapons/titan_sword/atpov_titan_sword_prime_block.mdl"]
};
test("all 34 verified Titan common resources map to their exact catalogue owner",()=>{
 assert.equal(Object.values(verified).flat().length,34);
 for(const [weapon,paths]of Object.entries(verified))for(const resource of paths){assert.deepEqual(weaponsFor(resource),[weapon],resource);assert.deepEqual(weaponsFor(resource.toUpperCase().replaceAll("/","\\")),[weapon],resource);assert.equal(belongs(resource,[weapon]),true,resource);}
});
test("ordinary and Prime sword models share no ownership, including their block and core variants",()=>{
 for(const resource of verified.broadsword){assert.deepEqual(weaponsFor(resource),["broadsword"]);assert.equal(belongs(resource,["primesword"]),false);}
 for(const resource of verified.primesword){assert.deepEqual(weaponsFor(resource),["primesword"]);assert.equal(belongs(resource,["broadsword"]),false);}
 const files=[...verified.broadsword,...verified.primesword].map(path=>({path}));assert.deepEqual(new Set(packageWeapons("vtf",{files})),new Set(["broadsword","primesword"]));
});
test("unknown models, shared effects, shells, Titan arms and descriptive names do not acquire a Titan owner",()=>{
 for(const resource of ["models/weapons/titan_sword/unknown_model.mdl","models/weapons/titan_sword/atpov_titan_sword_prime_extra.mdl","materials/models/fx/titan_sword_block_fx.vmt","materials/decals/bullets/thermite/shot1.vtf","models/weapons/shellejects/shelleject_40mm.mdl","models/weapons/bullets/projectile_40mm.mdl","models/weapons/arms/pov_titan_light_ronin_prime.mdl","materials/models/weapons/titan_particle_accelerator_extra/shared.vtf","materials/models/weapons/titan_predator_extra/shared.vtf","docs/titan_particle_accelerator.vtf","notes/materials/models/weapons/titan_predator/shared.vtf","models/weapons/titan_rocket_launcher/titan_rocket_launcher.mdl"]){assert.deepEqual(weaponsFor(resource),[],resource);assert.equal(belongs(resource,["broadsword","primesword","splitterrifle","predatorcannon","trackercannon"]),false,resource);}
});
test("old Titan resource tokens remain compatible and mixed ownership is rejected by the installer",()=>{
 for(const [weapon,resource]of [["splitterrifle","materials/weapons/splitterrifle/body.vtf"],["leadwall","materials/weapons/leadwall/body.vtf"],["broadsword","materials/weapons/broadsword/body.vtf"],["primesword","materials/weapons/primesword/body.vtf"],["primesword","materials/weapons/ronin_prime_sword/body.vtf"]])assert.deepEqual(weaponsFor(resource),[weapon],resource);
 const ambiguous="materials/models/weapons/titan_particle_accelerator/car/shared.vtf";assert.deepEqual(new Set(weaponsFor(ambiguous)),new Set(["car","splitterrifle"]));assert.equal(belongs(ambiguous,["splitterrifle"]),false);assert.throws(()=>packageWeapons("vtf",{files:[{path:ambiguous}]}),/归属不明确/);
});
test("the skin library and cross-format ownership agree for verified ordinary and Prime swords",async()=>{
 const files=[...verified.broadsword,...verified.primesword].map(path=>({path})),manifest={id:"00000000-0000-0000-0000-000000000001",name:"1234",state:"installed",createdAt:"2026-10-15T00:00:00.000Z",archiveIndex:7,files},index=new Map(files.map(file=>[file.path,7])),items=vtfItems([manifest],new Map(),index);
 assert.deepEqual(new Set(items[0].weaponIds),new Set(["broadsword","primesword"]));assert.deepEqual(new Set(items[0].activeWeaponIds),new Set(["broadsword","primesword"]));
 const rows=await modItems("/fixture",[{name:"1234",folder_path:"/fixture/mods/1234"}],[],async()=>({weaponIds:packageWeapons("vtf",{files}),resources:files.length,opaque:false}));assert.deepEqual(new Set(rows[0].weaponIds),new Set(items[0].weaponIds));
});
