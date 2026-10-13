/** Presentation-only projection of the S1 native candidate. No IO or admission.
 * Customer mode always withholds. A caller's synthetic label and digest reference
 * are NOT authenticated; this module is only a local research-preview dependency.
 */
export type HistoryMode = "CURRENT_ROSTER" | "PIT_AS_KNOWN";
export type SourceStatus = "READY" | "PARTIAL" | "UNAVAILABLE";
/** Native source-native measurement, never re-estimated by the Terminal client. */
export interface FactorDiagnostics {
  coverage: {
    eligibleCount: number | null; validCount: number | null;
    countFraction: number | null; weightFraction: number | null;
    weightBasis: "declared_start_weights";
  };
  breadth: {
    status: SourceStatus; eligibleCount: number | null; validCount: number | null;
    advanceFraction: number | null;
  };
  concentration: null | {
    basis: "end_of_interval_security_weights"; securityCount: number;
    hhi: number | null; effectiveN: number; largestWeight: number | null;
    top5Weight: number | null;
  };
}
export interface FactorPoint {
  date: string; level: number | null; returnFraction: number | null;
  segmentId: number; reasons: string[];
  /** Null for the anchor or an unavailable held-weight valuation. */
  diagnostics: FactorDiagnostics | null;
}
export interface FactorHistory {
  basketId: string; historyMode: HistoryMode; sourceStatus: SourceStatus;
  sourceDigest: string; constructionRef: string; codeRef: string;
  seriesInception: string; returnBasis: "tradj"; currency: "USD";
  costs: "gross_zero_cost"; digestVerification: "NOT_PERFORMED";
  points: FactorPoint[];
}
export interface HistoryRead {
  kind: "synthetic-preview" | "withheld" | "invalid";
  reasons: string[]; history: FactorHistory | null; mayPublish: false;
}
export interface HistoryWindowRequest { anchorDate: string; endDate: string }
export interface ChartPoint extends FactorPoint { rebasedPercent: number | null }
export interface HistoryWindow extends HistoryWindowRequest {
  status: SourceStatus; reason: string | null; points: ChartPoint[];
  returnFraction: number | null; sourceDigest: string;
}
export interface FactorComparison {
  status: SourceStatus | "INCOMPATIBLE"; reasons: string[];
  series: { history: FactorHistory; window: HistoryWindow }[];
  spreadFraction: number | null;
  spreadDefinition: "RETURN_DIFFERENCE_NOT_TRADEABLE_PNL";
}
const AUTHORITY = ["may_escalate", "may_gate", "may_publish", "may_rank", "may_size", "may_trade"];
const METHOD = {
  weighting: "equal", rebalance: "monthly", between_rebalances: "drift",
  return_basis: "tradj", currency: "USD", session: "regular", venue_scope: "consolidated",
  dividends: "constituent_total_return_reinvestment", costs: "gross_zero_cost",
  minimum_held_weight_coverage: 1, base_index: 100,
  window_semantics: "DISPLAY_WINDOW_NOT_RECONSTRUCTION",
};
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("INVALID_SHAPE");
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 2048): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error("INVALID_REFERENCE");
  return v;
}
function day(v: unknown): string {
  const s = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s))
    || new Date(s).toISOString().slice(0, 10) !== s) throw new Error("INVALID_DATE");
  return s;
}
function clock(v: unknown): number {
  const s = text(v, 48), n = Date.parse(s);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(n)) throw new Error("INVALID_CLOCK");
  return n;
}
function numberOrNull(v: unknown, lower: number): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= lower) throw new Error("INVALID_NUMBER");
  return v;
}
function reasons(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 64 || v.some(x => typeof x !== "string" || !/^[A-Z0-9_]{1,128}$/.test(x))) {
    throw new Error("INVALID_REASONS");
  }
  return v.slice();
}
/** Validate S1 diagnostics as supplied, without reconstructing constituents. */
function sourceDiagnostics(point: Record<string, unknown>): FactorDiagnostics {
  const c = object(point.coverage), b = object(point.breadth);
  const count = (value: unknown): number | null => {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("INVALID_COUNT");
    return value;
  };
  const fraction = (value: unknown): number | null => {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1 + 1e-12)
      throw new Error("INVALID_FRACTION");
    return value;
  };
  const eligibleCount = count(c.eligible_count), validCount = count(c.valid_count);
  const countFraction = fraction(c.count), weightFraction = fraction(c.weight);
  if (c.weight_basis !== "declared_start_weights"
    || (eligibleCount !== null && validCount !== null && validCount > eligibleCount)
    || (eligibleCount !== null && validCount !== null && countFraction !== null
      && Math.abs(countFraction - (eligibleCount ? validCount / eligibleCount : 0)) > 1e-8)) {
    throw new Error("INVALID_NATIVE_COVERAGE");
  }
  const bEligible = count(b.eligible_count), bValid = count(b.valid_count), advance = fraction(b.advance_fraction);
  if (!["READY", "PARTIAL", "UNAVAILABLE"].includes(String(b.status))
    || (bEligible !== null && bValid !== null && bValid > bEligible)
    || (b.status === "READY" && advance === null)
    || (eligibleCount !== null && bEligible !== null && eligibleCount !== bEligible)
    || (validCount !== null && bValid !== null && validCount !== bValid)) {
    throw new Error("INVALID_NATIVE_BREADTH");
  }
  let concentration: FactorDiagnostics["concentration"] = null;
  if (point.concentration !== null) {
    const x = object(point.concentration), securityCount = count(x.security_count);
    const effectiveN = x.effective_n, hhi = fraction(x.hhi);
    const largestWeight = fraction(x.largest_weight), top5Weight = fraction(x.top5_weight);
    if (x.basis !== "end_of_interval_security_weights" || securityCount === null || securityCount < 3
      || typeof effectiveN !== "number" || !Number.isFinite(effectiveN) || effectiveN < 1
      || effectiveN > securityCount + 1e-8
      || (hhi !== null && (hhi <= 0 || Math.abs(1 / hhi - effectiveN) > 1e-7 * Math.max(1, effectiveN)))
      || (largestWeight !== null && top5Weight !== null && largestWeight > top5Weight + 1e-12)) {
      throw new Error("INVALID_NATIVE_CONCENTRATION");
    }
    concentration = { basis: "end_of_interval_security_weights", securityCount,
      hhi, effectiveN, largestWeight, top5Weight };
  }
  return {
    coverage: { eligibleCount, validCount, countFraction, weightFraction,
      weightBasis: "declared_start_weights" },
    breadth: { status: b.status as SourceStatus, eligibleCount: bEligible, validCount: bValid,
      advanceFraction: b.status === "READY" ? advance : null },
    concentration,
  };
}

