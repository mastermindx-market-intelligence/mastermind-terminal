// Historical risk of today's cost-weighted book (B-F08-9 / MO-DELTA-014).
//
// TWO-ORGANISMS LAW (UWP-R2): decision_support_only. This module never writes a signal, rank,
// size, rebalance or trade. It describes historical characteristics of the CURRENT open
// cost-weighted holdings — not realized account performance. No React, no fetch: every I/O
// concern lives in the lazy secondary route; this file is unit-testable without a DOM or a
// network.
//
// Concentration is REUSED from `computePortfolioRisk` in portfolioRisk.ts — never a second
// formula. Holdings fold by `tickerKey` exactly as F08 law requires.

import { computePortfolioRisk, tickerKey, type Bilingual, type Lang, type RiskInputPosition } from "@/lib/portfolioRisk";

export type { Lang, Bilingual, RiskInputPosition as HistoryInputPosition };

export const SCHEMA = "portfolio_risk_history.v1" as const;
export const MIN_ALIGNED = 126;
export const TRAIL_ALIGNED = 252;
export const RF_FRESHNESS_DAYS = 7;
export const RF_UNPUBLISHED_REASON = "risk-free series not published yet" as const;
export const RF_UNREADABLE_REASON = "risk-free series could not be read" as const;

export type ClosePoint = { date: string; close: number };
export type CloseSeries = ClosePoint[];
export type ReturnPoint = { date: string; ret: number };

export type RiskFreeSource = "DGS3MO" | "us3m" | "unpublished" | "unreadable";
export type RiskFreeSeries = { source: "DGS3MO" | "us3m"; points: CloseSeries };

export type HistoryExcludeReason = "short" | "unsized" | "not_positive" | "missing_price_history";

export type HistoryMetricReason =
  | typeof RF_UNPUBLISHED_REASON
  | typeof RF_UNREADABLE_REASON
  | "risk-free series is stale"
  | "not enough history"
  | "benchmark missing"
  | "zero volatility"
  | "zero downside deviation"
  | "zero benchmark variance";

export type CoverageStatus = "empty" | "partial" | "ready" | "unavailable";

export interface HistoryComputeOptions {
  minAligned?: number;
  trailAligned?: number;
  credentialed?: boolean;
  /** Distinguishes a proven 404 (unpublished) from a 401/locked/outage (unreadable). */
  riskFreeStatus?: "published" | "unpublished" | "unreadable";
}

export interface IncludedHolding {
  ticker: string;
  weightPct: number;
  cost: number;
}

export interface ExcludedHolding {
  ticker: string;
  reason: HistoryExcludeReason;
}

