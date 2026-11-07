import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCatalog} from '../src/catalog-state.js';
import {progress} from '../src/core.js';
import {cleanFilters,readFilters} from '../src/catalog-filters.js';
const course={id:'U3',title:'Architecture',url:'https://www.coursera.org/learn/architecture',kind:'course',subjects:['ARCH'],inPlan:true};
const duplicate={...course,id:'local-duplicate',title:'Old architecture title',url:course.url+'/home/welcome?tracking=x',subjects:['CAP']};
test('same course URL has one card/count and preserves completion, certificate and all subjects',()=>{
 const result=reconcileCatalog([course],[duplicate],{U3:{status:'active',percent:67},[duplicate.id]:{status:'done',certificateUrl:'https://www.coursera.org/account/accomplishments/verify/CERT123',pinned:true}},{subjectAssignments:{[duplicate.id]:['SEC']}});
 assert.equal(result.catalog.length,1);assert.equal(result.customCourses.length,0);assert.equal(result.records.U3.status,'done');assert.ok(result.records.U3.certificateUrl);assert.equal(result.records.U3.pinned,true);assert.deepEqual(result.settings.subjectAssignments.U3,['ARCH','SEC']);assert.equal(progress(result.catalog,result.records).done,1);
 assert.ok(result.catalog[0].also.includes(duplicate.title));
 const again=reconcileCatalog([course],result.customCourses,result.records,result.settings);assert.equal(again.removed,0);assert.equal(again.records.U3.status,'done');
});
test('different URLs with the same title and whole programs stay separate',()=>{
 const program={...duplicate,id:'local-program',title:course.title,url:'https://www.coursera.org/specializations/architecture',kind:'specialization'};
 const different={...duplicate,id:'local-different',title:course.title,url:'https://www.coursera.org/learn/another-architecture'};
 assert.equal(reconcileCatalog([course],[program,different]).catalog.length,3);
});
test('explicit correction wins over older duplicate and later edits do not revive old memberships',()=>{
 const first=reconcileCatalog([course],[duplicate],{U3:{status:'new',manualOverride:true},[duplicate.id]:{status:'done'}},{});
 assert.equal(first.records.U3.status,'new');
 first.settings.subjectAssignments.U3=[];
 const again=reconcileCatalog([course],first.customCourses,first.records,first.settings);assert.deepEqual(again.settings.subjectAssignments.U3,[]);
 const backup=reconcileCatalog([course],[],{...again.records,[duplicate.id]:{status:'done'}},again.settings);assert.equal(backup.records.U3.status,'new');assert.equal(backup.records[duplicate.id],undefined);
});
test('saved filters are bounded and contradictory completion filters are repaired',()=>{
 assert.deepEqual(cleanFilters({query:'Go',scope:'plan',kind:'course',status:'done',hide:true}),{query:'Go',scope:'plan',kind:'course',status:'done',hide:false,subject:''});
 assert.equal(readFilters({getItem:()=>'{broken'},'key').query,'');
 assert.equal(readFilters({getItem:()=>'{"query":"Architecture"}'},'key').query,'Architecture');
});
