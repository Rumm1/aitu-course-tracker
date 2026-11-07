import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseProgressText} from '../src/progress-import.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/catalog.json', import.meta.url), 'utf8'));

test('one pasted list finds several older completions and an active course at 67%', () => {
  const parsed = parseProgressText(`Моё обучение\nЗавершённые\nSoftware Architecture\nUniversity of Alberta\nПройден\nObject-Oriented Design\nUniversity of Alberta\nПройден\nВ процессе\nGetting Started with Go\nUniversity of California, Irvine\n67% completed\nПродолжить обучение`, catalog);
  assert.equal(parsed.matches.length, 3);
  assert.equal(parsed.matches.find(row => row.courseId === 'U3').status, 'done');
  assert.equal(parsed.matches.find(row => row.courseId === 'U1').status, 'done');
  assert.deepEqual(parsed.matches.find(row => row.courseId === 'G1'), {courseId:'G1', title:'Getting Started with Go', status:'active', percent:67, progressSource:'percent'});
});

test('user-selected completed section accepts plain exact names and verified old aliases', () => {
  const parsed = parseProgressText('Research Methods: Plan and Evaluate Research Studies\nSoftware Architecture: Design Maintainable Systems\nDesign Patterns: Apply Reusable Software Solutions', catalog, {mode:'done'});
  assert.deepEqual(parsed.matches.map(row => row.courseId), ['C1','U3','U2']);
  assert(parsed.matches.every(row => row.status === 'done'));
});

test('titles can wrap over lines and punctuation is normalized', () => {
  const parsed = parseProgressText('Software Quality Control\nand Management Part 1\nNortheastern University\nCompleted', catalog);
  assert.equal(parsed.matches[0].courseId, 'Q12');
  assert.equal(parsed.matches[0].status, 'done');
});

test('percentage is actual source data, supports decimals and never turns 100 into completion alone', () => {
  const parsed = parseProgressText('Getting Started with Go\n67,5%\nSoftware Architecture\n100%', catalog, {mode:'active'});
  assert.equal(parsed.matches[0].percent, 67.5);
  assert.equal(parsed.matches[1].status, 'active');
  assert.equal(parsed.matches[1].percent, 100);
  assert.equal(parseProgressText('Getting Started with Go\nContinue learning', catalog, {mode:'active'}).matches[0].percent, undefined);
});

test('explicit copied completion wins over a grade or optional-content percentage', () => {
  const heading = parseProgressText('Completed\nSoftware Architecture\nUniversity of Alberta\n67%', catalog, {mode:'mixed'});
  assert.equal(heading.matches[0].status, 'done');
  assert.equal(heading.matches[0].percent, undefined);
  const local = parseProgressText('Software Architecture\nCompleted\n67%', catalog, {mode:'active'});
  assert.equal(local.matches[0].status, 'done');
  assert.equal(local.matches[0].percent, undefined);
  const active = parseProgressText('In Progress\nSoftware Architecture\n67%', catalog, {mode:'done'});
  assert.equal(active.matches[0].status, 'active');
  assert.equal(active.matches[0].percent, 67);
  const fallback = parseProgressText('Software Architecture\n67%', catalog, {mode:'done'});
  assert.equal(fallback.matches[0].status, 'active');
});

test('explicit assignment counts calculate percent and bare fractions do not', () => {
  const parsed = parseProgressText('Getting Started with Go\nВыполнено 3 из 10 заданий\nSoftware Architecture\nGrade 9 / 10', catalog, {mode:'active'});
  assert.equal(parsed.matches[0].percent, 30);
  assert.equal(parsed.matches[0].progressSource, 'tasks');
  assert.equal(parsed.matches[0].completedTasks, 3);
  assert.equal(parsed.matches[1].percent, undefined);
});

