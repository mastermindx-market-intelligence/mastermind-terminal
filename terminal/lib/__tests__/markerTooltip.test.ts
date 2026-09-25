import { describe, expect, it } from "vitest";
import {
  hitTestMarkers, placeMarkerTip, isTapGesture, gestureStamp, isTapSample, reanchorMarker,
  MARKER_HOVER_SLACK, MARKER_TAP_SLACK, type MarkerHit,
} from "../markerTooltip";

/** A ⊘ ring marker, roughly the real geometry: ~11px across, ~19px tall with the amber dot. */
const ring = (x: number, title = "ring"): MarkerHit =>
  ({ x, y: 100, w: 11, h: 19, title, t: title });
/** A BUY pill with its pointer triangle — the entry geometry, ~19×20. */
const pill = (x: number, title = "pill"): MarkerHit =>
  ({ x, y: 100, w: 19, h: 20, title, t: title });

describe("hitTestMarkers", () => {
  it("returns the marker under the point", () => {
    const boxes = [ring(50), pill(200)];
    expect(hitTestMarkers(boxes, 55, 110, 0)?.title).toBe("ring");
    expect(hitTestMarkers(boxes, 208, 110, 0)?.title).toBe("pill");
  });

  it("returns null off every marker", () => {
    expect(hitTestMarkers([ring(50)], 400, 110, 0)).toBeNull();
    expect(hitTestMarkers([ring(50)], 55, 400, 0)).toBeNull();
  });

  it("returns null when nothing is painted", () => {
    expect(hitTestMarkers([], 55, 110, MARKER_TAP_SLACK)).toBeNull();
  });

  it("misses just outside the box and hits once slack is allowed", () => {
    const boxes = [ring(50)];                 // x spans 50..61, y spans 100..119
    expect(hitTestMarkers(boxes, 63, 110, 0)).toBeNull();
    expect(hitTestMarkers(boxes, 63, 110, MARKER_HOVER_SLACK)?.title).toBe("ring");
  });

  it("grows a sub-touch-target marker into a tappable one", () => {
    // The reason MARKER_TAP_SLACK exists: an 11px ring is far under any usable touch target, so a
    // finger landing 9px off centre-edge must still open it. The hover slack must NOT be enough.
    const boxes = [ring(50)];
    expect(hitTestMarkers(boxes, 69, 110, MARKER_HOVER_SLACK)).toBeNull();
    expect(hitTestMarkers(boxes, 69, 110, MARKER_TAP_SLACK)?.title).toBe("ring");
  });

  it("resolves overlapping markers by centre distance, not by array order", () => {
    // Two fires on adjacent bars whose slack boxes overlap. Paint order is emitter ordering, so
    // resolving by "last one wins" would make the tooltip depend on it; the nearest centre is
    // what the reader is actually pointing at. Asserted BOTH ways round so the test cannot pass
    // by accidentally agreeing with the iteration order.
    const a = { ...ring(50), title: "a", t: "a" };
    const b = { ...ring(58), title: "b", t: "b" };
    expect(hitTestMarkers([a, b], 52, 110, MARKER_TAP_SLACK)?.title).toBe("a");
    expect(hitTestMarkers([b, a], 52, 110, MARKER_TAP_SLACK)?.title).toBe("a");
    expect(hitTestMarkers([a, b], 67, 110, MARKER_TAP_SLACK)?.title).toBe("b");
    expect(hitTestMarkers([b, a], 67, 110, MARKER_TAP_SLACK)?.title).toBe("b");
  });

  it("is coordinate-space agnostic — negative origins hit normally", () => {
    // ChartPanel measures in viewport coordinates, which go negative when the chart is scrolled
    // above the fold. Nothing in the hit test may assume a positive origin.
    const boxes = [{ x: -40, y: -30, w: 11, h: 19, title: "off", t: "off" }];
    expect(hitTestMarkers(boxes, -35, -20, 0)?.title).toBe("off");
  });
});

