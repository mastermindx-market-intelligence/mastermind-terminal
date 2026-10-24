import {describe,expect,it} from "vitest";
import plan from "./fixtures/options_plan_draft_v1.json";
import {canonicalInvestigationJson,validateInvestigationManifest,validateInvestigationManifestV3Draft as validateDraft,validateStoredInvestigationManifest} from "../investigationContracts";
import {validateOptionsPlanDraft} from "../optionsPlanDraft";
import {parseInvestigationCommand} from "../investigations";
import {beginInvestigationSave,recoverInvestigationSave} from "../investigationSave";
const base=()=>({schema:"investigation_manifest.v3",intent:{title:"Exact-contract Plan",question:"Keep source values and assumptions separate",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],argument_relations:[],continuation:{}});
const manifest=()=>({...base(),option_plan:structuredClone(plan)});
describe("dormant Investigation v3 Plan shape",()=>{
 it("retains the exact shared synthetic draft and detaches caller memory",()=>{
  expect(validateOptionsPlanDraft(plan).ok).toBe(true);const m=manifest();const got=validateDraft(m);expect(got).toEqual({ok:true,value:m});
  if(got.ok){m.option_plan.legs[0].assumptions.quantity=999;expect(got.value.option_plan?.legs[0].assumptions.quantity).toBe(2);expect(got.value.option_plan?.legs[0].assumptions.entry).toBeNull();expect(got.value.option_plan?.legs[1].assumptions.entry?.premium_per_unit).toBe(0);}
 });
 it("allows absent Plan but rejects null, unsupported inner version and unknown outer keys",()=>{
  expect(validateDraft(base()).ok).toBe(true);
  for(const m of [{...base(),option_plan:null},{...manifest(),option_plan:{...plan,schema:"options_plan_draft.v99"}},{...manifest(),hidden_owner:"alice"}])expect(validateDraft(m).ok).toBe(false);
 });
 it("does not widen v2 or rewrite stored legacy v2",()=>{
  expect(validateDraft({...manifest(),schema:"investigation_manifest.v2"}).ok).toBe(false);
  const m=base();const old={schema:m.schema,intent:m.intent,layout_refs:m.layout_refs,thesis_refs:m.thesis_refs,evidence_refs:m.evidence_refs,continuation:m.continuation};const v2={...old,schema:"investigation_manifest.v2"};expect(validateStoredInvestigationManifest(v2)).toEqual({ok:true,value:v2});expect(Object.hasOwn(v2,"argument_relations")).toBe(false);
 });
 it("requires current relation and timestamp rules",()=>{
  const m:Partial<ReturnType<typeof manifest>>=manifest();delete m.argument_relations;expect(validateDraft(m).ok).toBe(false);
  expect(validateDraft({...manifest(),intent:{...base().intent,research_as_of:"2026-10-23"}}).ok).toBe(false);
  expect(validateDraft({...manifest(),intent:{...base().intent,research_as_of:"2026-10-23T20:00:00.000Z"}}).ok).toBe(true);
 });
 it("preserves a separately typed Review without overwriting the Plan",()=>{
  const m={...manifest(),review:{assessment:"inconclusive",fire_event_id:"a".repeat(64),note:"Research observation"}};expect(validateDraft(m)).toEqual({ok:true,value:m});
  for(const review of [{assessment:"ready_to_trade"},{assessment:"confirmed",option_plan:plan},{assessment:"inconclusive",fire_event_id:"bad"}])expect(validateDraft({...manifest(),review}).ok).toBe(false);
 });
 it("includes every Plan value in canonical JSON",()=>{
  const a=manifest(),c=canonicalInvestigationJson(a);for(const mutate of [(m:typeof a)=>{m.option_plan.legs[1].assumptions.entry!.premium_per_unit=1;},(m:typeof a)=>{m.option_plan.legs[0].assumptions.quantity=3;},(m:typeof a)=>{m.option_plan.research.thesis="changed";},(m:typeof a)=>{m.option_plan.legs[0].snapshot.sourceStale=false;}]){const b=structuredClone(a);mutate(b);expect(canonicalInvestigationJson(b)).not.toBe(c);}expect(JSON.parse(c)).toEqual(a);
 });
 it("rejects forged identity and nonfinite assumptions",()=>{
  const a=manifest();a.option_plan.legs[0].snapshot.identity.key="forged";expect(validateDraft(a).ok).toBe(false);const b=manifest();b.option_plan.legs[1].assumptions.entry!.premium_per_unit=NaN;expect(validateDraft(b).ok).toBe(false);
 });
 it("keeps the existing outer byte ceiling and requires explicit evidence-owner admission",()=>{
  const evidence_refs=Array.from({length:110},(_,i)=>({owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:"🧠".repeat(240)+i,mode:"pinned",version_ref:"v".repeat(256)}));
  const huge=validateDraft({...manifest(),evidence_refs},{evidence:[{owner:"earnings.workspace_generation",object_types:["event_workspace"]}]});expect(huge.ok).toBe(false);if(!huge.ok)expect(huge.errors).toContainEqual({path:"$",code:"manifest_too_large"});
  const ref={owner:"terminal.options_exposure",object_type:"exposure_chart_request",object_id:"snapshot-one",mode:"pinned",version_ref:"retained-one"};
  expect(validateDraft({...manifest(),evidence_refs:[ref]}).ok).toBe(false);
  expect(validateDraft({...manifest(),evidence_refs:[ref]},{evidence:[{owner:"terminal.options_exposure",object_types:["exposure_chart_request"]}]}).ok).toBe(true);
 });
 it("leaves v3 command, new save and recovered outbox transport unadmitted",()=>{
  const c={id:"11111111-1111-4111-8111-111111111111",operation_id:"22222222-2222-4222-8222-222222222222",expected_revision:0,action:"create",manifest:manifest()};expect(validateInvestigationManifest(c.manifest).ok).toBe(false);expect(validateStoredInvestigationManifest(c.manifest).ok).toBe(false);expect(parseInvestigationCommand(c)).toBeNull();expect(beginInvestigationSave("alice",c,{phase:"idle"})).toEqual({phase:"idle"});expect(recoverInvestigationSave("alice",{owner:"alice",phase:"uncertain",command:c})).toBeNull();
 });
});
