/**
 * Chart-engine performance protocol (B1–B6). Playwright test file living under
 * bench/ as *.bench.ts so the responsive suite never picks it up.
 *
 * Measurement path MUST NOT call page.clock.install() — Playwright's fake clock
 * replaces rAF and performance.now, so the numbers would be the driver, not
 * presentation (see docs/chart-engine-completion/performance-budget.md §3,
 * dated 2026-10-13). Determinism comes from the seeded corpus and this script.
 */

import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DAILY_40K,
  UNMEASURED,
  frameDeltas,
  p95,
  panMoved,
  runMedian,
  zoomChangedSpan,
  type FrameRecord,
  type VisibleSpan,
} from "../lib/chart-engine/bench/corpus";
import {
  applyRefusals,
  buildReceipt,
  validateReceipt,
  type ReceiptMetrics,
} from "../lib/chart-engine/bench/receipt";

type EngineImpl = "mm" | "lwc";

type RunMetrics = ReceiptMetrics & {
  zoomDriftPx: number | null;
  screenshotWidth: number;
  screenshotHeight: number;
  soakSlope: number | null;
  log: string[];
};

const IMPLS: EngineImpl[] = (process.env.BENCH_IMPLS ?? "mm,lwc")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is EngineImpl => s === "mm" || s === "lwc");

const RUNS = Math.max(1, Number(process.env.BENCH_RUNS ?? 3));
const SOAK_SWITCHES = Math.max(2, Number(process.env.BENCH_SOAK ?? 50));
const ENFORCE = process.env.BENCH_ENFORCE === "1";
const OUT_DIR = process.env.BENCH_OUT_DIR
  ?? path.resolve(__dirname, "..", "test-results", "bench");

const COMMIT = execSync("git rev-parse HEAD", {
  encoding: "utf8",
  cwd: path.resolve(__dirname, "..", ".."),
}).trim();

const HOST = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-");
const CPU = `${os.cpus().length} x ${os.cpus()[0]?.model ?? "unknown"}`;
const OS_LABEL = `${os.type()} ${os.release()}`;

async function readRange(page: Page): Promise<VisibleSpan> {
  return benchEval(page, () => (window as unknown as { __mmBench: { visibleLogicalRange: () => VisibleSpan } }).__mmBench.visibleLogicalRange());
}

function ensureOutDir(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function appendLog(file: string, line: string): void {
  fs.appendFileSync(file, line + "\n");
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __mmBench?: { ready: Promise<void> } }).__mmBench),
    { timeout: 120_000 },
  );
  await page.evaluate(() => (window as unknown as { __mmBench: { ready: Promise<void> } }).__mmBench.ready);
}

async function benchEval<T>(page: Page, fn: (arg: number) => T | Promise<T>, arg: number): Promise<T>;
async function benchEval<T>(page: Page, fn: () => T | Promise<T>): Promise<T>;
async function benchEval<T>(page: Page, fn: ((arg: number) => T | Promise<T>) | (() => T | Promise<T>), arg?: number): Promise<T> {
  return arg === undefined
    ? page.evaluate(fn as () => T)
    : page.evaluate(fn as (a: number) => T, arg);
}

