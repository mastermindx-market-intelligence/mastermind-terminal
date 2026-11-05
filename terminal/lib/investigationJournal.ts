/** Compatibility for the EXISTING Investigation draft buffer, not a new store.
 * Production Workspace receives raw claims.sub; shell surfaces use account:<uuid>.
 * Inspect both before any new intent. Never migrate, overwrite, select between
 * different operations, or replay a mutation during recovery.
 */
import { ownerKeyFor, ownerUserId } from "./accountIdentity";
import { isInvestigationId, type InvestigationCommand } from "./investigations";
import { parseScenarioCapture } from "./investigationScenario";
import { recoverInvestigationSave, type InvestigationSaveState } from "./investigationSave";
type Store = Pick<Storage,"getItem"|"setItem"|"removeItem">;
type Entry = { key:string; owner:string; text:string };
type Retained = Extract<InvestigationSaveState,{phase:"uncertain"|"rejected"}>;
export type JournalRead = {status:"empty";entries:Entry[]}
 | {status:"retained";entries:Entry[];state:Retained}
 | {status:"conflict"|"invalid"|"legacy";entries:Entry[]};
export const investigationSubject = (principal:string) => {
 const value=ownerUserId(principal)||principal;
 return isInvestigationId(value)?value:"";
};
const key=(owner:string)=>`mm.investigation.pending.v2:${encodeURIComponent(owner)}`;
const owners=(principal:string)=>{const subject=investigationSubject(principal);return subject?[subject,ownerKeyFor(subject)]:[principal];};
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const same=(a:InvestigationCommand,b:InvestigationCommand)=>stable(a)===stable(b);
export function readInvestigationJournal(store:Store,principal:string):JournalRead {
 const entries=owners(principal).map(owner=>({owner,key:key(owner),text:store.getItem(key(owner))})).filter((v):v is Entry=>v.text!==null);
 if(!entries.length)return {status:"empty",entries};
 const states:Retained[]=[];let invalid=false,legacy=false;
 for(const entry of entries){
  try{
   const raw=JSON.parse(entry.text), capture=raw?.command?.manifest?.scenario_capture;
   if(raw?.owner!==entry.owner){invalid=true;continue;}
   if(capture!==undefined&&capture!==null&&!parseScenarioCapture(capture)){legacy=true;continue;}
   const state=recoverInvestigationSave(entry.owner,raw);
   if(!state||(state.phase!=="uncertain"&&state.phase!=="rejected")){invalid=true;continue;}
   if(state.phase==="rejected")states.push({...state,principal});
   else states.push({...state,principal});
  }catch{invalid=true;}
 }
 // Even an invalid/legacy second buffer cannot be silently discarded in favor
 // of another operation. Both namespaces remain byte-for-byte intact.
 if(entries.length>1&&(invalid||legacy||states.some(s=>!same(s.command,states[0].command))))return {status:"conflict",entries};
 if(invalid)return {status:"invalid",entries};if(legacy)return {status:"legacy",entries};
 // If duplicate copies disagree about rejection, preserve uncertainty.
 const state=states.find(s=>s.phase==="uncertain")??states[0];
 // Identical aliases may hold different recovery provenance. A single older
 // invalid_payload copy requires the complete owner check, regardless of key order.
 const ownerRecheck=states.some(s=>s.phase==="uncertain"&&s.ownerRecheck===true);
 return {status:"retained",entries,state:state.phase==="uncertain"&&ownerRecheck?{...state,ownerRecheck:true}:state};
}
/** A persisted no-effect word cannot prove a fence on reload. Only the current
 * canonical state machine's matching, same-principal owner-confirmed state may
 * authorize replacing/clearing that conservative journal copy. */
function replaceable(found:JournalRead,principal:string,previous?:InvestigationSaveState):boolean {
 return found.status==="retained" && (found.state.phase==="rejected"
   ||(previous?.phase==="rejected"&&previous.reason==="not_applied"&&previous.principal===principal
     &&same(found.state.command,previous.command)));
}
export function retainInvestigationJournal(store:Store,principal:string,command:InvestigationCommand,previous?:InvestigationSaveState){
 const found=readInvestigationJournal(store,principal);
 if(found.status!=="empty"&&!(replaceable(found,principal,previous)&&found.status==="retained"
   &&previous?.phase==="rejected"&&previous.principal===principal&&same(found.state.command,previous.command)))throw Error("occupied journal");
 const entries=found.status==="empty"?[{owner:investigationSubject(principal)?ownerKeyFor(investigationSubject(principal)):principal,key:key(investigationSubject(principal)?ownerKeyFor(investigationSubject(principal)):principal),text:""}]:found.entries;
 for(const entry of entries){const text=JSON.stringify({owner:entry.owner,command});store.setItem(entry.key,text);if(store.getItem(entry.key)!==text)throw Error("journal unavailable");}
}
export function rejectInvestigationJournal(store:Store,principal:string,command:InvestigationCommand,reason:string){
 const found=readInvestigationJournal(store,principal);
 if(found.status!=="retained"||!same(found.state.command,command))throw Error("journal changed");
 for(const entry of found.entries)store.setItem(entry.key,JSON.stringify({owner:entry.owner,command,phase:"rejected",reason}));
}
/** Called only after the canonical state machine matched the exact commit receipt. */
export function clearCommittedInvestigationJournal(store:Store,principal:string,command:InvestigationCommand){
 const found=readInvestigationJournal(store,principal);if(found.status==="empty")return;
 if(found.status!=="retained"||!same(found.state.command,command))throw Error("journal changed");
 for(const entry of found.entries)store.removeItem(entry.key);
}
/** Starting another draft cannot discard either UNKNOWN or conflicting buffers. */
export function clearRejectedInvestigationJournal(store:Store,principal:string,previous?:InvestigationSaveState){
 const found=readInvestigationJournal(store,principal);if(found.status==="empty")return;
 if(!replaceable(found,principal,previous))throw Error("unsettled journal");
 for(const entry of found.entries)store.removeItem(entry.key);
}
