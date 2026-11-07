import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {subjects as defaultSubjects} from '../src/core.js';

function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(files){
 const local=[],central=[];let offset=0;
 for(const [name,value]of Object.entries(files)){
  const data=Buffer.from(value,'utf8'),filename=Buffer.from(name,'utf8'),crc=crc32(data),header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);local.push(header,filename,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);central.push(entry,filename);offset+=header.length+filename.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
function workbook(rows=[['title','url','subject','status'],['Software Architecture','https://www.coursera.org/learn/software-architecture','ARCH','done'],['Network Defense Basics','https://www.coursera.org/learn/network-defense-basics','SEC','done']]){
 const sheet=rows.map((row,index)=>`<row r="${index+1}">${row.map((value,column)=>`<c r="${String.fromCharCode(65+column)}${index+1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join('')}</row>`).join('');
 return zip({
  '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Courses" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
 });
}
const excelFile=rows=>({name:'course-catalog.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook(rows)});

async function mapColumn(page,field,header){
 const select=page.locator(`#excel-import-form [name="column-${field}"]`);
 if(!await select.count())return;
 const value=await select.evaluate((node,label)=>[...node.options].find(option=>option.textContent.trim()===label||option.textContent.trim().endsWith(' · '+label))?.value,header);
 if(value!==undefined)await select.selectOption(value);
}
async function importWorkbook(page,{capture=false,rows=undefined}={}){
 await page.locator('[data-action="excel"]').first().click();
 await page.locator('#excel-file').setInputFiles(excelFile(rows));
 await expect(page.locator('#excel-import-form')).toBeVisible();
 if(await page.locator('.excel-mapping summary').count())await page.locator('.excel-mapping summary').click();
 await mapColumn(page,'title','title');await mapColumn(page,'url','url');await mapColumn(page,'subject','subject');await mapColumn(page,'subjects','subject');await mapColumn(page,'status','status');
 if(await page.locator('[data-action="excel-preview"]').count())await page.locator('[data-action="excel-preview"]').click();
 if(capture)await page.screenshot({path:'test-results/excel-preview-light.png',animations:'disabled'});
 await page.locator('#excel-import-form button[type="submit"]').click();
 await expect(page.locator('#excel-import-form')).toHaveCount(0);
}
async function seedAndImport(page){
 await page.emulateMedia({colorScheme:'light'});
 await page.goto('./#courses');
 await expect(page.locator('[data-course]')).toHaveCount(109);
 await page.screenshot({path:'test-results/catalog-short-light.png',animations:'disabled'});
 await page.locator('[data-course="G1"] [data-action="status"]').click();
 await page.locator('[data-course="K063"] [data-action="pin"]').click();
 await importWorkbook(page,{capture:true});
 await page.goto('./#courses');
 await expect(page.locator('[data-scope="all"]')).toContainText('109');
 await expect(page.locator('[data-scope="additional"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('[data-course]')).toHaveCount(1);
}

test('Excel adds one local course, applies completed rows and preserves existing marks without duplicates',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await seedAndImport(page);
 const added=page.locator('[data-course]').filter({has:page.getByRole('heading',{name:'Network Defense Basics',exact:true})});
 await expect(added).toHaveCount(1);await expect(added.locator('.status')).toContainText('Пройден');
 await page.locator('[data-scope="all"]').click();
 await expect(page.locator('[data-course="U3"] .status')).toContainText('Пройден');
 await expect(page.locator('[data-course="G1"] .status')).toContainText('В процессе');
 await expect(page.locator('[data-course="K063"] [data-action="pin"]')).toHaveAttribute('aria-label','Снять приоритет');
 await page.locator('[data-scope="additional"]').click();
 await page.reload();await expect(page.locator('[data-course]')).toHaveCount(1);
 await expect(added.locator('.status')).toContainText('Пройден');
 await importWorkbook(page);await page.goto('./#courses');
 await expect(page.locator('[data-course]')).toHaveCount(1);await expect(added).toHaveCount(1);
 await page.goto('./#completed');
 await expect(page.getByRole('heading',{name:defaultSubjects.SEC,level:2,exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Network Defense Basics',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:defaultSubjects.ARCH,level:2,exact:true})).toBeVisible();
 await expect(page.locator('[data-course="U3"]')).toHaveCount(1);
 if(await page.locator('html').getAttribute('data-theme')!=='dark')await page.locator('[data-action="theme"]').click();
 await page.screenshot({path:'test-results/completed-excel-desktop-dark.png',animations:'disabled'});
 await page.setViewportSize({width:360,height:900});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/completed-excel-mobile-dark.png',animations:'disabled'});
 await page.goto('./#setup');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/setup-mobile-dark.png',animations:'disabled'});
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'test-results/setup-desktop-dark.png',animations:'disabled'});
 expect(errors).toEqual([]);
});

test('friends start independently and JSON backup transfers local Excel course metadata and marks',async({page,browser})=>{
 await seedAndImport(page);
 await page.locator('[data-action="settings"]').last().click();
 const pendingDownload=page.waitForEvent('download');await page.locator('[data-action="export"]').click();
 const download=await pendingDownload,backup=await readFile(await download.path());
 const friendContext=await browser.newContext();
 try{
  const friend=await friendContext.newPage();await friend.goto(new URL('#courses',page.url()).href);
  await expect(friend.locator('[data-course]')).toHaveCount(109);
  await expect(friend.locator('[data-course="U3"] .status')).toContainText('Не начат');
  await expect(friend.locator('[data-course="K063"] [data-action="pin"]')).toHaveAttribute('aria-label','Закрепить приоритет');
  await friend.locator('#files').setInputFiles({name:'my-progress.json',mimeType:'application/json',buffer:backup});
  await expect(friend.locator('[data-action="apply-import"]')).toBeVisible();
  for(const box of await friend.locator('[data-accept]').all())await box.check();
  await friend.locator('[data-action="apply-import"]').click();await friend.goto(new URL('#courses',page.url()).href);
  await expect(friend.locator('[data-course]')).toHaveCount(109);
  await expect(friend.locator('[data-course="K063"] [data-action="pin"]')).toHaveAttribute('aria-label','Снять приоритет');
  await friend.locator('[data-scope="additional"]').click();
  const added=friend.locator('[data-course]').filter({has:friend.getByRole('heading',{name:'Network Defense Basics',exact:true})});
  await expect(added).toHaveCount(1);await expect(added.locator('.status')).toContainText('Пройден');
  await friend.reload();await expect(friend.locator('[data-course]')).toHaveCount(1);
 }finally{await friendContext.close();}
});

test('Excel creates an explicit personal subject and retains its course assignment after reload',async({page})=>{
 await page.goto('./#courses');
 await importWorkbook(page,{rows:[['title','url','subject','status'],['Linear Algebra Fundamentals','https://www.coursera.org/learn/linear-algebra-fundamentals','Математика','done']]});
 await page.goto('./#subjects');
 const math=page.locator('[data-subject-id]').filter({has:page.getByRole('heading',{name:'Математика',exact:true})});
 await expect(math).toHaveCount(1);
 const id=await math.getAttribute('data-subject-id');
 await page.goto('./#courses');await page.locator('#subject').selectOption(id);
 await expect(page.locator('[data-course]')).toHaveCount(1);
 await expect(page.getByRole('heading',{name:'Linear Algebra Fundamentals',exact:true})).toBeVisible();
 await expect(page.locator('[data-course] .status')).toContainText('Пройден');
 await page.reload();await page.locator('#subject').selectOption(id);
 await expect(page.locator('[data-course]')).toHaveCount(1);
 await page.goto('./#completed');
 await expect(page.getByRole('heading',{name:'Математика',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Linear Algebra Fundamentals',exact:true})).toBeVisible();
});
