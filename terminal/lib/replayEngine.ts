/**
 * replayEngine.ts — pure logic for the surface replay spine.
 *
 * The replay bar time-travels the whole pane group: frames come from a snapshot index
 * (`stamps: ["HHMM", …]`), and scrubbing sets a global "asOfStamp" that panes consume.
 * All of the index math, the keybind reducer, and the play-clock stepping live here as
 * pure functions so they can be unit-tested (lib/__tests__/replayEngine.test.ts) without
 * a DOM — the ReplayBar component and its context are thin wrappers over this.
 */

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface ReplayState {
  /** All available frame stamps in ascending order, "HHMM". */
  stamps: string[];
  /** Current frame index into `stamps` (0-based). */
  frame: number;
  /** Whether the play clock is running. */
  playing: boolean;
  /** Play speed multiplier. */
  speed: ReplaySpeed;
  /** Explicit pause/seek must not follow newly published frames. */
  followHead?: boolean;
  /** Selected observation is no longer available. */
  missingStamp?: string;
}

export type ReplayAction =
  | { type: "setStamps"; stamps: string[]; keepHead?: boolean }
  | { type: "toFirst" } // ⏮ / Home
  | { type: "toLast" } // ⏭ / End
  | { type: "stepBack" } // ◀
  | { type: "stepFwd" } // ▶ (single frame)
  | { type: "togglePlay" } // Space
  | { type: "play" }
  | { type: "pause" }
  | { type: "setFrame"; frame: number } // scrubber
  | { type: "setSpeed"; speed: ReplaySpeed }
  | { type: "tick" }; // one play-clock advance

/** Clamp a frame index into [0, stamps.length-1] (or 0 when empty). */
export function clampFrame(frame: number, len: number): number {
  if (len <= 0) return 0;
  if (frame < 0) return 0;
  if (frame > len - 1) return len - 1;
  return Math.round(frame);
}

/** The stamp at the current frame, or null when there are no frames. */
export function stampAt(state: ReplayState): string | null {
  if (state.stamps.length === 0 || state.missingStamp != null) return null;
  const f = clampFrame(state.frame, state.stamps.length);
  return state.stamps[f] ?? null;
}

/** True when the current frame is the newest (head) — drives the LIVE badge. */
export function isAtHead(state: ReplayState): boolean {
  return state.missingStamp == null && state.stamps.length > 0 && state.frame >= state.stamps.length - 1;
}

/** Initial state for a fresh index — starts pinned to the head (LIVE). */
export function initReplay(stamps: string[] = []): ReplayState {
  return {
    stamps,
    frame: Math.max(0, stamps.length - 1),
    playing: false,
    speed: 1,
  };
}

/**
 * Pure reducer. Every control (buttons + Home/End/Space + scrubber) routes through
 * here so keyboard and click paths cannot drift apart.
 *
 * setStamps semantics: when the index grows and we were already at the head (LIVE),
 * follow the new head; otherwise hold the current frame (a scrubbed-back viewer is not
 * yanked forward when a new snapshot lands). `keepHead` forces head-follow regardless.
 */
