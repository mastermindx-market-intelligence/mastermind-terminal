import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const terminal = path.resolve(__dirname, '../../../..');
const output = path.join(__dirname, '.generated');
fs.mkdirSync(output, { recursive: true });
buildSync({
  entryPoints: [path.join(__dirname, 'entry.tsx')], outfile: path.join(output, 'bundle.js'),
  bundle: true, platform: 'browser', jsx: 'automatic',
  tsconfig: path.join(terminal, 'tsconfig.json'), absWorkingDir: terminal,
  nodePaths: [path.join(terminal, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
});
fs.copyFileSync(path.join(terminal, 'app/globals.css'), path.join(output, 'globals.css'));
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(output, 'index.html'));
console.log('Isolated synthetic presenter bundle: ' + output);
