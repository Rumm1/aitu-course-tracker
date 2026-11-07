import {mergeBackupRecord} from './core.js';
import {canonicalCourseURL} from './course-identity.js';

const unique=values=>[...new Set(values.filter(Boolean))];
// A personal catalog without a starter set has no separate "additional" section.
export function catalogSections(catalog,baseIds,hasStarter=true){
 if(!hasStarter)return {main:catalog,additional:[]};
 const main=[],additional=[];for(const course of catalog)(baseIds.has(course.id)?main:additional).push(course);
 return {main,additional};
}
export function catalogIdentity(course){
 const url=canonicalCourseURL(course.url);
 if(!url||course.linkState==='requires-check')return 'id:'+course.id;
 // The official route identifies the item even if an old import labelled its type incorrectly.
 return /^https:\/\/coursera\.org\/(learn|projects|specializations|professional-certificates)\//.test(url)?url:url+'|'+course.kind;
}
export function resolveCourseId(id,aliases={}){
 const seen=new Set();while(aliases[id]&&!seen.has(id)){seen.add(id);id=aliases[id];}return id;
}
function combineRecords(current,incoming){
 const preferred=incoming.manualOverride&&!current.manualOverride?incoming:current;
 const other=preferred===current?incoming:current;
 const result=mergeBackupRecord(preferred,other).next;
 if(current.pinned||incoming.pinned)result.pinned=true;
 if(current.lastOpened||incoming.lastOpened)result.lastOpened=[current.lastOpened,incoming.lastOpened].filter(Boolean).sort().at(-1);
 return result;
}

/** Coalesce exact URL identities; titles alone never prove that two courses are identical. */
export function reconcileCatalog(base,custom,records={},settings={}){
 const groups=new Map(),aliases={...settings.courseAliases},nextRecords={...records},assignments={...settings.subjectAssignments};
 const previousAliases={...settings.courseAliases};let removed=0;
 for(const course of [...base,...custom]){
  const key=catalogIdentity(course),group=groups.get(key);
  if(group){group.push(course);aliases[course.id]=group[0].id;removed++;}
  else groups.set(key,[course]);
 }
 const catalog=[...groups.values()].map(group=>{
  const first=group[0];if(group.length===1)return first;
  const combined={...first,also:unique([...first.also||[],...group.slice(1).flatMap(c=>[c.title,...c.also||[]])]).filter(title=>title!==first.title),subjects:unique(group.flatMap(c=>c.subjects||[])),sources:unique(group.flatMap(c=>c.sources||[])),inPlan:group.some(c=>c.inPlan)};
  if(group.some(c=>c.hoursBySource))combined.hoursBySource=Object.assign({},...[...group].reverse().map(c=>c.hoursBySource||{}));
  // Migrate memberships once. Later explicit edits must not resurrect old assignments.
  const fresh=group.slice(1).filter(c=>previousAliases[c.id]!==first.id);
  if(fresh.length)assignments[first.id]=unique([...(assignments[first.id]??first.subjects??[]),...fresh.flatMap(c=>assignments[c.id]??c.subjects??[])]);
  return combined;
 });
 const known=new Set(catalog.map(c=>c.id));
 for(const id of Object.keys(aliases)){
  const target=resolveCourseId(id,aliases);
  if(id===target||!known.has(target)){delete aliases[id];continue;}
  aliases[id]=target;
  if(nextRecords[id]){nextRecords[target]=combineRecords(nextRecords[target]||{},nextRecords[id]);delete nextRecords[id];}
  if(assignments[id]){assignments[target]=unique([...(assignments[target]??catalog.find(c=>c.id===target)?.subjects??[]),...assignments[id]]);delete assignments[id];}
 }
 const baseIDs=new Set(base.map(c=>c.id));
 return {catalog,customCourses:catalog.filter(c=>!baseIDs.has(c.id)),records:nextRecords,settings:{...settings,...Object.keys(aliases).length?{courseAliases:aliases}:{},...Object.keys(assignments).length?{subjectAssignments:assignments}:{}},removed};
}
