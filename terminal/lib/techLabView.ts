/**
 * Display projection of Macro's Technical Lab. No signal calculations or forecasts.
 * Legacy firing eligibility follows engine/tech_catalog.py:is_screener_firing:
 * discrete events or directional states, with the catalog's explicit context exclusions.
 * Historical statistics are pooled, direction-adjusted 21-trading-day observations.
 */
export interface LabHistory {
  wins: number | null;
  baseline: number | null;
  lift: number | null;
  observations: number | null;
  months: number | null;
  excursionRatio: number | null;
  pre2010: number | null;
  post2010: number | null;
}
export interface LabSetup {
  id: string;
  name: string;
  family: string;
  direction: -1 | 0 | 1 | null;
  kind: "event" | "state" | null;
  active: boolean | null;
  contextOnly: boolean;
  comparison: boolean;
  inconsistent: boolean;
  fires: string[];
  latestFire: string | null;
  history: LabHistory;
}
export interface LabModel {
  status: "ready" | "missing" | "unbound";
  publishedAt: string | null;
  setups: LabSetup[];
}
export type LabSort = "lift" | "recent" | "history";

// Legacy tech_events omits the catalog's screener_firing flag. Keep its explicit
// exclusions at Macro snapshot 084ac334, plus raw scores, in this display adapter.
const CONTEXT_IDS = new Set([
  "return_1d", "valuation_pctile", "insider_power_state",
  "rs_repair", "rs_deteriorate", "rs_new_high", "rs_new_low",
]);

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const rate = (v: unknown): number | null => {
  const n = finite(v);
  return n !== null && n >= 0 && n <= 1 ? n : null;
};
const count = (v: unknown): number | null => {
  const n = finite(v);
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const direction = (v: unknown): -1 | 0 | 1 | null => v === -1 || v === 0 || v === 1 ? v : null;

/** Reject normalized impossible dates (e.g. February 30), non-dates and timestamps. */
export function labDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const ms = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v ? v : null;
}
function publishedDate(v: unknown): string | null {
  const s = text(v);
  if (!s || !labDate(s.slice(0, 10))) return null;
  if (s.length === 10) return s;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s) && Number.isFinite(Date.parse(s)) ? s : null;
}

export function buildLabModel(sym: string, intel: unknown): LabModel {
  const empty: LabModel = { status: "missing", publishedAt: null, setups: [] };
  const tech = record(record(intel)?.tech);
  const events = record(tech?.events);
  const signals = record(events?.signals);
  if (!tech || !events || !signals) return empty;
  // A previous symbol's async response must never become the current symbol's setup.
  const ticker = text(events.ticker);
  if (!ticker || ticker.toUpperCase() !== sym.trim().toUpperCase()) return { ...empty, status: "unbound" };
  const profiles = record(tech.profiles) ?? {};
  const publishedAt = publishedDate(events.generated_utc) ?? publishedDate(tech.asof);
  const cutoff = publishedAt?.slice(0, 10);
  const setups = Object.entries(signals).map(([id, raw]): LabSetup => {
    const state = record(raw) ?? {};
    const profile = record(profiles[id]) ?? {};
    const stateDirection = direction(state.dir);
    const profileDirection = direction(profile.direction);
    const dir = stateDirection ?? profileDirection;
    const kind = state.kind === "event" || state.kind === "state" ? state.kind : null;
    const directionConflict = stateDirection !== null && profileDirection !== null && stateDirection !== profileDirection;
    const kindConflict = (profile.kind === "event" || profile.kind === "state") && kind !== null && kind !== profile.kind;
    const catalogContext = CONTEXT_IDS.has(id);
    const flag = typeof state.screener_firing === "boolean" ? state.screener_firing : profile.screener_firing;
    const eligible = !catalogContext && (typeof flag === "boolean" ? flag : kind === "event" || (kind === "state" && (dir === 1 || dir === -1)));
    const wins = rate(profile.wr_21d);
    const baseline = rate(profile.base_wr);
    const rawLift = finite(profile.edge_wr);
    const lift = rawLift !== null && rawLift >= -1 && rawLift <= 1 ? rawLift : null;
    const observations = count(profile.n_fires);
    // Source fields are rounded to six decimals; inconsistent supplied comparisons cannot rank.
    const mismatch = wins !== null && baseline !== null && lift !== null && Math.abs(wins - baseline - lift) > 0.000002;
    const inconsistent = directionConflict || kindConflict || mismatch;
    const fires = Array.isArray(state.fires)
      ? [...new Set(state.fires.map(labDate).filter((d): d is string => d !== null && (!cutoff || d <= cutoff)))].sort()
      : [];
    const excursionRatio = finite(profile.mfe_mae_med);
    return {
      id, name: text(profile.display_en) ?? id.replace(/_/g, " "),
      family: text(profile.family) ?? "",
      direction: dir, kind, active: state.state === 1 ? true : state.state === 0 ? false : null,
      contextOnly: !eligible, inconsistent,
      comparison: dir !== null && !inconsistent && observations !== null && observations > 0 && wins !== null && baseline !== null && lift !== null,
      fires, latestFire: fires.at(-1) ?? null,
      history: { wins, baseline, lift, observations, months: count(profile.n_months),
        excursionRatio: excursionRatio !== null && excursionRatio >= 0 ? excursionRatio : null,
        pre2010: rate(profile.wr_pre2010), post2010: rate(profile.wr_post2010) },
    };
  });
  return { status: "ready", publishedAt, setups };
}

export function sortLabSetups(setups: LabSetup[], sort: LabSort): LabSetup[] {
  const descending = (a: number | null, b: number | null) => (b ?? -Infinity) - (a ?? -Infinity);
  return [...setups].sort((a, b) => {
    const compared = Number(b.comparison) - Number(a.comparison);
    if (compared) return compared;
    const latest = (b.latestFire ?? "").localeCompare(a.latestFire ?? "");
    const history = descending(a.history.observations, b.history.observations) || 0;
    const lift = a.comparison && b.comparison ? descending(a.history.lift, b.history.lift) || 0 : 0;
    const primary = sort === "recent" ? latest : sort === "history" ? history : lift;
    return primary || lift || history || latest || a.id.localeCompare(b.id);
  });
}
