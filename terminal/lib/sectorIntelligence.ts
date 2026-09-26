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
/** Exact read-only owner envelopes, qualified against Macro's published source files.
 * Never recursively discover a look-alike record inside rankings, metadata or a basket.
 * This is a consumer boundary, not a dossier/schema producer or authority manifest.
 */
export function readableOwnerEnvelope(source: SectorFeed, data: unknown): boolean {
  const root = object(data);
  const bounded = (value: unknown) => Array.isArray(value) && value.length <= 10_000;
  if (source === "sector") return bounded(root.sectors);
  if (source === "confluence") return root.ok === true && bounded(root.subsectors) && bounded(root.sectors);
  if (source === "themes") return root.schema === "neuralweb.theme_state.v1" && bounded(root.themes);
  return root.size_basis === "marketcap" && bounded(root.tiles) && root.n_tiles === (root.tiles as unknown[]).length;
}
function uniqueRows(found: Row[], key: string): Row[] {
  const ids = found.map(r => text(r[key]));
  return ids.every(Boolean) && new Set(ids).size === ids.length ? found : [];
}
function ownerRows(value: unknown, match: (row: Row) => boolean, key: string): Row[] {
  if (!Array.isArray(value) || value.length > 10_000) return [];
  const found = value.map(object);
  // A malformed row does not silently shrink the population or change its rank/order.
  return found.every(match) ? uniqueRows(found, key) : [];
}
const SYMBOL = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/;
const KEY = /^[a-z][a-z0-9_-]{0,79}$/;
export function sectorRows(data: unknown): Row[] {
  if (!readableOwnerEnvelope("sector", data)) return [];
  return ownerRows(object(data).sectors, r => KEY.test(text(r.id)) && SYMBOL.test(text(r.ticker))
    && !!text(r.name) && (r.kind === undefined || r.kind === "sector"), "id");
}
export function groupRows(data: unknown): Row[] {
  if (!readableOwnerEnvelope("confluence", data)) return [];
  const root = object(data);
  return ownerRows([...(root.subsectors as unknown[]), ...(root.sectors as unknown[])],
    r => KEY.test(text(r.key)) && !!text(r.label) && Array.isArray(r.members), "key");
}
export function themeRows(data: unknown): Row[] {
  if (!readableOwnerEnvelope("themes", data)) return [];
  return ownerRows(object(data).themes, r => KEY.test(text(r.theme_id)) && !!text(r.name_en), "theme_id");
}
export function themeEntryReady(row: Row): boolean | null {
  const value = object(row.foresight).entry_ready;
  return typeof value === "boolean" ? value : null;
}
export function themeStaleLegs(data: unknown): string[] {
  const legs = object(data).stale_legs;
  return Array.isArray(legs) ? legs.filter((leg): leg is string => typeof leg === "string") : [];
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
  if (!sectorName || !readableOwnerEnvelope("heatmap", data)) return null;
  const root = object(data), raw = (root.tiles as unknown[]).map(object);
  if (raw.some(row => !SYMBOL.test(text(row.t)) || !text(row.sector))
    || uniqueRows(raw, "t").length !== raw.length) return null;
  const tiles = raw.filter(row => row.sector === sectorName);
  // Heatmap t is its documented ticker field. Missing cap sizes invalidate the
  // whole selected denominator; dropping them would invent a complete cohort.
  if (tiles.length < 5 || tiles.some(row => number(row.size) === null || number(row.size)! <= 0)) return null;
  const total = tiles.reduce((sum, row) => sum + number(row.size)!, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const top = [...tiles].sort((a, b) => number(b.size)! - number(a.size)!).slice(0, 5);
  return { share: top.reduce((sum, row) => sum + number(row.size)!, 0) / total,
    count: tiles.length, names: top.map(row => text(row.t)) };
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
