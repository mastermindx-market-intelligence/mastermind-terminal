/* eslint-disable @typescript-eslint/no-require-imports -- Pure Node/TS source controls, no browser or runtime. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {proxyAllowed,guardProxy}=require('./intl_return_closed_policy.cjs');
const base='http://127.0.0.1:41951',selected='allocation-p12t58',paths=['/allocation.html','/basket/big_pharma.html'];
test('fixed allocation proxy adds only two read documents and leaves default Intl closed to them',()=>{
 for(const p of paths)for(const m of ['GET','HEAD']){assert(proxyAllowed(base+p,m,base,selected));assert(proxyAllowed(base+p+'?_rsc=abc_12',m,base,selected));assert.equal(proxyAllowed(base+p,m,base),false);}
 for(const p of ['/intl.html','/analysis','/stock.html','/basket/other.html','/allocation_china.html','/api/investigations','/_next/image?url=x','/_next/webpack-hmr','/allocation.html?x=1','/allocation.html?_rsc=a&_rsc=b','/allocation.html?_rsc=','/basket/%62ig_pharma.html','/basket/x/../big_pharma.html'])assert.equal(proxyAllowed(base+p,'GET',base,selected),false,p);
 for(const m of ['POST','PUT','DELETE','PATCH','CONNECT','get'])assert.equal(proxyAllowed(base+paths[0],m,base,selected),false);
 assert.throws(()=>proxyAllowed(base+paths[0],'GET',base,'arbitrary'));
 assert.equal(proxyAllowed('https://provider.invalid/allocation.html','GET',base,selected),false);
 assert(proxyAllowed(base+'/_next/static/chunks/app/layout.js','GET',base,selected));assert(proxyAllowed(base+'/api/shared-shell/status','GET',base,selected));
});
test('all direct API entrypoints and headers retain existing refusal before IO for the new case',async()=>{
 const calls=[];let status=200;const request={fetch:async(url,options)=>{calls.push({url,options});return {status:()=>status};}};
 guardProxy(request,base,selected);const headers={cookie:'mm_e2e_rs30=1; mm_e2e_guest=1','next-url':'/allocation.html'};
 await request.fetch(base+paths[0],{headers,maxRedirects:0});assert.equal(calls.length,1);assert.equal(calls[0].options.timeout,30000);
 for(const name of ['get','post','put','patch','delete','head','fetch'])await assert.rejects(request[name]('https://provider.invalid/data',{headers,maxRedirects:0}));
 for(const options of [{headers:{...headers,'next-url':'/intl.html'},maxRedirects:0},{headers:{...headers,authorization:'forged'},maxRedirects:0},{headers,maxRedirects:1},{headers,maxRedirects:0,data:{}},{headers,maxRedirects:0,params:{x:1}}])await assert.rejects(request.fetch(base+paths[0],options));
 assert.equal(calls.length,1);status=302;await assert.rejects(request.fetch(base+paths[0],{headers,maxRedirects:0}),/REDIRECT/);assert.equal(calls.length,2);
});
function compiledTransport(){
 const ts=require('typescript'),file=path.join(__dirname,'../fixtures/real-next-legacy-transport.ts');
 const expect=actual=>({toBe:expected=>assert.equal(actual,expected),toContain:expected=>assert(actual.includes(expected)),not:{toBe:expected=>assert.notEqual(actual,expected)}});
 const mod={exports:{}};const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:name=>name==='@playwright/test'?{expect}:require(name),Buffer,Map,URL,process:{env:{TERMINAL_VISUAL_EVIDENCE_OPERATION:'allocation-return-controlled'}}});return mod.exports;
}
function context(){let route,io=0;const reads=[];
 const value={request:{fetch:async(url,options)=>{reads.push({url,options});return {status:()=>200,headers:()=>({'content-type':'text/x-component; charset=utf-8'})};}},addCookies:async()=>{io++;},routeWebSocket:async()=>{io++;},route:async(_pattern,handler)=>{io++;route=handler;}};
 const dispatch=async(url,method='GET')=>{let result;await route({request:()=>({url:()=>url,method:()=>method,headers:()=>({}),resourceType:()=> 'fetch',isNavigationRequest:()=>false}),fulfill:async payload=>{result={fulfill:payload};},abort:async()=>{result={abort:true};}});return result;};
 return {value,dispatch,reads,io:()=>io,page:{on(){io++;}}};
}
function input(t){return {page:t.page,context:t.value,baseURL:base,documents:new Map(paths.map(p=>[p,Buffer.from(p)])),assets:new Map([['/theme.css',Buffer.from('fixed-css')]])};}
test('actual transport handles exactly the two retained documents plus pinned assets, with no file/current fallback',async()=>{
 const helper=compiledTransport(),t=context(),opts=input(t);guardProxy(t.value.request,base,selected);
 const observations=await helper.installAllocationLegacyTransport(opts);
 opts.documents.get(paths[0]).fill(0);opts.assets.get('/theme.css').fill(0);opts.documents.set('/secret.html',Buffer.from('private'));
 for(const p of paths){const r=await t.dispatch('https://www.mastermind-x.com'+p);assert.equal(r.fulfill.body.toString(),p);}
 assert.equal((await t.dispatch('https://www.mastermind-x.com/theme.css')).fulfill.body.toString(),'fixed-css');
 for(const p of ['/secret.html','/stock.html','/basket/other.html','/missing.js','/api/options'])assert((await t.dispatch('https://www.mastermind-x.com'+p)).abort);
 await t.dispatch('https://beta.mastermind-x.com/allocation.html?_rsc=abc');assert.equal(t.reads.length,1);assert.equal(t.reads[0].url,base+'/allocation.html?_rsc=abc');assert.equal(observations.nextNavigations.length,1);assert.equal(observations.nextNavigations[0].path,'/allocation.html');assert.equal(observations.nextNavigations[0].contentType,'text/x-component');assert.equal(JSON.stringify(observations.nextNavigations).includes('_rsc'),false);
 assert((await t.dispatch('https://provider.invalid/x')).abort);assert((await t.dispatch('https://www.mastermind-x.com/allocation.html','POST')).abort);
});
test('missing/extra documents, wrong case, untracked page or filesystem fallback refuse before transport effects',async()=>{
 const helper=compiledTransport();for(const change of [o=>o.documents.delete(paths[0]),o=>o.documents.set('/secret.html',Buffer.from('x')),o=>o.documents.set(paths[0],Buffer.alloc(0)),o=>{o.assetsDirectory='/foreign';},o=>{o.canonicalChildPath='/intl.html';},o=>{o.html=Buffer.from('x');}]){
  const t=context(),o=input(t);change(o);await assert.rejects(helper.installAllocationLegacyTransport(o));assert.equal(t.io(),0);
 }
 const t=context();await assert.rejects(helper.installRealNextLegacyTransport({...input(t),fixtureCase:'arbitrary'}));assert.equal(t.io(),0);
});
test('the original Intl transport still needs its literal path and cannot serve an allocation document',async()=>{
 const helper=compiledTransport(),t=context();await helper.installRealNextLegacyTransport({page:t.page,context:t.value,baseURL:base,canonicalChildPath:'/intl.html',html:Buffer.from('intl'),assets:new Map([['/theme.css',Buffer.from('css')]])});
 assert.equal((await t.dispatch('https://www.mastermind-x.com/intl.html')).fulfill.body.toString(),'intl');assert((await t.dispatch('https://www.mastermind-x.com/allocation.html')).abort);
});
function runner(){const file=path.join(__dirname,'run_intl_return_controlled.cjs'),code=fs.readFileSync(file,'utf8'),mod={exports:{}};vm.runInNewContext(code,{module:mod,exports:mod.exports,__dirname,process:{argv:['node','runner'],env:{}},require:Object.assign(name=>name.startsWith('./')?{}:require(name),{main:{}})});return mod.exports;}
test('fixed CLI enrollment is one literal case, parsed without launching or configuring resources',()=>{
 const api=runner();assert.equal(api.selectedFixture([]),'intl');assert.equal(api.selectedFixture(['--allocation-p12t58']),selected);
 for(const args of [['--case=anything'],['--allocation-p12t58','extra'],['intl'],['--allocation-p12t58=1']])assert.throws(()=>api.selectedFixture(args),/FIXED_SCOPE/);
});
test('driver preload forwards the same finite case but keeps provider, mutation, listen and other ports denied',()=>{
 const {install}=require('./intl_return_closed_egress.cjs');let calls=0;
 class Socket{connect(){return 'owned';}}class Server{listen(){throw Error('must not listen');}}
 const original=()=>{calls++;return {end(){}};};const modules={net:{Socket,Server},dns:{promises:{}},http:{request:original},https:{request:original,get:original},global:{fetch:async()=>{calls++;}}};
 install(base,'ws://127.0.0.1:41952/owned-path',modules,null,selected);
 modules.http.request(base+paths[0],{method:'GET'});modules.http.request(base+paths[1],{method:'HEAD'});assert.equal(calls,2);
 for(const p of ['/intl.html','/analysis','/api/investigations'])assert.throws(()=>modules.http.request(base+p,{method:'GET'}),/EGRESS_DENIED/);
 assert.throws(()=>modules.http.request(base+paths[0],{method:'POST'}),/EGRESS_DENIED/);assert.throws(()=>modules.https.request('https://provider.invalid'),/EGRESS_DENIED/);assert.throws(()=>new modules.net.Server().listen(),/EGRESS_DENIED/);
 assert.throws(()=>new modules.net.Socket().connect({host:'127.0.0.1',port:41953}),/EGRESS_DENIED/);assert.throws(()=>modules.dns.lookup('provider.invalid',()=>{}),/EGRESS_DENIED/);assert.equal(calls,2);
});
function config(selectedCase){
 const mod={exports:{}},code=fs.readFileSync(path.join(__dirname,'intl_return_controlled.config.cjs'),'utf8');
 const input={baseURL:base,wsEndpoint:'ws://127.0.0.1:41952/owned',playwrightModule:'/fixture-pw',fixtureCase:selectedCase};
 const fakeFs={lstatSync:file=>file==='/owned/op.json'?{isFile:()=>true,uid:1,mode:0o600,size:100}:{isDirectory:()=>true,uid:1,mode:0o700},readFileSync:()=>JSON.stringify(input)};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,__dirname,URL,process:{env:{TERMINAL_INTL_RETURN_OPERATION:'/owned/op.json'},getuid:()=>1},require:name=>name==='node:fs'?fakeFs:name==='/fixture-pw/package.json'?{version:'1.63.0'}:require(name)});return mod.exports;
}
test('private operation selects only the fixed spec while preserving budget and unknown-case refusal',()=>{
 const cfg=config(selected);assert.equal(cfg.testMatch,'allocation-return-controlled.spec.ts');assert.equal(cfg.workers,1);assert.equal(cfg.retries,0);assert.equal(cfg.timeout,120000);assert.equal(cfg.webServer,undefined);assert.equal(cfg.globalSetup,undefined);assert.equal(cfg.use.serviceWorkers,'block');
 assert.equal(config(undefined).testMatch,'intl-return-controlled.spec.ts');assert.throws(()=>config('arbitrary'));
});
test('shared presentation enrollment is fixed, retains dark/default Intl, and supplies no auth/rights grant',()=>{
 const {capturePresentationEnvironment}=require('./thesis_capture_runtime.cjs');assert.deepEqual(capturePresentationEnvironment('shared-shell-allocation-return'),{MMX_SHARED_SHELL:'1'});assert.deepEqual(capturePresentationEnvironment('shared-shell-intl-return'),{MMX_SHARED_SHELL:'1'});assert.deepEqual(capturePresentationEnvironment('dark'),{});assert.throws(()=>capturePresentationEnvironment('arbitrary'));
});

test('actual finite transport aborts only exact telemetry separately and retains all business-write failures',async()=>{
 const helper=compiledTransport(),t=context();const observations=await helper.installAllocationLegacyTransport(input(t));
 assert((await t.dispatch('https://beta.mastermind-x.com/api/collect','POST')).abort);
 assert((await t.dispatch('https://www.mastermind-x.com/api/collect','POST')).abort);
 assert.equal(observations.blockedTelemetryAttempts.length,2);
 assert.equal(JSON.stringify(observations.blockedTelemetryAttempts),JSON.stringify([{origin:'shell',method:'POST',path:'/api/collect',disposition:'blocked-before-transport'},{origin:'legacy',method:'POST',path:'/api/collect',disposition:'blocked-before-transport'}]));
 for(const url of ['https://provider.invalid/api/collect','https://beta.mastermind-x.com/api/collect?x=1','https://beta.mastermind-x.com/api/collect#x','https://a@beta.mastermind-x.com/api/collect','https://beta.mastermind-x.com/api/investigations'])assert((await t.dispatch(url,'POST')).abort);
 assert((await t.dispatch('https://beta.mastermind-x.com/api/collect','PUT')).abort);
 assert.equal(observations.mutations.length,6);assert.equal(observations.blockedTelemetryAttempts.length,2);assert.equal(t.reads.length,0);
});
