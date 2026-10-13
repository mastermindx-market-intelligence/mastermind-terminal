/**
 * CE-Q03C-D1 diagnostic harness — per-wheel trace collection for the mm vs lwc
 * latency gap. Copy of the official cadence spec with the gesture reduced to
 * the zoom burst (60 wheel events) and the CDP trace categories widened to
 * include the queue, rAF, paint, GC, and compositor work. No edits to the
 * official spec, no edits to bench/chart-engine.cadence.bench.ts or
 * lib/chart-engine/bench/cadence.ts. Node-side hrtime captures one dispatch
 * duration per wheel. Traces land in ~/lanes/wt/$RUN_ID/traces/ (outside the
 * repo tree). Playwright config is read from playwright.config.ts and the
 * `BENCH_BASE_URL` env override points the config at the private port we
 * started. Per task spec: zoom only, alternating impl order, ≥5 runs/impl,
 * one fresh page per run.
 */

import { test, expect, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type EngineImpl = "mm" | "lwc";

const RUNS = Math.max(1, Number(process.env.BENCH_RUNS ?? 5));
// Alternating mm/lwc default per the task spec (≥5 runs/impl). Per-engine run
// counts via BENCH_IMPLS=mm gives 5 mm-only runs; BENCH_IMPLS=mm,lwc gives
// the alternating interleaved default.
const IMPLS: EngineImpl[] = (() => {
  const env = process.env.BENCH_IMPLS;
  if (env) {
    const tokens = env.split(",").map((s) => s.trim()).filter((s): s is EngineImpl => s === "mm" || s === "lwc");
    if (tokens.length > 0 && tokens.length !== 2) return tokens; // user-specified single or repeated list
  }
  const out: EngineImpl[] = [];
  for (let i = 0; i < RUNS; i++) out.push(i % 2 === 0 ? "mm" : "lwc");
  return out;
})();

const RUN_ID = process.env.RUN_ID ?? "ce-q03c-d1diag-1013";
const HOME = process.env.HOME ?? os.homedir();
const TRACE_DIR = path.resolve(HOME, "lanes", "wt", RUN_ID, "traces");

// Pure structural type; mirrors TraceEventSession in the official spec — we
// only add the categories we need.
interface TraceDataCollectedPayload { value?: unknown[] }
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

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing",
  "input",
  "benchmark",
  "latencyInfo",
  "cc",
  "viz",
  "toplevel",
  "v8.execute",
  "disabled-by-default-v8.cpu_profiler",
  "renderer.scheduler",
];

function ensureOutDir(): void {
  fs.mkdirSync(TRACE_DIR, { recursive: true });
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __mmBench?: { ready: Promise<void> } }).__mmBench),
    { timeout: 120_000 },
  );
  await page.evaluate(() => (window as unknown as { __mmBench: { ready: Promise<void> } }).__mmBench.ready);
}

/**
 * Install a capture-phase listener on `document` that records one
 * `performance.mark(name, { startTime: ev.timeStamp })` per wheel. Mirrors
 * the official spec verbatim.
 */
async function installInputMarks(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MinimalEv = { timeStamp: number; getCoalescedEvents?: () => ReadonlyArray<{ timeStamp: number }> };
    type MinimalDoc = { addEventListener(name: string, fn: (e: MinimalEv) => void, opts: { capture: boolean; passive: boolean }): void };
    type WindowSlot = { __diagInputMarksRemover?: () => void };
    const win = window as unknown as WindowSlot;
    const name = "cadence:zoom:input";
    const handler = (ev: MinimalEv): void => {
      const coalesced = ev.getCoalescedEvents?.() ?? [];
      if (coalesced.length > 0) {
        for (const c of coalesced) {
          performance.mark(name, { startTime: c.timeStamp });
        }
      } else {
        performance.mark(name, { startTime: ev.timeStamp });
      }
    };
    const doc = document as unknown as MinimalDoc;
    doc.addEventListener("wheel", handler, { capture: true, passive: true });
    win.__diagInputMarksRemover = (): void => {
      document.removeEventListener("wheel", handler, { capture: true });
      delete win.__diagInputMarksRemover;
    };
  });
}

async function removeInputMarks(page: Page): Promise<void> {
  await page.evaluate(() => {
    type WindowSlot = { __diagInputMarksRemover?: () => void };
    const win = window as unknown as WindowSlot;
    win.__diagInputMarksRemover?.();
  });
}

