// ── Cross-market screening rules (E03) ────────────────────────────────────────
// The ONE projection the Screener uses to show and filter industries and money across markets.
// Pure: the scan (lib/classificationScan.ts) says what each listing's owner record states; this
// module decides what a screen may do with it.
//
//   classification  A label is filtered only under the native taxonomy the user picked. A stale
//                   label (an undated snapshot, an aged owner record, an old generation) is
//                   shown with its age and admitted only by an explicit "include stale" opt-in.
//                   There is no crosswalk: a Yahoo label never answers a GICS filter.
//   money           Price × volume is in the LISTING'S currency. A floor is applied in exactly
//                   one currency scope; listings in other currencies are not compared (no FX
//                   conversion exists), they are excluded and counted. Indices, rates, FX and
//                   futures have no traded value at all.
//   reconcile       A market change keeps every filter that still has a population in the new
//                   market and clears — by name, with the reason — every one that does not, so
//                   a screen never silently turns into an empty table.

import {
  GICS_SECTORS,
  SECTOR_TAXONOMIES,
  CURRENCY_RE,
  classifyCurrency,
  classifyLabel,
  isTaxonomyId,
  labelCellOf,
  labelOf,
  matchClassification,
  type ClassLabelCell,
  type ClassificationPredicate,
  type ClassificationScanSource,
  type LabelClassification,
  type LabelSource,
  type TaxonomyId,
} from "./classificationScan";

/** Label-select value for "no label in this taxonomy" — the visible unclassified population. */
export const UNCLASSIFIED = "__unclassified__";

// ── Labels ──────────────────────────────────────────────────────────────────

const GICS_SET: ReadonlySet<string> = new Set(GICS_SECTORS);
/** Reasons for which the scan holds no cell for this listing at all. */
const SCAN_MISS: ReadonlySet<string> = new Set(["scan_absent", "scan_unavailable", "not_in_scan"]);

/**
 * classifyLabel, plus the one fallback the producer itself applies: when the scan has no row
 * for a listing, the manifest's undated `gics` reference snapshot is still shown — as
 * stale/snapshot_undated from manifest_gics, exactly as the producer would have carried it. It
 * never becomes a current label (AC-E03-03), and it is never re-filed under another taxonomy.
 */
export function resolveLabel(
  source: ClassificationScanSource,
  row: { sym: string; gics?: string | null },
  taxonomy: TaxonomyId,
  now: Date | number,
): LabelClassification {
  const c = classifyLabel(source, row.sym, taxonomy, now);
  if (taxonomy !== "gics_sector" || c.cell !== null || !SCAN_MISS.has(c.coverage.reason)) return c;
  if (!row.gics || !GICS_SET.has(row.gics)) return c;
  const cell: ClassLabelCell = {
    status: "stale", reason: "snapshot_undated", label: row.gics, as_of: null, source: "manifest_gics", reclassified_from: null,
  };
  return { taxonomy, coverage: { status: "stale", reason: "snapshot_undated" }, cell };
}

/** What the sector cell shows for one listing. Every label names its taxonomy (AC-E03-02). */
export type SectorDisplay =
  | { kind: "label"; taxonomy: TaxonomyId; label: string; stale: boolean; reason: string; asOf: string | null; source: LabelSource }
  /** No label in the taxonomy (or any sector taxonomy). `rawLabel` is a source label the
   *  producer could not attribute to a taxonomy — shown as provenance, never as a label. */
  | { kind: "unclassified"; taxonomy: TaxonomyId | null; reason: string; rawLabel: string | null }
  | { kind: "not_applicable"; reason: string }
  | { kind: "unavailable"; reason: string };

const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([...SCAN_MISS, "malformed_row"]);

/**
 * The sector cell. With a taxonomy picked, that taxonomy's cell; otherwise the first CURRENT
 * label across the sector taxonomies (GICS, Yahoo, CN profile — in that order), then the first
 * stale one. Never a blend: the chosen label keeps the taxonomy it came from.
 */
