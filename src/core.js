export const DEADLINE = Date.parse('2026-11-11T00:00:00+05:00');
export const subjects = {CAP:'Дипломный проект',SEC:'Информационная безопасность',QA:'Качество и тестирование ПО',ARCH:'Архитектура ПО',TE:'Технологическое предпринимательство'};
export const kinds = {course:'Курс',project:'Проект',specialization:'Специализация','professional-certificate':'Профессиональная программа'};
export const statuses = {new:'Не начат',active:'В работе',done:'Пройден'};
export const normalize = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu,' ').trim();
export function courseURL(s) {try {const u=new URL(s);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;u.search='';u.hash='';u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');u.pathname=u.pathname.replace(/\/+$/,'');return u.href;}catch{return null;}}
export function certificateURL(s,course) {
 try {const u=new URL(s);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
 const h=u.hostname.toLowerCase().replace(/^www\./,'');
 const platform=new URL(course.url).hostname.replace(/^www\./,'');
 const valid=platform==='coursera.org' ? h==='coursera.org'&&/^\/(?:account\/)?(?:verify|accomplishments\/(?:verify|certificate|specialization|professional-cert))\/[a-z0-9-]+\/?$/i.test(u.pathname)
 : platform==='udemy.com' ? h==='udemy.com'&&/^\/certificate\/UC-[a-z0-9-]+\/?$/i.test(u.pathname)
 : (platform==='boot.dev'||platform.endsWith('.boot.dev')) ? (h==='boot.dev'||h==='bootdev.io')&&/^\/certificates?\/[a-z0-9-]+\/?$/i.test(u.pathname):false;
 if(!valid)return null;u.search='';u.hash='';return u.href;
 }catch{return null;}
}
export function deadline(now=Date.now()) {const ms=DEADLINE-now;return ms<=0?{expired:true,days:0,hours:0}:{expired:false,days:Math.floor(ms/86400000),hours:Math.floor(ms%86400000/3600000)};}
export function stateFor(c,records) {return {status:'new',inPlan:!!c.inPlan,...records[c.id]};}
export function inVariant(c,variant) {if(variant==='ALL')return true;return !(variant==='UML'&&/Только Мукатаев/.test(c.seScope)||variant==='GO'&&/Только Сма/.test(c.seScope));}
export function plan(catalog,records,variant='ALL') {return catalog.filter(c=>stateFor(c,records).inPlan&&inVariant(c,variant));}
export function progress(catalog,records,variant='ALL') {const selected=plan(catalog,records,variant);const done=selected.filter(c=>stateFor(c,records).status==='done').length;return {total:selected.length,done,percent:selected.length?Math.round(done/selected.length*100):0};}
export function search(c,q) {return normalize([c.id,c.title,c.provider,...(c.also||[]),...c.subjects.flatMap(s=>[s,subjects[s]])].join(' ')).includes(normalize(q));}
export function hours(c) {const entries=Object.entries(c.hoursBySource||{});if(!entries.length)return 'Нет данных о часах';return entries.map(([source,v])=>`${String(v).replace(/^~/,'примерно ').replace(/^≥/,'не менее ')} ч · ${source}`).join(' / ');}
export function matchRecord(row,catalog) {
 if(!row||typeof row!=='object'||Array.isArray(row))return [];
 let found=row.courseId||row.id?catalog.filter(c=>c.id===String(row.courseId||row.id)):catalog.filter(c=>[c.title,...c.also||[]].some(t=>normalize(t)===normalize(row.title)));
 if(row.provider)found=found.filter(c=>normalize(c.provider)===normalize(row.provider));
 if(row.kind)found=found.filter(c=>c.kind===row.kind);
 return found;
}
export function mergeRecord(current,incoming) {
 const next={...current};let conflict=false;
 // Starting a course by hand must not block a later certificate. Only an
 // explicit correction (or a legacy reset to "new") protects the status.
 const protectedStatus=current.manualOverride||current.manual&&current.status==='new';
 if(protectedStatus && incoming.source!=='manual' && incoming.status && incoming.status!==current.status) conflict=true;
 else if(incoming.status==='done'||!current.status||current.status!=='done'&&incoming.status)next.status=incoming.status||current.status;
 if(incoming.certificateUrl) {if(current.certificateUrl&&current.certificateUrl!==incoming.certificateUrl)conflict=true;else next.certificateUrl=incoming.certificateUrl;}
 if(incoming.completedAt&&!current.completedAt)next.completedAt=incoming.completedAt;
 if(incoming.completedAt&&current.completedAt&&incoming.completedAt!==current.completedAt)conflict=true;
 for(const key of ['pdfKey','grade','source','documentKey'])if(incoming[key]!==undefined && (!protectedStatus||key==='pdfKey')){
  // A partial or older report must not replace the provenance of completion.
  if(current.status==='done'&&incoming.status!=='done'&&['grade','source','documentKey'].includes(key))continue;
  if(key==='grade'&&current.grade!==undefined&&current.grade!==incoming.grade){conflict=true;continue;}
  next[key]=incoming[key];
 }
 return {next,conflict};
}
export function mergeBackupRecord(current,incoming) {
 const merged=mergeRecord(current,incoming);
 for(const key of ['inPlan','pinned','manual','manualOverride','customUrl','lastOpened']){
  if(incoming[key]===undefined)continue;
  if(Object.hasOwn(current,key)&&current[key]!==incoming[key])merged.conflict=true;
  else merged.next[key]=incoming[key];
 }
 return merged;
}
export function undoImportedRecord(current,before,after) {
 if(!current)return current;
 const previous=before||{},next={...current};
 const corrected=current.manualOverride!==after?.manualOverride&&current.manualOverride;
 for(const key of new Set([...Object.keys(previous),...Object.keys(after||{})])){
  if(corrected&&['status','completedAt','grade','source','documentKey'].includes(key))continue;
  if(JSON.stringify(previous[key])===JSON.stringify(after?.[key]))continue;
  if(JSON.stringify(current[key])!==JSON.stringify(after?.[key]))continue;
  if(Object.hasOwn(previous,key))next[key]=previous[key];else delete next[key];
 }
 return Object.keys(next).length?next:undefined;
}
export function parseCSV(text) {
 const first=text.split(/\r?\n/)[0];const delimiter=first.includes(';')?';':',';const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(ch===delimiter&&!quoted){row.push(field);field='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}else field+=ch;}
 if(field||row.length){row.push(field);rows.push(row);}if(quoted)throw Error('Незакрытая кавычка в CSV');
 const headers=(rows.shift()||[]).map(h=>h.replace(/^\uFEFF/,'').trim());return {headers,rows:rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])))};
}
export function reportStatus(s){const n=normalize(s);if(['done','completed','complete','passed','true','пройден','завершен','завершён'].includes(n))return 'done';if(['active','in progress','в работе'].includes(n))return 'active';if(['new','not started','не начат','false'].includes(n))return 'new';return null;}
export function validDate(s){
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(s))return undefined;
 const parsed=Date.parse(s);if(!Number.isFinite(parsed))return undefined;
 // Date.parse silently normalizes impossible dates such as 2026-02-31.
 const [year,month,day]=s.slice(0,10).split('-').map(Number);
 if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return undefined;
 return s;
}
export function validateBackup(value,catalog){
 if(value?.app!=='aitu-course-tracker'||value.version!==1||!value.records||Array.isArray(value.records)||typeof value.records!=='object')throw Error('Неизвестная схема резервной копии');
 const allowed=new Set(catalog.map(c=>c.id));const records={};
 for(const [id,r] of Object.entries(value.records)){
 if(!allowed.has(id))throw Error(`Неизвестный ID: ${id}`);
 if(!r||typeof r!=='object'||Array.isArray(r)||!Object.keys(statuses).includes(r.status||'new'))throw Error(`Неверная запись: ${id}`);
 const next={status:r.status||'new'};
 for(const k of ['inPlan','pinned','manual','manualOverride'])if(typeof r[k]==='boolean')next[k]=r[k];
 if(r.completedAt){if(!validDate(r.completedAt))throw Error('Неверная дата');next.completedAt=r.completedAt;}
 if(r.certificateUrl){const url=certificateURL(r.certificateUrl,catalog.find(c=>c.id===id));if(!url)throw Error(`Недопустимый сертификат: ${id}`);next.certificateUrl=url;}
 if(r.customUrl){const url=courseURL(r.customUrl);if(!url||new URL(url).hostname!=='coursera.org'||!/^\/learn\/[\w-]+\/?$/.test(new URL(url).pathname))throw Error(`Недопустимый URL курса: ${id}`);next.customUrl=url;}
 for(const k of ['source','lastOpened'])if(typeof r[k]==='string')next[k]=r[k];
 if(typeof r.grade==='string'||typeof r.grade==='number'&&Number.isFinite(r.grade))next.grade=r.grade;
 records[id]=next;
 }return records;
}
export function analyzeCertificateText(text,links,catalog,owner='') {
 const norm=normalize(text),contains=s=>(' '+norm+' ').includes(' '+normalize(s)+' ');
 const negative=/certificate\s+(?:not\s+(?:yet\s+)?issued|pending)|not\s+(?:yet\s+)?(?:completed|earned)|сертификат\s+(?:ещё\s+)?не\s+выдан/i.test(text);
 const issued=!negative&&/successfully\s+completed|has\s+(?:successfully\s+)?completed|успешно\s+заверш/i.test(text);
 const isProgram=/specialization\s+certificate|professional\s+certificate|completed[\s\S]{0,100}specialization/i.test(text);
 const candidates=catalog.filter(c=>(isProgram?['specialization','professional-certificate']:['course','project']).includes(c.kind)&&[c.title,...c.also||[]].some(contains));
 // Missing provider data cannot establish an automatic identity match.
 const matched=candidates.filter(c=>c.provider&&c.provider.split(';').some(contains));
 const ownerOK=!!owner.trim()&&contains(owner);
 const result={text:text.slice(0,30000),candidates:candidates.map(c=>c.id),issued,reason:!norm?'Скан без читаемого текста':!issued?'Нет явного подтверждения выдачи сертификата':!owner.trim()?'Укажите имя владельца для автоматического сопоставления':!ownerOK?'Имя владельца не совпало':matched.length!==1?'Название, провайдер или вид документа требуют проверки':''};
 if(issued&&ownerOK&&matched.length===1){const c=matched[0];result.courseId=c.id;result.certificateUrl=links.map(l=>certificateURL(l,c)).find(Boolean);}
 result.links=links;
 return result;
}
