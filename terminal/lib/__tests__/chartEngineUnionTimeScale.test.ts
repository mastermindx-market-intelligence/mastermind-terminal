// @vitest-environment jsdom
// mm parity — one time scale shared by every series (LWC's merged time points).
// Each scenario runs the same script on lightweight-charts and on the mm canvas
// engine and compares what a caller can observe: the visible logical range, the
// x of every time, each series' own data and its rows by logical index. Before
// the union every mm series indexed its own rows, so a shorter study drew from
// the left edge and a whitespace tail moved nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "@/lib/chart-engine";
import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import { ChartModel } from "@/lib/chart-engine/canvas/model";
import type { ChartEngine, EngineSeriesRow, SeriesHandle } from "@/lib/chart-engine/api";

const DAY = 86400;
const T0 = 1767225600; // 2026-01-01T00:00:00Z
const t = (i: number) => T0 + i * DAY;

function bars(from: number, to: number, base = 100): EngineSeriesRow[] {
  const out: EngineSeriesRow[] = [];
  for (let i = from; i < to; i++) {
    const c = base + i;
    out.push({ time: t(i), open: c - 1, high: c + 2, low: c - 2, close: c });
  }
  return out;
}

function line(from: number, to: number, base = 50): EngineSeriesRow[] {
  const out: EngineSeriesRow[] = [];
  for (let i = from; i < to; i++) out.push({ time: t(i), value: base + i });
  return out;
}

function blank(from: number, to: number): EngineSeriesRow[] {
  const out: EngineSeriesRow[] = [];
  for (let i = from; i < to; i++) out.push({ time: t(i) });
  return out;
}

const r3 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 1000 + 0); // + 0: no -0

type Ctx = {
  impl: "lwc" | "mm";
  engine: ChartEngine;
  series: Record<string, SeriesHandle>;
  log: unknown[];
  /** Show logical bars [from, to) — mm's house window; LWC's range is right-inclusive. */
  view(from: number, to: number): void;
  /** Run queued animation frames: LWC applies a set range or fitContent on the next frame. */
  frame(): void;
};

/** What a caller sees: the window, where each probed time sits, and each series' rows. */
function observe(ctx: Ctx, label: string, probe: readonly number[]): void {
  ctx.frame();
  const ts = ctx.engine.timeScale();
  const lr = ts.getVisibleLogicalRange();
  // House convention (modelTime.ts): mm's window is [from, to) and its x sits one pixel
  // right of LWC's (LWC indexToCoordinate subtracts 1). Map LWC onto it; any other
  // difference is a real divergence. LWC's plot also loses its measured price-axis width
  // (mm's does not here), so a time is compared by the logical slot its x lands on —
  // x / spacing + from - 0.5 — not by raw pixels.
  const dTo = ctx.impl === "lwc" ? 1 : 0;
  const dX = ctx.impl === "lwc" ? 1 : 0;
  const from = lr ? lr.from : 0;
  const spacing = lr ? ts.width() / (lr.to + dTo - lr.from) : 1;
  const per: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(ctx.series)) {
    const own = s.data();
    per[name] = {
      own: own.map((row) => Number(row.time)),
      byIndex: probe.map((i) => {
        const row = s.dataByIndex(i);
        return row ? Number(row.time) : null;
      }),
    };
  }
  ctx.log.push({
    label,
    range: lr ? { from: r3(lr.from), to: r3(lr.to + dTo) } : null,
    slot: probe.map((i) => {
      const x = ts.timeToCoordinate(t(i) as never);
      return x == null ? null : r3((x + dX) / spacing + from - 0.5);
    }),
    series: per,
  });
}

type Script = (ctx: Ctx) => void;

