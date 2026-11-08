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

// Finite original S28 joined-path source selections.
{
const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('./intl_return_closed_policy.cjs');
const base='http://127.0.0.1:42051';
const paths=[
  "/analysis?view=investigations&intl_context=intl-workspace-context%3Asha256%3A1807a6a6b9c3428f0a152b1f8bfa570b8f8647ca94dd998bb908886c885b3185&intl_generation=im-workspace-generation%3Af180e9f4-eeee-488d-b312-5a68d09ccf5c&intl_fingerprint=0dc2265e5985adaff29f0c2efbf7191be9f80472a6c0f73646a4ac1b5776f8b8&intl_field=GB.policy_rate&intl_return=https%3A%2F%2Fwww.mastermind-x.com%2Fintl.html%3Fview%3Dmacro%26market%3DGB%26pins%3DGB%2CEZ%26horizon%3D3m%26basis%3Dlocal%26return_basis%3Dprice%26group%3D",
  "/analysis?view=investigations&intl_context=intl-workspace-context%3Asha256%3A7ec67830beee8562216756553bb3e861d3377ab284dbd29f4ce44261b0eaec88&intl_generation=im-workspace-generation%3Af180e9f4-eeee-488d-b312-5a68d09ccf5c&intl_fingerprint=0dc2265e5985adaff29f0c2efbf7191be9f80472a6c0f73646a4ac1b5776f8b8&intl_field=EZ.annual_current_account&intl_return=https%3A%2F%2Fwww.mastermind-x.com%2Fintl.html%3Fview%3Drisk%26market%3DEZ%26pins%3DGB%2CEZ%26horizon%3D1m%26basis%3Dusd_unhedged%26return_basis%3Dprice%26group%3D"
];
test('two actual emitted source-link tuples enter only the owned GET/HEAD route, with bounded RSC',()=>{
 for(const p of paths)for(const method of ['GET','HEAD'])for(const suffix of ['', '&_rsc=bounded-123'])assert.equal(policy.proxyAllowed(base+p+suffix,method,base),true,p);
});
test('source identity, Return tuple, origin, method and near-path mutations remain denied',()=>{
 for(const p of paths){
  const bad=[];for(const key of ['intl_context','intl_generation','intl_fingerprint','intl_field','intl_return']){const u=new URL(base+p);u.searchParams.set(key,u.searchParams.get(key)+'x');bad.push(u.href);const d=new URL(base+p);d.searchParams.append(key,d.searchParams.get(key));bad.push(d.href);}
  for(const extra of ['auth=x','principal=x','scope=company_context','intl_other=x','_rsc=','_rsc='+('x'.repeat(129)),'_rsc=ok&_rsc=other'])bad.push(base+p+'&'+extra);
  const swapped=new URL(base+p);swapped.searchParams.set('intl_return',new URL(base+paths.find(x=>x!==p)).searchParams.get('intl_return'));bad.push(swapped.href);
  for(const raw of [...bad,'https://provider.invalid'+p,base+p+'#x',base+'/api/investigations/baseline?'+p.split('?')[1],base+'/%61nalysis?'+p.split('?')[1]])assert.equal(policy.proxyAllowed(raw,'GET',base),false,raw);
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])assert.equal(policy.proxyAllowed(base+p,method,base),false);
 }
 assert.equal(policy.proxyAllowed(base+'/api/investigations/baseline?kind=international','GET',base),false);
});
test('ordinary source-route metadata requires exact outbound destination and real RSC shape; denied requests never transport',async()=>{
 let calls=0;const request={fetch:async()=>{calls++;return{status:()=>200};}};policy.guardProxy(request,base);
 const good={cookie:'mm_e2e_rs30=1; mm_e2e_guest=1',rsc:'1','next-router-state-tree':'["",{}]','next-url':'/intl.html'};
 for(const p of paths){await request.fetch(base+p,{method:'GET',headers:good,maxRedirects:0});await request.fetch(base+p+'&_rsc=bounded',{method:'GET',headers:good,maxRedirects:0});}
 assert.equal(calls,4);
 for(const headers of [{...good,rsc:undefined},{...good,rsc:'0'},{...good,'next-router-state-tree':''},{...good,'next-router-state-tree':undefined},{...good,'next-url':'/other'},{...good,'next-url':'https://www.mastermind-x.com/intl.html'},{...good,authorization:'forged'}])await assert.rejects(request.fetch(base+paths[0],{headers,maxRedirects:0}));
 for(const raw of [base+'/api/shared-shell/status',base+'/_next/static/chunks/app/layout.js',base+'/api/investigations/baseline?kind=international',base+paths[0]+'&auth=x'])await assert.rejects(request.fetch(raw,{headers:good,maxRedirects:0}));
 for(const method of ['POST','PUT','PATCH','DELETE'])await assert.rejects(request.fetch(base+paths[0],{method,headers:good,maxRedirects:0}));
 assert.equal(calls,4);
});

}

