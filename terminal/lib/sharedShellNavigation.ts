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
  { k: "shellUS", label: "United States", code: "US", href: "/us_stocks.html" },
  { k: "shellChina", label: "China", code: "CN", href: "/china.html" },
  { k: "shellHK", label: "Hong Kong", code: "HK", href: "/hk.html" },
  { k: "shellCanada", label: "Canada", code: "CA", href: "/canada.html" },
  { k: "shellGlobal", label: "International", code: "INTL", href: "/intl.html" },
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
