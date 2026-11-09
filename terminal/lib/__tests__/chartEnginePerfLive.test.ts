// PERF-B T1(b,c)/T3-live/T4 — the live commit path must be O(1) amortised in
// the corpus size N, and the incremental visible-extents cache must agree with
// a full visible-slice rescan oracle after EVERY tick.
//
// The oracle in T4 is a verbatim copy of the pre-PERF-B visiblePriceExtents
// row scan (BASE_SHA 4c1b991), run directly over the rows.
import { describe, expect, it } from "vitest";

import { ChartModel, __perfCounters } from "@/lib/chart-engine/canvas/model";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

/** Deterministic PRNG (mulberry32) so tick sequences are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function candleRows(n: number): EngineSeriesRow[] {
  const rand = mulberry32(1234 + n);
  let close = 100;
  return Array.from({ length: n }, (_, i) => {
    close += (rand() - 0.5) * 4;
    const high = close + rand() * 2;
    const low = close - rand() * 2;
    return { time: 1_700_000_000 + i * 3600, open: close - 0.5, high, low, close };
  });
}

function mounted(n: number, kind: "candles" | "line" = "candles"): { m: ChartModel; s: NonNullable<ReturnType<ChartModel["primarySeries"]>> } {
  const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
  m.applyOptions({ width: 900, height: 400 });
  const rows = candleRows(n);
  if (kind === "line") {
    m.addSeries("line").setData(rows.map((r) => ({ time: r.time, value: (r as { close: number }).close })));
  } else {
    m.addSeries("candles").setData(rows);
  }
  m.setVisibleLogicalRange({ from: n - 1000, to: n });
  return { m, s: m.primarySeries()! };
}

/** Oracle: pre-PERF-B visiblePriceExtents scan, verbatim. */
function oracleExtents(m: ChartModel, s: NonNullable<ReturnType<ChartModel["primarySeries"]>>): { min: number; max: number } | null {
  const rows = s.rows;
  const start = Math.max(0, Math.floor(m.time.visibleFrom));
  const end = Math.min(rows.length - 1, Math.ceil(m.time.visibleTo));
  if (start > end) return null;
  let min = Infinity;
  let max = -Infinity;
  const ohlc = s.kind === "candles" || s.kind === "bars";
  for (let i = start; i <= end; i++) {
    const row = rows[i];
    if (!row) continue;
    if (ohlc) {
      const b = row as { open?: unknown; high?: unknown; low?: unknown; close?: unknown };
      for (const key of ["open", "high", "low", "close"] as const) {
        const v = b[key];
        if (typeof v === "number" && Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
      }
    } else if ("value" in row && typeof (row as { value?: unknown }).value === "number") {
      const v = (row as { value: number }).value;
      if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

describe("PERF-B T1(b,c) live update / append counters are N-independent", () => {
  it("one in-place tick + extents reads: counters EQUAL for N=10,000 vs N=40,000", () => {
    const runAt = (n: number) => {
      const { m, s } = mounted(n);
      const rows = s.rows;
      const last = rows[rows.length - 1] as { time: number; open: number; high: number; low: number; close: number };
      // Warm the caches once (a paint after load does exactly this).
      m.visiblePriceExtents(s);
      m.firstVisibleClose(s);
      __perfCounters.valuedRowsBuilt = 0;
      __perfCounters.extentsRowsScanned = 0;
      __perfCounters.rowsScanned = 0;
      m.updateSeriesRow(s.id, { ...last, close: last.close + 0.1 });
      // A paint reads extents several times (per series projection) and the
      // first visible close — all must be cache hits now.
      for (let k = 0; k < 4; k++) {
        m.visiblePriceExtents(s);
        m.firstVisibleClose(s);
      }
      return {
        valued: __perfCounters.valuedRowsBuilt,
        extents: __perfCounters.extentsRowsScanned,
        scanned: __perfCounters.rowsScanned,
      };
    };
    const small = runAt(10_000);
    const large = runAt(40_000);
    expect(large.valued).toBe(small.valued);
    expect(small.valued).toBe(0); // mutant: `s.valuedIdx = null` per update makes this N
    expect(large.extents).toBe(small.extents);
    expect(small.extents).toBe(0); // tick stayed inside the cached extents
    expect(large.scanned).toBe(small.scanned);
    expect(small.scanned).toBe(0);
  });

  it("one append + extents reads rescans ONLY the visible slice (equal for both N)", () => {
    const runAt = (n: number) => {
      const { m, s } = mounted(n);
      const rows = s.rows;
      const last = rows[rows.length - 1] as { time: number; open: number; high: number; low: number; close: number };
      m.visiblePriceExtents(s);
      __perfCounters.extentsRowsScanned = 0;
      __perfCounters.valuedRowsBuilt = 0;
      m.updateSeriesRow(s.id, { time: last.time + 3600, open: last.close, high: last.close + 1, low: last.close - 1, close: last.close + 0.5 });
      m.visiblePriceExtents(s);
      m.visiblePriceExtents(s);
      return { extents: __perfCounters.extentsRowsScanned, valued: __perfCounters.valuedRowsBuilt };
    };
    const small = runAt(10_000);
    const large = runAt(40_000);
    expect(large.extents).toBe(small.extents);
    expect(small.extents).toBeLessThanOrEqual(1001); // the visible window, never N
    expect(large.valued).toBe(small.valued);
    expect(small.valued).toBe(0);
  });
});

describe("PERF-B T4 incremental extents equal a full visible rescan after every tick", () => {
  it("500 seeded in-place ticks (inside, outside, taking and releasing extremes)", () => {
    const { m, s } = mounted(2_000);
    const rows = s.rows;
    const rand = mulberry32(20261013);
    for (let k = 0; k < 500; k++) {
      const last = rows[rows.length - 1] as { time: number; open: number; high: number; low: number; close: number };
      const roll = rand();
      let next: EngineSeriesRow;
      if (roll < 0.15) {
        // take the extreme: a new visible maximum
        next = { ...last, close: last.close + 25 + rand() * 5, high: last.high + 26 };
      } else if (roll < 0.30) {
        // release the extreme: fall back inside (the old bar held the max)
        next = { ...last, close: 100 + rand() * 2, high: 102 + rand() * 2, low: 98 + rand() * 2, open: 100 };
      } else if (roll < 0.40) {
        // whitespace flip: the live bar goes blank (all extents must survive)
        next = { time: last.time };
      } else if (roll < 0.55 && k > 0) {
        // flip back to valued from a blank previous tick
        const prev = rows[rows.length - 1];
        next = "close" in prev && typeof (prev as { close?: unknown }).close === "number"
          ? { ...last, close: (prev as { close: number }).close + (rand() - 0.5) }
          : { ...last, close: 100 + rand() * 3, open: 99, high: 103, low: 97 };
      } else {
        // ordinary tick, sometimes outside the current extents
        const drift = (rand() - 0.5) * (roll > 0.9 ? 40 : 3);
        next = { ...last, close: last.close + drift, high: last.high + Math.abs(drift), low: last.low - Math.abs(drift) };
      }
      m.updateSeriesRow(s.id, next);
      const got = m.visiblePriceExtents(s);
      const want = oracleExtents(m, s);
      expect(got).toEqual(want);
    }
  });

  it("500 seeded ticks on a line series with occasional NaN-ish blanks", () => {
    const { m, s } = mounted(2_000, "line");
    const rows = s.rows;
    const rand = mulberry32(777);
    for (let k = 0; k < 500; k++) {
      const last = rows[rows.length - 1] as { time: number; value: number };
      const roll = rand();
      const next: EngineSeriesRow = roll < 0.2
        ? { time: last.time } // whitespace
        : roll < 0.4
          ? { time: last.time, value: last.value + 30 } // take the extreme
          : { time: last.time, value: last.value + (rand() - 0.5) * 8 };
      m.updateSeriesRow(s.id, next);
      expect(m.visiblePriceExtents(s)).toEqual(oracleExtents(m, s));
    }
  });

  it("a same-bar tick on an OFF-SCREEN last row leaves the visible extents untouched", () => {
    // The live branch of updateSeriesRow always mutates row n-1; maintainExtentsOnInPlace
    // must not fold it into a cache built for a window that excludes it.
    const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
    m.applyOptions({ width: 900, height: 400 });
    const h = m.addSeries("candles");
    // Distinct extremes per row so no off-window row can equal the visible min/max.
    h.setData(Array.from({ length: 1000 }, (_, i) => ({
      time: 1_700_000_000 + i * 3600, open: 100 + i * 1e-4,
      high: 101 + i * 1e-4, low: 99 + i * 1e-4, close: 100.5 + i * 1e-4,
    })));
    const s = m.primarySeries()!;
    m.setVisibleLogicalRange({ from: 100, to: 300 });
    expect(m.visiblePriceExtents(s)).toEqual(oracleExtents(m, s));
    m.updateSeriesRow(s.id, { time: 1_700_000_000 + 999 * 3600, open: 100, high: 900, low: 1, close: 500 });
    expect(m.visiblePriceExtents(s)).toEqual(oracleExtents(m, s));
    expect(m.autoscaleScale(0, "right").to).toBeLessThan(200);
  });
});
