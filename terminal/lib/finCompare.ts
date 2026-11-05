/**
 * finCompare — the comparability gate behind the Financials · Compare workbench.
 *
 * A user pins a few statement metrics across a company and its peers. The one thing this module
 * exists to prevent is the falsifier the feature was specified against: a match on a metric's
 * DISPLAY NAME authorizing a comparison. "Revenue" on a bank and "Revenue" on a chip maker are
 * different statement geometries; "Q2 '26" is NVIDIA's quarter ending 2025-07-31 and AMD's quarter
 * ending 2026-06-30; a CNY total is not a USD total; a cumulative year-to-date figure is not a
 * quarter. None of those is ever decided here from a label. Every cell is admitted only when its
 * statement family, unit/currency, period kind and flow basis are explicitly compatible with the
 * frame; anything else is `unavailable` (we cannot tell) or `noncomparable` (we can tell, and it is
 * not the same thing) — never zero, never ranked.
 *
 * Consumes, never re-derives:
 *   • income values come from `finStatementMath.incomeView` — the exact block the Statements tab
 *     prints (raw for discrete markets, differenced for legacy cumulative-YTD CN/HK files), so a
 *     comparison cell and the source cell it opens are the same number by construction;
 *   • net margin is `finSeries.netMarginPct` over that same block;
 *   • cadence is `statementCadence`, family is `isIndustrialStatement`, currency is
 *     `statementCurrencyCode`. No statement parser, YoY formula, or cache lives here.
 *
 * Pure and in `lib/` on purpose: vitest only collects `lib/__tests__/**`.
 */
import type { CacheOutcome, UnavailableReason } from "./dataCache";
import {
  applyLegacyStatementFamilyFallback,
  type Fund,
  type NumArr,
  type StatementPeriodKind,
  type StatementPeriodSet,
  type StatementSourceFamily,
} from "./fund";
import {
  CUMULATIVE_YTD_MARKETS,
  incomeView,
  isCumulativeShape,
  isIndustrialStatement,
  statementBasisAvailable,
  statementCadence,
  type IncomeView,
  type StatementBasis,
} from "./finStatementMath";
import { netMarginPct } from "./finSeries";
import { statementCurrencyCode } from "./finFormat";

// ── metric catalog ───────────────────────────────────────────────────────────────────────────

export type CompareBlock = "income" | "balance" | "cashflow";
/** flow = accumulates over the period; stock = a period-end snapshot; ratio = flow ÷ flow. */
export type MetricKind = "flow" | "stock" | "per_share" | "ratio";
export type MetricUnit = "currency" | "currency_per_share" | "percent";
/**
 * any_family       the line has one meaning across statement formats (net income, total assets);
 * same_family      the line exists everywhere but its composition is format-specific — a bank's
 *                  total operating income is not an industrial revenue line;
 * industrial_only  the line exists only on the industrial format (gross profit, free cash flow).
 */
export type FamilyRule = "any_family" | "same_family" | "industrial_only";
export type CompareMetricId =
  | "revenue"
  | "gross_profit"
  | "op_income"
  | "net_income"
  | "eps_diluted"
  | "net_margin"
  | "assets"
  | "equity"
  | "cfo"
  | "fcf";

export interface CompareMetric {
  id: CompareMetricId;
  block: CompareBlock;
  kind: MetricKind;
  unit: MetricUnit;
  family: FamilyRule;
  /** The Statements row a drilldown focuses (`MiniRow.id`). */
  sourceRow: string;
}

export const COMPARE_METRICS: readonly CompareMetric[] = [
  { id: "revenue", block: "income", kind: "flow", unit: "currency", family: "same_family", sourceRow: "revenue" },
  { id: "gross_profit", block: "income", kind: "flow", unit: "currency", family: "industrial_only", sourceRow: "gross_profit" },
  { id: "op_income", block: "income", kind: "flow", unit: "currency", family: "same_family", sourceRow: "op_income" },
  { id: "net_income", block: "income", kind: "flow", unit: "currency", family: "any_family", sourceRow: "net_income" },
  { id: "eps_diluted", block: "income", kind: "per_share", unit: "currency_per_share", family: "any_family", sourceRow: "eps_diluted" },
  // A margin is unit-free, so it is the one metric that may sit beside a peer reporting in
  // another currency — but its numerator and denominator must still be one discrete period.
  { id: "net_margin", block: "income", kind: "ratio", unit: "percent", family: "same_family", sourceRow: "net_income" },
  { id: "assets", block: "balance", kind: "stock", unit: "currency", family: "any_family", sourceRow: "assets" },
  { id: "equity", block: "balance", kind: "stock", unit: "currency", family: "any_family", sourceRow: "equity" },
  { id: "cfo", block: "cashflow", kind: "flow", unit: "currency", family: "same_family", sourceRow: "cfo" },
  { id: "fcf", block: "cashflow", kind: "flow", unit: "currency", family: "industrial_only", sourceRow: "fcf" },
] as const;

