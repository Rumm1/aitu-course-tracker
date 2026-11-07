const byId=id=>document.getElementById(id);
async function show(){
  try{const response=await chrome.runtime.sendMessage({type:'GET_STATE'});const state=response.payload;
    const enabled=!!state.enabled;
    byId('enable').hidden=enabled;byId('consent-label').hidden=enabled;byId('disconnect').hidden=!enabled;byId('refresh').hidden=!enabled;
    byId('status').textContent=enabled?`Чтение включено · учтено курсов: ${state.rows.length}${state.checkedAt?' · проверено '+new Date(state.checkedAt).toLocaleString('ru-RU'):'. Откройте «Моё обучение». '}`:'Чтение выключено. Данные не собираются.';
  }catch{byId('status').textContent='Перезагрузите расширение и страницы Coursera / трекера.';}
}
byId('enable').addEventListener('click',async()=>{if(!byId('consent').checked){byId('status').textContent='Сначала подтвердите разрешение на чтение списка.';return;}await chrome.runtime.sendMessage({type:'ENABLE'});await show();});
byId('disconnect').addEventListener('click',async()=>{await chrome.runtime.sendMessage({type:'DISCONNECT'});byId('consent').checked=false;await show();});
byId('refresh').addEventListener('click',async()=>{await chrome.storage.local.set({refreshRequestedAt:Date.now()});byId('status').textContent='Проверяется открытая видимая страница «Моё обучение»…';setTimeout(show,1700);});
chrome.storage.onChanged.addListener(()=>show());
show();
