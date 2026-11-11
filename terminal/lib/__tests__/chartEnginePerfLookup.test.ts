// PERF-B T1(d)/T2 — N-independence and equivalence of the indexed time
// lookups. The oracles below are VERBATIM COPIES of the pre-PERF-B
// implementations (linear scans + per-call maps) from model.ts/frame.ts at
// BASE_SHA 4c1b991; the optimised paths must answer identically (T2) and must
// not visit rows proportionally to the corpus (T1d, via the documented
// model.__perfCounters hook).
import { describe, expect, it, vi } from "vitest";

import { ChartModel, __perfCounters, seriesIndexOfTime, timeToMs } from "@/lib/chart-engine/canvas/model";
import { futureBarTimes, futureCadence, futureSlotOf } from "@/lib/chart-engine/futureTime";
import type { EngineSeriesRow, EngineTime } from "@/lib/chart-engine/api";

// ── Oracles: pre-PERF-B implementations, copied verbatim ───────────────────────

function oracleTimeToIndex(rows: EngineSeriesRow[], time: EngineTime, findNearest?: boolean): number | null {
  if (rows.length === 0) return null;
  const target = timeToMs(time);
  if (!Number.isFinite(target)) return null;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const d = Math.abs(timeToMs(rows[i].time) - target);
    if (d === 0) return i;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return findNearest && best >= 0 ? best : null;
}

function oracleIndexOfTime(rows: EngineSeriesRow[], t: EngineTime): number | null {
  const target = timeToMs(t);
  if (!Number.isFinite(target)) return null;
  for (let i = 0; i < rows.length; i++) {
    if (timeToMs(rows[i].time) === target) return i;
  }
  return null;
}

function oracleResolve(time: EngineTime, primaryTimes: EngineTime[]): { logical: number; time: EngineTime } | null {
  if (primaryTimes.length < 2) return null;
  const asCadence = (t: EngineTime): string | number => (typeof t === "object"
    ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`
    : t);
  const times = primaryTimes.map(asCadence);
  const slot = futureSlotOf(futureCadence(times), asCadence(time));
  if (slot < 0) return null;
  const ft = futureBarTimes(times)[slot];
  return ft == null ? null : { logical: primaryTimes.length + slot, time: ft };
}

function oracleLogicalToFutureTime(rows: EngineSeriesRow[], logical: number): EngineTime | null {
  if (!Number.isFinite(logical)) return null;
  if (rows.length < 2) return null;
  const n = rows.length;
  const i = Math.round(logical);
  if (i < n) return null;
  const asCadence = (t: EngineTime): string | number => (typeof t === "object"
    ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`
    : t);
  const futures = futureBarTimes(rows.map((r) => asCadence(r.time)));
  return futures[i - n] ?? null;
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

/** Daily bars as business-day objects, with whitespace rows mixed in. */
function businessDayRows(n: number): EngineSeriesRow[] {
  const out: EngineSeriesRow[] = [];
  let d = new Date(Date.UTC(2020, 0, 1));
  for (let i = 0; i < n; i++) {
    do { d = new Date(d.getTime() + 86_400_000); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    const row: EngineSeriesRow = i % 97 === 96
      ? { time: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } }
      : {
        time: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
        open: 100 + (i % 13), high: 110 + (i % 17), low: 90 + (i % 11), close: 105 + (i % 19),
      };
    out.push(row);
  }
  return out;
}

/** Daily bars as ISO date strings. */
function isoRows(n: number): EngineSeriesRow[] {
  const base = businessDayRows(n);
  return base.map((r) => {
    const t = r.time as { year: number; month: number; day: number };
    return { ...r, time: `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` };
  });
}

/** Intraday bars as numeric epoch seconds. */
function epochRows(n: number): EngineSeriesRow[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1_700_000_000 + i * 3600,
    open: 10 + (i % 7), high: 12 + (i % 5), low: 9 + (i % 3), close: 11 + (i % 6),
  }));
}

function mountedWith(rows: EngineSeriesRow[]): { m: ChartModel; rows: EngineSeriesRow[] } {
  const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
  m.applyOptions({ width: 900, height: 400 });
  m.addSeries("candles").setData(rows);
  return { m, rows };
}

const QUERY_GRID = (rows: EngineSeriesRow[]): EngineTime[] => [
  rows[0].time,
  rows[Math.floor(rows.length / 2)].time,
  rows[rows.length - 1].time,
  // off-grid times (absent, between bars, before first, after last)
  1, 99_999, 1_700_000_000 + 1800, "2019-12-31", "2099-01-01",
  { year: 2019, month: 12, day: 31 }, { year: 2099, month: 1, day: 1 },
  // future-slot targets past the last bar
  1_700_000_000 + 3600 * 3, "2099-01-05",
];

// ── T2: equivalence against the oracles ───────────────────────────────────────

