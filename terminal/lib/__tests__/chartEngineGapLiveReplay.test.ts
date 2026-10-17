// @vitest-environment jsdom
// GAP-LIVEREPLAY — acceptance-matrix rows for the live/replay lane:
//   L01-A02  Old-symbol HTTP/script response arrives late -> no visible/persisted state change
//   L01-A03  In-place update -> no pane topology or static-guide growth
//   L01-A04  Data-fed Options overlay -> no new fetch/model and no false freshness from render clock
//   L02-A01  Scrub before future bars/signals -> no downstream layer exposes inadmissible future values
//   L02-A02  Replay->live after intervening updates -> latest accepted live generation, no source mix
//   L02-A04  Missing captured knowledge-time metadata -> view states reconstructed/unavailable as appropriate
//
// Every describe follows the "Required observation itself" pattern: the test names the row's
// asserted property in its `it` title, and a per-row mutant receipt (see RESULT.md MUTANTS) makes
// the assertion falsifiable. No production behaviour is added — the file is read-only over the
// chart-engine live/replay surfaces and the data-load effect in components/ChartPanel.tsx.

import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ── LWC mock stand-in (precedent: lwcAdapter.test.ts) ──────────────────────────
const H = vi.hoisted(() => {
  type Spy = ReturnType<typeof vi.fn>;
  interface FakePriceLine { __opts: unknown; applyOptions: Spy; options: Spy; }
  interface FakeSeries {
    __paneIndex: number;
    __priceLines: FakePriceLine[];
    __data: unknown[];
    setData: Spy; update: Spy; applyOptions: Spy; options: Spy;
    data: Spy; dataByIndex: Spy; priceLines: Spy; createPriceLine: Spy; removePriceLine: Spy;
    priceToCoordinate: Spy; coordinateToPrice: Spy; paneIndex: Spy;
  }
  interface FakePane { __index: number; __series: FakeSeries[]; getSeries: Spy; paneIndex: Spy; }
  interface FakeTimeScale { getVisibleLogicalRange: Spy; subscribeVisibleLogicalRangeChange: Spy; }
  interface FakeChart {
    panes: Spy; timeScale: Spy; addSeries: Spy; removeSeries: Spy; applyOptions: Spy;
    subscribeCrosshairMove: Spy; unsubscribeCrosshairMove: Spy; resize: Spy; remove: Spy;
    takeScreenshot: Spy; setCrosshairPosition: Spy; clearCrosshairPosition: Spy;
    __ts: FakeTimeScale; __panes: FakePane[];
  }
  const reg = { charts: [] as FakeChart[], lastChart(): FakeChart { return reg.charts[reg.charts.length - 1]; } };
  const makePane = (index: number): FakePane => {
    const pane: FakePane = {
      __index: index, __series: [],
      getSeries: vi.fn(() => pane.__series),
      paneIndex: vi.fn(() => index),
    };
    return pane;
  };
  const makeSeries = (paneIndex: number): FakeSeries => {
    const s: FakeSeries = {
      __paneIndex: paneIndex, __priceLines: [], __data: [],
      setData: vi.fn((rows: unknown[]) => { s.__data = rows; }),
      update: vi.fn(), applyOptions: vi.fn(), options: vi.fn(() => ({})),
      data: vi.fn(() => s.__data),
      dataByIndex: vi.fn((i: number) => (s.__data[i] ?? null) as unknown),
      priceLines: vi.fn(() => s.__priceLines),
      createPriceLine: vi.fn((o: unknown) => {
        const pl: FakePriceLine = { __opts: o, applyOptions: vi.fn(), options: vi.fn(() => o) };
        s.__priceLines.push(pl); return pl;
      }),
      removePriceLine: vi.fn(), priceToCoordinate: vi.fn(() => null),
      coordinateToPrice: vi.fn(() => null), paneIndex: vi.fn(() => paneIndex),
    };
    return s;
  };
  const createChart = vi.fn((): FakeChart => {
    const ts: FakeTimeScale = { getVisibleLogicalRange: vi.fn(), subscribeVisibleLogicalRangeChange: vi.fn() };
    const chart: FakeChart = {
      __ts: ts, __panes: [makePane(0)],
      panes: vi.fn(() => chart.__panes),
      timeScale: vi.fn(() => ts),
      addSeries: vi.fn((_d: unknown, _o: unknown, paneIndex?: number) => {
        const pi = paneIndex ?? 0;
        while (chart.__panes.length <= pi) chart.__panes.push(makePane(chart.__panes.length));
        const s = makeSeries(pi);
        chart.__panes[pi].__series.push(s);
        return s;
      }),
      removeSeries: vi.fn(), applyOptions: vi.fn(),
      subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(),
      resize: vi.fn(), remove: vi.fn(), takeScreenshot: vi.fn(() => ({}) as unknown),
      setCrosshairPosition: vi.fn(), clearCrosshairPosition: vi.fn(),
    };
    reg.charts.push(chart);
    return chart;
  });
  return { reg, createChart };
});
vi.mock("lightweight-charts", () => ({
  createChart: H.createChart,
  createSeriesMarkers: vi.fn(),
  createTextWatermark: vi.fn(),
  CandlestickSeries: {}, BarSeries: {}, LineSeries: {}, AreaSeries: {},
  HistogramSeries: {}, BaselineSeries: {}, MismatchDirection: {},
}));

