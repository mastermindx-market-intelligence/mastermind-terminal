/** Client recovery state only. The database operation receipt remains the sole retry authority. */
import { isInvestigationId, isLegacyInvestigationCommitted, parseInvestigationNativeReceipt, type InvestigationNativeReceipt, matchesInvestigationCommand, parseInvestigationCommand, type InvestigationCommand, type InvestigationCommitted } from "./investigations";
import { classifyInvestigationOperationReceipt } from "./investigationOperationReceipt";
import { ownerUserId } from "./accountIdentity";
export type CaptureOutcome = "unknown_after_canonical_not_applied" | "unknown_after_canonical_refusal" | "native_participant_unresolved";
type NativeCaptureState = { captureOutcome?: CaptureOutcome; canonicalResult?: InvestigationCommitted; canonicalRefusal?: string; nativeObservation?: InvestigationNativeReceipt };
export type InvestigationSaveState =
  | { phase: "idle" }
  | ({ phase: "pending"; principal: string; command: InvestigationCommand } & NativeCaptureState)
  // ownerRecheck: a receipt read alone may not settle this state; the full-request owner must answer first.
  | ({ phase: "uncertain"; principal: string; command: InvestigationCommand; ownerRecheck?: true } & NativeCaptureState)
  | { phase: "committed"; principal: string; result: InvestigationCommitted; receiptBinding?: "native_lineage" | "legacy_recorded_completion"; nativeObservation?: InvestigationNativeReceipt }
  | { phase: "rejected"; principal: string; command: InvestigationCommand; reason: string; nativeObservation?: InvestigationNativeReceipt };
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i) => sameJson(v,b[i]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string,unknown>, right = b as Record<string,unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(k => Object.hasOwn(right,k) && sameJson(left[k],right[k]));
}
const definitive = new Set(["invalid_payload", "version_conflict", "idempotency_conflict", "invalid_transition", "reference_unavailable", "layout_conflict", "screen_conflict", "limit_reached"]);
/** Local recovery is a draft buffer; only an owner receipt establishes a commit. */
export function recoverInvestigationSave(principal: string, raw: unknown): InvestigationSaveState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const saved = raw as Record<string, unknown>;
  if (saved.owner !== principal) return null;
  const command = parseInvestigationCommand(saved.command, true);
  if (!command) return null;
  // Before the legacy POST cutover the route refused a retried legacy request with invalid_payload before it
  // asked the owner, so that stored refusal never proved the original failed: it may already have committed.
  if (saved.phase === "rejected" && saved.reason === "invalid_payload") return { phase: "uncertain", principal, command, ownerRecheck: true,
    ...(mayHaveNativeCapture(command)?{captureOutcome:"unknown_after_canonical_refusal" as const}:{}) };
  if (saved.phase === "rejected" && typeof saved.reason === "string" && definitive.has(saved.reason)) {
    if (mayHaveNativeCapture(command)) return { phase: "uncertain", principal, command, captureOutcome: "unknown_after_canonical_refusal" };
    return { phase: "rejected", principal, command, reason: saved.reason };
  }
  return { phase: "uncertain", principal, command,
    ...(saved.owner_recheck===true?{ownerRecheck:true as const}:{}),
    ...((saved.capture_outcome === "unknown_after_canonical_not_applied" || saved.capture_outcome === "unknown_after_canonical_refusal" || saved.capture_outcome === "native_participant_unresolved") && mayHaveNativeCapture(command)
      ? { captureOutcome: saved.capture_outcome } : {}) };
}
export function beginInvestigationSave(principal: string, raw: unknown, previous: InvestigationSaveState): InvestigationSaveState {
  previous = partitionInvestigationSave(previous, principal || null);
  if (!principal || previous.phase === "pending" || previous.phase === "uncertain") return previous;
  const command = parseInvestigationCommand(raw);
  // Detach caller memory: an edited draft must never change an already-sent operation.
  return command ? { phase: "pending", principal, command: JSON.parse(JSON.stringify(command)) } : previous;
}
/** Only a matching full-command owner answer discharges the legacy recheck.
 * Its canonical observation cannot discharge an orthogonal native capture. */