function makeFakeCtx(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {};
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo", "stroke",
    "fill", "save", "restore", "scale", "translate", "rect", "closePath", "fillText", "strokeRect",
    "arc", "arcTo", "ellipse", "roundRect", "quadraticCurveTo", "bezierCurveTo", "setLineDash", "clip",
    "resetTransform", "strokeText", "putImageData", "transform", "rotate",
  ]) ctx[m] = () => undefined;
  ctx.getLineDash = () => [];
  ctx.isPointInPath = () => false;
  ctx.createRadialGradient = () => ({ addColorStop: () => undefined });
  ctx.createPattern = () => null;
  ctx.measureText = (s: string) => ({ width: s.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  ctx.createLinearGradient = () => ({ addColorStop: () => undefined });
  return ctx as unknown as CanvasRenderingContext2D;
}

describe("mm union time scale (LWC merged time points)", () => {
  let container: HTMLDivElement;
  let frames: Array<FrameRequestCallback | null> = [];
  let clock = 0;

  /** Each round is a 100 ms frame, so LWC's 400 ms scroll animation lands in a few rounds. */
  function runFrames(): void {
    for (let guard = 0; frames.some(Boolean); guard++) {
      if (guard > 50) throw new Error("animation frames never settle");
      const due = frames;
      frames = [];
      clock = Math.max(clock, performance.now()) + 100;
      for (const cb of due) cb?.(clock);
    }
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
    frames = [];
    clock = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      if (id > 0 && id <= frames.length) frames[id - 1] = null;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (type: string) {
      return type === "2d" ? makeFakeCtx() : null;
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  function runOn(impl: "lwc" | "mm", script: Script): unknown[] {
    const engine = impl === "lwc"
      ? createEngine(container, { width: 600, height: 300 }, "lwc")
      : createCanvasEngine(container, { width: 600, height: 300, devicePixelRatio: 1, scheduler: createManualScheduler() });
    const ctx: Ctx = {
      impl,
      engine,
      series: {},
      log: [],
      view: (from, to) => {
        engine.timeScale().setVisibleLogicalRange({ from, to: impl === "lwc" ? to - 1 : to });
        runFrames();
      },
      frame: runFrames,
    };
    try {
      script(ctx);
    } finally {
      engine.destroy();
    }
    return ctx.log;
  }

  /** Run the script on both engines; mm must match LWC step for step. */
  function parity(script: Script): unknown[] {
    const lwc = runOn("lwc", script);
    const mm = runOn("mm", script);
    expect(mm).toEqual(lwc);
    return lwc;
  }

  it("a shorter study sits on its own times, not from the left edge", () => {
    const log = parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const ma = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, ma };
      candles.setData(bars(0, 20));
      ma.setData(line(5, 20));
      ctx.view(0, 20);
      observe(ctx, "aligned", [0, 4, 5, 12, 19]);
    });
    const ma = (log[0] as { series: Record<string, { byIndex: (number | null)[] }> }).series.ma;
    expect(ma.byIndex).toEqual([null, null, t(5), t(12), t(19)]);
  });

  it("a study set before the price series lands on the price series' slots", () => {
    parity((ctx) => {
      const ma = ctx.engine.addSeries("line", {}, 0);
      const candles = ctx.engine.addSeries("candles", {}, 0);
      ctx.series = { ma, candles };
      ma.setData(line(10, 30));
      candles.setData(bars(0, 30));
      ctx.view(0, 30);
      observe(ctx, "study-first", [0, 9, 10, 29]);
    });
  });

  it("a future whitespace tail adds time points but keeps the base and the view", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const future = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, future };
      candles.setData(bars(0, 20));
      ctx.view(4, 20);
      observe(ctx, "before", [0, 19, 20, 24]);
      future.setData(blank(20, 25));
      observe(ctx, "tail", [0, 19, 20, 24]);
      ctx.engine.timeScale().fitContent();
      observe(ctx, "fit", [0, 19, 20, 24]);
    });
  });

  it("a live bar on a whitespace slot keeps the view; a bar past the end shifts it", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const future = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, future };
      candles.setData(bars(0, 20));
      future.setData(blank(20, 23));
      ctx.view(4, 20);
      observe(ctx, "start", [18, 19, 20, 22, 23]);
      candles.update(bars(20, 21)[0]);
      observe(ctx, "onto-whitespace", [18, 19, 20, 22, 23]);
      candles.update({ ...bars(20, 21)[0], close: 130 });
      observe(ctx, "tick", [18, 19, 20, 22, 23]);
      candles.update(bars(23, 24)[0]);
      observe(ctx, "past-end", [18, 19, 20, 22, 23]);
    });
  });

  it("a new bar shifts the view only while the last bar is on screen", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const ma = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, ma };
      candles.setData(bars(0, 40));
      ma.setData(line(10, 40));
      ctx.view(5, 25);
      observe(ctx, "scrolled-back", [5, 24, 39]);
      candles.update(bars(40, 41)[0]);
      ma.update(line(40, 41)[0]);
      observe(ctx, "appended-offscreen", [5, 24, 39, 40]);
      // Not scrollToRealtime: LWC's animation skips its finishing frame (dev:11107-11110),
      // so where it stops depends on frame timing. The jump is what this case needs.
      ctx.engine.timeScale().scrollToPosition(0, false);
      observe(ctx, "realtime", [5, 24, 39, 40]);
      candles.update(bars(41, 42)[0]);
      observe(ctx, "appended-onscreen", [24, 39, 40, 41]);
    });
  });

  it("history prepended by one series re-seats every other series", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const ma = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, ma };
      candles.setData(bars(10, 30));
      ma.setData(line(15, 30));
      ctx.view(5, 20);
      observe(ctx, "before", [0, 5, 10, 19]);
      candles.setData(bars(0, 30));
      observe(ctx, "prepended", [0, 5, 10, 19, 29]);
    });
  });

  it("a study with times between the price bars inserts interior points", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const fine = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, fine };
      candles.setData(bars(0, 10).filter((_, i) => i % 2 === 0));
      ctx.view(0, 5);
      observe(ctx, "sparse", [0, 1, 2, 3, 4]);
      fine.setData(line(0, 10));
      observe(ctx, "merged", [0, 1, 2, 3, 4, 9]);
      fine.update({ time: t(10), value: 99 });
      observe(ctx, "fine-append", [0, 8, 9, 10]);
    });
  });

  it("removing a series drops the time points nobody else holds", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const future = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, future };
      candles.setData(bars(0, 20));
      future.setData([...line(15, 20), ...blank(20, 26)]);
      ctx.view(2, 22);
      observe(ctx, "with-tail", [0, 19, 20, 25]);
      ctx.engine.removeSeries(future);
      ctx.series = { candles };
      observe(ctx, "removed", [0, 19, 20, 25]);
    });
  });

  it("history prepended while the last bar is off screen keeps the same times in view", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const ma = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, ma };
      candles.setData(bars(10, 40));
      ctx.view(5, 15);
      observe(ctx, "scrolled-back", [0, 5, 14, 29]);
      ma.setData(line(0, 20));
      observe(ctx, "prepended", [0, 5, 14, 15, 24, 39]);
    });
  });

  it("fitContent keeps the right offset past the last value, not past the whitespace", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const future = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, future };
      ctx.engine.applyOptions({ timeScale: { rightOffset: 5 } });
      candles.setData(bars(0, 20));
      future.setData(blank(20, 23));
      ctx.engine.timeScale().fitContent();
      observe(ctx, "fit", [0, 19, 20, 22]);
    });
  });

  it("a row written onto another series' slot keeps the slot after that series goes", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const future = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, future };
      candles.setData(bars(0, 20));
      future.setData(blank(20, 26));
      ctx.view(4, 24);
      candles.update(bars(20, 21)[0]);
      observe(ctx, "filled", [19, 20, 21, 25]);
      ctx.engine.removeSeries(future);
      ctx.series = { candles };
      observe(ctx, "other-removed", [19, 20, 21, 25]);
    });
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const ma = ctx.engine.addSeries("line", {}, 0);
      ctx.series = { candles, ma };
      candles.setData(bars(0, 20));
      ma.setData(line(0, 10));
      ctx.view(0, 20);
      ma.update(line(15, 16)[0], true);
      observe(ctx, "historical-fill", [9, 10, 15, 19]);
      ctx.engine.removeSeries(candles);
      ctx.series = { ma };
      observe(ctx, "other-removed", [9, 10, 11]);
    });
  });

  it("a historical write past a series' own last becomes its last row", () => {
    const outcomes = (impl: "lwc" | "mm") => {
      const out: { log: unknown[]; errors: string[]; data: number[][] } = { log: [], errors: [], data: [] };
      runOn(impl, (ctx) => {
        const candles = ctx.engine.addSeries("candles", {}, 0);
        const ma = ctx.engine.addSeries("line", {}, 0);
        ctx.series = { candles, ma };
        candles.setData([...bars(0, 6), ...blank(6, 10)]);
        ma.setData(line(0, 6));
        ma.update({ time: t(8), value: 1 }, true);
        ctx.engine.timeScale().fitContent();
        observe(ctx, "historical-append", [5, 7, 8, 9]);
        for (const fn of [() => ma.update({ time: t(7), value: 2 }), () => ma.update({ time: t(8), value: 3 })]) {
          try {
            fn();
            out.errors.push("ok");
          } catch (e) {
            out.errors.push((e as Error).message.replace(/time=[^,]*/g, "time=T"));
          }
        }
        out.log = ctx.log;
        out.data = ma.data().map((row) => [Number(row.time), (row as { value: number }).value]);
      });
      return out;
    };
    const lwc = outcomes("lwc");
    const mm = outcomes("mm");
    // The base moves to the written row on both: the range and every slot agree.
    expect(mm.log).toEqual(lwc.log);
    // Not mirrored: LWC's oldest-data check reads _seriesLastTimePoint, which a historical
    // write never advances (dev:11691-11704), so t(7) passes and _updateLastSeriesRow
    // writes it over the t(8) row (dev:11673-11689). mm treats the written row as the last.
    expect(lwc.errors).toEqual(["ok", "ok"]);
    expect(mm.errors).toEqual(["Cannot update oldest data, last time=T, new time=T", "ok"]);
    const head = line(0, 6).map((row) => [Number(row.time), (row as { value: number }).value]);
    expect(lwc.data).toEqual([...head, [t(7), 2], [t(8), 3]]);
    expect(mm.data).toEqual([...head, [t(8), 3]]);
  });

  it("history a study prepends re-seats the price series' last bar", () => {
    const outcomes = (impl: "lwc" | "mm") => {
      const out: unknown[] = [];
      runOn(impl, (ctx) => {
        const candles = ctx.engine.addSeries("candles", {}, 0);
        const ma = ctx.engine.addSeries("line", {}, 0);
        ctx.series = { candles, ma };
        candles.setData(bars(10, 30));
        ma.setData(line(0, 15));
        ctx.engine.timeScale().fitContent();
        observe(ctx, "prepended", [0, 10, 19, 29]);
        for (const fn of [
          () => candles.update(bars(25, 26)[0]),
          () => candles.update({ ...bars(29, 30)[0], close: 1 }),
          () => candles.update(bars(30, 31)[0]),
        ]) {
          try {
            fn();
            out.push("ok");
          } catch (e) {
            out.push((e as Error).message.replace(/time=[^,]*/g, "time=T"));
          }
        }
        observe(ctx, "after-ticks", [19, 29, 30]);
        out.push(ctx.log);
      });
      return out;
    };
    const mm = outcomes("mm");
    expect(mm).toEqual(outcomes("lwc"));
    expect(mm.slice(0, 3)).toEqual(["Cannot update oldest data, last time=T, new time=T", "ok", "ok"]);
  });

  it("a series in another pane shares the same time scale", () => {
    parity((ctx) => {
      const candles = ctx.engine.addSeries("candles", {}, 0);
      const osc = ctx.engine.addSeries("histogram", {}, 1);
      ctx.series = { candles, osc };
      candles.setData(bars(0, 25));
      osc.setData(line(12, 25, 0));
      ctx.view(0, 25);
      observe(ctx, "two-panes", [0, 11, 12, 24]);
    });
  });

  it("update() refuses an older time; a historical update needs only a merged time point", () => {
    const outcomes = (impl: "lwc" | "mm") => {
      const out: unknown[] = [];
      runOn(impl, (ctx) => {
        const candles = ctx.engine.addSeries("candles", {}, 0);
        const ma = ctx.engine.addSeries("line", {}, 0);
        candles.setData(bars(0, 10));
        ma.setData(line(5, 8));
        for (const fn of [
          () => ma.update(line(6, 7)[0]),
          // t(9) is the candles' slot: LWC takes it although ma has no row there.
          () => ma.update(line(9, 10)[0], true),
          // t(12) is on no series: refused.
          () => ma.update(line(12, 13)[0], true),
        ]) {
          try {
            fn();
            out.push("ok");
          } catch (e) {
            // LWC prints its internal time objects; compare the reason, not the times.
            out.push((e as Error).message.replace(/time=[^,]*/g, "time=T"));
          }
        }
        out.push(ma.data().map((row) => Number(row.time)));
      });
      return out;
    };
    const mm = outcomes("mm");
    expect(mm).toEqual(outcomes("lwc"));
    expect(mm.slice(0, 3)).toEqual([
      "Cannot update oldest data, last time=T, new time=T",
      "ok",
      "Cannot update non-existing data point when historicalUpdate is true",
    ]);
    expect(mm[3]).toEqual([t(5), t(6), t(7), t(9)]);
  });

  it("a historical update before a study's first row seats it at its own time (LWC overwrites the next row)", () => {
    // LWC _updateHistoricalSeriesRow writes the row at the lower-bound position of the
    // series' own rows (dev:11691-11704), so t(2) replaces ma's t(5) row. mm keeps t(5).
    const own = (impl: "lwc" | "mm") => {
      let times: number[] = [];
      runOn(impl, (ctx) => {
        const candles = ctx.engine.addSeries("candles", {}, 0);
        const ma = ctx.engine.addSeries("line", {}, 0);
        candles.setData(bars(0, 10));
        ma.setData(line(5, 8));
        ma.update(line(2, 3)[0], true);
        times = ma.data().map((row) => Number(row.time));
      });
      return times;
    };
    expect(own("lwc")).toEqual([t(2), t(6), t(7)]);
    expect(own("mm")).toEqual([t(2), t(5), t(6), t(7)]);
  });

  describe("repaint scope after a union change", () => {
    type Pending = { level: string; timeScale: boolean } | null;
    /** The mask the engine queued for the next frame (manual scheduler: nothing flushes on its own). */
    function setup() {
      const scheduler = createManualScheduler();
      const engine = createCanvasEngine(container, { width: 600, height: 300, devicePixelRatio: 1, scheduler });
      const pending = () => (engine as unknown as { invalidator: { pending(): Pending } }).invalidator.pending();
      return { engine, scheduler, pending };
    }

    it("an append that opens an interior slot repaints everything", () => {
      const { engine, scheduler, pending } = setup();
      try {
        const candles = engine.addSeries("candles", {}, 0);
        const ma = engine.addSeries("line", {}, 0);
        candles.setData([...bars(0, 10), ...bars(15, 20)]);
        ma.setData(line(0, 10));
        scheduler.flush();
        // ma's own append (one more row, a later last time) moves every later candle slot.
        ma.update(line(12, 13)[0]);
        expect(pending()?.level).toBe("full");
      } finally {
        engine.destroy();
      }
    });

    it("a study tick past the end is a light repaint: the other series' pads are not its rows", () => {
      const { engine, scheduler, pending } = setup();
      try {
        const candles = engine.addSeries("candles", {}, 0);
        const ma = engine.addSeries("line", {}, 0);
        candles.setData(bars(0, 20));
        ma.setData(line(0, 20));
        scheduler.flush();
        ma.update(line(20, 21)[0]);
        expect(pending()?.level).toBe("light");
      } finally {
        engine.destroy();
      }
    });

    it("a late-starting study's append measures the right edge from its last slot, not its row count", () => {
      const { engine, scheduler, pending } = setup();
      try {
        const candles = engine.addSeries("candles", {}, 0);
        const ma = engine.addSeries("line", {}, 0);
        candles.setData(bars(0, 20));
        ma.setData(line(5, 20));
        engine.timeScale().setVisibleLogicalRange({ from: 0, to: 16 });
        scheduler.flush();
        // Slot 19 (ma's last) is off screen, so nothing shifts; ma's 15 rows would say otherwise.
        ma.update(line(20, 21)[0]);
        expect(pending()).toMatchObject({ level: "light", timeScale: false });
      } finally {
        engine.destroy();
      }
    });
  });

  it("price<->coordinate is null for a series with no value at or after the left edge", () => {
    const answers = (impl: "lwc" | "mm") => {
      const out: (boolean | null)[] = [];
      runOn(impl, (ctx) => {
        const candles = ctx.engine.addSeries("candles", {}, 0);
        const ma = ctx.engine.addSeries("line", {}, 0);
        const empty = ctx.engine.addSeries("line", {}, 0);
        candles.setData(bars(0, 40));
        ma.setData(line(0, 10));
        const probe = () => [candles, ma, empty].map((s) => s.priceToCoordinate(120) != null);
        out.push(...probe());
        ctx.view(20, 40);
        out.push(...probe());
        ctx.view(9.5, 30);
        out.push(...probe());
      });
      return out;
    };
    const lwc = answers("lwc");
    expect(answers("mm")).toEqual(lwc);
    expect(lwc).toEqual([true, true, false, true, false, false, true, true, false]);
  });
});

