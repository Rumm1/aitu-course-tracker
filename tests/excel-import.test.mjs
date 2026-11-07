import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import {readExcelFile,prepareCourseRows,localCourseId,classifyCourseSubjects} from '../src/excel-import.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../src/catalog.json',import.meta.url),'utf8'));
function fixture(rows,{name='Курсы',type='xlsx',edit=()=>{},extra=[]}={}){
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(rows);edit(sheet);
 XLSX.utils.book_append_sheet(book,sheet,name);
 for(const [sheetName,data]of extra)XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(data),sheetName);
 return new File([XLSX.write(book,{type:'buffer',bookType:type==='xls'?'biff8':'xlsx'})],'courses.'+type);
}

for(const type of ['xlsx','xls'])test(`reads actual ${type} file with Russian headers, hyperlinks and separate sheets`,async()=>{
 const file=fixture([
  ['Мой список для семестра'],[],
  ['Название курса','Ссылка на курс','Провайдер','Предмет','Статус','Процент','Часы','В плане'],
  ['Software Architecture','Открыть курс','University of Alberta','ARCH','Пройден','',10,''],
  ['Practical Playwright Testing','https://www.coursera.org/learn/practical-playwright-testing','Example University','QA','В процессе',0.67,8,'нет'],
 ],{type,edit:sheet=>{sheet.B4.l={Target:'https://www.coursera.org/learn/software-architecture/home/welcome?utm_source=x#week'};sheet.F5.z='0%';},extra:[['Дополнительные',[['title','url'],['Startup Marketing','https://www.coursera.org/learn/startup-marketing']]]]});
 const result=await readExcelFile(file);assert.equal(result.sheets.length,2);
 const sheet=result.sheets[0];assert.equal(sheet.headerRow,3);assert.equal(sheet.rows.length,2);assert.equal(sheet.mapping.title,'Название курса');assert.equal(sheet.mapping.url,'Ссылка на курс');
 const preview=prepareCourseRows(sheet.rows,sheet.mapping,catalog);
 assert.equal(preview[0].courseId,'U3');assert.equal(preview[0].isNew,false);assert.equal(preview[0].record.status,'done');assert.equal(preview[0].record.inPlan,undefined);
 assert.equal(preview[1].isNew,true);assert.equal(preview[1].course.inPlan,false);assert.deepEqual(preview[1].course.subjects,['QA']);assert.equal(preview[1].record.percent,67);assert.equal(preview[1].record.status,'active');
});

test('literal HYPERLINK URL is extracted without evaluating formula or cached completion',async()=>{
 const file=fixture([['title','url','status','Scenario score'],['Application Security Deep Dive','Open','Пройден',95]],{edit:sheet=>{
  sheet.B2={t:'s',v:'Open',f:'HYPERLINK("https://www.coursera.org/learn/application-security-deep-dive","Open")'};
  sheet.C2={t:'s',v:'Пройден',f:'IF(D2>90,"Пройден","Не начат")'};
 }});
 const sheet=(await readExcelFile(file)).sheets[0],entry=prepareCourseRows(sheet.rows,sheet.mapping,catalog)[0];
 assert.equal(entry.course.url,'https://coursera.org/learn/application-security-deep-dive');assert.equal(entry.record?.status,undefined);assert(entry.issues.some(issue=>issue.includes('формулой')));
 assert.equal(sheet.rows[0]['Scenario score'],95);
});

test('a nonliteral URL formula and grade do not manufacture a usable link or completion',async()=>{
 const file=fixture([['Название','URL','Оценка'],['Unlisted Course','Open',95]],{edit:sheet=>{sheet.B2={t:'s',v:'https://www.coursera.org/learn/unlisted',f:'HYPERLINK(CONCAT("https://www.coursera.org/learn/",A2),"Open")'};}});
 const sheet=(await readExcelFile(file)).sheets[0],entry=prepareCourseRows(sheet.rows,sheet.mapping,catalog)[0];
 assert.equal(entry.course,undefined);assert.equal(entry.record?.status,undefined);assert(entry.issues.some(issue=>issue.includes('HTTPS')));
});

test('title-cell hyperlinks work without a dedicated URL column and data rows are not lost',async()=>{
 const file=fixture([['Курс'],['Getting Started with Go']],{edit:sheet=>{sheet.A2.l={Target:'https://www.coursera.org/learn/golang-getting-started'};}});
 const sheet=(await readExcelFile(file)).sheets[0];assert.equal(sheet.mapping.title,'Курс');assert.equal(sheet.mapping.url,'Курс');
 assert.equal(prepareCourseRows(sheet.rows,sheet.mapping,catalog)[0].courseId,'G1');
 const noHeader=(await readExcelFile(fixture([['A New Course','https://www.coursera.org/learn/new-course']]))).sheets[0];assert.equal(noHeader.headerRow,0);assert.equal(noHeader.rows.length,1);
 assert.equal(prepareCourseRows(noHeader.rows,noHeader.mapping,catalog)[0].course.title,'A New Course');
 const formulaSheet=(await readExcelFile(fixture([['Название'],['Research New Course']],{edit:sheet=>{sheet.A2={t:'s',v:'Research New Course',f:'HYPERLINK("https://www.coursera.org/learn/new-research-course","Research New Course")'};}}))).sheets[0];
 const formulaEntry=prepareCourseRows(formulaSheet.rows,formulaSheet.mapping,catalog)[0];assert.equal(formulaEntry.course.title,'Research New Course');assert.equal(formulaEntry.course.url,'https://coursera.org/learn/new-research-course');
});

