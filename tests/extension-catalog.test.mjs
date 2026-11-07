import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileExtensionCatalog} from '../src/extension-catalog.js';
const course={id:'local-1234567890abcdef',title:'My new course',url:'https://www.coursera.org/learn/my-course',kind:'course',subjects:[],inPlan:false};
test('discovery adds an unassigned course once and retains active progress',()=>{
 const state={courses:[course],rows:[{courseId:course.id,url:course.url,kind:'course',status:'active',percent:67}]};
 const first=reconcileExtensionCatalog([],[],state);assert.equal(first.added,1);assert.deepEqual(first.customCourses[0].subjects,[]);assert.equal(first.rows[0].percent,67);
 const repeat=reconcileExtensionCatalog(first.customCourses,first.customCourses,state);assert.equal(repeat.added,0);assert.equal(repeat.customCourses.length,1);
});
test('discovered addresses already in a personal catalog update that existing ID',()=>{
 const existing={...course,id:'U3',subjects:['ARCH']};
 const result=reconcileExtensionCatalog([existing],[],{courses:[course],rows:[{courseId:course.id,status:'done'}]});
 assert.equal(result.added,0);assert.equal(result.rows[0].courseId,'U3');assert.deepEqual(existing.subjects,['ARCH']);
});
