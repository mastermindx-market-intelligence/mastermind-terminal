import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isDocId, isUuid } from "./readingContracts";

const PRIVATE = { "Cache-Control":"private, no-store", Vary:"Cookie", "X-Robots-Tag":"noindex,noarchive", "X-Content-Type-Options":"nosniff" };
const fail = (status:number,error:string,retryAfter?:string) => Response.json({error},{status,headers:{...PRIVATE,...(retryAfter?{"Retry-After":retryAfter}:{})}});
const PDF_LIMIT = 32 * 1024 * 1024;
/** Deliberate CURRENT original only. This does not claim historical PDF custody. */
export async function proxyCurrentResearchPdf(request:Request,docId:string):Promise<Response> {
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let stop=()=>{};
 const boundary=new Promise<never>((_resolve,reject)=>{stop=()=>{controller.abort();reject(Error("source stopped"));};request.signal.addEventListener("abort",stop,{once:true});timer=setTimeout(stop,12000);});
 try {
  if(request.signal.aborted)throw Error("source stopped");
  return await Promise.race([boundary,readCurrentOriginal(request,docId,controller)]);
 }catch{return fail(502,"research_source_unavailable");}
 finally{clearTimeout(timer);request.signal.removeEventListener("abort",stop);controller.abort();}
}
async function readCurrentOriginal(request:Request,docId:string,controller:AbortController):Promise<Response> {
 if(!isDocId(docId)||new URL(request.url).search)return fail(400,"invalid_request");
 let bearer:string;
 try {
  const supabase=await createClient(),verified=await supabase.auth.getUser();
  if(verified.error){const missing=verified.error.name==="AuthSessionMissingError"||[401,403].includes(verified.error.status??0);return fail(missing?401:503,missing?"unauthenticated":"account_service_unavailable");}
  if(!verified.data.user||!isUuid(verified.data.user.id))return fail(401,"unauthenticated");
  const current=await supabase.auth.getSession();
  if(current.error)return fail(503,"account_service_unavailable");
  const session=current.data.session;
  if(!session||session.user.id!==verified.data.user.id||!session.access_token)return fail(401,"unauthenticated");
  bearer=session.access_token;
 }catch{return fail(503,"account_service_unavailable");}
 let base:URL;
 try {
  base=new URL(process.env.BRAIN_GATEWAY_URL||"https://www.mastermind-x.com");
  if(base.username||base.password||base.pathname!=="/"||base.search||base.hash||!(base.protocol==="https:"||base.protocol==="http:"&&["localhost","127.0.0.1"].includes(base.hostname)))throw Error("invalid base");
 }catch{return fail(503,"research_source_unavailable");}
 if(controller.signal.aborted)throw Error("source stopped");
   const response=await fetch(new URL(`/api/research/view/${docId}`,base),{headers:{Authorization:`Bearer ${bearer}`,Accept:"application/pdf"},cache:"no-store",redirect:"error",signal:controller.signal});
   if(response.redirected||response.status>=300&&response.status<400)return fail(502,"research_source_unavailable");
   const rawRetry=response.headers.get("retry-after"),retry=rawRetry&&/^\d+$/.test(rawRetry)&&Number(rawRetry)<=86400?rawRetry:undefined;
   if(!response.ok)return fail(response.status,response.status===402||response.status===403?"paid_required":response.status===401?"unauthenticated":response.status===429?"rate_limited":"research_source_unavailable",retry);
   if(!response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")||!response.body)return fail(502,"research_source_unavailable");
   const length=response.headers.get("content-length");if(length&&Number(length)>PDF_LIMIT)return fail(502,"research_source_unavailable");
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
   try {while(true){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>PDF_LIMIT){await reader.cancel();return fail(502,"research_source_unavailable");}chunks.push(chunk.value);}}finally{reader.releaseLock();}
   const body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
   // Content-type alone is insufficient: HTML under a PDF media type is refused.
   if(new TextDecoder().decode(body.subarray(0,5))!=="%PDF-")return fail(502,"research_source_unavailable");
   return new Response(body,{headers:{...PRIVATE,"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${docId}.pdf"`}});

}
