/**
 * sectorDepthCalls.ts — pure reader/model for the native calls board and the
 * display-only Bottoming Watch strip (Sector Intelligence retained depth).
 *
 * Everything here is deterministic and side-effect free: the owner generation
 * (Macro sector generation, `sector_native_view.v1` → projection.data.action_board)
 * is the single data source, and these functions only fold, sort, slice and
 * normalize what it already carries. No value is ever invented: a missing board
 * is the caller's signal to render the shared typed-unavailable state, and a
 * zero-total lane is a measured empty, never an unavailable.
 *
 * Field shapes mirror the REAL captured generation
 * (lib/__tests__/fixtures/sector_generation.captured.preview.v1.json) exactly —
 * including the nullable `signal_grade`/`book_wt` the capture carries, and the
 * optional `days` field the incumbent puts on buy_soon rows only.
 */

/** One qualified row of the owner's action board. Kind distinguishes the
 * theme baskets from the plain sector groups; every other field arrives
 * qualified from the generation and is carried verbatim. */
export interface CallRow {
  kind: "theme" | "sector";
  ticker: string;
  slug: string;
  name: string;
  name_zh: string;
  /** Owner recommendation key (e.g. "hold"); the customer-facing word is `label`. */
  reco: string;
  label: string;
  label_zh: string;
  score: number;
  alloc_rank: number;
  above_trend: boolean;
  eligible: boolean;
  durability: number;
  /** Weight in the qualified book; null when the row carries no book weight. */
  book_wt: number | null;
  validated: boolean;
  signal_grade: string | null;
  clean_entry: boolean;
  clean_quality: number;
  /** 20-session relative performance vs the market, as a fraction. */
  perf_20d_rel: number;
  breadth_pct50: number;
  top_members: string[];
  rollover_band: string;
  rollover_band_zh: string;
  reco_why_en: string;
  reco_why_zh: string;
  rs_pctile: number;
  flip_distance: number;
  /** Detail destination, used EXACTLY as carried (e.g. "basket/test_theme.html"). */
  href: string;
  /** Days-to-trigger, carried by buy_soon rows only. Null/absent sorts last. */
  days?: number | null;
}

/** The six source lanes of the owner board. */
export type SourceLaneKey =
  | "buy_now"
  | "buy_soon"
  | "on_the_run"
  | "take_profits"
  | "hold"
  | "avoid";

/** One source lane: the rows this reading can see, plus the lane's FULL
 * qualified total and locked count (locked rows are withheld from `rows`). */
export interface LaneData {
  rows: CallRow[];
  total: number;
  locked: number;
}

/** The action board exactly as the generation carries it. */
export interface ActionBoardData {
  as_of: string;
  total: number;
  locked: number;
  lanes: Record<SourceLaneKey, LaneData>;
}

/** The five board lanes after the incumbent fold: hold + avoid become the
 * single "Stand aside" column. */
export type BoardLaneKey =
  | "buy_now"
  | "buy_soon"
  | "on_the_run"
  | "take_profits"
  | "stand_aside";

/** Deterministic left-to-right order of the five board columns. */
export const BOARD_LANE_ORDER: readonly BoardLaneKey[] = [
  "buy_now",
  "buy_soon",
  "on_the_run",
  "take_profits",
  "stand_aside",
];

/**
 * The incumbent six-to-five fold: `hold` and `avoid` merge into ONE
 * "Stand aside" column — hold rows first, then avoid rows, both stable in
 * source order; totals and locked counts add. The other four lanes pass
 * through unchanged (same objects, no re-sorting).
 */
export function foldSixToFive(
  lanes: Record<SourceLaneKey, LaneData>,
): Record<BoardLaneKey, LaneData> {
  const hold = lanes.hold;
  const avoid = lanes.avoid;
  return {
    buy_now: lanes.buy_now,
    buy_soon: lanes.buy_soon,
    on_the_run: lanes.on_the_run,
    take_profits: lanes.take_profits,
    stand_aside: {
      rows: [...hold.rows, ...avoid.rows],
      total: hold.total + avoid.total,
      locked: hold.locked + avoid.locked,
    },
  };
}

