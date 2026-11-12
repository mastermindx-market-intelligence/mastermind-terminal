import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the chart engine's level-of-detail module
// (lib/chart-engine/canvas/lod.ts — P3 canvas renderer support).
//
// The module is pure (no DOM, no LWC), so this suite runs in the plain Node
// environment. What is being pinned, per the acceptance tags:
//   LOD-A01  exact lookups are exact — every row's own time resolves to its
//            own index, absent keys answer null, and an unsorted (or
//            duplicate-time) row set throws a typed error instead of building
//            a silently mis-sorted index.
//   LOD-A02  extrema are never lost — columnAggregate's high/low are the TRUE
//            max/min over each column's rows, checked against an independent
//            brute-force pass over seeded random data (the falsifier mutant
//            "high = last finite value instead of max" turns this red).
//   LOD-A03  decimation keeps peaks — lineDecimate emits first/min/max/last
//            per pixel bucket, so a one-sample spike survives.
// The VisualColumn brand is compile-time evidence: an @ts-expect-error proves
// a VisualColumn[] cannot be passed where EngineSeriesRow[] is expected
// (verified by `npx tsc --noEmit`, which type-checks this file).
// ─────────────────────────────────────────────────────────────────────────────

import {
  LodIndexError,
  columnAggregate,
  createBarIndex,
  lineDecimate,
  LineDecimator,
  timeToKey,
  type ColumnAccessor,
  type LookupMode,
  type VisualColumn,
} from "../chart-engine/canvas/lod";
import type { EngineSeriesRow } from "../chart-engine/api";

