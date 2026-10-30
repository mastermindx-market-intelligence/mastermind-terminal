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
//                   a screen never silently turns into an empty table. A floor is a number IN a
//                   currency: when the scope currency changes it is cleared by name, never re-read
//                   in the new unit. Nothing is cleared on the strength of a read that failed.
//   not read        A listing whose owner record was not read (scan absent/unreadable, no row,
//                   malformed row, record unreadable, not processed) has an UNKNOWN label: it is
//                   counted as "not read", never as unclassified and never as a non-match.

import { MARKET_IDS } from "./markets";
import {
  GICS_SECTORS,
  SECTOR_TAXONOMIES,
  CURRENCY_RE,
  classifyCurrency,
  classifyLabel,
  isTaxonomyId,
  labelCellOf,
  labelNotRead,
  labelOf,
  LABEL_NOT_READ_REASONS,
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
  // Not read: every taxonomy that could have held a label (one that is not simply absent from
  // this listing's source) failed to be read — its label is unknown, not missing.
  const telling = reasons.filter((r) => r !== "taxonomy_not_supplied");
  const unread = telling.length > 0 ? telling : reasons;
  if (unread.every((r) => LABEL_NOT_READ_REASONS.has(r))) return { kind: "unavailable", reason: unread[0] };
  const specific = reasons.find((r) => r !== "taxonomy_not_supplied" && !LABEL_NOT_READ_REASONS.has(r));
  const rawLabel = cs.map((c) => c.cell?.label ?? null).find((l) => l !== null) ?? null;
  return { kind: "unclassified", taxonomy, reason: specific ?? reasons.find((r) => !LABEL_NOT_READ_REASONS.has(r)) ?? reasons[0], rawLabel };
}

// ── Classification filter ───────────────────────────────────────────────────

