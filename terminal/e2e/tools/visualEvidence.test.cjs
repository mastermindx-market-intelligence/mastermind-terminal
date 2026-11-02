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
test("source lock includes both committed hub classification and actual More renderer", () => {
  const locked = require("./visualEvidenceSources.json");
  assert.ok(locked.includes("terminal/lib/useHubDiscovery.ts"));
  assert.ok(locked.includes("terminal/components/mobile/RollerStrip.tsx"));
});
let root;
function at(op,name){return path.join(root,op.relative,(op.version===2?op.id+"--":"")+name);}
function refPath(op){return `${op.relative}/${op.version===2?op.id+"--":""}operation.json`;}
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
  assert.throws(() => e.readComposition({ repoRoot: root, compositionPath: refPath(op) }), /COMPOSITION_PATH/);
  const outside = path.join(root, "outside"); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(root, e.PACKETS.pl6, "linked--start.json"));
  assert.throws(() => e.beginOperation({ repoRoot: root, packet: "pl6", operationId: "linked", env: {} }), /FileExistsError/);
  assert.equal(fs.readdirSync(outside).length, 0);
});
test("replaced operation start refuses writes without touching foreign target", () => {
  const op = e.beginOperation({ repoRoot: root, packet: "pl6", operationId: "replaced", env: {} });
  const named = at(op,"start.json"); fs.renameSync(named, named + ".retained"); fs.writeFileSync(named,"foreign start");
  assert.throws(() => e.writePayload(op, "payload.json", Buffer.from("{}")), /MEMBER_REPLACED/);
  assert.equal(fs.readFileSync(named,"utf8"),"foreign start");assert.equal(fs.existsSync(at(op,"payload.json")),false);
  assert.ok(fs.existsSync(named + ".retained"));
});
test("report failure leaves incomplete evidence and never a completed operation", () => {
  const x = prepared("pl6", "failed", [e.requirements("pl6")[0]]); x.report.cases[0].status = "failed";
  assert.throws(() => e.finishOperation(x.op, x.report), /REPORT_RESULT/);
  assert.equal(fs.existsSync(at(x.op,"operation.json")), false);
  assert.ok(fs.existsSync(at(x.op,"start.json")));
});
test("actual writer-reader contract preserves two full packets, hashes, execution and source locks", () => {
  const pl = prepared("pl6", "pl-complete", e.requirements("pl6")), vi = prepared("vi", "vi-complete", e.requirements("vi"));
  const a = e.finishOperation(pl.op, pl.report), b = e.finishOperation(vi.op, vi.report);
  const refs = [a,b].map(({path, sha256}) => ({path, sha256})); const selections = [a,b].flatMap(ref => ref.operation.cases.map(c => ({ operationId: ref.operation.id, key: c.key })));
  const before = fs.readFileSync(path.join(root, a.path));
  const c = e.writeComposition({ repoRoot: root, id: "full", operations: refs, selections, profile });
  assert.throws(() => e.readComposition({ repoRoot: root, compositionPath: `${e.PACKETS.pl6}/full.composition.json`, expectedProfile: e.profile({MMX_SHARED_SHELL:"1"}) }), /PROFILE_MISMATCH/);
  const cp=require("node:child_process"),spawn=cp.spawnSync,swapped=path.join(root,e.PACKETS.pl6,"replaced-composition.composition.json");
  cp.spawnSync=function(command,args,options){const req=JSON.parse(options.input),reply=spawn.call(this,command,args,options);if(req.action==="write"&&req.name==="replaced-composition.composition.json"&&reply.status===0){fs.renameSync(swapped,swapped+".retained");fs.writeFileSync(swapped,"foreign selection");}return reply;};
  try{assert.throws(()=>e.writeComposition({repoRoot:root,id:"replaced-composition",operations:refs,selections,profile}),/MEMBER_REPLACED/);}finally{cp.spawnSync=spawn;}
  assert.equal(fs.readFileSync(swapped,"utf8"),"foreign selection");
  assert.equal(c.cases.length, 50); assert.equal(c.cases.filter(x => x.packet === "vi").length, 30);
  assert.deepEqual(fs.readFileSync(path.join(root,a.path)), before);
  assert.throws(() => e.writePayload(pl.op,"new.png",makePNG(8,8)), /OPERATION_COMPLETE/);
  assert.throws(() => e.writeComposition({repoRoot:root,id:"full",operations:refs,selections,profile}), /FileExistsError/);
  const target = path.join(root,"terminal/source-extra.ts");fs.writeFileSync(target,"unrelated not pinned");
  const source = path.join(root, require("./visualEvidenceSources.json")[0]); const old = fs.readFileSync(source);fs.writeFileSync(source,"stale source");
  assert.throws(() => e.readComposition({repoRoot:root,compositionPath:`${e.PACKETS.pl6}/full.composition.json`}), /SOURCE_MISMATCH/);fs.writeFileSync(source,old);
  const image = at(pl.op,a.operation.cases[0].image.path);fs.chmodSync(image,0o600);fs.writeFileSync(image,makePNG(8,8));
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
  const first=fs.readFileSync(at(a,x.row.image.path));
  assert.throws(()=>e.writeCase(a,spec,changed,observation), /FileExistsError/);
  assert.deepEqual(fs.readFileSync(at(a,x.row.image.path)),first);
  assert.deepEqual(fs.readFileSync(at(b,y.row.image.path)),changed);
  assert.throws(()=>e.readOperation(root,{path:refPath(a),sha256:"a".repeat(64)},{remaining:256*1024*1024}), /FileNotFoundError/);
});
for (const [label, mutate] of [
  ["missing attachment digest", r=>delete r.suites[0].specs[0].tests[0].results[0].attachments[0].sha256],
  ["wrong attachment digest", r=>r.suites[0].specs[0].tests[0].results[0].attachments[0].sha256="f".repeat(64)],
  ["wrong attachment size", r=>r.suites[0].specs[0].tests[0].results[0].attachments[0].bytes=1],
]) test(label,()=>{
  const x=prepared("vi",label.replaceAll(" ","-"),[e.requirements("vi")[0]]);mutate(x.report);
  assert.throws(()=>e.finishOperation(x.op,x.report),/REPORT_ATTACHMENT/);
  assert.equal(fs.existsSync(at(x.op,"operation.json")),false);
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
test("creation identity refuses replacement after helper return", () => {
  const cp=require("node:child_process"), spawn=cp.spawnSync;
  const named=path.join(root,e.PACKETS.pl6,"creation-race--start.json"),retained=named+".retained";
  let result,error;
  cp.spawnSync=function(command,args,options){
    const req=JSON.parse(options.input),reply=spawn.call(this,command,args,options);
    if(req.action==="create_start"&&req.id==="creation-race"&&reply.status===0){fs.renameSync(named,retained);fs.writeFileSync(named,"foreign replacement");}
    return reply;
  };
  try{result=e.beginOperation({repoRoot:root,packet:"pl6",operationId:"creation-race",env:{}});}catch(caught){error=caught.message;}finally{cp.spawnSync=spawn;}
  assert.equal(error,"MEMBER_REPLACED");assert.equal(result,undefined);
  assert.equal(fs.readFileSync(named,"utf8"),"foreign replacement");assert.equal(JSON.parse(fs.readFileSync(retained)).id,"creation-race");
});
test("ordinary exclusive creation pins start and trusted parent",()=>{
  const op=e.beginOperation({repoRoot:root,packet:"pl6",operationId:"creation-positive",env:{}}), stat=fs.statSync(at(op,"start.json")),parent=fs.statSync(path.join(root,op.relative));
  assert.equal(op.version,2);assert.deepEqual(op.identity,[stat.dev,stat.ino]);assert.deepEqual(op.parentIdentity,[parent.dev,parent.ino]);
  assert.equal(e.sha(fs.readFileSync(at(op,"start.json"))),op.startHash);
  const start=JSON.parse(fs.readFileSync(at(op,"start.json")));assert.equal(start.id,op.id);assert.equal(start.schema,"terminal.visual-operation-start.v2");
});
test("native earliest interleaving reproduces directory RED and keeps v2 foreign file untouched",()=>{
  const cp=require("node:child_process"),helper=path.join(__dirname,"visualEvidenceFs.py");
  const script=String.raw`
import base64,importlib.util,json,os,sys
x=json.loads(sys.stdin.buffer.readline(1024*1024))
spec=importlib.util.spec_from_file_location('new',x['helper']);n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n)
# Self-contained historical unsafe fragment from rejected c8f; test fixture only.
# No shallow-checkout ancestor object or network fetch is required.
os.makedirs(os.path.join(x['root'],x['packet'],'operations'),exist_ok=True)
def legacy_create():
    target=n.open_dir(x['root'],x['packet']+'/operations')
    try:
        os.mkdir('native-old',0o700,dir_fd=target)
        created=os.open('native-old',n.FLAGS,dir_fd=target)
        try:
            value=n.identity(created);named=os.stat('native-old',dir_fd=target,follow_symlinks=False)
            if [named.st_dev,named.st_ino]!=value:raise ValueError('DIRECTORY_REPLACED')
            os.fsync(created);os.fsync(target);return value
        finally:os.close(created)
    finally:os.close(target)
realmkdir=os.mkdir
native_old='native-old'
def mkdir_race(name,*args,**kwargs):
    realmkdir(name,*args,**kwargs)
    if name==native_old:
        fd=kwargs['dir_fd'];os.rename(name,name+'.retained',src_dir_fd=fd,dst_dir_fd=fd);realmkdir(name,*args,**kwargs)
os.mkdir=mkdir_race
try: old_identity=legacy_create()
finally: os.mkdir=realmkdir
payload=b'original start bytes'
parent=n.open_dir(x['root'],x['packet']+'/operations/'+native_old)
try:
    if n.identity(parent)!=old_identity:raise ValueError('DIRECTORY_REPLACED')
    leaf=os.open('start.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400,dir_fd=parent)
    try:os.write(leaf,payload);os.fsync(leaf)
    finally:os.close(leaf)
finally:os.close(parent)
p=os.path.join(x['root'],x['packet'],'operations',native_old)
old_result={'foreignStartWritten':open(p+'/start.json','rb').read()==payload,'originalStartWritten':os.path.exists(p+'.retained/start.json')}
realopen=os.open;name='native-new--start.json';sentinel=b'foreign replacement'
def open_race(value,flags,*args,**kwargs):
    fd=realopen(value,flags,*args,**kwargs)
    if value==name and flags & os.O_CREAT:
        parent=kwargs['dir_fd'];os.rename(name,name+'.retained',src_dir_fd=parent,dst_dir_fd=parent)
        foreign=realopen(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600,dir_fd=parent)
        try: os.write(foreign,sentinel)
        finally: os.close(foreign)
    return fd
os.open=open_race
error=None
try: n.main({'root':x['root'],'relative':x['packet'],'action':'create_start','id':'native-new','name':name,'bytes':base64.b64encode(payload).decode()})
except Exception as e: error=str(e)
finally: os.open=realopen
p=os.path.join(x['root'],x['packet'],name)
new_result={'error':error,'foreignUnchanged':open(p,'rb').read()==sentinel,'originalReceivesOwnBytes':open(p+'.retained','rb').read()==payload,'complete':os.path.exists(os.path.join(x['root'],x['packet'],'native-new--operation.json'))}
print(json.dumps({'old':old_result,'new':new_result}))
`;
  const r=cp.spawnSync('/usr/bin/python3',['-I','-c',script],{input:JSON.stringify({root,packet:e.PACKETS.pl6,helper})+'\n',encoding:'utf8',maxBuffer:1024*1024});
  assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);
  assert.deepEqual(result.old,{foreignStartWritten:true,originalStartWritten:false});
  assert.deepEqual(result.new,{error:'MEMBER_CHANGED',foreignUnchanged:true,originalReceivesOwnBytes:true,complete:false});
  console.log('native earliest interleaving',JSON.stringify(result));
});
test("lost creation response retains original prefix and refuses replacement attempt",()=>{
  const cp=require('node:child_process'),spawn=cp.spawnSync;
  cp.spawnSync=function(command,args,options){const req=JSON.parse(options.input),r=spawn.call(this,command,args,options);if(req.action==='create_start'&&req.id==='lost-response'&&r.status===0)return {...r,stdout:''};return r;};
  try{assert.throws(()=>e.beginOperation({repoRoot:root,packet:'pl6',operationId:'lost-response',env:{}}),/ARTIFACT_IO_UNCERTAIN/);}finally{cp.spawnSync=spawn;}
  const named=path.join(root,e.PACKETS.pl6,'lost-response--start.json'),before=fs.readFileSync(named);
  assert.throws(()=>e.beginOperation({repoRoot:root,packet:'pl6',operationId:'lost-response',env:{}}),/FileExistsError/);
  assert.deepEqual(fs.readFileSync(named),before);assert.equal(fs.existsSync(path.join(root,e.PACKETS.pl6,'lost-response--operation.json')),false);
});
test("orphaned flat prefix cannot be reenrolled after missing start",()=>{
  const p=path.join(root,e.PACKETS.pl6,'orphaned--report.json');fs.writeFileSync(p,'retained partial');
  assert.throws(()=>e.beginOperation({repoRoot:root,packet:'pl6',operationId:'orphaned',env:{}}),/FileExistsError/);
  assert.equal(fs.readFileSync(p,'utf8'),'retained partial');assert.equal(fs.existsSync(path.join(root,e.PACKETS.pl6,'orphaned--start.json')),false);
});
test("explicit v1 history remains readable, cannot be rewritten or silently mixed",()=>{
  const repo=path.resolve(__dirname,"../../.."),relative=`${e.PACKETS.vi}/operations/fixture-final-vi-01a15d64-20261024`,p=`${relative}/operation.json`;
  fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});fs.cpSync(path.join(repo,relative),path.join(root,relative),{recursive:true});
  const bytes=fs.readFileSync(path.join(root,p)),historical={path:p,sha256:e.sha(bytes)};
  const old=e.readOperation(root,historical,{remaining:256*1024*1024});assert.equal(old.schema,"terminal.visual-operation.v1");assert.equal(old.cases.length,3);
  assert.throws(()=>e.writePayload({version:1,repoRoot:root,relative},'new.json',Buffer.from('{}')),/HISTORICAL_READ_ONLY/);
  assert.deepEqual(fs.readFileSync(path.join(root,p)),bytes);
  const x=prepared('pl6','mixed-v2',[e.requirements('pl6')[0]]),fresh=e.finishOperation(x.op,x.report);
  const shape={schema:'terminal.visual-composition.v2',mode:'records',id:'mixed-versions',profile,operations:[historical,{path:fresh.path,sha256:fresh.sha256}],selections:[]};
  const composition=`${e.PACKETS.pl6}/mixed-versions.composition.json`;fs.writeFileSync(path.join(root,composition),JSON.stringify(shape));
  assert.throws(()=>e.readComposition({repoRoot:root,compositionPath:composition}),/MIXED_OPERATION_VERSIONS/);
  const unknown=`${e.PACKETS.pl6}/unknown-version.composition.json`;fs.writeFileSync(path.join(root,unknown),JSON.stringify({...shape,id:'unknown-version',schema:'terminal.visual-composition.v999'}));
  assert.throws(()=>e.readComposition({repoRoot:root,compositionPath:unknown}),/COMPOSITION_SHAPE/);
  fs.chmodSync(path.join(root,fresh.path),0o600);const bad={...fresh.operation,schema:'terminal.visual-operation.v999'};const badBytes=Buffer.from(e.canonical(bad));fs.writeFileSync(path.join(root,fresh.path),badBytes);
  assert.throws(()=>e.readOperation(root,{path:fresh.path,sha256:e.sha(badBytes)},{remaining:256*1024*1024}),/OPERATION_BINDING/);
});

