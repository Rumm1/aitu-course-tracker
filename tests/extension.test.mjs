import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseProgressText} from '../src/progress-import.js';
import {courseIdentity,inferLearningMode,isCourseraLearningURL,isCourseraCaptureURL,isTrackerURL,mergeCapture,publicCapture,readLearningDocument,readLearningCards,sanitizeCaptureRow} from '../extension/shared.js';
import {CATALOG_KEY,STORAGE_KEY,DEFAULT_CURATED,canSetCaptureCatalog,validateCaptureCourses,getCaptureCatalog,mergeDiscoveredCourses} from '../extension/shared.js';
import {canonicalCourseURL,localCourseId} from '../src/course-identity.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../src/catalog.json',import.meta.url)));
test('extension permissions are limited and capture is opt-in',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../extension/manifest.json',import.meta.url)));
  assert.deepEqual(manifest.permissions,['storage']);
  assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.externally_connectable,undefined);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://www.coursera.org/*']);
  assert.deepEqual(manifest.content_scripts[1].include_globs,['https://rumm1.github.io/aitu-course-tracker/*']);
  assert.deepEqual(publicCapture({enabled:false,rows:[{courseId:'U3',status:'done'}]}).rows,[]);
  assert.equal(publicCapture().enabled,false);
});
test('URL scopes reject other tabs and spoofed origins',()=>{
  assert(isCourseraLearningURL('https://www.coursera.org/my-learning?myLearningTab=COMPLETED'));
  for(const url of ['https://coursera.org.evil.test/my-learning','https://www.coursera.org/learn/software-architecture','http://www.coursera.org/my-learning','https://www.coursera.org/my-learning-other'])assert(!isCourseraLearningURL(url));
  assert(isCourseraCaptureURL('https://www.coursera.org/account/accomplishments/verify/CERT123?share=1'));
  for(const url of ['https://www.coursera.org/account/accomplishments','https://www.coursera.org/learn/software-architecture','https://coursera.org.evil.test/account/accomplishments/verify/CERT123','https://user:password@www.coursera.org/account/accomplishments/verify/CERT123'])assert(!isCourseraCaptureURL(url));
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
test('official visible course links use stable slugs and preserve content kind',()=>{
  assert.equal(courseIdentity('/learn/software-architecture/home/welcome?utm_source=x'),'learn:software-architecture');
  assert.equal(courseIdentity('https://www.coursera.org/specializations/software-testing-automation'),'specializations:software-testing-automation');
  assert.notEqual(courseIdentity('/learn/shared'),courseIdentity('/specializations/shared'));
  assert.equal(courseIdentity('https://www.coursera.org.evil.test/learn/software-architecture'),null);
});
test('completed labels support Russian layouts and root without main',()=>{
  assert.equal(inferLearningMode('Завершено (18)'), 'done');
  assert.equal(inferLearningMode('Завершённые'), 'done');
  const body=element('BODY',[element('DIV',[text('Software Architecture')])]);
  const doc={body,querySelector:selector=>selector.startsWith('[role=')?{textContent:'Завершено (18)'}:null,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}};
  const read=readLearningDocument(doc,'https://www.coursera.org/my-learning');
  assert.match(read.text,/Software Architecture/);assert.equal(read.mode,'done');
  const parsed=readLearningCards(doc,'https://www.coursera.org/my-learning',catalog);
  assert.equal(parsed.matches[0].courseId,'U3');assert.equal(parsed.matches[0].status,'done');
});
test('zero-match diagnostic is published while previous completed history survives',()=>{
  const old=mergeCapture({}, {matches:[{courseId:'U3',status:'done'}]},'2026-11-07T10:00:00Z',catalog);
  const now=mergeCapture(old,{matches:[],diagnostics:{section:'done',visibleCards:2,matchedCount:0,resultStatus:'no-matches',message:'Нет точных совпадений'}},'2026-11-07T11:00:00Z',catalog);
  assert.equal(now.rows[0].status,'done');
  const snapshot=publicCapture(now);
  assert.equal(snapshot.diagnostics.resultStatus,'no-matches');assert.equal(snapshot.diagnostics.visibleCards,2);assert.equal(snapshot.diagnostics.checkedAt,'2026-11-07T11:00:00Z');
});

test('additional course metadata is accepted only from this extension and its configured tracker',()=>{
  assert.equal(CATALOG_KEY,'courseByCourseCatalog');
  assert(canSetCaptureCatalog({id:'extension-id',url:'https://rumm1.github.io/aitu-course-tracker/#overview'},'extension-id'));
  for(const sender of [{id:'other-extension',url:'https://rumm1.github.io/aitu-course-tracker/'},{id:'extension-id',url:'https://www.coursera.org/my-learning'},{id:'extension-id',url:'https://rumm1.github.io/other/'},{id:'extension-id',url:'https://rumm1.github.io.evil.test/aitu-course-tracker/'}])assert.equal(canSetCaptureCatalog(sender,'extension-id'),false);
});

test('validated local courses are recognized from completed lists and retain their own stable ID',()=>{
  const local={id:'local-excel-course',title:'Additional Coursera Course',url:'https://www.coursera.org/learn/additional-course',provider:'Course Provider',kind:'course',subjects:['QA'],also:['Earlier Additional Course'],rawText:'not retained',cookie:'not retained'};
  const courses=validateCaptureCourses([local]);
  assert.equal(courses.length,1);assert.equal(courses[0].id,local.id);assert.equal(courses[0].cookie,undefined);assert.equal(courses[0].rawText,undefined);
  const combined=[...catalog,...courses];
  const body=element('BODY',[element('DIV',[text('Earlier Additional Course')])]);
  const doc={body,querySelector:selector=>selector.startsWith('[role=')?{textContent:'Completed'}:null,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}};
  const parsed=readLearningCards(doc,'https://www.coursera.org/my-learning?myLearningTab=COMPLETED',combined);
  assert.equal(parsed.matches[0].courseId,local.id);assert.equal(parsed.matches[0].status,'done');
  const stored=mergeCapture({},parsed,'2026-11-07T12:00:00Z',combined);
  assert.equal(stored.rows[0].courseId,local.id);assert.equal(stored.rows[0].status,'done');
  assert.throws(()=>validateCaptureCourses([{...local,id:'wrong-id'}]));
  assert.throws(()=>validateCaptureCourses([local,local]));
  assert.throws(()=>validateCaptureCourses(new Array(5001).fill(local)));
});