describe("placeMarkerTip", () => {
  const tip = { w: 260, h: 60 };
  const wrap = { w: 1000, h: 600 };

  it("offsets below-right of the anchor when there is room", () => {
    expect(placeMarkerTip({ x: 100, y: 100 }, tip, wrap)).toEqual({ left: 112, top: 114 });
  });

  it("flips to the left of the anchor rather than overflowing the right edge", () => {
    const p = placeMarkerTip({ x: 960, y: 100 }, tip, wrap);
    expect(p.left).toBe(960 - tip.w - 12);
    expect(p.left + tip.w).toBeLessThanOrEqual(wrap.w);
  });

  it("flips above the anchor rather than overflowing the bottom edge", () => {
    const p = placeMarkerTip({ x: 100, y: 580 }, tip, wrap);
    expect(p.top).toBeLessThan(580);
    expect(p.top + tip.h).toBeLessThanOrEqual(wrap.h);
  });

  it("keeps the whole tooltip inside the wrapper at every corner", () => {
    // A marker at the very edge of the pane must show its whole tooltip, not a sliver.
    for (const [x, y] of [[0, 0], [1000, 0], [0, 600], [1000, 600], [-20, -20]] as const) {
      const p = placeMarkerTip({ x, y }, tip, wrap);
      expect(p.left).toBeGreaterThanOrEqual(4);
      expect(p.top).toBeGreaterThanOrEqual(4);
      expect(p.left + tip.w).toBeLessThanOrEqual(wrap.w - 4);
      expect(p.top + tip.h).toBeLessThanOrEqual(wrap.h - 4);
    }
  });

  it("degrades to the pad rather than a negative offset when the tooltip exceeds the wrapper", () => {
    // A narrow mobile pane can be smaller than the tooltip's max-width. Clamping must not invert.
    const p = placeMarkerTip({ x: 100, y: 100 }, { w: 400, h: 60 }, { w: 300, h: 200 });
    expect(p.left).toBe(4);
    expect(p.top).toBeGreaterThanOrEqual(4);
  });
});

describe("isTapGesture", () => {
  const down = { x: 100, y: 100, t: 1000 };

  it("accepts a still, short press", () => {
    expect(isTapGesture(down, { x: 103, y: 102, t: 1120 })).toBe(true);
  });

  it("rejects a long press", () => {
    expect(isTapGesture(down, { x: 100, y: 100, t: 1400 })).toBe(false);
  });

  it("rejects a press that travelled — that gesture is a chart pan, not a tap", () => {
    // The load-bearing case: a drag STARTING on a marker belongs to the chart. If this returned
    // true, a pan would end by opening a tooltip over the pane the user just moved.
    expect(isTapGesture(down, { x: 160, y: 100, t: 1120 })).toBe(false);
  });

  it("uses the same thresholds as the chart's own double-tap detector", () => {
    // 300ms / 12px — kept identical so one gesture can never be a tap here and a drag there.
    expect(isTapGesture(down, { x: 100, y: 100, t: 1300 })).toBe(true);
    expect(isTapGesture(down, { x: 100, y: 100, t: 1301 })).toBe(false);
    expect(isTapGesture(down, { x: 112, y: 100, t: 1100 })).toBe(true);
    expect(isTapGesture(down, { x: 113, y: 100, t: 1100 })).toBe(false);
  });
});

describe("gestureStamp", () => {
  it("takes the event's own platform time", () => {
    expect(gestureStamp({ timeStamp: 1234.5 })).toBe(1234.5);
  });

  it("refuses a zero stamp — a pair of them would make every press look instantaneous", () => {
    // Some synthetic events carry no platform time at all. Reading 0 from both ends of a gesture
    // would produce a delta of 0, i.e. a five-second press classified as a tap. Better to fall
    // back to the handler clock, which is at least monotonic.
    expect(gestureStamp({ timeStamp: 0 })).toBeNull();
  });

  it("refuses a missing or non-finite stamp", () => {
    expect(gestureStamp({})).toBeNull();
    expect(gestureStamp({ timeStamp: NaN })).toBeNull();
    expect(gestureStamp({ timeStamp: Infinity })).toBeNull();
    expect(gestureStamp({ timeStamp: "120" })).toBeNull();
  });
});

