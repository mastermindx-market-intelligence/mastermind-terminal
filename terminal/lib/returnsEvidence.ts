import { finite, isoDay, record, type ReturnBasis, type ReturnQuality, type ReturnsHorizon } from "./returnsIntelligence";
import { etDateOf } from "./intradaySources";

export type EvidenceState = "ready" | "absent" | "unavailable" | "access" | "mismatch" | "stale";
export type GexEvidence = { state: EvidenceState; asOf: string | null; netBn: number | null; flip: number | null; callWall: number | null; putWall: number | null; convention: string | null };
export type FlowEvidence = { state: EvidenceState; asOf: string | null; gross: number | null; events: number | null; callShare: number | null };
const scalar = (v: unknown) => finite(v) ? v : null;
const positive = (v: unknown) => finite(v) && v > 0 ? v : null;
function snapshotMatches(o: Record<string, unknown>, schema: string, symbol: string, session: string): boolean {
  if (o.schema !== schema || o.root !== symbol) return false;
  // GEX publishes a session day; live flow can publish an actual timestamp.
  // Use the existing source owner's New York conversion, never a UTC prefix.
  const day = isoDay(o.asof), stamp = day ? null : instant(o.asof);
  return (day ?? (stamp === null ? null : etDateOf(stamp))) === session;
}
export function gexEvidence(input: unknown, symbol: string, session: string): GexEvidence {
  const o = record(input), blank: GexEvidence = { state: "mismatch", asOf: null, netBn: null, flip: null, callWall: null, putWall: null, convention: null };
  if (!snapshotMatches(o, "options_hub.gex/v1", symbol, session)) return blank;
  return { state: o.stale === true ? "stale" : "ready", asOf: String(o.asof), netBn: scalar(o.net_gex_bn), flip: positive(o.gamma_flip), callWall: positive(o.call_wall), putWall: positive(o.put_wall), convention: typeof o.convention === "string" ? o.convention : null };
}
export function flowEvidence(input: unknown, symbol: string, session: string): FlowEvidence {
  const o = record(input), day = record(o.day), blank: FlowEvidence = { state: "mismatch", asOf: null, gross: null, events: null, callShare: null };
  if (!snapshotMatches(o, "live_flow.ticker/v1", symbol, session)) return blank;
  return { state: o.stale === true ? "stale" : "ready", asOf: String(o.asof), gross: finite(day.gross) && day.gross >= 0 ? day.gross : null,
    events: Number.isSafeInteger(day.n_events) && Number(day.n_events) >= 0 ? Number(day.n_events) : null, callShare: finite(day.call_share) && day.call_share >= 0 && day.call_share <= 1 ? day.call_share : null };
}

/** Contract for an admitted artifact from the existing forecasting/evaluation owner.
 * A UI indicator, options snapshot or retrospective seasonal win rate cannot satisfy it.
 */
export interface ReturnsForecast {
  schema: "returns.forecast.v1"; status: "ready"; symbol: string; asOf: string; basis: ReturnBasis;
  horizon: ReturnsHorizon; decisionCutoff: string; publishedAt: string; sourceMaxAvailableAt: string;
  event: { kind: "forward_close_return"; neutralBandPct: number };
  probabilities: { down: number; flat: number; up: number };
  quantilesPct: { p10: number; p50: number; p90: number };
  model: { id: string; version: string; trainedThrough: string; features: "price" | "price_options_flow" };
  validation: { method: "purged_walk_forward"; observations: number; effectiveObservations: number; folds: number;
    brier: number; baselineBrier: number; logLoss: number; baselineLogLoss: number;
    brierSkillCiLow: number; calibrationError: number; optionsAblationSkillCiLow: number | null;
    evaluatedThrough: string; prospectiveArchive: string; receiptSha256: string };
}
export type ForecastRead = { status: "ready"; forecast: ReturnsForecast } | { status: "abstain"; reasons: string[] };
/** Strict ISO timestamp: Date.parse alone silently normalizes some invalid dates. */
function instant(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m || !isoDay(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59) return null;
  if (m[5] !== "Z" && (Number(m[5].slice(1,3)) > 23 || Number(m[5].slice(4,6)) > 59)) return null;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : null;
}

