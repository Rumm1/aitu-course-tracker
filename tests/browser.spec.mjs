import {test,expect} from '@playwright/test';
import {subjects as defaultSubjects} from '../src/core.js';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {certificatePDF} from './pdf-fixture.mjs';

test('fresh catalog, plan, Russian search, reset and project prefix',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('./#courses');
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await expect(page.locator('[data-scope="plan"]')).toContainText('28');
 await page.locator('#search').fill('архитектура');
 await expect(page.locator('[data-course]').first()).toBeVisible();
 expect(await page.locator('[data-course]').count()).toBeLessThan(109);
 await page.locator('#search').fill('Software Architecture');
 await expect(page.locator('[data-course="U3"]')).toBeVisible();
 await page.locator('#search').fill('unknown course xyz');
 await expect(page.getByText('По этим фильтрам ничего не найдено')).toBeVisible();
 await page.locator('[data-action="reset"]').first().click();
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await page.locator('[data-scope="plan"]').click();
 await expect(page.locator('[data-course]')).toHaveCount(28);
 expect(errors).toEqual([]);
});

test('status persists and certificate only appears after done plus URL',async({page})=>{
 await page.goto('./#courses');const card=page.locator('[data-course="U3"]');
 await expect(card.getByText('Открыть сертификат')).toHaveCount(0);
 await card.locator('[data-action="status"]').click();
 await expect(card.locator('.status')).toHaveText('● В процессе');
 await page.reload();await expect(card.locator('.status')).toHaveText('● В процессе');
 await card.locator('[data-action="status"]').click();
 await page.locator('#status-form [name="status"]').selectOption('done');
 await page.locator('#status-form').getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(card.locator('.status')).toHaveText('✓ Пройден');
 await expect(card.getByRole('button',{name:'Добавить ссылку',exact:true})).toBeVisible();
 await expect(card.getByText('Открыть сертификат')).toHaveCount(0);
 await card.getByRole('button',{name:'Добавить ссылку',exact:true}).click();
 await page.locator('#cert-form [name="url"]').fill('https://www.coursera.org/account/accomplishments/verify/TESTCERT123');
 await page.locator('#cert-form button').click();
 await expect(card.getByRole('link',{name:'Открыть сертификат ↗'})).toHaveAttribute('target','_blank');
 await page.goto('./#overview');await expect(page.locator('.stats>div').first()).toContainText('1 / 28');
 await page.reload();await expect(page.locator('.stats>div').first()).toContainText('1 / 28');
});

test('plan membership and architecture filter preserve full catalog',async({page})=>{
 await page.goto('./#courses');const card=page.locator('[data-course="K063"]');
 await card.locator('[data-action="plan"]').click();
 await expect(page.locator('[data-scope="plan"]')).toContainText('29');
 await card.locator('[data-action="plan"]').click();
 await expect(page.locator('[data-scope="plan"]')).toContainText('28');
 await page.locator('#variant').selectOption('UML');
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await page.locator('[data-scope="plan"]').click();
 await expect(page.locator('[data-course="G1"]')).toHaveCount(0);
 await page.locator('[data-scope="all"]').click();
 await expect(page.locator('[data-course="G1"]')).toBeVisible();
});

