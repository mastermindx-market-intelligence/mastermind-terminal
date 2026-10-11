/** Read-only presentation of the existing Sector Central owner feeds.
 * This module neither emits a dossier nor creates rankings/entry permission.
 * Missing numbers stay null. Every feed keeps its own clock and cohort.
 */
export const SECTOR_FEEDS = ["sector", "confluence", "themes", "heatmap", "risk", "history", "events"] as const;

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
  qualificationReasons?: string[];
}
export interface FeedPayload { data: unknown; receipt: FeedReceipt }
export type FeedMap = Partial<Record<SectorFeed, FeedPayload>>;
export type Row = Record<string, unknown>;
export const SECTOR_VIEWS = ["intelligence", "companies", "signals", "drivers", "history"] as const;
export type SectorView = typeof SECTOR_VIEWS[number];
export type MemberSort = "source" | "return" | "relative" | "ticker";
export type SectorWorkspace = "rotation" | "discover" | "breadth" | "detail";
export type SectorDiscoverySort = "source" | "return" | "participation";
export type SectorCompanyTableSort = "source" | "performance" | "marketcap" | "ticker";
export type SectorDiscoveryMode = "summary" | "table" | "heatmap" | "matrix";
export type SectorMatrixTimeframe = "1D" | "1W" | "MTD" | "1M" | "3M" | "6M" | "YTD" | "1Y";
export type SectorCapBand = "mega" | "large" | "mid" | "smaller";
export type SectorRotationMode = "map" | "list";
export type SectorState = {
  view: SectorView; sector: string; group: string; sort: MemberSort; query: string; theme: "dark" | "light"; company: string; expanded: boolean; sourcesOpen: boolean;
  workspace: SectorWorkspace; discoveryQuery: string; discoverySort: SectorDiscoverySort; companyTableQuery: string; companyTableSort: SectorCompanyTableSort;
  discoveryMode: SectorDiscoveryMode; matrixTimeframe: SectorMatrixTimeframe; matrixIndustry: string; matrixBand: SectorCapBand | "";
  rotationMode: SectorRotationMode; rotationQuery: string;
};
export const DEFAULT_SECTOR_STATE: SectorState = {
  view: "intelligence", sector: "xlk", group: "semiconductors", sort: "source", query: "", theme: "dark", company: "", expanded: false, sourcesOpen: false,
  workspace: "discover", discoveryQuery: "", discoverySort: "source", companyTableQuery: "", companyTableSort: "source", discoveryMode: "summary", matrixTimeframe: "1D", matrixIndustry: "", matrixBand: "",
  rotationMode: "map", rotationQuery: "",
};
export function object(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
export const text = (v: unknown): string => typeof v === "string" ? v : "";
export const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

export interface SectorRotationHistoryPoint {
  date: string;
  rs21: number;
  rs63: number;
}
export interface SectorRotationHistoryCycleTurn {
  date: string;
  kind: "peak" | "trough";
  major: boolean;
  provisional: boolean;
  magnitudePct: number | null;
}
export interface SectorRotationHistorySeries {
  id: string;
  ticker: string;
  points: SectorRotationHistoryPoint[];
  /** Price-cycle swing markers, retrospectively reconstructed by the existing owner. Not RC migration episodes. */
  cycleTurns: SectorRotationHistoryCycleTurn[];
}
export interface SectorRotationHistory {
  schema: "sector_cycles.rs_history.v1";
  asOf: string;
  mode: "reconstructed_price_history";
  naturallyObserved: false;
  basis: "tr";
  benchmark: "SPY";
  horizons: readonly [21, 63];
  maxPoints: 252;
  series: Record<string, SectorRotationHistorySeries>;
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function strictDay(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return null;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
export function sectorRotationHistory(data: unknown): SectorRotationHistory | null {
  const root = object(data), meta = object(root.meta), contract = object(meta.rs_history);
  const asOf = strictDay(meta.asOf);
  if (!asOf || contract.schema !== "sector_cycles.rs_history.v1"
    || contract.mode !== "reconstructed_price_history" || contract.naturally_observed !== false
    || contract.basis !== "tr" || contract.benchmark !== "SPY"
    || !Array.isArray(contract.horizons_sessions)
    || contract.horizons_sessions.length !== 2 || contract.horizons_sessions[0] !== 21 || contract.horizons_sessions[1] !== 63
    || contract.max_points_per_sector !== 252
    || !Array.isArray(root.sectors) || root.sectors.length > 100) return null;

  const series: Record<string, SectorRotationHistorySeries> = {};
  for (const value of root.sectors) {
    const row = object(value), id = text(row.id), ticker = text(row.ticker), raw = row.rs_history;
    if (!KEY.test(id) || !SYMBOL.test(ticker) || row.kind !== "sector"
      || !Array.isArray(raw) || raw.length > 252 || Object.hasOwn(series, id)) return null;
    const points: SectorRotationHistoryPoint[] = [];
    let prior = "";
    for (const pointValue of raw) {
      const point = object(pointValue), date = strictDay(point.date), rs21 = number(point.rs_21d), rs63 = number(point.rs_63d);
      if (!date || date > asOf || date <= prior || rs21 === null || rs63 === null) return null;
      prior = date;
      points.push({ date, rs21, rs63 });
    }
    const rawTurns = row.turns === undefined ? [] : row.turns;
    if (!Array.isArray(rawTurns) || rawTurns.length > 256) return null;
    const cycleTurns: SectorRotationHistoryCycleTurn[] = [];
    let previousTurn = "";
    for (const turnValue of rawTurns) {
      const turn = object(turnValue), date = strictDay(turn.date);
      const mag = turn.mag_pct === null || turn.mag_pct === undefined ? null : number(turn.mag_pct);
      if (!date || date > asOf || date <= previousTurn
        || (turn.k !== "peak" && turn.k !== "trough")
        || typeof turn.major !== "boolean" || typeof turn.provisional !== "boolean"
        || (mag !== null && mag < 0) || (turn.mag_pct !== null && turn.mag_pct !== undefined && mag === null)) return null;
      previousTurn = date;
      cycleTurns.push({ date, kind: turn.k, major: turn.major, provisional: turn.provisional, magnitudePct: mag });
    }
    series[id] = { id, ticker, points, cycleTurns };
  }
  return {
    schema: "sector_cycles.rs_history.v1", asOf, mode: "reconstructed_price_history",
    naturallyObserved: false, basis: "tr", benchmark: "SPY", horizons: [21, 63],
    maxPoints: 252, series,
  };
}

export interface NativeRotationClosedEpisode {
  sector: string;
  pairId: string;
  fromKey: string;
  toKey: string;
  fromNameEn: string;
  toNameEn: string;
  fromNameZh: string;
  toNameZh: string;
  started: string;
  closedAsOf: string;
  recordedAt: string;
  reason: string;
  dayN: number;
  provenance: "RECONSTRUCTED_REPLAY" | "RETAINED_LEDGER_UNMARKED";
}
export interface SectorRotationEpisodes {
  sourceAsOf: string;
  generatedUtc: string;
  coldstart: boolean;
  closedRecent: NativeRotationClosedEpisode[];
}
/** Existing RC published closures only. Does not infer active calls, PIT origin or authority. */
export function sectorRotationEpisodes(data: unknown): SectorRotationEpisodes | null {
  const root = object(data), authority = object(root.authority);
  const sourceAsOf = strictDay(root.as_of);
  const generatedUtc = text(root.generated_utc);
  const generated = /^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):[0-5]\d UTC$/.exec(generatedUtc);
  if (root.schema !== "rotation_events.v1" || root.ok !== true || !sourceAsOf
    || !generated || !strictDay(generated[1]) || generated[1] < sourceAsOf
    || root.coldstart !== false && root.coldstart !== true
    || authority.tier !== "display"
    || ["may_rank", "may_gate", "may_size", "may_escalate"].some(flag => authority[flag] !== false)
    || !Array.isArray(root.active) || !Array.isArray(root.created_tonight)
    || !Array.isArray(root.closed_tonight)
    || !Array.isArray(root.closed_recent) || root.closed_recent.length > 128) return null;
  const closedRecent: NativeRotationClosedEpisode[] = [];
  for (const value of root.closed_recent) {
    const row = object(value);
    const sector = text(row.sector), fromKey = text(row.from_leg), toKey = text(row.to_leg);
    const pairId = text(row.pair_id), started = strictDay(row.started), closedAsOf = strictDay(row.closed_asof);
    const recordedAt = text(row.ts);
    const receipt = /^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):[0-5]\d UTC$/.exec(recordedAt);
    const dayN = number(row.day_n);
    const reason = text(row.reason);
    if (row.event !== "closed" || !KEY.test(sector) || !KEY.test(fromKey) || !KEY.test(toKey)
      || pairId !== `${sector}:${fromKey}->${toKey}`
      || !started || !closedAsOf || started > closedAsOf || closedAsOf > sourceAsOf
      || !receipt || !strictDay(receipt[1]) || receipt[1] < closedAsOf || receipt[1] > generated[1]
      || dayN === null || !Number.isInteger(dayN) || dayN < 0
      || !reason || reason.length > 160
      || (row.replayed !== undefined && typeof row.replayed !== "boolean")) return null;
    const field = (name: string, fallback: string) => {
      const value = row[name];
      return value === undefined ? fallback
        : typeof value === "string" && value.length <= 160 ? value : null;
    };
    const fromNameEn = field("from_name_en", fromKey), toNameEn = field("to_name_en", toKey);
    const fromNameZh = field("from_name_zh", fromKey), toNameZh = field("to_name_zh", toKey);
    if (fromNameEn === null || toNameEn === null || fromNameZh === null || toNameZh === null) return null;
    closedRecent.push({
      sector, pairId, fromKey, toKey, fromNameEn, toNameEn, fromNameZh, toNameZh,
      started, closedAsOf, recordedAt, reason, dayN,
      provenance: row.replayed === true ? "RECONSTRUCTED_REPLAY" : "RETAINED_LEDGER_UNMARKED",
    });
  }
  return { sourceAsOf, generatedUtc, coldstart: root.coldstart as boolean, closedRecent };
}
export function sourceDate(data: unknown): string | null {
  const row = object(data), meta = object(row.meta);
  // These are source-date aliases, not generated/fetched-time substitutes.
  const value = row.as_of ?? row.asof ?? meta.asOf;
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
  if (source === "risk") return root.schema === "mastermind.risk_envelope/v1"
    && ["measured_state", "hazard_summary", "policy_summary", "authority"].every(key =>
      root[key] !== null && typeof root[key] === "object" && !Array.isArray(root[key]));
  if (source === "history") return sectorRotationHistory(data) !== null;
  if (source === "events") return sectorRotationEpisodes(data) !== null;

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
  const workspace = params.get("sectorWorkspace"), discoverySort = params.get("sectorDiscoverySort");
  const companyTableSort = params.get("sectorCompanyTableSort");
  const discoveryMode = params.get("sectorDiscoveryMode"), matrixTimeframe = params.get("sectorMatrixTimeframe");
  const matrixBand = params.get("sectorMatrixBand"), rotationMode = params.get("sectorRotationMode");
  const legacyDetail = ["sectorView", "sector", "group", "sectorCompany", "sectorQuery"].some(key => params.has(key));
  return {
    workspace: workspace === "rotation" || workspace === "discover" || workspace === "breadth" || workspace === "detail" ? workspace : legacyDetail ? "detail" : "discover",
    discoveryQuery: (params.get("sectorDiscoveryQuery") || "").slice(0, 60),
    discoverySort: discoverySort === "return" || discoverySort === "participation" ? discoverySort : "source",
    companyTableQuery: (params.get("sectorCompanyTableQuery") || "").slice(0, 60),
    companyTableSort: ["source", "performance", "marketcap", "ticker"].includes(companyTableSort || "") ? companyTableSort as SectorCompanyTableSort : "source",
    discoveryMode: discoveryMode === "table" || discoveryMode === "heatmap" || discoveryMode === "matrix" ? discoveryMode : "summary",
    matrixTimeframe: ["1D", "1W", "MTD", "1M", "3M", "6M", "YTD", "1Y"].includes(matrixTimeframe || "") ? matrixTimeframe as SectorMatrixTimeframe : "1D",
    matrixIndustry: (params.get("sectorMatrixIndustry") || "").slice(0, 120),
    matrixBand: ["mega", "large", "mid", "smaller"].includes(matrixBand || "") ? matrixBand as SectorCapBand : "",
    rotationMode: rotationMode === "list" ? "list" : "map",
    rotationQuery: (params.get("sectorRotationQuery") || "").slice(0, 60),
    // Preserve old study URLs without keeping competing customer destinations.
    view: view === "dossier" ? "signals" : view === "themes" ? "drivers" :
      SECTOR_VIEWS.includes(view as SectorView) ? view as SectorView : "intelligence",
    sourcesOpen: view === "sources" || params.get("sectorSources") === "1",
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
  url.searchParams.set("sectorWorkspace", state.workspace);
  url.searchParams.set("sectorDiscoverySort", state.discoverySort);
  url.searchParams.set("sectorCompanyTableSort", state.companyTableSort);
  if (state.discoveryQuery) url.searchParams.set("sectorDiscoveryQuery", state.discoveryQuery); else url.searchParams.delete("sectorDiscoveryQuery");
  if (state.companyTableQuery) url.searchParams.set("sectorCompanyTableQuery", state.companyTableQuery); else url.searchParams.delete("sectorCompanyTableQuery");
  url.searchParams.set("sectorDiscoveryMode", state.discoveryMode);
  url.searchParams.set("sectorMatrixTimeframe", state.matrixTimeframe);
  if (state.matrixIndustry) url.searchParams.set("sectorMatrixIndustry", state.matrixIndustry); else url.searchParams.delete("sectorMatrixIndustry");
  if (state.matrixBand) url.searchParams.set("sectorMatrixBand", state.matrixBand); else url.searchParams.delete("sectorMatrixBand");
  url.searchParams.set("sectorRotationMode", state.rotationMode);
  if (state.rotationQuery) url.searchParams.set("sectorRotationQuery", state.rotationQuery); else url.searchParams.delete("sectorRotationQuery");
  url.searchParams.set("sectorView", state.view);
  if (state.sourcesOpen) url.searchParams.set("sectorSources", "1"); else url.searchParams.delete("sectorSources");
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
