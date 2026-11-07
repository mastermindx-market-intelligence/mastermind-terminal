"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process");
const {fixtureApi,decision,publish,guardApiRequest}=require("./thesis_capture_runtime.cjs");
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
 const script=`const n=require('node:net'),d=require('node:dns');let results=0;for(const run of [()=>n.connect({host:'example.invalid',port:443}),()=>n.connect({host:'127.0.0.1',port:54321}),()=>d.lookup('example.invalid')]){try{run();throw Error('unexpected');}catch(e){if(e.message!=='THESIS_CAPTURE_EXTERNAL_EGRESS_DENIED')throw e;results++;}}globalThis.fetch('https://example.invalid').then(()=>process.exit(1),e=>{if(e.message!=='THESIS_CAPTURE_EXTERNAL_EGRESS_DENIED')throw e;console.log(results+1)});`;
 const out=cp.execFileSync(process.execPath,["--require",path.join(__dirname,"thesis_capture_egress.cjs"),"-e",script],{env:{PATH:process.env.PATH,THESIS_CAPTURE_SERVER:"1",TERMINAL_E2E_FIXTURE:"1",TERMINAL_F11_PROVIDER_CLOSED:"1",THESIS_CAPTURE_PORT:"41911"},encoding:"utf8"});
 assert.equal(out.trim(),"4");
});
test("incomplete or unsettled records preserve all old outputs",()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"thesis-capture-check-"));
 try{const stage=path.join(temp,"stage"),target=path.join(temp,"target");fs.mkdirSync(stage);fs.mkdirSync(target);fs.writeFileSync(path.join(target,"one.png"),"old-image");fs.writeFileSync(path.join(target,"EVIDENCE.yml"),"old-lock");
 const ready={counts:{contexts:1,contextsClosed:1,browsersClosed:1,redirectsDenied:0}};
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
