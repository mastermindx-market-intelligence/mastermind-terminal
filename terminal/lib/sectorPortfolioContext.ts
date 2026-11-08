/**
 * Sector → Portfolio navigation context.
 *
 * A Portfolio address may carry ONE selected native sector ETF and ONE bounded,
 * canonical `sectorDepthReturn` snapshot. Both are untrusted navigation context:
 * they name a selection, they grant no data access, and every fact rendered from
 * them is read again from its own owner. Nothing in this module reads a dossier,
 * a position, a weight, an account or a permission.
 *
 * The identity set below is the closed v1 wire cohort of
 * `leadership_rotation_context.sector_dossiers/v1` — the same eleven native
 * sector-ETF identities the incumbent dossier parser admits. It is not a second
 * membership registry and it classifies nothing: a technology stock such as NVDA
 * or AMD is not a sector ETF and never implies one.
 */

import { encodeSectorDepthReturn, parseSectorDepthReturn, sectorDepthReturnQuery } from "@/lib/sectorDepthReturn";
import type { Position } from "@/lib/portfolio";
import { positiveCostCohort } from "@/lib/portfolioMoney";
import type { SectorState } from "@/lib/sectorIntelligence";

/** The Portfolio route the admitted context belongs to. */
export const SECTOR_PORTFOLIO_PATH = "/portfolio";

/** The single native sector-ETF identity parameter. */
export const SECTOR_PORTFOLIO_SECTOR_PARAM = "sector";

/** The single bounded opener-snapshot parameter. */
export const SECTOR_PORTFOLIO_RETURN_PARAM = "sectorReturn";

/** The Sector route an admitted opener returns to. */
export const SECTOR_DISCOVER_PATH = "/discover";

/** The Sector workspace tab an admitted opener returns to. */
export const SECTOR_DISCOVER_TAB_PARAM = "tab";
export const SECTOR_DISCOVER_TAB = "sectors";

/**
 * The closed v1 cohort of native sector-ETF identities. An exact identity only:
 * a lowercase, padded, foreign or malformed symbol is not one of these and is
 * rejected rather than repaired.
 */
export const NATIVE_SECTOR_ETFS = [
  "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
] as const;
export type NativeSectorEtf = (typeof NATIVE_SECTOR_ETFS)[number];

/** The one native sector-ETF identity, or null when the value is not one. */
export function nativeSectorEtf(value: unknown): NativeSectorEtf | null {
  return typeof value === "string" && (NATIVE_SECTOR_ETFS as readonly string[]).includes(value)
    ? value as NativeSectorEtf
    : null;
}

/** An admitted, untrusted navigation context read from an address. */
export type SectorPortfolioContext = {
  /** The one native sector-ETF identity the address names. */
  etf: NativeSectorEtf;
  /** The canonical bounded opener snapshot the address carries. */
  snapshot: string;
  /** The decoded opener: the exact Discover/Rotation selection to return to. */
  opener: SectorState;
};

/**
 * Read the admitted context from an address. A duplicate identity, a duplicate
 * snapshot, a foreign or malformed sector, and any snapshot the incumbent parser
 * does not accept (noncanonical, recursive, oversized, path- or fragment-shaped)
 * yield no context at all. No context means the Portfolio keeps its ordinary
 * behaviour; it never means a partially admitted one.
 */
export function parseSectorPortfolioContext(href: string | null | undefined): SectorPortfolioContext | null {
  if (typeof href !== "string" || href === "") return null;
  let params: URLSearchParams;
  try {
    params = new URL(href, "https://mastermind.invalid").searchParams;
  } catch {
    return null;
  }
  return parseSectorPortfolioParams(params);
}

/** The same admission, over an already-split query. */
export function parseSectorPortfolioParams(params: URLSearchParams): SectorPortfolioContext | null {
  const sectors = params.getAll(SECTOR_PORTFOLIO_SECTOR_PARAM);
  const snapshots = params.getAll(SECTOR_PORTFOLIO_RETURN_PARAM);
  if (sectors.length !== 1 || snapshots.length !== 1) return null;
  const etf = nativeSectorEtf(sectors[0]);
  if (!etf) return null;
  const opener = parseSectorDepthReturn(snapshots[0]);
  if (!opener) return null;
  return { etf, snapshot: snapshots[0], opener };
}

