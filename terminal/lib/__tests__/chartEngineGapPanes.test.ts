// Gap-pane tests for the chart-engine acceptance matrix.
//
// Rows proved here:
//   I02-A02: Collapsed pane reopened -> Drawing/time/price meaning remains identical once scale is truly ready.
//   I03-A02: Register/unregister/reuse pane slot -> Old queued crosshair cannot target new registration.
//   I03-A03: Group plan changes before RAF fires -> Old-plan event is discarded; no echo loop.
//
// These tests ride the bridge (drawingBridge) and the cross-pane sync bus
// (paneSync). Mutant receipts (mutate the implementation, run RED, restore,
// run GREEN) are performed by the runner OUTSIDE this file and quoted in
// RESULT.md; no mutation is ever committed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChartEngine,
  EngineLogicalRange,
  EngineLogicalRangeHandler,
  EngineTime,
  SeriesHandle,
  TimeScaleHandle,
} from "../chart-engine/api";
import {
  createDrawingBridge,
  type DrawingAnchor,
} from "../chart-engine/drawingBridge";
import { futureCadence } from "../chart-engine/futureTime";
import {
  broadcastCrosshair,
  registerPane,
  setPaneLinks,
  setPaneSync,
  type PaneLink,
} from "../paneSync";

// ─────────────────────────────────────────────────────────────────────────────
// I02-A02 — collapsed pane reopening keeps anchor meaning identical once the
// scale is truly ready. The bridge gates every resolution on priceRoundTripHealthy:
// while a pane's price<->coordinate map is degenerate (collapsed pane, scale not
// healed) the bridge returns null AND never mutates the anchor the caller passed.
// ─────────────────────────────────────────────────────────────────────────────

type PaneSpec = {
  width: number;
  height: number;
  priceAtTop: number;
  priceAtBottom: number;
};

// Two panes with different price maps so pane-scoping is observable.
const SPECS: PaneSpec[] = [
  { width: 600, height: 300, priceAtTop: 200, priceAtBottom: -100 },
  { width: 600, height: 300, priceAtTop: 300, priceAtBottom: 0 },
];
// Ten daily bars; range {-1, 11} → barSpacing 600/12 = 50, bar i centred at (i + 1.5) * 50.
const TIMES = Array.from({ length: 10 }, (_, i) =>
  new Date(Date.UTC(2026, 8, i + 1)).toISOString().slice(0, 10));

function makeBridgeHarness() {
  const scaleDegenerate = [false, true];
  const paneHeights = [SPECS[0].height, 0];

  const series = SPECS.map((spec, paneIndex) => ({
    priceToCoordinate: (price: number): number | null => {
      if (scaleDegenerate[paneIndex]) return 0;
      const { priceAtTop, priceAtBottom, height } = spec;
      return (priceAtTop - price) * (height - 1) / (priceAtTop - priceAtBottom);
    },
    coordinateToPrice: (y: number): number | null => {
      if (scaleDegenerate[paneIndex]) return 0;
      const { priceAtTop, priceAtBottom, height } = spec;
      return priceAtTop - y * (priceAtTop - priceAtBottom) / (height - 1);
    },
  }));

  let range: EngineLogicalRange = { from: -1, to: 11 };
  const rangeHandlers = new Set<EngineLogicalRangeHandler>();
  const barSpacing = () => 600 / (range.to - range.from);

  const timeScale: TimeScaleHandle = {
    getVisibleLogicalRange: () => ({ ...range }),
    setVisibleLogicalRange: (next: EngineLogicalRange) => { range = { ...next }; },
    subscribeVisibleLogicalRangeChange: (h: EngineLogicalRangeHandler) => { rangeHandlers.add(h); },
    unsubscribeVisibleLogicalRangeChange: (h: EngineLogicalRangeHandler) => { rangeHandlers.delete(h); },
    timeToCoordinate: (time: EngineTime): number | null => {
      const i = TIMES.findIndex((known) => String(known) === String(time));
      return i < 0 ? null : (i - range.from + 0.5) * barSpacing();
    },
    coordinateToTime: (x: number): EngineTime | null => {
      const i = Math.round(x / barSpacing() + range.from - 0.5);
      return i >= 0 && i < TIMES.length ? TIMES[i] : null;
    },
  } as unknown as TimeScaleHandle;

  const engine = {
    timeScale: () => timeScale,
    paneSize: (paneIndex?: number) => {
      const spec = SPECS[paneIndex ?? 0];
      return { width: spec.width, height: paneHeights[paneIndex ?? 0] };
    },
  } as unknown as ChartEngine;

  const tasks: { run: () => void }[] = [];
  const bridge = createDrawingBridge(engine, {
    primaryByPane: (paneIndex: number): SeriesHandle | null => series[paneIndex] as unknown as SeriesHandle,
    cadence: () => futureCadence(TIMES),
    lastBarTime: (): EngineTime | null => TIMES[TIMES.length - 1],
    scheduler: (run: () => void) => { tasks.push({ run }); return () => { tasks.length = 0; }; },
  });

  return {
    bridge,
    setScaleDegenerate: (paneIndex: number, value: boolean) => { scaleDegenerate[paneIndex] = value; },
    setPaneHeight: (paneIndex: number, height: number) => { paneHeights[paneIndex] = height; },
    setRange: (from: number, to: number) => {
      range = { from, to };
      [...rangeHandlers].forEach((h) => h({ ...range }));
    },
    flushScheduler: () => { tasks.splice(0).forEach((t) => t.run()); },
    barSpacing: () => barSpacing(),
  };
}

