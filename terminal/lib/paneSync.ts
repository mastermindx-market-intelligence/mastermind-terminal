// Cross-pane sync bus for the multi-pane chart grid.
// Panes register their chart + main series; when sync is on, the focused pane's
// crosshair and visible time-range are mirrored onto every other pane. BOTH travel by
// TIME, never by bar number — each peer resolves its OWN chart at that calendar instant,
// so a $192 NVDA crosshair lands on BTC's candle at the same date, not at $192, and a
// window over June 2024 lands on June 2024 rather than on whatever bar happens to sit at
// the same array position. See lib/timeWindow.ts for why logical indexes cannot be shared.
import type { IChartApi, ISeriesApi, SeriesType, Time } from "lightweight-charts";
import {
  clampLogicalRange, sameLogicalRange, sampleStep, timeToMs, toLogicalRange, toTimeWindow,
  type AxisClock, type LogicalRange, type TimeWindow,
} from "./timeWindow";

// `onCrosshair` fires on a peer whenever THIS bus moves or clears its crosshair: setCrosshairPosition
// is a synthetic position and deliberately fires no crosshairMove event, so a pane that reacts to its
// own crosshair (such as its foreground price label) would never hear about a mirrored one.
export type PaneRegistration = {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  valueAt: (t: Time) => number | null;
  tf: string;
  onCrosshair?: (price: number | null, time: Time | null) => void;
};

type Peer = PaneRegistration & {
  /** operation token armed when THIS bus drove the pane; its next range event is our own echo */
  echoOf?: number;
  /** the range we last asked this pane for — second echo signal, and the re-issue guard */
  lastTarget?: LogicalRange;
  /** memoised index↔time clock, rebuilt only when the pane's bar set moves */
  clock?: { sig: string; clock: AxisClock };
};

// `MismatchDirection` from lightweight-charts, inlined so this module keeps its type-only import
// of the chart library (it is pulled in by TerminalShell purely for `setPaneSync`).
const NEAREST_LEFT = -1;
const NEAREST_RIGHT = 1;

const peers = new Map<number, Peer>();
type VisibleWindowListener = (window: TimeWindow | null) => void;
const visibleWindowListeners = new Map<number, Set<VisibleWindowListener>>();
let enabled = false;
let applying = false; // crosshair re-entrancy guard (range uses the operation token below)
let crosshairFrame: number | null = null;
let pendingCrosshair: { fromId: number; time: Time | null } | null = null;
let opSeq = 0;        // monotonic range-operation token

function cancelPendingCrosshair() {
  pendingCrosshair = null;
  if (crosshairFrame == null) return;
  if (typeof cancelAnimationFrame === "function") {
    try { cancelAnimationFrame(crosshairFrame); } catch {}
  }
  crosshairFrame = null;
}

function applyCrosshair(fromId: number, time: Time | null) {
  if (!enabled || applying) return;
  const self = peers.get(fromId);
  if (!self) return;
  applying = true;
  try {
    peers.forEach((p, id) => {
      if (id === fromId || p.tf !== self.tf) return;
      try {
        const v = time == null ? null : p.valueAt(time);
        if (time == null || v == null) { p.chart.clearCrosshairPosition(); p.onCrosshair?.(null, null); }
        else { p.chart.setCrosshairPosition(v, time, p.series); p.onCrosshair?.(v, time); }
      } catch {}
    });
  } finally { applying = false; }
}

function flushCrosshairFrame() {
  crosshairFrame = null;
  const next = pendingCrosshair;
  pendingCrosshair = null;
  if (next) applyCrosshair(next.fromId, next.time);
}

export function setPaneSync(on: boolean) {
  enabled = on;
  if (!on) {
    cancelPendingCrosshair();
    peers.forEach((p) => {
      // Drop the echo bookkeeping too: a `lastTarget` left over from the previous session would
      // suppress the first mirror after sync is switched back on.
      p.echoOf = undefined;
      p.lastTarget = undefined;
      try { p.chart.clearCrosshairPosition(); p.onCrosshair?.(null, null); } catch {}
    });
  }
}
export function paneSyncEnabled() { return enabled; }

