import {courseURL,kinds,subjects,validDate} from './core.js';

export function validateLocalCourses(value=[]){
 if(!Array.isArray(value)||value.length>5000)throw Error('Неверный локальный каталог');
 const seen=new Set();return value.map(item=>{
  if(!item||typeof item!=='object'||!/^local-[a-z0-9-]{6,80}$/.test(item.id)||seen.has(item.id))throw Error('Неверный или повторный ID дополнительного курса');
  seen.add(item.id);
  const url=courseURL(item.url);
  if(!url||new URL(url).hostname==='localhost'||/^\d+(?:\.\d+){3}$/.test(new URL(url).hostname))throw Error('Неверная HTTPS-ссылка дополнительного курса');
  if(typeof item.title!=='string'||!item.title.trim()||item.title.length>700||!Object.hasOwn(kinds,item.kind))throw Error('Неверное название или вид дополнительного курса');
  const c={id:item.id,title:item.title.trim(),url,kind:item.kind,subjects:Array.isArray(item.subjects)?[...new Set(item.subjects.filter(id=>typeof id==='string'&&id.length<=80&&(Object.hasOwn(subjects,id)||/^subject-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))))]:[],sources:['EXCEL'],inPlan:!!item.inPlan};
  if(Array.isArray(item.sources)&&item.sources.includes('COURSERA'))c.sources=['COURSERA'];
  if(typeof item.provider==='string')c.provider=item.provider.slice(0,300);
  if(Array.isArray(item.also))c.also=item.also.filter(t=>typeof t==='string'&&t.length<=700).slice(0,30);
  if(typeof item.subjectSource==='string')c.subjectSource=item.subjectSource.slice(0,100);
  if(item.hoursBySource&&typeof item.hoursBySource==='object'){c.hoursBySource={};for(const [source,hours]of Object.entries(item.hoursBySource).slice(0,10))if(typeof hours==='string'||typeof hours==='number'&&Number.isFinite(hours)&&hours>=0)c.hoursBySource[source.slice(0,50)]=typeof hours==='string'?hours.slice(0,100):hours;}
  if(validDate(item.addedAt))c.addedAt=item.addedAt;
  return c;
 });
}
export function mergeLocalCourses(current,incoming){
 const map=new Map(current.map(course=>[course.id,course]));
 for(const course of validateLocalCourses(incoming))map.set(course.id,{...map.get(course.id),...course});
 return [...map.values()];
}
