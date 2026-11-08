"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process");
const {fixtureApi,decision,publish,guardApiRequest,initializeOwnedBrowser,cleanupPreserving,boundary}=require("./thesis_capture_runtime.cjs");
const base="http://127.0.0.1:41911",id="00000000-0000-0000-0000-000000000001";
test("exact incumbent fixture endpoints and methods only",()=>{
 for(const [p,m] of [["/api/theses","POST"],["/api/thesis-saved-views","PUT"],[`/api/thesis/${id}/proposals`,"POST"],[`/api/thesis/${id}/proposals/${id}`,"PATCH"],["/api/thesis-fire-status","GET"]])assert.equal(fixtureApi(base+p,m,base),true);
 for(const [p,m] of [["/api/theses","PUT"],["/api/watchlist","POST"],["/api/thesis-fire-status","POST"],["/api/thesis/bad/proposals","POST"],["/api/%74heses","POST"]])assert.equal(fixtureApi(base+p,m,base),false);
 for(const host of ["https://provider.invalid","http://127.0.0.1:54321","http://evil@127.0.0.1:41911"])assert.equal(fixtureApi(host+"/api/theses","POST",base),false);
});
test("browser policy permits actual Analysis and static transport, denies providers/streams/private writes",()=>{
 const d=(url,method,resourceType)=>decision({url,method,resourceType},base);
 assert.equal(d(base+"/analysis?view=theses&lang=zh","GET","document"),"document");
 assert.equal(d(base+"/_next/static/chunk.js","GET","script"),"continue");
 assert.equal(d(base+"/api/theses","POST","fetch"),"fixture");
 assert.equal(d("https://provider.invalid/data/quotes","GET","fetch"),"fulfill");
 assert.equal(d("https://provider.invalid/chunk.js","GET","script"),"abort");
 assert.equal(d(base+"/api/accuracy/claims","POST","fetch"),"abort");
 assert.equal(d(base+"/_next/webpack-hmr","GET","websocket"),"abort");
});
test("Node preload refuses before actual DNS/socket/fetch and scopes exact localport",()=>{
 const script=`const n=require('node:net'),d=require('node:dns');let results=0;for(const run of [()=>n.connect({host:'example.invalid',port:443}),()=>n.connect({host:'127.0.0.1',port:54321}),()=>d.lookup('example.invalid'),()=>d.lookup('::1'),()=>n.createServer().listen(41912,'127.0.0.1')]){try{run();throw Error('unexpected');}catch(e){if(e.message!=='THESIS_CAPTURE_EXTERNAL_EGRESS_DENIED')throw e;results++;}}globalThis.fetch('https://example.invalid').then(()=>process.exit(1),e=>{if(e.message!=='THESIS_CAPTURE_EXTERNAL_EGRESS_DENIED')throw e;console.log(results+1)});`;
 const out=cp.execFileSync(process.execPath,["--require",path.join(__dirname,"thesis_capture_egress.cjs"),"-e",script],{env:{PATH:process.env.PATH,THESIS_CAPTURE_SERVER:"1",TERMINAL_E2E_FIXTURE:"1",TERMINAL_F11_PROVIDER_CLOSED:"1",THESIS_CAPTURE_PORT:"41911"},encoding:"utf8"});
 assert.equal(out.trim(),"6");
});
test("incomplete or unsettled records preserve all old outputs",()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"thesis-capture-check-"));
 try{const stage=path.join(temp,"stage"),target=path.join(temp,"target");fs.mkdirSync(stage);fs.mkdirSync(target);fs.writeFileSync(path.join(target,"one.png"),"old-image");fs.writeFileSync(path.join(target,"EVIDENCE.yml"),"old-lock");
 // eslint-disable-next-line @typescript-eslint/no-require-imports -- Mock image bytes in the incumbent CommonJS harness.
 const ready={counts:{contexts:1,contextsClosed:1,browsersClosed:1,redirectsDenied:0,canonicalFontWitnesses:[{file:"one.png",receiptSha256:"1d04bbe5678ad7eef6e969a5c46e643f9526695bc3167de5a7d8a29280b6ca0f",loadedFaces:[{family:"Inter",status:"loaded"},{family:"JetBrains Mono",status:"loaded"}],verifiedBodies:[{family:"Inter",subset:"latin"},{family:"JetBrains Mono",subset:"latin"}],renderedGlyphs:[{kind:"numeric",present:false,status:"not_present",requiresCustomInter:false},{kind:"native-ui",present:false,status:"not_present",requiresCustomInter:false},{kind:"latin",present:true,requiresCustomInter:true,fonts:[{familyName:"Inter",isCustomFont:true,glyphCount:1}]},{kind:"crop",present:true,requiresCustomInter:false,fonts:[{glyphCount:1}]}],imageSha256:require("node:crypto").createHash("sha256").update("new-image").digest("hex"),imageBytes:9}]}};
 assert.throws(()=>publish(stage,target,["one.png"],ready));assert.equal(fs.readFileSync(path.join(target,"one.png"),"utf8"),"old-image");
 fs.writeFileSync(path.join(stage,"one.png"),"new-image");fs.writeFileSync(path.join(stage,"EVIDENCE.yml"),"new-lock");
 assert.throws(()=>publish(stage,target,["one.png"],{counts:{...ready.counts,contextsClosed:0}}));assert.equal(fs.readFileSync(path.join(target,"EVIDENCE.yml"),"utf8"),"old-lock");
 publish(stage,target,["one.png"],ready);assert.equal(fs.readFileSync(path.join(target,"EVIDENCE.yml"),"utf8"),"new-lock");assert.equal(fs.readFileSync(path.join(stage,"previous","one.png"),"utf8"),"old-image");
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test("all exposed API transports refuse foreign/forged methods before original fetch",async()=>{
 const reached=[],request={fetch:async(url,options)=>{reached.push({url,options});return "local";}};
 const counts={directFixtureRequests:0};guardApiRequest(request,base,counts);
 for(const name of ["get","post","put","patch","delete","head","fetch"])
  await assert.rejects(()=>request[name]("https://provider.invalid/test"),/THESIS_CAPTURE_API_SCOPE/);
 for(const input of [new URL(base+"/api/theses"),{url:base+"/api/theses"},{toString:()=>base+"/api/theses"},null])
  await assert.rejects(()=>request.fetch(input),/THESIS_CAPTURE_API_SCOPE/);
 for(const method of ["HEAD","TRACE","CONNECT",{},null,"POST "])
  await assert.rejects(()=>request.fetch(base+"/api/theses",{method}),/THESIS_CAPTURE_API_SCOPE/);
 await assert.rejects(()=>request.head(base+"/api/theses"),/THESIS_CAPTURE_API_SCOPE/);
 assert.equal(reached.length,0);
 assert.equal(await request.fetch(base+"/api/theses",{method:"POST",maxRedirects:99,data:{action:"create"}}),"local");
 assert.equal(await request.get(base+"/api/theses",{method:"DELETE",maxRedirects:99}),"local");
 assert.deepEqual(reached.map(x=>[x.options.method,x.options.maxRedirects]),[["POST",0],["GET",0]]);
 assert.equal(counts.directFixtureRequests,2);
});

test("postlaunch metadata failure closes owned server, preserves cause and cleanup uncertainty",async()=>{
 let closes=0,probes=0;const server={close:async()=>{closes++;},process:()=>({pid:99})};
 let error;
 await assert.rejects(()=>initializeOwnedBrowser(server,async()=>{
  try { fs.readFileSync(path.join(__dirname,"missing-thesis-browser-metadata.test-only")); }
  catch(actual){error=actual;throw actual;}
 },async pid=>{assert.equal(pid,99);probes++;}),actual=>actual===error && actual.code==="ENOENT");
 assert.equal(closes,1);assert.equal(probes,1);assert.deepEqual(error.ownedBrowserCleanup,{serverCloseObserved:true,processAbsent:true,unknown:false});
 const unknown=new Error("original initialization error");
 await assert.rejects(()=>initializeOwnedBrowser({close:async()=>{throw Error("close failed");},process:()=>({pid:99})},async()=>{throw unknown;},()=>{throw Error("must not probe after failed close");}),actual=>actual===unknown);
 assert.equal(unknown.ownedBrowserCleanup.unknown,true);assert.equal(unknown.ownedBrowserCleanup.serverCloseObserved,false);
 let healthyCloses=0;assert.equal(await initializeOwnedBrowser({close:async()=>{healthyCloses++;}},async()=>"healthy",()=>{throw Error("must not probe healthy live browser");}),"healthy");assert.equal(healthyCloses,0);
});

test("a cleanup exception never masks the original capture failure",async()=>{
 const primary=new Error("primary"),cleanup=new Error("cleanup");
 await assert.rejects(()=>cleanupPreserving(primary,async()=>{throw cleanup;}),actual=>actual===primary && actual.cleanupError===cleanup);
 await assert.rejects(()=>cleanupPreserving(null,async()=>{throw cleanup;}),actual=>actual===cleanup);
 assert.equal(await cleanupPreserving(primary,async()=>"closed"),"closed");
});

test("generic namespace absent-to-absent is a no-write only after custody/source checks",()=>{
 const {prepareNamespace}=require("./f11_owned_server.cjs");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"thesis-types-"));
 try{
  for(const name of ["tsconfig.json","tsconfig.f11.json"])fs.writeFileSync(path.join(root,name),"{}\n");
  const clean=prepareNamespace(root);clean.restoreGeneratedTypeFile();assert.equal(clean.summary().nextEnvRestored,true);assert.equal(fs.existsSync(path.join(root,"next-env.d.ts")),false);
  const changed=prepareNamespace(root);fs.writeFileSync(path.join(root,"tsconfig.json"),"{ }\n");assert.throws(()=>changed.restoreGeneratedTypeFile(),/F11_TYPESCRIPT_SOURCE_CHANGED/);
  const unknown=prepareNamespace(root);fs.writeFileSync(path.join(root,"next-env.d.ts"),"unrecognized generated file");assert.throws(()=>unknown.restoreGeneratedTypeFile(),/F11_GENERATED_TYPES_UNKNOWN/);
  fs.unlinkSync(path.join(root,"next-env.d.ts"));const linked=prepareNamespace(root);fs.symlinkSync(path.join(root,"tsconfig.json"),path.join(root,"next-env.d.ts"));assert.throws(()=>linked.restoreGeneratedTypeFile(),/F11_GENERATED_FILE_CUSTODY/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test("literal lookup supports Node listener setup with no DNS or bind in the discriminator",()=>{
 const probe=`const net=require('node:net'),dns=require('node:dns');const calls=[];dns.lookup=(host,options,callback)=>{if(typeof options==='function')callback=options;calls.push(host);callback(Object.assign(new Error('CONTROLLED_BEFORE_BIND'),{code:'CONTROLLED_BEFORE_BIND'}));};const s=net.createServer();s.once('error',e=>console.log(JSON.stringify({calls,error:e.code,listening:s.listening})));s.listen(41911,'127.0.0.1');`;
 const result=JSON.parse(cp.execFileSync(process.execPath,["-e",probe],{encoding:"utf8"}));assert.deepEqual(result,{calls:["127.0.0.1"],error:"CONTROLLED_BEFORE_BIND",listening:false});
 const script=`const dns=require('node:dns');Promise.all([new Promise((resolve,reject)=>dns.lookup('127.0.0.1',{all:true},(e,v)=>e?reject(e):resolve(v))),dns.promises.lookup('127.0.0.1')]).then(v=>console.log(JSON.stringify(v)));`;
 const out=cp.execFileSync(process.execPath,["--require",path.join(__dirname,"thesis_capture_egress.cjs"),"-e",script],{env:{PATH:process.env.PATH,THESIS_CAPTURE_SERVER:"1",TERMINAL_E2E_FIXTURE:"1",TERMINAL_F11_PROVIDER_CLOSED:"1",THESIS_CAPTURE_PORT:"41911"},encoding:"utf8"});assert.deepEqual(JSON.parse(out),[[{address:"127.0.0.1",family:4}],{address:"127.0.0.1",family:4}]);
});

function fakeRuntimeIo({failJournalAt=Infinity,failAppend=false,failStop=false,fontError,fontFacts}={}) {
 const vm=require("node:vm"),{EventEmitter}=require("node:events");
 const stats={writes:0,spawns:0,stops:0,restored:0};
 const child={pid:64001,stdout:new EventEmitter(),stderr:new EventEmitter()};
 const io=Object.assign(new Error("controlled diagnostic IO"),{code:"EIO"});
 const fakeFs={...fs,writeFileSync(_file,body){stats.lastSnapshot=body;if(++stats.writes>=failJournalAt)throw io;},appendFileSync(){if(failAppend)throw io;}};
 const module={exports:{}};
 const requires=name=>{
  if(name==="node:fs")return fakeFs;
  if(name==="./thesis_capture_fonts.cjs")return {prepareFontEnvironment:()=>({env:{},provenance:{}}),installFontWitness(){},fontFailureFacts:error=>error===fontError?fontFacts:null};
  if(name==="node:net")return {createServer:()=>({once(){},listen(_p,_h,ready){ready();},close(done){done();}})};
  if(name==="node:child_process")return {spawn(){stats.spawns++;return child;},execFileSync(){return "";}};
  if(name==="./capture_b_f11_10_analysis_theses_entry.cjs")return {assertNoCaptureDotenv(){},captureServerEnv:()=>({})};
  if(name==="./f11_owned_server.cjs")return {prepareNamespace:()=>({restoreGeneratedTypeFile(){stats.restored++;},summary:()=>({restored:true})}),trackOwnedServer:()=>({assertRunning(){},async stop(){stats.stops++;if(failStop)throw Error("CONTROLLED_STOP_UNKNOWN");},settlement:()=>({pid:64001,processGroupAbsent:true})})};
  return require(name);
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"thesis_capture_runtime.cjs"),"utf8"),{module,exports:module.exports,require:requires,__dirname,Buffer,URL,AbortSignal,setTimeout,process:{env:{},stdout:{write(){}},getuid:()=>process.getuid()}});
 return {api:module.exports,stats,child,io};
}
test("journal EIO after spawn awaits owned cleanup; error-path note cannot mask primary",async()=>{
 const f=fakeRuntimeIo({failJournalAt:2});
 await assert.rejects(()=>f.api.start("/fake-root",41921,"/fake-stage"),e=>e===f.io && e.ownedServerCleanup.pid===64001 && e.ownedServerCleanup.processGroupAbsent===true);
 assert.equal(f.stats.spawns,1);assert.equal(f.stats.stops,1);assert.equal(f.stats.restored,1);
 const primary=Error("original primary"),cleanup=Error("cleanup uncertain");
 await assert.rejects(()=>f.api.cleanupPreserving(primary,async()=>{throw cleanup;}),e=>e===primary && e.cleanupError===cleanup);
 const unknown=fakeRuntimeIo({failJournalAt:2,failStop:true});
 await assert.rejects(()=>unknown.api.start("/fake-root",41921,"/fake-stage"),e=>e===unknown.io && e.ownedServerCleanup.unknown && e.cleanupError.message==="CONTROLLED_STOP_UNKNOWN");
 assert.equal(unknown.stats.stops,1);
});
test("stream log IO cannot throw uncaught, stops its owner and refuses publication",async()=>{
 const f=fakeRuntimeIo({failAppend:true});const owner=await f.api.start("/fake-root",41921,"/fake-stage");
 assert.doesNotThrow(()=>f.child.stdout.emit("data",Buffer.from("controlled server output")));
 await owner.stop();assert.equal(f.stats.stops,1);assert.equal(f.stats.restored,1);
 assert.throws(()=>owner.summary(),e=>e===f.io);
 assert.throws(()=>f.api.publish("/fake-stage","/fake-target",[],{}),e=>e===f.io);
 const pipe=fakeRuntimeIo();const other=await pipe.api.start("/fake-root",41921,"/fake-stage");
 assert.doesNotThrow(()=>pipe.child.stderr.emit("error",pipe.io));await other.stop();assert.equal(pipe.stats.stops,1);
 assert.throws(()=>other.summary(),e=>e===pipe.io);
});

test("font facts use the existing failure journal without replacing original cause or IO",async()=>{
 const error=Object.freeze(Error("private font failure details")),facts={schema:"thesis.font-observation.v1",phase:"platform-fonts",role:"numeric",platformFonts:[{familyName:"Arial",isCustomFont:false,glyphCount:3}]};
 const t=fakeRuntimeIo({fontError:error,fontFacts:facts}),owner=await t.api.start("/fake-root",41921,"/fake-stage");
 assert.doesNotThrow(()=>owner.failure(error));let snapshot=JSON.parse(t.stats.lastSnapshot),event=snapshot.events.find(e=>e.phase==="PRIMARY_FAILURE");
 assert.deepEqual(event.fontObservation,facts);assert.equal(event.message,"OTHER");await owner.stop();assert.equal(error.message,"private font failure details");
 const unavailable=fakeRuntimeIo({fontError:error,fontFacts:facts,failJournalAt:3}),other=await unavailable.api.start("/fake-root",41921,"/fake-stage");
 assert.doesNotThrow(()=>other.failure(error));await other.stop();assert.throws(()=>other.summary(),e=>e===unavailable.io);
 assert.equal(error.message,"private font failure details");
});


// Pure callback/teardown controls: no Playwright process or network is started.
function fakeBoundaryContext() {
 let handler,closed=false;
 return {request:{fetch:async()=>{}},routeWebSocket:async()=>{},
   route:async(_pattern,value)=>{handler=value;},
   close:async()=>{closed=true;},
   dispatch:route=>handler(route),isClosed:()=>closed};
}
function fakeRoute(fetch) {
 return {request:()=>({url:()=>base+"/_next/static/chunk.js",method:()=>"GET",resourceType:()=>"script"}),
   fetch,fulfill:async()=>{},abort:async()=>{}};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
test("context teardown waits for the actual in-flight route before closing its target",async()=>{
 const context=fakeBoundaryContext(),gate=deferred(),counts={};
 await boundary(context,base,counts);
 const callback=context.dispatch(fakeRoute(async()=>{await gate.promise;assert.equal(context.isClosed(),false);return {status:()=>200};}));
 const closing=context.close();await Promise.resolve();assert.equal(context.isClosed(),false);
 gate.resolve();await callback;await closing;assert.equal(context.isClosed(),true);
});
test("teardown refuses newly arriving routes without fetch while the first route drains",async()=>{
 const context=fakeBoundaryContext(),gate=deferred(),counts={};let fetched=0,aborted=0;
 await boundary(context,base,counts);
 const first=context.dispatch(fakeRoute(async()=>{await gate.promise;return {status:()=>200};}));
 const closing=context.close();
 const late=fakeRoute(async()=>{fetched++;return {status:()=>200};});late.abort=async()=>{aborted++;};
 await context.dispatch(late);assert.equal(fetched,0);assert.equal(aborted,1);
 gate.resolve();await first;await closing;
});
test("route rejection is handled, cleanup runs, and the original failure blocks publication",async()=>{
 const context=fakeBoundaryContext(),counts={contexts:1,contextsClosed:1,browsersClosed:1},cause=Error("synthetic fetch failure");
 await boundary(context,base,counts);
 await assert.doesNotReject(context.dispatch(fakeRoute(async()=>{throw cause;})));
 await context.close();assert.equal(context.isClosed(),true);
 assert.throws(()=>publish("unused-stage","unused-target",[],{counts}),actual=>actual===cause);
});
test("late abort failure is retained rather than ignored and closing preserves a primary capture failure",async()=>{
 const context=fakeBoundaryContext(),counts={},gate=deferred(),cause=Error("synthetic abort failure"),primary=Error("capture failure");
 await boundary(context,base,counts);
 const first=context.dispatch(fakeRoute(async()=>{await gate.promise;return {status:()=>200};}));
 const closing=context.close(),late=fakeRoute(async()=>{throw Error("must not fetch");});late.abort=async()=>{throw cause;};
 await assert.doesNotReject(context.dispatch(late));gate.resolve();await first;await closing;
 await assert.rejects(async()=>{try{throw primary;}finally{await context.close();}},actual=>actual===primary);
 assert.throws(()=>publish("unused-stage","unused-target",[],{counts}),actual=>actual===cause);
});

test("first route failure survives secondary close failure and the owned close is attempted once",async()=>{
 const context=fakeBoundaryContext(),counts={},cause=Error("first route failure"),cleanup=Error("close failure");let closes=0;
 context.close=async()=>{closes++;throw cleanup;};
 await boundary(context,base,counts);
 await context.dispatch(fakeRoute(async()=>{throw cause;}));
 await assert.rejects(context.close(),actual=>actual===cause && actual.cleanupError===cleanup);
 await assert.rejects(context.close(),actual=>actual===cause);assert.equal(closes,1);
});
test("routes delivered during actual close still settle, and pending or serialized failure counts cannot publish",async()=>{
 const context=fakeBoundaryContext(),counts={},gate=deferred();let fetched=0;
 context.close=async()=>{await context.dispatch({...fakeRoute(async()=>{fetched++;}),abort:async()=>{await gate.promise;}});};
 await boundary(context,base,counts);
 const closing=context.close();await Promise.resolve();await Promise.resolve();
 assert.throws(()=>publish("unused","unused",[],{counts}),/THESIS_CAPTURE_ROUTE_UNSETTLED/);
 gate.resolve();await closing;assert.equal(fetched,0);assert.equal(counts.routeCallbacksPending,0);
 assert.throws(()=>publish("unused","unused",[],{counts:{routeCallbacksFailed:1}}),/THESIS_CAPTURE_ROUTE_UNSETTLED/);
});