describe("mm union bookkeeping (model)", () => {
  function model(width = 600) {
    const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
    m.applyOptions({ width, height: 300 });
    return m;
  }

  it("barCount stops at the last value; pointCount includes the whitespace tail", () => {
    const m = model();
    m.addSeries("candles").setData(bars(0, 20));
    m.addSeries("line").setData(blank(20, 26));
    expect(m.barCount()).toBe(20);
    expect(m.pointCount()).toBe(26);
  });

  it("the union epoch moves on a slot change, not on a tail append or a tick", () => {
    const m = model();
    const candles = m.addSeries("candles");
    candles.setData(bars(10, 20));
    const ma = m.addSeries("line");
    ma.setData(line(12, 20));
    const e0 = m.unionEpoch;
    candles.update(bars(20, 21)[0]);
    candles.update({ ...bars(20, 21)[0], close: 1 });
    expect(m.unionEpoch).toBe(e0);
    ma.setData(line(5, 21));
    expect(m.unionEpoch).toBeGreaterThan(e0);
  });

  it("data() returns only the series' own rows, in order", () => {
    const m = model();
    m.addSeries("candles").setData(bars(0, 10));
    const ma = m.addSeries("line");
    const rows = line(3, 7);
    ma.setData(rows);
    expect(ma.data()).toEqual(rows);
  });

  it("a series with times out of order stays positional and off the union", () => {
    const m = model();
    m.addSeries("candles").setData(bars(0, 10));
    const odd = m.addSeries("line");
    odd.setData([{ time: t(5), value: 1 }, { time: t(3), value: 2 }]);
    expect(m.pointCount()).toBe(10);
    expect(odd.data().map((r) => r.time)).toEqual([t(5), t(3)]);
  });
});