/** Days-to-trigger sort key: absent/null days are treated as 99 (last),
 * the incumbent's `x.days ?? 99` semantics. */
function daysSortKey(row: CallRow): number {
  return typeof row.days === "number" ? row.days : 99;
}

/**
 * Reader order for one board lane: themes before sectors, stable within each
 * kind (theme rows keep source order, then sector rows keep source order).
 * Additionally, for the buy_soon lane only, rows sort by `days` ascending
 * (null/absent last) within each kind — the incumbent's "almost ready"
 * ordering by time-to-trigger.
 */
export function laneRowsSorted(laneKey: BoardLaneKey, rows: CallRow[]): CallRow[] {
  if (laneKey === "buy_soon") {
    const themes = rows.filter((row) => row.kind === "theme").sort((a, b) => daysSortKey(a) - daysSortKey(b));
    const sectors = rows.filter((row) => row.kind === "sector").sort((a, b) => daysSortKey(a) - daysSortKey(b));
    return [...themes, ...sectors];
  }
  return [
    ...rows.filter((row) => row.kind === "theme"),
    ...rows.filter((row) => row.kind === "sector"),
  ];
}

/** Preview rows shown per lane before the Show more control. */
export const PREVIEW_ROWS = 3;

export interface PreviewSlice {
  /** Rows the reader can see. */
  shown: CallRow[];
  /** Rows concealed behind the Show more control. */
  hidden: number;
}

/**
 * Collapsed lanes show the first `limit` rows (PREVIEW_ROWS by default);
 * expanded lanes show everything. `hidden` drives the "Show more ({n})" copy.
 */
export function previewSlice(
  rows: CallRow[],
  expanded: boolean,
  limit: number = PREVIEW_ROWS,
): PreviewSlice {
  const shown = expanded ? rows : rows.slice(0, limit);
  return { shown, hidden: rows.length - shown.length };
}

export interface BoardColumnTotals {
  key: BoardLaneKey;
  /** The lane's FULL qualified count — never rows.length. */
  total: number;
  locked: number;
}

export interface BoardTotals {
  /** Full qualified total carried on the board itself. */
  total: number;
  /** Locked count carried on the board itself. */
  locked: number;
  columns: Record<BoardLaneKey, BoardColumnTotals>;
}

/**
 * Heading totals: the board's own qualified total/locked, plus per-column
 * totals taken from each (folded) lane's FULL total and locked count — so a
 * lane whose rows are all withheld still reports its qualified count.
 */
export function boardTotals(board: ActionBoardData): BoardTotals {
  const folded = foldSixToFive(board.lanes);
  const columns = {} as Record<BoardLaneKey, BoardColumnTotals>;
  for (const key of BOARD_LANE_ORDER) {
    const lane = folded[key];
    columns[key] = { key, total: lane.total, locked: lane.locked };
  }
  return { total: board.total, locked: board.locked, columns };
}

/** The trace disclosure's placeholder for a null signal grade. */
export const NO_GRADE = "—";

/** Normalized trace fields for one row's per-row Trace disclosure. Raw
 * measured numbers are carried as-is (formatting is render-time); the
 * rollover band keeps both languages so the renderer localizes; a null
 * signal grade normalizes to an em dash. */
export interface CallTrace {
  score: number;
  perf20dRel: number;
  rolloverBand: string;
  rolloverBandZh: string;
  breadthPct50: number;
  /** The owner's grade, or NO_GRADE ("—") when the row carries none. */
  signalGrade: string;
  flipDistance: number;
  rsPctile: number;
  allocRank: number;
  bookWt: number | null;
  durability: number;
  topMembers: string[];
}