export const DEFAULT_COMPARE_METRICS: readonly CompareMetricId[] = ["revenue", "net_income"];
export const MAX_COMPARE_METRICS = 4;
export const MAX_COMPARE_PEERS = 5;

export function compareMetric(id: CompareMetricId): CompareMetric {
  const found = COMPARE_METRICS.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown comparison metric: ${id}`);
  return found;
}

/** The normalized series a metric reads. Income always goes through `incomeView`. */
export function metricValues(
  metric: CompareMetric,
  set: StatementPeriodSet,
  view: IncomeView,
): NumArr {
  switch (metric.id) {
    case "revenue":
      return view.income.revenue;
    case "gross_profit":
      return view.income.gross_profit;
    case "op_income":
      return view.income.op_income;
    case "net_income":
      return view.income.net_income;
    case "eps_diluted":
      return view.income.eps_diluted;
    case "net_margin":
      return netMarginPct(view.income.revenue, view.income.net_income);
    case "assets":
      return set.balance?.assets ?? [];
    case "equity":
      return set.balance?.equity ?? [];
    case "cfo":
      return set.cashflow?.cfo ?? [];
    case "fcf":
      return set.cashflow?.fcf ?? [];
  }
}

// ── statement family ─────────────────────────────────────────────────────────────────────────

/**
 * Comparison family. Every industrial-compatible receipt ("industrial", "other", none) is one
 * class; the financial formats stay DISTINCT from each other — a bank and an insurer share a
 * label ("Total operating income") but not a composition. "ambiguous" (one vendor row carrying
 * two complete formats) proves no family at all and admits no comparison.
 */
export type FamilyClass = "industrial" | "bank" | "insurer" | "financial_services" | "ambiguous";

export function familyClass(family: StatementSourceFamily | null | undefined): FamilyClass {
  if (family === "ambiguous") return "ambiguous";
  if (isIndustrialStatement(family)) return "industrial";
  return family as "bank" | "insurer" | "financial_services";
}

// ── periods ──────────────────────────────────────────────────────────────────────────────────

export type FrameKind = "full_year" | "half_year" | "quarter";
export type CompareAlignment = "fiscal" | "calendar";

const DAY = 86_400_000;
/** Nominal span and tolerance in days. 52/53-week years and 13/14-week quarters sit well inside. */
const NOMINAL: Record<FrameKind, number> = { full_year: 365, half_year: 182, quarter: 91 };
const TOLERANCE: Record<FrameKind, number> = { full_year: 40, half_year: 25, quarter: 20 };
/** A period belongs to a calendar bucket only when at least this share of its days fall in it. */
export const CALENDAR_MAJORITY = 0.6;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isoMs(value: string | null | undefined): number | null {
  const m = ISO_DATE.exec(value ?? "");
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}
function msIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface ComparePeriod {
  /** Index into the source period set — the exact column the Statements tab renders. */
  index: number;
  /** The producer's display label, shown verbatim and NEVER used to align. */
  label: string;
  end: string;
  endMs: number;
  /** The period's first day: the producer's `period_start`, else estimated from the kind. */
  start: string;
  startMs: number;
  startEstimated: boolean;
  kind: FrameKind;
}

/** The declared kind of one column, or null when the artifact does not say. */
function declaredKind(
  set: StatementPeriodSet,
  basis: StatementBasis,
  index: number,
): StatementPeriodKind | null {
  const kind = set.period_kind?.[index];
  if (kind) return kind;
  if (basis === "annual") return "full_year";
  // A per-period kind array with a hole says nothing about that hole.
  if ((set.period_kind?.length ?? 0) > 0) return null;
  const cadence = statementCadence(set, "quarterly");
  if (cadence === "quarterly") return "quarter";
  if (cadence === "semiannual") return "half_year";
  return null;
}

/**
 * Columns of `kind`, oldest→newest by period end. A column is dropped when its end date is not a
 * date, when its declared start makes it the wrong length (a transition stub, a nine-month
 * column), or — for an artifact that declares no per-period kind — when the set's spacing does not
 * match the kind its cadence fallback implies. Nothing here reads a label.
 */
export function periodsOfKind(
  set: StatementPeriodSet,
  basis: StatementBasis,
  kind: FrameKind,
): ComparePeriod[] {
  const n = set.periods?.length ?? 0;
  const nominal = NOMINAL[kind];
  const tol = TOLERANCE[kind];
  const out: ComparePeriod[] = [];
  for (let i = 0; i < n; i++) {
    if (declaredKind(set, basis, i) !== kind) continue;
    const endMs = isoMs(set.period_end?.[i]);
    if (endMs == null) continue;
    const declaredStart = isoMs(set.period_start?.[i] ?? null);
    if (declaredStart != null) {
      const days = (endMs - declaredStart) / DAY + 1;
      if (Math.abs(days - nominal) > tol) continue;
    }
    const startMs = declaredStart ?? endMs - (nominal - 1) * DAY;
    out.push({
      index: i,
      label: set.periods[i] ?? "",
      end: msIso(endMs),
      endMs,
      start: msIso(startMs),
      startMs,
      startEstimated: declaredStart == null,
      kind,
    });
  }
  out.sort((a, b) => a.endMs - b.endMs);
  if ((set.period_kind?.length ?? 0) === 0 && out.length >= 3) {
    // Legacy artifact: the kind came from a cadence fallback. Confirm it from the period ends.
    const gaps = out.slice(1).map((p, j) => (p.endMs - out[j].endMs) / DAY).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (Math.abs(median - nominal) > tol) return [];
  }
  return out;
}

/** Kinds this set carries on `basis`, for an honest "reports half-years" message. */
export function declaredKinds(set: StatementPeriodSet, basis: StatementBasis): StatementPeriodKind[] {
  const kinds = new Set<StatementPeriodKind>();
  for (let i = 0; i < (set.periods?.length ?? 0); i++) {
    const k = declaredKind(set, basis, i);
    if (k) kinds.add(k);
  }
  return [...kinds];
}

/** The frame kind for a basis, chosen from the ANCHOR's newest eligible column. */
export function frameKindFor(set: StatementPeriodSet, basis: StatementBasis): FrameKind | null {
  if (basis === "annual") return periodsOfKind(set, basis, "full_year").length > 0 ? "full_year" : null;
  const candidates = (["quarter", "half_year"] as const)
    .map((kind) => ({ kind, periods: periodsOfKind(set, basis, kind) }))
    .filter((c) => c.periods.length > 0);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.periods[b.periods.length - 1].endMs - a.periods[a.periods.length - 1].endMs);
  return candidates[0].kind;
}

// ── flow basis ───────────────────────────────────────────────────────────────────────────────

export type FlowState = "discrete" | "cumulative" | "missing_base" | "unknown";

/** True when `incomeView` differenced a legacy cumulative-YTD set (CN/HK, no producer receipt). */
function legacyDifferenced(set: StatementPeriodSet, view: IncomeView): boolean {
  return (
    !view.producerNormalized &&
    (CUMULATIVE_YTD_MARKETS as readonly string[]).includes(view.market) &&
    isCumulativeShape(set.income?.revenue)
  );
}

/**
 * Whether one interim column's EMITTED flow values cover only that period.
 *
 * `flow_basis` describes the emitted values and is the authority; `is_cumulative` describes the
 * SOURCE row before normalization. So a Tencent Q1 column is `is_cumulative: true` with
 * `normalization_method: "as_reported_ytd"` under `flow_basis: "discrete_period"` — a Q1
 * year-to-date total IS the quarter — and is discrete. Cash-flow rows are never differenced by any
 * consumer, so a cumulative source stays cumulative there.
 */
export function interimFlowState(
  set: StatementPeriodSet,
  view: IncomeView,
  period: ComparePeriod,
  block: "income" | "cashflow",
): FlowState {
  const i = period.index;
  const method = set.normalization_method?.[i];
  if (method === "unavailable_missing_base") return "missing_base";
  const differenced = block === "income" && legacyDifferenced(set, view);
  const sourceCumulative = set.is_cumulative?.[i];
  switch (set.flow_basis) {
    case "discrete_period":
    case "as_reported":
      return "discrete";
    case "mixed_period":
      if (method === "difference_from_prior_ytd") return "discrete";
      if (!period.startEstimated) return "discrete"; // declared start + length already verified
      if (sourceCumulative === false && method !== "as_reported_ytd") return "discrete";
      if (sourceCumulative === true || method === "as_reported_ytd") return "cumulative";
      return "unknown";
    case "cumulative_ytd":
      return differenced ? "discrete" : "cumulative";
    default:
      break;
  }
  if (sourceCumulative === false) return "discrete";
  if (sourceCumulative === true) return differenced ? "discrete" : "cumulative";
  if ((CUMULATIVE_YTD_MARKETS as readonly string[]).includes(view.market)) {
    return differenced ? "discrete" : "unknown";
  }
  return "discrete";
}

/** How the displayed figure was produced from the filing, for the source disclosure. */
export function periodDerivation(
  set: StatementPeriodSet,
  view: IncomeView,
  period: ComparePeriod,
  basis: StatementBasis,
  block: CompareBlock,
): "as_reported" | "differenced_ytd" {
  if (basis === "annual" || block === "balance") return "as_reported";
  if (set.normalization_method?.[period.index] === "difference_from_prior_ytd") return "differenced_ytd";
  // Mirrors `discreteQuarters`: a legacy file's Q1 is its own year-to-date, so it is not differenced.
  if (block === "income" && legacyDifferenced(set, view) && !view.periods[period.index]?.startsWith("Q1")) {
    return "differenced_ytd";
  }
  return "as_reported";
}

// ── calendar buckets ─────────────────────────────────────────────────────────────────────────

export interface CalendarBucket {
  key: string;
  year: number;
  /** Quarter 1–4, half 1–2, or null for a calendar year. */
  part: number | null;
  kind: FrameKind;
  order: number;
}

function bucketAt(ms: number, kind: FrameKind): CalendarBucket {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const part = kind === "quarter" ? Math.floor(month / 3) + 1 : kind === "half_year" ? Math.floor(month / 6) + 1 : null;
  return {
    key: part == null ? `CY${year}` : `${year}-${kind === "quarter" ? "Q" : "H"}${part}`,
    year,
    part,
    kind,
    order: year * 10 + (part ?? 0),
  };
}
function bucketBounds(b: CalendarBucket): [number, number] {
  if (b.part == null) return [Date.UTC(b.year, 0, 1), Date.UTC(b.year + 1, 0, 1) - DAY];
  const months = b.kind === "quarter" ? 3 : 6;
  return [Date.UTC(b.year, (b.part - 1) * months, 1), Date.UTC(b.year, b.part * months, 1) - DAY];
}

/**
 * The calendar period holding most of a fiscal period's days, and that share. NVIDIA's quarter of
 * May–July sits two-thirds in calendar Q2 and is placed there; Microsoft's July–June fiscal year
 * splits almost exactly in half across two calendar years and is placed nowhere.
 */
export function calendarPlacement(period: ComparePeriod): { bucket: CalendarBucket; share: number } {
  const total = (period.endMs - period.startMs) / DAY + 1;
  let best: { bucket: CalendarBucket; days: number } | null = null;
  let cursor = bucketAt(period.startMs, period.kind);
  for (let guard = 0; guard < 8; guard++) {
    const [lo, hi] = bucketBounds(cursor);
    const days = (Math.min(hi, period.endMs) - Math.max(lo, period.startMs)) / DAY + 1;
    if (days > 0 && (!best || days > best.days)) best = { bucket: cursor, days };
    if (hi >= period.endMs) break;
    cursor = bucketAt(hi + DAY, period.kind);
  }
  const chosen = best ?? { bucket: bucketAt(period.endMs, period.kind), days: 0 };
  return { bucket: chosen.bucket, share: total > 0 ? chosen.days / total : 0 };
}

// ── columns / alignment ──────────────────────────────────────────────────────────────────────

export const COMPARE_COLUMNS = 4;

export type CompareColumn =
  | { type: "fiscal"; key: string; offset: number; kind: FrameKind }
  | { type: "calendar"; key: string; bucket: CalendarBucket };

type Slot =
  | { period: ComparePeriod }
  | { reason: "calendar_collision" | "calendar_straddle"; periods: ComparePeriod[] };

/**
 * Fiscal-relative slots: offset 0 is the company's own newest period of the frame kind, offset 1
 * the one before it, measured by period END DATES (one nominal step each). A missing quarter
 * leaves its offset empty instead of shifting older periods forward; an irregular gap ends the
 * walk. The display label plays no part.
 */
export function fiscalSlots(periods: ComparePeriod[], kind: FrameKind, count = COMPARE_COLUMNS): Map<number, ComparePeriod> {
  const slots = new Map<number, ComparePeriod>();
  if (periods.length === 0) return slots;
  const nominal = NOMINAL[kind];
  const tol = TOLERANCE[kind];
  let prev = periods[periods.length - 1];
  let offset = 0;
  slots.set(0, prev);
  for (let j = periods.length - 2; j >= 0; j--) {
    const p = periods[j];
    const diff = (prev.endMs - p.endMs) / DAY;
    const steps = Math.round(diff / nominal);
    if (steps < 1 || Math.abs(diff - steps * nominal) > tol * steps) break;
    offset += steps;
    if (offset >= count) break;
    slots.set(offset, p);
    prev = p;
  }
  return slots;
}

/** Calendar slots by majority overlap; a split period or a double occupant is never guessed. */
export function calendarSlots(periods: ComparePeriod[]): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  const straddles = new Map<string, ComparePeriod[]>();
  for (const p of periods) {
    const { bucket, share } = calendarPlacement(p);
    if (share < CALENDAR_MAJORITY) {
      straddles.set(bucket.key, [...(straddles.get(bucket.key) ?? []), p]);
      continue;
    }
    const existing = slots.get(bucket.key);
    if (!existing) slots.set(bucket.key, { period: p });
    else {
      const prior = "period" in existing ? [existing.period] : existing.periods;
      slots.set(bucket.key, { reason: "calendar_collision", periods: [...prior, p] });
    }
  }
  for (const [key, ps] of straddles) {
    if (!slots.has(key)) slots.set(key, { reason: "calendar_straddle", periods: ps });
  }
  return slots;
}

// ── peers ────────────────────────────────────────────────────────────────────────────────────

export type PeerStale = "revalidating" | "refresh_failed" | null;
export type PeerLoad =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "unavailable"; reason: UnavailableReason }
  | { status: "data"; fund: Fund; stale: PeerStale };

export interface PeerSlot {
  sym: string;
  /** Request generation. A response is applied only to the generation that asked for it. */
  gen: number;
  load: PeerLoad;
}

/** The three-way read outcome → a peer's state. A 404 is "not published", never "zero". */
export function peerLoadFromOutcome(outcome: CacheOutcome): PeerLoad {
  if (outcome.status === "absent") return { status: "absent" };
  if (outcome.status === "unavailable") return { status: "unavailable", reason: outcome.reason };
  const data = outcome.data as Fund | null;
  if (!data || typeof data !== "object" || !data.statements || typeof data.statements !== "object") {
    return { status: "unavailable", reason: "malformed" };
  }
  return {
    status: "data",
    fund: applyLegacyStatementFamilyFallback(data),
    stale: outcome.stale ? "revalidating" : null,
  };
}

export type AddPeerResult =
  | { ok: true; sym: string }
  | { ok: false; reason: "invalid" | "anchor" | "duplicate" | "limit" };

export function admitPeer(
  peers: readonly PeerSlot[],
  anchor: string,
  normalized: string | null,
): AddPeerResult {
  if (!normalized) return { ok: false, reason: "invalid" };
  if (normalized === anchor) return { ok: false, reason: "anchor" };
  if (peers.some((p) => p.sym === normalized)) return { ok: false, reason: "duplicate" };
  if (peers.length >= MAX_COMPARE_PEERS) return { ok: false, reason: "limit" };
  return { ok: true, sym: normalized };
}

/** Start (or restart) a peer read under a new generation. */
export function requestPeer(peers: readonly PeerSlot[], sym: string, gen: number): PeerSlot[] {
  const next: PeerSlot = { sym, gen, load: { status: "loading" } };
  return peers.some((p) => p.sym === sym)
    ? peers.map((p) => (p.sym === sym ? next : p))
    : [...peers, next];
}

/**
 * Apply a read result only when the peer is still pinned AND still waiting on that generation.
 * A removed peer, or a retry that superseded the request, leaves the list untouched — the same
 * array, so a stale response cannot even cause a render.
 */
export function resolvePeer(
  peers: PeerSlot[],
  sym: string,
  gen: number,
  load: PeerLoad,
): PeerSlot[] {
  const target = peers.find((p) => p.sym === sym);
  if (!target || target.gen !== gen) return peers;
  return peers.map((p) => (p === target ? { ...p, load } : p));
}

/** Label a served copy whose background refresh failed, if the generation still matches. */
export function markPeerRefreshFailed(peers: PeerSlot[], sym: string, gen: number): PeerSlot[] {
  const target = peers.find((p) => p.sym === sym);
  if (!target || target.gen !== gen || target.load.status !== "data" || target.load.stale !== "revalidating") {
    return peers;
  }
  return resolvePeer(peers, sym, gen, { ...target.load, stale: "refresh_failed" });
}

export function removePeer(peers: readonly PeerSlot[], sym: string): PeerSlot[] {
  return peers.filter((p) => p.sym !== sym);
}

// ── the comparison ───────────────────────────────────────────────────────────────────────────

export type CellStatus = "ok" | "unavailable" | "noncomparable";
export type CellReason =
  | "no_period"
  | "no_value"
  | "family_mismatch"
  | "family_ambiguous"
  | "currency_mismatch"
  | "currency_unknown"
  | "cumulative_flow"
  | "missing_base"
  | "flow_basis_unknown"
  | "margin_undefined"
  | "calendar_collision"
  | "calendar_straddle";

export interface CellSource {
  sym: string;
  basis: StatementBasis;
  block: CompareBlock;
  /** Statements column index — what the drilldown focuses. */
  index: number;
  label: string;
  end: string;
  start: string;
  startEstimated: boolean;
  kind: FrameKind;
  /** ISO date of the filing these figures were taken from, when the artifact records it. */
  filed: string | null;
  /** True when more than one filing reported this period; the LATEST is shown. */
  restated: boolean;
  currency: string | null;
  family: FamilyClass;
  derivation: "as_reported" | "differenced_ytd";
  rowId: string;
}

export interface CompareCell {
  column: string;
  status: CellStatus;
  reason: CellReason | null;
  /** Present only on an `ok` cell. */
  value: number | null;
  /** The exact source period, whenever one occupies this slot (also on refused cells). */
  source: CellSource | null;
  /** Competition rank among this column's `ok` cells, largest first; null unless ≥ 2 are ok. */
  rank: number | null;
  rankOf: number | null;
}

export type RowState =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "unavailable"; reason: UnavailableReason }
  | { status: "basis_absent" }
  | { status: "kind_mismatch"; kinds: StatementPeriodKind[] }
  | { status: "kind_unknown" }
  | { status: "generation_gap"; latestEnd: string; frameEnd: string }
  | { status: "ready" };

export interface CompareRow {
  sym: string;
  isAnchor: boolean;
  state: RowState;
  stale: PeerStale;
  currency: string | null;
  /** Family of the company's newest frame period, for the row disclosure. */
  family: FamilyClass | null;
  cells: CompareCell[];
}

export type MetricApplicability = "applicable" | "industrial_only" | "family_ambiguous";

export interface CompareTable {
  metric: CompareMetric;
  applicability: MetricApplicability;
  rows: CompareRow[];
}

export interface CompareFrame {
  anchor: string;
  basis: StatementBasis;
  kind: FrameKind;
  alignment: CompareAlignment;
  currency: string | null;
  family: FamilyClass;
  /** The anchor's newest frame period — the reference for fiscal-relative generations. */
  latestEnd: string;
}

export type FrameIssue = "anchor_absent" | "anchor_basis_absent" | "anchor_kind_unknown";

export interface CompareResult {
  frame: CompareFrame | null;
  frameIssue: FrameIssue | null;
  columns: CompareColumn[];
  tables: CompareTable[];
}

export interface CompareInput {
  anchor: { sym: string; fund: Fund | null };
  peers: readonly PeerSlot[];
  basis: StatementBasis;
  alignment: CompareAlignment;
  metrics: readonly CompareMetricId[];
}

interface CompanyFrame {
  sym: string;
  isAnchor: boolean;
  stale: PeerStale;
  state: RowState;
  set: StatementPeriodSet | null;
  view: IncomeView | null;
  currency: string | null;
  periods: ComparePeriod[];
  fiscal: Map<number, ComparePeriod>;
  calendar: Map<string, Slot>;
}

function companyFrame(
  sym: string,
  fund: Fund,
  basis: StatementBasis,
  kind: FrameKind,
  isAnchor: boolean,
  stale: PeerStale,
): CompanyFrame {
  const set = (basis === "annual" ? fund.statements?.annual : fund.statements?.quarterly) ?? null;
  const currency = statementCurrencyCode(fund.stmt_currency);
  const unready = (state: RowState, view: IncomeView | null): CompanyFrame => ({
    sym,
    isAnchor,
    stale,
    currency,
    state,
    set: view ? set : null,
    view,
    periods: [],
    fiscal: new Map(),
    calendar: new Map(),
  });
  if (!set || !statementBasisAvailable(set)) return unready({ status: "basis_absent" }, null);
  const view = incomeView(sym, set, basis);
  const periods = periodsOfKind(set, basis, kind);
  if (periods.length === 0) {
    const kinds = declaredKinds(set, basis).filter((k) => k !== kind);
    return unready(kinds.length > 0 ? { status: "kind_mismatch", kinds } : { status: "kind_unknown" }, view);
  }
  return {
    sym,
    isAnchor,
    stale,
    currency,
    state: { status: "ready" },
    set,
    view,
    periods,
    fiscal: fiscalSlots(periods, kind),
    calendar: calendarSlots(periods),
  };
}

function cellFamily(company: CompanyFrame, period: ComparePeriod): FamilyClass {
  const view = company.view!;
  return familyClass(view.sourceFamilies[period.index] ?? view.sourceFamily);
}

function evaluateCell(
  metric: CompareMetric,
  frame: CompareFrame,
  company: CompanyFrame,
  column: CompareColumn,
): CompareCell {
  const empty = (reason: CellReason, status: CellStatus = "unavailable", source: CellSource | null = null): CompareCell => ({
    column: column.key,
    status,
    reason,
    value: null,
    source,
    rank: null,
    rankOf: null,
  });
  let period: ComparePeriod | null = null;
  if (column.type === "fiscal") {
    period = company.fiscal.get(column.offset) ?? null;
  } else {
    const slot = company.calendar.get(column.key);
    if (slot && "reason" in slot) return empty(slot.reason);
    period = slot?.period ?? null;
  }
  if (!period) return empty("no_period");

  const set = company.set!;
  const view = company.view!;
  const family = cellFamily(company, period);
  const source: CellSource = {
    sym: company.sym,
    basis: frame.basis,
    block: metric.block,
    index: period.index,
    label: period.label,
    end: period.end,
    start: period.start,
    startEstimated: period.startEstimated,
    kind: period.kind,
    filed: set.filed_by_period?.[period.index] ?? null,
    restated: set.restated_by_period?.[period.index] === true,
    currency: company.currency,
    family,
    derivation: periodDerivation(set, view, period, frame.basis, metric.block),
    rowId: metric.sourceRow,
  };

  // 1. Statement family — decided from the producer's family receipt, never the row label. An
  //    "ambiguous" receipt proves no format, so only a format-independent line survives it.
  if (metric.family !== "any_family") {
    if (family === "ambiguous" || frame.family === "ambiguous") return empty("family_ambiguous", "unavailable", source);
    if (metric.family === "same_family" && family !== frame.family) return empty("family_mismatch", "noncomparable", source);
    if (metric.family === "industrial_only" && family !== "industrial") return empty("family_mismatch", "noncomparable", source);
  }

  // 2. Unit — a currency amount is compared only in the frame's own reporting currency.
  if (metric.unit !== "percent") {
    if (frame.currency == null || company.currency == null) return empty("currency_unknown", "unavailable", source);
    if (company.currency !== frame.currency) return empty("currency_mismatch", "noncomparable", source);
  }

  // 3. Flow basis — an interim flow must cover exactly its own period.
  if (metric.kind !== "stock" && frame.basis === "quarterly") {
    const state = interimFlowState(set, view, period, metric.block === "cashflow" ? "cashflow" : "income");
    if (state === "missing_base") return empty("missing_base", "unavailable", source);
    if (state === "cumulative") return empty("cumulative_flow", "noncomparable", source);
    if (state === "unknown") return empty("flow_basis_unknown", "unavailable", source);
  }

  // 4. Value.
  const values = metricValues(metric, set, view);
  const value = values[period.index];
  if (metric.id === "net_margin") {
    const revenue = view.income.revenue[period.index];
    if (value == null || !Number.isFinite(value) || revenue == null || revenue <= 0) {
      return empty("margin_undefined", "unavailable", source);
    }
  } else if (value == null || !Number.isFinite(value)) {
    return empty("no_value", "unavailable", source);
  }
  return { column: column.key, status: "ok", reason: null, value, source, rank: null, rankOf: null };
}

/** Competition ranking (1, 1, 3) among `ok` cells only; nothing is ranked against a gap. */
function rankColumn(cells: CompareCell[]): void {
  const ok = cells.filter((c) => c.status === "ok" && c.value != null);
  if (ok.length < 2) return;
  for (const cell of ok) {
    cell.rank = 1 + ok.filter((o) => (o.value as number) > (cell.value as number)).length;
    cell.rankOf = ok.length;
  }
}

function rowFromLoad(sym: string, load: PeerLoad): CompareRow | null {
  if (load.status === "data") return null;
  return { sym, isAnchor: false, state: load, stale: null, currency: null, family: null, cells: [] };
}

/**
 * Build every metric table for one frame. The ANCHOR fixes the frame — basis, period kind,
 * reporting currency, statement family and (fiscal-relative) generation; peers are admitted cell
 * by cell against it.
 */
export function buildComparison(input: CompareInput): CompareResult {
  const { anchor, basis, alignment } = input;
  const metrics = input.metrics.map(compareMetric);
  const none = (frameIssue: FrameIssue): CompareResult => ({ frame: null, frameIssue, columns: [], tables: [] });
  if (!anchor.fund || !anchor.fund.statements) return none("anchor_absent");
  const anchorSet = basis === "annual" ? anchor.fund.statements.annual : anchor.fund.statements.quarterly;
  if (!anchorSet || !statementBasisAvailable(anchorSet)) return none("anchor_basis_absent");
  const kind = frameKindFor(anchorSet, basis);
  if (!kind) return none("anchor_kind_unknown");

  const anchorCompany = companyFrame(anchor.sym, anchor.fund, basis, kind, true, null);
  const latest = anchorCompany.periods[anchorCompany.periods.length - 1];
  const frame: CompareFrame = {
    anchor: anchor.sym,
    basis,
    kind,
    alignment,
    currency: anchorCompany.currency,
    family: cellFamily(anchorCompany, latest),
    latestEnd: latest.end,
  };

  const companies: CompanyFrame[] = [anchorCompany];
  const pending: CompareRow[] = [];
  const order: string[] = [anchor.sym];
  for (const peer of input.peers) {
    order.push(peer.sym);
    if (peer.load.status !== "data") {
      pending.push(rowFromLoad(peer.sym, peer.load)!);
      continue;
    }
    const company = companyFrame(peer.sym, peer.load.fund, basis, kind, false, peer.load.stale);
    if (alignment === "fiscal" && company.state.status === "ready") {
      // Offsets count back from each company's own newest period, so they are only meaningful
      // when both newest periods belong to the same generation. A peer whose newest year is a
      // full year behind the anchor's is not "Latest FY" alongside it.
      const peerLatest = company.periods[company.periods.length - 1];
      const gapDays = Math.abs(peerLatest.endMs - latest.endMs) / DAY;
      if (gapDays >= NOMINAL[kind] - TOLERANCE[kind]) {
        company.state = { status: "generation_gap", latestEnd: peerLatest.end, frameEnd: latest.end };
      }
    }
    companies.push(company);
  }

  let columns: CompareColumn[];
  if (alignment === "fiscal") {
    columns = Array.from({ length: COMPARE_COLUMNS }, (_, j) => COMPARE_COLUMNS - 1 - j).map((offset) => ({
      type: "fiscal" as const,
      key: `F${offset}`,
      offset,
      kind,
    }));
  } else {
    const buckets = new Map<string, CalendarBucket>();
    for (const company of companies) {
      if (company.state.status !== "ready") continue;
      for (const [key, slot] of company.calendar) {
        if ("period" in slot) buckets.set(key, calendarPlacement(slot.period).bucket);
      }
    }
    columns = [...buckets.values()]
      .sort((a, b) => a.order - b.order)
      .slice(-COMPARE_COLUMNS)
      .map((bucket) => ({ type: "calendar" as const, key: bucket.key, bucket }));
  }

  const tables: CompareTable[] = metrics.map((metric) => {
    const applicability: MetricApplicability =
      frame.family === "ambiguous" && metric.family !== "any_family"
        ? "family_ambiguous"
        : metric.family === "industrial_only" && frame.family !== "industrial"
          ? "industrial_only"
          : "applicable";
    const built = new Map<string, CompareRow>();
    for (const company of companies) {
      const ready = company.state.status === "ready";
      const newest = company.periods[company.periods.length - 1];
      built.set(company.sym, {
        sym: company.sym,
        isAnchor: company.isAnchor,
        state: company.state,
        stale: company.stale,
        currency: company.currency,
        family: newest ? cellFamily(company, newest) : null,
        cells: ready && applicability === "applicable"
          ? columns.map((column) => evaluateCell(metric, frame, company, column))
          : [],
      });
    }
    for (const row of pending) built.set(row.sym, row);
    const rows = order.map((sym) => built.get(sym)!).filter(Boolean);
    columns.forEach((_, j) => rankColumn(rows.flatMap((r) => (r.cells[j] ? [r.cells[j]] : []))));
    return { metric, applicability, rows };
  });

  return { frame, frameIssue: null, columns, tables };
}
