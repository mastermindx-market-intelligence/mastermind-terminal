// @vitest-environment jsdom
// PERF-B T1(a,b,c) frame-level N-independence + T3 ticks equivalence.
//
// A full paint (and the paint that follows a live tick / an append) must not
// visit rows proportionally to the corpus: a counting Proxy wraps the series'
// rows array after setData, and the visit counts for N=10,000 and N=40,000
// (same visible window, same markers in view) must be EQUAL.
//
// T3 pins timeTicks' output (ticks, labels, order) against a verbatim copy of
// the pre-PERF-B implementation over 200 seeded random windows, and pins the
// Intl.DateTimeFormat constructor to a bounded count across 1000 paints.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import { ChartModel } from "@/lib/chart-engine/canvas/model";
import { timeTicks, TIME_TICK_WEIGHT, type TimeTick } from "@/lib/chart-engine/canvas/ticks";
import type { TimeScaleState } from "@/lib/chart-engine/canvas/scales";
import { timeToMs } from "@/lib/timeWindow";
import { barSpacingOf, xOfLogical } from "@/lib/chart-engine/canvas/scales";
import type { EngineSeriesRow, EngineTime } from "@/lib/chart-engine/api";

// ── jsdom canvas fake (house pattern: chartEngineCanvasPaint.test.ts) ─────────

type CtxCall = { method: string; args: unknown[] };
function makeFakeCtx(): CanvasRenderingContext2D {
  const calls: CtxCall[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const props: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {
    setTransform: rec("setTransform"), fillRect: rec("fillRect"), clearRect: rec("clearRect"),
    drawImage: rec("drawImage"), beginPath: rec("beginPath"), moveTo: rec("moveTo"),
    lineTo: rec("lineTo"), stroke: rec("stroke"), fill: rec("fill"), save: rec("save"),
    restore: rec("restore"), scale: rec("scale"), translate: rec("translate"), rect: rec("rect"),
    arc: rec("arc"), clip: rec("clip"), closePath: rec("closePath"), fillText: rec("fillText"),
    strokeRect: rec("strokeRect"), setLineDash: rec("setLineDash"),
    measureText: (text: string) => ({ width: String(text).length * 7 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "globalAlpha"]) {
    Object.defineProperty(ctx, p, {
      get: () => props[p],
      set: (v: unknown) => { calls.push({ method: `set:${p}`, args: [v] }); props[p] = v; },
      enumerable: true, configurable: true,
    });
  }
  return ctx as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string) {
    return type === "2d" ? makeFakeCtx() : null;
  });
});
afterEach(() => { vi.restoreAllMocks(); });

// ── corpus ────────────────────────────────────────────────────────────────────

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

function dailyCandles(n: number): EngineSeriesRow[] {
  const rand = mulberry32(42);
  let close = 100;
  const out: EngineSeriesRow[] = [];
  let ms = Date.UTC(2020, 0, 2);
  for (let i = 0; i < n; i++) {
    do { ms += 86_400_000; } while (new Date(ms).getUTCDay() === 0 || new Date(ms).getUTCDay() === 6);
    close += (rand() - 0.5) * 4;
    out.push({ time: ms / 1000, open: close - 0.5, high: close + 1, low: close - 1, close });
  }
  return out;
}

type CountingProxy = { proxy: EngineSeriesRow[]; target: EngineSeriesRow[]; visits: () => number };

/** Wrap rows in an index-get counting Proxy (a row visit = one rows[i] read). */
function countingRows(rows: EngineSeriesRow[]): CountingProxy {
  let visits = 0;
  const target = rows.slice();
  const proxy = new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) visits += 1;
      return Reflect.get(t, key, receiver);
    },
  });
  return { proxy, target, visits: () => visits };
}

function mountEngine(n: number): {
  engine: ReturnType<typeof createCanvasEngine>;
  model: ChartModel;
  scheduler: ReturnType<typeof createManualScheduler>;
} {
  const scheduler = createManualScheduler();
  const engine = createCanvasEngine(document.createElement("div"), {
    width: 900, height: 400, scheduler, devicePixelRatio: 1,
    // grid.vertLines ON so paintGrid's time-ticks path (the pre-PERF-B
    // full-rows .map) actually runs in every paint.
    grid: { vertLines: { visible: true, color: "g" }, horzLines: { visible: true, color: "g" } },
  });
  const model = engine.unwrap<ChartModel>();
  const candles = engine.addSeries("candles", { upColor: "u", downColor: "d" });
  candles.setData(dailyCandles(n));
  engine.addSeries("line", { color: "m", lineWidth: 1 }).setData(
    dailyCandles(n).map((r) => ({ time: r.time, value: (r as { close: number }).close * 0.98 })),
  );
  engine.timeScale().setVisibleLogicalRange({ from: n - 1000, to: n });
  // markers on visible bars (sorted by time, LWC §3.7)
  const rows = model.primarySeries()!.rows;
  candles.setMarkers(Array.from({ length: 12 }, (_, k) => {
    const t = rows[n - 995 + k * 80].time;
    return { time: t, position: "aboveBar", shape: "arrowUp", color: "m", text: `v${k}` };
  }));
  scheduler.flush();
  return { engine, model, scheduler };
}

