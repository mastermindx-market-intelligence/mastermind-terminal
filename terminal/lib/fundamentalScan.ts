// ── Fundamental scan (E02): period-aware, unit-honest fundamental screening ──
// The Screener can filter on a small set of fundamentals for every manifest equity without
// opening companies one by one. The producer (scripts/gen_fundamental_scan.ts, sharing the
// pure projector in lib/fundamentalScanProducer.ts with the in-app evidence panel) projects each
// `<SYM>.fund.json` into one compact `mastermind.screener_scan/v1` document of family
// "fundamental". Nothing here invents a ratio: every value is a documented function of named
// fund.json inputs, and a field whose inputs cannot support an honest comparable number is
// WITHHELD (unsupported/unavailable with a reason) instead of substituting a similarly named raw
// number (E02 falsifier).
//
// Units are stored exactly once: fractions as fractions (0.15), multiples as multiples (37.84).
// The only scaling happens at the UI boundary through `toStoredThreshold` / `toDisplayNumber`
// (AC-E02-01). Every observed row carries the fiscal/reference period its values belong to, so
// annual, interim, TTM and point-in-time balance-sheet values cannot silently stand in for one
// another (AC-E02-02).

import { canonicalChartSymbol } from "./terminalBoot";
import {
  accountCoverage,
  adoptGeneration,
  combineAll,
  generationAgeDays,
  isReasonCode,
  knownCell,
  matchRange,
  matchUnknown,
  parseScanEnvelope,
  passes,
  unknownCell,
  type AdoptDecision,
  type Coverage,
  type CoverageAccount,
  type CoverageStatus,
  type ParseResult,
  type ScanCell,
  type ScanEnvelope,
  type ScanMatch,
} from "./screenerScan";

export const FUNDAMENTAL_SCAN_FAMILY = "fundamental";
export const FUNDAMENTAL_SCAN_VERSION = 1;
export const FUNDAMENTAL_SCAN_SUPPORTED_VERSIONS: readonly number[] = [FUNDAMENTAL_SCAN_VERSION];
/** One bounded read per screen, next to the E01 technical scan under /data/scan/. */
export const FUNDAMENTAL_SCAN_URL = "/data/scan/fundamental.json";

// Staleness clocks (calendar days). Exported so the UI can state them and tests pin them.
/** A generation older than this makes every observed value stale/generation_stale. */
export const FUNDAMENTAL_GENERATION_MAX_AGE_DAYS = 4;
/** A fiscal year that ENDED longer ago than this is stale/fiscal_period_aged (≈18 months: one
 *  missed annual filing cycle plus the usual 60–120 day reporting lag). */
export const FISCAL_PERIOD_MAX_AGE_DAYS = 548;
/** A TTM snapshot (P/E) whose fund artifact is older than this is stale/snapshot_aged. */
export const SNAPSHOT_MAX_AGE_DAYS = 14;

// ── Fields ──────────────────────────────────────────────────────────────────
// Stable ids — persisted by saved screens (E04), so never renamed within v1.

export type FundamentalFieldId =
  | "fund.pe_ttm"
  | "fund.gross_margin_fy"
  | "fund.net_margin_fy"
  | "fund.roe_fy"
  | "fund.revenue_growth_fy";

/** "fraction": stored 0.15 = 15%. "multiple": stored 37.84 = 37.84×. */
export type FundamentalUnit = "fraction" | "multiple";

/**
 * The period a value belongs to. Never mixed inside one field:
 *   ttm_snapshot          vendor trailing-twelve-month ratio captured at the fund artifact's
 *                         `asof` (point-in-time snapshot, not a fiscal-year value);
 *   fiscal_year           the latest FULL fiscal year of `statements.annual` only (no interim,
 *                         no TTM roll-up, never an older year as fallback);
 *   fiscal_year_vs_prior  latest fiscal year against its comparable prior fiscal year.
 */
export type FundamentalBasis = "ttm_snapshot" | "fiscal_year" | "fiscal_year_vs_prior";