export function traceModel(row: CallRow): CallTrace {
  return {
    score: row.score,
    perf20dRel: row.perf_20d_rel,
    rolloverBand: row.rollover_band,
    rolloverBandZh: row.rollover_band_zh,
    breadthPct50: row.breadth_pct50,
    signalGrade: row.signal_grade === null ? NO_GRADE : row.signal_grade,
    flipDistance: row.flip_distance,
    rsPctile: row.rs_pctile,
    allocRank: row.alloc_rank,
    bookWt: row.book_wt,
    durability: row.durability,
    topMembers: [...row.top_members],
  };
}

// ── Bottoming Watch (display-only) ──────────────────────────────────────────

/** One Bottoming Watch entry as the generation carries it. `signal` and
 * `timing_state` are PAYLOAD-ONLY: they ride the type for forward
 * compatibility but are never surfaced in any model output the UI renders. */
export interface WatchEntry {
  ticker: string;
  name: string;
  name_zh: string;
  /** Cycle position, 0–100 (0 = cycle trough). */
  pos: number;
  above_200d: boolean;
  /** The name also appears on the reduce lane — both reads are shown. */
  dual_read: boolean;
  /** Cycle read turning up off a low while the longer trend still says reduce. */
  recovering: boolean;
  /** Payload-only; never rendered. */
  signal?: string;
  /** Payload-only; never rendered. */
  timing_state?: string;
}

/** Entries shown in the watch strip — hard cap. */
export const BOTTOMING_CAP = 8;

/** The chip set the watch renders per entry: the cycle-turn base chip every
 * entry carries, then the disagreement/recovery chips when their flags are
 * set, then the 200-day read (above or below — always exactly one). */
export type WatchChipKind =
  | "cycle_turn"
  | "dual_read"
  | "recovering"
  | "above_200d"
  | "below_200d";

/** The rendered model of one watch entry. Deliberately carries NO trace of
 * the payload-only `signal`/`timing_state` fields. */
export interface WatchModelEntry {
  ticker: string;
  name: string;
  name_zh: string;
  pos: number;
  above200d: boolean;
  dualRead: boolean;
  recovering: boolean;
  chips: WatchChipKind[];
}

function watchChips(entry: WatchEntry): WatchChipKind[] {
  const chips: WatchChipKind[] = ["cycle_turn"];
  if (entry.dual_read) chips.push("dual_read");
  if (entry.recovering) chips.push("recovering");
  chips.push(entry.above_200d ? "above_200d" : "below_200d");
  return chips;
}

/**
 * The watch strip's display model: entries sort by cycle position ASC (deepest
 * trough first) and cap at BOTTOMING_CAP. Only display fields survive the
 * fold — the payload-only fields are dropped here, not hidden in CSS.
 */
export function watchModel(entries: WatchEntry[]): WatchModelEntry[] {
  return [...entries]
    .sort((a, b) => a.pos - b.pos)
    .slice(0, BOTTOMING_CAP)
    .map((entry) => ({
      ticker: entry.ticker,
      name: entry.name,
      name_zh: entry.name_zh,
      pos: entry.pos,
      above200d: entry.above_200d,
      dualRead: entry.dual_read,
      recovering: entry.recovering,
      chips: watchChips(entry),
    }));
}

/** True when any VISIBLE (post-cap) entry is recovering from its cycle low —
 * the condition for the strip's single recovering disclosure line. */
export function hasRecovering(entries: WatchEntry[]): boolean {
  return watchModel(entries).some((entry) => entry.recovering);
}

// ── typed availability guards ───────────────────────────────────────────────
// Zero is measured; missing is missing. The ONLY unavailable path for each
// surface is a null input — an empty array or a zero-total lane is a real,
// measured empty state and must render as such.

export function isCallsBoardUnavailable(
  board: ActionBoardData | null | undefined,
): boolean {
  return board === null || board === undefined;
}

export function isBottomingWatchUnavailable(
  watch: WatchEntry[] | null | undefined,
): boolean {
  return watch === null || watch === undefined;
}
