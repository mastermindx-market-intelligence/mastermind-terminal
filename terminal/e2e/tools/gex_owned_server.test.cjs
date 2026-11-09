/* eslint-disable @typescript-eslint/no-require-imports -- Pure Node capture controls. */
"use strict";
// S5 uses this exact existing helper only for owned-child/group settlement.
// Original F11 namespace/config/capture assertions stay on their original C recipe;
// they are not prerequisites for these unchanged full Gex scripts.
const test = require("node:test"), assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { trackOwnedServer } = require("./f11_owned_server.cjs");
function child() { return Object.assign(new EventEmitter(), { pid: 9911, exitCode: null, signalCode: null }); }
const gone = () => { throw Object.assign(new Error("not printed"), { code: "ESRCH" }); };
test("owned server close and group absence precede eligible success; repeated stop signals once", async () => {
  const c = child(), calls = [];
  const owner = trackOwnedServer(c, { signal(pid, sig) { calls.push([pid, sig]); if (sig === 0) gone(); else queueMicrotask(() => c.emit("close")); } });
  owner.assertRunning(); assert.throws(() => owner.settlement(), /NOT_SETTLED/);
  const first = owner.stop(), second = owner.stop(); assert.equal(first, second);
  await first; assert.deepEqual(calls, [[-9911, "SIGTERM"], [-9911, 0]]);
  assert.equal(owner.settlement().closeObserved, true);
  assert.throws(() => owner.assertRunning(), /NOT_RUNNING/);
});
test("exit without stdio close cannot qualify success", async () => {
  const c = child(), calls = [];
  const owner = trackOwnedServer(c, { timeoutMs: 5, signal(pid, sig) { calls.push([pid,sig]); c.exitCode = 0; c.emit("exit",0); } });
  await assert.rejects(owner.stop(), /CLOSE_TIMEOUT/);
  assert.throws(() => owner.settlement(), /NOT_SETTLED/);
  assert.deepEqual(calls, [[-9911,"SIGTERM"]]);
});
test("already closed child never receives termination (PID may have been reused)", async () => {
  const c = child(), calls = [];
  const owner = trackOwnedServer(c, { signal(pid,sig) { calls.push([pid,sig]); gone(); } });
  c.exitCode = 0; c.emit("close"); await owner.stop(); assert.deepEqual(calls,[[-9911,0]]);
});
test("ESRCH termination alone does not prove close", async () => {
  const owner = trackOwnedServer(child(), { timeoutMs: 5, signal: gone });
  await assert.rejects(owner.stop(), /CLOSE_TIMEOUT/); assert.throws(()=>owner.settlement(),/NOT_SETTLED/);
});
for (const condition of ["alive", "EPERM", "unknown"]) test(`postclose group ${condition} prevents success`, async () => {
  const c = child();
  const owner = trackOwnedServer(c, { timeoutMs: 5, signal(pid,sig) { if (sig === "SIGTERM") {queueMicrotask(()=>c.emit("close"));return;} if(condition!=="alive") throw Object.assign(new Error("not printed"),{code:condition}); } });
  await assert.rejects(owner.stop(), condition === "alive" ? /STILL_PRESENT/ : /GROUP_UNKNOWN/);
  assert.throws(()=>owner.settlement(),/NOT_SETTLED/);
});
test("child close may precede group disappearance, but success still requires actual ESRCH", async () => {
  const c=child(), calls=[];let probes=0;
  const owner=trackOwnedServer(c,{timeoutMs:200,signal(pid,sig){calls.push([pid,sig]);if(sig==="SIGTERM")queueMicrotask(()=>c.emit("close"));else if(++probes===2)gone();}});
  await owner.stop();assert.equal(probes,2);assert.equal(owner.settlement().processGroupAbsent,true);
  assert.equal(calls.filter(([,sig])=>sig==="SIGTERM").length,1);
});
test("group settlement uses only the original stop deadline remaining after close", async () => {
  const c=child();let clock=0,probes=0;
  const owner=trackOwnedServer(c,{timeoutMs:10,now:()=>clock,schedule(fn,ms){return setTimeout(()=>{clock+=ms;fn();},ms);},signal(pid,sig){if(sig==="SIGTERM"){clock=9;queueMicrotask(()=>c.emit("close"));}else probes++;}});
  const started=Date.now();await assert.rejects(owner.stop(),/GROUP_STILL_PRESENT/);
  assert.ok(Date.now()-started<100);assert.equal(probes,1);assert.throws(()=>owner.settlement(),/NOT_SETTLED/);
});
test("changed child identity is refused before a delayed group probe", async()=>{
  const c=child();let probes=0;
  const owner=trackOwnedServer(c,{timeoutMs:200,signal(pid,sig){if(sig==="SIGTERM")queueMicrotask(()=>c.emit("close"));else{probes++;c.pid=9922;}}});
  await assert.rejects(owner.stop(),/SERVER_IDENTITY_CHANGED/);assert.equal(probes,1);
  assert.throws(()=>owner.settlement(),/NOT_SETTLED/);
});
test("group probing never retries permission errors and releases every own timer",async()=>{
  const c=child(),pending=new Set();let probes=0,signals=0;
  const owner=trackOwnedServer(c,{timeoutMs:200,
    schedule(fn,ms){const timer=setTimeout(()=>{pending.delete(timer);fn();},ms);pending.add(timer);return timer;},
    cancel(timer){clearTimeout(timer);pending.delete(timer);},
    signal(pid,sig){if(sig==="SIGTERM"){signals++;queueMicrotask(()=>c.emit("close"));}else if(++probes===2)throw Object.assign(new Error("not retained"),{code:"EPERM"});}});
  const first=owner.stop();assert.equal(first,owner.stop());await assert.rejects(first,/GROUP_UNKNOWN/);
  assert.equal(signals,1);assert.equal(probes,2);assert.equal(pending.size,0);
  assert.throws(()=>owner.settlement(),/NOT_SETTLED/);
});
test("signal refusal stops without a fallback or repeated signal", async () => {
  let n=0; const owner=trackOwnedServer(child(),{signal(){n++;throw Object.assign(new Error("private"),{code:"EPERM"});}});
  await assert.rejects(owner.stop(),/^Error: F11_SERVER_STOP_REFUSED$/); await assert.rejects(owner.stop()); assert.equal(n,1);
});
test("capture child error cannot become success even after close", async () => {
  const c=child(), owner=trackOwnedServer(c,{signal:gone}); c.emit("error",new Error("private")); c.emit("close");
  await assert.rejects(owner.stop(),/SERVER_ERROR/);
});
test("timer cleanup occurs on close and timeout", async () => {
  for(const closes of [true,false]) {
    const c=child();let cancels=0;
    const owner=trackOwnedServer(c,{timeoutMs:5,cancel(timer){cancels++;clearTimeout(timer);},signal(pid,sig){if(sig===0)gone();if(closes)queueMicrotask(()=>c.emit("close"));}});
    if(closes)await owner.stop();else await assert.rejects(owner.stop(),/TIMEOUT/);assert.equal(cancels,1);
  }
});
test("invalid spawn identity refuses and keeps error event handled",()=>{
  const c=child();c.pid=undefined;assert.throws(()=>trackOwnedServer(c),/IDENTITY/);assert.doesNotThrow(()=>c.emit("error",new Error("spawn failed")));
});