export interface PortfolioRiskHistory {
  schema: typeof SCHEMA;
  weightBasis: "cost";
  coverageSource: "credentialed" | "anonymous";
  coverageStatus: CoverageStatus;
  basis: "cost-weighted, positive open holdings";
  counts: {
    total: number;
    open: number;
    foldedTickers: number;
    included: number;
    excluded: number;
  };
  cost: {
    included: number | null;
    excluded: number | null;
    known: number | null;
  };
  sources: {
    ohlcAsOf: string | null;
    spyAsOf: string | null;
    riskFreeAsOf: string | null;
    riskFreeSource: RiskFreeSource;
    benchmark: "SPY";
  };
  window: {
    firstSession: string | null;
    lastSession: string | null;
    n: number;
    requested: number;
    minimum: number;
  };
  included: IncludedHolding[];
  excluded: ExcludedHolding[];
  gaps: { ticker: string | null; reason: HistoryExcludeReason | HistoryMetricReason }[];
  sharpe: number | null;
  sortino: number | null;
  beta: number | null;
  sharpeReason: HistoryMetricReason | null;
  sortinoReason: HistoryMetricReason | null;
  betaReason: HistoryMetricReason | null;
  concentration: ReturnType<typeof computePortfolioRisk>["concentration"];
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function ymd(raw: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? m[1] : null;
}

function utcDay(date: string): number | null {
  const stamp = ymd(date);
  if (!stamp) return null;
  const [y, m, d] = stamp.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

export function calendarDaysBetween(a: string, b: string): number | null {
  const da = utcDay(a);
  const db = utcDay(b);
  if (da == null || db == null) return null;
  return Math.round((db - da) / 86_400_000);
}

export function annualPercentToDaily(y: number): number {
  if (!Number.isFinite(y)) return NaN;
  return (1 + y / 100) ** (1 / 252) - 1;
}

export function dailyReturns(closes: CloseSeries): ReturnPoint[] {
  const out: ReturnPoint[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (!(prev.close > 0) || !Number.isFinite(cur.close)) continue;
    out.push({ date: cur.date, ret: cur.close / prev.close - 1 });
  }
  return out;
}

export function sampleMean(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sampleStd(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = sampleMean(xs);
  if (m == null) return null;
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0);
  const v = ss / (xs.length - 1);
  if (!(v > 0) || !Number.isFinite(v)) return null;
  return Math.sqrt(v);
}

export function sharpeRatio(port: readonly number[], rf: readonly number[]): number | null {
  if (port.length !== rf.length || port.length < 2) return null;
  const excess = port.map((p, i) => p - rf[i]);
  const m = sampleMean(excess);
  const s = sampleStd(excess);
  if (m == null || s == null) return null;
  return Math.sqrt(252) * m / s;
}

export function sortinoRatio(port: readonly number[], rf: readonly number[]): number | null {
  if (port.length !== rf.length || !port.length) return null;
  const excess = port.map((p, i) => p - rf[i]);
  const m = sampleMean(excess);
  if (m == null) return null;
  const down = excess.reduce((a, x) => a + Math.min(x, 0) ** 2, 0) / excess.length;
  if (!(down > 0) || !Number.isFinite(down)) return null;
  return Math.sqrt(252) * m / Math.sqrt(down);
}

export function betaVsBenchmark(port: readonly number[], bench: readonly number[]): number | null {
  if (port.length !== bench.length || port.length < 2) return null;
  const mp = sampleMean(port);
  const mb = sampleMean(bench);
  if (mp == null || mb == null) return null;
  const n = port.length;
  let cov = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const dp = port[i] - mp;
    const db = bench[i] - mb;
    cov += dp * db;
    vb += db * db;
  }
  cov /= n - 1;
  vb /= n - 1;
  if (!(vb > 0) || !Number.isFinite(vb) || !Number.isFinite(cov)) return null;
  return cov / vb;
}

export function parseOhlcBars(body: unknown, opts: { allowNonPositive?: boolean } = {}): CloseSeries | null {
  if (!body || typeof body !== "object") return null;
  const bars = (body as { bars?: unknown }).bars;
  if (!Array.isArray(bars)) return null;
  const out: CloseSeries = [];
  for (const row of bars) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const date = ymd(String(row[0]));
    const close = Number(row[4]);
    if (!date || !Number.isFinite(close)) continue;
    if (!opts.allowNonPositive && !(close > 0)) continue;
    out.push({ date, close });
  }
  return out.length ? out : null;
}

function lastDate(series: CloseSeries | null | undefined): string | null {
  if (!series || !series.length) return null;
  return series[series.length - 1].date;
}

function toReturnMap(series: CloseSeries): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of dailyReturns(series)) m.set(p.date, p.ret);
  return m;
}

function intersectDates(maps: Map<string, number>[]): string[] {
  if (!maps.length) return [];
  const [first, ...rest] = maps;
  const out: string[] = [];
  for (const date of first.keys()) {
    if (rest.every((m) => m.has(date))) out.push(date);
  }
  out.sort();
  return out;
}

function trimTrail(dates: string[], trail: number): string[] {
  if (dates.length <= trail) return dates;
  return dates.slice(dates.length - trail);
}

