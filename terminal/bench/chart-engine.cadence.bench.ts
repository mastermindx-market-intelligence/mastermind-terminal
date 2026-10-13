/**
 * Chart-engine presented-frame cadence protocol (Q03). Playwright test file
 * living under bench/ as *.bench.ts so the responsive suite never picks it up.
 *
 * ONE trace per gesture (CDP Tracing.stream): pan, then zoom. Each run drives
 * a fresh context, page, and trace. Receipt = the run with the median
 * pan.p95_ms across this impl per set of runs (Math.floor((n-1)/2) of the
 * sorted ascending set; tie -> lower run index). Invalid results fail;
 * BENCH_ENFORCE=1 fails the whole test on budget_ok=false.
 *
 * Measurement path MUST NOT call page.clock.install() (F7) — the CDP trace
 * uses the real browser clock.
 */

import { test, expect, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCadenceReceipt,
  gestureStats,
  asTraceEvents,
  parsePresentedFrames,
  userTimingMs,
  validateCadenceReceipt,
  type CadenceGestureStats,
  type CadenceReceipt,
} from "../lib/chart-engine/bench/cadence";
import {
  panMoved,
  zoomChangedSpan,
  type VisibleSpan,
} from "../lib/chart-engine/bench/corpus";

type EngineImpl = "mm" | "lwc";

type RunStats = {
  pan: CadenceGestureStats;
  zoom: CadenceGestureStats;
};

const IMPLS: EngineImpl[] = (process.env.BENCH_IMPLS ?? "mm,lwc")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is EngineImpl => s === "mm" || s === "lwc");

const RUNS = Math.max(1, Number(process.env.BENCH_RUNS ?? 3));
const ENFORCE = process.env.BENCH_ENFORCE === "1";
const DUMP_TRACE = process.env.BENCH_DUMP_TRACE === "1";
const OUT_DIR = process.env.BENCH_OUT_DIR
  ?? path.resolve(__dirname, "..", "test-results", "bench");

const COMMIT = execSync("git rev-parse HEAD", {
  encoding: "utf8",
  cwd: path.resolve(__dirname, "..", ".."),
}).trim();

const HOST = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-");
const CPU = `${os.cpus().length} x ${os.cpus()[0]?.model ?? "unknown"}`;
const OS_LABEL = `${os.type()} ${os.release()}`;
const DPR = 2;

/**
 * `Tracing.dataCollected` payload shape Chromium 149 actually emits when the
 * trace is started with `transferMode: "ReportEvents"`:
 *   { value: Array<TraceEvent> }.
 * The Playwright-bound `@playwright/types` protocol declaration `Tracing.data
 * CollectedPayload = { value: { [key: string]: string }[] }` describes the
 * older key/value wire format and types our callback incorrectly. Use the
 * actual runtime shape so `eslint` and `tsc --strict` stay green without an
 * `any` or `eslint-disable`.
 */
interface TraceDataCollectedPayload {
  value?: unknown[];
}
type TraceCompletePayload = Record<string, never>;

interface TraceEventSession {
  on(event: "Tracing.dataCollected", cb: (p: TraceDataCollectedPayload) => void): void;
  on(event: "Tracing.tracingComplete", cb: (p: TraceCompletePayload) => void): void;
  off(event: "Tracing.dataCollected", cb: (p: TraceDataCollectedPayload) => void): void;
  off(event: "Tracing.tracingComplete", cb: (p: TraceCompletePayload) => void): void;
  send(method: "Tracing.start", params?: Record<string, unknown>): Promise<void>;
  send(method: "Tracing.end"): Promise<void>;
  detach(): Promise<void>;
}