describe("isTapSample", () => {
  // THE DEFECT THIS EXISTS FOR. A physically instantaneous tap — zero travel, two events stamped
  // 8ms apart — whose pointerup was DISPATCHED 400ms late because the main thread was busy laying
  // out the chart. Timed on the handler clock it is a 400ms long press and the tooltip dead-ends;
  // timed on the events it is what it actually was. Reproduced in the browser on both touch
  // viewports and both overlay layers (e2e marker-tooltip / indicator-prim-tooltip).
  it("classifies on the events, not on when the handlers happened to run", () => {
    const down = { x: 100, y: 100, t: 1000, ts: 5000 };
    const up = { x: 101, y: 100, t: 1400, ts: 5008 };
    expect(isTapSample(down, up)).toBe(true);
    // …and the same gesture is refused by the handler clock, which is the shipped behaviour it
    // replaces. If this ever flips, the fix has been undone.
    expect(isTapGesture({ x: down.x, y: down.y, t: down.t }, { x: up.x, y: up.y, t: up.t })).toBe(false);
  });

  it("still refuses a press that was genuinely long", () => {
    // The threshold is NOT loosened. A finger that really rested for 600ms is still a long press:
    // the events say so, and the events are what is read.
    expect(isTapSample(
      { x: 100, y: 100, t: 1000, ts: 5000 },
      { x: 100, y: 100, t: 1050, ts: 5600 },
    )).toBe(false);
  });

  it("still refuses a press that travelled, whatever the clock says", () => {
    // The load-bearing case: a drag STARTING on a marker belongs to the chart. Distance is not a
    // timing question, so no clock choice can turn a pan into a tap.
    expect(isTapSample(
      { x: 100, y: 100, t: 1000, ts: 5000 },
      { x: 180, y: 100, t: 1010, ts: 5010 },
    )).toBe(false);
  });

  it("falls back to the handler clock when either end cannot date itself", () => {
    expect(isTapSample(
      { x: 100, y: 100, t: 1000, ts: null },
      { x: 100, y: 100, t: 1120, ts: 5008 },
    )).toBe(true);
    expect(isTapSample(
      { x: 100, y: 100, t: 1000, ts: 5000 },
      { x: 100, y: 100, t: 1400, ts: null },
    )).toBe(false);
  });

  it("falls back when the two stamps are out of order — a mismatched pair means nothing", () => {
    expect(isTapSample(
      { x: 100, y: 100, t: 1000, ts: 9000 },
      { x: 100, y: 100, t: 1120, ts: 5000 },
    )).toBe(true);    // handler clock: 120ms → a tap
  });

  it("keeps the one definition of a tap — same thresholds, only the clock is resolved here", () => {
    expect(isTapSample({ x: 0, y: 0, t: 0, ts: 100 }, { x: 0, y: 0, t: 0, ts: 400 })).toBe(true);
    expect(isTapSample({ x: 0, y: 0, t: 0, ts: 100 }, { x: 0, y: 0, t: 0, ts: 401 })).toBe(false);
    expect(isTapSample({ x: 0, y: 0, t: 0, ts: 100 }, { x: 12, y: 0, t: 0, ts: 200 })).toBe(true);
    expect(isTapSample({ x: 0, y: 0, t: 0, ts: 100 }, { x: 13, y: 0, t: 0, ts: 200 })).toBe(false);
  });
});

describe("reanchorMarker — a relayout moves a pinned tooltip, it does not kill it", () => {
  const at = (x: number, y: number, title: string): MarkerHit =>
    ({ x, y, w: 11, h: 19, title, t: title.split(" ·")[0] });

  it("finds the same marker at its NEW box after a relayout", () => {
    const before = at(100, 200, "2026-07-27 · BUY — would have entered");
    const after = [at(60, 240, "2026-07-27 · BUY — would have entered"), at(300, 180, "2026-08-14 · CUT")];
    expect(reanchorMarker(after, before)).toBe(after[0]);
  });

  it("returns null when that marker is no longer painted — then the tooltip really is litter", () => {
    const before = at(100, 200, "2026-07-27 · BUY — would have entered");
    expect(reanchorMarker([at(300, 180, "2026-08-14 · CUT")], before)).toBeNull();
  });

  it("returns null when nothing is pinned, so a hover tooltip still just drops on a resize", () => {
    expect(reanchorMarker([at(60, 240, "2026-07-27 · BUY")], null)).toBeNull();
  });

  it("keys on the full title, so two markers sharing one BAR cannot swap tooltips", () => {
    const before = at(100, 200, "2026-07-27 · BUY — would have entered");
    const after = [at(100, 200, "2026-07-27 · ⊘ not an entry"), at(104, 220, "2026-07-27 · BUY — would have entered")];
    expect(reanchorMarker(after, before)).toBe(after[1]);
  });
});
