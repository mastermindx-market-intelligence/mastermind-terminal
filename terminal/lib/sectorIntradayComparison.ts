/** Catalyst intraday comparison — the authenticated Terminal consumer of Macro's accepted
 * `basket_intraday_comparison.v1`, read per basket out of the existing basket-pulse owner file.
 *
 * This module decodes and qualifies only. It never computes a comparative financial metric,
 * never reconstructs a number from quotes and never invents one: every rendered figure is the
 * owner's own admitted value, and an unknown stays unknown rather than becoming 0, a blank or a
 * positive claim. Coherence between owner fields is checked so an incoherent row fails closed,
 * but the owner value is what is displayed.
 *
 * The interval is named by the benchmark's two source clocks, never by polling cadence, and
 * those clocks keep their full precision everywhere downstream. A `retained` settled closing
 * row is the same observation redelivered — never a new event — which is why `delivery_state`
 * and `is_new_observation` are read together and required to agree.
 */

export const INTRADAY_COMPARISON_SCHEMA = "basket_intraday_comparison.v1" as const;
export const INTRADAY_BASKET_PULSE_SCHEMA = "basket_pulse.v1" as const;
export const INTRADAY_BENCHMARK = "SPY" as const;
export const INTRADAY_METHOD = "matched_member_equal_weight" as const;

export type IntradayObservationKind = "regular" | "settled_regular";
/** Every owner status token `build_basket_pulse._intraday_comparisons` can emit. The set is
 * closed on purpose: a token the producer adds later is a contract change, not a new reason. */
export const INTRADAY_OWNER_STATUSES = [
  "observed",
  "membership_changed",
  "insufficient_matched_coverage",
  "invalid_return",
  "unsupported_session",
  "invalid_evaluation_clock",
  "outside_regular_session",
  "baseline_missing",
  "baseline_invalid",
  "session_boundary",
  "baseline_nonadvancing",
  "baseline_corrected",
  "benchmark_unavailable",
  "benchmark_nonadvancing",
  "benchmark_basis_changed",
  "benchmark_invalid_return",
] as const;
export type IntradayOwnerStatus = typeof INTRADAY_OWNER_STATUSES[number];

/** Presentation classes. The owner status stays attached; this only chooses the sentence. */
export type IntradayReason =
  | "clock_disagreement" | "stale" | "unverified" | "awaiting" | "reset" | "no_session" | "unavailable" | "absent";

/** Lexical pairs for every reason the panel can render. */
export const INTRADAY_REASON_LEX: Record<IntradayReason, [string, string]> = {
  absent: ["No interval comparison was supplied.", "未提供区间比较。"],
  clock_disagreement: ["Source and device clocks disagree.", "行情与设备时钟不一致。"],
  stale: ["Observation is no longer current.", "观测已过期。"],
  unverified: ["Observation could not be verified.", "无法确认此观测。"],
  awaiting: ["Waiting for another observation.", "等待新的观测。"],
  reset: ["Comparison reset after a source change.", "数据变更后，正在重新建立比较。"],
  no_session: ["No comparable regular-session interval.", "暂无可比较的常规时段区间。"],
  unavailable: ["Comparable observations are unavailable.", "暂无可比较的观测。"],
};

/** The accepted presentation classes for every non-observed owner status. */
export const OWNER_STATUS_REASON: Record<Exclude<IntradayOwnerStatus, "observed">, IntradayReason> = {
  baseline_missing: "awaiting",
  baseline_nonadvancing: "awaiting",
  benchmark_nonadvancing: "awaiting",
  membership_changed: "reset",
  session_boundary: "reset",
  benchmark_basis_changed: "reset",
  baseline_corrected: "reset",
  unsupported_session: "no_session",
  outside_regular_session: "no_session",
  baseline_invalid: "unavailable",
  invalid_evaluation_clock: "unavailable",
  benchmark_unavailable: "unavailable",
  benchmark_invalid_return: "unavailable",
  insufficient_matched_coverage: "unavailable",
  invalid_return: "unavailable",
};

