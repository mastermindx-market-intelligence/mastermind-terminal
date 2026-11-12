"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const ROOT=fs.realpathSync("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-estate-security-toolchain-20261112-c3");
const JOURNAL="/private/tmp/terminal-pr1481-current-evidence-20261112-c3";
const RAW=path.join(JOURNAL,"serial/ticker-news-current");
const P=require(path.join(ROOT,"terminal/e2e/tools/ticker_news_capture_receipt.cjs"));
const read=p=>fs.readFileSync(p);
const json=p=>JSON.parse(read(p));
const sha=b=>P.sha256(b);
const git=args=>execFileSync("git",args,{cwd:ROOT,maxBuffer:8*1024*1024});
const text=args=>git(args).toString("utf8").trim();
const inventory=dir=>{
  const rows={};
  const visit=base=>{for(const e of fs.readdirSync(base,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    assert(!e.isSymbolicLink());const p=path.join(base,e.name);
    if(e.isDirectory())visit(p);else{assert(e.isFile());rows[path.relative(dir,p)]=sha(read(p));}
  }};visit(dir);return rows;
};
const prepared=json(path.join(RAW,"prepared.json")),capture=json(path.join(RAW,"capture.json")),cleared=json(path.join(RAW,"images-cleared.json"));
const checkoutApi=json(path.join(JOURNAL,"actual-checkout-github.json"));
assert.equal(text(["rev-parse","HEAD"]),"ea3eda41176e8bfb0f5421f2ab9efabb31031459");
assert.equal(text(["status","--porcelain=v1"]),"");
assert.equal(prepared.schema,"ticker-news.hosted-capture.v1");
assert.equal(prepared.qualified,false);assert.equal(capture.qualified,true);
for(const [k,v] of Object.entries(prepared))if(k!=="qualified")assert.deepEqual(capture[k],v,k);
assert.deepEqual(cleared.absent,P.SHOTS.map(x=>x.file));
assert.equal(cleared.startedAt,prepared.startedAt);assert.equal(cleared.manifest,prepared.prior["EVIDENCE.yml"]);
assert.equal(capture.checkout.commit,"35d6b1f9305b445949f1c49512bfe3bce0ac3460");
assert.equal(capture.checkout.tree,"c081f4aceea804c8ef66b09935a8d365d9587779");
assert.equal(checkoutApi.sha,capture.checkout.commit);assert.equal(checkoutApi.tree.sha,capture.checkout.tree);
const resolvedParents=text(["show","-s","--format=%P",capture.checkout.commit]).split(" ").filter(Boolean);
assert.deepEqual(resolvedParents,checkoutApi.parents.map(x=>x.sha));
assert.deepEqual(resolvedParents,["e2a76ec4fa684f0289dd3afc3a9abbe8c01d8661","ea3eda41176e8bfb0f5421f2ab9efabb31031459"]);
assert.equal(text(["rev-parse",capture.checkout.commit+"^{tree}"]),capture.checkout.tree);
assert.deepEqual(capture.checkout.parents,[]); // Preserve the original shallow-checkout observation.
assert.deepEqual(capture.workflow,{repository:"mastermindx-market-intelligence/mastermind-terminal",run:"43160725037",attempt:"1",job:"terminal-e2e",event:"pull_request",head:"ea3eda41176e8bfb0f5421f2ab9efabb31031459",base:"e2a76ec4fa684f0289dd3afc3a9abbe8c01d8661"});
assert.equal(P.SOURCES.length,18);assert.deepEqual(Object.keys(capture.sources).sort(),[...P.SOURCES].sort());
for(const file of P.SOURCES){
 const expected=capture.sources[file];assert.equal(sha(git(["show",capture.checkout.commit+":"+file])),expected,"capture:"+file);
 assert.equal(sha(git(["show",capture.workflow.head+":"+file])),expected,"head:"+file);
 assert.equal(sha(read(path.join(ROOT,file))),expected,"working:"+file);
}
const reportBytes=read(path.join(RAW,"report.json"));assert.equal(sha(reportBytes),capture.reportSha256);
const cases=P.validateReport(JSON.parse(reportBytes),prepared.startedAt);assert.deepEqual(cases,capture.cases);
const images=P.validateImages(file=>read(path.join(RAW,"crops",file)),fs.readdirSync(path.join(RAW,"crops")));
assert.deepEqual(images,capture.images);
assert.deepEqual(inventory(path.join(RAW,"prior")),prepared.prior);
assert.deepEqual(Object.keys(prepared.prior).sort(),["EVIDENCE.yml",...P.SHOTS.map(x=>x.file)].sort());
assert.deepEqual(inventory(path.join(ROOT,"terminal/docs/pr-crops/ticker-news")),prepared.prior);
const siblings=Object.fromEntries(fs.readdirSync(path.join(ROOT,"terminal/docs/pr-crops")).filter(x=>x.startsWith("ticker-news-")).sort().map(x=>[x,inventory(path.join(ROOT,"terminal/docs/pr-crops",x))]));
assert.deepEqual(siblings,prepared.otherPackets);
assert.equal(capture.lifecycle.playwrightReturned,true);assert.equal(capture.lifecycle.portIsClosed,true);
assert.equal(capture.preflight.portIsClosed,true);
for(const k of ["producerActivation","productionAcceptance","visualAcceptance"])assert.equal(capture[k],false);
assert(Date.parse(capture.completedAt)>Date.parse(capture.startedAt));
const lock=json(path.join(ROOT,"terminal/package-lock.json"));
assert.equal(capture.runtime.node,"v20.20.2");
assert.equal(capture.runtime.next,lock.packages["node_modules/next"].version);
assert.equal(capture.runtime.playwright,lock.packages["node_modules/@playwright/test"].version);
assert.deepEqual(capture.runtime.configuredChromium,json(path.join(ROOT,"terminal/node_modules/playwright-core/browsers.json")).browsers.filter(x=>["chromium","chromium-headless-shell"].includes(x.name)));
const jobs=json(path.join(JOURNAL,"original-evidence-jobs-github.json"));
const serial=jobs.find(x=>x.id===130991417439);assert.equal(serial.conclusion,"success");
assert.equal(serial.runner_group_name,"GitHub Actions");
const observation={
 schema:"terminal.ticker-original-artifact-qualification.v1",qualifiedAt:new Date().toISOString(),
 pr:1481,head:capture.workflow.head,run:43160725037,attempt:1,job:serial,
 captureCheckout:capture.checkout,resolvedGitObject:{commit:checkoutApi.sha,tree:checkoutApi.tree.sha,orderedParents:resolvedParents},
 checkoutParentInterpretation:"Original capture records [] from its shallow checkout. The separately resolved Git object retains both actual parents; neither record was restamped.",
 artifact:{id:13918917251,bytes:13455632,sha256:"b5049be9f4a9c22428bee6ab33c86acad205f584394f0cee6f4c3a9f2b6b033d"},
 raw:inventory(RAW),sources:capture.sources,runtime:capture.runtime,
 runtimeInterpretation:"Node/Next/Playwright are original runtime observations. configuredChromium is installed browser-manifest metadata, not an independent browser.version() observation.",
 cases,images,lifecycle:capture.lifecycle,originalCaptureSha256:sha(read(path.join(RAW,"capture.json"))),
 sourceBinding:{count:18,actualCaptureGit:true,publishedHeadGit:true,workingTree:true},priorPacketFiles:11,
 siblingsPreserved:Object.keys(siblings),
 visualReview:{reviewer:"assigned-root",reviewedAt:new Date().toISOString(),files:images.map(x=>x.file),
   result:"All ten original PNGs inspected. EN and native ZH controls are legible; live-feed cards, curated-source/review controls, and unavailable messages with Retry remain visible without clipped controls at the declared desktop/tablet/mobile viewport sizes. Five ZH images contain distinct readable glyphs. English source headlines remain original in ZH UI.",
   scope:"Original ticker-news dark fixture packet only. No sibling CN/HK/light packet, provider completeness, installed, authenticated, or production acceptance."},
 producerActivation:false,productionAcceptance:false,
 validators:{source:"terminal/e2e/tools/ticker_news_capture_receipt.cjs",sha256:capture.sources["terminal/e2e/tools/ticker_news_capture_receipt.cjs"],functions:["validateReport","validateImages"],recapture:false},
 freshness:"Original prepared/images-cleared/report/capture receipts prove original producer freshness. Extraction filesystem mtimes are not used.",
};
const out=path.join(JOURNAL,"ticker-qualification.json");assert(!fs.existsSync(out));fs.writeFileSync(out,JSON.stringify(observation,null,2)+"\n");
console.log(JSON.stringify({result:"PASS",file:out,sha256:sha(read(out)),sources:18,cases:cases.length,passed:cases.filter(x=>x.status==="passed").length,authoredSkips:cases.filter(x=>x.status==="skipped").length,images:images.length,priorFiles:11,siblingPackets:Object.keys(siblings),captureCheckout:capture.checkout,resolvedParents,runner:serial.runner_name,lifecycle:capture.lifecycle},null,2));
