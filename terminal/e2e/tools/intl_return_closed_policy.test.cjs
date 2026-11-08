/* eslint-disable @typescript-eslint/no-require-imports -- Pure Node source controls use incumbent CommonJS tooling. */
"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {LEGACY,VIEWS,ownedBase,proxyAllowed,guardProxy}=require("./intl_return_closed_policy.cjs");
const base="http://127.0.0.1:41951";
const query=new URLSearchParams({view:"investigations",intl_return:LEGACY+"/intl.html?"+VIEWS[0]});
const headers={cookie:"mm_e2e_rs30=1; mm_e2e_guest=1",rsc:"1"};
test("only exact original two Return contexts and bounded RSC/static transport are eligible",()=>{
 assert.equal(ownedBase(base),base);
 for(const value of VIEWS){assert(proxyAllowed(base+"/intl.html?"+value,"GET",base));
  assert(proxyAllowed(base+"/analysis?"+new URLSearchParams({view:"investigations",intl_return:LEGACY+"/intl.html?"+value}),"GET",base));}
 for(const url of [base+"/analysis?"+query+"&_rsc=abc_123",base+"/_next/static/chunks/app/layout.js?v=123",base+"/_next/static/css/app/layout.css",base+"/api/shared-shell/status"])
  assert(proxyAllowed(url,"GET",base),url);
 for(const raw of ["http://localhost:41951","http://2130706433:41951","http://0x7f000001:41951","http://127.0.0.1:3100","https://127.0.0.1:41951","http://a@127.0.0.1:41951",base+"/path"])
  assert.throws(()=>ownedBase(raw));
 for(const path of ["/analysis","/analysis?"+query+"&view=investigations","/analysis?"+query+"&x=1","/analysis?"+query+"&_rsc=abc&_rsc=def",
  "/intl.html?"+VIEWS[0].replace("GB,EZ","EZ,GB"),"/intl.html?"+VIEWS[0]+"&unexpected=1","/api/shared-shell/status?x=1",
  "/api/investigations","/api/investigations/baseline","/_next/image?url=https://provider.invalid","/_next/webpack-hmr","/_next/static/../secret.js","/_next/static/%2e/x.js","/_next/static/chunks/app/layout.js?v=1&v=2","/_next/static/chunks/app/layout.js?url=x"])
  assert.equal(proxyAllowed(base+path,"GET",base),false,path);
 for(const raw of ["https://provider.invalid/analysis?"+query,"http://evil@127.0.0.1:41951/analysis?"+query,base+"/analysis?"+query+"#fragment"])
  assert.equal(proxyAllowed(raw,"GET",base),false);
 for(const method of ["POST","PUT","PATCH","DELETE","CONNECT","get"])
  assert.equal(proxyAllowed(base+"/analysis?"+query,method,base),false);
});
test("all seven direct API entrypoints refuse before transport; actual local proxy has fixed headers and no redirects",async()=>{
 let calls=0,code=200;const request={fetch:async(raw,options)=>{calls++;assert.equal(options.maxRedirects,0);return {status:()=>code};}};
 guardProxy(request,base);
 for(const method of ["get","post","put","patch","delete","head","fetch"]){
  await assert.rejects(request[method]("https://provider.invalid/x",{headers,maxRedirects:0}));
  await assert.rejects(request[method](new URL(base+"/api/shared-shell/status"),{headers,maxRedirects:0}));
 }
 assert.equal(calls,0);
 await request.fetch(base+"/analysis?"+query,{method:"GET",headers,maxRedirects:0});assert.equal(calls,1);
 for(const options of [{headers,maxRedirects:1},{headers:{...headers,authorization:"forged"},maxRedirects:0},{headers:{},maxRedirects:0},{headers,maxRedirects:0,params:{extra:"1"}}])
  await assert.rejects(request.fetch(base+"/analysis?"+query,options));
 assert.equal(calls,1);code=302;
 await assert.rejects(request.fetch(base+"/api/shared-shell/status",{headers,maxRedirects:0}),/REDIRECT/);
 assert.equal(calls,2);
});