function afterOriginalOwnerCheck(state:Extract<InvestigationSaveState,{phase:"pending"|"uncertain"}>) {
  if(state.phase!=="uncertain"||!state.ownerRecheck)return state;
  const {ownerRecheck: observed,...remaining}=state;void observed;return remaining;
}
export function settleInvestigationSave(state: InvestigationSaveState, principal: string, response: unknown): InvestigationSaveState {
  if (state.phase !== "pending" && state.phase !== "uncertain") return state;
  if (state.principal !== principal) return { phase: "idle" };
  if (matchesInvestigationCommand(response,state.command)) {
    if (state.captureOutcome) return {...afterOriginalOwnerCheck(state),phase:"uncertain",canonicalResult:response};
    return { phase: "committed", principal, result: response };
  }
  const status = response !== null && typeof response === "object" ? (response as { status?: unknown }).status : null;
  if (state.captureOutcome) {
    const answer=response as {id?:unknown;operation_id?:unknown;reason?:unknown}|null;
    if(state.phase==="uncertain"&&state.ownerRecheck&&status==="not_applied"&&answer?.id===state.command.id
      &&answer.operation_id===state.command.operation_id&&(answer.reason===undefined||answer.reason==="limit_reached"))
      return {...afterOriginalOwnerCheck(state),phase:"uncertain",canonicalRefusal:"not_applied"};
    return {...state,phase:"uncertain"};
  }
  if (status === "not_applied" && (response as {id?:unknown}).id === state.command.id && (response as {operation_id?:unknown}).operation_id === state.command.operation_id) {
    // A stored fence permits a new operation. The receipt-cap answer is just as final for the
    // original, but it permits nothing new, so it keeps its own reason. Unknown reasons stay uncertain.
    const reason = (response as {reason?:unknown}).reason;
    if (mayHaveNativeCapture(state.command)) return {...state,phase:"uncertain",captureOutcome:"unknown_after_canonical_not_applied"};
    if (reason === undefined) return {phase:"rejected",principal,command:state.command,reason:"not_applied"};
    if (reason === "limit_reached") return {phase:"rejected",principal,command:state.command,reason:"limit_reached"};
  }
  if (state.phase === "pending" && typeof status === "string" && definitive.has(status)) {
    if (mayHaveNativeCapture(state.command)) return {...state,phase:"uncertain",captureOutcome:"unknown_after_canonical_refusal",canonicalRefusal:status};
    return { phase: "rejected", principal, command: state.command, reason: status };
  }
  // not_found on receipt lookup, auth expiry, timeout and malformed replies are all inconclusive.
  return {...state,phase:"uncertain"};
}
/** Receipt reads have a stricter native lineage contract than incumbent POST replies.
 * A current authenticated read is an observation, never an implicit reconcile/retry.
 */