export function replayReducer(state: ReplayState, action: ReplayAction): ReplayState {
  const len = state.stamps.length;
  switch (action.type) {
    case "setStamps": {
      const selected = state.missingStamp ?? stampAt(state);
      const follows = action.keepHead || (state.followHead !== false &&
        (isAtHead(state) || (len === 0 && selected == null)));
      let frame = 0;
      let missingStamp: string | undefined;
      if (follows) {
        frame = Math.max(0, action.stamps.length - 1);
      } else if (selected != null) {
        const prior = action.stamps.findLastIndex(stamp => stamp <= selected);
        if (prior < 0) missingStamp = selected;
        else frame = prior;
      }
      return { ...state, stamps: action.stamps, frame, missingStamp,
        playing: missingStamp != null || action.keepHead ? false : state.playing,
        followHead: action.keepHead ? true : state.followHead };
    }
    case "toFirst":
      return { ...state, frame: 0, playing: false, followHead: false, missingStamp: undefined };
    case "toLast":
      return { ...state, frame: Math.max(0, len - 1), playing: false, followHead: true, missingStamp: undefined };
    case "stepBack":
      return { ...state, frame: clampFrame(state.frame - 1, len), playing: false, followHead: false, missingStamp: undefined };
    case "stepFwd":
      return { ...state, frame: clampFrame(state.frame + 1, len), playing: false, followHead: false, missingStamp: undefined };
    case "togglePlay": {
      const restart = !state.playing && isAtHead(state) && len > 1;
      return { ...state, frame: restart ? 0 : state.frame, playing: !state.playing,
        followHead: false, missingStamp: undefined };
    }
    case "play":
      return { ...state, frame: isAtHead(state) && len > 1 ? 0 : state.frame,
        playing: true, followHead: false, missingStamp: undefined };
    case "pause":
      return { ...state, playing: false, followHead: false };
    case "setFrame":
      return { ...state, frame: clampFrame(action.frame, len), playing: false, followHead: false, missingStamp: undefined };
    case "setSpeed":
      return { ...state, speed: action.speed };
    case "tick": {
      if (!state.playing || len === 0) return state;
      const next = state.frame + 1;
      if (next >= len) return { ...state, frame: len - 1, playing: false }; // stop at head
      return { ...state, frame: next };
    }
    default:
      return state;
  }
}

/** Milliseconds between play-clock ticks for a given speed (base 700ms/frame). */
export const BASE_TICK_MS = 700;
export function tickIntervalMs(speed: ReplaySpeed): number {
  return Math.round(BASE_TICK_MS / speed);
}

/**
 * Map a keyboard event key to a replay action, or null if it's not a replay key.
 * Home→toFirst, End→toLast, Space→togglePlay, ArrowLeft→stepBack, ArrowRight→stepFwd.
 * (Callers gate this on the pane group being focused/hovered so it doesn't hijack
 * typing in inputs.)
 */
export function keyToAction(key: string): ReplayAction | null {
  switch (key) {
    case "Home":
      return { type: "toFirst" };
    case "End":
      return { type: "toLast" };
    case " ":
    case "Spacebar": // legacy
      return { type: "togglePlay" };
    case "ArrowLeft":
      return { type: "stepBack" };
    case "ArrowRight":
      return { type: "stepFwd" };
    default:
      return null;
  }
}

/** "HHMM" → "HH:MM" for display; passthrough if it doesn't look like a stamp. */
export function fmtStamp(stamp: string | null): string {
  if (!stamp) return "—";
  if (/^\d{4}$/.test(stamp)) return `${stamp.slice(0, 2)}:${stamp.slice(2)}`;
  return stamp;
}

/** "HHMM" → minutes past midnight, or NaN when it isn't a stamp. */
export function stampMinutes(stamp: string): number {
  if (!/^\d{4}$/.test(stamp)) return NaN;
  const h = Number(stamp.slice(0, 2));
  const m = Number(stamp.slice(2));
  if (h > 23 || m > 59) return NaN;
  return h * 60 + m;
}

/**
 * Position every stored frame on an observed-time rail.
 *
 * A native range input spaces values evenly, which is actively misleading when the store
 * contains 10:02, 10:07, then 11:41: the thumb moves one identical notch while the chart
 * jumps 94 minutes. These fractions preserve the wall-clock distance between frames so a
 * missing interval is visible before the user scrubs into it. Malformed/degenerate indexes
 * fall back to even spacing rather than producing an unusable rail.
 */
