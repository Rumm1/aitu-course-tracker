import {stateFor,courseProgress,normalize} from './core.js';
import {allDefinitions,definitions,assignedSubjects,createSubject,renameSubject,hideSubject,revealSubject,setSubjectCourses} from './subjects.js';
import {icon} from './icons.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function createSubjectUI({getCatalog,getRecords,getSettings,modal,onChange}){
 const listFor=id=>getCatalog().filter(course=>assignedSubjects(course,getSettings()).includes(id));
 const close=form=>{const dialog=form.closest('dialog');if(dialog?.isConnected&&dialog.open)dialog.close();};
 function showError(form,error){
  const alert=form.querySelector('[data-subject-error]');if(alert){alert.textContent=error?.message||'Не удалось сохранить предмет';alert.hidden=false;}
 }
 function render(){
  const settings=getSettings(),available=definitions(settings),all=allDefinitions(settings),catalog=getCatalog(),records=getRecords();
  const hidden=Object.entries(all).filter(([id])=>!Object.hasOwn(available,id));
  return `<div class="page-heading catalog-heading"><div><h1>Мои предметы</h1><p class="muted">Свои названия и списки курсов для каждого предмета.</p></div><button class="primary" data-action="subject-add">＋ Создать предмет</button></div><div class="subject-workspace">${Object.entries(available).map(([id,name])=>{
   const courses=catalog.filter(course=>assignedSubjects(course,settings).includes(id)),done=courses.filter(course=>stateFor(course,records).status==='done').length;
   return `<section class="subject panel personal-subject" data-subject-id="${id}"><div class="section-heading"><div><h2>${esc(name)}</h2><p class="small muted">${courses.length} курсов · ${done} пройдено</p></div><span class="subject-count">${courses.length?Math.round(done/courses.length*100):0}%</span></div><div class="button-row"><button class="secondary" data-action="subject-manage" data-id="${id}">${icon('courses')} Выбрать курсы</button><button class="text" data-action="subject-edit" data-id="${id}">Переименовать</button><button class="text" data-action="subject-hide" data-id="${id}">Скрыть</button></div>${courses.length?`<ul class="subject-course-list">${courses.map(course=>{const record=stateFor(course,records),info=courseProgress(record);return `<li class="subject-course-row" data-subject-course-row="${course.id}"><button class="text" data-action="details" data-id="${course.id}">${esc(course.title)}</button><span class="small ${record.status==='done'?'done-text':'muted'}">${esc(info.label)}</span></li>`;}).join('')}</ul>`:'<p class="muted small">Курсы пока не выбраны. Добавьте их из своего каталога.</p>'}</section>`;
  }).join('')||`<div class="empty"><span class="empty-icon">${icon('subjects')}</span><h3>Создайте свой первый предмет</h3><p>Затем выберите для него курсы из каталога.</p><button class="secondary" data-action="subject-add">Создать предмет</button></div>`}</div>${hidden.length?`<details class="panel hidden-subjects"><summary>Скрытые предметы (${hidden.length})</summary><ul class="subject-course-list">${hidden.map(([id,name])=>`<li class="subject-course-row"><span>${esc(name)}</span><button class="text" data-action="subject-restore" data-id="${id}">Восстановить</button></li>`).join('')}</ul></details>`:''}`;
 }
 function nameForm(id){
  const editing=!!id,name=id?allDefinitions(getSettings())[id]:'';
  if(editing&&!name)throw Error('Предмет не найден');
  modal(editing?'Переименовать предмет':'Создать предмет',`<form id="${editing?'subject-edit-form':'subject-create-form'}" ${id?`data-subject-id="${id}"`:''}><label>Название предмета<input name="name" type="text" required maxlength="80" value="${esc(name)}" placeholder="Например, математика" autocomplete="off"></label><p class="small muted">Название и список курсов принадлежат только вашему пространству.</p><p data-subject-error role="alert" class="warning" hidden></p><button class="primary" type="submit">${editing?'Сохранить название':'Создать предмет'}</button></form>`);
  const form=document.querySelector(editing?'#subject-edit-form':'#subject-create-form');
  form.addEventListener('submit',async event=>{
   event.preventDefault();event.stopPropagation();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
   try{const value=new FormData(form).get('name'),next=editing?renameSubject(getSettings(),id,value):createSubject(getSettings(),value);await onChange(next);close(form);}
   catch(error){showError(form,error);if(submit.isConnected)submit.disabled=false;}
  });
  form.elements.namedItem('name').focus();
 }
 function manageForm(id){
  const name=allDefinitions(getSettings())[id];if(!name)throw Error('Предмет не найден');
  const selected=new Set(listFor(id).map(course=>course.id));let query='';
  modal('Курсы предмета «'+esc(name)+'»',`<form id="subject-courses-form" data-subject-id="${id}"><label>Поиск курсов<input name="query" type="search" placeholder="Название или провайдер" autocomplete="off"></label><p class="small muted">Курс может входить в несколько предметов. Выбор не меняет его статус и включение в учебный план.</p><div class="subject-assignment-summary"><span data-subject-selected></span><button type="button" class="text" data-subject-select="all">Выбрать показанные</button><button type="button" class="text" data-subject-select="none">Снять показанные</button></div><div data-subject-courses class="subject-assignment-list"></div><p data-subject-error role="alert" class="warning" hidden></p><div class="button-row"><button class="primary" type="submit">Сохранить список курсов</button></div></form>`);
  const form=document.querySelector('#subject-courses-form'),container=form.querySelector('[data-subject-courses]');
  const filtered=()=>getCatalog().filter(course=>normalize([course.title,course.provider,course.id,...course.also||[]].join(' ')).includes(normalize(query)));
  function renderRows(){
   const list=filtered(),records=getRecords();
   form.querySelector('[data-subject-selected]').textContent='Выбрано: '+selected.size;
   container.innerHTML=list.map(course=>`<label class="checkbox subject-assignment-row" data-subject-course="${course.id}"><input type="checkbox" name="course" value="${course.id}" ${selected.has(course.id)?'checked':''}><span><strong>${esc(course.title)}</strong><small>${esc(course.provider||'Провайдер не указан')} · ${esc(courseProgress(stateFor(course,records)).label)}</small></span></label>`).join('')||'<p class="muted small">По этому запросу курсов нет.</p>';
  }
  form.elements.namedItem('query').addEventListener('input',event=>{query=event.target.value;renderRows();});
  container.addEventListener('change',event=>{const checkbox=event.target.closest('input[name="course"]');if(!checkbox)return;checkbox.checked?selected.add(checkbox.value):selected.delete(checkbox.value);form.querySelector('[data-subject-selected]').textContent='Выбрано: '+selected.size;});
  for(const button of form.querySelectorAll('[data-subject-select]'))button.addEventListener('click',()=>{for(const course of filtered())button.dataset.subjectSelect==='all'?selected.add(course.id):selected.delete(course.id);renderRows();});
  form.addEventListener('submit',async event=>{
   event.preventDefault();event.stopPropagation();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
   try{await onChange(setSubjectCourses(getSettings(),id,[...selected],getCatalog()));close(form);}
   catch(error){showError(form,error);if(submit.isConnected)submit.disabled=false;}
  });
  renderRows();
 }
 return {render,async handleAction(action,id){
  if(action==='subject-add'){nameForm();return true;}
  if(action==='subject-edit'){nameForm(id);return true;}
  if(action==='subject-manage'){manageForm(id);return true;}
  if(action==='subject-hide'){await onChange(hideSubject(getSettings(),id));return true;}
  if(action==='subject-restore'){await onChange(revealSubject(getSettings(),id));return true;}
  return false;
 }};
}
