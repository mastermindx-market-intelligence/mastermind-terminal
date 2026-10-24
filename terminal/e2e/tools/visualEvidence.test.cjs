"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PNG } = require("pngjs");
const e = require("./visualEvidence.cjs");
const sources = { "terminal/source.ts": "a".repeat(64) }, profile = e.profile({});
function row(spec) {
  return { key: spec.key, packet: spec.packet, locale: spec.locale, viewport: { ...spec.viewport },
    image: { path: "same-name.png", sha256: "b".repeat(64), ...spec.viewport },
    execution: { file: spec.file, title: spec.title, project: spec.project, status: "passed", expectedStatus: "passed", retry: 0, errors: [] },
    observation: { lang: spec.locale, theme: "dark", viewport: { ...spec.viewport } } };
}
function fixture(required = e.requirements("vi")) {
  const operations = [{ id: "alpha", packet: "vi", sourceFiles: { ...sources }, profile: { ...profile }, cases: required.map(row) }];
  return { operations, selections: required.map(s => ({ operationId: "alpha", key: s.key })), requiredCases: required, currentSources: sources, profile };
}
function changed(fn) { const x = structuredClone(fixture()); fn(x); return x; }
test("all30 actual identities and mobile crosshair required; deterministic order, no input mutation", () => {
  const x = fixture(), before = JSON.stringify(x); const a = e.composeCases(x); assert.equal(a.length, 30);
  assert.deepEqual(a.map(r => r.key), [...a.map(r => r.key)].sort((a,b) => a.localeCompare(b)));
  assert.deepEqual(e.composeCases({ ...x, selections: [...x.selections].reverse() }), a); assert.equal(JSON.stringify(x), before);
});
test("two scoped cases cannot stand in for30", () => assert.throws(() => e.composeCases(changed(x => x.selections.splice(2))), /MISSING_CASE/));
test("duplicate exact bytes never inflate coverage", () => assert.throws(() => e.composeCases(changed(x => x.selections[29] = x.selections[0])), /DUPLICATE_CASE/));
test("actual mobile crosshair missing refuses", () => assert.throws(() => e.composeCases(changed(x => x.selections = x.selections.filter(s => !s.key.includes(`mobile:en:${e.TITLES[3]}`)))), /MISSING_CASE/));
test("two operations with identical filenames compose without changing either record", () => {
  const x = fixture(); const b = structuredClone(x.operations[0]); b.id = "beta"; b.cases = b.cases.splice(15); x.operations[0].cases.splice(15); x.operations.push(b); x.selections.slice(15).forEach(s => { s.operationId = "beta"; }); const before = JSON.stringify(x);
  assert.equal(e.composeCases(x).length, 30); assert.equal(JSON.stringify(x), before);
});
for (const [label, mutate, code] of [
  ["changed source", x => x.operations[0].sourceFiles["terminal/source.ts"] = "c".repeat(64), "SOURCE_MISMATCH"],
  ["missing source lock", x => delete x.operations[0].sourceFiles["terminal/source.ts"], "SOURCE_MISMATCH"],
  ["shared shell profile", x => x.operations[0].profile.sharedShell = "1", "PROFILE_MISMATCH"],
  ["wrong locale", x => x.operations[0].cases[0].observation.lang = "zh", "CASE_BINDING"],
  ["wrong theme", x => x.operations[0].cases[0].observation.theme = "light", "CASE_BINDING"],
  ["wrong viewport", x => x.operations[0].cases[0].observation.viewport.width = 100, "CASE_BINDING"],
  ["tiny image cannot claim full viewport", x => x.operations[0].cases[0].image.width = 1, "CASE_BINDING"],
  ["failed execution", x => x.operations[0].cases[0].execution.status = "failed", "CASE_BINDING"],
  ["retry", x => x.operations[0].cases[0].execution.retry = 1, "CASE_BINDING"],
  ["report error", x => x.operations[0].cases[0].execution.errors.push({ message: "fault" }), "CASE_BINDING"],
  ["wrong executed title", x => x.operations[0].cases[0].execution.title = "other", "CASE_BINDING"],
  ["unknown explicit selection", x => x.selections[0].operationId = "missing", "UNKNOWN_SELECTION"],
  ["unsafe image path", x => x.operations[0].cases[0].image.path = "../other.png", "CASE_BINDING"],
]) test(label, () => assert.throws(() => e.composeCases(changed(mutate)), new RegExp(code)));
test("explicit invalid selection never falls back; bounded legacy remains explicit", () => {
  assert.equal(e.selectedComposition("unused", {}), null);
  assert.equal(e.selectedComposition("unused", { TERMINAL_EVIDENCE_MODE: "legacy" }), null);
  assert.throws(() => e.selectedComposition("unused", { TERMINAL_EVIDENCE_COMPOSITION: "" }), /EVIDENCE_SELECTION/);
  assert.throws(() => e.selectedComposition("unused", { TERMINAL_EVIDENCE_COMPOSITION: "missing", TERMINAL_EVIDENCE_MODE: "legacy" }), /EVIDENCE_SELECTION/);
});
let root;
function makePNG(width, height) {
  const png = new PNG({ width, height }); for (let i = 0; i < png.data.length; i += 4) { png.data[i] = (i / 4) % 251; png.data[i+1] = 64; png.data[i+2] = 96; png.data[i+3] = 255; } return PNG.sync.write(png);
}
function cleanup(dir) { if (!fs.existsSync(dir)) return; fs.chmodSync(dir, 0o700); for (const name of fs.readdirSync(dir)) { const p = path.join(dir, name); if (fs.lstatSync(p).isDirectory()) cleanup(p); } fs.rmSync(dir, { recursive: true, force: true }); }
before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "visual-evidence-contract-")));
  for (const p of [...require("./visualEvidenceSources.json"), "terminal/e2e/tools/visualEvidenceSources.json"]) { const at = path.join(root, p); fs.mkdirSync(path.dirname(at), { recursive: true }); fs.writeFileSync(at, `synthetic source: ${p}\n`); }
  for (const p of Object.values(e.PACKETS)) fs.mkdirSync(path.join(root, p), { recursive: true });
});
after(() => cleanup(root));
function prepared(packet, id, specs) {
  const op = e.beginOperation({ repoRoot: root, packet, operationId: id, env: {} });
  const rows = [];
  for (const s of specs) {
    const actual = row(s); const result = e.writeCase(op, s, makePNG(s.viewport.width, s.viewport.height), actual.observation);
    rows.push(packet === "pl6" ? { ...actual.execution, locale: s.locale, observation: { path: result.observationName, sha256: e.sha(Buffer.from(e.canonical(result.row))) } } : { title: s.title, file: s.file, tests: [{ projectName: s.project, status: "expected", expectedStatus: "passed", results: [{ status: "passed", retry: 0, errors: [], attachments: [{ name: `visual-evidence:${result.observationName}`, contentType: "application/json", sha256: e.sha(Buffer.from(e.canonical(result.row))), bytes: Buffer.byteLength(e.canonical(result.row)) }] }] }] });
  }
  const report = packet === "pl6" ? { schema: "terminal.pl6-execution.v1", cases: rows } : { errors: [], stats: { expected: rows.length, unexpected: 0, skipped: 0, flaky: 0 }, suites: [{ specs: rows }] };
  return { op, report };
}
test("immutable begin refuses existing target, symlink and escaped IDs", () => {
  const op = e.beginOperation({ repoRoot: root, packet: "pl6", operationId: "incomplete", env: {} });
  assert.throws(() => e.beginOperation({ repoRoot: root, packet: "pl6", operationId: "incomplete", env: {} }), /FileExistsError/);
  assert.throws(() => e.beginOperation({ repoRoot: root, packet: "pl6", operationId: "../outside", env: {} }), /OPERATION_ID/);
  assert.throws(() => e.readComposition({ repoRoot: root, compositionPath: `${op.relative}/operation.json` }), /COMPOSITION_PATH/);
  const outside = path.join(root, "outside"); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(root, e.PACKETS.pl6, "operations", "linked"));
  assert.throws(() => e.beginOperation({ repoRoot: root, packet: "pl6", operationId: "linked", env: {} }), /FileExistsError/);
  assert.equal(fs.readdirSync(outside).length, 0);
});
test("replaced operation directory refuses writes without touching foreign target", () => {
  const op = e.beginOperation({ repoRoot: root, packet: "pl6", operationId: "replaced", env: {} });
  const named = path.join(root, op.relative); fs.renameSync(named, named + "-retained"); fs.mkdirSync(named);
  assert.throws(() => e.writePayload(op, "payload.json", Buffer.from("{}")), /DIRECTORY_REPLACED/);
  assert.deepEqual(fs.readdirSync(named), []); assert.ok(fs.existsSync(named + "-retained/start.json"));
});
test("report failure leaves incomplete evidence and never a completed operation", () => {
  const x = prepared("pl6", "failed", [e.requirements("pl6")[0]]); x.report.cases[0].status = "failed";
  assert.throws(() => e.finishOperation(x.op, x.report), /REPORT_RESULT/);
  assert.equal(fs.existsSync(path.join(root, x.op.relative, "operation.json")), false);
  assert.ok(fs.existsSync(path.join(root, x.op.relative, "start.json")));
});
test("actual writer-reader contract preserves two full packets, hashes, execution and source locks", () => {
  const pl = prepared("pl6", "pl-complete", e.requirements("pl6")), vi = prepared("vi", "vi-complete", e.requirements("vi"));
  const a = e.finishOperation(pl.op, pl.report), b = e.finishOperation(vi.op, vi.report);
  const refs = [a,b].map(({path, sha256}) => ({path, sha256})); const selections = [a,b].flatMap(ref => ref.operation.cases.map(c => ({ operationId: ref.operation.id, key: c.key })));
  const before = fs.readFileSync(path.join(root, a.path));
  const c = e.writeComposition({ repoRoot: root, id: "full", operations: refs, selections, profile });
  assert.throws(() => e.readComposition({ repoRoot: root, compositionPath: `${e.PACKETS.pl6}/full.composition.json`, expectedProfile: e.profile({MMX_SHARED_SHELL:"1"}) }), /PROFILE_MISMATCH/);
  assert.equal(c.cases.length, 50); assert.equal(c.cases.filter(x => x.packet === "vi").length, 30);
  assert.deepEqual(fs.readFileSync(path.join(root,a.path)), before);
  assert.throws(() => e.writePayload(pl.op,"new.png",makePNG(8,8)), /OPERATION_COMPLETE/);
  assert.throws(() => e.writeComposition({repoRoot:root,id:"full",operations:refs,selections,profile}), /FileExistsError/);
  const target = path.join(root,"terminal/source-extra.ts");fs.writeFileSync(target,"unrelated not pinned");
  const source = path.join(root, require("./visualEvidenceSources.json")[0]); const old = fs.readFileSync(source);fs.writeFileSync(source,"stale source");
  assert.throws(() => e.readComposition({repoRoot:root,compositionPath:`${e.PACKETS.pl6}/full.composition.json`}), /SOURCE_MISMATCH/);fs.writeFileSync(source,old);
  const image = path.join(root,pl.op.relative,a.operation.cases[0].image.path);fs.chmodSync(image,0o600);fs.writeFileSync(image,makePNG(8,8));
  assert.throws(() => e.readComposition({repoRoot:root,compositionPath:`${e.PACKETS.pl6}/full.composition.json`}), /PNG_BINDING/);
});

