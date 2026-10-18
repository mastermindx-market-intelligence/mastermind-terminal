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
 * Measurement path MUST NOT install the Playwright clock fixture (F7) — the
 * CDP trace uses the real browser clock.
 *
 * Per-input marks (Q03b): for each gesture we install a single capture-phase
 * listener on `document` that records one `performance.mark` per coalesced
 * event (pointermove/mousemove for pan, wheel for zoom) using the input's
 * own timeStamp as the startTime. The trace-side ts and the page-side
 * performance entry are compared via `checkInputMarkClock` and a > 0.01 ms
 * deviation FAILS the run. Per-input latency is then the FIRST presented
 * frame at-or-after each input mark, bounded by the gesture tail; the
 * interval quantity is bounded by the dispatch rate but per-input latency is
 * not, so a separate budget (20 / 33.4 ms) gates it.
 */

import { test, expect, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { waitBenchReady } from "../lib/chart-engine/bench/ready";
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
  userTimingAllMs,
  validateCadenceReceipt,
  inputLatencyStats,
  parsePresentedFrameSpans,
  leadinPresentations,
  wheelForwardsMs,
  pairWheelForwards,
  cadenceForwardBlock,
  forwardLatenciesMs,
  forwardLatencyStats,
  forwardAnsweredByPriorFrame,
  presentedIntervals,
  measureVsync,
  frameSequenceIntervals,
  checkInputMarkClock,
  cadenceV2Seed,
  cadenceV2ScheduleMs,
  dispatchOnSchedule,
  countDispatched,
  cadenceInvalidLine,
  CADENCE_V2_WHEELS,
  CADENCE_V3_ZOOM_EXTRA_CATEGORIES,
  GESTURE_TAIL_MS,
  type CadenceGestureStats,
  type CadenceDisplay,
  type CadenceDispatch,
  type CadenceAwakeStart,
  type CadenceZoomV3Stats,
  type CadenceForward,
  type CadenceEndMarkDiag,
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
  display: CadenceDisplay;
  panClockMaxDevMs: number;
  zoomClockMaxDevMs: number;
  vsyncSeqMs: number | null;
  zoomV2Extra?: {
    dispatch: CadenceDispatch;
    awake_start: CadenceAwakeStart;
    answered_by_prior_frame: number;
    forward: CadenceForward;
    diag: CadenceRunDiag;
  } | null;
};

/** DIAG-only per-run numbers. Never part of a receipt.
 *  `zoom_first_lat_ms` is the latency of the FIRST in-window input (input 0)
 *  and is `null` when no frame answers it; it prints as "null", never NaN.
 *  The two end-mark fields come from FIX 3 (no barrier between the last send
 *  and the end mark) and let the parent see whether a wheel mark ever landed
 *  after the end mark. */
type CadenceRunDiag = CadenceEndMarkDiag & {
  zoom_first_lat_ms: number | null;
  zoom_rest_lat_min_ms: number;
  zoom_rest_lat_max_ms: number;
  zoom_answered_lt2ms: number;
  /** q03b-v3 DIAG: wheel 0's stamp-to-forward delay (null without a forward)
   *  and wheel 0's mark-anchored (v2-definition) latency, so the parent can
   *  see how much of the v2 first-wheel number was the CDP wait. */
  zoom_first_stamp_to_forward_ms: number | null;
  zoom_first_mark_lat_ms: number | null;
};

/** The zoom protocol every receipt of this bench is built and validated
 *  under. q03b-v3 anchors zoom latency at the Browser-process wheel forward;
 *  pan is unchanged. */
const CADENCE_PROTOCOL = "q03b-v3" as const;

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
 * bare `unknown` or other escape hatch.
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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A latency prints as "null" when the first in-window input was never
 *  answered; it must never print as NaN. */
function fmtLatMs(v: number | null | undefined): string {
  return v == null ? "null" : String(round3(v));
}

