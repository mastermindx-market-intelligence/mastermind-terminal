// @vitest-environment jsdom
//
// ── THE PRIMS THAT DELETED THE CHART'S GESTURES ────────────────────────────────────────────────
//
// `bindTooltip` used to set `pointer-events:auto` on every premium-suite prim carrying a tooltip,
// inside an indicator layer that is itself `pointer-events:none`. That is not a smaller version of
// a JS hit test, it is a broken one: the lightweight-charts canvas is a SIBLING subtree of this
// overlay (both are appended to `wrap = el.parentElement`), so an event landing on a hit-testable
// prim bubbles to the wrapper and never reaches the chart at all. Every prim with a tooltip
// therefore removed pan, wheel-zoom and crosshair over its own footprint, in production.
//
// The unit-level falsifier is the first test below: no element in the layer may be hit-testable.
// The gesture claim itself is proved against the live chart in e2e/indicator-prim-tooltip.spec.ts
// (including the counterfactual that re-adds `pointer-events:auto` and watches the pan die).
//
// Everything else here pins the replacement: the delegated wrapper hit test, its per-frame cache
// invalidation, the touch tap path, and the clip-window intersection that keeps a clipped-invisible
// prim from ghost-hitting.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureTooltipHost, renderPrims } from "@/lib/indicator-canvas/render";
import type {
  CoordMapper, LabelPrim, MarkerPrim, Prim, SuiteRenderBundle, TooltipDef,
} from "@/lib/indicator-canvas/types";

const NS = "http://www.w3.org/2000/svg";

/** The chart wrapper + indicator overlay, in ChartPanel's own arrangement: the <svg> is a CHILD of
 *  the wrapper (in production it is a sibling of the chart container that owns the canvas). */
function mount(): { wrap: HTMLElement; svg: SVGSVGElement } {
  document.body.innerHTML = "";
  const wrap = document.createElement("div");
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  wrap.appendChild(svg);
  document.body.appendChild(wrap);
  return { wrap, svg };
}

const mapper = (): CoordMapper => ({
  xi: (i: number) => 20 + i * 20,
  y: (p: number) => 300 - p,
  W: 600, H: 400, i0: 0, i1: 20, barW: 20,
});

const tipDef = (id: string, title: string): TooltipDef => ({
  id, title, accent: "var(--up)", rows: [{ k: "Entry", v: "12.34" }, { k: "Tier", v: "Standard" }],
});

/** A bundle carrying one of every tooltip-capable prim kind. `marker` and `label` are the two kinds
 *  whose emitters attach a tooltipId today; a third prim is deliberately left WITHOUT one. */
function bundle(): SuiteRenderBundle {
  const prims: Prim[] = [
    { kind: "marker", id: "m1", i: 3, p: 120, shape: "tri-up", size: 6, fill: "var(--up)", tooltipId: "t-buy" } as MarkerPrim,
    { kind: "label", id: "l1", i: 3, p: 120, text: "BUY", place: "below", style: "pill", color: "var(--text)", bg: "var(--up)", pointer: true, tooltipId: "t-buy" } as LabelPrim,
    { kind: "marker", id: "m2", i: 9, p: 60, shape: "tri-down", size: 6, fill: "var(--down)", tooltipId: "t-sell" } as MarkerPrim,
    { kind: "label", id: "l2", i: 9, p: 60, text: "SELL", place: "above", style: "pill", color: "var(--text)", bg: "var(--down)", tooltipId: "t-sell" } as LabelPrim,
    // no tooltipId — must stay entirely untouched by the tooltip path
    { kind: "marker", id: "m3", i: 15, p: 90, shape: "circle", size: 4, fill: "var(--muted)" } as MarkerPrim,
  ];
  return {
    prims,
    tooltips: new Map([["t-buy", tipDef("t-buy", "BUY signal")], ["t-sell", tipDef("t-sell", "SELL signal")]]),
    candlePaint: [], events: [], tables: [],
  };
}

type Box = { x: number; y: number; w: number; h: number };

/** jsdom lays nothing out, so every rect the hit test reads is stubbed explicitly. That is the
 *  whole point of measuring in CLIENT coordinates: the test controls the same space the pointer
 *  events report in, and no SVG user-space conversion is involved. */
