// Vitest2 artifact projection. Never read titles, errors, messages, stacks,
// expected/actual values, console output or attachments. Reporting cannot set
// the test exit code. Private progress is NOT included by the artifact uploader.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {checkoutIdentity,operationIds}=createRequire(import.meta.url)('../e2e/tools/capture_ci_evidence.cjs');
const STATES=new Set(['pending','running','passed','failed','skipped','todo']);
const MAX_ROWS=200000,MAX_BYTES=32*1024*1024;
const allowed=p=>/^terminal\/(lib\/__tests__\/|components\/(settings|dislocations)\/__tests__\/)[A-Za-z0-9_./-]+\.test\.tsx?$/.test(p)&&!p.split('/').includes('..');
const safeInt=n=>Number.isSafeInteger(n)&&n>=0;
function context(root,env){
 if(typeof fs.constants.O_NOFOLLOW!=='number')throw Error('unit_report_unavailable');
 root=fs.realpathSync(root);const repo=path.dirname(root);
 if(path.basename(root)!=='terminal')throw Error('unit_report_unavailable');
 const ids=operationIds(env),identity=checkoutIdentity(repo,{}).actualCheckout;
 const tracked=new Set(execFileSync('git',['ls-files','-z','--','terminal'],{cwd:repo,encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(allowed));
 const temp=fs.realpathSync(env.RUNNER_TEMP);if(!path.isAbsolute(temp)||!/^[A-Za-z0-9_/. -]+$/.test(temp)||temp.length>2048)throw Error('unit_report_unavailable');
 return {root,repo,tracked,binding:{checkout:identity,run_id:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT},
  privateDir:path.join(temp,'terminal-unit-private'),outputDir:path.join(temp,'terminal-ci-evidence'),name:`${ids.prefix}.unit`};
}
function directory(p){try{fs.mkdirSync(p,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('unit_report_unavailable');}
function source(c,p){if(typeof p!=='string'||p.length>4096||!path.isAbsolute(p))throw Error('unit_report_unavailable');const rel=path.relative(c.repo,p).split(path.sep).join('/');if(!c.tracked.has(rel)||fs.realpathSync(p)!==path.resolve(c.repo,rel))throw Error('unit_report_unavailable');return rel;}
function state(result,mode){if(mode!==undefined&&!['run','skip','todo','only'].includes(mode))throw Error('unit_report_unavailable');if(result!==undefined&&result!==null&&(!['run','pass','fail','skip','todo','only'].includes(result.state)))throw Error('unit_report_unavailable');return ({run:'running',pass:'passed',fail:'failed',skip:'skipped',todo:'todo'})[result?.state]??({skip:'skipped',todo:'todo'})[mode]??'pending';}
// Fixed availability signal through the SAME GitHub unit step, never a test
// verdict or caller ready receipt. Missing/failed output binding stays unavailable.
function stepOutput(key,value){try{
 if(typeof fs.constants.O_NOFOLLOW!=='number')return false;
 if(!['safe_unit_report_initialized','safe_unit_report_failed','safe_unit_summary_path'].includes(key))return false;
 if(key==='safe_unit_summary_path'){if(typeof value!=='string'||!path.isAbsolute(value)||value.length>4096||!/^[A-Za-z0-9_/. -]+$/.test(value))return false;}
 else if(value!=='true')return false;
 const p=process.env.GITHUB_OUTPUT;if(typeof p!=='string'||!path.isAbsolute(p))return false;
 const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW);
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)return false;fs.writeFileSync(fd,`${key}=${value}\n`);fs.fsyncSync(fd);return true;}finally{fs.closeSync(fd);}
 }catch{return false;}}
function signal(kind){return ['initialized','failed'].includes(kind)&&stepOutput(`safe_unit_report_${kind}`,'true');}
function recordKeys(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');}
export default class UnitResultReporter{
 constructor(){this.fd=null;this.rows=0;this.bytes=0;this.tasks=new Map();this.files=new Map();this.unavailable=false;}
 close(){if(this.fd!==null){try{fs.closeSync(this.fd);}catch{}this.fd=null;}}
 unavailableNow(){this.unavailable=true;signal('failed');this.close();if(this.c){try{directory(this.c.privateDir);const fd=fs.openSync(path.join(this.c.privateDir,this.c.name+'.unavailable'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.closeSync(fd);}catch{}}}
 // Synchronous flush once per callback batch, not an extra fsync per unit case.
 guard(f){if(this.unavailable)return;try{f();if(this.fd!==null)fs.fsyncSync(this.fd);}catch{this.unavailableNow();}}
 emit(v){const b=Buffer.from(JSON.stringify(v)+'\n');if(++this.rows>MAX_ROWS||(this.bytes+=b.length)>MAX_BYTES||b.length>2048||this.fd===null)throw Error('unit_report_unavailable');let n=0;while(n<b.length){const count=fs.writeSync(this.fd,b,n,b.length-n);if(count<=0)throw Error('unit_report_unavailable');n+=count;}}
 onInit(ctx){this.guard(()=>{this.c=context(ctx.config.root,process.env);directory(this.c.privateDir);this.fd=fs.openSync(path.join(this.c.privateDir,this.c.name+'.ndjson'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);this.emit({event:'start',schema:'terminal.unit.safe.v1',binding:this.c.binding});if(!signal('initialized'))throw Error('unit_report_unavailable');});}
 collect(file){
 const name=source(this.c,file.filepath);if(this.files.has(name))return;this.files.set(name,file);let ordinal=0;
 const visit=t=>{if(t.type==='test'){if(typeof t.id!=='string'||t.id.length>1024||this.tasks.has(t.id)||this.tasks.size>=100000)throw Error('unit_report_unavailable');const row={event:'case',file:name,ordinal:++ordinal,status:state(t.result,t.mode),error_class:t.result?.state==='fail'?'test_failure':'none'};this.tasks.set(t.id,row);this.emit(row);}else if(Array.isArray(t.tasks)){for(const child of t.tasks)visit(child);}else throw Error('unit_report_unavailable');};
 visit(file);
 }
 onPathsCollected(paths){this.guard(()=>{if(!Array.isArray(paths)||paths.length>5000)throw Error("unit_report_unavailable");for(const p of paths)this.emit({event:"selected",file:source(this.c,p)});this.emit({event:"selection_end",file_count:paths.length});});}
 onCollected(files){this.guard(()=>{if(!Array.isArray(files))throw Error('unit_report_unavailable');for(const f of files)this.collect(f);});}
 onTaskUpdate(packs){this.guard(()=>{for(const pack of packs){const row=this.tasks.get(pack[0]);if(!row)continue;const status=state(pack[1]);if(status==='pending')continue;const next={...row,status,error_class:status==='failed'?'test_failure':'none'};this.tasks.set(pack[0],next);this.emit(next);}});}
 onFinished(files,errors){this.guard(()=>{if(!Array.isArray(files)||!Array.isArray(errors)||errors.length>100000)throw Error('unit_report_unavailable');for(const f of files){this.collect(f);const name=source(this.c,f.filepath);this.emit({event:'file',file:name,status:state(f.result,f.mode),error_class:f.result?.state==='fail'?'suite_or_collection_failure':'none'});}this.emit({event:'end',unhandled_error_count:errors.length});});this.close();}
 onProcessTimeout(){this.unavailableNow();}
}
function readProgress(c){
 if(fs.existsSync(path.join(c.privateDir,c.name+'.unavailable')))throw Error('unit_report_unavailable');
 const dir=fs.lstatSync(c.privateDir);if(!dir.isDirectory()||dir.isSymbolicLink())throw Error('unit_report_unavailable');
 const p=path.join(c.privateDir,c.name+'.ndjson'),s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>MAX_BYTES)throw Error('unit_report_unavailable');
 const lines=fs.readFileSync(p,'utf8').split('\n');if(lines.at(-1)!=='')throw Error('unit_report_unavailable');lines.pop();if(lines.length>MAX_ROWS)throw Error('unit_report_unavailable');
 const rows=lines.map(l=>{if(l.length>2048)throw Error('unit_report_unavailable');return JSON.parse(l);});
 const first=rows.shift();if(!recordKeys(first,['event','schema','binding'])||first.event!=='start'||first.schema!=='terminal.unit.safe.v1'||JSON.stringify(first.binding)!==JSON.stringify(c.binding))throw Error('unit_report_unavailable');
 let ended=false,errors=null,selectionCount=null;const cases=new Map(),files=new Map(),selected=new Set();
 for(const v of rows){if(ended)throw Error('unit_report_unavailable');
  if(v.event==='selected'){if(selectionCount!==null||!recordKeys(v,['event','file'])||!c.tracked.has(v.file)||selected.has(v.file))throw Error('unit_report_unavailable');selected.add(v.file);}
  else if(v.event==='selection_end'){if(selectionCount!==null||!recordKeys(v,['event','file_count'])||!safeInt(v.file_count)||v.file_count!==selected.size)throw Error('unit_report_unavailable');selectionCount=v.file_count;}
  else if(v.event==='case'){if(!recordKeys(v,['event','file','ordinal','status','error_class'])||!c.tracked.has(v.file)||!safeInt(v.ordinal)||v.ordinal<1||!STATES.has(v.status)||v.error_class!==(v.status==='failed'?'test_failure':'none'))throw Error('unit_report_unavailable');cases.set(v.file+':'+v.ordinal,v);}
  else if(v.event==='file'){if(!recordKeys(v,['event','file','status','error_class'])||!c.tracked.has(v.file)||!STATES.has(v.status)||v.error_class!==(v.status==='failed'?'suite_or_collection_failure':'none'))throw Error('unit_report_unavailable');files.set(v.file,v);}
  else if(v.event==='end'){if(!recordKeys(v,['event','unhandled_error_count'])||!safeInt(v.unhandled_error_count)||v.unhandled_error_count>100000)throw Error('unit_report_unavailable');ended=true;errors=v.unhandled_error_count;}
  else throw Error('unit_report_unavailable');
 }
 for(const file of new Set([...cases.values()].map(v=>v.file))){const nums=[...cases.values()].filter(v=>v.file===file).map(v=>v.ordinal).sort((a,b)=>a-b);if(nums.some((v,i)=>v!==i+1))throw Error('unit_report_unavailable');}
 const records=[...cases.values()],counts=Object.fromEntries([...STATES].map(s=>[s,records.filter(v=>v.status===s).length]));
 const complete=ended&&selectionCount>0&&selected.size===files.size&&[...files.keys()].every(f=>selected.has(f))&&!counts.pending&&!counts.running;
 return {reporting_state:complete?'complete':'partial',selected_file_count:selectionCount,counts,files:[...files.values()].map(v=>({file:v.file,status:v.status,error_class:v.error_class})),cases:records.map(v=>({file:v.file,ordinal:v.ordinal,status:v.status,error_class:v.error_class})),unhandled_error_count:errors};
}
export function summarize(root,env=process.env){
 try{
  const c=context(root,env);
  const outcome=['success','failure','cancelled','skipped'].includes(env.UNIT_STEP_OUTCOME)?env.UNIT_STEP_OUTCOME:'unknown';
  let result;try{if(env.UNIT_REPORT_INITIALIZED!=='true'||![undefined,''].includes(env.UNIT_REPORT_FAILED))throw Error('unit_report_unavailable');result=readProgress(c);}
  catch{result={reporting_state:'unavailable',counts:null,files:[],cases:[],unhandled_error_count:null};}
  const summary={schema:'terminal.unit.safe-summary.v1',binding:c.binding,unit_step_outcome:outcome,...result};
  directory(c.outputDir);
  // Never overwrite/remove an earlier or unknown output. The uploader excludes
  // this whole namespace and re-includes ONLY this step's successfully selected file.
  const fresh=fs.mkdtempSync(path.join(c.outputDir,`unit-safe-${c.name}-`));
  if(fs.realpathSync(fresh)!==fresh)throw Error('unit_report_unavailable');
  const p=path.join(fresh,'summary.json');
  const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{if(!fs.fstatSync(fd).isFile()||fs.fstatSync(fd).nlink!==1)throw Error('unit_report_unavailable');fs.writeFileSync(fd,JSON.stringify(summary)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(fs.realpathSync(p)!==p||fs.lstatSync(p).nlink!==1||!stepOutput('safe_unit_summary_path',p))throw Error('unit_report_unavailable');
  return {...summary,publication_state:'selected'};
 }catch{return {schema:'terminal.unit.safe-summary.v1',reporting_state:'unavailable',publication_state:'unavailable'};}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--summary'){
 const result=summarize(process.cwd());console.log(JSON.stringify({unit_reporting:result.reporting_state}));
 // This is ONLY the new nonblocking diagnostic step's outcome. The original
 // npm-test process/exit is untouched; uploader selection requires this success.
 if(result.publication_state!=='selected')process.exitCode=1;
}
