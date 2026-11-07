import {canonicalCourseURL} from './course-identity.js';
import {validateLocalCourses} from './local-catalog.js';

// Reconcile by canonical address and type before accepting progress from discovery.
export function reconcileExtensionCatalog(catalog,customCourses,state){
 const incoming=validateLocalCourses(state.courses||[]),known=[...catalog],custom=[...customCourses],remap=new Map();
 const key=course=>canonicalCourseURL(course.url)+'|'+course.kind;
 let added=0;
 for(const course of incoming){
  const existing=known.find(item=>item.id===course.id)||known.find(item=>key(item)===key(course));
  if(existing){remap.set(course.id,existing.id);continue;}
  const next={...course,subjects:[],inPlan:false,sources:['COURSERA']};
  custom.push(next);known.push(next);remap.set(course.id,next.id);added++;
 }
 const rows=[...new Map((state.rows||[]).map(row=>{
  const target=remap.get(row.courseId)||known.find(course=>course.id===row.courseId)?.id||(row.url&&known.find(course=>key(course)===key(row))?.id);
  return target?[target,{...row,courseId:target}]:null;
 }).filter(Boolean)).values()];
 return {customCourses:custom,rows,added};
}