function ensureOutDir(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function appendLog(file: string, line: string): void {
  fs.appendFileSync(file, line + "\n");
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
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

async function readRange(page: Page): Promise<VisibleSpan> {
  return benchEval(page, () => (window as unknown as { __mmBench: { visibleLogicalRange: () => VisibleSpan } }).__mmBench.visibleLogicalRange());
}

function receiptPathFor(impl: EngineImpl): string {
  return path.join(OUT_DIR, `cadence-${impl}-${COMMIT}-${HOST}.json`);
}

/**
 * Start a CDP trace covering only the two frame-reporter + user_timing
 * categories, run `body`, then collect via the `Tracing.dataCollected` event
 * stream (transferMode: "ReportEvents"). When the browser emits
 * `Tracing.tracingComplete`, all events have been delivered.
 */
async function captureTrace<T>(
  context: BrowserContext,
  page: Page,
  label: string,
  body: () => Promise<T>,
): Promise<{ value: T; events: unknown[] }> {
  const cdp = await context.newCDPSession(page);
  // Cast through unknown to the actual runtime shape (see TraceEventSession).
  const trace = cdp as unknown as TraceEventSession;
  const traceConfig = {
    includedCategories: [
      "disabled-by-default-devtools.timeline.frame",
      "blink.user_timing",
    ],
  };
  const collected: unknown[] = [];
  let completeResolve: () => void = () => {};
  const complete = new Promise<void>((resolve) => {
    completeResolve = resolve;
  });
  const onData = (chunk: TraceDataCollectedPayload) => {
    if (Array.isArray(chunk.value)) {
      for (const ev of chunk.value) collected.push(ev);
    }
  };
  const onEnd = () => completeResolve();
  trace.on("Tracing.dataCollected", onData);
  trace.on("Tracing.tracingComplete", onEnd);
  await trace.send("Tracing.start", { transferMode: "ReportEvents", traceConfig });
  let value: T;
  try {
    value = await body();
  } finally {
    await page.waitForTimeout(250);
    await trace.send("Tracing.end");
    await complete;
  }
  trace.off("Tracing.dataCollected", onData);
  trace.off("Tracing.tracingComplete", onEnd);
  // CDPSession.detach exists; the structural type narrows the union.
  await (cdp as CDPSession).detach().catch(() => undefined);
  return { value, events: asTraceEvents({ traceEvents: collected }) };
}

async function panGesture(
  context: BrowserContext,
  page: Page,
  center: { x: number; y: number },
  impl: EngineImpl,
  runIdx: number,
): Promise<{ stats: CadenceGestureStats; events: unknown[]; rangeBefore: VisibleSpan; rangeAfter: VisibleSpan }> {
  const rangeBefore = await readRange(page);
  const { events } = await captureTrace(context, page, "pan", async () => {
    await page.mouse.move(center.x, center.y);
    await page.waitForTimeout(200);
    await page.evaluate((n: string) => performance.mark(n), "cadence:pan:start");
    await page.mouse.down();
    await page.mouse.move(center.x + 1600, center.y, { steps: 200 });
    await page.mouse.up();
    await page.evaluate((n: string) => performance.mark(n), "cadence:pan:end");
    return true;
  });
  const rangeAfter = await readRange(page);
  if (!panMoved(rangeBefore, rangeAfter)) {
    throw new Error(`INVALID: pan did not move the visible range (${impl}); before=${JSON.stringify(rangeBefore)} after=${JSON.stringify(rangeAfter)}`);
  }
  const startMs = userTimingMs(events, "cadence:pan:start");
  const endMs = userTimingMs(events, "cadence:pan:end");
  if (startMs == null) throw new Error(`INVALID: missing mark cadence:pan:start (${impl})`);
  if (endMs == null) throw new Error(`INVALID: missing mark cadence:pan:end (${impl})`);
  let parsed;
  try {
    parsed = parsePresentedFrames(events);
  } catch (err) {
    // Always dump on parse failure so the host sees what arrived; useful for
    // a Chromium version whose category name or mark clock changed.
    writeTrace(events, impl, runIdx, "pan");
    throw new Error(`INVALID: ${(err as Error).message} (${impl} pan run ${runIdx + 1})`);
  }
  const stats = gestureStats(parsed, startMs, endMs, 200);
  // B4: window must hold >= 2 presented frames, else INVALID.
  if (stats.presented < 2) {
    throw new Error(`INVALID: fewer than 2 presented frames in the pan window (${impl})`);
  }
  if (DUMP_TRACE) writeTrace(events, impl, runIdx, "pan");
  return { stats, events, rangeBefore, rangeAfter };
}

async function zoomGesture(
  context: BrowserContext,
  page: Page,
  center: { x: number; y: number },
  impl: EngineImpl,
  runIdx: number,
): Promise<{ stats: CadenceGestureStats; events: unknown[]; rangeBefore: VisibleSpan; rangeAfter: VisibleSpan }> {
  const rangeBefore = await readRange(page);
  const { events } = await captureTrace(context, page, "zoom", async () => {
    await page.mouse.move(center.x, center.y);
    await page.waitForTimeout(200);
    await page.evaluate((n: string) => performance.mark(n), "cadence:zoom:start");
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, -120);
    }
    await page.evaluate((n: string) => performance.mark(n), "cadence:zoom:end");
    return true;
  });
  const rangeAfter = await readRange(page);
  if (!zoomChangedSpan(rangeBefore, rangeAfter)) {
    throw new Error(`INVALID: zoom did not change the visible span (${impl}); before=${JSON.stringify(rangeBefore)} after=${JSON.stringify(rangeAfter)}`);
  }
  const startMs = userTimingMs(events, "cadence:zoom:start");
  const endMs = userTimingMs(events, "cadence:zoom:end");
  if (startMs == null) throw new Error(`INVALID: missing mark cadence:zoom:start (${impl})`);
  if (endMs == null) throw new Error(`INVALID: missing mark cadence:zoom:end (${impl})`);
  let parsed;
  try {
    parsed = parsePresentedFrames(events);
  } catch (err) {
    writeTrace(events, impl, runIdx, "zoom");
    throw new Error(`INVALID: ${(err as Error).message} (${impl} zoom run ${runIdx + 1})`);
  }
  const stats = gestureStats(parsed, startMs, endMs, 60);
  if (stats.presented < 2) {
    throw new Error(`INVALID: fewer than 2 presented frames in the zoom window (${impl})`);
  }
  if (DUMP_TRACE) writeTrace(events, impl, runIdx, "zoom");
  return { stats, events, rangeBefore, rangeAfter };
}

