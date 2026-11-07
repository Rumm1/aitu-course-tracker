import {courseURL} from './core.js';

export function canonicalCourseURL(value){
 const safe=courseURL(typeof value==='string'?value.trim():String(value??'').trim());if(!safe)return null;
 const url=new URL(safe);
 if(url.hostname==='coursera.org'){
  const match=url.pathname.match(/^\/(learn|projects|specializations|professional-certificates)\/([^/]+)/i);
  if(match)url.pathname='/'+match[1].toLowerCase()+'/'+match[2].toLowerCase();
 }
 return url.href;
}

export function localCourseId(url,kind){
 const value=canonicalCourseURL(url)+'|'+kind;let hash=0xcbf29ce484222325n;
 for(const character of value){hash^=BigInt(character.codePointAt(0));hash=BigInt.asUintN(64,hash*0x100000001b3n);}
 return 'local-'+hash.toString(16).padStart(16,'0');
}
