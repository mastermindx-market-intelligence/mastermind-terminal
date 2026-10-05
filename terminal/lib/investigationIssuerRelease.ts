/** Reference-only selection over the existing immutable Earnings owner. */
import {createHash} from "node:crypto";
import {canonicalInvestigationJson} from "./investigationContracts";
import {resolveRetainedEventWorkspaceFromR2,resolveRetainedEventWorkspaceAtCutoff,
  type EventWorkspace,type EventWorkspaceReplayResult,type RetainedEventWorkspaceResult,
  type RetainedEventWorkspacePin,type RetainedEventWorkspaceReceipt,type EventWorkspaceSource} from "./eventWorkspace";

export type IssuerReleaseRights = {
  allowed:boolean;family:"sec_edgar";policy_version:string;registry_revision:string;
  permitted_display_class:"direct_display_ok";checked_at:string;document_id:string;source_sha256:string;
};
export type IssuerReleaseIdentity = {
  company_id:string;event_id:string;generation_id:string;document_id:string;
  source_sha256:string;filing_key:EventWorkspaceSource["filing_key"];
};
export type IssuerReleaseProjection = {
  schema:"earnings.issuer_release_projection.v1";
  issuer:{company_id:string;display_name:string};event_id:string;generation_id:string;
  completeness:{release:{status:"present";document_id:string}};
  selected_release:IssuerReleaseIdentity & {receipt_state:"byte_replayed";public_known_at:string|null;platform_known_at:string|null};
};
export type IssuerReleaseBaseline = {
  ok:true;workspace:IssuerReleaseProjection;receipt:RetainedEventWorkspaceReceipt;
  selection_receipt:{schema:"earnings.issuer_release_selection.v1";container_fingerprint:string;fingerprint:string;rights:IssuerReleaseRights};
  reference:{owner:"earnings.workspace_generation";object_type:"event_workspace";object_id:string;mode:"pinned";version_ref:string;fingerprint:string;selection:{field:"issuer_release"}};
};
type Unavailable={ok:false;code:"HISTORICAL_UNAVAILABLE";reason:string};
type Options={signal?:AbortSignal;authorize?:(identity:IssuerReleaseIdentity)=>Promise<IssuerReleaseRights>};
type Authorized={identity:IssuerReleaseIdentity;release:EventWorkspaceSource;rights:IssuerReleaseRights};
const unavailable=(reason:string):Unavailable=>({ok:false,code:"HISTORICAL_UNAVAILABLE",reason});

async function authorizeSelection(workspace:EventWorkspace,authorize:NonNullable<Options["authorize"]>):Promise<Authorized> {
  const releases=workspace.sources.filter(item=>item.kind==="issuer_release");
  if(releases.length!==1)throw Error("ambiguous_release");
  const release=releases[0];
  if(release.receipt_state!=="byte_replayed"||!release.document_id||!release.source_sha256||!/^[0-9a-f]{64}$/.test(release.source_sha256))throw Error("unretained_release");
  const identity:IssuerReleaseIdentity={company_id:workspace.issuer.company_id,event_id:workspace.event_id,generation_id:workspace.generation_id,document_id:release.document_id,source_sha256:release.source_sha256,filing_key:release.filing_key};
  const decision=await authorize(identity);
  if(!decision||decision.family!=="sec_edgar"||decision.document_id!==identity.document_id||decision.source_sha256!==identity.source_sha256
    ||decision.permitted_display_class!=="direct_display_ok"||![decision.registry_revision,decision.policy_version,decision.checked_at].every(v=>typeof v==="string"&&v.length>0&&v.length<=256)
    ||!Number.isFinite(Date.parse(decision.checked_at)))throw Error("rights_unavailable");
  const rights:IssuerReleaseRights={allowed:decision.allowed,family:"sec_edgar",policy_version:decision.policy_version,registry_revision:decision.registry_revision,permitted_display_class:"direct_display_ok",checked_at:decision.checked_at,document_id:identity.document_id,source_sha256:identity.source_sha256};
  return {identity,release,rights};
}

