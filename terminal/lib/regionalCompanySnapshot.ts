/**
 * regionalCompanySnapshot — the listing-backed company snapshot for regional listings.
 *
 * WHY THIS MODULE EXISTS
 *
 * `AnalysisWorkspace` loads `<SYM>.fund.json` and MegaPane receives it, but the Intelligence
 * tab sends neither fund nor legacy intel into `CompanyIntelligencePage` /
 * `SharedShellCompanyIntelligence` — both of which require a VERIFIED earnings event and CI
 * identity. Most regional listings therefore render an empty Intelligence tab while the very
 * same page already holds useful reported financials. This module turns the listing artifact
 * that is ALREADY LOADED into the supported facts a reader can act on, so the tab is useful
 * before (or instead of) document-based company intelligence.
 *
 * WHAT IT IS NOT — the boundaries are the feature
 *
 *   • This is NOT document-based company intelligence. It creates no issuer id, no CIK, no
 *     earnings event, no transcript and no holder. It cannot and must not stand in for CI
 *     identity; the retained-event path is untouched and still owns every one of those.
 *   • `/data/<SYM>.fund.json` is an internal PUBLIC data object, not immutable evidence. The
 *     evidence affordance points at that file so a reader can check the bytes, and the copy
 *     says so in those words rather than dressing it as a verified source.
 *   • Legacy `intel` is deliberately NOT read in this release. `<SYM>.intel.json` is absent for
 *     Canada, so accepting it would make coverage depend on a field the weakest market cannot
 *     supply, and its conviction / entry / sizing / signals / smart-money / inferred-score rows
 *     are exactly the material this surface must not present as company facts. First release is
 *     fund-only, and the exclusions are pinned by tests rather than left to review.
 *
 * WHAT IS REUSED, NEVER REBUILT
 *
 * Every number and every label here comes from `finStatementMath`: the `incomeView`
 * normalization point, `priorComparableIndex` / `comparablePeriodChanges` for genuine annual
 * comparability, and the family label helpers (`incomeViewTopLineLabel`,
 * `statementCadenceLabel`, `statementPeriodCountLabel`). There is no second statement engine,
 * no second comparable-period rule, and no second place where a bank's top line can be called
 * "Revenue".
 *
 * WHAT IS DELIBERATELY SYNTHESIZED FROM NOTHING
 *
 *   • Interim (quarterly / half-year) columns are COVERAGE ONLY. Their reported period and end
 *     are shown; their figures are not. Differencing a cumulative YTD ladder, subtracting EPS
 *     across YTD windows, or forcing an HK half-year to read as a quarter are all ways to
 *     publish a number nobody filed, and none of them happen here.
 *   • Year-over-year appears ONLY where `priorComparableIndex` says the prior column is the
 *     economically comparable period and the prior value is present, finite and non-zero.
 *     Currency-unknown suppresses every delta rather than comparing across an unknown unit.
 *   • Source acquisition is shown only from an observation receipt. `fund.asof` is the ARTIFACT GENERATED date, labelled as
 *     such. When source receipts are absent, the surface says
 *     "Source retrieval time unavailable" instead of the word "Fresh".
 *
 * Pure and dependency-light, and in `lib/` on purpose: vitest only collects `lib/__tests__/**`
 * (terminal/vitest.config.ts), so component-private synthesis would be untestable by
 * construction. This module never throws, never mutates its input, and returns `null` rather
 * than a partial object when the artifact cannot be trusted for the requested symbol.
 */
import type { Fund, NumArr, StatementPeriodSet } from "./fund";
import {
  comparablePeriodChanges,
  incomeView,
  incomeViewTopLineLabel,
  priorComparableIndex,
  statementBasisAvailable,
  statementCadenceLabel,
  statementPeriodCountLabel,
} from "./finStatementMath";

/**
 * The regional listing suffixes this surface owns — the CN / HK / Canada venues.
 *
 * Deliberately narrower than `markets.groupFromSymbol`, which also routes `.NE` (Canada) and
 * every foreign venue (`.L`, `.T`, `.PA`, …) to its own buckets. This surface changes what the
 * Intelligence tab renders, so it names its own blast radius exactly: US symbols (including
 * any ticker containing a letter from this list) are untouched, and `.NE` stays on the
 * incumbent event view until a Canada artifact is proven for it.
 */