export type FundamentalFieldSpec = {
  unit: FundamentalUnit;
  basis: FundamentalBasis;
  /** Exact fund.json keys the value is computed from (documentation + evidence panel). */
  inputs: readonly string[];
  /** "industrial": withheld for bank/insurer/financial-services/ambiguous statement families,
   *  which do not share industrial revenue / gross-profit geometry. "any": family-neutral. */
  families: "industrial" | "any";
  /** Stored precision (decimal places). */
  decimals: number;
};

export const FUNDAMENTAL_FIELD_SPEC: Readonly<Record<FundamentalFieldId, FundamentalFieldSpec>> = {
  "fund.pe_ttm": {
    unit: "multiple", basis: "ttm_snapshot", families: "any", decimals: 4,
    inputs: ["ratios.current.pe_ttm"],
  },
  "fund.gross_margin_fy": {
    unit: "fraction", basis: "fiscal_year", families: "industrial", decimals: 6,
    inputs: ["statements.annual.income.gross_profit", "statements.annual.income.revenue"],
  },
  "fund.net_margin_fy": {
    unit: "fraction", basis: "fiscal_year", families: "industrial", decimals: 6,
    inputs: ["statements.annual.income.net_income", "statements.annual.income.revenue"],
  },
  "fund.roe_fy": {
    unit: "fraction", basis: "fiscal_year", families: "any", decimals: 6,
    inputs: ["statements.annual.income.net_income", "statements.annual.balance.equity"],
  },
  "fund.revenue_growth_fy": {
    unit: "fraction", basis: "fiscal_year_vs_prior", families: "industrial", decimals: 6,
    inputs: ["statements.annual.income.revenue"],
  },
};
export const FUNDAMENTAL_FIELD_IDS = Object.keys(FUNDAMENTAL_FIELD_SPEC) as FundamentalFieldId[];
const FIELD_SET: ReadonlySet<string> = new Set(FUNDAMENTAL_FIELD_IDS);
export const isFundamentalFieldId = (v: unknown): v is FundamentalFieldId => typeof v === "string" && FIELD_SET.has(v);

// ── Reason vocabulary ───────────────────────────────────────────────────────
// Row-level producer reasons describe why a whole symbol has no fundamentals; field-level
// reasons describe why ONE field was withheld for an otherwise observed company. Consumer
// reasons are derived here and RESERVED (a document emitting one is malformed at that row).
export const FUNDAMENTAL_ROW_REASONS = {
  unsupported: ["asset_class_not_covered"],
  unavailable: ["fund_absent", "fund_unreadable", "fund_malformed", "not_processed"],
} as const;

export const FUNDAMENTAL_FIELD_REASONS = {
  unsupported: [
    "pe_basis_unverified",        // CN pe_ttm may be a last-fiscal-year (LYR) fallback
    "currency_basis_unverified",  // quote ≠ statement currency (or unknown): ratio basis unproven
    "equity_basis_unverified",    // CN/HK equity basis (incl. minorities) ≠ parent net income
    "family_not_applicable",      // bank/insurer/financial services: no industrial geometry
    "family_ambiguous",           // vendor row carries several statement formats
    "family_unverified",          // no producer taxonomy and no industrial structure on file
    "family_changed",             // prior comparable year has a different statement family
    "period_not_annual",          // latest annual column is not a full fiscal year
  ],
  unavailable: [
    "not_reported",               // source carries no value
    "earnings_nonpositive",       // P/E ≤ 0: no meaningful multiple (never a "cheap" value)
    "denominator_nonpositive",    // revenue / equity / prior revenue ≤ 0
    "input_missing",              // a required input is null for the latest fiscal year
    "input_misaligned",           // an input array is not aligned to the period axis
    "no_annual_statements",       // no annual statement set
    "period_axis_misaligned",     // period_end / labels not aligned to the period axis
    "period_end_missing",         // latest annual column has no valid period end
    "period_order_invalid",       // latest column is not the newest period end
    "no_comparable_prior",        // no unique prior fiscal year 330–400 days earlier
  ],
} as const;

export const FUNDAMENTAL_CONSUMER_REASONS = {
  evaluated: ["ok"],
  stale: ["generation_stale", "fiscal_period_aged", "snapshot_aged"],
  unsupported: ["field_not_produced"],
  unavailable: ["scan_absent", "scan_unavailable", "not_in_scan", "malformed_row"],
} as const;

