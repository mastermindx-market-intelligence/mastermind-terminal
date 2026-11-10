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
 * optional `days` field the incumbent puts on buy_soon rows only. The watch
 * contract mirrors theme_intel.act_now's bottoming_watch payload (ids +
 * membership sets, display-tier authority, payload-only machine fields).
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
  /** Detail destination, carried verbatim; the board renders it as a link only
   * when it is a same-site relative path beginning with one "/" (review N4 —
   * see lib/sectorDepthHref.ts). */
  href: string;
  /** Days-to-trigger, carried by buy_soon rows only. Null/absent sorts last. */
  days?: number | null;
  /** Owner-written stat sentence for SECTOR rows (the sector face — sectors
   * never show a score). Absent/null on rows whose owner wrote no stat. */
  stat_en?: string | null;
  stat_zh?: string | null;
  /** Independent-emergence marker (v1.1, R6-09 "Company strength is early"):
   * true ONLY when the owner engine itself flags this row — a strong company
   * in a weak sector stays discoverable; components never derive it from
   * score/RS/perf, and it never changes entry qualification or may_* flags.
   * Absent/null = not flagged. */
  emerging?: boolean | null;
  /** Company-evidence destination for an emerging row, used EXACTLY as
   * carried; absent/null on every other row and whenever the owner publishes
   * no distinct route (the row's own `href` detail remains). */
  emergence_href?: string | null;
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

/** The two groups rendered INSIDE the Stand-aside column (R5 C01): the
 * incumbent's hold and avoid lanes keep their own identity under the folded
 * column — group headers carry each lane's own full total, never the merged
 * one. Group rendering is display-only; folding arithmetic is unchanged. */
export interface StandAsideGroups {
  hold: LaneData;
  avoid: LaneData;
}

/** Pass-through view of the two source lanes that folded into Stand-aside,
 * for the grouped column rendering (C01/C02). */
export function standAsideGroups(
  lanes: Record<SourceLaneKey, LaneData>,
): StandAsideGroups {
  return { hold: lanes.hold, avoid: lanes.avoid };
}

export interface GroupPreviewSlice {
  hold: PreviewSlice;
  avoid: PreviewSlice;
}

/**
 * The Stand-aside preview budget spent exactly as the incumbent slices the
 * merged list (hold rows first, then avoid): hold spends from the front,
 * avoid receives only what is left of the budget (zero when hold already
 * consumed it). Each group expands independently via its own flag; the
 * display sort (themes first) applies per group afterwards, mirroring
 * columnPreview's semantics.
 */
export function standAsidePreview(
  lanes: Record<SourceLaneKey, LaneData>,
  holdExpanded: boolean,
  avoidExpanded: boolean,
  limit: number = PREVIEW_ROWS,
): GroupPreviewSlice {
  const holdRows = lanes.hold.rows;
  const avoidRows = lanes.avoid.rows;
  const holdShown = holdExpanded ? holdRows : holdRows.slice(0, Math.max(0, limit));
  // The budget is a property of the SOURCE slice (hold rows first, avoid takes
  // what is left), so avoid's collapsed share never depends on hold's
  // expansion state — expanding Hold reveals Hold only.
  const avoidBudget = Math.max(0, limit - Math.min(holdRows.length, limit));
  const avoidShown = avoidExpanded ? avoidRows : avoidRows.slice(0, avoidBudget);
  return {
    hold: {
      shown: laneRowsSorted("stand_aside", holdShown),
      hidden: holdRows.length - holdShown.length,
    },
    avoid: {
      shown: laneRowsSorted("stand_aside", avoidShown),
      hidden: avoidRows.length - avoidShown.length,
    },
  };
}

/** Days-to-trigger sort key: absent/null days are treated as 99 (last),
 * the incumbent's `x.days ?? 99` semantics. */
function daysSortKey(row: CallRow): number {
  return typeof row.days === "number" ? row.days : 99;
}

/**
 * Reader order for one board lane's VISIBLE rows: themes before sectors,
 * stable within each kind (theme rows keep source order, then sector rows
 * keep source order). Additionally, for the buy_soon lane only, rows sort by
 * `days` ascending (null/absent last) within each kind — the incumbent's
 * "almost ready" ordering by time-to-trigger.
 *
 * This is a DISPLAY sort only — preview budgets are spent on SOURCE order
 * (see columnPreview), never on the re-sorted list.
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

/** Preview rows shown per rendered column before the Show more control. */
export const PREVIEW_ROWS = 3;