export function frameClockPositions(stamps: string[]): number[] {
  if (stamps.length <= 1) return stamps.map(() => 0);
  const mins = stamps.map(stampMinutes);
  if (mins.some((m) => !Number.isFinite(m))) {
    return stamps.map((_, i) => i / (stamps.length - 1));
  }
  const first = mins[0];
  const last = mins[mins.length - 1];
  if (last <= first) return stamps.map((_, i) => i / (stamps.length - 1));
  return mins.map((m) => Math.min(1, Math.max(0, (m - first) / (last - first))));
}

export interface FrameGapStats {
  /** Median observed spacing, in seconds. Null until two valid frames exist. */
  medianSec: number | null;
  /** Largest observed spacing, in seconds. Null until two valid frames exist. */
  maxSec: number | null;
  /** True when the largest gap is materially larger than the typical spacing. */
  irregular: boolean;
}

/** Measured index spacing; this describes what was stored, never a configured target. */
export function frameGapStats(stamps: string[]): FrameGapStats {
  if (stamps.length < 2) return { medianSec: null, maxSec: null, irregular: false };
  const mins = stamps.map(stampMinutes);
  if (mins.some((m) => !Number.isFinite(m))) {
    return { medianSec: null, maxSec: null, irregular: false };
  }
  const gaps = mins.slice(1).map((m, i) => (m - mins[i]) * 60).filter((v) => v > 0);
  if (!gaps.length) return { medianSec: null, maxSec: null, irregular: false };
  const ordered = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  const medianSec = ordered.length % 2
    ? ordered[mid]
    : (ordered[mid - 1] + ordered[mid]) / 2;
  const maxSec = ordered[ordered.length - 1];
  return { medianSec, maxSec, irregular: maxSec > Math.max(medianSec * 1.8, medianSec + 120) };
}

// ─── Scrubber annotations: session structure ────────────────────────────────
//
// The three session landmarks the replay track can annotate WITHOUT any extra data: the RTH
// open, the closing hour, and the bell. They are properties of the US equity session itself,
// not a feed — so they are always true and never need a payload.
//
// Macro-event markers (FOMC/CPI) were scoped for this rail and deliberately NOT shipped. A
// dated macro calendar IS reachable — the macro repo publishes feeds/event_calendar.json to
// the same R2 bucket lib/upstreams R2_BASE already reads, with per-event {date, time_et,
// label, label_zh, impact} — but it is a FORWARD calendar: horizon_days 21, earliest entry
// asof+1. This track only ever shows sessions that have already happened (today's realized
// frames, or one of the retained PAST sessions), so the overlap with a forward-only feed is
// structurally empty, not merely rare. Marking events here needs a calendar with history;
// until one exists the rail carries session structure only. Event dates are never hardcoded.

export const RTH_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
export const POWER_HOUR_MIN = 15 * 60; // 15:00 ET
export const RTH_CLOSE_MIN = 16 * 60; // 16:00 ET

/**
 * How close the newest frame must be to the bell before the close is annotated. Mid-session
 * there is no close to mark yet — drawing one would claim a session had ended when it hadn't.
 */
export const CLOSE_GRACE_MIN = 10;

export type ScrubberBandKey = "open" | "power" | "close";

export interface ScrubberBand {
  key: ScrubberBandKey;
  /** Fraction [0,1] of the track where the band starts. */
  from: number;
  /** Fraction [0,1] where it ends; `from === to` is a marker line, not a span. */
  to: number;
}

/**
 * Session-structure bands for a stamp list, as track fractions.
 *
 * Positions are interpolated on the CLOCK, not on frame indices, so a session with a gap in
 * its snapshots still puts 15:00 where 15:00 belongs. Landmarks outside the realized window
 * clamp to the track ends — the open genuinely precedes the first frame, so its marker sits at
 * the left edge rather than being dropped.
 *
 * What is emitted is gated on what actually happened:
 *   - open   — whenever there are ≥2 frames (an RTH session always has an open behind it).
 *   - power  — only once the newest frame has reached 15:00.
 *   - close  — only once the newest frame is within CLOSE_GRACE_MIN of the bell.
 * Pure + DOM-free so the geometry is unit-testable without a scrubber.
 */
