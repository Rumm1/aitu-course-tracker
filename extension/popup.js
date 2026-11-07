const byId=id=>document.getElementById(id);
let pendingSince=0,previousCheck=null,pollTimer=null,lastState=null,showing=false;

function dateTime(value){
  const date=new Date(value);
  return value&&Number.isFinite(date.getTime())?date.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Ещё не было';
}
function sectionName(value){
  const section=String(value||'').toLowerCase();
  if(['done','completed','завершённые','завершено'].includes(section))return 'Завершённые';
  if(['active','in_progress','in progress','в процессе'].includes(section))return 'В процессе';
  if(['mixed','unknown'].includes(section))return 'Не определён';
  return section?'Моё обучение':'—';
}
function loading(value){
  byId('refresh').disabled=value;
  byId('refresh').classList.toggle('is-loading',value);
  byId('refresh').setAttribute('aria-busy',String(value));
  byId('refresh').querySelector('span').textContent=value?'Проверяем список…':'Проверить прогресс';
}
function stopPolling(){clearTimeout(pollTimer);pollTimer=null;pendingSince=0;loading(false);}
function render(state){
  lastState=state;
  const enabled=state?.enabled===true;
  document.body.dataset.enabled=String(enabled);
  if(enabled)document.querySelector('main').append(byId('settings'));
  else byId('sync-card').after(byId('settings'));
  const rows=[...new Map((Array.isArray(state?.rows)?state.rows:[]).filter(row=>row&&typeof row.courseId==='string').map(row=>[row.courseId,row])).values()];
  const completed=rows.filter(row=>row.status==='done').length,active=rows.filter(row=>row.status==='active').length;
  const diagnostics=state?.diagnostics||{};
  byId('completed-count').textContent=completed;
  byId('active-count').textContent=active;
  byId('total-count').textContent=rows.length;
  byId('sync-card').dataset.enabled=String(enabled);
  byId('state-label').textContent=enabled?'Передача включена':'Передача выключена';
  byId('refresh').hidden=!enabled;
  byId('enable').hidden=enabled;
  byId('consent-label').hidden=enabled;
  byId('disconnect').hidden=!enabled;
  byId('last-check').textContent=dateTime(state?.checkedAt);
  byId('section').textContent=sectionName(diagnostics.section);
  if(!enabled){
    stopPolling();byId('status').textContent='Подключите свой список';
    byId('detail').textContent='Разрешите чтение курсов в настройках ниже.';
    return;
  }
  if(pendingSince&&state.checkedAt&&state.checkedAt!==previousCheck)stopPolling();
  if(pendingSince){
    byId('status').textContent='Проверяем открытый список';
    byId('detail').textContent='Оставьте страницу «Моё обучение» открытой.';
    return;
  }
  const message=typeof diagnostics.message==='string'?diagnostics.message.slice(0,240):'';
  if(state.checkedAt){
    const matches=Number.isFinite(diagnostics.matchedCount)?diagnostics.matchedCount:null;
    const status=String(diagnostics.resultStatus||'');
    byId('status').textContent=matches===0?'Проверим нужный раздел':rows.length?'Прогресс сохранён':'Список пока не распознан';
    byId('detail').textContent=message||(['waiting','no-page','unsupported','login'].includes(status)?'Откройте «Моё обучение» в Coursera и обновите страницу.':rows.length?'Результаты доступны в вашем трекере.':'Откройте «Завершённые» или «В процессе» и загрузите список.');
  }else{
    byId('status').textContent='Готово к проверке';
    byId('detail').textContent='Откройте «Завершённые» или «В процессе» на Coursera.';
  }
}
async function command(type){
  let timer;
  try{
    const response=await Promise.race([
      chrome.runtime.sendMessage({type}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Служба расширения не отвечает')),4500);}),
    ]);
    if(!response?.ok||!response.payload)throw Error(response?.error||'Расширение недоступно');
    return response.payload;
  }finally{clearTimeout(timer);}
}
async function show(){
  if(showing)return;
  showing=true;
  try{render(await command('GET_STATE'));}
  catch{stopPolling();byId('status').textContent='Обновите страницы';byId('detail').textContent='Перезагрузите расширение, Coursera и трекер.';}
  finally{showing=false;}
}
async function poll(){
  await show();
  if(!pendingSince)return;
  if(Date.now()-pendingSince>6500){
    stopPolling();byId('status').textContent='Откройте список Coursera';
    byId('detail').textContent='Выберите «Завершённые» или «В процессе», обновите страницу и повторите проверку.';
    return;
  }
  pollTimer=setTimeout(poll,650);
}

byId('enable').addEventListener('click',async()=>{
  if(!byId('consent').checked){byId('status').textContent='Нужно ваше разрешение';byId('detail').textContent='Отметьте разрешение в настройках ниже.';byId('consent').focus();return;}
  byId('enable').disabled=true;
  try{render(await command('ENABLE'));byId('settings').open=false;}
  catch{byId('status').textContent='Не удалось включить чтение';byId('detail').textContent='Перезагрузите расширение и попробуйте ещё раз.';}
  finally{byId('enable').disabled=false;}
});
byId('disconnect').addEventListener('click',async()=>{
  try{stopPolling();render(await command('DISCONNECT'));byId('consent').checked=false;byId('settings').open=true;}
  catch{byId('status').textContent='Не удалось отключить';byId('detail').textContent='Перезагрузите расширение и повторите действие.';}
});
byId('refresh').addEventListener('click',async()=>{
  stopPolling();pendingSince=Date.now();previousCheck=lastState?.checkedAt||null;loading(true);
  byId('status').textContent='Проверяем открытый список';byId('detail').textContent='Оставьте страницу «Моё обучение» открытой.';
  try{await chrome.storage.local.set({refreshRequestedAt:pendingSince});pollTimer=setTimeout(poll,650);}
  catch{stopPolling();byId('status').textContent='Не удалось начать проверку';byId('detail').textContent='Перезагрузите расширение и попробуйте ещё раз.';}
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.courseByCourseCapture)void show();});
byId('sync-card').after(byId('settings'));
void command('GET_STATE').then(state=>{render(state);byId('settings').open=!state.enabled;}).catch(()=>show());
