import {describe,expect,it} from "vitest";
import actual from "./fixtures/intl_policy_actual_20261104/comparison.json";
import {createPolicyPreviewSession,updatePolicyDraft,updatePolicyBinding,beginPolicyPreview,receivePublishedPolicyPreview,reviewPolicyDraft,type PolicySettings,type PreviewBinding} from "../intlPolicyPreviewSession";
// Actual retained Python comparison inside a SYNTHETIC publication envelope,
// binding and digest. This proves native projection, not emitted feed/auth/Saved.
const settings:PolicySettings={economy_a:"EZ",economy_b:"GB",lens:"nominal_policy_point_gap",definition:"absolute_gap_change_bp",method_version:actual.identity.method_version,period:{mode:"fixed_dates",start:"2026-08-28",end:"2026-09-30"},instrument_a_ref:null,instrument_b_ref:null,revision_policy:"latest_vintage"};
const binding:PreviewBinding={principal_partition:"synthetic-private-owner",auth_epoch:"epoch-1",saved_id:"synthetic-saved",saved_revision:7,source_generation:actual.identity.identity.source_generation,instrument_mapping_identity:null,qualification_identity:null};
const pin={generation:binding.source_generation!,fingerprint:"a".repeat(64)};
const setup=()=>beginPolicyPreview(updatePolicyDraft(createPolicyPreviewSession(binding),{ok:true,settings}));
const reply=()=>({schema:"intl.policy_preview.v1",state:"qualified",source_generation:pin.generation,artifact_sha256:pin.fingerprint,mapping_identity:"synthetic:actual-response-mapping",qualification_identity:"synthetic:actual-response-qualification",result:structuredClone(actual)});
describe("atomic native policy-preview source identity adoption",()=>{
 it("projects the real unchanged Python numbers only onto the original private pending ticket",()=>{
  const {state,ticket}=setup(),raw=reply(),before=structuredClone(raw);const accepted=receivePublishedPolicyPreview(state,ticket!,pin,raw);
  expect(accepted.pending).toBeNull();expect(accepted.preview).toMatchObject({state:"qualified",signed_start_bp:-150,signed_end_bp:-125,signed_change_bp:25,absolute_change_bp:-25,direction:"narrowed",crosses_zero:false});
  expect(accepted.binding).toEqual({...binding,instrument_mapping_identity:raw.mapping_identity,qualification_identity:raw.qualification_identity});expect(accepted.preview?.identity.settings).toEqual(settings);expect(raw).toEqual(before);expect(state.binding).toEqual(binding);expect(accepted.sequence).toBe(state.sequence);
  expect(reviewPolicyDraft(accepted).review).toEqual({binding:{principal_partition:binding.principal_partition,auth_epoch:binding.auth_epoch,saved_id:binding.saved_id,saved_revision:7},settings});
 });
 it.each(["principal_partition","auth_epoch","saved_id","saved_revision"] as const)("cannot adopt a response after private %s changes",field=>{
  const {state,ticket}=setup();const changed=updatePolicyBinding(state,{...state.binding,[field]:field==="saved_revision"?8:"changed-private-scope"});expect(receivePublishedPolicyPreview(changed,ticket!,pin,reply())).toBe(changed);
 });
 it("does not resurrect a response through draft A-B-A, out-of-order requests or duplicate delivery",()=>{
  const {state,ticket}=setup();const a=updatePolicyDraft(updatePolicyDraft(state,{ok:true,settings:{...settings,economy_b:"JP"}}),{ok:true,settings});expect(receivePublishedPolicyPreview(a,ticket!,pin,reply())).toBe(a);
  const newer=beginPolicyPreview(state);expect(receivePublishedPolicyPreview(newer.state,ticket!,pin,reply())).toBe(newer.state);const accepted=receivePublishedPolicyPreview(state,ticket!,pin,reply());expect(receivePublishedPolicyPreview(accepted,ticket!,pin,reply())).toBe(accepted);
 });
 it.each([{source_generation:"other"},{artifact_sha256:"b".repeat(64)},{state:"unavailable"},{schema:"wrong"},{mapping_identity:null},{qualification_identity:null}])("does not adopt a mismatched/malformed qualified envelope %j",change=>{
  const {state,ticket}=setup(),next=receivePublishedPolicyPreview(state,ticket!,pin,{...reply(),...change});expect(next.preview?.state).toBe("unavailable");expect(next.binding).toEqual(binding);
 });
 it.each(["economy_a","economy_b","method_version","vintage_policy"])("refuses a different comparator intent %s",field=>{
  const {state,ticket}=setup(),raw=reply();(raw.result.identity as Record<string,unknown>)[field]="substituted";const next=receivePublishedPolicyPreview(state,ticket!,pin,raw);expect(next.preview?.state).toBe("unavailable");expect(next.binding).toEqual(binding);
 });
 it("does not import server-supplied private identity or endpoint-date substitution",()=>{
  const {state,ticket}=setup(),raw=reply();(raw.result.identity.identity as Record<string,unknown>).principal_partition="foreign";expect(receivePublishedPolicyPreview(state,ticket!,pin,raw).preview?.state).toBe("unavailable");const next=reply();next.result.evidence_refs[0].observation_at="2026-08-27";expect(receivePublishedPolicyPreview(state,ticket!,pin,next).preview?.state).toBe("unavailable");
 });
 it("accepts only finite unchanged engine numbers, complete slots and exact envelope keys",()=>{
  const {state,ticket}=setup();for(const change of [(raw:ReturnType<typeof reply>)=>{raw.result.signed_end_bp=Infinity;},(raw:ReturnType<typeof reply>)=>{raw.result.evidence_refs.pop();},(raw:ReturnType<typeof reply>)=>{raw.result.evidence_refs[1].slot="a_start";},(raw:ReturnType<typeof reply>)=>{(raw as Record<string,unknown>).principal="invented";}]){const raw=reply();change(raw);const next=receivePublishedPolicyPreview(state,ticket!,pin,raw);expect(next.preview?.state).toBe("unavailable");expect(next.binding).toEqual(binding);}
 });
 it("keeps missing qualification unavailable and settings reviewable without inventing source IDs",()=>{
  const {state,ticket}=setup();const next=receivePublishedPolicyPreview(state,ticket!,pin,{...reply(),state:"unavailable",mapping_identity:null,qualification_identity:null,result:{state:"unavailable",reasons:["original_known_unavailable"],missing_refs:[]}});expect(next.preview?.state).toBe("unavailable");expect(next.binding).toEqual(binding);expect(reviewPolicyDraft(next).review?.settings).toEqual(settings);
 });
});