const blocked = (kind: "withheld" | "invalid", reason: string): HistoryRead =>
  ({ kind, reasons: [reason], history: null, mayPublish: false });

export function prepareFactorHistory(raw: unknown, options: {
  basketId: string; audience: "synthetic-preview" | "customer";
}): HistoryRead {
  // Never inspect/copy numeric fields into customer mode, even for a READY fixture.
  if (options?.audience !== "synthetic-preview") return blocked("withheld", "SOURCE_ADMISSION_REQUIRED");
  try {
    const d = object(raw);
    if (d.evidence_kind === "RETAINED_OWNER_INPUT") return blocked("withheld", "SYNTHETIC_PREVIEW_ONLY");
    if (d.schema !== "factor_atlas_read.v1" || d.evidence_kind !== "SYNTHETIC_FIXTURE"
      || d.release_state !== "CANDIDATE_NOT_ADMITTED"
      || d.input_admission !== "REFERENCE_CHECKS_ONLY_NOT_RECEIPT_AUTHENTICATION") throw new Error("INVALID_SOURCE_CEILING");
    const basketId = text(d.basket_id, 128), request = object(d.request), method = object(d.method);
    const authority = object(d.authority), units = object(d.units), refs = object(d.source_refs);
    if (basketId !== text(options.basketId, 128) || request.basket_id !== basketId) throw new Error("BASKET_MISMATCH");
    if (Object.keys(authority).sort().join("|") !== AUTHORITY.join("|")
      || AUTHORITY.some(k => authority[k] !== false)) throw new Error("AUTHORITY_WIDENING");
    if (Object.entries(METHOD).some(([k, v]) => method[k] !== v)
      || request.purpose !== "internal_research" || request.weighting !== "equal" || request.rebalance !== "monthly"
      || units.returns !== "fraction" || units.coverage !== "fraction" || units.volatility !== "annualized_fraction") {
      throw new Error("UNSUPPORTED_METHOD_OR_UNITS");
    }
    if (!["CURRENT_ROSTER", "PIT_AS_KNOWN"].includes(String(d.history_mode))
      || request.history_mode !== d.history_mode) throw new Error("HISTORY_MODE_MISMATCH");
    if (!["READY", "PARTIAL", "UNAVAILABLE"].includes(String(d.status))) throw new Error("INVALID_STATUS");
    if (d.status === "UNAVAILABLE") return blocked("withheld", "SOURCE_UNAVAILABLE");
    const sourceDigest = text(d.result_digest, 64);
    if (!/^[a-f0-9]{64}$/.test(sourceDigest)) throw new Error("INVALID_DIGEST_REFERENCE");
    const start = day(request.start), end = day(request.end), asOf = day(d.as_of), cutoff = clock(request.measurement_cutoff);
    const anchor = object(d.anchor), inception = day(method.series_inception);
    if (day(anchor.date) !== start || asOf !== end || start >= end || inception > start) throw new Error("WINDOW_MISMATCH");
    if (!Array.isArray(d.points) || d.points.length < 1 || d.points.length > 1261) throw new Error("INVALID_POINT_COUNT");
    const firstSegment = object(d.points[0]).segment_id;
    if (typeof firstSegment !== "number" || !Number.isInteger(firstSegment) || firstSegment < 0) throw new Error("INVALID_SEGMENT");
    const points: FactorPoint[] = [{ date: start, level: numberOrNull(anchor.index_level, 0),
      returnFraction: null, segmentId: firstSegment, reasons: [], diagnostics: null }];
    let previousEnd: number | null = null, broken = points[0].level === null;
    for (const value of d.points) {
      const p = object(value), date = day(p.date), previous = points[points.length - 1];
      const from = clock(p.interval_start), to = clock(p.interval_end);
      if (date <= previous.date || date > end || from >= to || to > cutoff
        || new Date(to).toISOString().slice(0, 10) !== date
        || (previousEnd === null ? new Date(from).toISOString().slice(0, 10) !== start : from !== previousEnd)) {
        throw new Error("INVALID_INTERVAL_CONTINUITY");
      }
      const level = numberOrNull(p.index_level, 0), ret = numberOrNull(p.return, -1);
      const segment = p.segment_id, why = reasons(p.reasons);
      // Preserve native eligibility and concentration, not a Terminal-derived estimator.
      // The source may carry diagnostics for a missing NAV, but a numeric chart
      // observation must not be constructed from that unavailable valuation.
      const diagnostics = sourceDiagnostics(p);
      if (typeof segment !== "number" || !Number.isInteger(segment) || segment < previous.segmentId) throw new Error("INVALID_SEGMENT");
      if (broken && level !== null) throw new Error("BROKEN_NAV_RECONNECTED");
      if (level !== null && ret === null) throw new Error("LEVEL_WITHOUT_RETURN");
      if (level === null && ret !== null) throw new Error("RETURN_WITHOUT_HELD_VALUATION");
      if (level !== null && previous.level !== null && ret !== null) {
        const expected = previous.level * (1 + ret);
        if (!Number.isFinite(expected) || Math.abs(level - expected) > 1e-9 * Math.max(1, Math.abs(expected))) {
          throw new Error("NAV_RETURN_MISMATCH");
        }
      }
      if (level === null) broken = true;
      points.push({ date, level, returnFraction: ret, segmentId: segment, reasons: why,
        diagnostics: level === null ? null : diagnostics });
      previousEnd = to;
    }
    if (points[points.length - 1].date !== end || (d.status === "READY"
      && (broken || points.slice(1).some(p => p.returnFraction === null || p.reasons.length)))) throw new Error("STATUS_OR_END_MISMATCH");
    return { kind: "synthetic-preview", reasons: [], mayPublish: false, history: {
      basketId, historyMode: d.history_mode as HistoryMode, sourceStatus: d.status as SourceStatus,
      sourceDigest, constructionRef: text(refs.construction), codeRef: text(refs.code),
      seriesInception: inception, returnBasis: "tradj", currency: "USD", costs: "gross_zero_cost",
      digestVerification: "NOT_PERFORMED", points,
    } };
  } catch {
    // Fixed reason only: no source fields, exceptions, credential-like strings or raw data echoed.
    return blocked("invalid", "INVALID_NATIVE_CANDIDATE");
  }
}

