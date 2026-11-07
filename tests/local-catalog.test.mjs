import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalCourses,mergeLocalCourses} from '../src/local-catalog.js';
const course={id:'local-12345678',title:'Network Defense Basics',url:'https://www.coursera.org/learn/network-defense-basics?utm_source=test',kind:'course',subjects:['SEC'],inPlan:false};
test('local catalog validates public course metadata without changing stable identity',()=>{
 const [clean]=validateLocalCourses([course]);assert.equal(clean.id,course.id);assert.equal(clean.url,'https://coursera.org/learn/network-defense-basics');assert.deepEqual(clean.subjects,['SEC']);
 assert.equal(mergeLocalCourses([clean],[{...course,provider:'My University'}]).length,1);
 for(const invalid of [{...course,id:'Q12'},{...course,url:'javascript:alert(1)'},{...course,url:'https://user:secret@example.com/learn/x'},{...course,url:'https://127.0.0.1/course'}])assert.throws(()=>validateLocalCourses([invalid]));
 assert.throws(()=>validateLocalCourses([course,course]));
});