/**
 * The Portfolio address for one selected native sector ETF and one admitted
 * opener. The snapshot must preserve the complete admitted selection inside
 * the incumbent public bound. An opener that needs a separate history binding
 * is withheld here, so this action never silently drops filters on return.
 */
export function sectorPortfolioHref(etf: string, opener: SectorState | null): string | null {
  const identity = nativeSectorEtf(etf);
  if (!identity || !opener) return null;
  const snapshot = sectorDepthReturnQuery(opener);
  if (!snapshot || snapshot !== encodeSectorDepthReturn(opener)) return null;
  const params = new URLSearchParams();
  params.set(SECTOR_PORTFOLIO_SECTOR_PARAM, identity);
  params.set(SECTOR_PORTFOLIO_RETURN_PARAM, snapshot);
  return `${SECTOR_PORTFOLIO_PATH}?${params.toString()}`;
}

/**
 * The address that returns the reader to the exact admitted selection. It is
 * always a relative Sector route: the context can never name another origin.
 * Null when the carried snapshot no longer decodes.
 */
export function sectorPortfolioReturnHref(context: SectorPortfolioContext | null): string | null {
  if (!context) return null;
  if (!parseSectorDepthReturn(context.snapshot)) return null;
  const params = new URLSearchParams();
  params.set(SECTOR_DISCOVER_TAB_PARAM, SECTOR_DISCOVER_TAB);
  for (const [key, value] of new URLSearchParams(context.snapshot)) {
    if (key === SECTOR_DISCOVER_TAB_PARAM) continue;
    params.append(key, value);
  }
  return `${SECTOR_DISCOVER_PATH}?${params.toString()}`;
}

/** Why no recorded-cost share may be shown for the selected ETF. */
export type SectorEtfWeightGap =
  | "not_held"
  | "unreadable"
  | "stale"
  | "no_eligible_cost"
  | "missing_basis"
  | "currency_unknown"
  | "currency_mismatch"
  | "amount_overflow";

/** The selected ETF's own holding, read from the canonical open position records. */
export type SectorEtfHolding = {
  /** The one native sector-ETF identity this reading is about. */
  etf: NativeSectorEtf;
  /** Open canonical position records whose ticker is exactly this ETF. */
  openRecords: number;
  /** Open records of this ETF that carry a comparable recorded cost. */
  coveredRecords: number;
  /** The eligible recorded-cost population, in lots. */
  eligibleLots: number;
  /** The eligible recorded-cost denominator, in the cohort's single currency. */
  eligibleCost: number | null;
  /** The cohort's single currency, when the cohort qualifies. */
  currency: string | null;
  /** The selected ETF's share of the eligible recorded cost, as a percentage. */
  weightPct: number | null;
  /** Why no numeric share is shown. */
  gap: SectorEtfWeightGap | null;
};

/**
 * The selected ETF's direct holding, read from the canonical open position
 * records the Portfolio already holds. Closed lots do not count, watchlists are
 * not read at all, and no technology stock implies sector exposure: only an
 * exact ticker match counts.
 *
 * The share of eligible recorded cost reuses the incumbent monetary cohort. An
 * unknown or mixed currency, a missing basis, an overflow, an empty eligible
 * population, an unreadable book and a stale book each withhold the number
 * instead of renormalizing around the gap. No FX, market value, sector
 * attribution or advice is derived here.
 */
export function sectorEtfHolding(
  positions: readonly Position[],
  etf: string,
  book: { unreadable: boolean; stale: boolean },
): SectorEtfHolding | null {
  const identity = nativeSectorEtf(etf);
  if (!identity) return null;
  const open = positions.filter(position => position.status === "open" && position.ticker === identity);
  const base: SectorEtfHolding = {
    etf: identity, openRecords: open.length, coveredRecords: 0, eligibleLots: 0,
    eligibleCost: null, currency: null, weightPct: null, gap: null,
  };
  // An unreadable or stale book does not prove what is held: it withholds the number, and it
  // never turns into a claim that nothing is held.
  if (book.unreadable) return { ...base, gap: "unreadable" };
  if (book.stale) return { ...base, gap: "stale" };
  if (!open.length) return { ...base, gap: "not_held" };

  const cohort = positiveCostCohort(positions);
  const covered = cohort.parts.filter(part => part.position.ticker === identity);
  const shared = {
    ...base,
    coveredRecords: covered.length,
    eligibleLots: cohort.parts.length,
  };
  if (cohort.reason) return { ...shared, gap: cohort.reason };
  if (!cohort.money) return { ...shared, gap: "no_eligible_cost" };
  const qualified = { ...shared, eligibleCost: cohort.money.amount, currency: cohort.money.currency };
  // An open record of this ETF without a comparable recorded cost is not
  // silently renormalized away: the whole share is withheld.
  if (covered.length < open.length) return { ...qualified, gap: "missing_basis" };
  const cost = covered.reduce((sum, part) => sum + part.cost, 0);
  if (!(cost > 0) || !(cohort.money.amount > 0)) return { ...qualified, gap: "missing_basis" };
  return { ...qualified, weightPct: Math.round((cost / cohort.money.amount) * 1000) / 10 };
}