interface NodeWheelTiming { i: number; dispatchMs: number; dispatchHr: [number, number]; receiveMs: number; }

/**
 * Capture a CDP trace covering the widened categories, run the zoom gesture
 * (60 wheels; each node-side hrtime is recorded before/after each await
 * mouse.wheel), then collect via `Tracing.dataCollected`.
 */
async function captureZoomTrace(
  context: BrowserContext,
  page: Page,
  impl: EngineImpl,
  runIdx: number,
): Promise<{ events: unknown[]; wheelTimings: NodeWheelTiming[] }> {
  const cdp = await context.newCDPSession(page);
  const trace = cdp as unknown as TraceEventSession;
  const collected: unknown[] = [];
  let completeResolve: () => void = () => {};
  const complete = new Promise<void>((resolve) => { completeResolve = resolve; });
  const onData = (chunk: TraceDataCollectedPayload): void => {
    if (Array.isArray(chunk.value)) {
      for (const ev of chunk.value) collected.push(ev);
    }
  };
  const onEnd = (): void => completeResolve();
  trace.on("Tracing.dataCollected", onData);
  trace.on("Tracing.tracingComplete", onEnd);
  await trace.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: TRACE_CATEGORIES } });
  const wheelTimings: NodeWheelTiming[] = [];
  try {
    await page.mouse.move(720, 450);
    await page.waitForTimeout(200);
    await installInputMarks(page);
    try {
      await page.evaluate((n: string) => performance.mark(n), "cadence:zoom:start");
      for (let i = 0; i < 60; i++) {
        const hr0 = process.hrtime();
        const t0 = Date.now();
        await page.mouse.wheel(0, -120);
        const t1 = Date.now();
        wheelTimings.push({ i, dispatchMs: t1 - t0, dispatchHr: hr0, receiveMs: t1 });
      }
      await page.evaluate((n: string) => performance.mark(n), "cadence:zoom:end");
    } finally {
      await removeInputMarks(page).catch(() => undefined);
    }
    await page.waitForTimeout(250);
    await trace.send("Tracing.end");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`INVALID: Tracing.tracingComplete not received within 30 s (${impl} r${runIdx + 1})`)), 30_000);
    });
    try {
      await Promise.race([complete, timedOut]);
    } finally {
      if (timer != null) clearTimeout(timer);
    }
  } finally {
    trace.off("Tracing.dataCollected", onData);
    trace.off("Tracing.tracingComplete", onEnd);
    await (cdp as CDPSession).detach().catch(() => undefined);
  }
  return { events: collected, wheelTimings };
}

function dumpTrace(events: unknown[], impl: EngineImpl, runIdx: number, wheelTimings: NodeWheelTiming[]): void {
  const file = path.join(TRACE_DIR, `${impl}-r${runIdx + 1}-zoom.json`);
  fs.writeFileSync(file, JSON.stringify({
    commit: process.env.BENCH_COMMIT ?? "unknown",
    host: { os: `${os.type()} ${os.release()}`, cpu: `${os.cpus().length} x ${os.cpus()[0]?.model ?? "unknown"}` },
    impl,
    runIdx: runIdx + 1,
    wheelTimings,
    traceEvents: events,
  }, null, 2) + "\n");
}

test("ce-q03c-d1 diagnostic per-wheel trace (zoom only)", async ({ browser }) => {
  ensureOutDir();
  for (let i = 0; i < IMPLS.length; i++) {
    const impl = IMPLS[i];
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    try {
      await page.goto(`/dev/chart-bench?engine=${impl}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await waitReady(page);
      const dpr = await page.evaluate(() => window.devicePixelRatio);
      expect(dpr, `INVALID: dpr ${dpr} must equal 2 (every cadence number is scale-dependent)`).toBe(2);
      await page.mouse.move(10, 10);
      console.log(`D1DIAG ${impl} run=${i + 1}/${IMPLS.length} begin`);
      const { events, wheelTimings } = await captureZoomTrace(context, page, impl, i);
      dumpTrace(events, impl, i, wheelTimings);
      const medDispatch = median(wheelTimings.map((w) => w.dispatchMs));
      console.log(`D1DIAG ${impl} run=${i + 1}/${IMPLS.length} events=${events.length} wheels=${wheelTimings.length} dispatch_ms_p50=${medDispatch.toFixed(3)} trace=${path.join(TRACE_DIR, `${impl}-r${i + 1}-zoom.json`)}`);
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  }
});

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}