export function factorHistoryWindow(history: FactorHistory, window: HistoryWindowRequest): HistoryWindow {
  const unavailable = (reason: string): HistoryWindow => ({ ...window, status: "UNAVAILABLE", reason,
    points: [], returnFraction: null, sourceDigest: history.sourceDigest });
  if (history.sourceStatus === "UNAVAILABLE") return unavailable("SOURCE_UNAVAILABLE");
  const from = history.points.findIndex(p => p.date === window.anchorDate);
  const to = history.points.findIndex(p => p.date === window.endDate);
  if (from < 0 || to <= from) return unavailable("EXACT_WINDOW_UNAVAILABLE");
  const anchor = history.points[from].level;
  if (anchor === null || !Number.isFinite(anchor) || anchor <= 0) return unavailable("ANCHOR_UNAVAILABLE");
  const selected = history.points.slice(from, to + 1);
  const points = selected.map(p => ({ ...p, reasons: p.reasons.slice(),
    rebasedPercent: p.level === null ? null : (p.level / anchor - 1) * 100 }));
  const complete = selected.every(p => p.level !== null && p.segmentId === selected[0].segmentId)
    && selected.slice(1).every(p => p.returnFraction !== null);
  const end = selected[selected.length - 1].level;
  return { ...window, status: complete ? "READY" : "PARTIAL", reason: complete ? null : "VALUATION_GAP",
    points, returnFraction: complete && end !== null ? end / anchor - 1 : null, sourceDigest: history.sourceDigest };
}