export type CrossMarketFilters = {
  market: string;              // "all" | MarketId
  sector: string;              // "all" | a label of `taxonomy` | UNCLASSIFIED
  taxonomy?: TaxonomyId | null;
  classStale?: boolean;        // explicit opt-in: stale labels may match
  ccy?: string;                // "auto" | a currency code
  liq: number;                 // traded-value floor in the scope currency; 0 = none
  /** The currency the floor was set in. null = not yet bound (bound to the first scope it is
   *  applied in). A floor never carries over into another currency. */
  liqCcy?: string | null;
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

/** Why a row left a classification screen. Only the counted outcomes are named: a row the
 *  label simply does not match is a plain "fail". A row whose record was not read is
 *  "unread_excluded" under EITHER op — its label is unknown, so it is neither a non-match nor
 *  unclassified. */
export type ClassOutcome = "pass" | "fail" | "stale_excluded" | "unclassified_excluded" | "unread_excluded";

export function screenClassification(c: LabelClassification, p: ClassificationPredicate): ClassOutcome {
  const m = matchClassification(c, p);
  if (m === "pass") return "pass";
  if (labelNotRead(c)) return "unread_excluded";
  if (m === "fail" || p.op === "unclassified") return "fail";
  // unknown: no evaluated label under this taxonomy
  if (c.coverage.status === "stale") {
    const l = labelOf(c);
    return l !== null && p.labels.includes(l) ? "stale_excluded" : "fail";
  }
  return "unclassified_excluded";
}

export type LabelStanding = "current" | "stale" | "unclassified" | "unavailable";

/** A row's standing under one taxonomy — the four disjoint populations the coverage line
 *  counts: a current label, a stale one ("include stale"), no label ("Unclassified"), and a
 *  record that was not read ("unavailable" — its label is unknown, so it is in none of the
 *  other three and no label pick or "Unclassified" can select it). */
export function labelStanding(c: LabelClassification): LabelStanding {
  if (labelCellOf(c).known) return "current";
  if (c.coverage.status === "stale" && labelOf(c) !== null) return "stale";
  if (labelNotRead(c)) return "unavailable";
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

/** One listing's money value for sorting; `mkt` is the listing's own market (never a currency). */
export type MoneySortItem = { v: number | null | undefined; cur: MoneyCurrency; mkt?: string | null };

const marketOrder = (m: string | null | undefined): number => {
  const i = m == null ? -1 : (MARKET_IDS as readonly string[]).indexOf(m);
  return i < 0 ? MARKET_IDS.length : i;
};

/**
 * Sort order for a money column: the scope currency first, then each other currency as its own
 * block (by code), then everything that has no comparable value. Values are compared only
 * within one currency; direction flips the values, never the blocks.
 *
 * A listing whose currency was not read still has an amount in its own market's quote unit, so
 * those rows are ordered by amount within their own market only (markets in the product's
 * market order, never interleaved). That keeps a failed or pending classification read from
 * turning the traded-value sort into an arbitrary list, without ranking one market's amounts
 * against another's. Rows with no amount, or no money at all, stay last in their incoming order.
 */
export function compareMoney(a: MoneySortItem, b: MoneySortItem, scopeCode: string | null, dir: 1 | -1): number {
  const finite = (x: MoneySortItem) => x.v != null && Number.isFinite(x.v);
  const rank = (x: MoneySortItem): number =>
    !finite(x) || x.cur.kind === "not_money" ? 3 : x.cur.kind === "unknown" ? 2 : x.cur.code === scopeCode ? 0 : 1;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 3) return 0;
  if (ra === 2) {
    const ma = marketOrder(a.mkt), mb = marketOrder(b.mkt);
    if (ma !== mb) return ma - mb;
    const ka = a.mkt ?? "", kb = b.mkt ?? "";
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (ka === "") return 0; // no market identity: no amount comparison either
    const va = a.v as number, vb = b.v as number;
    return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
  }
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
  unclassified: number;    // the read found no label under the screened taxonomy
  unread: number;          // the listing's record was not read — its label is unknown
  otherCurrency: number;   // a money floor in another currency than the scope
  currencyUnknown: number; // a money floor, listing currency unknown
  notMoney: number;        // a money floor on an index / rate / FX / futures row
};
export const NO_EXCLUSIONS: ExclusionCounts = { stale: 0, unclassified: 0, unread: 0, otherCurrency: 0, currencyUnknown: 0, notMoney: 0 };

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
    if (o === "unread_excluded") return "unread";
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
  /** What was set (a currency code, a floor as written in its currency, a taxonomy id or a label). */
  value: string;
  reason:
    | "currency_not_in_market"
    | "currency_unavailable"
    | "currency_changed"
    | "mcap_not_covered"
    | "taxonomy_not_covered"
    | "label_not_present";
  /** currency_changed only: the floor's currency and the scope currency it would have moved to. */
  from?: string;
  to?: string;
};

export type ReconcileProbe<L> = {
  currency: (l: L) => MoneyCurrency;
  mcap: (l: L) => number | null;
  label: (l: L, taxonomy: TaxonomyId) => LabelClassification;
};

export type ReconcileOptions = {
  /** resolveCurrencyScope's `preferred` for the next screen (USD for all markets, else null). */
  preferred: string | null;
  /** false while the classification scan is absent or unreadable: listing currencies and labels
   *  were NOT READ, so nothing may be cleared for lacking them — the filters are kept as set
   *  (the caller leaves a floor inactive and names it). */
  readable: boolean;
};

const READABLE: ReconcileOptions = { preferred: null, readable: true };

/**
 * Validate a filter state against the population it is about to screen (the listings of
 * `next.market`, already scoped by the caller). Filters that still describe part of that
 * population are kept untouched; each one that describes none of it is reset and reported.
 * A traded-value floor is a number in ONE currency: when the next screen's scope currency
 * differs from the currency it was set in, it is cleared and reported (currency_changed) —
 * never silently re-read as the same number in another unit. A floor not yet bound to a
 * currency is bound to the next scope. Nothing is cleared for lacking a currency or a label
 * that was not read: with `readable` false only the market-cap floor (manifest data) is
 * checked, and a taxonomy or label is cleared only when every listing's record was read.
 * Language is not an input: labels and codes are stored canonically and only displayed
 * translated, so a language change never needs this.
 */
