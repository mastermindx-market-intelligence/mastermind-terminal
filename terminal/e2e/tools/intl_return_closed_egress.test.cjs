"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {install}=require("./intl_return_closed_egress.cjs");
const {cleanupAll,runOwned}=require("./run_intl_return_controlled.cjs");
const {LEGACY,VIEWS}=require("./intl_return_closed_policy.cjs");
const base="http://127.0.0.1:41951",ws="ws://127.0.0.1:41952/owned-exact-path";
function fakes(){
 let connected=0,requested=0;
 class Socket{connect(){connected++;return "connected";}}class Server{listen(){throw Error("unexpected listen");}}
 const req=()=>{requested++;return {end(){}};};
 return {net:{Socket,Server},dns:{promises:{}},http:{request:req},https:{request:req,get:req},global:{fetch:async()=>"fetched"},counts:()=>({connected,requested})};
}
test("runner/driver network admits only actual owned local socket and exact Next read proxy; no provider/DNS/listen",async()=>{
 const modules=fakes();install(base,ws,modules);
 assert.equal(new modules.net.Socket().connect({host:"127.0.0.1",port:41951}),"connected");
 assert.equal(new modules.net.Socket().connect({host:"127.0.0.1",port:41952}),"connected");
 for(const options of [{host:"provider.invalid",port:443},{host:"127.0.0.1",port:41953},{path:"/tmp/foreign.sock"},{host:"localhost",port:41951}])
  assert.throws(()=>new modules.net.Socket().connect(options),/EGRESS_DENIED/);
 assert.throws(()=>new modules.net.Server().listen(),/EGRESS_DENIED/);
 assert.throws(()=>modules.dns.lookup("provider.invalid",()=>{}),/EGRESS_DENIED/);
 assert.throws(()=>modules.dns.resolve("127.0.0.1"),/EGRESS_DENIED/);
 const q=new URLSearchParams({view:"investigations",intl_return:LEGACY+"/intl.html?"+VIEWS[0]});
 modules.http.request(base+"/analysis?"+q,{method:"GET"});
 modules.http.request(ws.replace(/^ws:/,"http:"),{method:"GET"});
 modules.http.request({hostname:"127.0.0.1",port:41951,path:"/api/shared-shell/status",method:"HEAD"});
 for(const [url,options] of [[base+"/api/investigations",{method:"GET"}],[base+"/api/shared-shell/status",{method:"POST"}],
  [base+"/api/shared-shell/status",{hostname:"provider.invalid"}],["https://provider.invalid/x",{}],[ws.replace(/^ws:/,"http:")+"extra",{}]])
  assert.throws(()=>modules.http.request(url,options),/EGRESS_DENIED/);
 assert.throws(()=>modules.https.request("https://provider.invalid/x"),/EGRESS_DENIED/);
 await assert.rejects(modules.global.fetch("https://provider.invalid/x",{redirect:"manual"}));
 await assert.rejects(modules.global.fetch(base+"/api/shared-shell/status",{redirect:"follow"}));
 assert.equal(await modules.global.fetch(base+"/api/shared-shell/status",{redirect:"manual"}),"fetched");
 assert.deepEqual(modules.counts(),{connected:2,requested:3});
});
test("cleanup attempts every owned resource even when earlier cleanup is unknown",async()=>{
 const calls=[],first=Error("OWN_RUNNER_UNKNOWN"),second=Error("OWN_BROWSER_UNKNOWN");
 await assert.rejects(cleanupAll([async()=>{calls.push("runner");throw first;},async()=>{calls.push("browser");throw second;},async()=>{calls.push("server");}]),error=>error===first);
 assert.deepEqual(calls,["runner","browser","server"]);assert.deepEqual(first.additionalCleanupErrors,[second]);
});

test("runner completion/error/timeout stay on original owned handle; no replacement",async()=>{
 const {EventEmitter}=require("node:events");
 for(const phase of ["complete","error","timeout"]){
  const child=new EventEmitter();child.pid=23456;let spawns=0,stops=0,timer;
  const deps={spawn:()=>{spawns++;return child;},track:()=>({stop:async()=>{stops++;},settlement:()=>({pid:23456,processGroupAbsent:true})}),
    schedule:fn=>{timer=fn;return 1;},cancel:()=>{}};
  const result=runOwned("fake",[],{},1,deps);
  if(phase==="complete"){child.emit("close",0,null);assert.equal((await result).code,0);}
  if(phase==="error"){const cause=Error("FAKE_PRIMARY");child.emit("error",cause);await assert.rejects(result,error=>error===cause && error.runnerSettlement.processGroupAbsent);}
  if(phase==="timeout"){timer();await assert.rejects(result,/RUNNER_TIMEOUT/);}
  assert.equal(spawns,1);assert.equal(stops,1);
 }
 const child=new EventEmitter();child.pid=23456;
 await assert.rejects(runOwned("fake",[],{},1,{spawn:()=>child,track:()=>{throw Error("FAKE_CUSTODY");}}),
  error=>error.message==="FAKE_CUSTODY" && error.runnerCustody.unknown===true);
});

