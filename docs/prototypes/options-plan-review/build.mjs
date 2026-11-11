import { build } from '../../../terminal/node_modules/esbuild/lib/main.js';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here,'../../..');
await mkdir(path.join(here,'dist'),{recursive:true});
await build({ entryPoints:[path.join(here,'app.tsx')],bundle:true,minify:true,format:'iife',
  outfile:path.join(here,'dist/app.js'),nodePaths:[path.join(root,'terminal/node_modules')],
  define:{'process.env.NODE_ENV':'"production"'}, target:'es2020' });
for(const f of ['index.html','styles.css','tokens.css'])await cp(path.join(here,f),path.join(here,'dist',f));
await writeFile(path.join(here,'dist/README.txt'),'Interactive synthetic example only. Open index.html in a browser. No network requests, saved case, live data, alert or order.\n');
console.log(path.join(here,'dist/index.html'));
