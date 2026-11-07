import {certificateURL,courseURL,mergeRecord,normalize,validDate} from '../src/core.js';
import {parseProgressText} from '../src/progress-import.js';
import {validateLocalCourses} from '../src/local-catalog.js';
import bundledCatalog from '../src/catalog.json' with {type:'json'};
import {canonicalCourseURL,localCourseId} from '../src/course-identity.js';

export const CHANNEL='course-by-course';
export const STORAGE_KEY='courseByCourseCapture';
export const CATALOG_KEY='courseByCourseCatalog';
export const SOURCE='Расширение браузера · видимая страница Coursera';
export const TRACKER_URL=typeof __TRACKER_URL__!=='undefined'?__TRACKER_URL__:'https://rumm1.github.io/aitu-course-tracker/';
const trackerAddress=new URL(TRACKER_URL);
export const TRACKER_ORIGIN=trackerAddress.origin;
export const TRACKER_PATH=trackerAddress.pathname;
export const DEFAULT_CURATED=TRACKER_URL==='https://rumm1.github.io/aitu-course-tracker/';

export function isCourseraLearningURL(input){
  try{const url=new URL(input);return url.protocol==='https:'&&url.hostname==='www.coursera.org'&&/^\/my-learning\/?$/.test(url.pathname);}catch{return false;}
}
export function isTrackerURL(input){
  try{const url=new URL(input);return url.origin===TRACKER_ORIGIN&&url.pathname.startsWith(TRACKER_PATH);}catch{return false;}
}
export function canSetCaptureCatalog(sender,extensionId){
  return !!extensionId&&sender?.id===extensionId&&isTrackerURL(sender?.url||'');
}
export function validateCaptureCourses(value=[]){
  if(!Array.isArray(value)||value.length>6000)throw Error('Неверный каталог расширения');
  const seen=new Set(),local=[],trusted=new Map(bundledCatalog.map(course=>[course.id,course]));
  for(const item of value){
    if(!item||typeof item!=='object'||typeof item.id!=='string'||seen.has(item.id))throw Error('Неверный или повторный ID курса');
    seen.add(item.id);
    if(item.id.startsWith('local-'))local.push(item);
    else {
      const original=trusted.get(item.id);
      if(!original||item.kind!==original.kind||courseURL(item.url)!==courseURL(original.url))throw Error('Запись базового курса не совпадает с доверенным каталогом');
    }
  }
  const localById=new Map(validateLocalCourses(local).map(course=>[course.id,course]));
  return value.map(item=>{
    const course=localById.get(item.id)||trusted.get(item.id);
    const result={id:course.id,title:course.title,url:course.url,kind:course.kind,subjects:course.subjects};
    if(course.provider)result.provider=course.provider;
    if(course.also?.length)result.also=course.also;
    return result;
  });
}
export function getCaptureCatalog(stored={}){
  const registered=Object.hasOwn(stored,CATALOG_KEY)?validateCaptureCourses(stored[CATALOG_KEY]):DEFAULT_CURATED?bundledCatalog:[];
  return combineCaptureCatalog(registered,stored[STORAGE_KEY]?.courses||[]);
}
function courseKey(course){return canonicalCourseURL(course.url)+'|'+course.kind;}
export function combineCaptureCatalog(registered=[],discovered=[]){
  const result=[...registered],identities=new Set(result.map(courseKey)),ids=new Set(result.map(course=>course.id));
  for(const course of validateLocalCourses(discovered)){
    const key=courseKey(course);if(identities.has(key)||ids.has(course.id))continue;
    result.push(course);identities.add(key);ids.add(course.id);
  }
  return result;
}
export function mergeDiscoveredCourses(previous=[],incoming=[]){
  const map=new Map();
  for(const course of [...validateLocalCourses(previous),...validateLocalCourses(incoming)]){
    const key=courseKey(course);if(map.has(key))continue;
    map.set(key,{...course,subjects:[],inPlan:false,sources:['COURSERA'],subjectSource:'unassigned'});
  }
  if(map.size>5000)throw Error('Слишком много курсов в истории расширения');
  return [...map.values()];
}
export function inferLearningMode(tabText='',input=''){
  const label=normalize(tabText).replace(/ё/g,'е').replace(/\s*\d+\s*$/,'').trim();
  if(/^(completed|complete|finished|завершенные|завершено|завершен|пройденные|пройдено)$/.test(label))return 'done';
  if(/^(in progress|inprogress|в процессе|в работе|current)$/.test(label))return 'active';
  try{const url=new URL(input);const tab=normalize(url.searchParams.get('myLearningTab')||url.searchParams.get('tab')||'').replace(/ /g,'');if(['completed','complete','finished'].includes(tab))return 'done';if(['inprogress','current','active'].includes(tab))return 'active';}catch{}
  return 'mixed';
}

