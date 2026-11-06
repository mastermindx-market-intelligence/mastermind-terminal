/** Client recovery state only. The database operation receipt remains the sole retry authority. */
import { isInvestigationId, isInvestigationCommitted, isLegacyInvestigationCommitted, parseInvestigationCommand, type InvestigationCommand, type InvestigationCommitted } from "./investigations";
import { classifyInvestigationOperationReceipt } from "./investigationOperationReceipt";
import { ownerUserId } from "./accountIdentity";
export type InvestigationSaveState =
  | { phase: "idle" }
  | { phase: "pending" | "uncertain"; principal: string; command: InvestigationCommand; captureOutcome?: "unknown_after_canonical_not_applied"; canonicalResult?: InvestigationCommitted }
  | { phase: "committed"; principal: string; result: InvestigationCommitted; receiptBinding?: "native_lineage" | "legacy_recorded_completion" }
  | { phase: "rejected"; principal: string; command: InvestigationCommand; reason: string };
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i) => sameJson(v,b[i]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string,unknown>, right = b as Record<string,unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(k => Object.hasOwn(right,k) && sameJson(left[k],right[k]));
}
function matchesCommand(result: InvestigationCommitted, command: InvestigationCommand): boolean {
  if (!command.layout_capture) return sameJson(result.manifest,command.manifest);
  const refs = result.manifest.layout_refs;
  return refs.length === 1 && refs[0].layout_id === command.layout_capture.layout_id
    && refs[0].layout_revision_id === command.layout_capture.revision_id && refs[0].role === "primary"
    && sameJson({...result.manifest,layout_refs:[]},command.manifest);
}
const definitive = new Set(["invalid_payload", "version_conflict", "idempotency_conflict", "invalid_transition", "reference_unavailable", "layout_conflict", "limit_reached"]);
/** Local recovery is a draft buffer; only an owner receipt establishes a commit. */
export function recoverInvestigationSave(principal: string, raw: unknown): InvestigationSaveState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const saved = raw as Record<string, unknown>;
  if (saved.owner !== principal) return null;
  const command = parseInvestigationCommand(saved.command);
  if (!command) return null;
  if (saved.phase === "rejected" && typeof saved.reason === "string" && definitive.has(saved.reason)) {
    return { phase: "rejected", principal, command, reason: saved.reason };
  }
  return { phase: "uncertain", principal, command,
    ...(saved.capture_outcome === "unknown_after_canonical_not_applied" && mayHaveNativeCapture(command)
      ? { captureOutcome: "unknown_after_canonical_not_applied" as const } : {}) };
}
export function beginInvestigationSave(principal: string, raw: unknown, previous: InvestigationSaveState): InvestigationSaveState {
  previous = partitionInvestigationSave(previous, principal || null);
  if (!principal || previous.phase === "pending" || previous.phase === "uncertain") return previous;
  const command = parseInvestigationCommand(raw);
  // Detach caller memory: an edited draft must never change an already-sent operation.
  return command ? { phase: "pending", principal, command: JSON.parse(JSON.stringify(command)) } : previous;
}
export function settleInvestigationSave(state: InvestigationSaveState, principal: string, response: unknown): InvestigationSaveState {
  if (state.phase !== "pending" && state.phase !== "uncertain") return state;
  if (state.principal !== principal) return { phase: "idle" };
  if (isInvestigationCommitted(response) && response.id === state.command.id
    && response.revision === state.command.expected_revision + 1
    && response.lifecycle === (state.command.action === "remove" ? "removed" : "active")
    && matchesCommand(response,state.command)) {
    // Canonical commit is real recorded information, but does not settle an
    // independent producer phase already known to remain UNKNOWN.
    if (state.captureOutcome) return { phase: "uncertain", principal, command: state.command, captureOutcome: state.captureOutcome, canonicalResult: response };
    return { phase: "committed", principal, result: response };
  }
  const status = response !== null && typeof response === "object" ? (response as { status?: unknown }).status : null;
  // A late canonical refusal cannot settle the already-observed independent
  // native capture. Keep the original command and conservative retry fence.
  if (state.captureOutcome) return { phase: "uncertain", principal, command: state.command, captureOutcome: state.captureOutcome,
    ...(state.canonicalResult ? { canonicalResult: state.canonicalResult } : {}) };
  if (typeof status === "string" && definitive.has(status)) return { phase: "rejected", principal, command: state.command, reason: status };
  // not_found on receipt lookup, auth expiry, timeout and malformed replies are all inconclusive.
  return { phase: "uncertain", principal, command: state.command,
    ...(state.captureOutcome ? { captureOutcome: state.captureOutcome } : {}) };
}
/** Receipt reads have a stricter native lineage contract than incumbent POST replies.
 * A current authenticated read is an observation, never an implicit reconcile/retry.
 */
export function settleInvestigationOperationRead(state: InvestigationSaveState, principal: string, response: unknown): InvestigationSaveState {
  if (state.phase !== "pending" && state.phase !== "uncertain") return state;
  if (state.principal !== principal) return { phase: "idle" };
  const unresolved = () => settleInvestigationSave(state, principal, null);
  if (!response || typeof response !== "object" || Array.isArray(response)) return unresolved();
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
export function retryInvestigationSave(state: InvestigationSaveState, principal: string): InvestigationCommand | null {
  return (state.phase === "pending" || state.phase === "uncertain") && state.principal === principal && !state.captureOutcome ? JSON.parse(JSON.stringify(state.command)) : null;
}
export function originalInvestigationOperationToRead(state: InvestigationSaveState, principal: string): InvestigationCommand | null {
  return (state.phase === "pending" || state.phase === "uncertain") && state.principal === principal ? JSON.parse(JSON.stringify(state.command)) : null;
}
const mayHaveNativeCapture = (command: InvestigationCommand) =>
  (command.action === "create" || command.action === "revise") && command.manifest.scenario_capture !== undefined;
export function partitionInvestigationSave(state: InvestigationSaveState, principal: string | null): InvestigationSaveState {
  return state.phase === "idle" || state.principal === principal ? state : { phase: "idle" };
}