type ProducerStatus = "unsupported" | "unavailable";
const statusMap = (spec: { unsupported: readonly string[]; unavailable: readonly string[] }) =>
  new Map<string, ProducerStatus>([
    ...spec.unsupported.map((r) => [r, "unsupported"] as const),
    ...spec.unavailable.map((r) => [r, "unavailable"] as const),
  ]);
const ROW_STATUS_OF: ReadonlyMap<string, ProducerStatus> = statusMap(FUNDAMENTAL_ROW_REASONS);
const FIELD_STATUS_OF: ReadonlyMap<string, ProducerStatus> = statusMap(FUNDAMENTAL_FIELD_REASONS);
const RESERVED_REASONS: ReadonlySet<string> = new Set([
  ...FUNDAMENTAL_CONSUMER_REASONS.evaluated,
  ...FUNDAMENTAL_CONSUMER_REASONS.stale,
  ...FUNDAMENTAL_CONSUMER_REASONS.unsupported,
  ...FUNDAMENTAL_CONSUMER_REASONS.unavailable,
]);

// ── Document types ──────────────────────────────────────────────────────────

/** One field of one observed company: a value, or the reason it was withheld. */
export type FundamentalFieldCell = { v: number } | { s: ProducerStatus; r: string };

/** The fiscal year the FY fields belong to (index-aligned to statements.annual). */
export type FundamentalFiscalYear = {
  /** statements.annual.periods[last] — the producer's display label, e.g. "2025". */
  label: string;
  /** statements.annual.period_end[last], YYYY-MM-DD. */
  end: string;
  /** statements.annual.fiscal_year[last] when the artifact carries explicit fiscal identity. */
  fiscal_year: string | null;
  /** statements.annual.period_kind[last] when present (always "full_year" for a valued FY). */
  kind: string | null;
  /** Statement family the producer applied for this period (lib/finStatementMath). */
  fam: string;
  /** statements.annual.src_by_period[last] when present. */
  src: string | null;
  /** statements.annual.filed_by_period[last] (YYYY-MM-DD) when present. */
  filed: string | null;
  /** statements.annual.restated_by_period[last] when present. */
  restated: boolean | null;
};

export type FundamentalObserved = {
  status: "observed";
  reason: "ok";
  /** Fund artifact `asof` (YYYY-MM-DD): the date the source snapshot was captured. */
  asof: string;
  /** quote = trading currency (prices, P/E numerator); stmt = reporting currency. */
  ccy: { quote: string | null; stmt: string | null };
  /** fund.src.statements — the statement vendor. */
  src: string | null;
  fy: FundamentalFiscalYear | null;
  /** The comparable prior fiscal year used by revenue growth, when one was identified. */
  prior: { label: string; end: string } | null;
  f: Record<FundamentalFieldId, FundamentalFieldCell>;
};

export type FundamentalNotObserved = { status: ProducerStatus; reason: string };

export type FundamentalObservation = FundamentalObserved | FundamentalNotObserved;

export type FundamentalRow =
  | ({ kind: "row"; sym: string } & FundamentalObservation)
  | { kind: "malformed"; sym: string; error: string };

export type FundamentalScan = Omit<ScanEnvelope<never>, "rows"> & {
  /** Fields this generation produced (a subset of FUNDAMENTAL_FIELD_IDS). */
  fields: FundamentalFieldId[];
  /** Exact sym → row. Size === universe.count. */
  rows: ReadonlyMap<string, FundamentalRow>;
};

// ── Parsing ─────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);
export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && DATE_RE.test(v) && Number.isFinite(dayMs(v)) && new Date(dayMs(v)).toISOString().slice(0, 10) === v;
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseFieldCell(raw: unknown): FundamentalFieldCell | string {
  if (!isObj(raw)) return "field_invalid";
  if ("v" in raw) {
    if (!isFiniteNum(raw.v)) return "value_invalid";
    return { v: raw.v };
  }
  const { s, r } = raw;
  if (s !== "unsupported" && s !== "unavailable") return "field_status_invalid";
  if (!isReasonCode(r)) return "reason_invalid";
  if (RESERVED_REASONS.has(r)) return "reason_reserved";
  const expected = FIELD_STATUS_OF.get(r);
  if (expected !== undefined && expected !== s) return "reason_status_mismatch";
  return { s, r };
}