function rfDailyOn(points: CloseSeries, date: string): number | null {
  let best: ClosePoint | null = null;
  for (const p of points) {
    const gap = calendarDaysBetween(p.date, date);
    if (gap == null || gap < 0 || gap > RF_FRESHNESS_DAYS) continue;
    if (!best || p.date > best.date) best = p;
  }
  if (!best) return null;
  const daily = annualPercentToDaily(best.close);
  return Number.isFinite(daily) ? daily : null;
}

interface Folded {
  total: number;
  open: number;
  costByTicker: Map<string, number>;
  excluded: ExcludedHolding[];
  excludedCost: number;
}

function foldHoldings(positions: readonly RiskInputPosition[]): Folded {
  const excluded: ExcludedHolding[] = [];
  const costByTicker = new Map<string, number>();
  let excludedCost = 0;
  let open = 0;
  for (const p of positions) {
    if (p.status !== "open") continue;
    open += 1;
    const key = tickerKey(p.ticker);
    if (isFiniteNum(p.shares) && p.shares < 0) {
      excluded.push({ ticker: key, reason: "short" });
      if (isFiniteNum(p.entryPrice)) excludedCost += Math.abs(p.shares * p.entryPrice);
      continue;
    }
    if (!isFiniteNum(p.shares) || !isFiniteNum(p.entryPrice)) {
      excluded.push({ ticker: key, reason: "unsized" });
      continue;
    }
    const cost = p.shares * p.entryPrice;
    if (!(cost > 0)) {
      excluded.push({ ticker: key, reason: "not_positive" });
      continue;
    }
    costByTicker.set(key, (costByTicker.get(key) ?? 0) + cost);
  }
  return {
    total: positions.length,
    open,
    costByTicker,
    excluded,
    excludedCost,
  };
}