function project(retained:Extract<RetainedEventWorkspaceResult,{ok:true}>,selected:Authorized):IssuerReleaseBaseline|Unavailable {
  const {identity,release,rights}=selected,clock=release.source_clock;
  if(clock&&(clock.document_id!==identity.document_id||clock.source_sha256!==identity.source_sha256))return unavailable("invalid_owner_receipt");
  const workspace:IssuerReleaseProjection={schema:"earnings.issuer_release_projection.v1",issuer:{company_id:retained.workspace.issuer.company_id,display_name:retained.workspace.issuer.display_name},event_id:identity.event_id,generation_id:identity.generation_id,
    completeness:{release:{status:"present",document_id:identity.document_id}},selected_release:{...identity,receipt_state:"byte_replayed",public_known_at:clock?.source_available_at??null,platform_known_at:clock?.system_recorded_at??null}};
  const fingerprint=createHash("sha256").update(canonicalInvestigationJson({schema:"earnings.issuer_release_selection.v1",container_fingerprint:retained.receipt.fingerprint,workspace})).digest("hex");
  return {ok:true,workspace,receipt:{...retained.receipt,public_known_at:workspace.selected_release.public_known_at,platform_known_at:workspace.selected_release.platform_known_at},
    selection_receipt:{schema:"earnings.issuer_release_selection.v1",container_fingerprint:retained.receipt.fingerprint,fingerprint,rights},
    reference:{owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:identity.event_id,mode:"pinned",version_ref:identity.generation_id,fingerprint,selection:{field:"issuer_release"}}};
}

/** Current rights are deliberately absent by default. Saved public-primary tokens
 * and SEC display permission never authorize the surrounding mixed workspace. */
export async function resolveInvestigationIssuerRelease(pin:RetainedEventWorkspacePin,base:string,options:Options={}):Promise<IssuerReleaseBaseline|Unavailable> {
  if(!options.authorize)return unavailable("rights_unavailable");
  let selected:Authorized|undefined;
  const {fingerprint,...containerPin}=pin;
  const retained=await resolveRetainedEventWorkspaceFromR2(containerPin,base,{signal:options.signal,authorize:async workspace=>{
    selected=await authorizeSelection(workspace,options.authorize!);return selected.rights;
  }});
  if(!retained.ok)return retained;
  if(!selected||options.signal?.aborted)return unavailable("rights_unavailable");
  const result=project(retained,selected);
  if(result.ok&&fingerprint!==undefined&&fingerprint!==result.reference.fingerprint)return unavailable("invalid_owner_receipt");
  return result;
}

export type IssuerReleaseReplayResult=(IssuerReleaseBaseline & {replay:Extract<EventWorkspaceReplayResult,{ok:true}>["replay"]})|Unavailable;
/** Reuse the existing hash-bound history traversal. Validate the saved selection
 * first, then keep container and selection fingerprints distinct throughout. */
export async function resolveInvestigationIssuerReleaseAtCutoff(pin:RetainedEventWorkspacePin,selection:Parameters<typeof resolveRetainedEventWorkspaceAtCutoff>[1],base:string,options:Options={}):Promise<IssuerReleaseReplayResult> {
  if(selection.policy!=="platform_snapshot")return unavailable("unsupported_policy");
  if(!pin.fingerprint)return unavailable("invalid_reference");
  if(!options.authorize)return unavailable("rights_unavailable");
  const root=await resolveInvestigationIssuerRelease(pin,base,options);
  if(!root.ok)return root;
  const authorized=new Map<string,Authorized>();
  const replay=await resolveRetainedEventWorkspaceAtCutoff({...pin,fingerprint:root.receipt.fingerprint},selection,base,{signal:options.signal,authorize:async workspace=>{
    const result=await authorizeSelection(workspace,options.authorize!);authorized.set(workspace.generation_id,result);return result.rights;
  }});
  if(!replay.ok)return replay;
  const selected=authorized.get(replay.receipt.generation_id);
  if(!selected||options.signal?.aborted)return unavailable("rights_unavailable");
  const result=project(replay,selected);
  return result.ok?{...result,replay:replay.replay}:result;
}