const REGIONAL_SUFFIX_RE = /\.(TO|V|HK|SS|SZ|BJ)$/i;

/** True only for the CN / HK / Canada listing suffixes this module composes for. */
export function isRegionalListingSymbol(sym: string | null | undefined): boolean {
  return REGIONAL_SUFFIX_RE.test((sym ?? "").trim());
}

export type RegionalSnapshotState = "available" | "partial" | "unknown_freshness" | "unavailable";

export type RegionalSectionId = "business" | "performance" | "estimates";

/**
 * Per-section disclosure. `unknown_freshness` is a distinct state rather than a modifier
 * because "we have the facts but cannot say how old they are" is a different reader decision
 * from "we have half the facts" and from "we have none".
 */
export interface RegionalSectionStatus {
  state: RegionalSnapshotState;
  /** Stable machine reasons (`no_annual_period`, `stmt_currency_unknown`, …), never prose. */
  reasons: string[];
  /** Field and artifact references that back what this section actually shows. */
  sources: string[];
}

export type RegionalMetricId = "revenue" | "net_income" | "cfo" | "cash" | "debt";

export interface RegionalMetric {
  id: RegionalMetricId;
  label: string;
  /** null renders as the house dash placeholder. A missing figure is NEVER shown as zero. */
  value: number | null;
  /**
   * Percent change against the genuinely comparable prior period, or null when comparability
   * is unsupported, the prior value is missing / zero / non-finite, or the currency is unknown.
   */
  yoyPct: number | null;
}

export interface RegionalAnnualSection {
  periodLabel: string;
  periodEnd: string;
  fiscalYear: string | null;
  /** Family-appropriate top line: "Revenue" for industrial, "Total operating income" for banks. */
  topLineLabel: string;
  metrics: RegionalMetric[];
  /** Statement-transport provenance for the column, e.g. "akshare" — null when the artifact has none. */
  source: string | null;
}

export interface RegionalInterimCoverage {
  periodLabel: string;
  periodEnd: string | null;
  /** "Quarterly" / "Semiannual" / "Interim" — the artifact's own cadence, never a forced label. */
  cadenceLabel: string;
  periodCountLabel: string;
}

export interface RegionalEstimateItem {
  id: "revenue_estimate" | "eps_estimate";
  label: string;
  value: number;
  /** Analyst count when the artifact carries one; null otherwise. Never inferred from asof. */
  analystCount: number | null;
}

export interface RegionalEstimatesSection {
  fiscalPeriod: string;
  items: RegionalEstimateItem[];
  source: string | null;
}

export interface RegionalCompanySnapshot {
  /** Uppercased requested symbol — the identity every field below was selected for. */
  sym: string;
  ticker: string;
  schema: string;
  /** Present only when the artifact carried an http(s) URL; any other scheme is dropped. */
  website: string | null;
  description: string | null;
  sector: string | null;
  industry: string | null;
  /** `fund.asof` — the date this ARTIFACT was generated. Never labelled a source retrieval time. */
  artifactGenerated: string | null;
  /** Shared acquisition receipt for the displayed annual observation, otherwise unknown. */
  sourceRetrieval: string | null;
  /** Financial-REPORTING currency for statement figures. Never the quote currency. */
  stmtCurrency: string | null;
  /** Trading currency (price / market cap). Shown for contrast only; no figure is converted. */
  quoteCurrency: string | null;
  annual: RegionalAnnualSection | null;
  interim: RegionalInterimCoverage | null;
  estimates: RegionalEstimatesSection | null;
  sections: Record<RegionalSectionId, RegionalSectionStatus>;
  /** Internal public data object for the exact symbol — checkable bytes, not CI evidence. */
  evidenceHref: string;
}

/** Machine reasons are stable identifiers; the component owns every word shown to a reader. */
const REASON = {
  noFund: "no_fund_for_symbol",
  noArtifactDate: "no_artifact_generated_date",
  noRetrievalTime: "no_source_retrieval_time",
  noProfile: "no_profile_fields",
  noAnnualPeriod: "no_valid_annual_period",
  noStatementCurrency: "stmt_currency_unknown",
  noInterimPeriod: "no_interim_period",
  noEstimates: "no_forward_estimate",
  missingMetric: "metric_missing",
} as const;

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A usable column requires a well-formed period end; a label alone is not a dated fact. */
function periodEndOf(set: StatementPeriodSet, index: number): string | null {
  const end = set.period_end?.[index];
  if (typeof end !== "string" || !ISO_DAY_RE.test(end.trim())) return null;
  const value = end.trim();
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** Last column that carries BOTH a display label and a dated period end. */
function latestDatedIndex(set: StatementPeriodSet): number | null {
  const n = set.periods?.length ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    if (set.periods?.[i] && periodEndOf(set, i)) return i;
  }
  return null;
}

