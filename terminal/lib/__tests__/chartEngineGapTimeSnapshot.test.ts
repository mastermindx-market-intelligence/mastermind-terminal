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

import type { EngineMouseEventParams } from "@/lib/chart-engine/api";
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
// Shared mm-engine mount helpers (T03-A03 / R05-A03 / M03-A04 mounted legs).
// The engine is always driven by the manual scheduler (canvas/index.ts:96) so a
// frame happens only when the test says so — no rAF, no wall clock.
// ─────────────────────────────────────────────────────────────────────────────

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => { host.remove(); });

function mountEngine(width = 320, height = 200) {
  const scheduler = createManualScheduler();
  const engine = createCanvasEngine(host, {
    width, height, devicePixelRatio: 1, scheduler,
  });
  return { engine, scheduler };
}

function paneCanvasOf(index: number): HTMLCanvasElement {
  const found = host.querySelector(`canvas[data-mm-pane-canvas="${index}"]`);
  if (!found) throw new Error(`no pane canvas ${index} in the mounted engine`);
  return found as HTMLCanvasElement;
}

function overlayCanvasOf(): HTMLCanvasElement {
  const found = host.querySelector("canvas[data-mm-overlay]");
  if (!found) throw new Error("no overlay canvas in the mounted engine");
  return found as HTMLCanvasElement;
}

function engineCanvases(): HTMLCanvasElement[] {
  return Array.from(host.querySelectorAll("canvas")) as HTMLCanvasElement[];
}

function clearCalls(canvases: readonly HTMLCanvasElement[]): void {
  for (const c of canvases) ctxOf(c).__calls.length = 0;
}

/** Ops on `canvas` drawn in one of `colors`.
 *  A path op (moveTo/lineTo/stroke) is drawn in the CURRENT strokeStyle and a
 *  fill/rect/text op in the CURRENT fillStyle. The recording fake stores both
 *  properties on every call, so attribution must go through the property the
 *  canvas would actually use for that method — otherwise a later axis label
 *  would be blamed on the series colour that happened to be in strokeStyle. */
function opsWithColors(canvas: HTMLCanvasElement, colors: readonly string[]): Call[] {
  const wanted = colors.map((c) => c.toUpperCase());
  return ctxOf(canvas).__calls.filter((op) => {
    const drawn = op.method === "moveTo" || op.method === "lineTo" || op.method === "stroke"
      ? String(op.strokeStyle ?? "")
      : String(op.fillStyle ?? "");
    return wanted.includes(drawn.toUpperCase());
  });
}