export interface PreviewSlice {
  /** Rows the reader can see, in display order (themes first). */
  shown: CallRow[];
  /** Rows concealed behind the Show more control. */
  hidden: number;
}

/**
 * One preview budget per rendered column, spent on SOURCE order exactly as the
 * incumbent template slices it (scripts/build_sector_central.py::split_actnow):
 * the budget applies to the rows as the fold merged them, THEN what shipped is
 * sorted for display. Because the folded stand_aside list is hold rows followed
 * by avoid rows, a plain head-slice IS the incumbent arithmetic — hold spends
 * the budget first and avoid takes the remainder (preview - hold_shown).
 *
 * An at/under-cap column ships whole: hidden is 0 and no Show more appears.
 * Expanded shows everything.
 */
export function columnPreview(
  laneKey: BoardLaneKey,
  rows: CallRow[],
  expanded: boolean,
  limit: number = PREVIEW_ROWS,
): PreviewSlice {
  const { shown: shipped, hidden } = previewSlice(rows, expanded, limit);
  return { shown: laneRowsSorted(laneKey, shipped), hidden };
}

/** Collapsed-lane preview slice over a plain list (kept for direct callers;
 * the board renders through columnPreview). */
export function previewSlice(
  rows: CallRow[],
  expanded: boolean,
  limit: number = PREVIEW_ROWS,
): PreviewSlice {
  const shown = expanded ? rows : rows.slice(0, Math.max(0, limit));
  return { shown, hidden: rows.length - shown.length };
}

/**
 * A lane is a MEASURED EMPTY only when its full qualified total is zero.
 * A lane with total > 0 and nothing visible (every row withheld upstream) is
 * NOT empty — it renders the withheld line, never the empty-state copy.
 */
export function laneMeasuredEmpty(lane: LaneData): boolean {
  return lane.total === 0;
}

/**
 * Row-face content law (R5 builder note): theme rows show score + 20d
 * performance; sector rows show the owner's stat sentence only — never a
 * score, and never a synthesized one. Returns the localized stat line for a
 * sector row, or null when the row is a theme or the owner wrote no stat.
 */
export function sectorStat(row: CallRow, lang: string): string | null {
  if (row.kind !== "sector") return null;
  const stat = lang === "zh" ? row.stat_zh : row.stat_en;
  if (stat) return stat;
  return row.stat_en ?? row.stat_zh ?? null;
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

/** One Bottoming Watch entry exactly as theme_intel.act_now carries it.
 * `signal`, `cycle_signal`, `timing_state` and `osc_slope` are PAYLOAD-ONLY:
 * they ride the type for forward compatibility but are never surfaced in any
 * model output the UI renders. `href` is carried but never actionable — the
 * strip renders names as plain text. */
export interface WatchEntry {
  id: string;
  cid: string;
  kind: "BASKET" | "SECTOR";
  name: string;
  name_zh: string;
  /** Cycle position, 0–100 (0 = cycle trough). */
  pos: number;
  osc_slope: number;
  signal: string | null;
  timing_state: string;
  above200d: boolean;
  cycle_signal: string | null;
  /** Cycle turned but price is below its 200-day — renders the gate-conflict chip. */
  gate_conflict: boolean;
  /** Carried verbatim, never rendered as a link. */
  href: string;
}

/** The watch authority block. Tier is display-only and every may_* stays
 * false; the owner's null disclosure is rendered in place of the standard
 * watch disclosure when present. */
export interface WatchAuthority {
  tier: "display";
  may_rank: false;
  may_gate: false;
  may_size: false;
  may_escalate: false;
  null_disclosure_en?: string | null;
  null_disclosure_zh?: string | null;
}

/** The bottoming-watch payload as the generation carries it: entries plus the
 * two membership sets (ids, not per-row booleans) and the authority block. */
export interface BottomingWatchData {
  bottoming_watch: WatchEntry[];
  dual_read_ids: string[];
  recovering_ids: string[];
  bottoming_authority: WatchAuthority;
}

/** Entries shown in the watch strip before its continuation control — NOT a
 * hard cap: the strip is display-only but the full population stays reachable
 * through Show all (v1.1 full-population continuation; R6-09 member coverage
 * keeps every entry in the population). */
export const BOTTOMING_CAP = 8;

/** The chip set the watch renders per entry: the cycle-turn base chip every
 * entry carries, then the disagreement chips when their conditions hold
 * (dual-read and recovering are id-membership reads; gate conflict is carried
 * on the row), then the 200-day read (above or below — always exactly one). */
export type WatchChipKind =
  | "cycle_turn"
  | "dual_read"
  | "recovering"
  | "gate_conflict"
  | "above_200d"
  | "below_200d";

/** The rendered model of one watch entry. Deliberately carries NO trace of
 * the payload-only fields (signal, cycle_signal, timing_state, osc_slope) and
 * no href/cid/kind raw enums — only what the strip actually renders. */
export interface WatchModelEntry {
  /** Stable id; used as the React key, never rendered as customer text. */
  id: string;
  name: string;
  name_zh: string;
  pos: number;
  above200d: boolean;
  dualRead: boolean;
  recovering: boolean;
  gateConflict: boolean;
  chips: WatchChipKind[];
}

function watchChips(entry: WatchEntry, data: BottomingWatchData): WatchChipKind[] {
  const chips: WatchChipKind[] = ["cycle_turn"];
  if (data.dual_read_ids.includes(entry.id)) chips.push("dual_read");
  if (data.recovering_ids.includes(entry.id)) chips.push("recovering");
  if (entry.gate_conflict) chips.push("gate_conflict");
  chips.push(entry.above200d ? "above_200d" : "below_200d");
  return chips;
}

/**
 * The watch strip's display model: entries sort by cycle position ASC (deepest
 * trough first) and cap at BOTTOMING_CAP; chip flags read the membership sets.
 * Only display fields survive the fold — payload-only fields are dropped here,
 * not hidden in CSS.
 */
export function watchModel(data: BottomingWatchData, expanded = false): WatchModelEntry[] {
  const all = [...data.bottoming_watch].sort((a, b) => a.pos - b.pos);
  const shown =
    expanded || all.length <= BOTTOMING_CAP ? all : all.slice(0, BOTTOMING_CAP);
  return shown
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      name_zh: entry.name_zh,
      pos: entry.pos,
      above200d: entry.above200d,
      dualRead: data.dual_read_ids.includes(entry.id),
      recovering: data.recovering_ids.includes(entry.id),
      gateConflict: entry.gate_conflict,
      chips: watchChips(entry, data),
    }));
}