test('360px viewport has no overflow and course actions stay accessible',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 for(const hash of ['overview','courses','completed','subjects','certificates']){
  await page.goto('./#'+hash);await expect(page.locator('main')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  for(const item of await page.locator('.sidebar nav a').all()){
   const box=await item.boundingBox();
   expect(box).not.toBeNull();
   expect(box.y).toBeGreaterThanOrEqual(0);
   expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize().height+1);
  }
 }
 await page.goto('./#courses');
 const first=page.locator('[data-course]').first();
 await expect(first.getByRole('link',{name:'Открыть курс ↗'})).toBeVisible();
 await first.locator('[data-action="details"]').click();
 await expect(page.locator('dialog')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('local PDF text and link annotation import once and update all representations',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('./#certificates');
 await page.locator('#owner').fill('Test Learner');await page.locator('#owner').blur();
 const file={name:'certificate-test.pdf',mimeType:'application/pdf',buffer:certificatePDF()};
 await page.locator('#files').setInputFiles(file);
 await expect(page.locator('[data-course="U3"] .status')).toHaveText('✓ Пройден',{timeout:20000});
 await expect(page.locator('[data-course="U3"]')).toContainText('Дата неизвестна');
 await expect(page.locator('[data-course="U3"] a.primary')).toHaveAttribute('href','https://www.coursera.org/account/accomplishments/verify/TESTCERT123');
 await page.locator('#files').setInputFiles(file);
 await expect(page.locator('[data-course="U3"]')).toHaveCount(1);
 await page.goto('./#overview');await expect(page.locator('.stats>div').first()).toContainText('1 / 28');
 await page.goto('./#subjects');
 await expect(page.getByRole('heading',{name:defaultSubjects.ARCH,level:2,exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});

test('backup preserves explicit plan flags when current browser is empty',async({page})=>{
 await page.goto('./#certificates');
 await page.locator('#files').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'aitu-course-tracker',version:1,records:{U3:{status:'done',inPlan:false,pinned:true}}}))});
 await expect(page.locator('[data-review="0"]')).toBeVisible();
 await page.locator('[data-accept="0"]').check();await page.locator('[data-action="apply-import"]').click();
 await page.goto('./#courses');
 await expect(page.locator('[data-scope="plan"]')).toContainText('27');
 await expect(page.locator('[data-course="U3"] [data-action="plan"]')).toContainText('В план');
 await expect(page.locator('[data-course="U3"] [data-action="pin"]')).toHaveAttribute('aria-label','Снять приоритет');
});

test('two CSV files map sequentially and both results are applied',async({page})=>{
 await page.goto('./#certificates');
 await page.locator('#files').setInputFiles([
  {name:'first.csv',mimeType:'text/csv',buffer:Buffer.from('courseId,status\nU3,done\n')},
  {name:'second.csv',mimeType:'text/csv',buffer:Buffer.from('courseId,status\nU1,done\n')}
 ]);
 await expect(page.locator('#mapping-form')).toBeVisible();
 await page.locator('#mapping-form').getByRole('button',{name:/^Проверить/}).click();
 await expect(page.locator('#mapping-form')).toBeVisible();
 await page.locator('#mapping-form').getByRole('button',{name:/^Проверить/}).click();
 await expect(page.locator('[data-review]')).toHaveCount(2);
 await page.locator('[data-accept="0"]').check();await page.locator('[data-accept="1"]').check();
 await page.locator('[data-action="apply-import"]').click();
 await expect(page.locator('[data-course="U3"] .status')).toHaveText('✓ Пройден');
 await expect(page.locator('[data-course="U1"] .status')).toHaveText('✓ Пройден');
});

test('CSV column mapping and unknown certificate stay reviewable',async({page})=>{
 await page.goto('./#certificates');
 await page.locator('#files').setInputFiles({name:'report.csv',mimeType:'text/csv',buffer:Buffer.from('courseId,status,completedAt\nU3,done,2025-02-01\n')});
 await expect(page.locator('#mapping-form')).toBeVisible();
 await page.locator('#mapping-form').getByRole('button',{name:/^Проверить/}).click();
 await expect(page.locator('[data-review="0"]')).toBeVisible();
 await page.locator('[data-accept="0"]').check();
 await page.locator('[data-action="apply-import"]').click();
 await expect(page.locator('[data-course="U3"] .status')).toHaveText('✓ Пройден');
 await page.locator('#files').setInputFiles({name:'unknown.pdf',mimeType:'application/pdf',buffer:certificatePDF({title:'Unlisted Test Course'})});
 await expect(page.locator('[data-review="0"]')).toBeVisible({timeout:20000});
 await expect(page.locator('[data-accept="0"]')).not.toBeChecked();
});

