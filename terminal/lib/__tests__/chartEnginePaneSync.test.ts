import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneLink, PaneRegistration } from "@/lib/paneSync";
import { timeToMs } from "@/lib/timeWindow";
import type {
  ChartEngine,
  EngineInventory,
  EngineLogicalRange,
  EngineLogicalRangeHandler,
  EngineMouseEventParams,
  EngineMouseHandler,
  EngineSeriesKind,
  EngineSeriesRow,
  EngineTime,
  PaneHandle,
  PriceLineHandle,
  PriceScaleHandle,
  SeriesHandle,
  TimeScaleHandle,
} from "@/lib/chart-engine/api";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the pane-sync adapter (lib/chart-engine/paneSyncAdapter.ts).
//
// The adapter's job is to stand between the renderer-agnostic ChartEngine contract and
// the paneSync bus, which is LWC-typed. Everything here is contract-level: the engine,
// time scale and series are fakes typed STRUCTURALLY against api.ts (they implement the
// interfaces, so a contract drift fails to compile), and paneSync is vi.mock'd with
// recorders. lib/paneSync.ts's own behaviour is pinned by paneSyncFrame/TimeAxis/
// LinkGroups/Focus suites — this file covers only the adapter's conversions and guards.
//
// The law under test (#642): what crosses the bus is a CALENDAR window, never a bar
// index — the falsifiers at the bottom swap the conversions to raw indexes and this
// suite goes red.
// ─────────────────────────────────────────────────────────────────────────────

const unregisterMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paneSync", () => ({
  registerPane: vi.fn(() => unregisterMock),
  broadcastRange: vi.fn(),
  broadcastCrosshair: vi.fn(),
  setPaneLinks: vi.fn(),
  setPaneSync: vi.fn(),
  paneSyncEnabled: vi.fn(() => false),
  paneLinkOf: vi.fn(() => null),
  registeredPaneIds: vi.fn(() => ""),
  subscribePaneRegistry: vi.fn(() => () => {}),
  subscribePaneVisibleWindow: vi.fn(() => () => {}),
  peerValueAt: vi.fn(() => null),
  requestPaneFocus: vi.fn(() => Promise.resolve({ status: "unavailable" as const })),
}));

import { broadcastCrosshair, broadcastRange, registerPane } from "@/lib/paneSync";
import { attachPaneSync, engineCrosshairToPeerValue, type PaneSyncOpts } from "@/lib/chart-engine/paneSyncAdapter";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const msOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const T0 = Date.UTC(2026, 0, 1);
/** The bus speaks epoch ms; EngineTime on the wire is epoch seconds. */
const sec = (ms: number): EngineTime => ms / 1000;