test('same title across providers needs a choice unless nearby provider disambiguates', () => {
  const custom = [{id:'one',title:'Shared Course Name',provider:'First University',url:'https://www.coursera.org/learn/one',kind:'course'}, {id:'two',title:'Shared Course Name',provider:'Second University',url:'https://www.coursera.org/learn/two',kind:'course'}];
  const unknown = parseProgressText('Shared Course Name\nCompleted', custom);
  assert.equal(unknown.matches.length, 0);
  assert.deepEqual(unknown.ambiguous[0].candidates, ['one','two']);
  const known = parseProgressText('Shared Course Name\nSecond University\nCompleted', custom);
  assert.equal(known.matches[0].courseId, 'two');
  const preceding = parseProgressText('Second University\nShared Course Name\nCompleted', custom);
  assert.equal(preceding.matches[0].courseId, 'two');
});

test('a new active section heading does not change the preceding completed course', () => {
  const parsed = parseProgressText('Завершённые\nSoftware Architecture\nUniversity of Alberta\nObject-Oriented Design\nUniversity of Alberta\nВ процессе\nGetting Started with Go\n67%', catalog);
  assert.equal(parsed.matches.find(row => row.courseId === 'U3').status, 'done');
  assert.equal(parsed.matches.find(row => row.courseId === 'U1').status, 'done');
  assert.equal(parsed.matches.find(row => row.courseId === 'G1').status, 'active');
  assert.equal(parsed.matches.find(row => row.courseId === 'G1').percent, 67);
});

test('longer exact program names do not complete a child course contained in the title', () => {
  const custom = [{id:'course',title:'Software Testing',url:'https://www.coursera.org/learn/a',kind:'course'}, {id:'program',title:'Software Testing and Automation',url:'https://www.coursera.org/specializations/a',kind:'specialization'}];
  const parsed = parseProgressText('Software Testing and Automation\nCompleted', custom);
  assert.deepEqual(parsed.matches.map(row => row.courseId), ['program']);
});

test('repeated card titles and repeated pastes produce unique identical results', () => {
  const text = 'Software Architecture\nSoftware Architecture\nUniversity of Alberta\nCompleted\nSoftware Architecture\nUniversity of Alberta\nCompleted';
  const first = parseProgressText(text, catalog), second = parseProgressText(text, catalog);
  assert.equal(first.matches.length, 1);
  assert.deepEqual(first, second);
});

test('certificate links stay separate from course URLs and unsafe account pages are ignored', () => {
  const parsed = parseProgressText('Software Architecture\nCompleted\nhttps://www.coursera.org/account/accomplishments/verify/REAL123\nObject-Oriented Design\nCompleted\nhttps://www.coursera.org/accomplishments\nhttps://coursera.org.evil.test/verify/EVIL', catalog);
  assert.equal(parsed.matches[0].certificateUrl, 'https://www.coursera.org/account/accomplishments/verify/REAL123');
  assert.equal(parsed.matches[1].certificateUrl, undefined);
});

test('unknown title is not fuzzy-matched and a phrase inside a longer unknown title is not exact', () => {
  const parsed = parseProgressText('Advanced Software Architecture For Everyone\nUnknown Course Title\nCompleted', catalog);
  assert.equal(parsed.matches.length, 0);
  assert(parsed.unmatched.some(row => row.title === 'Unknown Course Title'));
});

test('mixed mode does not invent status or progress for an unlabelled course', () => {
  const parsed = parseProgressText('Software Architecture', catalog, {mode:'mixed'});
  assert.equal(parsed.matches.length, 0);
  assert.equal(parsed.ambiguous[0].reason, 'Не указан раздел или статус курса');
});

test('recommendations after a copied completed list are not silently marked complete', () => {
  const parsed = parseProgressText('Completed\nSoftware Architecture\nUniversity of Alberta\nCompleted\nRecommended for you\nGetting Started with Go\nUniversity of California, Irvine', catalog);
  assert.deepEqual(parsed.matches.map(row => row.courseId), ['U3']);
});

test('invalid progress is never fabricated and an empty list is harmless', () => {
  assert.equal(parseProgressText('Getting Started with Go\n167%', catalog, {mode:'active'}).matches[0].percent, undefined);
  assert.deepEqual(parseProgressText('', catalog), {matches:[],ambiguous:[],unmatched:[],warnings:[]});
});