test("runner cleanup UNKNOWN retains actual original PID and primary error",async()=>{
 const {EventEmitter}=require("node:events"),child=new EventEmitter();child.pid=23457;
 let timeout,stops=0;const cleanup=Error("FAKE_GROUP_UNKNOWN");
 const result=runOwned("fake",[],{},1,{spawn:()=>child,track:()=>({stop:async()=>{stops++;throw cleanup;}}),
  schedule:fn=>{timeout=fn;return 1;},cancel:()=>{}});
 timeout();
 await assert.rejects(result,error=>error.message==="INTL_RETURN_RUNNER_TIMEOUT"
  && error.runnerProcess.pid===23457 && error.runnerCleanup.unknown===true && error.cleanupError===cleanup);
 assert.equal(stops,1);
});

// Invoke the ACTUAL controller main/runOwned in a pure VM. No source branch is
// replaced; fake FS/process/timers are the only capability providers.
async function controllerCloseProbe(unknown) {
 const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{EventEmitter}=require("node:events");
 const filename=path.join(__dirname,"run_intl_return_controlled.cjs"),source=fs.readFileSync(filename,"utf8");
 const files=new Map(),unlinked=[];let spawns=0,stops=0,browserCloses=0,serverStops=0;
 const fakefs={realpathSync:x=>x,lstatSync:()=>({isDirectory:()=>true,uid:501,mode:0o700}),mkdtempSync:()=>"/owned/tmp/intl-return-fake",chmodSync:()=>{},
  writeFileSync:(p,b)=>files.set(p,String(b)),openSync:p=>{files.set(p,"");return 11;},closeSync:()=>{const e=Error("FAKE_LOG_CLOSE_EIO");e.code="EIO";throw e;},
  existsSync:p=>files.has(p),unlinkSync:p=>{unlinked.push(p);files.delete(p);},statSync:p=>({size:Buffer.byteLength(files.get(p))}),readFileSync:p=>Buffer.from(files.get(p))};
 const cp={execFileSync:(command,args)=>args[0]==="rev-parse" ? "frozen-source\n" : "",spawn:()=>{spawns++;const child=new EventEmitter();child.pid=23457;if(!unknown)queueMicrotask(()=>child.emit("close",0,null));return child;}};
 const server={ready:async()=>{},failure:()=>{},stop:async()=>{serverStops++;},summary:()=>({fixture:"source-only"})};
 const runtime={assertPortFree:async()=>{},start:async()=>server,getChromium:()=>({counts:{},toolchain:{version:"fake-controlled-source-only"},launch:async()=>({thesisOwnedWsEndpoint:"ws://127.0.0.1:41952/owned",close:async()=>{browserCloses++;}})})};
 const module={exports:{}};
 const fakeRequire=name=>{
  if(name==="node:fs")return fakefs;if(name==="node:child_process")return cp;
  if(name==="./thesis_capture_runtime.cjs")return runtime;
  if(name==="./capture_b_f11_10_analysis_theses_entry.cjs")return {captureServerEnv:()=>({})};
  if(name==="./f11_owned_server.cjs")return {trackOwnedServer:()=>({stop:async()=>{stops++;if(unknown)throw Error("FAKE_GROUP_UNKNOWN");},settlement:()=>({pid:23457,processGroupAbsent:true})})};
  if(name==="/owned/playwright/package.json")return {version:"1.63.0"};return require(name);
 };
 const context={require:fakeRequire,module,exports:module.exports,__dirname,Buffer,URL,console:{log:()=>{}},queueMicrotask,
  process:{argv:["node",filename],execPath:"node",getuid:()=>501,env:{TMPDIR:"/owned/tmp",THESIS_CAPTURE_PLAYWRIGHT_MODULE:"/owned/playwright",TERMINAL_CROP_PORT:"41951"}},
  setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout:()=>{}};
 vm.runInNewContext(source,context,{filename});let error;try{await module.exports.main();}catch(e){error=e;}
 const result=JSON.parse(files.get("/owned/tmp/intl-return-fake/RESULT.json"));
 return {error,result,unlinked,spawns,stops,browserCloses,serverStops};
}
test("actual main preserves timeout/PID/cleanupUNKNOWN through ancillary log-close EIO",async()=>{
 const r=await controllerCloseProbe(true);
 assert.equal(r.error.message,"INTL_RETURN_RUNNER_TIMEOUT");assert.equal(r.error.logCloseError.code,"EIO");
 assert.equal(r.result.primary.runnerProcess.pid,23457);assert.equal(r.result.primary.runnerCleanup.unknown,true);
 assert.equal(r.result.primary.logCloseError.code,"EIO");assert.equal(r.result.privateOperationRetained,"/owned/tmp/intl-return-fake/runner-input.json");
 assert.deepEqual(r.unlinked,[]);assert.equal(r.spawns,1);assert.equal(r.stops,1);assert.equal(r.browserCloses,1);assert.equal(r.serverStops,1);
});
test("actual main settled runner records standalone close EIO and removes only settled private input",async()=>{
 const r=await controllerCloseProbe(false);
 assert.equal(r.error.message,"FAKE_LOG_CLOSE_EIO");assert.equal(r.result.primary.message,"FAKE_LOG_CLOSE_EIO");
 assert.equal(r.result.runner.settlement.processGroupAbsent,true);assert.equal(r.result.privateOperationRetained,null);
 assert.deepEqual(r.unlinked,["/owned/tmp/intl-return-fake/runner-input.json"]);assert.equal(r.spawns,1);assert.equal(r.stops,1);assert.equal(r.browserCloses,1);assert.equal(r.serverStops,1);
});
