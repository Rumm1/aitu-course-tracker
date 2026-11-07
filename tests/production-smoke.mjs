import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateRawSync} from 'node:zlib';
import {chromium,expect} from '@playwright/test';

// Run explicitly after deployment: SITE_URL=https://.../ node tests/production-smoke.mjs
// This creates a fresh browser profile. It only requests public files and
// changes the isolated profile's appearance, never the owner's marks.
const site=new URL(process.env.SITE_URL||'https://rumm1.github.io/aitu-course-tracker/');
assert.equal(site.protocol,'https:','SITE_URL must use HTTPS');
assert(!site.username&&!site.password,'SITE_URL must not contain credentials');
site.search='';site.hash='';site.pathname=site.pathname.replace(/\/+$/,'')+'/';
const expectedCourses=process.env.EXPECTED_COURSES===undefined?109:Number(process.env.EXPECTED_COURSES);
assert(Number.isSafeInteger(expectedCourses)&&expectedCourses>=0,'EXPECTED_COURSES must be a non-negative integer');
const output=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','test-results');

function zipEntry(bytes,name){
 let offset=0;
 while(offset+30<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
  const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8),size=bytes.readUInt32LE(offset+18);
  const nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
  assert(!(flags&1)&&!(flags&8),'Unexpected encrypted or streamed ZIP entry');
  const fileName=bytes.subarray(offset+30,offset+30+nameLength).toString('utf8');
  const start=offset+30+nameLength+extraLength,end=start+size;
  assert(end<=bytes.length,'Truncated ZIP file');
  if(fileName===name){
   const data=bytes.subarray(start,end);
   if(method===0)return data;
   if(method===8)return inflateRawSync(data);
   throw Error('Unsupported ZIP compression');
  }
  offset=end;
 }
 throw Error(`ZIP entry ${name} was not found`);
}
async function settleAppearance(page){
 await page.evaluate(async()=>{
  const finite=document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().endTime!==Infinity);
  await Promise.all(finite.map(animation=>animation.finished.catch(()=>{})));
 });
}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Horizontal page overflow');}

await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const coursesURL=new URL(site);coursesURL.hash='courses';
 const response=await page.goto(coursesURL.href);
 assert.equal(response?.status(),200,'Public Pages response');
 await expect(page.locator('h1')).toHaveText('Мои курсы');
 await expect(page.locator('[data-course]')).toHaveCount(expectedCourses);
 await expect.poll(()=>page.locator('.sidebar .brand-symbol').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
 await page.getByRole('button',{name:'Свернуть панель',exact:true}).click();
 await expect(page.locator('#app')).toHaveAttribute('data-sidebar','collapsed');
 await page.reload();await expect(page.locator('#app')).toHaveAttribute('data-sidebar','collapsed');
 await page.getByRole('button',{name:'Развернуть панель',exact:true}).click();
 const subjectNames=(await page.locator('#subject option').evaluateAll(options=>options.filter(option=>option.value).map(option=>option.textContent.trim())));
 if(expectedCourses===109){
  for(const name of ['Capstone Project','Information Security','Software Quality Assurance and Testing','Software Architecture','Technology Entrepreneurship'])assert(subjectNames.includes(name),`English subject ${name} is absent`);
 }

 const setupURL=new URL(site);setupURL.hash='setup';await page.goto(setupURL.href);
 await expect(page.locator('h1')).toContainText('Свой сайт');
 const download=page.locator('a[download][href$="course-progress-extension.zip"]').first();
 await expect(download).toBeVisible();
 const zipURL=new URL(await download.getAttribute('href'),site).href,zipResponse=await context.request.get(zipURL);
 assert.equal(zipResponse.status(),200,'Extension ZIP is unavailable');
 const bytes=await zipResponse.body();assert(bytes.length>1000,'Extension ZIP is unexpectedly small');
 const manifest=JSON.parse(zipEntry(bytes,'manifest.json').toString('utf8'));
 const expectedManifest=JSON.parse(await fs.readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.version,expectedManifest.version,'Unexpected extension release');
 assert.equal(zipEntry(bytes,'logo.png').subarray(1,4).toString(),'PNG','PNG logo is absent from the extension ZIP');
 const bridge=manifest.content_scripts.find(script=>script.js?.includes('tracker-content.js'));
 assert(bridge,'Extension tracker bridge is absent');
 assert.deepEqual(bridge.matches,[`${site.protocol}//${site.hostname}/*`]);
 assert.deepEqual(bridge.include_globs,[`${site.origin}${site.pathname}*`]);

 await page.goto(coursesURL.href);await expect(page.locator('[data-course]')).toHaveCount(expectedCourses);
 if(await page.locator('html').getAttribute('data-theme')!=='dark')await page.locator('[data-action="theme"]').click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await settleAppearance(page);await noOverflow(page);
 await page.screenshot({path:path.join(output,'production-desktop-dark.png')});
 await page.setViewportSize({width:360,height:900});
 if(await page.locator('html').getAttribute('data-theme')!=='light')await page.locator('[data-action="theme"]').click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');await settleAppearance(page);await noOverflow(page);
 await page.screenshot({path:path.join(output,'production-mobile-light.png')});
 assert.deepEqual(errors,[],'Production page emitted JavaScript errors');
 console.log(JSON.stringify({site:site.href,httpStatus:200,courses:expectedCourses,subjectNames,extensionVersion:manifest.version,extensionBytes:bytes.length,zipStatus:200,mobileOverflow:false,pageErrors:errors,screenshots:['test-results/production-desktop-dark.png','test-results/production-mobile-light.png']},null,2));
}finally{await browser.close();}
