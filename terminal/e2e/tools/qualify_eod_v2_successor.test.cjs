"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { requireClosedProcess, requireNativeReceipt, requireImageDetails, validateContext, inputSets } = require("./qualify_eod_v2_successor.cjs");
const { nativeDefinition } = require("./capture_ci_evidence.cjs");
const closed = () => ({ closed: true, status: 0, signal: null, timedOut: false, error: null,
  serverReportedStopped: true, serverSettled: true, serverRefused: null, serverPid: 1234 });
test("native export rejects failed, timed-out, signalled and unsettled process returns", () => {
  requireClosedProcess(closed());
  for (const patch of [{status: 1}, {timedOut: true}, {closed: false}, {signal: "SIGTERM"}, {error: {code:"EACCES"}}])
    assert.throws(() => requireClosedProcess({...closed(), ...patch}));
});
function receiptFixture() {
  const expected = nativeDefinition("eod").files, context = {checkoutCommit: "a".repeat(40)}, captureId = "pr895-eod-123-1";
  const images = expected.map(file => ({file, sha256:"b".repeat(64)}));
  const manifest = {sha256:"c".repeat(64),head:context.checkoutCommit};
  const receipt = {family:"eod",captureId,capturedAtHead:context.checkoutCommit,manifestSha256:manifest.sha256,files:structuredClone(images)};
  return {receipt,context,captureId,expected,manifest,images,result:closed()};
}
const verify = f => requireNativeReceipt(f.receipt,f.context,f.captureId,f.expected,f.manifest,f.images,f.result);
test("a full actual-M receipt is distinct from branch-head, partial and duplicate proof", () => {
  const f=receiptFixture(); assert.equal(f.expected.length,126); verify(f);
  for (const change of [x=>x.receipt.files.pop(), x=>x.receipt.files[1]=x.receipt.files[0],
    x=>x.receipt.capturedAtHead="d".repeat(40), x=>x.receipt.captureId="other",
    x=>x.manifest.head="d".repeat(40), x=>x.receipt.manifestSha256="d".repeat(64),
    x=>x.images[0].sha256="d".repeat(64), x=>x.result.serverReportedStopped=false,
    x=>x.result.serverSettled=false, x=>x.result.serverRefused="EPERM"]){const bad=receiptFixture();change(bad);assert.throws(()=>verify(bad));}
});
test("the export binds the frozen fixture through all EOD/browser input unions", () => {
  const sets=inputSets();
  for(const kind of ["eod","browser","expiry"])assert.ok(sets[kind].includes("terminal/public/data/darkpool_fixture.json"));
  assert.ok(!sets.gex.includes("terminal/public/data/darkpool_fixture.json"));
});
test("retained image bytes are read independently of the native image-info shape", () => {
  const content=Buffer.from("bounded image fixture"), digest=createHash("sha256").update(content).digest("hex");
  const image={file:"evidence.png",width:390,height:844,sha256:digest};
  const expected={...image,bytes:content.length};
  assert.deepEqual(requireImageDetails(image,expected,content),expected);
  for(const patch of [{bytes:content.length+1},{width:820},{height:900},{sha256:"d".repeat(64)}])
    assert.throws(()=>requireImageDetails(image,{...expected,...patch},content));
  assert.throws(()=>requireImageDetails(image,expected,Buffer.from("changed image fixture")));
});
function identity() {
  const context={checkoutCommit:"a".repeat(40),checkoutTree:"b".repeat(40),branchHead:"c".repeat(40),protectedMaster:"d".repeat(40),
    checkoutParents:["d".repeat(40),"c".repeat(40)],workflowRunId:"123",workflowRunAttempt:"1",deadlineEpochMs:Date.now()+60000};
  const env={GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"pull_request",GITHUB_JOB:"terminal-unit",GITHUB_REF:"refs/pull/895/merge",
    GITHUB_REPOSITORY:"mastermindx-market-intelligence/mastermind-terminal",GITHUB_SHA:context.checkoutCommit,GITHUB_RUN_ID:"123",GITHUB_RUN_ATTEMPT:"1"};
  const checkout={commit:context.checkoutCommit,tree:context.checkoutTree,parents:[...context.checkoutParents]};
  return {context,env,checkout};
}
test("only actual PR895 unit merge checkout and original run identity can export",()=>{
  const good=identity();validateContext(good.context,good.env,good.checkout);
  for(const change of [x=>x.env.GITHUB_JOB="terminal-e2e",x=>x.env.GITHUB_EVENT_NAME="workflow_dispatch",
    x=>x.env.GITHUB_REF="refs/pull/646/merge",x=>x.env.GITHUB_SHA=x.context.branchHead,
    x=>x.env.GITHUB_REPOSITORY="someone/fork",x=>x.checkout.parents.reverse(),x=>x.checkout.tree="f".repeat(40),
    x=>x.context.workflowRunAttempt="2",x=>x.context.deadlineEpochMs=0]){const bad=identity();change(bad);assert.throws(()=>validateContext(bad.context,bad.env,bad.checkout));}
});