export function computePortfolioRiskHistory(
  positions: readonly RiskInputPosition[],
  ohlcByTicker: Readonly<Record<string, CloseSeries | null | undefined>>,
  spy: CloseSeries | null | undefined,
  rf: RiskFreeSeries | null | undefined,
  options: HistoryComputeOptions = {},
): PortfolioRiskHistory {
  const minAligned = options.minAligned ?? MIN_ALIGNED;
  const trailAligned = options.trailAligned ?? TRAIL_ALIGNED;
  const credentialed = !!options.credentialed;
  const rfStatus = rf
    ? "published" as const
    : (options.riskFreeStatus === "unreadable" ? "unreadable" as const : "unpublished" as const);
  const rfAbsentReason: HistoryMetricReason = rfStatus === "unreadable"
    ? RF_UNREADABLE_REASON
    : RF_UNPUBLISHED_REASON;
  const rfAbsentSource: RiskFreeSource = rfStatus === "unreadable" ? "unreadable" : "unpublished";
  const concentration = computePortfolioRisk(positions, {}, credentialed).concentration;
  const folded = foldHoldings(positions);

  const included: IncludedHolding[] = [];
  const excluded = [...folded.excluded];
  let extraExcludedCost = 0;
  const returnMaps: { ticker: string; cost: number; map: Map<string, number> }[] = [];
  let ohlcAsOf: string | null = null;

  for (const [ticker, cost] of folded.costByTicker) {
    const series = ohlcByTicker[ticker];
    if (!series || series.length < 2) {
      excluded.push({ ticker, reason: "missing_price_history" });
      extraExcludedCost += cost;
      continue;
    }
    const asOf = lastDate(series);
    if (asOf && (!ohlcAsOf || asOf > ohlcAsOf)) ohlcAsOf = asOf;
    const map = toReturnMap(series);
    if (map.size < 1) {
      excluded.push({ ticker, reason: "missing_price_history" });
      extraExcludedCost += cost;
      continue;
    }
    returnMaps.push({ ticker, cost, map });
  }

  const includedCost = returnMaps.reduce((a, r) => a + r.cost, 0);
  const excludedCost = folded.excludedCost + extraExcludedCost;
  const known = includedCost + excludedCost;

  for (const row of returnMaps) {
    included.push({
      ticker: row.ticker,
      cost: row.cost,
      weightPct: includedCost > 0 ? (row.cost / includedCost) * 100 : 0,
    });
  }
  included.sort((a, b) => b.cost - a.cost || a.ticker.localeCompare(b.ticker));

  const gaps: PortfolioRiskHistory["gaps"] = excluded.map((e) => ({ ticker: e.ticker, reason: e.reason }));

  const base = {
    schema: SCHEMA,
    weightBasis: "cost" as const,
    coverageSource: (credentialed ? "credentialed" : "anonymous") as "credentialed" | "anonymous",
    basis: "cost-weighted, positive open holdings" as const,
    counts: {
      total: folded.total,
      open: folded.open,
      foldedTickers: folded.costByTicker.size,
      included: included.length,
      excluded: excluded.length,
    },
    cost: {
      included: included.length ? includedCost : null,
      excluded: excludedCost > 0 ? excludedCost : null,
      known: known > 0 ? known : null,
    },
    sources: {
      ohlcAsOf,
      spyAsOf: lastDate(spy ?? null),
      riskFreeAsOf: lastDate(rf?.points ?? null),
      riskFreeSource: (rf?.source ?? rfAbsentSource) as RiskFreeSource,
      benchmark: "SPY" as const,
    },
    included,
    excluded,
    concentration,
  };

  if (!returnMaps.length) {
    return {
      ...base,
      coverageStatus: folded.open === 0 ? "empty" : "unavailable",
      window: {
        firstSession: null,
        lastSession: null,
        n: 0,
        requested: TRAIL_ALIGNED,
        minimum: MIN_ALIGNED,
      },
      gaps,
      sharpe: null,
      sortino: null,
      beta: null,
      sharpeReason: "not enough history",
      sortinoReason: "not enough history",
      betaReason: "not enough history",
    };
  }

  const aligned = trimTrail(intersectDates(returnMaps.map((r) => r.map)), trailAligned);
  const weights = returnMaps.map((r) => r.cost / includedCost);
  const port = aligned.map((date) =>
    returnMaps.reduce((sum, row, i) => sum + weights[i] * (row.map.get(date) ?? 0), 0),
  );

  const window = {
    firstSession: aligned[0] ?? null,
    lastSession: aligned[aligned.length - 1] ?? null,
    n: aligned.length,
    requested: TRAIL_ALIGNED,
    minimum: MIN_ALIGNED,
  };

  let sharpe: number | null = null;
  let sortino: number | null = null;
  let beta: number | null = null;
  let sharpeReason: HistoryMetricReason | null = null;
  let sortinoReason: HistoryMetricReason | null = null;
  let betaReason: HistoryMetricReason | null = null;

  if (aligned.length < minAligned) {
    sharpeReason = "not enough history";
    sortinoReason = "not enough history";
    betaReason = "not enough history";
    gaps.push({ ticker: null, reason: "not enough history" });
  } else {
    if (!rf) {
      sharpeReason = rfAbsentReason;
      sortinoReason = rfAbsentReason;
      gaps.push({ ticker: null, reason: rfAbsentReason });
    } else {
      const rfDaily = aligned.map((d) => rfDailyOn(rf.points, d));
      if (rfDaily.some((x) => x == null)) {
        sharpeReason = "risk-free series is stale";
        sortinoReason = "risk-free series is stale";
        gaps.push({ ticker: null, reason: "risk-free series is stale" });
      } else {
        const rfVals = rfDaily as number[];
        const s = sharpeRatio(port, rfVals);
        if (s == null) {
          sharpeReason = "zero volatility";
          gaps.push({ ticker: null, reason: "zero volatility" });
        } else {
          sharpe = s;
        }
        const so = sortinoRatio(port, rfVals);
        if (so == null) {
          sortinoReason = "zero downside deviation";
          gaps.push({ ticker: null, reason: "zero downside deviation" });
        } else {
          sortino = so;
        }
      }
    }

    if (!spy || spy.length < 2) {
      betaReason = "benchmark missing";
      gaps.push({ ticker: null, reason: "benchmark missing" });
    } else {
      const spyMap = toReturnMap(spy);
      const betaDates = aligned.filter((d) => spyMap.has(d));
      if (betaDates.length < minAligned) {
        betaReason = "not enough history";
        gaps.push({ ticker: null, reason: "not enough history" });
      } else {
        const portB = betaDates.map((d) =>
          returnMaps.reduce((sum, row, i) => sum + weights[i] * (row.map.get(d) ?? 0), 0),
        );
        const spyB = betaDates.map((d) => spyMap.get(d)!);
        const b = betaVsBenchmark(portB, spyB);
        if (b == null) {
          betaReason = "zero benchmark variance";
          gaps.push({ ticker: null, reason: "zero benchmark variance" });
        } else {
          beta = b;
        }
      }
    }
  }

  const metricPresent = [sharpe, sortino, beta].filter((x) => x != null).length;
  let coverageStatus: CoverageStatus;
  if (metricPresent === 3) coverageStatus = "ready";
  else if (metricPresent > 0) coverageStatus = "partial";
  else coverageStatus = "unavailable";

  return {
    ...base,
    coverageStatus,
    window,
    gaps,
    sharpe,
    sortino,
    beta,
    sharpeReason,
    sortinoReason,
    betaReason,
  };
}