test("decoded images preserve incumbent blank/transparent/CRC bounds", () => {
  const p = new PNG({width:2,height:2});
  p.data=Buffer.from([10,20,30,255,10,20,30,128,10,20,30,64,10,20,30,0]);
  assert.throws(()=>e.imageInfo(PNG.sync.write(p)), /PNG_BLANK/);
  p.data=Buffer.from([1,2,3,0,10,20,30,0,80,90,100,0,100,90,80,0]);
  assert.throws(()=>e.imageInfo(PNG.sync.write(p)), /PNG_BLANK/);
  const valid=makePNG(8,8);const corrupt=Buffer.from(valid);corrupt[corrupt.length-5]^=255;
  assert.throws(()=>e.imageInfo(corrupt));
  assert.throws(()=>e.imageInfo(valid.subarray(0,20)), /PNG_INVALID/);
});
test("ambiguous operation IDs and changed fixture membership refuse", () => {
  const x=fixture();x.operations.push(structuredClone(x.operations[0]));
  assert.throws(()=>e.composeCases(x), /COMPOSITION_SHAPE/);
  assert.throws(()=>e.composeCases(changed(x=>x.currentSources['terminal/new-fixture.ts']='d'.repeat(64))), /SOURCE_MISMATCH/);
});
test("same case filename remains distinct across immutable physical operations", () => {
  const spec=e.requirements("pl6")[0], a=e.beginOperation({repoRoot:root,packet:"pl6",operationId:"same-one",env:{}}), b=e.beginOperation({repoRoot:root,packet:"pl6",operationId:"same-two",env:{}});
  const bytes=makePNG(8,8), alt=new PNG({width:8,height:8});for(let i=0;i<alt.data.length;i+=4){alt.data[i]=i%251;alt.data[i+1]=99;alt.data[i+2]=11;alt.data[i+3]=255;}
  const changed=PNG.sync.write(alt), observation=row(spec).observation;
  const x=e.writeCase(a,spec,bytes,observation), y=e.writeCase(b,spec,changed,observation);
  assert.equal(x.row.image.path,y.row.image.path);assert.notEqual(x.row.image.sha256,y.row.image.sha256);
  const first=fs.readFileSync(path.join(root,a.relative,x.row.image.path));
  assert.throws(()=>e.writeCase(a,spec,changed,observation), /FileExistsError/);
  assert.deepEqual(fs.readFileSync(path.join(root,a.relative,x.row.image.path)),first);
  assert.deepEqual(fs.readFileSync(path.join(root,b.relative,y.row.image.path)),changed);
  assert.throws(()=>e.readOperation(root,{path:`${a.relative}/operation.json`,sha256:"a".repeat(64)},{remaining:256*1024*1024}), /FileNotFoundError/);
});
for (const [label, mutate] of [
  ["missing attachment digest", r=>delete r.suites[0].specs[0].tests[0].results[0].attachments[0].sha256],
  ["wrong attachment digest", r=>r.suites[0].specs[0].tests[0].results[0].attachments[0].sha256="f".repeat(64)],
  ["wrong attachment size", r=>r.suites[0].specs[0].tests[0].results[0].attachments[0].bytes=1],
]) test(label,()=>{
  const x=prepared("vi",label.replaceAll(" ","-"),[e.requirements("vi")[0]]);mutate(x.report);
  assert.throws(()=>e.finishOperation(x.op,x.report),/REPORT_ATTACHMENT/);
  assert.equal(fs.existsSync(path.join(root,x.op.relative,"operation.json")),false);
});