function writeTrace(events: unknown[], impl: EngineImpl, runIdx: number, kind: "pan" | "zoom"): void {
  const file = path.join(OUT_DIR, `cadence-trace-${impl}-r${runIdx + 1}-${kind}-${COMMIT.slice(0, 12)}.json`);
  fs.writeFileSync(file, JSON.stringify({ traceEvents: events }, null, 2) + "\n");
}

async function runGesture(
  context: BrowserContext,
  page: Page,
  impl: EngineImpl,
  runIdx: number,
): Promise<RunStats> {
  const center = await benchEval(page, () => {
    const w = window as unknown as { __mmBench: { plotCenter: () => { x: number; y: number } } };
    return w.__mmBench.plotCenter();
  });
  const pan = await panGesture(context, page, center, impl, runIdx);
  const zoom = await zoomGesture(context, page, center, impl, runIdx);
  return { pan: pan.stats, zoom: zoom.stats };
}

/** Per-run receipt over (pan, zoom) stats; same canonical budgets as the
 *  receipt that will be persisted for that impl. */
function perRunReceipt(stats: RunStats, impl: EngineImpl): CadenceReceipt {
  return buildCadenceReceipt({
    commit: COMMIT,
    impl,
    host: { os: OS_LABEL, cpu: CPU, dpr: DPR },
    generated_at: new Date().toISOString(),
    pan: stats.pan,
    zoom: stats.zoom,
  });
}

