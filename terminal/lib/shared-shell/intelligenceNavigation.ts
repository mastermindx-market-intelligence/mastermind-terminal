/** Presentation only. Route admission remains the canonical generated catalog. */
export const INTELLIGENCE_DESTINATIONS = [
  { key: "overview", href: "/intelligence", label: ["Overview", "总览"] },
  { key: "macro", href: "/macro.html", label: ["Macro Dashboard", "宏观仪表盘"] },
  { key: "prophet", href: "/us_stocks.html", label: ["Prophet", "Prophet"] },
  { key: "cycles", href: "/sector_cycles.html", label: ["Sector Cycles", "行业周期"] },
  { key: "sectors", href: "/sectors", label: ["Sector Intelligence", "行业情报"] },
] as const;
export type IntelligenceKey = typeof INTELLIGENCE_DESTINATIONS[number]["key"];
export function intelligenceActiveKey(path: string, search = ""): IntelligenceKey | null {
  if (path === "/intelligence") return "overview";
  if (/^\/macro(?:_[a-z0-9_]+)?\.html$/.test(path)) return "macro";
  // The complete opportunity workspace remains Macro-owned. The native route
  // is its separately entitled model-plan/options desk, not a replacement.
  if (path === "/us_stocks.html" || path === "/prophet" || (path === "/options" && new URLSearchParams(search).get("tab") === "prophet")) return "prophet";
  if (path === "/sector_cycles.html" || path === "/sector_cycles_china.html") return "cycles";
  if (path === "/sectors" || path === "/sector_central.html" || path === "/sector_central_china.html"
    || (path === "/discover" && new URLSearchParams(search).get("tab") === "sectors")) return "sectors";
  return null;
}
