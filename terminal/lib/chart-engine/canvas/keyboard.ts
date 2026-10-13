// Mastermind Chart Engine — keyboard navigation & accessibility layer (canvas/, P3).
//
// Pure, event-record based controller that turns KeyboardEvent-shaped records into
// time-scale / crosshair / pane-focus actions through an injected dependency set. It
// owns no DOM: no element access, no listeners, no timers — every clock (now()) and
// every side effect (range writes, crosshair writes, announcements) is injected, so
// the same controller drives tests, the canvas renderer and the LWC adapter.
//
// Mapping (active controller only; see focus()/blur()):
//   ArrowLeft/ArrowRight  move the crosshair one bar (Shift: 10 bars). With Alt the
//                         same arrows PAN the visible range instead — the crosshair
//                         stays put, the range slides under it (Shift+Alt: 10 bars).
//                         With no crosshair set, the first press materialises it at
//                         the centre visible bar (the delta is absorbed).
//   ArrowUp/ArrowDown     rove pane focus between panes, wrapping at both ends.
//   "+"/"=" and "-"       zoom in/out around the crosshair logical, or the centre of
//                         the visible range when no crosshair is set.
//   Home / End            jump the crosshair to the first / last bar. End also sets
//                         the right offset so the last bar sits at the right edge
//                         with the standard future gutter after it (viewReset preset
//                         shape: visibleTo = lastBar + rightOffset).
//   Escape                clears the crosshair.
//   r (no modifiers)      resetView() — the parent wires this to the viewReset
//                         presets (normalizedChartLogicalRange & friends).
//   Anything else — and ANY key with ctrl/meta held — returns { handled: false } so
//   browser and screen-reader shortcuts always win.
//
// Auto-repeat acceleration: the streak is classified from the record's timeStamp
// deltas ONLY (house law — now() is never consulted for key classification), with
// the record's `repeat` flag deliberately ignored (it disagrees across
// browsers/focus changes; the timeStamp gap is the single source of truth).
// Curve: steps(streak) = 1 + floor((streak - 1) / 3) — each run of three consecutive
// same-signature presses (<= 500 ms apart) adds one step. Bars moved per event =
// base x steps (base 1, or 10 with Shift), capped at 20 bars per event. Zoom
// compounds its per-step factor over the same step count.
//
// Announcements: crosshair moves made by keyboard route through announce(text),
// a trailing debounce of the LAST value within 150 ms measured on the injected
// now(). Pure and timer-free: a pending value is emitted at the first subsequent
// controller entry whose now() is >= 150 ms after it was recorded, or on flush()/
// blur(). Mouse moves never arrive here — the parent owns whether to call announce()
// for them (it can reuse the same debounce by doing so).
//
// formatHoverAnnouncement(bar, formatters) builds the screen-reader sentence for a
// hovered bar from an injected t(key)/formatTime/formatPrice — no English copy is
// embedded as the single source. The parent adds these LEX [en, zh] keys (suggested
// copy, en first): chartKeyboardBarAnnouncement — "Bar {time}: O {open} H {high}
// L {low} C {close}" / "{time} 柱线：开 {open} 高 {high} 低 {low} 收 {close}";
// chartKeyboardBarAnnouncementWithVolume — the same plus " · Volume {volume}" /
// " · 量 {volume}".

import type { EngineTime } from "../api";

// ── Shared programme vocabulary (local structural types) ──────────────────────
// LogicalIndex/TimeScaleState mirror the shapes every canvas/ lane declares locally
// so the parent can unify them in one place later. Logical index 0 is the first row
// of the primary series; fractional values address the space between bars.

export type LogicalIndex = number;

export type TimeScaleState = {
  visibleFrom: number;
  visibleTo: number;
  barSpacing: number;
  rightOffset: number;
  widthPx: number;
};

export type PaneRect = { x: number; y: number; width: number; height: number };

export type CrosshairState = { logical: number | null; paneIndex: number };

/** The slice of a KeyboardEvent the controller consumes (structural — no DOM types). */
export type KeyRecord = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  timeStamp: number;
  // Deliberately unused for classification (see header): timeStamp gaps decide.
  repeat: boolean;
};

/** What the parent draws as the keyboard focus ring; null rect when geometry is unknown. */
export type FocusRing = { paneIndex: number; rect: PaneRect | null };

/** Spread on the chart container so it is a focusable application landmark. */
export type KeyboardAriaProps = {
  role: "application";
  "aria-roledescription": string;
  "aria-label": string;
  tabIndex: 0;
};

export type KeyboardControllerState = {
  active: boolean;
  focusPaneIndex: number;
  crosshair: CrosshairState;
};