const anchor = (over: Partial<DrawingAnchor> & Pick<DrawingAnchor, "paneIndex">): DrawingAnchor => ({
  time: null,
  logical: 3,
  price: 50,
  ...over,
});

describe("I02-A02: Collapsed pane reopened -> Drawing/time/price meaning remains identical once scale is truly ready", () => {
  it("refuses every projection while the pane is collapsed, without mutating the caller-owned anchor", () => {
    const h = makeBridgeHarness();
    const onPane1 = anchor({ paneIndex: 1, time: TIMES[3], logical: 3, price: 50 });

    // Fully collapsed: paneSize.height = 0 AND scale degenerate. The bridge
    // must report not-ready and refuse every projection; the caller-owned
    // anchor must come back deep-equal from the refused call.
    h.setPaneHeight(1, 0);
    h.setScaleDegenerate(1, true);
    expect(h.bridge.ready(1)).toBe(false);
    expect(h.bridge.anchorToPixel(onPane1)).toBeNull();
    expect(h.bridge.pixelToAnchor(1, 200, 150, "raw")).toBeNull();
    expect(h.bridge.pixelToAnchor(1, 200, 150, "snapBar")).toBeNull();
    expect(h.bridge.translateAnchor(onPane1, 5, 5)).toBeNull();
    expect(onPane1).toEqual({ paneIndex: 1, time: TIMES[3], logical: 3, price: 50 });
    expect(h.bridge.clampToPane(1, -5, 4000).clamped).toBe(false);
  });

  it("keeps reporting not-ready after a resize that has not yet produced a usable coordinate map", () => {
    const h = makeBridgeHarness();
    // Reopen the height (the pane has been laid out again) but leave the scale
    // degenerate. The intermediate state: the engine reports a positive pane
    // size, yet the bridge must still refuse until the round trip is healthy.
    h.setPaneHeight(1, 300);
    expect(h.bridge.ready(1)).toBe(false);
    expect(h.bridge.anchorToPixel(anchor({ paneIndex: 1, time: TIMES[3], logical: 3, price: 50 }))).toBeNull();
    expect(h.bridge.pixelToAnchor(1, 200, 150, "raw")).toBeNull();
  });

  it("projects and round-trips identically once the scale is truly ready", () => {
    const h = makeBridgeHarness();
    // Pane 1's price map: priceAtTop=300, priceAtBottom=0, height=300.
    // For price 150 the bridge yields y = (300 - 150) * 299 / 300 = 149.5
    // and the inverse recovers 150 — a clean round trip.
    const onPane1: DrawingAnchor = { paneIndex: 1, time: TIMES[3], logical: 3, price: 150 };

    h.setPaneHeight(1, 300);
    h.setScaleDegenerate(1, false);
    expect(h.bridge.ready(1)).toBe(true);

    const px = h.bridge.anchorToPixel(onPane1);
    expect(px).not.toBeNull();
    expect(px!.x).toBeCloseTo((3 + 1.5) * 50, 9);
    expect(px!.y).toBeCloseTo((300 - 150) * 299 / 300, 9);

    // pixel→anchor round-trips to the IDENTICAL (paneIndex, time, price) the
    // caller stored, modulo the trivial logical (which the bridge recomputes
    // through the projection but the durable time address must match).
    // snapBar mode is required for the time to come back — raw mode keeps no
    // bar time on a real (non-future) pixel (drawingBridge.ts: pixelToAnchor).
    const back = h.bridge.pixelToAnchor(1, px!.x, px!.y, "snapBar");
    expect(back).not.toBeNull();
    expect(back!.paneIndex).toBe(onPane1.paneIndex);
    expect(back!.time).toBe(onPane1.time);
    expect(back!.price).toBe(onPane1.price);
    expect(back!.logical).toBeCloseTo(onPane1.logical, 9);
  });

  it("control: without a collapse the bridge always reports ready", () => {
    const h = makeBridgeHarness();
    // Pane 0 is healthy by default; restore pane 1 to a usable state too.
    h.setPaneHeight(1, 300);
    h.setScaleDegenerate(1, false);
    expect(h.bridge.ready(0)).toBe(true);
    expect(h.bridge.ready(1)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I03-A02 / I03-A03 — pane-slot reuse and plan-change echo discipline on the
// paneSync bus. The bus stores one queued crosshair (pendingCrosshair with
// fromId + source + epoch + time) and flushes it on requestAnimationFrame;
// stale samples must never speak for a new owner of the same slot, and a
// plan change before flush must drop the queued sample.
// ─────────────────────────────────────────────────────────────────────────────

type MockPeer = {
  peer: Parameters<typeof registerPane>[1];
  setCrosshairPosition: ReturnType<typeof vi.fn>;
  clearCrosshairPosition: ReturnType<typeof vi.fn>;
  onCrosshair: ReturnType<typeof vi.fn>;
};

function mockPeer(value: number, tf = "D"): MockPeer {
  const setCrosshairPosition = vi.fn();
  const clearCrosshairPosition = vi.fn();
  const onCrosshair = vi.fn();
  return {
    setCrosshairPosition,
    clearCrosshairPosition,
    onCrosshair,
    peer: {
      chart: { setCrosshairPosition, clearCrosshairPosition } as unknown as MockPeer["peer"]["chart"],
      series: {} as unknown as MockPeer["peer"]["series"],
      valueAt: () => value,
      tf,
      onCrosshair,
    },
  };
}

let frames: Array<FrameRequestCallback | null> = [];
let cancelled: Set<number>;
function manualFrames() {
  frames = [];
  cancelled = new Set();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { cancelled.add(id); });
}
function runFrames() { const due = frames; frames = []; for (const cb of due) cb?.(16); }

beforeEach(() => {
  setPaneSync(false);
  setPaneLinks({});
});

afterEach(() => {
  setPaneSync(false);
  setPaneLinks({});
  vi.unstubAllGlobals();
});

const link = (group: string, crosshair = true, window = true): PaneLink => ({ group, crosshair, window });

describe("I03-A02: Register/unregister/reuse pane slot -> Old queued crosshair cannot target new registration", () => {
  it("a queued crosshair drops when the source slot is unregistered before paint", () => {
    manualFrames();
    const source = mockPeer(100);
    const target = mockPeer(200);
    const offSource = registerPane(1, source.peer);
    const offTarget = registerPane(2, target.peer);
    setPaneLinks({ 1: link("A"), 2: link("A") });
    target.onCrosshair.mockClear();
    target.setCrosshairPosition.mockClear();

    broadcastCrosshair(1, "2026-09-19" as unknown as Parameters<typeof broadcastCrosshair>[1]);
    expect(frames).toHaveLength(1);

    offSource();
    runFrames();
    expect(target.setCrosshairPosition).toHaveBeenCalledTimes(0);
    expect(target.onCrosshair).toHaveBeenCalledTimes(0);

    offTarget();
  });

  it("a queued crosshair cannot speak for a NEW owner that re-registered the same slot id before paint", () => {
    manualFrames();
    const oldSource = mockPeer(100);
    const newSource = mockPeer(300);
    const target = mockPeer(200);
    const offOld = registerPane(1, oldSource.peer);
    const offTarget = registerPane(2, target.peer);
    setPaneLinks({ 1: link("A"), 2: link("A") });
    target.onCrosshair.mockClear();
    target.setCrosshairPosition.mockClear();

    broadcastCrosshair(1, "2026-09-19" as unknown as Parameters<typeof broadcastCrosshair>[1]);
    expect(frames).toHaveLength(1);

    // The slot is re-registered (symbol switch, remount) BEFORE the frame
    // fires — this is the case the identity check exists for. The new owner's
    // setCrosshairPosition MUST NOT be invoked for the sample the retired
    // registration queued. The unregister of the old owner is delayed until
    // after the flush, otherwise the cancel-on-unregister path would preempt
    // the identity check.
    const offNew = registerPane(1, newSource.peer);
    runFrames();
    expect(target.setCrosshairPosition).toHaveBeenCalledTimes(0);
    expect(target.onCrosshair).toHaveBeenCalledTimes(0);

    // After the swap, a FRESH broadcast from the new owner IS delivered: the
    // identity check is per-queued-sample, not a permanent lock-out.
    broadcastCrosshair(1, "2026-09-20" as unknown as Parameters<typeof broadcastCrosshair>[1]);
    runFrames();
    expect(target.setCrosshairPosition).toHaveBeenCalledTimes(1);
    expect(target.setCrosshairPosition).toHaveBeenLastCalledWith(
      200,
      "2026-09-20",
      target.peer.series,
    );

    offOld();
    offNew();
    offTarget();
  });

  it("control: without the re-registration the queued crosshair IS delivered", () => {
    manualFrames();
    const source = mockPeer(100);
    const target = mockPeer(200);
    const offSource = registerPane(1, source.peer);
    const offTarget = registerPane(2, target.peer);
    setPaneLinks({ 1: link("A"), 2: link("A") });

    broadcastCrosshair(1, "2026-09-19" as unknown as Parameters<typeof broadcastCrosshair>[1]);
    runFrames();
    expect(target.setCrosshairPosition).toHaveBeenCalledTimes(1);
    expect(target.setCrosshairPosition).toHaveBeenLastCalledWith(
      200,
      "2026-09-19",
      target.peer.series,
    );

    offSource();
    offTarget();
  });
});

describe("I03-A03: Group plan changes before RAF fires -> Old-plan event is discarded; no echo loop", () => {
  it("a queued crosshair under the previous plan is discarded when setPaneLinks advances the plan before paint", () => {
    manualFrames();
    const a = mockPeer(100);
    const b = mockPeer(200);
    const c = mockPeer(300);
    registerPane(0, a.peer);
    registerPane(1, b.peer);
    registerPane(2, c.peer);
    setPaneLinks({ 0: link("A"), 1: link("A"), 2: link("B") });

    broadcastCrosshair(0, "2026-09-19" as unknown as Parameters<typeof broadcastCrosshair>[1]);
    expect(frames).toHaveLength(1);

    // Regroup: pane 0 leaves group A; the queued sample must not be delivered
    // to the OLD group (1 was in A) nor to the NEW one (1 stayed in A under
    // the new plan, but the sample was queued before — so it is stale).
    setPaneLinks({ 0: link("B"), 1: link("A"), 2: link("B") });
    runFrames();
    expect(b.setCrosshairPosition).toHaveBeenCalledTimes(0);
    expect(c.setCrosshairPosition).toHaveBeenCalledTimes(0);
  });

  it("a queued crosshair under the legacy plan is discarded when setPaneSync advances the plan before paint", () => {
    manualFrames();
    // A non-null plan is required first: setPaneSync(true) bumps planEpoch
    // (and switches to the legacy plan) WITHOUT calling cancelPendingCrosshair.
    // The queued sample therefore survives to flush, where the `next.epoch ===
    // planEpoch` check in flushCrosshairFrame is the sole defence.
    setPaneLinks({ 0: link("A"), 1: link("A") });
    const a = mockPeer(100);
    const b = mockPeer(200);
    registerPane(0, a.peer);
    registerPane(1, b.peer);
    b.setCrosshairPosition.mockClear();

    broadcastCrosshair(0, "2026-09-19" as unknown as Parameters<typeof broadcastCrosshair>[1]);
    expect(frames).toHaveLength(1);

    // Switch to the legacy plan: planEpoch advances, the queued sample keeps
    // its old epoch. flush must discard it on the epoch guard.
    setPaneSync(true);
    runFrames();
    expect(b.setCrosshairPosition).toHaveBeenCalledTimes(0);
  });

  it("echo: with the plan unchanged, B's handler calling broadcastCrosshair back does not loop to A across 3 rAF turns", () => {
    manualFrames();
    const a = mockPeer(100);
    const b = mockPeer(200);
    registerPane(0, a.peer);
    registerPane(1, b.peer);
    setPaneLinks({ 0: link("A"), 1: link("A") });

    // Echo through the hook attachPaneSync actually registers: paneSyncAdapter
    // wires the peer's `onCrosshair` (paneSyncAdapter.ts:399-401) and its
    // chartShim.setCrosshairPosition (:370-372) into applyPeerCrosshair, which
    // today ABSORBS the mirror. A consumer that instead re-broadcasts from that
    // delivery must be stopped by the bus's `applying` guard (paneSync.ts:272).
    let echoBroadcastCalls = 0;
    b.onCrosshair.mockImplementation((_price: number | null, time: unknown) => {
      echoBroadcastCalls += 1;
      broadcastCrosshair(1, time as Parameters<typeof broadcastCrosshair>[1]);
    });

    broadcastCrosshair(0, "2026-09-19" as unknown as Parameters<typeof broadcastCrosshair>[1]);
    runFrames();
    runFrames();
    runFrames();

    // A's setCrosshairPosition was never invoked across 3 rAF turns: no loop.
    expect(a.setCrosshairPosition).toHaveBeenCalledTimes(0);
    // Only the original call reached the bus with an effect at flush time;
    // the in-delivery echo attempt was suppressed by the bus's `applying`
    // re-entrancy guard.
    expect(echoBroadcastCalls).toBe(1);
  });
});