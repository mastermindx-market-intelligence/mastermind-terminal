// Tests for lib/crosshairMagnet.ts — the magnet hover-tag scan helper ChartPanel
// uses inside `onTagCrosshair` (see components/ChartPanel.tsx). The helper has to
// handle the shipping lwc adapter (wrapMouse is a pass-through, so the keys in
// `p.seriesData` are raw ISeriesApi objects with no `paneIndex()` — their pane
// lives on `getPane().paneIndex()`) AND the future owned-SeriesHandle map the
// adapter will produce. All candidates are plain-object fakes — no DOM, no
// lightweight-charts import, Node test environment.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { candidatePaneIndex, nearestMagnetY } from "@/lib/crosshairMagnet";

type LwcLike = {
  options: () => Record<string, unknown> | unknown;
  priceToCoordinate: (v: number) => unknown;
  // NOTE: deliberately no paneIndex() — the raw lwc series shape.
  getPane?: () => { paneIndex?: () => number | null | undefined } | null | undefined;
};

type HandleLike = {
  options: () => Record<string, unknown> | unknown;
  priceToCoordinate: (v: number) => unknown;
  paneIndex: () => number | null | undefined;
  getPane?: () => never;
};

function lwcCandidate(opts: Record<string, unknown>, yMap: Record<number, number>): LwcLike {
  return {
    options: () => opts,
    priceToCoordinate: (v: number) =>
      Object.prototype.hasOwnProperty.call(yMap, v) ? yMap[v] : null,
    // Raw lwc: getPane().paneIndex() is how the pane resolves.
    getPane: () => ({ paneIndex: () => 0 }),
  };
}

function handleCandidate(
  paneIdx: number,
  opts: Record<string, unknown>,
  yMap: Record<number, number>,
): HandleLike {
  return {
    options: () => opts,
    priceToCoordinate: (v: number) =>
      Object.prototype.hasOwnProperty.call(yMap, v) ? yMap[v] : null,
    paneIndex: () => paneIdx,
  };
}

// One global pointerY these magnet tests snap to. Magnet scan minimises
// Math.abs(y - pointerY); chosen so distinct candidate rows land on distinct
// y values for unambiguous assertions.
const POINTER_Y = 240;

describe("candidatePaneIndex", () => {
  it("(ii) owned-handle-shaped candidate → calls paneIndex() and returns the value", () => {
    const h: HandleLike = handleCandidate(2, {}, {});
    expect(candidatePaneIndex(h)).toBe(2);
  });

  it("(i) raw-lwc-shaped candidate → falls through to getPane().paneIndex()", () => {
    const raw = { options: () => ({}), priceToCoordinate: () => null, getPane: () => ({ paneIndex: () => 1 }) };
    expect(candidatePaneIndex(raw)).toBe(1);
  });

  it("returns null when paneIndex() throws (lwc adapter tearing down mid-event)", () => {
    const h: HandleLike = {
      options: () => ({}),
      priceToCoordinate: () => null,
      paneIndex: () => { throw new Error("disposed"); },
    };
    expect(candidatePaneIndex(h)).toBe(null);
  });

  it("returns null when candidate has neither paneIndex() nor getPane()", () => {
    expect(candidatePaneIndex({ options: () => ({}), priceToCoordinate: () => null })).toBe(null);
  });

  it("returns null on a finite integer from getPane() === undefined", () => {
    const raw = {
      options: () => ({}),
      priceToCoordinate: () => null,
      getPane: () => ({ paneIndex: () => undefined }),
    };
    expect(candidatePaneIndex(raw)).toBe(null);
  });
});