function parseFiscalYear(raw: unknown): FundamentalFiscalYear | null | string {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw)) return "fy_invalid";
  const { label, end, fiscal_year, kind, fam, src, filed, restated } = raw;
  if (typeof label !== "string" || !label) return "fy_label_invalid";
  if (!isIsoDate(end)) return "fy_end_invalid";
  if (!isStrOrNull(fiscal_year ?? null) || !isStrOrNull(kind ?? null) || !isStrOrNull(src ?? null)) return "fy_invalid";
  if (typeof fam !== "string" || !fam) return "fy_family_invalid";
  if (filed != null && !isIsoDate(filed)) return "fy_filed_invalid";
  if (restated != null && typeof restated !== "boolean") return "fy_invalid";
  return {
    label, end,
    fiscal_year: (fiscal_year ?? null) as string | null,
    kind: (kind ?? null) as string | null,
    fam,
    src: (src ?? null) as string | null,
    filed: (filed ?? null) as string | null,
    restated: (restated ?? null) as boolean | null,
  };
}

function parseObservation(raw: Record<string, unknown>, fields: readonly FundamentalFieldId[]): FundamentalObservation | string {
  const { status, reason } = raw;
  if (!isReasonCode(reason)) return "reason_invalid";
  if (status === "unsupported" || status === "unavailable") {
    if (RESERVED_REASONS.has(reason)) return "reason_reserved";
    const expected = ROW_STATUS_OF.get(reason);
    if (expected !== undefined && expected !== status) return "reason_status_mismatch";
    return { status, reason };
  }
  if (status !== "observed") return "status_invalid";
  if (reason !== "ok") return "reason_status_mismatch";
  if (!isIsoDate(raw.asof)) return "asof_invalid";
  const ccy = raw.ccy;
  if (!isObj(ccy) || !isStrOrNull(ccy.quote ?? null) || !isStrOrNull(ccy.stmt ?? null)) return "ccy_invalid";
  if (!isStrOrNull(raw.src ?? null)) return "src_invalid";
  const fy = parseFiscalYear(raw.fy);
  if (typeof fy === "string") return fy;
  let prior: { label: string; end: string } | null = null;
  if (raw.prior != null) {
    const p = raw.prior;
    if (!isObj(p) || typeof p.label !== "string" || !p.label || !isIsoDate(p.end)) return "prior_invalid";
    if (fy && p.end >= fy.end) return "prior_not_earlier";
    prior = { label: p.label, end: p.end };
  }
  if (!isObj(raw.f)) return "fields_invalid";
  const f = {} as Record<FundamentalFieldId, FundamentalFieldCell>;
  for (const field of fields) {
    const cell = parseFieldCell((raw.f as Record<string, unknown>)[field]);
    if (typeof cell === "string") return `${field}:${cell}`;
    // A fiscal-year value without the fiscal year it belongs to is exactly the silent
    // substitution AC-E02-02 forbids: the row is malformed, never "probably the latest year".
    if ("v" in cell && FUNDAMENTAL_FIELD_SPEC[field].basis !== "ttm_snapshot" && !fy) return `${field}:fy_missing`;
    if ("v" in cell && FUNDAMENTAL_FIELD_SPEC[field].basis === "fiscal_year_vs_prior" && !prior) return `${field}:prior_missing`;
    f[field] = cell;
  }
  return {
    status: "observed",
    reason: "ok",
    asof: raw.asof,
    ccy: { quote: (ccy.quote ?? null) as string | null, stmt: (ccy.stmt ?? null) as string | null },
    src: (raw.src ?? null) as string | null,
    fy,
    prior,
    f,
  };
}

/**
 * Validate a fundamental scan document. Whole-document rejections: any envelope failure
 * (screenerScan), a missing/empty/unknown `fields` list, or `complete:true` while any row
 * reports `not_processed`. Row-level problems never drop the row: it is kept as
 * `{kind:"malformed"}` and classified unavailable/malformed_row, so the coverage sum still
 * equals the requested universe. An observed row must carry a cell for EVERY produced field.
 */
