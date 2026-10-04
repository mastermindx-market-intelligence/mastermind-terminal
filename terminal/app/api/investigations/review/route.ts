import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {R2_BASE} from "@/lib/upstreams";
import {readInvestigation,isInvestigationId,INVESTIGATION_ADMISSION,type InvestigationDb} from "@/lib/investigations";
import {validateInvestigationManifest} from "@/lib/investigationContracts";
import {resolveCurrentEventWorkspaceFromR2,resolveRetainedEventWorkspaceFromR2,authorizeRetainedPublicEventContext} from "@/lib/eventWorkspace";
import {reviewRetainedEarnings} from "@/lib/investigationEarningsReview";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const response=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store","Vary":"Cookie"}});
const unavailable=(reason:string)=>response({status:"unavailable",reason},503);

/** Read-only review of one saved revision. Baseline advancement remains an explicit
 * Investigation mutation through the existing expected-head/operation-receipt path. */
export async function GET(request:Request){
 try{
  const db=await createClient();const {data:{user},error}=await db.auth.getUser();
  if(error||!user)return response({status:"unauthenticated"},401);
  const query=new URL(request.url).searchParams,keys=[...query.keys()];
  const id=query.get("id"),revision=query.get("revision");
  if(keys.length!==2||new Set(keys).size!==2||keys.some(key=>!["id","revision"].includes(key))
   ||!isInvestigationId(id)||!revision||!/^[1-9][0-9]{0,9}$/.test(revision)||Number(revision)>2147483647)return response({status:"invalid_payload"},400);
  const saved=await readInvestigation(db as unknown as InvestigationDb,id,Number(revision));
  if(saved.status!=="found")return response({status:saved.status==="not_found"?"not_found":"unavailable"},saved.status==="not_found"?404:503);
  const manifest=validateInvestigationManifest("manifest" in saved?saved.manifest:null,INVESTIGATION_ADMISSION);
  if(!manifest.ok)return unavailable("invalid_saved_reference");
  const ref=manifest.value.review_baseline_ref;
  const issuers=manifest.value.intent.subjects.filter(subject=>subject.owner==="data_os.security_master"&&subject.kind==="issuer");
  if(!ref||ref.owner!=="earnings.workspace_generation"||ref.object_type!=="event_workspace"||ref.mode!=="pinned"||!ref.version_ref||!ref.fingerprint||issuers.length!==1)return unavailable("baseline_unavailable");
  const options={signal:request.signal,authorize:(workspace:Parameters<typeof authorizeRetainedPublicEventContext>[0])=>authorizeRetainedPublicEventContext(workspace,R2_BASE,request.signal)};
  const baseline=await resolveRetainedEventWorkspaceFromR2({event_id:ref.object_id,generation_id:ref.version_ref,company_id:issuers[0].object_id,fingerprint:ref.fingerprint},R2_BASE,options);
  if(!baseline.ok)return unavailable(baseline.reason==="denied"?"denied":"historical_unavailable");
  const listing=baseline.workspace.issuer.listings.find(item=>item.is_primary)??baseline.workspace.issuer.listings[0];
  if(!listing)return unavailable("current_owner_unavailable");
  const selected=await resolveCurrentEventWorkspaceFromR2(listing.ticker,R2_BASE,{signal:request.signal});
  if(!selected.ok||selected.state==="stale")return unavailable("current_owner_unavailable");
  if(selected.workspace.issuer.company_id!==baseline.workspace.issuer.company_id||selected.workspace.event_id!==baseline.workspace.event_id)return response({status:"scope_changed"});
  const current=await resolveRetainedEventWorkspaceFromR2({event_id:selected.workspace.event_id,generation_id:selected.workspace.generation_id,company_id:selected.workspace.issuer.company_id},R2_BASE,options);
  if(!current.ok)return unavailable(current.reason==="denied"?"denied":"current_owner_unavailable");
  const comparison=reviewRetainedEarnings(baseline,current);
  if(["invalid","unavailable","denied"].includes(comparison.review.summary))return unavailable(comparison.review.summary);
  return response({status:"reviewed",id,revision:Number(revision),baseline:baseline.receipt,current:current.receipt,...comparison});
 }catch{return unavailable("review_unavailable");}
}
