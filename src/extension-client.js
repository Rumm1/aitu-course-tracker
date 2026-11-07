import {validateLocalCourses} from './local-catalog.js';
const channel='course-by-course';
const requests=new Map(),subscribers=new Set();

export function validExtensionPayload(value){
 if(!value||value.version!==1||typeof value.enabled!=='boolean'||!Array.isArray(value.rows)||value.rows.length>6000)return false;
 if(value.capturedAt!==null&&(typeof value.capturedAt!=='string'||!Number.isFinite(Date.parse(value.capturedAt))))return false;
 if(value.ambiguous!==undefined&&(!Array.isArray(value.ambiguous)||value.ambiguous.length>200))return false;
 if(value.unmatched!==undefined&&(!Array.isArray(value.unmatched)||value.unmatched.length>200))return false;
 if(value.courses!==undefined){try{validateLocalCourses(value.courses);}catch{return false;}}
 for(const row of value.rows){
  if(!row||typeof row.courseId!=='string'||!['active','done'].includes(row.status))return false;
  if(row.percent!==undefined&&(typeof row.percent!=='number'||!Number.isFinite(row.percent)||row.percent<0||row.percent>100))return false;
  if(row.completedTasks!==undefined||row.totalTasks!==undefined){
   if(!Number.isSafeInteger(row.completedTasks)||!Number.isSafeInteger(row.totalTasks)||row.totalTasks<=0||row.completedTasks<0||row.completedTasks>row.totalTasks)return false;
  }
 }
 return true;
}

if(typeof window!=='undefined')window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin||event.data?.channel!==channel)return;
 const {type,requestId,payload}=event.data;
 if(!validExtensionPayload(payload))return;
 if(type==='PROGRESS_RESPONSE'&&requests.has(requestId)){
  const request=requests.get(requestId);requests.delete(requestId);clearTimeout(request.timer);request.resolve(payload);
 }
 if(type==='PROGRESS_CHANGED')for(const callback of subscribers)callback(payload);
});

export function requestExtension(timeout=900,catalog=[]){
 return new Promise(resolve=>{
  const requestId=crypto.randomUUID();
  const timer=setTimeout(()=>{requests.delete(requestId);resolve(null);},timeout);
  requests.set(requestId,{resolve,timer});
  window.postMessage({channel,type:'PROGRESS_REQUEST',requestId,catalog},location.origin);
 });
}
export function onExtensionProgress(callback){subscribers.add(callback);return()=>subscribers.delete(callback);}