function stubRect(el: Element, b: Box): void {
  (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({
    x: b.x, y: b.y, width: b.w, height: b.h,
    left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h,
    toJSON: () => b,
  }) as DOMRect;
}

/** Stub the wrapper + overlay. They are coincident (the overlay is `inset:0` inside the wrapper) and
 *  default to the viewport origin, where client coords and SVG user units read the same — convenient
 *  for the tests that are not about coordinate spaces. Pass an origin for the tests that ARE: in
 *  production the chart sits below a header and right of a nav rail, never at 0,0. */
function stubHost(wrap: HTMLElement, svg: SVGSVGElement, origin = { x: 0, y: 0 }): void {
  stubRect(wrap, { x: origin.x, y: origin.y, w: 600, h: 400 });
  stubRect(svg, { x: origin.x, y: origin.y, w: 600, h: 400 });
}

/** Give every tooltip'd prim a box, keyed by its tooltip id. */
function stubTips(wrap: HTMLElement, boxes: Record<string, Box>): Element[] {
  const out: Element[] = [];
  for (const el of wrap.querySelectorAll("svg [data-ic-tip]")) {
    const b = boxes[el.getAttribute("data-ic-tip") || ""];
    if (b) { stubRect(el, b); out.push(el); }
  }
  return out;
}

/** jsdom 26 registers no PointerEvent interface at all, so the handlers are fed MouseEvents with
 *  the pointer fields defined on top — which is also why the hover path reads an ABSENT
 *  `pointerType` as a mouse. */
function pointer(
  type: string,
  init: { clientX: number; clientY: number; buttons?: number; pointerType?: string; pointerId?: number },
): MouseEvent {
  const ev = new MouseEvent(type, {
    bubbles: true, cancelable: true,
    clientX: init.clientX, clientY: init.clientY, buttons: init.buttons ?? 0,
  });
  if (init.pointerType !== undefined) Object.defineProperty(ev, "pointerType", { value: init.pointerType });
  if (init.pointerId !== undefined) Object.defineProperty(ev, "pointerId", { value: init.pointerId });
  return ev;
}

/** Dispatch FROM a node inside the overlay, so the assertion covers the delegation itself: the
 *  wrapper's listener must see an event that landed on a prim. */
function send(from: Element, type: string, init: Parameters<typeof pointer>[1]): void {
  from.dispatchEvent(pointer(type, init));
}

const tipOf = (wrap: HTMLElement) => wrap.querySelector(":scope > .ic-tip") as HTMLElement | null;
const shown = (wrap: HTMLElement) => {
  const t = tipOf(wrap);
  return !!t && t.style.display === "block";
};

describe("indicator-canvas prim tooltips — the layer stays non-hit-testable", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  // ── 1. THE FALSIFIER ───────────────────────────────────────────────────────────────────────
  it("makes no prim hit-testable, of any tooltip-capable kind", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());

    const tipped = [...wrap.querySelectorAll("svg [data-ic-tip]")];
    expect(tipped.length, "every tooltip'd prim kind should have rendered").toBeGreaterThanOrEqual(4);
    for (const el of tipped) {
      expect(el.hasAttribute("pointer-events"),
        `${el.getAttribute("data-ic-tip")} carries a pointer-events attribute — it would swallow the chart's gestures`,
      ).toBe(false);
    }
    // …and nothing ELSE in the layer smuggled one in either (a group wrapping a tooltip'd prim
    // would delete the same gestures without ever matching the query above).
    expect(svg.querySelectorAll('[pointer-events="auto"]').length).toBe(0);
    expect(svg.querySelectorAll("[pointer-events]").length).toBe(0);
  });

  it("marks data-ic-tip on exactly the prims that carry a tooltipId", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());

    const ids = [...wrap.querySelectorAll("svg [data-ic-tip]")].map((e) => e.getAttribute("data-ic-tip"));
    expect(ids.filter((i) => i === "t-buy").length).toBe(2);    // marker + pill
    expect(ids.filter((i) => i === "t-sell").length).toBe(2);
    expect(new Set(ids)).toEqual(new Set(["t-buy", "t-sell"]));
    // the untooltipped marker rendered and was left alone
    expect(svg.querySelectorAll("circle").length).toBe(1);
    expect(svg.querySelector("circle")!.hasAttribute("data-ic-tip")).toBe(false);
  });

  // ── 2. THE DELEGATED HIT TEST ──────────────────────────────────────────────────────────────
  it("shows the def's tooltip on a hover that hits, and hides it on one that misses", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, {
      "t-buy": { x: 100, y: 100, w: 14, h: 14 },
      "t-sell": { x: 300, y: 200, w: 14, h: 14 },
    });

    expect(shown(wrap), "nothing is shown before a pointer arrives").toBe(false);

    send(first, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap)).toBe(true);
    expect(tipOf(wrap)!.textContent).toContain("BUY signal");
    expect(tipOf(wrap)!.dataset.icTipFor).toBe("t-buy");

    // the second prim's own def, not the first one's, on its own box
    send(first, "pointermove", { clientX: 307, clientY: 207 });
    expect(tipOf(wrap)!.textContent).toContain("SELL signal");
    expect(tipOf(wrap)!.dataset.icTipFor).toBe("t-sell");

    // empty chart between the two prims
    send(first, "pointermove", { clientX: 500, clientY: 380 });
    expect(shown(wrap)).toBe(false);
  });

  it("treats a marked prim with no registered def as a miss, not an empty tooltip", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });
    // The defs map is merged per wrapper and never pruned, so an id it does not carry is the
    // honest "I have nothing to say about this prim" case. It must read as empty chart.
    const ghost = wrap.querySelector('[data-ic-tip="t-buy"]')!;
    ghost.setAttribute("data-ic-tip", "t-ghost");

    send(wrap, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap), "an unknown tooltip id raised the shared node anyway").toBe(false);
  });

  it("hovers within the mouse slack, and not far past it", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });   // box x 100..114

    // 2px outside the right edge — inside MARKER_HOVER_SLACK (3). These prims are 6–14px across, so
    // a hit test with no forgiveness at all is unusable in the hand; both other hover tests probe
    // box CENTRES, where a slack of zero would read identically.
    send(first, "pointermove", { clientX: 116, clientY: 107 });
    expect(shown(wrap), "the hover slack is not wired — only the box interior hits").toBe(true);
    // …and the forgiveness is the MOUSE one, not the fingertip one: 16px out is empty chart.
    send(first, "pointermove", { clientX: 130, clientY: 107 });
    expect(shown(wrap), "the hover slack reaches far past the prim").toBe(false);
  });

  it("does not open a tooltip on a mouse click, and does not freeze hover with one", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });

    // A still press-and-release with a MOUSE is a click on the chart, not a tooltip gesture: the
    // cursor is already the hover affordance, and a pinned tooltip would have nothing to dismiss it
    // except another click.
    send(first, "pointerdown", { clientX: 107, clientY: 107, pointerType: "mouse", pointerId: 1 });
    send(first, "pointerup", { clientX: 107, clientY: 107, pointerType: "mouse", pointerId: 1 });
    expect(shown(wrap), "a mouse click pinned a tooltip the cursor cannot dismiss").toBe(false);

    // …and it must not have stamped the post-touch suppression window on the way past, which would
    // silently kill hover for 700ms after every click on the chart.
    send(first, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap), "a mouse click froze hover — it set the touch-suppression window").toBe(true);
  });

  it("hover is live in the first 700ms of the page's life, before any touch", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });

    // Fake `performance` so now() reads ~0 — a freshly loaded page. No touch has happened, so the
    // post-touch suppression window must NOT be armed: its timestamp starts at 0, and an ungated
    // `now() - 0 < 700` reads true for the page's whole first 700ms. That shape shipped as a
    // dead-on-load signal-marker hover path in ChartPanel's copy of this guard (found 2026-08-10
    // reviewing PR #387); the copies' SHAPE is pinned by syntheticTouchHoverGuard.test.ts, the
    // gated BEHAVIOR by this test — the ordinary hover tests can't, because a real clock is past
    // 700ms by the time a worker reaches them, which makes the ungated guard read as gated.
    vi.useFakeTimers({ toFake: ["performance"] });
    try {
      expect(performance.now(), "the faked clock must sit inside the 700ms window").toBeLessThan(700);
      send(first, "pointermove", { clientX: 107, clientY: 107 });
      expect(shown(wrap), "a hover in the page's first 700ms was eaten by an unarmed suppression window").toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("never chases a pan: a move with a button held hides the tooltip", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });

    send(first, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap)).toBe(true);

    send(first, "pointerdown", { clientX: 107, clientY: 107, pointerType: "mouse", pointerId: 1 });
    expect(shown(wrap), "a press dismisses before the gesture it starts").toBe(false);
    // mid-drag, still over the prim — the tooltip must not come back under the cursor
    send(first, "pointermove", { clientX: 107, clientY: 107, buttons: 1 });
    expect(shown(wrap)).toBe(false);
    // released outside the window: the next buttonless move heals the flag and hover resumes
    send(first, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap)).toBe(true);
  });

  it("coalesces tooltip positioning to one layout read per frame while keeping content immediate", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });

    // First appearance stays synchronous so a newly opened tooltip never flashes at the wrapper
    // origin for one frame. The hot path begins once the node is already visible and merely follows
    // a high-Hz cursor.
    send(first, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap)).toBe(true);

    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }));

    const hostRect = wrap.getBoundingClientRect.bind(wrap);
    let hostReads = 0;
    wrap.getBoundingClientRect = () => {
      hostReads++;
      return hostRect();
    };

    try {
      const points = Array.from({ length: 12 }, (_, i) => ({
        x: 104 + (i % 8),
        y: 104 + ((i * 3) % 8),
      }));
      for (const p of points) send(first, "pointermove", { clientX: p.x, clientY: p.y });

      expect(shown(wrap), "tooltip content/visibility should not wait for the next paint").toBe(true);
      expect(tipOf(wrap)!.textContent).toContain("BUY signal");
      expect(frames, "a burst should schedule one tooltip-position paint").toHaveLength(1);
      expect(hostReads, "positioning should not force wrapper layout before the frame").toBe(0);

      frames[0](16);
      expect(hostReads, "the whole burst should cost one wrapper geometry read").toBe(1);

      const last = points[points.length - 1];
      expect(tipOf(wrap)!.style.left).toBe(`${last.x + 12}px`);
      expect(tipOf(wrap)!.style.top).toBe(`${last.y + 14}px`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cancels queued cursor-follow positioning when hover leaves before paint", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });

    send(first, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap)).toBe(true);

    const frames: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => cancelled.push(id)));

    const hostRect = wrap.getBoundingClientRect.bind(wrap);
    let hostReads = 0;
    wrap.getBoundingClientRect = () => {
      hostReads++;
      return hostRect();
    };

    try {
      send(first, "pointermove", { clientX: 108, clientY: 108 });
      expect(frames).toHaveLength(1);
      send(first, "pointermove", { clientX: 500, clientY: 380 });

      expect(shown(wrap)).toBe(false);
      expect(cancelled).toEqual([1]);
      expect(hostReads).toBe(0);

      // A browser may still deliver a callback already dequeued for execution. The callback itself
      // must be harmless after hide() cleared the pending sample.
      frames[0](16);
      expect(hostReads).toBe(0);
      expect(shown(wrap)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // ── 3. THE CACHE IS PER FRAME ──────────────────────────────────────────────────────────────
  it("drops the measured boxes on every render, so a second suite's prims are hoverable too", () => {
    // Deliberately NOT written as "clear the layer, repaint, hover the old spot": that scenario is
    // also caught by the detached-element rebuild below, so it would pass with the invalidation
    // deleted. This is the case only the invalidation can answer — ChartPanel clears the layer ONCE
    // per frame and then calls renderPrims per suite, so the first suite's elements are still
    // attached (and still cached) when the second suite's prims arrive.
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });
    send(first, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap)).toBe(true);          // cache is now populated with suite one only
    send(first, "pointermove", { clientX: 500, clientY: 380 });

    const second = bundle();
    second.prims = [{
      kind: "marker", id: "s1", i: 12, p: 40, shape: "diamond", size: 6,
      fill: "var(--warn)", tooltipId: "t-second",
    } as MarkerPrim];
    second.tooltips = new Map([["t-second", tipDef("t-second", "Second suite")]]);
    renderPrims(svg, second, mapper());
    stubTips(wrap, {
      "t-buy": { x: 100, y: 100, w: 14, h: 14 },
      "t-sell": { x: 300, y: 200, w: 14, h: 14 },
      "t-second": { x: 420, y: 260, w: 14, h: 14 },
    });

    send(wrap, "pointermove", { clientX: 427, clientY: 267 });
    expect(shown(wrap), "the stale cache survived the render — the later suite was unhoverable").toBe(true);
    expect(tipOf(wrap)!.textContent).toContain("Second suite");
  });

  it("rebuilds when the layer was emptied with no render behind it", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });
    send(first, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap)).toBe(true);

    // every suite toggled off: the layer is cleared and renderPrims is never called again
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    send(wrap, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap), "a detached prim kept hit-testing from the stale cache").toBe(false);
  });

  // ── 4. TOUCH ───────────────────────────────────────────────────────────────────────────────
  it("pins a tapped tooltip until the next press", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });

    // Fake `performance.now()` from here: the tap's own timestamp and the move below must come off
    // the same clock for the final assertion to isolate the pin (see the comment there).
    vi.useFakeTimers({ toFake: ["performance"] });
    send(first, "pointerdown", { clientX: 106, clientY: 106, pointerType: "touch", pointerId: 7 });
    send(first, "pointerup", { clientX: 107, clientY: 107, pointerType: "touch", pointerId: 7 });
    expect(shown(wrap), "a still tap on a prim should open its tooltip").toBe(true);
    expect(tipOf(wrap)!.dataset.icTipFor).toBe("t-buy");

    // a pinned tooltip is not dismissed by the synthetic move touch emits behind it
    send(first, "pointermove", { clientX: 500, clientY: 380 });
    expect(shown(wrap)).toBe(true);
    // …nor by the pointerleave touch fires straight after the up
    send(wrap, "pointerleave", { clientX: 500, clientY: 380, pointerType: "touch", pointerId: 7 });
    expect(shown(wrap)).toBe(true);
    // …and not a second later either, once the post-touch suppression window has expired and the
    // PIN is the only thing holding it open. Without the clock this assertion is answered by the
    // 700ms guard instead and pins nothing.
    try {
      vi.advanceTimersByTime(1_000);
      send(first, "pointermove", { clientX: 500, clientY: 380 });
      expect(shown(wrap), "a pinned tooltip was chased away by a later cursor move").toBe(true);
    } finally { vi.useRealTimers(); }

    // the next press is what dismisses it — otherwise it is litter pinned over the chart
    send(wrap, "pointerdown", { clientX: 500, clientY: 380, pointerType: "touch", pointerId: 8 });
    expect(shown(wrap)).toBe(false);
  });

  it("gives a tap the FINGERTIP slack, which is wider than the cursor's", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });   // box x 100..114

    // 7px past the right edge: inside MARKER_TAP_SLACK (10), OUTSIDE MARKER_HOVER_SLACK (3). A
    // fingertip has no hover state to correct its aim with, so the tap box is deliberately the
    // wider of the two — a tap path built on the hover slack would dead-end on a 14px prim.
    send(first, "pointerdown", { clientX: 121, clientY: 107, pointerType: "touch", pointerId: 7 });
    send(first, "pointerup", { clientX: 121, clientY: 107, pointerType: "touch", pointerId: 7 });
    expect(shown(wrap), "a fingertip 7px off the prim missed — the tap used the cursor's slack")
      .toBe(true);
  });

  it("ignores a release from a different finger than the one that pressed", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });

    // Two-finger gestures are the chart's pinch-zoom. The second finger's release must not be read
    // as the completion of the first finger's press, or a pinch that happens to start on a prim
    // ends with a tooltip pinned over the chart the reader just zoomed.
    send(first, "pointerdown", { clientX: 107, clientY: 107, pointerType: "touch", pointerId: 7 });
    send(first, "pointerup", { clientX: 107, clientY: 107, pointerType: "touch", pointerId: 8 });
    expect(shown(wrap), "a second finger's release opened the first finger's tooltip").toBe(false);
  });

  it("reads a press that travels as a pan, not a tap", () => {
    const { wrap, svg } = mount();
    renderPrims(svg, bundle(), mapper());
    stubHost(wrap, svg);
    const [first] = stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });

    send(first, "pointerdown", { clientX: 107, clientY: 107, pointerType: "touch", pointerId: 7 });
    for (let i = 1; i <= 8; i++) {
      send(first, "pointermove", { clientX: 107 + i * 12, clientY: 107, pointerType: "touch", pointerId: 7 });
    }
    send(first, "pointerup", { clientX: 203, clientY: 107, pointerType: "touch", pointerId: 7 });
    expect(shown(wrap), "a travelled press left a tooltip over the pane the reader just panned").toBe(false);
  });

  // ── 5. CLIPPED-INVISIBLE PRIMS ─────────────────────────────────────────────────────────────
  it("does not hit a prim its clip window hides", () => {
    const { wrap, svg } = mount();
    // ChartPanel's own arrangement: a <defs><clipPath><rect> sized to the pane band, and a
    // clip-wrapped <g> the suite renders into. A TP/SL label pushed past the band is drawn but
    // invisible — and must not answer a hover.
    const defs = document.createElementNS(NS, "defs");
    const clip = document.createElementNS(NS, "clipPath");
    clip.setAttribute("id", "ic-price-clip-unit");
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", "0"); rect.setAttribute("y", "0");
    rect.setAttribute("width", "600"); rect.setAttribute("height", "150");
    clip.appendChild(rect); defs.appendChild(clip); svg.appendChild(defs);
    const g = document.createElementNS(NS, "g") as SVGGElement;
    g.setAttribute("clip-path", "url(#ic-price-clip-unit)");
    svg.appendChild(g);

    renderPrims(g, bundle(), mapper());
    stubHost(wrap, svg);
    stubTips(wrap, {
      "t-buy": { x: 100, y: 100, w: 14, h: 14 },    // inside the band
      "t-sell": { x: 300, y: 300, w: 14, h: 14 },   // pushed below it — clipped away
    });

    send(wrap, "pointermove", { clientX: 307, clientY: 307 });
    expect(shown(wrap), "a clipped-invisible prim answered a hover").toBe(false);
    send(wrap, "pointermove", { clientX: 107, clientY: 107 });
    expect(shown(wrap), "the prim inside the clip window is still hoverable").toBe(true);
    expect(tipOf(wrap)!.dataset.icTipFor).toBe("t-buy");
  });

  it("clamps a partially clipped prim to its visible part, in the overlay's OWN client origin", () => {
    // THE TWO SPACES. A clipPath rect is written in SVG USER UNITS; a hit box is measured in CLIENT
    // coordinates. They differ by the overlay's own client origin, and the overlay is never at 0,0
    // in production — it sits below the header and right of the nav rail. A test that stubs the
    // overlay at the viewport origin makes `sr.x + rx` and `rx` indistinguishable, so deleting the
    // origin shift entirely would still read green while silently narrowing the wrong band on every
    // real chart. Hence the deliberate 240,120 offset here: every clip number below is in user
    // units and every pointer number is in client coordinates, and only the shift reconciles them.
    const ORIGIN = { x: 240, y: 120 };
    const { wrap, svg } = mount();
    const defs = document.createElementNS(NS, "defs");
    const clip = document.createElementNS(NS, "clipPath");
    clip.setAttribute("id", "ic-price-clip-unit-2");
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", "0"); rect.setAttribute("y", "0");          // user units: the pane band…
    rect.setAttribute("width", "600"); rect.setAttribute("height", "110");   // …is user y 0..110
    clip.appendChild(rect); defs.appendChild(clip); svg.appendChild(defs);
    const g = document.createElementNS(NS, "g") as SVGGElement;
    g.setAttribute("clip-path", "url(#ic-price-clip-unit-2)");
    svg.appendChild(g);

    renderPrims(g, bundle(), mapper());
    stubHost(wrap, svg, ORIGIN);
    // The prim spans user y 90..130 — half inside the band. In CLIENT coordinates that is
    // 120+90 = 210 .. 120+130 = 250, and the band's cut lands at client y 120+110 = 230.
    stubTips(wrap, { "t-buy": { x: ORIGIN.x + 100, y: ORIGIN.y + 90, w: 40, h: 40 } });

    send(wrap, "pointermove", { clientX: ORIGIN.x + 120, clientY: 220 });   // visible half
    expect(shown(wrap), "the visible half of a clipped prim did not answer a hover").toBe(true);
    send(wrap, "pointermove", { clientX: ORIGIN.x + 120, clientY: 245 });   // past the cut + slack
    expect(shown(wrap), "the hidden half of a clipped prim answered a hover").toBe(false);
  });

  // ── 6. HOST IDEMPOTENCE ────────────────────────────────────────────────────────────────────
  it("creates one tooltip host and one set of listeners per wrapper", () => {
    const { wrap, svg } = mount();
    ensureTooltipHost(wrap);
    ensureTooltipHost(wrap);
    renderPrims(svg, bundle(), mapper());
    renderPrims(svg, bundle(), mapper());
    expect(wrap.querySelectorAll(":scope > .ic-tip").length).toBe(1);

    stubHost(wrap, svg);
    stubTips(wrap, { "t-buy": { x: 100, y: 100, w: 14, h: 14 } });
    send(wrap, "pointermove", { clientX: 107, clientY: 107 });
    // one filled title, not four: duplicate listeners would each fill the same shared node
    expect(tipOf(wrap)!.querySelectorAll("div").length).toBe(3);   // title + 2 rows
  });
});
