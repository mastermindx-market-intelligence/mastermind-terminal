"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawn,spawnSync,execFileSync}=require("node:child_process");
const repoRoot=path.resolve(__dirname,"../../.."),terminal=path.join(repoRoot,"terminal");
const ci=require(path.join(terminal,"e2e/tools/capture_ci_evidence.cjs"));
const evidence=require(path.join(terminal,"e2e/tools/visualEvidence.cjs"));
const prefix="terminal-pr1291-source-integration-20261109-r1";
const ids={prefix,pl6:prefix+"-pl6",vi:prefix+"-vi",composition:prefix+"-current"};
const prior=path.join(__dirname,"capture-r1"),diagnostics=path.join(__dirname,"capture-r1-continuation");
const env={...process.env,MMX_SHARED_SHELL:"0",MMX_INVESTOR_SHELL_PREVIEW:"0",CAPTURE_ONLY:"",
PLAYWRIGHT_BROWSERS_PATH:path.join(terminal,"node_modules/.cache/pr1291-playwright")};
delete env.TERMINAL_EVIDENCE_COMPOSITION;delete env.TERMINAL_EVIDENCE_MODE;
const git=(...args)=>execFileSync("git",args,{cwd:repoRoot,encoding:"utf8"}).trim();
const sha=file=>evidence.sha(fs.readFileSync(file)),put=(file,v)=>fs.writeFileSync(file,JSON.stringify(v,null,2)+"\n");
function portClosed(port){const r=spawnSync("lsof",["-t","-iTCP:"+port,"-sTCP:LISTEN"],{encoding:"utf8"});assert(!r.error&&[0,1].includes(r.status)&&!r.stderr.trim());return r.status===1;}
async function settled(port){for(let i=0;i<40;i++){if(portClosed(port)&&!fs.existsSync(path.join(terminal,".next/dev/lock")))return true;await new Promise(r=>setTimeout(r,250));}return false;}
assert.equal(git("rev-parse","HEAD"),"797e8fed41963c6757dd35db8d77dd71e5d58fba");
assert.equal(git("rev-parse","MERGE_HEAD"),"1c0bf028cf72539a4d3fcb17fa137ee474d764f9");
assert.equal(git("ls-files","-u"),"");
assert(fs.existsSync(diagnostics)&&!fs.existsSync(path.join(diagnostics,"capture-execution.json")));
assert(!fs.existsSync(path.join(terminal,".next/dev/lock")));
for(const port of [3536,3537,3538,3571])assert(portClosed(port));
const originalFile=path.join(prior,"capture-execution.json"),original=JSON.parse(fs.readFileSync(originalFile,"utf8"));
assert.equal(sha(originalFile),"84a8ee82485c9cdb4f377c1d6361a23e35d825a39df470a0ab502bb02e510c0c");
assert.equal(original.state,"FAILED");
assert.equal(original.children[0].status,0);assert(original.children[0].serverSettled);
assert.equal(original.children[1].status,0);assert.equal(original.children[1].serverSettled,false);
const reconciliationFile=path.join(diagnostics,"vi-lifecycle-reconciliation.json");
const reconciliation=JSON.parse(fs.readFileSync(reconciliationFile,"utf8"));
assert.equal(reconciliation.state,"STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED");assert(reconciliation.lockAbsent);
const before=JSON.parse(fs.readFileSync(path.join(prior,"source-before.json"),"utf8"));
assert.equal(evidence.canonical(evidence.sourceSnapshot(repoRoot)),evidence.canonical(before));
const pl6=fs.readFileSync(original.children[0].stdoutPath,"utf8"),vi=fs.readFileSync(original.children[1].stdoutPath,"utf8");
for(const child of original.children){assert.equal(sha(child.stdoutPath),child.stdoutSha256);assert.equal(sha(child.stderrPath),child.stderrSha256);}
const references=[ci.reference(pl6,"pl6",ids.pl6,evidence),ci.reference(vi,"vi",ids.vi,evidence)];
assert.equal(sha(path.join(repoRoot,"terminal/docs/pr-crops/b-pl-6-batch-1/"+ids.pl6+"--operation.json")),"f40e2975e1c658c4f349ecc7fa93c0a3a70bc375d7212c1ff0f948a3f165a03f");
assert.equal(sha(path.join(repoRoot,"terminal/docs/pr-crops/terminal-visual-intelligence/"+ids.vi+"--operation.json")),"43e1b97cbca1e708c63efb79ca91e4c0d68b6a0bd775f7eaf199949717868160");
assert(!fs.existsSync(path.join(repoRoot,evidence.PACKETS.pl6,ids.composition+".composition.json")));
const record={...original,schema:"terminal_pr1291_local_capture_continuation.v1",state:"RUNNING",startedAt:new Date().toISOString(),priorExecution:{path:path.relative(repoRoot,originalFile),sha256:sha(originalFile),state:original.state},
lifecycleReconciliation:{path:path.relative(repoRoot,reconciliationFile),sha256:sha(reconciliationFile)},children:structuredClone(original.children)};
delete record.failure;delete record.completedAt;
record.children[1].originalLifecycle={state:"UNSETTLED",serverSettled:false,completedAt:original.children[1].completedAt};
record.children[1].state="CLOSED";record.children[1].serverSettled=true;record.children[1].serverSettledVerifiedAt=reconciliation.completedAt;
put(path.join(diagnostics,"source-before.json"),before);
const save=()=>put(path.join(diagnostics,"capture-execution.json"),record);
const captureDeadline=Date.now()+25*60*1000;save();
function stable(){const current=evidence.sourceSnapshot(repoRoot);assert.equal(evidence.canonical(current),evidence.canonical(before));assert.deepEqual(ci.checkoutIdentity(repoRoot,env).actualCheckout,original.actualCheckout);return current;}
async function execute(packet,args,port,extra={}){
 assert(portClosed(port));assert(!fs.existsSync(path.join(terminal,".next/dev/lock")));
 const child={packet,command:[process.execPath,...args],port,state:"RUNNING",startedAt:new Date().toISOString(),stdoutPath:path.join(diagnostics,prefix+"-"+packet+".stdout.log"),stderrPath:path.join(diagnostics,prefix+"-"+packet+".stderr.log")};
 record.children.push(child);save();
 const out=fs.openSync(child.stdoutPath,"wx"),err=fs.openSync(child.stderrPath,"wx"),start=Date.now();let result;
 console.log(JSON.stringify({starting:packet,port}));
 try{result=spawnSync(process.execPath,args,{cwd:terminal,env:{...env,...extra},stdio:["ignore",out,err],timeout:Math.max(1,captureDeadline-Date.now()-90000),killSignal:"SIGTERM"});}finally{fs.closeSync(out);fs.closeSync(err);}
 Object.assign(child,{status:result.status,signal:result.signal,error:result.error?.message||null,seconds:(Date.now()-start)/1000,closed:true,completedAt:new Date().toISOString(),stdoutSha256:sha(child.stdoutPath),stderrSha256:sha(child.stderrPath)});
 child.serverSettled=await settled(port);child.state=child.serverSettled?"CLOSED":"UNSETTLED";save();console.log(JSON.stringify({finished:packet,status:child.status,serverSettled:child.serverSettled,seconds:child.seconds}));
 assert(!result.error&&result.status===0&&!result.signal&&child.serverSettled);stable();return fs.readFileSync(child.stdoutPath,"utf8");
}
(async()=>{
 const beforeBatch2=ci.batch2Plan(repoRoot);
 record.batch2={before:beforeBatch2,prior:ci.archivePacket(repoRoot,"terminal/docs/pr-crops/b-pl-6-batch-2",path.join(diagnostics,prefix+"-batch2.prior"))};save();
 const batch2=await execute("batch2",["e2e/tools/capture_pl6_batch2.cjs"],3538,{TERMINAL_CROP_PORT:"3538"});
 record.batch2.returned=ci.archivePacket(repoRoot,"terminal/docs/pr-crops/b-pl-6-batch-2",path.join(diagnostics,prefix+"-batch2.returned"));
 record.batch2.qualification=ci.verifyBatch2Capture(repoRoot,beforeBatch2,batch2,record.actualCheckout.commit);save();
 console.log(JSON.stringify({starting:"pine",owner:"existing qualifyLegacyPackets"}));
 await ci.qualifyLegacyPackets({repoRoot,env,evidence,checkout:ci.checkoutIdentity,spawnLegacy:spawn,diagnostics,ids,record,save,captureDeadline});
 assert(await settled(3571));stable();save();
 const required=[...evidence.requirements("pl6"),...evidence.requirements("vi")];assert.equal(required.length,50);
 const validated=evidence.writeComposition({repoRoot,id:ids.composition,operations:references,selections:required.map(item=>({operationId:ids[item.packet],key:item.key})),profile:evidence.profile(env)});
 assert.equal(validated.cases.length,50);assert.equal(validated.operations.length,2);
 assert.equal(validated.operations.find(x=>x.packet==="pl6").cases.length,24);assert.equal(validated.operations.find(x=>x.packet==="vi").cases.length,30);
 record.composition={path:evidence.PACKETS.pl6+"/"+ids.composition+".composition.json",operations:references,actualCases:54,selectedCases:50};record.composition.sha256=sha(path.join(repoRoot,record.composition.path));
 for(const [packet,files] of Object.entries(record.retainedPackets))assert.deepEqual(ci.snapshotPacket(repoRoot,"terminal/docs/pr-crops/"+packet),files);
 const after=stable();put(path.join(diagnostics,"source-after.json"),after);record.sourceAfterSha256=sha(path.join(diagnostics,"source-after.json"));record.sourceStable=true;
 record.state="CAPTURED_AWAITING_NATIVE_READERS";record.completedAt=new Date().toISOString();save();assert.equal(sha(originalFile),record.priorExecution.sha256);
 console.log(JSON.stringify({completed:true,composition:record.composition,options:record.optionsAxis.state,batch2:24,pine:record.legacyPackets.pine.state,sourceStable:true}));
})().catch(error=>{record.state="FAILED";record.failure={message:error.message,stack:error.stack};record.completedAt=new Date().toISOString();save();console.error(error);process.exitCode=1;});
