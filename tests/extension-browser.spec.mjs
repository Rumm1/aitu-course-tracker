import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';

const contentScript=fileURLToPath(new URL('../build/extension/coursera-content.js',import.meta.url));

async function useMockedLearningPage(page,{enabled=true,tab='Completed',html=''}){
  await page.addInitScript(({enabled})=>{
    window.__extensionCaptures=[];
    window.__extensionStorageReads=0;
    const storage={
      local:{get:async()=>{window.__extensionStorageReads++;return {courseByCourseCapture:{version:1,enabled}};}},
      onChanged:{addListener:()=>{}},
    };
    const runtime={sendMessage:async message=>{window.__extensionCaptures.push(message);return {ok:true};}};
    Object.assign(window.chrome||(window.chrome={}),{storage,runtime});
  },{enabled});
  const fixture=`<!doctype html><html><head><meta charset="utf-8"><title>Local Coursera DOM fixture</title></head><body>
    <header>Unrelated account header</header>
    <nav role="tablist"><button role="tab" aria-selected="${tab==='Completed'}">Completed</button><button role="tab" aria-selected="${tab==='In Progress'}">In Progress</button></nav>
    <main><h1>My Learning</h1><div role="tablist"><span>In Progress</span><span>Completed</span></div>${html}</main>
    <footer>Unrelated footer</footer></body></html>`;
  // Every request in this page is fulfilled locally or blocked. No real
  // Coursera session, account, HTML, API or extension installation is involved.
  await page.route('**/*',route=>route.request().isNavigationRequest()
    ?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture})
    :route.abort());
  const mode=tab==='Completed'?'COMPLETED':'IN_PROGRESS';
  await page.goto(`https://www.coursera.org/my-learning?myLearningTab=${mode}`);
  await page.addScriptTag({path:contentScript});
}

test('extension DOM fixture: built script captures only visible completed card despite grade and misleading tabs',async({page})=>{
  await useMockedLearningPage(page,{html:`
    <article><h2>Software Architecture</h2><p>University of Alberta</p><p>Grade: 67%</p><a href="/account/accomplishments/verify/FIXTURECERT123">View Certificate</a></article>
    <article hidden><h2>Object-Oriented Design</h2><p>Completed</p></article>
    <article style="display:none"><h2>Mastering Selenium WebDriver and Java Fundamentals</h2><p>Packt</p><p>82% complete</p></article>
    <input type="password" value="fixture-private-password"><textarea>fixture-private-notes</textarea>
  `});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const message=await page.evaluate(()=>window.__extensionCaptures[0]);
  expect(message.type).toBe('CAPTURE');
  expect(message.parsed.matches).toHaveLength(1);
  expect(message.parsed.matches[0]).toMatchObject({courseId:'U3',status:'done',certificateUrl:'https://www.coursera.org/account/accomplishments/verify/FIXTURECERT123'});
  expect(message.parsed.matches[0].percent).toBeUndefined();
  expect(message.parsed.ambiguous).toHaveLength(0);
  expect(JSON.stringify(message)).not.toContain('fixture-private');
});

test('extension DOM fixture: selected active list keeps real 67 percent and ignores completed navigation',async({page})=>{
  await useMockedLearningPage(page,{tab:'In Progress',html:`
    <nav><a>Completed</a><a>View Certificate</a></nav>
    <article><h2>Mastering Selenium WebDriver and Java Fundamentals</h2><p>Packt</p><p>67% complete</p></article>
  `});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const parsed=await page.evaluate(()=>window.__extensionCaptures[0].parsed);
  expect(parsed.matches).toHaveLength(1);
  expect(parsed.matches[0]).toMatchObject({courseId:'Q2',status:'active',percent:67});
  expect(parsed.ambiguous).toHaveLength(0);
});

test('extension DOM fixture: disabled capture never sends page results',async({page})=>{
  await useMockedLearningPage(page,{enabled:false,html:'<article><h2>Software Architecture</h2><p>Completed</p></article>'});
  await expect.poll(()=>page.evaluate(()=>window.__extensionStorageReads)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.__extensionCaptures)).toEqual([]);
});