export function qualifyReturnsForecast(input: unknown, expected: { symbol: string; asOf: string; basis: ReturnBasis; quality: ReturnQuality; horizon: ReturnsHorizon; now?: number }): ForecastRead {
  const o = record(input), reasons: string[] = [], validation = record(o.validation), model = record(o.model), event = record(o.event), p = record(o.probabilities), q = record(o.quantilesPct);
  if (o.status === "abstain") return { status: "abstain", reasons: Array.isArray(o.reasons) && o.reasons.some(r => typeof r === "string" && r) ? o.reasons.filter((r): r is string => typeof r === "string" && !!r).slice(0,12) : ["MODEL_ABSTAINED"] };
  if (o.schema !== "returns.forecast.v1" || o.status !== "ready") return { status: "abstain", reasons: ["NO_QUALIFIED_ARTIFACT"] };
  if (o.symbol !== expected.symbol || o.asOf !== expected.asOf || o.horizon !== expected.horizon || o.basis !== expected.basis) reasons.push("CONTEXT_MISMATCH");
  if (expected.quality !== "qualified" || expected.basis === "reported_price") reasons.push("PRICE_BASIS_UNQUALIFIED");
  const cutoff = instant(o.decisionCutoff), published = instant(o.publishedAt), available = instant(o.sourceMaxAvailableAt), trained = instant(model.trainedThrough), evaluated = instant(validation.evaluatedThrough);
  const now = expected.now ?? Date.now();
  if ([cutoff, published, available, trained, evaluated].some(t => t === null) || cutoff! > published! || published! > now || available! > cutoff! || trained! > cutoff! || evaluated! > cutoff!
    || (typeof o.decisionCutoff === "string" && o.decisionCutoff.slice(0,10) !== expected.asOf)) reasons.push("DECISION_CLOCK_INVALID");
  if (event.kind !== "forward_close_return" || !finite(event.neutralBandPct) || event.neutralBandPct <= 0) reasons.push("EVENT_UNDEFINED");
  const probabilities = [p.down, p.flat, p.up];
  if (!probabilities.every(v => finite(v) && v >= 0 && v <= 1) || Math.abs(probabilities.reduce<number>((s, n) => s + Number(n), 0) - 1) > 1e-6) reasons.push("INVALID_PROBABILITIES");
  if (![q.p10, q.p50, q.p90].every(finite) || Number(q.p10) < -100 || Number(q.p10) > Number(q.p50) || Number(q.p50) > Number(q.p90)) reasons.push("INVALID_QUANTILES");
  if (typeof model.id !== "string" || !model.id || typeof model.version !== "string" || !model.version || !["price", "price_options_flow"].includes(String(model.features))) reasons.push("MODEL_IDENTITY_MISSING");
  if (validation.method !== "purged_walk_forward" || !Number.isSafeInteger(validation.observations) || Number(validation.observations) < 200
    || !Number.isSafeInteger(validation.effectiveObservations) || Number(validation.effectiveObservations) < 100 || Number(validation.effectiveObservations) > Number(validation.observations)
    || !Number.isSafeInteger(validation.folds) || Number(validation.folds) < 3) reasons.push("VALIDATION_COVERAGE_INSUFFICIENT");
  if (![validation.brier, validation.baselineBrier, validation.logLoss, validation.baselineLogLoss, validation.brierSkillCiLow, validation.calibrationError].every(finite)
    || Number(validation.brier) < 0 || Number(validation.baselineBrier) <= 0 || Number(validation.brier) >= Number(validation.baselineBrier)
    || Number(validation.logLoss) < 0 || Number(validation.logLoss) >= Number(validation.baselineLogLoss)
    || Number(validation.brierSkillCiLow) <= 0 || Number(validation.calibrationError) < 0 || Number(validation.calibrationError) > 0.1) reasons.push("NO_QUALIFIED_OUT_OF_SAMPLE_SKILL");
  if (model.features === "price_options_flow" && (!finite(validation.optionsAblationSkillCiLow) || validation.optionsAblationSkillCiLow <= 0)) reasons.push("OPTIONS_INCREMENT_NOT_QUALIFIED");
  if (typeof validation.prospectiveArchive !== "string" || !validation.prospectiveArchive || typeof validation.receiptSha256 !== "string" || !/^[a-f0-9]{64}$/.test(validation.receiptSha256)) reasons.push("VALIDATION_RECEIPT_MISSING");
  // The seasonal artifact is display-only. No canonical Returns model promotion
  // binding has been published. Producer-supplied metrics, IDs, hashes or Boolean
  // claims cannot independently admit their own forecast. There is deliberately
  // no environment-variable or client flag that unlocks this path.
  reasons.push("CANONICAL_MODEL_ADMISSION_NOT_PUBLISHED");
  return { status: "abstain", reasons };
}
