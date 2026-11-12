"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),net=require("node:net");
const {spawn}=require("node:child_process");
const proof=__dirname,repo=path.resolve(proof,"../../.."),terminal=path.join(repo,"terminal");
const evidence=require(path.join(terminal,"e2e/tools/visualEvidence.cjs"));
const incumbent=require(path.join(terminal,"e2e/tools/capture_ci_evidence.cjs"));
const recordPath=path.join(proof,"capture-webpack-execution.json");
if(fs.existsSync(recordPath))throw Error("Existing capture must be reconciled; no replay");
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const equal=(a,b)=>evidence.canonical(a)===evidence.canonical(b);
const readJson=name=>JSON.parse(fs.readFileSync(path.join(proof,name),"utf8"));
const runtime=readJson("runtime.json");
const sourceChecks=readJson("source-checks.json");
const classification=readJson("lint-baseline-classification.json");
const nodeGreen=readJson("node-green-execution.json");
const compilerGreen=readJson("compiler-green-execution.json");
const repair=readJson("compiler-compatibility-repair.json");
if(compilerGreen.state!=="AFFECTED_COMPILER_AND_CAPTURE_CONTRACTS_PASSED"||compilerGreen.counts.pass!==283||!compilerGreen.sourceStable)throw Error("COMPILER_CONTRACTS_NOT_QUALIFIED");
if(readJson("capture-reconciliation.json").state!=="RUNTIME_COMPILE_FAILURE_SETTLED_NO_CASES_OR_COMPOSITION")throw Error("PRIOR_CAPTURE_NOT_RECONCILED");
const qualifiedSource=compilerGreen.sourceAfter;
const permittedChanges=new Set([...Object.keys(repair.changes),"terminal/e2e/tools/capture_visual_evidence.test.cjs"]);
for(const [name,digest] of Object.entries(sourceChecks.sourceAfter))if(qualifiedSource[name]!==digest&&!permittedChanges.has(name))throw Error("UNQUALIFIED_SOURCE_CHANGE:"+name);
if(runtime.state!=="LOCKED_DEPENDENCIES_READY"||nodeGreen.state!=="AFFECTED_NODE_CONTRACTS_PASSED"||nodeGreen.counts.pass!==272)throw Error("SOURCE_PREREQUISITES");
if(!sourceChecks.sourceStable||!sourceChecks.generatedTypesRestored||sourceChecks.checks.length!==4||!sourceChecks.checks.slice(0,3).every(x=>x.exitCode===0))throw Error("SOURCE_PREREQUISITES");
if(classification.state!=="NO_NEW_LINT_FINDINGS_ALL_TERMINAL_SHELL_DIAGNOSTICS_INHERITED_FROM_PROTECTED")throw Error("LINT_UNCLASSIFIED");
for(const [name,digest]of Object.entries(qualifiedSource))if(sha(fs.readFileSync(path.join(repo,name)))!==digest)throw Error("SOURCE_CHANGED:"+name);
const ids={pl6:"pr761-20261110-pl6-webpack",vi:"pr761-20261110-vi-webpack",composition:"pr761-protected-20261110"};
for(const packet of ["pl6","vi"]){
 const members=fs.readdirSync(path.join(repo,evidence.PACKETS[packet]));
 if(members.some(name=>name.startsWith(ids[packet]+"--")))throw Error("EXISTING_OPERATION_REQUIRES_RECONCILIATION:"+packet);
}
const compositionPath=evidence.PACKETS.pl6+"/"+ids.composition+".composition.json";
if(fs.existsSync(path.join(repo,compositionPath)))throw Error("EXISTING_COMPOSITION_REQUIRES_RECONCILIATION");
const env=Object.fromEntries(["HOME","LANG","TMPDIR","TMP","TEMP","PATH"].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
Object.assign(env,{PATH:path.dirname(runtime.node)+path.delimiter+(env.PATH||""),CI:"1",NEXT_TELEMETRY_DISABLED:"1",PLAYWRIGHT_BROWSERS_PATH:"/Users/chriswong/Library/Caches/ms-playwright",TERMINAL_EVIDENCE_FONTS:"retained-fonts-34fb",TERMINAL_EVIDENCE_COMPILER:"webpack",MMX_SHARED_SHELL:"0",MMX_INVESTOR_SHELL_PREVIEW:"0",CAPTURE_ONLY:"",TERMINAL_CI_OPTIONS_AXIS_CAPTURE:"0"});
if(env.TERMINAL_EVIDENCE_COMPILER!=="webpack"||Object.hasOwn(env,"IS_WEBPACK_TEST")||Object.keys(env).some(k=>k.startsWith("GITHUB_")))throw Error("FALSE_RUNTIME_IDENTITY");
const prepared=evidence.captureEnvironment(env);
if(prepared.IS_WEBPACK_TEST!=="1")throw Error("COMPILER_NOT_BOUND");
const state={schema:"terminal_pr761_capture_execution.v1",state:"PREFLIGHT",startedAt:new Date().toISOString(),ids,sourceChecks:"source-checks.json",lintDisposition:"lint-baseline-classification.json",nodeContracts:"node-green-execution.json",compilerContracts:"compiler-green-execution.json",priorCaptureReconciliation:"capture-reconciliation.json",profile:evidence.profile(env),runtime:{node:runtime.node,nodeVersion:process.version,nextVersion:JSON.parse(fs.readFileSync(path.join(terminal,"node_modules/next/package.json"),"utf8")).version,compiler:"declared Webpack through existing Next IS_WEBPACK_TEST selector",selector:prepared.IS_WEBPACK_TEST},steps:[]};
const save=()=>fs.writeFileSync(recordPath,JSON.stringify(state,null,2)+"\n");
const nextenv=path.join(terminal,"next-env.d.ts"),nextenvBefore=fs.existsSync(nextenv)?fs.readFileSync(nextenv):null;
fs.writeFileSync(path.join(proof,"capture-webpack-next-env.preimage.json"),JSON.stringify({exists:nextenvBefore!==null,sha256:nextenvBefore?sha(nextenvBefore):null})+"\n",{flag:"wx"});
if(nextenvBefore)fs.writeFileSync(path.join(proof,"capture-webpack-next-env.preimage.d.ts.txt"),nextenvBefore,{flag:"wx"});
state.sourceBefore=evidence.sourceSnapshot(repo);
state.completeSourceBefore=qualifiedSource;
state.historyBefore=Object.fromEntries(["pl6","vi"].map(packet=>[packet,incumbent.snapshotPacket(repo,evidence.PACKETS[packet])]));
save();
async function portClosed(port){
 return await new Promise((resolve,reject)=>{
  const socket=net.createConnection({host:"127.0.0.1",port});
  let done=false;
  function finish(error,value){if(done)return;done=true;socket.destroy();if(error)reject(error);else resolve(value);}
  socket.setTimeout(2000,()=>finish(Error("PORT_OBSERVATION_TIMEOUT:"+port)));
  socket.once("connect",()=>finish(null,false));
  socket.once("error",error=>error.code==="ECONNREFUSED"?finish(null,true):finish(error));
 });
}
function restoreGeneratedTypes(){
 if(fs.existsSync(nextenv))fs.writeFileSync(path.join(proof,"capture-webpack-next-env.generated.d.ts.txt"),fs.readFileSync(nextenv),{flag:"wx"});
 if(nextenvBefore===null){if(fs.existsSync(nextenv))fs.unlinkSync(nextenv);}
 else fs.writeFileSync(nextenv,nextenvBefore);
 state.generatedTypesRestored=equal(nextenvBefore===null?null:sha(nextenvBefore),fs.existsSync(nextenv)?sha(fs.readFileSync(nextenv)):null);
}
function verifyHistory(){
 const result={};
 for(const packet of ["pl6","vi"]){
  const after=incumbent.snapshotPacket(repo,evidence.PACKETS[packet]),before=state.historyBefore[packet];
  const changed=Object.keys(before).filter(name=>!after[name]||!equal(before[name],after[name]));
  result[packet]={priorMembers:Object.keys(before).length,newMembers:Object.keys(after).filter(name=>!Object.hasOwn(before,name)).length,changed};
 }
 state.historyAfter=result;
 if(Object.values(result).some(x=>x.changed.length))throw Error("HISTORICAL_PACKET_CHANGED");
}
async function producer(packet,port,args,extra){
 if(!await portClosed(port))throw Error("PORT_ALREADY_LISTENING:"+port);
 const stdout=path.join(proof,packet+"-webpack-capture.stdout.log"),stderr=path.join(proof,packet+"-webpack-capture.stderr.log");
 const out=fs.openSync(stdout,"wx"),err=fs.openSync(stderr,"wx");
 const step={packet,port,args:[runtime.node,...args],startedAt:new Date().toISOString(),state:"STARTING",portClosedBefore:true,stdout:path.basename(stdout),stderr:path.basename(stderr)};
 state.steps.push(step);state.state="CAPTURING_"+packet.toUpperCase();save();
 let result;
 try{
  result=await new Promise((resolve,reject)=>{
   const child=spawn(runtime.node,args,{cwd:terminal,env:{...env,...extra},stdio:["ignore",out,err]});
   step.pid=child.pid;step.state="RUNNING";save();console.log(JSON.stringify({state:state.state,pid:child.pid,packet,port}));
   child.once("error",reject);
   child.once("close",(code,signal)=>resolve({code,signal}));
  });
 }finally{fs.closeSync(out);fs.closeSync(err);}
 step.exitCode=result.code;step.signal=result.signal;step.finishedAt=new Date().toISOString();step.state="RETURNED";
 step.stdoutSha256=sha(fs.readFileSync(stdout));step.stderrSha256=sha(fs.readFileSync(stderr));save();
 console.log(JSON.stringify({packet,pid:step.pid,exitCode:result.code,signal:result.signal,stdoutSha256:step.stdoutSha256,stderrSha256:step.stderrSha256}));
 if(result.signal||result.code!==0)throw Error("PRODUCER_NOT_QUALIFIED_RECONCILE_BEFORE_FURTHER_ACTION:"+packet);
 step.portClosedAfter=await portClosed(port);
 if(!step.portClosedAfter)throw Error("PRODUCER_RETURNED_WITH_LISTENING_PORT:"+packet);
 const ref=incumbent.reference(fs.readFileSync(stdout,"utf8"),packet,ids[packet],evidence);
 step.reference=ref;step.state="SUCCEEDED_AND_PORT_CLOSED";save();
 if(!equal(evidence.sourceSnapshot(repo),state.sourceBefore))throw Error("SOURCE_CHANGED_DURING_CAPTURE");
 verifyHistory();save();
 return ref;
}
(async()=>{
 try{
  const refs=[];
  refs.push(await producer("pl6",3536,["e2e/tools/capture_pl6_batch1.cjs"],{TERMINAL_PL6_EVIDENCE_OPERATION_ID:ids.pl6,TERMINAL_CROP_PORT:"3536"}));
  refs.push(await producer("vi",3537,["e2e/tools/capture_visual_evidence.cjs","--id",ids.vi,"--port","3537"],{}));
  state.state="VALIDATING";state.references=refs;save();
  const required=[...evidence.requirements("pl6"),...evidence.requirements("vi")];
  if(required.length!==50||new Set(required.map(x=>x.key)).size!==50)throw Error("REQUIRED_CASES");
  const selections=required.map(x=>({operationId:ids[x.packet],key:x.key}));
  const validated=evidence.writeComposition({repoRoot:repo,id:ids.composition,operations:refs,selections,profile:state.profile});
  if(validated.cases.length!==50||validated.operations.length!==2||validated.operations.some(op=>op.cases.length!==(op.packet==="pl6"?24:30)))throw Error("COMPOSITION_COUNTS");
  state.composition={path:compositionPath,sha256:sha(fs.readFileSync(path.join(repo,compositionPath))),selectedCases:validated.cases.length,actualCases:validated.operations.map(op=>({id:op.id,packet:op.packet,cases:op.cases.length}))};
  restoreGeneratedTypes();
  state.sourceAfter=evidence.sourceSnapshot(repo);state.sourceStable=equal(state.sourceBefore,state.sourceAfter);
  state.completeSourceChanged=Object.keys(state.completeSourceBefore).filter(name=>sha(fs.readFileSync(path.join(repo,name)))!==state.completeSourceBefore[name]);
  verifyHistory();
  if(!state.generatedTypesRestored||!state.sourceStable||state.completeSourceChanged.length)throw Error("FINAL_SOURCE_NOT_STABLE");
  const readback=evidence.readComposition({repoRoot:repo,compositionPath,expectedProfile:state.profile});
  if(readback.cases.length!==50||readback.operations.length!==2)throw Error("FINAL_COMPOSITION_READBACK");
  state.state="CAPTURED_COMPOSED_AND_READ_BACK";state.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({state:state.state,composition:state.composition,sourceCount:Object.keys(state.sourceBefore).length,completeSourceCount:Object.keys(state.completeSourceBefore).length,sourceStable:state.sourceStable,history:state.historyAfter,generatedTypesRestored:state.generatedTypesRestored}));
 }catch(error){
  state.state="CAPTURE_REQUIRES_CLASSIFICATION";state.error={message:error.message,code:error.code??null,stack:error.stack};state.finishedAt=new Date().toISOString();
  save();console.error(JSON.stringify({state:state.state,error:state.error.message,code:state.error.code,steps:state.steps.map(x=>({packet:x.packet,pid:x.pid,state:x.state,exitCode:x.exitCode,signal:x.signal}))}));
  process.exitCode=1;
 }
})();