async function waitReady(page: Page): Promise<void> {
  const { attempts } = await waitBenchReady(page, { timeoutMs: 120_000 });
  // Ruling (docs/chart-engine-completion/bench.md): the only stdout line an INVALID
  // attempt may produce is CADENCE_INVALID. Readiness runs before validity is known,
  // so the retry diagnostic goes to the bench log file, like the pre-validity
  // devicePixelRatio line.
  if (attempts > 1)
    appendLog(
      path.join(OUT_DIR, `cadence-${COMMIT.slice(0, 12)}-${HOST}.log`),
      `BENCH_READY_RETRY attempts=${attempts}`,
    );
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
 * Install a capture-phase listener on `document` that records one
 * `performance.mark(name, { startTime: ev.timeStamp })` per coalesced event.
 * For PointerEvents with non-empty `getCoalescedEvents()` we record each
 * coalesced entry separately; otherwise one mark on the event itself. The
 * remover lives on `window` under a bench-only key and `removeInputMarks`
 * calls it. Stored globally so the listener survives the function returning.
 */
async function installInputMarks(page: Page, gesture: "pan" | "zoom"): Promise<void> {
  await page.evaluate((g: string) => {
    type MinimalEv = { timeStamp: number; getCoalescedEvents?: () => ReadonlyArray<{ timeStamp: number }> };
    type MinimalDoc = { addEventListener(name: string, fn: (e: MinimalEv) => void, opts: { capture: boolean; passive: boolean }): void };
    type WindowSlot = { __cadenceInputMarksRemover?: () => void };
    const win = window as unknown as WindowSlot;
    const name = `cadence:${g}:input`;
    const handler = (ev: MinimalEv) => {
      const coalesced = ev.getCoalescedEvents?.() ?? [];
      if (coalesced.length > 0) {
        for (const c of coalesced) {
          performance.mark(name, { startTime: c.timeStamp });
        }
      } else {
        performance.mark(name, { startTime: ev.timeStamp });
      }
    };
    const events: string[] = g === "pan" ? ["pointermove", "mousemove"] : ["wheel"];
    const doc = document as unknown as MinimalDoc;
    for (const evt of events) {
      doc.addEventListener(evt, handler, { capture: true, passive: true });
    }
    win.__cadenceInputMarksRemover = () => {
      for (const evt of events) {
        document.removeEventListener(evt, handler, { capture: true });
      }
      delete win.__cadenceInputMarksRemover;
    };
  }, gesture);
}

async function removeInputMarks(page: Page): Promise<void> {
  await page.evaluate(() => {
    type WindowSlot = { __cadenceInputMarksRemover?: () => void };
    const win = window as unknown as WindowSlot;
    win.__cadenceInputMarksRemover?.();
  });
}

/**
 * Start a CDP trace covering only the two frame-reporter + user_timing
 * categories (plus `extraCategories`: the q03b-v3 zoom trace adds "input" for
 * the Browser-process wheel forward), run `body`, then collect via the `Tracing.dataCollected` event
 * stream (transferMode: "ReportEvents"). When the browser emits
 * `Tracing.tracingComplete`, all events have been delivered.
 */
async function captureTrace<T>(
  context: BrowserContext,
  page: Page,
  label: string,
  body: () => Promise<T>,
  extraCategories: readonly string[] = [],
): Promise<{ value: T; events: unknown[] }> {
  const cdp = await context.newCDPSession(page);
  // Cast through unknown to the actual runtime shape (see TraceEventSession).
  const trace = cdp as unknown as TraceEventSession;
  const traceConfig = {
    includedCategories: [
      "disabled-by-default-devtools.timeline.frame",
      "blink.user_timing",
      ...extraCategories,
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
    try {
      await page.waitForTimeout(250);
      await trace.send("Tracing.end");
      // Bound the wait: Tracing.tracingComplete should arrive within ~hundreds
      // of ms after Tracing.end. 30 s is a hard wall so a stuck CDP session
      // cannot hang the bench forever. The timer is cleared on success so it
      // never fires spuriously.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`INVALID: Tracing.tracingComplete not received within 30 s (${label})`)), 30_000);
      });
      try {
        await Promise.race([complete, timedOut]);
      } finally {
        if (timer != null) clearTimeout(timer);
      }
    } finally {
      // Teardown on EVERY path: the 30 s timeout and a Tracing.end rejection
      // both propagate out of the block above, so without this inner finally
      // the stuck session that F6 exists to bound would still leak its two
      // listeners and its CDPSession.
      trace.off("Tracing.dataCollected", onData);
      trace.off("Tracing.tracingComplete", onEnd);
      // CDPSession.detach exists; the structural type narrows the union.
      await (cdp as CDPSession).detach().catch(() => undefined);
    }
  }
  return { value, events: asTraceEvents({ traceEvents: collected }) };
}

