// Pane-sync adapter — plugs a contract-level ChartEngine pane into the cross-pane sync
// bus (lib/paneSync.ts) without importing lightweight-charts anywhere on this side.
//
// THE BUS CURRENCY IS THE CALENDAR (law #642). paneSync's own registration is LWC-typed
// (`chart: IChartApi`, `series: ISeriesApi`), so this module hands it a VIRTUAL time axis:
// the shims it registers present a coordinate space whose "logical index" unit is EPOCH
// MILLISECONDS. In that space every number paneSync exchanges with us IS a calendar instant:
//
//   outbound  engine logical range ──resolveTime──▶ {from,to} epoch ms ──▶ broadcastRange()
//   inbound   {from,to} epoch ms (bus or parent) ──resolveLogical──▶ engine setVisibleLogicalRange()
//
// The conversions are ours, not the bus's: `resolveTime` is sampled at INTEGER neighbours
// and interpolated for fractional edges (a half-bar over a weekend lands on Saturday noon),
// and past the last bar (or before the first) the window is extrapolated at the axis's
// representative cadence — the median adjacent-bar gap, matching lib/timeWindow.ts's
// `sampleStep` reasoning. Two panes with different cadences or history depths therefore
// never shift by index: each resolves the same millisecond window through its own axis.
//
// Echo policy (I03-A02). Applying a peer window never re-issues a write the engine already
// satisfies (> 1e-6 logical), a synchronously delivered echo is swallowed by the
// `applying` flag, and the asynchronous echo of a PARENT-applied window is matched against
// the range we wrote and absorbed. The echo of a BUS-driven write (paneSync called our
// shim's setVisibleLogicalRange) is deliberately let through: paneSync arms an operation
// token (`echoOf`) that only that broadcast can consume — swallowing it here would deafen
// this pane to its next genuine move.
//
// `detach()` unregisters and unsubscribes exactly once (I03-A03) and restores any series
// methods this adapter wrapped.

import type { PaneLink, PaneRegistration } from "../paneSync";
import { broadcastCrosshair, broadcastRange, registerPane } from "../paneSync";
import { timeToMs } from "../timeWindow";
import type {
  ChartEngine,
  EngineLogicalRange,
  EngineMouseEventParams,
  EngineSeriesRow,
  EngineTime,
  SeriesHandle,
} from "./api";

// paneSync's registration is typed against lightweight-charts; we satisfy it structurally
// through these indexed aliases, so this file never names an LWC type (the documented
// pass-through idiom of the P0 boundary — see api.ts).
type PeerChart = PaneRegistration["chart"];
type PeerSeries = PaneRegistration["series"];
type PeerTime = Parameters<typeof broadcastCrosshair>[1];

export type PaneSyncOpts = {
  /** Grid slot id as a non-negative integer string — `Number(...)` must parse it. */
  paneId: string;
  /**
   * This pane's declared link membership. Validated but NOT pushed to `setPaneLinks`: the
   * bus plan has exactly one owner today (lib/chartLinkGroups.ts → TerminalShell), and a
   * second writer would clobber it. Parents that manage groups themselves pass it for
   * symmetry with that model; the bus gates mirroring regardless.
   */
  linkGroup?: PaneLink;
  /** Timeframe key; paneSync mirrors only same-`tf` panes. Defaults to "" (matches only other defaulting adapter panes). */
  tf?: string;
  /** The pane's axis: logical index (0 = first row of the primary series) → its bar time, null outside the data. */
  resolveTime(logical: number): EngineTime | null;
  /** The inverse: a time (epoch-seconds numbers are the bus currency for windows) → this pane's logical index, null when unresolvable. */
  resolveLogical(time: EngineTime): number | null;
};

export type PaneSyncAttachment = {
  detach(): void;
  /** Adopt a peer's calendar window on this pane (echo-suppressed; no-op when already shown). */
  applyPeerWindow(from: EngineTime, to: EngineTime): void;
  /**
   * Record a peer-mirrored crosshair. The engine contract has no write-side crosshair API
   * yet, so this validates and absorbs the mirror instead of drawing it; paneSync's
   * `onCrosshair` callback lands here too.
   */
  applyPeerCrosshair(time: EngineTime | null, price?: number): void;
};

/** Two logical ranges that differ by more than this are different viewports (I03-A02). */
const RANGE_EPS = 1e-6;
/** Upper bound for probing where the pane's bars end (a sane plotted-row ceiling). */
const EXTENT_CAP = 1 << 20;
/** Adjacent-bar gaps sampled for the representative cadence (matches sampleStep's budget). */
const MAX_STEP_SAMPLES = 32;

type BarExtent = { first: number; last: number; stepMs: number };

