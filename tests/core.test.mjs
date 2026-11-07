import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deadline,DEADLINE,progress,plan,certificateURL,mergeRecord,mergeBackupRecord,undoImportedRecord,matchRecord,validateBackup,parseCSV,search,courseURL,validDate,analyzeCertificateText,courseProgress} from '../src/core.js';
const catalog=JSON.parse(fs.readFileSync(new URL('../src/catalog.json',import.meta.url)));
const relations=JSON.parse(fs.readFileSync(new URL('../src/relations.json',import.meta.url)));
test('complete catalog and default plan',()=>{assert.equal(catalog.length,109);assert.equal(new Set(catalog.map(c=>c.id)).size,109);assert.equal(plan(catalog,{}).length,28);assert.equal(catalog.filter(c=>c.kind==='course').length,93);assert.equal(catalog.filter(c=>c.kind==='project').length,2);assert.equal(catalog.filter(c=>c.kind==='specialization').length,12);assert.equal(catalog.filter(c=>c.kind==='professional-certificate').length,2);assert.equal(catalog.filter(c=>c.linkState==='requires-check').length,3);assert(catalog.some(c=>c.url.includes('boot.dev')));assert(catalog.some(c=>c.url.includes('udemy.com')));});
test('deadline has correct exclusive boundary UTC+5',()=>{assert.equal(new Date(DEADLINE).toISOString(),'2026-11-10T19:00:00.000Z');assert.equal(deadline(DEADLINE-1).expired,false);assert.equal(deadline(DEADLINE).expired,true);assert.equal(deadline(DEADLINE+1).expired,true);assert.deepEqual(deadline(DEADLINE-25*3600000),{expired:false,days:1,hours:1});});
test('unique progress, empty plan and architecture variants',()=>{assert.equal(progress(catalog,{U3:{status:'done'}}).done,1);assert.equal(progress(catalog,Object.fromEntries(catalog.map(c=>[c.id,{inPlan:false}]))).percent,0);assert.equal(plan(catalog,{},'UML').some(c=>c.id==='G1'),false);assert.equal(plan(catalog,{},'GO').some(c=>c.id==='U1'),false);assert(catalog.some(c=>c.id==='G1'));});
test('all relationship course IDs resolve and shared architecture stays one record',()=>{const rows=relations['ПОДТЕМЫ SE'];assert(rows.filter(r=>r[3]==='U3'&&r[0]==='UML').length>1);assert(relations['АЛЬТЕРНАТИВНЫЕ СВЯЗИ ИЗ МАТРИЦ XLS'].some(r=>r[0]==='ARCH'&&String(r[1]).includes('(M)')&&r[3].includes('U3')));for(const row of rows)if(row[3])assert(catalog.some(c=>c.id===row[3]),row[3]);});
test('certificate URL validation rejects account pages and spoofing',()=>{const c=catalog[0];for(const url of ['http://www.coursera.org/account/accomplishments/verify/ABC','https://coursera.org/accomplishments','https://coursera.org.evil.test/account/accomplishments/verify/ABC','javascript:alert(1)','https://coursera.org/learn/foo','https://coursera.org:443@evil.test/verify/ABC'])assert.equal(certificateURL(url,c),null);for(const path of ['verify/ABC123','account/accomplishments/verify/ABC123','account/accomplishments/specialization/ABC123','account/accomplishments/professional-cert/ABC123'])assert(certificateURL('https://www.coursera.org/'+path,c));});
test('imports preserve completion and late certificates; manual corrections conflict',()=>{const old={status:'done',completedAt:'2025-01-01',certificateUrl:'https://www.coursera.org/verify/ABC'};assert.equal(mergeRecord(old,{status:'new'}).next.status,'done');assert.equal(mergeRecord(old,{}).next.certificateUrl,old.certificateUrl);assert.equal(mergeRecord({status:'done'},{status:'done',certificateUrl:old.certificateUrl}).next.certificateUrl,old.certificateUrl);assert.equal(mergeRecord({status:'new',manual:true},{status:'done',source:'PDF'}).conflict,true);});
test('exact matching does not collapse courses into programs',()=>{const a=catalog.find(c=>c.title==='Introduction to Software Testing'),b=catalog.find(c=>c.title==='Black-box and White-box Testing');assert(a&&b);assert.notEqual(a.id,b.id);assert.notEqual(a.url,b.url);assert.equal(matchRecord({title:'Software'},catalog).length,0);assert.equal(matchRecord({title:a.title},catalog)[0].id,a.id);assert(search(a,'тестирование'));assert.equal(courseURL(a.url+'/?utm_source=x#foo'),courseURL(a.url));});
test('CSV escaped quotes, multiline fields, semicolons',()=>{const p=parseCSV('title;status\r\n"A; B\nC";done\r\n"a""b";new');assert.equal(p.rows[0].title,'A; B\nC');assert.equal(p.rows[1].title,'a"b');});
test('backup schema blocks invalid status, unknown IDs and unsafe links',()=>{for(const records of [{X:{status:'done'}},{Q12:{status:'fake'}},{Q12:{status:'done',certificateUrl:'javascript:alert(1)'}}])assert.throws(()=>validateBackup({app:'aitu-course-tracker',version:1,records},catalog));assert.deepEqual(validateBackup({app:'aitu-course-tracker',version:1,records:{}},catalog),{});});
test('manual start accepts certificate but an explicit correction remains protected',()=>{
 const started={status:'active',manual:true,source:'Ручная отметка'};
 const incoming={status:'done',source:'PDF',certificateUrl:'https://www.coursera.org/verify/TEST'};
 const completed=mergeRecord(started,incoming);assert.equal(completed.conflict,false);assert.equal(completed.next.status,'done');assert.equal(completed.next.source,'PDF');
 const corrected=mergeRecord({...started,manualOverride:true},incoming);assert.equal(corrected.conflict,true);assert.equal(corrected.next.status,'active');
 assert.equal(mergeRecord(completed.next,{status:'new',source:'older report'}).next.source,'PDF');
});
test('backup merge imports explicit plan choices into a new browser and preserves local conflicts',()=>{
 const imported={status:'done',inPlan:false,pinned:true,manual:true,manualOverride:true};
 const result=mergeBackupRecord({},imported);assert.equal(result.next.inPlan,false);assert.equal(result.next.pinned,true);assert.equal(result.next.manualOverride,true);
 const conflict=mergeBackupRecord({status:'done',inPlan:true,pinned:false},imported);assert.equal(conflict.conflict,true);assert.equal(conflict.next.inPlan,true);assert.equal(conflict.next.pinned,false);
});
test('PDF evidence requires exact owner phrase, provider and issued certificate',()=>{
 const c=catalog.find(c=>c.id==='U3');
 const link='https://www.coursera.org/account/accomplishments/verify/TEST';
 const text=`Course Certificate\nIliyas Aitzhan has successfully completed\nSoftware\nArchitecture\nUniversity of Alberta`;
 const result=analyzeCertificateText(text,[link],catalog,'Iliyas Aitzhan');assert.equal(result.courseId,'U3');assert.equal(result.certificateUrl,link);
 assert.equal(analyzeCertificateText(text,[link],catalog,'Other Student').courseId,undefined);
 assert.equal(analyzeCertificateText(text.replace('Iliyas Aitzhan','JoIliyas Aitzhan'),[link],catalog,'Iliyas Aitzhan').courseId,undefined);
 assert.equal(analyzeCertificateText(text.replace('University of Alberta','Unknown University'),[link],catalog,'Iliyas Aitzhan').courseId,undefined);
 assert.equal(analyzeCertificateText(text+' Certificate not yet issued',[link],catalog,'Iliyas Aitzhan').courseId,undefined);
 assert.equal(analyzeCertificateText('Course Certificate Software Architecture University of Alberta Iliyas Aitzhan',[link],catalog,'Iliyas Aitzhan').issued,false);
});
test('program evidence does not complete a similarly named individual course',()=>{
 const fake=[{id:'course',title:'Testing',kind:'course',provider:'University',url:'https://www.coursera.org/learn/testing'},{id:'program',title:'Testing',kind:'specialization',provider:'University',url:'https://www.coursera.org/specializations/testing'}];
 const result=analyzeCertificateText('Student has successfully completed Testing Specialization Certificate University',[],fake,'Student');assert.equal(result.courseId,'program');
 const duplicates=[...fake,{...fake[0],id:'other-course'}];assert.equal(analyzeCertificateText('Student has successfully completed Testing Course Certificate University',[],duplicates,'Student').courseId,undefined);
});
test('dates are not fabricated or silently normalized',()=>{assert.equal(validDate('2026-02-31'),undefined);assert.equal(validDate('2026-11-07'),'2026-11-07');assert.equal(validDate(''),undefined);assert.equal(validDate(42),undefined);assert.equal(validDate('2026-11-07T14:30:00+05:00'),'2026-11-07T14:30:00+05:00');assert.equal(validDate('2026-11-07Tjunk'),undefined);});
test('undo document restores imported fields without erasing later personal changes',()=>{
 const before={status:'active',inPlan:true},after={...before,status:'done',certificateUrl:'https://www.coursera.org/verify/TEST',documentKey:'abc'};
 assert.deepEqual(undoImportedRecord({...after,pinned:true,inPlan:false},before,after),{status:'active',inPlan:false,pinned:true});
 const corrected={...after,status:'new',completedAt:undefined,manual:true,manualOverride:true,source:'Ручная отметка'};
 const result=undoImportedRecord(corrected,before,after);assert.equal(result.status,'new');assert.equal(result.source,'Ручная отметка');assert.equal(result.certificateUrl,undefined);
 assert.equal(undoImportedRecord({status:'done'},null,{status:'done'}),undefined);
});

