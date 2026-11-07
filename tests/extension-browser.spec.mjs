import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';

const contentScript=fileURLToPath(new URL('../build/extension/coursera-content.js',import.meta.url));

async function useMockedLearningPage(page,{enabled=true,tab='Completed',html='',withMain=true,tabsHTML=null,url=null,courses=undefined}){
  await page.addInitScript(({enabled,courses})=>{
    window.__extensionCaptures=[];
    window.__extensionStorageReads=0;
    const storage={
      local:{get:async()=>{window.__extensionStorageReads++;return {courseByCourseCapture:{version:1,enabled},...(Array.isArray(courses)?{courseByCourseCatalog:courses}:{})};}},
      onChanged:{addListener:()=>{}},
    };
    const runtime={sendMessage:async message=>{window.__extensionCaptures.push(message);return {ok:true};}};
    Object.assign(window.chrome||(window.chrome={}),{storage,runtime});
  },{enabled,courses});
  const fixture=`<!doctype html><html><head><meta charset="utf-8"><title>Local Coursera DOM fixture</title></head><body>
    <header>Unrelated account header</header>
    ${tabsHTML??`<nav role="tablist"><button role="tab" aria-selected="${tab==='Completed'}">Completed</button><button role="tab" aria-selected="${tab==='In Progress'}">In Progress</button></nav>`}
    <${withMain?'main':'div'}><h1>My Learning</h1><div role="tablist"><span>In Progress</span><span>Completed</span></div>${html}</${withMain?'main':'div'}>
    <footer>Unrelated footer</footer></body></html>`;
  // Every request in this page is fulfilled locally or blocked. No real
  // Coursera session, account, HTML, API or extension installation is involved.
  await page.route('**/*',route=>route.request().isNavigationRequest()
    ?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture})
    :route.abort());
  const mode=tab==='Completed'?'COMPLETED':'IN_PROGRESS';
  await page.goto(url||`https://www.coursera.org/my-learning?myLearningTab=${mode}`);
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

test('extension DOM fixture: completed href cards with inline labels and no main element are recognized',async({page})=>{
  await useMockedLearningPage(page,{withMain:false,tabsHTML:'<nav><a href="?myLearningTab=IN_PROGRESS">In Progress</a><a aria-current="page" href="?myLearningTab=COMPLETED">Завершённые</a></nav>',url:'https://www.coursera.org/my-learning?myLearningTab=IN_PROGRESS',html:`
    <article class="learning-card"><a href="/learn/software-architecture/home/welcome"><span>Continue to course: Software Architecture</span></a><span>University of Alberta</span><span>View Certificate · Share · 67% grade</span><a href="/account/accomplishments/verify/COMPLETEDFIXTURE123">Certificate</a></article>
    <article class="learning-card"><a href="/learn/object-oriented-design?utm_source=learning"><span>Object-Oriented Design — review</span></a><span>University of Alberta</span><button>View Certificate</button></article>
  `});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const parsed=await page.evaluate(()=>window.__extensionCaptures.at(-1).parsed);
  expect(parsed.matches).toEqual(expect.arrayContaining([expect.objectContaining({courseId:'U3',status:'done'}),expect.objectContaining({courseId:'U1',status:'done'})]));
  expect(parsed.matches.find(row=>row.courseId==='U3').certificateUrl).toBe('https://www.coursera.org/account/accomplishments/verify/COMPLETEDFIXTURE123');
  expect(parsed.diagnostics).toMatchObject({section:'done',matchedCount:2,resultStatus:'success'});
});

test('extension DOM fixture: actual ARIA progress is captured from a selected active href tab',async({page})=>{
  await useMockedLearningPage(page,{tab:'In Progress',tabsHTML:'<nav><a aria-current="page" href="?myLearningTab=IN_PROGRESS">В процессе</a><a href="?myLearningTab=COMPLETED">Завершённые</a></nav>',url:'https://www.coursera.org/my-learning',html:`
    <article><a href="/learn/golang-getting-started/home/welcome">Open course outline</a><span>University of California, Irvine</span><div role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="67"></div></article>
  `});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const parsed=await page.evaluate(()=>window.__extensionCaptures.at(-1).parsed);
  expect(parsed.matches).toHaveLength(1);
  expect(parsed.matches[0]).toMatchObject({courseId:'G1',status:'active',percent:67});
  expect(parsed.diagnostics.section).toBe('active');
});

