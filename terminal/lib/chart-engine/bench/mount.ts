// Chart-engine performance-budget mount (P4 harness).
//
// Creates the engine through the public factory, loads the daily-40k corpus,
// wraps requestAnimationFrame BEFORE createEngine so both impls share one
// frame log, and exposes window.__mmBench for the Playwright protocol.
// Browser-safe: no node: imports. Never import receipt.ts from this file.

import {
  createEngine,
  type ChartEngine,
  type EngineImpl,
  type EngineInventory,
  type EngineTime,
  type SeriesHandle,
} from "@/lib/chart-engine";
import {
  BENCH_HANDLE_SCROLL,
  DAILY_40K,
  UNMEASURED,
  buildDailyCorpus,
  frameWorkMs,
  planTick,
  type DailyCorpus,
  type FrameRecord,
} from "./corpus";

export type TickResult = { updateMs: number; frameMs: number };

export type ScreenshotResult = { ms: number; width: number; height: number };

export type MmBenchHook = {
  impl: EngineImpl;
  ready: Promise<void>;
  heapBefore: number;
  firstPaintMs: number;
  log: string[];
  paintRefusals(): number;
  /** False when performance.memory is absent, so heap_mb is UNMEASURED, not 1e-9. */
  heapSupported(): boolean;
  plotCenter(): { x: number; y: number };
  startFrameLog(): void;
  stopFrameLog(): FrameRecord[];
  tick(n: number): Promise<TickResult[]>;
  resetData(): void;
  screenshot(): ScreenshotResult;
  anchorTimeAt(x: number): EngineTime | null;
  timeToCoordinate(time: EngineTime): number | null;
  /** Visible logical range, or null — the protocol uses it to prove pan/zoom did something. */
  visibleLogicalRange(): { from: number; to: number } | null;
  inventory(): EngineInventory;
};

declare global {
  interface Window {
    __mmBench: MmBenchHook;
  }
}

type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number } };

function heapSize(): number {
  const mem = (performance as MemoryPerformance).memory;
  return mem && typeof mem.usedJSHeapSize === "number" ? mem.usedJSHeapSize : 0;
}

/** True only when performance.memory really reports a number (Chrome-only API). */
function heapMeasurable(): boolean {
  const mem = (performance as MemoryPerformance).memory;
  return typeof mem?.usedJSHeapSize === "number";
}

function readError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export type MountBenchHandle = {
  destroy(): void;
};

const LAYOUT = {
  background: { type: "solid", color: "#0b0b0c" },
  textColor: "#9a9a9a",
  fontSize: 12,
};

const CANDLE_OPTS = {
  upColor: "#c8c8c8",
  downColor: "#5a5a5a",
  borderUpColor: "#c8c8c8",
  borderDownColor: "#5a5a5a",
  wickUpColor: "#c8c8c8",
  wickDownColor: "#5a5a5a",
};

