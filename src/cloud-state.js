import {mergeRecord,mergeBackupRecord} from './core.js';

export const emptyAccount=()=>({records:{},customCourses:[],settings:{catalogMode:'empty',subjectsMode:'empty',variant:'ALL',theme:'system',layout:'grid'}});
const clone=value=>structuredClone(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const deviceSettings=['extensionRevision','extensionLinked','scan'];
export function cloudSnapshot(snapshot){
 const result=clone(snapshot);
 for(const record of Object.values(result.records||{})){delete record.pdfKey;delete record.documentKey;}
 for(const key of deviceSettings)delete result.settings[key];
 return result;
}
export function withDeviceData(snapshot,local){
 const result=clone(snapshot);
 for(const [id,record]of Object.entries(local.records||{}))if(result.records[id])for(const key of ['pdfKey','documentKey'])if(record[key])result.records[id][key]=record[key];
 for(const key of deviceSettings)if(Object.hasOwn(local.settings||{},key))result.settings[key]=local.settings[key];
 return result;
}
function mergeValue(base,local,remote){
 if(equal(local,base))return clone(remote);
 if(equal(remote,base)||equal(local,remote))return clone(local);
 if(object(local)&&object(remote)){
  const next={};for(const key of new Set([...Object.keys(base||{}),...Object.keys(local),...Object.keys(remote)])){
   const value=mergeValue(base?.[key],local[key],remote[key]);if(value!==undefined)next[key]=value;
  }return next;
 }
 if(Array.isArray(local)&&Array.isArray(remote)&&[...local,...remote].every(v=>typeof v==='string')){
  const before=new Set(Array.isArray(base)?base:[]),left=new Set(local),right=new Set(remote);
  return [...new Set([...local,...remote])].filter(v=>!before.has(v)||left.has(v)&&right.has(v));
 }
 return clone(local); // Simultaneous edits to the same preference: this user's latest edit wins.
}
export function mergeSnapshots(base,local,remote){
 base=cloudSnapshot(base||emptyAccount());local=cloudSnapshot(local);remote=cloudSnapshot(remote||emptyAccount());
 const result=mergeValue(base,local,remote);
 const asMap=list=>Object.fromEntries((list||[]).map(c=>[c.id,c]));
 result.customCourses=Object.values(mergeValue(asMap(base.customCourses),asMap(local.customCourses),asMap(remote.customCourses)));
 for(const [id,record]of Object.entries(result.records)){
  const l=local.records[id],r=remote.records[id],b=base.records[id];
  if(l&&r&&!equal(l,b)&&!equal(r,b)){
   const preferred=l.manualOverride?l:r.manualOverride?r:l;
   result.records[id]={...record,...mergeRecord(preferred,preferred===l?r:l).next};
  }
 }
 return result;
}
export function importLocalSnapshot(local,account){
 const result=mergeSnapshots(emptyAccount(),account,local);
 for(const [id,record]of Object.entries(local.records||{}))result.records[id]=account.records[id]?mergeBackupRecord(account.records[id],record).next:clone(record);
 return withDeviceData(result,account);
}

/** Optimistic writes prevent a stale browser snapshot from overwriting another device. */
export function createCloudStore({client,userId,space,storage,onSnapshot,onStatus,canSync=()=>true}){
 const key='account:'+userId;let current=emptyAccount(),base=emptyAccount(),revision=0,timer,running=null,disposed=false;
 const status=(state,message='')=>{if(!disposed)onStatus({state,message});};
 const persist=()=>storage.put('state',key,{snapshot:current,base,revision});
 const apply=()=>{if(!disposed)onSnapshot(clone(current));};
 async function readRemote(){
  const {data,error}=await client.from('course_tracker_data').select('data,revision').eq('user_id',userId).eq('space',space).maybeSingle();
  if(error)throw error;
  if(data&&(!object(data.data?.records)||!object(data.data?.settings)||!Array.isArray(data.data?.customCourses)))throw Error('Неверный формат облачной копии');
  return data||{data:emptyAccount(),revision:0};
 }
 async function perform(force=false){
  if(disposed||!force&&!canSync())return;
  status('syncing');
  try{
   for(let attempt=0;attempt<4;attempt++){
    const remote=await readRemote();if(disposed)return;
    current=withDeviceData(mergeSnapshots(base,current,remote.data),current);base=remote.data;revision=remote.revision;
    await persist();apply();
    const sent=cloudSnapshot(current);
    if(equal(sent,base)){status('synced');return;}
    const {data,error}=await client.rpc('save_course_tracker',{p_space:space,p_revision:revision,p_data:sent});
    if(disposed)return;
    if(error){if(error.code==='40001')continue;throw error;}
    const row=Array.isArray(data)?data[0]:data;if(!row?.revision)throw Error('Облако не подтвердило сохранение');
    base=sent;revision=row.revision;await persist();
    if(equal(cloudSnapshot(current),sent)){status('synced');return;}
   }
   status('pending','Есть новые изменения — повторяем сохранение');schedule();
  }catch(error){status('error',error.message||'Нет связи с облаком');}
 }
 function sync(force=false){if(running)return running;running=perform(force).finally(()=>{running=null;});return running;}
 function schedule(){clearTimeout(timer);if(!disposed)timer=setTimeout(()=>void sync(),600);}
 return {
  async start(){const cached=await storage.get('state',key);if(disposed)return;if(cached?.snapshot){current=cached.snapshot;base=cached.base||emptyAccount();revision=cached.revision||0;}apply();await sync(true);},
  async save(snapshot){current=clone(snapshot);await persist();status('pending');schedule();},
  sync,
  dispose(){disposed=true;clearTimeout(timer);},
 };
}