function pickMeta(set: StatementPeriodSet, index: number, field: "fiscal_year"): string | null {
  const value = set[field]?.[index];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const METRIC_SPECS: { id: RegionalMetricId; field: (set: StatementPeriodSet, view: ReturnType<typeof incomeView>) => NumArr; en: string; zh: string }[] = [
  // The top line is resolved by the view, not by field name: a bank's operating income must
  // never print under "Revenue", and that decision belongs to the shared family helpers.
  { id: "revenue", field: (_set, view) => view.income.revenue, en: "Revenue", zh: "营业收入" },
  { id: "net_income", field: (_set, view) => view.income.net_income, en: "Net income", zh: "净利润" },
  { id: "cfo", field: (set) => set.cashflow?.cfo ?? [], en: "Operating cash flow", zh: "经营活动现金流" },
  { id: "cash", field: (set) => set.balance?.cash ?? [], en: "Cash", zh: "现金" },
  { id: "debt", field: (set) => set.balance?.debt ?? [], en: "Debt", zh: "债务" },
];

/**
 * Build the annual row set from the shared normalization point.
 *
 * `yoyPct` reuses `comparablePeriodChanges` — the house comparability rule — and then applies
 * the guards that rule deliberately leaves to its callers: currency-unknown suppresses the
 * whole delta set (comparing two numbers whose unit is unknown is not a comparison), and a
 * non-finite result is dropped rather than rendered. The prior-period INDEX also comes from
 * `priorComparableIndex` so this surface cannot disagree with the statements page about which
 * column is the comparable one.
 */
function buildMetrics(
  set: StatementPeriodSet,
  index: number,
  view: ReturnType<typeof incomeView>,
  stmtCurrency: string | null,
  zh: boolean,
): RegionalMetric[] {
  let comparable = priorComparableIndex(set, index, "annual");
  // Legacy annual arrays have no fiscal identity; adjacent columns can be several years apart.
  if (comparable != null) {
    const currentEnd = periodEndOf(set, index);
    const priorEnd = periodEndOf(set, comparable);
    const days = currentEnd && priorEnd ? (Date.parse(currentEnd) - Date.parse(priorEnd)) / 86400000 : 0;
    if (days < 330 || days > 400) comparable = null;
  }
  const currencyKnown = stmtCurrency != null && stmtCurrency.trim() !== "";
  return METRIC_SPECS.map((spec) => {
    const values = spec.field(set, view);
    const value = finite(values?.[index]);
    let yoyPct: number | null = null;
    // No comparable prior column → no delta whatever the current value is. The house rule for
    // WHICH column is comparable is `priorComparableIndex`; the arithmetic is
    // `comparablePeriodChanges`, which folds in the missing / zero / null prior guards.
    if (currencyKnown && comparable != null) {
      yoyPct = finite(comparablePeriodChanges(values ?? [], set, "annual")?.[index]);
    }
    const label = spec.id === "revenue" ? incomeViewTopLineLabel(view, zh) : zh ? spec.zh : spec.en;
    return { id: spec.id, label, value, yoyPct };
  });
}

/**
 * Forward fiscal-year estimate, ONLY when the artifact carries both a period label and a finite
 * consensus value. `<SYM>.intel.json` is not read (see the header), so there is no second path
 * by which an estimate, a target price, or a score can reach this surface.
 *
 * `EstimateSeries.periods` runs "0y", "+1y"; index 1 is the forward fiscal year. Index 0 is the
 * current year and is deliberately NOT shown: this card is "Estimates and coverage", and a
 * current-year number beside a forward one invites reading it as a forecast.
 */
function buildEstimates(fund: Fund, zh: boolean): RegionalEstimatesSection | null {
  const estimates = fund.estimates;
  if (!estimates) return null;
  const revenue = estimates.rev_fy;
  const eps = estimates.eps_fy;
  const revenuePeriod = text(revenue?.periods?.[1]);
  const revenueValue = finite(revenue?.avg?.[1]);
  const epsPeriod = text(eps?.periods?.[1]);
  const epsValue = finite(eps?.avg?.[1]);
  const fiscalPeriod = revenuePeriod && revenueValue != null ? revenuePeriod :
    epsPeriod && epsValue != null ? epsPeriod : null;
  if (!fiscalPeriod) return null;
  const items: RegionalEstimateItem[] = [];
  if (revenuePeriod === fiscalPeriod && revenueValue != null) items.push({
    id: "revenue_estimate", label: zh ? "收入预测" : "Revenue estimate", value: revenueValue,
    analystCount: finite(revenue?.n?.[1]),
  });
  if (epsPeriod === fiscalPeriod && epsValue != null) items.push({
    id: "eps_estimate", label: zh ? "每股收益预测" : "EPS estimate", value: epsValue,
    analystCount: finite(eps?.n?.[1]),
  });
  return {
    fiscalPeriod, items,
    source: typeof fund.src?.estimates === "string" && fund.src.estimates.trim() ? fund.src.estimates : null,
  };
}

/** Only http(s) leaves this module — a `javascript:` or `data:` company URL is dropped. */
function safeWebsite(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function text(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value ? value : null;
}

/**
 * Assemble the snapshot for `sym`, or `null` when the artifact cannot be trusted for it.
 *
 * Returns null — not a partial, not an empty shell — in exactly three cases: no fund, a fund
 * that is not this symbol's (a stale artifact carried over from the previous ticker is a
 * correctness bug, not a data gap), or a fund with no statement transport at all. Every other
 * gap is reported honestly INSIDE the snapshot through the per-section states, because "this
 * listing has no reported financials" is itself the answer a regional reader needs.
 */
export function selectRegionalCompanySnapshot(input: {
  sym: string;
  fund: Fund | null | undefined;
  zh?: boolean;
}): RegionalCompanySnapshot | null {
  const { fund } = input;
  const sym = (input.sym ?? "").trim().toUpperCase();
  const zh = input.zh === true;
  if (!fund || !sym || fund.schema !== "mastermind.fund/v1" || "regional_financials" in fund) return null;
  // EXACT identity. A fund for another ticker is the previous symbol's file, and rendering it
  // under the new ticker is the single most damaging thing this surface could do.
  const ticker = typeof fund.ticker === "string" ? fund.ticker.trim().toUpperCase() : "";
  if (ticker !== sym) return null;

  const annualSet = fund.statements?.annual ?? null;
  const interimSet = fund.statements?.quarterly ?? null;
  const stmtCurrency = text(fund.stmt_currency);
  const artifactGenerated = text(fund.asof);
  const description = text(fund.profile?.description);
  const sector = text(fund.profile?.sector);
  const industry = text(fund.profile?.industry);

  // ── annual: the ONLY synthesized figure set ──
  let annual: RegionalAnnualSection | null = null;
  let annualIndex: number | null = null;
  let annualView: ReturnType<typeof incomeView> | null = null;
  if (statementBasisAvailable(annualSet) && annualSet) {
    annualIndex = latestDatedIndex(annualSet);
    if (annualIndex != null) {
      annualView = incomeView(sym, annualSet, "annual");
      annual = {
        periodLabel: annualSet.periods[annualIndex],
        periodEnd: periodEndOf(annualSet, annualIndex)!,
        fiscalYear: pickMeta(annualSet, annualIndex, "fiscal_year"),
        topLineLabel: incomeViewTopLineLabel(annualView, zh),
        metrics: buildMetrics(annualSet, annualIndex, annualView, stmtCurrency, zh),
        source: text(annualSet.src_by_period?.[annualIndex]) ?? text(fund.src?.statements),
      };
    }
  }

  // ── interim: COVERAGE ONLY, never synthesized ──
  let interim: RegionalInterimCoverage | null = null;
  if (statementBasisAvailable(interimSet) && interimSet) {
    const last = latestDatedIndex(interimSet);
    if (last != null) interim = {
      periodLabel: interimSet.periods[last],
      periodEnd: periodEndOf(interimSet, last),
      cadenceLabel: statementCadenceLabel(interimSet, "quarterly", zh),
      periodCountLabel: statementPeriodCountLabel(interimSet, "quarterly", zh),
    };
  }

  const estimates = buildEstimates(fund, zh);
  const acquired = (raw: unknown): string | null => {
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw)) return null;
    const date = new Date(raw);
    return Number.isFinite(date.getTime()) && date.toISOString() === raw.replace("Z", ".000Z") ? raw : null;
  };
  let sourceRetrieval: string | null = null;
  if (annualSet && annualIndex != null && annual) {
    const sections = (["income", "balance", "cashflow"] as const).filter((section) =>
      Object.values(annualSet[section] ?? {}).some((values) => finite(values?.[annualIndex!]) != null));
    const stamps = sections.map((section) => acquired(annualSet.period_provenance?.[section]?.[annualIndex!]?.acquired_at));
    if (stamps.length && stamps.every((stamp) => stamp != null && stamp === stamps[0])) sourceRetrieval = stamps[0];
  }

  // ── per-section disclosure ──
  const profileFields = [description, sector, industry];
  const presentProfile = profileFields.filter(Boolean).length;
  const businessSources = ["fund.profile"];
  if (description) businessSources.push("fund.profile.description");
  if (sector) businessSources.push("fund.profile.sector");
  if (industry) businessSources.push("fund.profile.industry");

  const performanceReasons: string[] = [];
  const performanceSources: string[] = [];
  if (!annual) {
    performanceReasons.push(REASON.noAnnualPeriod);
  } else {
    performanceSources.push("fund.statements.annual");
    if (annual.source) performanceSources.push(`fund.src.statements=${annual.source}`);
    for (const metric of annual.metrics) {
      performanceSources.push(`fund.statements.annual.${metric.id}`);
      if (metric.value == null) performanceReasons.push(REASON.missingMetric);
    }
    if (!stmtCurrency) performanceReasons.push(REASON.noStatementCurrency);
  }

  const estimateReasons: string[] = [];
  const estimateSources: string[] = [];
  if (!estimates) {
    estimateReasons.push(REASON.noEstimates);
  } else {
    estimateSources.push("fund.estimates");
    for (const item of estimates.items) estimateSources.push(`fund.estimates.${item.id}`);
  }
  if (interim) estimateSources.push("fund.statements.quarterly(period only)");

  const sections: Record<RegionalSectionId, RegionalSectionStatus> = {
    business: {
      state: presentProfile === 0
        ? "unavailable"
        : presentProfile === profileFields.length ? "unknown_freshness" : "partial",
      reasons: presentProfile === 0
        ? [REASON.noProfile, REASON.noArtifactDate]
        : artifactGenerated
          ? (presentProfile === profileFields.length ? [REASON.noRetrievalTime] : [REASON.noRetrievalTime, REASON.noProfile])
          : [REASON.noArtifactDate, REASON.noRetrievalTime],
      sources: businessSources,
    },
    performance: {
      state: !annual
        ? "unavailable"
        : !stmtCurrency
          ? "unknown_freshness"
          : annual.metrics.every((metric) => metric.value != null) ? (sourceRetrieval ? "available" : "unknown_freshness") : "partial",
      reasons: [...performanceReasons, ...(!sourceRetrieval ? [REASON.noRetrievalTime] : [])],
      sources: performanceSources,
    },
    estimates: {
      state: !estimates && !interim
        ? "unavailable"
        : !estimates
          ? "partial"
          : estimates.items.length < 2 || !stmtCurrency ? "partial" : "unknown_freshness",
      reasons: estimateReasons.length ? [...estimateReasons, REASON.noRetrievalTime] : [REASON.noRetrievalTime],
      sources: estimateSources,
    },
  };

  return {
    sym,
    ticker,
    schema: typeof fund.schema === "string" ? fund.schema : "",
    website: safeWebsite(fund.profile?.website),
    description,
    sector,
    industry,
    artifactGenerated,
    sourceRetrieval,
    stmtCurrency,
    quoteCurrency: text(fund.quote_currency),
    annual,
    interim,
    estimates,
    sections,
    evidenceHref: `/data/${encodeURIComponent(sym)}.fund.json`,
  };
}

/** Fields the snapshot must never surface, whatever the artifact contains. */
export const REGIONAL_SNAPSHOT_EXCLUDED_FIELDS = [
  "conviction",
  "entry",
  "sizing",
  "signal",
  "signals",
  "smartmoney",
  "smart_money",
  "score",
  "scores",
  "cik",
  "issuer_id",
] as const;