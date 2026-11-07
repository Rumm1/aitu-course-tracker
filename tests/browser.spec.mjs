import {test,expect} from '@playwright/test';
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
 await expect(card.locator('.status')).toHaveText('● В работе');
 await page.reload();await expect(card.locator('.status')).toHaveText('● В работе');
 await card.locator('[data-action="status"]').click();
 await page.locator('#status-form [name="status"]').selectOption('done');
 await page.locator('#status-form button').click();
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
 for(const hash of ['overview','courses','subjects','certificates']){
  await page.goto('./#'+hash);await expect(page.locator('main')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
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
 await expect(page.getByText('Архитектура ПО',{exact:true})).toBeVisible();
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
 await page.locator('#mapping-form button').click();
 await expect(page.locator('#mapping-form')).toBeVisible();
 await page.locator('#mapping-form button').click();
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
 await page.locator('#mapping-form button').click();
 await expect(page.locator('[data-review="0"]')).toBeVisible();
 await page.locator('[data-accept="0"]').check();
 await page.locator('[data-action="apply-import"]').click();
 await expect(page.locator('[data-course="U3"] .status')).toHaveText('✓ Пройден');
 await page.locator('#files').setInputFiles({name:'unknown.pdf',mimeType:'application/pdf',buffer:certificatePDF({title:'Unlisted Test Course'})});
 await expect(page.locator('[data-review="0"]')).toBeVisible({timeout:20000});
 await expect(page.locator('[data-accept="0"]')).not.toBeChecked();
});