export function courseIdentity(input,base='https://www.coursera.org'){
  try{
    const url=new URL(input,base);
    if(url.protocol!=='https:'||!['coursera.org','www.coursera.org'].includes(url.hostname))return null;
    const match=url.pathname.match(/^\/(learn|specializations|professional-certificates|projects)\/([^/]+)/i);
    return match?match[1].toLowerCase()+':'+decodeURIComponent(match[2]).toLowerCase():null;
  }catch{return null;}
}

const EXCLUDED=new Set(['SCRIPT','STYLE','NOSCRIPT','NAV','HEADER','FOOTER','FORM','INPUT','TEXTAREA','SELECT']);
const BLOCKS=new Set(['DIV','P','LI','UL','OL','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','TR','TD','MAIN']);
const RECOMMENDED=/^(?:recommended(?:\s+(?:for\s+you|courses))?|recommendations|you\s+might\s+(?:also\s+)?like|related\s+courses|похожие\s+курсы|рекомендации|рекомендуем(?:ые|\s+вам)?|вам\s+может\s+понравиться)$/i;
function elements(root,selector){return root?.querySelectorAll?Array.from(root.querySelectorAll(selector)):[];}
function attribute(node,name){return node?.getAttribute?.(name)||'';}
function visible(node,doc,root){
  for(let current=node;current&&current!==root?.parentElement;current=current.parentElement){
    if(EXCLUDED.has(current.tagName)||current.hidden||current.hasAttribute?.('inert')||attribute(current,'aria-hidden')==='true'||['tablist','navigation','menu','menubar'].includes(attribute(current,'role')))return false;
    const style=doc.defaultView?.getComputedStyle?.(current);
    if(style&&(style.display==='none'||['hidden','collapse'].includes(style.visibility)))return false;
  }
  return true;
}
function recommendation(node,root){
  for(let current=node;current&&current!==root;current=current.parentElement){
    if(/recommend|related-course/i.test(attribute(current,'aria-label')+' '+attribute(current,'data-testid')))return true;
    const first=Array.from(current.children||[]).find(child=>/^H[1-6]$/.test(child.tagName)||attribute(child,'role')==='heading');
    if(first&&RECOMMENDED.test(String(first.textContent||'').trim()))return true;
    for(let previous=current.previousElementSibling;previous;previous=previous.previousElementSibling){
      if(/^H[1-6]$/.test(previous.tagName)||attribute(previous,'role')==='heading')return RECOMMENDED.test(String(previous.textContent||'').trim());
    }
  }
  return false;
}
function selectedMode(doc,input){
  const selected=doc.querySelector?.('[role="tab"][aria-selected="true"]');
  const primary=inferLearningMode(selected?.textContent||'');
  if(primary!=='mixed')return primary;
  for(const node of elements(doc,'[aria-current="page"], [aria-pressed="true"], [data-state="active"], [data-selected="true"]')){
    let href='';try{if(attribute(node,'href'))href=new URL(attribute(node,'href'),input).href;}catch{}
    const mode=inferLearningMode(node.textContent||'',href);
    if(mode!=='mixed')return mode;
  }
  return inferLearningMode('',input);
}
function readVisibleText(node,doc,input){
  function walk(current){
    if(current.nodeType===3)return current.textContent||'';
    if(current.nodeType!==1||!visible(current,doc,node))return '';
    if(current.tagName==='BR')return '\n';
    let value=Array.from(current.childNodes||[]).map(walk).join(' ');
    if(attribute(current,'role')==='progressbar'){
      const now=Number(attribute(current,'aria-valuenow')),min=attribute(current,'aria-valuemin'),max=attribute(current,'aria-valuemax');
      if(attribute(current,'aria-valuenow')&&Number.isFinite(now)&&(min===''||Number(min)===0)&&(max===''||Number(max)===100)&&now>=0&&now<=100)value+='\n'+now+'%\n';
    }
    if(current.tagName==='PROGRESS'){
      const valueAttribute=attribute(current,'value'),maxAttribute=attribute(current,'max')||'1';
      const valueNumber=Number(valueAttribute),maxNumber=Number(maxAttribute);
      if(valueAttribute!==''&&maxNumber>0&&Number.isFinite(maxNumber)&&Number.isFinite(valueNumber)&&valueNumber>=0&&valueNumber<=maxNumber)value+='\n'+Math.round(valueNumber/maxNumber*1000)/10+'%\n';
    }
    if(current.tagName==='A'){
      let href='';try{href=new URL(attribute(current,'href'),input).href;}catch{}
      if(/^https:\/\/(?:www\.)?coursera\.org\/(?:account\/)?(?:verify|accomplishments\/)/i.test(href))value+='\n'+href+'\n';
    }
    return BLOCKS.has(current.tagName)||attribute(current,'role')==='heading'?'\n'+value+'\n':value;
  }
  return walk(node).replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').slice(0,500000);
}
function cardScope(node,root,doc){
  let best=node;
  for(let current=node.parentElement;current&&current!==root;current=current.parentElement){
    if(!visible(current,doc,root))break;
    const identities=new Set(elements(current,'a[href]').map(link=>courseIdentity(attribute(link,'href'))).filter(Boolean));
    const headings=elements(current,'h1,h2,h3,h4,h5,h6,[role="heading"]').filter(heading=>visible(heading,doc,root));
    if(identities.size>1||headings.length>1)break;
    best=current;
    if(['ARTICLE','LI'].includes(current.tagName)||attribute(current,'role')==='listitem')break;
  }
  return best;
}
function discoverCardCourse(link,scope,doc,input){
  let href='';try{href=new URL(attribute(link,'href'),input).href;}catch{return null;}
  const identity=courseIdentity(href,input),url=canonicalCourseURL(href);if(!identity||!url)return null;
  const type=identity.split(':')[0],kind={learn:'course',projects:'project',specializations:'specialization','professional-certificates':'professional-certificate'}[type];
  const headings=elements(scope,'h1,h2,h3,h4,h5,h6,[role="heading"]').filter(node=>visible(node,doc,scope));
  const candidates=[...headings.map(node=>readVisibleText(node,doc,input)),readVisibleText(link,doc,input),attribute(link,'aria-label')];
  let title='';
  for(const value of candidates){
    const clean=String(value||'').replace(/\s+/g,' ').trim().replace(/^(?:go to course|open course|перейти к курсу|открыть курс)\s*[:—-]\s*/i,'');
    if(clean.length<2||clean.length>700||/^(?:course|view course|open course|go to course|continue|continue learning|resume|view certificate|completed|in progress|курс|открыть курс|продолжить|сертификат|завершено|в процессе|my learning|мо[её] обучение)$/i.test(clean)||!/[\p{L}]/u.test(clean))continue;
    title=clean;break;
  }
  if(!title||!kind)return null;
  const candidate={id:localCourseId(url,kind),title,url,kind,subjects:[],inPlan:false,sources:['COURSERA'],subjectSource:'unassigned'};
  const provider=elements(scope,'[data-testid*="partner"],[data-e2e*="partner"],[class*="partner"],[class*="provider"]').find(node=>visible(node,doc,scope));
  const providerText=provider?readVisibleText(provider,doc,input).replace(/\s+/g,' ').trim():'';
  if(providerText&&providerText.length<=300&&!providerText.includes('@')&&normalize(providerText)!==normalize(title))candidate.provider=providerText;
  return mergeDiscoveredCourses([],[candidate])[0];
}