test('extension DOM fixture: an unknown section never turns a visible course into completion',async({page})=>{
  await useMockedLearningPage(page,{tab:'',tabsHTML:'',url:'https://www.coursera.org/my-learning',html:'<article><a href="/learn/software-architecture">Software Architecture</a><span>University of Alberta</span></article>'});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const parsed=await page.evaluate(()=>window.__extensionCaptures.at(-1).parsed);
  expect(parsed.matches.some(row=>row.status==='done')).toBe(false);
  expect(parsed.diagnostics).toMatchObject({section:'mixed',resultStatus:'section-unknown'});
});

test('extension DOM fixture: a personal certificate attached to the exact course card confirms completion',async({page})=>{
  await useMockedLearningPage(page,{tab:'',tabsHTML:'',url:'https://www.coursera.org/my-learning',html:'<article><a href="/learn/software-architecture">Software Architecture</a><span>University of Alberta</span><a href="/account/accomplishments/verify/CARDPROOF123">View Certificate</a></article>'});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const parsed=await page.evaluate(()=>window.__extensionCaptures.at(-1).parsed);
  expect(parsed.matches).toEqual(expect.arrayContaining([expect.objectContaining({courseId:'U3',status:'done',certificateUrl:'https://www.coursera.org/account/accomplishments/verify/CARDPROOF123'})]));
});

test('extension DOM fixture: SPA navigation into completed learning starts capture',async({page})=>{
  await useMockedLearningPage(page,{url:'https://www.coursera.org/',html:'<article><a href="/learn/software-architecture">Software Architecture</a><span>University of Alberta</span></article>'});
  await page.evaluate(()=>{history.pushState({},'', '/my-learning?myLearningTab=COMPLETED');document.querySelector('article').append(document.createElement('span'));});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const parsed=await page.evaluate(()=>window.__extensionCaptures.at(-1).parsed);
  expect(parsed.matches).toEqual(expect.arrayContaining([expect.objectContaining({courseId:'U3',status:'done'})]));
});

test('extension DOM fixture: a course added through the local Excel catalog is recognized as completed',async({page})=>{
  await useMockedLearningPage(page,{courses:[{id:'local-fixture-network',title:'Network Defense Basics',url:'https://www.coursera.org/learn/network-defense-basics',kind:'course',subjects:['SEC']}],html:'<article><a href="/learn/network-defense-basics/home/welcome">Open course outline</a><span>View Certificate</span></article>'});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const parsed=await page.evaluate(()=>window.__extensionCaptures.at(-1).parsed);
  expect(parsed.matches).toHaveLength(1);
  expect(parsed.matches[0]).toMatchObject({courseId:'local-fixture-network',status:'done'});
});

test('extension DOM discovery: an unknown completed course becomes stable local metadata without a starter catalog',async({page})=>{
  await useMockedLearningPage(page,{courses:[],html:'<article><h3><a href="/learn/personal-linear-algebra/home/welcome?utm_source=my-learning">Personal Linear Algebra</a></h3><span>Example University</span><a href="/account/accomplishments/verify/DISCOVEREDCOMPLETE123">View Certificate</a></article>'});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const parsed=await page.evaluate(()=>window.__extensionCaptures.at(-1).parsed);
  expect(parsed.courses).toHaveLength(1);
  expect(parsed.courses[0]).toMatchObject({title:'Personal Linear Algebra',url:'https://coursera.org/learn/personal-linear-algebra',kind:'course',subjects:[],inPlan:false});
  expect(parsed.courses[0].id).toMatch(/^local-[a-f0-9]{16}$/);
  expect(parsed.matches).toEqual(expect.arrayContaining([expect.objectContaining({courseId:parsed.courses[0].id,status:'done',certificateUrl:'https://www.coursera.org/account/accomplishments/verify/DISCOVEREDCOMPLETE123'})]));
});