/**
 * The hovered instant as a peer-mirrorable sample: the event's time plus the price the
 * PRIMARY series shows under the pointer (its own scale, via the contract's coordinate
 * conversion). Null when the param carries no time (pointer left the pane).
 */
export function engineCrosshairToPeerValue(
  params: EngineMouseEventParams,
  primary: SeriesHandle,
): { time: EngineTime; price: number | null } | null {
  const time = params?.time;
  if (time == null) return null;
  let price: number | null = null;
  const y = params.point?.y;
  if (typeof y === "number" && Number.isFinite(y)) {
    try {
      const p = primary.coordinateToPrice(y);
      if (p != null && Number.isFinite(p)) price = p;
    } catch { price = null; }
  }
  return { time, price };
}

function paneIdOf(paneId: string): number {
  const id = Number(paneId);
  if (!Number.isInteger(id) || id < 0) {
    throw new RangeError(`attachPaneSync: paneId must parse as a non-negative integer, got ${JSON.stringify(paneId)}`);
  }
  return id;
}

function validateLinkGroup(link: PaneLink): void {
  if (!link
    || typeof link.group !== "string" || !link.group
    || typeof link.crosshair !== "boolean"
    || typeof link.window !== "boolean") {
    throw new TypeError("attachPaneSync: linkGroup must be a PaneLink {group, crosshair, window}");
  }
}

/**
 * Wire one ChartEngine pane into the pane-sync bus. Everything paneSync sees of this pane
 * flows through the contract handles and the two resolvers — the adapter is the only
 * thing that knows this pane's bar geometry.
 */