test('a registered full catalog replaces the bundled seed even when the catalog is empty',()=>{
  assert.equal(DEFAULT_CURATED,true);assert.equal(getCaptureCatalog({}).length,109);
  assert.deepEqual(getCaptureCatalog({[CATALOG_KEY]:[]}),[]);
  const original=catalog.find(course=>course.id==='U3');
  const local={id:'local-personal-architecture',title:original.title,url:original.url,provider:original.provider,kind:original.kind,subjects:[]};
  const own=getCaptureCatalog({[CATALOG_KEY]:[local]});
  assert.deepEqual(own.map(course=>course.id),[local.id]);assert.equal(own.some(course=>course.id==='U3'),false);
  const body=element('BODY',[element('DIV',[text('Software Architecture')])]);
  const doc={body,querySelector:selector=>selector.startsWith('[role=')?{textContent:'Completed'}:null,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}};
  const parsed=readLearningCards(doc,'https://www.coursera.org/my-learning?myLearningTab=COMPLETED',own);
  assert.deepEqual(parsed.matches.map(row=>row.courseId),[local.id]);
  const history=mergeCapture({rows:[{courseId:'U3',status:'done'}]},parsed,'2026-11-07T13:00:00Z',own);
  assert.deepEqual(history.rows.map(row=>row.courseId),[local.id]);
});

test('registered base IDs must preserve the trusted URL and kind and cannot inject another title',()=>{
  const course=catalog.find(course=>course.id==='U3');
  const [valid]=validateCaptureCourses([{...course,title:'Untrusted replacement',also:['Untrusted alias'],rawText:'not retained'}]);
  assert.equal(valid.title,course.title);assert.deepEqual(valid.also,course.also);assert.equal(valid.rawText,undefined);
  assert.throws(()=>validateCaptureCourses([{...course,url:'https://www.coursera.org/learn/other-course'}]));
  assert.throws(()=>validateCaptureCourses([{...course,kind:'specialization'}]));
  assert.throws(()=>validateCaptureCourses([{...course,id:'UNKNOWN'}]));
  assert.throws(()=>getCaptureCatalog({[CATALOG_KEY]:null}));
});

test('visible newly discovered courses use stable Excel-compatible IDs and keep metadata locally',()=>{
  const url='https://www.coursera.org/learn/visible-new-course/home/welcome?utm_source=x';
  assert.equal(canonicalCourseURL(url),'https://coursera.org/learn/visible-new-course');
  const id=localCourseId(url,'course');assert.equal(id,'local-2184254397706702');
  const course={id,title:'A Newly Visible Course',url:canonicalCourseURL(url),kind:'course',subjects:['QA'],inPlan:true,cookie:'not retained'};
  const state=mergeCapture({}, {courses:[course],matches:[{courseId:id,status:'done'}]},'2026-11-07T14:00:00Z',[]);
  assert.equal(state.courses.length,1);assert.equal(state.courses[0].cookie,undefined);
  assert.deepEqual(state.courses[0].subjects,[]);assert.equal(state.courses[0].inPlan,false);assert.deepEqual(state.courses[0].sources,['COURSERA']);
  assert.equal(state.rows[0].courseId,id);assert.equal(state.rows[0].status,'done');
  const next=mergeCapture(state,{matches:[{courseId:id,status:'active',percent:10}],courses:[]},'2026-11-07T15:00:00Z',[]);
  assert.equal(next.courses.length,1);assert.equal(next.rows[0].status,'done');
  const payload=publicCapture(next);assert.equal(payload.courses[0].id,id);assert.equal(payload.rows[0].url,course.url);assert.equal(payload.rows[0].kind,'course');
  assert.deepEqual(publicCapture({...next,enabled:false}).courses,[]);
  assert.throws(()=>mergeDiscoveredCourses([],[{...course,id:'U3'}]));
});

test('registered personal IDs win URL collisions while discovered completion history survives',()=>{
  const url='https://coursera.org/learn/software-architecture',id=localCourseId(url,'course');
  const discovered={id,title:'Software Architecture',url,kind:'course',subjects:[]};
  const previous=mergeCapture({}, {courses:[discovered],matches:[{courseId:id,status:'done'}]},'2026-11-07T14:00:00Z',[]);
  const registered={...discovered,id:'local-personal-architecture'};
  const own=getCaptureCatalog({[CATALOG_KEY]:[registered],[STORAGE_KEY]:previous});
  assert.deepEqual(own.map(course=>course.id),[registered.id]);assert.equal(own.some(course=>course.id==='U3'),false);
  const merged=mergeCapture(previous,{matches:[],courses:[]},'2026-11-07T15:00:00Z',own);
  assert.deepEqual(merged.rows,[{courseId:registered.id,status:'done'}]);assert.equal(merged.courses[0].id,id);
});