test('theme preference persists across routes and reload and styles dialogs',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});
 await page.goto('./#overview');
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await expect(page).toHaveTitle(/Курс за курсом/);
 await expect(page.locator('body')).not.toContainText('AITU');
 const light=await page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor);
 await page.locator('[data-action="theme"]').click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 const dark=await page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor);
 expect(dark).not.toBe(light);
 await page.goto('./#courses');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.locator('[data-course="U3"] [data-action="details"]').click();
 await expect(page.locator('dialog')).toBeVisible();
 const dialogColor=await page.locator('dialog').evaluate(el=>getComputedStyle(el).backgroundColor);
 const rgb=dialogColor.match(/[\d.]+/g).slice(0,3).map(Number);
 expect(Math.max(...rgb)).toBeLessThan(120);
 await page.locator('[data-action="close"]').click();
 await page.locator('[data-action="theme"]').click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});

test('system theme follows the device until a manual theme is chosen',async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});
 await page.goto('./#overview');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.locator('[data-action="theme"]').click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.emulateMedia({colorScheme:'light'});
 await page.emulateMedia({colorScheme:'dark'});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.locator('[data-action="settings"]').first().click();
 await page.locator('#theme-preference').selectOption('system');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.emulateMedia({colorScheme:'light'});
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.emulateMedia({colorScheme:'dark'});
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});

test('list view keeps catalog actions, filtering and saved layout',async({page})=>{
 await page.goto('./#courses');
 await page.locator('[data-layout="list"]').click();
 await expect(page.locator('#catalog-grid')).toHaveClass(/list-view/);
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await page.locator('#search').fill('Software Architecture');
 const card=page.locator('[data-course="U3"]');
 await expect(card).toBeVisible();
 await card.locator('[data-action="status"]').click();
 await expect(card.locator('.status')).toContainText('В процессе');
 await expect(page.locator('#catalog-grid')).toHaveClass(/list-view/);
 await page.reload();
 await expect(page.locator('#catalog-grid')).toHaveClass(/list-view/);
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await expect(card.locator('.status')).toContainText('В процессе');
 await page.locator('[data-layout="grid"]').click();
 await expect(page.locator('#catalog-grid')).not.toHaveClass(/list-view/);
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await page.reload();
 await expect(page.locator('#catalog-grid')).not.toHaveClass(/list-view/);
});