export function sectorDisplay(
  source: ClassificationScanSource,
  row: { sym: string; gics?: string | null },
  taxonomy: TaxonomyId | null,
  now: Date | number,
): SectorDisplay {
  const cs = (taxonomy ? [taxonomy] : SECTOR_TAXONOMIES).map((t) => resolveLabel(source, row, t, now));
  const asLabel = (c: LabelClassification, stale: boolean): SectorDisplay | null => {
    const cell = c.cell;
    if (!cell || (cell.status !== "evaluated" && cell.status !== "stale")) return null;
    return { kind: "label", taxonomy: c.taxonomy, label: cell.label, stale, reason: c.coverage.reason, asOf: cell.as_of, source: cell.source };
  };
  for (const c of cs) if (c.coverage.status === "evaluated") { const d = asLabel(c, false); if (d) return d; }
  for (const c of cs) if (c.coverage.status === "stale") { const d = asLabel(c, true); if (d) return d; }
  const reasons = cs.map((c) => c.coverage.reason);
  if (reasons.includes("asset_class_not_covered")) return { kind: "not_applicable", reason: "asset_class_not_covered" };
  if (reasons.every((r) => UNAVAILABLE_REASONS.has(r))) return { kind: "unavailable", reason: reasons[0] };
  const specific = reasons.find((r) => r !== "taxonomy_not_supplied" && !UNAVAILABLE_REASONS.has(r));
  const rawLabel = cs.map((c) => c.cell?.label ?? null).find((l) => l !== null) ?? null;
  return { kind: "unclassified", taxonomy, reason: specific ?? reasons.find((r) => !UNAVAILABLE_REASONS.has(r)) ?? reasons[0], rawLabel };
}

// ── Classification filter ───────────────────────────────────────────────────

export type CrossMarketFilters = {
  market: string;              // "all" | MarketId
  sector: string;              // "all" | a label of `taxonomy` | UNCLASSIFIED
  taxonomy?: TaxonomyId | null;
  classStale?: boolean;        // explicit opt-in: stale labels may match
  ccy?: string;                // "auto" | a currency code
  liq: number;                 // traded-value floor in the scope currency; 0 = none
  mcap: number;                // USD market-cap floor (US reference data only); 0 = none
};

/** The taxonomy a filter state screens on. A label without a taxonomy is a legacy preset,
 *  which filtered the manifest's GICS strings — so it is read as GICS. */
export const effectiveTaxonomy = (f: Pick<CrossMarketFilters, "taxonomy" | "sector">): TaxonomyId | null =>
  f.taxonomy ?? (f.sector !== "all" ? "gics_sector" : null);

export function classPredicateOf(f: Pick<CrossMarketFilters, "taxonomy" | "sector" | "classStale">): ClassificationPredicate | null {
  const taxonomy = effectiveTaxonomy(f);
  if (!taxonomy || f.sector === "all") return null;
  if (f.sector === UNCLASSIFIED) return { taxonomy, op: "unclassified" };
  return { taxonomy, op: "in", labels: [f.sector], ...(f.classStale ? { includeStale: true } : {}) };
}

/** Why a row left a classification screen. Only the two counted outcomes are named: a row the
 *  label simply does not match is a plain "fail". */
export type ClassOutcome = "pass" | "fail" | "stale_excluded" | "unclassified_excluded";

export function screenClassification(c: LabelClassification, p: ClassificationPredicate): ClassOutcome {
  const m = matchClassification(c, p);
  if (m === "pass") return "pass";
  if (m === "fail" || p.op === "unclassified") return "fail";
  // unknown: no evaluated label under this taxonomy
  if (c.coverage.status === "stale") {
    const l = labelOf(c);
    return l !== null && p.labels.includes(l) ? "stale_excluded" : "fail";
  }
  return "unclassified_excluded";
}

/** A row's standing under one taxonomy — the three disjoint populations the coverage line
 *  counts and the label select offers (a label, "include stale", "Unclassified"). */
export function labelStanding(c: LabelClassification): "current" | "stale" | "unclassified" {
  if (labelCellOf(c).known) return "current";
  if (c.coverage.status === "stale" && labelOf(c) !== null) return "stale";
  return "unclassified";
}

// ── Money ───────────────────────────────────────────────────────────────────

/** The unit of a listing's price × volume. */
export type MoneyCurrency =
  | { kind: "code"; code: string }
  | { kind: "not_money"; reason: string }   // index level, yield, FX rate, futures points
  | { kind: "unknown"; reason: string };    // scan absent, row missing, owner record silent

export function moneyCurrency(source: ClassificationScanSource, sym: string): MoneyCurrency {
  const c = classifyCurrency(source, sym);
  if (c.code) return { kind: "code", code: c.code };
  if (c.coverage.reason === "currency_not_applicable") return { kind: "not_money", reason: c.coverage.reason };
  return { kind: "unknown", reason: c.coverage.reason };
}

export type CurrencyScope = {
  /** The one currency monetary floors are applied in; null when no listing has a known one. */
  code: string | null;
  auto: boolean;
  /** Known listing currencies in the population, most common first (ties by code). */
  codes: ReadonlyArray<{ code: string; n: number }>;
};

