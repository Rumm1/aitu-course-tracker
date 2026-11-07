import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseProgressText} from '../src/progress-import.js';
import {inferLearningMode,isCourseraLearningURL,isTrackerURL,mergeCapture,publicCapture,readLearningDocument,sanitizeCaptureRow} from '../extension/shared.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../src/catalog.json',import.meta.url)));
test('extension permissions are limited and capture is opt-in',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../extension/manifest.json',import.meta.url)));
  assert.deepEqual(manifest.permissions,['storage']);
  assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.externally_connectable,undefined);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://www.coursera.org/my-learning*']);
  assert.deepEqual(manifest.content_scripts[1].include_globs,['https://rumm1.github.io/aitu-course-tracker/*']);
  assert.deepEqual(publicCapture({enabled:false,rows:[{courseId:'U3',status:'done'}]}).rows,[]);
  assert.equal(publicCapture().enabled,false);
});
test('URL scopes reject other tabs and spoofed origins',()=>{
  assert(isCourseraLearningURL('https://www.coursera.org/my-learning?myLearningTab=COMPLETED'));
  for(const url of ['https://coursera.org.evil.test/my-learning','https://www.coursera.org/learn/software-architecture','http://www.coursera.org/my-learning','https://www.coursera.org/my-learning-other'])assert(!isCourseraLearningURL(url));
  assert(isTrackerURL('https://rumm1.github.io/aitu-course-tracker/#overview'));
  for(const url of ['https://rumm1.github.io/other/','https://rumm1.github.io.evil.test/aitu-course-tracker/','http://rumm1.github.io/aitu-course-tracker/'])assert(!isTrackerURL(url));
});
test('selected visible tab or explicit URL determines mode; unknown is conservative',()=>{
  assert.equal(inferLearningMode('Completed (12)','https://www.coursera.org/my-learning'),'done');
  assert.equal(inferLearningMode('В процессе','https://www.coursera.org/my-learning?myLearningTab=COMPLETED'),'active');
  assert.equal(inferLearningMode('','https://www.coursera.org/my-learning?myLearningTab=IN_PROGRESS'),'active');
  assert.equal(inferLearningMode('My courses','https://www.coursera.org/my-learning'),'mixed');
});
test('capture merge is unique and monotonic and source is never official API',()=>{
  const first=mergeCapture({}, {matches:[{courseId:'U3',status:'done'},{courseId:'Q2',status:'active',percent:67}]},'2026-11-07T10:00:00Z',catalog);
  const second=mergeCapture(first,{matches:[{courseId:'U3',status:'active',percent:10},{courseId:'Q2',status:'active',percent:20}]},'2026-11-07T11:00:00Z',catalog);
  assert.equal(second.rows.length,2);assert.equal(second.rows.find(r=>r.courseId==='U3').status,'done');assert.equal(second.rows.find(r=>r.courseId==='Q2').percent,67);
  assert.equal(second.revision,first.revision);assert.equal(second.capturedAt,first.capturedAt);assert.equal(second.checkedAt,'2026-11-07T11:00:00Z');
  assert.match(second.source,/видимая страница/);assert.doesNotMatch(second.source,/API/);
  const incomplete=mergeCapture(second,{matches:[]},'2026-11-07T12:00:00Z',catalog);assert.deepEqual(incomplete.rows,second.rows);
});
test('capture sanitization has no raw page data and accepts only catalog progress',()=>{
  const row=sanitizeCaptureRow({courseId:'Q2',status:'active',percent:67,rawText:'private page',email:'private@example.test',cookie:'secret'},catalog);
  assert.deepEqual(row,{courseId:'Q2',status:'active',percent:67});
  assert.equal(sanitizeCaptureRow({courseId:'missing',status:'done'},catalog),null);
  assert.deepEqual(sanitizeCaptureRow({courseId:'Q2',status:'active',percent:999,certificateUrl:'https://evil.test/secret'},catalog),{courseId:'Q2',status:'active'});
  assert.equal(sanitizeCaptureRow({courseId:'Q2',status:'new'},catalog),null);
  assert.deepEqual(mergeCapture({}, {unmatched:[{title:'Private account name'}]},'2026-11-07T10:00:00Z',catalog).unmatched,[]);
});

function text(value){return {nodeType:3,textContent:value};}
function element(tag,children=[],attrs={}){return {nodeType:1,tagName:tag,childNodes:children,hidden:!!attrs.hidden,hasAttribute:name=>Object.hasOwn(attrs,name),getAttribute:name=>attrs[name]??null};}
test('DOM capture excludes hidden/nav/input contents and keeps visible course lines',()=>{
  const root=element('MAIN',[
    element('NAV',[text('Completed')]),
    element('DIV',[text('Software Architecture')]),
    element('DIV',[text('In progress')],{role:'tablist'}),
    element('DIV',[text('Object-Oriented Design')],{'aria-hidden':'true'}),
    element('INPUT',[text('password contents')]),
    element('DIV',[text('Mastering Selenium WebDriver and Java Fundamentals')]),
    element('DIV',[text('67% complete')]),
  ]);
  const doc={querySelector:selector=>selector.startsWith('[role=')?{textContent:'In Progress'}:root,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}};
  const read=readLearningDocument(doc,'https://www.coursera.org/my-learning');
  assert.equal(read.mode,'active');assert.match(read.text,/Software Architecture/);assert.match(read.text,/67% complete/);assert.doesNotMatch(read.text,/Completed|Object-Oriented|password/);
  assert.equal(readLearningDocument(doc,'https://www.coursera.org/login').text,'');
});
test('selected completed tab is explicit evidence even when card has a grade percentage',()=>{
  const root=element('MAIN',[element('DIV',[text('Software Architecture')]),element('DIV',[text('Grade: 67%')]),element('A',[text('View Certificate')],{href:'/account/accomplishments/verify/ABC123'})]);
  const doc={querySelector:selector=>selector.startsWith('[role=')?{textContent:'Completed'}:root,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}};
  const visible=readLearningDocument(doc,'https://www.coursera.org/my-learning');
  const result=parseProgressText(visible.text,catalog,{mode:visible.mode});
  assert.equal(result.matches[0].courseId,'U3');assert.equal(result.matches[0].status,'done');
  assert.equal(result.matches[0].certificateUrl,'https://www.coursera.org/account/accomplishments/verify/ABC123');
});