test('both themes and list view fit 360px and respect reduced motion',async({page})=>{
 await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 await page.setViewportSize({width:360,height:800});
 for(const theme of ['light','dark']){
  await page.goto('./#overview');
  if(theme==='dark')await page.locator('[data-action="theme"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  for(const hash of ['overview','courses','completed','subjects','certificates']){
   await page.goto('./#'+hash);
   await expect(page.locator('main')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.goto('./#courses');
  await page.locator('[data-layout="list"]').click();
  await expect(page.locator('#catalog-grid')).toHaveClass(/list-view/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const durations=await page.locator('[data-course]').first().evaluate(el=>{
   const style=getComputedStyle(el);
   return [...style.animationDuration.split(','),...style.transitionDuration.split(',')].map(s=>parseFloat(s)*(s.trim().endsWith('ms')?1:1000));
  });
  expect(Math.max(...durations)).toBeLessThanOrEqual(10);
 }
});

async function applyProgressPaste(page,text,mode='mixed'){
 await page.goto('./#overview');
 await page.locator('[data-action="progress-check"]').first().click();
 await page.locator('#progress-paste-form textarea[name="text"]').fill(text);
 await page.locator('#progress-paste-form select[name="mode"]').selectOption(mode);
 await page.locator('#progress-paste-form button[type="submit"]').click();
 await expect(page.locator('#progress-paste-form')).toHaveCount(0);
 await expect(page.locator('.progress-result')).toBeVisible();
}

const mixedCourseraList=[
 'Completed',
 'Software Architecture',
 'Object-Oriented Design',
 'In Progress',
 'Mastering Selenium WebDriver and Java Fundamentals',
 '67% complete'
].join('\n');

test('bulk Coursera paste applies completed and active progress in one step and persists',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await applyProgressPaste(page,mixedCourseraList);
 await expect(page.locator('[data-review]')).toHaveCount(0);
 await expect(page.locator('.progress-result')).toContainText('Вставленный список Coursera');
 await expect(page.locator('#last-progress-check')).toContainText(/\d{2}\.\d{2}\.\d{4}/);
 await expect(page.locator('.progress-result')).not.toContainText(/синхронизировано/i);
 await page.goto('./#courses');
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await expect(page.locator('[data-course="U3"] .status')).toContainText('Пройден');
 await expect(page.locator('[data-course="U1"] .status')).toContainText('Пройден');
 const active=page.locator('[data-course="Q2"]');
 await expect(active.locator('.status')).toContainText('В процессе');
 await expect(active.locator('.course-progress-label')).toContainText('67%');
 await expect(active.getByText('Открыть сертификат')).toHaveCount(0);
 await page.reload();
 await expect(active.locator('.status')).toContainText('В процессе');
 await expect(active.locator('.course-progress-label')).toContainText('67%');
 await page.goto('./#overview');
 await expect(page.locator('.stats>div').first()).toContainText('2 / 28');
 await expect(page.locator('#last-progress-check')).toContainText('Вставленный список Coursera');
 await expect(page.locator('#last-progress-check')).toContainText(/\d{2}\.\d{2}\.\d{4}/);
 await expect(page.locator('#last-progress-check')).not.toContainText(/синхронизировано/i);
 await page.goto('./#completed');
 await expect(page.getByRole('heading',{name:defaultSubjects.ARCH,level:2,exact:true})).toBeVisible();
 await expect(page.locator('[data-course="U3"]')).toHaveCount(1);
 await expect(page.locator('[data-course="U1"]')).toHaveCount(1);
 await applyProgressPaste(page,mixedCourseraList);
 await page.goto('./#overview');
 await expect(page.locator('.stats>div').first()).toContainText('2 / 28');
 await page.goto('./#courses');
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await expect(page.locator('[data-course="U3"]')).toHaveCount(1);
 expect(errors).toEqual([]);
});

test('incomplete Coursera paste does not downgrade completed courses or clear known percent',async({page})=>{
 await applyProgressPaste(page,mixedCourseraList);
 await applyProgressPaste(page,[
  'In Progress',
  'Software Architecture',
  'Mastering Selenium WebDriver and Java Fundamentals'
 ].join('\n'));
 await page.goto('./#courses');
 await expect(page.locator('[data-course="U3"] .status')).toContainText('Пройден');
 await expect(page.locator('[data-course="U1"] .status')).toContainText('Пройден');
 await expect(page.locator('[data-course="Q2"] .status')).toContainText('В процессе');
 await expect(page.locator('[data-course="Q2"] .course-progress-label')).toContainText('67%');
 await page.reload();
 await expect(page.locator('[data-course="Q2"] .course-progress-label')).toContainText('67%');
 await page.goto('./#overview');
 await expect(page.locator('.stats>div').first()).toContainText('2 / 28');
});

test('active Coursera course without a percentage does not invent progress',async({page})=>{
 await applyProgressPaste(page,'Getting Started with Go','active');
 await page.goto('./#courses');
 const card=page.locator('[data-course="G1"]');
 await expect(card.locator('.status')).toContainText('В процессе');
 await expect(card).not.toContainText(/\d+\s*%/);
 await expect(card.getByText('Открыть сертификат')).toHaveCount(0);
 await page.reload();
 await expect(card.locator('.status')).toContainText('В процессе');
 await expect(card).not.toContainText(/\d+\s*%/);
});

test('browser bridge updates captured visible-page progress automatically without official sync claims',async({page})=>{
 await page.addInitScript(()=>{
  window.addEventListener('message',event=>{
   if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='course-by-course'||event.data.type!=='PROGRESS_REQUEST')return;
   window.postMessage({channel:'course-by-course',type:'PROGRESS_RESPONSE',requestId:event.data.requestId,payload:{
    version:1,enabled:true,capturedAt:new Date().toISOString(),
    rows:[{courseId:'U3',status:'done'},{courseId:'Q2',status:'active',percent:67}],ambiguous:[],unmatched:[]
   }},location.origin);
  });
 });
 await page.goto('./#courses');
 await expect(page.locator('[data-course="U3"] .status')).toContainText('Пройден');
 await expect(page.locator('[data-course="Q2"] .status')).toContainText('В процессе');
 await expect(page.locator('[data-course="Q2"] .course-progress-label')).toContainText('67%');
 await page.goto('./#overview');
 await expect(page.locator('#last-progress-check')).toContainText('Расширение браузера · видимая страница Coursera');
 await expect(page.locator('#last-progress-check')).not.toContainText(/синхронизировано/i);
 await page.evaluate(()=>window.postMessage({channel:'course-by-course',type:'PROGRESS_CHANGED',payload:{
  version:1,enabled:true,capturedAt:new Date().toISOString(),
  rows:[{courseId:'U1',status:'done'},{courseId:'U3',status:'done',certificateUrl:'https://www.coursera.org/account/accomplishments/verify/AUTORESULT123'},{courseId:'Q2',status:'active',percent:70}],ambiguous:[],unmatched:[]
 }},location.origin));
 await expect(page.locator('.stats>div').first()).toContainText('2 / 28');
 await page.goto('./#courses');
 await expect(page.locator('[data-course="U1"] .status')).toContainText('Пройден');
 await expect(page.locator('[data-course="Q2"] .course-progress-label')).toContainText('70%');
 await expect(page.locator('[data-course="U3"] a.primary')).toHaveAttribute('href','https://www.coursera.org/account/accomplishments/verify/AUTORESULT123');
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await page.reload();
 await expect(page.locator('[data-course="U3"] .status')).toContainText('Пройден');
 await expect(page.locator('[data-course="U1"] .status')).toContainText('Пройден');
 await expect(page.locator('[data-course="Q2"] .course-progress-label')).toContainText('70%');
 await expect(page.locator('[data-course="U3"] a.primary')).toHaveAttribute('href','https://www.coursera.org/account/accomplishments/verify/AUTORESULT123');
});

test('collapsible sidebar preserves focus, progress and preference across routes and mobile layouts',async({page})=>{
 await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 await page.goto('./#courses');
 const logo=page.locator('.sidebar .brand-symbol');
 await expect.poll(()=>logo.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 await page.locator('[data-course="U3"] [data-action="status"]').click();
 await page.locator('#search').fill('Software Architecture');
 await page.getByRole('button',{name:'Свернуть панель',exact:true}).click();
 await expect(page.locator('#app')).toHaveAttribute('data-sidebar','collapsed');
 await expect(page.getByRole('button',{name:'Развернуть панель',exact:true})).toBeFocused();
 await expect(page.locator('#search')).toHaveValue('Software Architecture');
 expect((await page.locator('.sidebar').boundingBox()).width).toBeLessThan(90);
 await page.locator('.sidebar nav').getByRole('link',{name:'Сертификаты',exact:true}).click();
 await expect(page.locator('h1')).toHaveText('Сертификаты');
 expect((await page.locator('.topbar').boundingBox()).height).toBeLessThanOrEqual(60);
 expect((await page.locator('.certificate-heading').boundingBox()).height).toBeLessThan(90);
 await page.screenshot({path:'test-results/sidebar-collapsed-light.png',animations:'disabled'});
 await page.reload();await expect(page.locator('#app')).toHaveAttribute('data-sidebar','collapsed');
 await page.getByRole('button',{name:'Развернуть панель',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.locator('#app')).toHaveAttribute('data-sidebar','expanded');
 await page.locator('[data-action="theme"]').click();
 await page.screenshot({path:'test-results/sidebar-expanded-dark.png',animations:'disabled'});
 await page.getByRole('button',{name:'Свернуть панель',exact:true}).click();
 await page.setViewportSize({width:360,height:800});
 await expect(page.locator('.sidebar-toggle')).toBeHidden();
 for(const link of await page.locator('.sidebar nav a').all()){await expect(link).toBeVisible();const box=await link.boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(801);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/certificates-mobile-dark.png',animations:'disabled'});
 await page.locator('.sidebar nav').getByRole('link',{name:'Курсы',exact:true}).click();
 await expect(page.locator('[data-course="U3"] .status')).toContainText('В процессе');
 await page.setViewportSize({width:1440,height:1000});
 await expect(page.locator('#app')).toHaveAttribute('data-sidebar','collapsed');
});

test('custom course filter has themed options and complete keyboard and mouse selection',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});
 await page.goto('./#courses');
 const trigger=page.locator('[data-select-trigger="subject"]');
 await expect(trigger).toHaveAttribute('role','combobox');
 await trigger.focus();await trigger.press('ArrowDown');
 await expect(trigger).toHaveAttribute('aria-expanded','true');
 const listbox=page.getByRole('listbox');
 await expect(listbox).toBeVisible();
 await trigger.press('End');await trigger.press('Home');await trigger.press('ArrowDown');await trigger.press('Enter');
 await expect(page.locator('#subject')).toHaveValue('CAP');
 await expect(page.locator('[data-select-trigger="subject"]')).toContainText(defaultSubjects.CAP);
 expect(await page.locator('[data-course]').count()).toBeLessThan(109);
 await page.locator('[data-select-trigger="subject"]').press('ArrowDown');
 await page.locator('[data-select-trigger="subject"]').press('Escape');
 await expect(page.getByRole('listbox')).toHaveCount(0);
 await expect(page.locator('#subject')).toHaveValue('CAP');
 await expect(page.locator('[data-select-trigger="subject"]')).toBeFocused();
 await page.locator('[data-select-trigger="subject"]').press('Space');
 await expect(page.getByRole('listbox')).toBeVisible();
 await page.locator('[data-select-trigger="subject"]').press('Space');
 await expect(page.getByRole('listbox')).toHaveCount(0);
 await expect(page.locator('#subject')).toHaveValue('CAP');
 await page.locator('[data-select-trigger="subject"]').click();
 await page.locator('[role="option"][data-select-value="ARCH"]').click();
 await expect(page.locator('#subject')).toHaveValue('ARCH');
 await expect(page.locator('[data-course="U3"]')).toBeVisible();
 // Programmatic native selection remains compatible with imports and tests.
 await page.locator('#subject').selectOption('SEC');
 await expect(page.locator('[data-select-trigger="subject"]')).toContainText(defaultSubjects.SEC);
 await page.locator('[data-action="reset"]').first().click();
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await page.locator('[data-action="theme"]').click();
 await page.locator('[data-select-trigger="subject"]').click();
 await expect(page.getByRole('listbox')).toBeVisible();
 const color=await page.getByRole('listbox').evaluate(el=>getComputedStyle(el).backgroundColor);
 expect(Math.max(...color.match(/[\d.]+/g).slice(0,3).map(Number))).toBeLessThan(130);
 await page.screenshot({path:'test-results/custom-filter-dark.png',animations:'disabled'});
 await page.locator('[data-select-trigger="subject"]').press('Escape');
 await page.setViewportSize({width:360,height:900});
 await page.locator('[data-select-trigger="subject"]').click();
 const bounds=await page.getByRole('listbox').boundingBox();
 expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(361);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/custom-filter-mobile-dark.png',animations:'disabled'});
});

test('personal subjects can be created, assigned, renamed and restored without resetting marks',async({page,browser})=>{
 await page.emulateMedia({colorScheme:'light'});
 await applyProgressPaste(page,'Software Architecture','done');
 await page.goto('./#courses');
 await page.locator('[data-course="G1"] [data-action="status"]').click();
 await page.locator('[data-course="K063"] [data-action="pin"]').click();
 await page.goto('./#subjects');
 await page.locator('[data-action="subject-add"]').first().click();
 await page.locator('#subject-create-form [name="name"]').fill('Математика');
 await page.locator('#subject-create-form button[type="submit"]').click();
 const mathPanel=page.locator('[data-subject-id]').filter({has:page.getByRole('heading',{name:'Математика',exact:true})});
 await expect(mathPanel).toHaveCount(1);
 const mathId=await mathPanel.getAttribute('data-subject-id');
 await mathPanel.locator('[data-action="subject-manage"]').click();
 const assignment=page.locator('#subject-courses-form');
 await assignment.locator('[name="query"]').fill('Software Architecture');
 await assignment.locator('input[name="course"][value="U3"]').check();
 await assignment.locator('[name="query"]').fill('Selenium');
 await assignment.locator('[name="query"]').fill('Software Architecture');
 await expect(assignment.locator('input[name="course"][value="U3"]')).toBeChecked();
 await assignment.locator('button[type="submit"]').click();
 await page.locator(`[data-subject-id="${mathId}"] [data-action="subject-edit"]`).click();
 await page.locator('#subject-edit-form [name="name"]').fill('Высшая математика');
 await page.locator('#subject-edit-form button[type="submit"]').click();
 await page.reload();
 await expect(page.locator(`[data-subject-id="${mathId}"]`).getByRole('heading',{name:'Высшая математика',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:defaultSubjects.ARCH,level:2,exact:true})).toBeVisible();
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:'test-results/subjects-personal-light.png',animations:'disabled'});
 await page.setViewportSize({width:360,height:900});await page.locator('[data-action="theme"]').click();
 await page.locator(`[data-subject-id="${mathId}"]`).scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/subjects-personal-mobile-dark.png',animations:'disabled'});
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('./#courses');
 await page.locator('#subject').selectOption(mathId);
 await expect(page.locator('[data-course="U3"]')).toHaveCount(1);
 await expect(page.locator('[data-course="U3"] .status')).toContainText('Пройден');
 await page.locator('#subject').selectOption('ARCH');
 await expect(page.locator('[data-course="U3"]')).toHaveCount(1);
 await page.locator('[data-action="reset"]').first().click();
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await expect(page.locator('[data-course="G1"] .status')).toContainText('В процессе');
 await expect(page.locator('[data-course="K063"] [data-action="pin"]')).toHaveAttribute('aria-label','Снять приоритет');
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:'test-results/catalog-personal-dark.png',animations:'disabled'});
 await page.goto('./#overview');await expect(page.locator('.stats>div').first()).toContainText('1 / 28');
 await page.goto('./#completed');
 await expect(page.locator('[data-course="U3"]')).toHaveCount(1);
 await expect(page.locator('[data-completed-subject="ARCH"] [data-course="U3"]')).toHaveCount(1);
 await page.locator('[data-action="settings"]').last().click();
 const pendingDownload=page.waitForEvent('download');await page.locator('[data-action="export"]').click();
 const download=await pendingDownload,backup=await (await import('node:fs/promises')).readFile(await download.path());
 const friendContext=await browser.newContext();
 try{
  const friend=await friendContext.newPage();await friend.goto(new URL('#subjects',page.url()).href);
  await expect(friend.getByRole('heading',{name:'Высшая математика',exact:true})).toHaveCount(0);
  await friend.locator('#files').setInputFiles({name:'personal-subjects.json',mimeType:'application/json',buffer:backup});
  await expect(friend.locator('[data-action="apply-import"]')).toBeVisible();
  await friend.locator('#restore-settings').check();
  for(const box of await friend.locator('[data-accept]').all())await box.check();
  await friend.locator('[data-action="apply-import"]').click();
  await friend.goto(new URL('#courses',page.url()).href);
  await friend.locator('#subject').selectOption(mathId);
  await expect(friend.locator('[data-course="U3"] .status')).toContainText('Пройден');
  await friend.goto(new URL('#subjects',page.url()).href);
  await expect(friend.getByRole('heading',{name:'Высшая математика',exact:true})).toBeVisible();
  await friend.reload();await expect(friend.getByRole('heading',{name:'Высшая математика',exact:true})).toBeVisible();
 }finally{await friendContext.close();}
});

