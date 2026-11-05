import {describe,expect,it,vi} from "vitest";
import fixture from "./fixtures/options_plan_draft_v1.json";
import {canonicalInvestigationJson,validateStoredInvestigationManifest,type InvestigationManifest} from "../investigationContracts";
import {applyInvestigationRevision,readInvestigation,readInvestigationOperation,reconcileInvestigationOperation,parseInvestigationCommand,matchesInvestigationCommand,type InvestigationCommand} from "../investigations";
import {beginInvestigationSave,recoverInvestigationSave,settleInvestigationSave,retryInvestigationSave,investigationCommandToReconcile,partitionInvestigationSave} from "../investigationSave";
import {assessmentRevision} from "../investigationReview";
import {createHash} from "node:crypto";
const id="11111111-1111-4111-8111-111111111111", op="22222222-2222-4222-8222-222222222222", rid="33333333-3333-4333-8333-333333333333", author="44444444-4444-4444-8444-444444444444", stamp="2026-10-23T20:00:00.000Z";
const manifest=():InvestigationManifest=>({schema:"investigation_manifest.v3",intent:{title:"Retained contract research",question:"Exact source, explicit assumptions",subjects:[],research_as_of:stamp},layout_refs:[],thesis_refs:[],evidence_refs:[],argument_relations:[],continuation:{},option_plan:structuredClone(fixture) as InvestigationManifest["option_plan"]});
const command=():InvestigationCommand=>({id,operation_id:op,action:"create",expected_revision:0,manifest:manifest()});
// An in-memory adapter receipt, not a PostgreSQL canonical-digest/parity or atomicity claim.
const digest=(m:InvestigationManifest)=>createHash("sha256").update(canonicalInvestigationJson(m)).digest("hex");
const receipt=(c=command())=>({status:"committed",id:c.id,investigation_id:c.id,revision:c.expected_revision+1,sequence:c.expected_revision+1,revision_id:rid,parent_revision_id:c.expected_revision?op:null,operation_id:c.operation_id,author_ref:author,recorded_at:stamp,committed_at:stamp,lifecycle:c.action==="remove"?"removed":"active",manifest:structuredClone(c.manifest),manifest_digest:digest(c.manifest)});
const rpcArgs=(c:InvestigationCommand)=>({p_id:c.id,p_expected_revision:c.expected_revision,p_action:c.action,p_operation_id:c.operation_id,p_manifest:c.manifest,p_layout_capture:null});
describe("native Plan transport and recovery composition (in-memory only)",()=>{
 it("passes v3 whole Plan through the existing RPC, without ids, clocks, null/zero or terms substitution",async()=>{
  const c=command(),before=JSON.stringify(c);const rpc=vi.fn(async()=>({data:receipt(c),error:null}));
  expect(await applyInvestigationRevision({rpc},c)).toEqual(receipt(c));expect(rpc.mock.calls[0]).toEqual(["apply_investigation_revision_v2",rpcArgs(c)]);
  expect(JSON.stringify(c)).toBe(before);expect(c.manifest.option_plan?.legs[0].assumptions.entry).toBeNull();expect(c.manifest.option_plan?.legs[1].assumptions.entry?.premium_per_unit).toBe(0);
 });
 it.each(["create","revise","remove","restore"] as const)("preserves v2 %s JSON and original operation identity across outbox recovery/reconcile",async action=>{
  const c=command();c.action=action;c.expected_revision=action==="create"?0:4;c.manifest={...c.manifest,schema:"investigation_manifest.v2"};delete c.manifest.option_plan;
  const before=JSON.stringify(c),pending=beginInvestigationSave("alice",c,{phase:"idle"});expect(pending.phase).toBe("pending");
  const recovered=recoverInvestigationSave("alice",JSON.parse(JSON.stringify({owner:"alice",command:c})))!;expect(investigationCommandToReconcile(recovered,"alice")).toEqual(c);
  const rpc=vi.fn(async()=>({data:receipt(c),error:null}));expect(await reconcileInvestigationOperation({rpc},c)).toEqual(receipt(c));expect(rpc.mock.calls[0]).toEqual(["reconcile_investigation_operation_v2",rpcArgs(c)]);expect(JSON.stringify(c)).toBe(before);
 });
 it("retains an uncertain v3 request despite caller edits, reload and a receipt miss",async()=>{
  const c=command(),original=structuredClone(c);const pending=beginInvestigationSave("alice",c,{phase:"idle"});c.manifest.option_plan!.research.thesis="later unsaved edit";
  const unknown=settleInvestigationSave(pending,"alice",null);expect(retryInvestigationSave(unknown,"alice")).toBeNull();
  const recovered=recoverInvestigationSave("alice",JSON.parse(JSON.stringify({owner:"alice",command:investigationCommandToReconcile(unknown,"alice")})))!;
  const missed=settleInvestigationSave(recovered,"alice",{status:"not_found"});expect(investigationCommandToReconcile(missed,"alice")).toEqual(original);expect(retryInvestigationSave(missed,"alice")).toBeNull();
  const rpc=vi.fn(async()=>({data:receipt(original),error:null}));const found=await reconcileInvestigationOperation({rpc},investigationCommandToReconcile(missed,"alice"));expect(rpc.mock.calls[0]).toEqual(["reconcile_investigation_operation_v2",rpcArgs(original)]);expect(settleInvestigationSave(missed,"alice",found).phase).toBe("committed");
 });
 it("requires a same-principal exact no-effect fence before minting a new operation, with unchanged Plan",()=>{
  const c=command(),pending=beginInvestigationSave("alice",c,{phase:"idle"});
  for(const bad of [{status:"not_applied",id,operation_id:rid},{status:"not_applied",id:rid,operation_id:op},{status:"not_found"},{status:"not_applied",id,operation_id:op,reason:"unknown"}])expect(retryInvestigationSave(settleInvestigationSave(pending,"alice",bad),"alice")).toBeNull();
  const fenced=settleInvestigationSave(pending,"alice",{status:"not_applied",id,operation_id:op});expect(retryInvestigationSave(fenced,"bob")).toBeNull();const next=retryInvestigationSave(fenced,"alice")!;expect(next.operation_id).not.toBe(op);expect({...next,operation_id:op}).toEqual(c);expect(partitionInvestigationSave(pending,"bob")).toEqual({phase:"idle"});
 });
 it.each(["entry","quantity","side","research","source","terms"])("rejects a well-shaped receipt with changed %s rather than declaring the request committed",async field=>{
  const c=command(),r=receipt(c),p=r.manifest.option_plan!;
  if(field==="entry")p.legs[1].assumptions.entry!.premium_per_unit=1;
  if(field==="quantity")p.legs[0].assumptions.quantity=3;
  if(field==="side")p.legs[0].assumptions.side="sell";
  if(field==="research")p.research.thesis="changed";
  if(field==="source")p.legs[0].snapshot.sourceStale=false;
  if(field==="terms")p.legs[0].snapshot.identity.terms.multiplier=100;
  expect(matchesInvestigationCommand(r,c)).toBe(false);expect(settleInvestigationSave(beginInvestigationSave("alice",c,{phase:"idle"}),"alice",r).phase).toBe("uncertain");
  expect(await applyInvestigationRevision({rpc:async()=>({data:r,error:null})},c)).toEqual({status:"unavailable"});expect(digest(r.manifest)).not.toBe(digest(c.manifest));
 });
 it("reopens requested revision N exactly after N+1 without fresh source substitution",async()=>{
  const c=command(),r={...receipt(c),status:"found",current_revision:2,layouts:[]};const rpc=vi.fn(async()=>({data:r,error:null}));
  expect(await readInvestigation({rpc},id,1)).toEqual(r);expect(rpc.mock.calls[0]).toEqual(["read_investigation_v2",{p_id:id,p_revision:1}]);
  expect(await readInvestigation({rpc:async()=>({data:{...r,revision:2,sequence:2},error:null})},id,1)).toEqual({status:"unavailable"});
  const missing:Partial<typeof r>={...r};delete missing.revision_id;expect(await readInvestigation({rpc:async()=>({data:missing,error:null})},id,1)).toEqual({status:"unavailable"});
 });
 it("reads the exact original committed operation, and refuses a foreign operation",async()=>{
  const c=command(),r=receipt(c);expect(await readInvestigationOperation({rpc:async()=>({data:r,error:null})},op)).toEqual(r);
  expect(await readInvestigationOperation({rpc:async()=>({data:{...r,operation_id:rid},error:null})},op)).toEqual({status:"unavailable"});
 });
 it("Review creates a new exact whole-Plan manifest without mutating the opened revision",()=>{
  const a=manifest(),before=canonicalInvestigationJson(a),b=assessmentRevision(a,"inconclusive", "a".repeat(64),"Keep unknown terms");expect(canonicalInvestigationJson(a)).toBe(before);expect(b.option_plan).toEqual(a.option_plan);expect(b.option_plan).not.toBe(a.option_plan);expect(b.review).toEqual({assessment:"inconclusive",fire_event_id:"a".repeat(64),note:"Keep unknown terms"});expect(parseInvestigationCommand({...command(),action:"revise",expected_revision:1,manifest:b})?.manifest).toEqual(b);
 });
 it.each(["future","missing_relations","forged_contract","nonfinite","plan_in_v2"])("refuses %s before any native RPC",async defect=>{
  const c=command();if(defect==="future")c.manifest.schema="investigation_manifest.v99" as InvestigationManifest["schema"];if(defect==="missing_relations")delete c.manifest.argument_relations;if(defect==="forged_contract")c.manifest.option_plan!.legs[0].snapshot.identity.key="forged";if(defect==="nonfinite")c.manifest.option_plan!.legs[1].assumptions.entry!.premium_per_unit=Infinity;if(defect==="plan_in_v2")c.manifest.schema="investigation_manifest.v2";
  const rpc=vi.fn();expect(parseInvestigationCommand(c)).toBeNull();expect(validateStoredInvestigationManifest(c.manifest).ok).toBe(false);expect(await applyInvestigationRevision({rpc},c)).toEqual({status:"invalid_payload"});expect(rpc).not.toHaveBeenCalled();
 });
});
