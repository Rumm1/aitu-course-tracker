import * as XLSX from 'xlsx';
import {normalize,certificateURL,reportStatus,validDate,subjects as baseSubjects} from './core.js';
import {canonicalCourseURL as canonicalURL,localCourseId} from './course-identity.js';
export {localCourseId};

const MAX_BYTES=20*1024*1024,MAX_ROWS=5000,MAX_SHEETS=20,MAX_COLUMNS=256;
const FIELDS=['title','url','provider','subjects','kind','status','percent','hours','inPlan','id','completedAt','certificateUrl'];
const aliases={
 title:['title','course','course name','course title','название','название курса','курс','наименование','наименование курса'],
 url:['url','link','course url','course link','ссылка','ссылка на курс','адрес','адрес курса'],
 provider:['provider','partner','organization','university','провайдер','организация','университет','автор'],
 subjects:['subjects','subject','discipline','category','направление','направления','предмет','предметы','дисциплина','категория'],
 kind:['kind','type','course type','тип','вид','тип курса','вид позиции'],
 status:['status','completion status','статус','статус прохождения','состояние'],
 percent:['percent','progress','progress percent','progress percentage','progress %','overall progress','процент','прогресс','прогресс %','процент прохождения'],
 hours:['hours','duration','duration hours','часы','часов','длительность','трудоемкость','трудоёмкость'],
 inPlan:['inplan','in plan','selected','в плане','мой план','добавить в план','выбран'],
 id:['id','courseid','course id','ид','код','код курса'],
 completedAt:['completedat','completed at','completion date','дата завершения','дата окончания'],
 certificateUrl:['certificateurl','certificate url','certificate link','сертификат url','ссылка сертификата','ссылка на сертификат'],
};
const normalizedAliases=Object.fromEntries(Object.entries(aliases).map(([key,values])=>[key,new Set(values.map(normalize))]));
const isBlank=value=>value===null||value===undefined||typeof value==='string'&&!value.trim();
const text=value=>isBlank(value)?'':String(value).trim();
function hyperlinkFormula(formula){
 const match=String(formula||'').match(/^\s*(?:_xlfn\.)?HYPERLINK\s*\(\s*"((?:[^"]|"")*)"(?:\s*[,;]\s*"((?:[^"]|"")*)")?\s*\)\s*$/i);
 return match?{url:match[1].replace(/""/g,'"'),label:match[2]?.replace(/""/g,'"')}:null;
}
function headerMapping(headers){
 const mapping=Object.fromEntries(FIELDS.map(field=>[field,'']));
 for(const field of FIELDS){const exact=headers.find(header=>normalizedAliases[field].has(normalize(header)));if(exact)mapping[field]=exact;}
 return mapping;
}
function headerScore(values){
 const mapping=headerMapping(values.map(text));
 return FIELDS.reduce((score,field)=>score+(mapping[field]?field==='title'||field==='url'?4:1:0),0);
}
function uniqueHeaders(values){
 const used=new Map();
 return values.map((value,index)=>{
  let base=text(value).slice(0,180)||'Колонка '+XLSX.utils.encode_col(index);
  if(base==='__excel')base='__excel (колонка)';
  const count=(used.get(base)||0)+1;used.set(base,count);
  return count===1?base:`${base} (${count})`;
 });
}
function rawCell(cell){
 if(!cell)return '';
 const formula=cell.f?hyperlinkFormula(cell.f):null;
 if(formula?.label)return formula.label;
 if(cell.t==='e')return '';
 if(typeof cell.v==='number'&&typeof cell.z==='string'&&XLSX.SSF.is_date(cell.z)){
  const date=XLSX.SSF.parse_date_code(cell.v);
  // Excel serial dates carry no timezone. Preserve their calendar date rather
  // than inventing a UTC completion timestamp from a displayed local value.
  if(date)return [date.y,String(date.m).padStart(2,'0'),String(date.d).padStart(2,'0')].join('-');
 }
 return cell.v instanceof Date?cell.v.toISOString():cell.v??'';
}

