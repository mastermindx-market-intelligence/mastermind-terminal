// @vitest-environment jsdom
//
// chartEngineGapDrawingAnchor.test.ts — pins the D01-A02 stale-logical guard in
// lib/chart-engine/drawingBridge.ts `resolveX` (drawing review F5, lane GAP-DBFIX).
//
// Defect pinned here: a time-keyed, NON-future anchor whose time the shared time
// scale can no longer address — the primary series was emptied with setData([]),
// the symbol was switched, or a re-aggregation dropped the anchor's bar — used to
// fall through to step 3 and resolve through `projection.xOfLogical(anchor.logical)`.
// That `logical` is a stale row index belonging to the OLD series, so the bridge
// reported a confident pixel for a drawing it cannot place: measured x=1500 in a
// 600px pane. Row D01-A02 ("Existing anchor policy applies; no accidental
// row-index rebinding") forbids exactly this — such an anchor has NO x.
//
// Two negative pins keep the fix narrow:
//   • a RAW anchor (time == null, finite logical) still travels through xOfLogical;
//   • a FUTURE anchor holding a stored slot still resolves through the slot path.
// Together they reject the hoisted guard (before step 3) and the bare `return null`
// stronger variant, both of which would widen the refusal past the time branch.
//
// Engine: impl "mm" — createCanvasEngine + createManualScheduler with a recording
// fake CanvasRenderingContext2D (house precedent: chartEngineGapDrawing.test.ts,
// chartEngineCanvasC02.test.ts). That setup is COPIED here, not imported: another
// lane owns chartEngineGapDrawing.test.ts. Deterministic: manual scheduler, no
// network, no wall clock; every spy is restored in afterEach.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import { createDrawingBridge, type DrawingAnchor } from "@/lib/chart-engine/drawingBridge";
import { futureCadence } from "@/lib/chart-engine/futureTime";
import type { ChartEngine, EngineBarRow, EngineTime, SeriesHandle } from "@/lib/chart-engine/api";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic dataset.
// ─────────────────────────────────────────────────────────────────────────────

const PANE_W = 600;
const PANE_H_PX = 300;

// 12 daily bars: 2026-01-05 .. 2026-01-16.
const TIMES: string[] = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10));

// A switched/re-aggregated source: SAME window, but only the odd-offset days, so
// none of the anchor times pinned below (TIMES[2], TIMES[4], TIMES[6]) survive in
// it while the newest bar time is unchanged. The scale cannot address them any more.
const OTHER_TIMES: string[] = [TIMES[1]!, TIMES[3]!, TIMES[5]!, TIMES[7]!, TIMES[9]!, TIMES[11]!];