export interface IntradayClock {
  referenceAsOf: string;
  sourceAsOf: string;
  elapsedMinutes: number;
  sessionDate: string;
  maxClockSkewSeconds: number;
  /** Seconds between the two benchmark source clocks — the observed interval, not a poll interval. */
  elapsedSeconds: number;
  /** Seconds from the observed endpoint to the caller's clock; negative means the source is ahead. */
  ageSeconds: number;
}

export interface IntradayExclusion { reason: string; count: number }

export interface IntradayCoverage {
  matchedMembers: number;
  totalMembers: number;
  coveragePct: number;
  excluded: IntradayExclusion[];
}

interface IntradayCommon {
  /** The owner basket identity, verbatim. No localized basket-name source is connected here, so
   * the id is what a reader sees rather than a translated label we would have had to invent. */
  basketId: string;
  ownerStatus: IntradayOwnerStatus;
  observationKind: IntradayObservationKind;
  settlementToleranceSeconds: number;
  /** Null when the owner emitted no interval for this basket — an unknown interval, not a zero one. */
  clock: IntradayClock | null;
  /** Null when the owner emitted no coverage for this basket — unknown coverage is never 0%. */
  coverage: IntradayCoverage | null;
  /** The owner's separate whole-day equal-weight change, on its own clock. Null when the owner
   * field is absent or unusable. It is never folded into the observed interval. */
  dayChangePct: number | null;
}

/** A verified observation. Every number here is the owner's own admitted value. */
export interface IntradayObservedRow extends IntradayCommon {
  outcome: "observed";
  ownerStatus: "observed";
  deliveryState: "new" | "retained";
  isNewObservation: boolean;
  absoluteChangePct: number;
  benchmarkChangePct: number;
  relativeChangePct: number;
  positiveRelativeBreadthPct: number;
}

/** A qualified row: the owner stated why, or our own gate could not verify it. No numbers.
 * `reason` is the presentation class for that qualified state — the owner status stays attached
 * on `ownerStatus` so nothing about the owner's own wording is lost. */
export interface IntradayUnqualifiedRow extends IntradayCommon {
  outcome: "unqualified" | "unverified";
  reason: IntradayReason;
  /** Present only when an observed row passed delivery validation before its age qualification. */
  deliveryState?: "new" | "retained";
  isNewObservation?: boolean;
}

export type IntradayRow = IntradayObservedRow | IntradayUnqualifiedRow;

/** Consumer availability, separate from a validated owner status. An absent or invalid
 * comparison carries no invented owner evidence and no financial figure. */
export interface IntradayUnavailableRow {
  basketId: string;
  outcome: "absent" | "invalid";
  reason: "absent" | "unverified";
  dayChangePct: null;
}
export type IntradayReadRow = IntradayRow | IntradayUnavailableRow;

export interface IntradayRead {
  schema: typeof INTRADAY_BASKET_PULSE_SCHEMA;
  market: string;
  session: string | null;
  built: string | null;
  /** Evaluation/build time; never a quote observation clock. */
  asOfUtc: string | null;
  quoteSourceAsOf: string | null;
  quoteBarDate: string | null;
  /** Every admitted basket identity, in producer order, including absent/invalid comparisons. */
  rows: IntradayReadRow[];
  /** Baskets that actually carry a comparison object at all. Zero means the producer has not
   * emitted this capability in the current build — an absent capability, not a failure. */
  presentCount: number;
  totalBaskets: number;
}

const KEY = /^[a-z][a-z0-9_-]{0,79}$/;
const ZONED = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const EXCLUSION_REASON = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_BASKETS = 500;
const MAX_EXCLUSIONS = 16;
/** Owner's minimum matched coverage (`MIN_COVERAGE = 0.30`) and the accepted presentation's
 * bound on how old an observation may be before it stops being current. */
