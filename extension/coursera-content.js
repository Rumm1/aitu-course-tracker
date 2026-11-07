import {STORAGE_KEY,CATALOG_KEY,getCaptureCatalog,isCourseraCaptureURL,isCourseraCertificateURL,readLearningCards,readCertificatePage} from './shared.js';

let scheduled=null,running=false,lastURL=location.href,lastAttempt=0;
async function capture(){
  if(running||document.hidden||!isCourseraCaptureURL(location.href))return;
  running=true;lastAttempt=Date.now();let enabled=false;
  try{
    const stored=await chrome.storage.local.get([STORAGE_KEY,CATALOG_KEY]);
    const state=stored[STORAGE_KEY];
    if(!state?.enabled)return;
    enabled=true;
    const courses=getCaptureCatalog(stored);
    const parsed=isCourseraCertificateURL(location.href)?readCertificatePage(document,location.href,courses):readLearningCards(document,location.href,courses);
    // A zero-match check is still a result. Its reason must reach the popup
    // rather than leaving the user looking at an unexplained old zero count.
    await chrome.runtime.sendMessage({type:'CAPTURE',parsed,pageUrl:location.href});
  }catch{
    if(enabled)try{await chrome.runtime.sendMessage({type:'CAPTURE',pageUrl:location.href,parsed:{matches:[],ambiguous:[],diagnostics:{section:'mixed',visibleCards:0,matchedCount:0,resultStatus:'error',message:'Не удалось прочитать список. Обновите страницу «Моё обучение» и повторите проверку.'}}});}catch{}
  }
  finally{running=false;}
}
// A continuously updating React page must not postpone capture forever.
function schedule(){if(scheduled)return;scheduled=setTimeout(()=>{scheduled=null;void capture();},Math.max(350,lastAttempt+1200-Date.now()));}
new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-selected','aria-hidden','hidden','aria-valuenow','aria-valuetext','value']});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
window.addEventListener('focus',schedule);
window.addEventListener('popstate',schedule);
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.refreshRequestedAt||changes[CATALOG_KEY]||changes[STORAGE_KEY]?.newValue?.enabled!==changes[STORAGE_KEY]?.oldValue?.enabled))schedule();});
setInterval(()=>{if(location.href!==lastURL){lastURL=location.href;schedule();}},800);
setInterval(capture,15000);
schedule();
