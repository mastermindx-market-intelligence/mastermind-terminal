import {describe,expect,it,vi} from "vitest";
import fixture from "./fixtures/options_plan_draft_v1.json";
import {admitInvestigationOptionPlan} from "../investigationOptionPlanAdmission";
import type {AuthLifecycleSnapshot} from "../supabase/authLifecycle";

const ready:AuthLifecycleSnapshot={availability:"ready",principal_partition:"account-A",auth_epoch:"epoch-A"};
const input=()=>({ownerKey:"account-A",snapshot:ready,locked:false,fresh:true,candidate:structuredClone(fixture)});
describe("deliberate whole Plan admission to a new local draft",()=>{
 it("keeps exact source and authored values in a detached immutable Plan and owner guard",()=>{
  const raw=input(),before=structuredClone(raw.candidate),r=admitInvestigationOptionPlan(raw);
  expect(r.ok).toBe(true);if(!r.ok)return;
  expect(r.plan).toEqual(before);expect(r.plan).not.toBe(raw.candidate);
  expect(r.guard).toEqual({principal:"account-A",epoch:"epoch-A"});expect(Object.isFrozen(r.guard)).toBe(true);
  expect(Object.isFrozen(r.plan)).toBe(true);expect(Object.isFrozen(r.plan.legs[0].snapshot)).toBe(true);
  raw.candidate.research.thesis="later edit";raw.candidate.legs[0].assumptions.quantity=999;
  expect(r.plan).toEqual(before);expect(r.plan.legs[0].assumptions.entry).toBeNull();
  expect(r.plan.legs[1].assumptions.entry?.premium_per_unit).toBe(0);
 });
 it.each(["locked","not_new_draft"] as const)("refuses %s before touching candidate accessors",reason=>{
  const get=vi.fn(()=>fixture);const candidate=Object.defineProperty({},"schema",{get,enumerable:true});
  expect(admitInvestigationOptionPlan({...input(),candidate,locked:reason==="locked",fresh:reason!=="not_new_draft"})).toEqual({ok:false,reason});
  expect(get).not.toHaveBeenCalled();
 });
 it.each([null,...(["pending","unverified","unavailable"] as const).map(availability=>({...ready,availability})),{...ready,auth_epoch:""},{...ready,principal_partition:null}])("refuses an unready owner before candidate inspection: %j",snapshot=>{
  const get=vi.fn();const candidate=Object.defineProperty({},"schema",{get,enumerable:true});
  expect(admitInvestigationOptionPlan({...input(),snapshot,candidate})).toEqual({ok:false,reason:"auth"});expect(get).not.toHaveBeenCalled();
 });
 it("refuses another account and the anonymous preview carrier without inventing an epoch",()=>{
  expect(admitInvestigationOptionPlan({...input(),snapshot:{...ready,principal_partition:"account-B"}})).toEqual({ok:false,reason:"account"});
  expect(admitInvestigationOptionPlan({...input(),ownerKey:"local-preview",snapshot:null})).toEqual({ok:false,reason:"auth"});
 });
 it("uses the supplied ready epoch exactly; the Workspace separately fences old callbacks and Save",()=>{
  const r=admitInvestigationOptionPlan({...input(),snapshot:{...ready,auth_epoch:"epoch-B"}});
  expect(r.ok&&r.guard.epoch).toBe("epoch-B");
 });
 it.each([null,{...fixture,schema:"options_plan_draft.v99"},{...fixture,derived_payoff:10}])("refuses malformed or expanded payloads: %j",candidate=>{
  expect(admitInvestigationOptionPlan({...input(),candidate})).toEqual({ok:false,reason:"invalid_plan"});
 });
 it("rejects a data accessor without running it",()=>{
  const get=vi.fn(()=>"options_plan_draft.v1");const candidate={...fixture};
  Object.defineProperty(candidate,"schema",{get,enumerable:true});
  expect(admitInvestigationOptionPlan({...input(),candidate})).toEqual({ok:false,reason:"invalid_plan"});expect(get).not.toHaveBeenCalled();
 });
});