export function parseFundamentalScan(raw: unknown): ParseResult<FundamentalScan> {
  const env = parseScanEnvelope(raw, FUNDAMENTAL_SCAN_FAMILY, FUNDAMENTAL_SCAN_SUPPORTED_VERSIONS);
  if (!env.ok) return env;
  const doc = raw as Record<string, unknown>;
  if (!Array.isArray(doc.fields) || doc.fields.length === 0) return { ok: false, error: "fields_invalid" };
  const fields: FundamentalFieldId[] = [];
  for (const f of doc.fields) {
    if (!isFundamentalFieldId(f)) return { ok: false, error: "field_unknown" };
    if (fields.includes(f)) return { ok: false, error: "field_duplicate" };
    fields.push(f);
  }

  const rows = new Map<string, FundamentalRow>();
  let notProcessed = 0;
  for (const r of env.value.rows) {
    const o = parseObservation(r, fields);
    if (typeof o === "string") {
      rows.set(r.sym, { kind: "malformed", sym: r.sym, error: o });
      continue;
    }
    if (o.status === "unavailable" && o.reason === "not_processed") notProcessed += 1;
    rows.set(r.sym, { kind: "row", sym: r.sym, ...o });
  }
  if (env.value.complete && notProcessed > 0) return { ok: false, error: "complete_with_not_processed" };

  const { rows: _drop, ...meta } = env.value;
  void _drop;
  return { ok: true, value: { ...meta, fields, rows } };
}

// ── Reader state ────────────────────────────────────────────────────────────
// What the consumer holds once a read SETTLES. "Loading" is not a coverage population and is
// rendered by the caller before any classification (failure-state-truth law).
export type FundamentalScanSource =
  | { kind: "ready"; scan: FundamentalScan; refreshFailed?: boolean }
  | { kind: "absent" }                 // HTTP 404 — no generation has ever been published
  | { kind: "error"; error: string };  // network failure, non-JSON body, or rejected document

/** Adapt one HTTP read to a source. 404 ⇒ absent; 2xx + valid ⇒ ready; anything else ⇒ error. */
export function readFundamentalScanResponse(httpStatus: number, body: unknown): FundamentalScanSource {
  if (httpStatus === 404) return { kind: "absent" };
  if (httpStatus < 200 || httpStatus >= 300) return { kind: "error", error: `http_${httpStatus}` };
  const parsed = parseFundamentalScan(body);
  return parsed.ok ? { kind: "ready", scan: parsed.value } : { kind: "error", error: parsed.error };
}

/** Fold a revalidation into what the reader holds — the same adoption rule as E01. */
export function nextFundamentalSource(
  held: FundamentalScanSource | null,
  incoming: FundamentalScanSource,
): { source: FundamentalScanSource; decision: AdoptDecision | null } {
  const heldScan = held?.kind === "ready" ? held.scan : null;
  if (incoming.kind !== "ready") {
    if (heldScan) return { source: { kind: "ready", scan: heldScan, refreshFailed: true }, decision: null };
    return { source: incoming, decision: null };
  }
  const decision = adoptGeneration(heldScan, incoming.scan);
  if (decision.adopt || !heldScan) return { source: { kind: "ready", scan: incoming.scan }, decision };
  return { source: { kind: "ready", scan: heldScan }, decision };
}

// ── Classification ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const nowMs = (now: Date | number): number => (typeof now === "number" ? now : now.getTime());
const ageDays = (day: string, now: Date | number): number => (nowMs(now) - dayMs(day)) / DAY_MS;

export type FundamentalClassification = {
  coverage: Coverage;
  /** The stored value for evaluated AND stale cells (a stale value is shown with its age).
   *  Never used by a filter unless the coverage is evaluated. */
  value: number | null;
  /** The observed company row (for period/source display), when there is one. */
  row: FundamentalObserved | null;
};

/**
 * Classify one symbol for one field. First matching rule wins:
 *   source absent / error              → unavailable  scan_absent / scan_unavailable
 *   field not produced                 → unsupported  field_not_produced
 *   sym not in scan                    → unavailable  not_in_scan
 *   malformed row                      → unavailable  malformed_row
 *   row unsupported/unavailable        → that status  row reason
 *   field withheld                     → that status  field reason
 *   generation too old                 → stale        generation_stale
 *   FY field, fiscal year ended long ago → stale      fiscal_period_aged
 *   TTM snapshot, artifact too old     → stale        snapshot_aged
 *   otherwise                          → evaluated    ok
 * `sym` is matched EXACTLY: one listing, one row.
 */
