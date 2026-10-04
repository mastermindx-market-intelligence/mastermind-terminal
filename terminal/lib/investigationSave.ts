/** Client recovery state only. The database operation receipt remains the sole retry authority. */
import { isInvestigationCommitted, parseInvestigationCommand, type InvestigationCommand, type InvestigationCommitted } from "./investigations";
export type InvestigationSaveState =
  | { phase: "idle" }
  | { phase: "pending" | "uncertain"; principal: string; command: InvestigationCommand }
  | { phase: "committed"; principal: string; result: InvestigationCommitted }
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
    && matchesCommand(response,state.command)) return { phase: "committed", principal, result: response };
  const status = response !== null && typeof response === "object" ? (response as { status?: unknown }).status : null;
  if (typeof status === "string" && definitive.has(status)) return { phase: "rejected", principal, command: state.command, reason: status };
  // not_found on receipt lookup, auth expiry, timeout and malformed replies are all inconclusive.
  return { phase: "uncertain", principal, command: state.command };
}
export function retryInvestigationSave(state: InvestigationSaveState, principal: string): InvestigationCommand | null {
  return (state.phase === "pending" || state.phase === "uncertain") && state.principal === principal ? JSON.parse(JSON.stringify(state.command)) : null;
}
export function partitionInvestigationSave(state: InvestigationSaveState, principal: string | null): InvestigationSaveState {
  return state.phase === "idle" || state.principal === principal ? state : { phase: "idle" };
}