export function historyAvailability(
  attempted: boolean,
  payload?: PortfolioRiskHistory | null,
): "hidden" | "ready" | "unavailable" {
  if (!attempted) return "hidden";
  if (payload) return "ready";
  return "unavailable";
}

export const T_HISTORY_UNAVAILABLE: Bilingual = {
  en: "We could not read the historical risk of today's book. It will try again next time you reload.",
  zh: "暂时未能读取今日持仓的历史风险特征，下次刷新会重新尝试。",
};

const T_TITLE: Bilingual = { en: "Historical risk of today's book", zh: "今日持仓的历史风险特征" };
const T_STANDING: Bilingual = {
  en: "These are historical characteristics of today's cost-weighted holdings, not realized account returns and not a recommendation.",
  zh: "这些是按今天成本加权后的持仓历史特征，不是账户的实际收益，也不是投资建议。",
};
const T_BASIS: Bilingual = {
  en: "Weighted by what you paid, using open holdings with a positive cost.",
  zh: "按你的买入成本加权，只计入成本为正的未平仓持仓。",
};
const T_WINDOW: Bilingual = {
  en: "First session {first}. Last session {last}. {n} sessions.",
  zh: "首个交易日 {first}。最近交易日 {last}。共 {n} 个交易日。",
};
const T_WINDOW_NONE: Bilingual = {
  en: "No overlapping trading sessions yet.",
  zh: "目前还没有重叠的交易日。",
};
const T_BENCH: Bilingual = { en: "Benchmark is SPY.", zh: "比较基准是 SPY。" };
const T_RF_DGS: Bilingual = {
  en: "Risk-free source is the three-month Treasury yield.",
  zh: "无风险利率来自三个月期国债收益率。",
};
const T_RF_US3M: Bilingual = {
  en: "Risk-free source is the three-month Treasury yield.",
  zh: "无风险利率来自三个月期国债收益率。",
};
const T_RF_NONE: Bilingual = {
  en: "The three-month Treasury yield series has not been published yet.",
  zh: "三个月期国债收益率序列尚未发布。",
};
const T_RF_UNREADABLE: Bilingual = {
  en: "The three-month Treasury yield could not be read.",
  zh: "暂时读不到三个月期国债收益率。",
};
const T_ASOF: Bilingual = {
  en: "Holdings prices as of {ohlc}. SPY as of {spy}. Risk-free as of {rf}.",
  zh: "持仓价格截至 {ohlc}。SPY 截至 {spy}。无风险利率截至 {rf}。",
};
const T_EMPTY: Bilingual = {
  en: "There is no open holding to describe yet.",
  zh: "目前没有未平仓持仓可供描述。",
};
const T_NOT_ENOUGH: Bilingual = {
  en: "There are not enough overlapping trading days yet to describe this book's historical risk. At least 126 aligned sessions are needed.",
  zh: "重叠的交易日还不够，暂时无法描述这本持仓的历史风险。至少需要 126 个对齐的交易日。",
};