// ── Dependencies ───────────────────────────────────────────────────────────────
export type KeyboardControllerDeps = {
  getTimeScale(): TimeScaleState;
  setVisibleLogicalRange(from: number, to: number): void;
  getCrosshair(): CrosshairState;
  setCrosshair(logical: number | null, paneIndex: number): void;
  clearCrosshair(): void;
  resetView(): void;
  paneCount(): number;
  /** Output channel for debounced announcements (wire to the aria-live region). */
  announce(text: string): void;
  /** Debounce clock. Never used for key classification — that is timeStamp's job. */
  now(): number;

  // Optional overrides beyond the base contract (see INTEGRATION_NOTES):
  /** Exact data length. Default derives the last bar as visibleTo - rightOffset,
   *  which is exact while the standard future gutter is displayed (viewReset
   *  presets) but stale after a manual pan left — provide this for exactness. */
  barCount?(): number;
  /** Localised bar description for keyboard crosshair moves; null = nothing to say.
   *  The parent composes it with formatHoverAnnouncement below. */
  describeBar?(logical: number): string | null;
  /** Plot-area rect of a pane, for the focus ring descriptor. */
  paneRect?(paneIndex: number): PaneRect | null;
};

export type KeyboardController = {
  handleKey(record: KeyRecord): { handled: boolean };
  focus(): void;
  blur(): void;
  focusRing(): FocusRing | null;
  ariaProps(state: { roledescription: string; label: string }): KeyboardAriaProps;
  /** Debounced announcement channel (last value within 150 ms wins). */
  announce(text: string): void;
  /** Emit any pending announcement immediately, matured or not. */
  flush(): void;
  state(): KeyboardControllerState;
};

// ── Tuning constants (behaviour spec'd in the header comment) ──────────────────
const ACCEL_REPEAT_WINDOW_MS = 500;
const ACCEL_STREAK_PER_STEP = 3;
const MAX_BARS_PER_EVENT = 20;
const SHIFT_BASE_BARS = 10;
const ZOOM_FACTOR_PER_STEP = 1.2;
const MIN_VISIBLE_SPAN = 2;
const MAX_VISIBLE_SPAN = 50_000;
const ANNOUNCE_DEBOUNCE_MS = 150;

/** steps(streak) = 1 + floor((streak - 1) / 3): three repeats per extra step. */
function accelSteps(streak: number): number {
  return 1 + Math.floor((streak - 1) / ACCEL_STREAK_PER_STEP);
}

/** Bars for one event: base x steps, capped so one keypress never jumps past 20 bars. */
function barsForEvent(base: number, streak: number): number {
  return Math.min(base * accelSteps(streak), MAX_BARS_PER_EVENT);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Last real bar index: barCount()-1 when the parent knows it, else derived. */
function lastBarIndex(deps: KeyboardControllerDeps): number {
  if (deps.barCount) {
    const byCount = deps.barCount() - 1;
    if (Number.isFinite(byCount)) return Math.max(0, Math.floor(byCount));
  }
  const ts = deps.getTimeScale();
  const gutter = Math.max(0, finiteOr(ts.rightOffset, 0));
  return Math.max(0, Math.floor(finiteOr(ts.visibleTo, gutter) - gutter));
}

type KeyAction =
  | "left"
  | "right"
  | "up"
  | "down"
  | "zoomIn"
  | "zoomOut"
  | "home"
  | "end"
  | "escape"
  | "reset";

/** Pure classification: null means "not ours" (parent lets the browser act). */
function classifyKey(record: KeyRecord): KeyAction | null {
  // Browser/screen-reader shortcuts always win, whatever the key.
  if (record.ctrlKey || record.metaKey) return null;
  switch (record.key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    // "+" is shift+"=" on many layouts; accept both spellings for zoom-in.
    case "+":
    case "=":
      return "zoomIn";
    case "-":
      return "zoomOut";
    case "Home":
      return "home";
    case "End":
      return "end";
    case "Escape":
      return "escape";
    case "r":
      // Bare "r" only — any modifier makes it somebody else's key.
      if (record.shiftKey || record.altKey) return null;
      return "reset";
    default:
      return null;
  }
}

// ── Hover announcement formatter ───────────────────────────────────────────────

export type HoverBar = {
  time: EngineTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type AnnouncementFormatters = {
  formatTime(time: EngineTime): string;
  /** Formats every numeric field, volume included (the only numeric formatter injected). */
  formatPrice(price: number): string;
  t(key: string): string;
};

const KEY_BAR = "chartKeyboardBarAnnouncement";
const KEY_BAR_WITH_VOLUME = "chartKeyboardBarAnnouncementWithVolume";

function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    out = out.split(`{${name}}`).join(value);
  }
  return out;
}

/**
 * Concise, localisable screen-reader sentence for a hovered bar. Word order and
 * copy come entirely from the injected t(key) templates ({time}/{open}/{high}/
 * {low}/{close}/{volume} placeholders), so zh and en stay equally first-class.
 */
