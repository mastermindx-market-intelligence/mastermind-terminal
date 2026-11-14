import { parseFundamentalScreen, FUNDAMENTAL_FIELD_IDS, type FundamentalPredicate } from "./fundamentalScan";
import { TECH_SIGNAL_PICKS, TECH_CHIP_IDS, TECH_BARS_MAX, type TechControls } from "./technicalScreenControls";
import { DAILY_FUNCTIONAL_TIMEFRAMES } from "./startTf";
import { TAXONOMY_IDS } from "./classificationScan";
/** Discover presentation lives in the existing account-preference owner.
 * Each named view is one independently merged metadata key: saving one view never
 * re-sends or replaces its siblings. Filters do not own table layout or sort.
 */
export const DISCOVER_CURRENT_KEY = "discover_current_v1";
export const DISCOVER_VIEW_PREFIX = "discover_view_v1_";
export const DISCOVER_LOCAL_KEY = "mm.discoverWorkspace.v1";
export const MAX_DISCOVER_VIEWS = 10;
export const DISCOVER_COLUMNS = [
  "sym", "verdict", "regimeBull", "last", "chg", "overnight", "overnightChg",
  "dv", "mcap", "gics", "vol", "offHi", "offLo", "hi52", "lo52", "vts",
  "wr", "pf", "cagr", "mscRank", "mscNetGex", "mscFlip", "technical",
  "fund:fund.pe_ttm", "fund:fund.gross_margin_fy", "fund:fund.net_margin_fy", "fund:fund.roe_fy", "fund:fund.revenue_growth_fy",
] as const;
export type DiscoverColumn = typeof DISCOVER_COLUMNS[number];
export const DEFAULT_DISCOVER_COLUMNS: DiscoverColumn[] = ["sym", "verdict", "regimeBull", "last", "chg", "dv", "mcap", "gics"];
export type DiscoverView = {
  schema: 1;
  id: string;
  name: string;
  columns: DiscoverColumn[];
  density: "c" | "k";
  sort: { k: string; dir: 1 | -1 };
  filters: Record<string, string | number | boolean | null>;
  search: string;
  showAllMarkets: boolean;
  technical: TechControls | null;
  fundamental: FundamentalPredicate[];
};
export type DiscoverPreferences = { current: DiscoverView | null; views: DiscoverView[]; blocked: boolean };
export const EMPTY_DISCOVER: DiscoverPreferences = { current: null, views: [], blocked: false };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const DISCOVER_VIEW_ID = /^[a-f0-9]{32}$/;
export const discoverViewKey = (id: string) => `${DISCOVER_VIEW_PREFIX}${id}`;
export function normalizeDiscoverColumns(value: unknown): DiscoverColumn[] {
  if (!Array.isArray(value)) return [...DEFAULT_DISCOVER_COLUMNS];
  const cols = [...new Set(value.filter((v): v is DiscoverColumn => typeof v === "string" && (DISCOVER_COLUMNS as readonly string[]).includes(v)))];
  // Identity is always visible and pinned; every data column remains optional.
  return ["sym", ...cols.filter(c => c !== "sym")];
}
export function moveDiscoverColumn(columns: readonly DiscoverColumn[], from: string, to: string): DiscoverColumn[] {
  const out = normalizeDiscoverColumns(columns);
  const a = out.indexOf(from as DiscoverColumn), b = out.indexOf(to as DiscoverColumn);
  if (a <= 0 || b <= 0 || a === b) return out;
  out.splice(b, 0, out.splice(a, 1)[0]);
  return out;
}
export function normalizeDiscoverName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return name && [...name].length <= 40 ? name : null;
}
const enumFilter = (v: unknown, choices: readonly string[]) => typeof v === "string" && choices.includes(v);
const filterValid = (k: string, v: unknown): boolean => {
  if (k === "market") return enumFilter(v, ["all", "us", "cn", "hk", "ca", "intl", "crypto"]);
  if (k === "asset") return enumFilter(v, ["all", "Equities", "Funds", "Crypto", "Indices", "Bonds", "Forex", "Futures"]);
  if (k === "signal") return enumFilter(v, ["any", "buy", "sell", "tracked"]);
  if (k === "w52") return enumFilter(v, ["any", "nearHigh", "within15", "dd30", "nearLow"]);
  if (k === "move") return enumFilter(v, ["any", "up3", "down3", "abs5"]);
  if (["uptrend", "unpriced", "classStale"].includes(k)) return typeof v === "boolean";
  if (["liq", "mcap"].includes(k)) return typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (k === "taxonomy") return v === null || enumFilter(v, TAXONOMY_IDS);
  if (k === "sector") return typeof v === "string" && v.length <= 160;
  if (k === "ccy" || k === "liqCcy") return k === "liqCcy" && v === null || v === "auto" || typeof v === "string" && /^(?:[A-Z]{3,8}|GBp|ZAc)$/.test(v);
  return false;
};
export function parseDiscoverTechnical(value: unknown): TechControls | null {
  if (!object(value) || typeof value.tf !== "string" || !DAILY_FUNCTIONAL_TIMEFRAMES.has(value.tf) ||
      !enumFilter(value.position, ["any", "long", "flat"]) || !enumFilter(value.signal, TECH_SIGNAL_PICKS) ||
      value.barsMax !== 0 && !(TECH_BARS_MAX as readonly unknown[]).includes(value.barsMax) ||
      typeof value.includeUnknown !== "boolean" || !Array.isArray(value.chips) ||
      value.chips.some(c => !(TECH_CHIP_IDS as readonly unknown[]).includes(c))) return null;
  return { tf: value.tf, position: value.position as TechControls["position"], signal: value.signal as TechControls["signal"],
    barsMax: value.barsMax as TechControls["barsMax"], chips: [...new Set(value.chips)] as TechControls["chips"], includeUnknown: value.includeUnknown };
}
export function parseDiscoverView(value: unknown): DiscoverView | null {
  if (!object(value) || value.schema !== 1 || typeof value.id !== "string" ||
      (value.id !== "current" && !DISCOVER_VIEW_ID.test(value.id))) return null;
  const name = normalizeDiscoverName(value.name);
  if (!name || !object(value.filters) || !object(value.sort)) return null;
  const filters: DiscoverView["filters"] = {};
  for (const [k, v] of Object.entries(value.filters)) {
    // Reject an unknown predicate, rather than silently widening a saved screen.
    if (!filterValid(k, v)) return null;
    filters[k] = v as string | number | boolean | null;
  }
  const sortKey = value.sort.k;
  if (typeof sortKey !== "string" || !(DISCOVER_COLUMNS as readonly string[]).includes(sortKey) ||
      ["overnight", "overnightChg", "technical"].includes(sortKey) || ![1, -1].includes(value.sort.dir as number)) return null;
  const technical = value.technical == null ? null : parseDiscoverTechnical(value.technical);
  if (value.technical != null && !technical) return null;
  const fundamentalResult = parseFundamentalScreen(value.fundamental ?? []);
  if (!fundamentalResult.ok || fundamentalResult.value.length > FUNDAMENTAL_FIELD_IDS.length) return null;
  const fundamental = fundamentalResult.value;
  const result: DiscoverView = { schema: 1, id: value.id, name, columns: normalizeDiscoverColumns(value.columns),
    density: value.density === "k" ? "k" : "c", sort: { k: sortKey, dir: value.sort.dir === 1 ? 1 : -1 },
    showAllMarkets: value.showAllMarkets === true, filters, search: typeof value.search === "string" ? value.search.slice(0, 120) : "", technical, fundamental };
  return new TextEncoder().encode(JSON.stringify(result)).byteLength <= 12_000 ? result : null;
}
export function readDiscoverPreferences(meta: unknown): DiscoverPreferences {
  if (!object(meta)) return EMPTY_DISCOVER;
  let blocked = false;
  const currentValue = meta[DISCOVER_CURRENT_KEY];
  if (currentValue != null && !parseDiscoverView(currentValue)) blocked = true;
  const views: DiscoverView[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (!key.startsWith(DISCOVER_VIEW_PREFIX) || !DISCOVER_VIEW_ID.test(key.slice(DISCOVER_VIEW_PREFIX.length)) || value == null) continue;
    const parsed = parseDiscoverView(value);
    if (!parsed || parsed.id !== key.slice(DISCOVER_VIEW_PREFIX.length)) { blocked = true; continue; }
    views.push(parsed);
  }
  return { current: parseDiscoverView(currentValue), views: views.sort((a, b) => a.name.localeCompare(b.name)), blocked };
}
export function discoverMetadata(value: DiscoverPreferences): Record<string, unknown> {
  return { [DISCOVER_CURRENT_KEY]: value.current, ...Object.fromEntries(value.views.map(v => [discoverViewKey(v.id), v])) };
}
export function newDiscoverViewId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, "0")).join("");
}
