import { object } from "./sectorIntelligence";

/* ────────────────────────────────────────────────────────────────────────────
 * Rhythm window (Round 3 §6.4). The window edges are a pure function of the
 * record's own turn history — the last NON-provisional pivot plus that same
 * record's half-cycle spacing quantiles. "Today" is deliberately NOT an input
 * to the edges: when today advances, the edges stay exactly where they were and
 * only the record's position state (before → inside → past) and the overdue
 * flag move. This is a descriptive rhythm, never a probability.
 * ──────────────────────────────────────────────────────────────────────────── */

export type RhythmMonth = string; // "YYYY-MM"
export type TurnKind = "peak" | "trough";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const strictDay = (value: unknown): string | null =>
  typeof value === "string" && DAY.test(value) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
    ? value
    : null;

export function monthOf(day: string): RhythmMonth {
  return day.slice(0, 7);
}
const isMonth = (value: unknown): value is RhythmMonth =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** Calendar-month addition with end-of-month clamping (Jan 31 + 1M = Feb 28). */
export function addMonths(day: string, months: number): RhythmMonth | null {
  const pivot = strictDay(day);
  if (pivot === null || !Number.isFinite(months)) return null;
  const whole = Math.round(months);
  if (Math.abs(months - whole) > 1e-9) return null;
  const [y, m, d] = pivot.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + whole;
  const year = Math.floor(total / 12), month = (total % 12) + 1;
  const leap = (year % 4 === 0) && (year % 100 !== 0 || year % 400 === 0);
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  const dayClamped = Math.min(d, length);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(dayClamped).padStart(2, "0")}`.slice(0, 7);
}

export interface RhythmPivot {
  date: string;
  kind: TurnKind;
  provisional: boolean;
}
export interface RhythmSpacing {
  /** Half-cycle spacing quantiles in months, from the same record's own history. */
  p25: number;
  median: number;
  p75: number;
}

export interface RhythmWindowEdges {
  state: "ready" | "unavailable";
  /** The kind of turn the open leg is heading toward. */
  nextTurn: TurnKind | null;
  /** Fixed window edges (YYYY-MM). Never recompute from today. */
  low: RhythmMonth | null;
  central: RhythmMonth | null;
  high: RhythmMonth | null;
  fromPivot: RhythmPivot | null;
}

const isTurnKind = (v: unknown): v is TurnKind => v === "peak" || v === "trough";

/** Last confirmed (non-provisional) pivot of a turn list, scanning from the end. */
export function lastConfirmedPivot(turns: readonly {
  date: unknown;
  k?: unknown;
  kind?: unknown;
  provisional?: unknown;
}[]): RhythmPivot | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const raw = turns[i];
    const kind = raw.k ?? raw.kind;
    const date = strictDay(raw.date);
    if (date === null || !isTurnKind(kind) || raw.provisional === true) continue;
    return { date, kind, provisional: false };
  }
  return null;
}

/** Build the fixed window from a pivot and that record's own spacing quantiles. */
export function rhythmWindowFromTurns(
  pivot: RhythmPivot | null,
  spacing: RhythmSpacing | null,
): RhythmWindowEdges {
  const p25 = spacing && Number.isFinite(spacing.p25) ? spacing.p25 : null;
  const median = spacing && Number.isFinite(spacing.median) ? spacing.median : null;
  const p75 = spacing && Number.isFinite(spacing.p75) ? spacing.p75 : null;
  if (!pivot || p25 === null || median === null || p75 === null) {
    return { state: "unavailable", nextTurn: null, low: null, central: null, high: null, fromPivot: null };
  }
  if (!(p25 > 0 && median >= p25 && p75 >= median)) {
    return { state: "unavailable", nextTurn: null, low: null, central: null, high: null, fromPivot: null };
  }
  const low = addMonths(pivot.date, p25),
    central = addMonths(pivot.date, median),
    high = addMonths(pivot.date, p75);
  if (!low || !central || !high) {
    return { state: "unavailable", nextTurn: null, low: null, central: null, high: null, fromPivot: null };
  }
  return {
    state: "ready",
    nextTurn: pivot.kind === "trough" ? "peak" : "trough",
    low, central, high,
    fromPivot: pivot,
  };
}

export type RhythmPosition = "before" | "inside" | "past";
export interface RhythmPlacement {
  /** null only when the window itself is unavailable. */
  position: RhythmPosition | null;
  overdue: boolean;
}

/** Place "today" against FIXED edges. Month precision — the producer's window is
 * monthly — so the comparison is on YYYY-MM, never on a re-derived day. */
export function rhythmPlacement(
  window: RhythmWindowEdges,
  today: string | null,
): RhythmPlacement {
  if (window.state !== "ready" || window.low === null || window.central === null || window.high === null) {
    return { position: null, overdue: false };
  }
  const day = strictDay(today);
  if (day === null) return { position: null, overdue: false };
  const now = monthOf(day);
  if (now < window.low) return { position: "before", overdue: false };
  if (now > window.high) return { position: "past", overdue: true };
  return { position: "inside", overdue: false };
}

/* ── Producer record reader ─────────────────────────────────────────────────── */

export type RhythmDepthState = "valid" | "wrong_epoch" | "expired" | "absent";
export interface RhythmReading {
  state: RhythmDepthState;
  window: RhythmWindowEdges;
  kind: "descriptive_rhythm" | null;
  overdue: boolean;
  position: RhythmPosition | null;
}

const RHYTHM_SCHEMA = "sector_cycles.rhythm.v1";

/** Read the producer's rhythm block as an optional depth. A stale or
 * wrong-epoch rhythm never erases the qualified core — it is withheld with its
 * own reason. */
export function rhythmReading(
  record: unknown,
  generation: { asOf: string } | null,
  today: string | null,
): RhythmReading {
  const r = object(object(record).rhythm);
  const unavailable: RhythmReading = {
    state: "absent",
    window: rhythmWindowFromTurns(null, null),
    kind: null,
    overdue: false,
    position: null,
  };
  if (!r.schema) return unavailable;
  if (r.schema !== RHYTHM_SCHEMA) return { ...unavailable, state: "wrong_epoch" };
  const asOf = strictDay(r.as_of ?? r.asOf);
  if (generation && asOf !== null && asOf !== generation.asOf) {
    return { ...unavailable, state: "expired" };
  }
  const w = object(r.window);
  const low = isMonth(w.low) ? w.low : null,
    central = isMonth(w.central) ? w.central : null,
    high = isMonth(w.high) ? w.high : null;
  const nextTurn = isTurnKind(r.next_turn) ? r.next_turn : null;
  const ordered = low && central && high && low <= central && central <= high;
  const edges: RhythmWindowEdges = ordered
    ? { state: "ready", nextTurn, low, central, high, fromPivot: null }
    : { state: "unavailable", nextTurn: null, low: null, central: null, high: null, fromPivot: null };
  const placement = rhythmPlacement(edges, today);
  return {
    state: "valid",
    window: edges,
    kind: r.kind === "descriptive_rhythm" ? "descriptive_rhythm" : null,
    overdue: r.overdue === true ? true : placement.overdue,
    position: placement.position,
  };
}