/**
 * The currency scope of a screen. An explicit pick is kept as is. "auto" is `preferred` when the
 * population has listings in it, and otherwise the population's most common listing currency
 * (ties by code). The Screener passes USD as `preferred` for the all-markets screen — the unit
 * its floors were always labelled in — and null for a single market, so a Hong Kong screen is in
 * HKD and a mainland one in CNY even though both carry a few listings in other currencies.
 */
export function resolveCurrencyScope(
  pref: string | undefined,
  currencies: Iterable<MoneyCurrency>,
  preferred: string | null,
): CurrencyScope {
  const counts = new Map<string, number>();
  for (const c of currencies) if (c.kind === "code") counts.set(c.code, (counts.get(c.code) ?? 0) + 1);
  const codes = Array.from(counts, ([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  if (pref && pref !== "auto") return { code: pref, auto: false, codes };
  return { code: preferred !== null && counts.has(preferred) ? preferred : codes[0]?.code ?? null, auto: true, codes };
}

export type MoneyOutcome = "pass" | "below" | "value_missing" | "other_currency" | "currency_unknown" | "not_money";

/** Apply a floor to one listing's money value. Only same-currency values are ever compared. */
export function matchMoneyFloor(value: number | null | undefined, cur: MoneyCurrency, floor: number, scopeCode: string | null): MoneyOutcome {
  if (cur.kind === "not_money") return "not_money";
  if (cur.kind === "unknown") return "currency_unknown";
  if (scopeCode === null || cur.code !== scopeCode) return "other_currency";
  if (value == null || !Number.isFinite(value)) return "value_missing";
  return value >= floor ? "pass" : "below";
}

/**
 * Sort order for a money column: the scope currency first, then each other currency as its own
 * block (by code), then everything that has no comparable value. Values are compared only
 * within one currency; direction flips the values, never the blocks.
 */
export function compareMoney(
  a: { v: number | null | undefined; cur: MoneyCurrency },
  b: { v: number | null | undefined; cur: MoneyCurrency },
  scopeCode: string | null,
  dir: 1 | -1,
): number {
  const rank = (x: { v: number | null | undefined; cur: MoneyCurrency }): number =>
    x.cur.kind !== "code" || x.v == null || !Number.isFinite(x.v) ? 2 : x.cur.code === scopeCode ? 0 : 1;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) return 0;
  const ca = (a.cur as { code: string }).code, cb = (b.cur as { code: string }).code;
  if (ca !== cb) return ca < cb ? -1 : 1;
  const va = a.v as number, vb = b.v as number;
  return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
}

const abbr = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
};

/** A money cell: "$1.20B" for USD, "HKD 1.20B" / "GBp 3.4M" otherwise, "? 1.20B" when the
 *  currency is unknown, "—" for an instrument whose price × volume is not money. */
export function formatMoney(n: number | null | undefined, cur: MoneyCurrency): string {
  if (cur.kind === "not_money" || n == null || !Number.isFinite(n)) return "—";
  if (cur.kind === "unknown") return `? ${abbr(n)}`;
  return cur.code === "USD" ? `$${abbr(n)}` : `${cur.code} ${abbr(n)}`;
}

/** A round floor in its scope currency: "$5M", "HKD 5M", "? 5M" (no scope). */
export function formatFloor(n: number, code: string | null): string {
  const s = n >= 1e12 ? `${n / 1e12}T` : n >= 1e9 ? `${n / 1e9}B` : n >= 1e6 ? `${n / 1e6}M` : `${n}`;
  return code === "USD" ? `$${s}` : code ? `${code} ${s}` : `? ${s}`;
}

// ── Exclusion accounting ────────────────────────────────────────────────────

export type ExclusionCounts = {
  stale: number;           // label matched, but only as a stale label
  unclassified: number;    // no label at all under the screened taxonomy
  otherCurrency: number;   // a money floor in another currency than the scope
  currencyUnknown: number; // a money floor, listing currency unknown
  notMoney: number;        // a money floor on an index / rate / FX / futures row
};
export const NO_EXCLUSIONS: ExclusionCounts = { stale: 0, unclassified: 0, otherCurrency: 0, currencyUnknown: 0, notMoney: 0 };

export type CrossMarketExclusion = keyof ExclusionCounts;

/**
 * The cross-market predicates for one row, run after every other filter so the counts describe
 * rows that would OTHERWISE be results. null = admitted; "fail" = an ordinary non-match.
 */
export function screenCrossMarket(
  cls: LabelClassification | null,
  pred: ClassificationPredicate | null,
  money: { v: number | null | undefined; cur: MoneyCurrency } | null,
  liq: number,
  scopeCode: string | null,
): CrossMarketExclusion | "fail" | null {
  if (pred && cls) {
    const o = screenClassification(cls, pred);
    if (o === "stale_excluded") return "stale";
    if (o === "unclassified_excluded") return "unclassified";
    if (o === "fail") return "fail";
  }
  if (liq > 0 && money) {
    const m = matchMoneyFloor(money.v, money.cur, liq, scopeCode);
    if (m === "other_currency") return "otherCurrency";
    if (m === "currency_unknown") return "currencyUnknown";
    if (m === "not_money") return "notMoney";
    if (m !== "pass") return "fail";
  }
  return null;
}

// ── Market change reconciliation (AC-E03-05) ────────────────────────────────

export type ClearedFilter = {
  field: "ccy" | "liq" | "mcap" | "taxonomy" | "sector";
  /** What was set (a currency code, a floor, a taxonomy id or a label). */
  value: string;
  reason: "currency_not_in_market" | "currency_unavailable" | "mcap_not_covered" | "taxonomy_not_covered" | "label_not_present";
};

export type ReconcileProbe<L> = {
  currency: (l: L) => MoneyCurrency;
  mcap: (l: L) => number | null;
  label: (l: L, taxonomy: TaxonomyId) => LabelClassification;
};

/**
 * Validate a filter state against the population it is about to screen (the listings of
 * `next.market`, already scoped by the caller). Filters that still describe part of that
 * population are kept untouched; each one that describes none of it is reset and reported.
 * Language is not an input: labels and codes are stored canonically and only displayed
 * translated, so a language change never needs this.
 */
export function reconcileFilters<F extends CrossMarketFilters, L>(
  next: F,
  population: readonly L[],
  probe: ReconcileProbe<L>,
): { next: F; cleared: ClearedFilter[] } {
  const cleared: ClearedFilter[] = [];
  const out: F = { ...next };
  const codes = new Set<string>();
  for (const l of population) { const c = probe.currency(l); if (c.kind === "code") codes.add(c.code); }

  if (out.ccy && out.ccy !== "auto" && !codes.has(out.ccy)) {
    cleared.push({ field: "ccy", value: out.ccy, reason: codes.size > 0 ? "currency_not_in_market" : "currency_unavailable" });
    out.ccy = "auto";
  }
  if (out.liq > 0 && codes.size === 0) {
    cleared.push({ field: "liq", value: String(out.liq), reason: "currency_unavailable" });
    out.liq = 0;
  }
  if (out.mcap > 0 && !population.some((l) => probe.mcap(l) != null)) {
    cleared.push({ field: "mcap", value: String(out.mcap), reason: "mcap_not_covered" });
    out.mcap = 0;
  }
  const taxonomy = effectiveTaxonomy(out);
  if (taxonomy) {
    const present = new Set<string>();
    for (const l of population) {
      const c = probe.label(l, taxonomy);
      if (labelStanding(c) !== "unclassified") present.add(labelOf(c) as string);
    }
    if (present.size === 0) {
      cleared.push({ field: "taxonomy", value: taxonomy, reason: "taxonomy_not_covered" });
      out.taxonomy = null; out.sector = "all"; out.classStale = false;
    } else if (out.sector !== "all" && out.sector !== UNCLASSIFIED && !present.has(out.sector)) {
      cleared.push({ field: "sector", value: out.sector, reason: "label_not_present" });
      out.sector = "all"; out.classStale = false;
    }
  }
  return { next: out, cleared };
}

/** Normalize the cross-market fields of a stored (device-local) preset. Unknown values fall
 *  back to their neutral setting; a legacy sector label keeps screening GICS. */
export function sanitizeCrossMarketFields(raw: { sector?: unknown; taxonomy?: unknown; classStale?: unknown; ccy?: unknown }): {
  sector: string; taxonomy: TaxonomyId | null; classStale: boolean; ccy: string;
} {
  const sector = typeof raw.sector === "string" && raw.sector !== "" ? raw.sector : "all";
  let taxonomy: TaxonomyId | null = isTaxonomyId(raw.taxonomy) ? raw.taxonomy : null;
  if (!taxonomy && sector !== "all") taxonomy = "gics_sector";
  const ccy = typeof raw.ccy === "string" && (raw.ccy === "auto" || CURRENCY_RE.test(raw.ccy)) ? raw.ccy : "auto";
  return { sector, taxonomy, classStale: raw.classStale === true, ccy };
}
