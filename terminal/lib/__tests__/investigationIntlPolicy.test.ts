import {describe,expect,it} from "vitest";
import {INTL_POLICY_METHOD,validateIntlPolicySettings,intlPolicySettingsRevision,intlPolicySettingsUndo} from "../investigationIntlPolicy";
import {validateInvestigationManifest,type InvestigationManifest} from "../investigationContracts";
import {INVESTIGATION_ADMISSION,parseInvestigationCommand} from "../investigations";
const settings=()=>({economy_a:"EZ",economy_b:"GB",lens:"nominal_policy_point_gap",definition:"absolute_gap_change_bp",method_version:INTL_POLICY_METHOD,period:{mode:"fixed_dates",start:"2026-08-28",end:"2026-09-30"},instrument_a_ref:null,instrument_b_ref:null,revision_policy:"latest_vintage"});
function manifest():InvestigationManifest{
 const context="intl-workspace-context:sha256:"+"c".repeat(64),ref={owner:"intl.workspace_generation",object_type:"selected_generation",object_id:context,mode:"pinned" as const,version_ref:"im-workspace-generation:11111111-1111-4111-8111-111111111111",fingerprint:"a".repeat(64),selection:{field:"EZ.policy_rate"}};
 return {schema:"investigation_manifest.v3",intent:{title:"Exact prior title",question:"  Whole authored question preserved  ",subjects:[{owner:"intl.workspace_context",kind:"economy",object_id:context}]},evidence_refs:[ref],review_baseline_ref:ref,layout_refs:[],thesis_refs:[],argument_relations:[],continuation:{next_question:"Kept next question"}};
}
describe("same native Investigation settings intent",()=>{
 it("admits exact nine-key settings in v3 and the existing explicit command, without a numerical preview",()=>{
  const before=manifest(),snapshot=structuredClone(before),raw=settings(),next=intlPolicySettingsRevision(before,raw,"EZ");expect(next).not.toBeNull();expect(validateInvestigationManifest(next,INVESTIGATION_ADMISSION).ok).toBe(true);
  expect(parseInvestigationCommand({id:"50000000-0000-4000-8000-000000000001",operation_id:"50000000-0000-4000-8000-000000000002",action:"revise",expected_revision:7,manifest:next})).not.toBeNull();
  expect(before).toEqual(snapshot);expect({...next,intl_policy_comparison:undefined}).toEqual({...before,intl_policy_comparison:undefined});raw.economy_b="JP";expect(next!.intl_policy_comparison?.economy_b).toBe("GB");expect(next).not.toHaveProperty("preview");
 });
 it.each([{economy_b:"EZ"},{economy_b:""},{method_version:"invented"},{lens:"real_rate"},{revision_policy:"unrevised"},{instrument_a_ref:4},{period:{mode:"fixed_dates",start:"2026-02-30",end:"2026-03-31"}},{period:{mode:"fixed_dates",start:"0000-01-01",end:"2026-03-31"}},{period:{mode:"fixed_dates",start:"2026-10-01",end:"2026-09-30"}},{period:{mode:"owner_horizon",key:""}},{result:{value:1.7}}])("rejects malformed/mis-scoped settings %j",change=>{expect(validateIntlPolicySettings({...settings(),...change}).ok).toBe(false);expect(intlPolicySettingsRevision(manifest(),{...settings(),...change},"EZ")).toBeNull();});
 it("preserves day precision and supports declared owner-horizon intent without inventing covered observations",()=>{
  const raw={...settings(),period:{mode:"owner_horizon",key:"3m"},revision_policy:"original_known"};expect(validateIntlPolicySettings(raw)).toEqual({ok:true,settings:raw});expect(intlPolicySettingsRevision(manifest(),raw,"EZ")).not.toBeNull();
 });
 it("refuses focus replacement, unrelated manifests and v1/v2 widening",()=>{
  expect(intlPolicySettingsRevision(manifest(),settings(),"GB")).toBeNull();for(const schema of ["investigation_manifest.v1","investigation_manifest.v2"] as const){const m={...manifest(),schema,intl_policy_comparison:settings()};expect(validateInvestigationManifest(m,INVESTIGATION_ADMISSION).ok).toBe(false);}
  const m=manifest();m.evidence_refs=[];m.intent.subjects=[];delete m.review_baseline_ref;expect(validateInvestigationManifest({...m,intl_policy_comparison:settings()},INVESTIGATION_ADMISSION).ok).toBe(false);
 });
 it("conditions Undo on the exact acknowledged revision and whole unchanged after-manifest",()=>{
  const before=manifest(),after=intlPolicySettingsRevision(before,settings(),"EZ")!,change={id:"saved-A",savedRevision:8,before,after},current={id:"saved-A",revision:8,manifest:after};
  expect(intlPolicySettingsUndo(current,change)).toEqual(before);expect(intlPolicySettingsUndo({...current,id:"saved-B"},change)).toBeNull();expect(intlPolicySettingsUndo({...current,revision:9},change)).toBeNull();
  const changed=structuredClone(after);changed.intent.question="Newer authored question";expect(intlPolicySettingsUndo({...current,manifest:changed},change)).toBeNull();expect(after.intl_policy_comparison).toEqual(settings());
 });
});
