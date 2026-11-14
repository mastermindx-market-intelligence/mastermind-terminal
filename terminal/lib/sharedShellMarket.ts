import { isMarketId, type MarketId } from "@/lib/markets";

/** Workspace context is URL-owned. It never changes account market preferences. */
export type WorkspaceMarket = Exclude<MarketId, "crypto">;
type Family = "macro" | "prophet" | "cycles" | "sectors";

// Presentation bindings to existing admitted pages, not a second admission catalog.
// A missing binding is deliberately unavailable; it must never fall back to US data.
const FAMILY_ROUTES: Record<Family, Partial<Record<WorkspaceMarket, string>>> = {
  macro: { us: "/macro.html", cn: "/china.html", hk: "/hk.html", ca: "/canada.html", intl: "/intl.html" },
  prophet: { us: "/us_stocks.html", cn: "/china_stocks.html", hk: "/hk_stocks.html", ca: "/canada_stocks.html", intl: "/intl_stocks.html" },
  cycles: { us: "/sector_cycles.html", cn: "/sector_cycles_china.html" },
  sectors: { us: "/sector_central.html", cn: "/sector_central_china.html" },
};
const NATIVE_MARKET_WORKSPACES = new Set(["/today", "/intelligence", "/sectors", "/discover", "/prophet", "/dislocations"]);
// These surfaces have an explicit instrument, account, or document scope. Changing
// research context must not filter a portfolio or relabel an already selected issuer.
const INDEPENDENT_SCOPES = new Set(["/analysis", "/portfolio", "/monitor", "/research", "/alerts", "/scripts", "/options", "/terminal"]);
function hasIndependentScope(path: string): boolean {
  return INDEPENDENT_SCOPES.has(path) || path.startsWith("/options/")
    || ["/stock.html", "/china_lookup.html", "/hk_lookup.html", "/canada_stock.html", "/intl_stock.html", "/watchlist.html"].includes(path)
    || path.startsWith("/stocks/") || path.startsWith("/research/") || path.startsWith("/reports/");
}

function routeBinding(path: string): { family: Family; market: WorkspaceMarket } | null {
  for (const [family, markets] of Object.entries(FAMILY_ROUTES)) {
    for (const [market, href] of Object.entries(markets)) {
      if (path === href) return { family: family as Family, market: market as WorkspaceMarket };
    }
  }
  return null;
}

export function workspaceMarketFamily(path: string): Family | null {
  return routeBinding(path)?.family ?? null;
}

export function isWorkspaceMarket(value: unknown): value is WorkspaceMarket {
  return isMarketId(value) && value !== "crypto";
}

export function workspaceMarket(path: string, search = ""): WorkspaceMarket | null {
  const values = new URLSearchParams(search).getAll("workspaceMarket");
  if (values.length) return values.length === 1 && isWorkspaceMarket(values[0]) ? values[0] : null;
  return routeBinding(path)?.market ?? (NATIVE_MARKET_WORKSPACES.has(path) ? "us" : null);
}

export function hasWorkspaceMarketCoverage(path: string, search = ""): boolean {
  const params = new URLSearchParams(search);
  const market = workspaceMarket(path, search);
  if (params.has("workspaceMarket") && !market) return false;
  if (hasIndependentScope(path)) return true;
  const binding = routeBinding(path);
  if (binding) return binding.market === market;
  if (NATIVE_MARKET_WORKSPACES.has(path)) return market === "us";
  // Unqualified legacy/deep pages keep their original semantics until selected.
  // Explicit context requires an actual binding, even for the US.
  return !params.has("workspaceMarket");
}

function queryKey(field: string): string {
  try { return decodeURIComponent(field.split("=", 1)[0].replace(/\+/g, " ")); }
  catch { return field; }
}
function retainQuery(search: string, keep: (key: string) => boolean): string {
  if (!search) return search;
  const fields = search.replace(/^\?/, "").split("&").filter(field => keep(queryKey(field)));
  return fields.length ? `?${fields.join("&")}` : "";
}

/** Only the shell's reserved field is removed. Legacy parsers own raw query
 * bytes (Intl's pins=JP,KR must not become pins=JP%2CKR). */
export function workspaceDocumentHref(href: string): string {
  const url = new URL(href, "https://shell.invalid");
  return `${url.pathname}${retainQuery(url.search, key => key !== "workspaceMarket")}${url.hash}`;
}

/** Only known relative app destinations are decorated; external links stay intact. */
export function marketNavigationHref(href: string, market: WorkspaceMarket | null): string {
  if (!market || !href.startsWith("/") || href.startsWith("//")) return href;
  const url = new URL(href, "https://shell.invalid");
  const binding = routeBinding(url.pathname);
  const destination = binding && FAMILY_ROUTES[binding.family][market];
  if (destination) {
    url.pathname = destination;
    // The bound pathname already identifies its engine. Do not send a shell
    // field to legacy reducers, some of which reject every unknown query key.
    return workspaceDocumentHref(`${url.pathname}${url.search}${url.hash}`);
  }
  const search = retainQuery(url.search, key => key !== "workspaceMarket");
  url.search = `${search}${search ? "&" : "?"}workspaceMarket=${market}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Explicit regional links keep their own country. Native and instrument links
 * inherit browsing context after the incumbent catalog has admitted the target. */
export function inheritWorkspaceMarketHref(href: string, market: WorkspaceMarket | null): string {
  if (!market || !href.startsWith("/") || href.startsWith("//")) return href;
  const url = new URL(href, "https://shell.invalid");
  if (url.searchParams.has("workspaceMarket") || routeBinding(url.pathname)) return href;
  if (!NATIVE_MARKET_WORKSPACES.has(url.pathname) && !hasIndependentScope(url.pathname)) return href;
  return marketNavigationHref(href, market);
}

/** A deliberate market switch preserves the task and compatible view parameters.
 * Source-specific subjects/anchors cannot be carried to a different universe. */
export function switchWorkspaceMarket(href: string, market: WorkspaceMarket): string {
  const url = new URL(href, "https://shell.invalid");
  const previous = workspaceMarket(url.pathname, url.search);
  if (previous !== market && (routeBinding(url.pathname) || NATIVE_MARKET_WORKSPACES.has(url.pathname))) {
    const compatible = new Set(["tab", "view", "sectorJob", "window", "timeframe", "period",
      "sectorWorkspace", "sectorView", "sectorDiscoveryMode", "sectorMatrixTimeframe", "sectorBreadthWindow"]);
    url.search = retainQuery(url.search, key => compatible.has(key));
    url.hash = "";
  }
  return marketNavigationHref(`${url.pathname}${url.search}${url.hash}`, market);
}

export function marketOverviewHref(market: WorkspaceMarket): string {
  return marketNavigationHref(FAMILY_ROUTES.macro[market]!, market);
}