function businessDays(startISO: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${startISO}T00:00:00Z`);
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** A pane on a uniform cadence: the resolver pair is exactly linear, resolveTime answers integers only. */
function uniformPane(startMs: number, stepMs: number, n: number) {
  return {
    stepMs,
    barMs: (logical: number) => startMs + logical * stepMs,
    resolveTime: (logical: number): EngineTime | null =>
      Number.isInteger(logical) && logical >= 0 && logical < n ? sec(startMs + logical * stepMs) : null,
    resolveLogical: (time: EngineTime): number | null => {
      const ms = timeToMs(time);
      return Number.isFinite(ms) ? (ms - startMs) / stepMs : null;
    },
  };
}

/** Business-day bars: 1- and 3-day gaps interleaved, so fractional interpolation is observable. */
function businessDayPane(bars: string[]) {
  return {
    resolveTime: (logical: number): EngineTime | null =>
      Number.isInteger(logical) && logical >= 0 && logical < bars.length ? bars[logical] : null,
    resolveLogical: (time: EngineTime): number | null => {
      const ms = timeToMs(time);
      return Number.isFinite(ms) ? (ms - msOf(bars[0])) / DAY : null; // calendar-linear, as a daily axis resolves whitespace
    },
  };
}

// ── Contract fakes ────────────────────────────────────────────────────────────
// The engine fires visible-range events like LWC does: programmatic writes land on a
// LATER frame (`flush()`), and `delivery: "sync"` models a renderer that fires inside
// the call — the case the re-entrancy flag exists for.

class FakeTimeScale implements TimeScaleHandle {
  range: EngineLogicalRange | null = null;
  writeLog: EngineLogicalRange[] = [];
  readonly subscribes: EngineLogicalRangeHandler[] = [];
  readonly unsubscribes: EngineLogicalRangeHandler[] = [];
  private readonly listeners = new Set<EngineLogicalRangeHandler>();
  private pending = false;

  constructor(readonly delivery: "queued" | "sync" = "queued") {}

  subscribeVisibleLogicalRangeChange(handler: EngineLogicalRangeHandler): void {
    this.listeners.add(handler);
    this.subscribes.push(handler);
  }
  unsubscribeVisibleLogicalRangeChange(handler: EngineLogicalRangeHandler): void {
    this.listeners.delete(handler);
    this.unsubscribes.push(handler);
  }
  getVisibleLogicalRange(): EngineLogicalRange | null {
    return this.range ? { ...this.range } : null;
  }
  setVisibleLogicalRange(range: EngineLogicalRange): void {
    expect(range.from, "the engine asserts from <= to").toBeLessThanOrEqual(range.to);
    this.writeLog.push({ ...range });
    this.range = { ...range };
    if (this.delivery === "sync") this.fire();
    else this.pending = true;
  }
  /** The user drags/zooms this pane: the range changes and the event lands immediately. */
  userView(range: EngineLogicalRange): void {
    this.range = { ...range };
    this.fire();
  }
  /** Deliver the range event a real renderer queues — one animation frame. */
  flush(): void {
    if (!this.pending) return;
    this.pending = false;
    this.fire();
  }
  private fire(): void {
    const r = this.range ? { ...this.range } : null;
    for (const l of [...this.listeners]) l(r);
  }

  timeToCoordinate(): number | null { throw new Error("not part of this contract test"); }
  coordinateToTime(): EngineTime | null { throw new Error("not part of this contract test"); }
  scrollToRealtime(): void { throw new Error("not part of this contract test"); }
  scrollToPosition(): void { throw new Error("not part of this contract test"); }
  applyOptions(): void { throw new Error("not part of this contract test"); }
  fitContent(): void { throw new Error("not part of this contract test"); }
  unwrap<T>(): T { throw new Error("not part of this contract test"); }
}

class FakeSeries implements SeriesHandle {
  readonly kind: EngineSeriesKind = "candles";
  rows: EngineSeriesRow[] = [];
  readonly updates: EngineSeriesRow[] = [];

  setData(rows: EngineSeriesRow[]): void { this.rows = rows; }
  update(row: EngineSeriesRow): void { this.updates.push(row); }
  applyOptions(): void { throw new Error("not part of this contract test"); }
  setMarkers(): void { throw new Error("not part of this contract test"); }
  createPriceLine(): PriceLineHandle { throw new Error("not part of this contract test"); }
  priceToCoordinate(price: number): number | null { return (price - 10) / 2; }
  coordinateToPrice(y: number): number | null { return y * 2 + 10; }
  paneIndex(): number { return 0; }
  pane(): PaneHandle { throw new Error("not part of this contract test"); }
  moveToPane(): void { throw new Error("not part of this contract test"); }
  attachPrimitive(): void { throw new Error("not part of this contract test"); }
  detachPrimitive(): void { throw new Error("not part of this contract test"); }
  remove(): void { throw new Error("not part of this contract test"); }
  unwrap<T>(): T { throw new Error("not part of this contract test"); }
}

class FakeEngine implements ChartEngine {
  readonly ts: FakeTimeScale;
  readonly primary: FakeSeries;
  readonly crosshairSubscribes: EngineMouseHandler[] = [];
  readonly crosshairUnsubscribes: EngineMouseHandler[] = [];
  private readonly crosshairListeners = new Set<EngineMouseHandler>();

  constructor(ts: FakeTimeScale, primary: FakeSeries) {
    this.ts = ts;
    this.primary = primary;
  }

  timeScale(): TimeScaleHandle { return this.ts; }
  addSeries(): SeriesHandle {
    throw new Error("not part of this contract test");
  }
  panes(): PaneHandle[] { throw new Error("not part of this contract test"); }
  priceScale(): PriceScaleHandle { throw new Error("not part of this contract test"); }
  paneSize(): { width: number; height: number } { throw new Error("not part of this contract test"); }
  swapPanes(): void { throw new Error("not part of this contract test"); }
  takeScreenshot(): HTMLCanvasElement { throw new Error("not part of this contract test"); }
  applyOptions(): void { throw new Error("not part of this contract test"); }
  subscribeCrosshairMove(handler: EngineMouseHandler): void { this.crosshairListeners.add(handler); this.crosshairSubscribes.push(handler); }
  unsubscribeCrosshairMove(handler: EngineMouseHandler): void { this.crosshairListeners.delete(handler); this.crosshairUnsubscribes.push(handler); }
  subscribeClick(): void { throw new Error("not part of this contract test"); }
  unsubscribeClick(): void { throw new Error("not part of this contract test"); }
  subscribeDblClick(): void { throw new Error("not part of this contract test"); }
  unsubscribeDblClick(): void { throw new Error("not part of this contract test"); }
  setWatermark(): void { throw new Error("not part of this contract test"); }
  resize(): void { throw new Error("not part of this contract test"); }
  unwrap<T>(): T { throw new Error("not part of this contract test"); }
  inventory(): EngineInventory { throw new Error("not part of this contract test"); }
  destroy(): void { this.crosshairListeners.clear(); }

  crosshairMove(param: EngineMouseEventParams): void {
    for (const h of [...this.crosshairListeners]) h(param);
  }
}

function mount(
  pane: Pick<PaneSyncOpts, "resolveTime" | "resolveLogical">,
  o: { paneId?: string; tf?: string; delivery?: "queued" | "sync"; linkGroup?: PaneLink } = {},
) {
  const ts = new FakeTimeScale(o.delivery ?? "queued");
  const primary = new FakeSeries();
  const engine = new FakeEngine(ts, primary);
  const sync = attachPaneSync(engine, primary, {
    paneId: o.paneId ?? "7",
    tf: o.tf,
    linkGroup: o.linkGroup,
    resolveTime: pane.resolveTime,
    resolveLogical: pane.resolveLogical,
  });
  return { ts, engine, primary, sync };
}

const bar = (time: string, close: number) => ({ time, open: close - 1, high: close + 1, low: close - 2, close });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("attachPaneSync: registration and lifecycle", () => {
  it("registers through paneSync with a numeric id and a ChartPanel-shaped registration", () => {
    const { primary } = mount(uniformPane(T0, HOUR, 10), { paneId: "7", tf: "D" });

    expect(registerPane).toHaveBeenCalledTimes(1);
    const [regId, reg] = vi.mocked(registerPane).mock.calls[0];
    expect(regId).toBe(7);
    expect(reg.tf).toBe("D");

    // valueAt answers from the data the pane pushes through the CONTRACT handle — the
    // shadow paneSync's peers read, exactly what ChartPanel's bar store feeds it today.
    primary.setData([bar("2026-01-05", 101.5), bar("2026-01-06", 102.25), { time: "2026-01-07" }]);
    expect(reg.valueAt("2026-01-06")).toBe(102.25);
    expect(reg.valueAt("2026-01-07")).toBeNull(); // whitespace: a slot with no value
    expect(reg.valueAt("2026-02-01")).toBeNull(); // not plotted
    primary.update(bar("2026-01-08", 99));
    expect(reg.valueAt("2026-01-08")).toBe(99);

    // A mirrored crosshair lands on the pane without re-broadcasting (paneSync's own callback).
    expect(typeof reg.onCrosshair).toBe("function");
    reg.onCrosshair?.(123.5, "2026-01-06");
    expect(broadcastCrosshair).not.toHaveBeenCalled();
    expect(() => reg.chart.setCrosshairPosition(123.5, "2026-01-06", reg.series)).not.toThrow();
    expect(() => reg.chart.clearCrosshairPosition()).not.toThrow();

    // The shims paneSync converts through never throw on a chartless engine.
    expect(reg.chart.timeScale().getVisibleLogicalRange()).toBeNull();
  });

  it("subscribes through the engine contract (timeScale range + crosshairMove)", () => {
    const { ts, engine } = mount(uniformPane(T0, HOUR, 10));
    expect(ts.subscribes).toHaveLength(1);
    expect(engine.crosshairMove).toBeDefined();
  });

  it("detach unregisters and unsubscribes exactly once, and nothing broadcasts afterwards", () => {
    const { ts, engine, sync } = mount(uniformPane(T0, HOUR, 10));
    sync.detach();
    sync.detach(); // idempotent

    expect(unregisterMock).toHaveBeenCalledTimes(1);
    expect(ts.unsubscribes).toHaveLength(1);        // the range handler, once
    expect(ts.unsubscribes[0]).toBe(ts.subscribes[0]);
    expect(engine.crosshairUnsubscribes).toHaveLength(1); // the crosshair handler, once
    expect(engine.crosshairUnsubscribes[0]).toBe(engine.crosshairSubscribes[0]);

    ts.userView({ from: 2, to: 8 });
    expect(broadcastRange).not.toHaveBeenCalled();
    expect(ts.writeLog).toHaveLength(0); // post-detach writes are refused too
  });

  it("restores the series data hooks it wrapped", () => {
    const { primary, sync } = mount(uniformPane(T0, HOUR, 10));
    sync.detach();
    primary.setData([bar("2026-01-05", 1)]);
    expect(primary.rows).toEqual([bar("2026-01-05", 1)]); // the original path still works
  });

  it("rejects a malformed paneId or linkGroup before touching the bus", () => {
    const pane = uniformPane(T0, HOUR, 10);
    const ts = new FakeTimeScale();
    const primary = new FakeSeries();
    const engine = new FakeEngine(ts, primary);
    expect(() => attachPaneSync(engine, primary, { paneId: "left", resolveTime: pane.resolveTime, resolveLogical: pane.resolveLogical }))
      .toThrow(RangeError);
    expect(() => attachPaneSync(engine, primary, {
      paneId: "1",
      linkGroup: { group: "", crosshair: true, window: true },
      resolveTime: pane.resolveTime,
      resolveLogical: pane.resolveLogical,
    })).toThrow(TypeError);
    expect(registerPane).not.toHaveBeenCalled();
    expect(ts.subscribes).toHaveLength(0);
  });
});

describe("outbound range: the bus carries a CALENDAR window, never bar indexes", () => {
  it("interpolates fractional edges between neighbour bar times", () => {
    const bars = businessDays("2026-01-05", 40); // Mon-start: 1-day steps, 3-day weekend gaps
    const { ts } = mount(businessDayPane(bars));

    ts.userView({ from: 5.5, to: 20.25 });

    expect(broadcastRange).toHaveBeenCalledTimes(1);
    const [id, win] = vi.mocked(broadcastRange).mock.calls[0];
    expect(id).toBe(7);
    // Half a bar past Friday's close is Saturday noon; a quarter past bar 20 is its own gap fraction.
    const a5 = msOf(bars[5]), a6 = msOf(bars[6]), a20 = msOf(bars[20]), a21 = msOf(bars[21]);
    expect(win).toEqual({ from: a5 + (a6 - a5) * 0.5, to: a20 + (a21 - a20) * 0.25 });
    // …and that is epoch MILLISECONDS, not the fractional indexes 5.5 / 20.25 raw.
    expect(win!.from).toBeGreaterThan(1e12);
    expect(win!.from).not.toBe(5.5);
    expect(win!.to).not.toBe(20.25);
  });

  it("extrapolates by the sampled cadence past the last bar and before the first", () => {
    const bars = businessDays("2026-01-05", 30);
    const { ts } = mount(businessDayPane(bars));

    ts.userView({ from: -2, to: bars.length - 1 + 3 });

    const [, win] = vi.mocked(broadcastRange).mock.calls[0];
    const medianStep = DAY; // 1- and 3-day gaps: the median adjacent gap is one day
    expect(win).toEqual({
      from: msOf(bars[0]) - 2 * medianStep,
      to: msOf(bars[bars.length - 1]) + 3 * medianStep,
    });
  });

  it("broadcasts nothing for a pane with no resolvable bars", () => {
    const { ts, sync } = mount(uniformPane(T0, HOUR, 0));
    expect(() => ts.userView({ from: 1, to: 5 })).not.toThrow();
    expect(broadcastRange).not.toHaveBeenCalled();
    expect(() => sync.applyPeerWindow(sec(T0 + HOUR), sec(T0 + 5 * HOUR))).not.toThrow();
    expect(ts.writeLog).toHaveLength(0);
  });
});

describe("inbound range: peer windows map through THIS pane's own axis", () => {
  it("a peer window with a different cadence lands on the right logical range here", () => {
    // THIS pane: 4h bars. The same calendar window on the 1h peer it came from spans
    // logical 10…122 THERE; here it must resolve through THIS pane's 4h axis instead.
    const pane = uniformPane(T0, 4 * HOUR, 100);
    const { ts, sync } = mount(pane);

    sync.applyPeerWindow(sec(pane.barMs(2.5)), sec(pane.barMs(30.5)));

    expect(ts.writeLog).toHaveLength(1);
    expect(ts.writeLog[0].from).toBeCloseTo(2.5, 10);
    expect(ts.writeLog[0].to).toBeCloseTo(30.5, 10);
  });

  it("skips the write when the resolver cannot place the window", () => {
    const { ts, sync } = mount({
      resolveTime: uniformPane(T0, HOUR, 10).resolveTime,
      resolveLogical: () => null, // an axis that refuses windows outside its data
    });
    expect(() => sync.applyPeerWindow(sec(T0), sec(T0 + 5 * HOUR))).not.toThrow();
    expect(ts.writeLog).toHaveLength(0);
    expect(broadcastRange).not.toHaveBeenCalled();
  });
});

describe("echo suppression (I03-A02): no feedback loop", () => {
  it("applying a peer window does not re-broadcast — and does not deafen the pane", () => {
    const pane = uniformPane(T0, HOUR, 100);
    const { ts, sync } = mount(pane);

    ts.userView({ from: 10, to: 50 }); // a genuine user move broadcasts the calendar window
    expect(broadcastRange).toHaveBeenCalledTimes(1);
    vi.mocked(broadcastRange).mockClear();

    sync.applyPeerWindow(sec(pane.barMs(2.5)), sec(pane.barMs(30.5)));
    expect(ts.writeLog).toHaveLength(1);              // the window WAS adopted…
    expect(broadcastRange).not.toHaveBeenCalled();    // …without a synchronous re-broadcast
    ts.flush();                                       // …and the engine's echo frame is absorbed
    expect(broadcastRange).not.toHaveBeenCalled();

    sync.applyPeerWindow(sec(pane.barMs(2.5)), sec(pane.barMs(30.5))); // same window again
    expect(ts.writeLog).toHaveLength(1);              // no redundant write → no echo at all
    ts.flush();
    expect(broadcastRange).not.toHaveBeenCalled();

    ts.userView({ from: 60, to: 90 });                // a later genuine move still propagates
    expect(broadcastRange).toHaveBeenCalledTimes(1);
    const [, win] = vi.mocked(broadcastRange).mock.calls[0];
    expect(win).toEqual({ from: pane.barMs(60), to: pane.barMs(90) });
  });

  it("swallows a synchronously delivered echo with the re-entrancy guard", () => {
    const pane = uniformPane(T0, HOUR, 100);
    const { ts, sync } = mount(pane, { delivery: "sync" });

    ts.userView({ from: 5, to: 9 }); // sanity: events DO fire synchronously in this mode
    expect(broadcastRange).toHaveBeenCalledTimes(1);
    vi.mocked(broadcastRange).mockClear();

    // The write fires the range handler INSIDE applyPeerWindow; the guard keeps it quiet.
    expect(() => sync.applyPeerWindow(sec(pane.barMs(2.5)), sec(pane.barMs(30.5)))).not.toThrow();
    expect(broadcastRange).not.toHaveBeenCalled();

    ts.userView({ from: 40, to: 44 }); // the guard suppresses only our own echo
    expect(broadcastRange).toHaveBeenCalledTimes(1);
  });

  it("lets the echo of a BUS-driven write reach the bus — paneSync's echo token must be consumed", () => {
    // paneSync drives a peer by arming `echoOf` and calling the registration's
    // setVisibleLogicalRange. Its echo HAS to come back as a broadcast for the bus to
    // absorb it; swallowing it here would drop this pane's next genuine move.
    const pane = uniformPane(T0, HOUR, 100);
    const { ts } = mount(pane, { delivery: "sync" });
    const reg: PaneRegistration = vi.mocked(registerPane).mock.calls[0][1];

    const fromMs = pane.barMs(2.5);
    const toMs = pane.barMs(30.5);
    reg.chart.timeScale().setVisibleLogicalRange({ from: fromMs, to: toMs }); // exactly what paneSync does

    // The bus-space write was converted into THIS pane's engine logical range…
    expect(ts.writeLog).toHaveLength(1);
    expect(ts.writeLog[0].from).toBeCloseTo(2.5, 10);
    expect(ts.writeLog[0].to).toBeCloseTo(30.5, 10);
    // …and its (synchronous) echo went back out as the same calendar window.
    expect(broadcastRange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(broadcastRange).mock.calls[0]).toEqual([7, { from: fromMs, to: toMs }]);
  });
});

describe("crosshair: the hovered time travels, priced on the primary series", () => {
  it("broadcasts the hovered time and prices it from the primary series", () => {
    const { engine, primary } = mount(uniformPane(T0, HOUR, 10));
    const param: EngineMouseEventParams = { time: 1735772400, point: { x: 12, y: 42 } };

    engine.crosshairMove(param);
    expect(broadcastCrosshair).toHaveBeenCalledTimes(1);
    expect(vi.mocked(broadcastCrosshair).mock.calls[0]).toEqual([7, 1735772400]);

    // The peer-value helper carries BOTH halves: time + the price under the pointer.
    expect(engineCrosshairToPeerValue(param, primary)).toEqual({ time: 1735772400, price: 42 * 2 + 10 });
  });

  it("broadcasts null when the pointer leaves, and a time without a point prices null", () => {
    const { engine, primary } = mount(uniformPane(T0, HOUR, 10));
    engine.crosshairMove({ point: { x: 3, y: 4 } });
    expect(broadcastCrosshair).toHaveBeenCalledTimes(1);
    expect(vi.mocked(broadcastCrosshair).mock.calls[0]).toEqual([7, null]);

    expect(engineCrosshairToPeerValue({ time: 1735772400 }, primary)).toEqual({ time: 1735772400, price: null });
    expect(engineCrosshairToPeerValue({}, primary)).toBeNull();
  });
});