describe("PERF-B T1(a,b,c) paint row visits are N-independent", () => {
  const scenarios = [
    { name: "one full paint", mutate: null as null },
    { name: "one live in-place update + its paint", mutate: "inplace" as const },
    { name: "one append + its paint", mutate: "append" as const },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.name}: row visits EQUAL for N=10,000 vs N=40,000`, () => {
      const runAt = (n: number): number => {
        const { engine, model, scheduler } = mountEngine(n);
        const s = model.primarySeries()!;
        const wrap = countingRows(s.rows);
        s.rows = wrap.proxy;
        // Something must trigger a fresh paint in a NEW generation so the
        // marker-layout memo and extents cache paths run for real.
        if (scenario.mutate === "inplace") {
          const last = wrap.target[wrap.target.length - 1] as { time: number; open: number; high: number; low: number; close: number };
          s.rows = wrap.target;
          engine.addSeries("line").setData([{ time: last.time, value: 1 }]); // harmless structure bump
          s.rows = wrap.proxy;
          model.updateSeriesRow(s.id, { ...last, close: last.close + 0.2 });
        } else if (scenario.mutate === "append") {
          const last = wrap.target[wrap.target.length - 1] as { time: number; close: number };
          s.rows = wrap.target;
          model.updateSeriesRow(s.id, { time: last.time + 86_400, open: last.close, high: last.close + 1, low: last.close - 1, close: last.close + 0.5 });
          s.rows = wrap.proxy;
        } else {
          s.rows = wrap.target;
          model.setWatermark(0, { lines: [{ text: "w", color: "m" }] }); // full repaint, same data
          s.rows = wrap.proxy;
        }
        const before = wrap.visits();
        scheduler.flush();
        const visited = wrap.visits() - before;
        s.rows = wrap.target; // restore before teardown
        engine.destroy();
        return visited;
      };
      const small = runAt(10_000);
      const large = runAt(40_000);
      expect(large).toBe(small);
      expect(small).toBeGreaterThan(0); // the paint really read rows (visible slice)
    });
  }
});

// ── T3: ticks equivalence + formatter cache ───────────────────────────────────

// Oracle: the PRE-PERF-B ticks.ts core, copied verbatim from BASE_SHA.
function oracleTimeTicks(rows: readonly EngineTime[], state: TimeScaleState, options: { minGapPx: number; hourFormat: "12" | "24"; locale?: string }): TimeTick[] {
  const MAX_DAY = 120;
  const pad2 = (x: number): string => String(x).padStart(2, "0");
  const dateOf = (time: EngineTime): Date | null => {
    const ms = timeToMs(time);
    return Number.isFinite(ms) ? new Date(ms) : null;
  };
  const weightAgainst = (curr: Date, prev: Date): number => {
    if (curr.getUTCFullYear() !== prev.getUTCFullYear()) return 5;
    if (curr.getUTCMonth() !== prev.getUTCMonth()) return 4;
    if (curr.getUTCDate() !== prev.getUTCDate()) return 3;
    if (curr.getUTCHours() !== prev.getUTCHours()) return 2;
    if (curr.getUTCMinutes() !== prev.getUTCMinutes()) return 1;
    return 0;
  };
  const typicalStepMs = (index: number): number => {
    const curr = timeToMs(rows[index]);
    if (index + 1 < rows.length) {
      const next = timeToMs(rows[index + 1]);
      if (Number.isFinite(curr) && Number.isFinite(next) && next > curr) return next - curr;
    }
    if (index > 0) {
      const prev = timeToMs(rows[index - 1]);
      if (Number.isFinite(curr) && Number.isFinite(prev) && curr > prev) return curr - prev;
    }
    return 86_400_000;
  };
  const spanDaysOf = (from: number, to: number): number | null => {
    const start = Math.max(0, Math.min(rows.length - 1, Math.floor(from)));
    const end = Math.max(0, Math.min(rows.length - 1, Math.ceil(to)));
    const a = timeToMs(rows[start]);
    const b = timeToMs(rows[end]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.abs(b - a) / 86_400_000;
  };
  const formatTimeLabel = (time: EngineTime, weight: number, hourFormat: "12" | "24", visibleSpanDays: number | null, locale: string): string => {
    const date = dateOf(time);
    if (!date) return "";
    if (weight === 5) return String(date.getUTCFullYear());
    if (weight === 4) return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
    if (weight === 3) {
      if (visibleSpanDays != null && visibleSpanDays > MAX_DAY) {
        if (date.getUTCDate() <= 7) return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
        return "";
      }
      return String(date.getUTCDate());
    }
    const hour24 = date.getUTCHours();
    const minute = pad2(date.getUTCMinutes());
    if (hourFormat === "12") {
      const hour = hour24 % 12 || 12;
      return `${hour}:${minute} ${hour24 >= 12 ? "PM" : "AM"}`;
    }
    return `${pad2(hour24)}:${minute}`;
  };
  const placeByWeight = (candidates: TimeTick[], minGapPx: number): TimeTick[] => {
    const placed: TimeTick[] = [];
    const weights = [5, 4, 3, 2, 1];
    for (const weight of weights) {
      for (const tick of candidates) {
        if (tick.weight !== weight) continue;
        const collides = placed.some((p) => Math.abs(p.x - tick.x) < minGapPx);
        if (collides) continue;
        placed.push(tick);
      }
    }
    placed.sort((a, b) => a.x - b.x);
    return placed;
  };

  if (rows.length === 0 || !(state.widthPx > 0) || !(options.minGapPx > 0)) return [];
  const spacing = barSpacingOf(state);
  if (!(spacing > 0)) return [];
  const first = Math.max(0, Math.floor(state.visibleFrom) - 1);
  const last = Math.min(rows.length - 1, Math.ceil(state.visibleTo) + 1);
  if (last < first) return [];
  const spanDays = spanDaysOf(state.visibleFrom, state.visibleTo);
  const locale = options.locale ?? "en-US";
  const candidates: TimeTick[] = [];
  for (let i = first; i <= last; i += 1) {
    const date = dateOf(rows[i]);
    if (!date) continue;
    let weight = 0;
    if (i > 0) {
      const prev = dateOf(rows[i - 1]);
      if (prev) weight = weightAgainst(date, prev);
    } else {
      const approxPrev = new Date(date.getTime() - typicalStepMs(i));
      weight = weightAgainst(date, approxPrev);
    }
    if (weight === 0) continue;
    const x = xOfLogical(i, state);
    if (!Number.isFinite(x)) continue;
    if (x < -spacing || x > state.widthPx + spacing) continue;
    const label = formatTimeLabel(rows[i], weight, options.hourFormat, spanDays, locale);
    if (!label) continue;
    candidates.push({ index: i, x, label, weight });
  }
  return placeByWeight(candidates, options.minGapPx);
}

describe("PERF-B T3 timeTicks equivalence + cached formatters", () => {
  /** A fixture spanning months with intraday steps so hour/minute weights fire. */
  function intradayTimes(n: number): EngineTime[] {
    const out: EngineTime[] = [];
    let ms = Date.UTC(2024, 0, 1, 9, 30);
    for (let i = 0; i < n; i++) {
      out.push(ms / 1000);
      ms += 15 * 60_000;
      if (new Date(ms).getUTCHours() >= 16) {
        do { ms += 86_400_000; } while (new Date(ms).getUTCDay() === 0 || new Date(ms).getUTCDay() === 6);
        ms = Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate(), 9, 30);
      }
    }
    return out;
  }

  it("identical tick list + labels vs the old implementation over 200 seeded windows", () => {
    const rows = intradayTimes(6_000);
    const rand = mulberry32(99);
    for (let w = 0; w < 200; w++) {
      const widthPx = Math.floor(200 + rand() * 1200);
      const span = Math.floor(3 + rand() * 900);
      const from = Math.floor(rand() * (rows.length - span - 1));
      const state: TimeScaleState = {
        visibleFrom: from,
        visibleTo: from + span,
        barSpacing: widthPx / span,
        rightOffset: 0,
        widthPx,
      };
      const options = { minGapPx: Math.floor(30 + rand() * 60), hourFormat: (rand() < 0.5 ? "12" : "24") as "12" | "24" };
      const want = oracleTimeTicks(rows, state, options);
      const got = timeTicks(rows, state, options);
      expect(got).toEqual(want);
      // The accessor form (cached ms keys — what frame.ts passes) must agree too.
      const gotViaSource = timeTicks(
        { length: rows.length, timeAt: (i) => rows[i] as EngineTime, msAt: (i) => timeToMs(rows[i] as EngineTime) },
        state,
        options,
      );
      expect(gotViaSource).toEqual(want);
    }
  });

  it("Intl.DateTimeFormat is constructed at most a constant number of times across 1000 paints", () => {
    const rows = intradayTimes(6_000);
    const spy = vi.spyOn(Intl, "DateTimeFormat" as never) as unknown as { mock: { calls: unknown[] } };
    const state: TimeScaleState = {
      visibleFrom: 0, visibleTo: 900, barSpacing: 900 / 900, rightOffset: 0, widthPx: 900,
    };
    for (let k = 0; k < 1000; k++) {
      state.visibleFrom = (k * 7) % 5000;
      state.visibleTo = state.visibleFrom + 900;
      timeTicks(rows, state, { minGapPx: 48, hourFormat: "24" });
    }
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4); // one per locale seen, bounded
  });

  it("weights still rank year > month > day > hour > minute (oracle shares them)", () => {
    expect(TIME_TICK_WEIGHT.year).toBeGreaterThan(TIME_TICK_WEIGHT.month);
    expect(TIME_TICK_WEIGHT.month).toBeGreaterThan(TIME_TICK_WEIGHT.day);
    expect(TIME_TICK_WEIGHT.day).toBeGreaterThan(TIME_TICK_WEIGHT.hour);
    expect(TIME_TICK_WEIGHT.hour).toBeGreaterThan(TIME_TICK_WEIGHT.minute);
  });
});
