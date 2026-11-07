import baseCatalog from './catalog.json';
import relations from './relations.json';
import {subjects as baseSubjects,kinds,statuses,normalize,deadline,stateFor,inVariant,plan,progress,courseProgress,search,hours,certificateURL,courseURL,matchRecord,mergeRecord,mergeBackupRecord,undoImportedRecord,parseCSV,reportStatus,validDate,validateBackup} from './core.js';
import * as store from './storage.js';
import {icon} from './icons.js';
import {requestExtension,onExtensionProgress} from './extension-client.js';
import {enhanceSelects,closeSelectMenu} from './select.js';
import {validateLocalCourses,mergeLocalCourses} from './local-catalog.js';
import {definitions,allDefinitions,assignedSubjects,createSubject,validateSubjectSettings} from './subjects.js';
import {createSubjectUI} from './subject-ui.js';
import {reconcileExtensionCatalog} from './extension-catalog.js';
import './style.css';
import './refinement.css';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog=[...baseCatalog],customCourses=[],records={},settings={variant:'ALL',owner:'',theme:'system',layout:'grid',sidebarCollapsed:false},view='overview',query='',subject='',status='',hide=false,scope='all',directory=null,busy=false,pending=[],toastTimer,extensionState=null,extensionBusy=false,pendingCatalog=[];
const nav=[['overview','overview','Обзор'],['courses','courses','Курсы'],['completed','check','Пройденные'],['subjects','subjects','Предметы'],['certificates','certificate','Сертификаты']];
const extraViews={setup:'Расширение и свой сайт'};
const projectRepository=typeof __PROJECT_REPOSITORY__!=='undefined'?__PROJECT_REPOSITORY__:'Rumm1/aitu-course-tracker';
const curatedDefault=projectRepository.toLowerCase()==='rumm1/aitu-course-tracker';
let subjects={...baseSubjects};
const subjectUI=createSubjectUI({getCatalog:()=>catalog,getRecords:()=>records,getSettings:()=>settings,modal,onChange:async next=>{settings=next;refreshSubjects();await save();render();}});
const russianSubjectNames={CAP:'Дипломный проект',SEC:'Информационная безопасность',QA:'Качество и тестирование ПО',ARCH:'Архитектура ПО',TE:'Технологическое предпринимательство'};
function refreshSubjects(){subjects=definitions(settings);if(subject&&!Object.hasOwn(subjects,subject))subject='';}
function matchesSearch(c,value){const ids=assignedSubjects(c,settings);if(search({...c,subjects:ids},value))return true;const labels=ids.flatMap(id=>[subjects[id],russianSubjectNames[id]||'']);return normalize(labels.join(' ')).includes(normalize(value));}
const themeKey='aitu-course-tracker:theme:'+location.pathname.replace(/\/[^/]*$/,'/');
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
function currentTheme(){return settings.theme==='system'?(systemTheme.matches?'dark':'light'):settings.theme;}
function themeButton(){const dark=currentTheme()==='dark';return `${icon(dark?'sun':'moon')}<span>${dark?'Светлая тема':'Тёмная тема'}</span>`;}
function applyTheme(){
 const theme=currentTheme();document.documentElement.dataset.theme=theme;
 document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#0f1210':'#f4f5f4';
 try{localStorage.setItem(themeKey,settings.theme);}catch{}
 const toggle=document.querySelector('[data-action="theme"]');
 if(toggle){toggle.innerHTML=themeButton();toggle.setAttribute('aria-label',theme==='dark'?'Включить светлую тему':'Включить тёмную тему');toggle.setAttribute('aria-pressed',String(theme==='dark'));}
}
systemTheme.addEventListener('change',()=>{if(settings.theme==='system')applyTheme();});
const r=c=>stateFor(c,records);
const cById=id=>catalog.find(c=>c.id===id);
const se=relations['ПОДТЕМЫ SE'];
const syllabi=relations['СИЛЛАБУСЫ SE'];
const variantFor=s=>s==='ARCH'?(settings.variant==='ALL'?['UML','GO']:[settings.variant]):[s];
const relevant=(rows)=>rows.filter(row=>!['UML','GO'].includes(row[0])||settings.variant==='ALL'||row[0]===settings.variant);
const allLinks=se.map(row=>({...Object.fromEntries(['variant','week','topic','courseId','coverage'].map((key,i)=>[key,row[i]])),source:'SE'}));
for(const row of relations['АЛЬТЕРНАТИВНЫЕ СВЯЗИ ИЗ МАТРИЦ XLS'])for(const id of row[3])allLinks.push({variant:row[0]==='ARCH'?String(row[1]).includes('(M)')?'GO':'UML':row[0],week:row[1],topic:row[2],courseId:id,coverage:row[4],source:'XLS'});
for(const row of relations['СВЯЗИ ИЗ СПИСКА ПОЛЬЗОВАТЕЛЯ'])allLinks.push({variant:row[0],week:row[2],topic:row[2],courseId:row[1],coverage:'Сопоставление пользователя',source:'LIST'});
const linksFor=id=>allLinks.filter(row=>row.courseId===id&&(!['UML','GO'].includes(row.variant)||settings.variant==='ALL'||row.variant===settings.variant));
function date(s){return s?new Date(s).toLocaleDateString('ru-RU',{timeZone:'Asia/Almaty'}):'Дата неизвестна';}
function error(e){toast(e?.message||String(e));console.error(e);}
function toast(message){let t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';t.setAttribute('role','status');document.body.append(t);}t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),4500);}
function refreshCatalog(){catalog=[...(settings.catalogMode==='empty'?[]:baseCatalog),...customCourses];}
async function save(){await store.put('state','main',{records,settings,customCourses});}
async function change(id,patch){records[id]={...r(cById(id)),...patch};await save();render();}
function queue(){return plan(catalog,records,settings.variant).filter(c=>r(c).status!=='done').sort((a,b)=>Number(r(b).pinned)-Number(r(a).pinned)||Number(r(b).status==='active')-Number(r(a).status==='active')||linksFor(b.id).length-linksFor(a.id).length);}
function primary(c){const s=r(c);if(s.status==='done'&&s.certificateUrl)return `<a class="primary" href="${esc(s.certificateUrl)}" target="_blank" rel="noopener noreferrer">Открыть сертификат ↗</a>`;if(s.status==='done'&&s.pdfKey)return `<button class="primary" data-action="pdf" data-id="${c.id}">Открыть PDF ↗</button>`;if(s.status==='done')return `<button class="primary" data-action="certificate" data-id="${c.id}">Добавить ссылку</button>`;return `<a class="primary" data-action="open" data-id="${c.id}" href="${esc(openURL(c))}" target="_blank" rel="noopener noreferrer">${c.linkState==='requires-check'&&!s.customUrl?'Найти на Coursera':s.status==='active'?'Продолжить':'Открыть курс'} ↗</a>`;}
function openURL(c){return r(c).customUrl||(c.linkState==='requires-check'?`https://www.coursera.org/search?query=${encodeURIComponent(c.title)}`:c.url);}
function courseProgressBar(record){
 const info=courseProgress(record),known=info.percent!==null;
 return `<div class="course-progress ${known?'':'unknown'}" data-progress-status="${record.status}"><span class="course-progress-label">${esc(info.label)}</span><div class="course-progress-track" role="progressbar" aria-label="Прогресс курса" aria-valuemin="0" aria-valuemax="100" ${known?`aria-valuenow="${info.percent}"`:'aria-valuetext="Процент пока неизвестен"'}><i style="width:${known?info.percent:0}%"></i></div>${record.status==='active'&&record.source?`<span class="progress-source">${esc(record.source)}</span>`:''}</div>`;
}
function card(c){
 const s=r(c),n=linksFor(c.id).length,courseSubjects=assignedSubjects(c,settings);
 return `<article class="course ${s.status==='done'?'complete':''}" data-course="${c.id}" data-subject="${courseSubjects[0]||''}">
 <div class="card-top"><span class="provider-icon">${esc((c.provider||'C')[0])}</span><span class="eyebrow">${esc(c.provider||new URL(c.url).hostname)}<br><span class="muted">${kinds[c.kind]}</span></span><button class="icon ${s.pinned?'pinned':''}" data-action="pin" data-id="${c.id}" aria-label="${s.pinned?'Снять приоритет':'Закрепить приоритет'}" title="Приоритет">${s.pinned?'★':'☆'}</button></div>
 <div class="tags">${courseSubjects.map(id=>`<span class="tag ${id.toLowerCase()}" title="${esc(subjects[id])}">${esc(baseSubjects[id]?id:subjects[id])}</span>`).join('')}<span class="status ${s.status}">${s.status==='done'?'✓ ':s.status==='active'?'● ':''}${statuses[s.status]}</span></div>
 <div class="course-content"><h3 class="course-title">${esc(c.title)}</h3><p class="course-meta">${icon('clock')}${esc(hours(c))}</p>${n?`<p class="card-context muted small">${n} связей с темами · ${esc(c.seScope||'Несколько источников')}</p>`:''}${courseProgressBar(s)}${s.status==='done'?`<p class="small done-text">${date(s.completedAt)} · ${esc(s.source||'Ручная отметка')}${s.grade?' · Оценка: '+esc(s.grade):''}</p>`:''}</div>
 <div class="card-actions">${primary(c)}<button class="secondary" data-action="details" data-id="${c.id}">Подробнее</button></div>
 <div class="card-footer"><button class="text" data-action="plan" data-id="${c.id}">${s.inPlan?'✓ В моём плане':'＋ В план'}</button><button class="text" data-action="status" data-id="${c.id}">${s.status==='done'?'Исправить статус':s.status==='active'?'Отметить пройденным':'Начать'}</button></div>${s.status==='done'&&s.certificateUrl?`<button class="text copy" data-action="copy" data-id="${c.id}">Скопировать ссылку</button>`:''}
 </article>`;
}
function empty(text,extra=''){return `<div class="empty"><span class="empty-icon">${icon('sparkle')}</span><h3>${text}</h3>${extra}</div>`;}
function summary(){
 const p=progress(catalog,records,settings.variant),active=plan(catalog,records,settings.variant).filter(c=>r(c).status==='active').length,cert=catalog.filter(c=>r(c).status==='done'&&(r(c).certificateUrl||r(c).pdfKey)).length;
 return `<div class="stats"><div><span>${icon('courses')} Мой план</span><strong>${p.done}<small> / ${p.total}</small></strong><div class="progress" role="progressbar" aria-label="Завершено в плане" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.percent}"><i style="width:${p.percent}%"></i></div><small>${p.percent}% завершено</small></div><div><span>${icon('clock')} В работе</span><strong>${active.toString().padStart(2,'0')}</strong><small>В вашем собственном темпе</small></div><div><span>${icon('certificate')} Сертификаты</span><strong>${cert.toString().padStart(2,'0')}</strong><small>Маленькие шаги. Настоящие результаты.</small></div></div>`;
}
function progressSummaryText(result){
 return `Найдено ${result.found} курсов: ${result.completed} отмечены пройденными, у ${result.updated} обновлён прогресс, ${result.clarify} требуют уточнения.${result.unchanged?` Уже учтены: ${result.unchanged}.`:''}${result.conflicts?` Сохранены ручные исправления: ${result.conflicts}.`:''}`;
}
function overallProgress(){
 const p=progress(catalog,records,settings.variant),check=settings.lastProgressCheck,clarifications=settings.progressClarifications||[];
 const checked=check?.at&&Number.isFinite(Date.parse(check.at))?`${new Date(check.at).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'})} · ${esc(check.source)}${check.capturedAt?` · данные страницы от ${new Date(check.capturedAt).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'})}`:''}`:'Проверок ещё не было · статусы из ручных отметок и локального импорта';
 return `<section class="learning-total"><strong>Пройдено ${p.done} из ${p.total} курсов моего плана · ${p.percent}%</strong><p id="last-progress-check">Последняя проверка: ${checked}</p>${check?.summary?`<div class="progress-result" role="status" tabindex="-1">${icon('check')}<div><p>${esc(progressSummaryText({...check.summary,clarify:clarifications.length}))}</p><span>Источник: ${esc(check.source)}</span>${clarifications.length?`<button class="text" data-action="progress-clarify">Уточнить совпадения (${clarifications.length}) →</button>`:''}${settings.progressUnmatched?.length?`<details class="progress-missed"><summary>Нет в каталоге или недостаточно данных: ${settings.progressUnmatched.length}</summary><ul>${settings.progressUnmatched.slice(0,25).map(item=>`<li>${esc(item.title)}</li>`).join('')}</ul></details>`:''}</div></div>`:''}</section>`;
}
function overview(){
 const d=deadline(),q=queue(),selected=plan(catalog,records,settings.variant),active=catalog.filter(c=>r(c).status==='active').sort((a,b)=>(r(b).lastOpened||'').localeCompare(r(a).lastOpened||''))[0];
 return `<div class="page-heading"><div><p class="eyebrow">ВАШЕ ПРОСТРАНСТВО ОБУЧЕНИЯ</p><h1>Большие цели.<br><em>Небольшие шаги.</em></h1><p class="muted">Соберите знания в один понятный маршрут.</p></div><div class="overview-tools"><button class="primary" data-action="progress-check">${icon('check')} Проверить мой прогресс</button><button class="text" data-action="progress-paste">Учесть уже пройденные</button></div></div>
 <section class="hero"><div class="hero-content"><span class="light-label"><span class="live-dot"></span>${active?'СЛЕДУЮЩИЙ ШАГ':'МАРШРУТ К ВАШЕЙ ЦЕЛИ'}</span><h2>${active?esc(active.title):'Курс за курсом.<br>Всё ближе к цели.'}</h2><p>${active?esc(active.provider):`${selected.length} курсов в вашем плане. ${Object.keys(subjects).length} предметов.<br>Начните с того, что важно сейчас.`}</p><div class="hero-footer">${active?primary(active):`<a class="primary white" href="#courses?plan">Открыть план ${icon('arrow')}</a>`}<span>Ваш следующий шаг — здесь</span></div></div><div class="hero-art" aria-hidden="true"><span class="orbit-core">${icon('mark')}</span><span class="orbit-label">learn. grow. repeat.</span></div>
 <div class="deadline"><span class="deadline-label">БЛИЖАЙШИЙ ДЕДЛАЙН</span><span class="calendar">10 <small>НОЯБРЯ</small></span><p>До 10 ноября включительно</p><strong id="countdown">${d.expired?'Дедлайн прошёл':`${d.days} дн. <span>${d.hours} ч.</span>`}</strong><small>2026 · Казахстан, UTC+5</small></div></section>
 ${overallProgress()}${summary()}<div class="section-heading"><div><p class="eyebrow">ПОНЕМНОГУ, КАЖДЫЙ ДЕНЬ</p><h2>Очередь на сегодня <span class="heading-dot"></span></h2></div><a href="#courses?plan">Весь план ${icon('arrow')}</a></div><div class="grid">${q.slice(0,3).map(card).join('')||empty('План завершён или пока пуст','<a href="#courses">Добавить курсы →</a>')}</div>
 <section class="import-banner"><div class="badge-icon">${icon('certificate')}</div><div><h3>Ваши достижения уже с вами</h3><p>Добавьте сертификаты и сразу увидите, сколько уже пройдено.</p></div><button class="secondary" data-action="import">${icon('upload')} Учесть мои сертификаты</button></section>
 <div class="notice">${icon('check')} Статусы обновляются из ручных отметок и локального импорта. PDF остаются на вашем устройстве.</div>`;
}
function viewSwitch(){return `<div class="view-switch" role="group" aria-label="Вид каталога"><button data-layout="grid" aria-label="Показать карточки" aria-pressed="${settings.layout!=='list'}" class="${settings.layout!=='list'?'active':''}" title="Карточки">${icon('grid')}<span>Карточки</span></button><button data-layout="list" aria-label="Показать список" aria-pressed="${settings.layout==='list'}" class="${settings.layout==='list'?'active':''}" title="Список">${icon('list')}<span>Список</span></button></div>`;}
function completedGroups(list){
 const groups=new Map();for(const c of list){const key=assignedSubjects(c,settings)[0]||'other';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 return [...groups].map(([id,courses])=>`<section class="completed-group" data-completed-subject="${id}"><div class="completed-group-heading"><div><span class="tag ${id.toLowerCase()}">${id==='other'?'КУРСЫ':esc(baseSubjects[id]?id:subjects[id])}</span><h2>${esc(subjects[id]||'Без предмета')}</h2></div><span class="completed-count">${courses.length} пройдено</span></div><div class="grid catalog-grid ${settings.layout==='list'?'list-view':''}">${courses.map(card).join('')}</div></section>`).join('');
}
function completedPage(){
 const list=catalog.filter(c=>r(c).status==='done');
 return `<div class="page-heading catalog-heading"><div><h1>Пройденные курсы</h1><p class="muted">${list.length} завершено · распределены по основному предмету</p></div><button class="secondary" data-action="progress-paste">${icon('check')} Учесть пройденные</button></div><div class="catalog-toolbar"><p class="course-group-note">Каждый курс учитывается в общем прогрессе один раз.</p>${viewSwitch()}</div>${list.length?completedGroups(list):empty('Здесь будут пройденные курсы','<p>Вставьте список Coursera, загрузите Excel или измените статус курса.</p><button class="secondary" data-action="progress-paste">Учесть уже пройденные</button>')}`;
}
function courseList(){
 const list=catalog.filter(c=>(scope!=='plan'||r(c).inPlan&&inVariant(c,settings.variant))&&matchesSearch(c,query)&&(!subject||assignedSubjects(c,settings).includes(subject))&&(!status||r(c).status===status)&&(!hide||r(c).status!=='done'));
 const remaining=list.filter(c=>r(c).status!=='done'),done=list.filter(c=>r(c).status==='done');
 return `<div class="page-heading catalog-heading"><div><h1>Мои курсы</h1><p class="muted">${catalog.length} в каталоге · ${plan(catalog,records,settings.variant).length} в моём плане</p></div><div class="excel-toolbar"><button class="primary" data-action="excel">${icon('upload')} Добавить из Excel</button><button class="secondary" data-action="import">Импорт результатов</button></div></div>
 <div class="catalog-toolbar"><div class="tabs"><button data-scope="all" class="${scope==='all'?'selected':''}">Все курсы <b>${catalog.length}</b></button><button data-scope="plan" class="${scope==='plan'?'selected':''}">Мой план <b>${plan(catalog,records,settings.variant).length}</b></button><a href="#completed">Пройденные <b>${catalog.filter(c=>r(c).status==='done').length}</b></a></div>${viewSwitch()}</div>
 <section class="filters" aria-label="Фильтры каталога"><label class="search">${icon('search')}<input id="search" type="search" placeholder="Что хотите изучить?" value="${esc(query)}" aria-label="Поиск курсов"></label><label>Направление<select id="subject"><option value="">Все направления</option>${Object.entries(subjects).map(([k,v])=>`<option value="${k}" ${subject===k?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Статус<select id="status"><option value="">Все статусы</option>${Object.entries(statuses).map(([k,v])=>`<option value="${k}" ${status===k?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label class="checkbox"><input id="hide" type="checkbox" ${hide?'checked':''}> Скрыть пройденные</label></section>
 <div class="list-meta"><span>Найдено <b>${list.length}</b> из ${catalog.length}</span><button class="text" data-action="reset">Сбросить фильтры</button></div><div id="catalog-grid" class="grid catalog-grid ${settings.layout==='list'?'list-view':''}">${remaining.map(card).join('')||(!done.length?empty('По этим фильтрам ничего не найдено','<button class="secondary" data-action="reset">Сбросить фильтры</button>'):'')}</div>${done.length?`<div class="completed-summary"><h2>Пройденные</h2><a href="#completed">Открыть отдельный раздел →</a></div>${completedGroups(done)}`:''}`;
}
function certificates(){
 const list=catalog.filter(c=>r(c).status==='done');
 return `<div class="page-heading certificate-heading"><div><h1>Сертификаты</h1><p class="muted">Документы о пройденных курсах — в одном месте.</p></div><button class="primary" data-action="import">${icon('upload')} Добавить сертификаты</button></div>${list.length?`<div class="catalog-toolbar"><p class="muted small">Завершено курсов: <b>${list.length}</b></p>${viewSwitch()}</div><div id="catalog-grid" class="grid catalog-grid ${settings.layout==='list'?'list-view':''}">${list.map(card).join('')}</div>`:empty('Сертификаты появятся после завершения курса','<p>Добавьте PDF или отметьте пройденный курс вручную.</p><button class="secondary" data-action="import">Загрузить сертификаты</button>')}
 <section class="panel import-panel"><p class="eyebrow">ВАШИ ДАННЫЕ ОСТАЮТСЯ У ВАС</p><h2>Добавьте уже пройденное</h2><p>Для автоматического сопоставления PDF укажите имя, как в сертификате.</p><label>Владелец профиля<input id="owner" value="${esc(settings.owner)}" placeholder="Имя и фамилия"></label><div class="button-row"><button class="secondary" data-action="files">${icon('upload')} Загрузить PDF / CSV / JSON</button>${'showDirectoryPicker' in window?`<button class="secondary" data-action="folder">${directory?'Восстановить доступ / проверить':'Подключить папку PDF'}</button>`:''}${directory?'<button class="text" data-action="disconnect">Отключить папку</button>':''}<button class="text" data-action="documents">Документы и привязки ↗</button></div><p class="small muted">${settings.scan?`Последняя проверка: ${esc(new Date(settings.scan.at).toLocaleString('ru-RU'))} · добавлено: ${settings.scan.added}, пропущено: ${settings.scan.skipped}, требуют выбора: ${settings.scan.review}`:'Папка ещё не проверялась.'}</p><p class="small muted">Сохраняйте новые сертификаты в подключённую папку. Проверка работает при открытии и пока вкладка видима. PDF и разрешение на папку не переносятся в JSON.</p></section>`;
}
function week(variant,num,title){
 const rows=se.filter(row=>row[0]===variant&&row[1]===num);
 return `<details class="week"><summary><span class="week-number">${String(num).padStart(2,'0')}</span><span>${esc(title)}</span><small>${rows.filter(row=>row[4]==='Прямое'&&row[3]&&r(cById(row[3])).status==='done').length} / ${rows.length} подтверждений</small><span class="disclosure-icon" aria-hidden="true">+</span></summary><div class="week-body"><p class="small muted">Источник: SE · Завершение курса и зачёт в университете учитываются отдельно.</p>${rows.map(row=>{const c=cById(row[3]),done=c&&r(c).status==='done';return `<div class="subtopic"><div>${esc(row[2])}<small class="${row[4]==='Прямое'&&done?'done-text':'muted'}">${esc(row[4])} · ${!c?'Пробел / практика':done?'Курс пройден':'Курс не пройден'}${row[4]!=='Прямое'?' · тема требует проверки':''}</small></div>${c?`<button class="text" data-action="details" data-id="${c.id}">${esc(c.title)} ↗</button>`:''}</div>`;}).join('')}${rows.length?'':'<p>Повторение, экзамен или собственная практика. Новый курс не создаётся.</p>'}</div></details>`;
}
function alternatives(id){
 return Object.entries(relations).filter(([key])=>!['СИЛЛАБУСЫ SE','ПОДТЕМЫ SE'].includes(key)).map(([source,rows])=>{
 const list=rows.filter(row=>{
  if(row[0]!==id&&!(id==='ARCH'&&['UML','GO'].includes(row[0])))return false;
  if(id!=='ARCH'||settings.variant==='ALL')return true;
  const variant=['UML','GO'].includes(row[0])?row[0]:source.includes('XLS')?(String(row[1]).includes('(M)')?'GO':'UML'):/Мукатаев/.test(row[4])?'GO':'UML';
  return variant===settings.variant;
 });
 const label=source.includes('XLS')?'XLS · альтернативные сопоставления':source.includes('ПРАКТИКА')?'SE · практика и документы':'LIST · ваши сопоставления';
 return `<div class="source-group"><h4>${esc(label)} <span>${list.length}</span></h4><div class="source-list">${list.map(row=>{
  const user=source.includes('СПИСКА'),ids=user?[row[1]]:Array.isArray(row[3])?row[3]:String(row[3]).split(/,\s*/).filter(code=>cById(code));
  return `<div class="source-row"><span class="source-index">${user?esc(row[0]):esc(row[1])}</span><div class="source-content"><strong>${esc(user?row[2]:row[2])}</strong><p>${esc(!user?row[4]:'Сопоставление пользователя')}</p><div class="source-courses">${ids.map(code=>cById(code)?`<button class="tag" data-action="details" data-id="${code}">${esc(cById(code).title)} ↗</button>`:'').join('')||'<span class="muted small">Онлайн-курс не назначен</span>'}</div></div></div>`;
 }).join('')}</div></div>`;
 }).join('');
}
function syllabusPage(){
 return `<div class="notice">Цель: 90+ · Сценарный балл: 95. Это плановые ориентиры. Решение о зачёте принимает ваш университет.</div>${Object.entries(baseSubjects).map(([id,title])=>{
 const cs=plan(catalog,records,settings.variant).filter(c=>assignedSubjects(c,settings).includes(id)),d=cs.filter(c=>r(c).status==='done').length;
 return `<section class="subject panel"><div class="section-heading"><div><span class="tag ${id.toLowerCase()}">${id}</span><h2>${title}</h2></div><span class="subject-count">${d} / ${cs.length} курсов плана</span></div><label class="credit-field">Решение по зачёту<select data-credit="${id}"><option value="">Не запрашивалось</option>${['На рассмотрении','Зачтено','Не зачтено'].map(s=>`<option ${settings.credits?.[id]===s?'selected':''}>${s}</option>`).join('')}</select></label>${variantFor(id).map(v=>`<h3>${v==='UML'?'UML · Ассель Смайыл':v==='GO'?'Go · Тлеужан Мукатаев':'Недельный план SE'}</h3><div class="week-list">${syllabi.filter(row=>row[0]===v).map(row=>week(...row)).join('')}</div>`).join('')}${id==='CAP'?`<h3>Практические результаты Capstone</h3><div class="practice-list">${['План проекта','Собственная разработка','Final Paper','Презентация'].map((s,i)=>`<label class="checkbox"><input type="checkbox" data-practice="${i}" ${settings.practice?.[i]?'checked':''}>${s}</label>`).join('')}</div>`:''}<details class="alternatives"><summary>Другие источники и альтернативы <span class="disclosure-icon" aria-hidden="true">+</span></summary>${alternatives(id)}</details></section>`;
 }).join('')}`;
}
function subjectPage(){return subjectUI.render()+(settings.catalogMode!=='empty'?`<details class="syllabus-reference panel"><summary>Недельный план и исходные сопоставления SE</summary>${syllabusPage()}</details>`:'');}
function sidebar(){
 const p=progress(catalog,records,settings.variant);
 return `<aside class="sidebar" aria-label="Боковая панель"><div class="sidebar-header"><a class="brand" href="#overview" aria-label="Курс за курсом — на главную" title="Курс за курсом"><span class="brand-mark">${icon('mark')}</span><span class="brand-copy">Курс <b>за курсом</b><small>ЛИЧНЫЙ ТРЕКЕР</small></span></a><button class="sidebar-toggle" data-action="sidebar-toggle" aria-controls="sidebar-navigation"></button></div><p class="nav-label">МОЁ ОБУЧЕНИЕ</p><nav id="sidebar-navigation" aria-label="Главная навигация">${nav.map(([id,iconName,title])=>`<a href="#${id}" aria-label="${title}" title="${title}" ${view===id?'aria-current="page"':''} class="${view===id?'current':''}"><span class="nav-symbol">${icon(iconName)}</span><span class="nav-copy">${title}</span>${id==='courses'?`<small>${catalog.length}</small>`:''}</a>`).join('')}</nav><div class="sidebar-bottom"><a class="sidebar-progress" href="#courses?plan"><span>Мой план <strong>${p.percent}%</strong></span><div class="sidebar-progress-track" aria-hidden="true"><i style="width:${p.percent}%"></i></div><small>${p.done} из ${p.total} курсов пройдено ${icon('arrow')}</small></a><div class="sidebar-utilities"><button data-action="settings" aria-label="Настройки и резервная копия" title="Настройки и резервная копия">${icon('settings')}<span class="nav-copy">Настройки и данные</span></button><a href="#setup" aria-label="Расширение и свой сайт" title="Расширение и свой сайт" ${view==='setup'?'aria-current="page"':''}>${icon('extension')}<span class="nav-copy">Расширение</span></a></div><div class="local-dot" title="Данные сохраняются на этом устройстве"><span>Сохранено на устройстве</span></div></div></aside>`;
}
function applySidebar(){
 const collapsed=settings.sidebarCollapsed===true;$('#app').dataset.sidebar=collapsed?'collapsed':'expanded';
 const toggle=$('[data-action="sidebar-toggle"]');if(!toggle)return;
 const label=collapsed?'Развернуть панель':'Свернуть панель';toggle.innerHTML=icon(collapsed?'expand':'panel');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',label);toggle.title=label;
}
function render(){
 const focusedSelect=document.activeElement?.dataset.selectTrigger;closeSelectMenu();
 const nextView=location.hash.slice(1).split('?')[0]||'overview',entering=nextView!==view||!$('#app').children.length;
 view=nextView;
 if(!nav.some(n=>n[0]===view)&&!extraViews[view])view='overview';
 if(location.hash.includes('?plan'))scope='plan';
 $('#app').innerHTML=`${sidebar()}
 <main><header class="topbar"><div class="topbar-left"><a class="mobile-brand" href="#overview" aria-label="Курс за курсом">${icon('mark')}<span>Курс за курсом</span></a><span class="breadcrumb">Личное пространство <span>/</span> <b>${nav.find(n=>n[0]===view)?.[2]||extraViews[view]}</b></span></div><div class="header-actions"><label class="variant">Архитектура<select id="variant"><option value="ALL">Обе версии</option><option value="UML" ${settings.variant==='UML'?'selected':''}>UML</option><option value="GO" ${settings.variant==='GO'?'selected':''}>Go</option></select></label><button class="theme-toggle" data-action="theme" aria-label="${currentTheme()==='dark'?'Включить светлую тему':'Включить тёмную тему'}" aria-pressed="${currentTheme()==='dark'}">${themeButton()}</button></div></header><div class="content ${entering?'page-enter':''}">${view==='courses'?courseList():view==='completed'?completedPage():view==='certificates'?certificates():view==='subjects'?subjectPage():view==='setup'?setupPage():overview()}<footer><span class="footer-name">Курс за курсом</span><div class="footer-links"><a href="#setup">Расширение и свой сайт</a><button class="text" data-action="settings">${icon('settings')} Мои данные</button></div></footer></div></main><input hidden type="file" id="files" accept=".pdf,.csv,.json" multiple><input hidden type="file" id="excel-file" accept=".xlsx,.xls"><dialog id="dialog"></dialog>`;
 enhanceSelects($('#app'));applySidebar();
 if(focusedSelect)document.querySelector(`[data-select-trigger="${CSS.escape(focusedSelect)}"]`)?.focus({preventScroll:true});
}
function modal(title,html){closeSelectMenu();const d=$('#dialog');d.innerHTML=`<div class="modal-heading"><h2>${title}</h2><button class="icon" data-action="close" aria-label="Закрыть">${icon('close')}</button></div>${html}`;enhanceSelects(d);if(!d.open)d.showModal();}
function setupPage(){
 const zip=import.meta.env.BASE_URL+'course-progress-extension.zip',github='https://github.com/'+projectRepository;
 return `<div class="page-heading catalog-heading"><div><h1>Свой сайт и расширение</h1><p class="muted">Отдельный адрес и локальные данные для каждого владельца.</p></div></div><section class="panel download-panel"><img src="${import.meta.env.BASE_URL}brand-logo.png" width="56" height="56" alt="Логотип Курс за курсом"><div><h2>Расширение Chrome 1.3</h2><p>Читает отображаемые завершённые и активные курсы в «Моём обучении» Coursera.</p><div class="button-row"><a class="primary" href="${zip}" download>Скачать расширение ZIP</a><a class="secondary" href="${github}/releases" target="_blank" rel="noopener noreferrer">Релизы GitHub ↗</a></div><p class="small muted">Этот ZIP собран для адреса ${esc(location.origin+location.pathname)}. Для своей копии скачивайте расширение со своего сайта.</p></div></section><section class="panel onboarding-panel"><h2>Установить или обновить расширение</h2><ol><li>Распакуйте ZIP в постоянную папку.</li><li>В <code>chrome://extensions</code> включите «Режим разработчика» и выберите «Загрузить распакованное расширение».</li><li>При обновлении замените файлы в прежней папке и нажмите ↻ у расширения.</li><li>Обновите Coursera и трекер. В окне расширения подтвердите чтение и откройте «Завершённые» или «В процессе».</li></ol><p class="small muted">Расширение читает загруженные карточки и подставляет персональные ссылки сертификатов. Если ссылка открывается отдельной страницей, откройте сертификат один раз — он привяжется к точному курсу. Скрытые разделы оно не открывает. Перед сменой аккаунта отключите и очистите расширение.</p></section><section class="panel onboarding-panel"><h2>Личная копия для знакомого</h2><p>Каждый создаёт свой репозиторий и свой GitHub Pages. Новая копия начинается с пустого каталога и предметов. Добавьте свои курсы из Excel и создайте свои предметы.</p><a class="primary" href="https://github.com/Rumm1/aitu-course-tracker/generate" target="_blank" rel="noopener noreferrer">Создать мою копию сайта ↗</a><ol><li>Войдите в свой GitHub и нажмите кнопку создания копии.</li><li>В новом репозитории откройте Settings → Pages → Source → GitHub Actions.</li><li>В Actions запустите Publish GitHub Pages и дождитесь публикации.</li><li>Откройте свой адрес Pages. При необходимости загрузите свой Excel и скачайте ZIP расширения уже со своей страницы.</li></ol></section><section class="panel"><h2>Данные только у владельца</h2><p>Каталог из Excel, статусы, проценты, темы и настройки сохраняются в IndexedDB этого браузера. Сайт не отправляет их в GitHub и не объединяет с данными других людей.</p><p class="small muted">Для другого устройства перенесите резервную копию JSON. Очистка данных браузера удаляет локальное хранилище. PDF и разрешения на папку в JSON не входят.</p><button class="secondary" data-action="export">Экспорт моих данных JSON</button></section>`;
}
let excelImporter=null;
async function readExcelInput(file){
 if(!excelImporter){const {createExcelImporter}=await import('./excel-ui.js');excelImporter=createExcelImporter({modal,getCatalog:()=>catalog,getSubjects:()=>subjects,apply:applyExcelEntries,onError:error});}
 await excelImporter.load(file);
}
async function applyExcelEntries(entries,fileName){
 let added=0,updated=0,conflicts=0;const at=new Date().toISOString();
 let nextSettings=settings;
 for(const item of entries){if(!item.course||item.issues.length||item.duplicate||item.skipped)continue;for(const name of item.subjectNames||[]){const found=Object.entries(allDefinitions(nextSettings)).find(([,label])=>normalize(label)===normalize(name));if(!found)nextSettings=createSubject(nextSettings,name);else if(nextSettings.hiddenSubjects?.includes(found[0]))nextSettings={...nextSettings,hiddenSubjects:nextSettings.hiddenSubjects.filter(id=>id!==found[0])};}}
 settings=nextSettings;refreshSubjects();
 for(const item of entries){
  if(!item.course||item.issues.length||item.duplicate||item.skipped)continue;
  const existing=cById(item.courseId),before=records[item.courseId]||null;
  const itemSubjects=[...new Set([...(item.subjects||[]),...(item.subjectNames||[]).map(name=>Object.entries(subjects).find(([,label])=>normalize(label)===normalize(name))?.[0]).filter(Boolean)])];
  if(item.isNew&&!existing){customCourses=mergeLocalCourses(customCourses,[{...item.course,subjects:itemSubjects,subjectSource:item.subjectSource,addedAt:at}]);refreshCatalog();added++;}
  const c=cById(item.courseId);if(!c)continue;
  if(itemSubjects.length){const current=settings.subjectAssignments&&Object.hasOwn(settings.subjectAssignments,c.id)?settings.subjectAssignments[c.id]:c.subjects;settings.subjectAssignments={...settings.subjectAssignments,[c.id]:[...new Set([...(current||[]),...itemSubjects])]};}
  const incoming={...item.record,source:'Excel · '+fileName};
  if(incoming.percent!==undefined)incoming.progressUpdatedAt=at;
  if(incoming.inPlan!==undefined&&before&&Object.hasOwn(before,'inPlan'))delete incoming.inPlan;
  const merged=mergeRecord(r(c),incoming);if(merged.conflict)conflicts++;
  if(incoming.inPlan!==undefined&&!before)merged.next.inPlan=!!incoming.inPlan;
  records[c.id]=merged.next;if(item.record?.status||item.record?.percent!==undefined)updated++;
 }
 await save();$('#dialog').close();history.replaceState(null,'','#courses');render();toast(`Excel: добавлено ${added}, обновлено ${updated}${conflicts?', сохранены ручные исправления: '+conflicts:''}`);void checkExtensionProgress({automatic:true});
}
function details(id){
 const c=cById(id),s=r(c);
 modal(esc(c.title),`<div class="detail-meta"><span class="tag">${kinds[c.kind]}</span><span>${esc(c.provider||'Провайдер не указан')}</span></div><p class="course-meta">${icon('clock')}${esc(hours(c))}</p><p class="small muted">Источники: ${esc(c.sources.join(', '))} · ID: ${c.id}</p>${/ASP.NET|C#|\.NET/.test(c.title)?'<p class="notice">Практика на C#. Привязка к версии Go не меняет язык курса.</p>':''}${c.linkState==='requires-check'?`<p class="notice">Ссылка требует проверки. Исходный адрес: ${esc(c.url)}</p><button class="secondary" data-action="replace-url" data-id="${id}">Заменить URL курса</button>`:''}<div class="button-row">${primary(c)}<button class="secondary" data-action="edit-status" data-id="${id}">Изменить статус</button>${s.status==='done'?`<button class="secondary" data-action="certificate" data-id="${id}">Добавить / изменить ссылку</button>${c.url.includes('coursera.org')?'<a target="_blank" rel="noopener noreferrer" href="https://www.coursera.org/accomplishments">Мои достижения ↗</a>':''}`:''}</div><h3>Где пригодится этот курс</h3><ul class="relation-list">${linksFor(id).map(row=>`<li class="relation-row"><span class="source-pill">${esc(row.source)}</span><div><strong>${esc(row.topic)}</strong><p>${esc(row.variant)} · ${esc(row.week)} · ${esc(row.coverage)}</p></div></li>`).join('')||'<li class="muted small">Смотрите альтернативные сопоставления в разделе «Предметы».</li>'}</ul><p class="muted small">Членство в программах не предполагается автоматически. Сертификат программы не подтверждает отдельные курсы.</p>`);
}
function editStatus(id){const s=r(cById(id));modal('Статус курса',`<form id="status-form" data-id="${id}"><label>Статус<select name="status">${Object.entries(statuses).map(([k,v])=>`<option value="${k}" ${s.status===k?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Дата завершения, если известна<input name="completedAt" type="date" value="${esc((s.completedAt||'').slice(0,10))}"></label><p class="small muted">Ручное исправление сохраняется при повторном импорте того же документа.</p><button class="primary">Сохранить</button></form>`);}
function editCert(id){const s=r(cById(id));modal('Персональный сертификат',`<form id="cert-form" data-id="${id}"><p>Вставьте ссылку на выданный вам сертификат этого курса.</p><label>HTTPS URL<input name="url" type="url" required value="${esc(s.certificateUrl||'')}"></label><button class="primary">Сохранить ссылку</button><p class="small muted">Ссылка не меняет статус курса. Кнопка сертификата появится после подтверждения завершения.</p></form>`);}
function importModal(){modal('Учесть мои результаты',`<p>PDF, CSV и JSON обрабатываются локально. Никакие документы не отправляются на сервер.</p><label>Имя владельца, как в сертификате<input id="import-owner" value="${esc(settings.owner)}"></label><div class="button-row"><button class="primary" data-action="files">Выбрать файлы</button>${'showDirectoryPicker'in window?'<button class="secondary" data-action="folder">Подключить папку PDF</button>':''}</div><p class="small muted">Для CSV/JSON нужны ID или точное название и явный статус. Неоднозначные записи попадут на проверку. На телефоне выберите несколько PDF.</p>`);}
function settingsModal(){modal('Ваше пространство',`<div class="settings-appearance"><p class="eyebrow">ОФОРМЛЕНИЕ</p><label>Тема<select id="theme-preference"><option value="system" ${settings.theme==='system'?'selected':''}>Как в системе</option><option value="light" ${settings.theme==='light'?'selected':''}>Светлая</option><option value="dark" ${settings.theme==='dark'?'selected':''}>Тёмная</option></select></label><p class="small muted">Выбор темы и вида каталога запоминается на этом устройстве.</p></div><p class="eyebrow">ПРОФИЛЬ И ДАННЫЕ</p><label>Владелец профиля<input id="import-owner" value="${esc(settings.owner)}"></label><div class="button-row"><button class="primary" data-action="export">${icon('arrow')} Экспорт JSON</button><button class="secondary" data-action="files">${icon('upload')} Импорт JSON / CSV / PDF</button></div><p>Резервная копия содержит личные статусы и ссылки. Храните её у себя.</p><p class="small muted">Прогресс принадлежит этому браузеру. PDF и разрешение на папку не входят в резервную копию.</p><button class="text" data-action="documents">Документы и отмена привязок ↗</button>`);}
function openProgressPaste(mode='done'){
 const connection=extensionState?.enabled?'Расширение включено, но сохранённого списка пока нет. Откройте «Моё обучение» или вставьте список ниже.':'Официальное API не подключено. Можно вставить список или установить локальное расширение браузера.';
 modal('Проверить мой прогресс',`<p class="connection-state">${icon('list')} ${connection}</p><ol class="paste-steps"><li><a class="secondary" href="https://www.coursera.org/my-learning" target="_blank" rel="noopener noreferrer">Открыть «Моё обучение» ↗</a></li><li>Откройте «Завершённые» или «В процессе», скопируйте список целиком и вставьте ниже.</li></ol><form id="progress-paste-form"><label>Какой список вы скопировали?<select name="mode"><option value="done" ${mode==='done'?'selected':''}>Завершённые</option><option value="active" ${mode==='active'?'selected':''}>В процессе</option><option value="mixed" ${mode==='mixed'?'selected':''}>Оба раздела вместе, с названиями разделов</option></select></label><label>Список курсов<textarea name="text" rows="10" required maxlength="500000" placeholder="Вставьте скопированный список целиком. Названия, проценты и ссылки распознаются автоматически."></textarea></label><p class="small muted">Точные совпадения применятся сразу. Процент появится только из вашего списка или явного числа выполненных заданий. Неизвестные названия не создадут новые курсы.</p><div class="button-row"><button class="primary" type="submit">${icon('check')} Учесть весь список</button></div></form><details class="extension-install"><summary>Автоматический перенос через расширение Chrome</summary><p>После включения расширение читает загруженные курсы в «Моём обучении» и открытые персональные страницы сертификатов. Данные передаются трекеру внутри браузера, без отправки на сервер.</p><a class="secondary" href="${import.meta.env.BASE_URL}course-progress-extension.zip" download>Скачать расширение ZIP</a><ol><li>Распакуйте ZIP в отдельную папку.</li><li>Откройте <code>chrome://extensions</code>, включите «Режим разработчика» и выберите «Загрузить распакованное расширение».</li><li>Выберите папку, откройте значок расширения и включите передачу прогресса.</li><li>Обновите страницу трекера и откройте «Моё обучение». Для старых завершений откройте «Завершённые» и загрузите нужные строки списка.</li></ol><p class="small muted">Учитываются только уже отображённые курсы. Расширение не входит в аккаунт, не читает cookies и не открывает разделы тайно. Перед сменой аккаунта отключите передачу и очистите данные в расширении. На телефоне используйте вставку списка.</p></details>`);
}
async function applyProgressMatches(items,key,at,{source='Вставленный список Coursera',prefix='paste'}={}){
 const result={completed:0,updated:0,unchanged:0,conflicts:0};
 for(const item of items){
  const c=cById(item.courseId);if(!c||!['done','active'].includes(item.status))continue;
  const before=records[c.id]||null,current=r(c),documentKey=`${prefix}:${key}:${c.id}`;
  const incoming={status:item.status,source,documentKey};
  for(const field of ['percent','completedTasks','totalTasks','progressSource'])if(item[field]!==undefined)incoming[field]=item[field];
  if(incoming.percent!==undefined||incoming.totalTasks!==undefined)incoming.progressUpdatedAt=validDate(item.progressUpdatedAt)||at;
  if(item.certificateUrl){const url=certificateURL(item.certificateUrl,c);if(url)incoming.certificateUrl=url;}
  const merged=mergeRecord(current,incoming);
  if(merged.conflict){result.conflicts++;continue;}
  const changed=['status','percent','completedTasks','totalTasks','certificateUrl','completedAt'].some(field=>JSON.stringify(current[field])!==JSON.stringify(merged.next[field]));
  if(current.status!=='done'&&merged.next.status==='done')result.completed++;
  else if(changed)result.updated++;
  else result.unchanged++;
  records[c.id]=merged.next;
  const prior=await store.get('documents',documentKey);
  await store.put('documents',documentKey,{name:source,courseId:c.id,before:prior?.applied?prior.before:before,after:merged.next,applied:true});
 }
 return result;
}
async function applyPastedProgress(text,mode){
 if(busy)throw Error('Дождитесь текущей проверки');
 busy=true;
 try{
  const {parseProgressText}=await import('./progress-import.js');
  // The section explicitly chosen by the user is completion/status evidence;
  // later section headings in a mixed copy still take precedence.
  const selectedText=mode==='done'?'Completed\n'+text:mode==='active'?'In Progress\n'+text:text;
  const parsed=parseProgressText(selectedText,catalog,{mode});
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(mode+'\n'+text));
  const key=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join(''),at=new Date().toISOString();
  const applied=await applyProgressMatches(parsed.matches,key,at);
  settings.progressClarifications=parsed.ambiguous.map(item=>({...item,key,at}));
  settings.progressUnmatched=parsed.unmatched;
  settings.lastProgressCheck={at,source:'Вставленный список Coursera',method:'paste',summary:{found:parsed.matches.length+parsed.ambiguous.length,...applied,clarify:parsed.ambiguous.length}};
  await save();$('#dialog').close();history.replaceState(null,'','#overview');render();
  toast(progressSummaryText(settings.lastProgressCheck.summary));
  if(settings.progressClarifications.length)showProgressClarifications();
  else $('.progress-result')?.focus({preventScroll:true});
 }finally{busy=false;}
}
function showProgressClarifications(){
 const rows=settings.progressClarifications||[];
 if(!rows.length)return toast('Все точные совпадения уже учтены');
 modal('Уточните только неоднозначные совпадения',`<p>Точные названия уже применены. Для этих записей найдено несколько вариантов.</p><form id="progress-resolve-form">${rows.map((item,index)=>`<div class="review-row"><strong>${esc(item.title)}</strong><p class="small muted">${item.status==='done'?'Пройден':item.status==='active'?`В процессе${item.percent!==undefined?' · '+item.percent+'%':''}`:'Статус не определён'}</p><label>Выберите курс<select name="course-${index}"><option value="">Пока пропустить</option>${item.candidates.map(id=>cById(id)).filter(Boolean).map(c=>`<option value="${c.id}">${esc(c.title)} · ${esc(c.provider||kinds[c.kind])}</option>`).join('')}</select></label>${!item.status?`<label>Статус<select name="status-${index}"><option value="done">Пройден</option><option value="active">В процессе</option></select></label>`:''}</div>`).join('')}<button type="submit" class="primary">Применить выбранные</button></form>`);
}
async function resolveProgressClarifications(data){
 const remaining=[],rows=settings.progressClarifications||[];
 for(const [index,item]of rows.entries()){
  const id=data.get('course-'+index);if(!id){remaining.push(item);continue;}
  if(!item.candidates.includes(id))throw Error('Выберите один из найденных вариантов');
  const applied=await applyProgressMatches([{...item,courseId:id,status:item.status||data.get('status-'+index)}],item.key,item.at,{source:item.source||'Вставленный список Coursera',prefix:item.prefix||'paste'});
  for(const field of ['completed','updated','unchanged','conflicts'])settings.lastProgressCheck.summary[field]+=applied[field];
 }
 settings.progressClarifications=remaining;settings.lastProgressCheck.summary.clarify=remaining.length;
 await save();$('#dialog').close();render();toast(progressSummaryText(settings.lastProgressCheck.summary));
}
async function checkExtensionProgress({automatic=false,payload=null}={}){
 if(extensionBusy||busy||automatic&&($('#dialog')?.open||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)))return false;
 extensionBusy=true;
 try{
  const state=payload||await requestExtension(900,catalog);extensionState=state;
  if(!state?.enabled)return false;
  const discovered=reconcileExtensionCatalog(catalog,customCourses,state);
  if(discovered.added){customCourses=discovered.customCourses;refreshCatalog();await save();}
  const rows=discovered.rows;
  if(!rows.length){if(discovered.added){render();if(!automatic)toast(`Добавлено курсов из Coursera: ${discovered.added}. Предметы можно выбрать в разделе «Предметы».`);return true;}return false;}
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({rows,ambiguous:state.ambiguous||[]})));
  const key=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  if(automatic&&settings.extensionRevision===key)return true;
  const at=new Date().toISOString(),observed=validDate(state.capturedAt)||at,source='Расширение браузера · видимая страница Coursera';
  const applied=await applyProgressMatches(rows,key,observed,{source,prefix:'extension'});
  const ambiguous=(state.ambiguous||[]).filter(item=>item&&typeof item.title==='string'&&Array.isArray(item.candidates)).map(item=>({...item,candidates:item.candidates.filter(id=>cById(id)),key,at:observed,source,prefix:'extension'})).filter(item=>item.candidates.length);
  settings.extensionRevision=key;settings.progressClarifications=ambiguous;
  settings.progressUnmatched=(state.unmatched||[]).filter(item=>item&&typeof item.title==='string').slice(0,40);
  settings.lastProgressCheck={at,capturedAt:observed,source,method:'extension',summary:{found:rows.length+ambiguous.length,...applied,clarify:ambiguous.length}};
  await save();render();
  if(!automatic){history.replaceState(null,'','#overview');render();toast(progressSummaryText(settings.lastProgressCheck.summary));if(ambiguous.length)showProgressClarifications();}
  return true;
 }catch(err){if(!automatic)error(err);return false;}finally{extensionBusy=false;}
}
onExtensionProgress(payload=>{void checkExtensionProgress({automatic:true,payload});});
async function exportBackup(){const data={app:'aitu-course-tracker',version:1,exportedAt:new Date().toISOString(),courses:customCourses,records:Object.fromEntries(Object.entries(records).map(([id,{pdfKey,documentKey,...rest}])=>[id,rest])),settings:{owner:settings.owner,variant:settings.variant,credits:settings.credits,practice:settings.practice,theme:settings.theme,layout:settings.layout,sidebarCollapsed:settings.sidebarCollapsed,catalogMode:settings.catalogMode,...validateSubjectSettings(settings,catalog)}};download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'course-progress.json');}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function openPDF(id){const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;const file=await store.get('pdfs',r(cById(id)).pdfKey);if(!file){tab?.close();return toast('PDF недоступен. Загрузите файл повторно или добавьте ссылку.');}const url=URL.createObjectURL(file);if(tab)tab.location.href=url;else download(file,'certificate.pdf');setTimeout(()=>URL.revokeObjectURL(url),60000);}

async function stageRows(rows,source,fileKey){
 for(const [index,row] of rows.entries()){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Каждая строка отчёта должна быть объектом');
  const documentKey=fileKey+':'+index;
  const prior=await store.get('documents',documentKey);
  if(prior?.ignored||prior?.applied||pending.some(item=>item.documentKey===documentKey))continue;
  const candidates=matchRecord(row,catalog),c=candidates.length===1?candidates[0]:null;
  const st=reportStatus(row.status),url=c&&row.certificateUrl?certificateURL(row.certificateUrl,c):undefined;
  const item={row,candidates:candidates.map(c=>c.id),courseId:c?.id,status:st,certificateUrl:url,completedAt:validDate(row.completedAt),grade:row.grade,source,documentKey,reason:!st?'Нет явного статуса завершения':!c?'Неоднозначный или неизвестный курс':row.certificateUrl&&!url?'Ссылка сертификата не прошла проверку':''};
  pending.push(item);await store.put('documents',documentKey,{name:source,staged:item,applied:false});
 }
}
async function importFile(file){if(file.size>40*1024*1024)throw Error('Файл больше 40 МБ: '+file.name);const {fingerprint,readPDF}=await import('./pdf.js');const key=await fingerprint(file);const prior=await store.get('documents',key);if(prior?.ignored||prior?.applied||pending.some(item=>item.documentKey===key))return {skipped:1};
 if(/\.pdf$/i.test(file.name)){
 const parsed=await readPDF(file,catalog,settings.owner);await store.put('pdfs',key,file);await store.put('documents',key,{name:file.name,parsed,applied:false});
 if(parsed.courseId&&!parsed.reason){const c=cById(parsed.courseId),incoming={status:'done',certificateUrl:parsed.certificateUrl,completedAt:parsed.completedAt,pdfKey:key,documentKey:key,source:'PDF · '+file.name};const merged=mergeRecord(r(c),incoming);if(!merged.conflict){const before=records[c.id]||null;records[c.id]=merged.next;await store.put('documents',key,{name:file.name,courseId:c.id,before,after:merged.next,applied:true});await save();return {added:1};}}
 pending.push({...parsed,source:'PDF · '+file.name,documentKey:key,pdfKey:key,status:parsed.issued?'done':null,reason:parsed.reason||'Конфликт с ручным исправлением'});return {review:1};
 }
 const text=await file.text();
 if(/\.json$/i.test(file.name)){
 const data=JSON.parse(text);if(data?.app==='aitu-course-tracker'){
 const fromBackup=validateLocalCourses(data.courses||[]).filter(c=>!cById(c.id));
 const nextPending=mergeLocalCourses(pendingCatalog,fromBackup),available=[...(data.settings?.catalogMode==='curated'?baseCatalog:catalog),...nextPending];
 const imported=validateBackup(data,available);pendingCatalog=nextPending;for(const [id,row]of Object.entries(imported)){
 const documentKey=key+':'+id,previous=await store.get('documents',documentKey);
 if(previous?.applied||previous?.ignored||pending.some(item=>item.documentKey===documentKey))continue;
 const item={...row,backup:true,courseId:id,source:row.source||'Резервная копия',documentKey,reason:mergeBackupRecord(records[id]||{},row).conflict?'Есть локальные данные: сохраняются конфликтующие локальные значения':''};
 pending.push(item);await store.put('documents',documentKey,{name:file.name,staged:item,applied:false});
 }
 if(data.settings&&typeof data.settings==='object')pendingSettings=data.settings;
 }else{const rows=Array.isArray(data)?data:data.rows;if(!Array.isArray(rows))throw Error('JSON должен содержать массив записей');await stageRows(rows,'JSON · '+file.name,key);}
 }else if(/\.csv$/i.test(file.name)){const parsed=parseCSV(text);if(!parsed.headers.length)return {skipped:1};pendingCSVs.push({...parsed,fileName:file.name,key});return {review:1,mapping:true};}else throw Error('Поддерживаются PDF, CSV и JSON');
 return {review:1};
}
let pendingCSVs=[],pendingSettings=null;
function mapColumns(){const pendingCSV=pendingCSVs[0];if(!pendingCSV)return review();const fields={courseId:'ID курса',title:'Название',status:'Статус',provider:'Провайдер',completedAt:'Дата завершения',grade:'Оценка',certificateUrl:'URL сертификата'};modal('Сопоставление колонок CSV',`<p>${esc(pendingCSV.fileName)} · файлов в очереди: ${pendingCSVs.length}</p><form id="mapping-form">${Object.entries(fields).map(([key,label])=>`<label>${label}<select name="${key}"><option value="">Не используется</option>${pendingCSV.headers.map(h=>`<option ${normalize(h)===normalize(key)||normalize(h)===normalize(label)?'selected':''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}<button class="primary">Проверить ${pendingCSV.rows.length} записей</button></form>`);}
function review(){
 if(!pending.length&&!pendingSettings&&!pendingCatalog.length){$('#dialog')?.close();render();return toast('Импорт завершён');}
 const available=[...(pendingSettings?.catalogMode==='curated'?baseCatalog:catalog),...customCourses,...pendingCatalog.filter(c=>!cById(c.id))].filter((course,index,list)=>list.findIndex(item=>item.id===course.id)===index);
 modal('Проверка импорта',`<p>Проверьте курс, статус и конфликтующие данные. Пустые и старые записи не стирают завершение и сертификат.</p>${pendingCatalog.length?`<label class="checkbox"><input id="restore-courses" type="checkbox" checked>Добавить недостающие курсы из копии (${pendingCatalog.length})</label>`:''}${pendingSettings?'<label class="checkbox"><input id="restore-settings" type="checkbox">Перенести настройки, свои предметы и списки курсов из копии</label>':''}<div class="review-list">${pending.map((item,i)=>{
 const c=available.find(c=>c.id===item.courseId),conflict=c&&(item.backup?mergeBackupRecord(records[c.id]||{},item):mergeRecord(r(c),item)).conflict;
 return `<div class="review-row" data-review="${i}"><label class="checkbox"><input type="checkbox" data-accept="${i}" ${item.courseId&&item.status&&!item.reason&&!conflict?'checked':''}>Применить запись</label><p>${esc(item.source)}${item.row?.title?' · '+esc(item.row.title):''}</p><p class="warning">${esc(item.reason||'')}${conflict?' · Конфликт: локальный статус, дата, ссылка или настройки сохраняются.':''}</p><label>Курс<select data-map="${i}"><option value="">Выберите курс</option>${available.map(c=>`<option value="${c.id}" ${c.id===item.courseId?'selected':''}>${esc(c.title)} · ${esc(c.provider||c.kind)}</option>`).join('')}</select></label><label>Подтверждённый статус<select data-import-status="${i}"><option value="">Не подтверждён</option>${Object.entries(statuses).map(([k,v])=>`<option value="${k}" ${item.status===k?'selected':''}>${esc(v)}</option>`).join('')}</select></label>${item.pdfKey?`<details><summary>Извлечённый текст PDF</summary><p class="pdf-text">${esc(item.text||'Нет читаемого текста')}</p></details>`:''}<p class="small">Дата: ${date(item.completedAt)} · ${item.certificateUrl?'Персональная ссылка найдена':'Публичная ссылка не найдена'}</p><button class="text" data-ignore="${i}">Не импортировать этот документ повторно</button></div>`;
 }).join('')}</div><button class="primary" data-action="apply-import">Применить выбранные</button>`);
}
async function applyImport(){
 const accepted=[...document.querySelectorAll('[data-accept]:checked')].map(e=>+e.dataset.accept),prepared=[];
 // Validate the complete selection before mutating any record.
 const restoreSettings=$('#restore-settings')?.checked&&pendingSettings;
 const restoreCourses=$('#restore-courses')?.checked,available=[...(restoreSettings&&pendingSettings.catalogMode==='curated'?baseCatalog:catalog),...customCourses,...(restoreCourses?pendingCatalog:[])];
 const subjectSettings=restoreSettings?validateSubjectSettings(pendingSettings,available):null;
 for(const i of accepted){const item=pending[i],c=available.find(c=>c.id===item.courseId);if(!c||!item.status)return toast('Выберите курс и явный статус; для нового курса включите восстановление каталога');
 let certificate=item.certificateUrl;if(!certificate&&item.links)certificate=item.links.map(l=>certificateURL(l,c)).find(Boolean);
 if(certificate&&!certificateURL(certificate,c))return toast('Ссылка не соответствует платформе выбранного курса');
 prepared.push({item,c,certificate});}
 if(restoreCourses){customCourses=mergeLocalCourses(customCourses,pendingCatalog);refreshCatalog();}
 for(const {item,c,certificate} of prepared){
 const before=records[c.id]||null,incoming={...item.backup?item:{},status:item.status,source:item.source,...item.completedAt?{completedAt:item.completedAt}:{},...certificate?{certificateUrl:certificate}:{},...item.pdfKey?{pdfKey:item.pdfKey}:{},...item.grade!==undefined?{grade:item.grade}:{},documentKey:item.documentKey};
 if(item.backup){for(const key of ['backup','courseId','reason','row','candidates'])delete incoming[key];}
 const merged=item.backup?mergeBackupRecord(records[c.id]||{},incoming):mergeRecord(r(c),incoming);records[c.id]=merged.next;
 if(item.documentKey)await store.put('documents',item.documentKey,{...(await store.get('documents',item.documentKey)),courseId:c.id,before,after:merged.next,applied:true});
 }
 if(restoreSettings){
 settings={...settings,...subjectSettings,subjectDefinitions:{...settings.subjectDefinitions,...subjectSettings.subjectDefinitions},subjectAssignments:{...settings.subjectAssignments,...subjectSettings.subjectAssignments}};
 if(['empty','curated'].includes(pendingSettings.catalogMode))settings.catalogMode=pendingSettings.catalogMode;
 refreshCatalog();refreshSubjects();
 if(typeof pendingSettings.owner==='string')settings.owner=pendingSettings.owner.slice(0,300);
 if(['ALL','UML','GO'].includes(pendingSettings.variant))settings.variant=pendingSettings.variant;
 if(['system','light','dark'].includes(pendingSettings.theme))settings.theme=pendingSettings.theme;
 if(['grid','list'].includes(pendingSettings.layout))settings.layout=pendingSettings.layout;
 if(typeof pendingSettings.sidebarCollapsed==='boolean')settings.sidebarCollapsed=pendingSettings.sidebarCollapsed;
 for(const [id,value]of Object.entries(pendingSettings.credits||{}))if(Object.hasOwn(subjects,id)&&['','На рассмотрении','Зачтено','Не зачтено'].includes(value))(settings.credits??={})[id]=value;
 for(const [id,value]of Object.entries(pendingSettings.practice||{}))if(['0','1','2','3'].includes(id)&&typeof value==='boolean')(settings.practice??={})[id]=value;
 }
 await save();applyTheme();pending=pending.filter((_,i)=>!accepted.includes(i));pendingSettings=null;pendingCatalog=[];$('#dialog').close();render();toast(`Применено записей: ${prepared.length}${pending.length?'. Остальные доступны в документах.':''}`);
}
async function handleFiles(files){if(busy)return;busy=true;let counts={added:0,skipped:0,review:0};try{for(const f of files){try{const result=await importFile(f);for(const k of Object.keys(counts))counts[k]+=result[k]||0;}catch(e){counts.review++;toast(`${f.name}: ${e.message}`);}}settings.scan={...counts,at:new Date().toISOString()};await save();render();if(pendingCSVs.length)mapColumns();else if(pending.length||pendingSettings)review();else toast(`Добавлено: ${counts.added}, пропущено: ${counts.skipped}`);}finally{busy=false;}}
async function scanFolder(userAction=false){if(!directory||busy||!userAction&&$('#dialog')?.open)return;try{let permission=await directory.queryPermission({mode:'read'});if(permission!=='granted'&&userAction)permission=await directory.requestPermission({mode:'read'});if(permission!=='granted'){if(userAction)toast('Доступ к папке не предоставлен. Сохранённые данные доступны.');return;}const files=[];for await(const entry of directory.values())if(entry.kind==='file'&&/\.pdf$/i.test(entry.name))files.push(await entry.getFile());await handleFiles(files);}catch(e){toast('Папка недоступна. Загрузите PDF вручную или восстановите доступ.');}}
async function connectFolder(){try{if(!directory){directory=await window.showDirectoryPicker({mode:'read'});await store.put('state','directory',directory);}await scanFolder(true);}catch(e){if(e.name!=='AbortError')error(e);}}
async function documents(){const docs=await store.entries('documents');modal('Документы и привязки',docs.length?docs.map(([key,d])=>`<div class="review-row"><p>${esc(d.name||'Импорт отчёта')} · ${d.ignored?'Пропущен':d.applied?'Применён':'Требует проверки'}</p>${d.courseId?`<p>${esc(cById(d.courseId)?.title)}</p><button class="secondary" data-undo="${key}">Отменить привязку</button>`:''}${!d.applied&&!d.ignored&&(d.parsed||d.staged)?`<button class="secondary" data-review-document="${key}">Проверить документ</button>`:''}</div>`).join(''):'<p>Пока нет импортированных документов.</p>');}

document.addEventListener('click',async e=>{const b=e.target.closest('[data-action],[data-scope],[data-layout],[data-ignore],[data-undo],[data-review-document]');if(!b)return;try{
 if(b.dataset.scope){scope=b.dataset.scope;history.replaceState(null,'','#courses');render();return;}
 if(b.dataset.layout){settings.layout=b.dataset.layout==='list'?'list':'grid';await save();render();return;}
 if(b.dataset.ignore){const item=pending[+b.dataset.ignore];await store.put('documents',item.documentKey,{...(await store.get('documents',item.documentKey)),ignored:true});pending.splice(+b.dataset.ignore,1);review();return;}
 if(b.dataset.reviewDocument){const key=b.dataset.reviewDocument,d=await store.get('documents',key);if(!pending.some(item=>item.documentKey===key))pending.push(d.staged||{...d.parsed,documentKey:key,pdfKey:key,status:d.parsed.issued?'done':null,source:'PDF · '+d.name});review();return;}
 if(b.dataset.undo){const key=b.dataset.undo,d=await store.get('documents',key);const reverted=undoImportedRecord(records[d.courseId],d.before,d.after||records[d.courseId]);if(reverted)records[d.courseId]=reverted;else delete records[d.courseId];await store.put('documents',key,{...d,applied:false,ignored:true});await save();$('#dialog').close();render();toast('Привязка отменена; последующие ручные изменения сохранены');return;}
 const id=b.dataset.id,c=cById(id);if(b.dataset.action?.startsWith('subject-')&&await subjectUI.handleAction(b.dataset.action,id))return;switch(b.dataset.action){
 case 'excel':$('#excel-file').click();break;
 case 'progress-check':if(!await checkExtensionProgress())openProgressPaste('done');break;
 case 'progress-paste':openProgressPaste('done');break;
 case 'progress-clarify':showProgressClarifications();break;
 case 'theme':settings.theme=currentTheme()==='dark'?'light':'dark';document.documentElement.classList.add('theme-ready');applyTheme();await save();break;
 case 'sidebar-toggle':settings.sidebarCollapsed=!settings.sidebarCollapsed;closeSelectMenu();applySidebar();await save();break;
 case 'close':$('#dialog').close();break;
 case 'open':records[id]={...r(c),lastOpened:new Date().toISOString()};await save();break;
 case 'plan':await change(id,{inPlan:!r(c).inPlan});break;
 case 'pin':await change(id,{pinned:!r(c).pinned});break;
 case 'status':if(r(c).status==='new')await change(id,{status:'active',manual:true,manualOverride:false,source:'Ручная отметка',lastOpened:new Date().toISOString()});else editStatus(id);break;
 case 'edit-status':editStatus(id);break;
 case 'certificate':editCert(id);break;
 case 'copy':await navigator.clipboard.writeText(r(c).certificateUrl);toast('Ссылка скопирована');break;
 case 'pdf':await openPDF(id);break;
 case 'details':details(id);break;
 case 'replace-url':modal('Заменить ссылку курса',`<form id="url-form" data-id="${id}"><label>Официальная HTTPS-ссылка<input name="url" type="url" required value="${esc(r(c).customUrl||c.url)}"></label><button class="primary">Сохранить</button></form>`);break;
 case 'reset':query='';subject='';status='';hide=false;render();break;
 case 'import':importModal();break;
 case 'files':$('#files').click();break;
 case 'folder':await connectFolder();break;
 case 'disconnect':directory=null;await store.remove('state','directory');render();toast('Папка отключена');break;
 case 'settings':settingsModal();break;
 case 'export':await exportBackup();break;
 case 'apply-import':await applyImport();break;
 case 'documents':await documents();break;
 }
 }catch(err){error(err);}});
document.addEventListener('input',e=>{if(e.target.id==='search'){const pos=e.target.selectionStart;query=e.target.value;render();$('#search').focus();$('#search').setSelectionRange(pos,pos);}});
document.addEventListener('change',async e=>{const t=e.target;try{
 if(t.id==='excel-file'){if(t.files[0])await readExcelInput(t.files[0]);t.value='';return;}
 if(t.id==='files'){await handleFiles(t.files);return;}
 if(t.id==='theme-preference'){settings.theme=['system','light','dark'].includes(t.value)?t.value:'system';document.documentElement.classList.add('theme-ready');applyTheme();await save();}
 if(t.id==='variant'){settings.variant=t.value;await save();render();}
 if(t.id==='subject'){subject=t.value;render();}if(t.id==='status'){status=t.value;render();}if(t.id==='hide'){hide=t.checked;render();}
 if(['owner','import-owner'].includes(t.id)){settings.owner=t.value.trim();await save();}
 if(t.dataset.credit){(settings.credits??={})[t.dataset.credit]=t.value;await save();}
 if(t.dataset.practice){(settings.practice??={})[t.dataset.practice]=t.checked;await save();}
 if(t.dataset.map){const item=pending[+t.dataset.map];item.courseId=t.value;}
 if(t.dataset.importStatus){pending[+t.dataset.importStatus].status=t.value;}
 }catch(err){error(err);}});
document.addEventListener('submit',async e=>{e.preventDefault();const form=e.target,data=new FormData(form),id=form.dataset.id;try{
 if(form.id==='progress-paste-form'){const submit=form.querySelector('[type="submit"]');submit.disabled=true;try{await applyPastedProgress(String(data.get('text')||''),String(data.get('mode')||'done'));}finally{if(submit.isConnected)submit.disabled=false;}return;}
 if(form.id==='progress-resolve-form'){await resolveProgressClarifications(data);return;}
 if(form.id==='cert-form'){const url=certificateURL(data.get('url'),cById(id));if(!url)throw Error('Нужна действительная персональная ссылка сертификата на официальном домене платформы.');await change(id,{certificateUrl:url});toast('Ссылка сохранена');}
 if(form.id==='status-form')await change(id,{status:data.get('status'),completedAt:data.get('status')==='done'?data.get('completedAt')||undefined:undefined,manual:true,manualOverride:true,source:'Ручная отметка'});
 if(form.id==='url-form'){const url=courseURL(data.get('url'));if(!url||new URL(url).hostname!=='coursera.org'||!/^\/learn\/[\w-]+\/?$/.test(new URL(url).pathname))throw Error('Нужна официальная ссылка https://www.coursera.org/learn/...');await change(id,{customUrl:url});}
 if(form.id==='mapping-form'){const mapping=Object.fromEntries(data),pendingCSV=pendingCSVs.shift();if(!mapping.status||!mapping.courseId&&!mapping.title){pendingCSVs.unshift(pendingCSV);throw Error('Выберите колонку статуса и ID или названия курса');}const rows=pendingCSV.rows.map(row=>Object.fromEntries(Object.entries(mapping).filter(([,col])=>col).map(([field,col])=>[field,row[col]])));await stageRows(rows,'CSV · '+pendingCSV.fileName,pendingCSV.key);if(pendingCSVs.length)mapColumns();else review();return;}
 $('#dialog')?.close();
 }catch(err){error(err);}});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){scanFolder();void checkExtensionProgress({automatic:true});}});
window.addEventListener('focus',()=>{void checkExtensionProgress({automatic:true});});
setInterval(()=>{if(!document.hidden){scanFolder();void checkExtensionProgress({automatic:true});}const d=deadline();if($('#countdown'))$('#countdown').innerHTML=d.expired?'Дедлайн прошёл':`${d.days} дн. <span>${d.hours} ч.</span>`;},60000);
try{
 const saved=await store.get('state','main');if(saved){records=saved.records||{};settings={...settings,...saved.settings};customCourses=validateLocalCourses(saved.customCourses||[]);}else{settings.catalogMode=curatedDefault?'curated':'empty';settings.subjectsMode=curatedDefault?'default':'empty';}
 refreshCatalog();refreshSubjects();
 if(!['system','light','dark'].includes(settings.theme))settings.theme='system';
 if(!['grid','list'].includes(settings.layout))settings.layout='grid';
 directory=await store.get('state','directory');applyTheme();render();await scanFolder();void checkExtensionProgress({automatic:true});
}catch(e){$('#app').innerHTML='<main class="content"><h1>Хранилище браузера недоступно</h1><p>Разрешите IndexedDB для этого сайта, чтобы сохранять прогресс, и обновите страницу.</p></main>';error(e);}
