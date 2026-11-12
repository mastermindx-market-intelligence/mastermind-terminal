"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {execFileSync}=require("node:child_process");
const ROOT=fs.realpathSync("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-estate-security-toolchain-20261112-c3");
const J="/private/tmp/terminal-pr1481-current-evidence-20261112-c3";
const U=path.join(J,"unit/mastermind-terminal/mastermind-terminal");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const read=p=>fs.readFileSync(p),json=p=>JSON.parse(read(p));
const git=args=>execFileSync("git",args,{cwd:ROOT,maxBuffer:16*1024*1024}).toString("utf8").trim();
const CHECKOUT="35d6b1f9305b445949f1c49512bfe3bce0ac3460",HEAD="ea3eda41176e8bfb0f5421f2ab9efabb31031459";
assert.equal(git(["rev-parse","HEAD"]),HEAD);
const froot=path.join(U,"terminal/docs/pr-crops/b-f11-10-analysis-theses-entry"),fbytes=read(path.join(froot,"FIXTURE.json")),f=JSON.parse(fbytes);
assert.equal(sha(fbytes),"e3f23963c22812a52a05120b084959dc3e109bb6a31de21ad7163e502b2bbc20");
assert.equal(f.schema,"terminal.f11-source-component-fixture.v1");assert.equal(f.capturedAtHead,CHECKOUT);
const files=["desktop-en.png","desktop-zh.png","tablet-en.png","tablet-zh.png","mobile-en.png","mobile-zh.png"];
require(path.join(ROOT,"terminal/e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs")).assertAllSixObserved(files,f.entryObservations);
assert.equal(Object.keys(f.fixtureSources).length,15);
for(const [file,expected] of Object.entries(f.fixtureSources)){
 assert.equal(sha(read(path.join(ROOT,file))),expected,"current:"+file);
 assert.equal(sha(execFileSync("git",["show",CHECKOUT+":"+file],{cwd:ROOT,maxBuffer:2*1024*1024})),expected,"captured:"+file);
}
assert.equal(f.captureProfile.node,"v20.20.2");assert.equal(f.captureProfile.next,"16.4.6");assert.equal(f.captureProfile.playwright,"1.61.1");
assert.equal(f.captureProfile.browser.version,"149.0.7827.55");assert.equal(f.captureProfile.browser.revision,"1228");
assert.equal(f.captureProfile.server.providerClosedChild,true);assert.equal(f.captureProfile.server.freshServerPerImage,true);
assert.equal(f.captureProfile.browser.freshContextPerImage,true);assert.equal(f.captureProfile.browser.freshBrowserPerImage,true);
assert.equal(f.serverSettlement.allClosed,true);assert.equal(f.serverSettlement.allGroupsAbsent,true);assert.equal(f.generatedTypes.allRestored,true);
assert.deepEqual(f.caseLifecycle.map(x=>x.file),files);
const V=require(path.join(ROOT,"terminal/e2e/tools/visualEvidence.cjs"));
for(const [i,o] of f.entryObservations.entries()){
 const image=read(path.join(froot,o.file)),info=V.imageInfo(image);
 assert.equal(image.length,o.image.bytes);assert.equal(info.sha256,o.image.sha256);
 assert.equal(info.width,o.viewport.width);assert.equal(info.height,o.viewport.height);
 assert.deepEqual(o.pageErrorNames,[]);assert.equal(o.href,"/analysis?view=theses&symbol=NVDA");
 assert.equal(o.requestBoundary.callbackFailureCount,0);assert.deepEqual(o.requestBoundary.callbackFailures,[]);
 assert.deepEqual(o.requestBoundary.failedAllowedResponses,[]);assert.equal(o.requestBoundary.redirectOrBadStatus,0);
 assert(o.requestBoundary.businessUnavailable>0);assert(o.requestBoundary.componentFundUnavailable>0);
 assert.equal(o.requestBoundary.publicScripts.length,10);assert.equal(o.requestBoundary.scriptDelivery.length,10);
 for(const script of o.requestBoundary.publicScripts){assert(/^[a-f0-9]{64}$/.test(script.sha256));assert(script.bytes>0);assert.equal(script.mime,"application/javascript");assert(o.requestBoundary.scriptDelivery.some(x=>x.requestId===script.requestId&&x.pathname===script.pathname&&x.event==="finished"));}
 const l=f.caseLifecycle[i];assert.equal(l.serverSettlement.closeObserved,true);assert.equal(l.serverSettlement.processGroupAbsent,true);
 assert.equal(l.serverSettlement.exitSuccess,"NOT_ASSERTED");assert.equal(l.generatedTypes.defaultCompilerNamespaceSelected,false);
 assert.equal(l.generatedTypes.nextEnvRestored,true);assert.equal(l.generatedTypes.trackedTsconfigsUnchanged,true);
 if(i>=4){assert.equal(o.entryPresentation,"compact-research-actions");assert.equal(o.captureDisclosure,"closed");assert(o.disclosureBounds.width>=44&&o.disclosureBounds.height>=44);}
 else assert.equal(o.entryPresentation,"inline");
}
const relative="terminal/docs/pr-crops/b-pl-6-batch-1/ci-43160725037-1-current.composition.json";
const cb=read(path.join(U,relative)),c=JSON.parse(cb);
assert.equal(sha(cb),"52923524039451052b4bd0b617e189f8faff0a36f2b76618e91b1063b7752356");
assert.equal(c.schema,"terminal.visual-composition.v2");assert.equal(c.mode,"records");assert.equal(c.id,"ci-43160725037-1-current");assert.deepEqual(c.profile,V.profile({}));
const diagnostic=json(path.join(J,"unit/_temp/terminal-ci-evidence/ci-43160725037-1.json"));
assert.equal(diagnostic.state,"SELECTED");assert.deepEqual(diagnostic.actualCheckout,{commit:CHECKOUT,tree:"c081f4aceea804c8ef66b09935a8d365d9587779"});
const budget={remaining:256*1024*1024-cb.length};
const operations=c.operations.map(ref=>V.readOperation(U,ref,budget));
const sources=V.sourceSnapshot(ROOT),sourceKeys=Object.keys(sources);
const changed=git(["diff","--name-only","HEAD"]).split("\n").filter(Boolean);
const mergeChanged=git(["diff","--name-only",HEAD,CHECKOUT]).split("\n").filter(Boolean);
const tracked=new Set(execFileSync("git",["ls-files","-z"],{cwd:ROOT,maxBuffer:16*1024*1024}).toString("utf8").split("\0"));
assert(sourceKeys.every(k=>tracked.has(k)));assert(!changed.some(k=>sourceKeys.includes(k)));assert(!mergeChanged.some(k=>sourceKeys.includes(k)));
const cases=V.composeCases({operations,selections:c.selections,requiredCases:[...V.requirements("pl6"),...V.requirements("vi")],currentSources:sources,profile:c.profile});
assert.equal(cases.length,50);assert.equal(operations.reduce((n,x)=>n+x.cases.length,0),54);
const members=new Set([relative]);
for(const ref of c.operations){const dir=path.posix.dirname(ref.path),op=operations.find(x=>ref.path.endsWith(x.id+"--operation.json"));assert(op);
 for(const name of fs.readdirSync(path.join(U,dir))){if(name.startsWith(op.id+"--"))members.add(dir+"/"+name);}
}
const inventory=[...members].sort().map(file=>({path:file,bytes:read(path.join(U,file)).length,sha256:sha(read(path.join(U,file)))}));
const result={schema:"terminal.current-hosted-evidence-qualification.v1",qualifiedAt:new Date().toISOString(),run:43160725037,attempt:1,head:HEAD,actualCheckout:diagnostic.actualCheckout,
 unitArtifact:{id:13919181267,sha256:"84d54fc54801bb8998d4c67b85b5c005827398a5e28569b0812529402a063407",bytes:42855075},
 f11:{fixtureSha256:sha(fbytes),capturedAtHead:f.capturedAtHead,sources:f.fixtureSources,captureProfile:f.captureProfile,serverSettlement:f.serverSettlement,generatedTypes:f.generatedTypes,
 images:f.entryObservations.map(o=>({file:o.file,viewport:o.viewport,lang:o.lang,href:o.href,entryPresentation:o.entryPresentation,captureDisclosure:o.captureDisclosure,image:o.image})),
 sourceCount:15,orderedCases:6,allCurrentSourceAndCapturedGitBindings:true,
 visualReview:{reviewer:"assigned-root",files,result:"All six original EN/ZH PNGs inspected: legible research context and explicit unavailable fundamentals; desktop/tablet theses controls are inline, mobile preserves its closed 44px compact disclosure. The receipt separately records observed theses-entry targets. No live data, account, authenticated or installed acceptance."},
 scope:f.scope,committedLegacyPacketDisposition:"Preserved. Existing reader's three layout/lexicon pins are unchanged; current-package FIXTURE and six PNGs are retained as original CI evidence."},
 composition:{id:c.id,sha256:sha(cb),profile:c.profile,operations:c.operations,operationCases:operations.map(o=>({id:o.id,packet:o.packet,cases:o.cases.length})),selectedCases:50,sourceFiles:sourceKeys.length,
 sourceSnapshotSha256:sha(Buffer.from(V.canonical(sources))),sourceBindings:"Unmodified sourceSnapshot and composeCases agree with original operations. All mapped paths are tracked; no working diff or captured merge delta overlaps the map.",
 evidenceBytesRead:256*1024*1024-budget.remaining,budgetBytes:256*1024*1024,artifactMembers:inventory,visualAcceptance:false,
 readers:["readOperation","sourceSnapshot","composeCases","requirements","imageInfo"],readerSha256:sha(read(path.join(ROOT,"terminal/e2e/tools/visualEvidence.cjs"))),captureOrCompositionWrites:false},
 productionAcceptance:false};
const out=path.join(J,"current-unit-qualification.json");assert(!fs.existsSync(out));fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({result:"PASS",file:out,sha256:sha(read(out)),f11:{sources:15,cases:6,groupsClosed:true,generatedTypesRestored:true},composition:{operations:operations.length,executed:54,selected:50,sources:sourceKeys.length,bytesRead:result.composition.evidenceBytesRead,retainedMembers:inventory.length}},null,2));
