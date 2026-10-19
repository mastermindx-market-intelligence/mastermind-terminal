// ── Fundamental scan projector (E02) ────────────────────────────────────────
// ONE pure function from a `<SYM>.fund.json` document to a fundamental scan observation. The
// nightly producer (scripts/gen_fundamental_scan.ts) publishes its output for the whole manifest;
// the Screener's company evidence panel runs the SAME function over the company's own fund file,
// so the value a user filters on and the value shown next to its inputs cannot drift apart
// (AC-E02-06).
//
// Source keys and units (fund.json is the `mastermind.fund/v1` contract in lib/fund.ts):
//   fund.pe_ttm              ratios.current.pe_ttm — vendor trailing P/E multiple, captured at
//                            `asof`. Withheld for CN (the CN emitter may fall back to a
//                            last-fiscal-year P/E) and when the quote and statement currencies
//                            differ or the statement currency is unknown (basis unproven).
//                            A non-positive multiple is "earnings_nonpositive", never a cheap P/E.
//   fund.gross_margin_fy     statements.annual.income.gross_profit[last] / revenue[last]
//   fund.net_margin_fy       statements.annual.income.net_income[last]  / revenue[last]
//   fund.roe_fy              statements.annual.income.net_income[last]  / balance.equity[last]
//                            (fiscal-year-end equity, not average equity). Withheld for CN/HK,
//                            whose equity line includes minority interests while net income is
//                            attributable to the parent.
//   fund.revenue_growth_fy   revenue[last] vs revenue[prior comparable fiscal year], through
//                            lib/finStatementMath.comparablePeriodChanges (fiscal identity when
//                            the artifact carries it), stored as a fraction.
// All FY fields read ONLY the latest column of `statements.annual` — never an interim set, a TTM
// roll-up or an older year standing in for a missing one (AC-E02-02). `ratios.current` margins /
// ROE are never read: they are TTM vendor snapshots, and in HK/CN artifacts they are percent-form
// (56.7 = 56.7%), so substituting them would double-scale (E02 falsifier).
//
// Statement families: industrial-only fields (margins, revenue growth) are withheld for bank /
// insurer / financial-services / ambiguous families, and when no taxonomy exists and the annual
// set carries no industrial structure (no COGS and no gross profit in any year) — the same
// structural evidence lib/fund.applyLegacyStatementFamilyFallback uses.

import { applyLegacyStatementFamilyFallback, type Fund, type StatementPeriodSet, type StatementSourceFamily } from "./fund";
import {
  comparablePeriodChanges,
  incomeView,
  isIndustrialStatement,
  priorComparableIndex,
  statementMarket,
} from "./finStatementMath";
import type { MarketId } from "./markets";
import {
  FUNDAMENTAL_FIELD_IDS,
  FUNDAMENTAL_FIELD_SPEC,
  isIsoDate,
  roundStored,
  type FundamentalFieldCell,
  type FundamentalFieldId,
  type FundamentalFiscalYear,
  type FundamentalObservation,
  type FundamentalObserved,
} from "./fundamentalScan";

/** The prior comparable fiscal year must end 330–400 days before the latest one: a fiscal-year
 *  transition, a missing year or a duplicated column never passes as "last year". */
export const PRIOR_FY_MIN_DAYS = 330;
export const PRIOR_FY_MAX_DAYS = 400;

/** The inputs one projection read — rendered verbatim by the company evidence panel. */
export type FundamentalInputTrace = {
  market: MarketId;
  /** statements.annual column the FY fields read; null when no fiscal year was established. */
  index: number | null;
  priorIndex: number | null;
  revenue: number | null;
  grossProfit: number | null;
  netIncome: number | null;
  equity: number | null;
  priorRevenue: number | null;
  /** ratios.current.pe_ttm as published (before any gating). */
  peTtm: number | null;
  /** Newest statements.quarterly period end — context for the TTM snapshot. */
  latestInterimEnd: string | null;
};

export type FundamentalProjection = {
  observation: FundamentalObservation;
  inputs: FundamentalInputTrace | null;
};