function rowsFor(times: readonly string[]): EngineBarRow[] {
  return times.map((t, i) => ({
    time: t, open: 50 + i * 10, high: 90 + i * 10, low: 30 + i * 10, close: 70 + i * 10,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording fake 2D context for the canvas engine (jsdom has no real canvas).
// ─────────────────────────────────────────────────────────────────────────────

type Call = { method: string; args: unknown[] };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, { __calls: Call[] }>();
function makeFakeCtx(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  const rec = (m: string) => (...args: unknown[]) => { calls.push({ method: m, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo",
    "lineTo", "stroke", "fill", "save", "restore", "scale", "translate",
    "rect", "closePath", "fillText", "strokeRect",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return ctx as unknown as CanvasRenderingContext2D & { __calls: Call[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas-engine wiring (copied from the D01 gap-drawing setup).
// ─────────────────────────────────────────────────────────────────────────────

type Bridge = ReturnType<typeof createDrawingBridge>;

type MountHandle = {
  engine: ChartEngine;
  primaryByPane: (paneIndex: number) => SeriesHandle | null;
  scheduler: ReturnType<typeof createManualScheduler>;
};

function mountCanvas(container: HTMLDivElement): MountHandle {
  const scheduler = createManualScheduler();
  const engine = createCanvasEngine(container, {
    width: PANE_W, height: PANE_H_PX * 2, devicePixelRatio: 1, scheduler,
  });
  const s0 = engine.addSeries("candles", {}, 0);
  const s1 = engine.addSeries("candles", {}, 1);
  s0.setData(rowsFor(TIMES));
  s1.setData(rowsFor(TIMES));
  scheduler.flush();
  const primaryByPane = (paneIndex: number): SeriesHandle | null =>
    engine.panes()[paneIndex]?.getSeries()[0] ?? null;
  return { engine, primaryByPane, scheduler };
}

function bridgeOpts(handle: MountHandle, times: readonly string[]) {
  // Wrap primaryByPane so later reassignment reaches the bridge on every call.
  return {
    primaryByPane: (paneIndex: number) => handle.primaryByPane(paneIndex),
    cadence: () => futureCadence(times),
    lastBarTime: (): EngineTime | null => times[times.length - 1] ?? null,
    scheduler: (run: () => void) => { run(); return () => {}; },
  } as const;
}

/**
 * The engine's OWN pane projection, recomputed from its time scale + pane rect so
 * no expectation below is a hard-coded constant (contract coordinate convention:
 * bar i is centred at (i - visibleFrom + 0.5) * barSpacing).
 */
function paneProjection(engine: ChartEngine, paneIndex: number) {
  const range = engine.timeScale().getVisibleLogicalRange();
  if (!range || !(range.to > range.from)) throw new Error("no non-degenerate visible logical range");
  const size = engine.paneSize(paneIndex);
  const barSpacing = size.width / (range.to - range.from);
  return {
    barSpacing,
    widthPx: size.width,
    heightPx: size.height,
    xOfLogical: (i: number) => (i - range.from + 0.5) * barSpacing,
    logicalOfX: (x: number) => x / barSpacing + range.from - 0.5,
  };
}

function yOfPrice(engine: ChartEngine, paneIndex: number, price: number): number {
  const series = engine.panes()[paneIndex]?.getSeries()[0] ?? null;
  const y = series ? series.priceToCoordinate(price) : null;
  if (y == null || !Number.isFinite(y)) throw new Error(`price ${price} is not projectable`);
  return y;
}

/** Mint a time-keyed, NON-future anchor on a real bar through the bridge itself. */
function mintBarAnchor(
  bridge: Bridge,
  engine: ChartEngine,
  paneIndex: number,
  time: string,
  price: number,
): DrawingAnchor {
  const x = engine.timeScale().timeToCoordinate(time);
  if (x == null) throw new Error(`bar ${time} is not addressable at mint time`);
  const anchor = bridge.pixelToAnchor(paneIndex, x, yOfPrice(engine, paneIndex, price), "snapBar");
  if (!anchor) throw new Error(`anchor for ${time} did not mint`);
  return anchor;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test setup.
// ─────────────────────────────────────────────────────────────────────────────

let canvasContainer: HTMLDivElement;

beforeEach(() => {
  canvasContainer = document.createElement("div");
  document.body.appendChild(canvasContainer);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement, type: string,
  ) {
    if (type !== "2d") return null;
    let ctx = ctxByCanvas.get(this);
    if (!ctx) { ctx = makeFakeCtx(); ctxByCanvas.set(this, ctx); }
    return ctx as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  canvasContainer.remove();
});

describe("D01-A02: Timeframe or history-depth changes -> Existing anchor policy applies; no accidental row-index rebinding (stale-logical guard)", () => {
  it("PRIMARY/setData([]): an emptied primary series leaves every time-keyed non-future anchor with no x", () => {
    const mm = mountCanvas(canvasContainer);
    const bridge = createDrawingBridge(mm.engine, bridgeOpts(mm, TIMES));

    const times = [TIMES[2]!, TIMES[5]!, TIMES[8]!];
    const anchors = times.map((t, i) => mintBarAnchor(bridge, mm.engine, 0, t, [80, 100, 120][i]!));
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!;
      expect(a.time).toBe(times[i]);
      expect(a.future).toBeUndefined();
      expect(Number.isFinite(a.logical)).toBe(true);
      const before = bridge.anchorToPixel(a);
      expect(before).not.toBeNull();
      expect(before!.x).toBeGreaterThanOrEqual(0);
      expect(before!.x).toBeLessThanOrEqual(PANE_W);
    }

    // The series still EXISTS but holds no rows: its times are gone, so nothing
    // addresses the anchors' times any more. (D01-A04 path B, made independent.)
    const primary = mm.engine.panes()[0]!.getSeries()[0]!;
    primary.setData([]);
    mm.scheduler.flush();

    for (const a of anchors) {
      // The defect answered { x: 1500, y: 158.35... } here — a stale row index
      // projected through a degenerate 1-bar window in a 600px pane.
      expect(bridge.anchorToPixel(a)).toBeNull();
    }
    // Invariant, independent of the refusal: never an off-pane x.
    for (const a of anchors) {
      const p = bridge.anchorToPixel(a);
      if (p !== null) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(PANE_W);
      }
    }
  });

  it("PRIMARY/source swap: a series that no longer contains the anchor's time leaves it with no x", () => {
    const mm = mountCanvas(canvasContainer);
    const bridge = createDrawingBridge(mm.engine, bridgeOpts(mm, TIMES));

    const times = [TIMES[2]!, TIMES[4]!, TIMES[6]!];
    const anchors = times.map((t, i) => mintBarAnchor(bridge, mm.engine, 0, t, [80, 100, 120][i]!));
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!;
      expect(a.time).toBe(times[i]);
      expect(a.future).toBeUndefined();
      // The swapped-in source genuinely cannot address these times.
      expect(OTHER_TIMES).not.toContain(String(a.time));
      expect(bridge.anchorToPixel(a)).not.toBeNull();
    }

    // Symbol switch / re-aggregation: same window, different bars.
    for (const s of mm.engine.panes().flatMap((p) => p.getSeries())) s.setData(rowsFor(OTHER_TIMES));
    mm.scheduler.flush();
    // The caller's cadence + last-bar view follow the new source.
    const switched = createDrawingBridge(mm.engine, bridgeOpts(mm, OTHER_TIMES));
    expect(mm.engine.timeScale().timeToCoordinate(times[0]!)).toBeNull();

    for (const a of anchors) {
      expect(bridge.anchorToPixel(a)).toBeNull();
      expect(switched.anchorToPixel(a)).toBeNull();
    }
    for (const a of anchors) {
      for (const b of [bridge, switched]) {
        const p = b.anchorToPixel(a);
        if (p !== null) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(PANE_W);
        }
      }
    }
  });

  it("NEGATIVE 1: a raw anchor (time == null, finite logical) still projects through xOfLogical", () => {
    const mm = mountCanvas(canvasContainer);
    const bridge = createDrawingBridge(mm.engine, bridgeOpts(mm, TIMES));
    const proj = paneProjection(mm.engine, 0);

    const rawX = proj.xOfLogical(4.35);
    const raw = bridge.pixelToAnchor(0, rawX, yOfPrice(mm.engine, 0, 100), "raw");
    expect(raw).not.toBeNull();
    expect(raw!.time).toBeNull();
    expect(raw!.future).toBeUndefined();
    expect(Number.isFinite(raw!.logical)).toBe(true);

    const px = bridge.anchorToPixel(raw!);
    expect(px).not.toBeNull();
    // Independent recomputation from the engine's own time scale, not a constant.
    const engineX = mm.engine.timeScale().logicalToCoordinate(raw!.logical);
    expect(engineX).not.toBeNull();
    expect(px!.x).toBeCloseTo(engineX!, 6);
    expect(px!.x).toBeCloseTo(paneProjection(mm.engine, 0).xOfLogical(raw!.logical), 6);
    expect(px!.x).toBeCloseTo(rawX, 6);
  });

  it("NEGATIVE 2: a future anchor holding a stored slot still resolves through the slot path", () => {
    const mm = mountCanvas(canvasContainer);
    const bridge = createDrawingBridge(mm.engine, bridgeOpts(mm, TIMES));
    const proj = paneProjection(mm.engine, 0);

    // Two bar slots past the newest candle: past the live edge, so the scale has
    // no time for it and only the STORED slot can place it.
    const pastEdgeX = proj.xOfLogical(TIMES.length + 2);
    const minted = bridge.pixelToAnchor(0, pastEdgeX, yOfPrice(mm.engine, 0, 100), "snapBar");
    expect(minted).not.toBeNull();
    expect(minted!.future).toBeDefined();
    const slot = minted!.future!.slot;
    expect(Number.isFinite(slot)).toBe(true);
    expect(slot).toBeGreaterThanOrEqual(0);

    const px = bridge.anchorToPixel(minted!);
    expect(px).not.toBeNull();

    // The slot path, recomputed from the engine: slot k sits at
    // lastBarLogical + k + 1 on the shared scale (the futureTime grid is contiguous).
    const lastX = mm.engine.timeScale().timeToCoordinate(TIMES[TIMES.length - 1]!);
    expect(lastX).not.toBeNull();
    const base = proj.logicalOfX(lastX!);
    expect(px!.x).toBeCloseTo(proj.xOfLogical(base + slot + 1), 6);
    expect(px!.x).toBeGreaterThan(lastX!);
    // ... and the slot path really is what resolved it: the scale cannot address
    // the synthetic future time, so a bare `return null` would drop this anchor.
    expect(minted!.time).not.toBeNull();
    expect(mm.engine.timeScale().timeToCoordinate(minted!.time!)).toBeNull();
  });
});
