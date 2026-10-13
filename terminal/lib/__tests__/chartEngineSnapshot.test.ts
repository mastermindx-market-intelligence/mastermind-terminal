// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  composeSnapshot,
  cropSnapshot,
  layersFromPanes,
  snapshotDataUrl,
  SnapshotUnavailableError,
} from "../chart-engine/canvas/snapshot";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the synchronous snapshot compositor (R05).
//
// jsdom has no canvas raster — getContext("2d") returns null without the node-canvas
// package — so, following the house precedent (lwcAdapter.test.ts models LWC rather
// than running it), HTMLCanvasElement.prototype.getContext is spied with a recording
// fake and every visual claim below is asserted against the ops the compositor issued
// (drawImage args, fillRect, globalAlpha at call time). What makes that evidence rather
// than bookkeeping: the compositor is only ever observed through the SAME public surface
// a real canvas would expose.
// ─────────────────────────────────────────────────────────────────────────────

// The recording 2d context. Property writes (fillStyle/globalAlpha) land on the object;
// drawImage/fillRect append one op row with the property values AT CALL TIME.
interface RecordedOp {
  op: "drawImage" | "fillRect";
  alpha: number;
  fillStyle?: string;
  args: unknown[];
}
interface RecordedCtx {
  globalAlpha: number;
  fillStyle: string;
  ops: RecordedOp[];
  drawImage: (...args: unknown[]) => void;
  fillRect: (...args: unknown[]) => void;
}

const ctxByCanvas = new WeakMap<HTMLCanvasElement, RecordedCtx>();

function ensureCtx(canvas: HTMLCanvasElement): RecordedCtx {
  let ctx = ctxByCanvas.get(canvas);
  if (!ctx) {
    ctx = {
      globalAlpha: 1,
      fillStyle: "",
      ops: [],
      drawImage(...args: unknown[]) {
        ctx!.ops.push({ op: "drawImage", alpha: ctx!.globalAlpha, args });
      },
      fillRect(...args: unknown[]) {
        ctx!.ops.push({ op: "fillRect", alpha: ctx!.globalAlpha, fillStyle: ctx!.fillStyle, args });
      },
    };
    ctxByCanvas.set(canvas, ctx);
  }
  return ctx;
}

function opsOf(canvas: HTMLCanvasElement): RecordedOp[] {
  return ensureCtx(canvas).ops;
}

// Only mockRestore() is needed after the suite's own restoreAllMocks; typing the spy by
// the DOM method's overloaded signature buys nothing here.
let getContextSpy: { mockRestore(): void } | null = null;

beforeEach(() => {
  // A plain function (not an arrow): the spy's receiver is the canvas the caller wants a
  // context for, and that canvas is the key the recorder is filed under. The cast bridges
  // lib.dom's three getContext overloads to one recorded implementation.
  const fakeGetContext = function (this: HTMLCanvasElement, contextId: string): CanvasRenderingContext2D | null {
    if (contextId !== "2d" || !this) return null;
    return ensureCtx(this) as unknown as CanvasRenderingContext2D;
  };
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(fakeGetContext as never);
});

afterEach(() => {
  getContextSpy?.mockRestore();
  vi.restoreAllMocks();
});

// A canvas source for layers/crops: sized, and optionally tagged so assertions can name
// the source recorded inside drawImage args.
function makeCanvas(width: number, height: number, tag?: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (tag !== undefined) (canvas as unknown as { __tag?: string }).__tag = tag;
  return canvas;
}

const SRC = join(__dirname, "../chart-engine/canvas/snapshot.ts");

