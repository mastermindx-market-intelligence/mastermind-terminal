#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const {createHash}=require("node:crypto");
const runtime=require("./thesis_capture_runtime.cjs");
const {captureServerEnv}=require("./capture_b_f11_10_analysis_theses_entry.cjs");
const {trackOwnedServer}=require("./f11_owned_server.cjs");
async function cleanupAll(actions){let failure;for(const action of actions){try{await action();}catch(error){if(failure)(failure.additionalCleanupErrors ||= []).push(error);else failure=error;}}if(failure)throw failure;}
async function runOwned(command,args,options,timeoutMs=150000,{spawn=cp.spawn,track=trackOwnedServer,schedule=setTimeout,cancel=clearTimeout}={}){
  const child=spawn(command,args,{...options,detached:true});
  let owner;
  try{
    owner=track(child);
    const result=await new Promise((resolve,reject)=>{
      const timer=schedule(()=>reject(Error("INTL_RETURN_RUNNER_TIMEOUT")),timeoutMs);
      child.once("error",error=>{cancel(timer);reject(error);});
      child.once("close",(code,signal)=>{cancel(timer);resolve({code,signal,pid:child.pid});});
    });
    await owner.stop();return {...result,settlement:owner.settlement()};
  }catch(error){
    error.runnerProcess={pid:child?.pid};
    if(owner){try{await owner.stop();error.runnerSettlement=owner.settlement();}
      catch(cleanup){error.cleanupError=cleanup;error.runnerCleanup={unknown:true,code:cleanup.code || cleanup.message};}}
    else error.runnerCustody={pid:child?.pid,unknown:true};throw error;}
}
function joinedSourceCase(args){
  if(args.length===0)return false;
  if(args.length===1 && args[0]==="--joined-source")return true;
  throw Error("INTL_RETURN_FIXED_SCOPE");
}
async function main(){
  const joinedSource=joinedSourceCase(process.argv.slice(2));
  const root=path.resolve(__dirname,"../.."),port=Number(process.env.TERMINAL_CROP_PORT);
  await runtime.assertPortFree(port);
  const tmp=fs.realpathSync(process.env.TMPDIR),st=fs.lstatSync(tmp);
  if(!st.isDirectory() || st.uid!==process.getuid() || (st.mode&0o777)!==0o700)throw Error("INTL_RETURN_PRIVATE_TMPDIR");
  const stage=fs.mkdtempSync(path.join(tmp,"intl-return-"));fs.chmodSync(stage,0o700);
  const head=cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  cp.execFileSync("git",["diff","--exit-code","HEAD","--"],{cwd:root,stdio:"pipe"});
  const modulePath=process.env.THESIS_CAPTURE_PLAYWRIGHT_MODULE;
  if(!modulePath || !path.isAbsolute(modulePath) || require(modulePath+"/package.json").version!=="1.63.0")throw Error("INTL_RETURN_TOOLCHAIN");
  const chromium=runtime.getChromium();let server,browser,primary,result,cleanupError;
  const operation=path.join(stage,"runner-input.json"),log=path.join(stage,"runner.log");
  try{
    server=await runtime.start(root,port,stage,"shared-shell-intl-return");await server.ready();
    browser=await chromium.launch({headless:true,host:"127.0.0.1"});
    const tsconfig=path.join(stage,"tsconfig.json");
    fs.writeFileSync(tsconfig,JSON.stringify({compilerOptions:{baseUrl:root,paths:{"@/*":[path.join(root,"*")],"@playwright/test":[path.join(modulePath,"test")]}}}),{mode:0o600});
    fs.writeFileSync(operation,JSON.stringify({baseURL:`http://127.0.0.1:${port}`,wsEndpoint:browser.thesisOwnedWsEndpoint,playwrightModule:modulePath,sourceHead:head,joinedSource}),{mode:0o600});
    const fd=fs.openSync(log,"wx",0o600);let runnerError;
    try{
      result=await runOwned(process.execPath,[path.join(modulePath,"cli.js"),"test","--config",path.join(__dirname,"intl_return_controlled.config.cjs"),"--tsconfig",tsconfig],
        {cwd:root,env:{...captureServerEnv(),MMX_SHARED_SHELL:"1",TERMINAL_VISUAL_EVIDENCE_OPERATION:joinedSource?"intl-investigate-controlled":"intl-return-controlled",TERMINAL_INTL_RETURN_OPERATION:operation,
          NODE_OPTIONS:`--require ${JSON.stringify(path.join(__dirname,"intl_return_closed_egress.cjs"))}`},stdio:["ignore",fd,fd]});
    }catch(error){runnerError=error;throw error;}
    finally{
      try{fs.closeSync(fd);}
      catch(error){if(runnerError)runnerError.logCloseError=error;else throw error;}
    }
    if(result.code!==0)throw Error("INTL_RETURN_CASE_FAILED");
  }catch(error){primary=error;if(server)server.failure(error);}
  try{await cleanupAll([async()=>{if(browser)await browser.close();},async()=>{if(server)await server.stop();}]);}
  catch(error){cleanupError=error;}
  // The live endpoint is private transient runner input, never an evidence field.
  const runnerUnknown=!!(primary?.runnerCleanup?.unknown || primary?.runnerCustody?.unknown);
  // An unsettled runner retains its same-carrier private input for reconciliation.
  try{if(!runnerUnknown && fs.existsSync(operation))fs.unlinkSync(operation);}catch(error){cleanupError ||= error;}
  let serverSummary;
  try{serverSummary=server?.summary();}catch(error){serverSummary={unknown:true,code:error.code || error.message};primary ||= error;}
  try{
    if(cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim()!==head)throw Error("INTL_RETURN_SOURCE_CHANGED");
    cp.execFileSync("git",["diff","--exit-code","HEAD","--"],{cwd:root,stdio:"pipe"});
  }catch(error){primary ||= error;}
  const browserFacts={...chromium.counts};delete browserFacts.contexts;delete browserFacts.contextsClosed;
  let logFacts=null;
  try{if(fs.existsSync(log)){
    const bytes=fs.statSync(log).size;
    if(bytes>262144)throw Error("INTL_RETURN_LOG_LIMIT");
    logFacts={bytes,sha256:createHash("sha256").update(fs.readFileSync(log)).digest("hex")};
  }}catch(error){if(primary)primary.logEvidenceError=error;else primary=error;}
  const report={sourceHead:head,scope:joinedSource?"real source Investigate to preview and authored Return; controlled retained fixture; CLOSED server":"unchanged real Next Return; controlled retained fixture; CLOSED server",
    primary:primary ? {name:primary.name,message:primary.message,runnerProcess:primary.runnerProcess,
      runnerSettlement:primary.runnerSettlement,runnerCleanup:primary.runnerCleanup,runnerCustody:primary.runnerCustody,
      logCloseError:primary.logCloseError ? {name:primary.logCloseError.name,code:primary.logCloseError.code,message:primary.logCloseError.message} : null} : null,
    privateOperationRetained:runnerUnknown ? operation : null,
    cleanupError:cleanupError ? {name:cleanupError.name,message:cleanupError.message} : null,
    runner:result,server:serverSummary,browser:{...browserFacts,contextCounts:"runner-owned, not instrumented by capture wrapper"},toolchain:chromium.toolchain,
    runnerLog:logFacts};
  try{fs.writeFileSync(path.join(stage,"RESULT.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});}
  catch(error){if(primary)primary.resultWriteError=error;else primary=error;}
  console.log(JSON.stringify({result:path.join(stage,"RESULT.json"),success:!primary&&!cleanupError}));
  if(primary){if(cleanupError)primary.cleanupError=cleanupError;throw primary;}if(cleanupError)throw cleanupError;
}
module.exports={cleanupAll,runOwned,joinedSourceCase,main};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
