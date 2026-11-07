import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const mm=createRequire(import.meta.url)('minimatch');const match=typeof mm==='function'?mm:mm.minimatch;
import Reporter,{summarize} from './unit-result-reporter.mjs';
const reporter=path.resolve(import.meta.dirname,'unit-result-reporter.mjs');
const vitest=path.resolve(import.meta.dirname,'../node_modules/vitest/vitest.mjs');
const SECRET='UNTRUSTED_TITLE_BODY_STACK_ENV_EXPECTED_ACTUAL';
function fixture(){
 const repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'unit-safe-'))),root=path.join(repo,'terminal'),temp=path.join(repo,'runner');
 const file=path.join(root,'lib/__tests__/safe.test.ts');fs.mkdirSync(path.dirname(file),{recursive:true});fs.mkdirSync(temp);
 fs.writeFileSync(file,'// tracked unit fixture\n');
 const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});git('init','-q');git('add','.');git('-c','user.name=Unit Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
 const ghOutput=path.join(temp,'github-output');fs.writeFileSync(ghOutput,'');
 const env={GITHUB_OUTPUT:ghOutput,RUNNER_TEMP:temp,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',UNIT_STEP_OUTCOME:'failure'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const task={id:SECRET,type:'test',mode:'run',result:{state:'pass',errors:[{message:SECRET,stack:SECRET,expected:SECRET,actual:SECRET}]}};
 Object.defineProperty(task,'name',{get(){throw Error(SECRET);}});
 const fileTask={id:'file',type:'suite',filepath:file,tasks:[task],result:{state:'pass'}};
 const r=new Reporter(),progress=path.join(temp,'terminal-unit-private/ci-123-1.unit.ndjson');
 return {repo,root,temp,file,task,fileTask,r,env,progress,start(){r.onInit({config:{root}});r.onPathsCollected([file]);r.onCollected([fileTask]);},finish(){r.onTaskUpdate([[task.id,task.result]]);r.onFinished([fileTask],[]);},summary(){const lines=fs.readFileSync(ghOutput,'utf8').trim().split('\n');const initialized=lines.includes('safe_unit_report_initialized=true')?'true':'false',failed=lines.includes('safe_unit_report_failed=true')?'true':'';this.lastSummary=summarize(root,{...env,UNIT_REPORT_INITIALIZED:initialized,UNIT_REPORT_FAILED:failed});return this.lastSummary;},selected(outcome='success'){if(outcome!=='success'||this.lastSummary?.publication_state!=='selected')return null;return fs.readFileSync(ghOutput,'utf8').split('\n').filter(l=>l.startsWith('safe_unit_summary_path=')).at(-1)?.slice('safe_unit_summary_path='.length)??null;},clean(){r.close();for(const [k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;fs.rmSync(repo,{recursive:true,force:true});}};
}
test('allowlisted source ordinals/status only; arbitrary names/error fields are never read or retained',()=>{
 const f=fixture();try{f.start();f.finish();const result=f.summary();assert.equal(result.reporting_state,'complete');assert.equal(result.unit_step_outcome,'failure');assert.deepEqual(result.cases,[{file:'terminal/lib/__tests__/safe.test.ts',ordinal:1,status:'passed',error_class:'none'}]);assert.equal(result.counts.passed,1);assert.equal(result.binding.run_id,'123');const output=fs.readFileSync(f.selected(),'utf8');assert.ok(!output.includes(SECRET)&&!output.includes(f.repo));assert.ok(!fs.readFileSync(f.progress,'utf8').includes(SECRET));}finally{f.clean();}
});
test('failed test, collection/hook failure and unhandled counts use fixed classes only',()=>{
 const f=fixture();try{f.task.result={state:'fail',errors:[{name:SECRET,message:SECRET}]};f.fileTask.result={state:'fail',errors:[{stack:SECRET}]};f.start();f.r.onTaskUpdate([[f.task.id,f.task.result]]);f.r.onFinished([f.fileTask],[{message:SECRET}]);const v=f.summary();assert.equal(v.reporting_state,'complete');assert.equal(v.cases[0].error_class,'test_failure');assert.equal(v.files[0].error_class,'suite_or_collection_failure');assert.equal(v.unhandled_error_count,1);assert.ok(!JSON.stringify(v).includes(SECRET));}finally{f.clean();}
});
test('abrupt finish, pending case and missing selected file remain partial',()=>{
 for(const mode of ['no-end','pending','missing-file']){const f=fixture();try{if(mode==='pending')f.task.result=undefined;f.start();if(mode==='no-end')f.r.close();else if(mode==='missing-file')f.r.onFinished([],[]);else f.r.onFinished([f.fileTask],[]);assert.equal(f.summary().reporting_state,'partial');}finally{f.clean();}}
});
test('missing/malformed/extra raw fields stay unavailable without copying bytes into upload destination',()=>{
 for(const mode of ['missing','malformed','extra']){const f=fixture();try{if(mode!=='missing'){f.start();f.finish();fs.appendFileSync(f.progress,mode==='malformed'?SECRET+'\n':JSON.stringify({event:'case',file:'terminal/lib/__tests__/safe.test.ts',ordinal:1,status:'failed',error_class:'test_failure',message:SECRET})+'\n');}const v=f.summary();assert.equal(v.reporting_state,'unavailable');assert.ok(!JSON.stringify(v).includes(SECRET));}finally{f.clean();}}
});
test('foreign/untracked source, duplicate ordinal identity, and write failure never affect caller exit',()=>{
 for(const mode of ['untracked','missing','outside','duplicate','write','invalid-state']){const f=fixture(),write=fs.writeSync;try{f.r.onInit({config:{root:f.root}});f.r.onPathsCollected([f.file]);if(mode==='untracked'){const foreign=path.join(f.root,'lib/__tests__/private.test.ts');fs.writeFileSync(foreign,SECRET);f.fileTask.filepath=foreign;}if(mode==='missing')delete f.fileTask.filepath;if(mode==='outside'){f.fileTask.filepath=path.join(f.temp,'private-secret.test.ts');fs.writeFileSync(f.fileTask.filepath,SECRET);}if(mode==='invalid-state')f.task.result={state:SECRET};if(mode==='duplicate')f.fileTask.tasks.push({...f.task});if(mode==='write')fs.writeSync=()=>{throw Error(SECRET);};assert.doesNotThrow(()=>f.r.onCollected([f.fileTask]));fs.writeSync=write;assert.equal(f.r.unavailable,true);assert.equal(f.summary().reporting_state,'unavailable');}finally{fs.writeSync=write;f.clean();}}
});
test('exclusive output does not adopt an earlier same-run artifact; source drift refuses summary',()=>{
 for(const mode of ['preexisting','drift']){const f=fixture();try{f.start();f.finish();if(mode==='preexisting'){const second=new Reporter();second.onInit({config:{root:f.root}});assert.equal(second.unavailable,true);}else{execFileSync('git',['-c','user.name=Unit Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','next'],{cwd:f.repo});}assert.equal(f.summary().reporting_state,'unavailable');}finally{f.clean();}}
});
test('private and uploader directory symlinks cannot read or write an outside canary',()=>{
 for(const mode of ['private','output']){const f=fixture(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'unit-safe-outside-'));try{fs.writeFileSync(path.join(outside,'canary'),SECRET);if(mode==='private')fs.symlinkSync(outside,path.join(f.temp,'terminal-unit-private'));else{f.start();f.finish();fs.symlinkSync(outside,path.join(f.temp,'terminal-ci-evidence'));}assert.equal(f.summary().reporting_state,'unavailable');assert.deepEqual(fs.readdirSync(outside),['canary']);}finally{f.clean();fs.rmSync(outside,{recursive:true,force:true});}}
});
test('real isolated Vitest preserves pass/fail exit with reporter IO unavailable and emits no parameter title',()=>{
 for(const failing of [false,true])for(const unavailable of [false,true]){const f=fixture();try{if(unavailable)fs.writeFileSync(path.join(f.temp,'terminal-unit-private'),'not-a-directory');fs.writeFileSync(f.file,`import {it,expect} from '${path.resolve(import.meta.dirname,'../node_modules/vitest').replaceAll('\\','/')}/dist/index.js';it.each(['${SECRET}'])('private %s',()=>{expect(${failing?'1':'2'}).toBe(2)});`);execFileSync('git',['add','.'],{cwd:f.repo});execFileSync('git',['-c','user.name=Unit Fixture','-c','user.email=fixture@example.invalid','commit','-qm','case'],{cwd:f.repo});
 const config=path.join(f.root,'vitest.config.mjs');fs.writeFileSync(config,`export default {test:{include:['lib/__tests__/*.test.ts']}}`);
 const env={PATH:process.env.PATH,HOME:process.env.HOME,...f.env,CI:'true'};
 const child=spawnSync(process.execPath,[vitest,'run','--root',f.root,'--config',config,'--reporter='+reporter,'--maxWorkers=1','--minWorkers=1'],{cwd:f.root,env,encoding:'utf8',timeout:20000});assert.equal(child.signal,null);assert.equal(child.status,failing?1:0,child.stderr);const value=f.summary();assert.equal(value.reporting_state,unavailable?'unavailable':'complete');if(!unavailable)assert.equal(value.cases[0].status,failing?'failed':'passed');assert.ok(!JSON.stringify(value).includes(SECRET));
 }finally{f.clean();}}
});
test('workflow keeps npm command semantics and existing uploader, summary always follows unit',()=>{
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'../../.github/workflows/ci.yml'),'utf8');assert.match(source,/id: terminal_unit_tests\n        run: npm test -- --reporter=default --reporter=github-actions --reporter=\.\/scripts\/unit-result-reporter.mjs\n        timeout-minutes: 20/);assert.match(source,/name: Retain safe unit outcome summary\n        id: safe_unit_summary\n        if: always\(\)/);assert.match(source,/name: unit-evidence-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);assert.ok(!source.includes('terminal-unit-private/\n'));assert.ok(!source.includes('--outputFile.json'));
});