export function classifyFundamental(
  source: FundamentalScanSource,
  sym: string,
  field: FundamentalFieldId,
  now: Date | number,
): FundamentalClassification {
  const none = (status: CoverageStatus, reason: string, row: FundamentalObserved | null = null): FundamentalClassification =>
    ({ coverage: { status, reason }, value: null, row });
  if (source.kind === "absent") return none("unavailable", "scan_absent");
  if (source.kind === "error") return none("unavailable", "scan_unavailable");
  const scan = source.scan;
  if (!scan.fields.includes(field)) return none("unsupported", "field_not_produced");
  const row = scan.rows.get(sym);
  if (!row) return none("unavailable", "not_in_scan");
  if (row.kind === "malformed") return none("unavailable", "malformed_row");
  if (row.status !== "observed") return none(row.status, row.reason);
  const cell = row.f[field];
  if (!cell) return none("unavailable", "malformed_row");
  if (!("v" in cell)) return none(cell.s, cell.r, row);
  const stale = (reason: string): FundamentalClassification =>
    ({ coverage: { status: "stale", reason }, value: cell.v, row });
  if (generationAgeDays(scan, now) > FUNDAMENTAL_GENERATION_MAX_AGE_DAYS) return stale("generation_stale");
  const basis = FUNDAMENTAL_FIELD_SPEC[field].basis;
  if (basis === "ttm_snapshot") {
    if (ageDays(row.asof, now) > SNAPSHOT_MAX_AGE_DAYS) return stale("snapshot_aged");
  } else if (row.fy && ageDays(row.fy.end, now) > FISCAL_PERIOD_MAX_AGE_DAYS) {
    return stale("fiscal_period_aged");
  }
  return { coverage: { status: "evaluated", reason: "ok" }, value: cell.v, row };
}

/** Partition a requested universe for one field. Sum invariant per accountCoverage. */
export function accountFundamentalCoverage(
  requestedIds: Iterable<string>,
  source: FundamentalScanSource,
  field: FundamentalFieldId,
  now: Date | number,
): CoverageAccount {
  return accountCoverage(requestedIds, (id) => classifyFundamental(source, id, field, now).coverage);
}

/** A field as a filterable cell: known ONLY when evaluated. */
export function fundamentalCellOf(c: FundamentalClassification): ScanCell<number> {
  if (c.coverage.status !== "evaluated" || c.value === null) return unknownCell(c.coverage.status, c.coverage.reason);
  return knownCell(c.value);
}

// ── Predicates ──────────────────────────────────────────────────────────────
// Thresholds are ALWAYS in stored units (0.15 for 15%); see toStoredThreshold.

export type FundamentalPredicate =
  | { field: FundamentalFieldId; op: "range"; gte?: number; lte?: number; includeUnknown?: boolean }
  | { field: FundamentalFieldId; op: "unknown" };

export function matchFundamentalPredicate(c: FundamentalClassification, p: FundamentalPredicate): ScanMatch {
  if (p.op === "unknown") return matchUnknown(fundamentalCellOf(c));
  return matchRange(fundamentalCellOf(c), { gte: p.gte, lte: p.lte }, { includeUnknown: p.includeUnknown === true });
}

/** Evaluate predicates for one symbol: Kleene AND, plus the per-field classifications. */
export function evaluateFundamentalScreen(
  source: FundamentalScanSource,
  sym: string,
  predicates: readonly FundamentalPredicate[],
  now: Date | number,
): { match: ScanMatch; cells: Partial<Record<FundamentalFieldId, FundamentalClassification>> } {
  const cells: Partial<Record<FundamentalFieldId, FundamentalClassification>> = {};
  const matches = predicates.map((p) => {
    const c = cells[p.field] ?? (cells[p.field] = classifyFundamental(source, sym, p.field, now));
    return matchFundamentalPredicate(c, p);
  });
  return { match: combineAll(matches), cells };
}

/**
 * Validate a persisted/serialized predicate list. Rejects unknown fields, ops, malformed
 * bounds or an empty range rather than silently dropping a predicate (dropping widens a screen).
 */
