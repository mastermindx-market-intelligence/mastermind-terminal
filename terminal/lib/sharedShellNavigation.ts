import { canonicalEpisodeId } from "./dislocations/episodeDeepLink";
import { normalizeAnalysisSymbol } from "./analysisSymbol";
import { TF_CANONICAL_ORDER } from "./startTf";
import { isPresentationHref } from "./sharedShellContracts";
/** Presentation of existing destinations. Admission remains in the generated route projection. */
export const SHARED_SHELL_NAV = [
  { k: "shellToday", label: "Today", href: "/today" },
  { k: "shellOptionsFlow", label: "Options Flow", href: "/options" },
  { k: "portfolio", label: "Portfolio", href: "/portfolio" },
];
export const SHARED_SHELL_MARKETS = [
  { id: "us", k: "shellMarketUS", label: "United States", code: "US", href: "/us_stocks.html" },
  { id: "cn", k: "shellMarketCN", label: "China", code: "CN", href: "/china.html" },
  { id: "hk", k: "shellMarketHK", label: "Hong Kong", code: "HK", href: "/hk.html" },
  { id: "ca", k: "shellMarketCA", label: "Canada", code: "CA", href: "/canada.html" },
  { id: "intl", k: "shellMarketIntl", label: "International", code: "INTL", href: "/intl.html" },
];
export function sharedShellActiveKey(path: string): string {
  if (path === "/options" || path.startsWith("/options/")) return "shellOptionsFlow";
  if (path === "/today") return "shellToday";
  if (path.startsWith("/analysis") || /^\/(?:stock|china_lookup|hk_lookup|canada_stock|intl_stock)\.html$/.test(path))
    return "analysis";
  if (path === "/discover" || path.startsWith("/discover/")) return "discover";
  if (path === "/monitor") return "shellMonitor";
  if (path.startsWith("/portfolio")) return "portfolio";
  if (path.includes("watchlist") || path.startsWith("/alerts")) return "shellMonitor";
  if (/^\/(?:research|learn|blog|stocks\/earnings)/.test(path)) return "shellResearch";
  // Other estate tools and regional overviews do not inherit a native primary job.
  return "";
}

/** Keep only the chart state that belongs to this company across an Analysis visit. */
export function chartAnalysisHref(symbol: string, timeframe?: string, episode?: string): string {
  const params = new URLSearchParams({ symbol });
  const tf = timeframe && TF_CANONICAL_ORDER.includes(timeframe) ? timeframe : null;
  const id = canonicalEpisodeId(episode);
  if (tf || id) {
    params.set("chartSymbol", symbol);
    if (tf) params.set("tf", tf);
    if (id) params.set("episode", id);
  }
  return "/analysis?" + params.toString();
}

/** Keep the incumbent Terminal return handoff on every beta chart/AI entry. */
export function sharedShellTerminalHref(canonicalHref: string, symbol?: string | null, ai = false): string {
  const ret = isPresentationHref(canonicalHref) ? canonicalHref : new URL("/macro.html", canonicalHref).href;
  const params = new URLSearchParams({ from: "macro", ret });
  if (symbol) params.set("symbol", symbol);
  const source = new URL(ret, "https://beta.mastermind-x.com");
  if (source.pathname === "/analysis" && symbol && source.searchParams.get("chartSymbol") === symbol
      && normalizeAnalysisSymbol(source.searchParams.get("symbol") ?? undefined) === symbol) {
    const tf = source.searchParams.get("tf");
    const episode = canonicalEpisodeId(source.searchParams.get("episode"));
    if (tf && TF_CANONICAL_ORDER.includes(tf)) params.set("tf", tf);
    if (episode) params.set("episode", episode);
  }
  if (ai) params.set("ai", "1");
  return "/terminal?" + params.toString();
}