test('extension DOM discovery: an unknown active course keeps its actual 67 percent',async({page})=>{
  await useMockedLearningPage(page,{courses:[],tab:'In Progress',html:'<article><h3><a href="/learn/personal-observability-foundations">Personal Observability Foundations</a></h3><span>Example University</span><div role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="67"></div></article>'});
  await expect.poll(()=>page.evaluate(()=>window.__extensionCaptures.length)).toBeGreaterThan(0);
  const parsed=await page.evaluate(()=>window.__extensionCaptures.at(-1).parsed);
  expect(parsed.courses).toHaveLength(1);expect(parsed.courses[0].title).toBe('Personal Observability Foundations');
  expect(parsed.matches).toEqual(expect.arrayContaining([expect.objectContaining({courseId:parsed.courses[0].id,status:'active',percent:67})]));
});

test('extension popup fixture: consent, no-match diagnostics, completed counters and theme remain clear',async({page})=>{
  await page.setViewportSize({width:360,height:740});
  await page.emulateMedia({colorScheme:'light'});
  await page.addInitScript(()=>{
    let state={version:1,enabled:false,rows:[],checkedAt:null,capturedAt:null,diagnostics:{section:'mixed',matchedCount:0}};
    const listeners=[];
    const emit=()=>listeners.forEach(fn=>fn({courseByCourseCapture:{newValue:state}},'local'));
    window.__setPopupState=next=>{state={...state,...next};emit();};
    const runtime={sendMessage:async({type})=>{
      if(type==='ENABLE')state={...state,enabled:true};
      if(type==='DISCONNECT')state={version:1,enabled:false,rows:[],checkedAt:null,capturedAt:null,diagnostics:{}};
      return {ok:true,payload:state};
    }};
    const storage={local:{set:async()=>{setTimeout(()=>{state={...state,checkedAt:new Date().toISOString(),diagnostics:{section:'done',visibleCards:0,matchedCount:0,resultStatus:'empty',message:'На странице пока нет загруженных курсов. Откройте «Завершённые» и загрузите список.'}};emit();},50);}},onChanged:{addListener:fn=>listeners.push(fn)}};
    Object.assign(window.chrome||(window.chrome={}),{runtime,storage});
  });
  await page.route('https://extension-fixture.test/**',async route=>{
    const name=new URL(route.request().url()).pathname.slice(1);
    if(!['popup.html','popup.css','popup.js','logo.svg'].includes(name))return route.abort();
    const type={html:'text/html; charset=utf-8',css:'text/css',js:'text/javascript',svg:'image/svg+xml'}[name.split('.').at(-1)];
    try{await route.fulfill({status:200,contentType:type,body:await readFile(new URL('../build/extension/'+name,import.meta.url))});}catch{await route.abort();}
  });
  await page.goto('https://extension-fixture.test/popup.html');
  await expect(page.locator('#settings')).toHaveAttribute('open','');
  await page.locator('#enable').click();
  await expect(page.locator('#status')).toContainText('разрешение');
  await expect(page.locator('#refresh')).toBeHidden();
  await page.locator('#consent').check();await page.locator('#enable').click();
  await expect(page.locator('#refresh')).toBeVisible();
  await page.locator('#refresh').click();
  await expect(page.locator('#detail')).toContainText('пока нет загруженных курсов');
  await expect(page.locator('#refresh')).toBeEnabled();
  await expect(page.locator('#completed-count')).toHaveText('0');
  await page.evaluate(()=>window.__setPopupState({rows:[{courseId:'U3',status:'done'},{courseId:'U1',status:'done'},{courseId:'Q2',status:'active',percent:67}],checkedAt:new Date().toISOString(),diagnostics:{section:'done',matchedCount:2,resultStatus:'success',message:'Найдены завершённые курсы. Результаты переданы трекеру.'}}));
  await expect(page.locator('#completed-count')).toHaveText('2');
  await expect(page.locator('#active-count')).toHaveText('1');
  await expect(page.locator('#total-count')).toHaveText('3');
  await expect(page.locator('#section')).toHaveText('Завершённые');
  await expect.poll(()=>page.locator('.brand img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/extension-popup-light.png',animations:'disabled'});
  await page.emulateMedia({colorScheme:'dark'});
  await page.screenshot({path:'test-results/extension-popup-dark.png',animations:'disabled'});
  await page.locator('#settings summary').click();await page.locator('#disconnect').click();
  await expect(page.locator('#completed-count')).toHaveText('0');
  await expect(page.locator('#refresh')).toBeHidden();
  await expect(page.locator('#consent')).not.toBeChecked();
});
