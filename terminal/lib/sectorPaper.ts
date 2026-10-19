import { number, object, parseSectorState, sectorMeasuredRead, sectorRotationHistory, text, type FeedMap, type MeasuredGroup, type SectorState } from "./sectorIntelligence";

/** Paper R2 presentation only. The owner keeps ranking, membership and entry authority. */
export type PaperSectorRoute = "brief" | "explore" | "research" | "watches";
export type PaperSectorLens = "rotation" | "market-map" | "breadth" | "confluence" | "themes";
export type PaperRotationMeasure = "native-wealth" | "relative-performance";
export const PAPER_SECTOR_ROUTES: readonly PaperSectorRoute[] = ["brief", "explore", "research", "watches"];
export const PAPER_SECTOR_LENSES: readonly PaperSectorLens[] = ["rotation", "market-map", "breadth", "confluence", "themes"];

export type BriefState = "loading" | "access" | "error" | "unavailable" | "invalid" | "ready";
export interface PaperSectorBriefModel {
  state: BriefState;
  asOf: string | null;
  benchmark: string | null;
  expected: number | null;
  measured: number | null;
  partial: boolean;
  stale: boolean;
  leader: MeasuredGroup | null;
  priorities: MeasuredGroup[];
  unmeasured: MeasuredGroup[];
}
const count = (value: unknown) => {
  const n = number(value);
  return n !== null && n >= 0 && Number.isInteger(n) ? n : null;
};

/** Never ranks an unmeasured row, derives stock entry, or replaces a failed feed with empty success. */
export function paperSectorBrief(feeds: FeedMap): PaperSectorBriefModel {
  const source = feeds.sector;
  const empty = (state: BriefState): PaperSectorBriefModel => ({
    state, asOf: source?.receipt.asOf ?? null, benchmark: null, expected: null, measured: null,
    partial: false, stale: source?.receipt.stale === true,
    leader: null, priorities: [], unmeasured: [],
  });
  if (!source || source.receipt.status === "loading") return empty("loading");
  if (source.receipt.status !== "ready") return empty(source.receipt.status);
  const read = sectorMeasuredRead(source.data);
  if (read.state === "absent" || read.state === "outage") return empty("unavailable");
  if (read.state !== "ok") return empty("invalid");
  // The display adapter omits these fields. Qualify their original meaning here.
  const raw = object(object(source.data).measured_read), generation = object(raw.generation), cohort = object(raw.cohort);
  if (raw.schema !== "leadership_rotation_context.measured_group_read/v1"
    || raw.definition_id !== "leadership_rotation_context/1"
    || generation.cohort_id !== "us_sectors_11" || generation.benchmark !== "SPY"
    || generation.price_basis !== "total_return" || cohort.horizon !== "rs_63d"
    || cohort.window_sessions !== 63 || cohort.expected_n !== 11 || !Array.isArray(raw.groups)
    || raw.groups.some(value => {
      const row = object(value), current = object(row.current);
      return row.group_kind !== "sector" || current.metric !== "relative_wealth_pct" || current.units !== "pct"
        || !["measured", "unmeasured"].includes(text(current.status))
        || (current.status === "measured" && (number(current.rs_63d) === null
          || (current.rs_21d !== null && current.rs_21d !== undefined && number(current.rs_21d) === null)));
    })) return empty("invalid");
  const expected = count(read.expectedN), measured = count(read.measuredN);
  const ids = [...read.ranked, ...read.unmeasured].map(row => row.groupId);
  const ranks = read.ranked.map(row => row.rank);
  if (!day(read.sessionEnd) || !read.benchmark || expected === null || measured === null
    || measured > expected || measured !== read.ranked.length
    || ids.length !== expected || new Set(ids).size !== ids.length || ids.some(id => !id)
    || ranks.some(rank => rank === null || !Number.isInteger(rank) || rank < 1 || rank > measured)
    || new Set(ranks).size !== ranks.length
    || read.ranked.some(row => row.rs63d === null)
    || (source.receipt.asOf !== null && source.receipt.asOf !== read.sessionEnd)) return empty("invalid");
  return {
    state: "ready", asOf: read.sessionEnd, benchmark: read.benchmark, expected, measured,
    partial: measured < expected, stale: source.receipt.stale,
    leader: read.ranked[0] ?? null, priorities: read.ranked.slice(0, 3), unmeasured: read.unmeasured,
  };
}

export interface PaperReturnPoint { session: string; groupReturn: number | null; benchmarkReturn: number | null }
export interface PaperReturnSeries {
  definition: "cumulative_total_return_from_common_start";
  unit: "fraction";
  groupId: string;
  benchmark: string;
  currency: string;
  startSession: string;
  endSession: string;
  sourceId: string;
  membershipRevision: string | null;
  points: PaperReturnPoint[];
}
const day = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
};
function leg(value: unknown): number | null | undefined {
  if (value === null) return null;
  const n = number(value);
  return n !== null && n >= -1 ? n : undefined;
}

