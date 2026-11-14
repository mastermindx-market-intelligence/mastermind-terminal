/** Read-only consumer. Missing, stale and malformed publications stay quiet. */
export const PROPHET_TROUGH_READ_ENABLED = process.env.NEXT_PUBLIC_PROPHET_TROUGH_READ_ENABLED === "1";
export const PROPHET_TROUGH_READ_URL = "/data/prophet/trough_read.json";
export const TROUGH_TIMEFRAMES = ["1D", "3D", "1W", "2W"] as const;
export type TroughTimeframe = typeof TROUGH_TIMEFRAMES[number];
export type TroughKind = "steady" | "leans_steady" | "middle" | "leans_cyclical" | "cyclical";
export type TroughGroupState = "FALLING" | "WASHED_OUT" | "BASING" | "TURNING" | "NOT_WASHED_OUT";
export type TroughFrame = { tf: TroughTimeframe; bar_end: string | null; washed_out: boolean | null; turned_up: boolean | null; available: boolean };
export type TroughRow = {
  as_of: string;
  timeframes: TroughFrame[];
  kind: { label: TroughKind; position: number } | null;
  own_history: { tf: TroughTimeframe; current_depth_pct: number | null; past: { date: string; depth_pct: number }[]; comparison: "shallower" | "about_usual" | "deeper" | null } | null;
  group: { group_id: string; name: string; state: TroughGroupState | null; fields: null } | null;
  provenance: "shared_with_group" | "own" | null;
};
export type ProphetTroughRead = { status: "unavailable" } | { status: "ready"; data: {
  schema: "prophet.trough_read/v1"; as_of: string; built_at: string; status: "ok"; tickers: Record<string, TroughRow>;
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
const tf = (v: unknown): v is TroughTimeframe => TROUGH_TIMEFRAMES.includes(v as TroughTimeframe);
function row(v: unknown, asOf: string): v is TroughRow {
  if (!object(v) || !day(v.as_of) || v.as_of > asOf || !Array.isArray(v.timeframes) || v.timeframes.length !== 4) return false;
  if (!v.timeframes.every((f, i) => object(f) && f.tf === TROUGH_TIMEFRAMES[i]
    && (f.bar_end === null || day(f.bar_end) && f.bar_end <= (v.as_of as string))
    && boolOrNull(f.washed_out) && boolOrNull(f.turned_up) && typeof f.available === "boolean")) return false;
  if (v.kind !== null && (!object(v.kind) || !["steady", "leans_steady", "middle", "leans_cyclical", "cyclical"].includes(String(v.kind.label))
    || !finite(v.kind.position) || v.kind.position < 0 || v.kind.position > 1)) return false;
  if (v.own_history !== null) {
    const h = v.own_history;
    if (!object(h) || !tf(h.tf) || !(h.current_depth_pct === null || finite(h.current_depth_pct))
      || !(h.comparison === null || ["shallower", "about_usual", "deeper"].includes(String(h.comparison)))
      || !Array.isArray(h.past) || !h.past.every(p => object(p) && day(p.date) && p.date <= (v.as_of as string) && finite(p.depth_pct))) return false;
  }
  if (v.group !== null && (!object(v.group) || !text(v.group.group_id) || !text(v.group.name) || v.group.fields !== null
    || !(v.group.state === null || ["FALLING", "WASHED_OUT", "BASING", "TURNING", "NOT_WASHED_OUT"].includes(String(v.group.state))))) return false;
  return v.provenance === null || v.provenance === "shared_with_group" || v.provenance === "own";
}
export function parseProphetTroughRead(value: unknown): ProphetTroughRead {
  if (!object(value) || value.schema !== "prophet.trough_read/v1" || value.status !== "ok" || !day(value.as_of)
    || typeof value.built_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value.built_at) || !Number.isFinite(Date.parse(value.built_at))
    || !object(value.tickers)) return TROUGH_READ_UNAVAILABLE;
  const tickers: Record<string, TroughRow> = Object.create(null);
  for (const [ticker, candidate] of Object.entries(value.tickers)) {
    if (!/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/.test(ticker) || !row(candidate, value.as_of)) return TROUGH_READ_UNAVAILABLE;
    tickers[ticker] = candidate;
  }
  return { status: "ready", data: { schema: "prophet.trough_read/v1", as_of: value.as_of, built_at: value.built_at, status: "ok", tickers } };
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
  const { n, k } = troughCounts(row);
  return n === 0 ? "notWashed" : k > 0 ? "turning" : "notTurned";
}
