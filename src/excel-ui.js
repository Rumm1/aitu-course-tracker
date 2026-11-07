import {readExcelFile,prepareCourseRows} from './excel-import.js';
import {subjects as defaultSubjects,kinds} from './core.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields={title:'Название курса',url:'Ссылка на курс',provider:'Провайдер',subjects:'Предмет / направление',kind:'Вид позиции',status:'Статус',percent:'Процент',hours:'Часы',inPlan:'В моём плане'};

export function createExcelImporter({modal,getCatalog,getSubjects=()=>defaultSubjects,apply,onError}){
 let workbook=null,sheetIndex=0,fileName='',mapping={},entries=[];
 const sheet=()=>workbook.sheets[sheetIndex];
 function preview(){entries=prepareCourseRows(sheet().rows,mapping,getCatalog(),{subjects:getSubjects()});return entries;}
 function mappingFromForm(form){for(const key of Object.keys(fields))mapping[key]=form.elements.namedItem('column-'+key)?.value||'';}
 function render(){
  preview();
  const subjectDefinitions=getSubjects();
  const subjectLabel=item=>{
   const ids=Array.isArray(item.subjects)?item.subjects:item.course?.subjects||[];
   const pending=Array.isArray(item.subjectNames)?item.subjectNames:[];
   const labels=[...ids.map(id=>subjectDefinitions[id]||id),...pending];
   return `${labels.map(esc).join(', ')||'Без предмета'}${pending.length?'<small>Новые предметы будут созданы</small>':item.subjectSource==='title'?'<small>По названию</small>':''}`;
  };
  const valid=entries.filter(item=>item.course&&!item.issues.length&&!item.skipped&&!item.duplicate),fresh=valid.filter(item=>item.isNew).length;
  modal('Добавить курсы из Excel',`<form id="excel-import-form"><p class="muted small">${esc(fileName)} · данные обрабатываются только в этом браузере.</p><label>Лист<select name="sheet">${workbook.sheets.map((item,index)=>`<option value="${index}" ${index===sheetIndex?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label><details class="excel-mapping"><summary>Сопоставление колонок</summary><div class="excel-mapping-grid">${Object.entries(fields).map(([key,label])=>`<label>${label}<select name="column-${key}"><option value="">Не используется</option>${sheet().headers.map(header=>`<option value="${esc(header)}" ${mapping[key]===header?'selected':''}>${esc(header)}</option>`).join('')}</select></label>`).join('')}</div><button type="button" class="secondary" data-action="excel-preview">Обновить предпросмотр</button></details><div class="notice">Готово строк: ${valid.length} · новых курсов: ${fresh} · повторов: ${entries.filter(item=>item.duplicate).length}. Текущие отметки и сертификаты сохранятся.</div><div class="excel-preview"><table><thead><tr><th>Добавить</th><th>Курс</th><th>Предмет</th><th>Результат</th></tr></thead><tbody>${entries.slice(0,250).map((item,index)=>`<tr><td><input type="checkbox" name="row-${index}" ${item.course&&!item.issues.length&&!item.skipped&&!item.duplicate?'checked':'disabled'} aria-label="Строка ${item.rowIndex}"></td><td><strong>${esc(item.course?.title||'Строка '+item.rowIndex)}</strong>${item.course?`<small>${esc(kinds[item.course.kind])} · ${item.isNew?'Новый курс':'Уже в каталоге'}</small><a href="${esc(item.course.url)}" target="_blank" rel="noopener noreferrer">Открыть ссылку ↗</a>`:''}${item.issues.length?`<small class="excel-issues">${item.issues.map(esc).join('; ')}</small>`:''}</td><td>${subjectLabel(item)}</td><td>${item.duplicate?'Повтор — пропущен':item.record?.status==='done'?'Пройден':item.record?.status==='active'?`В процессе${item.record.percent!==undefined?' · '+item.record.percent+'%':''}`:'Без новой отметки'}</td></tr>`).join('')}</tbody></table></div>${entries.length>250?'<p class="small muted">Показаны первые 250 строк. Все корректные строки будут добавлены; для большого файла разделите таблицу на листы.</p>':''}<div class="button-row"><button class="primary" type="submit">Добавить выбранные курсы</button></div></form>`);
  const form=document.querySelector('#excel-import-form');
  form.addEventListener('change',event=>{if(event.target.name==='sheet'){sheetIndex=Number(event.target.value);mapping={...sheet().mapping};render();}});
  form.querySelector('[data-action="excel-preview"]').addEventListener('click',()=>{mappingFromForm(form);render();});
  form.addEventListener('submit',async event=>{
   event.preventDefault();event.stopPropagation();
   const selected=new Set([...form.querySelectorAll('input[name^="row-"]:checked')].map(input=>Number(input.name.slice(4))));
   mappingFromForm(form);preview();
   const chosen=entries.filter((item,index)=>index<250?selected.has(index):item.course&&!item.issues.length&&!item.duplicate&&!item.skipped);
   if(!chosen.length){onError(Error('Выберите хотя бы одну корректную строку'));return;}
   const submit=form.querySelector('[type="submit"]');submit.disabled=true;
   try{await apply(chosen,fileName);}catch(error){onError(error);if(submit.isConnected)submit.disabled=false;}
  });
 }
 return {async load(file){if(!file)return;fileName=file.name;workbook=await readExcelFile(file);if(!workbook.sheets.length)throw Error('В файле нет заполненных листов');sheetIndex=0;mapping={...sheet().mapping};render();}};
}