test("flat IDs with delimiter-like prefixes remain disjoint",()=>{
  const a=e.beginOperation({repoRoot:root,packet:'pl6',operationId:'flat-prefix',env:{}}),b=e.beginOperation({repoRoot:root,packet:'pl6',operationId:'flat-prefix--nested',env:{}});
  e.writePayload(b,'report.json',Buffer.from('{"retained":true}'));const before=fs.readFileSync(at(b,'report.json'));
  assert.throws(()=>e.writePayload(a,'nested--report.json',Buffer.from('{}')),/UNSAFE_MEMBER/);
  assert.throws(()=>e.writePayload(a,'nested.composition.json',Buffer.from('{}')),/UNSAFE_MEMBER/);
  assert.deepEqual(fs.readFileSync(at(b,'report.json')),before);
});
test("partial first write is retained and never reenrolled",()=>{
  const cp=require('node:child_process'),helper=path.join(__dirname,'visualEvidenceFs.py');
  const script=String.raw`
import base64,importlib.util,json,os,sys
x=json.loads(sys.stdin.buffer.readline(1024*1024));spec=importlib.util.spec_from_file_location('h',x['helper']);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=os.write
def partial(fd,data):
    original(fd,data[:3]);raise OSError('injected after partial write')
os.write=partial
error=None
try:m.main({'root':x['root'],'relative':x['packet'],'action':'create_start','id':'partial-write','name':'partial-write--start.json','bytes':base64.b64encode(b'original payload').decode()})
except Exception as exc:error=type(exc).__name__
finally:os.write=original
print(json.dumps({'error':error,'bytes':open(os.path.join(x['root'],x['packet'],'partial-write--start.json'),'rb').read().decode()}))
`;
  const r=cp.spawnSync('/usr/bin/python3',['-I','-c',script],{input:JSON.stringify({root,packet:e.PACKETS.pl6,helper})+'\n',encoding:'utf8',maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{error:'OSError',bytes:'ori'});
  assert.throws(()=>e.beginOperation({repoRoot:root,packet:'pl6',operationId:'partial-write',env:{}}),/FileExistsError/);
  assert.equal(fs.readFileSync(path.join(root,e.PACKETS.pl6,'partial-write--start.json'),'utf8'),'ori');
  assert.equal(fs.existsSync(path.join(root,e.PACKETS.pl6,'partial-write--operation.json')),false);
});

test("webpack identity is explicit and cannot reuse unlabelled compiler proof", () => {
  assert.equal(e.profile({ TERMINAL_EVIDENCE_COMPILER: "webpack" }).compiler, "webpack");
  assert.equal(e.profile({}).compiler, undefined);
  assert.throws(() => e.profile({ TERMINAL_EVIDENCE_COMPILER: "other" }), /PROFILE_COMPILER/);
  const x = fixture(); x.operations[0].profile = e.profile({ TERMINAL_EVIDENCE_COMPILER: "webpack" });
  assert.throws(() => e.composeCases(x), /PROFILE_MISMATCH/);
  x.profile = e.profile({ TERMINAL_EVIDENCE_COMPILER: "webpack" });
  assert.equal(e.composeCases(x).length, 30);
});
