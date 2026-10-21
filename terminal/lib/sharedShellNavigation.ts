import { isPresentationHref } from "./sharedShellContracts";
/** Presentation of existing destinations. Admission remains in the generated route projection. */
export const SHARED_SHELL_NAV = [
  { k: "shellToday", label: "Today", href: "/macro.html" },
  { k: "discover", label: "Discover", href: "/discover" },
  { k: "analysis", label: "Analysis", href: "/analysis" },
  { k: "shellMonitor", label: "Monitor", href: "/watchlist.html" },
  { k: "shellResearch", label: "Research", href: "/research_screener.html" },
  { k: "portfolio", label: "Portfolio", href: "/portfolio" },
];
export const SHARED_SHELL_MARKETS = [
  { k: "shellMarketUS", label: "United States", code: "US", href: "/us_stocks.html" },
  { k: "shellMarketCN", label: "China", code: "CN", href: "/china.html" },
  { k: "shellMarketHK", label: "Hong Kong", code: "HK", href: "/hk.html" },
  { k: "shellMarketCA", label: "Canada", code: "CA", href: "/canada.html" },
  { k: "shellMarketIntl", label: "International", code: "INTL", href: "/intl.html" },
];
export function sharedShellActiveKey(path: string): string {
  if (path.startsWith("/analysis") || /^\/(?:stock|china_lookup|hk_lookup|canada_stock|intl_stock)\.html$/.test(path))
    return "analysis";
  if (path.startsWith("/discover")) return "discover";
  if (path.startsWith("/portfolio")) return "portfolio";
  if (path.includes("watchlist") || path.startsWith("/alerts")) return "shellMonitor";
  if (/^\/(?:research|learn|blog|stocks\/earnings)/.test(path)) return "shellResearch";
  return "shellToday";
}

/** Keep the incumbent Terminal return handoff on every beta chart/AI entry. */
export function sharedShellTerminalHref(canonicalHref: string, symbol?: string | null, ai = false): string {
  const ret = isPresentationHref(canonicalHref) ? canonicalHref : new URL("/macro.html", canonicalHref).href;
  const params = new URLSearchParams({ from: "macro", ret });
  if (symbol) params.set("symbol", symbol);
  if (ai) params.set("ai", "1");
  return "/terminal?" + params.toString();
}