describe("composeSnapshot — R05-A01 synchronous composite", () => {
  it("returns an HTMLCanvasElement that is not a thenable (no deferred answer)", () => {
    const out = composeSnapshot([], { widthPx: 100, heightPx: 50, dpr: 1 });
    expect(out).toBeInstanceOf(HTMLCanvasElement);
    expect(typeof (out as unknown as { then?: unknown }).then).toBe("undefined");
  });

  it("the module source contains no deferred-encoding construct (static law)", () => {
    // R05-A01 is a property of the module, not of one call: scan the source so an
    // accidentally-introduced deferred path fails CI even if no runtime case covers it.
    const src = readFileSync(SRC, "utf8");
    expect(src).toMatch(/\bexport function composeSnapshot\b/); // guard: scanned the real file
    for (const banned of [/\basync\b/, /\bawait\b/, /\.then\s*\(/, /\btoBlob\b/, /\bconvertToBlob\b/, /\bPromise\b/]) {
      expect(src.match(banned)).toBeNull();
    }
    // The background is always the caller's; a baked-in fill color is a palette leak.
    expect(src.match(/fillStyle\s*=\s*["'#]/)).toBeNull();
  });

  it("rasterizes at round(css × dpr) device pixels", () => {
    const cases: [number, number, number, number, number][] = [
      [100, 50, 1, 100, 50],
      [250, 100, 2, 500, 200],
      [100.3, 50.2, 2, 201, 100], // 200.6 → 201, 100.4 → 100
      [640, 400, 1.25, 800, 500],
    ];
    for (const [w, h, dpr, expW, expH] of cases) {
      const out = composeSnapshot([], { widthPx: w, heightPx: h, dpr });
      expect(out.width).toBe(expW);
      expect(out.height).toBe(expH);
    }
  });

  it("paints opts.background first, full-bleed, before every layer", () => {
    const pane = makeCanvas(10, 10, "pane");
    const out = composeSnapshot(
      [{ canvas: pane, x: 0, y: 0, width: 100, height: 50 }],
      { widthPx: 100, heightPx: 50, dpr: 2 },
      { background: "#0a0b0e" },
    );
    const ops = opsOf(out);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ op: "fillRect", fillStyle: "#0a0b0e" });
    expect(ops[0].args).toEqual([0, 0, 200, 100]);
    expect(ops[1].op).toBe("drawImage"); // fill strictly before any layer
  });

  it("omits the fill entirely when no background is given (default transparent)", () => {
    const out = composeSnapshot(
      [{ canvas: makeCanvas(10, 10), x: 0, y: 0, width: 10, height: 10 }],
      { widthPx: 10, heightPx: 10, dpr: 1 },
    );
    expect(opsOf(out).filter((o) => o.op === "fillRect")).toHaveLength(0);
  });

  it("draws layers in order at dpr-scaled positions (9-arg drawImage)", () => {
    const a = makeCanvas(200, 50, "pane0");
    const b = makeCanvas(100, 100, "pane1");
    const out = composeSnapshot(
      [
        { canvas: a, x: 0, y: 10, width: 200, height: 50 },
        { canvas: b, x: 40, y: 0, width: 100, height: 100 },
      ],
      { widthPx: 200, heightPx: 110, dpr: 2 },
    );
    const draws = opsOf(out).filter((o) => o.op === "drawImage");
    expect(draws).toHaveLength(2);
    expect(draws[0].args).toEqual([a, 0, 20, 400, 100]);
    expect(draws[1].args).toEqual([b, 80, 0, 200, 200]);
  });

  it("applies opacity via globalAlpha and restores it after each layer", () => {
    const out = composeSnapshot(
      [
        { canvas: makeCanvas(1, 1), x: 0, y: 0, width: 1, height: 1, opacity: 0.35 },
        { canvas: makeCanvas(1, 1), x: 0, y: 0, width: 1, height: 1 }, // no opacity → 1
        { canvas: makeCanvas(1, 1), x: 0, y: 0, width: 1, height: 1, opacity: 0.8 },
      ],
      { widthPx: 1, heightPx: 1, dpr: 1 },
    );
    const ctx = ensureCtx(out);
    const alphas = ctx.ops.map((o) => o.alpha);
    expect(alphas).toEqual([0.35, 1, 0.8]);
    expect(ctx.globalAlpha).toBe(1); // restored after the LAST layer too
  });

  it("uses an injected createCanvas and never touches the DOM for it", () => {
    const created: [number, number][] = [];
    const injected = makeCanvas(1, 1, "injected"); // deliberately wrong size
    const createElement = vi.spyOn(document, "createElement");
    const out = composeSnapshot([], { widthPx: 120, heightPx: 80, dpr: 2 }, {
      createCanvas: (w, h) => {
        created.push([w, h]);
        return injected;
      },
    });
    expect(created).toEqual([[240, 160]]);
    expect(out).toBe(injected);
    // The bitmap-size law is asserted on the injected canvas regardless of its factory size.
    expect(out.width).toBe(240);
    expect(out.height).toBe(160);
    expect(createElement).not.toHaveBeenCalled();
    createElement.mockRestore();
  });
});

describe("layersFromPanes — pane layout → layer list", () => {
  it("maps panes to full-width layers at their tops, then full-chart overlays above", () => {
    const pane0 = makeCanvas(800, 300, "pane0");
    const pane1 = makeCanvas(800, 199, "pane1");
    const crosshair = makeCanvas(800, 500, "crosshair");
    const drawings = makeCanvas(800, 500, "drawings");
    const layers = layersFromPanes(
      [
        { canvas: pane0, top: 0, height: 300 },
        { canvas: pane1, top: 301, height: 199 },
      ],
      [{ canvas: crosshair }, { canvas: drawings }],
      800,
    );
    expect(layers).toHaveLength(4);
    const out = composeSnapshot(layers, { widthPx: 800, heightPx: 500, dpr: 2 });
    const draws = opsOf(out).filter((o) => o.op === "drawImage");
    expect(draws.map((d) => (d.args[0] as { __tag?: string }).__tag)).toEqual([
      "pane0", "pane1", "crosshair", "drawings",
    ]);
    expect(draws[0].args).toEqual([pane0, 0, 0, 1600, 600]);
    expect(draws[1].args).toEqual([pane1, 0, 602, 1600, 398]);
    // Overlays span the composed height (the lowest pane edge: 301 + 199 = 500 CSS px).
    expect(draws[2].args).toEqual([crosshair, 0, 0, 1600, 1000]);
    expect(draws[3].args).toEqual([drawings, 0, 0, 1600, 1000]);
  });

  it("no panes → no layers from overlays' span alone is still composable at height 0", () => {
    const layers = layersFromPanes([], [{ canvas: makeCanvas(10, 10) }], 100);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ x: 0, y: 0, width: 100, height: 0 });
  });
});