/** True when any entry in the FULL population (not just the pre-expansion
 * slice) is recovering from its cycle low — the condition for the strip's
 * single recovering disclosure line. Population truth, independent of what is
 * currently shown (v1.1 full-population continuation). */
export function hasRecovering(data: BottomingWatchData): boolean {
  return [...data.bottoming_watch]
    .sort((a, b) => a.pos - b.pos)
    .some((entry) => data.recovering_ids.includes(entry.id));
}

/**
 * The owner's null disclosure for the watch, localized, when the authority
 * carries one — rendered in place of the standard siWatchDisclosure copy.
 * Returns null when absent, so the caller falls back to the lexicon.
 */
export function watchDisclosure(data: BottomingWatchData, lang: string): string | null {
  const text = lang === "zh" ? data.bottoming_authority.null_disclosure_zh : data.bottoming_authority.null_disclosure_en;
  return text ?? data.bottoming_authority.null_disclosure_en ?? data.bottoming_authority.null_disclosure_zh ?? null;
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
  watch: BottomingWatchData | null | undefined,
): boolean {
  return watch === null || watch === undefined;
}

// ── closed-shape carried readers (review S2) ─────────────────────────────────
// Same pattern as flowsFromCarriedBlock: a malformed or incomplete payload
// returns null, the component renders the shared DepthUnavailable state, and
// NO input ever throws. An absent `total` is malformed (null) — it can never
// reach the reader as the text "undefined". These readers are the boundary
// lane 3's mount calls instead of a cast: hand them the raw projection value
// and branch on null.

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** One accepted CallRow: the closed field set every renderer reads, with the
 * owner's nullable/optional fields validated only when present. */
