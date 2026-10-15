'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {visibleCount}=require('../src/app/js/weapon-library-layout');
test('collapsed records follow the actual left grid budget instead of a fixed page size',()=>{
 const rowHeights=Array.from({length:30},()=>76);
 assert.equal(visibleCount({rowHeights,availableHeight:230}),3);
 assert.equal(visibleCount({rowHeights,availableHeight:460}),6);
 assert.equal(visibleCount({rowHeights,availableHeight:915}),12);
 assert.equal(visibleCount({rowHeights,availableHeight:4000}),30);
});
test('long localized row titles and the gap consume their measured height',()=>{
 const rowHeights=[72,118,72,94,72];
 assert.equal(visibleCount({rowHeights,availableHeight:262}),3);
 assert.equal(visibleCount({rowHeights,availableHeight:262,gap:5}),2);
 assert.equal(visibleCount({rowHeights,availableHeight:360,gap:5}),3);
});
test('the collapsed list keeps one actionable record in a small layout and handles no records',()=>{
 assert.equal(visibleCount({rowHeights:[118,72],availableHeight:-20}),1);
 assert.equal(visibleCount({rowHeights:[118,72],availableHeight:117}),1);
 assert.equal(visibleCount({rowHeights:[],availableHeight:1000}),0);
});
test('growing the left grid never reduces the visible count or exceeds the measured budget',()=>{
 const rowHeights=[65,72,131,88,84,98,73,82,93,69,75,78];let previous=1;
 for(let availableHeight=70;availableHeight<1100;availableHeight+=7){
  const count=visibleCount({rowHeights,availableHeight});assert(count>=previous);
  const used=rowHeights.slice(0,count).reduce((total,value)=>total+value,0);
  assert(used<=availableHeight+.5||count===1);
  if(count<rowHeights.length)assert(used+rowHeights[count]>availableHeight+.5);
  previous=count;
 }
});
