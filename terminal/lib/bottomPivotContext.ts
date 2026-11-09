/** Read-only consumer of Macro PR10785's bottom_pivot_context.v1.
 * No indicators, voting, ranking, eligibility, probability or trading authority.
 * Rechecks source clocks at inspection; a refreshed outer payload never refreshes a fact.
 */
export const PIVOT_FIELDS = [
  "trigger_tier", "trigger_age_ticks", "coiled", "star", "coiled_fire", "above200",
  "hold_state", "hold_days_basing", "hold_ret_since_anchor_pct", "knife_score",
  "dist_21d_low_pct", "dist_126d_high_pct", "sponsorship_state",
] as const;
export type PivotField = typeof PIVOT_FIELDS[number];
export const PIVOT_STATES = ["observed", "missing", "stale", "future", "conflict", "invalid", "not_known"] as const;
export type PivotState = typeof PIVOT_STATES[number];
export type PivotEvidence = {
  field: PivotField; state: PivotState; value: string | number | boolean | null;
  source: string | null; asOf: string | null; availableAt: string | null;
};
export type BottomPivotView =
  | { kind: "unavailable"; reason: "feed" | "not_covered" | "duplicate" | "contract" | "clock" }
  | { kind: "evidence"; symbol: string; mode: "current_snapshot" | "as_issued";
      decisionAt: string; inspectedAt: string; quality: "available" | "partial" | "unavailable";
      observed: number; fields: PivotEvidence[]; firstSeenUnknown: boolean };

const DAY_MS = 86_400_000;
// The incumbent producer calls compose_pivot_context with its v1 default: seven
// NEW YORK CALENDAR days, not trading sessions. Do not turn these into live quotes.
const MAX_AGE_DAYS = 7;
const NY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const record = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
const text = (x: unknown, max = 512): string | null =>
  typeof x === "string" && x.trim().length > 0 && x.length <= max ? x : null;

function day(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (Number(value.slice(0, 4)) < 1) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY_MS : null;
}
function instant(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (value.length > 64 || Number(value.slice(11, 13)) > 23 || day(value.slice(0, 10)) === null) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function nyDay(ms: number): number | null {
  const parts = NY.formatToParts(ms);
  const part = (kind: string) => parts.find(p => p.type === kind)?.value;
  return day(`${part("year")}-${part("month")}-${part("day")}`);
}
function validValue(field: PivotField, value: unknown): value is string | number | boolean {
  if (["coiled", "star", "coiled_fire", "above200"].includes(field)) return typeof value === "boolean";
  if (field === "trigger_tier") return typeof value === "string" && ["T1", "T2", "T3", "T4"].includes(value);
  if (field === "hold_state" || field === "sponsorship_state") {
    return text(value, 80) !== null && !(field === "sponsorship_state" && ["unknown", "unavailable"].includes((value as string).trim().toLowerCase()));
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (field === "trigger_age_ticks" || field === "hold_days_basing") return Number.isSafeInteger(value) && value >= 0;
  if (field === "knife_score") return value >= 0 && value <= 1;
  return field === "hold_ret_since_anchor_pct" || value >= 0;
}

/** Total over untrusted JSON. A caller provides the actual inspection clock. */
export function parseBottomPivotContext(raw: unknown, requestedSymbol: string, nowMs: number): BottomPivotView {
  const unavailable = (reason: Extract<BottomPivotView, { kind: "unavailable" }> ["reason"]): BottomPivotView => ({ kind: "unavailable", reason });
  if (!Number.isFinite(nowMs) || !Number.isFinite(new Date(nowMs).getTime())) return unavailable("clock");
  const symbol = requestedSymbol.trim().toUpperCase();
  if (!symbol || symbol.length > 32) return unavailable("contract");
  const outer = record(raw);
  if (!outer || outer.is_display_only !== true || !Array.isArray(outer.rows) || outer.rows.length > 20_000) return unavailable("feed");
  const matches = outer.rows.map(record).filter(row => row?.symbol === symbol);
  if (!matches.length) return unavailable("not_covered");
  if (matches.length !== 1) return unavailable("duplicate");
  const ctx = record(matches[0]?.pivot_context);
  if (!ctx || ctx.schema !== "bottom_pivot_context.v1" || ctx.symbol !== symbol ||
      ctx.scope !== "single_security" || ctx.cadence !== "daily" || ctx.is_display_only !== true ||
      ctx.action_authority !== "none" || ctx.probability !== null ||
      typeof ctx.evidence_mode !== "string" || !["current_snapshot", "as_issued"].includes(ctx.evidence_mode) ||
      !Array.isArray(ctx.evidence) || ctx.evidence.length > 64) return unavailable("contract");
  const decisionMs = instant(ctx.decision_at);
  if (decisionMs === null || decisionMs > nowMs) return unavailable("clock");
  const decisionDay = nyDay(decisionMs), currentDay = nyDay(nowMs);
  if (decisionDay === null || currentDay === null) return unavailable("clock");
  const mode = ctx.evidence_mode as "current_snapshot" | "as_issued";
  // Unknown keys never become claims. Missing/duplicate allowlisted entries are
  // rejected individually; an outer `quality: available` cannot conceal them.
  const entries = ctx.evidence.map(record);
  const fields: PivotEvidence[] = PIVOT_FIELDS.map(field => {
    const rows = entries.filter(row => row?.field === field);
    const row = rows.length === 1 ? rows[0] : null;
    const base: PivotEvidence = { field, state: rows.length > 1 ? "conflict" : "missing", value: null,
      source: text(row?.source), asOf: text(row?.as_of, 10), availableAt: text(row?.available_at, 64) };
    if (!row) return base;
    if (!PIVOT_STATES.includes(row.state as PivotState)) return { ...base, state: "invalid" };
    base.state = row.state as PivotState;
    // A consumer may invalidate an observation, never promote a rejected one.
    if (base.state !== "observed") return base;
    const vintage = day(row.as_of);
    const availableMs = row.available_at === null ? null : instant(row.available_at);
    const reject = (state: PivotState): PivotEvidence => ({ ...base, state });
    if (!base.source || vintage === null || (row.available_at !== null && availableMs === null)) return reject("invalid");
    if (vintage > decisionDay || (availableMs !== null && availableMs > decisionMs)) return reject("future");
    if (availableMs !== null && (nyDay(availableMs) ?? -Infinity) < vintage) return reject("invalid");
    if (decisionDay - vintage > MAX_AGE_DAYS || (mode === "current_snapshot" && currentDay - vintage > MAX_AGE_DAYS)) return reject("stale");
    if (!validValue(field, row.value)) return reject("invalid");
    if (mode === "as_issued" && availableMs === null) return reject("not_known");
    return { ...base, value: row.value };
  });
  const observed = fields.filter(field => field.state === "observed").length;
  return { kind: "evidence", symbol, mode, decisionAt: ctx.decision_at as string,
    inspectedAt: new Date(nowMs).toISOString(), observed,
    quality: observed === 0 ? "unavailable" : observed === PIVOT_FIELDS.length ? "available" : "partial",
    fields, firstSeenUnknown: fields.some(field => field.state === "observed" && field.availableAt === null) };
}
