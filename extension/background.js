import {STORAGE_KEY,CATALOG_KEY,isCourseraLearningURL,canSetCaptureCatalog,validateCaptureCourses,getCaptureCatalog,mergeCapture,publicCapture} from './shared.js';
import {canonicalCourseURL} from '../src/course-identity.js';

let queue=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return false;
  const popup=sender.url===chrome.runtime.getURL('popup.html');
  let courseraSender=false;try{const url=new URL(sender.url||'');courseraSender=url.protocol==='https:'&&url.hostname==='www.coursera.org';}catch{}
  // sender.url may retain the document's initial URL after SPA routing. The
  // isolated content script supplies its current URL; both must be Coursera.
  const learning=isCourseraLearningURL(sender.url||'')||courseraSender&&isCourseraLearningURL(message?.pageUrl||'');
  if(message?.type==='CAPTURE'&&!learning)return false;
  if(message?.type==='SET_CATALOG'&&!canSetCaptureCatalog(sender,chrome.runtime.id))return false;
  if(['ENABLE','DISCONNECT'].includes(message?.type)&&!popup)return false;
  if(!['CAPTURE','ENABLE','DISCONNECT','GET_STATE','SET_CATALOG'].includes(message?.type))return false;
  queue=queue.catch(()=>{}).then(async()=>{
    const stored=await chrome.storage.local.get([STORAGE_KEY,CATALOG_KEY]);
    const current=stored[STORAGE_KEY]||{};
    if(message.type==='ENABLE'){
      await chrome.storage.local.set({[STORAGE_KEY]:{...current,enabled:true,diagnostics:current.diagnostics||{section:'mixed',visibleCards:0,matchedCount:0,resultStatus:'waiting',message:'Откройте «Моё обучение» и раздел с курсами.'}},refreshRequestedAt:Date.now()});
      return publicCapture({...current,enabled:true});
    }
    if(message.type==='DISCONNECT'){
      await chrome.storage.local.set({[STORAGE_KEY]:{version:1,enabled:false,rows:[],courses:[],ambiguous:[],unmatched:[]},[CATALOG_KEY]:[]});
      return publicCapture({enabled:false});
    }
    if(message.type==='SET_CATALOG'){
      const courses=validateCaptureCourses(message.courses);
      if(!current.enabled)return publicCapture(current);
      const effective=getCaptureCatalog({...stored,[CATALOG_KEY]:courses});
      const allowed=new Set(effective.map(course=>course.id)),byURL=new Map(effective.map(course=>[canonicalCourseURL(course.url)+'|'+course.kind,course]));
      const discovered=new Map((current.courses||[]).map(course=>[course.id,course]));
      const changed=JSON.stringify(stored[CATALOG_KEY])!==JSON.stringify(courses);
      const scoped=changed?{...current,rows:(current.rows||[]).map(row=>{if(allowed.has(row.courseId))return row;const old=discovered.get(row.courseId),replacement=old&&byURL.get(canonicalCourseURL(old.url)+'|'+old.kind);return replacement?{...row,courseId:replacement.id}:null;}).filter(Boolean),ambiguous:(current.ambiguous||[]).map(row=>({...row,candidates:(row.candidates||[]).filter(id=>allowed.has(id))})).filter(row=>row.candidates.length)}:current;
      await chrome.storage.local.set({[CATALOG_KEY]:courses,...changed?{[STORAGE_KEY]:scoped}:{},refreshRequestedAt:Date.now()});
      return publicCapture(scoped);
    }
    if(message.type==='CAPTURE'){
      if(!current.enabled)return publicCapture(current);
      const courses=getCaptureCatalog(stored);
      const next=mergeCapture(current,message.parsed,new Date().toISOString(),courses);
      await chrome.storage.local.set({[STORAGE_KEY]:next});
      return publicCapture(next);
    }
    return publicCapture(current);
  });
  queue.then(result=>respond({ok:true,payload:result}),()=>respond({ok:false,error:'Не удалось сохранить локальные результаты'}));
  return true;
});