const T_SHARPE: Bilingual = { en: "Sharpe ratio", zh: "夏普比率" };
const T_SORTINO: Bilingual = { en: "Sortino ratio", zh: "索提诺比率" };
const T_BETA: Bilingual = { en: "Beta versus SPY", zh: "相对 SPY 的贝塔" };
const T_CONC: Bilingual = { en: "Biggest holding", zh: "最大的一笔持仓" };

const T_INCLUDED: Bilingual = { en: "Holdings in this picture", zh: "计入这张图的持仓" };
const T_EXCLUDED: Bilingual = { en: "Holdings left out", zh: "未计入的持仓" };
const T_GAPS: Bilingual = { en: "{n} gaps in this picture", zh: "这张图有 {n} 处缺口" };
const T_GAPS_ONE: Bilingual = { en: "1 gap in this picture", zh: "这张图有 1 处缺口" };

const EXCLUDE_COPY: Record<HistoryExcludeReason, Bilingual> = {
  short: { en: "short holdings are not given a return series in this version", zh: "本版本不为空头持仓编制收益率序列。" },
  unsized: { en: "no share count or entry price on record", zh: "没有记录数量或买入价。" },
  not_positive: { en: "cost is not positive", zh: "成本不是正数。" },
  missing_price_history: { en: "no daily price history to read", zh: "读不到每日价格历史。" },
};

const METRIC_COPY: Record<HistoryMetricReason, Bilingual> = {
  [RF_UNPUBLISHED_REASON]: {
    en: "The three-month Treasury yield series has not been published yet, so this figure cannot be computed. Beta still uses SPY.",
    zh: "三个月期国债收益率序列尚未发布，因此无法计算该数字。贝塔仍按 SPY 计算。",
  },
  [RF_UNREADABLE_REASON]: {
    en: "The three-month Treasury yield could not be read, so this figure cannot be computed. Beta still uses SPY.",
    zh: "暂时读不到三个月期国债收益率，因此无法计算该数字。贝塔仍按 SPY 计算。",
  },
  "risk-free series is stale": {
    en: "The three-month Treasury yield is more than seven days old, so this figure cannot be computed.",
    zh: "三个月期国债收益率已超过七天未更新，因此无法计算该数字。",
  },
  "not enough history": T_NOT_ENOUGH,
  "benchmark missing": {
    en: "SPY's daily prices could not be read, so beta cannot be computed.",
    zh: "读不到 SPY 的每日价格，因此无法计算贝塔。",
  },
  "zero volatility": {
    en: "Daily variation of this book is zero over the window, so the Sharpe ratio cannot be computed.",
    zh: "这段窗口里持仓的每日波动为零，因此无法计算夏普比率。",
  },
  "zero downside deviation": {
    en: "There were no down days versus the risk-free rate, so the Sortino ratio cannot be computed.",
    zh: "相对无风险利率没有下跌的交易日，因此无法计算索提诺比率。",
  },
  "zero benchmark variance": {
    en: "SPY did not vary over the window, so beta cannot be computed.",
    zh: "这段窗口里 SPY 没有波动，因此无法计算贝塔。",
  },
};

function fill(b: Bilingual, vars: Record<string, string>): Bilingual {
  const sub = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), s);
  return { en: sub(b.en), zh: sub(b.zh) };
}

