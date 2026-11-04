import "server-only";
import {INTL_EVIDENCE_OWNER,INTL_EVIDENCE_TYPE,INTL_SUBJECT_OWNER,parseIntlEvidenceReference,validIntlManifestReferences} from "./investigationIntlReference";
import type {IntlDraftSource,IntlEntrySelectors} from "./investigationIntlEntry";
import type {InvestigationManifest} from "./investigationContracts";
import type {IntlCallerInput,IntlResolvedPacket} from "./intlInvestigationCaller";
import {toIntlEvidenceCensus,type IntlExactContext,type IntlOwnerResult,type IntlOwnerObservation} from "./intlInvestigationEvidence";
import type {IntlCompositionOwnerInput} from "./intlInvestigationComposition";

/** Normalized output of the native public-generation reader, not its wire format.
 * Query, Saved clocks and principal are deliberately absent from public data. */
export type IntlPublicationPolicy={metadata:"allowed"|"unknown"|"denied";value_permission:"allowed"|"unknown"|"denied";policy_ref:string|null;policy_document_sha256:string|null;policy_identity:string|null};
export type IntlNativeObservation=Omit<IntlOwnerObservation,"interpretation">&{value:number|null;unit:string|null};
export const INTL_NATIVE_READ_POLICY="investigation.intl.current_publication_policy.v1";
const NATIVE_CONTEXT_FIELDS=["researchMarket","toolBindingVersion","periodIdentity","currencyBasis","returnBasis"] as const;
export type IntlNativeGeneration={
 object_id:string;generation:string;fingerprint:string;
 context:Pick<IntlExactContext,typeof NATIVE_CONTEXT_FIELDS[number]>;
 supportedMeasureIds:readonly string[];
 result:Pick<IntlOwnerResult,"read"|"membership"|"tombstones">&{observations:readonly IntlNativeObservation[]};
 publicationPolicies:Readonly<Record<string,IntlPublicationPolicy>>;
 display:Omit<IntlCompositionOwnerInput,"question"|"savedAt"|"updatedAt"|"rightsAt">;
 unmetPrerequisites:readonly string[];
};
export type IntlGenerationPin={object_id:string;generation:string;fingerprint:string};
export type IntlReadDecision={
 disposition:"allowed"|"denied"|"unavailable";
 principal:string;object_id:string;generation:string;fingerprint:string;
 selectedMeasureIds:readonly string[];
 // Actual native policy identity/decision clock, never source/publication clocks.
 policyRevision:string;checkedAt:string|null;
};
export type IntlNativeReads={
 retained:(pin:IntlGenerationPin)=>Promise<IntlNativeGeneration|null>;
 current:(objectId:string)=>Promise<IntlNativeGeneration|null>;
 authorize:(scope:{principal:string;selectedMeasureIds:readonly string[]},value:IntlNativeGeneration)=>Promise<IntlReadDecision>;
};
export type IntlAcknowledgedDetail={id:string;revision:number;committed_at:string;manifest:InvestigationManifest};
const sameList=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const identifier=(value:unknown)=>typeof value==="string"&&value.length>0;
const principalOk=(value:string)=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)&&value!=="00000000-0000-0000-0000-000000000000";

type Qualified={ok:true;prior:IntlNativeGeneration;current:IntlNativeGeneration}|{ok:false;disposition:"unauthenticated"|"unavailable"|"scope_changed"|"not_admitted"|"denied"};
async function qualifiedSelection(principal:string,pin:IntlGenerationPin,selectedMeasureIds:readonly string[],reads:IntlNativeReads,signal?:AbortSignal):Promise<Qualified>{
 if(!principalOk(principal))return {ok:false,disposition:"unauthenticated"};
 if(signal?.aborted)return {ok:false,disposition:"unavailable"};
 try{
  const prior=await reads.retained(pin);
  if(signal?.aborted||!prior)return {ok:false,disposition:"unavailable"};
  if(prior.object_id!==pin.object_id||prior.generation!==pin.generation||prior.fingerprint!==pin.fingerprint)return {ok:false,disposition:"scope_changed"};
  const current=await reads.current(pin.object_id);
  if(signal?.aborted||!current)return {ok:false,disposition:"unavailable"};
  if(current.object_id!==pin.object_id||NATIVE_CONTEXT_FIELDS.some(field=>current.context[field]!==prior.context[field]))return {ok:false,disposition:"scope_changed"};
  for(const value of [prior,current]){
   if(selectedMeasureIds.some(id=>!value.supportedMeasureIds.includes(id)))return {ok:false,disposition:"scope_changed"};
   const decision=await reads.authorize({principal,selectedMeasureIds:[...selectedMeasureIds]},value);
   if(signal?.aborted)return {ok:false,disposition:"unavailable"};
   if(decision.principal!==principal||decision.object_id!==value.object_id||decision.generation!==value.generation||decision.fingerprint!==value.fingerprint
    ||!sameList(decision.selectedMeasureIds,selectedMeasureIds)||!identifier(decision.policyRevision)
    ||(decision.checkedAt!==null&&!Number.isFinite(Date.parse(decision.checkedAt))))return {ok:false,disposition:"not_admitted"};
   if(decision.disposition!=="allowed")return {ok:false,disposition:decision.disposition==="denied"?"denied":"unavailable"};
  }
  return {ok:true,prior,current};
 }catch{return {ok:false,disposition:"unavailable"};}
}

/** Native authoring preflight: selectors identify reads, never permission. No
 * synthetic saved record/question or operation is needed to qualify references. */