test('joined case enrolls only its fixed CLI and private config boolean without resource launch',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const directory=__dirname;const runnerFile=path.join(directory,'run_intl_return_controlled.cjs');const runner={exports:{}};
 const stubRequire=Object.assign(n=>n==='./thesis_capture_runtime.cjs'?{}:require(n),{main:{}});
 vm.runInNewContext(fs.readFileSync(runnerFile,'utf8'),{module:runner,exports:runner.exports,require:stubRequire,__dirname:directory,process:{argv:['node','runner'],env:{}}});
 assert.equal(runner.exports.joinedSourceCase([]),false);assert.equal(runner.exports.joinedSourceCase(['--joined-source']),true);
 for(const args of [['--joined-source','extra'],['--joined-source=1'],['--arbitrary']])assert.throws(()=>runner.exports.joinedSourceCase(args),/FIXED_SCOPE/);
 function config(joinedSource,fixtureCase){
  const input={baseURL:base,wsEndpoint:'ws://127.0.0.1:41952/owned',playwrightModule:'/fixture-pw',joinedSource,fixtureCase};const mod={exports:{}};
  const fakeFs={lstatSync:p=>p==='/owned/op.json'?{isFile:()=>true,uid:1,mode:0o600,size:100}:{isDirectory:()=>true,uid:1,mode:0o700},readFileSync:()=>JSON.stringify(input)};
  vm.runInNewContext(fs.readFileSync(path.join(directory,'intl_return_controlled.config.cjs'),'utf8'),{module:mod,exports:mod.exports,__dirname:directory,URL,process:{env:{TERMINAL_INTL_RETURN_OPERATION:'/owned/op.json'},getuid:()=>1},require:n=>n==='node:fs'?fakeFs:n==='/fixture-pw/package.json'?{version:'1.63.0'}:require(n)});return mod.exports;
 }
 assert.equal(config(true).testMatch,'intl-investigate-controlled.spec.ts');assert.equal(config(false).testMatch,'intl-return-controlled.spec.ts');assert.equal(config(undefined).testMatch,'intl-return-controlled.spec.ts');
 assert.equal(config(false,'allocation-p12t58').testMatch,'allocation-return-controlled.spec.ts');
 assert.throws(()=>config(true,'allocation-p12t58'),/FIXED_SCOPE/);
 for(const [args,want]of [[[],{selected:'intl',allocation:false,joinedSource:false}],[['--joined-source'],{selected:'intl',allocation:false,joinedSource:true}],[['--allocation-p12t58'],{selected:'allocation-p12t58',allocation:true,joinedSource:false}]])assert.equal(JSON.stringify(runner.exports.selectOperation(args)),JSON.stringify(want));
 for(const args of [['--joined-source','--allocation-p12t58'],['--allocation-p12t58','--joined-source'],['--joined-source=1'],['--unknown']])assert.throws(()=>runner.exports.selectOperation(args),/FIXED_SCOPE/);
 for(const invalid of ['true',1,null])assert.throws(()=>config(invalid),/FIXED_SCOPE/);
 const selected=config(true);assert.equal(selected.workers,1);assert.equal(selected.retries,0);assert.equal(selected.timeout,120000);assert.equal(selected.webServer,undefined);assert.equal(selected.globalSetup,undefined);assert.equal(selected.use.serviceWorkers,'block');
});
