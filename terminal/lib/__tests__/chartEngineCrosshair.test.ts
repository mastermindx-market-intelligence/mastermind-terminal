import { describe, expect, it } from "vitest";
import {
  HOVER_TOLERANCE_PX,
  buildMouseParams,
  crosshairInvalidation,
  dataAt,
  resolveCrosshair,
  snapLogicalToBar,
  type CrosshairProjection,
  type CrosshairRow,
  type CrosshairSeries,
  type CrosshairState,
  type HoverableSeries,
} from "@/lib/chart-engine/canvas/crosshair";

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the native renderer's crosshair model
// (lib/chart-engine/canvas/crosshair.ts): bar snapping per mode incl. virtual
// slots, magnet/magnetOHLC target selection, MismatchDirection-style dataAt
// walks over gapped series, EngineMouseEventParams construction (absence vs
// presence, hoveredSeries tolerance, mouse-left shape) and invalidation
// classification. Pure math — no DOM needed, so this file stays on Node.
// ─────────────────────────────────────────────────────────────────────────────

// 12px per bar; bar i is centred at (i + 0.5) * 12.
const BAR_SPACING = 12;
const proj: CrosshairProjection = {
  logicalOfX: (x) => x / BAR_SPACING - 0.5,
  xOfLogical: (i) => (i + 0.5) * BAR_SPACING,
  // Pane 0 (price): p = 200 - y / 2  ⇔  y = (200 - p) * 2.
  // Pane 1 (volume): p = 100 - y * 2 ⇔  y = (100 - p) / 2.
  priceOfY: (paneIndex, y) => (paneIndex === 0 ? 200 - y / 2 : 100 - y * 2),
  yOfPrice: (paneIndex, p) => (paneIndex === 0 ? (200 - p) * 2 : (100 - p) / 2),
};
const yOfPane0 = (p: number) => (200 - p) * 2;

// OHLC primary: bar, bar, whitespace, bar, whitespace, bar.
const priceRows: CrosshairRow[] = [
  { time: 1000, open: 90, high: 110, low: 80, close: 105 },
  { time: 2000, open: 95, high: 115, low: 85, close: 100 },
  { time: 3000 },
  { time: 4000, open: 105, high: 125, low: 95, close: 120 },
  { time: 5000 },
  { time: 6000, open: 120, high: 130, low: 110, close: 125 },
];
const priceSeries: CrosshairSeries = { id: "price", paneIndex: 0, kind: "candles", rows: priceRows };

// Gapped single-value series: value, whitespace, NaN, value, value.
const gapRows: CrosshairRow[] = [
  { time: 1000, value: 10 },
  { time: 2000 },
  { time: 3000, value: Number.NaN },
  { time: 4000, value: 40 },
  { time: 5000, value: 50 },
];
const gapSeries: CrosshairSeries = { id: "gap", paneIndex: 0, kind: "line", rows: gapRows };

function resolve(over: Partial<Parameters<typeof resolveCrosshair>[0]> = {}) {
  return resolveCrosshair({
    x: 6,
    y: 190,
    paneIndex: 0,
    mode: "normal",
    proj,
    series: [priceSeries],
    primaryId: "price",
    ...over,
  });
}

describe("snapLogicalToBar (LWC coordinateToIndex rule)", () => {
  it("snaps to the nearest integer bar", () => {
    expect(snapLogicalToBar(1.2)).toBe(1);
    expect(snapLogicalToBar(1.8)).toBe(2);
    expect(snapLogicalToBar(-2.3)).toBe(-2);
  });

  it("resolves a half-bar boundary to the LOWER-INDEX bar (LWC ceil rule)", () => {
    expect(snapLogicalToBar(2.5)).toBe(2);
    expect(snapLogicalToBar(-2.5)).toBe(-3);
  });

  it("kills sub-1e-6 float noise before rounding", () => {
    expect(snapLogicalToBar(2.5000000001)).toBe(2);
    expect(snapLogicalToBar(2.500001)).toBe(3);
  });
});

