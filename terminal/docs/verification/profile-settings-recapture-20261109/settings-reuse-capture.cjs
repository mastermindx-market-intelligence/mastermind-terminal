// One-off evidence adapter: preserve the already-running, exact-workspace preview.
// All original capture fixtures, interactions, assertions, measurements and PNG
// writes run unchanged. Only ownership of starting/stopping Next is omitted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const {execFileSync} = require('node:child_process');
const repo = '/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-beta-profile-settings-crash-20261108';
const expected = '793dd27a1bc88fe2bcf86fa2de9962034b0769a2';
const allowed = new Set(['capture_b_f12_b5_3_account_completeness.cjs','capture_f12_16_team_settings.cjs']);
const script = process.argv[2];
if (!allowed.has(script)) throw Error('Exact capture script is required');
const head = execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
if(head!==expected) throw Error('Source head changed; requalify rather than capturing another writer');
const file = path.join(repo,'terminal/e2e/tools',script);
const source = fs.readFileSync(file,'utf8');
const original = execFileSync('git',['show',`HEAD:terminal/e2e/tools/${script}`],{cwd:repo,encoding:'utf8'});
if(source!==original)throw Error('Capture source has an uncommitted change');
const marker = 'const child = startServer();';
if(source.split(marker).length!==2)throw Error('Capture lifecycle contract changed');
console.log(JSON.stringify({head,script,scriptSha256:crypto.createHash('sha256').update(source).digest('hex'),baseURL:'http://127.0.0.1:3391',adaptation:'reuse existing preview; no spawn/termination; original checks preserved'}));
process.env.TERMINAL_CROP_PORT='3391';
const compiled = new Module(file,module);
compiled.filename=file;
compiled.paths=Module._nodeModulePaths(path.dirname(file));
compiled._compile(source.replace(marker,'const child = null; // existing preview is not owned by this capture'),file);