// Test row: every field nullable so one shape plays both valued bars and
// whitespace slots (all-null = whitespace, mirroring api.ts's EngineWhitespace).
type MaybeBar = {
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

const ACC: ColumnAccessor<MaybeBar> = {
  open: (r) => r.open,
  high: (r) => r.high,
  low: (r) => r.low,
  close: (r) => r.close,
  volume: (r) => r.volume,
};

/** Deterministic PRNG (mulberry32) so the brute-force comparison is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A price walk of `count` 60-second bars starting at a fixed epoch. */
function makeRows(count: number, seed = 0xce10d): MaybeBar[] {
  const rand = mulberry32(seed);
  const rows: MaybeBar[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price += (rand() - 0.5) * 4;
    rows.push({
      time: 1_700_000_000 + i * 60,
      open: price,
      high: price + rand() * 3,
      low: price - rand() * 3,
      close: price + (rand() - 0.5) * 2,
      volume: Math.floor(rand() * 1000),
    });
  }
  return rows;
}

const MODES: readonly LookupMode[] = ["exact", "nearest-left", "nearest-right", "nearest"];

// ── createBarIndex — LOD-A01 ───────────────────────────────────────────────────

describe("lod — createBarIndex", () => {
  it("resolves every row's own time to its own index, exactly (LOD-A01)", () => {
    const rows = makeRows(500);
    const idx = createBarIndex(rows);
    expect(idx.size).toBe(500);
    for (let i = 0; i < rows.length; i += 7) {
      expect(idx.indexOfTime(rows[i].time, "exact")).toBe(i);
      expect(idx.keyAt(i)).toBe(rows[i].time);
      expect(idx.rowAt(i)).toBe(rows[i]);
    }
  });

  it("exact lookup answers null for absent keys — before, between, and after", () => {
    const idx = createBarIndex([{ time: 100 }, { time: 200 }, { time: 300 }]);
    expect(idx.indexOfTime(99, "exact")).toBeNull();
    expect(idx.indexOfTime(150, "exact")).toBeNull();
    expect(idx.indexOfTime(301, "exact")).toBeNull();
    expect(idx.indexOfTime(100, "exact")).toBe(0);
    expect(idx.indexOfTime(200, "exact")).toBe(1);
    expect(idx.indexOfTime(300, "exact")).toBe(2);
  });

  it("nearest-left / nearest-right / nearest resolve to the bracketing bars", () => {
    const idx = createBarIndex([{ time: 10 }, { time: 20 }, { time: 30 }]);
    expect(idx.indexOfTime(15, "nearest-left")).toBe(0);
    expect(idx.indexOfTime(15, "nearest-right")).toBe(1);
    expect(idx.indexOfTime(15, "nearest")).toBe(0); // equidistant → earlier bar
    expect(idx.indexOfTime(24, "nearest-left")).toBe(1);
    expect(idx.indexOfTime(24, "nearest-right")).toBe(2);
    expect(idx.indexOfTime(24, "nearest")).toBe(1); // 4 away from 20, 6 from 30
    // An exact hit agrees across all four modes.
    for (const mode of MODES) expect(idx.indexOfTime(20, mode)).toBe(1);
  });

  it("nearest mode clamps at the ends and resolves ties to the earlier bar", () => {
    const idx = createBarIndex([{ time: 10 }, { time: 20 }]);
    expect(idx.indexOfTime(5, "nearest-left")).toBeNull();
    expect(idx.indexOfTime(5, "nearest-right")).toBe(0);
    expect(idx.indexOfTime(5, "nearest")).toBe(0);
    expect(idx.indexOfTime(25, "nearest-left")).toBe(1);
    expect(idx.indexOfTime(25, "nearest-right")).toBeNull();
    expect(idx.indexOfTime(25, "nearest")).toBe(1);
    expect(idx.indexOfTime(15, "nearest")).toBe(0); // equidistant → earlier bar
  });

  it("range returns the inclusive index window for a key span", () => {
    const rows = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((t) => ({ time: t }));
    const idx = createBarIndex(rows);
    expect(idx.range(25, 75)).toEqual([2, 6]);
    expect(idx.range(30, 70)).toEqual([2, 6]); // inclusive on both ends
    expect(idx.range(0, 1000)).toEqual([0, 9]);
    expect(idx.range(90, 100)).toEqual([8, 9]);
  });

  it("range answers an empty window (i1 < i0) when no key falls inside", () => {
    const idx = createBarIndex([{ time: 10 }, { time: 20 }, { time: 30 }]);
    const [i0, i1] = idx.range(35, 36); // gap between keys
    expect(i1).toBeLessThan(i0);
    const [j0, j1] = idx.range(100, 50); // inverted span is empty by construction
    expect(j1).toBeLessThan(j0);
  });

  it("an empty index answers null lookups and empty ranges", () => {
    const idx = createBarIndex([]);
    expect(idx.size).toBe(0);
    for (const mode of MODES) expect(idx.indexOfTime(42, mode)).toBeNull();
    const [i0, i1] = idx.range(0, 100);
    expect(i0).toBe(0);
    expect(i1).toBe(-1);
  });

  it("a decreasing pair throws the typed disorder error", () => {
    let err: unknown;
    try {
      createBarIndex([{ time: 100 }, { time: 90 }]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LodIndexError);
    expect(err).toBeInstanceOf(Error);
    const lodErr = err as LodIndexError;
    expect(lodErr.code).toBe("lod/disorder");
    expect(lodErr.at).toBe(1);
    expect(lodErr.message).toContain("index 1");
  });

  it("a duplicate time is disorder too (strict ascending, LWC setData semantics)", () => {
    expect(() => createBarIndex([{ time: 5 }, { time: 5 }, { time: 6 }])).toThrow(LodIndexError);
    try {
      createBarIndex([{ time: 5 }, { time: 5 }]);
    } catch (e) {
      expect((e as LodIndexError).code).toBe("lod/disorder");
    }
  });

  it("malformed and non-finite times throw the typed bad-time error", () => {
    for (const bad of [
      { time: "2024-1-5" },            // not zero-padded ISO
      { time: "not-a-date" },
      { time: "2024-02-30" },          // Feb 30 would silently roll into March
      { time: Number.NaN },
    ]) {
      let err: unknown;
      try {
        createBarIndex([bad]);
      } catch (e) {
        err = e;
      }
      expect(err, `expected ${JSON.stringify(bad)} to be rejected`).toBeInstanceOf(LodIndexError);
      expect((err as LodIndexError).code).toBe("lod/bad-time");
    }
    expect(() => timeToKey({ year: 2024, month: 13, day: 1 })).toThrow(LodIndexError);
    expect(() => timeToKey({ year: 2023, month: 2, day: 29 })).toThrow(LodIndexError); // non-leap
    expect(() => timeToKey({ year: 2024, month: 2, day: 29 })).not.toThrow();          // leap
  });

  // ── business-day ordinals ─────────────────────────────────────────────────

  it("maps \"YYYY-MM-DD\" to days since 1970-01-01 UTC (the documented ordinal rule)", () => {
    expect(timeToKey("1970-01-01")).toBe(0);
    expect(timeToKey("1970-01-02")).toBe(1);
    expect(timeToKey("1969-12-31")).toBe(-1);
    expect(timeToKey("2024-01-02")).toBe(Date.UTC(2024, 0, 2) / 86_400_000);
    const idx = createBarIndex([{ time: "2024-01-02" }, { time: "2024-01-03" }]);
    expect(idx.keyAt(0)).toBe(19_724);
    expect(idx.indexOfTime("2024-01-03", "exact")).toBe(1);
    expect(idx.indexOfTime("2024-01-05", "nearest-left")).toBe(1);
    expect(idx.indexOfTime("2024-01-01", "nearest-right")).toBe(0);
  });

  it("business-day ordinals are monotone across calendars, leap days included", () => {
    const days: string[] = [];
    const cursor = new Date(Date.UTC(2023, 0, 1));
    for (let i = 0; i < 365 * 3 + 1; i++) { // 2023-01-01 .. 2025-12-31 (2024 is leap)
      days.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const rows = days.map((time) => ({ time }));
    const idx = createBarIndex(rows); // throws here if any day were out of order
    expect(idx.size).toBe(days.length);
    for (let i = 1; i < idx.size; i++) {
      expect(idx.keyAt(i) - idx.keyAt(i - 1)).toBe(1); // one ordinal per calendar day
    }
    expect(idx.indexOfTime("2024-02-29", "exact")).not.toBeNull();
  });

  it("{year,month,day} rows and \"YYYY-MM-DD\" rows share one ordinal space", () => {
    const idx = createBarIndex([
      { time: { year: 1970, month: 1, day: 2 } },
      { time: "1970-01-03" },
      { time: { year: 1970, month: 1, day: 4 } },
    ]);
    expect(idx.size).toBe(3);
    expect(idx.indexOfTime("1970-01-03", "exact")).toBe(1);
    expect(idx.indexOfTime({ year: 1970, month: 1, day: 4 }, "exact")).toBe(2);
    expect(idx.indexOfTime("1970-01-02", "exact")).toBe(0);
  });

  it("digit-only strings are epoch seconds (futureTime.ts idiom)", () => {
    const idx = createBarIndex([{ time: "1700000000" }, { time: "1700000120" }]);
    expect(idx.keyAt(0)).toBe(1_700_000_000);
    expect(idx.indexOfTime(1_700_000_060, "nearest-left")).toBe(0);
    expect(idx.indexOfTime("1700000120", "exact")).toBe(1);
  });
});

// ── columnAggregate — LOD-A02 ──────────────────────────────────────────────────

describe("lod — columnAggregate", () => {
  it("matches a brute-force pass on seeded random data with gaps and NaN (LOD-A02)", () => {
    const rand = mulberry32(0x10d);
    const rows: MaybeBar[] = [];
    let price = 100;
    for (let i = 0; i < 5000; i++) {
      const gap = rand() < 0.1; // ~10% whitespace slots
      price += (rand() - 0.5) * 4;
      rows.push({
        time: 1_700_000_000 + i * 60,
        open: gap ? null : price,
        high: gap ? null : (rand() < 0.05 ? Number.NaN : price + rand() * 3),
        low: gap ? null : price - rand() * 3,
        close: gap ? null : price + (rand() - 0.5) * 2,
        volume: rand() < 0.05 ? Number.NaN : Math.floor(rand() * 1000),
      });
    }
    const cols = columnAggregate(rows, 0, rows.length - 1, 37, ACC);
    expect(cols).toHaveLength(37);
    const n = rows.length;
    const fin = (x: number | null) => (x !== null && Number.isFinite(x) ? x : null);
    for (let k = 0; k < cols.length; k++) {
      const col = cols[k];
      // Independent recomputation of the same window split.
      const i0 = Math.floor((k * n) / 37);
      const i1 = Math.floor(((k + 1) * n) / 37) - 1;
      expect(col.i0).toBe(i0);
      expect(col.i1).toBe(i1);
      let hi: number | null = null;
      let lo: number | null = null;
      let op: number | null = null;
      let cl: number | null = null;
      let vol = 0;
      let hasGap = false;
      for (let i = i0; i <= i1; i++) {
        const r = rows[i];
        const v = fin(r.volume);
        if (v !== null) vol += v;
        const o = fin(r.open);
        const h = fin(r.high);
        const l = fin(r.low);
        const c = fin(r.close);
        if (o === null && h === null && l === null && c === null) {
          hasGap = true;
          continue;
        }
        if (o !== null && op === null) op = o;
        if (c !== null) cl = c;
        if (h !== null && (hi === null || h > hi)) hi = h;
        if (l !== null && (lo === null || l < lo)) lo = l;
      }
      expect(col.high, `column ${k} high`).toBe(hi);
      expect(col.low, `column ${k} low`).toBe(lo);
      expect(col.open, `column ${k} open`).toBe(op);
      expect(col.close, `column ${k} close`).toBe(cl);
      expect(col.volume, `column ${k} volume`).toBe(vol);
      expect(col.hasGap, `column ${k} hasGap`).toBe(hasGap);
    }
  });

  it("keeps a spike that occupies a single row of a many-row column", () => {
    const rows = makeRows(200);
    rows[100] = { ...rows[100], high: 999, low: -999 }; // one extreme bar mid-window
    const [col] = columnAggregate(rows, 0, 199, 1, ACC);
    expect(col.high).toBe(999);
    expect(col.low).toBe(-999);
  });

  it("whitespace rows set hasGap and are excluded from extrema, open, and close", () => {
    const rows: MaybeBar[] = [
      { time: 1, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { time: 2, open: null, high: null, low: null, close: null, volume: null },
      { time: 3, open: null, high: 999, low: 999, close: null, volume: null }, // partial-null but VALUED
      { time: 4, open: null, high: null, low: null, close: null, volume: null },
      { time: 5, open: 20, high: 21, low: 19, close: 20.5, volume: 50 },
    ];
    const [col] = columnAggregate(rows, 0, 4, 1, ACC);
    expect(col.hasGap).toBe(true);
    expect(col.high).toBe(999);
    expect(col.low).toBe(9);
    expect(col.open).toBe(10);   // first finite open skips the leading gaps
    expect(col.close).toBe(20.5); // last finite close
    expect(col.volume).toBe(150);
  });

  it("a column of only whitespace yields null fields and hasGap", () => {
    const rows: MaybeBar[] = [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 2, open: null, high: null, low: null, close: null, volume: null },
      { time: 3, open: null, high: null, low: null, close: null, volume: null },
    ];
    const cols = columnAggregate(rows, 1, 2, 1, ACC);
    expect(cols).toHaveLength(1);
    expect(cols[0]).toMatchObject({ high: null, low: null, open: null, close: null, volume: 0, hasGap: true });
    expect(cols[0].i0).toBe(1);
    expect(cols[0].i1).toBe(2);
  });

  it("columns tile the window contiguously, with no overlap and no remainder", () => {
    const rows = makeRows(1000);
    const cols = columnAggregate(rows, 3, 998, 17, ACC);
    expect(cols[0].i0).toBe(3);
    expect(cols[cols.length - 1].i1).toBe(998);
    for (let k = 1; k < cols.length; k++) {
      expect(cols[k].i0).toBe(cols[k - 1].i1 + 1);
      expect(cols[k].i1).toBeGreaterThanOrEqual(cols[k].i0);
    }
  });

  it("a window smaller than the column count degrades to one row per column", () => {
    const rows = makeRows(10);
    const cols = columnAggregate(rows, 0, 9, 1440, ACC);
    expect(cols).toHaveLength(10);
    for (const col of cols) expect(col.i0).toBe(col.i1);
  });

  it("clamps out-of-range windows and answers [] for empty/inverted inputs", () => {
    const rows = makeRows(50);
    expect(columnAggregate(rows, -999, 9999, 5, ACC)).toHaveLength(5);
    expect(columnAggregate(rows, 0, 49, 5, ACC)[0].i0).toBe(0);
    expect(columnAggregate(rows, 40, 10, 5, ACC)).toEqual([]);
    expect(columnAggregate(rows, 0, 49, 0, ACC)).toEqual([]);
    expect(columnAggregate([], 0, 10, 4, ACC)).toEqual([]);
  });

  it("aggregates 40k rows into 1440 columns inside the perf bound (log measured)", () => {
    const rows = makeRows(40_000);
    const t0 = performance.now();
    const cols = columnAggregate(rows, 0, rows.length - 1, 1440, ACC);
    const dt = performance.now() - t0;
    console.log(`[lod-perf] columnAggregate 40000 rows -> 1440 columns: ${dt.toFixed(2)} ms`);
    expect(cols).toHaveLength(1440);
    expect(dt).toBeLessThan(200); // generous CI bound; target is 20 ms
  });

  it("a VisualColumn[] cannot be passed where an EngineSeriesRow[] is expected", () => {
    const cols: VisualColumn[] = columnAggregate(makeRows(20), 0, 19, 4, ACC);
    // @ts-expect-error LOD-A02 visual-only brand: VisualColumn must never satisfy
    // EngineSeriesRow. If this ever type-checks, tsc reports the directive as
    // unused and fails — that is the guard, not this runtime assertion.
    const bad: EngineSeriesRow[] = cols;
    expect(bad.length).toBe(cols.length);
  });
});

// ── lineDecimate — LOD-A03 ─────────────────────────────────────────────────────

describe("lod — lineDecimate", () => {
  it("keeps the global min and max points (LOD-A03)", () => {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 500; i++) {
      points.push({ x: i * 0.1, y: Math.sin(i / 9) * 5 });
    }
    // A one-sample spike buried mid-bucket — the whole point of LOD-A03.
    points[255] = { x: 25.5, y: -999 };
    points[258] = { x: 25.8, y: 999 };
    const out = lineDecimate(points, 1);
    expect(out.some((p) => p.y === -999)).toBe(true);
    expect(out.some((p) => p.y === 999)).toBe(true);
  });

  it("keeps the first and last point of every pixel bucket, by reference", () => {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 100; i++) points.push({ x: i * 0.1, y: i });
    const out = lineDecimate(points, 1); // buckets of 10 points each
    for (let b = 0; b < 10; b++) {
      const first = points[b * 10];
      const last = points[b * 10 + 9];
      expect(out.includes(first)).toBe(true);
      expect(out.includes(last)).toBe(true);
    }
    // Global endpoints survive at the array edges.
    expect(out[0]).toBe(points[0]);
    expect(out[out.length - 1]).toBe(points[points.length - 1]);
  });

  it("only ever references input points, in input order", () => {
    const rand = mulberry32(7);
    const points = Array.from({ length: 300 }, (_, i) => ({ x: i * 0.05, y: rand() * 10 }));
    const out = lineDecimate(points, 0.75);
    let prev = -1;
    for (const p of out) {
      const i = points.indexOf(p); // strict-equality reference lookup
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeGreaterThan(prev);
      prev = i;
    }
    expect(out.length).toBeLessThanOrEqual(points.length);
  });

  it("collapses a monotone run to the bucket endpoints only", () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: i * 0.001 }));
    const out = lineDecimate(points, 10); // 100 buckets of 10 points
    expect(out).toHaveLength(200); // first + last per bucket; extremes ARE those
    expect(out.length).toBeLessThan(1000);
  });

  it("drops interior non-finite points but keeps bucket endpoints verbatim", () => {
    const nan = Number.NaN;
    const points = [
      { x: 0.0, y: nan },
      { x: 0.1, y: 5 },
      { x: 0.2, y: nan },
      { x: 0.3, y: 7 },
      { x: 0.4, y: nan },
    ];
    const out = lineDecimate(points, 1); // one bucket [0, 1)
    expect(out).toHaveLength(4);
    expect(Number.isNaN(out[0].y)).toBe(true);  // first kept verbatim
    expect(out[1].y).toBe(5);                   // bucket min
    expect(out[2].y).toBe(7);                   // bucket max
    expect(Number.isNaN(out[3].y)).toBe(true);  // last kept verbatim
  });

  it("answers a copy for empty input or a non-positive tolerance", () => {
    expect(lineDecimate([], 1)).toEqual([]);
    const points = [{ x: 0, y: 1 }, { x: 1, y: 2 }];
    const same = lineDecimate(points, 0);
    expect(same).toEqual(points);
    expect(same).not.toBe(points); // copied, not aliased
    expect(lineDecimate(points, Number.NaN)).toEqual(points);
    const single = lineDecimate([{ x: 5, y: 5 }], 1);
    expect(single).toEqual([{ x: 5, y: 5 }]);
  });
});