function visibleWindowFor(peer: Peer, range?: LogicalRange | null): TimeWindow | null {
  try {
    const logical = range ?? peer.chart.timeScale().getVisibleLogicalRange();
    if (!logical) return null;
    const clock = clockFor(peer);
    return clock ? toTimeWindow(clock, logical) : null;
  } catch {
    return null;
  }
}

function reportVisibleWindow(id: number, peer: Peer, range?: LogicalRange | null) {
  const listeners = visibleWindowListeners.get(id);
  if (!listeners?.size) return;
  const window = visibleWindowFor(peer, range);
  for (const fn of [...listeners]) {
    try { fn(window); } catch { /* observation never breaks chart sync */ }
  }
}

/** Observe one already-owned pane's exact calendar window without a second chart/range bus. */
export function subscribePaneVisibleWindow(id: number, fn: VisibleWindowListener): () => void {
  let listeners = visibleWindowListeners.get(id);
  if (!listeners) {
    listeners = new Set();
    visibleWindowListeners.set(id, listeners);
  }
  listeners.add(fn);
  const peer = peers.get(id);
  if (peer) reportVisibleWindow(id, peer);
  return () => {
    const current = visibleWindowListeners.get(id);
    current?.delete(fn);
    if (current && current.size === 0) visibleWindowListeners.delete(id);
  };
}

export function registerPane(id: number, registration: PaneRegistration) {
  const peer: Peer = { ...registration };
  peers.set(id, peer);
  // Effect 2 registers only after the pane owns bars + series, so an existing active-pane
  // subscriber receives viewport truth immediately instead of waiting for a pan/zoom.
  reportVisibleWindow(id, peer);
  installProbe();
  return () => {
    if (peers.get(id) === peer) {
      peers.delete(id);
      const listeners = visibleWindowListeners.get(id);
      if (listeners) for (const fn of [...listeners]) { try { fn(null); } catch {} }
    }
  };
}

// time === null means the pointer left the source chart → clear peers' crosshairs.
// Input devices can emit many moves inside one display frame. Only the latest sample can become
// visible, so peer crosshair + foreground-label work is bounded to one flush per paint.
export function broadcastCrosshair(fromId: number, time: Time | null) {
  if (!enabled || applying) return;
  pendingCrosshair = { fromId, time };
  if (crosshairFrame != null) return;
  if (typeof requestAnimationFrame !== "function") {
    flushCrosshairFrame();
    return;
  }
  crosshairFrame = requestAnimationFrame(flushCrosshairFrame);
}

/**
 * Mirror the source pane's VIEW onto every same-timeframe peer.
 *
 * `range` is the source's live logical range, which is meaningful only inside the source's own
 * bar array. It is immediately converted to a calendar window through the source's axis, and each
 * peer converts that window back through its own — so peers show the same DATES, not the same
 * array positions. `lib/timeWindow.ts` owns the arithmetic and the no-overlap edge policy.
 *
 * ── Echo suppression (single-owner law) ─────────────────────────────────────────────────────
 * Lightweight Charts applies `setVisibleLogicalRange` on the NEXT animation frame and fires the
 * change event there, so a mirrored write comes back as an inbound event on the pane we drove. A
 * wall-clock suppression window used to cover that gap, which made correctness a race: a frame
 * slower than the window (a heavy rebuild, a backgrounded tab) turned an echo into a genuine
 * broadcast and the panes fought. The gate is now an explicit operation token plus the range we
 * asked for — neither expires, so no amount of scheduler delay can reopen it.
 *
 * The bus also refuses to re-issue a target it has already asked a pane for. Together with
 * clamping the target ourselves (rather than letting the library rewrite it silently), that is
 * what makes the no-overlap case terminate instead of re-driving a pinned pane every frame.
 */
