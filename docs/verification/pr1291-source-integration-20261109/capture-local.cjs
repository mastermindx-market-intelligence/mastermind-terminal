"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const repoRoot = path.resolve(__dirname, "../../..");
const terminal = path.join(repoRoot, "terminal");
const ci = require(path.join(terminal, "e2e/tools/capture_ci_evidence.cjs"));
const evidence = require(path.join(terminal, "e2e/tools/visualEvidence.cjs"));
const prefix = "terminal-pr1291-source-integration-20261109-r1";
const ids = { prefix, pl6:prefix+"-pl6", vi:prefix+"-vi", composition:prefix+"-current" };
const diagnostics = path.join(__dirname, "capture-r1");
const env = { ...process.env, MMX_SHARED_SHELL:"0", MMX_INVESTOR_SHELL_PREVIEW:"0", CAPTURE_ONLY:"",
  PLAYWRIGHT_BROWSERS_PATH:path.join(terminal,"node_modules/.cache/pr1291-playwright") };
delete env.TERMINAL_EVIDENCE_COMPOSITION;
delete env.TERMINAL_EVIDENCE_MODE;
const git = (...args) => execFileSync("git",args,{cwd:repoRoot,encoding:"utf8"}).trim();
const sha = file => evidence.sha(fs.readFileSync(file));
const put = (file,value) => fs.writeFileSync(file,JSON.stringify(value,null,2)+"\n");
const captureDeadline = Date.now()+54*60*1000;
function portClosed(port) {
  const r=spawnSync("lsof",["-t","-iTCP:"+port,"-sTCP:LISTEN"],{encoding:"utf8"});
  if(r.error || ![0,1].includes(r.status))throw new Error("Owned-port inspection failed");
  return r.status===1;
}
async function observeSettled(port) {
  for(let i=0;i<40;i++) {
    if(portClosed(port)&&!fs.existsSync(path.join(terminal,".next/dev/lock")))return true;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  return false;
}
assert.equal(git("rev-parse","HEAD"),"797e8fed41963c6757dd35db8d77dd71e5d58fba");
assert.equal(git("rev-parse","MERGE_HEAD"),"1c0bf028cf72539a4d3fcb17fa137ee474d764f9");
assert.equal(git("diff","--name-only","--diff-filter=U"),"");
for(const port of [3536,3537,3538,3571])assert(portClosed(port),"Port already occupied");
assert(!fs.existsSync(path.join(terminal,".next/dev/lock")),"Existing Next owner");
for(const packet of ["pl6","vi"]) {
  const entries=fs.readdirSync(path.join(repoRoot,evidence.PACKETS[packet]));
  assert(!entries.some(name=>name.startsWith(prefix)),"Existing immutable operation");
}
assert(!fs.existsSync(diagnostics),"Existing capture attempt must be reconciled");
fs.mkdirSync(diagnostics);
git("add","-A");
const identity=ci.checkoutIdentity(repoRoot,env);
const record={schema:"terminal_pr1291_local_capture.v1",operation:prefix,...identity,
  mergeParent:git("rev-parse","MERGE_HEAD"),resolvedIndexTree:git("write-tree"),
  branch:git("branch","--show-current"),startedAt:new Date().toISOString(),
  profile:evidence.profile(env),state:"PREPARING",children:[]};
const save=()=>put(path.join(diagnostics,"capture-execution.json"),record);
const before=evidence.sourceSnapshot(repoRoot);
put(path.join(diagnostics,"source-before.json"),before);
record.sourceBeforeSha256=sha(path.join(diagnostics,"source-before.json"));
record.retainedPackets={};
for(const packet of ["gex-levels-heatmap-load-failure","eod-heatmap-flowdesk-load-failure"]) {
  const relative="terminal/docs/pr-crops/"+packet;
  record.retainedPackets[packet]=ci.snapshotPacket(repoRoot,relative);
}
record.optionsAxis=ci.prepareOptions({repoRoot,diagnostics,ids});
assert.equal(record.optionsAxis.required,true);
save();
function stable() {
  const current=evidence.sourceSnapshot(repoRoot);
  assert.equal(evidence.canonical(current),evidence.canonical(before),"Source changed during immutable sequence");
  assert.deepEqual(ci.checkoutIdentity(repoRoot,env).actualCheckout,record.actualCheckout);
  assert.equal(git("rev-parse","MERGE_HEAD"),record.mergeParent);
  return current;
}
async function execute(packet,args,port,extra={}) {
  assert(portClosed(port));assert(!fs.existsSync(path.join(terminal,".next/dev/lock")));
  const child={packet,command:[process.execPath,...args],port,state:"RUNNING",startedAt:new Date().toISOString(),
    stdoutPath:path.join(diagnostics,(ids[packet]||prefix+"-"+packet)+".stdout.log"),
    stderrPath:path.join(diagnostics,(ids[packet]||prefix+"-"+packet)+".stderr.log")};
  record.children.push(child);record.state="RUNNING";save();
  const out=fs.openSync(child.stdoutPath,"wx"),err=fs.openSync(child.stderrPath,"wx");const started=Date.now();
  console.log(JSON.stringify({starting:packet,port,command:child.command}),);
  let result;
  try { result=spawnSync(process.execPath,args,{cwd:terminal,env:{...env,...extra},stdio:["ignore",out,err],
    timeout:Math.max(1,captureDeadline-Date.now()-90000),killSignal:"SIGTERM"}); }
  finally {fs.closeSync(out);fs.closeSync(err);
    if(packet==="pl6") { record.optionsAxis.returned=ci.archivePacket(repoRoot,"terminal/docs/pr-crops/options-level-axis-labels",path.join(diagnostics,prefix+"-options.returned"));save(); }
  }
  Object.assign(child,{status:result.status,signal:result.signal,error:result.error?.message||null,
    seconds:(Date.now()-started)/1000,closed:true,completedAt:new Date().toISOString(),
    stdoutSha256:sha(child.stdoutPath),stderrSha256:sha(child.stderrPath)});
  child.serverSettled=await observeSettled(port);child.state=child.serverSettled?"CLOSED":"UNSETTLED";save();
  console.log(JSON.stringify({finished:packet,status:child.status,signal:child.signal,serverSettled:child.serverSettled,seconds:child.seconds}));
  assert(!result.error && result.status===0 && !result.signal && child.serverSettled,"Native child failed or not settled: "+packet);
  stable();return fs.readFileSync(child.stdoutPath,"utf8");
}
(async()=>{
  const pl6=await execute("pl6",["e2e/tools/capture_pl6_batch1.cjs"],3536,{
    TERMINAL_CROP_PORT:"3536",TERMINAL_PL6_EVIDENCE_OPERATION_ID:ids.pl6,
    TERMINAL_CI_OPTIONS_AXIS_CAPTURE:"1",TERMINAL_CI_OPTIONS_CAPTURE_ID:prefix+"-options"});
  ci.finishOptions({repoRoot,diagnostics,ids,record,evidence});save();
  const vi=await execute("vi",["e2e/tools/capture_visual_evidence.cjs","--id",ids.vi,"--port","3537"],3537);
  const beforeBatch2=ci.batch2Plan(repoRoot);
  record.batch2={before:beforeBatch2,prior:ci.archivePacket(repoRoot,"terminal/docs/pr-crops/b-pl-6-batch-2",path.join(diagnostics,prefix+"-batch2.prior"))};save();
  const batch2=await execute("batch2",["e2e/tools/capture_pl6_batch2.cjs"],3538,{TERMINAL_CROP_PORT:"3538"});
  record.batch2.returned=ci.archivePacket(repoRoot,"terminal/docs/pr-crops/b-pl-6-batch-2",path.join(diagnostics,prefix+"-batch2.returned"));
  record.batch2.qualification=ci.verifyBatch2Capture(repoRoot,beforeBatch2,batch2,record.actualCheckout.commit);save();
  console.log(JSON.stringify({starting:"pine",owner:"existing qualifyLegacyPackets"}));
  await ci.qualifyLegacyPackets({repoRoot,env,evidence,checkout:ci.checkoutIdentity,spawnLegacy:spawn,diagnostics,ids,record,save,captureDeadline});
  assert(await observeSettled(3571));stable();save();
  const references=[ci.reference(pl6,"pl6",ids.pl6,evidence),ci.reference(vi,"vi",ids.vi,evidence)];
  const required=[...evidence.requirements("pl6"),...evidence.requirements("vi")];assert.equal(required.length,50);
  assert.equal(new Set(required.map(item=>item.key)).size,50);
  const validated=evidence.writeComposition({repoRoot,id:ids.composition,operations:references,
    selections:required.map(item=>({operationId:ids[item.packet],key:item.key})),profile:evidence.profile(env)});
  assert.equal(validated.cases.length,50);assert.equal(validated.operations.length,2);
  assert.equal(validated.operations.find(op=>op.packet==="pl6").cases.length,24);
  assert.equal(validated.operations.find(op=>op.packet==="vi").cases.length,30);
  record.composition={path:evidence.PACKETS.pl6+"/"+ids.composition+".composition.json",
    operations:references,actualCases:54,selectedCases:50};
  record.composition.sha256=sha(path.join(repoRoot,record.composition.path));
  for(const [packet,files] of Object.entries(record.retainedPackets))
    assert.deepEqual(ci.snapshotPacket(repoRoot,"terminal/docs/pr-crops/"+packet),files,"Unchanged packet moved: "+packet);
  const after=stable();put(path.join(diagnostics,"source-after.json"),after);
  record.sourceAfterSha256=sha(path.join(diagnostics,"source-after.json"));record.sourceStable=true;
  record.state="CAPTURED_AWAITING_NATIVE_READERS";record.completedAt=new Date().toISOString();save();
  console.log(JSON.stringify({completed:true,composition:record.composition,options:record.optionsAxis.state,
    batch2:24,pine:record.legacyPackets.pine.state,sourceStable:true}));
})().catch(error=>{record.state="FAILED";record.failure={message:error.message,stack:error.stack};record.completedAt=new Date().toISOString();save();console.error(error);process.exitCode=1;});
