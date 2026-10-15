/* Fit the collapsed skin list to the rendered weapon grid, without an inner scrollbar. */
(() => {
 'use strict';
 function visibleCount({rowHeights=[],availableHeight=0,gap=0}={}){
  if(!rowHeights.length)return 0;
  const budget=Number.isFinite(availableHeight)?Math.max(0,availableHeight):0;
  let total=0,count=0;
  for(const value of rowHeights){
   const height=Number.isFinite(value)?Math.max(0,value):0,next=total+(count?Math.max(0,gap):0)+height;
   if(count&&next>budget+.5)break;
   total=next;count++;
  }
  return Math.max(1,count);
 }
 const api=Object.freeze({visibleCount});
 if(typeof module==='object'&&module.exports)module.exports=api;
 else window.WeaponLibraryLayout=api;
})();