export function parseFundamentalScreen(raw: unknown): ParseResult<FundamentalPredicate[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "screen_invalid" };
  const out: FundamentalPredicate[] = [];
  for (const p of raw) {
    if (!isObj(p) || !isFundamentalFieldId(p.field)) return { ok: false, error: "predicate_field_unknown" };
    if (p.op === "unknown") { out.push({ field: p.field, op: "unknown" }); continue; }
    if (p.op !== "range") return { ok: false, error: "predicate_op_invalid" };
    if (p.includeUnknown !== undefined && typeof p.includeUnknown !== "boolean") return { ok: false, error: "predicate_include_unknown_invalid" };
    const okNum = (v: unknown) => v === undefined || isFiniteNum(v);
    if (!okNum(p.gte) || !okNum(p.lte) || (p.gte === undefined && p.lte === undefined)) return { ok: false, error: "predicate_range_invalid" };
    if (p.gte !== undefined && p.lte !== undefined && (p.gte as number) > (p.lte as number)) return { ok: false, error: "predicate_range_invalid" };
    out.push({
      field: p.field,
      op: "range",
      ...(p.gte !== undefined ? { gte: p.gte as number } : {}),
      ...(p.lte !== undefined ? { lte: p.lte as number } : {}),
      ...(p.includeUnknown === true ? { includeUnknown: true } : {}),
    });
  }
  return { ok: true, value: out };
}

// ── Units: the ONE scaling boundary (AC-E02-01) ─────────────────────────────
// A fraction is entered and displayed in percent; it is stored, compared and published as a
// fraction. Each direction scales exactly once, and the rounding removes binary noise
// (14.3 / 100 = 0.14300000000000002) so a typed threshold equals the stored value it names.

const roundTo = (v: number, decimals: number): number => {
  const k = 10 ** decimals;
  return Math.round(v * k) / k;
};

/** Store a value at its field's published precision (shared by producer and tests). */
export const roundStored = (field: FundamentalFieldId, v: number): number => roundTo(v, FUNDAMENTAL_FIELD_SPEC[field].decimals);

/** User-typed number (percent for fractions, × for multiples) → stored threshold. */
export function toStoredThreshold(field: FundamentalFieldId, typed: number): number {
  return FUNDAMENTAL_FIELD_SPEC[field].unit === "fraction" ? roundTo(typed / 100, 6) : roundTo(typed, 4);
}

/** Stored value → the number shown to the user (percent for fractions). */
export function toDisplayNumber(field: FundamentalFieldId, stored: number): number {
  return FUNDAMENTAL_FIELD_SPEC[field].unit === "fraction" ? roundTo(stored * 100, 4) : stored;
}

const NUM_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const MULT_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 1 });

/** "15%" for 0.15, "37.84×" for 37.8373. Same string in EN and ZH. */
export function formatFundamentalValue(field: FundamentalFieldId, stored: number): string {
  if (!Number.isFinite(stored)) return "—";
  return FUNDAMENTAL_FIELD_SPEC[field].unit === "fraction"
    ? `${NUM_FMT.format(toDisplayNumber(field, stored))}%`
    : `${MULT_FMT.format(stored)}×`;
}

/** Parse a typed bound; "" ⇒ undefined (no bound), junk ⇒ null (invalid). */
export function parseTypedBound(field: FundamentalFieldId, text: string): number | undefined | null {
  const t = text.trim().replace(/[%×x,]/gi, "");
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? toStoredThreshold(field, n) : null;
}

/** A predicate's bounds back in typed units, for chip labels and inputs. */
export function describeRange(field: FundamentalFieldId, p: { gte?: number; lte?: number }): string {
  const lo = p.gte !== undefined ? formatFundamentalValue(field, p.gte) : null;
  const hi = p.lte !== undefined ? formatFundamentalValue(field, p.lte) : null;
  if (lo && hi) return `${lo} – ${hi}`;
  if (lo) return `≥ ${lo}`;
  if (hi) return `≤ ${hi}`;
  return "";
}

// ── Screen tally: explainable filtered results (AC-E02-05) ──────────────────
// The Screener records every row that passed its other filters (and is visible under the
// user's market preferences); the tally then says how many matched, how many failed on a KNOWN
// value, how many were excluded only because a value was unknown — and, per field, the
// coverage partition by reason (taxonomy-family restrictions included).

