import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {readInvestigation,isInvestigationId,INVESTIGATION_ADMISSION,type InvestigationDb} from "@/lib/investigations";
import {validateInvestigationManifest} from "@/lib/investigationContracts";
import {readThesisVersion,type ThesisDb} from "@/lib/theses";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const response=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store","Vary":"Cookie"}});

/** References come only from the authenticated saved revision. The Thesis owner
 * applies current RLS to each exact tuple. This endpoint has no write path. */
export async function GET(request:Request){
 try{
  const db=await createClient(),{data:{user},error}=await db.auth.getUser();
  if(error||!user)return response({status:"unauthenticated"},401);
  const q=new URL(request.url).searchParams,keys=[...q.keys()],id=q.get("id"),revision=q.get("revision");
  if(keys.length!==2||new Set(keys).size!==2||keys.some(key=>!["id","revision"].includes(key))||!isInvestigationId(id)||!revision||!/^[1-9][0-9]{0,9}$/.test(revision)||Number(revision)>2147483647)return response({status:"invalid_payload"},400);
  const saved=await readInvestigation(db as unknown as InvestigationDb,id,Number(revision));
  if(saved.status!=="found")return response({status:saved.status==="not_found"?"not_found":"unavailable"},saved.status==="not_found"?404:503);
  const manifest=validateInvestigationManifest("manifest" in saved?saved.manifest:null,INVESTIGATION_ADMISSION);
  if(!manifest.ok)return response({status:"unavailable"},503);
  const items=await Promise.all(manifest.value.thesis_refs.map(async ref=>{
   const result=await readThesisVersion(db as unknown as ThesisDb,user.id,ref.thesis_id,ref.version_id);
   return result.ok?{ref,status:"available" as const,version:result.version}:{ref,status:"unavailable" as const};
  }));
  return response({status:"resolved",id,revision:Number(revision),items});
 }catch{return response({status:"unavailable"},503);}
}
