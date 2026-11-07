import {CHANNEL,STORAGE_KEY,isTrackerURL,publicCapture} from './shared.js';

if(isTrackerURL(location.href)){
  function emit(type,payload,requestId){window.postMessage({channel:CHANNEL,type,requestId,payload},location.origin);}
  window.addEventListener('message',async event=>{
    const message=event.data;
    if(event.source!==window||event.origin!==location.origin||message?.channel!==CHANNEL||message.type!=='PROGRESS_REQUEST'||typeof message.requestId!=='string'||message.requestId.length>150)return;
    try{
      const state=(await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      emit('PROGRESS_RESPONSE',publicCapture(state),message.requestId);
      // Reply with the honestly timestamped cache immediately. A fresh visible
      // Coursera read arrives separately through PROGRESS_CHANGED.
      await chrome.storage.local.set({refreshRequestedAt:Date.now()});
    }catch{emit('PROGRESS_RESPONSE',publicCapture({}),message.requestId);}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local'||!changes[STORAGE_KEY])return;
    emit('PROGRESS_CHANGED',publicCapture(changes[STORAGE_KEY].newValue));
  });
}
