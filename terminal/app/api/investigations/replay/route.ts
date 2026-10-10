import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {R2_BASE} from "@/lib/upstreams";
import {readInvestigation,isInvestigationId,INVESTIGATION_ADMISSION,type InvestigationDb} from "@/lib/investigations";
import {validateStoredInvestigationManifest} from "@/lib/investigationContracts";
import {resolveRetainedEventWorkspaceAtCutoff,authorizeRetainedPublicEventContext,type EventWorkspaceReplayPolicy} from "@/lib/eventWorkspace";
import {resolveInvestigationIssuerReleaseAtCutoff} from "@/lib/investigationIssuerRelease";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const response=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store","Vary":"Cookie"}});

/** Read-only, exact saved-revision replay. This cannot advance a saved baseline,
 * run Brain, change layout state, or enable live subscriptions. */
export async function GET(request:Request){
 try{
  const db=await createClient(),{data:{user},error}=await db.auth.getUser();
  if(error||!user)return response({status:"unauthenticated"},401);
  const q=new URL(request.url).searchParams,keys=[...q.keys()],id=q.get("id"),revision=q.get("revision"),policy=q.get("policy"),cutoff=q.get("cutoff");
  if(keys.length!==4||new Set(keys).size!==4||keys.some(key=>!["id","revision","policy","cutoff"].includes(key))||!isInvestigationId(id)||!revision||!/^[1-9][0-9]{0,9}$/.test(revision)||Number(revision)>2147483647||!policy||!["platform_snapshot","public_known","user_seen"].includes(policy)||!cutoff||cutoff.length>64)return response({status:"invalid_payload"},400);
  const saved=await readInvestigation(db as unknown as InvestigationDb,id,Number(revision));
  if(saved.status!=="found")return response({status:saved.status==="not_found"?"not_found":"unavailable"},saved.status==="not_found"?404:503);
  const manifest=validateStoredInvestigationManifest("manifest" in saved?saved.manifest:null,INVESTIGATION_ADMISSION);
  if(!manifest.ok)return response({status:"unavailable"},503);
  const ref=manifest.value.review_baseline_ref,issuers=manifest.value.intent.subjects.filter(s=>s.owner==="data_os.security_master"&&s.kind==="issuer");
  if(!ref||ref.owner!=="earnings.workspace_generation"||ref.object_type!=="event_workspace"||ref.mode!=="pinned"||!ref.version_ref||!ref.fingerprint||issuers.length!==1)return response({status:"unavailable"},503);
  if(ref.selection?.field==="issuer_release"){
   const result=await resolveInvestigationIssuerReleaseAtCutoff({event_id:ref.object_id,generation_id:ref.version_ref,company_id:issuers[0].object_id,fingerprint:ref.fingerprint},{policy:policy as EventWorkspaceReplayPolicy,cutoff},R2_BASE,{signal:request.signal});
   if(!result.ok)return response(result,result.reason==="unsupported_policy"?422:result.reason==="invalid_reference"?400:503);
   return response({status:"replayed",id,revision:Number(revision),root_fingerprint:ref.fingerprint,...result});
  }
  const result=await resolveRetainedEventWorkspaceAtCutoff({event_id:ref.object_id,generation_id:ref.version_ref,company_id:issuers[0].object_id,fingerprint:ref.fingerprint},{policy:policy as EventWorkspaceReplayPolicy,cutoff},R2_BASE,{signal:request.signal,authorize:workspace=>authorizeRetainedPublicEventContext(workspace,R2_BASE,request.signal)});
  if(!result.ok)return response(result,result.reason==="unsupported_policy"?422:result.reason==="invalid_reference"?400:503);
  return response({status:"replayed",id,revision:Number(revision),root_fingerprint:ref.fingerprint,...result});
 }catch{return response({status:"unavailable"},503);}
}