describe("nearestMagnetY", () => {
  it("(iv) seriesData not a Map → null", () => {
    expect(nearestMagnetY({ a: 1 }, POINTER_Y, 0)).toBe(null);
    expect(nearestMagnetY(undefined, POINTER_Y, 0)).toBe(null);
    expect(nearestMagnetY(null, POINTER_Y, 0)).toBe(null);
    expect(nearestMagnetY([1, 2, 3], POINTER_Y, 0)).toBe(null);
  });

  it("(i) raw-lwc-shaped candidates in pane 0 snap to the nearest y", () => {
    // Two raw-lwc candidates in pane 0; one resolves close=200 to y=200,
    // the other resolves value=350 to y=350; both are within the scan window.
    const c1 = lwcCandidate({ visible: true, priceScaleId: "right" }, { 200: 200 });
    const c2 = lwcCandidate({ visible: true, priceScaleId: "right" }, { 350: 350 });
    const data = new Map<unknown, unknown>([
      [c1, { close: 200 }],
      [c2, { value: 350 }],
    ]);
    // POINTER_Y=240 → distance to y=200 is 40, to y=350 is 110 → 200 wins.
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(200);
  });

  it("(ii) owned-handle-shaped candidates snap the same way", () => {
    const c1 = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 42: 250 });
    const data = new Map<unknown, unknown>([[c1, { close: 42 }]]);
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(250);
  });

  it("(iii) skip-and-continue: invisible:false is filtered out", () => {
    const visible = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 230 });
    const hidden = handleCandidate(0, { visible: false, priceScaleId: "right" }, { 100: 0 });
    const data = new Map<unknown, unknown>([
      [visible, { close: 100 }],
      [hidden, { close: 100 }],
    ]);
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(230);
  });

  it("(iii) skip-and-continue: a candidate in a different pane is skipped", () => {
    const same = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 230 });
    const other = handleCandidate(1, { visible: true, priceScaleId: "right" }, { 100: 0 });
    const data = new Map<unknown, unknown>([
      [same, { close: 100 }],
      [other, { close: 100 }],
    ]);
    // Asked for pane 0 → other is skipped; same wins.
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(230);
    // Asked for pane 1 → same is skipped; other wins.
    expect(nearestMagnetY(data, POINTER_Y, 1)).toBe(0);
  });

  it("(iii) skip-and-continue: overlay priceScaleId (e.g. 'vol') is filtered out", () => {
    const primary = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 230 });
    const overlay = handleCandidate(0, { visible: true, priceScaleId: "vol" }, { 100: 0 });
    const data = new Map<unknown, unknown>([
      [primary, { close: 100 }],
      [overlay, { close: 100 }],
    ]);
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(230);
  });

  it("(iii) skip-and-continue: non-finite close/value is skipped (NaN, Infinity, undefined)", () => {
    const good = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 230 });
    const nanClose = handleCandidate(0, { visible: true, priceScaleId: "right" }, {});
    const data = new Map<unknown, unknown>([
      [good, { close: 100 }],
      [nanClose, { close: Number.NaN }],
    ]);
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(230);

    const onlyNan = new Map<unknown, unknown>([
      [nanClose, { close: Number.NaN, value: Number.POSITIVE_INFINITY }],
    ]);
    expect(nearestMagnetY(onlyNan, POINTER_Y, 0)).toBe(null);

    const onlyMissing = new Map<unknown, unknown>([[nanClose, {}]]);
    expect(nearestMagnetY(onlyMissing, POINTER_Y, 0)).toBe(null);
  });

  it("(iii) skip-and-continue: priceToCoordinate returning null / non-finite is skipped", () => {
    const yable = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 230 });
    const nully: HandleLike = {
      options: () => ({ visible: true, priceScaleId: "right" }),
      priceToCoordinate: () => null,
      paneIndex: () => 0,
    };
    const inf: HandleLike = {
      options: () => ({ visible: true, priceScaleId: "right" }),
      priceToCoordinate: () => Number.POSITIVE_INFINITY,
      paneIndex: () => 0,
    };
    const data = new Map<unknown, unknown>([
      [yable, { close: 100 }],
      [nully, { close: 100 }],
      [inf, { close: 100 }],
    ]);
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(230);
  });

  it("(iii) skip-and-continue: a candidate whose options() throws does NOT blank the scan", () => {
    const good = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 230 });
    const boom: HandleLike = {
      options: () => { throw new Error("renderer dead"); },
      priceToCoordinate: () => 0,
      paneIndex: () => 0,
    };
    const data = new Map<unknown, unknown>([
      [boom, { close: 100 }],
      [good, { close: 100 }],
    ]);
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(230);
  });

  it("(v) tie on distance → FIRST of equal distances wins", () => {
    // Symmetric pair around POINTER_Y=240: y=200 and y=280 both 40 away.
    const first = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 200 });
    const second = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 280 });
    const data = new Map<unknown, unknown>([
      [first, { close: 100 }],
      [second, { close: 100 }],
    ]);
    // Strict `<` rule: first remains best (second does not displace).
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(200);
  });

  it("(vi) close is preferred over value when both are finite on the same row", () => {
    // Series row that has BOTH close and value; only the y for close wins.
    const c = handleCandidate(0, { visible: true, priceScaleId: "right" }, {
      // The distinct values are {value-wins-if-preferred} vs {close}.
      // If `close` wins, the answer is the y for close=200 → 200.
      // If `value` wins, the answer is the y for value=600 → 600.
      200: 200,
      600: 600,
    });
    const data = new Map<unknown, unknown>([
      [c, { close: 200, value: 600 }],
    ]);
    // POINTER_Y=240 → 200 is 40 away, 600 is 360 away → 200 wins on distance anyway.
    // The contract here is the SELECTION: distance to the y for close wins because we used
    // close in priceToCoordinate even though value was also finite. We prove the contract by
    // pointing pointerY at 600 (between the two): 200 is now 400 away, 600 is 0 away, but if
    // value were chosen the answer would still be 600, so a closer test is to make both
    // equidistant from the pointer and see which one closed over prefers.
    expect(nearestMagnetY(data, 200, 0)).toBe(200); // exactly under close-y
  });

  it("(vi) close-preferred: when close is non-finite, falls back to value", () => {
    // Row with no close, finite value → value wins.
    const c = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 350: 250 });
    const data = new Map<unknown, unknown>([[c, { value: 350 }]]);
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(250);
  });

  it("returns null when every candidate is filtered out", () => {
    const hidden = handleCandidate(0, { visible: false, priceScaleId: "right" }, { 100: 230 });
    const data = new Map<unknown, unknown>([[hidden, { close: 100 }]]);
    expect(nearestMagnetY(data, POINTER_Y, 0)).toBe(null);
  });

  it("non-finite pointerY → null (no candidates examined)", () => {
    const c = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 230 });
    const data = new Map<unknown, unknown>([[c, { close: 100 }]]);
    expect(nearestMagnetY(data, Number.NaN, 0)).toBe(null);
    expect(nearestMagnetY(data, Number.POSITIVE_INFINITY, 0)).toBe(null);
  });

  it("non-finite paneIndex → null (defensive)", () => {
    const c = handleCandidate(0, { visible: true, priceScaleId: "right" }, { 100: 230 });
    const data = new Map<unknown, unknown>([[c, { close: 100 }]]);
    expect(nearestMagnetY(data, POINTER_Y, Number.NaN)).toBe(null);
  });
});

describe("ChartPanel source contract", () => {
  // Source-contract anchor: the call site must use nearestMagnetY, and the old
  // `candidate.paneIndex()` form (which fails on raw-lwc keys) is gone.
  it("(vi) ChartPanel.tsx calls nearestMagnetY and no longer contains candidate.paneIndex()", () => {
    const chartPanel = readFileSync(
      path.resolve(__dirname, "../../components/ChartPanel.tsx"),
      "utf8",
    );
    expect(chartPanel).toMatch(/nearestMagnetY\(/);
    // The old per-candidate call shape inside the loop must be gone; the
    // helper now owns it.
    expect(chartPanel).not.toMatch(/candidate\.paneIndex\(\)/);
  });
});