export function reconcileFilters<F extends CrossMarketFilters, L>(
  next: F,
  population: readonly L[],
  probe: ReconcileProbe<L>,
  opts: ReconcileOptions = READABLE,
): { next: F; cleared: ClearedFilter[] } {
  const cleared: ClearedFilter[] = [];
  const out: F = { ...next };

  if (out.mcap > 0 && !population.some((l) => probe.mcap(l) != null)) {
    cleared.push({ field: "mcap", value: String(out.mcap), reason: "mcap_not_covered" });
    out.mcap = 0;
  }
  if (!opts.readable) return { next: out, cleared };

  const currencies = population.map((l) => probe.currency(l));
  const codes = new Set<string>();
  for (const c of currencies) if (c.kind === "code") codes.add(c.code);

  if (out.ccy && out.ccy !== "auto" && !codes.has(out.ccy)) {
    cleared.push({ field: "ccy", value: out.ccy, reason: codes.size > 0 ? "currency_not_in_market" : "currency_unavailable" });
    out.ccy = "auto";
  }
  if (out.liq > 0) {
    const scopeCode = resolveCurrencyScope(out.ccy, currencies, opts.preferred).code;
    const setIn = out.liqCcy ?? null;
    if (codes.size === 0 || scopeCode === null) {
      cleared.push({ field: "liq", value: formatFloor(out.liq, setIn), reason: "currency_unavailable" });
      out.liq = 0; out.liqCcy = null;
    } else if (setIn !== null && setIn !== scopeCode) {
      cleared.push({ field: "liq", value: formatFloor(out.liq, setIn), reason: "currency_changed", from: setIn, to: scopeCode });
      out.liq = 0; out.liqCcy = null;
    } else {
      out.liqCcy = scopeCode;
    }
  } else if (out.liqCcy != null) {
    out.liqCcy = null;
  }

  const taxonomy = effectiveTaxonomy(out);
  if (taxonomy) {
    const present = new Set<string>();
    let unread = 0;
    for (const l of population) {
      const c = probe.label(l, taxonomy);
      const st = labelStanding(c);
      if (st === "current" || st === "stale") present.add(labelOf(c) as string);
      else if (st === "unavailable") unread++;
    }
    // A label absent from what was read may still be on a listing that was not: say nothing.
    if (unread === 0 && present.size === 0) {
      cleared.push({ field: "taxonomy", value: taxonomy, reason: "taxonomy_not_covered" });
      out.taxonomy = null; out.sector = "all"; out.classStale = false;
    } else if (unread === 0 && out.sector !== "all" && out.sector !== UNCLASSIFIED && !present.has(out.sector)) {
      cleared.push({ field: "sector", value: out.sector, reason: "label_not_present" });
      out.sector = "all"; out.classStale = false;
    }
  }
  return { next: out, cleared };
}

/**
 * Whether a traded-value floor is APPLIED on this screen, and if not, why. It applies only when
 * listing currencies were read, the screen has a scope currency, and that is the currency the
 * floor was set in (an unbound floor takes the scope). Otherwise it stays set — and named — but
 * filters nothing: no row is excluded on the strength of a currency nobody read.
 */
export type FloorState =
  | { kind: "none" }
  | { kind: "applied"; code: string }
  | { kind: "unread"; setIn: string | null }
  | { kind: "no_scope"; setIn: string | null }
  | { kind: "other_currency"; setIn: string; scope: string };

