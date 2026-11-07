import catalog from '../src/catalog.json';
import {parseProgressText} from '../src/progress-import.js';
import {STORAGE_KEY,isCourseraLearningURL,readLearningDocument} from './shared.js';

let scheduled=null,running=false;
async function capture(){
  if(running||document.hidden||!isCourseraLearningURL(location.href))return;
  running=true;
  try{
    const state=(await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if(!state?.enabled)return;
    const visible=readLearningDocument(document,location.href);
    if(!visible.text.trim())return;
    const parsed=parseProgressText(visible.text,catalog,{mode:visible.mode});
    await chrome.runtime.sendMessage({type:'CAPTURE',parsed});
  }catch{ /* Extension reload or changed page structure is harmless. */ }
  finally{running=false;}
}
function schedule(){clearTimeout(scheduled);scheduled=setTimeout(capture,900);}
new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-selected','aria-hidden','hidden']});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
window.addEventListener('focus',schedule);
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.refreshRequestedAt||changes[STORAGE_KEY]?.newValue?.enabled!==changes[STORAGE_KEY]?.oldValue?.enabled))schedule();});
setInterval(capture,30000);
schedule();
