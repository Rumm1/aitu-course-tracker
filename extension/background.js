import catalog from '../src/catalog.json';
import {STORAGE_KEY,isCourseraLearningURL,mergeCapture,publicCapture} from './shared.js';

let queue=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return false;
  const popup=sender.url===chrome.runtime.getURL('popup.html');
  const learning=isCourseraLearningURL(sender.url||'');
  if(message?.type==='CAPTURE'&&!learning)return false;
  if(['ENABLE','DISCONNECT'].includes(message?.type)&&!popup)return false;
  if(!['CAPTURE','ENABLE','DISCONNECT','GET_STATE'].includes(message?.type))return false;
  queue=queue.catch(()=>{}).then(async()=>{
    const current=(await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]||{};
    if(message.type==='ENABLE'){
      await chrome.storage.local.set({[STORAGE_KEY]:{...current,enabled:true},refreshRequestedAt:Date.now()});
      return publicCapture({...current,enabled:true});
    }
    if(message.type==='DISCONNECT'){
      await chrome.storage.local.set({[STORAGE_KEY]:{version:1,enabled:false,rows:[],ambiguous:[],unmatched:[]}});
      return publicCapture({enabled:false});
    }
    if(message.type==='CAPTURE'){
      if(!current.enabled)return publicCapture(current);
      const next=mergeCapture(current,message.parsed,new Date().toISOString(),catalog);
      await chrome.storage.local.set({[STORAGE_KEY]:next});
      return publicCapture(next);
    }
    return publicCapture(current);
  });
  queue.then(result=>respond({ok:true,payload:result}),()=>respond({ok:false,error:'Не удалось сохранить локальные результаты'}));
  return true;
});