test('course partial progress uses measured values and never opening time',()=>{
 assert.deepEqual(courseProgress({status:'active',lastOpened:'2026-11-07T12:00:00Z'}),{percent:null,label:'В процессе · процент пока неизвестен',source:null});
 assert.equal(courseProgress({status:'active',percent:67,progressSource:'Вставленный список'}).label,'В процессе · 67%');
 assert.equal(courseProgress({status:'active',percent:0}).percent,0);
 assert.equal(courseProgress({status:'active',percent:100}).label,'В процессе · 100%');
 assert.equal(courseProgress({status:'active',percent:101}).percent,null);
 assert.deepEqual(courseProgress({status:'new',percent:67}),{percent:0,label:'Не начат',source:null});
 assert.equal(courseProgress({status:'done',percent:67}).percent,100);
});
test('task-based progress is explicit, bounded and labelled',()=>{
 assert.deepEqual(courseProgress({status:'active',completedTasks:3,totalTasks:10}),{percent:30,label:'В процессе · 30% по заданиям',source:'по заданиям'});
 const fromParser={status:'active',percent:30,completedTasks:3,totalTasks:10,progressSource:'tasks'};
 assert.equal(courseProgress(fromParser).label,'В процессе · 30% по заданиям');
 assert.equal(courseProgress(mergeRecord({status:'active'},fromParser).next).label,'В процессе · 30% по заданиям');
 assert.equal(courseProgress({status:'active',completedTasks:2,totalTasks:3}).percent,66.7);
 for(const record of [{completedTasks:3,totalTasks:0},{completedTasks:11,totalTasks:10},{completedTasks:-1,totalTasks:10},{completedTasks:1.5,totalTasks:10},{totalTasks:10}])assert.equal(courseProgress({status:'active',...record}).percent,null);
});
test('progress merge is monotonic, idempotent and preserves completed results',()=>{
 const old={status:'active',percent:67,progressSource:'Вставленный список',progressUpdatedAt:'2026-11-07T12:00:00Z',source:'Вставленный список'};
 for(const incoming of [{status:'active'},{status:'active',percent:30},{status:'new'},{status:'active',percent:80,progressUpdatedAt:'2026-11-06T12:00:00Z'}])assert.equal(courseProgress(mergeRecord(old,incoming).next).percent,67);
 const received={status:'active',percent:80,progressSource:'Отчёт',progressUpdatedAt:'2026-11-07T13:00:00Z'};
 const next=mergeRecord(old,received).next;assert.equal(next.percent,80);assert.deepEqual(mergeRecord(next,received).next,next);
 const done={...old,status:'done',source:'Сертификат',certificateUrl:'https://www.coursera.org/verify/TEST'};
 const preserved=mergeRecord(done,{status:'active',percent:80,source:'Неполный список'}).next;
 assert.equal(preserved.status,'done');assert.equal(preserved.source,'Сертификат');assert.equal(preserved.certificateUrl,done.certificateUrl);assert.equal(courseProgress(preserved).percent,100);
 const corrected=mergeRecord({status:'new',manual:true,manualOverride:true},{status:'active',percent:67,source:'Список'});assert.equal(corrected.conflict,true);assert.equal(corrected.next.status,'new');assert.equal(corrected.next.percent,undefined);
});
test('backups preserve valid real progress and reject invalid numeric schema',()=>{
 const backup=records=>({app:'aitu-course-tracker',version:1,records});
 const input={status:'active',percent:0,progressSource:'Список',progressUpdatedAt:'2026-11-07T12:00:00Z'};
 assert.deepEqual(validateBackup(backup({U3:input}),catalog).U3,input);
 assert.equal(validateBackup(backup({U3:{status:'active',completedTasks:3,totalTasks:10}}),catalog).U3.totalTasks,10);
 for(const record of [{percent:-1},{percent:101},{percent:'67'},{percent:null},{percent:Infinity},{completedTasks:3},{completedTasks:3,totalTasks:0},{completedTasks:11,totalTasks:10},{progressUpdatedAt:'yesterday'}])assert.throws(()=>validateBackup(backup({U3:{status:'active',...record}}),catalog));
});
