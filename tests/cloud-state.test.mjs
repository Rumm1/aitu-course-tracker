import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudSnapshot,withDeviceData,mergeSnapshots,emptyAccount,createCloudStore,importLocalSnapshot} from '../src/cloud-state.js';
const copy=value=>structuredClone(value);
test('repeated local transfer preserves newer account completion and explicit plan choices',()=>{
 const local={...emptyAccount(),records:{A:{status:'new',manualOverride:true,inPlan:true}},settings:{catalogMode:'curated'}};
 const account={...emptyAccount(),records:{A:{status:'done',inPlan:false}}};
 const result=importLocalSnapshot(local,account);assert.equal(result.records.A.status,'done');assert.equal(result.records.A.inPlan,false);assert.equal(result.settings.catalogMode,'curated');assert.deepEqual(importLocalSnapshot(local,result),result);
});
test('cloud payload excludes local files and device-specific extension state',()=>{
 const local={...emptyAccount(),records:{U3:{status:'done',pdfKey:'pdf',documentKey:'doc',certificateUrl:'https://coursera.org/account/accomplishments/verify/ABC'}},settings:{extensionLinked:true,extensionRevision:'digest',owner:'Student'}};
 const sent=cloudSnapshot(local);assert.equal(sent.records.U3.pdfKey,undefined);assert.equal(sent.settings.extensionLinked,undefined);assert.ok(sent.records.U3.certificateUrl);assert.equal(withDeviceData(sent,local).records.U3.pdfKey,'pdf');
});
test('two devices merge independent marks, subjects and imported courses',()=>{
 const base=emptyAccount(),left=copy(base),right=copy(base);
 left.records.A={status:'done'};right.records.B={status:'active',percent:67};
 left.customCourses=[{id:'local-one',title:'One'}];right.customCourses=[{id:'local-two',title:'Two'}];
 left.settings.subjectDefinitions={'subject-one':'One'};right.settings.subjectDefinitions={'subject-two':'Two'};
 const merged=mergeSnapshots(base,left,right);assert.equal(merged.records.A.status,'done');assert.equal(merged.records.B.percent,67);assert.equal(merged.customCourses.length,2);assert.equal(Object.keys(merged.settings.subjectDefinitions).length,2);
});
test('concurrent progress never downgrades completion but respects an explicit correction',()=>{
 const base={...emptyAccount(),records:{A:{status:'active',percent:20}}},left=copy(base),right=copy(base);
 left.records.A={status:'active',percent:67};right.records.A={status:'done',certificateUrl:'cert'};
 assert.equal(mergeSnapshots(base,left,right).records.A.status,'done');
 left.records.A={status:'new',manualOverride:true};assert.equal(mergeSnapshots(base,left,right).records.A.status,'new');
});
test('subject removals persist while independent additions merge',()=>{
 const base=emptyAccount();base.settings.subjectAssignments={A:['CAP','QA']};
 const left=copy(base),right=copy(base);left.settings.subjectAssignments.A=['QA'];right.settings.subjectAssignments.A=['CAP','QA','SEC'];
 assert.deepEqual(mergeSnapshots(base,left,right).settings.subjectAssignments.A,['QA','SEC']);
});
function server(){
 const rows=new Map();let offline=false,conflictOnce=false;
 return {rows,setOffline:v=>offline=v,setConflict:v=>conflictOnce=v,client(user){return {
  from(){const filters={};return {select(){return this;},eq(k,v){filters[k]=v;return this;},async maybeSingle(){if(offline)return {error:{message:'offline'}};assert.equal(filters.user_id,user);return {data:copy(rows.get(user+'/'+filters.space)||null)};}};},
  async rpc(name,args){assert.equal(name,'save_course_tracker');if(offline)return {error:{message:'offline'}};const key=user+'/'+args.p_space,current=rows.get(key);if(conflictOnce){conflictOnce=false;const data=copy(current?.data||emptyAccount());data.records.REMOTE={status:'done'};rows.set(key,{data,revision:(current?.revision||0)+1});return {error:{code:'40001'}};}if((current?.revision||0)!==args.p_revision)return {error:{code:'40001'}};const row={revision:args.p_revision+1,data:copy(args.p_data)};rows.set(key,row);return {data:[copy(row)]};}
 };}};
}
function device(server,user='alice'){
 const cache=new Map(),states=[],statuses=[];
 const storage={async get(s,k){return copy(cache.get(k));},async put(s,k,v){cache.set(k,copy(v));}};
 const store=createCloudStore({client:server.client(user),userId:user,space:'tracker',storage,onSnapshot:s=>states.push(s),onStatus:s=>statuses.push(s)});
 return {store,cache,states,statuses};
}
test('version conflicts retry with a merge; two users and two devices remain isolated',async()=>{
 const api=server(),a=device(api),phone=device(api),other=device(api,'bob');
 try{
  await a.store.start();await phone.store.start();await other.store.start();
  const first=emptyAccount();first.records.A={status:'done'};await a.store.save(first);api.setConflict(true);await a.store.sync();
  const second=emptyAccount();second.records.B={status:'active',percent:67};await phone.store.save(second);await phone.store.sync();await a.store.sync();
  assert.deepEqual(Object.keys(api.rows.get('alice/tracker').data.records).sort(),['A','B','REMOTE']);assert.equal(a.states.at(-1).records.B.percent,67);
  await other.store.sync();assert.deepEqual(other.states.at(-1).records,{});assert.equal(api.rows.has('bob/tracker'),false);
 }finally{a.store.dispose();phone.store.dispose();other.store.dispose();}
});
test('offline edits are durable and synchronize after reconnection',async()=>{
 const api=server(),d=device(api);
 try{await d.store.start();api.setOffline(true);const snapshot=emptyAccount();snapshot.records.A={status:'active',percent:67};await d.store.save(snapshot);await d.store.sync();assert.equal(d.statuses.at(-1).state,'error');assert.equal(d.cache.get('account:alice').snapshot.records.A.percent,67);api.setOffline(false);await d.store.sync();assert.equal(d.statuses.at(-1).state,'synced');assert.equal(api.rows.get('alice/tracker').data.records.A.percent,67);}finally{d.store.dispose();}
});
