/**
 * Asset-class categories for the symbol-search dialog, and the BROWSE listing behind them.
 *
 * WHY A MODULE
 *     These were locals inside SearchModal.tsx, which has no test surface (the suite is vitest
 *     over lib/, with no component renderer). The browse listing below is real selection logic —
 *     ordering, caps, market filtering — so it lives where it can be tested.
 */

import { isSymbolVisible, type MarketPrefs } from "./markets";

/** Manifest fields this module reads. Deliberately narrower than SearchModal's Row. */
export type CatRow = { name?: string; zh?: string; mkt?: string; sec?: string; mcap?: number | null };

// Asset-class → search-tab mapping. `sec` in the manifest is the asset class
// (Equities / Funds / Crypto / …); anything unmapped (incl. stocks) falls under "Stocks".
export const CAT_OF: Record<string, string> = {
  Funds: "Funds", Crypto: "Crypto", Indices: "Indices", Bonds: "Bonds",
  Futures: "Futures", Forex: "Forex", Economy: "Economy", Options: "Options",
};

// The manifest tags ETFs as "Equities" today, so a pure `sec` map would file SPY/QQQ under
// Stocks. This explicit ticker set routes the common broad-market/sector ETFs into "Funds" so
// that category has real coverage (and lights up instead of rendering disabled). Heuristics
// beyond this fixed set are intentionally out of scope — extend the set, don't guess.
export const FUND_TICKERS = new Set(["SPY", "QQQ", "IWM", "DIA", "SOXL", "GLD", "TLT"]);

export const tabOf = (sym: string, sec?: string): string =>
  FUND_TICKERS.has(sym) ? "Funds" : (sec && CAT_OF[sec]) || "Stocks";

/** Company search requires the manifest's explicit equity class; unknown assets fail closed. */
export function isCompanySearchRow(sym: string, row: CatRow | undefined): boolean {
  return row?.sec === "Equities" && !FUND_TICKERS.has(sym);
}

// How many rows a category browse lists. The body scrolls, so this is a "how much is useful"
// cap rather than a layout constraint: enough to browse a real asset class (161 crypto pairs,
// 61 funds, 22 indices) without walking the 8.7k equity universe, which is what the query is
// for. Search results keep their own tighter 30-row cap — ranked relevance needs no depth.
export const BROWSE_CAP = 60;

/**
 * The symbols to list when a category tab is selected and the query is EMPTY.
 *
 * Before this, an empty query rendered ONLY search history, so picking "Crypto" on a fresh
 * session showed the two coins that happened to be in RECENT — indistinguishable from "this
 * category has nothing in it" (reported 2026-07-27 as "only BTC and ETH are in Crypto", with
 * 24 crypto rows sitting in the manifest). A category tab now browses its category.
 *
 * Ordering: market cap descending where the manifest carries one (equities/funds), then
 * manifest order for everything else. Macro rows have no mcap and arrive in catalog order,
 * which macro_catalog.py keeps liquidity-ranked — so crypto lists BTC/ETH/SOL first rather
 * than alphabetically, without this module needing a second ranking rule.
 *
 * `exclude` is the already-rendered RECENT set, so a recent symbol is not listed twice.
 */
export function categoryBrowse(
  manifest: Record<string, CatRow>,
  cat: string,
  opts: {
    exclude?: Iterable<string>;
    marketPrefs?: MarketPrefs;
    prefsReady?: boolean;
    cap?: number;
  } = {},
): string[] {
  if (!cat || cat === "All") return [];
  const skip = new Set(opts.exclude ?? []);
  const { marketPrefs, prefsReady = false } = opts;

  const withCap: [string, number][] = [];
  const rest: string[] = [];
  for (const [sym, row] of Object.entries(manifest)) {
    if (skip.has(sym)) continue;
    if (tabOf(sym, row?.sec) !== cat) continue;
    // Mirrors SearchModal's marketVisible: before the account answers, hide nothing.
    if (prefsReady && marketPrefs && !isSymbolVisible(sym, row, marketPrefs)) continue;
    const mcap = typeof row?.mcap === "number" && row.mcap > 0 ? row.mcap : null;
    if (mcap !== null) withCap.push([sym, mcap]);
    else rest.push(sym);
  }
  // Ties by ticker so the order is stable across renders (Object.entries order is not a
  // guarantee we want leaking into the UI for rows that share a market cap).
  withCap.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return [...withCap.map(([s]) => s), ...rest].slice(0, opts.cap ?? BROWSE_CAP);
}
