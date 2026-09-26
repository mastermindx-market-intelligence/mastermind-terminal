/** Read-only presentation of the existing Sector Central owner feeds.
 * This module neither emits a dossier nor creates rankings/entry permission.
 * Missing numbers stay null. Every feed keeps its own clock and cohort.
 */
export const SECTOR_FEEDS = ["sector", "confluence", "themes", "heatmap"] as const;
export type SectorFeed = typeof SECTOR_FEEDS[number];
export type FeedStatus = "loading" | "ready" | "access" | "unavailable" | "invalid" | "error";
export interface FeedReceipt {
  source: SectorFeed;
  path: string;
  status: FeedStatus;
  asOf: string | null;
  observedAt: string | null;
  stale: boolean;
  contentHash: string | null;
}
export interface FeedPayload { data: unknown; receipt: FeedReceipt }
export type FeedMap = Partial<Record<SectorFeed, FeedPayload>>;
export type Row = Record<string, unknown>;
export const SECTOR_VIEWS = ["intelligence", "dossier", "companies", "themes", "sources"] as const;
export type SectorView = typeof SECTOR_VIEWS[number];
export type MemberSort = "source" | "return" | "relative" | "ticker";
export type SectorState = {
  view: SectorView; sector: string; group: string; sort: MemberSort; query: string; theme: "dark" | "light"; company: string; expanded: boolean;
};
export const DEFAULT_SECTOR_STATE: SectorState = {
  view: "intelligence", sector: "xlk", group: "semiconductors", sort: "source", query: "", theme: "dark", company: "", expanded: false,
};
export function object(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
export const text = (v: unknown): string => typeof v === "string" ? v : "";
export const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
export function sourceDate(data: unknown): string | null {
  const row = object(data);
  // These are source-date aliases, not generated/fetched-time substitutes.
  const value = row.as_of ?? row.asof;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const day = value.slice(0, 10), parsed = new Date(day + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}
/** Bounded structural discovery tolerates owner envelope changes, not field meaning changes.
 * Ambiguous duplicate identities are rejected by uniqueRows rather than first-match-wins.
 */
function rows(data: unknown, match: (row: Row) => boolean): Row[] {
  const found: Row[] = [], stack: Array<[unknown, number]> = [[data, 0]];
  let visited = 0;
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (++visited > 30_000) return [];
    if (Array.isArray(v)) {
      if (depth < 6) for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], depth + 1]);
    } else if (v && typeof v === "object") {
      const r = v as Row;
      if (match(r)) found.push(r);
      else if (depth < 6) for (const k of Object.keys(r).reverse()) stack.push([r[k], depth + 1]);
    }
  }
  return found;
}
function uniqueRows(found: Row[], key: string): Row[] {
  const ids = found.map(r => text(r[key]));
  return ids.every(Boolean) && new Set(ids).size === ids.length ? found : [];
}
const SYMBOL = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/;
const KEY = /^[a-z][a-z0-9_-]{0,79}$/;
export function sectorRows(data: unknown): Row[] {
  return uniqueRows(rows(data, r => KEY.test(text(r.id)) && SYMBOL.test(text(r.ticker))
    && !!text(r.name) && !!r.momentum && !!r.heat), "id");
}
export function groupRows(data: unknown): Row[] {
  return uniqueRows(rows(data, r => KEY.test(text(r.key)) && !!text(r.label)
    && Array.isArray(r.members) && !!r.entry && !!r.regime), "key");
}
export function themeRows(data: unknown): Row[] {
  return uniqueRows(rows(data, r => KEY.test(text(r.theme_id)) && !!text(r.name_en)
    && typeof r.entry_ready === "boolean" && !!text(r.stage)), "theme_id");
}
export function marketContext(data: unknown): Row {
  const root = object(data);
  return object(root.market);
}
export interface SectorMember {
  ticker: string; price: number | null; return20d: number | null; relative: number | null;
  tier: string | null; ticks: number | null; buyable: boolean | null; state: string;
  sourceOrder: number;
}
export function members(group: Row): SectorMember[] {
  if (!Array.isArray(group.members)) return [];
  const list: SectorMember[] = [];
  for (const [sourceOrder, value] of group.members.entries()) {
    const r = object(value), ticker = text(r.ticker);
    // Never fabricate a ticker or silently convert an unverified identifier.
    if (!SYMBOL.test(ticker) || ticker.length > 20) continue;
    list.push({ ticker, price: number(r.price), return20d: number(r.ret_20d), relative: number(r.vs_basket),
      tier: ["T1", "T2", "T3"].includes(text(r.stock_tier)) ? text(r.stock_tier) : null,
      ticks: number(r.stock_ticks), buyable: typeof r.stock_buyable === "boolean" ? r.stock_buyable : null,
      state: text(r.stock_state), sourceOrder });
  }
  return new Set(list.map(r => r.ticker)).size === list.length ? list : [];
}
export function sortMembers(input: readonly SectorMember[], sort: MemberSort, query = ""): SectorMember[] {
  const filtered = input.filter(r => r.ticker.toLowerCase().includes(query.trim().toLowerCase()));
  if (sort === "source") return filtered.sort((a, b) => a.sourceOrder - b.sourceOrder);
  if (sort === "ticker") return filtered.sort((a, b) => a.ticker.localeCompare(b.ticker, "en"));
  const key = sort === "return" ? "return20d" : "relative";
  return filtered.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av === null && bv === null) return a.sourceOrder - b.sourceOrder;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av || a.sourceOrder - b.sourceOrder;
  });
}
export function concentration(data: unknown, sectorName: string): {
  share: number; count: number; names: string[];
} | null {
  if (!sectorName) return null;
  const tiles = uniqueRows(rows(data, r => text(r.sector) === sectorName
    && SYMBOL.test(text(r.ticker)) && number(r.size) !== null), "ticker");
  // Exact source taxonomy only; equal counts never establish a breadth/heatmap join.
  if (tiles.length < 5 || tiles.some(r => number(r.size)! <= 0)) return null;
  const total = tiles.reduce((sum, r) => sum + number(r.size)!, 0);
  const top = [...tiles].sort((a, b) => number(b.size)! - number(a.size)!).slice(0, 5);
  if (!Number.isFinite(total) || total <= 0) return null;
  return { share: top.reduce((sum, r) => sum + number(r.size)!, 0) / total,
    count: tiles.length, names: top.map(r => text(r.ticker)) };
}
export function parseSectorState(params: URLSearchParams): SectorState {
  const view = params.get("sectorView") || "", sector = params.get("sector") || "", group = params.get("group") || "";
  const sort = params.get("sectorSort") || "";
  return {
    view: SECTOR_VIEWS.includes(view as SectorView) ? view as SectorView : "intelligence",
    sector: KEY.test(sector) ? sector : "xlk", group: KEY.test(group) ? group : params.has("group") ? "" : "semiconductors",
    sort: ["source", "return", "relative", "ticker"].includes(sort) ? sort as MemberSort : "source",
    query: (params.get("sectorQuery") || "").slice(0, 40),
    theme: params.get("sectorTheme") === "light" ? "light" : "dark",
    company: SYMBOL.test(params.get("sectorCompany") || "") && (params.get("sectorCompany") || "").length <= 20 ? params.get("sectorCompany")! : "",
    expanded: params.get("sectorExpanded") === "1",
  };
}
export function writeSectorState(url: URL, state: SectorState): string {
  url.searchParams.set("tab", "sectors");
  url.searchParams.set("sectorView", state.view);
  url.searchParams.set("sectorTheme", state.theme);
  if (state.company) url.searchParams.set("sectorCompany", state.company); else url.searchParams.delete("sectorCompany");
  if (state.expanded) url.searchParams.set("sectorExpanded", "1"); else url.searchParams.delete("sectorExpanded");
  url.searchParams.set("sector", state.sector);
  url.searchParams.set("group", state.group);
  url.searchParams.set("sectorSort", state.sort);
  if (state.query) url.searchParams.set("sectorQuery", state.query); else url.searchParams.delete("sectorQuery");
  return url.pathname + url.search + url.hash;
}
export function companyHref(ticker: string): string | null {
  return SYMBOL.test(ticker) && ticker.length <= 20 ? `/analysis?symbol=${encodeURIComponent(ticker)}&page=overview` : null;
}
export function formatValue(value: number | null, digits = 1, suffix = "", signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}
