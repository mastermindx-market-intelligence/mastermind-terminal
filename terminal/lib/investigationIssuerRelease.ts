/** Reference-only selection over the existing immutable Earnings owner. */
import {createHash} from "node:crypto";
import {canonicalInvestigationJson} from "./investigationContracts";
import {parseSecAcquisitionReceipt,type SecAcquisitionReceipt} from "./issuerReleaseSecAcquisition";
import {resolveRetainedEventWorkspaceFromR2,resolveRetainedEventWorkspaceAtCutoff,
  type EventWorkspace,type EventWorkspaceReplayResult,type RetainedEventWorkspaceResult,
  type RetainedEventWorkspacePin,type RetainedEventWorkspaceReceipt,type EventWorkspaceSource} from "./eventWorkspace";

export type IssuerReleaseRights = {
  allowed:boolean;family:"sec_edgar";policy_version:string;registry_revision:string;
  permitted_display_class:"direct_display_ok";checked_at:string;document_id:string;source_sha256:string;
  decision_binding?:IssuerReleaseDecisionBinding;
};
export type IssuerReleaseReadScope=Readonly<{
  principal_id:string;action:"read";purpose:"investigation.selected_issuer_release";
}>;
export type IssuerReleaseDecisionBinding=IssuerReleaseReadScope&Readonly<{
  company_id:string;event_id:string;generation_id:string;document_id:string;source_sha256:string;
}>;
export type IssuerReleaseIdentity = {
  company_id:string;event_id:string;generation_id:string;document_id:string;
  source_sha256:string;filing_key:EventWorkspaceSource["filing_key"];
};
/** Declared metadata and optional acquisition record from the hash-bound owner,
 * not an independent byte replay or grant. Kept outside the saved identity. */
export type IssuerReleaseSourceContext = Readonly<{
  source_url:string|null;provenance:"retained_owner_metadata";
  acquisition_receipt?:SecAcquisitionReceipt;
  request_scope?:IssuerReleaseReadScope&Readonly<{checked_at:string}>;
}>;
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
type Options={signal?:AbortSignal;requestScope?:IssuerReleaseReadScope;authorize?:(identity:IssuerReleaseIdentity,source:IssuerReleaseSourceContext)=>Promise<IssuerReleaseRights>};
type Authorized={identity:IssuerReleaseIdentity;release:EventWorkspaceSource;rights:IssuerReleaseRights};
const unavailable=(reason:string):Unavailable=>({ok:false,code:"HISTORICAL_UNAVAILABLE",reason});

/** This is our executable policy revision, not an SEC-issued version or an
 * external registry. Its public basis never admits the mixed workspace. */
export const SELECTED_SEC_READ_POLICY=Object.freeze({
  policy_version:"iw2.selected_sec_issuer_release.read.v1",
  purpose:"investigation.selected_issuer_release",action:"read",reviewed_on:"2026-10-24",
  basis:Object.freeze(["https://www.sec.gov/files/about/webmaster-faq.htm","https://www.sec.gov/about/privacy-information"]),
  acquisition_schema:"earnings_release.sec_acquisition.v1",
  acquisition_schema_sha256:"a630622d64cccca2ef73de1af0263120331613537f74e4dfc52863548b66832b",
  eligibility:"Existing trusted owner retained a matching typed SEC public-filing acquisition receipt",
  rules:Object.freeze([
    "Canonical HTTPS sec.gov or www.sec.gov filing document; matching issuer CIK and accession; no escapes, userinfo, ports, queries, fragments or indexes",
    "At most five contiguous same-filing redirects; raw Location checked before normalization",
    "Status200, declared requests-decoded entity digest/length, strict recorded decoder and matching UTF8 source digest/length",
    "Exact authenticated server principal, read purpose and selected company/event/generation/document/digest binding",
    "Fresh request-evaluation clock; actual acquisition not later than that decision; no substitution for source/publication clocks",
  ]),
  exclusions:Object.freeze(["mixed_workspace","transcript","qa","model_input","export","owner_write","SEC_logos_artwork_trademarks"]),
});
export const SELECTED_SEC_POLICY_REVISION="local_executable_policy.sha256:"+createHash("sha256").update(canonicalInvestigationJson(SELECTED_SEC_READ_POLICY)).digest("hex");
function validScope(scope:IssuerReleaseReadScope):boolean {
  return typeof scope.principal_id==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(scope.principal_id)
    &&scope.principal_id!=="00000000-0000-0000-0000-000000000000"&&scope.action==="read"&&scope.purpose==="investigation.selected_issuer_release";
}
function decisionBinding(identity:IssuerReleaseIdentity,scope:IssuerReleaseReadScope):IssuerReleaseDecisionBinding {
  return Object.freeze({principal_id:scope.principal_id,action:scope.action,purpose:scope.purpose,
    company_id:identity.company_id,event_id:identity.event_id,generation_id:identity.generation_id,document_id:identity.document_id,source_sha256:identity.source_sha256});
}
function currentDecision(decision:IssuerReleaseRights,identity:IssuerReleaseIdentity,scope:NonNullable<IssuerReleaseSourceContext["request_scope"]>):boolean {
  const expected=decisionBinding(identity,scope),actual=decision.decision_binding;
  return !!actual&&typeof actual==="object"&&Object.keys(actual).length===Object.keys(expected).length
    &&(Object.keys(expected) as (keyof IssuerReleaseDecisionBinding)[]).every(key=>actual[key]===expected[key])
    &&decision.policy_version===SELECTED_SEC_READ_POLICY.policy_version&&decision.registry_revision===SELECTED_SEC_POLICY_REVISION&&decision.checked_at===scope.checked_at;
}
/** The caller supplies the principal returned by the server's authenticated
 * getUser, never a request parameter. No receipt is synthesized for old rows. */
