/**
 * Lane-3 structural admission for lane 7's depth surfaces (COO order 4 + lane 7
 * v1.1 return "Parser exposure for lane 3").
 *
 * `sectorNativeGeneration` already bounds the whole wire (4 MiB, closed depth);
 * what these readers add is FIELD-level structure so a malformed board or watch
 * block renders its honest unavailable state instead of crashing a chart or
 * sorting NaN. Everything accepted is carried verbatim — no derivation, no
 * re-uniting, no score math. Null means unavailable: never a partial read.
 *
 * `flowsFromCarriedBlock` (lib/sectorDepthFlows, lane 7's own reader) needs no
 * admission here — it already validates the closed envelope itself.
 */
import type { ActionBoardData, BottomingWatchData, CallRow, SourceLaneKey, WatchEntry } from "./sectorDepthCalls";
import type { Row } from "./sectorIntelligence";

const SOURCE_LANES: readonly SourceLaneKey[] = ["buy_now", "buy_soon", "on_the_run", "take_profits", "hold", "avoid"];
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 262144;
const strOrNull = (value: unknown): value is string | null => value === null || str(value);
const bool = (value: unknown): value is boolean => typeof value === "boolean";
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const int = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const time = new Date(value + "T00:00:00Z");
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value;
}
function closed(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  if (!record(value)) return false;
  const names = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key))
    && names.every(key => required.includes(key) || optional.includes(key));
}

const CALL_REQUIRED = ["kind", "ticker", "slug", "name", "name_zh", "reco", "label", "label_zh", "score",
  "alloc_rank", "above_trend", "eligible", "durability", "book_wt", "validated", "signal_grade", "clean_entry",
  "clean_quality", "perf_20d_rel", "breadth_pct50", "top_members", "rollover_band", "rollover_band_zh",
  "reco_why_en", "reco_why_zh", "rs_pctile", "flip_distance", "href"] as const;
const CALL_OPTIONAL = ["days", "stat_en", "stat_zh", "emerging", "emergence_href"] as const;

function admitCallRow(value: unknown): CallRow | null {
  if (!closed(value, [...CALL_REQUIRED], [...CALL_OPTIONAL])
    || (value.kind !== "theme" && value.kind !== "sector")
    || !str(value.ticker) || !str(value.slug) || !str(value.name) || !str(value.name_zh)
    || !str(value.reco) || !str(value.label) || !str(value.label_zh) || !str(value.href)
    || !num(value.score) || !num(value.alloc_rank) || !num(value.durability)
    || !bool(value.above_trend) || !bool(value.eligible) || !bool(value.validated) || !bool(value.clean_entry)
    || !num(value.clean_quality) || !num(value.perf_20d_rel) || !num(value.breadth_pct50)
    || !num(value.rs_pctile) || !num(value.flip_distance)
    || !(value.book_wt === null || num(value.book_wt)) || !strOrNull(value.signal_grade)
    || !Array.isArray(value.top_members) || value.top_members.length > 64
    || !value.top_members.every(member => str(member))
    || !str(value.rollover_band) || !str(value.rollover_band_zh)
    || !str(value.reco_why_en) || !str(value.reco_why_zh)
    || (value.days !== undefined && !(value.days === null || num(value.days)))
    || (value.stat_en !== undefined && !(value.stat_en === null || str(value.stat_en)))
    || (value.stat_zh !== undefined && !(value.stat_zh === null || str(value.stat_zh)))
    || (value.emerging !== undefined && !(value.emerging === null || bool(value.emerging)))
    || (value.emergence_href !== undefined && !(value.emergence_href === null || str(value.emergence_href)))) return null;
  return value as unknown as CallRow;
}

/** The owner action board, or null when the bounded payload is not the board. */
export function admitActionBoard(value: Row | null | undefined): ActionBoardData | null {
  if (!record(value)) return null;
  // Hoisted const so the lane-callback below keeps the record() narrowing.
  const rawLanes = value.lanes;
  if (!day(value.as_of) || !int(value.total, 0, 1_000_000) || !int(value.locked, 0, 1_000_000)
    || !record(rawLanes) || Object.keys(rawLanes).length !== SOURCE_LANES.length
    || !SOURCE_LANES.every(lane => Object.hasOwn(rawLanes, lane))) return null;
  const lanes = {} as ActionBoardData["lanes"];
  for (const key of SOURCE_LANES) {
    const lane = rawLanes[key];
    if (!record(lane) || !Array.isArray(lane.rows) || lane.rows.length > 1000
      || !int(lane.total, 0, 1_000_000) || !int(lane.locked, 0, 1_000_000)) return null;
    const rows: CallRow[] = [];
    for (const row of lane.rows) {
      const admitted = admitCallRow(row);
      if (!admitted) return null;
      rows.push(admitted);
    }
    lanes[key] = { rows, total: lane.total, locked: lane.locked };
  }
  return { as_of: value.as_of, total: value.total, locked: value.locked, lanes };
}

const WATCH_ENTRY_KEYS = ["id", "cid", "kind", "name", "name_zh", "pos", "osc_slope", "signal", "timing_state",
  "above200d", "cycle_signal", "gate_conflict", "href"] as const;

/**
 * The carried `bottoming_watch` typed block. Lane 7 confirms the block value
 * matches `BottomingWatchData` field-for-field; this reader enforces that
 * contract structurally (status==="available" is the mount's gate, this is the
 * payload's) so a malformed block still renders unavailable, never a bad strip.
 */
export function admitBottomingWatch(value: unknown): BottomingWatchData | null {
  if (!closed(value, ["bottoming_watch", "dual_read_ids", "recovering_ids", "bottoming_authority"])
    || !Array.isArray(value.bottoming_watch) || value.bottoming_watch.length > 100_000
    || !Array.isArray(value.dual_read_ids) || value.dual_read_ids.length > 100_000
    || !value.dual_read_ids.every(id => str(id))
    || !Array.isArray(value.recovering_ids) || value.recovering_ids.length > 100_000
    || !value.recovering_ids.every(id => str(id))
    || !closed(value.bottoming_authority, ["tier", "may_rank", "may_gate", "may_size", "may_escalate"],
      ["null_disclosure_en", "null_disclosure_zh"])
    || value.bottoming_authority.tier !== "display"
    || value.bottoming_authority.may_rank !== false || value.bottoming_authority.may_gate !== false
    || value.bottoming_authority.may_size !== false || value.bottoming_authority.may_escalate !== false
    || (value.bottoming_authority.null_disclosure_en !== undefined && !strOrNull(value.bottoming_authority.null_disclosure_en))
    || (value.bottoming_authority.null_disclosure_zh !== undefined && !strOrNull(value.bottoming_authority.null_disclosure_zh))) return null;
  const entries: WatchEntry[] = [];
  for (const entry of value.bottoming_watch) {
    if (!closed(entry, [...WATCH_ENTRY_KEYS]) || (entry.kind !== "BASKET" && entry.kind !== "SECTOR")
      || !str(entry.id) || !str(entry.cid) || !str(entry.name) || !str(entry.name_zh) || !str(entry.timing_state)
      || !num(entry.pos) || !num(entry.osc_slope) || !bool(entry.above200d) || !bool(entry.gate_conflict)
      || !strOrNull(entry.signal) || !strOrNull(entry.cycle_signal) || !str(entry.href)) return null;
    entries.push(entry as unknown as WatchEntry);
  }
  return { bottoming_watch: entries, dual_read_ids: value.dual_read_ids as string[],
    recovering_ids: value.recovering_ids as string[],
    bottoming_authority: value.bottoming_authority as unknown as BottomingWatchData["bottoming_authority"] };
}