// PERF-C: the streaming decimator the LOD line paint uses must return exactly
// what lineDecimate returns for the same pushed sequence.
describe("lod — LineDecimator (PERF-C streaming lineDecimate)", () => {
  const stream = (points: readonly { x: number; y: number }[], tol: number) => {
    const d = new LineDecimator(tol);
    for (const p of points) d.push(p.x, p.y);
    return d.finish();
  };

  it("equals lineDecimate on seeded random polylines with ties, gaps, non-finite y and x", () => {
    const rand = mulberry32(0x9e3c);
    const ys = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (let trial = 0; trial < 400; trial++) {
      const n = Math.floor(rand() * 400);
      const density = 0.05 + rand() * 40; // points per pixel: sparse to fitted-LOD dense
      const tol = [1, 1, 1, 0.75, 3, 10][Math.floor(rand() * 6)];
      let x = (rand() - 0.5) * 200;
      const points: { x: number; y: number }[] = [];
      for (let k = 0; k < n; k++) {
        x += rand() < 0.02 ? rand() * 30 : 1 / density;
        const r = rand();
        const y = r < 0.04 ? ys[Math.floor(rand() * ys.length)] : r < 0.2 ? Math.round(rand() * 3) : rand() * 100;
        points.push({ x: rand() < 0.01 ? Number.NaN : x, y });
      }
      expect(stream(points, tol)).toEqual(lineDecimate(points, tol));
    }
  });

  it("equals lineDecimate on the edge shapes: empty, single, one bucket, non-positive tolerance", () => {
    const pts = [{ x: 0.1, y: 5 }, { x: 0.2, y: 5 }, { x: 0.3, y: 1 }, { x: 0.4, y: 9 }, { x: 0.5, y: 1 }, { x: 0.9, y: 9 }];
    for (const input of [[], [{ x: 5, y: 5 }], pts, pts.slice().reverse()]) {
      for (const tol of [1, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(stream(input, tol)).toEqual(lineDecimate(input, tol));
      }
    }
  });
});

// ── indexOfTime throughput ─────────────────────────────────────────────────────

describe("lod — perf", () => {
  it("answers 1000 indexOfTime lookups over 40k rows inside the perf bound", () => {
    const rows = makeRows(40_000);
    const idx = createBarIndex(rows);
    let present = 0;
    let absent = 0;
    const t0 = performance.now();
    for (let q = 0; q < 1000; q++) {
      const row = rows[(q * 37) % rows.length];
      if (q % 2 === 0) {
        if (idx.indexOfTime(row.time, MODES[q % 4]) !== null) present++;
      } else {
        // +30 s never lands on a 60 s grid point, so exact must miss.
        if (idx.indexOfTime(row.time + 30, "exact") === null) absent++;
      }
    }
    const dt = performance.now() - t0;
    console.log(`[lod-perf] 1000 indexOfTime lookups (mixed modes) over 40000 rows: ${dt.toFixed(2)} ms`);
    expect(present).toBe(500);
    expect(absent).toBe(500);
    expect(dt).toBeLessThan(50); // generous CI bound; target is 5 ms
  });
});