describe("cropSnapshot — R05-A03 pixel-exact evidence crops", () => {
  it("integer-aligned rect: 1:1 blit of the device-pixel region (dest size == source size)", () => {
    const src = makeCanvas(400, 800, "src");
    const out = cropSnapshot(src, { x: 10, y: 20, w: 100, h: 60 }, 2);
    expect(out.width).toBe(200);
    expect(out.height).toBe(120);
    const draws = opsOf(out).filter((o) => o.op === "drawImage");
    expect(draws).toHaveLength(1);
    // Source rect == dest rect ⇒ no resampling ⇒ the crop is byte-identical to the region.
    expect(draws[0].args).toEqual([src, 20, 40, 200, 120, 0, 0, 200, 120]);
  });

  it("keeps dpr 1 crops at CSS resolution (device px are the crop px)", () => {
    const src = makeCanvas(800, 600);
    const out = cropSnapshot(src, { x: 100, y: 150, w: 320, h: 240 }, 1);
    expect([out.width, out.height]).toEqual([320, 240]);
    expect(opsOf(out)[0].args).toEqual([src, 100, 150, 320, 240, 0, 0, 320, 240]);
  });

  it("snaps rect EDGES to the device grid, not origin+size separately", () => {
    const src = makeCanvas(64, 64);
    // x=5.2→10.4→10; x+w=15.4→30.8→31 ⇒ sw 21, whereas rounding w alone gives
    // round(20.4)=20 — one device column would be silently dropped or stretched.
    // y=0.3→0.6→1; y+h=8.2→16.4→16 ⇒ sh 15 (rounding h alone gives 16).
    const out = cropSnapshot(src, { x: 5.2, y: 0.3, w: 10.2, h: 7.9 }, 2);
    expect([out.width, out.height]).toEqual([21, 15]);
    expect(opsOf(out)[0].args).toEqual([src, 10, 1, 21, 15, 0, 0, 21, 15]);
  });

  it("two adjacent crops share the exact same snapped edge (no gap, no doubled row)", () => {
    const src = makeCanvas(128, 32);
    const left = cropSnapshot(src, { x: 5.2, y: 0, w: 10.2, h: 32 }, 2);   // spans [10.4, 30.8)
    const right = cropSnapshot(src, { x: 15.4, y: 0, w: 10.2, h: 32 }, 2); // starts at 30.8
    const leftArgs = opsOf(left)[0].args;
    const rightArgs = opsOf(right)[0].args;
    const leftEdge = (leftArgs[1] as number) + (leftArgs[3] as number);  // sx + sw
    expect(rightArgs[1]).toBe(leftEdge); // right crop's sx is left crop's end — contiguous
  });

  it("a degenerate (empty after snapping) rect throws RangeError, not a 0×0 canvas", () => {
    const src = makeCanvas(10, 10);
    expect(() => cropSnapshot(src, { x: 0, y: 0, w: 0, h: 5 }, 2)).toThrow(RangeError);
    expect(() => cropSnapshot(src, { x: 0, y: 0, w: 5, h: -1 }, 1)).toThrow(/degenerate crop/);
  });
});