async function panGesture(
  context: BrowserContext,
  page: Page,
  center: { x: number; y: number },
  impl: EngineImpl,
  runIdx: number,
): Promise<{ stats: CadenceGestureStats; events: unknown[]; rangeBefore: VisibleSpan; rangeAfter: VisibleSpan; presentedMs: number[]; clockMaxDevMs: number; seqIntervals: number[] }> {
  const rangeBefore = await readRange(page);
  const { events } = await captureTrace(context, page, "pan", async () => {
    await page.mouse.move(center.x, center.y);
    await page.waitForTimeout(200);
    await installInputMarks(page, "pan");
    try {
      await page.evaluate((n: string) => performance.mark(n), "cadence:pan:start");
      await page.mouse.down();
      await page.mouse.move(center.x + 1600, center.y, { steps: 200 });
      await page.mouse.up();
      await page.evaluate((n: string) => performance.mark(n), "cadence:pan:end");
    } finally {
      await removeInputMarks(page).catch(() => undefined);
    }
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
  const baseStats = gestureStats(parsed, startMs, endMs, 200);
  // B4: window must hold >= 2 presented frames, else INVALID.
  if (baseStats.presented < 2) {
    throw new Error(`INVALID: fewer than 2 presented frames in the pan window (${impl})`);
  }
  // Per-input latency + clock check.
  const rawMarks = userTimingAllMs(events, `cadence:pan:input`, parsed.rendererPid);
  const pageEntries = await page.evaluate(() =>
    performance.getEntriesByName(`cadence:pan:input`, "mark").map((e: { startTime: number }) => e.startTime),
  );
  const clock = checkInputMarkClock(rawMarks, pageEntries);
  if (!clock.ok) {
    writeTrace(events, impl, runIdx, "pan");
    throw new Error(`INVALID: input-mark clock check failed (${impl} pan): ${clock.reason}`);
  }
  let latency;
  try {
    latency = inputLatencyStats(parsed, rawMarks, startMs, endMs);
  } catch (err) {
    writeTrace(events, impl, runIdx, "pan");
    throw new Error(`INVALID: no input marks in the pan window (${impl}): ${(err as Error).message}`);
  }
  const stats: CadenceGestureStats = { ...baseStats, ...latency };
  if (DUMP_TRACE) writeTrace(events, impl, runIdx, "pan");
  return { stats, events, rangeBefore, rangeAfter, presentedMs: parsed.presentedMs, clockMaxDevMs: clock.maxDeviationMs, seqIntervals: frameSequenceIntervals(events, parsed.rendererPid) };
}

async function zoomGesture(
  context: BrowserContext,
  page: Page,
  center: { x: number; y: number },
  impl: EngineImpl,
  runIdx: number,
): Promise<{
  stats: CadenceGestureStats;
  zoomV2: {
    dispatch: CadenceDispatch;
    awake_start: CadenceAwakeStart;
    answered_by_prior_frame: number;
    forward: CadenceForward;
    diag: CadenceRunDiag;
  } | null;
  events: unknown[];
  rangeBefore: VisibleSpan;
  rangeAfter: VisibleSpan;
  presentedMs: number[];
  clockMaxDevMs: number;
  seqIntervals: number[];
}> {
  const rangeBefore = await readRange(page);
  const heartbeatMode: "through" | "until-first-input" =
    process.env.BENCH_HEARTBEAT_MODE === "until-first-input" ? "until-first-input" : "through";
  const isIdle200Control = process.env.BENCH_AWAKE_START === "idle200";

  // Move the cursor to center BEFORE installing the input-mark listener so
  // mouse-move events at center do not also produce an extra wheel event.
  await page.mouse.move(center.x, center.y);
  await installInputMarks(page, "zoom");

  // Install the harness-side rAF heartbeat (v2) OR the diagnostic
  // idle-200 sentinel. The heartbeat install time is stashed on a
  // bench-only window slot; the start-mark eval reads it to compute
  // `heartbeat_ms`. The remover also lives on the slot. The
  // "until-first-input" mode adds a capture+passive document "wheel"
  // listener that cancels the pending rAF on the first wheel event.
  //
  // The mode travels as the page.evaluate ARGUMENT. A page callback may
  // only touch its argument, browser globals and its own locals: reading
  // the Node-side `heartbeatMode` binding here made every non-control run
  // die with `page.evaluate: ReferenceError: heartbeatMode is not defined`.
  let heartbeatInstallMs = 0;
  if (!isIdle200Control) {
    heartbeatInstallMs = await page.evaluate((mode: "through" | "until-first-input") => {
      type Win = Window & {
        __cadenceHeartbeat?: {
          installMs: number;
          mode: "through" | "until-first-input";
          stop: () => void;
        };
      };
      const win = window as unknown as Win;
      const installMs = performance.now();
      let stopped = false;
      let rafId = 0;
      const loop = () => {
        if (stopped) return;
        // Empty-callback rAF heartbeat: the harness keeps the renderer
        // awake without doing any work. The product code itself never sees
        // this loop (the install runs in page.evaluate, not in the engine).
        rafId = requestAnimationFrame(loop);
      };
      // Stopping really stops: cancel the PENDING rAF by id and drop the
      // wheel listener. A flag alone leaves the queued callback to run.
      const stop = () => {
        stopped = true;
        if (rafId !== 0) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        document.removeEventListener("wheel", onWheel, { capture: true });
      };
      const onWheel = () => {
        stop();
      };
      rafId = requestAnimationFrame(loop);
      if (mode === "until-first-input") {
        document.addEventListener("wheel", onWheel, { capture: true, passive: true });
      }
      win.__cadenceHeartbeat = { installMs, mode, stop };
      return installMs;
    }, heartbeatMode);
  }

  // Open a separate CDP session for the 60 wheel Input.dispatchMouseEvent
  // calls. Closing it at the end is a no-op except detaching the session.
  const inputSession = await context.newCDPSession(page);

  let events: unknown[] = [];
  let heartbeatMs = 0;
  let dispatched = 0;
  let dispatchDevMaxMs = 0;
  const seed = cadenceV2Seed(runIdx);
  const offsetsMs = cadenceV2ScheduleMs(seed);

  try {
    const traceResult = await captureTrace(context, page, "zoom", async () => {
      // Traced lead-in (250 ms); either the rAF heartbeat covers this
      // window (v2) or the bench just waits (idle-200 control). The
      // page.waitForTimeout is a documented BENCH-side action; the rule
      // "no spin or timer loop in the page" is about pollers installed
      // IN the page for measurement purposes, not this one-shot wait.
      await page.waitForTimeout(250);
      // Start mark: the eval also returns heartbeatMs so the bench can
      // carry the awake-start measurement into the receipt.
      const startInfo = await page.evaluate(
        ({ hbInstallArg }: { hbInstallArg: number }) => {
          const win = window as unknown as {
            __cadenceHeartbeat?: { installMs: number };
          };
          const startMs = performance.now();
          performance.mark("cadence:zoom:start");
          const installed = win.__cadenceHeartbeat?.installMs ?? hbInstallArg;
          return { startMs, heartbeatMs: installed > 0 ? startMs - installed : 0 };
        },
        { hbInstallArg: heartbeatInstallMs },
      );
      heartbeatMs = startInfo.heartbeatMs;

      // Wait, spin, fire. The Node-clock schedule is engine-independent.
      // `performance.now()` is the Node high-resolution clock: Date.now()
      // counts whole milliseconds and produced dispatch devs of 1 / 2 /
      // 0.963 / 7.963 ms on the headed reference run.
      const dispatch = await dispatchOnSchedule(offsetsMs, {
        nowMs: () => performance.now(),
        waitUntilMs: async (target: number) => {
          // Wake about 2 ms early then spin on the Node clock to land on
          // the target. No polling inside the page, ever.
          await new Promise((r) => setTimeout(r, Math.max(0, target - 2 - performance.now())));
          while (performance.now() < target) { /* spin */ }
        },
        // The RAW CDP send promise. `.then(() => true, () => false)` turned
        // every rejection into a fulfilment, so `dispatched` counted 60
        // even when a send had failed.
        send: () =>
          inputSession.send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: center.x,
            y: center.y,
            modifiers: 0,
            deltaX: 0,
            deltaY: -120,
          }),
      });
      dispatchDevMaxMs = dispatch.devMaxMs;

      // NO barrier between the last send and the end mark. Chromium stamps
      // an Input.dispatchMouseEvent when the browser processes the command,
      // which happens before it processes this later Runtime.evaluate on
      // the same connection; installInputMarks writes each mark with
      // `performance.mark(name, { startTime: ev.timeStamp })`, and
      // captureTrace keeps tracing 250 ms past the body, so a late
      // handler's mark still lands in the trace at its earlier startTime.
      // Should that reasoning ever fail, input_marks drops below 60 and
      // INVALID rule 1 discards and repeats the run; zoom_marks_after_end
      // below is the diagnostic that would show it.
      await page.evaluate((n: string) => performance.mark(n), "cadence:zoom:end");

      // "through" means the heartbeat runs THROUGH the end mark, so it is
      // stopped right after the end-mark evaluate. The finally block below
      // keeps an idempotent cleanup stop.
      if (!isIdle200Control && heartbeatMode === "through") {
        await benchEval(page, () => (window as unknown as { __cadenceHeartbeat?: { stop: () => void } }).__cadenceHeartbeat?.stop());
      }

      // All dispatch promises are awaited AFTER the end mark.
      dispatched = await countDispatched(dispatch.sendPromises);
      return true;
    }, CADENCE_V3_ZOOM_EXTRA_CATEGORIES);
    events = traceResult.events;
  } finally {
    // Cleanup: stop heartbeat (idempotent; through mode already stopped),
    // remove input marks, detach the input session. Errors here are
    // swallowed: the bench treats them as warnings and the run is
    // considered done.
    if (!isIdle200Control) {
      await benchEval(page, () => (window as unknown as { __cadenceHeartbeat?: { stop: () => void } }).__cadenceHeartbeat?.stop()).catch(() => undefined);
    }
    await removeInputMarks(page).catch(() => undefined);
    await inputSession.detach().catch(() => undefined);
  }

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
  const baseStats = gestureStats(parsed, startMs, endMs, CADENCE_V2_WHEELS);
  if (baseStats.presented < 2) {
    throw new Error(`INVALID: fewer than 2 presented frames in the zoom window (${impl})`);
  }
  const rawMarks = userTimingAllMs(events, `cadence:zoom:input`, parsed.rendererPid);
  const pageEntries = await page.evaluate(() =>
    performance.getEntriesByName(`cadence:zoom:input`, "mark").map((e: { startTime: number }) => e.startTime),
  );
  const clock = checkInputMarkClock(rawMarks, pageEntries);
  if (!clock.ok) {
    writeTrace(events, impl, runIdx, "zoom");
    throw new Error(`INVALID: input-mark clock check failed (${impl} zoom): ${clock.reason}`);
  }
  // q03b-v3: each wheel is anchored at its Browser-process forward, paired
  // index-for-index with the in-window marks. A missing or unprovable pairing
  // leaves rows unpresented / forward.paired short, which the validator turns
  // into an INVALID (q03b-v3) run.
  const pairing = pairWheelForwards(rawMarks, wheelForwardsMs(events), startMs, endMs);
  let latRows;
  let latency;
  try {
    latRows = forwardLatenciesMs(parsed, pairing, endMs);
    latency = forwardLatencyStats(latRows);
  } catch (err) {
    writeTrace(events, impl, runIdx, "zoom");
    throw new Error(`INVALID: no input marks in the zoom window (${impl}): ${(err as Error).message}`);
  }
  const stats: CadenceGestureStats = { ...baseStats, ...latency };
  const forwardBlock = cadenceForwardBlock(pairing);

  // The per-input detail rows for the diag values. The latency of input 0
  // (wheel-0) is reported on its own; wheels 1..59 contribute min/max.
  const realLats = latRows.map((r) => r.latencyMs).filter((v): v is number => v != null);
  // zoom_first_lat_ms is the latency of the FIRST in-window input (input 0)
  // even when it is null — taking the first NON-null latency silently
  // redefined "wheel 0" as "wheel k" whenever wheel 0 went unanswered.
  const firstRow = latRows[0];
  const zoomFirstLat = firstRow == null ? null : firstRow.latencyMs;
  const zoomRestLats = latRows.slice(1).map((r) => r.latencyMs).filter((v): v is number => v != null);
  const zoomRestMin = zoomRestLats.length > 0 ? Math.min(...zoomRestLats) : Number.NaN;
  const zoomRestMax = zoomRestLats.length > 0 ? Math.max(...zoomRestLats) : Number.NaN;
  const zoomAnsweredLt2ms = realLats.filter((v) => v < 2).length;
  // DIAG-only: wheel 0 under the v2 (mark-anchored) definition.
  const firstMarkAnswer = firstRow == null
    ? null
    : (parsed.presentedMs.find((p) => p >= firstRow.markMs && p <= endMs + GESTURE_TAIL_MS) ?? null);
  const zoomFirstMarkLat = firstRow == null || firstMarkAnswer == null ? null : firstMarkAnswer - firstRow.markMs;
  const zoomFirstStampToForward = firstRow == null || firstRow.forwardMs == null ? null : firstRow.forwardMs - firstRow.markMs;

  // Build the zoom protocol blocks (always computed; the bench serializes a
  // q03b-v3 receipt for both engines unless BENCH_AWAKE_START=idle200).
  const spans = parsePresentedFrameSpans(events);
  const answeredByPriorFrameCount = forwardAnsweredByPriorFrame(spans, latRows);
  // The lead-in window ends at the FIRST de-duplicated in-window mark, which
  // is latRows[0].markMs (rawMarks is the un-deduplicated trace order). The
  // heartbeat lead-in rule stays mark-based in v3.
  const firstInputMarkMs = firstRow == null ? null : firstRow.markMs;
  const leadinCount = leadinPresentations(parsed.presentedMs, startMs, firstInputMarkMs);

  // End-mark diagnostics (DIAG-only; never in the receipt). With no barrier
  // between the last send and the end mark these two numbers are how the
  // parent sees whether the ordering assumption held: a wheel mark after the
  // end mark, or an end mark ~1000 ms past the last wheel, would both show up
  // here.
  const dedupMarks = Array.from(new Set(rawMarks)).sort((a, b) => a - b);
  const zoomMarksAfterEnd = dedupMarks.filter((m) => m > endMs).length;
  const marksUpToEnd = dedupMarks.filter((m) => m <= endMs);
  // The `?? endMs` fallback is unreachable: forwardLatenciesMs above already
  // threw when the window held no mark, and every latRow mark is <= endMs.
  const lastMarkUpToEnd = marksUpToEnd[marksUpToEnd.length - 1] ?? endMs;
  const zoomEndMinusLastMarkMs = round3(endMs - lastMarkUpToEnd);

  const dispatchBlock: CadenceDispatch = {
    gap_min_ms: 17,
    gap_jitter_ms: 6,
    seed,
    scheduled: CADENCE_V2_WHEELS,
    dispatched,
    dispatch_dev_max_ms: round3(dispatchDevMaxMs),
  };
  const awakeStartBlock: CadenceAwakeStart = {
    heartbeat_ms: round3(heartbeatMs),
    heartbeat_mode: heartbeatMode,
    leadin_presentations: leadinCount,
  };

  const zoomV2 = {
    dispatch: dispatchBlock,
    awake_start: awakeStartBlock,
    answered_by_prior_frame: answeredByPriorFrameCount,
    forward: forwardBlock,
    diag: {
      zoom_first_lat_ms: zoomFirstLat == null ? null : round3(zoomFirstLat),
      zoom_first_stamp_to_forward_ms: zoomFirstStampToForward == null ? null : round3(zoomFirstStampToForward),
      zoom_first_mark_lat_ms: zoomFirstMarkLat == null ? null : round3(zoomFirstMarkLat),
      zoom_rest_lat_min_ms: Number.isFinite(zoomRestMin) ? round3(zoomRestMin) : 0,
      zoom_rest_lat_max_ms: Number.isFinite(zoomRestMax) ? round3(zoomRestMax) : 0,
      zoom_answered_lt2ms: zoomAnsweredLt2ms,
      zoom_marks_after_end: zoomMarksAfterEnd,
      zoom_end_minus_last_mark_ms: zoomEndMinusLastMarkMs,
    } satisfies CadenceRunDiag,
  };

  if (DUMP_TRACE) writeTrace(events, impl, runIdx, "zoom");
  return { stats, zoomV2, events, rangeBefore, rangeAfter, presentedMs: parsed.presentedMs, clockMaxDevMs: clock.maxDeviationMs, seqIntervals: frameSequenceIntervals(events, parsed.rendererPid) };
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
  // Measured vsync is one number per run, derived from the union of presented
  // intervals across both gestures. It MUST NOT be computed across the trace
  // boundary (an interval from the last pan presentation to the first zoom
  // presentation would be a pure idle gap).
  const display = measureVsync([...presentedIntervals(pan.presentedMs), ...presentedIntervals(zoom.presentedMs)]);
  // Input-independent vsync cross-check: mode of (begin-time diff / frame_sequence diff)
  // across both gestures. NOT part of the receipt; printed on the diagnostic line as
  // vsync_seq_ms. When inputs arrive slower than refreshes, the cross-check is the
  // true per-slot reading and the receipt's vsync_ms is a multiple of it.
  let vsyncSeqMs: number | null = null;
  try {
    vsyncSeqMs = measureVsync([...pan.seqIntervals, ...zoom.seqIntervals]).vsync_ms;
  } catch {
    vsyncSeqMs = null;
  }
  return {
    pan: pan.stats,
    zoom: zoom.stats,
    display,
    panClockMaxDevMs: pan.clockMaxDevMs,
    zoomClockMaxDevMs: zoom.clockMaxDevMs,
    vsyncSeqMs,
    zoomV2Extra: zoom.zoomV2,
  };
}