/** Feature-local EN/ZH tuples for the admitted journey. */
export const SECTOR_PORTFOLIO_LEX = {
  viewInPortfolio: ["View in Portfolio", "在持仓中查看"],
  selectedSector: ["Selected sector", "所选板块"],
  scope: ["Selected-sector evidence from the same sector source as the Sector workspace. It is not a market-wide risk measure.", "来自与板块工作区相同数据源的所选板块证据。它不是全市场风险指标。"],
  holdingTitle: ["Your direct holding of {etf}", "您直接持有的 {etf}"],
  openRecords: ["{count} open record for {etf}", "{etf} 的 {count} 条持有中记录"],
  openRecordsPlural: ["{count} open records for {etf}", "{etf} 的 {count} 条持有中记录"],
  noDirectRecord: ["No directly held ETF record for {etf}.", "{etf} 没有直接持有的 ETF 记录。"],
  noDirectRecordHint: ["A missing ETF record is not a statement about sector exposure. Technology holdings such as NVDA or AMD do not imply {etf} exposure without a qualified classification bridge.", "缺少 ETF 记录并不代表没有板块敞口。NVDA、AMD 等科技股持仓在没有合格分类桥接的情况下不代表持有 {etf}。"],
  costShare: ["Share of eligible recorded cost", "占符合条件记录成本的比例"],
  weightValue: ["{pct}% of eligible recorded cost", "占符合条件记录成本的 {pct}%"],
  weightCoverage: ["{covered} of {total} eligible lots · {currency} {amount} recorded cost", "{total} 条符合条件记录中的 {covered} 条 · {currency} {amount} 记录成本"],
  gapUnreadable: ["The holdings read failed, so no recorded-cost share is shown.", "持仓读取失败，因此不显示记录成本占比。"],
  gapStale: ["The latest holdings check failed, so no recorded-cost share is shown.", "最新持仓核对失败，因此不显示记录成本占比。"],
  gapNoEligibleCost: ["No comparable positive entry cost is recorded, so no recorded-cost share is shown.", "没有可比较的正值入场成本记录，因此不显示记录成本占比。"],
  gapMissingBasis: ["This holding has no comparable recorded basis, so no recorded-cost share is shown.", "该持仓没有可比较的记录基础，因此不显示记录成本占比。"],
  gapCurrencyUnknown: ["The currency of some entry costs is not recorded, so no recorded-cost share is shown. No currency conversion has been applied.", "部分入场成本的币种未记录，因此不显示记录成本占比。未进行货币换算。"],
  gapCurrencyMismatch: ["Entry costs are recorded in more than one currency, so no recorded-cost share is shown. No currency conversion has been applied.", "入场成本记录在多个币种中，因此不显示记录成本占比。未进行货币换算。"],
  gapAmountOverflow: ["The recorded cost is outside the supported numeric range, so no recorded-cost share is shown.", "记录成本超出支持的数值范围，因此不显示记录成本占比。"],
  backDiscover: ["← Back to Discover", "← 返回发现页"],
  backRotation: ["← Back to Rotation", "← 返回轮动页"],
  backBreadth: ["← Back to Market breadth", "← 返回市场广度"],
} as const;
export type SectorPortfolioCopyKey = keyof typeof SECTOR_PORTFOLIO_LEX;

/** UI copy follows Terminal's EN/ZH tuple convention and the shared language owner. */
export function sectorPortfolioCopy(lang: "en" | "zh") {
  return (key: SectorPortfolioCopyKey): string => SECTOR_PORTFOLIO_LEX[key][lang === "zh" ? 1 : 0];
}