test("immutable PL6 readiness refuses exited child and foreign response", async()=>{
  const {waitForServer}=require("./capture_pl6_batch1.cjs"), prior=global.fetch;
  let calls=0;global.fetch=async()=>{calls++;return {status:200};};
  try {
    await assert.rejects(waitForServer(100,{exitCode:1,signalCode:null,captureReady:false}),/CAPTURE_SERVER_EXITED/);assert.equal(calls,0);
    const child={exitCode:null,signalCode:null,captureReady:true};
    global.fetch=async()=>{calls++;child.exitCode=1;return {status:200};};
    await assert.rejects(waitForServer(100,child),/CAPTURE_SERVER_EXITED/);
    assert.equal(calls,1);
    const ready={exitCode:null,signalCode:null,captureReady:true};global.fetch=async()=>({status:200});
    await waitForServer(100,ready);
  } finally {global.fetch=prior;}
});
test("creation identity refuses replacement before the first start write", () => {
  const cp=require("node:child_process"), spawn=cp.spawnSync;
  const relative=`${e.PACKETS.pl6}/operations/creation-race`, named=path.join(root,relative), retained=named+"-original";
  let result, error;
  cp.spawnSync=function(command,args,options){
    const req=JSON.parse(options.input), reply=spawn.call(this,command,args,options);
    if(req.action==="create_operation" && req.id==="creation-race" && reply.status===0){fs.renameSync(named,retained);fs.mkdirSync(named);}
    return reply;
  };
  try{result=e.beginOperation({repoRoot:root,packet:"pl6",operationId:"creation-race",env:{}});}catch(caught){error=caught.message;}finally{cp.spawnSync=spawn;}
  const observed={accepted:Boolean(result),error:error||null,foreignStartWritten:fs.existsSync(path.join(named,"start.json")),originalStartWritten:fs.existsSync(path.join(retained,"start.json"))};
  assert.equal(error,"DIRECTORY_REPLACED",JSON.stringify(observed));
  assert.deepEqual(fs.readdirSync(named),[]);assert.deepEqual(fs.readdirSync(retained),[]);
});
test("ordinary creation pins its actual new directory before writing start",()=>{
  const op=e.beginOperation({repoRoot:root,packet:"pl6",operationId:"creation-positive",env:{}}), stat=fs.statSync(path.join(root,op.relative));
  assert.deepEqual(op.identity,[stat.dev,stat.ino]);
  const start=JSON.parse(fs.readFileSync(path.join(root,op.relative,"start.json")));
  assert.equal(start.id,op.id);assert.equal(start.packet,"pl6");
});