export function splitFactorSegments(points: ChartPoint[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let active: ChartPoint[] = [];
  for (const p of points) {
    if (p.rebasedPercent === null || !Number.isFinite(p.rebasedPercent)) { active = []; continue; }
    if (!active.length || active[active.length - 1].segmentId !== p.segmentId) {
      active = []; segments.push(active);
    }
    active.push(p);
  }
  return segments;
}

export function compareFactorHistories(histories: FactorHistory[], window: HistoryWindowRequest): FactorComparison {
  const base: FactorComparison = { status: "UNAVAILABLE", reasons: [], series: [], spreadFraction: null,
    spreadDefinition: "RETURN_DIFFERENCE_NOT_TRADEABLE_PNL" };
  if (!histories.length || histories.length > 8 || new Set(histories.map(h => h.basketId)).size !== histories.length) {
    return { ...base, reasons: ["INVALID_FACTOR_SELECTION"] };
  }
  const series = histories.map(history => ({ history, window: factorHistoryWindow(history, window) }));
  const first = histories[0];
  if (histories.some(h => h.historyMode !== first.historyMode || h.currency !== first.currency
    || h.returnBasis !== first.returnBasis || h.costs !== first.costs)) {
    return { ...base, series, status: "INCOMPATIBLE", reasons: ["INCOMPATIBLE_HISTORY_OR_BASIS"] };
  }
  const ready = series.filter(s => s.window.status === "READY").length;
  const status = ready === series.length ? "READY" : series.some(s => s.window.points.length) ? "PARTIAL" : "UNAVAILABLE";
  return { ...base, series, status, reasons: status === "READY" ? [] : ["EXACT_WINDOW_PARTIAL_OR_UNAVAILABLE"],
    spreadFraction: series.length === 2 && ready === 2
      ? series[0].window.returnFraction! - series[1].window.returnFraction! : null };
}

/** Input is a fraction, not percentage points. Never apply this to axis percentages. */
export function formatFactorPercent(value: number | null, locale: "en" | "zh" = "en"): string {
  if (value === null || !Number.isFinite(value) || !Number.isFinite(value * 100)) return "—";
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero",
  }).format(value);
}


/** Native participation/coverage fractions are shares, not signed returns. */
export function formatFactorShare(value: number | null, locale: "en" | "zh" = "en"): string {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1 + 1e-12) return "—";
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
  }).format(value);
}

/** A difference between two return fractions, displayed in percentage points.
 * Format its numeric value directly; no percent-sign escaping/replacement.
 */
export function formatFactorPoints(value: number | null, locale: "en" | "zh" = "en"): string {
  if (value === null || !Number.isFinite(value) || !Number.isFinite(value * 100)) return "—";
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero",
  }).format(value * 100);
  return `${number}${locale === "zh" ? " 个百分点" : " pp"}`;
}