describe("PERF-B T2 lookup equivalence (oracles = pre-change implementations)", () => {
  for (const [name, fixture] of [
    ["business-day objects", businessDayRows(400)],
    ["ISO date strings", isoRows(400)],
    ["numeric epoch seconds", epochRows(400)],
  ] as const) {
    it(`timeToIndex exact + findNearest answers identically (${name})`, () => {
      const { m, rows } = mountedWith(fixture);
      const primary = m.primarySeries()!;
      for (const q of QUERY_GRID(rows)) {
        expect(m.timeToIndex(q, false)).toEqual(oracleTimeToIndex(rows, q, false));
        expect(m.timeToIndex(q, true)).toEqual(oracleTimeToIndex(rows, q, true));
      }
      expect(seriesIndexOfTime(primary, rows[3].time, "exact"))
        .toEqual(oracleIndexOfTime(rows, rows[3].time));
    });

    it(`futureSlotLogical / logicalToFutureTime answer identically (${name})`, () => {
      const { m, rows } = mountedWith(fixture);
      for (const q of QUERY_GRID(rows)) {
        expect(m.futureSlotLogical(q)).toEqual(oracleResolve(q, rows.map((r) => r.time))?.logical ?? null);
      }
      const n = rows.length;
      for (const logical of [-3, 0, n - 1, n, n + 1, n + 5, n + 199, n + 500]) {
        expect(m.logicalToFutureTime(logical)).toEqual(oracleLogicalToFutureTime(rows, logical));
      }
    });

    it(`dataByIndex answers identically in all mismatch directions (${name})`, () => {
      const { m, rows } = mountedWith(fixture);
      const h = m.seriesHandle(m.primarySeries()!.id)!;
      const oracleDataByIndex = (logicalIndex: number, dir: "none" | "nearest-left" | "nearest-right") => {
        const valued: number[] = [];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i] as { close?: unknown; value?: unknown };
          if (typeof r.close === "number" || typeof r.value === "number") valued.push(i);
        }
        const lowerBound = (target: number): number => {
          let lo = 0;
          let hi = valued.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (valued[mid] < target) lo = mid + 1;
            else hi = mid;
          }
          return lo;
        };
        if (valued.length === 0) return null;
        const lo = lowerBound(logicalIndex);
        const hit = lo < valued.length && valued[lo] === logicalIndex ? valued[lo] : -1;
        if (dir === "nearest-left") {
          if (hit >= 0) return rows[hit];
          return lo > 0 ? rows[valued[lo - 1]] : null;
        }
        if (dir === "nearest-right") {
          if (hit >= 0) return rows[hit];
          return lo < valued.length ? rows[valued[lo]] : null;
        }
        const rounded = Math.round(logicalIndex);
        const at = lowerBound(rounded);
        return at < valued.length && valued[at] === rounded ? rows[rounded] : null;
      };
      for (const logical of [-2, 0, 1, 95.4, 96, 97, 199.6, 200, 399, 400.7, 1e9]) {
        for (const dir of ["none", "nearest-left", "nearest-right"] as const) {
          expect(h.dataByIndex(logical, dir)).toEqual(oracleDataByIndex(logical, dir));
        }
      }
    });
  }
});

// ── T1(d): N-independence of the lookup paths ─────────────────────────────────

/** Run the fixed lookup workload at corpus size n and return the counter delta. */
function lookupWorkload(n: number): { rowsScanned: number; timeToMsCalls: number; dateParses: number } {
  const { m, rows } = mountedWith(isoRows(n));
  m.setVisibleLogicalRange({ from: n - 1000, to: n });
  // Warm every lazy index once (allowed: once per data generation).
  m.timeToIndex(rows[n - 1].time, true);
  m.timeScaleHandleFor().setVisibleRange({ from: rows[n - 500].time, to: rows[n - 1].time });
  m.futureSlotLogical("2099-01-05");
  m.logicalToFutureTime(n + 10);
  m.seriesHandle(m.primarySeries()!.id)!.dataByIndex(n - 3, "none");

  const parseSpy = vi.spyOn(Date, "parse");
  __perfCounters.timeToMsCalls = 0;
  __perfCounters.rowsScanned = 0;
  for (let k = 0; k < 50; k++) {
    m.timeToIndex(rows[n - 1 - (k % 900)].time, k % 2 === 0);
    m.timeToCoordinate(rows[n - 1 - (k % 900)].time);
    m.coordinateToTime(450);
    m.futureSlotLogical("2099-01-05");
    m.logicalToFutureTime(n + (k % 30));
  }
  const out = {
    rowsScanned: __perfCounters.rowsScanned,
    timeToMsCalls: __perfCounters.timeToMsCalls,
    dateParses: parseSpy.mock.calls.length,
  };
  parseSpy.mockRestore();
  return out;
}

describe("PERF-B T1(d) lookup counters are N-independent", () => {
  it("row visits / timeToMs / Date.parse are EQUAL for N=10,000 and N=40,000 (same window)", () => {
    const small = lookupWorkload(10_000);
    const large = lookupWorkload(40_000);
    // Equality across N is the claim; the explicit log-bound documents the
    // allowed class (a binary-search implementation answers 0 row scans).
    expect(large.rowsScanned).toBe(small.rowsScanned);
    expect(small.rowsScanned).toBeLessThanOrEqual(250 * Math.ceil(Math.log2(40_000)) * 4);
    expect(large.timeToMsCalls).toBe(small.timeToMsCalls);
    expect(small.timeToMsCalls).toBeLessThan(2_000);
    expect(large.dateParses).toBe(small.dateParses);
  });
});