export function readLearningCards(doc,input,catalog){
  const empty=(resultStatus,message,section='mixed',visibleCards=0)=>({matches:[],courses:[],ambiguous:[],unmatched:[],warnings:[],diagnostics:{section,visibleCards,matchedCount:0,resultStatus,message}});
  if(!isCourseraLearningURL(input))return empty('not-learning','Откройте «Моё обучение» Coursera.');
  const root=doc.querySelector?.('main, [role="main"]')||doc.body;
  const mode=selectedMode(doc,input);
  if(!root)return empty('empty','Список пока не загружен. Дождитесь курсов на странице.',mode);
  const captureCatalog=[...catalog],discoveries=new Map(),byIdentity=new Map();
  const byTitle=new Map();
  for(const course of catalog){
    const identity=courseIdentity(course.url);if(identity){const bucket=byIdentity.get(identity)||[];bucket.push(course);byIdentity.set(identity,bucket);}
    for(const title of [course.title,...course.also||[]]){const key=normalize(title),bucket=byTitle.get(key)||[];if(!bucket.some(c=>c.id===course.id))bucket.push(course);byTitle.set(key,bucket);}
  }
  const units=new Map();
  const visibleIdentities=new Set();
  for(const link of elements(root,'a[href]')){
    if(!visible(link,doc,root)||recommendation(link,root))continue;
    const identity=courseIdentity(attribute(link,'href'),input);if(!identity)continue;
    visibleIdentities.add(identity);
    const scope=cardScope(link,root,doc);
    let courses=byIdentity.get(identity);
    if(!courses){
      const discovered=discoverCardCourse(link,scope,doc,input);if(!discovered)continue;
      discoveries.set(discovered.id,discovered);captureCatalog.push(discovered);courses=[discovered];byIdentity.set(identity,courses);byTitle.set(normalize(discovered.title),courses);
    }
    const key=courses.map(c=>c.id).join('|');
    if(!units.has(scope))units.set(scope,new Map());units.get(scope).set(key,courses);
  }
  for(const heading of elements(root,'h1,h2,h3,h4,h5,h6,[role="heading"],a')){
    if(!visible(heading,doc,root)||recommendation(heading,root))continue;
    const courses=byTitle.get(normalize(heading.textContent||''));if(!courses)continue;
    const scope=cardScope(heading,root,doc),key=courses.map(c=>c.id).join('|');
    if(!units.has(scope))units.set(scope,new Map());units.get(scope).set(key,courses);
  }
  const rows=new Map(),ambiguous=[];
  for(const [scope,groups]of units){
    const text=readVisibleText(scope,doc,input);
    for(const courses of groups.values()){
      // Canonical title is supplied from an exact visible href/heading match;
      // noisy buttons or badges on the same card cannot invalidate that match.
      const heading=mode==='done'?'Completed\n':mode==='active'?'In Progress\n':'';
      const evidence=text.replace(/(?:^|\n)[^\n]*(?:grade|score|оценка|балл)[^\n]*%[^\n]*(?=\n|$)/giu,'\n');
      const parsed=parseProgressText(heading+courses[0].title+'\n'+evidence,courses,{mode});
      if(courses.length===1){
        const urls=[...new Set(elements(scope,'a[href]').filter(link=>visible(link,doc,root)).map(link=>{try{return new URL(attribute(link,'href'),input).href;}catch{return '';}}).map(url=>certificateURL(url,courses[0])).filter(Boolean))];
        // An actual personal certificate URL on this exact course card is
        // completion evidence even when Coursera exposes no selected-tab ARIA.
        if(urls.length===1){parsed.matches=[{courseId:courses[0].id,title:courses[0].title,status:'done',certificateUrl:urls[0]}];parsed.ambiguous=[];}
      }
      for(const row of parsed.matches){
        const course=captureCatalog.find(c=>c.id===row.courseId);
        const urls=[...new Set(elements(scope,'a[href]').filter(link=>visible(link,doc,root)).map(link=>{try{return new URL(attribute(link,'href'),input).href;}catch{return '';}}).map(url=>certificateURL(url,course)).filter(Boolean))];
        if(urls.length===1){row.certificateUrl=urls[0];row.status='done';delete row.percent;}
        const old=rows.get(row.courseId);rows.set(row.courseId,{...mergeRecord(old||{},row).next,courseId:row.courseId,title:course.title});
      }
      ambiguous.push(...parsed.ambiguous);
    }
  }
  // Old layouts sometimes expose titles as plain text rather than links or
  // headings. Keep the conservative exact text parser as a fallback.
  if(!units.size){
    const visible=readLearningDocument(doc,input),parsed=parseProgressText(visible.text,captureCatalog,{mode});
    for(const row of parsed.matches)rows.set(row.courseId,row);
    ambiguous.push(...parsed.ambiguous);
  }
  const uniqueAmbiguous=[...new Map(ambiguous.filter(row=>!rows.has(row.candidates?.[0])||row.candidates.length>1).map(row=>[normalize(row.title)+'|'+row.candidates.join(','),row])).values()];
  const semanticCards=elements(root,'article,[role="listitem"],li,[data-testid*="course-card"],[data-e2e*="course-card"]').filter(node=>visible(node,doc,root)&&!recommendation(node,root)&&elements(node,'h1,h2,h3,h4,h5,h6,[role="heading"],a[href]').length);
  const matches=[...rows.values()],visibleCards=Math.max(visibleIdentities.size,units.size,semanticCards.length,matches.length+uniqueAmbiguous.length);
  const resultStatus=matches.length?'success':uniqueAmbiguous.length?'section-unknown':visibleCards?'no-matches':'empty';
  const message=matches.length?`Найдено ${matches.length} курсов в отображённом списке.`:uniqueAmbiguous.length?'Выберите раздел «Завершённые» или «В процессе», чтобы определить статус.':visibleCards?'Курсы отображаются, но точных совпадений в каталоге пока нет.':'Список пока не загружен. Откройте раздел с курсами и дождитесь карточек.';
  return {matches,courses:[...discoveries.values()],ambiguous:uniqueAmbiguous,unmatched:[],warnings:[],diagnostics:{section:mode,visibleCards,matchedCount:matches.length,resultStatus,message}};
}

