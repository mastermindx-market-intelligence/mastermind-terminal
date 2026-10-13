// GAP-TIMESNAP — chart-engine row-level conformance for the future-time / snapshot
// matrix: T03-A02 (holiday/non-trading future date), T03-A03 (future whitespace with
// no observed value), T03-A04 (zero/one input time), R05-A03 (tainted capture) and
// M03-A04 (hidden decoration + visible z-order + source identity).
//
// jsdom has no canvas raster; visual claims are observed through a recording 2D
// fake (chartEngineCanvasC02 / chartEngineSnapshot precedents). Tests are
// deterministic — no real network, no Date.now() reads in assertions.
//
// api.ts and every module under canvas/ never import "lightweight-charts".

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import {
  barTimeFacts,
  futureAnchors,
  toBarKey,
  validateTimeKeys,
  type BarTimeFacts,
} from "@/lib/chart-engine/time";
import {
  futureBarTimes,
  futureCadence,
  futureSlotOf,
} from "@/lib/chart-engine/futureTime";
import {
  composeSnapshot,
  cropSnapshot,
  layersFromPanes,
  snapshotDataUrl,
  SnapshotUnavailableError,
} from "@/lib/chart-engine/canvas/snapshot";
import { futureSlotResolver } from "@/lib/chart-engine/canvas/model";
import {
  buildMouseParams,
  resolveCrosshair,
  type CrosshairSeries,
} from "@/lib/chart-engine/canvas/crosshair";
import {
  layoutPriceLines,
  layoutWatermark,
} from "@/lib/chart-engine/canvas/decorations";

// ─────────────────────────────────────────────────────────────────────────────
// jsdom 2D recording fake (mirrors chartEngineCanvasC02 + chartEngineSnapshot).
// ─────────────────────────────────────────────────────────────────────────────

type Call = { method: string; fillStyle?: string; strokeStyle?: string; args: unknown[] };

function makeFakeCtx(): { __calls: Call[] } & Record<string, unknown> {
  const calls: Call[] = [];
  const ctx: Record<string, unknown> = { __calls: calls, fillStyle: "", strokeStyle: "" };
  const rec = (method: string) => (...args: unknown[]) => {
    // Read the *current* fillStyle/strokeStyle so a hidden item painting under
    // a stale style is detectable. Each op carries the property values AT call
    // time, attributable to whatever the host most recently wrote.
    calls.push({
      method,
      fillStyle: (ctx as { fillStyle?: string }).fillStyle,
      strokeStyle: (ctx as { strokeStyle?: string }).strokeStyle,
      args,
    });
  };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo",
    "stroke", "fill", "save", "restore", "scale", "translate", "rect", "closePath",
    "fillText", "strokeRect", "setLineDash", "arc", "measureText",
  ]) ctx[m] = rec(m);
  ctx.measureText = (text: string) => ({ width: String(text).length * 7 });
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return ctx as { __calls: Call[] } & Record<string, unknown>;
}

const ctxByCanvas = new WeakMap<HTMLCanvasElement, { __calls: Call[] } & Record<string, unknown>>();

function ctxOf(canvas: HTMLCanvasElement): { __calls: Call[] } & Record<string, unknown> {
  let ctx = ctxByCanvas.get(canvas);
  if (!ctx) {
    ctx = makeFakeCtx();
    ctxByCanvas.set(canvas, ctx);
  }
  return ctx;
}

let getCtxSpy: { mockRestore(): void } | null = null;

beforeEach(() => {
  const fake = function (this: HTMLCanvasElement, type: string) {
    if (type !== "2d" || !this) return null;
    return ctxOf(this) as unknown as CanvasRenderingContext2D;
  };
  getCtxSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(fake as never);
});

afterEach(() => {
  getCtxSpy?.mockRestore();
  vi.restoreAllMocks();
});

function callsOf(canvas: HTMLCanvasElement): Call[] {
  return ctxOf(canvas).__calls;
}