describe("resolveCrosshair — snapping and modes", () => {
  it("snaps x to the bar centre and reports the slot's time", () => {
    const st = resolve({ x: 25 }); // float logical 1.5833 → bar 2 (whitespace slot)
    expect(st).not.toBeNull();
    expect(st!.logical).toBe(2);
    expect(st!.x).toBe(30);
    expect(st!.time).toBe(3000); // whitespace slots still carry their time key
    expect(st!.paneIndex).toBe(0);
  });

  it("keeps the exact centre and the boundary-left rule", () => {
    expect(resolve({ x: 30 })!.logical).toBe(2); // exactly on bar 2's centre
    expect(resolve({ x: 36 })!.logical).toBe(2); // boundary → LEFT bar
    expect(resolve({ x: 36.001 })!.logical).toBe(3); // just past the boundary
  });

  it("keeps a virtual slot index beyond the data with a null time", () => {
    const st = resolve({ x: 95 }); // logical 7, past the 6 loaded rows
    expect(st!.logical).toBe(7);
    expect(st!.time).toBeNull();
    expect(st!.x).toBe(90);
    expect(st!.price).toBeCloseTo(200 - 190 / 2, 10);
  });

  it("accepts a slot before the data (negative logical, null time)", () => {
    const st = resolve({ x: -6 });
    expect(st!.logical).toBe(-1);
    expect(st!.time).toBeNull();
  });

  it("hidden mode and non-finite input yield null", () => {
    expect(resolve({ mode: "hidden" })).toBeNull();
    expect(resolve({ x: Number.NaN })).toBeNull();
    expect(resolve({ y: Number.NaN })).toBeNull();
    expect(resolve({ x: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("falls back to the first series holding the slot when the primary lacks it", () => {
    const longRows: CrosshairRow[] = priceRows.concat([
      { time: 7000, open: 125, high: 135, low: 115, close: 130 },
      { time: 8000, open: 130, high: 140, low: 120, close: 135 },
    ]);
    const st = resolve({
      series: [gapSeries, priceSeries, { ...priceSeries, id: "long", rows: longRows }],
      x: 90, // logical 7: primary (6 rows) and gap lack it, "long" has it
    });
    expect(st!.time).toBe(8000);
  });

  it("uses the first series as time base when primaryId is null", () => {
    const st = resolve({ series: [gapSeries, priceSeries], primaryId: null, x: 6 });
    expect(st!.time).toBe(1000);
  });
});

describe("resolveCrosshair — magnet target selection (CROSSHAIR-A01)", () => {
  // Bar 0 in pane 0: O=90→y220, H=110→y180, L=80→y240, C=105→y190.
  it("magnet snaps y/price to the primary's close", () => {
    const st = resolve({ mode: "magnet", x: 6, y: 182 });
    expect(st!.y).toBe(190);
    expect(st!.price).toBe(105);
    expect(st!.magnetTarget).toEqual({ seriesId: "price", value: 105, y: 190 });
  });

  it("magnetOHLC snaps to the nearest of O/H/L/C", () => {
    const st = resolve({ mode: "magnetOHLC", x: 6, y: 181 });
    expect(st!.y).toBe(180);
    expect(st!.price).toBe(110);
    expect(st!.magnetTarget).toEqual({ seriesId: "price", value: 110, y: 180 });
  });

  it("resolves an OHLC tie to the first candidate in O,H,L,C order", () => {
    const st = resolve({ mode: "magnetOHLC", x: 6, y: 185 }); // H(180) and C(190) both 5px away
    expect(st!.magnetTarget!.value).toBe(110);
  });

  it("magnet also snaps a single-value primary to its value", () => {
    const lineSeries: CrosshairSeries = {
      id: "line",
      paneIndex: 0,
      kind: "line",
      rows: [{ time: 1000, value: 150 }, { time: 2000 }, { time: 3000, value: 130 }],
    };
    const st = resolve({ mode: "magnet", series: [lineSeries], primaryId: "line", x: 6, y: 95 });
    expect(st!.y).toBe(100);
    expect(st!.price).toBe(150);
    expect(st!.magnetTarget).toEqual({ seriesId: "line", value: 150, y: 100 });
  });

  it("does not snap on a whitespace primary row or a virtual slot", () => {
    const ws = resolve({ mode: "magnet", x: 30, y: 182 }); // logical 2 is whitespace
    expect(ws!.y).toBe(182);
    expect(ws!.magnetTarget).toBeUndefined();
    const virtual = resolve({ mode: "magnetOHLC", x: 90, y: 181 }); // logical 7 has no row
    expect(virtual!.y).toBe(181);
    expect(virtual!.magnetTarget).toBeUndefined();
  });

  it("does not snap without a primary, or across panes", () => {
    const noPrimary = resolve({ mode: "magnet", primaryId: null, x: 6, y: 182 });
    expect(noPrimary!.y).toBe(182);
    const otherPane = resolve({ mode: "magnet", paneIndex: 1, x: 6, y: 3 });
    expect(otherPane!.magnetTarget).toBeUndefined();
    expect(otherPane!.y).toBe(3);
    expect(otherPane!.price).toBe(100 - 3 * 2); // volume-pane scale
  });

  it("normal mode never snaps", () => {
    const st = resolve({ mode: "normal", x: 6, y: 182 });
    expect(st!.y).toBe(182);
    expect(st!.magnetTarget).toBeUndefined();
    expect(st!.price).toBeCloseTo(109, 10);
  });
});

describe("dataAt (CROSSHAIR-A02 — MismatchDirection semantics)", () => {
  it('"none" matches only an exact, finite row', () => {
    expect(dataAt(gapSeries, 0, "none")).toEqual({ time: 1000, value: 10 });
    expect(dataAt(gapSeries, 1, "none")).toBeNull(); // whitespace
    expect(dataAt(gapSeries, 2, "none")).toBeNull(); // NaN value
    expect(dataAt(gapSeries, 99, "none")).toBeNull();
    expect(dataAt(gapSeries, -1, "none")).toBeNull();
    expect(dataAt(gapSeries, 0.5, "none")).toBeNull(); // fractional never matches
  });

  it('"none" requires all OHLC finite for bar kinds', () => {
    const broken: CrosshairSeries = {
      id: "broken",
      paneIndex: 0,
      kind: "candles",
      rows: [{ time: 1000, open: 1, high: 2, low: 0.5, close: Number.NaN }, { time: 2000, open: 1, high: 2, low: 0.5, close: 1.5 }],
    };
    expect(dataAt(broken, 0, "none")).toBeNull();
    expect(dataAt(broken, 1, "none")).toEqual({ time: 2000, open: 1, high: 2, low: 0.5, close: 1.5 });
  });

  it("walks to the nearest finite row in the requested direction", () => {
    expect(dataAt(gapSeries, 1, "nearest-left")).toEqual({ time: 1000, value: 10 });
    expect(dataAt(gapSeries, 1, "nearest-right")).toEqual({ time: 4000, value: 40 }); // skips ws + NaN
    expect(dataAt(gapSeries, 4, "nearest-left")).toEqual({ time: 4000, value: 40 });
    expect(dataAt(gapSeries, 4, "nearest-right")).toBeNull();
    expect(dataAt(gapSeries, 0, "nearest-left")).toBeNull();
  });

  it("honors LWC's exclusive bounds for fractional logicals", () => {
    expect(dataAt(gapSeries, 0.5, "nearest-left")).toEqual({ time: 1000, value: 10 });
    expect(dataAt(gapSeries, 0.5, "nearest-right")).toEqual({ time: 4000, value: 40 });
    expect(dataAt(gapSeries, -2.5, "nearest-right")).toEqual({ time: 1000, value: 10 });
  });
});

describe("buildMouseParams (CROSSHAIR-A03)", () => {
  const spread: HoverableSeries = {
    id: "spread",
    paneIndex: 0,
    kind: "line",
    rows: [{ time: 1000, value: 150 }, { time: 2000, value: 140 }, { time: 3000, value: 130 }],
  };
  const volume: HoverableSeries = {
    id: "volume",
    paneIndex: 1,
    kind: "histogram",
    rows: [{ time: 1000 }, { time: 2000, value: 1000 }, { time: 3000, value: 800 }],
  };
  const allSeries: HoverableSeries[] = [{ ...priceSeries }, spread, volume];

  it("maps each series' valued row at the bar, ABSENT otherwise (all panes)", () => {
    const st = resolve({ series: allSeries });
    const p = buildMouseParams(st, allSeries);
    const data = p.seriesData as Map<string, CrosshairRow>;
    expect(data.size).toBe(2);
    expect(data.get("price")).toEqual({ time: 1000, open: 90, high: 110, low: 80, close: 105 });
    expect(data.get("spread")).toEqual({ time: 1000, value: 150 });
    expect(data.has("volume")).toBe(false); // whitespace at logical 0 → ABSENT
    expect(data.get("volume")).toBeUndefined();
  });

  it("includes series from other panes and drops a whitespace primary", () => {
    const st = resolve({ series: allSeries, x: 30 }); // logical 2: price ws, spread+volume valued
    const data = buildMouseParams(st, allSeries).seriesData as Map<string, CrosshairRow>;
    expect(data.has("price")).toBe(false);
    expect(data.get("spread")).toEqual({ time: 3000, value: 130 });
    expect(data.get("volume")).toEqual({ time: 3000, value: 800 });
  });

  it("carries time/logical/point/paneIndex and the sourceEvent verbatim", () => {
    const st = resolve({ series: allSeries });
    const src = { type: "mousemove", clientX: 10 } as const;
    const p = buildMouseParams(st, allSeries, src);
    expect(p.time).toBe(1000);
    expect(p.logical).toBe(0);
    expect(p.point).toEqual({ x: 6, y: 190 });
    expect(p.paneIndex).toBe(0);
    expect(p.sourceEvent).toBe(src);
  });

  it("produces the LWC mouse-left shape for a null state", () => {
    const p = buildMouseParams(null, allSeries);
    expect(p.time).toBeUndefined();
    expect(p.logical).toBeUndefined();
    expect(p.point).toBeUndefined();
    expect(p.paneIndex).toBeUndefined();
    expect((p.seriesData as Map<string, CrosshairRow>).size).toBe(0);
    expect(p.hoveredSeries).toBeNull();
  });

  it("keeps a provided sourceEvent on the mouse-left shape too", () => {
    const src = { type: "mouseleave" } as const;
    expect(buildMouseParams(null, allSeries, src).sourceEvent).toBe(src);
    expect(buildMouseParams(null, allSeries).sourceEvent).toBeUndefined();
  });
});

describe("buildMouseParams — hoveredSeries tolerance", () => {
  const state = (y: number, paneIndex = 0): CrosshairState => ({
    logical: 0,
    time: 1000,
    x: 6,
    y,
    paneIndex,
    price: 200 - y / 2,
  });
  const series = (id: string, value: number, paneIndex = 0, withY = true): HoverableSeries => ({
    id,
    paneIndex,
    kind: "line",
    rows: [{ time: 1000, value }],
    ...(withY ? { yOfValue: (v: number) => (paneIndex === 0 ? yOfPane0(v) : (100 - v) / 2) } : {}),
  });

  it("hovers the nearest value within the tolerance", () => {
    const list = [series("a", 104), series("b", 106)]; // y 192 / 188
    expect(buildMouseParams(state(193), list).hoveredSeries).toBe("a"); // 1px vs 5px
    expect(buildMouseParams(state(189), list).hoveredSeries).toBe("b"); // 3px vs 1px
  });

  it("breaks an exact distance tie by input order", () => {
    const list = [series("a", 104), series("b", 106)]; // equidistant from y 190
    expect(buildMouseParams(state(190), list).hoveredSeries).toBe("a");
  });

  it(`includes a value exactly ${HOVER_TOLERANCE_PX}px away and excludes one further`, () => {
    expect(buildMouseParams(state(200), [series("edge", 104)]).hoveredSeries).toBe("edge"); // |192-200| = 8
    expect(buildMouseParams(state(200.5), [series("far", 104)]).hoveredSeries).toBeNull(); // 8.5px
    expect(buildMouseParams(state(250), [series("way-off", 104)])).toMatchObject({ hoveredSeries: null });
  });

  it("ignores other panes, missing projections, gap rows and non-finite y", () => {
    expect(buildMouseParams(state(50), [series("vol", 95, 1)]).hoveredSeries).toBeNull(); // other pane
    expect(buildMouseParams(state(yOfPane0(105)), [series("no-y", 105, 0, false)]).hoveredSeries).toBeNull();
    const gapped: HoverableSeries = { ...series("g", 105), rows: [{ time: 1000 }] };
    expect(buildMouseParams(state(yOfPane0(105)), [gapped]).hoveredSeries).toBeNull();
    const brokenY: HoverableSeries = { ...series("by", 105), yOfValue: () => Number.NaN };
    expect(buildMouseParams(state(yOfPane0(105)), [brokenY]).hoveredSeries).toBeNull();
  });

  it("hovers a candles series by its close", () => {
    const candles: HoverableSeries = { ...priceSeries, yOfValue: yOfPane0 };
    expect(buildMouseParams(state(190), [candles]).hoveredSeries).toBe("price"); // close 105 → y 190
    expect(buildMouseParams(state(199), [candles]).hoveredSeries).toBeNull();
  });
});

describe("crosshairInvalidation", () => {
  const st = (over: Partial<CrosshairState> = {}): CrosshairState => ({
    logical: 2,
    time: 3000,
    x: 30,
    y: 190,
    paneIndex: 0,
    price: 105,
    ...over,
  });

  it("treats null↔null as nothing and any show/hide as light", () => {
    expect(crosshairInvalidation(null, null)).toBe("none");
    expect(crosshairInvalidation(null, st())).toBe("light");
    expect(crosshairInvalidation(st(), null)).toBe("light");
  });

  it("classifies a bar, pane or time-key change as light", () => {
    expect(crosshairInvalidation(st(), st({ logical: 3 }))).toBe("light");
    expect(crosshairInvalidation(st(), st({ paneIndex: 1 }))).toBe("light");
    expect(crosshairInvalidation(st(), st({ time: 3100 }))).toBe("light");
  });

  it("classifies a same-bar pointer move as cursor", () => {
    expect(crosshairInvalidation(st(), st({ y: 191, price: 104.5 }))).toBe("cursor");
    expect(crosshairInvalidation(st(), st({ x: 30.5 }))).toBe("cursor");
    expect(crosshairInvalidation(st(), st({ magnetTarget: { seriesId: "price", value: 105, y: 190 } }))).toBe("cursor");
  });

  it("reports none when nothing observable changed (value-equal times)", () => {
    expect(crosshairInvalidation(st(), st())).toBe("none");
    // A fresh-but-equal BusinessDay object must not read as a change.
    expect(crosshairInvalidation(st({ time: { year: 2026, month: 8, day: 17 } }), st({ time: { year: 2026, month: 8, day: 17 } }))).toBe("none");
    expect(crosshairInvalidation(st({ time: { year: 2026, month: 8, day: 17 } }), st({ time: { year: 2026, month: 8, day: 18 } }))).toBe("light");
  });
});