// Use the installed Next producer rather than inventing a destination/header map.
// The source pathname is metadata; the outgoing transport URL remains the exact
// selected Intl tuple admitted independently above.
const {extractPathFromFlightRouterState}=require('next/dist/client/components/router-reducer/compute-changed-path');
const sourceTree=['',{children:['(shell)',{children:['analysis',{children:['__PAGE__?{"view":"investigations"}',{}]}]}]}];
const nextUrl=extractPathFromFlightRouterState(sourceTree);
test('installed Next pathname metadata reaches only the exact RSC Intl Return transport',async()=>{
 assert.equal(nextUrl,'/analysis');
 let calls=0;const request={fetch:async(raw,options)=>{calls++;assert.equal(options.headers['next-url'],nextUrl);assert.equal(raw,base+'/intl.html?'+VIEWS[calls-1]);return {status:()=>200};}};
 guardProxy(request,base);
 const metadata={...headers,'next-router-state-tree':JSON.stringify(sourceTree),'next-url':nextUrl};
 for(const view of VIEWS)await request.fetch(base+'/intl.html?'+view,{method:'GET',headers:metadata,maxRedirects:0});
 assert.equal(calls,2);
});
test('pathname metadata does not grant a route, context, origin, header or write',async()=>{
 let calls=0;const request={fetch:async()=>{calls++;return {status:()=>200};}};guardProxy(request,base);
 const metadata={...headers,'next-router-state-tree':JSON.stringify(sourceTree),'next-url':nextUrl};
 const fetch=(raw,hs=metadata,method='GET')=>request.fetch(raw,{method,headers:hs,maxRedirects:0});
 for(const value of ['/intl.html','/analysis/','//analysis','https://beta.mastermind-x.com/analysis','https://provider.invalid/analysis','/analysis#x','/analysis?unknown=1','/analysis%3F','/analysis\\evil',' /analysis','/analysis\r\nforged'])
  await assert.rejects(fetch(base+'/intl.html?'+VIEWS[0],{...metadata,'next-url':value}),/HEADERS/);
 for(const hs of [{...metadata,rsc:undefined},{...metadata,rsc:'0'},{...metadata,'next-router-state-tree':''},{...metadata,'next-router-state-tree':undefined},{...metadata,'next-router-state-tree':'\r\n'},{...metadata,authorization:'forged'}])
  await assert.rejects(fetch(base+'/intl.html?'+VIEWS[0],hs),/HEADERS/);
 for(const raw of [base+'/intl.html',base+'/intl.html?'+VIEWS[0]+'&extra=1',base+'/api/shared-shell/status',base+'/_next/static/chunks/app/layout.js',base+'/analysis?'+query,'https://provider.invalid/intl.html?'+VIEWS[0]])
  await assert.rejects(fetch(raw));
 for(const method of ['POST','PUT','PATCH','DELETE'])await assert.rejects(fetch(base+'/intl.html?'+VIEWS[0],metadata,method));
 assert.equal(calls,0);
 // The pre-existing exact full-context metadata contract remains eligible.
 await fetch(base+'/intl.html?'+VIEWS[0],{...metadata,'next-url':'/analysis?'+query});assert.equal(calls,1);
});

// Exercise the actual route callback; neither first-party telemetry destination
// is allowed to transmit, and request bodies/headers are never inspected.
test('actual retained producer telemetry origins are tagged and aborted while near matches remain business-write failures',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
 const file=path.join(__dirname,'../fixtures/real-next-legacy-transport.ts'),mod={exports:{}};
 const expect=actual=>({toBe:v=>assert.equal(actual,v),toContain:v=>assert(actual.includes(v)),not:{toBe:v=>assert.notEqual(actual,v)}});
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{module:mod,exports:mod.exports,require:n=>n==='@playwright/test'?{expect}:require(n),URL,Buffer,process:{env:{TERMINAL_VISUAL_EVIDENCE_OPERATION:'intl-return-controlled'}}});
 let handler,reads=0,fulfilled=0,aborted=0;
 const context={addCookies:async()=>{},routeWebSocket:async()=>{},route:async(_,cb)=>{handler=cb;},request:{fetch:async()=>{reads++;throw Error('must never transport');}}};
 const observations=await mod.exports.installRealNextLegacyTransport({page:{on(){}},context,baseURL:base,canonicalChildPath:'/intl.html',html:Buffer.from('source'),assets:new Map()});
 async function dispatch(raw,method='POST') {await handler({request:()=>({url:()=>raw,method:()=>method,headers:()=>{throw Error('must not inspect headers');},postData:()=>{throw Error('must not inspect body');}}),abort:async()=>{aborted++;},fulfill:async()=>{fulfilled++;}});}
 await dispatch('https://beta.mastermind-x.com/api/collect');await dispatch('https://www.mastermind-x.com/api/collect');
 assert.equal(JSON.stringify(observations.blockedTelemetryAttempts),JSON.stringify([{origin:'shell',method:'POST',path:'/api/collect',disposition:'blocked-before-transport'},{origin:'legacy',method:'POST',path:'/api/collect',disposition:'blocked-before-transport'}]));
 const negatives=['https://provider.invalid/api/collect','http://www.mastermind-x.com/api/collect','https://www.mastermind-x.com:444/api/collect','https://www.mastermind-x.com.evil.invalid/api/collect','https://www.mastermind-x.com/api/collect?x=1','https://www.mastermind-x.com/api/collect?','https://www.mastermind-x.com/api/collect#x','https://www.mastermind-x.com/api/collect#','https://a@www.mastermind-x.com/api/collect','https://www.mastermind-x.com/api/investigations'];
 for(const raw of negatives)await dispatch(raw);
 for(const method of ['PUT','PATCH','DELETE'])await dispatch('https://www.mastermind-x.com/api/collect',method);
 await dispatch('https://beta.mastermind-x.com/api/investigations/baseline','GET');
 assert.equal(observations.blockedTelemetryAttempts.length,2);assert.equal(observations.mutations.length,negatives.length+3);assert.equal(observations.baselines.length,1);assert.equal(reads,0);assert.equal(fulfilled,0);assert.equal(aborted,negatives.length+6);
});
