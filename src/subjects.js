import {subjects as defaultSubjects,normalize} from './core.js';

const DEFAULT_IDS=new Set(Object.keys(defaultSubjects));
const SUBJECT_ID=/^subject-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COURSE_ID=/^[a-z0-9][a-z0-9_-]{0,99}$/i;
const validID=id=>typeof id==='string'&&id.length<=80&&(DEFAULT_IDS.has(id)||SUBJECT_ID.test(id));
const unique=values=>[...new Set(values)];
function cleanName(name){
 if(typeof name!=='string')throw Error('Введите название предмета');
 const value=name.trim().replace(/\s+/g,' ');
 if(!value||value.length>80||/[\u0000-\u001f\u007f]/.test(value))throw Error('Название предмета должно содержать от 1 до 80 символов');
 return value;
}

/** All definitions, including hidden ones, are retained for reversible edits. */
export function allDefinitions(settings={}){
 const result=settings.subjectsMode==='empty'?{}:{...defaultSubjects};
 const custom=settings.subjectDefinitions;
 if(custom&&typeof custom==='object'&&!Array.isArray(custom))for(const [id,name]of Object.entries(custom)){
  if(!validID(id)||typeof name!=='string')continue;
  try{result[id]=cleanName(name);}catch{}
 }
 return result;
}
export function definitions(settings={}){
 const hidden=new Set(Array.isArray(settings.hiddenSubjects)?settings.hiddenSubjects:[]);
 return Object.fromEntries(Object.entries(allDefinitions(settings)).filter(([id])=>!hidden.has(id)));
}
function rawAssigned(course,settings={}){
 const override=settings.subjectAssignments;
 const value=override&&Object.hasOwn(override,course.id)?override[course.id]:course.subjects;
 const available=allDefinitions(settings);
 return unique(Array.isArray(value)?value.filter(id=>Object.hasOwn(available,id)):[]);
}
export function assignedSubjects(course,settings={}){
 const available=definitions(settings);
 return rawAssigned(course,settings).filter(id=>Object.hasOwn(available,id));
}
function ensureKnown(settings,id){
 if(!validID(id)||!Object.hasOwn(allDefinitions(settings),id))throw Error('Предмет не найден');
}
function ensureUniqueName(settings,name,exceptID=''){
 if(Object.entries(allDefinitions(settings)).some(([id,value])=>id!==exceptID&&normalize(value)===normalize(name)))throw Error('Предмет с таким названием уже существует');
}
function nextID(settings,name){
 let slug=normalize(name).replace(/[^a-z0-9 ]/g,'').trim().replace(/\s+/g,'-').slice(0,40).replace(/-+$/,'');
 if(!slug){let hash=0x811c9dc5;for(const character of name){hash^=character.codePointAt(0);hash=Math.imul(hash,0x01000193)>>>0;}slug=hash.toString(16).padStart(8,'0');}
 const all=allDefinitions(settings),base='subject-'+slug;let id=base,index=2;
 while(Object.hasOwn(all,id))id=base+'-'+index++;
 return id;
}
export function createSubject(settings={},name,id){
 const value=cleanName(name);ensureUniqueName(settings,value);
 if(Object.keys(allDefinitions(settings)).length>=200)throw Error('Можно создать не более 200 предметов');
 const subjectID=id||nextID(settings,value);
 if(!validID(subjectID)||Object.hasOwn(allDefinitions(settings),subjectID))throw Error('Недопустимый или уже занятый ID предмета');
 return {...settings,subjectDefinitions:{...settings.subjectDefinitions,[subjectID]:value}};
}
export function renameSubject(settings={},id,name){
 ensureKnown(settings,id);const value=cleanName(name);ensureUniqueName(settings,value,id);
 return {...settings,subjectDefinitions:{...settings.subjectDefinitions,[id]:value}};
}
export function hideSubject(settings={},id){
 ensureKnown(settings,id);
 return {...settings,hiddenSubjects:unique([...(Array.isArray(settings.hiddenSubjects)?settings.hiddenSubjects:[]),id])};
}
export function revealSubject(settings={},id){
 ensureKnown(settings,id);
 return {...settings,hiddenSubjects:(Array.isArray(settings.hiddenSubjects)?settings.hiddenSubjects:[]).filter(value=>value!==id)};
}
/** Change membership only. Course data, completion and inPlan are untouched. */
export function setSubjectCourses(settings={},id,courseIDs,catalog=[]){
 ensureKnown(settings,id);
 if(!Array.isArray(courseIDs))throw Error('Выберите курсы предмета');
 const known=new Set(catalog.map(course=>course.id)),selected=new Set(courseIDs);
 for(const courseID of selected)if(typeof courseID!=='string'||!known.has(courseID))throw Error('Один из выбранных курсов не найден в каталоге');
 const assignments={...settings.subjectAssignments};
 for(const course of catalog){
  const current=rawAssigned(course,settings),already=current.includes(id),wanted=selected.has(course.id);
  if(already===wanted)continue;
  assignments[course.id]=wanted?[...current,id]:current.filter(value=>value!==id);
 }
 return {...settings,subjectAssignments:assignments};
}

/** Validate optional subject settings from a backup. Stale safe IDs are omitted. */
export function validateSubjectSettings(value={},catalog){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Неверные настройки предметов');
 const result={};
 if(Object.hasOwn(value,'subjectsMode')){
  if(!['empty','default'].includes(value.subjectsMode))throw Error('Неверный режим предметов');
  result.subjectsMode=value.subjectsMode;
 }
 if(Object.hasOwn(value,'subjectDefinitions')){
  const source=value.subjectDefinitions;
  if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).length>200)throw Error('Неверный список предметов');
  result.subjectDefinitions={};
  for(const [id,name]of Object.entries(source)){
   if(!validID(id))throw Error('Неверный ID предмета');
   result.subjectDefinitions[id]=cleanName(name);
  }
 }
 const all=allDefinitions(result);if(Object.keys(all).length>200)throw Error('Можно сохранить не более 200 предметов');
 if(Object.hasOwn(value,'hiddenSubjects')){
  if(!Array.isArray(value.hiddenSubjects)||value.hiddenSubjects.length>200)throw Error('Неверный список скрытых предметов');
  for(const id of value.hiddenSubjects)if(!validID(id))throw Error('Неверный ID скрытого предмета');
  result.hiddenSubjects=unique(value.hiddenSubjects.filter(id=>Object.hasOwn(all,id)));
 }
 if(Object.hasOwn(value,'subjectAssignments')){
  const source=value.subjectAssignments;
  if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).length>10000)throw Error('Неверные связи предметов с курсами');
  const known=catalog?new Set(catalog.map(course=>course.id)):null;
  result.subjectAssignments={};
  for(const [courseID,ids]of Object.entries(source)){
   if(!COURSE_ID.test(courseID)||!Array.isArray(ids)||ids.length>200)throw Error('Неверная связь предмета с курсом');
   for(const id of ids)if(!validID(id))throw Error('Неверный ID предмета в связи курса');
   if(known&&!known.has(courseID))continue;
   result.subjectAssignments[courseID]=unique(ids.filter(id=>Object.hasOwn(all,id)));
  }
 }
 return result;
}