test('missing same-step availability binding never adopts an otherwise complete artifact',()=>{const f=fixture();try{f.start();f.finish();fs.writeFileSync(f.env.GITHUB_OUTPUT,'');assert.equal(f.summary().reporting_state,'unavailable');}finally{f.clean();}});

test('late malformed update and hardlinked progress cannot be reported complete',()=>{for(const mode of ['late','hardlink']){const f=fixture();try{f.start();if(mode==='late'){f.r.onTaskUpdate([[f.task.id,{state:SECRET}]]);f.finish();}else{f.finish();fs.linkSync(f.progress,path.join(f.temp,'alias'));}assert.equal(f.summary().reporting_state,'unavailable');}finally{f.clean();}}});

test('unknown task modes/types and out-of-bound error counts refuse rather than truncate',()=>{for(const mode of ['mode','type','errors']){const f=fixture();try{if(mode==='mode')f.task.mode=SECRET;if(mode==='type')f.task.type=SECRET;f.start();if(mode==='errors')f.r.onFinished([f.fileTask],new Array(100001));else f.finish();assert.equal(f.summary().reporting_state,'unavailable');}finally{f.clean();}}});

// Same ordered include/exclude/exact-include contract as @actions/glob's
// primary internal-pattern-helper.match; actual hosted upload remains unexecuted.
function uploadEligible(f,file,outcome='success'){
 const root=path.join(f.temp,'terminal-ci-evidence');
 const patterns=[root+'/**','!'+root+'/*.unit.safe-summary.json','!'+root+'/unit-safe-*/**',f.selected(outcome)].filter(Boolean);
 let yes=false;for(const pattern of patterns){const no=pattern.startsWith('!');if(match(file,no?pattern.slice(1):pattern,{dot:true}))yes=!no;}return yes;
}
test('R1 stale complete summary remains untouched but only current unavailable summary is upload-eligible',()=>{
 const f=fixture();try{f.env.UNIT_STEP_OUTCOME='success';f.start();f.finish();assert.equal(f.summary().reporting_state,'complete');const prior=f.selected(),bytes=fs.readFileSync(prior);
  const legacy=path.join(f.temp,'terminal-ci-evidence/ci-123-1.unit.safe-summary.json');fs.writeFileSync(legacy,bytes);
  const second=new Reporter();second.onInit({config:{root:f.root}});assert.equal(second.unavailable,true);f.env.UNIT_STEP_OUTCOME='failure';const result=f.summary(),current=f.selected();
  assert.equal(result.reporting_state,'unavailable');assert.equal(result.publication_state,'selected');assert.notEqual(current,prior);assert.deepEqual(fs.readFileSync(prior),bytes);assert.deepEqual(fs.readFileSync(legacy),bytes);
  assert.equal(uploadEligible(f,prior),false);assert.equal(uploadEligible(f,legacy),false);assert.equal(uploadEligible(f,current),true);assert.equal(JSON.parse(fs.readFileSync(current)).unit_step_outcome,'failure');
 }finally{f.clean();}
});
test('R1 write/fsync/selector failure leaves no old or new unit summary upload-eligible',()=>{
 for(const mode of ['write','fsync','selector']){const f=fixture(),write=fs.writeFileSync,sync=fs.fsyncSync,open=fs.openSync;let outputFd=null;try{f.start();f.finish();f.summary();const prior=f.selected(),bytes=fs.readFileSync(prior);
  fs.openSync=(p,...args)=>{const fd=open(p,...args);if(typeof p==='string'&&p.endsWith('/summary.json'))outputFd=fd;return fd;};
  fs.writeFileSync=(fd,data,...args)=>{if((mode==='write'&&fd===outputFd)||(mode==='selector'&&String(data).startsWith('safe_unit_summary_path=')))throw Error(SECRET);return write(fd,data,...args);};
  fs.fsyncSync=fd=>{if(mode==='fsync'&&fd===outputFd)throw Error(SECRET);return sync(fd);};
  const result=f.summary();assert.equal(result.publication_state,'unavailable');assert.equal(f.selected('failure'),null);assert.deepEqual(fs.readFileSync(prior),bytes);assert.equal(uploadEligible(f,prior,'failure'),false);
  for(const directory of fs.readdirSync(path.join(f.temp,'terminal-ci-evidence')).filter(n=>n.startsWith('unit-safe-')))assert.equal(uploadEligible(f,path.join(f.temp,'terminal-ci-evidence',directory,'summary.json'),'failure'),false);
 }finally{fs.openSync=open;fs.writeFileSync=write;fs.fsyncSync=sync;f.clean();}}
});
test('R1 unknown legacy file/symlink/hardlink is preserved and excluded, legacy checkout proof remains included',()=>{
 for(const mode of ['file','symlink','hardlink']){const f=fixture();try{f.start();f.finish();const out=path.join(f.temp,'terminal-ci-evidence');fs.mkdirSync(out);const canary=path.join(f.temp,'canary');fs.writeFileSync(canary,SECRET);const stale=path.join(out,'ci-123-1.unit.safe-summary.json');if(mode==='file')fs.writeFileSync(stale,SECRET);else if(mode==='symlink')fs.symlinkSync(canary,stale);else fs.linkSync(canary,stale);const before=fs.lstatSync(stale);f.summary();
  assert.equal(fs.readFileSync(stale,'utf8'),SECRET);assert.equal(fs.readFileSync(canary,'utf8'),SECRET);assert.equal(fs.lstatSync(stale).ino,before.ino);assert.equal(uploadEligible(f,stale),false);assert.equal(uploadEligible(f,path.join(out,'ci-123-1.checkout.json')),true);assert.equal(uploadEligible(f,f.selected()),true);
 }finally{f.clean();}}
});
test('R1 summary CLI failure is nonblocking diagnostics only and uploader requires actual step success',()=>{
 const f=fixture();try{fs.symlinkSync(f.root,path.join(f.temp,'terminal-ci-evidence'));const child=spawnSync(process.execPath,[reporter,'--summary'],{cwd:f.root,env:{PATH:process.env.PATH,HOME:process.env.HOME,...f.env},encoding:'utf8',timeout:5000});assert.equal(child.status,1);assert.ok(!child.stdout.includes(f.root)&&!child.stdout.includes(SECRET));
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'../../.github/workflows/ci.yml'),'utf8');assert.match(source,/id: safe_unit_summary\n        if: always\(\)\n        continue-on-error: true/);assert.match(source,/!\$\{\{ runner.temp \}\}\/terminal-ci-evidence\/unit-safe-\*\/\*\*/);assert.ok(source.includes("steps.safe_unit_summary.outcome == 'success' && steps.safe_unit_summary.outputs.safe_unit_summary_path || ''"));
 }finally{f.clean();}
});

