import "server-only";
import { parseScenarioCapture, type ScenarioCapture } from "./investigationScenario";
import { parseScenarioNativeIntent, requestNativeScenario } from "./scenarioNative";
import { readScenarioSession } from "./scenarioSessionServer";

export type ScenarioCaptureSaveRefusal = "invalid_source_reference" | "source_context_unavailable"
  | "source_authorization_unavailable" | "source_unavailable";
export type ScenarioCaptureSaveQualification = { ok: true; capture: ScenarioCapture }
  | { ok: false; reason: ScenarioCaptureSaveRefusal };
export type ScenarioSaveContext = {
  id: string; expected_revision: number; operation_id: string; action: "create" | "revise"; initial_capture?: boolean;
};

/** Initially capture, or read-only recover, exact source under the SAME verified owner.
 * Initial capture has separate native Save/retention checks; absent bindings refuse.
 * Recovery never repeats retention. This qualifies neither canonical write nor grant.
 * Native current source-use/destination checks,
 * exact byte/native TS verification and the canonical apply RPC remain independent gates.
 * Protected basis/results are discarded here and never reach a generic manifest or journal.
 */
export async function qualifyScenarioCaptureSave(capture: unknown, principal: string,
  context?: ScenarioSaveContext): Promise<ScenarioCaptureSaveQualification> {
  const parsed = parseScenarioCapture(capture);
  if (!parsed) return { ok: false, reason: "invalid_source_reference" };
  if (typeof principal !== "string" || !principal.trim()) return { ok: false, reason: "source_authorization_unavailable" };
  if (!context || (context.action === "create" ? context.expected_revision !== 0
    : context.action !== "revise" || context.expected_revision < 1)) return { ok: false, reason: "source_context_unavailable" };
  const intent = parseScenarioNativeIntent({ mode: context.initial_capture === true ? "capture" : "qualify", investigation_id: context.id,
    revision: context.expected_revision+1, grant_id: null, expected_revision: context.expected_revision,
    operation_id: context.operation_id, capture: parsed });
  if (!intent) return { ok: false, reason: "source_context_unavailable" };
  const session = await readScenarioSession(principal);
  if (session.status !== "ok") return { ok: false, reason: "source_authorization_unavailable" };
  const resolved = await requestNativeScenario(intent, session.token);
  if (resolved.status !== "resolved") return { ok: false, reason: "source_unavailable" };
  return { ok: true, capture: resolved.capture };
}