export function sanitizeCaptureRow(row,catalog){
  const course=catalog.find(c=>c.id===row?.courseId);
  if(!course||!['active','done'].includes(row.status))return null;
  const result={courseId:course.id,status:row.status};
  if(row.status==='active'){
    if(typeof row.percent==='number'&&Number.isFinite(row.percent)&&row.percent>=0&&row.percent<=100)result.percent=row.percent;
    if(Number.isSafeInteger(row.completedTasks)&&Number.isSafeInteger(row.totalTasks)&&row.totalTasks>0&&row.completedTasks>=0&&row.completedTasks<=row.totalTasks){result.completedTasks=row.completedTasks;result.totalTasks=row.totalTasks;}
    if(['tasks','percent','по заданиям'].includes(row.progressSource))result.progressSource=row.progressSource;
  }
  if(row.certificateUrl){const url=certificateURL(row.certificateUrl,course);if(url)result.certificateUrl=url;}
  if(validDate(row.completedAt))result.completedAt=row.completedAt;
  return result;
}

export function mergeCapture(previous={},parsed={},at,catalog){
  const courses=mergeDiscoveredCourses(previous.courses||[],parsed.courses||[]);
  const effective=combineCaptureCatalog(catalog,courses);
  const metadata=new Map(courses.map(course=>[course.id,course]));
  const effectiveIds=new Set(effective.map(course=>course.id)),byURL=new Map(effective.map(course=>[courseKey(course),course]));
  function aligned(row){
    if(effectiveIds.has(row?.courseId))return row;
    const original=metadata.get(row?.courseId),replacement=original&&byURL.get(courseKey(original));
    return replacement?{...row,courseId:replacement.id}:row;
  }
  const byId=new Map();
  for(const row of previous.rows||[]){const clean=sanitizeCaptureRow(aligned(row),effective);if(clean)byId.set(clean.courseId,sanitizeCaptureRow({...mergeRecord(byId.get(clean.courseId)||{},clean).next,courseId:clean.courseId},effective));}
  for(const row of parsed.matches||[]){
    const clean=sanitizeCaptureRow(aligned(row),effective);if(!clean)continue;
    const old=byId.get(clean.courseId),next=mergeRecord(old||{},clean).next;
    byId.set(clean.courseId,sanitizeCaptureRow({...next,courseId:clean.courseId},effective));
  }
  const rows=[...byId.values()].sort((a,b)=>a.courseId.localeCompare(b.courseId));
  const ambiguousMap=new Map((previous.ambiguous||[]).map(row=>[normalize(row.title)+'|'+(row.candidates||[]).join(','),row]));
  for(const row of parsed.ambiguous||[]){
    const candidates=[...new Set((row.candidates||[]).map(id=>aligned({courseId:id}).courseId).filter(id=>effectiveIds.has(id)))];
    if(!candidates.length)continue;
    const clean={title:String(row.title||'').slice(0,500),candidates,status:['done','active'].includes(row.status)?row.status:undefined};
    if(typeof row.percent==='number'&&row.percent>=0&&row.percent<=100)clean.percent=row.percent;
    ambiguousMap.set(normalize(clean.title)+'|'+candidates.join(','),clean);
  }
  // If a later visible card identifies one exact variant, that title no longer
  // needs a separate ambiguous selection.
  for(const [key,row]of ambiguousMap)if((parsed.matches||[]).some(match=>normalize(match.title)===normalize(row.title)))ambiguousMap.delete(key);
  const ambiguous=[...ambiguousMap.values()].slice(0,150);
  // Unknown page lines may contain unrelated account information. Only exact
  // catalog titles and their ambiguous variants are retained by the extension.
  const unmatched=[];
  const signature=JSON.stringify({rows,ambiguous,courses});
  const changed=signature!==previous.signature;
  const inputDiagnostics=parsed.diagnostics||{};
  const diagnostics={section:['done','active','mixed'].includes(inputDiagnostics.section)?inputDiagnostics.section:'mixed',visibleCards:Number.isSafeInteger(inputDiagnostics.visibleCards)?Math.max(0,inputDiagnostics.visibleCards):0,matchedCount:Number.isSafeInteger(inputDiagnostics.matchedCount)?Math.max(0,inputDiagnostics.matchedCount):(parsed.matches||[]).length,resultStatus:['success','no-matches','empty','section-unknown','not-learning','error'].includes(inputDiagnostics.resultStatus)?inputDiagnostics.resultStatus:(parsed.matches||[]).length?'success':'empty',message:String(inputDiagnostics.message||'').slice(0,500),checkedAt:at};
  return {version:1,enabled:true,rows,courses,ambiguous,unmatched,signature,revision:changed?at:previous.revision||at,capturedAt:changed?at:previous.capturedAt||at,checkedAt:at,diagnostics,source:SOURCE};
}

export function publicCapture(state={}){
  const enabled=state.enabled===true;
  const courses=enabled?state.courses||[]:[],metadata=new Map(courses.map(course=>[course.id,course]));
  const rows=enabled?(state.rows||[]).map(row=>{const course=metadata.get(row.courseId);return course?{...row,url:course.url,kind:course.kind}:row;}):[];
  return {version:1,enabled,rows,courses,ambiguous:enabled?state.ambiguous||[]:[],unmatched:enabled?state.unmatched||[]:[],capturedAt:enabled?state.capturedAt||null:null,checkedAt:enabled?state.checkedAt||null:null,revision:enabled?state.revision||null:null,diagnostics:enabled?state.diagnostics||null:null,source:SOURCE};
}

export function readLearningDocument(doc,input){
  if(!isCourseraLearningURL(input))return {text:'',mode:'mixed'};
  const mode=selectedMode(doc,input);
  const root=doc.querySelector('main, [role="main"]')||doc.body;
  if(!root)return {text:'',mode};
  const heading=mode==='done'?'Completed\n':mode==='active'?'In Progress\n':'';
  return {text:(heading+readVisibleText(root,doc,input)).slice(0,500000),mode};
}