async function measureImpl(page: Page, impl: EngineImpl, logFile: string): Promise<RunMetrics> {
  await page.goto(`/dev/chart-bench?engine=${impl}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitReady(page);
  // The budget assumes a dpr-2 raster (performance-budget.md §3). A run at dpr 1 measures a
  // quarter of the pixels and would still be schema-valid, so pin the scale before measuring.
  const dpr = await benchEval(page, () => window.devicePixelRatio);
  appendLog(logFile, `[${impl}] window.devicePixelRatio=${dpr}`);
  expect(
    dpr,
    `deviceScaleFactor must reach the page (got window.devicePixelRatio=${dpr}); every B1-B6 number is scale-dependent`,
  ).toBe(2);
  await page.mouse.move(10, 10);

  const firstPaint = await benchEval(page, () => {
    const w = window as unknown as { __mmBench: { firstPaintMs: number; log: string[] } };
    return { ms: w.__mmBench.firstPaintMs, log: w.__mmBench.log.slice() };
  });
  for (const line of firstPaint.log) appendLog(logFile, `[${impl}] ${line}`);

  const center = await benchEval(page, () => {
    const w = window as unknown as { __mmBench: { plotCenter: () => { x: number; y: number } } };
    return w.__mmBench.plotCenter();
  });

  await benchEval(page, () => {
    (window as unknown as { __mmBench: { startFrameLog: () => void } }).__mmBench.startFrameLog();
  });
  const rangeBeforePan = await readRange(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let i = 1; i <= 200; i++) {
    await page.mouse.move(center.x + i * 8, center.y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const panRecords = await benchEval(page, () => {
    return (window as unknown as { __mmBench: { stopFrameLog: () => FrameRecord[] } }).__mmBench.stopFrameLog();
  });
  const rangeAfterPan = await readRange(page);
  await page.mouse.move(10, 10);
  const panP95 = p95(frameDeltas(panRecords));
  if (impl === "mm") {
    expect(
      panMoved(rangeBeforePan, rangeAfterPan),
      `mm drag-pan must move the visible range (before=${JSON.stringify(rangeBeforePan)} after=${JSON.stringify(rangeAfterPan)}) — a no-op engine must fail here, not price 0 frames as fast`,
    ).toBe(true);
  }

  await benchEval(page, () => {
    (window as unknown as { __mmBench: { startFrameLog: () => void } }).__mmBench.startFrameLog();
  });
  const rangeBeforeZoom = await readRange(page);
  // Zoom metric: float index under the pointer (PERF-RR2 ruling 3). The metric
  // is the quantity the <= 1 CSS px law names; bar-centre anchoring breaks the
  // law at large barSpacing. Chrome dispatches MouseEvent.clientX as an
  // integer, so zoomX must be an integer CSS px identical to what the wheel
  // events are dispatched at. The lwc pane centre can be fractional, so we
  // round the centre to the same integer the wheel will use.
  const zoomX = Math.round(center.x);
  const zoomY = Math.round(center.y);
  const beforeAnchor = await benchEval(page, (px: number) => {
    const w = window as unknown as {
      __mmBench: {
        floatAnchorAt: (x: number) => { x: number; logical: number } | null;
      };
    };
    return w.__mmBench.floatAnchorAt(px);
  }, zoomX);
  await page.mouse.move(zoomX, zoomY);
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(50);
  }
  const zoomRecords = await benchEval(page, () => {
    return (window as unknown as { __mmBench: { stopFrameLog: () => FrameRecord[] } }).__mmBench.stopFrameLog();
  });
  const afterX = await benchEval(page, (logical: number) => {
    const w = window as unknown as {
      __mmBench: {
        coordinateOfLogical: (l: number) => number | null;
      };
    };
    return w.__mmBench.coordinateOfLogical(logical);
  }, beforeAnchor?.logical ?? Number.NaN);
  let zoomDriftPx: number | null = null;
  if (beforeAnchor != null && typeof afterX === "number") {
    zoomDriftPx = Math.abs(afterX - beforeAnchor.x);
  }
  appendLog(logFile, `[${impl}] zoom_anchor_drift_px=${zoomDriftPx ?? "n/a"}`);
  if (beforeAnchor != null && typeof afterX === "number") {
    appendLog(logFile, `[${impl}] zoom_anchor_float logical=${beforeAnchor.logical} x=${beforeAnchor.x} after_x=${afterX}`);
  }
  const rangeAfterZoom = await readRange(page);
  appendLog(logFile, `[${impl}] visible_range before_zoom=${JSON.stringify(rangeBeforeZoom)} after_zoom=${JSON.stringify(rangeAfterZoom)}`);
  if (impl === "mm") {
    expect(
      zoomChangedSpan(rangeBeforeZoom, rangeAfterZoom),
      `mm wheel zoom must change the visible-range width (before=${JSON.stringify(rangeBeforeZoom)} after=${JSON.stringify(rangeAfterZoom)}) — pointer-anchor drift is meaningless on an engine that did not zoom`,
    ).toBe(true);
    expect(
      beforeAnchor,
      "mm pointer-anchor drift must be MEASURABLE: coordinateToLogical/logicalToCoordinate returned null, so the <=1px law was never checked",
    ).not.toBe(null);
  }
  await page.mouse.move(10, 10);
  const zoomP95 = p95(frameDeltas(zoomRecords));

  const ticks = await benchEval(page, () => {
    return (window as unknown as { __mmBench: { tick: (n: number) => Promise<Array<{ updateMs: number; frameMs: number }>> } }).__mmBench.tick(500);
  });
  const liveP95 = p95(ticks.map((t) => t.updateMs + t.frameMs));

  const shot = await benchEval(page, async () => {
    const w = window as unknown as { __mmBench: { screenshot: () => { ms: number; width: number; height: number } } };
    const probe = w.__mmBench.screenshot();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const times: number[] = [];
    let last = probe;
    for (let i = 0; i < 20; i++) {
      last = w.__mmBench.screenshot();
      times.push(last.ms);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    }
    return { probe, times, last };
  });
  appendLog(logFile, `[${impl}] screenshot_probe ${shot.probe.width}x${shot.probe.height}`);
  if (impl === "lwc" && (shot.probe.width !== 2880 || shot.probe.height !== 1800)) {
    appendLog(logFile, `[${impl}] screenshot dims differ from 2880x1800 (control row; recorded, not failed)`);
  }
  const shotP95 = p95(shot.times);

  const heap = await benchEval(page, () => {
    const w = window as unknown as { __mmBench: { resetData: () => void; heapBefore: number; heapSupported: () => boolean } };
    w.__mmBench.resetData();
    w.__mmBench.resetData();
    w.__mmBench.resetData();
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const after = mem && typeof mem.usedJSHeapSize === "number" ? mem.usedJSHeapSize : 0;
    return { before: w.__mmBench.heapBefore, after, supported: w.__mmBench.heapSupported() };
  });
  const heapMb = heap.supported ? Math.max((heap.after - heap.before) / 1048576, 1e-9) : UNMEASURED;
  if (!heap.supported) appendLog(logFile, `[${impl}] performance.memory unavailable \u2014 heap_mb=UNMEASURED`);

  const soak = await benchEval(page, (soakCount: number) => {
    const w = window as unknown as { __mmBench: { resetData: () => void } };
    const samples: number[] = [];
    for (let i = 1; i <= soakCount; i++) {
      w.__mmBench.resetData();
      if (i % 10 === 0) {
        const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        samples.push(mem && typeof mem.usedJSHeapSize === "number" ? mem.usedJSHeapSize : 0);
      }
    }
    return samples;
  }, SOAK_SWITCHES);
  let soakSlope: number | null = null;
  if (soak.length >= 2) {
    soakSlope = (soak[soak.length - 1] - soak[0]) / (soak.length - 1);
  }
  appendLog(logFile, `[${impl}] soak_samples_bytes=${JSON.stringify(soak)} soak_slope=${soakSlope ?? "n/a"}`);

  const refusals = await benchEval(page, () => {
    return (window as unknown as { __mmBench: { log: string[] } }).__mmBench.log.filter((l) => l.startsWith("refused:"));
  });
  for (const line of refusals) appendLog(logFile, `[${impl}] ${line}`);

  const measured: ReceiptMetrics = {
    first_paint_ms: Math.max(firstPaint.ms, 1e-9),
    pan_frame_p95_ms: panP95,
    zoom_frame_p95_ms: zoomP95,
    live_commit_ms: liveP95,
    screenshot_ms: shotP95,
    heap_mb: heapMb,
  };

  return {
    ...applyRefusals(measured, refusals),
    zoomDriftPx,
    screenshotWidth: shot.last.width,
    screenshotHeight: shot.last.height,
    soakSlope,
    log: firstPaint.log.concat(refusals),
  };
}

function aggregate(runs: RunMetrics[]): ReceiptMetrics {
  const pick = (key: Exclude<keyof ReceiptMetrics, "heap_mb">) => runMedian(runs.map((r) => r[key]));
  const heaps = runs.map((r) => r.heap_mb);
  return {
    first_paint_ms: pick("first_paint_ms"),
    pan_frame_p95_ms: pick("pan_frame_p95_ms"),
    zoom_frame_p95_ms: pick("zoom_frame_p95_ms"),
    live_commit_ms: pick("live_commit_ms"),
    screenshot_ms: pick("screenshot_ms"),
    heap_mb: heaps.length === 0 || heaps.some((v) => v >= UNMEASURED) ? UNMEASURED : Math.max(...heaps, 1e-9),
  };
}

test("chart-engine performance protocol B1-B6", async ({ browser }) => {
  expect(COMMIT, "git rev-parse HEAD must be 40 hex").toMatch(/^[0-9a-f]{40}$/);
  ensureOutDir();
  const logFile = path.join(OUT_DIR, `${COMMIT.slice(0, 12)}-${HOST}.log`);
  appendLog(logFile, `commit=${COMMIT} host=${HOST} runs=${RUNS} impls=${IMPLS.join(",")}`);
  appendLog(logFile, "clock.install: NOT used (F7; rAF must stay real)");

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const mmDrifts: number[] = [];

  try {
    for (const impl of IMPLS) {
      const runs: RunMetrics[] = [];
      for (let i = 0; i < RUNS; i++) {
        const page = await context.newPage();
        try {
          appendLog(logFile, `[${impl}] run ${i + 1}/${RUNS} start`);
          const metrics = await measureImpl(page, impl, logFile);
          runs.push(metrics);
          appendLog(logFile, `[${impl}] run ${i + 1} first_paint_ms=${metrics.first_paint_ms} pan=${metrics.pan_frame_p95_ms} zoom=${metrics.zoom_frame_p95_ms} live=${metrics.live_commit_ms} shot=${metrics.screenshot_ms} heap=${metrics.heap_mb}`);
          if (impl === "mm" && metrics.screenshotWidth && metrics.screenshotHeight) {
            if (metrics.screenshotWidth !== 2880 || metrics.screenshotHeight !== 1800) {
              appendLog(logFile, `[${impl}] screenshot backing store ${metrics.screenshotWidth}x${metrics.screenshotHeight} (expected 2880x1800 at 1440x900 dpr2)`);
            }
          }
        } finally {
          await page.close();
        }
      }

      const metrics = aggregate(runs);
      const receipt = buildReceipt({
        commit: COMMIT,
        generated_at: new Date().toISOString(),
        host: { os: OS_LABEL, cpu: CPU, dpr: 2 },
        corpus: { name: DAILY_40K.name, bars: DAILY_40K.bars },
        metrics,
      });
      const file = path.join(OUT_DIR, `receipt-${impl}-${COMMIT}-${HOST}.json`);
      fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
      const valid = validateReceipt(receipt);
      if (!valid.ok) {
        throw new Error(`receipt ${file} failed schema validation:\n${valid.errors.join("\n")}`);
      }
      if (ENFORCE && !receipt.budget_ok) {
        throw new Error(`BENCH_ENFORCE=1 and budget_ok=false for ${impl}: ${JSON.stringify(receipt.violations)}`);
      }
      const summary = `BENCH ${impl} commit=${COMMIT} first_paint_ms=${metrics.first_paint_ms} pan=${metrics.pan_frame_p95_ms} zoom=${metrics.zoom_frame_p95_ms} live=${metrics.live_commit_ms} shot=${metrics.screenshot_ms} heap=${metrics.heap_mb} budget_ok=${receipt.budget_ok} violations=${receipt.violations.length} file=${file}`;
      console.log(summary);
      appendLog(logFile, summary);
      if (impl === "mm") {
        for (const run of runs) {
          if (run.zoomDriftPx != null) mmDrifts.push(run.zoomDriftPx);
        }
      }
    }
    expect(
      mmDrifts,
      `every mm run must yield a measurable zoom-anchor drift (got ${mmDrifts.length} of ${RUNS})`,
    ).toHaveLength(RUNS);
    for (const drift of mmDrifts) {
      expect(drift, "mm pointer-anchor drift after wheel zoom").toBeLessThanOrEqual(1);
    }
  } finally {
    await context.close();
  }
});

test("page.clock.install fakes requestAnimationFrame (F7 falsifier)", async ({ page }) => {
  test.skip(!process.env.BENCH_PROVE_CLOCK, "set BENCH_PROVE_CLOCK=1 to prove rAF is faked under clock.install");
  await page.goto("about:blank");
  await page.clock.install();
  await page.clock.pauseAt(new Date("2026-10-13T00:00:00.000Z"));
  await page.evaluate(() => {
    (window as unknown as { __rafFired?: boolean }).__rafFired = false;
    requestAnimationFrame(() => {
      (window as unknown as { __rafFired?: boolean }).__rafFired = true;
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const fired = await page.evaluate(() => Boolean((window as unknown as { __rafFired?: boolean }).__rafFired));
  expect(fired, "rAF callback must not fire within 500 ms real time while clock is paused").toBe(false);
});