export function createSelectedIssuerReleaseReadOptions(principal_id:string,signal?:AbortSignal):Options {
  const requestScope:IssuerReleaseReadScope=Object.freeze({principal_id,action:"read",purpose:"investigation.selected_issuer_release"});
  return {signal,requestScope,authorize:async(identity,source)=>{
    const scope=source.request_scope;
    if(signal?.aborted||source.provenance!=="retained_owner_metadata"||!validScope(requestScope)||!scope||scope.principal_id!==principal_id||!validScope(scope)
      ||!identity.filing_key||identity.company_id!==`cik:${identity.filing_key.cik}`||!source.source_url)throw Error("rights_unavailable");
    const receipt=parseSecAcquisitionReceipt(source.acquisition_receipt,{filing_key:identity.filing_key,source_url:source.source_url,source_sha256:identity.source_sha256});
    // This is a request decision clock, not a filing/publication/source clock.
    if(!receipt||!Number.isFinite(Date.parse(scope.checked_at))||Date.parse(receipt.acquired_at)>Date.parse(scope.checked_at))throw Error("rights_unavailable");
    return {allowed:true,family:"sec_edgar",policy_version:SELECTED_SEC_READ_POLICY.policy_version,registry_revision:SELECTED_SEC_POLICY_REVISION,
      permitted_display_class:"direct_display_ok",checked_at:scope.checked_at,document_id:identity.document_id,source_sha256:identity.source_sha256,
      decision_binding:decisionBinding(identity,requestScope)};
  }};
}

async function authorizeSelection(workspace:EventWorkspace,authorize:NonNullable<Options["authorize"]>,requestScope?:IssuerReleaseReadScope):Promise<Authorized> {
  const releases=workspace.sources.filter(item=>item.kind==="issuer_release");
  if(releases.length!==1)throw Error("ambiguous_release");
  const release=releases[0];
  if(release.receipt_state!=="byte_replayed"||!release.document_id||!release.source_sha256||!/^[0-9a-f]{64}$/.test(release.source_sha256))throw Error("unretained_release");
  const identity:IssuerReleaseIdentity={company_id:workspace.issuer.company_id,event_id:workspace.event_id,generation_id:workspace.generation_id,document_id:release.document_id,source_sha256:release.source_sha256,filing_key:release.filing_key};
  const source:IssuerReleaseSourceContext=Object.freeze({source_url:release.url,provenance:"retained_owner_metadata",
    ...(release.acquisition_receipt?{acquisition_receipt:release.acquisition_receipt}:{}),
    ...(requestScope?{request_scope:Object.freeze({...requestScope,checked_at:new Date().toISOString()})}:{})});
  const callbackIdentity=Object.freeze({...identity,filing_key:identity.filing_key?Object.freeze({...identity.filing_key}):null});
  const decision=await authorize(callbackIdentity,source);
  if(!decision||decision.family!=="sec_edgar"||decision.document_id!==identity.document_id||decision.source_sha256!==identity.source_sha256
    ||decision.permitted_display_class!=="direct_display_ok"||![decision.registry_revision,decision.policy_version,decision.checked_at].every(v=>typeof v==="string"&&v.length>0&&v.length<=256)
    ||!Number.isFinite(Date.parse(decision.checked_at)))throw Error("rights_unavailable");
  if(source.request_scope&&!currentDecision(decision,identity,source.request_scope))throw Error("rights_unavailable");
  const rights:IssuerReleaseRights={allowed:decision.allowed,family:"sec_edgar",policy_version:decision.policy_version,registry_revision:decision.registry_revision,permitted_display_class:"direct_display_ok",checked_at:decision.checked_at,document_id:identity.document_id,source_sha256:identity.source_sha256};
  if(source.request_scope)rights.decision_binding=decisionBinding(identity,source.request_scope);
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
  if(!options.authorize||(options.requestScope&&!validScope(options.requestScope)))return unavailable("rights_unavailable");
  let selected:Authorized|undefined;
  const {fingerprint,...containerPin}=pin;
  const retained=await resolveRetainedEventWorkspaceFromR2(containerPin,base,{signal:options.signal,authorize:async workspace=>{
    selected=await authorizeSelection(workspace,options.authorize!,options.requestScope);return selected.rights;
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
  if(!options.authorize||(options.requestScope&&!validScope(options.requestScope)))return unavailable("rights_unavailable");
  const root=await resolveInvestigationIssuerRelease(pin,base,options);
  if(!root.ok)return root;
  const authorized=new Map<string,Authorized>();
  const replay=await resolveRetainedEventWorkspaceAtCutoff({...pin,fingerprint:root.receipt.fingerprint},selection,base,{signal:options.signal,authorize:async workspace=>{
    const result=await authorizeSelection(workspace,options.authorize!,options.requestScope);authorized.set(workspace.generation_id,result);return result.rights;
  }});
  if(!replay.ok)return replay;
  const selected=authorized.get(replay.receipt.generation_id);
  if(!selected||options.signal?.aborted)return unavailable("rights_unavailable");
  const result=project(replay,selected);
  return result.ok?{...result,replay:replay.replay}:result;
}
