/**
 * optionsRoots.ts — the ONE source for the options-hub root pickers.
 *
 * Extracted from GexDeskView so every per-root options surface (GEX desk,
 * Volatility tab, …) offers the same universe in its input+datalist instead of
 * each desk growing its own drifting copy.
 *
 * GEX_QUICK_ROOTS — one-click chips next to the ticker box (indices first, then
 * the most liquid single names). GEX_AUTOCOMPLETE_ROOTS — the native <datalist>
 * dropdown: a zero-dependency "instant search" without loading the 1.9MB manifest.
 */

export const GEX_QUICK_ROOTS = ["SPY", "QQQ", "IWM", "NVDA", "TSLA", "META", "AAPL"];

// SPCX carries history only from its 2026-06-12 relisting: the same root served a
// SPAC ETF until that ETF delisted in 2026-04, and the ingest lane floors the root
// at the relisting date so the two eras never merge. Its session history is short
// by design, not by omission.
export const GEX_AUTOCOMPLETE_ROOTS = [
  // Index and broad-market anchors
  "SPY", "QQQ", "IWM", "DIA", "SPX", "SPXW", "XSP", "NDX", "RUT",
  // Macro and cross-asset proxies
  "GLD", "SLV", "TLT", "HYG", "USO", "UUP", "FXI", "EEM",
  // Sector and industry anchors
  "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
  "KRE", "SMH", "SOXX", "XBI", "ARKK",
  // Mega-cap and high-liquidity technology
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "AMD", "AVGO",
  "MU", "WDC", "STX", "SNDK", "INTC", "QCOM", "ARM", "TSM", "ASML", "MRVL",
  "AMAT", "LRCX", "KLAC", "SMCI", "PLTR", "CRWD", "PANW", "ORCL", "CRM", "NOW", "ADBE",
  // Consumer, communications, and internet
  "NFLX", "DIS", "UBER", "ABNB", "DASH", "SHOP", "BABA", "JD", "PDD", "SPCX",
  // Crypto-linked and high-beta finance
  "COIN", "MSTR", "MARA", "RIOT", "SOFI", "HOOD",
  // Financials and payments
  "JPM", "BAC", "GS", "MS", "WFC", "C", "V", "MA", "PYPL",
  // Energy, health care, industrials, and defense
  "XOM", "CVX", "OXY", "SLB", "UNH", "LLY", "NVO", "JNJ", "PFE", "ABBV",
  "BA", "CAT", "DE", "GE", "LMT", "NOC", "RTX",
  // Autos, travel, and consumer staples/discretionary
  "F", "GM", "RIVN", "LCID", "AAL", "DAL", "CCL", "RCL", "WMT", "COST", "HD",
  "NKE", "SBUX", "MCD", "KO", "PEP",
];