// The per-run receipt is built inline in the test loop (every run can
// be either v1 or v2 protocol); perRunReceipt() lived above in v1 only
// and has been removed in favor of the v2-aware inline builder.

test("chart-engine presented-frame cadence protocol (Q03)", async ({ browser }) => {
  expect(COMMIT, "git rev-parse HEAD must be 40 hex").toMatch(/^[0-9a-f]{40}$/);
  ensureOutDir();
  const logFile = path.join(OUT_DIR, `cadence-${COMMIT.slice(0, 12)}-${HOST}.log`);
  appendLog(logFile, `commit=${COMMIT} host=${HOST} runs=${RUNS} impls=${IMPLS.join(",")} enforce=${ENFORCE ? 1 : 0}`);

  try {
    for (const impl of IMPLS) {
      const runs: RunStats[] = [];
      const file = receiptPathFor(impl);
      const isIdle200Control = process.env.BENCH_AWAKE_START === "idle200";
      const heartbeatMode: "through" | "until-first-input" =
        process.env.BENCH_HEARTBEAT_MODE === "until-first-input" ? "until-first-input" : "through";

      for (let i = 0; i < RUNS; i++) {
        let attempt = 0;
        let validAttempt: RunStats | null = null;
        const invalidAttempts: Array<{ attempt: number; errors: string[] }> = [];
        const MAX_INVALID_ATTEMPTS = 3;
        while (validAttempt == null && attempt < MAX_INVALID_ATTEMPTS) {
          attempt += 1;
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
            appendLog(logFile, `[${impl}] run ${i + 1}/${RUNS} attempt=${attempt} window.devicePixelRatio=${dpr}`);
            expect(
              dpr,
              `INVALID: dpr ${dpr} must equal ${DPR} (every cadence number is scale-dependent)`,
            ).toBe(DPR);
            await page.mouse.move(10, 10);
            const stats = await runGesture(context, page, impl, i);

            // idle200 control mode: only print the CADENCE_CONTROL diag
            // line, no receipt.
            if (isIdle200Control) {
              const ctrlDiag = stats.zoomV2Extra?.diag;
              const ctrlLine = `CADENCE_CONTROL ${impl} run=${i + 1} awake_start=idle200 seed=${cadenceV2Seed(i)} input_marks=${stats.zoom.input_marks} dispatched=${stats.zoomV2Extra?.dispatch.dispatched ?? 0} dispatch_dev_max_ms=${stats.zoomV2Extra ? round3(stats.zoomV2Extra.dispatch.dispatch_dev_max_ms) : 0} heartbeat_mode=none heartbeat_ms=0 leadin_presentations=${stats.zoomV2Extra?.awake_start.leadin_presentations ?? 0} answered_by_prior_frame=${stats.zoomV2Extra?.answered_by_prior_frame ?? 0} zoom_first_lat_ms=${fmtLatMs(ctrlDiag?.zoom_first_lat_ms)} zoom_rest_lat_min_ms=${ctrlDiag?.zoom_rest_lat_min_ms ?? 0} zoom_rest_lat_max_ms=${ctrlDiag?.zoom_rest_lat_max_ms ?? 0} zoom_answered_lt2ms=${ctrlDiag?.zoom_answered_lt2ms ?? 0} zoom_marks_after_end=${ctrlDiag?.zoom_marks_after_end ?? 0} zoom_end_minus_last_mark_ms=${ctrlDiag ? round3(ctrlDiag.zoom_end_minus_last_mark_ms) : 0}`;
              console.log(ctrlLine);
              appendLog(logFile, `[${impl}] run ${i + 1} ${ctrlLine}`);
              validAttempt = stats;
              runs.push(stats);
              continue;
            }

            // Build a q03b-v3 receipt (the protocol is hard-coded in
            // CADENCE_PROTOCOL; idle200 skips this path).
            const zoomV3Stats = stats.zoomV2Extra
              ? ({
                  ...stats.zoom,
                  dispatch: stats.zoomV2Extra.dispatch,
                  awake_start: stats.zoomV2Extra.awake_start,
                  answered_by_prior_frame: stats.zoomV2Extra.answered_by_prior_frame,
                  forward: stats.zoomV2Extra.forward,
                } as CadenceZoomV3Stats)
              : (stats.zoom as CadenceZoomV3Stats);
            const r = buildCadenceReceipt({
              commit: COMMIT,
              impl,
              host: { os: OS_LABEL, cpu: CPU, dpr: DPR },
              display: stats.display,
              generated_at: new Date().toISOString(),
              pan: stats.pan,
              zoom: zoomV3Stats,
              protocol: CADENCE_PROTOCOL,
            });
            // Validate BEFORE printing anything. An INVALID run is repeated,
            // never counted and never read, so not one of its latency /
            // cadence / percentile / answered numbers may reach stdout or the
            // log file. Only the CADENCE_INVALID line below is allowed.
            const valid = validateCadenceReceipt(r);
            if (valid.ok) {
              const line = `CADENCE ${impl} commit=${COMMIT} pan_p95=${round1(stats.pan.p95_ms)} pan_p99=${round1(stats.pan.p99_ms)} zoom_p95=${round1(stats.zoom.p95_ms)} zoom_p99=${round1(stats.zoom.p99_ms)} pan_lat_p95=${round1(stats.pan.input_to_present_p95_ms)} pan_lat_p99=${round1(stats.pan.input_to_present_p99_ms)} zoom_lat_p95=${round1(stats.zoom.input_to_present_p95_ms)} zoom_lat_p99=${round1(stats.zoom.input_to_present_p99_ms)} vsync_ms=${round1(stats.display.vsync_ms)} presented=${stats.pan.presented} partial=${stats.pan.partial} dropped=${stats.pan.dropped} input_hz=${round1(stats.pan.input_hz)} budget_ok=${r.budget_ok} violations=${r.violations.length} file=${file}`;
              console.log(line);
              appendLog(logFile, `[${impl}] run ${i + 1} attempt=${attempt} ${line}`);

              // Diagnostic line (zoom protocol fields): never in the receipt.
              const floor = (hz: number) => (hz > 0 ? round1(1000 / hz) : 0);
              const perInput = (st: CadenceGestureStats) => (st.inputs > 0 ? round1(st.presented / st.inputs) : 0);
              const v2 = stats.zoomV2Extra;
              const diagBase = `pan_input_hz=${round1(stats.pan.input_hz)} pan_input_floor_ms=${floor(stats.pan.input_hz)} pan_presented_per_input=${perInput(stats.pan)} zoom_input_hz=${round1(stats.zoom.input_hz)} zoom_input_floor_ms=${floor(stats.zoom.input_hz)} zoom_presented_per_input=${perInput(stats.zoom)} pan_input_marks=${stats.pan.input_marks} pan_unpresented=${stats.pan.input_unpresented} zoom_input_marks=${stats.zoom.input_marks} zoom_unpresented=${stats.zoom.input_unpresented} hz=${stats.display.hz} vsync_seq_ms=${stats.vsyncSeqMs == null ? "unmeasured" : round1(stats.vsyncSeqMs)} pan_clock_dev_ms=${round3(stats.panClockMaxDevMs)} zoom_clock_dev_ms=${round3(stats.zoomClockMaxDevMs)}`;
              const v2Extras = v2
                ? ` zoom_protocol=${CADENCE_PROTOCOL} seed=${v2.dispatch.seed} scheduled=${v2.dispatch.scheduled} dispatched=${v2.dispatch.dispatched} dispatch_dev_max_ms=${round3(v2.dispatch.dispatch_dev_max_ms)} heartbeat_mode=${v2.awake_start.heartbeat_mode} heartbeat_ms=${round3(v2.awake_start.heartbeat_ms)} leadin_presentations=${v2.awake_start.leadin_presentations} answered_by_prior_frame=${v2.answered_by_prior_frame} zoom_answered_lt2ms=${v2.diag.zoom_answered_lt2ms} zoom_first_lat_ms=${fmtLatMs(v2.diag.zoom_first_lat_ms)} zoom_rest_lat_min_ms=${v2.diag.zoom_rest_lat_min_ms} zoom_rest_lat_max_ms=${v2.diag.zoom_rest_lat_max_ms} zoom_marks_after_end=${v2.diag.zoom_marks_after_end} zoom_end_minus_last_mark_ms=${round3(v2.diag.zoom_end_minus_last_mark_ms)} forwards=${v2.forward.forwards} paired=${v2.forward.paired} stamp_to_forward_min_ms=${round3(v2.forward.stamp_to_forward_min_ms)} stamp_to_forward_p50_ms=${round3(v2.forward.stamp_to_forward_p50_ms)} stamp_to_forward_max_ms=${round3(v2.forward.stamp_to_forward_max_ms)} zoom_first_stamp_to_forward_ms=${fmtLatMs(v2.diag.zoom_first_stamp_to_forward_ms)} zoom_first_mark_lat_ms=${fmtLatMs(v2.diag.zoom_first_mark_lat_ms)}`
                : "";
              const diag = `CADENCE_DIAG ${impl} run=${i + 1} ${diagBase}${v2Extras}`;
              console.log(diag);
              appendLog(logFile, `[${impl}] run ${i + 1} attempt=${attempt} ${diag}`);

              validAttempt = stats;
              runs.push(stats);
            } else {
              const invalidOnly = valid.errors.filter((e) => e.startsWith(`INVALID (${CADENCE_PROTOCOL}):`));
              if (invalidOnly.length === valid.errors.length && invalidOnly.length > 0) {
                // Per ruling: an INVALID run is repeated, never counted and
                // never read. The formatter prints no latency number at all.
                const inv = cadenceInvalidLine(
                  impl,
                  i + 1,
                  attempt,
                  r,
                  stats.zoomV2Extra?.diag ?? { zoom_marks_after_end: 0, zoom_end_minus_last_mark_ms: 0 },
                  invalidOnly,
                );
                console.log(inv);
                appendLog(logFile, `[${impl}] run ${i + 1} attempt=${attempt} ${inv}`);
                invalidAttempts.push({ attempt, errors: invalidOnly });
              } else {
                throw new Error(`receipt for ${impl} failed validation:\n${valid.errors.join("\n")}`);
              }
            }
          } finally {
            await page.close().catch(() => undefined);
            await context.close().catch(() => undefined);
          }
        }
        if (validAttempt == null) {
          throw new Error(
            `INVALID (${CADENCE_PROTOCOL}): ${impl} run ${i + 1} exhausted ${MAX_INVALID_ATTEMPTS} attempts (last errors: ${invalidAttempts[invalidAttempts.length - 1]?.errors.join("|") ?? "none"})`,
          );
        }
      }

      // idle200 control: no median, no receipt. Stop here.
      if (isIdle200Control) {
        continue;
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
      const zoomV3Median = medianRun.zoomV2Extra
        ? ({
            ...medianRun.zoom,
            dispatch: medianRun.zoomV2Extra.dispatch,
            awake_start: medianRun.zoomV2Extra.awake_start,
            answered_by_prior_frame: medianRun.zoomV2Extra.answered_by_prior_frame,
            forward: medianRun.zoomV2Extra.forward,
          } as CadenceZoomV3Stats)
        : (medianRun.zoom as CadenceZoomV3Stats);
      const receipt = buildCadenceReceipt({
        commit: COMMIT,
        impl,
        host: { os: OS_LABEL, cpu: CPU, dpr: DPR },
        display: medianRun.display,
        generated_at: new Date().toISOString(),
        pan: medianRun.pan,
        zoom: zoomV3Median,
        protocol: CADENCE_PROTOCOL,
      });
      const valid = validateCadenceReceipt(receipt);
      if (!valid.ok) {
        throw new Error(`receipt for ${impl} failed validation:\n${valid.errors.join("\n")}`);
      }
      fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
      const medianLine = `CADENCE_MEDIAN ${impl} run=${medianPick!.idx + 1} pan_p95=${round1(medianRun.pan.p95_ms)} file=${file} heartbeat_mode=${heartbeatMode}`;
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