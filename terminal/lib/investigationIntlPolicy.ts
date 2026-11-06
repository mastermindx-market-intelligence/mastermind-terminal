import type {InvestigationManifest} from "./investigationContracts";
import {validIntlManifestReferences} from "./investigationIntlReference";
import type {PolicySettings,PolicyValidation} from "./intlPolicyPreviewSession";
export const INTL_POLICY_METHOD="intl-ecb-boe-nominal-policy-point-v1";
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v:unknown,max=256):v is string=>typeof v==="string"&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const day=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!v.startsWith("0000-")&&Number.isFinite(Date.parse(v+"T00:00:00.000Z"))&&new Date(v+"T00:00:00.000Z").toISOString().slice(0,10)===v;
/** Settings intent only: never a preview, source grant or evidence. Exact
 * periods stay day strings; no capture/observation clock is manufactured. */
export function validateIntlPolicySettings(raw:unknown):PolicyValidation{
 const error=(field:string,code:string):PolicyValidation=>({ok:false,errors:[{field,code}]});
 if(!exact(raw,["economy_a","economy_b","lens","definition","method_version","period","instrument_a_ref","instrument_b_ref","revision_policy"]))return error("settings","invalid_shape");
 if(typeof raw.economy_a!=="string"||!/^[A-Z]{2}$/.test(raw.economy_a))return error("economy_a","invalid_focus");
 if(typeof raw.economy_b!=="string"||!/^[A-Z]{2}$/.test(raw.economy_b))return error("economy_b","missing_comparator");
 if(raw.economy_a===raw.economy_b)return error("economy_b","same_economy");
 if(raw.lens!=="nominal_policy_point_gap"||raw.definition!=="absolute_gap_change_bp"||raw.method_version!==INTL_POLICY_METHOD)return error("lens","unsupported_method");
 if(raw.revision_policy!=="latest_vintage"&&raw.revision_policy!=="original_known")return error("revision_policy","unsupported_revision_policy");
 for(const k of ["instrument_a_ref","instrument_b_ref"])if(raw[k]!==null&&!text(raw[k]))return error(k,"invalid_instrument_reference");
 const p=raw.period;
 if(record(p)&&p.mode==="owner_horizon"){
  if(!exact(p,["mode","key"])||typeof p.key!=="string"||!/^[1-9][0-9]{0,2}[dwmy]$/.test(p.key))return error("period_key","invalid_horizon");
 }else if(record(p)&&p.mode==="fixed_dates"){
  if(!exact(p,["mode","start","end"])||!day(p.start))return error("period_start","invalid_date");
  if(!day(p.end))return error("period_end","invalid_date");
  if(p.start>=p.end)return error("period_end","date_order");
 }else return error("period_mode","invalid_period");
 return {ok:true,settings:structuredClone(raw) as PolicySettings};
}
/** The existing native revision/CAS owner performs the explicit Save. This
 * builder changes ONLY settings, preserving the whole question, focus, pins,
 * baseline and relations. A qualified numerical preview is not a prerequisite. */
export function intlPolicySettingsRevision(manifest:InvestigationManifest,settings:unknown,nativeMarket:string):InvestigationManifest|null{
 const checked=validateIntlPolicySettings(settings);
 if(!checked.ok||manifest.schema!=="investigation_manifest.v3"||!validIntlManifestReferences(manifest)
  ||!manifest.evidence_refs.some(r=>r.owner==="intl.workspace_generation")||checked.settings.economy_a!==nativeMarket)return null;
 return {...structuredClone(manifest),intl_policy_comparison:checked.settings};
}
/** A conditional inverse intent, not a rollback operation. The host must still
 * submit an explicit existing CAS command against this acknowledged revision. */
export function intlPolicySettingsUndo(current:{id:string;revision:number;manifest:InvestigationManifest},change:{id:string;savedRevision:number;before:InvestigationManifest;after:InvestigationManifest}):InvestigationManifest|null{
 if(current.id!==change.id||current.revision!==change.savedRevision||!same(current.manifest,change.after))return null;
 return structuredClone(change.before);
}
function same(a:unknown,b:unknown):boolean{
 if(a===b)return true;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
 if(!record(a)||!record(b))return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
}
