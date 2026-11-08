import "server-only";
import {parseIntlBaselineSelectors} from "./investigationIntlEntry";
import {qualifyIntlDraftSelection,resolveSavedIntlInvestigation,qualifyIntlManifestSave,type IntlAcknowledgedDetail} from "./investigationIntlOwner";
import {createIntlGenerationReads,type IntlGenerationCodec} from "./investigationIntlNativeReads";
import type {InvestigationCommand} from "./investigations";

/** Existing route handlers retain closed-mode admission, getUser, same-client
 * RLS detail read, private/no-store headers and original mutation ownership.
 * This factory holds functions only; every invocation creates fresh native
 * readers. No cross-account policy cache, route or authentication is added. */
export function createIntlInvestigationHandlers(codec:IntlGenerationCodec,options:{fetcher?:typeof fetch;base?:string}={}){
 const reads=(request:Request)=>createIntlGenerationReads(codec,{...options,signal:request.signal,
  lang:request.headers.get("Accept-Language")?.toLowerCase().startsWith("zh")?"zh":"en"});
 return {
  baseline:async(request:Request,principal:string)=>{
   const selection=parseIntlBaselineSelectors(new URL(request.url).searchParams);
   if(!selection)return {body:{status:"invalid_payload"},status:400};
   const body=await qualifyIntlDraftSelection(selection,principal,reads(request),request.signal);
   return {body,status:body.status==="international_baseline"?200:503};
  },
  review:async(request:Request,detail:IntlAcknowledgedDetail,principal:string)=>{
   const input=await resolveSavedIntlInvestigation(detail,principal,reads(request),request.signal);
   return {body:{status:"international",id:detail.id,revision:detail.revision,input},status:200};
  },
  newCommand:async(request:Request,command:InvestigationCommand,principal:string)=>{
   if(command.action!=="create"&&command.action!=="revise")return true;
   // A strict POST can still be a committed original retry. Its route maps a
   // false result to UNKNOWN/unavailable, never a new no-effect assertion.
   return qualifyIntlManifestSave(command.manifest,principal,reads(request),request.signal);
  },
 };
}