const MIN_COVERAGE_PCT = 30;
const MAX_AGE_MS = 45 * 60_000;
const MAX_CHANGE_PCT = 40;
const MAX_SKEW_SECONDS = 60;
const SETTLED_TOLERANCE_SECONDS = 90;
/** The owner rounds coverage to 3 decimals and the accepted presentation tolerates 0.001. */
const COVERAGE_TOLERANCE = 0.001;
/** The owner derives relative from absolute and benchmark; the accepted presentation allows 3e-6. */
const RELATIVE_TOLERANCE = 3e-6;
const ELAPSED_TOLERANCE = 1e-6;
const CLOCK_KEYS = ["reference_asof", "source_asof", "elapsed_minutes", "session_date"] as const;
const COVERAGE_KEYS = ["matched_members", "total_members", "coverage_pct"] as const;

const isRow = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const whole = (value: unknown): value is number => Number.isSafeInteger(value);

const sessionDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

function ownerStatus(value: unknown): IntradayOwnerStatus | null {
  return INTRADAY_OWNER_STATUSES.includes(value as IntradayOwnerStatus) ? value as IntradayOwnerStatus : null;
}

function observationKind(value: unknown): IntradayObservationKind | null {
  return value === "regular" || value === "settled_regular" ? value : null;
}

type Read<T> = { ok: true; value: T } | { ok: false };

/** The two benchmark source clocks, kept at full precision. Either every clock field is readable
 * and mutually coherent, or the row has no interval at all — a partial clock is incoherent, never
 * a zero-length interval. */
function readClock(row: Record<string, unknown>, nowMs: number): Read<IntradayClock | null> {
  const present = CLOCK_KEYS.filter(key => Object.hasOwn(row, key)).length;
  if (present === 0) return { ok: true, value: null };
  if (present !== CLOCK_KEYS.length) return { ok: false };
  const { reference_asof: reference, source_asof: source } = row;
  const elapsedMinutes = row.elapsed_minutes, sessionDate = row.session_date, skew = row.max_clock_skew_seconds;
  if (typeof reference !== "string" || typeof source !== "string" || !ZONED.test(reference) || !ZONED.test(source)) return { ok: false };
  const start = Date.parse(reference), end = Date.parse(source);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { ok: false };
  if (!finite(elapsedMinutes) || typeof sessionDate !== "string" || !ISO_DAY.test(sessionDate)) return { ok: false };
  const elapsedSeconds = (end - start) / 1000;
  if (Math.abs(elapsedMinutes - elapsedSeconds / 60) > ELAPSED_TOLERANCE) return { ok: false };
  if (sessionDay.format(new Date(end)) !== sessionDate) return { ok: false };
  // Match the producer's millisecond arithmetic before converting to seconds.
  // Reordered divisions can reject its exact bound by one floating-point step.
  const maxAllowedSkewSeconds = Math.min(MAX_SKEW_SECONDS * 1000, (end - start) / 10) / 1000;
  if (!finite(skew) || skew < 0 || skew > maxAllowedSkewSeconds) return { ok: false };
  return { ok: true, value: { referenceAsOf: reference, sourceAsOf: source, elapsedMinutes, sessionDate,
    maxClockSkewSeconds: skew, elapsedSeconds, ageSeconds: (nowMs - end) / 1000 } };
}

/** Matched/total coverage. Absent coverage is unknown, never 0/0. */
function readCoverage(row: Record<string, unknown>): Read<IntradayCoverage | null> {
  const present = COVERAGE_KEYS.filter(key => Object.hasOwn(row, key)).length;
  if (present === 0) return { ok: true, value: null };
  if (present !== COVERAGE_KEYS.length) return { ok: false };
  const matched = row.matched_members, total = row.total_members, coveragePct = row.coverage_pct;
  if (!whole(matched) || !whole(total) || matched < 0 || total <= 0 || total < matched) return { ok: false };
  if (!finite(coveragePct) || coveragePct < 0 || coveragePct > 100) return { ok: false };
  if (Math.abs(coveragePct - (100 * matched) / total) > COVERAGE_TOLERANCE) return { ok: false };
  const excluded: IntradayExclusion[] = [];
  const raw = row.excluded;
  if (raw !== undefined && raw !== null) {
    if (!isRow(raw)) return { ok: false };
    const entries = Object.entries(raw);
    if (entries.length > MAX_EXCLUSIONS) return { ok: false };
    let counted = 0;
    for (const [key, value] of entries) {
      if (!EXCLUSION_REASON.test(key) || !whole(value) || value < 0) return { ok: false };
      excluded.push({ reason: key, count: value });
      counted += value;
    }
    // Every member is either matched or carries exactly one exclusion reason.
    if (counted + matched !== total) return { ok: false };
    excluded.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  } else if (matched !== total) return { ok: false };
  return { ok: true, value: { matchedMembers: matched, totalMembers: total, coveragePct, excluded } };
}