test('a personal repository starts with an empty catalog and subjects while the original site retains its defaults',async({page,browser})=>{
 test.setTimeout(45000);
 await page.goto('./#courses');await expect(page.locator('[data-course]')).toHaveCount(109);
 const reservation=createServer();
 await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const root=fileURLToPath(new URL('../',import.meta.url));
 const childCode="import {createServer} from 'vite';const server=await createServer({root:process.cwd(),cacheDir:'node_modules/.vite-personal-qa-'+process.env.QA_PERSONAL_PORT,base:'/MyCourses/',server:{host:'127.0.0.1',port:Number(process.env.QA_PERSONAL_PORT),strictPort:true}});await server.listen();server.printUrls();";
 const preview=spawn(process.execPath,['--input-type=module','-e',childCode],{cwd:root,env:{...process.env,GITHUB_REPOSITORY:'StudyBuddy/MyCourses',QA_PERSONAL_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let startup='';preview.stdout.on('data',chunk=>{startup=(startup+chunk).slice(-5000);});preview.stderr.on('data',chunk=>{startup=(startup+chunk).slice(-5000);});
 const friendContext=await browser.newContext();
 try{
  const address=`http://127.0.0.1:${port}/MyCourses/`;
  await expect.poll(async()=>{if(preview.exitCode!==null)throw Error('Personal preview exited: '+startup);try{return(await fetch(address)).status;}catch{return 0;}},{timeout:15000}).toBe(200);
  const friend=await friendContext.newPage();await friend.goto(address+'#courses');
  await expect(friend.locator('[data-action="excel"]').first()).toBeVisible();
  await expect(friend.locator('[data-course]')).toHaveCount(0);
  await friend.goto(address+'#subjects');
  await expect(friend.locator('[data-action="subject-add"]').first()).toBeVisible();
  await expect(friend.locator('[data-subject-id]')).toHaveCount(0);
  await friend.locator('[data-action="subject-add"]').first().click();
  await friend.locator('#subject-create-form [name="name"]').fill('Математика');
  await friend.locator('#subject-create-form button[type="submit"]').click();
  await expect(friend.getByRole('heading',{name:'Математика',exact:true})).toBeVisible();
  await friend.reload();await expect(friend.locator('[data-subject-id]')).toHaveCount(1);
  await friend.goto(address+'#overview');
  await expect(friend.locator('.stats>div').first()).toContainText('0 / 0');
  await expect(friend.locator('main')).not.toContainText('NaN');
  await friend.goto(address+'#courses');await expect(friend.locator('[data-course]')).toHaveCount(0);
  await page.reload();await expect(page.locator('[data-course]')).toHaveCount(109);
 }finally{
  await friendContext.close();
  if(preview.exitCode===null){const exited=new Promise(resolve=>preview.once('exit',resolve));preview.kill();let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);clearTimeout(timer);}
 }
});

test('browser discovery imports unknown completed and active courses once and persists their real progress',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.__discoveryPayload={version:1,enabled:true,capturedAt:'2026-11-07T12:00:00Z',
   courses:[
    {id:'local-discovered-algebra',title:'Personal Linear Algebra',url:'https://www.coursera.org/learn/personal-linear-algebra',kind:'course',subjects:[]},
    {id:'local-discovered-network',title:'Personal Network Defense',url:'https://www.coursera.org/learn/personal-network-defense',kind:'course',subjects:[]},
   ],
   rows:[{courseId:'local-discovered-algebra',status:'done'},{courseId:'local-discovered-network',status:'active',percent:67}],ambiguous:[],unmatched:[]};
  window.addEventListener('message',event=>{
   if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='course-by-course'||event.data.type!=='PROGRESS_REQUEST')return;
   window.postMessage({channel:'course-by-course',type:'PROGRESS_RESPONSE',requestId:event.data.requestId,payload:window.__discoveryPayload},location.origin);
  });
 });
 await page.goto('./#courses');
 await expect(page.locator('[data-course]')).toHaveCount(111);
 const completed=page.locator('[data-course]').filter({has:page.getByRole('heading',{name:'Personal Linear Algebra',exact:true})});
 const active=page.locator('[data-course]').filter({has:page.getByRole('heading',{name:'Personal Network Defense',exact:true})});
 await expect(completed).toHaveCount(1);await expect(completed.locator('.status')).toContainText('Пройден');
 await expect(active).toHaveCount(1);await expect(active.locator('.course-progress-label')).toContainText('67%');
 await expect(page.locator('[data-scope="plan"]')).toContainText('28');
 await page.reload();await expect(page.locator('[data-course]')).toHaveCount(111);
 await expect(active.locator('.course-progress-label')).toContainText('67%');
 await page.evaluate(()=>window.postMessage({channel:'course-by-course',type:'PROGRESS_CHANGED',payload:window.__discoveryPayload},location.origin));
 await expect(page.locator('[data-course]')).toHaveCount(111);await expect(completed).toHaveCount(1);
 await page.goto('./#completed');await expect(page.getByRole('heading',{name:'Personal Linear Algebra',exact:true})).toBeVisible();
 await page.goto('./#overview');await expect(page.locator('#last-progress-check')).toContainText('Расширение браузера');
 expect(errors).toEqual([]);
});