export function settleInvestigationOperationRead(state: InvestigationSaveState, principal: string, response: unknown): InvestigationSaveState {
  if (state.phase !== "pending" && state.phase !== "uncertain") return state;
  if (state.principal !== principal) return { phase: "idle" };
  const unresolved = (): InvestigationSaveState => ({...state, phase:"uncertain"});
  if (!response || typeof response !== "object" || Array.isArray(response)) return unresolved();
  if ((response as {read_binding?:unknown}).read_binding === "native_participant") {
    const {read_principal,read_operation_id,read_binding,canonical,...raw} = response as Record<string,unknown>;
    const subject = ownerUserId(principal) || principal;
    const native = parseInvestigationNativeReceipt(raw,state.command,subject);
    if (read_binding !== "native_participant" || read_principal !== subject || read_operation_id !== state.command.operation_id || !native
        || (state.nativeObservation && (!sameJson(state.nativeObservation.binding,native.binding)
          || state.nativeObservation.generation !== native.generation
          || (state.nativeObservation.native_phase === "retained" && native.native_phase !== "retained")
          || (state.nativeObservation.canonical_status !== "pending" && native.canonical_status !== state.nativeObservation.canonical_status)))) return unresolved();
    const waiting: InvestigationSaveState = {...state,phase:"uncertain",captureOutcome:"native_participant_unresolved",nativeObservation:native};
    if (native.native_phase !== "retained" || native.canonical_status === "pending"
        || !canonical || typeof canonical !== "object" || Array.isArray(canonical)) return waiting;
    const {read_principal: cp,read_operation_id: co,read_binding: cb,...result} = canonical as Record<string,unknown>;
    if (cp !== subject || co !== state.command.operation_id || result.id !== state.command.id) return waiting;
    if (native.canonical_status === "not_applied" && cb === "stored_no_effect"
        && classifyInvestigationOperationReceipt(result,state.command.operation_id,subject) === "not_applied") {
      return {phase:"rejected",principal,command:state.command,reason:"not_applied",nativeObservation:native};
    }
    if (native.canonical_status === "committed" && cb === "native_lineage"
        && classifyInvestigationOperationReceipt(result,state.command.operation_id,subject) === "committed") {
      const committed = settleInvestigationSave({phase:"pending",principal,command:state.command},principal,result);
      if (committed.phase === "committed") return {...committed,receiptBinding:"native_lineage",nativeObservation:native};
    }
    return waiting;
  }
  // A result-only receipt cannot replace the full original-command owner check.
  if (state.phase === "uncertain" && state.ownerRecheck) return unresolved();
  const { read_principal, read_operation_id, read_binding, ...native } = response as Record<string, unknown>;
  const subject = ownerUserId(principal) || principal;
  if (!isInvestigationId(subject) || read_principal !== subject || read_operation_id !== state.command.operation_id || native.id !== state.command.id) return unresolved();
  const disposition = classifyInvestigationOperationReceipt(native, state.command.operation_id, subject);
  if ((read_binding === "native_lineage" && disposition === "committed")
      || (read_binding === "legacy_recorded_completion" && isLegacyInvestigationCommitted(native))) {
    const settled = settleInvestigationSave(state, principal, native);
    return settled.phase === "committed" ? { ...settled, receiptBinding: read_binding } : settled;
  }
  if (read_binding === "stored_no_effect" && disposition === "not_applied") {
    // A canonical DB fence cannot settle a private retention PUT that precedes
    // the DB lock. Suppress retries without granting new-draft/clear authority.
    if (mayHaveNativeCapture(state.command)) return { phase: "uncertain", principal, command: state.command, captureOutcome: "unknown_after_canonical_not_applied",
      ...(state.canonicalResult ? { canonicalResult: state.canonicalResult } : {}) };
    return { phase: "rejected", principal, command: state.command, reason: "not_applied" };
  }
  return unresolved();
}
/** Current read observation only; never persisted as a clearance or source-access grant. */
export function hasBoundNativeTerminal(state: InvestigationSaveState, principal: string, command: InvestigationCommand): boolean {
  if (state.phase !== "rejected" || state.principal !== principal || state.reason !== "not_applied"
      || !sameJson(state.command,command) || !state.nativeObservation) return false;
  const native = parseInvestigationNativeReceipt(state.nativeObservation,command,ownerUserId(principal)||principal);
  return native?.native_phase === "retained" && native.canonical_status === "not_applied";
}
export function investigationNativeObservationLabel(state: InvestigationSaveState, lang: "en"|"zh"): string | null {
  if (state.phase === "idle" || !state.nativeObservation) return null;
  const native = state.nativeObservation;
  const phase = native.native_phase === "retained" ? (lang === "zh" ? "原来源保留写入已结束" : "Original source retention writes finished")
    : (lang === "zh" ? "原来源保留写入尚未确认结束" : "Original source retention writes are not confirmed finished");
  const canonical = {pending:lang === "zh"?"保存待确认":"save pending",committed:lang === "zh"?"保存已提交":"save committed",not_applied:lang === "zh"?"保存未执行":"save not applied"}[native.canonical_status];
  return `${phase} · ${canonical}. ${lang === "zh" ? "这不是当前私有来源访问权限。" : "This does not grant current private-source access."}`;
}
/**
 * True when a result-only receipt would satisfy the canonical side of an owner recheck. The receipt does not carry the action or
 * the layout capture, so only the full-request owner may confirm that it answers this exact request.
 */