export type FundamentalScreenResult = { match: ScanMatch; cells: Partial<Record<FundamentalFieldId, FundamentalClassification>> };

export type FundamentalTally = {
  /** Rows the fundamental predicates were applied to. */
  population: number;
  /** Rows admitted (match pass). */
  matched: number;
  /** Admitted rows that passed only through an explicit include-unknown opt-in. */
  includedUnknown: number;
  /** Rows excluded because a KNOWN value failed a predicate. */
  failed: number;
  /** Rows excluded only because a value was unknown (no known failure). */
  excludedUnknown: number;
  /** Per predicate field: coverage partition of the population. */
  byField: Partial<Record<FundamentalFieldId, CoverageAccount>>;
};

export function createFundamentalTally(predicates: readonly FundamentalPredicate[]) {
  const fields = [...new Set(predicates.map((p) => p.field))];
  const seen = new Map<string, FundamentalScreenResult>();
  return {
    record(sym: string, res: FundamentalScreenResult): void {
      if (!seen.has(sym)) seen.set(sym, res);
    },
    result(): FundamentalTally {
      let matched = 0, includedUnknown = 0, failed = 0, excludedUnknown = 0;
      for (const res of seen.values()) {
        if (passes(res.match)) {
          matched += 1;
          if (predicates.some((p) => p.op === "range" && p.includeUnknown === true && res.cells[p.field]?.coverage.status !== "evaluated")) {
            includedUnknown += 1;
          }
        } else if (res.match === "fail") failed += 1;
        else excludedUnknown += 1;
      }
      const byField: Partial<Record<FundamentalFieldId, CoverageAccount>> = {};
      for (const f of fields) {
        byField[f] = accountCoverage(seen.keys(), (id) => {
          const c = seen.get(id)?.cells[f];
          if (!c) throw new Error("unclassified");
          return c.coverage;
        });
      }
      return { population: seen.size, matched, includedUnknown, failed, excludedUnknown, byField };
    },
  };
}

/** What one field looks like over a population: its coverage partition, and the span of
 *  reference dates its KNOWN values belong to — fiscal-year ends for FY fields, snapshot dates
 *  for the TTM multiple — so the screen never shows only the build clock (AC-E02-04). */
export type FundamentalFieldSummary = {
  coverage: CoverageAccount;
  /** Earliest / latest reference date among evaluated values; null when none is known. */
  refMin: string | null;
  refMax: string | null;
};

/** The reference date a classified value belongs to (fiscal-year end, or snapshot date). */
export function fundamentalReferenceDate(field: FundamentalFieldId, c: FundamentalClassification): string | null {
  if (!c.row) return null;
  return FUNDAMENTAL_FIELD_SPEC[field].basis === "ttm_snapshot" ? c.row.asof : (c.row.fy?.end ?? null);
}

export function summarizeFundamentalField(
  ids: Iterable<string>,
  classify: (id: string) => FundamentalClassification,
  field: FundamentalFieldId,
): FundamentalFieldSummary {
  let refMin: string | null = null;
  let refMax: string | null = null;
  const coverage = accountCoverage(ids, (id) => {
    const c = classify(id);
    if (c.coverage.status === "evaluated") {
      const d = fundamentalReferenceDate(field, c);
      if (d !== null) {
        if (refMin === null || d < refMin) refMin = d;
        if (refMax === null || d > refMax) refMax = d;
      }
    }
    return c.coverage;
  });
  return { coverage, refMin, refMax };
}

// ── Statement drilldown (input → screen → statement) ────────────────────────

/** `/terminal?pane=statements&sym=…` for a screen row; null when the symbol is unusable. */
export function fundamentalStatementsHref(sym: unknown): string | null {
  const symbol = canonicalChartSymbol(sym);
  return symbol ? `/terminal?pane=statements&sym=${encodeURIComponent(symbol)}` : null;
}

/** The per-company fund artifact URL; null for a symbol that is not a safe data-file name. */
export function fundArtifactUrl(sym: unknown): string | null {
  const symbol = canonicalChartSymbol(sym);
  return symbol && symbol === sym ? `/data/${symbol}.fund.json` : null;
}
