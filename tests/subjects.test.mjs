import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {subjects as defaults} from '../src/core.js';
import {allDefinitions,definitions,assignedSubjects,createSubject,renameSubject,hideSubject,revealSubject,setSubjectCourses,validateSubjectSettings} from '../src/subjects.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../src/catalog.json',import.meta.url)));
const newID=(before,after)=>Object.keys(allDefinitions(after)).find(id=>!Object.hasOwn(allDefinitions(before),id));
test('legacy settings retain default subjects and explicit empty mode starts with no defaults',()=>{
 assert.deepEqual(definitions({}),defaults);assert.deepEqual(definitions({subjectsMode:'empty'}),{});
 const course=catalog.find(course=>course.id==='U3');assert(assignedSubjects(course,{}).includes('ARCH'));assert.deepEqual(assignedSubjects(course,{subjectsMode:'empty'}),[]);
});
test('create and rename are immutable and keep a stable subject ID',()=>{
 const initial=Object.freeze({owner:'Learner',variant:'ALL'}),created=createSubject(initial,' Математика '),id=newID(initial,created);
 assert.match(id,/^subject-[a-z0-9-]+$/);assert.equal(definitions(created)[id],'Математика');assert.equal(created.owner,'Learner');assert.equal(initial.subjectDefinitions,undefined);
 const renamed=renameSubject(created,id,'Высшая математика');assert.equal(definitions(renamed)[id],'Высшая математика');assert.equal(definitions(created)[id],'Математика');
 assert.throws(()=>createSubject(renamed,'Высшая математика'),/уже существует/);
});
test('a valid long subject name cannot leave an invalid trailing dash in generated ID',()=>{
 const name='a'.repeat(39)+' '+'b'.repeat(20),created=createSubject({},name),id=newID({},created);
 assert.match(id,/^subject-[a-z0-9]+(?:-[a-z0-9]+)*$/);assert(!id.endsWith('-'));assert.equal(definitions(created)[id],name);
});
test('subject assignment supports multiple subjects and does not change course data or plan',()=>{
 const beforeCourses=JSON.stringify(catalog);let settings=createSubject({},'Mathematics'),id=newID({},settings);
 settings=setSubjectCourses(settings,id,['U3','Q2'],catalog);
 assert.deepEqual(assignedSubjects(catalog.find(c=>c.id==='U3'),settings),['ARCH',id]);assert.equal(settings.subjectAssignments.U3.includes(id),true);
 assert.equal(catalog.find(c=>c.id==='U3').inPlan,true);assert.equal(JSON.stringify(catalog),beforeCourses);
 settings=setSubjectCourses(settings,id,['Q2'],catalog);assert.deepEqual(assignedSubjects(catalog.find(c=>c.id==='U3'),settings),['ARCH']);
});
test('hidden subjects and course memberships restore without losing marks or other hidden assignments',()=>{
 let settings=createSubject({},'Math'),math=newID({},settings);settings=setSubjectCourses(settings,math,['U3'],catalog);
 settings=hideSubject(settings,'ARCH');assert.deepEqual(assignedSubjects(catalog.find(c=>c.id==='U3'),settings),[math]);
 settings=setSubjectCourses(settings,math,['U3','Q2'],catalog);
 const restored=revealSubject(settings,'ARCH');assert.deepEqual(assignedSubjects(catalog.find(c=>c.id==='U3'),restored),['ARCH',math]);
 const hidden=hideSubject(restored,math);assert(!Object.hasOwn(definitions(hidden),math));assert(Object.hasOwn(allDefinitions(hidden),math));assert(Object.hasOwn(definitions(revealSubject(hidden,math)),math));
});
test('explicit empty assignment overrides defaults and fresh personal subjects work in empty mode',()=>{
 let settings=createSubject({subjectsMode:'empty'},'Math'),id=newID({subjectsMode:'empty'},settings);
 settings=setSubjectCourses(settings,id,['U3'],catalog);assert.deepEqual(assignedSubjects(catalog.find(c=>c.id==='U3'),settings),[id]);assert.deepEqual(Object.keys(definitions(settings)),[id]);
 assert.deepEqual(assignedSubjects(catalog.find(c=>c.id==='U3'),{subjectAssignments:{U3:[]}}),[]);
});
test('subject settings round-trip with custom metadata and omit only stale safe references',()=>{
 const value={subjectsMode:'empty',subjectDefinitions:{'subject-math':'Math'},hiddenSubjects:['subject-math','subject-gone'],subjectAssignments:{U3:['subject-math','subject-gone'],MissingCourse:['subject-math']}};
 const clean=validateSubjectSettings(JSON.parse(JSON.stringify(value)),catalog);
 assert.deepEqual(clean.hiddenSubjects,['subject-math']);assert.deepEqual(clean.subjectAssignments,{U3:['subject-math']});assert.equal(clean.subjectDefinitions['subject-math'],'Math');assert.deepEqual(validateSubjectSettings({},catalog),{});
});
test('validation rejects malformed imported names, IDs and assignment arrays',()=>{
 for(const value of [{subjectsMode:'unknown'},{subjectDefinitions:{'bad-id':'Math'}},{subjectDefinitions:{'subject-math':''}},{subjectDefinitions:{'subject-math':'x'.repeat(81)}},{hiddenSubjects:['__proto__']},{subjectAssignments:{U3:'ARCH'}},{subjectAssignments:{U3:['subject-']}}])assert.throws(()=>validateSubjectSettings(value,catalog));
 assert.throws(()=>setSubjectCourses({},'ARCH',['NotInCatalog'],catalog),/не найден/);assert.throws(()=>renameSubject({},'subject-unknown','Math'),/не найден/);
});
test('membership-only changes preserve unrelated profile and academic settings',()=>{
 const records=Object.freeze({U3:Object.freeze({status:'done',certificateUrl:'https://www.coursera.org/verify/REAL'})});
 const settings={owner:'Student',theme:'dark',credits:{ARCH:'Зачтено'},practice:{0:true}};
 const next=setSubjectCourses(settings,'ARCH',['U3'],catalog);
 assert.equal(next.credits,settings.credits);assert.equal(next.practice,settings.practice);assert.equal(next.theme,'dark');assert.equal(records.U3.status,'done');assert.equal(records.U3.certificateUrl,'https://www.coursera.org/verify/REAL');
});
