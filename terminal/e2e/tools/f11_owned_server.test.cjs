/* eslint-disable @typescript-eslint/no-require-imports -- Pure Node capture controls. */
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { trackOwnedServer, prepareNamespace, typeTemplate } = require("./f11_owned_server.cjs");
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
  const owner = trackOwnedServer(c, { signal(pid,sig) { if (sig === "SIGTERM") {queueMicrotask(()=>c.emit("close"));return;} if(condition!=="alive") throw Object.assign(new Error("not printed"),{code:condition}); } });
  await assert.rejects(owner.stop(), condition === "alive" ? /STILL_PRESENT/ : /GROUP_UNKNOWN/);
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
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"f11-owned-"));
  fs.writeFileSync(path.join(root,"tsconfig.json"),'{}\n');fs.writeFileSync(path.join(root,"tsconfig.f11.json"),'{}\n');
  return root;
}
function withFixture(fn){const root=fixture();try{return fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test("isolated compiler directory and generated types restore exact preimage without changing default output",()=>withFixture(root=>{
  fs.mkdirSync(path.join(root,".next/dev"),{recursive:true});fs.writeFileSync(path.join(root,".next/dev/sentinel"),"default output");
  const previous=typeTemplate.replace(".next/f11/dev/",".next/dev/");fs.writeFileSync(path.join(root,"next-env.d.ts"),previous);
  const namespace=prepareNamespace(root);assert.throws(()=>namespace.summary(),/NOT_RESTORED/);
  fs.writeFileSync(path.join(root,"next-env.d.ts"),typeTemplate);namespace.restoreGeneratedTypeFile();
  assert.equal(fs.readFileSync(path.join(root,"next-env.d.ts"),"utf8"),previous);
  assert.equal(fs.readFileSync(path.join(root,".next/dev/sentinel"),"utf8"),"default output");
  assert.equal(namespace.summary().trackedTsconfigsUnchanged,true);
}));
test("original absent generated type file remains absent",()=>withFixture(root=>{
  const namespace=prepareNamespace(root);fs.writeFileSync(path.join(root,"next-env.d.ts"),typeTemplate);namespace.restoreGeneratedTypeFile();assert.equal(fs.existsSync(path.join(root,"next-env.d.ts")),false);
}));
test("changed unknown generated bytes are retained and refuse restoration",()=>withFixture(root=>{
  fs.writeFileSync(path.join(root,"next-env.d.ts"),"old");const namespace=prepareNamespace(root);fs.writeFileSync(path.join(root,"next-env.d.ts"),"other writer");
  assert.throws(()=>namespace.restoreGeneratedTypeFile(),/TYPES_UNKNOWN/);assert.equal(fs.readFileSync(path.join(root,"next-env.d.ts"),"utf8"),"other writer");
}));
test("tracked TypeScript mutation refuses before generated restoration",()=>withFixture(root=>{
  const namespace=prepareNamespace(root);fs.writeFileSync(path.join(root,"tsconfig.json"),'{"changed":true}');fs.writeFileSync(path.join(root,"next-env.d.ts"),typeTemplate);
  assert.throws(()=>namespace.restoreGeneratedTypeFile(),/TYPESCRIPT_SOURCE_CHANGED/);assert.equal(fs.readFileSync(path.join(root,"next-env.d.ts"),"utf8"),typeTemplate);
}));
test("unknown restoration temporary remains untouched",()=>withFixture(root=>{
  fs.writeFileSync(path.join(root,"next-env.d.ts"),"old");const namespace=prepareNamespace(root);fs.writeFileSync(path.join(root,"next-env.d.ts"),typeTemplate);
  fs.writeFileSync(path.join(root,"next-env.d.ts.f11-restore"),"unknown");assert.throws(()=>namespace.restoreGeneratedTypeFile(),{code:"EEXIST"});assert.equal(fs.readFileSync(path.join(root,"next-env.d.ts.f11-restore"),"utf8"),"unknown");
}));
test("linked namespace or generated file refuses without following",()=>withFixture(root=>{
  fs.mkdirSync(path.join(root,"foreign"));fs.symlinkSync(path.join(root,"foreign"),path.join(root,".next"));assert.throws(()=>prepareNamespace(root),/NAMESPACE_CUSTODY/);assert.deepEqual(fs.readdirSync(path.join(root,"foreign")),[]);
  fs.unlinkSync(path.join(root,".next"));fs.symlinkSync(path.join(root,"tsconfig.json"),path.join(root,"next-env.d.ts"));assert.throws(()=>prepareNamespace(root),/FILE_CUSTODY/);
}));
test("namespace replacement is refused before any generated mutation",()=>withFixture(root=>{
  const namespace=prepareNamespace(root);fs.writeFileSync(path.join(root,"next-env.d.ts"),typeTemplate);fs.renameSync(path.join(root,".next/f11"),path.join(root,".next/original"));fs.mkdirSync(path.join(root,".next/f11"));
  assert.throws(()=>namespace.restoreGeneratedTypeFile(),/NAMESPACE_CHANGED/);
}));
test("actual pinned Next type emitter matches restoration predicate",async()=>{
  const root=fixture();try {
    const {writeAppTypeDeclarations}=require("next/dist/lib/typescript/writeAppTypeDeclarations");
    await writeAppTypeDeclarations({baseDir:root,distDir:".next/f11/dev",imageImportsEnabled:true,hasPagesDir:false,hasAppDir:true,strictRouteTypes:false,typedRoutes:false});
    assert.equal(fs.readFileSync(path.join(root,"next-env.d.ts"),"utf8"),typeTemplate);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("historical signal-only finalizer can publish before close; current owned promise fences publication",async()=>{
  const old=child();let closed=false,oldPublished=false;
  old.once("close",()=>{closed=true;});
  // Exact historical behavior: send SIGTERM and return synchronously.
  const oldStop=()=>{};oldStop(old);oldPublished=true;
  assert.equal(oldPublished,true);assert.equal(closed,false);
  const c=child(),owner=trackOwnedServer(c,{signal(pid,sig){if(sig===0)gone();}});
  let currentPublished=false;const publication=(async()=>{await owner.stop();currentPublished=true;})();
  await Promise.resolve();assert.equal(currentPublished,false);c.emit("close");await publication;assert.equal(currentPublished,true);
});
test("actual capture main awaits stop and generated restoration before writing eligibility",()=>{
  const source=fs.readFileSync(path.join(__dirname,"capture_b_f11_10_analysis_theses_entry.cjs"),"utf8");
  assert.match(source,/finally \{\s*await stopServer\(owner\);\s*namespace\.restoreGeneratedTypeFile\(\);/);
  assert.ok(source.indexOf("await stopServer(owner)")<source.indexOf("const fixturePayload"));
  assert.ok(source.indexOf("serverSettlement: owner.settlement()")<source.indexOf("writeSuccessArtifact(OUT, files, fixturePayload)"));
});
test("F11 TypeScript config retains enforced defaults and pinned Next does not rewrite it",async()=>{
  const ts=require("typescript");
  const actual=JSON.parse(fs.readFileSync(path.join(__dirname,"../../tsconfig.f11.json"),"utf8"));
  assert.equal(actual.extends,"./tsconfig.json");
  const root=fixture();try {
    fs.writeFileSync(path.join(root,"tsconfig.json"),fs.readFileSync(path.join(__dirname,"../../tsconfig.json")));
    const target=path.join(root,"tsconfig.f11.json");fs.writeFileSync(target,JSON.stringify(actual));
    const before=fs.readFileSync(target);
    const parsed=ts.getParsedCommandLineOfConfigFile(target,{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic(){throw new Error("type fixture configuration");}});
    assert.equal(parsed.options.strict,true);assert.equal(parsed.options.noEmit,true);assert.equal(parsed.options.isolatedModules,true);
    const {writeConfigurationDefaults}=require("next/dist/lib/typescript/writeConfigurationDefaults");
    await writeConfigurationDefaults(ts.version,target,false,true,".next/f11/dev",false,false);
    assert.ok(fs.readFileSync(target).equals(before));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
