import fs from 'node:fs/promises';
import path from 'node:path';
import {Resvg} from '@resvg/resvg-js';

export async function buildBrand(root,extension){
 const source=await fs.readFile(path.join(root,'assets','brand-logo-source.png'));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1280"><image href="data:image/png;base64,${source.toString('base64')}" width="1280" height="1280"/></svg>`;
 const png=size=>new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng();
 await fs.writeFile(path.join(root,'public','brand-logo.png'),png(256));
 await fs.writeFile(path.join(root,'public','favicon.png'),png(64));
 await fs.writeFile(path.join(extension,'logo.png'),png(128));
 await fs.mkdir(path.join(extension,'icons'),{recursive:true});
 for(const size of [16,32,48,128])await fs.writeFile(path.join(extension,'icons',`icon${size}.png`),png(size));
}
