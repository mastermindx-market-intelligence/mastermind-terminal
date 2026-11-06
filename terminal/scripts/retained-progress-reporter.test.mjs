import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Reporter from '../e2e/reporters/retainedProgress.mjs';
const MODULE = new URL('../e2e/reporters/retainedProgress.mjs', import.meta.url).href;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's17-progress-'));
  const output = path.join(root, 'test-results');
  const project = { name: 'desktop', outputDir: output };
  const config = { configFile: path.join(root, 'playwright.config.ts'), projects: [project] };
  const item = { id: 'case-1', location: {file:path.join(root,'e2e','a.spec.ts'),line:7,column:1},
    repeatEachIndex:0,retries:1,parent:{project:()=>project} };
  const result = {retry:0,workerIndex:0,duration:123,status:'passed',errors:[{message:'DO_NOT_RETAIN_SECRET'}],attachments:[{body:'DO_NOT_RETAIN_SECRET'}]};
  const suite = {allTests:()=>[item]};
  const file = path.join(output, `retained-progress-${process.pid}.ndjson`);
  return {root,output,config,item,result,suite,file,clean:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const rows = f => fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).map(v=>JSON.parse(v));

test('synchronous approved identity, retry, duration and status; no result payload or absolute path',()=>{
  const f=fixture(),r=new Reporter();
  try {
    r.onBegin(f.config,f.suite);r.onTestBegin(f.item,f.result);
    assert.equal(rows(f.file)[0].event,'begin'); // readable BEFORE onEnd
    r.onTestEnd(f.item,{...f.result,status:'failed'});
    r.onTestBegin(f.item,{...f.result,retry:1});r.onTestEnd(f.item,{...f.result,retry:1});r.onEnd();
    const records=rows(f.file);assert.deepEqual(records.map(v=>[v.event,v.retry]),[['begin',0],['end',0],['begin',1],['end',1]]);
    assert.equal(records[1].status,'failed');assert.equal(records[3].duration_ms,123);
    assert.equal(records[0].file,'e2e/a.spec.ts');assert.equal(records[0].line,7);assert.equal(records[0].project,'desktop');
    assert.equal(records[0].schema,'terminal.playwright.progress.v1');assert.equal(r.printsToStdio(),false);
    assert.ok(records.every(v=>v.elapsed_ms>=0&&Number.isFinite(v.at_ms)));
    const raw=fs.readFileSync(f.file,'utf8');assert.ok(!raw.includes('DO_NOT_RETAIN_SECRET')&&!raw.includes(f.root));
  } finally {r.onEnd();f.clean();}
});
test('abrupt OWN Node child exit retains finished cases and last begin without onEnd',()=>{
  const f=fixture();
  try {
    const code = `const {default:R}=await import(${JSON.stringify(MODULE)});const root=${JSON.stringify(f.root)};
const p={name:'desktop',outputDir:root+'/test-results'},r=new R();
const a={id:'finished',location:{file:root+'/e2e/a.spec.ts',line:1,column:1},repeatEachIndex:0,retries:0,parent:{project:()=>p}};
const b={...a,id:'active',location:{...a.location,line:2}};const v={retry:0,workerIndex:0,duration:41,status:'passed'};
r.onBegin({configFile:root+'/playwright.config.ts',projects:[p]},{allTests:()=>[a,b]});r.onTestBegin(a,v);r.onTestEnd(a,v);r.onTestBegin(b,v);process.exit(17);`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:5000});
    assert.equal(child.status,17,child.stderr);assert.equal(child.signal,null);
    const names=fs.readdirSync(f.output);assert.equal(names.length,1);
    const observed=rows(path.join(f.output,names[0]));
    assert.deepEqual(observed.map(v=>[v.test_id,v.event]),[['finished','begin'],['finished','end'],['active','begin']]);
    assert.equal(observed[1].duration_ms,41);
  } finally {f.clean();}
});
test('exclusive output does not truncate or adopt an existing artifact',()=>{
  const f=fixture(),r=new Reporter();
  try {fs.mkdirSync(f.output);fs.writeFileSync(f.file,'original');assert.throws(()=>r.onBegin(f.config,f.suite),/retained_progress_unavailable/);assert.equal(fs.readFileSync(f.file,'utf8'),'original');}
  finally {r.onEnd();f.clean();}
});
test('symlink output and final-file symlink refuse without writes to owned outside canary',()=>{
  for(const final of [false,true]) {
    const f=fixture(),r=new Reporter(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'s17-progress-outside-'));
    try {
      if(final){fs.mkdirSync(f.output);fs.writeFileSync(path.join(outside,'canary'),'original');fs.symlinkSync(path.join(outside,'canary'),f.file);}
      else fs.symlinkSync(outside,f.output);
      assert.throws(()=>r.onBegin(f.config,f.suite),/retained_progress_unavailable/);
      assert.deepEqual(fs.readdirSync(outside),final?['canary']:[]);
      if(final)assert.equal(fs.readFileSync(path.join(outside,'canary'),'utf8'),'original');
    } finally {r.onEnd();f.clean();fs.rmSync(outside,{recursive:true,force:true});}
  }
});
test('outside output, unbound/oversized/control identities and mismatched project fail bounded',()=>{
  const changes=[f=>{f.config.projects[0].outputDir=path.join(f.root,'..','outside');},
    f=>{f.item.location.file=path.join(f.root,'..','secret.spec.ts');},f=>{f.item.id='x'.repeat(257);},
    f=>{f.item.id='bad\nidentity';},f=>{f.item.parent={project:()=>({name:'unbound'})};},f=>{f.config.projects=[];}];
  for(const change of changes){const f=fixture(),r=new Reporter();try{change(f);assert.throws(()=>r.onBegin(f.config,f.suite),e=>e.message==='retained_progress_unavailable');}finally{r.onEnd();f.clean();}}
});
test('unselected test, changed source and malformed end cannot manufacture a completed case',()=>{
  for(const change of [f=>[ {...f.item,id:'foreign'},f.result ],f=>[ {...f.item,location:{...f.item.location,line:9}},f.result ],
    f=>[f.item,{...f.result,status:'unknown'}],f=>[f.item,{...f.result,duration:Infinity}],f=>[f.item,{...f.result,retry:2}]]) {
    const f=fixture(),r=new Reporter();try{r.onBegin(f.config,f.suite);r.onTestBegin(f.item,f.result);const [item,result]=change(f);assert.throws(()=>r.onTestEnd(item,result),/retained_progress_unavailable/);assert.equal(rows(f.file).length,1);}finally{r.onEnd();f.clean();}
  }
});
test('selected finite attempt budget and skipped/interrupted statuses stay explicit',()=>{
  const f=fixture(),r=new Reporter();
  try {r.onBegin(f.config,f.suite);r.onTestBegin(f.item,{...f.result,workerIndex:-1});r.onTestEnd(f.item,{...f.result,status:'skipped',workerIndex:-1});
    r.onTestBegin(f.item,{...f.result,retry:1});r.onTestEnd(f.item,{...f.result,retry:1,status:'interrupted'});
    assert.deepEqual(rows(f.file).filter(v=>v.event==='end').map(v=>v.status),['skipped','interrupted']);
    assert.throws(()=>r.onTestBegin(f.item,f.result),/retained_progress_unavailable/);assert.equal(rows(f.file).length,4);
  } finally {r.onEnd();f.clean();}
});
test('write failure is bounded, closes OWN descriptor, and never serializes raw error text',()=>{
  const f=fixture(),r=new Reporter(),write=fs.writeSync;
  try {r.onBegin(f.config,f.suite);fs.writeSync=()=>{throw Error('DO_NOT_RETAIN_SECRET');};assert.throws(()=>r.onTestBegin(f.item,f.result),e=>e.message==='retained_progress_unavailable');assert.equal(r.fd,null);assert.equal(fs.readFileSync(f.file,'utf8'),'');}
  finally {fs.writeSync=write;r.onEnd();f.clean();}
});
