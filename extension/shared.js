import {certificateURL,mergeRecord,normalize,validDate} from '../src/core.js';

export const CHANNEL='course-by-course';
export const STORAGE_KEY='courseByCourseCapture';
export const SOURCE='Расширение браузера · видимая страница Coursera';
export const TRACKER_ORIGIN='https://rumm1.github.io';
export const TRACKER_PATH='/aitu-course-tracker/';

export function isCourseraLearningURL(input){
  try{const url=new URL(input);return url.protocol==='https:'&&url.hostname==='www.coursera.org'&&/^\/my-learning\/?$/.test(url.pathname);}catch{return false;}
}
export function isTrackerURL(input){
  try{const url=new URL(input);return url.origin===TRACKER_ORIGIN&&url.pathname.startsWith(TRACKER_PATH);}catch{return false;}
}
export function inferLearningMode(tabText='',input=''){
  const label=normalize(tabText);
  if(/^(completed|завершенные|завершённые|пройденные)(?: \d+)?$/.test(label))return 'done';
  if(/^(in progress|в процессе|в работе)(?: \d+)?$/.test(label))return 'active';
  try{const url=new URL(input);const tab=normalize(url.searchParams.get('myLearningTab')||'').replace(/ /g,'');if(['completed','complete','finished'].includes(tab))return 'done';if(['inprogress','current','active'].includes(tab))return 'active';}catch{}
  return 'mixed';
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
  const byId=new Map();
  for(const row of previous.rows||[]){const clean=sanitizeCaptureRow(row,catalog);if(clean)byId.set(clean.courseId,clean);}
  for(const row of parsed.matches||[]){
    const clean=sanitizeCaptureRow(row,catalog);if(!clean)continue;
    const old=byId.get(clean.courseId),next=mergeRecord(old||{},clean).next;
    byId.set(clean.courseId,sanitizeCaptureRow({...next,courseId:clean.courseId},catalog));
  }
  const rows=[...byId.values()].sort((a,b)=>a.courseId.localeCompare(b.courseId));
  const ambiguousMap=new Map((previous.ambiguous||[]).map(row=>[normalize(row.title)+'|'+(row.candidates||[]).join(','),row]));
  for(const row of parsed.ambiguous||[]){
    const candidates=(row.candidates||[]).filter(id=>catalog.some(c=>c.id===id));
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
  const signature=JSON.stringify({rows,ambiguous});
  const changed=signature!==previous.signature;
  return {version:1,enabled:true,rows,ambiguous,unmatched,signature,revision:changed?at:previous.revision||at,capturedAt:changed?at:previous.capturedAt||at,checkedAt:at,source:SOURCE};
}

export function publicCapture(state={}){
  const enabled=state.enabled===true;
  return {version:1,enabled,rows:enabled?state.rows||[]:[],ambiguous:enabled?state.ambiguous||[]:[],unmatched:enabled?state.unmatched||[]:[],capturedAt:enabled?state.capturedAt||null:null,checkedAt:enabled?state.checkedAt||null:null,revision:enabled?state.revision||null:null,source:SOURCE};
}

export function readLearningDocument(doc,input){
  if(!isCourseraLearningURL(input))return {text:'',mode:'mixed'};
  const tab=doc.querySelector('[role="tab"][aria-selected="true"]');
  const mode=inferLearningMode(tab?.textContent||'',input);
  const root=doc.querySelector('main, [role="main"]');
  if(!root)return {text:'',mode};
  const blocks=new Set(['DIV','P','LI','UL','OL','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','TR','TD']);
  const excluded=new Set(['SCRIPT','STYLE','NOSCRIPT','NAV','HEADER','FOOTER','INPUT','TEXTAREA','SELECT']);
  function walk(node){
    if(node.nodeType===3)return node.textContent||'';
    if(node.nodeType!==1)return '';
    const tag=node.tagName;
    if(excluded.has(tag)||node.hidden||node.hasAttribute('inert')||node.getAttribute('aria-hidden')==='true'||['tablist','navigation','menu','menubar'].includes(node.getAttribute('role')))return '';
    const style=doc.defaultView?.getComputedStyle(node);
    if(style&&(style.display==='none'||style.visibility==='hidden'))return '';
    if(tag==='BR')return '\n';
    let value=Array.from(node.childNodes).map(walk).join(' ');
    if(tag==='A'){
      let href='';try{href=new URL(node.getAttribute('href')||'',input).href;}catch{}
      if(/^https:\/\/(?:www\.)?coursera\.org\/(?:account\/)?(?:verify|accomplishments\/)/i.test(href))value+='\n'+href+'\n';
    }
    return blocks.has(tag)?'\n'+value+'\n':value;
  }
  const heading=mode==='done'?'Completed\n':mode==='active'?'In Progress\n':'';
  return {text:(heading+walk(root)).replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').slice(0,500000),mode};
}