/** Read local XLS/XLSX only. SheetJS parses containers; no formulas or macros run. */
export async function readExcelFile(file){
 if(!file||typeof file.arrayBuffer!=='function')throw Error('Выберите файл Excel');
 if(file.size>MAX_BYTES)throw Error('Размер Excel-файла не должен превышать 20 МБ');
 if(!/\.(?:xlsx|xls)$/i.test(file.name||''))throw Error('Поддерживаются файлы .xlsx и .xls');
 const bytes=await file.arrayBuffer();if(bytes.byteLength>MAX_BYTES)throw Error('Размер Excel-файла не должен превышать 20 МБ');
 let workbook;
 try{workbook=XLSX.read(bytes,{type:'array',cellFormula:true,cellNF:true,cellText:true,cellHTML:false,cellDates:false,bookVBA:false,sheetRows:MAX_ROWS+22,dense:false});}
 catch{throw Error('Не удалось прочитать Excel-файл. Проверьте формат и отсутствие пароля.');}
 if(workbook.SheetNames.length>MAX_SHEETS)throw Error('В Excel-файле должно быть не более 20 листов');
 const sheets=[];let totalRows=0;
 for(const name of workbook.SheetNames){
  const sheet=workbook.Sheets[name];if(!sheet?.['!ref'])continue;
  const range=XLSX.utils.decode_range(sheet['!ref']);
  if(range.e.c>=MAX_COLUMNS)throw Error(`На листе «${name}» слишком много колонок (не более ${MAX_COLUMNS})`);
  const fullRange=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
  if(fullRange.e.r-range.s.r>MAX_ROWS+20)throw Error('Импорт ограничен 5000 строками данных');
  let headerRow=-1,bestScore=0;
  for(let r=range.s.r;r<=Math.min(range.e.r,range.s.r+19);r++){
   const values=Array.from({length:range.e.c+1},(_,c)=>rawCell(sheet[XLSX.utils.encode_cell({r,c})]));
   const score=headerScore(values);if(score>bestScore){headerRow=r;bestScore=score;}
  }
  // If no recognizable header exists, retain the first data row and offer
  // generated column names for the mapping screen instead of discarding it.
  const headers=uniqueHeaders(Array.from({length:range.e.c+1},(_,c)=>headerRow<0?'':rawCell(sheet[XLSX.utils.encode_cell({r:headerRow,c})])));
  const rows=[];
  for(let r=headerRow<0?range.s.r:headerRow+1;r<=range.e.r;r++){
   const row=Object.create(null),meta={rowNumber:r+1,formulaFields:[],hyperlinks:Object.create(null),formulaURLs:Object.create(null),formulaLabels:Object.create(null),percentFields:[]};
   for(let c=0;c<headers.length;c++){
    const cell=sheet[XLSX.utils.encode_cell({r,c})],header=headers[c];row[header]=rawCell(cell);
    if(cell?.f){meta.formulaFields.push(header);const literal=hyperlinkFormula(cell.f);if(literal?.url)meta.formulaURLs[header]=literal.url;if(literal?.label)meta.formulaLabels[header]=literal.label;}
    if(typeof cell?.l?.Target==='string')meta.hyperlinks[header]=cell.l.Target;
    if(typeof cell?.z==='string'&&cell.z.includes('%'))meta.percentFields.push(header);
   }
   if(headers.every(header=>isBlank(row[header])&&!meta.hyperlinks[header]&&!meta.formulaURLs[header]))continue;
   row.__excel=meta;rows.push(row);totalRows++;
   if(totalRows>MAX_ROWS)throw Error('Импорт ограничен 5000 строками данных');
  }
  const mapping=headerMapping(headers);
  if(!mapping.url)mapping.url=headers.find(header=>rows.some(row=>row.__excel.hyperlinks[header]||row.__excel.formulaURLs[header]||/^https:\/\//i.test(text(row[header]))))||'';
  if(!mapping.title)mapping.title=headers.find(header=>header!==mapping.url&&rows.some(row=>typeof row[header]==='string'&&text(row[header])&&!/^https?:/i.test(text(row[header]))))||(mapping.url&&rows.some(row=>row.__excel.hyperlinks[mapping.url]||row.__excel.formulaURLs[mapping.url])?mapping.url:'');
  sheets.push({name,headers,rows,mapping,headerRow:headerRow+1});
 }
 if(!sheets.length)throw Error('В Excel-файле нет строк для импорта');
 return {sheets};
}

function urlKind(url){
 try{const pathname=new URL(url).pathname;if(/^\/professional-certificates\//i.test(pathname))return 'professional-certificate';if(/^\/specializations\//i.test(pathname))return 'specialization';if(/^\/projects\//i.test(pathname))return 'project';}catch{}
 return 'course';
}
function explicitKind(value){
 const n=normalize(value);
 if(['course','курс','отдельный курс'].includes(n))return 'course';
 if(['project','проект','guided project','практический проект'].includes(n))return 'project';
 if(['specialization','специализация'].includes(n))return 'specialization';
 if(['professional certificate','professional certificate program','professional-certificate','профессиональная программа','профессиональный сертификат'].map(normalize).includes(n))return 'professional-certificate';
 return null;
}
function booleanValue(value){
 if(typeof value==='boolean')return value;
 const n=normalize(value);if(['true','yes','да','1','selected','в плане'].includes(n))return true;if(['false','no','нет','0','не в плане'].includes(n))return false;return undefined;
}
function subjectCodes(value,definitions){
 const dictionary={CAP:['cap','capstone project','дипломный проект','диплом'],SEC:['sec','information security','информационная безопасность','кибербезопасность'],QA:['qa','software quality assurance and testing','качество и тестирование по','тестирование по','тестирование'],ARCH:['arch','software architecture','архитектура по','архитектура','uml','go'],TE:['te','technological entrepreneurship','технологическое предпринимательство','предпринимательство']};
 const key=value=>normalize(value).replace(/ё/g,'е');
 const names=Object.entries(definitions).map(([id,name])=>[id,key(typeof name==='string'?name:name?.name||name?.title||'')]);
 function resolve(label){
  const normalized=key(label),id=names.find(([id])=>key(id)===normalized);
  if(id)return [id[0]];
  const exact=names.filter(([,name])=>name&&name===normalized).map(([id])=>id);
  if(exact.length)return exact;
  const described=names.filter(([id,name])=>name&&(normalized===key(id)+' '+name||normalized===name+' '+key(id))).map(([id])=>id);
  if(described.length)return described;
  return Object.entries(dictionary).filter(([id,aliases])=>Object.hasOwn(definitions,id)&&aliases.some(alias=>normalized===key(alias)||normalized===key(id)+' '+key(alias)||normalized===key(alias)+' '+key(id))).map(([id])=>id);
 }
 const codes=new Set(),unmatched=new Map();
 for(const input of text(value).split(/[,;|]+/)){
  const label=input.trim().slice(0,80).trim();if(!label)continue;
  let resolved=resolve(label);
  // Preserve subject names containing a slash. Legacy "CAP / TE" remains a
  // shorthand only when every part independently names an existing subject.
  if(!resolved.length&&label.includes('/')){
   const parts=label.split('/').map(part=>part.trim()).filter(Boolean),all=parts.map(resolve);
   if(parts.length>1&&all.every(ids=>ids.length))resolved=all.flat();
  }
  if(resolved.length)for(const id of resolved)codes.add(id);
  else if(!unmatched.has(key(label)))unmatched.set(key(label),label);
 }
 return {codes:[...codes],names:[...unmatched.values()]};
}
export function classifyCourseSubjects(title){
 const n=normalize(title),result=[];
 if(/\b(capstone|research|academic writing|project management|project planning|project execution|project initiation|proposal|scholarly)\b|исследован|диплом|написан.*стат/.test(n))result.push('CAP');
 if(/\b(secure|security|cybersecurity|cryptograph|cryptography|encryption|malware|threats|vulnerabilities|incident response|firewall)\b|безопасност|криптограф|шифрован/.test(n))result.push('SEC');
 if(/\b(test|tests|testing|selenium|junit|mockito|cucumber|jmeter|quality assurance|quality control|testng)\b|тестирован|качеств/.test(n))result.push('QA');
 if(/\b(architecture|design patterns|object oriented|uml|golang|go|microservices|clean architecture)\b|архитектур|паттерн/.test(n))result.push('ARCH');
 if(/\b(entrepreneur|entrepreneurs|entrepreneurship|startup|marketing|market analysis|business model|product pitch|innovation|fundraising|sales)\b|предпринимат|стартап|маркетинг/.test(n))result.push('TE');
 return result;
}
function plainValue(row,header){return header&&!row.__excel?.formulaFields?.includes(header)?row[header]:undefined;}
function literalURL(row,header){return header&&(row.__excel?.hyperlinks?.[header]||row.__excel?.formulaURLs?.[header]||plainValue(row,header));}
function numericPercent(value,row,header){
 if(isBlank(value))return undefined;
 const clean=typeof value==='string'?value.trim().replace('%','').replace(',','.'):value;
 let number=typeof clean==='number'?clean:/^\d+(?:\.\d+)?$/.test(clean)?Number(clean):NaN;
 if(typeof value==='number'&&row.__excel?.percentFields?.includes(header))number*=100;
 return Number.isFinite(number)&&number>=0&&number<=100?number:undefined;
}

/** Prepare reviewable rows; callers decide when to persist the preview. */
export function prepareCourseRows(rows,mapping={},catalog=[],options={}){
 if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw Error('Импорт ограничен 5000 строками данных');
 const definitions=options?.subjects&&typeof options.subjects==='object'&&!Array.isArray(options.subjects)?options.subjects:baseSubjects;
 const entries=[],seen=new Map();
 const knownURLs=new Map();
 for(const course of catalog){const key=canonicalURL(course.url)+'|'+course.kind,bucket=knownURLs.get(key)||[];bucket.push(course);knownURLs.set(key,bucket);}
 for(const [index,row]of rows.entries()){
  if(!row||typeof row!=='object')continue;
  if(Object.entries(row).filter(([key])=>key!=='__excel').every(([,value])=>isBlank(value))&&!Object.keys(row.__excel?.hyperlinks||{}).length&&!Object.keys(row.__excel?.formulaURLs||{}).length)continue;
  const issues=[],rowIndex=row.__excel?.rowNumber||index+1;
  const rawTitle=text(plainValue(row,mapping.title)??row.__excel?.formulaLabels?.[mapping.title]).slice(0,500),rawURL=text(literalURL(row,mapping.url))||text(row.__excel?.hyperlinks?.[mapping.title]||row.__excel?.formulaURLs?.[mapping.title]);
  const url=rawURL?canonicalURL(rawURL):null;
  if(rawURL&&!url)issues.push('Нужна HTTPS-ссылка без пароля, локального пути и исполняемого кода');
  let kind=explicitKind(plainValue(row,mapping.kind))||(url?urlKind(url):null);
  const explicitSubject=plainValue(row,mapping.subjects),resolved=isBlank(explicitSubject)?{codes:classifyCourseSubjects(rawTitle).filter(id=>Object.hasOwn(definitions,id)),names:[]}:subjectCodes(explicitSubject,definitions);
  const subjects=resolved.codes,subjectNames=resolved.names;
  const subjectSource=!isBlank(explicitSubject)?'explicit':subjects.length?'title':'unknown';
  const id=text(plainValue(row,mapping.id));
  const knownID=id?catalog.filter(course=>course.id===id):[];
  let candidates=url?knownURLs.get(url+'|'+kind)||[]:knownID.length?knownID:catalog.filter(course=>[course.title,...course.also||[]].some(title=>normalize(title)===normalize(rawTitle))&&(!kind||course.kind===kind));
  if(candidates.length>1&&rawTitle)candidates=candidates.filter(course=>[course.title,...course.also||[]].some(title=>normalize(title)===normalize(rawTitle)));
  const known=candidates.length===1?candidates[0]:null;
  if(candidates.length>1)issues.push('Несколько курсов совпали: уточните название или ссылку');
  if(!known&&!rawTitle)issues.push('Не указано название курса');
  if(!known&&!url)issues.push('Для нового курса нужна HTTPS-ссылка');
  if(url&&new URL(url).hostname==='coursera.org'&&explicitKind(plainValue(row,mapping.kind))&&kind!==urlKind(url))issues.push('Тип позиции не совпадает с официальной ссылкой: программа и отдельный курс учитываются раздельно');
  const inPlan=booleanValue(plainValue(row,mapping.inPlan)),record={};
  if(inPlan!==undefined)record.inPlan=inPlan;
  const statusValue=plainValue(row,mapping.status),normalizedStatus=normalize(statusValue).replace(/ё/g,'е');
  const status=reportStatus(statusValue)||(['в процессе','обучается','проходит'].includes(normalizedStatus)?'active':['завершено','пройдено','закончен','закончено'].includes(normalizedStatus)?'done':null);
  if(status)record.status=status;
  if(mapping.status&&row.__excel?.formulaFields?.includes(mapping.status))issues.push('Статус вычислен формулой и не используется для отметки прохождения');
  const percent=numericPercent(plainValue(row,mapping.percent),row,mapping.percent);
  if(percent!==undefined&&record.status!=='done'&&record.status!=='new'){record.status=record.status||'active';record.percent=percent;record.progressSource='EXCEL';}
  else if(!isBlank(plainValue(row,mapping.percent))&&percent===undefined)issues.push('Процент должен быть числом от 0 до 100');
  const completedAt=validDate(text(plainValue(row,mapping.completedAt)));if(completedAt)record.completedAt=completedAt;
  let course=known;
  if(!known&&rawTitle&&url){
   kind=kind||'course';course={id:localCourseId(url,kind),title:rawTitle,url,provider:text(plainValue(row,mapping.provider)).slice(0,300),subjects,kind,sources:['EXCEL'],inPlan:inPlan===true};
   const rawHours=plainValue(row,mapping.hours),hours=typeof rawHours==='number'&&Number.isFinite(rawHours)&&rawHours>=0?rawHours:typeof rawHours==='string'&&/^(?:~|≈|≥|примерно\s*|не менее\s*)?\d+(?:[.,]\d+)?(?:\s*(?:ч|час(?:а|ов)?|h|hours?))?$/i.test(rawHours.trim())?rawHours.trim().replace(',','.').replace(/\s*(?:ч|час(?:а|ов)?|h|hours?)$/i,''):undefined;
   if(hours!==undefined)course.hoursBySource={EXCEL:hours};
  }
  if(course&&mapping.certificateUrl&&!isBlank(literalURL(row,mapping.certificateUrl))){const certificate=certificateURL(text(literalURL(row,mapping.certificateUrl)),course);if(certificate)record.certificateUrl=certificate;else issues.push('Ссылка сертификата не прошла проверку платформы');}
  const courseId=course?.id,isNew=!!course&&!known,key=courseId||url+'|'+kind+'|'+normalize(rawTitle);
  const entry={rowIndex,...course?{course,courseId}:{},isNew,...Object.keys(record).length?{record}:{},issues,subjects,subjectNames,subjectSource};
  if(courseId&&seen.has(key)){entry.duplicate=true;entry.skipped=true;entry.isNew=false;entry.issues.push('Повтор курса в этом файле: строка '+seen.get(key));}
  else if(courseId)seen.set(key,rowIndex);
  entries.push(entry);
 }
 return entries;
}
