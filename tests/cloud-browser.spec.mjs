import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync(new URL('../src/catalog.json',import.meta.url),'utf8'));
test('filters, scope, type and search survive reload; totals reflect the selected scope',async({page})=>{
 await page.goto('./#courses');await page.locator('[data-scope="plan"]').click();
 await page.locator('#search').fill('Architecture');await page.locator('#subject').selectOption('ARCH');await page.locator('#kind').selectOption('course');await page.locator('#hide').check();
 const count=await page.locator('[data-course]').count();expect(count).toBeGreaterThan(0);await expect(page.locator('.list-meta')).toContainText('из 28 в плане');
 await page.reload();await expect(page.locator('#search')).toHaveValue('Architecture');await expect(page.locator('#subject')).toHaveValue('ARCH');await expect(page.locator('#kind')).toHaveValue('course');await expect(page.locator('#hide')).toBeChecked();await expect(page.locator('[data-course]')).toHaveCount(count);
 await page.locator('#status').selectOption('done');await expect(page.locator('#hide')).not.toBeChecked();
 await page.locator('[data-action="reset"]').first().click();await page.reload();await expect(page.locator('#search')).toHaveValue('');await expect(page.locator('[data-course]')).toHaveCount(28);
 await page.setViewportSize({width:360,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('legacy duplicate migrates to one visible course and one completed count without losing subjects',async({page})=>{
 await page.goto('./#courses');const base=catalog.find(c=>c.id==='U3');
 await page.evaluate(async course=>{
  const req=indexedDB.open('aitu-course-tracker:v1:/aitu-course-tracker/');await new Promise(r=>req.onsuccess=r);const db=req.result,t=db.transaction('state','readwrite');t.objectStore('state').put({settings:{subjectAssignments:{'local-legacy-duplicate':['SEC']}},customCourses:[{...course,id:'local-legacy-duplicate',url:course.url+'/home/welcome?ref=old'}],records:{'local-legacy-duplicate':{status:'done',certificateUrl:'https://www.coursera.org/account/accomplishments/verify/OLD123'}}},'main');await new Promise(r=>t.oncomplete=r);db.close();
 },base);
 await page.reload();await expect(page.locator('[data-course]')).toHaveCount(109);await expect(page.locator('[data-course="U3"] .status')).toContainText('Пройден');await expect(page.locator('[data-course="U3"] .tags')).toContainText('SEC');
 await page.goto('./#completed');await expect(page.locator('[data-course]')).toHaveCount(1);await page.reload();await expect(page.locator('[data-course]')).toHaveCount(1);
 await page.goto('./#overview');await expect(page.locator('.learning-total>strong')).toContainText('Пройдено 1 из 28');
});
function mockCloud({confirmationRequired=false}={}){
 const rows=new Map(),requests=[];
 const user=email=>({id:email.startsWith('alice')?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()});
 return {rows,requests,async install(context){await context.route('https://fxmpqblmthcxtobsjcgr.supabase.co/**',async route=>{
  const request=route.request(),url=new URL(request.url());let status=200,result={};
  requests.push(url.pathname);
  if(url.pathname==='/auth/v1/settings')result={mailer_autoconfirm:!confirmationRequired,disable_signup:false,external:{email:true}};
  else if(url.pathname==='/auth/v1/token'||url.pathname==='/auth/v1/signup'){
   const u=user(request.postDataJSON().email),jwt=[{alg:'HS256',typ:'JWT'},{sub:u.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'},'signature'].map(v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url')).join('.');
   result={access_token:jwt,refresh_token:'refresh-'+u.id,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:u};
  }else if(url.pathname.startsWith('/rest/v1/')){
   const token=request.headers().authorization?.split(' ')[1];let id;try{id=JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub;}catch{}
   if(!id){status=401;result={code:'42501',message:'unauthorized'};}
   else if(url.pathname.endsWith('/rpc/save_course_tracker')){
    const body=request.postDataJSON(),key=id+'/'+body.p_space,prior=rows.get(key);
    if((prior?.revision||0)!==body.p_revision){status=409;result={code:'40001',message:'conflict'};}
    else{const row={user_id:id,space:body.p_space,revision:body.p_revision+1,data:body.p_data};rows.set(key,row);result=[row];}
   }else{const owner=url.searchParams.get('user_id')?.slice(3),space=url.searchParams.get('space')?.slice(3);if(owner!==id){status=403;result={message:'forbidden'};}else result=rows.has(id+'/'+space)?[rows.get(id+'/'+space)]:[];}
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });}};
}
async function login(page,email){
 await page.goto('./#account');await page.locator('#account-form [name="email"]').fill(email);await page.locator('#account-form [name="password"]').fill('test-password-123');await page.locator('#account-form [type="submit"]').click();await expect(page.getByRole('button',{name:'Выйти',exact:true})).toBeVisible();await expect(page.locator('#app')).not.toHaveAttribute('inert','');
}
test('email login transfers guest data once, syncs a second device and isolates another account',async({browser,page,context})=>{
 const cloud=mockCloud();await cloud.install(context);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('./#courses');await page.locator('[data-course="U3"] [data-action="status"]').click();
 await login(page,'alice@example.test');await page.goto('./#courses');await expect(page.locator('[data-course]')).toHaveCount(0);
 await page.goto('./#account');await page.locator('[data-action="account-import"]').click();await expect(page.locator('.account-panel [data-cloud-status]')).toHaveText('Сохранено в облаке');
 await page.screenshot({path:'test-results/account-desktop.png',animations:'disabled'});
 await page.locator('[data-action="account-import"]').click();await page.goto('./#courses');await expect(page.locator('[data-course]')).toHaveCount(109);await expect(page.locator('[data-course="U3"] .status')).toContainText('В процессе');
 const mobile=await browser.newContext({viewport:{width:390,height:844}});await cloud.install(mobile);const phone=await mobile.newPage();
 try{
  await phone.goto('http://127.0.0.1:5178/aitu-course-tracker/');await login(phone,'alice@example.test');await phone.goto('./#courses');await expect(phone.locator('[data-course]')).toHaveCount(109);await expect(phone.locator('[data-course="U3"] .status')).toContainText('В процессе');
  await phone.goto('./#overview');await phone.locator('[data-action="progress-paste"]').click();await phone.locator('#progress-paste-form [name="mode"]').selectOption('active');await phone.locator('#progress-paste-form textarea').fill(catalog.find(c=>c.id==='G1').title+'\n67%');await phone.locator('#progress-paste-form [type="submit"]').click();await expect(phone.locator('#dialog')).not.toBeVisible();
  await phone.goto('./#account');await phone.locator('[data-action="account-sync"]').click();await expect(phone.locator('.account-panel [data-cloud-status]')).toHaveText('Сохранено в облаке');
  await page.goto('./#account');await page.locator('[data-action="account-sync"]').click();await expect(page.locator('.account-panel [data-cloud-status]')).toHaveText('Сохранено в облаке');await page.goto('./#courses');await expect(page.locator('[data-course="G1"] .course-progress-label')).toHaveText('В процессе · 67%');
  await page.goto('./#account');await page.locator('[data-action="account-logout"]').click();await expect(page.locator('#account-form')).toBeVisible();await login(page,'bob@example.test');await page.goto('./#courses');await expect(page.locator('[data-course]')).toHaveCount(0);await page.reload();await expect(page.locator('[data-course]')).toHaveCount(0);
  await phone.reload();await expect(phone.locator('.account-panel [data-cloud-status]')).toHaveText('Сохранено в облаке');expect(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);await phone.screenshot({path:'test-results/account-mobile.png',animations:'disabled'});
 }finally{await mobile.close();}
});
test('registration opens an empty personal account immediately without email or recovery requests',async({page,context})=>{
 const cloud=mockCloud();await cloud.install(context);await page.goto('./#account');
 await expect(page.locator('[data-mode="reset"]')).toHaveCount(0);
 await page.locator('[data-action="account-mode"][data-mode="signup"]').click();
 await page.locator('#account-form [name="email"]').fill('new@example.test');await page.locator('#account-form [name="password"]').fill('test-password-123');
 await page.locator('#account-form [type="submit"]').click();await expect(page.getByRole('button',{name:'Выйти',exact:true})).toBeVisible();
 await page.goto('./#courses');await expect(page.locator('[data-course]')).toHaveCount(0);await page.reload();await expect(page.locator('[data-course]')).toHaveCount(0);
 await page.goto('./#account');await expect(page.locator('.catalog-heading')).toContainText('new@example.test');
 expect(cloud.requests.filter(path=>path==='/auth/v1/signup')).toHaveLength(1);expect(cloud.requests).not.toContain('/auth/v1/recover');
});
test('registration reports an unfinished server setting before creating an unconfirmed user',async({page,context})=>{
 const cloud=mockCloud({confirmationRequired:true});await cloud.install(context);await page.goto('./#account');await page.locator('[data-action="account-mode"][data-mode="signup"]').click();
 await page.locator('#account-form [name="email"]').fill('new@example.test');await page.locator('#account-form [name="password"]').fill('test-password-123');await page.locator('#account-form [type="submit"]').click();
 await expect(page.locator('[data-auth-message]')).toContainText('Регистрация без письма ещё не включена');expect(cloud.requests).not.toContain('/auth/v1/signup');await expect(page.locator('#account-form [type="submit"]')).toBeEnabled();
});