test("chart-engine presented-frame cadence protocol (Q03)", async ({ browser }) => {
  expect(COMMIT, "git rev-parse HEAD must be 40 hex").toMatch(/^[0-9a-f]{40}$/);
  ensureOutDir();
  const logFile = path.join(OUT_DIR, `cadence-${COMMIT.slice(0, 12)}-${HOST}.log`);
  appendLog(logFile, `commit=${COMMIT} host=${HOST} runs=${RUNS} impls=${IMPLS.join(",")} enforce=${ENFORCE ? 1 : 0}`);

  try {
    for (const impl of IMPLS) {
      const runs: RunStats[] = [];
      const file = receiptPathFor(impl);
      for (let i = 0; i < RUNS; i++) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: DPR,
        });
        const page = await context.newPage();
        try {
          await page.goto(`/dev/chart-bench?engine=${impl}`, {
            waitUntil: "domcontentloaded",
            timeout: 120_000,
          });
          await waitReady(page);
          const dpr = await benchEval(page, () => window.devicePixelRatio);
          appendLog(logFile, `[${impl}] run ${i + 1}/${RUNS} window.devicePixelRatio=${dpr}`);
          expect(
            dpr,
            `INVALID: dpr ${dpr} must equal ${DPR} (every cadence number is scale-dependent)`,
          ).toBe(DPR);
          await page.mouse.move(10, 10);
          appendLog(logFile, `[${impl}] run ${i + 1} start`);
          const stats = await runGesture(context, page, impl, i);
          runs.push(stats);
          const r = perRunReceipt(stats, impl);
          const line = `CADENCE ${impl} commit=${COMMIT} pan_p95=${round1(stats.pan.p95_ms)} pan_p99=${round1(stats.pan.p99_ms)} zoom_p95=${round1(stats.zoom.p95_ms)} zoom_p99=${round1(stats.zoom.p99_ms)} presented=${stats.pan.presented} partial=${stats.pan.partial} dropped=${stats.pan.dropped} input_hz=${round1(stats.pan.input_hz)} budget_ok=${r.budget_ok} violations=${r.violations.length} file=${file}`;
          console.log(line);
          appendLog(logFile, `[${impl}] run ${i + 1} ${line}`);
        } finally {
          await page.close().catch(() => undefined);
          await context.close().catch(() => undefined);
        }
      }

      // Median run selection: sort by pan.p95_ms ascending, tie -> lower
      // run index, pick index Math.floor((n-1)/2).
      const indexed = runs.map((r, idx) => ({ idx, p95: r.pan.p95_ms, run: r }));
      indexed.sort((a, b) => {
        if (a.p95 !== b.p95) return a.p95 - b.p95;
        return a.idx - b.idx;
      });
      const medianPick = indexed[Math.floor((RUNS - 1) / 2)];
      const medianRun = medianPick?.run;
      if (medianRun == null) throw new Error(`no runs collected for ${impl}`);
      const receipt = buildCadenceReceipt({
        commit: COMMIT,
        impl,
        host: { os: OS_LABEL, cpu: CPU, dpr: DPR },
        generated_at: new Date().toISOString(),
        pan: medianRun.pan,
        zoom: medianRun.zoom,
      });
      const valid = validateCadenceReceipt(receipt);
      if (!valid.ok) {
        throw new Error(`receipt for ${impl} failed validation:\n${valid.errors.join("\n")}`);
      }
      fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
      const medianLine = `CADENCE_MEDIAN ${impl} run=${medianPick!.idx + 1} pan_p95=${round1(medianRun.pan.p95_ms)} file=${file}`;
      console.log(medianLine);
      appendLog(logFile, `[${impl}] ${medianLine}`);
      if (ENFORCE && !receipt.budget_ok) {
        throw new Error(`BENCH_ENFORCE=1 and budget_ok=false for ${impl}: ${JSON.stringify(receipt.violations)}`);
      }
    }
  } finally {
    // nothing to release
  }
});
