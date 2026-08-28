import type { Bar, Fund } from "./fund";
import { fmtCur, fmtPct, nextDateCountdown } from "./finFormat";

export type KeyStatsPick = (en?: string | null, cn?: string | null) => string;

export interface KeyStatRow {
  id: string;
  label: string;
  value: string;
}

export function formatCompactStat(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e12) return `${(value / 1e12).toFixed(2)} T`;
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(2)} B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(2)} M`;
  if (magnitude >= 1e3) return `${(value / 1e3).toFixed(2)} K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function finitePositive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function finiteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function fixed(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Build the compact rail's cross-market stats without inventing placeholders.
 * The fund contract owns fundamentals; bars remain the fallback for trading
 * activity when a symbol has no fundamentals coverage.
 */
export function buildKeyStatRows(
  fund: Fund | null,
  bars: Bar[],
  pick: KeyStatsPick,
): KeyStatRow[] {
  const rows: KeyStatRow[] = [];
  const nextEarningsDays = nextDateCountdown(fund?.earnings?.next_date);
  const stats = fund?.stats;
  const ratios = fund?.ratios?.current;
  const dividendYield = fund?.dividends?.yield_ttm ?? ratios?.div_yield ?? null;
  const recentVolumes = bars
    .slice(-30)
    .map((bar) => bar.v)
    .filter(finitePositive);
  const lastVolume = bars.length ? bars[bars.length - 1].v : null;
  const averageVolume = recentVolumes.length
    ? recentVolumes.reduce((sum, volume) => sum + volume, 0) / recentVolumes.length
    : null;

  if (nextEarningsDays != null) {
    rows.push({
      id: "next-earnings",
      label: pick("Next earnings report", "下次财报"),
      value: pick(`In ${nextEarningsDays} days`, `${nextEarningsDays} 天后`),
    });
  }
  if (finitePositive(stats?.mktcap)) {
    rows.push({
      id: "market-cap",
      label: pick("Market capitalization", "总市值"),
      value: fmtCur(stats.mktcap, fund?.quote_currency, { decimals: 2 }),
    });
  }
  if (finitePositive(ratios?.pe_ttm)) {
    rows.push({
      id: "pe-ttm",
      label: pick("P/E ratio (TTM)", "市盈率 (TTM)"),
      value: `${fixed(ratios.pe_ttm, 1)}×`,
    });
  }
  if (finitePositive(dividendYield)) {
    rows.push({
      id: "dividend-yield",
      label: pick("Dividend yield (TTM)", "股息率 (TTM)"),
      value: fmtPct(dividendYield, { decimals: 2, sign: false }),
    });
  }
  if (finiteNumber(stats?.beta)) {
    rows.push({
      id: "beta",
      label: pick("Beta", "贝塔系数"),
      value: fixed(stats.beta, 2),
    });
  }
  if (finitePositive(lastVolume)) {
    rows.push({
      id: "volume",
      label: pick("Volume", "成交量"),
      value: formatCompactStat(lastVolume),
    });
  }
  if (finitePositive(averageVolume)) {
    rows.push({
      id: "average-volume",
      label: pick("Avg volume (30D)", "平均成交量(30日)"),
      value: formatCompactStat(averageVolume),
    });
  }
  if (finitePositive(stats?.shares_out)) {
    rows.push({
      id: "shares-outstanding",
      label: pick("Shares outstanding", "总股本"),
      value: formatCompactStat(stats.shares_out),
    });
  }
  if (finitePositive(stats?.float_shares)) {
    rows.push({
      id: "float-shares",
      label: pick("Float shares", "流通股数"),
      value: formatCompactStat(stats.float_shares),
    });
  }

  return rows;
}