import { createEngine } from "@/lib/chart-engine";
import type { SeriesHandle, EngineSeriesKind } from "@/lib/chart-engine/api";
import {
  applyLiveOp, liveStateFromRows, reduceLiveTick,
  type LiveBar, type LiveGenerationState,
} from "@/lib/chart-engine/liveGeneration";
import {
  applyLiveCommit, createReplayState, enterReplay, exitReplay,
  seek, stepBack, stepForward, type ReplayRefusalCode, type ReplayRow, type ReplayState,
} from "@/lib/chart-engine/replayGeneration";
import { deriveOptLevels, sessionsOldEt } from "@/lib/optionsLevels";
import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";

// ── Shared fixtures ───────────────────────────────────────────────────────────
const T0 = 1_700_000_000;           // bar 0 OPEN, epoch seconds
const STEP = 300;                    // 5 minutes per bar
function rowAt(i: number, close = 100 + i, extra: Partial<ReplayRow> = {}): ReplayRow {
  const t = T0 + i * STEP;
  return {
    time: t, closeTime: t + STEP, open: 100 + i, high: 100 + i + 1,
    low: 100 + i - 1, close, volume: 100 + i, complete: true, ...extra,
  };
}
const closeMs = (r: ReplayRow): number => (r.closeTime as number) * 1000;

function quote(sec: number, last: number) {
  const ms = Date.UTC(2026, 7, 7, 13, 30, sec);
  return {
    basis: "REALTIME", marketSession: "rth", last,
    ts: Math.floor(ms / 1000), asOfMs: ms,
    tickOpen: last - 0.05, tickHigh: last + 0.1, tickLow: last - 0.1, tickClose: last,
    tickVol: 12, tickStartMs: ms, tickEndMs: ms + 999,
  };
}

