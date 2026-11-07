import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Resvg} from '@resvg/resvg-js';
import {DEFAULT_TRACKER_URL,resolveTrackerURL,trackerExtensionScope} from './tracker-url.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'build','extension');
const tracker=trackerExtensionScope(resolveTrackerURL(process.env));
await fs.mkdir(out,{recursive:true});
await fs.mkdir(path.join(root,'public'),{recursive:true});
const entries=['background','coursera-content','tracker-content'];
await build({entryPoints:entries.map(name=>path.join(root,'extension',name+'.js')),outdir:out,bundle:true,format:'iife',platform:'browser',target:'chrome109',minify:true,legalComments:'none',define:{__TRACKER_URL__:JSON.stringify(tracker.url)}});
for(const file of ['popup.css','popup.js','README.md','logo.svg'])await fs.copyFile(path.join(root,'extension',file),path.join(out,file));
const manifest=JSON.parse(await fs.readFile(path.join(root,'extension','manifest.json'),'utf8'));
const trackerScript=manifest.content_scripts.find(script=>script.js?.includes('tracker-content.js'));
if(!trackerScript)throw Error('В manifest.json не найден скрипт связи с трекером');
trackerScript.matches=tracker.matches;
trackerScript.include_globs=tracker.includeGlobs;
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const popup=await fs.readFile(path.join(root,'extension','popup.html'),'utf8');
const attribute=tracker.url.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
const personalizedPopup=popup.replace(/(<a\b[^>]*\bclass=["']tracker-link["'][^>]*\bhref=["'])[^"']*(["'])/i,(_,before,after)=>before+attribute+after);
if(personalizedPopup===popup&&!popup.includes(`href="${tracker.url}"`))throw Error('В popup.html не найдена ссылка на личный трекер');
await fs.writeFile(path.join(out,'popup.html'),personalizedPopup);
const instructions=await fs.readFile(path.join(out,'README.md'),'utf8');
await fs.writeFile(path.join(out,'README.md'),instructions.replaceAll(DEFAULT_TRACKER_URL,tracker.url));
await fs.mkdir(path.join(out,'icons'),{recursive:true});
const logo=await fs.readFile(path.join(root,'extension','logo.svg'),'utf8');
for(const size of [16,32,48,128])await fs.writeFile(path.join(out,'icons',`icon${size}.png`),new Resvg(logo,{fitTo:{mode:'width',value:size}}).render().asPng());

function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
// Stored (uncompressed) ZIP uses no platform shell or external archiver.
function zip(files){
  const locals=[],central=[];let offset=0;
  for(const {name,data}of files){
    const filename=Buffer.from(name,'utf8'),crc=crc32(data),local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(0,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
    locals.push(local,filename,data);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
    central.push(entry,filename);offset+=local.length+filename.length+data.length;
  }
  const centralBytes=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,centralBytes,end]);
}
const names=[...entries.map(name=>name+'.js'),'manifest.json','popup.html','popup.css','popup.js','README.md','logo.svg',...[16,32,48,128].map(size=>`icons/icon${size}.png`)];
const files=await Promise.all(names.map(async name=>({name,data:await fs.readFile(path.join(out,name))})));
const target=path.join(root,'public','course-progress-extension.zip');
await fs.writeFile(target,zip(files));
console.log(`Extension built for ${tracker.url}: build/extension (${names.length} files), public/course-progress-extension.zip`);
