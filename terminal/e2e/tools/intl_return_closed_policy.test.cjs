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