const dash = "—";
const fmtNum = (n: number | null) => (n == null || !Number.isFinite(n) ? dash : n.toFixed(2));
const fmtPct = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function historyCopy(h: PortfolioRiskHistory): {
  title: Bilingual;
  standing: Bilingual;
  basis: Bilingual;
  empty: Bilingual | null;
  window: Bilingual;
  benchmark: Bilingual;
  riskFree: Bilingual;
  asOf: Bilingual;
  sharpe: { label: Bilingual; value: Bilingual | null; unread: Bilingual | null };
  sortino: { label: Bilingual; value: Bilingual | null; unread: Bilingual | null };
  beta: { label: Bilingual; value: Bilingual | null; unread: Bilingual | null };
  concentration: { label: Bilingual; value: Bilingual | null; unread: Bilingual | null };
  includedHeader: Bilingual;
  included: { ticker: string; text: Bilingual }[];
  excludedHeader: Bilingual;
  excluded: { ticker: string; text: Bilingual }[];
  gapsSummary: Bilingual | null;
  gapLines: { ticker: string | null; text: Bilingual }[];
} {
  const empty = h.counts.open === 0 ? T_EMPTY : null;
  const window = h.window.n
    ? fill(T_WINDOW, {
      first: h.window.firstSession ?? dash,
      last: h.window.lastSession ?? dash,
      n: String(h.window.n),
    })
    : T_WINDOW_NONE;
  const riskFree = h.sources.riskFreeSource === "DGS3MO"
    ? T_RF_DGS
    : h.sources.riskFreeSource === "us3m"
      ? T_RF_US3M
      : h.sources.riskFreeSource === "unreadable"
        ? T_RF_UNREADABLE
        : T_RF_NONE;
  const asOf = fill(T_ASOF, {
    ohlc: h.sources.ohlcAsOf ?? dash,
    spy: h.sources.spyAsOf ?? dash,
    rf: h.sources.riskFreeAsOf ?? dash,
  });

  const metric = (
    label: Bilingual,
    value: number | null,
    reason: HistoryMetricReason | null,
  ) => {
    if (h.counts.open === 0) {
      return { label, value: null as Bilingual | null, unread: null as Bilingual | null };
    }
    return {
      label,
      value: value == null ? null : { en: fmtNum(value), zh: fmtNum(value) },
      unread: value == null ? (reason ? METRIC_COPY[reason] : T_NOT_ENOUGH) : null,
    };
  };

  const conc = h.concentration?.top1
    ? {
      label: T_CONC,
      value: {
        en: `${h.concentration.top1.ticker} ${fmtPct(h.concentration.top1.weightPct)}%`,
        zh: `${h.concentration.top1.ticker} ${fmtPct(h.concentration.top1.weightPct)}%`,
      },
      unread: null,
    }
    : { label: T_CONC, value: null, unread: { en: "No holding has both a share count and a buy price yet.", zh: "还没有持仓同时记录了数量和买入价。" } };

  const gapLines = h.gaps.map((g) => ({
    ticker: g.ticker,
    text: (g.reason in EXCLUDE_COPY
      ? EXCLUDE_COPY[g.reason as HistoryExcludeReason]
      : METRIC_COPY[g.reason as HistoryMetricReason]) ?? T_NOT_ENOUGH,
  }));

  return {
    title: T_TITLE,
    standing: T_STANDING,
    basis: T_BASIS,
    empty,
    window,
    benchmark: T_BENCH,
    riskFree,
    asOf,
    sharpe: metric(T_SHARPE, h.sharpe, h.sharpeReason),
    sortino: metric(T_SORTINO, h.sortino, h.sortinoReason),
    beta: metric(T_BETA, h.beta, h.betaReason),
    concentration: conc,
    includedHeader: T_INCLUDED,
    included: h.included.map((row) => ({
      ticker: row.ticker,
      text: {
        en: `${fmtPct(row.weightPct)}% of what you paid`,
        zh: `占买入成本的 ${fmtPct(row.weightPct)}%`,
      },
    })),
    excludedHeader: T_EXCLUDED,
    excluded: h.excluded.map((row) => ({ ticker: row.ticker, text: EXCLUDE_COPY[row.reason] })),
    gapsSummary: h.gaps.length
      ? (h.gaps.length === 1 ? T_GAPS_ONE : fill(T_GAPS, { n: String(h.gaps.length) }))
      : null,
    gapLines,
  };
}