/** Recency is a qualification, not a deletion: an old or future endpoint keeps its owner status and
 * its clocks, and loses only the claim that it is current. */
function ageReason(clock: IntradayClock | null): IntradayReason | null {
  if (!clock) return null;
  if (clock.ageSeconds < 0) return "clock_disagreement";
  if (clock.ageSeconds * 1000 > MAX_AGE_MS) return "stale";
  return null;
}

/** Read exactly one owner's per-basket comparison. Returns null when the row cannot be admitted —
 * the caller then renders a bounded unavailable message instead of any number.
 *
 * `basketId` is carried onto the row so a reader can see which cohort a number belongs to; it is
 * never used to look anything else up. */
export function readIntradayComparison(basketId: string, raw: unknown, nowMs: number): IntradayRow | null {
  if (!isRow(raw)) return null;
  if (raw.schema !== INTRADAY_COMPARISON_SCHEMA) return null;
  if (raw.benchmark !== INTRADAY_BENCHMARK || raw.method !== INTRADAY_METHOD) return null;
  const status = ownerStatus(raw.status);
  if (!status) return null;
  const kind = observationKind(raw.observation_kind);
  if (!kind) return null;
  const tolerance = raw.settlement_tolerance_seconds;
  if (!finite(tolerance) || tolerance < 0) return null;
  if (kind === "settled_regular" && tolerance !== SETTLED_TOLERANCE_SECONDS) return null;

  const clock = readClock(raw, nowMs);
  if (!clock.ok) return null;
  const coverage = readCoverage(raw);
  if (!coverage.ok) return null;
  // An observed comparison always carries its interval and enough matched members to mean anything.
  if (status === "observed" && (!clock.value || !coverage.value || coverage.value.coveragePct < MIN_COVERAGE_PCT)) return null;

  const shared = { basketId, observationKind: kind, settlementToleranceSeconds: tolerance,
    clock: clock.value, coverage: coverage.value, dayChangePct: null };

  if (status !== "observed") {
    // Qualified, with the owner's own token attached. There is no number to render here at all.
    return { ...shared, ownerStatus: status, outcome: "unqualified", reason: OWNER_STATUS_REASON[status] };
  }
  const common = { ...shared, ownerStatus: "observed" as const };

  const deliveryState = raw.delivery_state;
  if (deliveryState !== "new" && deliveryState !== "retained") return null;
  const isNewObservation = raw.is_new_observation;
  if (typeof isNewObservation !== "boolean") return null;
  // A measurement is not an event delivery. Redelivery and novelty must never disagree.
  if ((deliveryState === "new") !== isNewObservation) return null;
  const absolute = raw.absolute_change_pct, benchmark = raw.benchmark_change_pct;
  const relative = raw.relative_change_pct, breadth = raw.positive_relative_breadth_pct;
  if (!finite(absolute) || !finite(benchmark) || !finite(relative) || !finite(breadth)) return null;
  if (Math.abs(absolute) > MAX_CHANGE_PCT || Math.abs(benchmark) > MAX_CHANGE_PCT || Math.abs(relative) > MAX_CHANGE_PCT) return null;
  if (breadth < 0 || breadth > 100) return null;
  // Coherence check only — the owner value is what a reader sees, never a recomputation.
  if (Math.abs(100 * ((1 + absolute / 100) / (1 + benchmark / 100) - 1) - relative) > RELATIVE_TOLERANCE) return null;
  // An endpoint that is stale or ahead of this device is not a current observation. The row keeps
  // its owner status and both clocks; only the claim that it is current is withdrawn.
  const aged = ageReason(clock.value);
  if (aged) return { ...common, outcome: "unverified", reason: aged, deliveryState, isNewObservation };
  return { ...common, outcome: "observed", deliveryState, isNewObservation,
    absoluteChangePct: absolute, benchmarkChangePct: benchmark,
    relativeChangePct: relative, positiveRelativeBreadthPct: breadth };
}