export function broadcastRange(fromId: number, range: LogicalRange | null) {
  if (!range) return;
  const self = peers.get(fromId);
  if (!self) return;

  // Viewport observation is independent of cross-pane synchronization: the Brain needs
  // the pane the user is actually viewing even when sync is OFF. Mirrored echoes are
  // also real visible states, so report before the echo-suppression gate.
  const clock = clockFor(self);
  const win = clock ? toTimeWindow(clock, range) : null;
  reportVisibleWindow(fromId, self, range);

  if (!enabled || !clock || !win) return;
  if (self.echoOf != null || sameLogicalRange(range, self.lastTarget ?? null)) {
    self.echoOf = undefined;          // our own write bouncing back — absorb it, never re-broadcast
    return;
  }
  self.lastTarget = undefined;        // a genuine move: this pane owns its viewport again

  const op = ++opSeq;
  peers.forEach((p, id) => {
    if (id === fromId || p.tf !== self.tf) return;   // only mirror same-timeframe panes
    try {
      const peerClock = clockFor(p);
      if (!peerClock) return;
      const wanted = toLogicalRange(peerClock, win);
      if (!wanted) return;
      const target = clampLogicalRange(peerClock, wanted);
      if (!target) return;
      // Already asked for exactly this and the pane has not moved on its own since — whatever the
      // library settled on stands. Re-issuing here is the runaway-pan case.
      if (sameLogicalRange(target, p.lastTarget ?? null)) return;
      // A no-op set fires no event, so arming the echo token there would leak it onto the pane's
      // next genuine move.
      if (sameLogicalRange(target, p.chart.timeScale().getVisibleLogicalRange())) { p.lastTarget = target; return; }
      p.lastTarget = target;
      p.echoOf = op;
      p.chart.timeScale().setVisibleLogicalRange(target);
    } catch { /* teardown */ }
  });
}

/**
 * Index↔time clock for one pane, read from the chart it registered.
 *
 * The pane's own price series is the authority for where its data starts and ends: Lightweight
 * Charts indexes series bars by TIME-SCALE index, and the axis can carry points the price series
 * does not (an Ichimoku cloud is displaced into the future). Bounding the clock by the price
 * series keeps the clamp at or inside the library's own limit, which is what lets a mirrored
 * write settle instead of being rewritten and re-issued.
 */
function clockFor(p: Peer): AxisClock | null {
  try {
    const ts = p.chart.timeScale();
    const series = p.series;
    const firstBar = series.dataByIndex(Number.MIN_SAFE_INTEGER, NEAREST_RIGHT) as { time?: unknown } | null;
    const lastBar = series.dataByIndex(Number.MAX_SAFE_INTEGER, NEAREST_LEFT) as { time?: unknown } | null;
    if (!firstBar || !lastBar) return null;
    const first = ts.timeToIndex(firstBar.time as Time, false) as number | null;
    const last = ts.timeToIndex(lastBar.time as Time, false) as number | null;
    const msFirst = timeToMs(firstBar.time);
    const msLast = timeToMs(lastBar.time);
    if (first == null || last == null || !(last > first)) return null;
    if (!Number.isFinite(msFirst) || !Number.isFinite(msLast) || !(msLast > msFirst)) return null;
    // Endpoints move on every setData and on an appended live bar; nothing else can change the
    // interior, so this signature is a sufficient cache key for the sampled step.
    const sig = `${first}|${last}|${msFirst}|${msLast}`;
    if (p.clock?.sig === sig) return p.clock.clock;
    const msAt = (i: number): number => {
      try {
        const bar = series.dataByIndex(i) as { time?: unknown } | null;
        return bar ? timeToMs(bar.time) : NaN;
      } catch { return NaN; }
    };
    const step = sampleStep(msAt, first, last);
    if (!Number.isFinite(step) || step <= 0) return null;
    const clock: AxisClock = { first, last, msAt, step };
    p.clock = { sig, clock };
    return clock;
  } catch { return null; }
}

/**
 * Dev-only introspection, so a browser test can assert the CALENDAR window each pane shows rather
 * than infer it from pixels. `visible` is the library's own answer (clamped to that symbol's data);
 * `window` is the full window including whitespace, which is what the panes are supposed to agree on.
 */
function installProbe() {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
  (window as unknown as { __mmPaneSync?: unknown }).__mmPaneSync = () => ({
    enabled,
    panes: [...peers.entries()].map(([id, p]) => {
      let logical: LogicalRange | null = null;
      let visible: unknown = null;
      let win: { from: number; to: number } | null = null;
      try { logical = p.chart.timeScale().getVisibleLogicalRange(); } catch {}
      try { visible = p.chart.timeScale().getVisibleRange(); } catch {}
      try { const c = clockFor(p); if (c && logical) win = toTimeWindow(c, logical); } catch {}
      return { id, tf: p.tf, logical, visible, window: win, pendingEcho: p.echoOf ?? null };
    }),
  });
}