export function receiptRequiresOwnerCheck(state: InvestigationSaveState, principal: string, response: unknown): boolean {
  if(state.phase!=="uncertain"||state.ownerRecheck!==true||state.principal!==principal)return false;
  const observed=settleInvestigationSave(state,principal,response);
  // A Scenario may remain uncertain for its independent native obligation.
  return observed.phase!=="uncertain"||observed.ownerRecheck!==true;
}
export function retryInvestigationSave(state: InvestigationSaveState, principal: string): InvestigationCommand | null {
  // A persisted local rejection is never proof of a fence; recovery rechecks the owner.
  if (state.phase !== "rejected" || state.reason !== "not_applied" || state.principal !== principal || mayHaveNativeCapture(state.command)) return null;
  const retained = parseInvestigationCommand(state.command, true);
  if (!retained) return null;
  // The original operation is already fenced. Only this new draft may adopt
  // the current shape; never rewrite an uncertain request or invent a clock.
  const manifest = (retained.action === "create" || retained.action === "revise")
    && !Object.hasOwn(retained.manifest, "argument_relations")
    ? { ...retained.manifest, argument_relations: [] }
    : retained.manifest;
  const command = parseInvestigationCommand({ ...retained, manifest });
  return command ? { ...command, operation_id: crypto.randomUUID() } : null;
}
/** The server judges only these identities: a role or an order change is not a correction. */
const referenceRefusals = new Set(["layout_conflict", "screen_conflict", "reference_unavailable"]);
const captureKey = (capture?: { layout_id: string; expected_revision: number }) => capture ? `${capture.layout_id}:${capture.expected_revision}` : "";
const screenCaptureKey = (capture?: InvestigationCommand["screen_capture"]) => capture ? `${capture.screen_id}:${capture.expected_revision}` : "";
const identities = <T>(items: readonly T[], key: (item: T) => string) => items.map(key).sort().join("\n");
const drafted = (command: InvestigationCommand) => command.action === "create" || command.action === "revise";
/**
 * A definitive layout_conflict or reference_unavailable refusal is final for that exact reference set:
 * sending it again unchanged can only be refused again. True when `command` would do exactly that in the
 * refused command's own lineage (any create after a refused create, or a revise of the same record).
 * A deliberate change of the layout or the Thesis versions allows one send; a new refusal re-arms this.
 */
export function resendsRefusedReferences(state: InvestigationSaveState, principal: string, command: InvestigationCommand): boolean {
  if (state.phase !== "rejected" || state.principal !== principal || !referenceRefusals.has(state.reason)) return false;
  const refused = state.command;
  if (!drafted(refused) || !drafted(command)) return false;
  // A create has a new id on every ordinary Save, so its lineage is the create action itself.
  const sameLineage = refused.action === "create" ? command.action === "create" : command.action === "revise" && command.id === refused.id;
  if (!sameLineage) return false;
  if (state.reason === "screen_conflict") return !!refused.screen_capture && screenCaptureKey(refused.screen_capture) === screenCaptureKey(command.screen_capture);
  if (captureKey(refused.layout_capture) !== captureKey(command.layout_capture)) return false;
  if (state.reason === "layout_conflict") return !!refused.layout_capture;
  if (screenCaptureKey(refused.screen_capture) !== screenCaptureKey(command.screen_capture)) return false;
  const layoutRef = (ref: InvestigationCommand["manifest"]["layout_refs"][number]) => `${ref.layout_id}|${ref.layout_revision_id}|${ref.digest}`;
  const screenRef = (ref: InvestigationCommand["manifest"]["evidence_refs"][number]) => `${ref.owner}|${ref.object_type}|${ref.object_id}|${ref.mode}|${ref.version_ref}|${ref.fingerprint}`;
  const screenRefs = (c: InvestigationCommand) => c.manifest.evidence_refs.filter(ref => ref.owner === "terminal.smart_screen");
  const thesisRef = (ref: InvestigationCommand["manifest"]["thesis_refs"][number]) => `${ref.thesis_id}|${ref.version_id}`;
  return identities(refused.manifest.layout_refs, layoutRef) === identities(command.manifest.layout_refs, layoutRef)
    && identities(refused.manifest.thesis_refs, thesisRef) === identities(command.manifest.thesis_refs, thesisRef)
    && identities(screenRefs(refused), screenRef) === identities(screenRefs(command), screenRef);
}
export const originalInvestigationOperationToRead = (state: InvestigationSaveState, principal: string) => investigationCommandToReconcile(state,principal);
export function investigationCommandToReconcile(state: InvestigationSaveState, principal: string): InvestigationCommand | null {
  return (state.phase === "pending" || state.phase === "uncertain") && state.principal === principal ? JSON.parse(JSON.stringify(state.command)) : null;
}
/** Body transport for instrumented native reads; legacy research GET stays scoped. */
export function investigationOperationReadRequest(command: InvestigationCommand, principal: string): {url:string;init?:RequestInit} {
  return mayHaveNativeCapture(command) ? {url:"/api/investigations/operation-read",init:{
    method:"POST",headers:{"Content-Type":"application/json","x-mm-scenario-owner":ownerUserId(principal)||principal},body:JSON.stringify(command),
  }} : {url:`/api/investigations?operation_id=${encodeURIComponent(command.operation_id)}`};
}
const mayHaveNativeCapture = (command: InvestigationCommand) =>
  (command.action === "create" || command.action === "revise") && command.manifest.scenario_capture !== undefined;
export function partitionInvestigationSave(state: InvestigationSaveState, principal: string | null): InvestigationSaveState {
  return state.phase === "idle" || state.principal === principal ? state : { phase: "idle" };
}