const KNOWN_FAMILIES: ReadonlySet<string> = new Set<StatementSourceFamily>([
  "industrial", "bank", "insurer", "financial_services", "ambiguous", "other",
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);
const withheld = (s: "unsupported" | "unavailable", r: string): FundamentalFieldCell => ({ s, r });

type Read = { value: number } | { reason: "input_missing" | "input_misaligned" };
/** Read one aligned input at `i`. Misalignment is a distinct, explainable failure. */
function readAt(arr: unknown, n: number, i: number): Read {
  if (!Array.isArray(arr)) return { reason: "input_missing" };
  if (arr.length !== n) return { reason: "input_misaligned" };
  const v = finite(arr[i]);
  return v === null ? { reason: "input_missing" } : { value: v };
}
const valueOf = (r: Read): number | null => ("value" in r ? r.value : null);

/** Index-aligned optional metadata at `i`, or null when the array is absent / misaligned. */
function metaAt<T>(arr: unknown, n: number, i: number, ok: (v: unknown) => v is T): T | null {
  if (!Array.isArray(arr) || arr.length !== n) return null;
  const v = arr[i];
  return ok(v) ? v : null;
}
const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function latestIsoDate(arr: unknown): string | null {
  if (!Array.isArray(arr)) return null;
  let best: string | null = null;
  for (const v of arr) if (isIsoDate(v) && (best === null || v > best)) best = v;
  return best;
}

const asPeriodSet = (v: unknown): StatementPeriodSet | null =>
  isObj(v) && Array.isArray(v.periods) && v.periods.length > 0 && isObj(v.income) && isObj(v.balance)
    ? (v as unknown as StatementPeriodSet)
    : null;

/**
 * Project one fund document. `sym` is the manifest symbol; the document must name the same
 * ticker. Never throws: any structural surprise becomes `unavailable/fund_malformed`.
 */
export function projectFundamental(sym: string, raw: unknown): FundamentalProjection {
  const malformed: FundamentalProjection = { observation: { status: "unavailable", reason: "fund_malformed" }, inputs: null };
  if (!isObj(raw)) return malformed;
  if (typeof raw.schema !== "string" || !raw.schema.startsWith("mastermind.fund/")) return malformed;
  if (raw.ticker !== sym) return malformed;
  if (!isIsoDate(raw.asof)) return malformed;
  try {
    return projectChecked(sym, raw, raw.asof);
  } catch {
    return malformed;
  }
}

function projectChecked(sym: string, raw: Record<string, unknown>, asof: string): FundamentalProjection {
  const market = statementMarket(sym);
  const profile = isObj(raw.profile) ? raw.profile : {};
  const sector = str(profile.sector);
  // GICS names the sector "Financials"; the legacy fallback keys on the vendor's
  // "Financial Services". Both mean the same thing for statement geometry.
  const fallbackSector = sector?.trim().toLowerCase() === "financials" ? "Financial Services" : sector;
  const statements = isObj(raw.statements) ? raw.statements : {};
  const fund = applyLegacyStatementFamilyFallback({
    ...(raw as unknown as Fund),
    profile: { ...(profile as unknown as Fund["profile"]), sector: fallbackSector },
    statements: { annual: asPeriodSet(statements.annual), quarterly: asPeriodSet(statements.quarterly) },
  });
  const annual = fund.statements.annual;

  const quote = str(raw.quote_currency);
  const stmt = str(raw.stmt_currency);
  const src = isObj(raw.src) ? str(raw.src.statements) : null;
  const ratios = isObj(raw.ratios) && isObj(raw.ratios.current) ? raw.ratios.current : {};
  const peTtm = finite(ratios.pe_ttm);

  const f = {} as Record<FundamentalFieldId, FundamentalFieldCell>;

  // ── P/E (TTM snapshot) ──
  f["fund.pe_ttm"] =
    market === "cn" ? withheld("unsupported", "pe_basis_unverified")
    : !quote || !stmt || quote !== stmt ? withheld("unsupported", "currency_basis_unverified")
    : peTtm === null ? withheld("unavailable", "not_reported")
    : peTtm <= 0 ? withheld("unavailable", "earnings_nonpositive")
    : { v: roundStored("fund.pe_ttm", peTtm) };

  const inputs: FundamentalInputTrace = {
    market, index: null, priorIndex: null,
    revenue: null, grossProfit: null, netIncome: null, equity: null, priorRevenue: null,
    peTtm, latestInterimEnd: latestIsoDate(fund.statements.quarterly?.period_end),
  };

  // ── Fiscal year identity ──
  const fyFields = FUNDAMENTAL_FIELD_IDS.filter((id) => FUNDAMENTAL_FIELD_SPEC[id].basis !== "ttm_snapshot");
  const withholdAll = (s: "unsupported" | "unavailable", r: string) => {
    for (const id of fyFields) f[id] = withheld(s, r);
  };
  const observed = (fy: FundamentalFiscalYear | null, prior: { label: string; end: string } | null): FundamentalProjection => ({
    observation: { status: "observed", reason: "ok", asof, ccy: { quote, stmt }, src, fy, prior, f } satisfies FundamentalObserved,
    inputs,
  });

  if (!annual) {
    withholdAll("unavailable", "no_annual_statements");
    return observed(null, null);
  }
  const n = annual.periods.length;
  const last = n - 1;
  const ends = annual.period_end;
  const label = annual.periods[last];
  if (!Array.isArray(ends) || ends.length !== n || typeof label !== "string" || label === "") {
    withholdAll("unavailable", "period_axis_misaligned");
    return observed(null, null);
  }
  const end = ends[last];
  if (!isIsoDate(end)) {
    withholdAll("unavailable", "period_end_missing");
    return observed(null, null);
  }
  if (ends.some((e, i) => i !== last && isIsoDate(e) && e >= end)) {
    withholdAll("unavailable", "period_order_invalid");
    return observed(null, null);
  }
  const kind = metaAt(annual.period_kind, n, last, isStr);
  if (Array.isArray(annual.period_kind) && annual.period_kind.length === n && kind !== "full_year") {
    withholdAll("unsupported", "period_not_annual");
    return observed(null, null);
  }

  const view = incomeView(sym, annual, "annual");
  const familyAt = (i: number): string => view.sourceFamilies[i] ?? view.sourceFamily;
  const fam = familyAt(last);
  const fy: FundamentalFiscalYear = {
    label,
    end,
    fiscal_year: metaAt(annual.fiscal_year, n, last, isStr),
    kind,
    fam,
    src: metaAt(annual.src_by_period, n, last, isStr),
    filed: metaAt(annual.filed_by_period, n, last, isIsoDate),
    restated: metaAt(annual.restated_by_period, n, last, isBool),
  };
  inputs.index = last;

  const revenue = readAt(view.income.revenue, n, last);
  const grossProfit = readAt(view.income.gross_profit, n, last);
  const netIncome = readAt(view.income.net_income, n, last);
  const equity = readAt(annual.balance.equity, n, last);
  inputs.revenue = valueOf(revenue);
  inputs.grossProfit = valueOf(grossProfit);
  inputs.netIncome = valueOf(netIncome);
  inputs.equity = valueOf(equity);

  // Industrial-only fields: the family the producer (or the legacy fallback) assigned to the
  // latest column, plus structural evidence when no taxonomy exists at all.
  const hasIndustrialStructure = [view.income.cogs, view.income.gross_profit]
    .some((arr) => Array.isArray(arr) && arr.some((v) => finite(v) !== null));
  const industrialGate = (family: string): FundamentalFieldCell | null => {
    if (family === "ambiguous") return withheld("unsupported", "family_ambiguous");
    if (!KNOWN_FAMILIES.has(family)) return withheld("unsupported", "family_unverified");
    if (!isIndustrialStatement(family as StatementSourceFamily)) return withheld("unsupported", "family_not_applicable");
    if (family === "other" && !hasIndustrialStructure) return withheld("unsupported", "family_unverified");
    return null;
  };
  const ratio = (num: Read, den: Read, field: FundamentalFieldId): FundamentalFieldCell => {
    if (!("value" in den)) return withheld("unavailable", den.reason);
    if (den.value <= 0) return withheld("unavailable", "denominator_nonpositive");
    if (!("value" in num)) return withheld("unavailable", num.reason);
    return { v: roundStored(field, num.value / den.value) };
  };

  const gate = industrialGate(fam);
  f["fund.gross_margin_fy"] = gate ?? ratio(grossProfit, revenue, "fund.gross_margin_fy");
  f["fund.net_margin_fy"] = gate ?? ratio(netIncome, revenue, "fund.net_margin_fy");

  // ROE: family-neutral, but the equity basis must match parent net income.
  f["fund.roe_fy"] =
    market === "cn" || market === "hk" ? withheld("unsupported", "equity_basis_unverified")
    : fam === "ambiguous" ? withheld("unsupported", "family_ambiguous")
    : !KNOWN_FAMILIES.has(fam) ? withheld("unsupported", "family_unverified")
    : ratio(netIncome, equity, "fund.roe_fy");

  // Revenue growth vs the comparable prior fiscal year.
  let prior: { label: string; end: string } | null = null;
  f["fund.revenue_growth_fy"] = (() => {
    if (gate) return gate;
    if (!("value" in revenue)) return withheld("unavailable", revenue.reason);
    const p = priorComparableIndex(annual, last, "annual");
    if (p === null) return withheld("unavailable", "no_comparable_prior");
    const priorEnd = ends[p];
    const priorLabel = annual.periods[p];
    if (!isIsoDate(priorEnd) || typeof priorLabel !== "string" || priorLabel === "") return withheld("unavailable", "no_comparable_prior");
    const gapDays = (dayMs(end) - dayMs(priorEnd)) / 86_400_000;
    if (gapDays < PRIOR_FY_MIN_DAYS || gapDays > PRIOR_FY_MAX_DAYS) return withheld("unavailable", "no_comparable_prior");
    if (kind !== null && metaAt(annual.period_kind, n, p, isStr) !== "full_year") return withheld("unavailable", "no_comparable_prior");
    prior = { label: priorLabel, end: priorEnd };
    inputs.priorIndex = p;
    const priorFamilyGate = industrialGate(familyAt(p));
    if (priorFamilyGate) return withheld("unsupported", "family_changed");
    const priorRevenue = readAt(view.income.revenue, n, p);
    inputs.priorRevenue = valueOf(priorRevenue);
    if (!("value" in priorRevenue)) return withheld("unavailable", priorRevenue.reason);
    if (priorRevenue.value <= 0) return withheld("unavailable", "denominator_nonpositive");
    const pct = comparablePeriodChanges(view.income.revenue, annual, "annual")[last];
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return withheld("unavailable", "input_missing");
    return { v: roundStored("fund.revenue_growth_fy", pct / 100) };
  })();

  return observed(fy, prior);
}
