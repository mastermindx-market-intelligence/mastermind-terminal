/** Selected, reference-only adapter over the existing immutable Earnings owner.
 * The current rights owner is deliberately injectable and absent by default.
 * No registry row, persisted token or public-primary label grants access here. */
import { createHash } from "node:crypto";
import { canonicalInvestigationJson } from "./investigationContracts";
import { resolveRetainedEventWorkspaceFromR2, type RetainedEventWorkspacePin, type RetainedEventWorkspaceReceipt, type EventWorkspaceSource } from "./eventWorkspace";

export type IssuerReleaseRights = {
  allowed: boolean; family: "sec_edgar"; policy_version: string; registry_revision: string;
  permitted_display_class: "direct_display_ok"; checked_at: string;
  document_id: string; source_sha256: string;
};
export type IssuerReleaseIdentity = {
  company_id: string; event_id: string; generation_id: string;
  document_id: string; source_sha256: string; filing_key: EventWorkspaceSource["filing_key"];
};
export type IssuerReleaseProjection = {
  schema: "earnings.issuer_release_projection.v1";
  issuer: {company_id: string; display_name: string}; event_id: string; generation_id: string;
  completeness: {release: {status: "present"; document_id: string}};
  selected_release: IssuerReleaseIdentity & {receipt_state: "byte_replayed"; public_known_at: string | null; platform_known_at: string | null};
};
export type IssuerReleaseBaseline = {
  ok: true; workspace: IssuerReleaseProjection; receipt: RetainedEventWorkspaceReceipt;
  selection_receipt: {schema:"earnings.issuer_release_selection.v1"; container_fingerprint:string; fingerprint:string; rights:IssuerReleaseRights};
  reference: {owner:"earnings.workspace_generation"; object_type:"event_workspace"; object_id:string; mode:"pinned"; version_ref:string; fingerprint:string; selection:{field:"issuer_release"}};
};
export async function resolveInvestigationIssuerRelease(
  pin: RetainedEventWorkspacePin, base: string,
  options: {signal?: AbortSignal; authorize?: (identity: IssuerReleaseIdentity) => Promise<IssuerReleaseRights>} = {},
): Promise<IssuerReleaseBaseline | {ok:false;code:"HISTORICAL_UNAVAILABLE";reason:string}> {
  const unavailable=(reason:string)=>({ok:false as const,code:"HISTORICAL_UNAVAILABLE" as const,reason});
  if (!options.authorize) return unavailable("rights_unavailable");
  let selected: IssuerReleaseIdentity | null=null, rights: IssuerReleaseRights | null=null;
  let source: EventWorkspaceSource | null=null;
  // The incoming fingerprint belongs to the selected projection, not its container.
  const {fingerprint,...containerPin}=pin;
  const retained=await resolveRetainedEventWorkspaceFromR2(containerPin,base,{signal:options.signal,authorize:async workspace=>{
    const releases=workspace.sources.filter(item=>item.kind==="issuer_release");
    if(releases.length!==1)throw Error("ambiguous_release");
    source=releases[0];
    if(source.receipt_state!=="byte_replayed"||!source.document_id||!source.source_sha256||!/^[0-9a-f]{64}$/.test(source.source_sha256))throw Error("unretained_release");
    selected={company_id:workspace.issuer.company_id,event_id:workspace.event_id,generation_id:workspace.generation_id,document_id:source.document_id,source_sha256:source.source_sha256,filing_key:source.filing_key};
    const decision=await options.authorize!(selected);
    if(!decision||decision.family!=="sec_edgar"||decision.document_id!==selected.document_id||decision.source_sha256!==selected.source_sha256
      ||decision.permitted_display_class!=="direct_display_ok"||![decision.registry_revision,decision.policy_version,decision.checked_at].every(v=>typeof v==="string"&&v.length>0&&v.length<=256)
      ||!Number.isFinite(Date.parse(decision.checked_at)))throw Error("rights_unavailable");
    rights={allowed:decision.allowed,family:"sec_edgar",policy_version:decision.policy_version,registry_revision:decision.registry_revision,permitted_display_class:"direct_display_ok",checked_at:decision.checked_at,document_id:selected.document_id,source_sha256:selected.source_sha256};
    return rights;
  }});
  if(!retained.ok)return retained;
  // Assignments occur in the awaited owner authorization call.
  const identity=selected as IssuerReleaseIdentity|null, release=source as EventWorkspaceSource|null, decision=rights as IssuerReleaseRights|null;
  if(!identity||!release||!decision||options.signal?.aborted)return unavailable("rights_unavailable");
  const clock=release.source_clock;
  if(clock&&(clock.document_id!==identity.document_id||clock.source_sha256!==identity.source_sha256))return unavailable("invalid_owner_receipt");
  const workspace:IssuerReleaseProjection={schema:"earnings.issuer_release_projection.v1",issuer:{company_id:retained.workspace.issuer.company_id,display_name:retained.workspace.issuer.display_name},event_id:identity.event_id,generation_id:identity.generation_id,
    completeness:{release:{status:"present",document_id:identity.document_id}},selected_release:{...identity,receipt_state:"byte_replayed",public_known_at:clock?.source_available_at??null,platform_known_at:clock?.system_recorded_at??null}};
  const selectedFingerprint=createHash("sha256").update(canonicalInvestigationJson({schema:"earnings.issuer_release_selection.v1",container_fingerprint:retained.receipt.fingerprint,workspace})).digest("hex");
  if(fingerprint!==undefined&&fingerprint!==selectedFingerprint)return unavailable("invalid_owner_receipt");
  return {ok:true,workspace,receipt:{...retained.receipt,public_known_at:workspace.selected_release.public_known_at,platform_known_at:workspace.selected_release.platform_known_at},
    selection_receipt:{schema:"earnings.issuer_release_selection.v1",container_fingerprint:retained.receipt.fingerprint,fingerprint:selectedFingerprint,rights:decision},
    reference:{owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:identity.event_id,mode:"pinned",version_ref:identity.generation_id,fingerprint:selectedFingerprint,selection:{field:"issuer_release"}}};
}