export function sessionBands(stamps: string[]): ScrubberBand[] {
  if (stamps.length < 2) return [];
  const mins = stamps.map(stampMinutes).filter((m) => Number.isFinite(m));
  if (mins.length < 2) return [];
  const first = Math.min(...mins);
  const last = Math.max(...mins);
  if (last <= first) return [];
  const frac = (m: number) => Math.min(1, Math.max(0, (m - first) / (last - first)));

  const bands: ScrubberBand[] = [];
  const open = frac(RTH_OPEN_MIN);
  bands.push({ key: "open", from: open, to: open });
  if (last >= POWER_HOUR_MIN) {
    bands.push({ key: "power", from: frac(POWER_HOUR_MIN), to: frac(RTH_CLOSE_MIN) });
  }
  if (last >= RTH_CLOSE_MIN - CLOSE_GRACE_MIN) {
    const close = frac(RTH_CLOSE_MIN);
    bands.push({ key: "close", from: close, to: close });
  }
  return bands;
}

// ─── Group engagement (B5): hover/focus tracking with symmetric teardown ────
//
// The replay keybinds (Space / arrows / Home / End) must only fire while the pane group is
// engaged, or they hijack the page. Two bugs lived in the original binder:
//   1. `focusin` set the flag and NOTHING ever cleared it — one click inside the group left
//      Space and the arrows captured page-wide for the rest of the session.
//   2. the handlers were re-created on every bind invocation, so removeEventListener was
//      always handed a different function object than addEventListener had received and never
//      matched — listeners accumulated on every rebind.
// Both are fixed by owning ONE handler set per tracker for its whole life, and by pairing
// focusin with focusout. Kept DOM-free (the element is only ever used through the two
// listener methods plus an optional `contains`) so accumulation is provable in a plain unit
// test — lib/__tests__/replayEngine.test.ts — with no jsdom in the harness.

type EngagementListener = (ev?: unknown) => void;

export interface EngagementTarget {
  addEventListener(type: string, fn: EngagementListener): void;
  removeEventListener(type: string, fn: EngagementListener): void;
  /** DOM `Node.contains`. Used to ignore focus moving BETWEEN children of the group. */
  contains?(node: unknown): boolean;
}

export interface EngagementTracker {
  /** Attach to `el`, detaching from any previous element. `null` detaches. */
  bind(el: EngagementTarget | null): void;
  /** True while the pointer is over the group OR focus is inside it. */
  engaged(): boolean;
  /** The currently bound element (test/debug aid). */
  target(): EngagementTarget | null;
}

export function createEngagementTracker(): EngagementTracker {
  let el: EngagementTarget | null = null;
  let hovered = false;
  let focused = false;

  // Created ONCE, so every removeEventListener is handed the exact function addEventListener got.
  const handlers: [string, EngagementListener][] = [
    ["mouseenter", () => { hovered = true; }],
    ["mouseleave", () => { hovered = false; }],
    ["focusin", () => { focused = true; }],
    ["focusout", (ev) => {
      // Tabbing from one control in the group to another fires focusout→focusin; the group
      // never actually lost focus, so don't disengage on an internal hop.
      const next = (ev as { relatedTarget?: unknown } | undefined)?.relatedTarget ?? null;
      if (next != null && el?.contains?.(next)) return;
      focused = false;
    }],
  ];

  return {
    bind(next: EngagementTarget | null) {
      if (next === el) return; // re-binding the same node is a no-op, not a second attach
      if (el) for (const [type, fn] of handlers) el.removeEventListener(type, fn);
      el = next;
      // A fresh element starts disengaged; nothing carries over from the old one.
      hovered = false;
      focused = false;
      if (el) for (const [type, fn] of handlers) el.addEventListener(type, fn);
    },
    engaged: () => hovered || focused,
    target: () => el,
  };
}