export function formatHoverAnnouncement(bar: HoverBar, fmt: AnnouncementFormatters): string {
  const volume = bar.volume;
  const hasVolume = typeof volume === "number" && Number.isFinite(volume);
  const template = fmt.t(hasVolume ? KEY_BAR_WITH_VOLUME : KEY_BAR);
  return fillTemplate(template, {
    time: fmt.formatTime(bar.time),
    open: fmt.formatPrice(bar.open),
    high: fmt.formatPrice(bar.high),
    low: fmt.formatPrice(bar.low),
    close: fmt.formatPrice(bar.close),
    volume: hasVolume ? fmt.formatPrice(volume) : "",
  });
}

// ── Controller ─────────────────────────────────────────────────────────────────

export function createKeyboardController(deps: KeyboardControllerDeps): KeyboardController {
  let active = false;
  let focusPaneIndex = 0;
  let pending: { text: string; at: number } | null = null;
  // Acceleration streak: last handled key signature, its event count and timeStamp.
  let streakSig: string | null = null;
  let streakCount = 0;
  let streakAt = 0;

  function emitPending(): void {
    if (!pending) return;
    const { text } = pending;
    pending = null;
    deps.announce(text);
  }

  function flushMatured(): void {
    if (pending && deps.now() - pending.at >= ANNOUNCE_DEBOUNCE_MS) emitPending();
  }

  function paneTotal(): number {
    return Math.max(1, Math.floor(finiteOr(deps.paneCount(), 1)));
  }

  function clampFocusPane(index: number): number {
    return Math.max(0, Math.min(paneTotal() - 1, Math.floor(finiteOr(index, 0))));
  }

  function announceBar(logical: number): void {
    if (!deps.describeBar) return;
    const text = deps.describeBar(logical);
    if (text == null) {
      pending = null; // newest state wins: nothing to say about this bar
      return;
    }
    controller.announce(text);
  }

  /** Slide the visible range minimally so a moved crosshair stays on screen. */
  function ensureVisible(logical: number): void {
    const ts = deps.getTimeScale();
    const from = finiteOr(ts.visibleFrom, 0);
    const to = finiteOr(ts.visibleTo, from);
    const span = to - from;
    if (!(span > 0)) return;
    if (logical < from) {
      deps.setVisibleLogicalRange(logical, logical + span);
    } else if (logical > to - 1) {
      deps.setVisibleLogicalRange(logical + 1 - span, logical + 1);
    }
  }

  function moveCrosshair(delta: number): void {
    const ts = deps.getTimeScale();
    const cross = deps.getCrosshair();
    const last = lastBarIndex(deps);
    // The crosshair may enter the future gutter (addressable anchors) but not pass it.
    const maxLogical = last + Math.max(0, finiteOr(ts.rightOffset, 0));
    const hadCrosshair = cross.logical != null && Number.isFinite(cross.logical);
    const current = hadCrosshair
      ? Math.floor(cross.logical as number)
      : Math.round((finiteOr(ts.visibleFrom, 0) + finiteOr(ts.visibleTo, 0)) / 2);
    // With no crosshair set, the first arrow press materialises it at the centre
    // visible bar — the delta is absorbed by materialising, so Left and Right land
    // on the same starting bar.
    const next = hadCrosshair
      ? Math.max(0, Math.min(maxLogical, current + delta))
      : Math.max(0, Math.min(maxLogical, current));
    const stationary = hadCrosshair && next === current;
    if (!stationary) deps.setCrosshair(next, focusPaneIndex);
    // Even a stationary crosshair gets revealed if it slid off screen (e.g. after
    // an Alt-pan): pressing an arrow must never leave the crosshair invisible.
    ensureVisible(next);
    if (!stationary) announceBar(next);
  }

  /** Alt+arrows: move the range under the crosshair. Mirrors LWC scroll clamps:
   *  never past the first bar on the left, never past lastBar + rightOffset. */
  function panRange(bars: number): void {
    const ts = deps.getTimeScale();
    const from = finiteOr(ts.visibleFrom, 0);
    const to = finiteOr(ts.visibleTo, from);
    const span = to - from;
    if (!(span > 0)) return;
    const gutterEnd = lastBarIndex(deps) + Math.max(0, finiteOr(ts.rightOffset, 0));
    const maxFrom = Math.max(0, gutterEnd - span);
    const newFrom = Math.max(0, Math.min(from + bars, maxFrom));
    deps.setVisibleLogicalRange(newFrom, newFrom + span);
  }

  function zoom(direction: -1 | 1, streak: number): void {
    const ts = deps.getTimeScale();
    const from = finiteOr(ts.visibleFrom, 0);
    const to = finiteOr(ts.visibleTo, from);
    const span = to - from;
    if (!(span > 0)) return;
    const cross = deps.getCrosshair();
    const floatAnchor =
      cross.logical != null && Number.isFinite(cross.logical)
        ? (cross.logical as number)
        : (from + to) / 2;
    // PERF-A C2/F4: anchor the BAR under the crosshair (or the nearest bar to
    // the centre of the visible range) when it is on data, so the anchored
    // logical is an exact bar centre and cannot drift across steps; float only
    // off data.
    let anchor = floatAnchor;
    const count = deps.barCount?.();
    if (count != null && Number.isFinite(count)) {
      const bar = Math.round(floatAnchor);
      if (bar >= 0 && bar < count) anchor = bar;
    }
    const steps = barsForEvent(1, streak);
    const factor = Math.pow(ZOOM_FACTOR_PER_STEP, direction * steps);
    const newSpan = Math.min(MAX_VISIBLE_SPAN, Math.max(MIN_VISIBLE_SPAN, span * factor));
    const ratio = newSpan / span;
    let newFrom = anchor - (anchor - from) * ratio;
    let newTo = anchor + (to - anchor) * ratio;
    if (newFrom < 0) {
      newFrom = 0;
      newTo = newSpan;
    }
    deps.setVisibleLogicalRange(newFrom, newTo);
  }

  function roveFocus(direction: -1 | 1): void {
    const count = paneTotal();
    focusPaneIndex = (focusPaneIndex + direction + count) % count;
  }

  const controller: KeyboardController = {
    handleKey(record: KeyRecord): { handled: boolean } {
      flushMatured();
      const action = classifyKey(record);
      if (!active || action === null) return { handled: false };

      // Acceleration bookkeeping — timeStamp deltas only, per key signature.
      const sig = `${record.key}|${record.shiftKey ? "s" : ""}|${record.altKey ? "a" : ""}`;
      const gap = streakSig === sig ? record.timeStamp - streakAt : Infinity;
      streakCount = gap <= ACCEL_REPEAT_WINDOW_MS ? streakCount + 1 : 1;
      streakSig = sig;
      streakAt = record.timeStamp;

      const base = record.shiftKey ? SHIFT_BASE_BARS : 1;
      switch (action) {
        case "left":
        case "right": {
          const direction = action === "right" ? 1 : -1;
          if (record.altKey) panRange(direction * barsForEvent(base, streakCount));
          else moveCrosshair(direction * barsForEvent(base, streakCount));
          return { handled: true };
        }
        case "up":
          roveFocus(-1);
          return { handled: true };
        case "down":
          roveFocus(1);
          return { handled: true };
        case "zoomIn":
          zoom(-1, streakCount);
          return { handled: true };
        case "zoomOut":
          zoom(1, streakCount);
          return { handled: true };
        case "home": {
          const ts = deps.getTimeScale();
          const span = finiteOr(ts.visibleTo, 0) - finiteOr(ts.visibleFrom, 0);
          deps.setCrosshair(0, focusPaneIndex);
          if (span > 0) deps.setVisibleLogicalRange(0, span);
          announceBar(0);
          return { handled: true };
        }
        case "end": {
          const ts = deps.getTimeScale();
          const span = finiteOr(ts.visibleTo, 0) - finiteOr(ts.visibleFrom, 0);
          const gutter = Math.max(0, finiteOr(ts.rightOffset, 0));
          const last = lastBarIndex(deps);
          deps.setCrosshair(last, focusPaneIndex);
          if (span > 0) deps.setVisibleLogicalRange(last + gutter - span, last + gutter);
          announceBar(last);
          return { handled: true };
        }
        case "escape":
          deps.clearCrosshair();
          pending = null; // the crosshair is gone; nothing left to announce
          return { handled: true };
        case "reset":
          deps.resetView();
          return { handled: true };
      }
    },

    focus(): void {
      flushMatured();
      active = true;
      // Keyboard focus begins where attention already is: the crosshair's pane.
      focusPaneIndex = clampFocusPane(deps.getCrosshair().paneIndex);
    },

    blur(): void {
      // Drain, then go quiet: nothing pending survives an unfocused controller.
      emitPending();
      active = false;
    },

    focusRing(): FocusRing | null {
      if (!active) return null;
      return { paneIndex: focusPaneIndex, rect: deps.paneRect ? deps.paneRect(focusPaneIndex) : null };
    },

    ariaProps(state: { roledescription: string; label: string }): KeyboardAriaProps {
      return {
        role: "application",
        "aria-roledescription": state.roledescription,
        "aria-label": state.label,
        tabIndex: 0,
      };
    },

    announce(text: string): void {
      flushMatured();
      pending = { text, at: deps.now() };
    },

    flush(): void {
      emitPending();
    },

    state(): KeyboardControllerState {
      return {
        active,
        focusPaneIndex,
        crosshair: { ...deps.getCrosshair() },
      };
    },
  };

  return controller;
}
