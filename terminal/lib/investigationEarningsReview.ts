import type {RetainedEventWorkspaceResult} from "./eventWorkspace";
import {canonicalJson} from "./workspaceLayout";
import {reviewEvidence,type EvidenceCensus,type EvidenceObservation,type EvidenceReview} from "./investigationEvidenceDiff";

/** Compare admitted observations from the existing Earnings owner. Its generation schema
 * does not promise a complete evidence census or publish tombstones. Missing normalized
 * rows therefore remain not_observed, even when a generation's lifecycle says complete.
 * This adapter neither fetches nor grants rights; callers use fresh retained-owner reads. */
function project(result:Extract<RetainedEventWorkspaceResult,{ok:true}>):EvidenceCensus {
 const w=result.workspace;
 const qualification=(value:unknown)=>canonicalJson(value);
 const items:EvidenceObservation[]=[];
 const add=(id:string,content:unknown,qual:unknown,availability:EvidenceObservation["availability"],interpretation:EvidenceObservation["interpretation"] = null,excluded=false,correction=false)=>{
  items.push({id,contentIdentity:content===null?null:canonicalJson(content),qualificationIdentity:qualification(qual),availability,excluded,correction,interpretation});
 };
 for(const [kind,coverage] of Object.entries(w.completeness)){
  const availability:EvidenceObservation["availability"]=coverage.status==="unlicensed"?"denied":coverage.status==="absent"?"not_applicable":["present","bound"].includes(coverage.status)?"available":"unavailable";
  add(`coverage:${kind}`,{document_id:coverage.document_id??null,filing_key:coverage.filing_key??null},coverage,availability,null,coverage.typed_absence?.reason==="superseded_by_duplicate");
 }
 for(const source of w.sources){
  add(`source:${source.kind}:${source.document_id??"unidentified"}`,source.source_sha256,{receipt_state:source.receipt_state,join_status:source.join_status,typed_absence:source.typed_absence,rights_profile:source.source_clock?.rights_profile??null},source.receipt_state==="byte_replayed"?"available":"unavailable",null,source.typed_absence?.reason==="superseded_by_duplicate");
 }
 for(const fact of w.facts){
  add(`fact:${fact.fact_id}`,{metric:fact.metric,value:fact.value,unit:fact.unit,period:fact.period,basis:fact.basis,source_sha256:fact.source_span?.receipt?.source_sha256??null},
   {absence:fact.typed_absence,receipt_state:fact.source_span?.receipt_state??null,rights_profile:fact.source_span?.rights_profile??null},
   fact.value!==null&&fact.source_span?.receipt_state==="byte_replayed"?"available":"unavailable",
   {value:fact.value,unit:fact.unit,basis:fact.basis,cohort:fact.period},fact.typed_absence?.reason==="superseded_by_duplicate");
 }
 for(const claim of w.claims){
  add(`claim:${claim.claim_id}`,{text:claim.text,kind:claim.kind,metric:claim.metric,speaker:claim.speaker,role:claim.role,source_sha256:claim.source_span?.receipt?.source_sha256??null},
   {absence:claim.typed_absence,receipt_state:claim.source_span?.receipt_state??null,rights_profile:claim.source_span?.rights_profile??null},claim.source_span?.receipt_state==="byte_replayed"?"available":"unavailable",null,claim.typed_absence?.reason==="superseded_by_duplicate");
 }
 // Guidance and deltas are compared as exact owner fields. No new calculator or inferred
 // value is introduced, and no array absence is promoted to global source removal.
 add("owner:qualification",w.schema,{warnings:w.warnings,lifecycle:w.lifecycle.state},"available",null,false,w.lifecycle.state==="corrected");
 add("owner:guidance",w.guidance,null,"available");add("owner:deltas",w.deltas,null,"available");
 return {scope:{owner:"earnings.workspace_generation",query:w.event_id,cohort:w.issuer.company_id,temporalPolicy:"platform-known-owner-generation"},read:"ok",membership:"unknown",generation:w.generation_id,items,tombstones:[]};
}
function bound(result:Extract<RetainedEventWorkspaceResult,{ok:true}>):boolean {
 const {workspace:w,receipt:r}=result;
 return r.rights.allowed===true&&r.owner==="earnings.workspace_generation"&&r.company_id===w.issuer.company_id&&r.event_id===w.event_id&&r.generation_id===w.generation_id&&r.workspace_schema===w.schema&&r.authority===w.authority;
}
export type EarningsEvidenceReview={review:EvidenceReview;coverage:"observed_owner_rows_only";removalProofAvailable:false};
export function reviewRetainedEarnings(prior:RetainedEventWorkspaceResult,current:RetainedEventWorkspaceResult):EarningsEvidenceReview {
 const unavailable=(summary:EvidenceReview["summary"]):EarningsEvidenceReview=>({review:{schema:"investigation.evidence_review.v1",priorGeneration:"",currentGeneration:"",summary,items:[]},coverage:"observed_owner_rows_only",removalProofAvailable:false});
 if(!prior.ok||!current.ok)return unavailable((!prior.ok&&prior.reason==="denied")||(!current.ok&&current.reason==="denied")?"denied":"unavailable");
 if(!bound(prior)||!bound(current))return unavailable("unavailable");
 try{return {review:reviewEvidence(project(prior),project(current)),coverage:"observed_owner_rows_only",removalProofAvailable:false};}
 catch{return unavailable("invalid");}
}
