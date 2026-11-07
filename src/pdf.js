import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {analyzeCertificateText} from './core.js';
GlobalWorkerOptions.workerSrc=worker;
export async function fingerprint(file){const bytes=await file.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');}
export async function readPDF(file,catalog,owner=''){
 const loadingTask=getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});
 const doc=await loadingTask.promise;
 let text='',links=[];
 try{for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);const content=await page.getTextContent();text+=content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('')+'\n';for(const a of await page.getAnnotations())if(a.url)links.push(a.url);}}finally{await loadingTask.destroy();}
 links.push(...(text.match(/https:\/\/[^\s<>"()]+/g)||[]));
 return analyzeCertificateText(text,links,catalog,owner);
}