/** The owner's separate whole-day equal-weight change. A different clock from the observed
 * interval; it is never folded into it, and an unusable field simply stays absent. */
export function readDayChangePct(basket: unknown): number | null {
  if (!isRow(basket)) return null;
  const value = basket.live_ew_chg_pct;
  return finite(value) && Math.abs(value) <= MAX_CHANGE_PCT ? value : null;
}

/** Envelope admission for the transport gate.
 *
 * This admits the basket-pulse contract itself, not its comparisons: a build that has not started
 * emitting `intraday_comparison` yet is still a readable owner envelope whose capability is simply
 * absent. Deciding that per basket is the reader's job, never the gate's. */
export function sectorIntradayEnvelope(data: unknown): boolean {
  if (!isRow(data)) return false;
  if (data.schema !== INTRADAY_BASKET_PULSE_SCHEMA || data.market !== "us") return false;
  if (!Array.isArray(data.baskets) || data.baskets.length > MAX_BASKETS) return false;
  const ids = new Set<string>();
  for (const value of data.baskets) {
    if (!isRow(value) || typeof value.id !== "string" || !KEY.test(value.id) || ids.has(value.id)) return false;
    ids.add(value.id);
  }
  return true;
}

/** The envelope's actual quote clock. Build and transport clocks cannot substitute for it.
 * A date-only quote value is a bar date, not a precise source observation. */
export function readIntradaySourceStamp(data: unknown): string | null {
  if (!isRow(data)) return null;
  for (const value of [data.source_asof, data.as_of_quotes]) {
    if (typeof value === "string" && ZONED.test(value) && Number.isFinite(Date.parse(value))) return value;
  }
  return null;
}

/** Read the whole basket-pulse envelope. Returns null when the envelope itself is not the admitted
 * owner contract; an individual basket that fails its own gate is reported in place and never
 * discards the baskets around it. */
export function sectorIntradayRead(data: unknown, nowMs: number): IntradayRead | null {
  if (!isRow(data)) return null;
  if (data.schema !== INTRADAY_BASKET_PULSE_SCHEMA || data.market !== "us") return null;
  const baskets = data.baskets;
  if (!Array.isArray(baskets) || baskets.length > MAX_BASKETS) return null;
  const ids = new Set<string>();
  const rows: IntradayReadRow[] = [];
  let presentCount = 0;
  for (const value of baskets) {
    if (!isRow(value)) continue;
    const id = value.id;
    if (typeof id !== "string" || !KEY.test(id) || ids.has(id)) continue;
    ids.add(id);
    const raw = value.intraday_comparison;
    if (raw === undefined || raw === null) {
      rows.push({ basketId: id, outcome: "absent", reason: "absent", dayChangePct: null });
      continue;
    }
    presentCount++;
    const row = readIntradayComparison(id, raw, nowMs);
    // Preserve a present but unreadable basket in place, without manufacturing owner evidence.
    rows.push(row ? { ...row, dayChangePct: readDayChangePct(value) }
      : { basketId: id, outcome: "invalid", reason: "unverified", dayChangePct: null });
  }
  return {
    schema: INTRADAY_BASKET_PULSE_SCHEMA, market: data.market,
    session: typeof data.session === "string" && data.session ? data.session : null,
    built: typeof data.built === "string" && data.built ? data.built : null,
    asOfUtc: typeof data.as_of_utc === "string" && ZONED.test(data.as_of_utc)
      && Number.isFinite(Date.parse(data.as_of_utc)) ? data.as_of_utc : null,
    quoteSourceAsOf: readIntradaySourceStamp(data),
    quoteBarDate: typeof data.as_of_quotes === "string" && ISO_DAY.test(data.as_of_quotes)
      && Number.isFinite(Date.parse(data.as_of_quotes)) ? data.as_of_quotes : null,
    rows, presentCount, totalBaskets: ids.size,
  };
}