function spyHandle(kind: EngineSeriesKind): SeriesHandle & { setData: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  return {
    kind, setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(), options: vi.fn(() => ({})),
    data: vi.fn(() => []), dataByIndex: vi.fn(() => null), setMarkers: vi.fn(),
    createPriceLine: vi.fn(), removePriceLine: vi.fn(), priceLines: vi.fn(() => []),
    priceScale: vi.fn(() => ({ width: vi.fn(), applyOptions: vi.fn(), options: vi.fn(() => ({})),
      getVisibleRange: vi.fn(() => null), setVisibleRange: vi.fn(), setAutoScale: vi.fn(), unwrap: vi.fn() })),
    priceToCoordinate: vi.fn(() => null), coordinateToPrice: vi.fn(() => null),
    paneIndex: vi.fn(() => 0), pane: vi.fn(), moveToPane: vi.fn(),
    attachPrimitive: vi.fn(), detachPrimitive: vi.fn(), remove: vi.fn(), unwrap: vi.fn(),
  } as unknown as SeriesHandle & { setData: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
}

// ─────────────────────────────────────────────────────────────────────────────
// L01-A02 — Old-symbol response arriving late leaves no visible/persisted state.
// Evidence class: source-read of components/ChartPanel.tsx Effect 2 (data).
// ─────────────────────────────────────────────────────────────────────────────
describe("L01-A02: Old-symbol HTTP/script response arrives late -> No visible or persisted state change. [source-read]", () => {
  // The data-load effect spans lines 8645-9052 of components/ChartPanel.tsx. It is the only
  // place where ChartPanel awaits a remote response, so every async continuation that performs
  // a visible or persisted write (setX state setter, series.setData/update/createPriceLine,
  // localStorage/sessionStorage/persist/save calls) MUST be preceded by a `cancelled` or
  // `epochRef.current !== epoch` guard. The checker below reads the effect body and lists
  // every such guarded site; the assertion is that the count is >= 14 (the measured count of
  // actually-protected sites). The mutant receipt removes ONE guard, re-runs the checker
  // against an in-memory copy, and shows the unguarded site.

  const chartPanelPath = path.join(process.cwd(), "components", "ChartPanel.tsx");
  const source = fs.readFileSync(chartPanelPath, "utf8");
  // Anchor on the epoch-bump line that belongs only to the data-load effect, then walk
  // backward to the `useEffect(() => {` opener so we get the exact body of Effect 2.
  const epochIdx = source.indexOf("const epoch = ++epochRef.current;");
  if (epochIdx < 0) throw new Error("L01-A02: data-load effect not found in components/ChartPanel.tsx");
  const openerIdx = source.lastIndexOf("useEffect(() => {", epochIdx);
  const closerPattern = /\n  \}, \[symbol, effectiveTimeframe, chartType, extHours\]\);/;
  const closerMatch = source.slice(openerIdx).match(closerPattern);
  if (!closerMatch) throw new Error("L01-A02: data-load effect closer not found");
  const effectBody = source.slice(openerIdx, openerIdx + closerMatch.index! + 1);

  // Restrict the scan to the ASYNC IIFE that owns the fetches — synchronous setup writes
  // before the first await are not "async continuations" and are not in scope for L01-A02.
  const iifeOpen = effectBody.indexOf("(async () => {");
  const iifeClose = effectBody.indexOf("})();", iifeOpen);
  if (iifeOpen < 0 || iifeClose < 0) throw new Error("L01-A02: async IIFE not found in data-load effect");
  const iifeBody = effectBody.slice(iifeOpen, iifeClose);
  const iifeBaseLine = effectBody.slice(0, iifeOpen).split("\n").length - 1; // 0-based line of IIFE start

  // Every state setter (setX), series.setData/update/createPriceLine, localStorage / sessionStorage
  // / persist / save — the categories the row's Required observation names.
  // A call to a ChartPanel helper whose OWN body performs one of those writes counts as the write:
  // adoptSlice (setSliceState), clearChartData (setSliceState + setData), applyExtendedPriceLine,
  // buildSlevels and buildPivots (createPriceLine). The guard must dominate the helper call site.
  const WRITE = /(set[A-Z]\w*\(|setData\(|\.update\(|applyOptions\(|setSliceState\(|setStripDailyBars\(|setStripBars\(|localStorage\.|sessionStorage\.|\bpersist\w*\(|\bsave\w*\(|createPriceLine\(|\badoptSlice\(|\bclearChartData\(|\bapplyExtendedPriceLine\(|\bbuildSlevels\(|\bbuildPivots\()/;

  // A continuation is either (a) the code after an `await`, running to the next suspension
  // point, or (b) the body of a callback handed to .then/.catch/.finally or a timer. Each
  // callback is its OWN continuation: a guard inside a sibling callback does not dominate a
  // write here, so the INNERMOST (latest-opening) continuation containing a write wins.
  // `await x.catch(() => null)` is an await, not a callback continuation.
  const CALLBACK = /\.(then|catch|finally)\(|\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask|requestIdleCallback)\s*\(/;
  function scanGuardedWrites(body: string): { line: number; ok: boolean; write: string; guard?: string }[] {
    const lines = body.split("\n");
    const ranges: { from: number; to: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const cb = lines[i].search(CALLBACK);
      const aw = lines[i].search(/\bawait\b/);
      if (cb >= 0 && (aw < 0 || aw > cb)) {
        let depth = 0;
        let j = i;
        for (; j < lines.length; j++) {
          depth += (lines[j].match(/[\(\{]/g) || []).length - (lines[j].match(/[\)\}]/g) || []).length;
          if (depth <= 0 && j > i) break;
        }
        ranges.push({ from: i, to: j + 1 });
        continue;
      }
      if (aw >= 0) {
        let j = i + 1;
        while (j < lines.length && lines[j].search(/\bawait\b/) < 0 && lines[j].search(CALLBACK) < 0) j++;
        ranges.push({ from: i, to: j });
      }
    }
    const guardRe = /if\s*\(\s*(cancelled|epochRef\.current\s*!==\s*epoch)/;
    const out: { line: number; ok: boolean; write: string; guard?: string }[] = [];
    for (let k = 0; k < lines.length; k++) {
      const m = lines[k].match(WRITE);
      if (!m) continue;
      const containing = ranges.filter((r) => k >= r.from && k < r.to);
      if (!containing.length) continue;
      const range = containing.reduce((a, b) => (b.from > a.from ? b : a));
      let ok = false;
      let guard: string | undefined;
      for (let g = range.from; g <= k; g++) {
        if (guardRe.test(lines[g])) { ok = true; guard = lines[g].trim().slice(0, 60); break; }
      }
      out.push({ line: k + 1, ok, write: m[0], guard });
    }
    return out;
  }

  function findGuardedWriteSites(): { line: number; ok: boolean; write: string; guard?: string }[] {
    const sites = scanGuardedWrites(iifeBody);
    // Adjust line numbers to be relative to the effect body (iifeBaseLine offset).
    return sites.map((s) => ({ ...s, line: s.line + iifeBaseLine }));
  }

  it("every async-continuation visible/persisted write is preceded by a cancelled/epoch guard (>= 14 guarded sites, zero unguarded)", () => {
    const sites = findGuardedWriteSites();
    const guarded = sites.filter((s) => s.ok);
    const unguarded = sites.filter((s) => !s.ok);
    expect({ guarded: guarded.length, unguarded: unguarded.length, unguardedSites: unguarded.map((u) => ({ line: u.line, write: u.write })) }).toEqual({
      guarded: expect.any(Number) as unknown as number,
      unguarded: 0,
      unguardedSites: [],
    });
    expect(guarded.length).toBeGreaterThanOrEqual(14);
  });

  it("falsifier: deleting the first `if (cancelled || epochRef.current !== epoch) return;` guard in the async IIFE produces an unguarded write the checker can name", () => {
    // Find the first standard guard and DELETE the line (not comment it — commenting still
    // matches the regex, and we want a real, no-op mutant). The preceding write (the one that
    // guard was protecting) must then be reported as unguarded.
    const guardRe = /if \(cancelled \|\| epochRef\.current !== epoch\) return;\n?/g;
    const m = guardRe.exec(iifeBody);
    if (!m) throw new Error("L01-A02 falsifier: no standard guard found in async IIFE");
    const mutated = iifeBody.slice(0, m.index) + iifeBody.slice(m.index + m[0].length);
    const linesBefore = effectBody.slice(0, iifeOpen).split("\n");
    const fullMutated = linesBefore.join("\n") + "\n" + mutated + effectBody.slice(iifeClose);
    const originalSites = findGuardedWriteSites().filter((s) => s.ok);
    const original = originalSites.length;
    // Reuse the scan on the mutated body.
    const iifeOpenM = fullMutated.indexOf("(async () => {");
    const iifeCloseM = fullMutated.indexOf("})();", iifeOpenM);
    const iifeBaseLineM = fullMutated.slice(0, iifeOpenM).split("\n").length - 1;
    const iifeBodyM = fullMutated.slice(iifeOpenM, iifeCloseM);
    const mutatedAll = scanGuardedWrites(iifeBodyM).map((s) => ({ ...s, line: s.line + iifeBaseLineM }));
    const mutatedGuarded = mutatedAll.filter((s) => s.ok).length;
    const mutatedUnguarded = mutatedAll.filter((s) => !s.ok);
    expect(mutatedGuarded).toBeLessThan(original);
    // The checker must NAME the write the deleted guard protected, not merely count fewer.
    expect(mutatedUnguarded.length).toBeGreaterThan(0);
    expect(mutatedUnguarded.map((u) => `${u.line}:${u.write}`)).toContain(`${originalSites[0].line}:${originalSites[0].write}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L01-A03 — In-place update grows no pane topology or static-guide.
// ─────────────────────────────────────────────────────────────────────────────
describe("L01-A03: In-place update -> No pane topology or static-guide growth", () => {
  it("100 in-place ops through applyLiveOp on an LWC engine leave inventory() unchanged and never call setData/createPriceLine/addSeries beyond the one setup call", () => {
    H.reg.charts.length = 0; vi.clearAllMocks();
    const e = createEngine({} as HTMLElement, { width: 800, height: 600 }, "lwc");
    const chart = H.reg.lastChart();
    const series = e.addSeries("candles") as SeriesHandle;
    const setDataSpy = vi.spyOn(series, "setData");
    const createPriceLineSpy = vi.spyOn(series, "createPriceLine");
    const updateSpy = vi.spyOn(series, "update");
    series.setData([{ time: T0, open: 100, high: 101, low: 99, close: 100.5 }]);
    const baselineAddSeries = chart.addSeries.mock.calls.length;
    const baselineCreatePriceLine = createPriceLineSpy.mock.calls.length;
    const baselineSetData = setDataSpy.mock.calls.length;
    const invBefore = e.inventory();
    let st: LiveGenerationState = liveStateFromRows(
      [{ time: T0, open: 100, high: 101, low: 99, close: 100.5, volume: 12 }], "us", 60,
    );
    for (let i = 0; i < 100; i++) {
      const r = reduceLiveTick(st, quote(i, 100 + (i % 7) * 0.1), Date.UTC(2026, 7, 7, 13, 30, 60 + i), "us", 60);
      st = r.state;
      applyLiveOp(series, r.op);
    }
    const invAfter = e.inventory();
    expect(invAfter).toEqual(invBefore);                                  // panes/series/priceLines identical
    expect(chart.addSeries.mock.calls.length).toBe(baselineAddSeries);     // no new series
    expect(createPriceLineSpy.mock.calls.length).toBe(baselineCreatePriceLine);
    expect(setDataSpy.mock.calls.length).toBe(baselineSetData);            // in-place only, no setData
    expect(updateSpy.mock.calls.length).toBe(100);                         // one update per op
  });

  it("100 in-place ops on the canvas engine (impl 'mm') leave inventory() identical and never call setData/createPriceLine", () => {
    // jsdom + fake 2D context precedent: chartEngineCanvasC02.test.ts.
    const ctxByCanvas = new WeakMap<HTMLCanvasElement, { __calls: string[] }>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string) {
      if (type !== "2d") return null;
      let ctx = ctxByCanvas.get(this);
      if (!ctx) { ctx = { __calls: [] }; ctxByCanvas.set(this, ctx); }
      const rec = (m: string) => () => { ctx!.__calls.push(m); };
      return new Proxy({}, { get: (_t, p) => rec(String(p)) }) as unknown as CanvasRenderingContext2D;
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const scheduler = createManualScheduler();
    const e = createCanvasEngine(container, { width: 200, height: 100, devicePixelRatio: 1, scheduler });
    const series = e.addSeries("candles") as SeriesHandle;
    const setDataSpy = vi.spyOn(series, "setData");
    const createPriceLineSpy = vi.spyOn(series, "createPriceLine");
    series.setData([{ time: T0, open: 100, high: 101, low: 99, close: 100.5 }]);
    const invBefore = e.inventory();
    let st: LiveGenerationState = liveStateFromRows(
      [{ time: T0, open: 100, high: 101, low: 99, close: 100.5, volume: 12 }], "us", 60,
    );
    for (let i = 0; i < 100; i++) {
      const r = reduceLiveTick(st, quote(i, 100 + (i % 7) * 0.1), Date.UTC(2026, 7, 7, 13, 30, 60 + i), "us", 60);
      st = r.state;
      applyLiveOp(series, r.op);
    }
    const invAfter = e.inventory();
    expect(invAfter).toEqual(invBefore);
    expect(setDataSpy.mock.calls.length).toBe(1);   // only the initial seed
    expect(createPriceLineSpy.mock.calls.length).toBe(0);
    e.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L01-A04 — Data-fed options overlay never hits the network and is a pure
//            function of its inputs (no render-clock false freshness).
// ─────────────────────────────────────────────────────────────────────────────
describe("L01-A04: Data-fed Options overlay -> No new fetch/model and no false freshness from render clock", () => {
  const gex = {
    schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-07-31",
    spot_ref: 135.7, net_gex_bn: -1.24, gamma_flip: 130.0,
    call_wall: 150.0, put_wall: 120.0,
    by_strike: [
      { strike: 120, gamma_net: -40, gamma_call: 5, gamma_put: -45 },
      { strike: 135, gamma_net: 10, gamma_call: 60, gamma_put: -50 },
      { strike: 150, gamma_net: 30, gamma_call: 35, gamma_put: -5 },
    ],
  };
  const moves = {
    schema: "options_hub.moves/v1", root: "NVDA", asof: "2026-07-31",
    expected_move: { band_mult: 1.96, horizon_days: 1.0, pct: 3.62, lo: 130.8, hi: 140.6 },
  };

  it("deriveOptLevels never invokes fetch (no implicit network/model layer) and the same payload produces identical output under different render clocks", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("no fetch in deriveOptLevels"); });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const r1 = deriveOptLevels(gex, moves, "NVDA");
      vi.setSystemTime(new Date("2030-06-15T00:00:00Z"));
      const r2 = deriveOptLevels(gex, moves, "NVDA");
      expect(fetchSpy).not.toHaveBeenCalled();
      // The freshness/asof fields come from the payload's asof, not the render clock.
      expect(r1.asofDate).toBe(r2.asofDate);
      expect(r1.newestDate).toBe(r2.newestDate);
      expect(r1.levels).toEqual(r2.levels);
      expect(r1.signed).toBe(r2.signed);
      expect(r1.spot).toBe(r2.spot);
      expect(r1.netGexBn).toBe(r2.netGexBn);
    } finally {
      vi.useRealTimers();
      fetchSpy.mockRestore();
    }
  });

  it("sessionsOldEt is a pure function of its two arguments (no wall-clock leak)", () => {
    const a = sessionsOldEt("2026-07-31", "2026-08-03");
    const b = sessionsOldEt("2026-07-31", "2026-08-03");
    expect(a).toBe(b);
    expect(a).toBe(1);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-06-15T00:00:00Z"));
      const c = sessionsOldEt("2026-07-31", "2026-08-03");
      expect(c).toBe(a);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L02-A01 — Scrub before future bars/signals keeps knowability on every
//            downstream layer (study over visible rows = study over knowable
//            prefix; nothing past the cursor; no synthetic future row).
// ─────────────────────────────────────────────────────────────────────────────
describe("L02-A01: Scrub before future bars/signals -> No downstream layer exposes inadmissible future values", () => {
  const ROWS: ReplayRow[] = [rowAt(0, 10), rowAt(1, 11), rowAt(2, 12), rowAt(3, 13), rowAt(4, 14), rowAt(5, 15), rowAt(6, 16)];
  const sma5 = (vals: number[]): (number | null)[] => vals.map((_, i) => i < 4 ? null : vals.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5);
  function knownPrefixSma(full: ReplayRow[], cursorMs: number): (number | null)[] {
    const knowable = full.filter((r) => closeMs(r) <= cursorMs);
    return sma5(knowable.map((r) => r.close));
  }

  it("every visible row has closeTime <= cursor and synthetic future rows never enter the view; SMA-5 over visible rows equals SMA-5 over knowable prefix of full rows; no value past the cursor", () => {
    const created = createReplayState(ROWS);
    const cursor = T0 + 3 * STEP + 150;  // inside bar 3's life
    const entered = enterReplay(created, cursor, { paneSyncActive: false });
    expect(entered.ok).toBe(true);
    if (!entered.ok) return;
    const visible = entered.state.visibleRows;
    const cursorMs = cursor * 1000;
    // Every visible row's closeTime is at or before the cursor (in ms).
    for (const r of visible) expect(closeMs(r)).toBeLessThanOrEqual(cursorMs);
    // SMA-5 over visible closes equals SMA-5 over the knowable prefix of the full set.
    const visibleSma = sma5(visible.map((r) => r.close));
    const knownSma = knownPrefixSma(ROWS, cursorMs);
    expect(visibleSma).toEqual(knownSma);
    // No value past the cursor in any computed series.
    const lastKnownClose = visible[visible.length - 1].close;
    expect(lastKnownClose).toBeLessThanOrEqual(ROWS.filter((r) => closeMs(r) <= cursorMs).slice(-1)[0].close);
    // Synthetic future rows never enter the visible view.
    const synth: ReplayRow[] = [...ROWS, { ...rowAt(20, 999), synthetic: true }];
    const synthState = createReplayState(synth);
    expect(synthState.rows.find((r) => r.synthetic === true)).toBeUndefined();
    const synthEntered = enterReplay(synthState, cursor, { paneSyncActive: false });
    expect(synthEntered.ok).toBe(true);
    if (!synthEntered.ok) return;
    expect(synthEntered.state.visibleRows.some((r) => r.synthetic === true)).toBe(false);
  });

  it("showPartial: the developing bar's high/low/close are pinned to its open, never to an unknowable value", () => {
    const created = createReplayState(ROWS);
    const cursor = T0 + 3 * STEP + 150;  // inside bar 3's life — bar 3 has opened, not closed
    const entered = enterReplay(created, cursor, { paneSyncActive: false, showPartial: true });
    expect(entered.ok).toBe(true);
    if (!entered.ok) return;
    const partial = entered.state.visibleRows[entered.state.visibleRows.length - 1];
    expect(partial.complete).toBe(false);
    expect(partial.high).toBe(partial.open);
    expect(partial.low).toBe(partial.open);
    expect(partial.close).toBe(partial.open);
  });

  it("the same knowability law holds after stepForward / stepBack / seek", () => {
    let s: ReplayState = (() => {
      const r = enterReplay(createReplayState(ROWS), T0 + STEP, { paneSyncActive: false });
      if (!r.ok) throw new Error("enter failed");
      return r.state;
    })();
    for (let n = 0; n < 5; n++) {
      const vis = s.visibleRows;
      for (const r of vis) {
        expect(closeMs(r)).toBeLessThanOrEqual((s.cursorMs ?? 0));
      }
      // SMA-5 agreement each step.
      const knownSma = knownPrefixSma(ROWS, s.cursorMs ?? 0);
      const visSma = sma5(vis.map((x) => x.close));
      expect(visSma).toEqual(knownSma);
      // Move one step (alternating forward / back) and one seek, then re-assert.
      s = (n % 2 === 0) ? stepForward(s) : stepBack(s);
      s = seek(s, T0 + (n + 1) * STEP);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L02-A02 — Replay->live after intervening updates returns the LATEST
//            accepted live generation, never a replay-row mix, with no
//            duplicate subscriptions (one update per bar key).
// ─────────────────────────────────────────────────────────────────────────────
describe("L02-A02: Replay->live after intervening updates -> Latest accepted live generation returns without source mixing or duplicate subscriptions", () => {
  const ROWS: ReplayRow[] = [rowAt(0, 10), rowAt(1, 11), rowAt(2, 12), rowAt(3, 13), rowAt(4, 14), rowAt(5, 15)];
  const T = (i: number) => T0 + i * STEP;

  it("flush has exactly one entry per queued bar key carrying the LATEST accepted live generation's row; applying to a series calls update() once per key and never setData/addSeries (no duplicate subscriptions)", () => {
    const created = createReplayState(ROWS);
    const entered = enterReplay(created, T(1), { paneSyncActive: false });
    expect(entered.ok).toBe(true);
    if (!entered.ok) return;
    let s: ReplayState = entered.state;
    // Intervening updates: two for bar 3 (gen 10 first, gen 12 wins), one for bar 5 (gen 11), one append at gen 13.
    s = applyLiveCommit(s, { generation: 10, op: "update", row: { ...rowAt(3, 99), close: 99 } });
    s = applyLiveCommit(s, { generation: 12, op: "update", row: { ...rowAt(3, 88), close: 88 } });
    s = applyLiveCommit(s, { generation: 11, op: "update", row: { ...rowAt(5, 77), close: 77 } });
    s = applyLiveCommit(s, { generation: 13, op: "append", row: rowAt(6, 55) });
    const out = exitReplay(s);
    expect(out.apply).toBe("generation");
    expect(out.flush).toHaveLength(3);
    const keys = out.flush.map((c) => c.row.time);
    expect(new Set(keys).size).toBe(3);   // one entry per bar key
    // The LATEST row for bar 3 must win (gen 12's close=88, not gen 10's close=99).
    const bar3 = out.flush.find((c) => c.row.time === T(3));
    expect(bar3?.row.close).toBe(88);
    // The folded base row also carries the latest value.
    expect(out.rows.find((r) => r.time === T(3))?.close).toBe(88);
    // Every flush entry carries the single exit generation (one live commit boundary).
    expect(new Set(out.flush.map((c) => c.generation))).toEqual(new Set([out.state.generation]));
    // No replay-projection row is mixed in: every flush row came from the queue, not from
    // entered.state.visibleRows (the truncated knowability view).
    const projectedTimes = entered.state.visibleRows.map((r) => r.time);
    for (const c of out.flush) expect(projectedTimes).not.toContain(c.row.time);
    // Applying the flush through the PRODUCTION applier (applyLiveOp) rather than a loop the
    // test writes itself: one update() per bar key, zero setData/createPriceLine, so the flush
    // cannot rebuild the series or stack a duplicate subscription. LiveCommit and LiveOp are
    // structural twins (op/row <-> kind/bar); the mapping below is the caller's own boundary.
    const series = spyHandle("candles");
    const updateSpy = vi.spyOn(series, "update");
    const setDataSpy = vi.spyOn(series, "setData");
    const createPriceLineSpy = vi.spyOn(series, "createPriceLine");
    let mutations = 0;
    for (const c of out.flush) {
      const bar: LiveBar = {
        time: c.row.time, open: c.row.open, high: c.row.high, low: c.row.low,
        close: c.row.close, volume: c.row.volume ?? 0,
      };
      const op = c.op === "append"
        ? { kind: "append" as const, bar, closedPrev: null }
        : { kind: "inplace" as const, bar };
      mutations += applyLiveOp(series, op).mutations;
    }
    expect(updateSpy).toHaveBeenCalledTimes(out.flush.length);
    expect(mutations).toBe(out.flush.length);
    expect(setDataSpy).not.toHaveBeenCalled();
    expect(createPriceLineSpy).not.toHaveBeenCalled();
    // Base rows outside the queued keys are unchanged.
    const queuedTimes = new Set([T(3), T(5), T(6)]);
    const baseOutside = out.rows.filter((r) => !queuedTimes.has(r.time as number));
    for (const r of baseOutside) {
      const orig = ROWS.find((o) => o.time === r.time);
      expect(r.close).toBe(orig?.close);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L02-A04 — Missing captured knowledge-time metadata: view states
//            reconstructed/unavailable as appropriate; no PIT certification.
// ─────────────────────────────────────────────────────────────────────────────
describe("L02-A04: Missing captured knowledge-time metadata -> View states reconstructed/unavailable as appropriate; no PIT certification", () => {
  it("rows whose closeTime is missing/NaN are dropped by createReplayState and never appear as complete visible rows", () => {
    const good = [rowAt(0, 10), rowAt(1, 11), rowAt(2, 12)];
    const bad: ReplayRow[] = [
      { time: T0 + 3 * STEP, closeTime: NaN as unknown as number, open: 1, high: 2, low: 0, close: 1, complete: true },
      { time: T0 + 4 * STEP, closeTime: "not-a-time" as unknown as number, open: 1, high: 2, low: 0, close: 1, complete: true },
    ];
    const state = createReplayState([...good, ...bad]);
    expect(state.rows).toHaveLength(3);   // the two with non-finite closeTime are dropped
    const entered = enterReplay(state, T0 + STEP, { paneSyncActive: false });
    expect(entered.ok).toBe(true);
    if (!entered.ok) return;
    for (const r of entered.state.visibleRows) expect(Number.isFinite(closeMs(r))).toBe(true);
  });

  it("all-missing -> enterReplay refuses with the typed 'no_rows' code and mode/generation are unchanged", () => {
    const empty = createReplayState([]);
    const before = { mode: empty.mode, generation: empty.generation };
    const res = enterReplay(empty, T0, { paneSyncActive: false });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.code).toBe("no_rows");
    expect(res.state.mode).toBe(before.mode);
    expect(res.state.generation).toBe(before.generation);
  });
  // CAPABILITY_MISSING — the half of this row that is NOT observable at HEAD: ReplayState
  // carries no "reconstructed" view-state label and no PIT-certification flag, and
  // ReplayRefusalCode is only pane_sync_active | no_rows | cursor_before_first. Only the
  // UNAVAILABLE half of the row can therefore be proved. This test pins the gap so the
  // acceptance record cannot silently claim the reconstructed half, and it goes red the
  // moment such a label is added — at which point the row must be re-proved against it.
  it("CAPABILITY_MISSING: ReplayState exposes no reconstructed / PIT-certification label, so only the unavailable half of this row is observable", () => {
    const state = createReplayState([rowAt(0, 10)]);
    expect(Object.keys(state).sort()).toEqual([
      "atLiveEdge", "cursorMs", "generation", "mode", "queue", "refusal",
      "rows", "showPartial", "visibleRows",
    ]);
    expect("reconstructed" in state).toBe(false);
    expect("pitCertified" in state).toBe(false);
    const codes: ReplayRefusalCode[] = ["pane_sync_active", "no_rows", "cursor_before_first"];
    expect(codes.some((c) => /reconstruct|pit|certif/i.test(c))).toBe(false);
  });
});