/** The Paper two-line return chart cannot consume native rotation scores or rolling wealth ratios. */
export function qualifyPaperReturnSeries(input: unknown): PaperReturnSeries | null {
  const value = object(input);
  if (value.definition !== "cumulative_total_return_from_common_start" || value.unit !== "fraction"
    || !text(value.groupId) || !text(value.benchmark) || !text(value.currency) || !text(value.sourceId)
    || !day(value.startSession) || !day(value.endSession)
    || !Array.isArray(value.points) || value.points.length < 2 || value.points.length > 253
    || (value.membershipRevision !== null && typeof value.membershipRevision !== "string")) return null;
  const points: PaperReturnPoint[] = [];
  for (const item of value.points) {
    const row = object(item), session = day(row.session);
    const groupReturn = leg(row.groupReturn), benchmarkReturn = leg(row.benchmarkReturn);
    if (!session || groupReturn === undefined || benchmarkReturn === undefined
      || (points.length > 0 && session <= points[points.length - 1].session)) return null;
    points.push({ session, groupReturn, benchmarkReturn });
  }
  if (points[0].session !== value.startSession || points[points.length - 1].session !== value.endSession
    || points[0].groupReturn !== 0 || points[0].benchmarkReturn !== 0) return null;
  return {
    definition: value.definition, unit: value.unit, groupId: text(value.groupId),
    benchmark: text(value.benchmark), currency: text(value.currency),
    startSession: text(value.startSession), endSession: text(value.endSession),
    sourceId: text(value.sourceId), membershipRevision: value.membershipRevision as string | null, points,
  };
}

/** Preserve the native destination and all unrelated query keys. The shared route owner applies this patch. */
export function paperSectorState(params: URLSearchParams): { route: PaperSectorRoute; lens: PaperSectorLens } {
  const route = params.get("sectorPaperRoute") as PaperSectorRoute;
  const lens = params.get("sectorPaperLens") as PaperSectorLens;
  return {
    route: PAPER_SECTOR_ROUTES.includes(route) ? route : "brief",
    lens: PAPER_SECTOR_LENSES.includes(lens) ? lens : "rotation",
  };
}
export function writePaperSectorState(url: URL, state: { route: PaperSectorRoute; lens: PaperSectorLens }): string {
  url.searchParams.set("sectorPaperRoute", state.route);
  url.searchParams.set("sectorPaperLens", state.lens);
  return url.pathname + url.search + url.hash;
}

export interface PaperSectorNavigation { route: PaperSectorRoute; lens: PaperSectorLens }
export function paperWorkspaceForLens(lens: PaperSectorLens): "rotation" | "discover" | "breadth" {
  return lens === "rotation" ? "rotation" : lens === "breadth" ? "breadth" : "discover";
}
/** Existing sector bookmarks keep their destination; a fresh sector visit starts at Brief. */
export function resolvePaperSectorState(params: URLSearchParams, native: SectorState): PaperSectorNavigation {
  if (params.has("sectorPaperRoute")) return paperSectorState(params);
  const legacy = ["sectorWorkspace", "sectorView", "sector", "group", "sectorCompany", "sectorQuery"].some(key => params.has(key));
  return legacy ? { route: "explore", lens: native.workspace === "breadth" ? "breadth" : native.workspace === "discover" ? "market-map" : "rotation" }
    : paperSectorState(params);
}

/** One URL owner: an Explore lens selects the matching native instrument except inside a dossier. */
export function normalizePaperSectorNative(native: SectorState, paper: PaperSectorNavigation): SectorState {
  if (paper.route !== "explore" || native.workspace === "detail") return native;
  const workspace = paperWorkspaceForLens(paper.lens);
  return native.workspace === workspace ? native : { ...native, workspace };
}

export const PAPER_SECTOR_RETURN_KEY = "mmxSectorPaperReturnV1";
/** Read only this history entry's same-origin, non-dossier return target. */
export function paperSectorReturnContext(value: unknown, origin: string): { native: SectorState; paper: PaperSectorNavigation } | null {
  const record = object(value);
  if (record.version !== 1 || typeof record.href !== "string" || record.href.length > 8192) return null;
  try {
    const url = new URL(record.href, origin);
    if (url.origin !== new URL(origin).origin || url.pathname !== "/discover" || url.searchParams.get("tab") !== "sectors") return null;
    const parsed = parseSectorState(url.searchParams), paper = resolvePaperSectorState(url.searchParams, parsed);
    const native = normalizePaperSectorNative(parsed, paper);
    if (paper.route === "explore" && native.workspace === "detail") return null;
    return { native, paper };
  } catch { return null; }
}

export interface PaperLeadershipSeries {
  definition: "sector_relative_wealth_history";
  unit: "percent";
  groupId: string;
  benchmark: "SPY";
  startSession: string;
  endSession: string;
  sourceAsOf: string;
  sourceId: string;
  sourceVersion: string;
  stale: boolean;
  reconstructed: true;
  points: { session: string; short: number; long: number }[];
}
/** Reuse the existing owner parser and ID/ticker identity; never relabel this as absolute returns. */
export function paperLeadershipHistory(feeds: FeedMap, groupId: string, sectorAsOf: string, benchmark: string): PaperLeadershipSeries | null {
  const feed=feeds.history;
  if(feed?.receipt.status!=="ready" || !feed.receipt.contentHash || !feed.receipt.path) return null;
  const history=sectorRotationHistory(feed.data);
  if(!history || history.benchmark!==benchmark || history.asOf>sectorAsOf || feed.receipt.asOf!==history.asOf) return null;
  const matches=Object.values(history.series).filter(row=>row.id===groupId || row.ticker===groupId);
  if(matches.length!==1 || matches[0].points.length<2) return null;
  const points=matches[0].points.map(point=>({session:point.date,short:point.rs21,long:point.rs63}));
  return {definition:"sector_relative_wealth_history",unit:"percent",groupId,benchmark:history.benchmark,
    startSession:points[0].session,endSession:points[points.length-1].session,sourceAsOf:history.asOf,
    sourceId:feed.receipt.path,sourceVersion:feed.receipt.contentHash,stale:feed.receipt.stale,reconstructed:true,points};
}