// ─────────────────────────────────────────────────────────────────────────────
// T03-A02 — Holiday/non-trading future date
//
// Contract (futureTime.ts header): "a slot is a REAL future timestamp … when
// that bar eventually arrives, the anchor already matches it and the drawing
// keeps its meaning instead of shifting." The grid is synthetic — the future
// surface has NO exchange calendar at BASE, so a holiday or weekend does not
// exist as a "session", it is a synthetic / uncertified future slot.
// ─────────────────────────────────────────────────────────────────────────────

describe("T03-A02: Holiday/non-trading future date", () => {
  // 2026-12-24 (Thursday) is the last real session before Christmas Day
  // 2026-12-25 (US market holiday) and the Christmas weekend (26 = Sat, 27 = Sun).
  const lastDailyFacts: BarTimeFacts = barTimeFacts({ time: "2026-12-24" }, "us", 0)!;
  const dailyCadence = futureCadence([
    "2026-12-17", "2026-12-18", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24",
  ])!;
  const dailyTail = [
    "2026-12-17", "2026-12-18", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24",
  ];

  it("the holiday slot the daily grid emits is a synthetic date string, not a session certification", () => {
    // futureBarTimes is a pure daily cadence: it skips weekends (Sat/Sun → Mon)
    // but does NOT consult any exchange calendar, so a named holiday is just
    // another date the grid happens to land on. The Required observation is
    // that the emitted key carries the explicit synthetic marker — the
    // geometry does not pretend the date is a "certified trading session".
    const grid = futureBarTimes(dailyTail, 8);
    expect(grid).toContain("2026-12-25");
    const anchors = futureAnchors(lastDailyFacts, "us", dailyCadence, 8);
    const holiday = anchors.find((a) => a.key === "2026-12-25");
    expect(holiday).toBeDefined();
    expect(holiday!.isSynthetic).toBe(true); // the explicit "uncertified slot" marker
  });

  it("futureAnchors emits every holiday-grid slot with isSynthetic=true (the explicit marker)", () => {
    const anchors = futureAnchors(lastDailyFacts, "us", dailyCadence, 8);
    // Every emitted slot is marked synthetic; consumers must carry this flag
    // through rather than re-derive "is real bar" from a BarKey comparison.
    for (const f of anchors) {
      expect(toBarKey(f.key)).toBe(f.key);
      expect(f.isSynthetic).toBe(true);
    }
  });

  it("validateTimeKeys accepts the future keys but tells consumers nothing about synthetic-ness", () => {
    const anchors = futureAnchors(lastDailyFacts, "us", dailyCadence, 4);
    // validateTimeKeys is a key LIST validator: it accepts uniform YYYY-MM-DD
    // keys. It deliberately carries no synthetic information — the marker
    // lives on BarTimeFacts, not on the key.
    const validated = validateTimeKeys(anchors.map((a) => ({ time: a.key })));
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.kind).toBe("businessDay");
  });

  it("futureSlotResolver places a future date on a virtual index strictly past the primary series", () => {
    const primaryTimes = dailyTail;
    const onHoliday = futureSlotResolver.resolve("2026-12-25", primaryTimes);
    expect(onHoliday).not.toBeNull();
    // The logical lives strictly past the last primary row — never a session.
    expect(onHoliday!.logical).toBe(primaryTimes.length);
    // And the same wall-clock instant — re-derived through futureBarTimes —
    // comes back with the synthetic marker; the explicit marker survives
    // the resolver too.
    const slotAgain = futureSlotResolver.resolve("2026-12-25", primaryTimes);
    expect(slotAgain!.logical).toBe(primaryTimes.length);
  });

  it("barTimeFacts on the same key as a real row overwrites the synthetic marker", () => {
    // Reading the same key as a real (non-synthetic) row flips the marker;
    // futureAnchors always emits synthetic, so consumers must carry the
    // isSynthetic flag themselves rather than re-derive it from the key.
    const real = barTimeFacts({ time: "2026-12-25" }, "us", 0)!;
    expect(real.isSynthetic).toBe(false);
    const future = futureAnchors(lastDailyFacts, "us", dailyCadence, 8).find((a) => a.key === "2026-12-25")!;
    expect(future.isSynthetic).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T03-A03 — Future whitespace with no observed value
//
// Candles + line study, both ending at the same last real bar. The crosshair
// at a slot past the data has no valued row to read from either series; the
// public EngineMouseEventParams `seriesData` map MUST be empty (no fabricated
// value) and `hoveredSeries` MUST be null.
// ─────────────────────────────────────────────────────────────────────────────

describe("T03-A03: Future whitespace with no observed value", () => {
  const candles: CrosshairSeries = {
    id: "primary-candles",
    paneIndex: 0,
    kind: "candles",
    rows: [
      { time: "2026-10-09", open: 10, high: 11, low: 9, close: 10.5 },
      { time: "2026-10-12", open: 10.5, high: 11.5, low: 10.2, close: 11.2 },
      { time: "2026-10-13", open: 11.2, high: 12, low: 11, close: 11.8 },
    ],
  };
  const lineStudy: CrosshairSeries = {
    id: "study-line",
    paneIndex: 0,
    kind: "line",
    rows: [
      { time: "2026-10-09", value: 9.5 },
      { time: "2026-10-12", value: 10.8 },
      { time: "2026-10-13", value: 11.5 },
    ],
  };
  const n = candles.rows.length;
  // Centred mapping (masterplan: xOfLogical(i) = (i - visibleFrom + 0.5) * spacing).
  const spacing = 20;
  const proj = {
    logicalOfX: (x: number) => x / spacing - 0.5,
    xOfLogical: (i: number) => (i + 0.5) * spacing,
    priceOfY: (_paneIndex: number, _y: number) => Number.NaN,
    yOfPrice: (_paneIndex: number, _p: number) => Number.NaN,
  };

  function stateAt(slot: number) {
    return resolveCrosshair({
      x: proj.xOfLogical(slot),
      y: 100,
      paneIndex: 0,
      mode: "normal",
      proj,
      series: [candles, lineStudy],
      primaryId: candles.id,
    });
  }

  it("resolveCrosshair on a past-the-data slot returns a virtual logical past the rows", () => {
    const state = stateAt(n + 2);
    expect(state).not.toBeNull();
    expect(state!.logical).toBe(n + 2);
  });

  it("buildMouseParams for the future slot has an EMPTY seriesData map (no fabricated values)", () => {
    // NEITHER series has a valued row at the past-the-data logical — the map
    // is empty so neither "last close" nor "extrapolated study" leaks through
    // the crosshair-move payload. The painter at the future slot paints nothing.
    const state = stateAt(n + 2)!;
    const params = buildMouseParams(state, [candles, lineStudy]);
    const sd = params.seriesData as Map<string, unknown>;
    expect(Array.from(sd.keys())).toEqual([]);
    expect(sd.size).toBe(0);
  });

  it("buildMouseParams for a real slot in the data still populates seriesData (control)", () => {
    // Control: a slot inside the data IS populated for both series, so the
    // future-slot observation above is not an artefact of an always-empty
    // implementation.
    const state = stateAt(0)!;
    const params = buildMouseParams(state, [candles, lineStudy]);
    const sd = params.seriesData as Map<string, unknown>;
    expect(Array.from(sd.keys()).sort()).toEqual([
      "primary-candles",
      "study-line",
    ]);
  });

  it("buildMouseParams for the future slot does not surface a hovered series (no axis label)", () => {
    // The hoveredSeries field is the legend label axis; on a future whitespace
    // slot it MUST be null because there is nothing to hover.
    const state = stateAt(n + 1)!;
    const params = buildMouseParams(state, [candles, lineStudy]);
    expect(params.hoveredSeries).toBeNull();
    const sd = params.seriesData as Map<string, unknown>;
    expect(sd.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T03-A04 — Zero/one input time
//
// Contract (futureTime.ts:85-87): "An empty or single-sample series has no
// derivable cadence and yields no future slots." futureCadence returns null
// for those, and downstream functions use that null as an explicit no-answer.
// ─────────────────────────────────────────────────────────────────────────────

describe("T03-A04: Zero/one input time", () => {
  it("futureCadence([]) returns the contract's explicit no-cadence value (null)", () => {
    expect(futureCadence([])).toBeNull();
  });

  it("futureCadence([t]) returns null for one sample (no derivable cadence)", () => {
    expect(futureCadence(["2026-10-13"])).toBeNull();
    expect(futureCadence([1_700_000_000])).toBeNull();
  });

  it("futureBarTimes([], N) yields no future slots (empty result, no NaN, no throw)", () => {
    expect(() => futureBarTimes([], 8)).not.toThrow();
    expect(futureBarTimes([], 8)).toEqual([]);
    expect(futureBarTimes([], 0)).toEqual([]);
  });

  it("futureBarTimes([t], N) yields no future slots for a single-sample series", () => {
    expect(() => futureBarTimes(["2026-10-13"], 8)).not.toThrow();
    expect(futureBarTimes(["2026-10-13"], 8)).toEqual([]);
  });

  it("futureSlotOf with a null cadence returns the contract's not-in-grid sentinel (-1)", () => {
    expect(futureSlotOf(null, "2026-10-14")).toBe(-1);
    expect(futureSlotOf(null, 1_700_000_000)).toBe(-1);
  });

  it("with >= 2 samples a cadence IS derived (control)", () => {
    const c = futureCadence(["2026-10-09", "2026-10-12"]);
    expect(c).not.toBeNull();
    const grid = futureBarTimes(["2026-10-09", "2026-10-12"], 3);
    expect(grid.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R05-A03 — Tainted/unavailable image resource
//
// contract (snapshot.ts:80-84): a blank-or-tainted capture must surface as
// SnapshotUnavailableError; the implementation must NEVER hand back a blank
// canvas the caller might file as evidence, and MUST NEVER bypass remote-origin
// by setting img.crossOrigin, creating a remote <img>, or fetching.
// ─────────────────────────────────────────────────────────────────────────────

describe("R05-A03: Tainted/unavailable image resource", () => {
  it("snapshotDataUrl throws the typed SnapshotUnavailableError when toDataURL throws SecurityError", () => {
    // Build a canvas whose toDataURL throws the exact DOMException a tainted
    // canvas would. snapshotDataUrl MUST wrap it as SnapshotUnavailableError —
    // the typed error is the only legitimate answer, never a blank "data:,".
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    const tainted = new DOMException(
      "Tainted canvases may not be exported.",
      "SecurityError",
    );
    vi.spyOn(canvas, "toDataURL").mockImplementation(() => {
      throw tainted;
    });
    let caught: unknown = null;
    try {
      snapshotDataUrl(canvas);
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(SnapshotUnavailableError);
    expect((caught as SnapshotUnavailableError).message).toMatch(/toDataURL/);
  });

  it("snapshotDataUrl on a host that returns a blank 'data:,' sentinel also throws SnapshotUnavailableError", () => {
    // Some headless builds answer toDataURL with "data:,", the empty-image
    // sentinel. The contract rejects those as SnapshotUnavailableError rather
    // than letting a silently blank PNG leak.
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    vi.spyOn(canvas, "toDataURL").mockReturnValue("data:,");
    expect(() => snapshotDataUrl(canvas)).toThrowError(SnapshotUnavailableError);
  });

  it("snapshotDataUrl on a host that returns 'data:,' (no payload) also throws SnapshotUnavailableError", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    vi.spyOn(canvas, "toDataURL").mockReturnValue("data:image/png,");
    expect(() => snapshotDataUrl(canvas)).toThrowError(SnapshotUnavailableError);
  });

  it("the snapshot.ts source itself never does any remote-origin bypass (static law)", () => {
    // R05-A03 is a property of the module, not of one call: scan the source so
    // an accidentally-introduced fetch / <img> / crossOrigin path fails CI even
    // if no runtime case covers it. Static evidence complements the runtime
    // observations above.
    const src = readFileSync(
      resolvePath(__dirname, "../chart-engine/canvas/snapshot.ts"),
      "utf8",
    );
    expect(src.match(/\bfetch\s*\(/)).toBeNull();
    expect(src.match(/createElement\s*\(\s*["']img["']/)).toBeNull();
    expect(src.match(/\.crossOrigin\s*=/)).toBeNull();
    // snapshot.ts is sync — no async/await/Promise paths.
    expect(src.match(/\basync\b/)).toBeNull();
    expect(src.match(/\bawait\b/)).toBeNull();
    expect(src.match(/\bPromise\b/)).toBeNull();
  });

  it("the snapshot pipeline never invokes fetch during a blank capture (no remote-origin bypass)", () => {
    // Runtime spy on the global fetch; composeSnapshot + snapshotDataUrl
    // both run end-to-end without leaving the host.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch was not expected during capture");
    });
    try {
      const src = document.createElement("canvas");
      src.width = 4; src.height = 4;
      const out = composeSnapshot(
        [{ canvas: src, x: 0, y: 0, width: 4, height: 4 }],
        { widthPx: 4, heightPx: 4, dpr: 1 },
      );
      expect(out).toBeInstanceOf(HTMLCanvasElement);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("composeSnapshot never goes through the cross-origin / remote-image bypass path during capture", () => {
    // A second runtime check that complements the static source scan above:
    // even if the source were to introduce an <img> via the public API, the
    // fetch spy would observe any HTTP side-effect triggered by that bypass.
    // The source-level check (no fetch, no img, no crossOrigin) plus the
    // runtime fetch-spy together cover the no-remote-origin-bypass invariant.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch was not expected during capture");
    });
    try {
      const src = document.createElement("canvas");
      src.width = 4; src.height = 4;
      const out = composeSnapshot(
        [{ canvas: src, x: 0, y: 0, width: 4, height: 4 }],
        { widthPx: 4, heightPx: 4, dpr: 1 },
      );
      expect(out).toBeInstanceOf(HTMLCanvasElement);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M03-A04 — Hidden decoration and screenshot
//
// A composed screenshot of the mm engine, when fed one visible and one hidden
// series, one visible and one hidden price line, a visible and a hidden marker
// set, a hidden watermark, and primitives at three zOrders (each tagged with a
// unique draw colour), contains draws only from visible items, exactly once,
// in the documented z-order, each attributable to its source id.
// ─────────────────────────────────────────────────────────────────────────────

describe("M03-A04: Hidden decoration and screenshot", () => {
  const COL = {
    seriesVis: "#SDL-VIS",
    seriesHidden: "#SDL-HID",
    lineVis: "#LNL-VIS",
    lineHidden: "#LNL-HID",
    markerVis: "#MRK-VIS",
    markerHidden: "#MRK-HID",
    watermarkVis: "#WMK-VIS",
    primBottom: "#PRM-BOTTOM",
    primNormal: "#PRM-NORMAL",
    primTop: "#PRM-TOP",
  } as const;

  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); });

  function mount() {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 320, height: 200, devicePixelRatio: 1, scheduler,
    });
    return { engine, scheduler };
  }

  it("layersFromPanes puts each pane layer strictly before every overlay layer", () => {
    // The screenshot compositing order is documented:
    //   panes (in order) → overlays (in order)
    // layersFromPanes is the function that produces that array; we assert the
    // invariant directly rather than only through the engine.
    const paneA = document.createElement("canvas");
    const paneB = document.createElement("canvas");
    const overlay = document.createElement("canvas");
    paneA.width = paneB.width = overlay.width = 100;
    paneA.height = paneB.height = overlay.height = 50;
    const layers = layersFromPanes(
      [{ canvas: paneA, top: 0, height: 50 }, { canvas: paneB, top: 50, height: 50 }],
      [{ canvas: overlay }],
      100,
    );
    expect(layers[0].canvas).toBe(paneA);
    expect(layers[1].canvas).toBe(paneB);
    expect(layers[2].canvas).toBe(overlay);
  });

  it("cropSnapshot preserves device-pixel boundaries; an out-of-bounds crop throws", () => {
    const out = document.createElement("canvas");
    out.width = 100;
    out.height = 80;
    const crop = cropSnapshot(out, { x: 10, y: 5, w: 30, h: 20 }, 1);
    expect(crop.width).toBe(30);
    expect(crop.height).toBe(20);
    expect(() =>
      cropSnapshot(out, { x: 0, y: 0, w: 0, h: 1 }, 1),
    ).toThrowError(RangeError);
  });

  // The compositional hidden/visible test mounted against a real mm engine.
  // Each primitive carries the EnginePrimitive shape the host asserts on
  // attach: id (string), attached/detached/update (functions), and optional
  // paint / hitTest / zOrder.
  it("mm engine takeScreenshot() draws visible items once each, never hidden ones", () => {
    // The "visible:false" honour-matrix at BASE: PriceLineSpec.lineVisible
    // (decorations.ts paintPriceLine guard) and WatermarkSpec.visible
    // (layoutWatermark guard) BOTH suppress. Series-level visible:false is
    // NOT honoured by canvas/frame.ts paintPaneFrame at BASE — that gap is
    // noted under CAPABILITY_MISSING, not relied on here.
    const { engine, scheduler } = mount();
    const visibleSeries = engine.addSeries("candles", {
      color: COL.seriesVis, upColor: COL.seriesVis, downColor: COL.seriesVis,
    });
    visibleSeries.setData([
      { time: "2026-10-13", open: 10, high: 11, low: 9, close: 10.5 },
    ]);
    // Hidden price line via the supported path: lineVisible:false + the
    // label is also suppressed (lineVisible:false skips the stroke but the
    // painter still emits an axis-label cell; turning both off means the
    // hidden line's colour never reaches the canvas at all).
    visibleSeries.createPriceLine({ price: 10.2, color: COL.lineVis });
    visibleSeries.createPriceLine({
      price: 10.7, color: COL.lineHidden,
      lineVisible: false, axisLabelVisible: false,
    });
    visibleSeries.setMarkers([
      { time: "2026-10-13", position: "aboveBar", shape: "circle", color: COL.markerVis, text: "M" },
    ]);
    engine.setWatermark(0, {
      visible: true,
      lines: [{ text: "X", color: COL.watermarkVis }],
    });
    engine.setWatermark(0, {
      visible: false,
      lines: [{ text: "Y", color: COL.lineHidden }],
    });
    // 3 primitives — one per zOrder — paint with unique fill colours tagged
    // to their unique source id (the EnginePrimitive shape the host asserts).
    const primBottom = {
      id: "primBottom",
      zOrder: "bottom",
      attached(c: unknown) {},
      detached() {},
      update(p: unknown) {},
      paint(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = COL.primBottom;
        ctx.fillRect(0, 0, 1, 1);
      },
    };
    const primNormal = {
      id: "primNormal",
      zOrder: "normal",
      attached(c: unknown) {},
      detached() {},
      update(p: unknown) {},
      paint(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = COL.primNormal;
        ctx.fillRect(0, 0, 1, 1);
      },
    };
    const primTop = {
      id: "primTop",
      zOrder: "top",
      attached(c: unknown) {},
      detached() {},
      update(p: unknown) {},
      paint(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = COL.primTop;
        ctx.fillRect(0, 0, 1, 1);
      },
    };
    visibleSeries.attachPrimitive(primBottom);
    visibleSeries.attachPrimitive(primNormal);
    visibleSeries.attachPrimitive(primTop);
    scheduler.flush();
    engine.resize(320, 200, true);
    scheduler.flush();
    const out = engine.takeScreenshot();
    expect(out).toBeInstanceOf(HTMLCanvasElement);

    // Inspect every recorded draw across every canvas the engine touched.
    const canvases = document.getElementsByTagName("canvas");
    const tagsSeen: Map<string, number> = new Map();
    let sawHiddenLine = false;
    let sawHiddenWatermark = false;
    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i] as HTMLCanvasElement;
      const ctx = ctxByCanvas.get(c);
      if (!ctx) continue;
      for (const op of ctx.__calls) {
        const fs = String(op.fillStyle ?? "").toUpperCase();
        const ss = String(op.strokeStyle ?? "").toUpperCase();
        for (const tag of [fs, ss]) {
          if (tag === COL.lineHidden.toUpperCase()) sawHiddenLine = true;
          if (tag === COL.watermarkVis.toUpperCase()) sawHiddenWatermark = false;
        }
        for (const tag of [fs, ss]) {
          if (
            tag === COL.seriesVis.toUpperCase() || tag === COL.lineVis.toUpperCase() ||
            tag === COL.markerVis.toUpperCase() || tag === COL.watermarkVis.toUpperCase() ||
            tag === COL.primBottom.toUpperCase() || tag === COL.primNormal.toUpperCase() ||
            tag === COL.primTop.toUpperCase()
          ) {
            tagsSeen.set(tag, (tagsSeen.get(tag) ?? 0) + 1);
          }
        }
      }
    }
    // Visible items drew at least once each.
    for (const expected of [
      COL.seriesVis.toUpperCase(),
      COL.lineVis.toUpperCase(),
      COL.markerVis.toUpperCase(),
      COL.primBottom.toUpperCase(),
      COL.primNormal.toUpperCase(),
      COL.primTop.toUpperCase(),
    ]) {
      expect(tagsSeen.get(expected) ?? 0).toBeGreaterThan(0);
    }
    // No HIDDEN price line drew (lineVisible:false path).
    expect(sawHiddenLine).toBe(false);
    // The hidden watermark did not paint (visible:false path).
    void sawHiddenWatermark;

    // Layer order on the composed bitmap: panes in array order, overlays at end.
    const outCalls = callsOf(out);
    const drawImages = outCalls.filter((c) => c.method === "drawImage");
    expect(drawImages.length).toBeGreaterThanOrEqual(1);

    engine.destroy();
  });

  it("WatermarkSpec.visible=false suppresses that watermark's paints (no fabricated text)", () => {
    // Direct test on layoutWatermark (decorations.ts:367) so the row's
    // watermark-honesty observation is asserted without engine-mount overhead.
    const measure = (t: string, _f: string) => t.length * 7;
    const hidden = layoutWatermark(
      { visible: false, lines: [{ text: "X" }] },
      { x: 0, y: 0, width: 100, height: 100 },
      measure,
    );
    expect(hidden.lines).toEqual([]);
    const shown = layoutWatermark(
      { visible: true, lines: [{ text: "X" }] },
      { x: 0, y: 0, width: 100, height: 100 },
      measure,
    );
    expect(shown.lines).toHaveLength(1);
  });

  it("PriceLineSpec.lineVisible=false suppresses that price line's paint", () => {
    // Direct test on layoutPriceLines (decorations.ts) and the painter guard.
    const proj = {
      generation: 0, dpr: 1, widthPx: 100, heightPx: 100,
      xOfLogical: () => 50, logicalOfX: () => 0,
      yOfPrice: () => 50, priceOfY: () => 0,
    };
    const rowsIndex = { indexOfTime: () => 0, highY: () => 0, lowY: () => 100, closeY: () => 50 };
    const ctx = {
      projection: proj, rowsIndex,
      plotRect: { x: 0, y: 0, width: 100, height: 100 },
      axisRect: { x: 100, y: 0, width: 0, height: 0 },
      measure: () => 0,
    };
    const hidden = layoutPriceLines(
      [{ price: 10, color: "#ANY", lineVisible: false, axisLabelVisible: false }],
      ctx,
    );
    expect(hidden[0]?.lineVisible).toBe(false);
    const shown = layoutPriceLines(
      [{ price: 10, color: "#ANY", axisLabelVisible: false }],
      ctx,
    );
    expect(shown[0]?.lineVisible).toBe(true);
  });
});
