/** Client recovery state only. The database operation receipt remains the sole retry authority. */
import { matchesInvestigationCommand, parseInvestigationCommand, type InvestigationCommand, type InvestigationCommitted } from "./investigations";
export type InvestigationSaveState =
  | { phase: "idle" }
  | { phase: "pending"; principal: string; command: InvestigationCommand }
  // ownerRecheck: a receipt read alone may not settle this state; the full-request owner must answer first.
  | { phase: "uncertain"; principal: string; command: InvestigationCommand; ownerRecheck?: true }
  | { phase: "committed"; principal: string; result: InvestigationCommitted }
  | { phase: "rejected"; principal: string; command: InvestigationCommand; reason: string };
const definitive = new Set(["invalid_payload", "version_conflict", "idempotency_conflict", "invalid_transition", "reference_unavailable", "layout_conflict", "limit_reached"]);
/** Local recovery is a draft buffer; only an owner receipt establishes a commit. */
export function recoverInvestigationSave(principal: string, raw: unknown): InvestigationSaveState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const saved = raw as Record<string, unknown>;
  if (saved.owner !== principal) return null;
  const command = parseInvestigationCommand(saved.command, true);
  if (!command) return null;
  // Before the legacy POST cutover the route refused a retried legacy request with invalid_payload before it
  // asked the owner, so that stored refusal never proved the original failed: it may already have committed.
  if (saved.phase === "rejected" && saved.reason === "invalid_payload") return { phase: "uncertain", principal, command, ownerRecheck: true };
  if (saved.phase === "rejected" && typeof saved.reason === "string" && definitive.has(saved.reason)) {
    return { phase: "rejected", principal, command, reason: saved.reason };
  }
  return { phase: "uncertain", principal, command };
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
  if (matchesInvestigationCommand(response,state.command)) return { phase: "committed", principal, result: response };
  const status = response !== null && typeof response === "object" ? (response as { status?: unknown }).status : null;
  if (status === "not_applied" && (response as {id?:unknown}).id === state.command.id && (response as {operation_id?:unknown}).operation_id === state.command.operation_id) {
    // A stored fence permits a new operation. The receipt-cap answer is just as final for the
    // original, but it permits nothing new, so it keeps its own reason. Unknown reasons stay uncertain.
    const reason = (response as {reason?:unknown}).reason;
    if (reason === undefined) return {phase:"rejected",principal,command:state.command,reason:"not_applied"};
    if (reason === "limit_reached") return {phase:"rejected",principal,command:state.command,reason:"limit_reached"};
  }
  if (state.phase === "pending" && typeof status === "string" && definitive.has(status)) return { phase: "rejected", principal, command: state.command, reason: status };
  // not_found on receipt lookup, auth expiry, timeout and malformed replies are all inconclusive.
  return state.phase === "uncertain" && state.ownerRecheck ? { phase: "uncertain", principal, command: state.command, ownerRecheck: true } : { phase: "uncertain", principal, command: state.command };
}
/**
 * True when a result-only receipt read would settle an owner recheck. The receipt does not carry the action or
 * the layout capture, so only the full-request owner may confirm that it answers this exact request.
 */
export function receiptRequiresOwnerCheck(state: InvestigationSaveState, principal: string, response: unknown): boolean {
  return state.phase === "uncertain" && state.ownerRecheck === true && state.principal === principal
    && settleInvestigationSave(state, principal, response).phase !== "uncertain";
}
export function retryInvestigationSave(state: InvestigationSaveState, principal: string): InvestigationCommand | null {
  // A persisted local rejection is never proof of a fence; recovery rechecks the owner.
  if (state.phase !== "rejected" || state.reason !== "not_applied" || state.principal !== principal) return null;
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
const referenceRefusals = new Set(["layout_conflict", "reference_unavailable"]);
const captureKey = (capture?: { layout_id: string; expected_revision: number }) => capture ? `${capture.layout_id}:${capture.expected_revision}` : "";
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
  if (!sameLineage || captureKey(refused.layout_capture) !== captureKey(command.layout_capture)) return false;
  if (state.reason === "layout_conflict") return !!refused.layout_capture;
  const layoutRef = (ref: InvestigationCommand["manifest"]["layout_refs"][number]) => `${ref.layout_id}|${ref.layout_revision_id}|${ref.digest}`;
  const thesisRef = (ref: InvestigationCommand["manifest"]["thesis_refs"][number]) => `${ref.thesis_id}|${ref.version_id}`;
  return identities(refused.manifest.layout_refs, layoutRef) === identities(command.manifest.layout_refs, layoutRef)
    && identities(refused.manifest.thesis_refs, thesisRef) === identities(command.manifest.thesis_refs, thesisRef);
}
export function investigationCommandToReconcile(state: InvestigationSaveState, principal: string): InvestigationCommand | null {
  return (state.phase === "pending" || state.phase === "uncertain") && state.principal === principal ? JSON.parse(JSON.stringify(state.command)) : null;
}
export function partitionInvestigationSave(state: InvestigationSaveState, principal: string | null): InvestigationSaveState {
  return state.phase === "idle" || state.principal === principal ? state : { phase: "idle" };
}