test('locked Vitest actual CLI/config retains automatic GitHub/default plus safe reporter',async()=>{
 const saved={CI:process.env.CI,GITHUB_ACTIONS:process.env.GITHUB_ACTIONS};
 process.env.CI='true';process.env.GITHUB_ACTIONS='true';
 try{
  const {parseCLI,resolveConfig}=await import('vitest/node');
  const root=path.resolve(import.meta.dirname,'..');
  const vite={root,base:'/',cacheDir:path.join(root,'node_modules/.vite'),define:{},test:{}};
  const logger={console:{warn(){},error(){},log(){}}};
  const config=command=>resolveConfig('test',parseCLI(command).options,vite,logger);
  const names=resolved=>resolved.reporters.map(([name])=>name);
  const baseline=config('vitest run');
  const suppressed=config('vitest run --reporter=default --reporter=./scripts/unit-result-reporter.mjs');
  assert.deepEqual(names(baseline),['default','github-actions']);
  assert.equal(names(suppressed).includes('github-actions'),false);
  const source=fs.readFileSync(path.resolve(root,'../.github/workflows/ci.yml'),'utf8');
  const invocation=source.match(/id: terminal_unit_tests\n\s+run: (.+)/)?.[1];
  assert.ok(invocation?.startsWith('npm test -- '));
  const corrected=config(invocation.replace('npm test -- ','vitest run '));
  assert.deepEqual(names(corrected),['default','github-actions',path.join(root,'scripts/unit-result-reporter.mjs')]);
  // The pure resolver creates a fresh unused API nonce on each call; no
  // server is created. Compare every setting except reporters and that nonce,
  // without retaining or asserting the generated nonce value.
  const omitReporters=resolved=>{const value=Object.fromEntries(Object.entries(resolved).filter(([key])=>!['reporter','reporters'].includes(key)));value.api=Object.fromEntries(Object.entries(value.api).filter(([key])=>key!=='token'));return value;};
  assert.deepEqual(omitReporters(corrected),omitReporters(baseline));
  assert.deepEqual(parseCLI(invocation.replace('npm test -- ','vitest run ')).filter,parseCLI('vitest run').filter);
 }finally{for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
