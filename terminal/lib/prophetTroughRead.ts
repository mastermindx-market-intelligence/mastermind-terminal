/** Read-only consumer. Missing, stale and malformed publications stay quiet. */
export const PROPHET_TROUGH_READ_ENABLED = process.env.NEXT_PUBLIC_PROPHET_TROUGH_READ_ENABLED === "1";
export const PROPHET_TROUGH_READ_URL = "/api/prophet/trough-read";
export const TROUGH_TIMEFRAMES = ["1D", "3D", "1W", "2W"] as const;
export type TroughTimeframe = typeof TROUGH_TIMEFRAMES[number];
export type TroughKind = "steady" | "leans_steady" | "middle" | "leans_cyclical" | "cyclical";
export type TroughGroupState = "FALLING" | "WASHED_OUT" | "BASING" | "TURNING" | "NOT_WASHED_OUT";
export type TroughFrame = { tf: TroughTimeframe; bar_end: string | null; washed_out: boolean | null; turned_up: boolean | null; available: boolean; d: number | null; components: { K_gt_D: boolean | null; K_rising: boolean | null; D_rising: boolean | null; hist_rising: boolean | null } };
export type TroughRow = {
  as_of: string;
  timeframes: TroughFrame[];
  kind: { label: TroughKind; position: number } | null;
  own_history: { tf: "3D"; depth_atrc: number; own_history_pct: number; n_prior: number; past: { date: string; depth_atrc: number }[] } | null;
  group: { group_id: string; name: string; state: TroughGroupState | null; fields: null } | null;
  provenance: "shared_with_group" | "own" | null;
};
export type ProphetTroughRead = { status: "unavailable" } | { status: "ready"; data: {
  schema: "prophet.trough_read/v1"; as_of: string; built_at: string; known_ts: string; engine_ref: string; status: "ok"; tickers: Record<string, TroughRow>;
} };
export const TROUGH_READ_UNAVAILABLE: ProphetTroughRead = Object.freeze({ status: "unavailable" });
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
const boolOrNull = (v: unknown) => v === null || typeof v === "boolean";
function day(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const utc = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v) && day(v.slice(0, 10)) && Number.isFinite(Date.parse(v));
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).sort().join("|") === [...expected].sort().join("|");
function row(v: unknown, asOf: string): v is TroughRow {
  if (!object(v) || !keys(v, ["as_of", "timeframes", "kind", "own_history", "group", "provenance"]) || !day(v.as_of) || v.as_of > asOf || !Array.isArray(v.timeframes) || v.timeframes.length !== 4) return false;
  if (!v.timeframes.every((f, i) => object(f) && keys(f, ["tf", "bar_end", "washed_out", "turned_up", "available", "d", "components"]) && f.tf === TROUGH_TIMEFRAMES[i]
    && (f.bar_end === null || day(f.bar_end) && f.bar_end <= (v.as_of as string))
    && boolOrNull(f.washed_out) && (f.tf === "3D" ? boolOrNull(f.turned_up) : f.turned_up === null) && typeof f.available === "boolean"
    && (f.d === null || finite(f.d)) && object(f.components)
    && keys(f.components, ["K_gt_D", "K_rising", "D_rising", "hist_rising"]) && Object.values(f.components).every(boolOrNull))) return false;
  if (v.kind !== null && (!object(v.kind) || !keys(v.kind, ["label", "position"]) || !["steady", "leans_steady", "middle", "leans_cyclical", "cyclical"].includes(String(v.kind.label))
    || !finite(v.kind.position) || v.kind.position < 0 || v.kind.position > 1)) return false;
  if (v.own_history !== null) {
    const h = v.own_history;
    if (!object(h) || !keys(h, ["tf", "depth_atrc", "own_history_pct", "n_prior", "past"]) || h.tf !== "3D" || !finite(h.depth_atrc) || h.depth_atrc < 0
      || !finite(h.own_history_pct) || h.own_history_pct < 0 || h.own_history_pct > 1
      || !Number.isInteger(h.n_prior) || (h.n_prior as number) < 3
      || !Array.isArray(h.past) || h.past.length !== h.n_prior
      || !h.past.every(p => object(p) && keys(p, ["date", "depth_atrc"]) && day(p.date) && p.date < (v.as_of as string) && finite(p.depth_atrc) && p.depth_atrc >= 0)) return false;
  }
  if (v.group !== null && (!object(v.group) || !keys(v.group, ["group_id", "name", "state", "fields"]) || !text(v.group.group_id) || !text(v.group.name) || v.group.fields !== null
    || !(v.group.state === null || ["FALLING", "WASHED_OUT", "BASING", "TURNING", "NOT_WASHED_OUT"].includes(String(v.group.state))))) return false;
  return v.provenance === null || v.provenance === "shared_with_group" || v.provenance === "own";
}
export function parseProphetTroughRead(value: unknown): ProphetTroughRead {
  if (!object(value) || !keys(value, ["schema", "as_of", "built_at", "known_ts", "engine_ref", "status", "tickers"]) || value.schema !== "prophet.trough_read/v1" || value.status !== "ok" || !day(value.as_of)
    || !utc(value.built_at) || !utc(value.known_ts) || !text(value.engine_ref)
    || !object(value.tickers)) return TROUGH_READ_UNAVAILABLE;
  const tickers: Record<string, TroughRow> = Object.create(null);
  for (const [ticker, candidate] of Object.entries(value.tickers)) {
    if (!/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/.test(ticker) || !row(candidate, value.as_of)) return TROUGH_READ_UNAVAILABLE;
    tickers[ticker] = candidate;
  }
  return { status: "ready", data: { schema: "prophet.trough_read/v1", as_of: value.as_of, built_at: value.built_at, known_ts: value.known_ts, engine_ref: value.engine_ref, status: "ok", tickers } };
}
/** Single fixed same-origin transport seam; never synthesizes a missing publication. */
export async function fetchProphetTroughRead(signal?: AbortSignal): Promise<ProphetTroughRead> {
  try {
    const response = await fetch(PROPHET_TROUGH_READ_URL, { cache: "no-store", signal });
    if (!response.ok) return TROUGH_READ_UNAVAILABLE;
    return parseProphetTroughRead(await response.json());
  } catch { return TROUGH_READ_UNAVAILABLE; }
}
export function companyTroughRead(read: ProphetTroughRead, ticker: string): TroughRow | null {
  return read.status === "ready" && Object.hasOwn(read.data.tickers, ticker.toUpperCase()) ? read.data.tickers[ticker.toUpperCase()] : null;
}
/** Only available completed bars can contribute. No weighting or stock-kind inference. */
export function troughCounts(row: TroughRow) {
  const washed = row.timeframes.filter(f => f.available && f.bar_end !== null && f.washed_out === true);
  return { n: washed.length, k: washed.filter(f => f.turned_up === true).length };
}
export function troughSuffix(row: TroughRow): "notWashed" | "turning" | "notTurned" {
  const { n } = troughCounts(row);
  const threeDay = row.timeframes.find(f => f.tf === "3D");
  return n === 0 ? "notWashed" : threeDay?.available && threeDay.bar_end !== null && threeDay.turned_up === true ? "turning" : "notTurned";
}