export function mountBench(container: HTMLElement, impl: EngineImpl): MountBenchHandle {
  const log: string[] = [];
  const refuse = (member: string, err: unknown) => {
    log.push(`refused:${member} ${readError(err)}`);
  };
  const run = (member: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      refuse(member, err);
    }
  };

  document.documentElement.style.margin = "0";
  document.documentElement.style.height = "100%";
  document.body.style.margin = "0";
  document.body.style.height = "100%";
  document.body.style.background = "#0b0b0c";
  document.body.style.overflow = "hidden";
  container.style.width = "100vw";
  container.style.height = "100vh";
  container.style.background = "#0b0b0c";

  const origRaf = window.requestAnimationFrame.bind(window);
  const origCancel = window.cancelAnimationFrame.bind(window);
  let logging = false;
  const records: FrameRecord[] = [];
  let paintRefusalCount = 0;

  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    return origRaf((frameTs) => {
      /** False when the callback threw: that frame presented nothing. */
      const invoke = (): boolean => {
        try {
          cb(frameTs);
          return true;
        } catch (err) {
          paintRefusalCount++;
          if (paintRefusalCount === 1) {
            refuse("paint", err); // the first occurrence carries the message
          }
          return false;
        }
      };
      if (!logging) {
        invoke();
        return;
      }
      const start = performance.now();
      const painted = invoke();
      const end = performance.now();
      // A frame whose paint threw did no work. Recording it would price a
      // failure as a fast frame and feed the pan/zoom/live p95s with
      // numbers no renderer produced.
      if (painted) records.push({ frameTs, start, end });
    });
  }) as typeof window.requestAnimationFrame;

  const corpus: DailyCorpus = buildDailyCorpus();
  const heapBefore = heapSize();
  const width = container.clientWidth || 1440;
  const height = container.clientHeight || 900;

  performance.mark("engine:create");
  let engine: ChartEngine | null = null;
  try {
    engine = createEngine(
      container,
      {
        width,
        height,
        autoSize: false,
        layout: LAYOUT,
        grid: {
          vertLines: { color: "#1a1a1c" },
          horzLines: { color: "#1a1a1c" },
        },
        timeScale: { borderColor: "#2a2a2c", timeVisible: false },
        rightPriceScale: { borderColor: "#2a2a2c" },
        handleScroll: { mouseWheel: BENCH_HANDLE_SCROLL.mouseWheel },
      },
      impl,
    );
  } catch (err) {
    refuse("createEngine", err);
  }

  let candles: SeriesHandle | null = null;
  let ma20: SeriesHandle | null = null;
  let ma50: SeriesHandle | null = null;
  let volume: SeriesHandle | null = null;
  let oscillator: SeriesHandle | null = null;
  let lastBar = corpus.candles[corpus.candles.length - 1];

  if (engine) {
    try {
      candles = engine.addSeries("candles", CANDLE_OPTS, 0);
    } catch (err) {
      refuse("addSeries:candles", err);
    }
    try {
      ma20 = engine.addSeries("line", { color: "#8a8a8a", lineWidth: 1, priceScaleId: "right" }, 0);
    } catch (err) {
      refuse("addSeries:ma20", err);
    }
    try {
      ma50 = engine.addSeries("line", { color: "#5c5c5c", lineWidth: 1, priceScaleId: "right" }, 0);
    } catch (err) {
      refuse("addSeries:ma50", err);
    }
    try {
      volume = engine.addSeries(
        "histogram",
        { color: "#4a4a4a", priceScaleId: "volume", priceFormat: { type: "volume" } },
        0,
      );
    } catch (err) {
      refuse("addSeries:volume", err);
    }
    try {
      oscillator = engine.addSeries("line", { color: "#7a7a7a", lineWidth: 1 }, 1);
    } catch (err) {
      refuse("addSeries:oscillator", err);
    }

    run("setData:candles", () => {
      candles?.setData(corpus.candles);
    });
    run("setData:ma20", () => {
      ma20?.setData(corpus.ma20);
    });
    run("setData:ma50", () => {
      ma50?.setData(corpus.ma50);
    });
    run("setData:volume", () => {
      volume?.setData(corpus.volume);
    });
    run("setData:oscillator", () => {
      oscillator?.setData(corpus.oscillator);
    });
    run("setMarkers", () => {
      candles?.setMarkers(corpus.markers);
    });
    run("setWatermark", () => {
      engine?.setWatermark(0, corpus.watermark);
    });
    run("priceScale:volume", () => {
      engine?.priceScale("volume", 0).applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
    });
    run("fitContent", () => {
      engine?.timeScale().fitContent();
    });
    run("resize", () => {
      engine?.resize(width, height, true);
    });
  }

  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const hook: MmBenchHook = {
    impl,
    ready,
    heapBefore,
    firstPaintMs: 0,
    log,
    paintRefusals: () => paintRefusalCount,
    heapSupported: heapMeasurable,
    plotCenter() {
      const el = engine?.chartElement() ?? container;
      const rect = el.getBoundingClientRect();
      try {
        const pane = engine?.paneSize(0);
        if (pane && pane.width > 0 && pane.height > 0) {
          return { x: rect.left + pane.width / 2, y: rect.top + pane.height / 2 };
        }
      } catch (err) {
        refuse("paneSize", err);
      }
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    startFrameLog() {
      records.length = 0;
      logging = true;
    },
    stopFrameLog() {
      logging = false;
      return records.slice();
    },
    async tick(n: number) {
      const out: TickResult[] = [];
      if (!candles) return out;
      logging = true;
      for (let i = 0; i < n; i++) {
        const planned = planTick(lastBar, i, ((i * 17) % 100) / 100);
        lastBar = planned.bar;
        const before = records.length;
        const t0 = performance.now();
        try {
          candles.update(planned.bar);
        } catch (err) {
          refuse("update", err);
        }
        const updateMs = performance.now() - t0;
        const frameMs = await waitNextWorkFrame(origRaf, records, before);
        out.push({ updateMs, frameMs });
      }
      logging = false;
      return out;
    },
    resetData() {
      run("resetData:candles", () => {
        candles?.setData(corpus.candles);
      });
      run("resetData:ma20", () => {
        ma20?.setData(corpus.ma20);
      });
      run("resetData:ma50", () => {
        ma50?.setData(corpus.ma50);
      });
      run("resetData:volume", () => {
        volume?.setData(corpus.volume);
      });
      run("resetData:oscillator", () => {
        oscillator?.setData(corpus.oscillator);
      });
      lastBar = corpus.candles[corpus.candles.length - 1];
    },
    screenshot() {
      if (!engine) return { ms: UNMEASURED, width: 0, height: 0 };
      const t0 = performance.now();
      let canvas: HTMLCanvasElement;
      try {
        canvas = engine.takeScreenshot();
      } catch (err) {
        refuse("takeScreenshot", err);
        return { ms: UNMEASURED, width: 0, height: 0 };
      }
      const ms = Math.max(performance.now() - t0, 1e-9);
      return { ms, width: canvas.width, height: canvas.height };
    },
    anchorTimeAt(x: number) {
      try {
        const el = engine?.chartElement() ?? container;
        const rect = el.getBoundingClientRect();
        return engine?.timeScale().coordinateToTime(x - rect.left) ?? null;
      } catch (err) {
        refuse("coordinateToTime", err);
        return null;
      }
    },
    timeToCoordinate(time: EngineTime) {
      try {
        return engine?.timeScale().timeToCoordinate(time) ?? null;
      } catch (err) {
        refuse("timeToCoordinate", err);
        return null;
      }
    },
    visibleLogicalRange() {
      try {
        return engine?.timeScale().getVisibleLogicalRange() ?? null;
      } catch (err) {
        refuse("getVisibleLogicalRange", err);
        return null;
      }
    },
    inventory() {
      try {
        return engine?.inventory() ?? { alive: false, panes: 0, series: 0, seriesByPane: [], priceLines: 0, watermarks: 0 };
      } catch (err) {
        refuse("inventory", err);
        return { alive: false, panes: 0, series: 0, seriesByPane: [], priceLines: 0, watermarks: 0 };
      }
    },
  };

  window.__mmBench = hook;

  origRaf(() => {
    origRaf(() => {
      performance.mark("engine:first-frame");
      try {
        performance.measure("engine:first-paint", "engine:create", "engine:first-frame");
        const entry = performance.getEntriesByName("engine:first-paint")[0];
        hook.firstPaintMs = entry && "duration" in entry ? Math.max(entry.duration, 1e-9) : UNMEASURED;
      } catch (err) {
        refuse("performance.measure", err);
        hook.firstPaintMs = UNMEASURED;
      }
      log.push(`corpus=${DAILY_40K.name} bars=${DAILY_40K.bars} impl=${impl}`);
      log.push(`paint_refusals=${paintRefusalCount}`);
      resolveReady();
    });
  });

  return {
    destroy() {
      logging = false;
      window.requestAnimationFrame = origRaf as typeof window.requestAnimationFrame;
      window.cancelAnimationFrame = origCancel;
      run("destroy", () => {
        engine?.destroy();
      });
    },
  };
}

function waitNextWorkFrame(
  origRaf: typeof window.requestAnimationFrame,
  records: FrameRecord[],
  before: number,
): Promise<number> {
  return new Promise((resolve) => {
    const started = performance.now();
    const poll = () => {
      if (records.length > before) {
        const ts = records[before].frameTs;
        resolve(Math.max(frameWorkMs(records.slice(before), ts), 1e-9));
        return;
      }
      if (performance.now() - started > 500) {
        resolve(UNMEASURED);
        return;
      }
      origRaf(poll);
    };
    origRaf(poll);
  });
}
