/** Pure duplicate-draft admission and derivation for InvestigationWorkspace's private
 * "Duplicate as new research" action. No I/O, no React, no ids, no clocks: a duplicate is a
 * local unsaved draft, and only the existing Save chain may ever send anything.
 *
 * Admission reuses the Workspace's existing synchronous auth getter fence (the same boundary the
 * reviewed-baseline follow-up GET uses): a real authenticated owner needs a ready lifetime, its own
 * principal partition and a nonempty epoch at the click, and the captured principal and epoch must
 * still be current before a later Save adopts the draft. local-preview stays the existing fixture
 * carrier with no invented identity and no second auth coordinator.
 *
 * Derivation copies the acknowledged revision's own fields exactly. The selected historical
 * revision R is the basis (never currentR+1); nothing here allocates an id, an operation or a
 * revision, and an unsupported newer payload can only reach a duplicate through openRecord's
 * exact readback, which rejects it before any duplicate exists. */
import type { InvestigationManifest, InvestigationThesisRef } from "./investigationContracts";
import type { AuthLifecycleSnapshot } from "./supabase/authLifecycle";

/** The copied source of an unsaved duplicate: one acknowledged revision, unchanged. */
export type DuplicateSource = { id:string; revision:number; lifecycle:"active"|"removed"; manifest:InvestigationManifest };
/** The ready principal and epoch captured at the click; a later Save must still show both. */
export type DuplicateGuard = { principal:string; epoch:string };
export type DuplicateRefusal = "no_source"|"loading"|"locked"|"removed"|"auth"|"account";
export type DuplicateAdmission = { ok:true; guard:DuplicateGuard } | { ok:false; reason:DuplicateRefusal };

/** The guard a deliberate click may capture, or null when the current lifetime may not duplicate. */
export function duplicateGuard(ownerKey:string,snapshot:AuthLifecycleSnapshot|null):DuplicateGuard|null {
 if(ownerKey==="local-preview")return{principal:ownerKey,epoch:""};
 return snapshot&&snapshot.availability==="ready"&&snapshot.principal_partition===ownerKey&&!!snapshot.auth_epoch
  ?{principal:snapshot.principal_partition,epoch:snapshot.auth_epoch}:null;
}

/** Pure admission decision. A pending or uncertain original phase reaches this as `locked` and is
 * refused before any draft exists; a stored invalid_payload ownerRecheck is that same uncertain
 * lock and can never be freshened into a duplicate. */
export function admitDuplicate(input:{ownerKey:string;source:DuplicateSource|null;loading:boolean;locked:boolean;snapshot:AuthLifecycleSnapshot|null}):DuplicateAdmission {
 if(!input.source)return{ok:false,reason:"no_source"};
 if(input.loading)return{ok:false,reason:"loading"};
 if(input.locked)return{ok:false,reason:"locked"};
 if(input.source.lifecycle==="removed")return{ok:false,reason:"removed"};
 const guard=duplicateGuard(input.ownerKey,input.snapshot);
 if(guard)return{ok:true,guard};
 return input.snapshot&&input.snapshot.principal_partition&&input.snapshot.principal_partition!==input.ownerKey
  ?{ok:false,reason:"account"}:{ok:false,reason:"auth"};
}

export type DuplicateDraftFields = {
 title:string;question:string;symbol:string;next:string;horizon:string;asOf:string;
 keepLayout:boolean;theses:InvestigationThesisRef[];
};

/** The draft fields are the acknowledged revision's own values, unchanged: the exact intent
 * subjects stay in the manifest copy the Workspace retains, an existing layout reference is kept
 * with its stored revision (no capture, no bump) and Thesis versions keep their exact version
 * ids — an older referenced version is never exchanged for a newer one. The original title is
 * kept as written; no suffix is invented and no revision number is added to any field. */
export function duplicateDraftFields(manifest:InvestigationManifest):DuplicateDraftFields {
 return {
  title:manifest.intent.title,
  question:manifest.intent.question,
  symbol:manifest.intent.subjects.find(s=>s.owner==="terminal.analysis_symbol")?.object_id??"",
  next:manifest.continuation.next_question??"",
  horizon:manifest.intent.horizon??"",
  asOf:manifest.intent.research_as_of??"",
  keepLayout:manifest.layout_refs.length>0,
  theses:manifest.thesis_refs,
 };
}