function validCallRow(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  if (v.kind !== "theme" && v.kind !== "sector") return false;
  for (const key of [
    "ticker",
    "slug",
    "name",
    "name_zh",
    "reco",
    "label",
    "label_zh",
    "rollover_band",
    "rollover_band_zh",
    "reco_why_en",
    "reco_why_zh",
    "href",
  ] as const) {
    if (typeof v[key] !== "string") return false;
  }
  for (const key of [
    "score",
    "alloc_rank",
    "durability",
    "perf_20d_rel",
    "breadth_pct50",
    "clean_quality",
    "rs_pctile",
    "flip_distance",
  ] as const) {
    if (!isFiniteNumber(v[key])) return false;
  }
  for (const key of ["above_trend", "eligible", "validated", "clean_entry"] as const) {
    if (typeof v[key] !== "boolean") return false;
  }
  if (v.book_wt !== null && !isFiniteNumber(v.book_wt)) return false;
  if (v.signal_grade !== null && typeof v.signal_grade !== "string") return false;
  if (!Array.isArray(v.top_members) || !v.top_members.every((m) => typeof m === "string")) {
    return false;
  }
  // Optional fields, validated only when the key rides the payload.
  if (v.days !== undefined && v.days !== null && !isFiniteNumber(v.days)) return false;
  for (const key of ["stat_en", "stat_zh"] as const) {
    if (v[key] !== undefined && v[key] !== null && typeof v[key] !== "string") return false;
  }
  if (v.emerging !== undefined && v.emerging !== null && typeof v.emerging !== "boolean") {
    return false;
  }
  if (
    v.emergence_href !== undefined &&
    v.emergence_href !== null &&
    typeof v.emergence_href !== "string"
  ) {
    return false;
  }
  return true;
}

/** Closed-shape reader for the owner's action_board (review S2). Validates the
 * whole board — date, board total/locked, all six lanes with their own
 * total/locked and every row's closed field set — and returns the SAME object
 * typed as ActionBoardData, or null for anything malformed or incomplete.
 * Lane 3's mount calls this instead of casting; the calls board component
 * also runs it on its own prop, so a malformed board can never crash render. */
export function actionBoardFromCarried(payload: unknown): ActionBoardData | null {
  if (!isPlainObject(payload)) return null;
  if (typeof payload.as_of !== "string" || !DATE_SHAPE.test(payload.as_of)) return null;
  if (!isCount(payload.total)) return null;
  if (!isCount(payload.locked)) return null;
  if (!isPlainObject(payload.lanes)) return null;
  const lanes = payload.lanes as Record<string, unknown>;
  for (const key of [
    "buy_now",
    "buy_soon",
    "on_the_run",
    "take_profits",
    "hold",
    "avoid",
  ] as const) {
    const lane = lanes[key];
    if (!isPlainObject(lane)) return null;
    if (!Array.isArray(lane.rows) || !lane.rows.every(validCallRow)) return null;
    if (!isCount(lane.total)) return null;
    if (!isCount(lane.locked)) return null;
  }
  // Every field has been individually validated above; this is a sound cast.
  return payload as unknown as ActionBoardData;
}

/** Closed-shape reader for the owner's bottoming_watch payload (review S2):
 * the entries array, both id-membership sets and the display-tier authority
 * block, with every payload-only field still type-checked (they ride the wire
 * even though the strip never renders them). Returns the same object typed as
 * BottomingWatchData, or null for anything malformed or incomplete. */
export function bottomingWatchFromCarried(payload: unknown): BottomingWatchData | null {
  if (!isPlainObject(payload)) return null;
  if (!Array.isArray(payload.bottoming_watch)) return null;
  for (const e of payload.bottoming_watch) {
    if (!isPlainObject(e)) return null;
    if (e.kind !== "BASKET" && e.kind !== "SECTOR") return null;
    for (const key of ["id", "cid", "name", "name_zh", "timing_state", "href"] as const) {
      if (typeof e[key] !== "string") return null;
    }
    for (const key of ["pos", "osc_slope"] as const) {
      if (!isFiniteNumber(e[key])) return null;
    }
    for (const key of ["above200d", "gate_conflict"] as const) {
      if (typeof e[key] !== "boolean") return null;
    }
    for (const key of ["signal", "cycle_signal"] as const) {
      if (e[key] !== null && typeof e[key] !== "string") return null;
    }
  }
  for (const key of ["dual_read_ids", "recovering_ids"] as const) {
    if (!Array.isArray(payload[key]) || !payload[key].every((x) => typeof x === "string")) {
      return null;
    }
  }
  const auth = payload.bottoming_authority;
  if (!isPlainObject(auth)) return null;
  if (auth.tier !== "display") return null;
  // may_* are display-tier false by contract; a true value is not this contract.
  for (const key of ["may_rank", "may_gate", "may_size", "may_escalate"] as const) {
    if (auth[key] !== undefined && auth[key] !== false) return null;
  }
  for (const key of ["null_disclosure_en", "null_disclosure_zh"] as const) {
    if (auth[key] !== undefined && auth[key] !== null && typeof auth[key] !== "string") {
      return null;
    }
  }
  // Every field has been individually validated above; this is a sound cast.
  return payload as unknown as BottomingWatchData;
}
