import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {parseIntlEvidenceReference,validIntlManifestReferences,INTL_EVIDENCE_OWNER,INTL_EVIDENCE_TYPE,INTL_SUBJECT_OWNER} from "../investigationIntlReference";
import {validateInvestigationManifest,type InvestigationManifest,type InvestigationEvidenceRef} from "../investigationContracts";
import {INVESTIGATION_ADMISSION,parseInvestigationCommand} from "../investigations";
const reference=():InvestigationEvidenceRef=>({owner:INTL_EVIDENCE_OWNER,object_type:INTL_EVIDENCE_TYPE,object_id:"intl-workspace-context:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",mode:"pinned",version_ref:"im-workspace-generation:11111111-1111-4111-8111-111111111111",fingerprint:"a".repeat(64),selection:{field:"EZ.gdp_yoy"}});
const manifest=():InvestigationManifest=>{const ref=reference();return {schema:"investigation_manifest.v3",intent:{title:"Synthetic source-only selection",question:"An authored question, not public source data",subjects:[{owner:INTL_SUBJECT_OWNER,kind:"economy",object_id:ref.object_id}]},evidence_refs:[ref],review_baseline_ref:ref,layout_refs:[],thesis_refs:[],argument_relations:[],continuation:{}};};
describe("versioned International reference admission",()=>{
 it("admits v3 selected measures through the real command parser without treating shape as permission",()=>{
  const m=manifest();m.evidence_refs.push({...reference(),selection:{field:"EZ.cpi_yoy"}});
  expect(validateInvestigationManifest(m,INVESTIGATION_ADMISSION).ok).toBe(true);
  expect(parseInvestigationCommand({id:"10000000-0000-4000-8000-000000000001",operation_id:"10000000-0000-4000-8000-000000000002",expected_revision:0,action:"create",manifest:m})).not.toBeNull();
 });
 it.each(["fingerprint","selection","version_ref","object_id"])("requires %s on a full reference",field=>{const raw={...reference()} as Record<string,unknown>;delete raw[field];expect(parseIntlEvidenceReference(raw)).toBeNull();});
 it.each([{mode:"follow_head"},{owner:"earnings.workspace_generation"},{object_type:"event_workspace"},{fingerprint:"A".repeat(64)},{fingerprint:""},{selection:{field:"EZ.gdp_yoy",context:"invented"}},{object_id:"../escape"},{version_ref:"gen?principal=other"},{selection:{field:""}}])("refuses incompatible identity or envelope %j",change=>{expect(parseIntlEvidenceReference({...reference(),...change})).toBeNull();});
 it.each(["investigation_manifest.v1","investigation_manifest.v2"] as const)("does not silently widen %s",schema=>{const m=manifest();m.schema=schema;expect(validateInvestigationManifest(m,INVESTIGATION_ADMISSION).ok).toBe(false);});
 it.each(["object_id","version_ref","fingerprint"] as const)("refuses mixed selected-generation %s",field=>{const m=manifest(),next={...reference(),selection:{field:"EZ.cpi_yoy"}};next[field]=field==="fingerprint"?"b".repeat(64):"other";m.evidence_refs.push(next);expect(validIntlManifestReferences(m)).toBe(false);});
 it("rejects duplicate selected measures even with a purported new digest",()=>{const m=manifest();m.evidence_refs.push({...reference(),fingerprint:"b".repeat(64)});expect(validIntlManifestReferences(m)).toBe(false);});
 it.each([{owner:"terminal.analysis_symbol",kind:"security"},{owner:INTL_SUBJECT_OWNER,kind:"issuer"},{owner:INTL_SUBJECT_OWNER,kind:"economy",object_id:"other"},{owner:INTL_SUBJECT_OWNER,kind:"economy",version_ref:"other"}])("does not borrow a subject grant %j",change=>{const m=manifest();m.intent.subjects[0]={...m.intent.subjects[0],...change};expect(validateInvestigationManifest(m,INVESTIGATION_ADMISSION).ok).toBe(false);});
 it("rejects orphan context subjects and substituted baseline fields",()=>{const m=manifest();m.evidence_refs=[];delete m.review_baseline_ref;expect(validIntlManifestReferences(m)).toBe(false);const n=manifest();n.review_baseline_ref={...reference(),selection:{field:"EZ.policy_rate"}};expect(validIntlManifestReferences(n)).toBe(false);});
 it("retains existing relation endpoint identity without making fingerprint an authored endpoint field",()=>{const m=manifest(),ref={...reference()};delete ref.fingerprint;m.argument_relations=[{source:{kind:"evidence",...ref},target:{kind:"evidence",...ref},relation:"unresolved_interpretation",rationale:"Authored interpretation is not permission"}];expect(validateInvestigationManifest(m,INVESTIGATION_ADMISSION).ok).toBe(true);});
 it("preserves unrelated admitted v2 manifests",()=>{const m=manifest();m.schema="investigation_manifest.v2";m.intent.subjects=[{owner:"terminal.analysis_symbol",kind:"security",object_id:"AAPL"}];m.evidence_refs=[];delete m.review_baseline_ref;expect(validateInvestigationManifest(m,INVESTIGATION_ADMISSION).ok).toBe(true);});
 it("prepares a forward SQL source guarded by exact0043 preimage, with only narrow namespace and scope changes",()=>{
  const source=readFileSync(join(__dirname,"../../../supabase/migrations/0043_investigation_plan_composition.sql"),"utf8");
  const prepared=readFileSync(join(__dirname,"../../docs/verification/iw2-intl/selected-generation-admission.sql"),"utf8");
  const extract=(s:string)=>s.slice(s.indexOf("create or replace function public.valid_investigation_manifest_v2(m jsonb)"),s.indexOf("end $$;",s.indexOf("create or replace function public.valid_investigation_manifest_v2(m jsonb)"))+7);
  const old=extract(source),body=old.split("as $$")[1].slice(0,-3);
  expect(prepared).toContain(createHash("md5").update(body).digest("hex"));
  const restored=extract(prepared).replace(",\'intl_policy_comparison\'", "").replace(" or (r->>'owner'='intl.workspace_context' and r->>'kind'='economy')","").replace(" or (r->>'owner'='intl.workspace_generation' and r->>'object_type'='selected_generation')","").replace("return public.valid_investigation_intl_scope_v1(m);","return true;");
  expect(restored).toBe(old);expect(prepared).not.toMatch(/\bgrant\s+/i);expect(prepared).not.toMatch(/\b(create|alter)\s+table\b/i);
 });
});