test('stable IDs and duplicate rows ignore tracking URLs and do not inflate catalog',()=>{
 const mapping={title:'Name',url:'Link'};
 const rows=[{Name:'New Testing Course',Link:'https://www.coursera.org/learn/new-testing/?utm_source=a#week'},{Name:'New Testing Course',Link:'https://coursera.org/learn/new-testing'}];
 const entries=prepareCourseRows(rows,mapping,catalog);assert(entries[0].isNew);assert.equal(entries[0].courseId,entries[1].courseId);assert.equal(entries[1].duplicate,true);assert.equal(entries[1].skipped,true);
 assert.equal(localCourseId(rows[0].Link,'course'),localCourseId(rows[1].Link,'course'));assert.equal(entries[0].course.inPlan,false);
});

test('programs and children remain separate and mismatched parent URL needs review',()=>{
 const rows=[{title:'Software Testing and Automation',url:'https://www.coursera.org/specializations/software-testing-automation',kind:'specialization'},{title:'A New Child Course',url:'https://www.coursera.org/learn/a-new-child',kind:'course'},{title:'Introduction to Software Testing',url:'https://www.coursera.org/specializations/software-testing-automation',kind:'course'}];
 const entries=prepareCourseRows(rows,{title:'title',url:'url',kind:'kind'},catalog);
 assert.equal(entries[0].courseId,'K035');assert.notEqual(entries[1].courseId,entries[0].courseId);assert.equal(entries[1].course.kind,'course');
 assert(entries[2].issues.some(issue=>issue.includes('программа')));assert.notEqual(entries[2].courseId,'K035');
});

test('subjects are explicit or inferred, unknown stays unassigned, plan must be explicit',()=>{
 assert.deepEqual(classifyCourseSubjects('Secure API Testing in Go'),['SEC','QA','ARCH']);
 const entries=prepareCourseRows([{title:'Secure API Testing in Go',url:'https://www.coursera.org/learn/secure-api-go'},{title:'Some New Topic',url:'https://www.coursera.org/learn/some-new-topic'},{title:'Other Topic',url:'https://www.coursera.org/learn/other-topic',subjects:'CAP / TE',plan:'Да'}],{title:'title',url:'url',subjects:'subjects',inPlan:'plan'},catalog);
 assert.deepEqual(entries[0].course.subjects,['SEC','QA','ARCH']);assert.equal(entries[0].subjectSource,'title');assert.equal(entries[0].course.inPlan,false);
 assert.deepEqual(entries[1].course.subjects,[]);assert.equal(entries[1].subjectSource,'unknown');assert.deepEqual(entries[2].course.subjects,['CAP','TE']);assert.equal(entries[2].course.inPlan,true);
});

test('personal subject names and IDs resolve from the supplied definitions without mutating known courses',()=>{
 const definitions={CAP:'Дипломный проект',QA:'Качество и тестирование ПО','subject-math':'Математика','subject-physics':{name:'Физика'}};
 const oldCourse=catalog.find(course=>course.id==='U3'),before=JSON.stringify(oldCourse);
 const entries=prepareCourseRows([
  {title:'New Mathematics Course',url:'https://www.coursera.org/learn/new-mathematics',subject:'subject-math — Математика; subject-physics | QA — Качество и тестирование ПО'},
  {title:'Software Architecture',subject:'Математика'},
 ],{title:'title',url:'url',subjects:'subject'},catalog,{subjects:definitions});
 assert.deepEqual(entries[0].subjects,['subject-math','subject-physics','QA']);
 assert.deepEqual(entries[0].course.subjects,['subject-math','subject-physics','QA']);
 assert.deepEqual(entries[0].subjectNames,[]);assert.equal(entries[0].subjectSource,'explicit');
 assert.equal(entries[1].courseId,'U3');assert.deepEqual(entries[1].subjects,['subject-math']);assert.deepEqual(entries[1].subjectNames,[]);
 assert.equal(JSON.stringify(oldCourse),before);assert.equal(entries[1].course,oldCourse);
});

