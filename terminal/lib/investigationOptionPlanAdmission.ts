/** Local draft admission only. No Save, store, id, clock, calculation or authority. */
import {validateOptionsPlanDraft, type OptionsPlanDraft} from "./optionsPlanDraft";
import {duplicateGuard, type DuplicateGuard} from "./investigationDuplicate";
import type {AuthLifecycleSnapshot} from "./supabase/authLifecycle";

export type InvestigationOptionPlanAdmission =
  | {ok:true; plan:OptionsPlanDraft; guard:Readonly<DuplicateGuard>}
  | {ok:false; reason:"locked"|"not_new_draft"|"auth"|"account"|"invalid_plan"};

export function admitInvestigationOptionPlan(input:{
  ownerKey:string; snapshot:AuthLifecycleSnapshot|null; locked:boolean; fresh:boolean; candidate:unknown;
}):InvestigationOptionPlanAdmission {
  if(input.locked)return {ok:false,reason:"locked"};
  if(!input.fresh)return {ok:false,reason:"not_new_draft"};
  if(!input.ownerKey||input.ownerKey==="local-preview")return {ok:false,reason:"auth"};
  const guard=duplicateGuard(input.ownerKey,input.snapshot);
  if(!guard)return {ok:false,reason:input.snapshot?.principal_partition&&input.snapshot.principal_partition!==input.ownerKey?"account":"auth"};
  const checked=validateOptionsPlanDraft(input.candidate);
  if(!checked.ok)return {ok:false,reason:"invalid_plan"};
  return {ok:true,plan:checked.value,guard:Object.freeze(guard)};
}