describe("snapshotDataUrl — R05-A02 explicit failure, never a blank image", () => {
  it("returns a real encode verbatim and forwards the requested type", () => {
    const canvas = makeCanvas(2, 2);
    const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAACZgbYn";
    const spy = vi.spyOn(canvas, "toDataURL").mockReturnValue(url);
    expect(snapshotDataUrl(canvas)).toBe(url);
    expect(snapshotDataUrl(canvas, "image/jpeg")).toBe(url);
    expect(spy).toHaveBeenNthCalledWith(2, "image/jpeg");
    expect(spy).toHaveBeenCalledWith("image/png"); // default type
  });

  it("throws SnapshotUnavailableError for the blank sentinels 'data:,' / 'data:' / empty payload", () => {
    for (const blank of ["data:,", "data:", "data:image/png;base64,", "not-a-data-url", ""]) {
      const canvas = makeCanvas(2, 2);
      vi.spyOn(canvas, "toDataURL").mockReturnValue(blank);
      expect(() => snapshotDataUrl(canvas)).toThrow(SnapshotUnavailableError);
    }
  });

  it("wraps a throwing toDataURL (jsdom 'Not implemented') in the typed error with the cause", () => {
    const canvas = makeCanvas(2, 2);
    vi.spyOn(canvas, "toDataURL").mockImplementation(() => {
      throw new Error("Not implemented: HTMLCanvasElement.prototype.toDataURL");
    });
    let err: unknown;
    try {
      snapshotDataUrl(canvas);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SnapshotUnavailableError);
    expect((err as SnapshotUnavailableError).cause).toBeInstanceOf(Error);
    expect((err as { cause: Error }).cause.message).toMatch(/Not implemented/);
  });

  it("a canvas without a toDataURL method is a typed error, not a TypeError", () => {
    const bare = { width: 2, height: 2 } as HTMLCanvasElement;
    expect(() => snapshotDataUrl(bare)).toThrow(SnapshotUnavailableError);
  });

  it("in bare jsdom (no raster installed) the unspied call fails typed — never a blank URL", () => {
    // No mock on this element: whatever jsdom does without node-canvas — throw
    // "Not implemented" or return the empty sentinel — the contract answer is the same.
    const canvas = document.createElement("canvas");
    let err: unknown = null;
    try {
      snapshotDataUrl(canvas);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SnapshotUnavailableError);
  });
});