export function attachPaneSync(engine: ChartEngine, primary: SeriesHandle, opts: PaneSyncOpts): PaneSyncAttachment {
  const id = paneIdOf(opts.paneId);
  if (typeof opts.resolveTime !== "function" || typeof opts.resolveLogical !== "function") {
    throw new TypeError("attachPaneSync: resolveTime and resolveLogical must be functions");
  }
  if (opts.linkGroup !== undefined) validateLinkGroup(opts.linkGroup);
  const resolveTime = opts.resolveTime;
  const resolveLogical = opts.resolveLogical;

  // ── the pane's bar geometry, read through resolveTime ─────────────────────────────────
  let extent: BarExtent | null = null;

  const msAtInteger = (i: number): number => {
    const t = resolveTime(i);
    if (t == null) return NaN;
    const ms = timeToMs(t);
    return Number.isFinite(ms) ? ms : NaN;
  };

  function medianStepMs(first: number, last: number): number {
    const gaps: number[] = [];
    const stride = Math.max(1, Math.floor((last - first) / MAX_STEP_SAMPLES));
    for (let i = first; i < last && gaps.length < MAX_STEP_SAMPLES; i += stride) {
      const a = msAtInteger(i);
      const b = msAtInteger(i + 1);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) gaps.push(b - a);
    }
    if (!gaps.length) return NaN;
    gaps.sort((x, y) => x - y);
    return gaps[gaps.length >> 1];
  }

  function discoverExtent(): BarExtent | null {
    let first = -1;
    for (let i = 0; i <= 4; i++) {
      if (resolveTime(i) != null) { first = i; break; }
    }
    if (first < 0) return null;
    // exponential probe for the first index past the data, then binary-search the boundary
    let lo = first;
    let hi = first + 1;
    while (hi < EXTENT_CAP && resolveTime(hi) != null) {
      lo = hi;
      hi = Math.min(hi * 2, EXTENT_CAP);
    }
    if (hi < EXTENT_CAP || resolveTime(EXTENT_CAP) == null) {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (resolveTime(mid) != null) lo = mid; else hi = mid;
      }
    } else {
      lo = EXTENT_CAP; // data continues past the probe ceiling; degrade to the cap
    }
    const last = lo;
    if (last <= first) return null;
    const stepMs = medianStepMs(first, last);
    if (!Number.isFinite(stepMs) || stepMs <= 0) return null;
    return { first, last, stepMs };
  }

  /** Cached extent, re-validated per use: a live append moves the tail, a refresh can move the head. */
  function currentExtent(): BarExtent | null {
    if (!extent
      || resolveTime(extent.last + 1) != null
      || resolveTime(extent.first) == null) {
      extent = discoverExtent();
    }
    return extent;
  }

  /** Epoch ms at a FRACTIONAL logical index: interpolate between neighbour bars, extrapolate by cadence outside. */
  function calendarMsAt(logical: number): number | null {
    if (!Number.isFinite(logical)) return null;
    const ext = currentExtent();
    if (!ext) return null;
    if (logical <= ext.first) {
      const base = msAtInteger(ext.first);
      return Number.isFinite(base) ? base + (logical - ext.first) * ext.stepMs : null;
    }
    if (logical >= ext.last) {
      const base = msAtInteger(ext.last);
      return Number.isFinite(base) ? base + (logical - ext.last) * ext.stepMs : null;
    }
    const i = Math.floor(logical);
    const a = msAtInteger(i);
    const b = msAtInteger(i + 1);
    if (!Number.isFinite(a)) return null;
    if (!Number.isFinite(b) || b <= a) return a;
    return a + (b - a) * (logical - i);
  }

  /** The calendar window (epoch ms) this pane shows for an engine logical range. */
  function calendarWindow(range: EngineLogicalRange): { from: number; to: number } | null {
    const from = calendarMsAt(range.from);
    const to = calendarMsAt(range.to);
    if (from == null || to == null || !(to > from)) return null;
    return { from, to };
  }

  /** This pane's logical index for a bus time (epoch ms), or null when the axis cannot resolve it. */
  function logicalForMs(ms: number): number | null {
    if (!Number.isFinite(ms)) return null;
    const logical = resolveLogical(ms / 1000);
    return logical != null && Number.isFinite(logical) ? logical : null;
  }

  // ── shadow price index — backs registration.valueAt from the data the caller pushes ────
  // The contract's SeriesHandle exposes no row lookup, so the adapter shadows the rows the
  // pane itself pushes through setData/update. ChartPanel's registration reads its own bar
  // store the same way; this is that store, derived at the contract boundary.
  const priceAtMs = new Map<number, number>();

  function rememberRow(row: EngineSeriesRow): void {
    if (!row || typeof row !== "object") return;
    const ms = timeToMs((row as { time: EngineTime }).time);
    if (!Number.isFinite(ms)) return;
    const r = row as { close?: unknown; value?: unknown };
    const price = typeof r.close === "number" ? r.close : typeof r.value === "number" ? r.value : null;
    if (price != null && Number.isFinite(price)) priceAtMs.set(ms, price);
    else priceAtMs.delete(ms); // whitespace: a time slot with no value
  }

  const host = primary as { setData?: unknown; update?: unknown };
  const hadOwnSetData = Object.prototype.hasOwnProperty.call(primary, "setData");
  const hadOwnUpdate = Object.prototype.hasOwnProperty.call(primary, "update");
  const originalSetData = typeof host.setData === "function" ? (host.setData as (rows: EngineSeriesRow[]) => void).bind(primary) : null;
  const originalUpdate = typeof host.update === "function"
    ? (host.update as (row: EngineSeriesRow, historicalUpdate?: boolean) => void).bind(primary)
    : null;
  let wrappedDataHooks = false;
  try {
    primary.setData = (rows: EngineSeriesRow[]): void => {
      priceAtMs.clear();
      for (const row of rows) rememberRow(row);
      originalSetData?.(rows);
    };
    primary.update = (row: EngineSeriesRow, historicalUpdate?: boolean): void => {
      rememberRow(row);
      originalUpdate?.(row, historicalUpdate);
    };
    wrappedDataHooks = true;
  } catch {
    // A frozen handle keeps working; valueAt just has no prices to answer with.
  }

  function restoreDataHooks(): void {
    if (!wrappedDataHooks) return;
    wrappedDataHooks = false;
    try {
      if (hadOwnSetData && originalSetData) primary.setData = originalSetData;
      else delete (primary as { setData?: (rows: EngineSeriesRow[]) => void }).setData;
      if (hadOwnUpdate && originalUpdate) primary.update = originalUpdate;
      else delete (primary as { update?: (row: EngineSeriesRow, historicalUpdate?: boolean) => void }).update;
    } catch { /* teardown never throws */ }
  }

  // ── inbound: adopt windows / crosshairs from peers ─────────────────────────────────────
  let detached = false;
  let applying = false;         // re-entrancy guard while WE drive the engine
  let applyingFromBus = false;  // …and the write came from paneSync's shim, not the parent
  let echoGuard: EngineLogicalRange | null = null; // the parent-applied range whose echo to absorb
  let unregisterPane: (() => void) | null = null;

  const sameRange = (a: EngineLogicalRange, b: EngineLogicalRange): boolean =>
    Math.abs(a.from - b.from) <= RANGE_EPS && Math.abs(a.to - b.to) <= RANGE_EPS;

  function applyWindowMs(fromMs: number, toMs: number, fromBus: boolean): void {
    if (detached || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || !(toMs > fromMs)) return;
    const from = logicalForMs(fromMs);
    const to = logicalForMs(toMs);
    if (from == null || to == null || !(to > from)) return;
    const ts = engine.timeScale();
    const current = ts.getVisibleLogicalRange();
    if (current && sameRange(current, { from, to })) return; // already shown: no write, no echo (I03-A02)
    applying = true;
    applyingFromBus = fromBus;
    if (!fromBus) echoGuard = { from, to };
    try {
      ts.setVisibleLogicalRange({ from, to });
    } finally {
      applying = false;
    }
  }

  function applyPeerCrosshair(time: EngineTime | null, price?: number): void {
    if (detached || time == null) return;
    if (price != null && !Number.isFinite(price)) return;
    // No engine contract API draws a crosshair yet; the mirror is absorbed here so the bus
    // stays quiet. See the module header — paneSync's onCrosshair callback lands here too.
  }

  // ── outbound: this pane's moves and hovers go to the bus as CALENDAR values ────────────
  const onEngineRange = (range: EngineLogicalRange | null): void => {
    if (detached || range == null) return;
    if (applying && !applyingFromBus) return; // synchronous echo of a parent-applied window
    const win = calendarWindow(range);
    if (!win) return;
    if (echoGuard && sameRange(range, echoGuard)) {
      echoGuard = null; // our own write bouncing back — absorb it, never re-broadcast
      return;
    }
    echoGuard = null;
    // The bus receives the CALENDAR window (epoch ms in the shim's index space), never
    // this pane's bar indexes — a peer with another cadence resolves it through its own axis.
    broadcastRange(id, { from: win.from, to: win.to });
  };

  const onEngineCrosshair = (param: EngineMouseEventParams): void => {
    if (detached) return;
    const peer = engineCrosshairToPeerValue(param, primary);
    broadcastCrosshair(id, (peer ? peer.time : null) as PeerTime);
  };

  // ── the LWC-shaped shims paneSync drives peers through ─────────────────────────────────
  function shimVisibleWindow(): EngineLogicalRange | null {
    if (detached) return null;
    const range = engine.timeScale().getVisibleLogicalRange();
    const win = range ? calendarWindow(range) : null;
    return win ? { from: win.from, to: win.to } : null;
  }

  const timeScaleShim = {
    getVisibleLogicalRange: shimVisibleWindow,
    setVisibleLogicalRange: (range: EngineLogicalRange): void => {
      applyWindowMs(range.from, range.to, true); // paneSync-driven: its echo must reach the bus
    },
    timeToIndex: (time: unknown): number | null => {
      const ms = timeToMs(time);
      return Number.isFinite(ms) ? ms : null;
    },
    getVisibleRange: (): { from: number; to: number } | null => {
      const win = shimVisibleWindow();
      return win ? { from: win.from / 1000, to: win.to / 1000 } : null;
    },
  };

  const chartShim = {
    timeScale: () => timeScaleShim,
    setCrosshairPosition: (price: number, time: EngineTime | null): void => {
      applyPeerCrosshair(time ?? null, price);
    },
    clearCrosshairPosition: (): void => {
      applyPeerCrosshair(null);
    },
  } as unknown as PeerChart;

  // In the ms-indexed virtual axis, "the bar at logical i" is simply the instant i — the
  // identity mapping paneSync's clock (clockFor) interpolates through, so the numbers the
  // bus converts with are exactly the calendar instants we computed above.
  const seriesShim = {
    dataByIndex: (index: number): { time: number } => ({ time: index / 1000 }),
  } as unknown as PeerSeries;

  const valueAt = (time: PeerTime): number | null => {
    const ms = timeToMs(time);
    if (!Number.isFinite(ms)) return null;
    const price = priceAtMs.get(ms);
    return price != null && Number.isFinite(price) ? price : null;
  };

  engine.timeScale().subscribeVisibleLogicalRangeChange(onEngineRange);
  engine.subscribeCrosshairMove(onEngineCrosshair);
  unregisterPane = registerPane(id, {
    chart: chartShim,
    series: seriesShim,
    valueAt,
    tf: opts.tf ?? "",
    onCrosshair: (price: number | null, time: PeerTime) => {
      applyPeerCrosshair(time ?? null, price ?? undefined);
    },
  });

  function detach(): void {
    if (detached) return;
    detached = true;
    try { engine.timeScale().unsubscribeVisibleLogicalRangeChange(onEngineRange); } catch { /* teardown */ }
    try { engine.unsubscribeCrosshairMove(onEngineCrosshair); } catch { /* teardown */ }
    const off = unregisterPane;
    unregisterPane = null;
    try { off?.(); } catch { /* teardown */ }
    restoreDataHooks();
  }

  return {
    detach,
    applyPeerWindow: (from: EngineTime, to: EngineTime): void => {
      applyWindowMs(timeToMs(from), timeToMs(to), false);
    },
    applyPeerCrosshair,
  };
}
