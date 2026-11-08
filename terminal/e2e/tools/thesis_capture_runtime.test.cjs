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


test("computed named-image font witness survives route and close failure in the existing CONTROL journal",async()=>{
 // eslint-disable-next-line @typescript-eslint/no-require-imports -- Exercise the actual incumbent font helper with offline CDP/response fakes.
 const fonts=require("./thesis_capture_fonts.cjs"),assets=path.resolve(__dirname,"../fixtures/retained-fonts-34fb");
 const receipt=JSON.parse(fs.readFileSync(path.join(assets,"receipt.json"))),t=fakeRuntimeIo(),owner=await t.api.start("/fake-root",41921,"/fake-stage");
 const counts={},temp=fs.mkdtempSync(path.join(os.tmpdir(),"computed-font-retention-"));let response;
 const session={async send(method){
  if(method==="Runtime.evaluate")return {result:{objectId:"controlled"}};
  if(method==="Runtime.callFunctionOn")return {result:{value:{tag:"SPAN",fontFamily:"Inter",weight:"400",hasLatin:true,hasNumeric:true,hasOtherScript:false}}};
  if(method==="DOM.requestNode")return {nodeId:1};
  if(method==="CSS.getPlatformFontsForNode")return {fonts:[{familyName:"Inter",postScriptName:"Inter-Regular",isCustomFont:true,glyphCount:4}]};
  return {};
 },async detach(){}};
 const page={on(event,handler){if(event==="response")response=handler;},
  async evaluate(){return [{family:"Inter",weight:"100 900",style:"normal",status:"loaded"},{family:"JetBrains Mono",weight:"100 800",style:"normal",status:"loaded"}];},
  context(){return {async newCDPSession(){return session;}};},
  async screenshot(options){const image=Buffer.from("controlled-computed-png");fs.writeFileSync(options.path,image);return image;}};
 const context=fakeBoundaryContext();context.newPage=async()=>page;
 const routeError=Error("route failed"),closeError=Error("close unknown"),gate=deferred();let witnessBeforeClose=false;
 context.close=async()=>{const snapshot=JSON.parse(t.stats.lastSnapshot);witnessBeforeClose=snapshot.events.some(e=>e.phase==="CAPTURE_WITNESS_SNAPSHOT");throw closeError;};
 try{
  await t.api.boundary(context,base,counts);fonts.installFontWitness(context,counts);await context.newPage();
  for(const family of receipt.families){const f=family.files.find(x=>x.subset==="latin");response({url:()=>base+"/_next/static/media/"+f.sha256+".woff2",status:()=>200,body:async()=>fs.readFileSync(path.join(assets,f.file))});}
  await fonts.captureCanonicalScreenshot(page,page,{path:path.join(temp,"computed.png")});
  const actual=counts.canonicalFontWitnesses[0];assert.equal(actual.file,"computed.png");assert(actual.imageSha256);assert.equal(actual.renderedGlyphs[0].fonts[0].glyphCount,4);
  actual.privateUiText="NEVER_RETAIN_PRIVATE_TEXT";actual.renderedGlyphs[0].selectedElement.textContent="NEVER_RETAIN_PRIVATE_TEXT";
  const active=context.dispatch(fakeRoute(async()=>{await gate.promise;throw routeError;}));
  const closing=context.close();gate.resolve();await active;
  await assert.rejects(closing,error=>error===routeError && error.cleanupError===closeError);
  assert(witnessBeforeClose,"witness must persist before actual context close");
  owner.failure(routeError);await owner.stop();
  const snapshot=JSON.parse(t.stats.lastSnapshot),event=snapshot.events.find(e=>e.phase==="CAPTURE_WITNESS_SNAPSHOT");
  assert.equal(event.scope,"computed_partial_not_publication");assert.equal(event.canonicalFontWitnesses.length,1);
  const retained=event.canonicalFontWitnesses[0];assert.equal(retained.file,"computed.png");assert.equal(retained.imageSha256,actual.imageSha256);assert.equal(retained.imageBytes,actual.imageBytes);
  assert.deepEqual(retained.loadedFaces,actual.loadedFaces);assert.equal(retained.verifiedBodies.length,2);assert(retained.verifiedBodies.every(b=>/^[0-9a-f]{64}$/.test(b.sha256)));
  assert.equal(retained.renderedGlyphs[0].fonts[0].glyphCount,4);assert.equal(retained.renderedGlyphs[0].fonts[0].familyName,"Inter");
  assert(!JSON.stringify(snapshot).includes("NEVER_RETAIN_PRIVATE_TEXT"));assert(!JSON.stringify(event).includes("uncomputed.png"));assert(!JSON.stringify(event).includes("/_next/"));
  assert(snapshot.events.some(e=>e.phase==="PRIMARY_FAILURE"));assert.throws(()=>t.api.publish(temp,"unused-target",["computed.png"],{counts}),error=>error===routeError);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test("witness-journal IO failure cannot skip owned context/server cleanup or fabricate publication",async()=>{
 const t=fakeRuntimeIo({failJournalAt:3}),owner=await t.api.start("/fake-root",41921,"/fake-stage"),context=fakeBoundaryContext(),primary=Error("original capture failure");
 await t.api.boundary(context,base,{});
 await assert.rejects(async()=>{try{throw primary;}finally{await context.close();}},e=>e===primary);
 assert(context.isClosed());await owner.stop();assert.equal(t.stats.stops,1);assert.equal(t.stats.restored,1);
 assert.throws(()=>owner.summary(),e=>e===t.io);assert.throws(()=>t.api.publish("unused","unused",[],{counts:{}}),e=>e===t.io);
});

// Fixed representative light mode uses the same runtime/CI command; no new job.
const lightBodies=require("./thesis_capture_light_bodies.cjs");
test("representative light selection is finite, four observations per existing family",()=>{
 assert.equal(lightBodies.captureMode([]),"dark");assert.equal(lightBodies.captureMode(["--light-representative"]),lightBodies.LIGHT_MODE);
 for(const args of [["--light"],["--light-representative","--width=800"],["--light-representative=1"],["--light-representative","--light-representative"],null])assert.throws(()=>lightBodies.captureMode(args),/PRESENTATION_SCOPE/);
 assert.deepEqual(require("./thesis_capture_runtime.cjs").capturePresentationEnvironment(lightBodies.LIGHT_MODE),{MMX_SHARED_SHELL:"1"});
 const research=lightBodies.plan("research");assert.deepEqual(research.map(s=>[s.width,s.lang,s.surface]),[[1440,"en","save-flow"],[1440,"zh","view-subject-empty"],[390,"en","save-flow"],[390,"zh","save-flow"]]);
 assert.equal(lightBodies.plan("proposals").filter(s=>s.surface==="populated").length,4);
 for(const family of ["claim","",null,{}])assert.throws(()=>lightBodies.plan(family),/LIGHT_FAMILY/);
});
function lightFacts(shot){return {sharedShell:"1",theme:"light",lang:shot.lang,lightPressed:"true",localePressed:shot.lang==="zh"?"true":"false",viewport:{width:shot.width,height:shot.width===1440?900:844},panelToken:"#ffffff",textToken:"#202632",body:{width:290,height:600}};}
test("light root attributes alone cannot substitute for owner/locale/material/current viewport",()=>{
 const shot=lightBodies.plan("research")[0],facts=lightFacts(shot);assert.equal(lightBodies.assertObservation(facts,shot),facts);
 for(const change of [{sharedShell:null},{theme:"dark"},{lang:"zh"},{lightPressed:"false"},{localePressed:"true"},{panelToken:"#181b21"},{textToken:"#d7dce3"},{viewport:{width:390,height:844}},{body:{width:0,height:600}},{body:{width:290,height:NaN}}])assert.throws(()=>lightBodies.assertObservation({...facts,...change},shot),/LIGHT_PRESENTATION/);
});
test("actual owner public toggles settle both locale and light with no theme/root injection",async()=>{
 for(const lang of ["en","zh"]){
  const actions=[];const page={locator:()=>({waitFor:async()=>{}}),getByRole:(role,options)=>{assert.equal(role,"button");assert.equal(options.includeHidden,undefined);assert(options.name instanceof RegExp);return {waitFor:async()=>{},getAttribute:async()=>"false",click:async()=>actions.push(options.name.source)};},waitForFunction:async(fn,arg)=>{assert(arg===null || (arg.requested===lang && arg.theme==="light"));assert.match(fn.toString(),/mmxSharedShell/);}};
  await lightBodies.settleOwner(page,lang);assert.equal(actions.length,lang==="zh"?2:1);assert(actions[0].includes("Light theme"));
 }
 await assert.rejects(lightBodies.settleOwner({},"de"),/LIGHT_LOCALE/);
});
function lightStylePage(){let listener;return {on:(name,fn)=>{assert.equal(name,"response");listener=fn;},emit:r=>listener(r)};}
function lightStyleResponse(url="http://127.0.0.1:41911/_next/static/css/app.css?private=not-retained",body="data-mmx-shared-shell ThesisWorkspace",status=200){return {url:()=>url,request:()=>({resourceType:()=>"stylesheet"}),status:()=>status,body:async()=>Buffer.from(body)};}
test("representative light CSS captures exact local bodies, no query/raw text and refuses missing facets/errors",async()=>{
 const page=lightStylePage(),read=lightBodies.retainStyles(page,base);page.emit(lightStyleResponse());const [entry]=await read();assert.equal(entry.path,"/_next/static/css/app.css");assert.match(entry.sha256,/^[0-9a-f]{64}$/);assert(!JSON.stringify(entry).includes("private"));
 for(const response of [lightStyleResponse("https://provider.invalid/a.css"),lightStyleResponse("http://user@127.0.0.1:41911/_next/static/a.css"),lightStyleResponse("malformed"),lightStyleResponse(undefined,"missing"),lightStyleResponse(undefined,undefined,500),{...lightStyleResponse(),body:async()=>{throw Error("BODY_UNKNOWN");}}]){
  const p=lightStylePage(),r=lightBodies.retainStyles(p,base);p.emit(response);await assert.rejects(r());
 }
});
test("representative publication requires exactly current four named owner/CSS observations",()=>{
 const shots=lightBodies.plan("research"),files=shots.map(s=>s.file),observations=shots.map(s=>({file:s.file,facts:lightFacts(s),deliveredStyles:[{sharedShell:true,workspace:true}]}));
 lightBodies.assertComplete("research",files,observations);
 for(const [f,o] of [[files.slice(1),observations],[files,observations.slice(1)],[[...files.slice(0,3),files[0]],observations],[files,observations.map((v,i)=>i? v:{...v,deliveredStyles:[]})]])assert.throws(()=>lightBodies.assertComplete("research",f,o),/LIGHT_INCOMPLETE/);
});
test("both actual drivers select only fixed runtime mode before any child transport",async()=>{
 const vm=require("node:vm");
 for(const file of ["capture_f11_4_research_views.cjs","capture_b_f11_5_thesis_proposals.cjs"]){
  for(const args of [[],["--light-representative"]]){
   const calls=[];let exited;const runtime={getChromium:()=>({}),staging:(_root,family)=>"/private/stage/"+family,start:async(...values)=>{calls.push(values);throw Error("CONTROLLED_NO_EFFECT");}};
   const quietFs={mkdirSync:()=>{},readFileSync:()=>Buffer.from("unused"),writeFileSync:()=>{throw Error("UNEXPECTED_WRITE");}};
   const context={require:name=>name==="./thesis_capture_runtime.cjs"?runtime:name==="./thesis_capture_light_bodies.cjs"?lightBodies:name==="node:fs"?quietFs:name==="node:child_process"?{execFileSync:()=>"exact-source"}:require(name),__dirname,process:{argv:["node",file,...args],env:{},stdout:{write:()=>{}},exit:code=>{exited=code;}},console:{error:()=>{}}};
   vm.runInNewContext(fs.readFileSync(path.join(__dirname,file),"utf8"),context);await new Promise(resolve=>setImmediate(resolve));
   assert.equal(calls.length,1);assert.equal(calls[0][3],args.length?lightBodies.LIGHT_MODE:"dark");assert.equal(exited,1);
  }
 }
});

test("light driver source keeps existing default dark families and strict publication while separating light artifacts",()=>{
 for(const name of ["capture_f11_4_research_views.cjs","capture_b_f11_5_thesis_proposals.cjs"]){
  const source=fs.readFileSync(path.join(__dirname,name),"utf8");
  assert.match(source,/if \(process.env.CAPTURE_ONLY\) throw Error\("THESIS_CAPTURE_PARTIAL_REFUSED"\)/);
  assert.match(source,/REP \? join\(TARGET,LIGHT \? "light-representative" : "dark-representative"\) : TARGET/);
  assert.match(source,/if\(REP\)light.assertComplete/);
  assert.match(source,/await runtime.captureCanonicalScreenshot/);
  assert.match(source,/colorScheme: LIGHT \? "light" : "dark"/);
  assert.match(source,/if\(!REP\)await (?:context|page).addInitScript/);
 }
 const owner=lightBodies.settleOwner.toString();assert.doesNotMatch(owner,/evaluate|addInitScript|localStorage|setAttribute/);
 assert.match(owner,/waitForFunction/);assert.match(owner,/mmxSharedShell/);
 assert.equal(new Set(lightBodies.SOURCE_FILES).size,15);
});

test("light owner actions use exact visible role names rather than duplicated hidden responsive controls",async()=>{
 const calls=[];
 const page={locator:selector=>{assert.equal(selector,'[data-shared-shell="beta"]');return {waitFor:async()=>{}};},
  getByRole:(role,options)=>{assert.equal(role,"button");assert.equal(options.includeHidden,undefined);calls.push(options.name.source);return {waitFor:async()=>{},getAttribute:async()=>"true",click:async()=>{}};},waitForFunction:async()=>{}};
 await lightBodies.settleOwner(page,"zh");assert.deepEqual(calls,["^(Light theme|浅色主题)$","^(Chinese language|中文界面)$"]);
});

test("light observation facts read the same visible role controls instead of a hidden duplicate",async()=>{
 const shot=lightBodies.plan("research")[0],calls=[];
 const page={getByRole:(role,options)=>{assert.equal(role,"button");assert.equal(options.includeHidden,undefined);calls.push(options.name.source);return {getAttribute:async()=>options.name.test("Light theme")?"true":"false"};}};
 const target={evaluate:async fn=>{if(fn===lightBodies.observeSmallTextRendering)return {status:"observed",roles:[],namingInput:{present:false}};assert.doesNotMatch(fn.toString(),/aria-pressed|querySelector\('button/);return {...lightFacts(shot),lightPressed:"false",localePressed:"true"};}};
 const facts=await lightBodies.observe(page,target,shot);assert.equal(facts.lightPressed,"true");assert.equal(facts.localePressed,"false");assert.equal(calls.length,2);
});

test("fixed dark representative is exactly one EN1440 named state per family, independent from full dark and light",()=>{
 assert.equal(lightBodies.captureMode(["--dark-representative"]),lightBodies.DARK_MODE);
 assert.deepEqual(require("./thesis_capture_runtime.cjs").capturePresentationEnvironment(lightBodies.DARK_MODE),{MMX_SHARED_SHELL:"1"});
 for(const args of [["--dark-representative","--lang=zh"],["--dark-representative","--light-representative"],["--dark-representative=1"],["--dark-representative","--width=390"]])assert.throws(()=>lightBodies.captureMode(args),/PRESENTATION_SCOPE/);
 for(const family of ["research","proposals"]){
  const shots=lightBodies.plan(family,lightBodies.DARK_MODE);assert.equal(shots.length,1);assert.deepEqual([shots[0].width,shots[0].lang,shots[0].theme],[1440,"en","dark"]);
  assert.equal(shots[0].surface,family==="research"?"save-flow":"populated");
  const facts={...lightFacts(shots[0]),theme:"dark",lightPressed:"false",panelToken:"#181b21",textToken:"#d7dce3"};
  lightBodies.assertObservation(facts,shots[0]);const obs=[{file:shots[0].file,facts,deliveredStyles:[{sharedShell:true,workspace:true}]}];
  lightBodies.assertComplete(family,[shots[0].file],obs,lightBodies.DARK_MODE);
  assert.throws(()=>lightBodies.assertComplete(family,[],obs,lightBodies.DARK_MODE),/INCOMPLETE/);
  assert.throws(()=>lightBodies.assertComplete(family,[shots[0].file,shots[0].file],obs,lightBodies.DARK_MODE),/INCOMPLETE/);
  assert.throws(()=>lightBodies.assertObservation({...facts,lightPressed:"true"},shots[0]),/PRESENTATION/);
  assert.throws(()=>lightBodies.assertObservation(facts,{...shots[0],width:390}),/PRESENTATION/);
  assert.throws(()=>lightBodies.assertObservation(facts,{...shots[0],lang:"zh"}),/PRESENTATION/);
  assert.equal(lightBodies.plan(family).length,4);assert.throws(()=>lightBodies.plan(family,"dark"),/SCOPE/);
 }
});
test("dark representative toggles the same actual visible owner off and keeps locale EN",async()=>{
 const actions=[];const page={locator:()=>({waitFor:async()=>{}}),getByRole:(_role,options)=>({waitFor:async()=>{},getAttribute:async()=>"true",click:async()=>actions.push(options.name.source)}),waitForFunction:async(_fn,arg)=>{if(arg)assert.deepEqual(arg,{requested:"en",theme:"dark"});}};
 await lightBodies.settleOwner(page,"en","dark");assert.deepEqual(actions,["^(Light theme|浅色主题)$","^(Chinese language|中文界面)$"]);
 await assert.rejects(lightBodies.settleOwner(page,"en","auto"),/SCOPE/);
});

test("actual driver main selects full20/8, fixedlight4 and fixeddark1 with distinct publication manifests",async()=>{
 const vm=require("node:vm");
 for(const family of ["research","proposals"]){
  const file=family==="research"?"capture_f11_4_research_views.cjs":"capture_b_f11_5_thesis_proposals.cjs";
  for(const args of [[],["--light-representative"],["--dark-representative"]]){
   const publications=[],writes=[],calls=[];let stopped=0,browserClosed=0,contextsClosed=0;
   const page={setDefaultTimeout:()=>{},on:()=>{}};
   const browser={newContext:async()=>({addCookies:async()=>{},addInitScript:async()=>{},newPage:async()=>page,close:async()=>{contextsClosed++;}}),close:async()=>{browserClosed++;}};
   const runtime={getChromium:()=>({launch:async()=>browser,counts:{},toolchain:{}}),staging:()=>"/private/new-stage",start:async(...values)=>{calls.push(values);return {ready:async()=>{},stop:async()=>{stopped++;},summary:()=>({}),failure:()=>{}};},cleanupPreserving:async(_error,action)=>action(),publish:(stage,target,files,control)=>publications.push({stage,target,files:[...files],control})};
   const fakeFs={mkdirSync:()=>{},readFileSync:()=>Buffer.from("controlled-layout-source"),writeFileSync:(file,body)=>writes.push({file,body})};
   const context={require:name=>name==="./thesis_capture_runtime.cjs"?runtime:name==="./thesis_capture_light_bodies.cjs"?lightBodies:name==="node:fs"?fakeFs:name==="node:child_process"?{execFileSync:()=>"controlled-source-head"}:require(name),module:{exports:{}},__dirname,process:{argv:["node",file,...args],env:{},stdout:{write:()=>{}}},console:{log:()=>{},error:()=>{}},__family:family,__facts:shot=>({...lightFacts(shot),...(shot.theme==="dark"?{theme:"dark",lightPressed:"false",panelToken:"#181b21",textToken:"#d7dce3"}:{})})};
   const original=fs.readFileSync(path.join(__dirname,file),"utf8"),at=original.lastIndexOf("\nmain().catch");assert(at>0);
   vm.createContext(context);vm.runInContext(original.slice(0,at)+"\nmodule.exports={main};",context);
   // Only capture/DOM leaves are fake. The original main selection, manifest,
   // context lifecycle and complete-family predicate above remain actual source.
   const record=`async function recordCapture(...values){const file=require('node:path').basename(values[values.length-1]);if(REP){const shot=light.plan(__family,MODE).find(s=>s.file===file);if(!shot)throw Error('UNDECLARED_SHOT');lightObservations.push({file,facts:__facts(shot),deliveredStyles:[{sharedShell:true,workspace:true}]});}}`;
   vm.runInContext(record+(family==="research"?"\ncaptureEmpty=recordCapture;captureNamed=recordCapture;captureSaveFlow=recordCapture;captureWindowClosed=recordCapture;captureViewSubjectEmpty=recordCapture;captureUnavailable=recordCapture;":"\nopenPanel=async()=>{};shoot=async(page,file)=>recordCapture(file);"),context);
   await context.module.exports.main();assert.equal(publications.length,1);assert.equal(stopped,1);assert.equal(browserClosed,1);
   const pub=publications[0],rep=args.length>0,isDark=args[0]==="--dark-representative";
   assert.equal(pub.files.length,rep?(isDark?1:4):(family==="research"?20:8));assert.equal(contextsClosed,pub.files.length);
   assert.equal(calls[0][3],rep?(isDark?lightBodies.DARK_MODE:lightBodies.LIGHT_MODE):"dark");
   if(rep){assert(pub.target.endsWith(isDark?"/dark-representative":"/light-representative"));assert(pub.files.every(f=>f.startsWith(isDark?"dark-":"light-")));assert.match(writes[0].body,new RegExp('theme: '+(isDark?'dark':'light')));}
   else {assert(!pub.target.endsWith("-representative"));assert(!pub.files.some(f=>/^(light|dark)-/.test(f)));}
  }
 }
});

function textObserverFixture(lang="en",extra=""){
 const {JSDOM}=require("jsdom"),vm=require("node:vm");
 const placeholder=lang==="zh"?"为这个视图命名":"Name this view";
 const dom=new JSDOM(`<html data-lang="${lang}"><body><aside id="target"><nav data-testid="thesis-lens-rail"><button role="tab" aria-selected="true"><span>Theses</span><span>2</span></button><button role="tab" aria-selected="false"><span>Review</span><span>0</span></button></nav><p data-testid="rms-scope">Scope</p><form style="background:#eef1f6;opacity:.8"><input aria-label="${placeholder}" placeholder="${placeholder}" style="font-family:Inter;font-size:12px;color:#202632;background:#eef1f6;opacity:1"/><button type="submit" disabled>Save</button></form><section data-testid="thesis-assistant-notes"><div><h2>Notes</h2></div><p>Help</p><label>Suggested change<textarea></textarea></label><div><button data-testid="thesis-suggest-amendment">Suggest</button></div></section><section data-testid="thesis-proposals"><div><h2>Proposals</h2><span>3</span></div><p data-testid="thesis-proposals-ceiling">Ceiling</p><article data-testid="thesis-proposal-row"><p>Body</p><p>Based on</p><div><i data-state="accepted">Accepted</i><time>Time</time></div><div><button>Accept</button><button>Reject</button></div></article></section>${extra}</aside></body></html>`);
 // JSDOM supplies actual selectors and properties, not rendered layout/pseudo
 // styles. Only those two unimplemented browser primitives are controlled here.
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,width:100,height:20};};
 const calls=[],getComputedStyle=(node,pseudo)=>{if(pseudo){calls.push(pseudo);assert.equal(pseudo,"::placeholder");return {color:"rgb(84, 97, 116)",opacity:"1",fontSize:"12px",fontFamily:"Inter",fontWeight:"400",fontStyle:"normal",lineHeight:"normal"};}return dom.window.getComputedStyle(node);};
 const target=dom.window.document.getElementById("target");
 return {dom,target,calls,read:()=>vm.runInNewContext(`(${lightBodies.observeSmallTextRendering.toString()})(element)`,{element:target,document:dom.window.document,getComputedStyle})};
}
test("observer reads actual enabled empty naming input/pseudo styles and bounded audit roles without mutation",()=>{
 for(const lang of ["en","zh"]){const f=textObserverFixture(lang),before=f.target.outerHTML,read=f.read();
  assert.equal(read.status,"observed");assert.equal(read.roles.length,19);const input=read.namingInput;
  assert.equal(input.enabled,true);assert.equal(input.disabledProperty,false);assert.equal(input.readOnly,false);assert.equal(input.valueEmpty,true);assert.equal(input.placeholderMatchesLocale,true);assert.equal(input.saveButton.disabled,true);
  assert.equal(input.placeholderStyle.color,"rgb(84, 97, 116)");assert.equal(input.placeholderStyle.opacity,"1");assert.equal(input.placeholderStyle.fontSize,"12px");assert.equal(input.placeholderStyle.fontFamily,"Inter");assert(input.ancestors.rows.some(r=>r.backgroundColor==="rgb(238, 241, 246)" && r.opacity==="0.8"));
  assert.equal(f.calls.length,1);assert.equal(read.roles.find(r=>r.role==="research-count").entries[0].selected,"true");assert.equal(read.roles.find(r=>r.role==="research-count").entries[1].selected,"false");
  assert.equal(read.roles.find(r=>r.role==="notes-label").visible,true);assert.equal(read.roles.find(r=>r.role==="proposal-count").visible,true);assert.equal(read.roles.find(r=>r.role==="status").entries[0].state,"accepted");assert.equal(read.roles.find(r=>r.role==="retry").present,false);
  assert.equal(f.target.outerHTML,before);f.dom.window.close();
 }
});
test("observer preserves absent/disabled/nonempty/unknown-placeholder states without leaking values or enabling Save",()=>{
 const f=textObserverFixture(),input=f.target.querySelector("input");input.value="private-entered-name";input.disabled=true;input.readOnly=true;input.placeholder="private-placeholder";
 const before=f.target.outerHTML,r=f.read();assert.equal(r.namingInput.enabled,false);assert.equal(r.namingInput.readOnly,true);assert.equal(r.namingInput.valueEmpty,false);assert.equal(r.namingInput.placeholder,"other");assert.equal(r.namingInput.placeholderMatchesLocale,false);assert(!JSON.stringify(r).includes("private-"));assert.equal(f.target.outerHTML,before);
 input.remove();const missing=f.read();assert.equal(missing.namingInput.present,false);assert.equal(missing.roles.find(r=>r.role==="research-name").present,false);f.dom.window.close();
});
test("observer bounds repeated roles/ancestors and reports observation failure without a new qualification threshold",()=>{
 const extra=Array.from({length:25},()=>'<article data-testid="thesis-proposal-row"><p>Body</p><p>Based</p></article>').join("");const f=textObserverFixture("en",extra),r=f.read(),body=r.roles.find(x=>x.role==="body");assert.equal(body.entries.length,3);assert.equal(body.omitted,23);assert(body.entries.every(x=>x.ancestors.rows.length<=4));f.dom.window.close();
 const vm=require("node:vm"),unavailable=vm.runInNewContext(`(${lightBodies.observeSmallTextRendering.toString()})(element)`,{element:{querySelectorAll:()=>{throw Error("private-failure");}}});assert.equal(unavailable.status,"unavailable");assert(!JSON.stringify(unavailable).includes("private-failure"));
 const source=lightBodies.observeSmallTextRendering.toString();assert.doesNotMatch(source,/setAttribute|\.click\(|\.focus\(|scrollIntoView|\.style\.[A-Za-z]+\s*=/);
});