test('unknown explicit labels are reviewable new subject names and do not block import',()=>{
 const longName='Я'.repeat(95);
 const [entry]=prepareCourseRows([{title:'Additional Course',url:'https://www.coursera.org/learn/additional',subject:` Математика ; QA | Физика, математИка ; ${longName} `}],{title:'title',url:'url',subjects:'subject'},catalog);
 assert(entry.isNew);assert.equal(entry.issues.length,0);assert.deepEqual(entry.subjects,['QA']);assert.deepEqual(entry.course.subjects,['QA']);
 assert.deepEqual(entry.subjectNames,['Математика','Физика','Я'.repeat(80)]);assert.equal(entry.subjectSource,'explicit');
 const [known]=prepareCourseRows([{title:'Software Architecture',subject:'Современные системы'}],{title:'title',subjects:'subject'},catalog);
 assert.equal(known.courseId,'U3');assert.deepEqual(known.subjectNames,['Современные системы']);assert.equal(known.issues.length,0);
});

test('subject aliases require an existing definition and slash-containing names stay intact',()=>{
 const definitions={QA:'Тестирование','subject-path':'Алгоритмы / структуры данных'};
 const entries=prepareCourseRows([
  {title:'Course One',url:'https://www.coursera.org/learn/one',subject:'Архитектура; Тестирование; Алгоритмы / структуры данных'},
  {title:'Course Two',url:'https://www.coursera.org/learn/two',subject:'Математика / Физика'},
  {title:'Go Architecture',url:'https://www.coursera.org/learn/three'},
 ],{title:'title',url:'url',subjects:'subject'},catalog,{subjects:definitions});
 assert.deepEqual(entries[0].subjects,['QA','subject-path']);assert.deepEqual(entries[0].subjectNames,['Архитектура']);
 assert.deepEqual(entries[1].subjects,[]);assert.deepEqual(entries[1].subjectNames,['Математика / Физика']);
 assert.deepEqual(entries[2].subjects,[]);assert.equal(entries[2].subjectSource,'unknown');
});

test('unsafe URLs are rejected and exact known ID is never reused for an unrelated new URL',()=>{
 const bad=['javascript:alert(1)','file:///C:/private.xls','http://www.coursera.org/learn/x','https://user:password@www.coursera.org/learn/x'];
 for(const url of bad){const [entry]=prepareCourseRows([{title:'Unsafe Course',url}],{title:'title',url:'url'},catalog);assert.equal(entry.course,undefined);assert(entry.issues.length);}
 const [entry]=prepareCourseRows([{id:'U3',title:'Another Course',url:'https://www.coursera.org/learn/another-course'}],{id:'id',title:'title',url:'url'},catalog);assert(entry.isNew);assert.notEqual(entry.courseId,'U3');
 const [known]=prepareCourseRows([{id:'U3'}],{id:'id'},catalog);assert.equal(known.courseId,'U3');
 const [oldSpreadsheetID]=prepareCourseRows([{id:'ROW-18',title:'Software Architecture'}],{id:'id',title:'title'},catalog);assert.equal(oldSpreadsheetID.courseId,'U3');
});

test('an explicit Excel completion date is preserved without using import time',async()=>{
 const sheet=(await readExcelFile(fixture([['title','url','status','Дата завершения'],['Software Architecture','https://www.coursera.org/learn/software-architecture','done',new Date('2026-11-06T00:00:00Z')]],{edit:sheet=>{sheet.D2.z='yyyy-mm-dd';}}))).sheets[0];
 const [entry]=prepareCourseRows(sheet.rows,sheet.mapping,catalog);assert.equal(entry.record.completedAt,'2026-11-06');
});

test('empty cells, false flags and zero percent remain distinct',()=>{
 const rows=[{}, {title:'Zero Progress',url:'https://www.coursera.org/learn/zero-progress',status:'active',percent:0,plan:false},{title:'No Evidence',url:'https://www.coursera.org/learn/no-evidence',grade:95}];
 const entries=prepareCourseRows(rows,{title:'title',url:'url',status:'status',percent:'percent',inPlan:'plan'},catalog);assert.equal(entries.length,2);assert.equal(entries[0].record.percent,0);assert.equal(entries[0].record.inPlan,false);assert.equal(entries[1].record,undefined);
});

test('Russian active status stays active without a percent and title hyperlink survives a blank URL column',async()=>{
 const sheet=(await readExcelFile(fixture([['Название','Ссылка','Статус'],['New Go Course','','В процессе']],{edit:sheet=>{sheet.A2.l={Target:'https://www.coursera.org/learn/new-go-course'};}}))).sheets[0];
 const [entry]=prepareCourseRows(sheet.rows,sheet.mapping,catalog);assert(entry.isNew);assert.equal(entry.course.url,'https://coursera.org/learn/new-go-course');assert.equal(entry.record.status,'active');assert.equal(entry.record.percent,undefined);
});

test('file size, sheet count and row limits fail before unsafe unbounded work',async()=>{
 let read=false;await assert.rejects(()=>readExcelFile({name:'large.xlsx',size:21*1024*1024,arrayBuffer:async()=>{read=true;return new ArrayBuffer(0);}}),/20 МБ/);assert.equal(read,false);
 await assert.rejects(()=>readExcelFile(fixture([['title']],{extra:Array.from({length:20},(_,i)=>['sheet'+i,[['title']]])})),/20 листов/);
 assert.throws(()=>prepareCourseRows(Array.from({length:5001},()=>({})),{},catalog),/5000/);
});