export function floorState(liq: number, liqCcy: string | null | undefined, scopeCode: string | null, readable: boolean): FloorState {
  if (!(liq > 0)) return { kind: "none" };
  const setIn = liqCcy ?? null;
  if (!readable) return { kind: "unread", setIn };
  if (scopeCode === null) return { kind: "no_scope", setIn };
  if (setIn !== null && setIn !== scopeCode) return { kind: "other_currency", setIn, scope: scopeCode };
  return { kind: "applied", code: scopeCode };
}

/** Normalize the cross-market fields of a stored (device-local) preset. Unknown values fall
 *  back to their neutral setting; a legacy sector label keeps screening GICS. A legacy floor
 *  (saved before floors carried a currency) was set and shown as US dollars, so it is read as
 *  USD — and is cleared by name, not re-read, when the preset opens on another currency. */
export function sanitizeCrossMarketFields(raw: {
  sector?: unknown; taxonomy?: unknown; classStale?: unknown; ccy?: unknown; liq?: unknown; liqCcy?: unknown;
}): {
  sector: string; taxonomy: TaxonomyId | null; classStale: boolean; ccy: string; liqCcy: string | null;
} {
  const sector = typeof raw.sector === "string" && raw.sector !== "" ? raw.sector : "all";
  let taxonomy: TaxonomyId | null = isTaxonomyId(raw.taxonomy) ? raw.taxonomy : null;
  if (!taxonomy && sector !== "all") taxonomy = "gics_sector";
  const ccy = typeof raw.ccy === "string" && (raw.ccy === "auto" || CURRENCY_RE.test(raw.ccy)) ? raw.ccy : "auto";
  const hasFloor = typeof raw.liq === "number" && Number.isFinite(raw.liq) && raw.liq > 0;
  const liqCcy = !hasFloor
    ? null
    : typeof raw.liqCcy === "string" && CURRENCY_RE.test(raw.liqCcy)
      ? raw.liqCcy
      : raw.liqCcy === undefined ? "USD" : null;
  return { sector, taxonomy, classStale: raw.classStale === true, ccy, liqCcy };
}

// ── Smart screens (E04) hand-over ───────────────────────────────────────────

/** Why the filter bar cannot be handed to a smart screen as it stands. */
export type SmartScreenGap = "unclassified" | "non_gics_taxonomy" | "floor_inactive" | "floor_not_usd" | "floor_mixed_currency";

/**
 * Smart screens (E04) store a GICS sector and ONE traded-value number, shown and compared as US
 * dollars on every row of the screen. The filter bar is handed to them unchanged only when it
 * means the same thing there: no sector, or a GICS sector; and no floor, or a floor applied in
 * USD over a population whose read listing currencies are all USD.
 *
 * Anything else — a Yahoo or CN-profile label, "unclassified", a floor in HKD/CNY, a USD floor
 * over a mixed-currency population, a floor not applied for want of a read — has no faithful
 * spelling in that grammar. The sector is then handed over as UNCLASSIFIED, which the screen
 * grammar's own validator rejects, so Save refuses ("cannot be saved as a screen") instead of
 * filing a Yahoo label as GICS or an HKD floor as dollars. The table itself is unaffected.
 */
export function smartScreenHandover<F extends CrossMarketFilters>(
  f: F,
  floor: FloorState,
  scope: CurrencyScope,
): { filters: F; gap: SmartScreenGap | null } {
  let gap: SmartScreenGap | null = null;
  if (f.sector === UNCLASSIFIED) gap = "unclassified";
  else if (f.sector !== "all" && effectiveTaxonomy(f) !== "gics_sector") gap = "non_gics_taxonomy";
  else if (floor.kind !== "none") {
    if (floor.kind !== "applied") gap = "floor_inactive";
    else if (floor.code !== "USD") gap = "floor_not_usd";
    else if (scope.codes.some((c) => c.code !== "USD")) gap = "floor_mixed_currency";
  }
  return { filters: gap === null ? f : { ...f, sector: UNCLASSIFIED }, gap };
}