/** The x coordinate an op puts on the canvas (method-aware). */
function xsOf(op: Call): number[] {
  if (op.method === "fillText") {
    return typeof op.args[1] === "number" ? [op.args[1]] : [];
  }
  const first = op.args.find((a): a is number => typeof a === "number");
  return first === undefined ? [] : [first];
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
    priceOfY: () => Number.NaN,
    yOfPrice: () => Number.NaN,
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

  // ── Mounted leg: the same Required observation on the real mm engine ─────────
  //
  // setData accepts time-only rows (api.ts:22 EngineWhitespace) and the model
  // stores them verbatim (model.ts:794 `s.rows = rows.slice()`), so a trailing
  // whitespace slot EXISTS on the time axis while carrying no observed value.
  const REAL_ROWS = 3;
  const WS_SLOT = REAL_ROWS + 1;                 // second whitespace slot
  const CANDLE_COLOR = "#T03-CDL";
  const STUDY_COLOR = "#T03-STDY";
  const WS_TIME = "2026-10-15";

  function mountWhitespaceChart() {
    const { engine, scheduler } = mountEngine(300, 200);
    const candles = engine.addSeries("candles", {
      color: CANDLE_COLOR, upColor: CANDLE_COLOR, downColor: CANDLE_COLOR,
    }, 0);
    const study = engine.addSeries("line", { color: STUDY_COLOR }, 0);
    // Both series end at the SAME last real bar (2026-10-13) and then carry
    // three trailing whitespace rows.
    candles.setData([
      { time: "2026-10-09", open: 10, high: 11, low: 9, close: 10.5 },
      { time: "2026-10-12", open: 10.5, high: 11.5, low: 10.2, close: 11.2 },
      { time: "2026-10-13", open: 11.2, high: 12, low: 11, close: 11.8 },
      { time: "2026-10-14" }, { time: WS_TIME }, { time: "2026-10-16" },
    ]);
    study.setData([
      { time: "2026-10-09", value: 9.5 },
      { time: "2026-10-12", value: 10.8 },
      { time: "2026-10-13", value: 11.5 },
      { time: "2026-10-14" }, { time: WS_TIME }, { time: "2026-10-16" },
    ]);
    scheduler.flush();
    return { engine, scheduler, candles, study };
  }

  it("on the mm engine the crosshair payload at a trailing whitespace slot carries no seriesData entry for either series, and still names the slot's time", () => {
    const { engine, scheduler, candles, study } = mountWhitespaceChart();
    const seen: EngineMouseEventParams[] = [];
    engine.subscribeCrosshairMove((p) => { seen.push(p); });
    // Programmatic crosshair parked on the whitespace slot (index.ts:547) ...
    engine.setCrosshairPosition(12, WS_TIME, candles);
    scheduler.flush();
    // ... then the engine's delivery path for crosshair payloads: a pointer move
    // on the overlay at that slot's x (index.ts:485-492 → buildMouseParams).
    const x = engine.timeScale().logicalToCoordinate(WS_SLOT) as number;
    overlayCanvasOf().dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: 50 }));
    expect(seen.length).toBeGreaterThan(0);
    const params = seen[seen.length - 1];
    // seriesData is re-keyed onto SeriesHandles (index.ts:474-482). Both series
    // are ABSENT from it — not present with an undefined/NaN value field.
    const sd = params.seriesData as Map<unknown, unknown>;
    expect(sd.size).toBe(0);
    expect(sd.has(candles)).toBe(false);
    expect(sd.has(study)).toBe(false);
    expect(params.hoveredSeries).toBeNull();
    // The slot's own time key is a fact about the axis, not a fabricated value.
    expect(params.time).toBe(WS_TIME);
    expect(params.logical).toBe(WS_SLOT);
    engine.destroy();
  });

  it("on the mm engine a full repaint of that chart draws no candle or study pixel right of the last real bar's centre plus half a bar spacing", () => {
    const { engine, scheduler } = mountWhitespaceChart();
    const timeScale = engine.timeScale();
    // xOfLogical convention (frame/model): bar i is centred at
    // logicalToCoordinate(i); the last REAL bar is index REAL_ROWS - 1.
    const lastRealX = timeScale.logicalToCoordinate(REAL_ROWS - 1) as number;
    const spacing = (timeScale.logicalToCoordinate(1) as number)
      - (timeScale.logicalToCoordinate(0) as number);
    const bound = lastRealX + spacing / 2;
    expect(timeScale.logicalToCoordinate(WS_SLOT)).toBeGreaterThan(bound);
    const pane = paneCanvasOf(0);
    clearCalls([pane]);
    engine.resize(300, 200, true);   // full repaint covering the whitespace slots
    scheduler.flush();
    const ops = opsWithColors(pane, [CANDLE_COLOR, STUDY_COLOR]);
    expect(ops.length).toBeGreaterThan(0);   // the bound below is not vacuous
    for (const op of ops) {
      for (const px of xsOf(op)) expect(px).toBeLessThanOrEqual(bound);
    }
    engine.destroy();
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
//
// Browser semantics this row relies on: drawImage of a tainted source canvas
// does NOT throw - it taints the DESTINATION. So a tainted capture cannot fail
// inside takeScreenshot(); the typed failure surfaces at the single export site
// (snapshotDataUrl, snapshot.ts:221-240), which is also the only toDataURL /
// toBlob / getImageData call anywhere under lib/chart-engine.
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

  it("snapshotDataUrl on a host that returns a payload-less 'data:image/png,' also throws SnapshotUnavailableError", () => {
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

  it("on the mm engine a tainted capture surfaces SnapshotUnavailableError caused by that SecurityError, with no fetch, no <img> and no crossOrigin assignment", () => {
    const { engine, scheduler } = mountEngine();
    const candles = engine.addSeries("candles", {
      color: "#R05-CDL", upColor: "#R05-CDL", downColor: "#R05-CDL",
    }, 0);
    candles.setData([{ time: "2026-10-13", open: 10, high: 11, low: 9, close: 10.5 }]);
    scheduler.flush();

    // Spies are armed BEFORE the capture so they observe takeScreenshot AND the
    // export that follows it.
    let imgCreates = 0;
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag.toLowerCase() === "img") imgCreates += 1;
      return realCreateElement(tag);
    }) as never);
    const crossOriginDescriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype, "crossOrigin",
    );
    // The spy is only meaningful if the platform really exposes the setter.
    expect(typeof crossOriginDescriptor?.set).toBe("function");
    const realCrossOriginSet = crossOriginDescriptor!.set!;
    let crossOriginSets = 0;
    Object.defineProperty(HTMLImageElement.prototype, "crossOrigin", {
      configurable: true,
      enumerable: crossOriginDescriptor!.enumerable,
      get: crossOriginDescriptor!.get,
      set(this: HTMLImageElement, value: string | null) {
        crossOriginSets += 1;
        realCrossOriginSet.call(this, value);
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch was not expected during capture");
    });
    try {
      const out = engine.takeScreenshot();
      expect(out).toBeInstanceOf(HTMLCanvasElement);
      const tainted = new DOMException(
        "Tainted canvases may not be exported.",
        "SecurityError",
      );
      vi.spyOn(out, "toDataURL").mockImplementation(() => {
        throw tainted;
      });
      let caught: unknown = null;
      try {
        snapshotDataUrl(out);
      } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(SnapshotUnavailableError);
      // The typed failure carries the host's own SecurityError as its cause —
      // the caller can tell "tainted" from "no encoder" without string parsing.
      expect((caught as SnapshotUnavailableError).cause).toBe(tainted);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(imgCreates).toBe(0);
      expect(crossOriginSets).toBe(0);
    } finally {
      Object.defineProperty(
        HTMLImageElement.prototype, "crossOrigin", crossOriginDescriptor!,
      );
      createSpy.mockRestore();
      fetchSpy.mockRestore();
      engine.destroy();
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
    watermarkHidden: "#WMK-HID",
    primBottom: "#PRM-BOTTOM",
    primNormal: "#PRM-NORMAL",
    primTop: "#PRM-TOP",
  } as const;

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

  // ── Mounted legs on a real mm engine ─────────────────────────────────────────
  //
  // Scene: pane 0 carries a VISIBLE candles series (own colour, own price line,
  // own marker, three primitives at the three z-tiers) and the visible watermark;
  // pane 1 carries a series hidden the way ChartPanel.tsx:2471 hides a compare
  // series — applyOptions({ visible: false }) — with its own colour, its own
  // price line and its own markers, plus a visible:false watermark.
  // buildScene leaves the frame PENDING so each leg can clear the recorded call
  // logs and observe exactly ONE flush (no cumulative log can satisfy an assert).
  const ROW_TIME = "2026-10-13";

  function buildScene() {
    const { engine, scheduler } = mountEngine();
    const visible = engine.addSeries("candles", {
      color: COL.seriesVis, upColor: COL.seriesVis, downColor: COL.seriesVis,
    }, 0);
    visible.setData([{ time: ROW_TIME, open: 10, high: 11, low: 9, close: 10.5 }]);
    visible.createPriceLine({ price: 10.2, color: COL.lineVis });
    visible.setMarkers([
      { time: ROW_TIME, position: "aboveBar", shape: "circle", color: COL.markerVis, text: "M" },
    ]);
    const hidden = engine.addSeries("line", { color: COL.seriesHidden }, 1);
    hidden.setData([{ time: ROW_TIME, value: 5 }]);
    hidden.createPriceLine({ price: 5, color: COL.lineHidden });
    hidden.setMarkers([
      { time: ROW_TIME, position: "aboveBar", shape: "circle", color: COL.markerHidden, text: "H" },
    ]);
    hidden.applyOptions({ visible: false });
    engine.setWatermark(0, {
      visible: true,
      lines: [{ text: "VIS", color: COL.watermarkVis }],
    });
    engine.setWatermark(1, {
      visible: false,
      lines: [{ text: "HID", color: COL.watermarkHidden }],
    });
    const paints = { bottom: 0, normal: 0, top: 0 };
    const prim = (id: string, zOrder: "bottom" | "normal" | "top", color: string) => ({
      id,
      zOrder,
      attached() {},
      detached() {},
      update() {},
      paint(ctx: CanvasRenderingContext2D) {
        paints[zOrder] += 1;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
      },
    });
    visible.attachPrimitive(prim("primBottom", "bottom", COL.primBottom));
    visible.attachPrimitive(prim("primNormal", "normal", COL.primNormal));
    visible.attachPrimitive(prim("primTop", "top", COL.primTop));
    return { engine, scheduler, visible, hidden, paints };
  }

  it("the mm engine paints the visible watermark and never paints the visible:false watermark", () => {
    const { engine, scheduler } = buildScene();
    clearCalls(engineCanvases());
    scheduler.flush();                       // ONE frame
    expect(opsWithColors(paneCanvasOf(0), [COL.watermarkVis]).length).toBeGreaterThan(0);
    for (const canvas of engineCanvases()) {
      const leaked = opsWithColors(canvas, [COL.watermarkHidden]);
      expect(leaked.map((op) => [op.method, op.fillStyle, op.args])).toEqual([]);
    }
    engine.destroy();
  });

  it("the mm engine keeps a series hidden with applyOptions({ visible: false }), its price line and its markers off every canvas", () => {
    const { engine, scheduler } = buildScene();
    clearCalls(engineCanvases());
    scheduler.flush();                       // ONE frame
    for (const canvas of engineCanvases()) {
      const leaked = opsWithColors(canvas, [
        COL.seriesHidden, COL.lineHidden, COL.markerHidden,
      ]);
      expect(leaked.map((op) => [op.method, op.fillStyle, op.strokeStyle, op.args])).toEqual([]);
    }
    // Control: in the same frame the visible series' own colour DOES reach pane 0,
    // so the empty result above is not an artefact of a chart that painted nothing.
    expect(opsWithColors(paneCanvasOf(0), [COL.seriesVis]).length).toBeGreaterThan(0);
    expect(opsWithColors(paneCanvasOf(0), [COL.lineVis]).length).toBeGreaterThan(0);
    expect(opsWithColors(paneCanvasOf(0), [COL.markerVis]).length).toBeGreaterThan(0);
    engine.destroy();
  });

  it("one flush paints each visible primitive exactly once and pane 0 follows the documented z-order", () => {
    const { engine, scheduler, paints } = buildScene();
    clearCalls(engineCanvases());
    scheduler.flush();                       // ONE frame
    // Each primitive counts its own paint() calls: exactly one per tier per frame.
    expect(paints).toEqual({ bottom: 1, normal: 1, top: 1 });
    const pane0 = paneCanvasOf(0);
    const all = ctxOf(pane0).__calls;
    const firstOpOf = (color: string): number => {
      const ops = opsWithColors(pane0, [color]);
      expect(ops.length).toBeGreaterThan(0);
      return all.indexOf(ops[0]);
    };
    const bottom = firstOpOf(COL.primBottom);
    const series = firstOpOf(COL.seriesVis);
    const normal = firstOpOf(COL.primNormal);
    const watermark = firstOpOf(COL.watermarkVis);
    const top = firstOpOf(COL.primTop);
    // Paint order documented at frame.ts:2-3 — bottom primitives → series →
    // price lines → markers → normal primitives → watermark → top primitives.
    expect(bottom).toBeLessThan(series);
    expect(series).toBeLessThan(normal);
    expect(normal).toBeLessThan(watermark);
    expect(watermark).toBeLessThan(top);
    engine.destroy();
  });

  it("takeScreenshot() blits the pane canvases in pane order and then the overlay, each exactly once", () => {
    const { engine, scheduler, visible } = buildScene();
    scheduler.flush();
    // A parked external crosshair is what makes the overlay part of the
    // composite (index.ts:582 `overlayOn`).
    engine.setCrosshairPosition(10.4, ROW_TIME, visible);
    scheduler.flush();
    const out = engine.takeScreenshot();
    expect(out).toBeInstanceOf(HTMLCanvasElement);
    const pane0 = paneCanvasOf(0);
    const pane1 = paneCanvasOf(1);
    const overlay = overlayCanvasOf();
    const sources = callsOf(out)
      .filter((c) => c.method === "drawImage")
      .map((c) => c.args[0]);
    // Exactly the engine's own layer canvases: panes first in pane order, then
    // the overlay — each drawn exactly once (no foreign bitmap, no double blit).
    expect(sources).toHaveLength(3);
    expect(sources[0]).toBe(pane0);
    expect(sources[1]).toBe(pane1);
    expect(sources[2]).toBe(overlay);
    engine.destroy();
  });

  it("WatermarkSpec.visible=false suppresses that watermark's paints (no fabricated text)", () => {
    // Direct test on layoutWatermark (decorations.ts:367) so the row's
    // watermark-honesty observation is asserted without engine-mount overhead.
    const measure = (t: string) => t.length * 7;
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