export async function qualifyIntlDraftSelection(selection:IntlEntrySelectors,principal:string,reads:IntlNativeReads,signal?:AbortSignal):Promise<({status:"international_baseline"}&IntlDraftSource)|{status:"unavailable";reason:string}>{
 const refs=selection.fields.map(field=>parseIntlEvidenceReference({owner:INTL_EVIDENCE_OWNER,object_type:INTL_EVIDENCE_TYPE,object_id:selection.context,mode:"pinned",version_ref:selection.generation,fingerprint:selection.fingerprint,selection:{field}}));
 if(!refs.length||refs.length>128||refs.some(r=>!r)||new Set(selection.fields).size!==selection.fields.length)return {status:"unavailable",reason:"invalid"};
 const qualified=await qualifiedSelection(principal,{object_id:selection.context,generation:selection.generation,fingerprint:selection.fingerprint},selection.fields,reads,signal);
 if(!qualified.ok)return {status:"unavailable",reason:qualified.disposition};
 const admitted=refs.filter((r):r is NonNullable<typeof r>=>r!==null),native=qualified.prior.context;
 return {status:"international_baseline",refs:admitted,baseline:admitted[0],subject:{owner:INTL_SUBJECT_OWNER,kind:"economy",object_id:qualified.prior.object_id},
  context:{researchMarket:native.researchMarket,periodIdentity:native.periodIdentity,currencyBasis:native.currencyBasis,returnBasis:native.returnBasis}};
}

/** Source-use requalification for a NEW create/revise only. Caller must not run
 * it during PUT/legacy reconciliation or substitute a different operation. */
export async function qualifyIntlManifestSave(manifest:InvestigationManifest,principal:string,reads:IntlNativeReads,signal?:AbortSignal):Promise<boolean>{
 if(!validIntlManifestReferences(manifest))return false;
 const refs=manifest.evidence_refs.filter(ref=>ref.owner===INTL_EVIDENCE_OWNER);
 if(!refs.length)return true;
 const first=refs[0];return (await qualifiedSelection(principal,{object_id:first.object_id,generation:first.version_ref!,fingerprint:first.fingerprint!},refs.map(ref=>ref.selection!.field),reads,signal)).ok;
}

/** Server composition AFTER getUser and exact same-owner readInvestigation.
 * No request context, public query, write, baseline adoption or clock generation. */
export async function resolveSavedIntlInvestigation(detail:IntlAcknowledgedDetail,principal:string,reads:IntlNativeReads,signal?:AbortSignal):Promise<IntlCallerInput>{
 if(!principalOk(principal))return {disposition:"unauthenticated"};
 if(signal?.aborted)return {disposition:"unavailable"};
 const manifest=detail.manifest;
 if(!validIntlManifestReferences(manifest))return {disposition:"invalid"};
 const baseline=parseIntlEvidenceReference(manifest.review_baseline_ref);
 if(!baseline)return {disposition:"not_admitted"};
 const selectedMeasureIds=manifest.evidence_refs.filter(ref=>ref.owner===INTL_EVIDENCE_OWNER).map(ref=>ref.selection!.field);
 if(!selectedMeasureIds.length)return {disposition:"not_admitted"};
 const qualified=await qualifiedSelection(principal,{object_id:baseline.object_id,generation:baseline.version_ref!,fingerprint:baseline.fingerprint!},selectedMeasureIds,reads,signal);
 if(!qualified.ok)return {disposition:qualified.disposition};
 const {prior,current}=qualified;
 try{
  // The authenticated native owner supplies these caller fields explicitly.
  // Cohort is the real stable native context identity; this temporal policy
  // names the executable current-policy read contract, never a vendor grant.
  const callerContext={owner:INTL_EVIDENCE_OWNER,query:manifest.intent.question,cohort:prior.object_id,temporalPolicy:INTL_NATIVE_READ_POLICY};
  const exactContext:IntlExactContext={...current.context,...callerContext,selectedMeasureIds:[...selectedMeasureIds]};
  const project=(value:IntlNativeGeneration):IntlOwnerResult=>({...value.context,...callerContext,generation:value.generation,
   read:value.result.read,membership:value.result.membership,
   observations:value.result.observations.filter(row=>selectedMeasureIds.includes(row.id)).map(row=>({id:row.id,availability:row.availability,qualified:row.qualified,excluded:row.excluded,correction:row.correction,contentIdentity:row.contentIdentity,qualificationIdentity:row.qualificationIdentity,
    interpretation:row.value!==null&&row.unit!==null?{value:row.value,unit:row.unit,basis:value.context.currencyBasis,cohort:callerContext.cohort}:null})),tombstones:value.result.tombstones.filter(id=>selectedMeasureIds.includes(id))});
  const priorResult=project(prior),currentResult=project(current);
  for(const result of [priorResult,currentResult]){
   const safe=toIntlEvidenceCensus(result,exactContext);if(!safe.ok)return {disposition:"invalid"};
   result.observations=result.observations.map((row,i)=>({...row,availability:safe.census.items[i].availability,interpretation:safe.census.items[i].interpretation}));
  }
  const packet:IntlResolvedPacket={exactContext,prior:priorResult,current:currentResult,
   requirements:{requiredMeasureIds:[...selectedMeasureIds],unmetPrerequisites:[...current.unmetPrerequisites]},
   owner:{...current.display,question:manifest.intent.question,savedAt:detail.committed_at,updatedAt:null,rightsAt:null}};
  return {disposition:"resolved",...packet};
 }catch{return {disposition:"unavailable"};}
}
