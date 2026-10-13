/**
 * Q03C-D2 first-input latency diagnostic harness (NOT a receipt).
 *
 * Goal: decide between the four hypotheses for the FIRST-input p99 elevation
 * observed in the Q03c headed run (mm 37.4 / 37.2 / 32.8 ms; lwc 35.4 / 38.4
 * / 35.1 ms; budget 33.4 ms). The protocol is byte-identical to the official
 * `chart-engine.cadence.bench.ts` for the V0 baseline; F1..F5 change exactly
 * one thing each. Never page.clock. Never edit the official spec, receipt.ts,
 * corpus.ts, cadence.ts, the budgets, the corpus or run counts.
 *
 * V0  BASELINE: official pan and zoom, both engines.
 * F1  BARE PAGE: bare-wheel.html with capture-phase input-mark listener and
 *                same zoom gesture. Two sub-variants (passive=1, passive=0);
 *                pan sub-variant for the pan-first-input question.
 * F2  WARM-UP BEFORE TRACING: one mouse.wheel + a short drag BEFORE
 *                Tracing.start, then the unchanged traced gesture.
 * F3  IDLE DOSE-RESPONSE: vary only the idle wait before the first measured
 *                input: 0, 16, 50, 100, 200, 500 ms for zoom; 0 and 200 for pan.
 * F4  TIMESTAMP CHECK: compare the page-side input mark (ev.timeStamp on the
 *                trace clock) with the browser/renderer input timestamps in
 *                the trace; node-side process.hrtime around each input.
 * F5  MAIN-THREAD TASK DUMP: list renderer main-thread top-level tasks from
 *                5 ms before the first input to its presentation for V0 zoom
 *                and pan, both engines, and the same for input 5.
 */

import { test, expect, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parsePresentedFrames,
  userTimingAllMs,
  userTimingMs,
  asTraceEvents,
  type ParsedPresentation,
} from "../../lib/chart-engine/bench/cadence";
import { execSync } from "node:child_process";

type EngineImpl = "mm" | "lwc";

const COMMIT = execSync("git rev-parse HEAD", {
  encoding: "utf8",
  cwd: path.resolve(__dirname, "..", "..", ".."),
}).trim();

const HOST = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-");
const CPU = `${os.cpus().length} x ${os.cpus()[0]?.model ?? "unknown"}`;
const OS_LABEL = `${os.type()} ${os.release()}`;
const DPR = 2;

const IMPL_ORDER: EngineImpl[] = (process.env.D2_IMPLS ?? "mm,lwc").split(",").filter((s): s is EngineImpl => s === "mm" || s === "lwc") as EngineImpl[];
if (IMPL_ORDER.length === 0) IMPL_ORDER.push("mm", "lwc");

const RUNS_PER_VARIANT_IMPL = Math.max(1, Number(process.env.D2_RUNS ?? 5));
const TRACE_OUT = process.env.D2_TRACE_OUT
  ?? path.resolve(os.homedir(), "lanes", "wt", `d2-traces-${process.env.RUN_ID ?? "ce-q03c-d2diag2-1013"}`);

// Trace categories beyond the official "disabled-by-default-devtools.timeline.frame"
// + "blink.user_timing" pair. Drop one if Tracing.start throws.
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
  "renderer.scheduler",
];

interface TraceDataCollectedPayload { value?: unknown[]; }
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

function round1(n: number): number { return Math.round(n * 10) / 10; }

async function benchEval<T>(page: Page, fn: () => T | Promise<T>): Promise<T> {
  return page.evaluate(fn as () => T);
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __mmBench?: { ready: Promise<void> } }).__mmBench),
    { timeout: 120_000 },
  );
  await page.evaluate(() => (window as unknown as { __mmBench: { ready: Promise<void> } }).__mmBench.ready);
}

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
 * Capture a CDP trace with F1..F5 categories. The body callback runs inside
 * Tracing.start/Tracing.end. Drop categories one at a time if Tracing.start
 * throws. Returned `effectiveCategories` is the set that worked.
 */
async function captureTrace<T>(
  context: BrowserContext,
  page: Page,
  label: string,
  categories: readonly string[],
  body: () => Promise<T>,
): Promise<{ value: T; events: unknown[]; effectiveCategories: readonly string[] }> {
  const cdp = await context.newCDPSession(page);
  const trace = cdp as unknown as TraceEventSession;
  const collected: unknown[] = [];
  let completeResolve: () => void = () => {};
  const complete = new Promise<void>((resolve) => { completeResolve = resolve; });
  const onData = (chunk: TraceDataCollectedPayload) => {
    if (Array.isArray(chunk.value)) for (const ev of chunk.value) collected.push(ev);
  };
  const onEnd = () => completeResolve();
  trace.on("Tracing.dataCollected", onData);
  trace.on("Tracing.tracingComplete", onEnd);

  const base = ["disabled-by-default-devtools.timeline.frame", "blink.user_timing"];
  const extras = categories.filter((c) => !base.includes(c));
  const ordered = [...base, ...extras];
  let lastErr: unknown = null;
  let effective = ordered;
  for (let i = 0; i < ordered.length; i++) {
    const set = ordered.slice(0, ordered.length - i);
    try {
      await trace.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: set } });
      effective = set;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr != null) {
    trace.off("Tracing.dataCollected", onData);
    trace.off("Tracing.tracingComplete", onEnd);
    await (cdp as CDPSession).detach().catch(() => undefined);
    throw lastErr;
  }

  let value: T;
  try {
    value = await body();
  } finally {
    try {
      await page.waitForTimeout(250);
      await trace.send("Tracing.end");
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
      trace.off("Tracing.dataCollected", onData);
      trace.off("Tracing.tracingComplete", onEnd);
      await (cdp as CDPSession).detach().catch(() => undefined);
    }
  }
  return { value, events: asTraceEvents({ traceEvents: collected }), effectiveCategories: effective };
}

/**
 * Open an engine page and wait for its bench hook to be ready.
 */
async function openEnginePage(
  browser: Browser,
  impl: EngineImpl,
): Promise<{ context: BrowserContext; page: Page; center: { x: number; y: number } }> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: DPR,
  });
  const page = await context.newPage();
  await page.goto(`/dev/chart-bench?engine=${impl}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await waitReady(page);
  const dpr = await benchEval(page, () => window.devicePixelRatio);
  if (dpr !== DPR) throw new Error(`INVALID: dpr ${dpr} must equal ${DPR} (impl=${impl})`);
  await page.mouse.move(10, 10);
  const center = await benchEval(page, () => {
    const w = window as unknown as { __mmBench: { plotCenter: () => { x: number; y: number } } };
    return w.__mmBench.plotCenter();
  });
  return { context, page, center };
}

async function openBarePage(
  browser: Browser,
  passive: boolean,
  mode: "wheel" | "pan",
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: DPR,
  });
  const page = await context.newPage();
  const file = path.resolve(__dirname, "bare-wheel.html");
  await page.goto(`file://${file}?passive=${passive ? "1" : "0"}&mode=${mode}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForFunction(() => Boolean((window as unknown as { __bareReady?: Promise<unknown> }).__bareReady));
  await page.mouse.move(10, 10);
  return { context, page };
}

/** Per-input latency: first presented frame at-or-after each mark, in [startMs, endMs+100]. */
function perInputLatencies(parsedMs: number[], marks: number[], startMs: number, endMs: number): number[] {
  const tail = endMs + 100;
  const lat: number[] = [];
  for (const m of marks) {
    if (m < startMs || m > endMs) continue;
    for (const pp of parsedMs) {
      if (pp >= m && pp <= tail) {
        lat.push(pp - m);
        break;
      }
    }
  }
  return lat;
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? Number.NaN;
}

type PerRun = {
  variant: string;
  impl: EngineImpl | "bare";
  run: number;
  panOrZoom: "pan" | "zoom";
  firstMs: number | null;
  restMedianMs: number | null;
  nMarksInWindow: number;
  nLatencies: number;
  inputMarksFirst10: number[];
  presentedFirst10: number[];
  rendererPid: number | null;
  effectiveCategories: readonly string[];
  errors: string[];
};

async function ensureOutDir(): Promise<void> {
  fs.mkdirSync(TRACE_OUT, { recursive: true });
}

function dumpTrace(events: unknown[], variant: string, impl: string, n: number, kind: "pan" | "zoom"): void {
  const file = path.join(TRACE_OUT, `${variant}-${impl}-r${n + 1}-${kind}.json`);
  fs.writeFileSync(file, JSON.stringify({ traceEvents: events }, null, 2) + "\n");
}

async function runZoomGesture(
  context: BrowserContext,
  page: Page,
  center: { x: number; y: number },
  impl: EngineImpl | "bare",
  runIdx: number,
  variant: string,
  preWarm: boolean,
  idleBeforeMs: number,
  dumpTraces: boolean,
): Promise<PerRun> {
  const errors: string[] = [];
  if (preWarm) {
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -120);
    await page.mouse.move(center.x + 50, center.y, { steps: 4 });
    await page.waitForTimeout(50);
  }
  const labels = `${variant}-${impl}-r${runIdx + 1}-zoom`;
  let capRes!: { value: boolean; events: unknown[]; effectiveCategories: readonly string[] };
  try {
    capRes = await captureTrace(context, page, labels, TRACE_CATEGORIES, async () => {
      await page.mouse.move(center.x, center.y);
      if (idleBeforeMs > 0) await page.waitForTimeout(idleBeforeMs);
      await installInputMarks(page, "zoom");
      try {
        await page.evaluate((n: string) => performance.mark(n), "cadence:zoom:start");
        for (let i = 0; i < 60; i++) {
          await page.mouse.wheel(0, -120);
        }
        await page.evaluate((n: string) => performance.mark(n), "cadence:zoom:end");
      } finally {
        await removeInputMarks(page).catch(() => undefined);
      }
      return true;
    });
  } catch (err) {
    errors.push(`captureTrace: ${(err as Error).message}`);
    return {
      variant, impl, run: runIdx, panOrZoom: "zoom", firstMs: null, restMedianMs: null,
      nMarksInWindow: 0, nLatencies: 0, inputMarksFirst10: [], presentedFirst10: [],
      rendererPid: null, effectiveCategories: [], errors,
    };
  }

  if (dumpTraces) dumpTrace(capRes.events, variant, impl, runIdx, "zoom");

  let parsed: ParsedPresentation | null = null;
  try {
    parsed = parsePresentedFrames(capRes.events);
  } catch (err) {
    errors.push(`parsePresentedFrames: ${(err as Error).message}`);
  }
  const startMs = userTimingMs(capRes.events, "cadence:zoom:start");
  const endMs = userTimingMs(capRes.events, "cadence:zoom:end");
  if (startMs == null) errors.push("missing cadence:zoom:start mark");
  if (endMs == null) errors.push("missing cadence:zoom:end mark");

  let inputMarksFirst10: number[] = [];
  let presentedFirst10: number[] = [];
  let rendererPid: number | null = null;
  let lats: number[] = [];
  let nInWindow = 0;
  if (parsed && startMs != null && endMs != null) {
    rendererPid = parsed.rendererPid;
    const marks = userTimingAllMs(capRes.events, "cadence:zoom:input", parsed.rendererPid);
    inputMarksFirst10 = marks.slice(0, 10);
    presentedFirst10 = parsed.presentedMs.slice(0, 10);
    const inWindow = marks.filter((m) => m >= startMs && m <= endMs);
    nInWindow = inWindow.length;
    lats = perInputLatencies(parsed.presentedMs, inWindow, startMs, endMs);
  }
  const first = lats.length > 0 ? (lats[0] ?? null) : null;
  const rest = lats.slice(1);
  const restMed = rest.length > 0 ? median(rest) : null;

  return {
    variant, impl, run: runIdx, panOrZoom: "zoom",
    firstMs: first == null ? null : first,
    restMedianMs: restMed == null || !Number.isFinite(restMed) ? null : restMed,
    nMarksInWindow: nInWindow,
    nLatencies: lats.length,
    inputMarksFirst10,
    presentedFirst10,
    rendererPid,
    effectiveCategories: capRes.effectiveCategories,
    errors,
  };
}

async function runPanGesture(
  context: BrowserContext,
  page: Page,
  center: { x: number; y: number },
  impl: EngineImpl | "bare",
  runIdx: number,
  variant: string,
  preWarm: boolean,
  idleBeforeMs: number,
  dumpTraces: boolean,
): Promise<PerRun> {
  const errors: string[] = [];
  if (preWarm) {
    await page.mouse.move(center.x, center.y);
    await page.mouse.move(center.x + 30, center.y, { steps: 4 });
    await page.waitForTimeout(50);
  }
  const labels = `${variant}-${impl}-r${runIdx + 1}-pan`;
  let capRes!: { value: boolean; events: unknown[]; effectiveCategories: readonly string[] };
  try {
    capRes = await captureTrace(context, page, labels, TRACE_CATEGORIES, async () => {
      await page.mouse.move(center.x, center.y);
      if (idleBeforeMs > 0) await page.waitForTimeout(idleBeforeMs);
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
  } catch (err) {
    errors.push(`captureTrace: ${(err as Error).message}`);
    return {
      variant, impl, run: runIdx, panOrZoom: "pan", firstMs: null, restMedianMs: null,
      nMarksInWindow: 0, nLatencies: 0, inputMarksFirst10: [], presentedFirst10: [],
      rendererPid: null, effectiveCategories: [], errors,
    };
  }

  if (dumpTraces) dumpTrace(capRes.events, variant, impl, runIdx, "pan");

  let parsed: ParsedPresentation | null = null;
  try {
    parsed = parsePresentedFrames(capRes.events);
  } catch (err) {
    errors.push(`parsePresentedFrames: ${(err as Error).message}`);
  }
  const startMs = userTimingMs(capRes.events, "cadence:pan:start");
  const endMs = userTimingMs(capRes.events, "cadence:pan:end");
  if (startMs == null) errors.push("missing cadence:pan:start mark");
  if (endMs == null) errors.push("missing cadence:pan:end mark");

  let inputMarksFirst10: number[] = [];
  let presentedFirst10: number[] = [];
  let rendererPid: number | null = null;
  let lats: number[] = [];
  let nInWindow = 0;
  if (parsed && startMs != null && endMs != null) {
    rendererPid = parsed.rendererPid;
    const marks = userTimingAllMs(capRes.events, "cadence:pan:input", parsed.rendererPid);
    inputMarksFirst10 = marks.slice(0, 10);
    presentedFirst10 = parsed.presentedMs.slice(0, 10);
    const inWindow = marks.filter((m) => m >= startMs && m <= endMs);
    nInWindow = inWindow.length;
    lats = perInputLatencies(parsed.presentedMs, inWindow, startMs, endMs);
  }
  // Pan emits one mark per pointermove AND per mousemove (same timeStamp); cadence de-dupes by Set.
  // We expect more marks than inputs; only nLatencies matters for the metric.
  const first = lats.length > 0 ? (lats[0] ?? null) : null;
  const rest = lats.slice(1);
  const restMed = rest.length > 0 ? median(rest) : null;

  return {
    variant, impl, run: runIdx, panOrZoom: "pan",
    firstMs: first == null ? null : first,
    restMedianMs: restMed == null || !Number.isFinite(restMed) ? null : restMed,
    nMarksInWindow: nInWindow,
    nLatencies: lats.length,
    inputMarksFirst10,
    presentedFirst10,
    rendererPid,
    effectiveCategories: capRes.effectiveCategories,
    errors,
  };
}

type WorkEntry = {
  variant: string;
  impl: EngineImpl | "bare";
  isBare: boolean;
  preWarm: boolean;
  idleBeforeMs: number;
  kind: "zoom" | "pan";
  passive?: boolean | null;  // bare-page only
};

function buildWorkEntries(): WorkEntry[] {
  const filter = process.env.D2_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const w: WorkEntry[] = [];
  // V0: official baseline
  for (const impl of IMPL_ORDER) w.push({ variant: "V0", impl, isBare: false, preWarm: false, idleBeforeMs: 200, kind: "zoom" });
  for (const impl of IMPL_ORDER) w.push({ variant: "V0", impl, isBare: false, preWarm: false, idleBeforeMs: 200, kind: "pan" });
  // F1: bare page (passive=true and passive=false) for zoom; passive=true also for pan
  w.push({ variant: "F1p", impl: "bare", isBare: true, preWarm: false, idleBeforeMs: 200, kind: "zoom", passive: true });
  w.push({ variant: "F1n", impl: "bare", isBare: true, preWarm: false, idleBeforeMs: 200, kind: "zoom", passive: false });
  w.push({ variant: "F1p-pan", impl: "bare", isBare: true, preWarm: false, idleBeforeMs: 200, kind: "pan", passive: true });
  w.push({ variant: "F1n-pan", impl: "bare", isBare: true, preWarm: false, idleBeforeMs: 200, kind: "pan", passive: false });
  // F2: warm-up before tracing
  for (const impl of IMPL_ORDER) w.push({ variant: "F2", impl, isBare: false, preWarm: true, idleBeforeMs: 200, kind: "zoom" });
  for (const impl of IMPL_ORDER) w.push({ variant: "F2", impl, isBare: false, preWarm: true, idleBeforeMs: 200, kind: "pan" });
  // F3: idle dose-response (zoom at every idle, pan at 0 and 200)
  for (const idle of [0, 16, 50, 100, 200, 500] as const) {
    for (const impl of IMPL_ORDER) w.push({ variant: `F3-${idle}-zoom`, impl, isBare: false, preWarm: true, idleBeforeMs: idle, kind: "zoom" });
  }
  for (const idle of [0, 200] as const) {
    for (const impl of IMPL_ORDER) w.push({ variant: `F3-${idle}-pan`, impl, isBare: false, preWarm: true, idleBeforeMs: idle, kind: "pan" });
  }
  // Also F1p at the same idle matrix for direct engine vs bare comparison.
  for (const idle of [0, 16, 50, 100, 200, 500] as const) {
    w.push({ variant: `F1p-F3-${idle}-zoom`, impl: "bare", isBare: true, preWarm: true, idleBeforeMs: idle, kind: "zoom", passive: true });
  }
  return filter ? w.filter((e) => filter.some((f) => e.variant.startsWith(f))) : w;
}

/**
 * Re-order work entries so that, for each (variant, kind) group, the engine
 * order alternates between adjacent runs. Group 1: IMPL_ORDER as written.
 * Group 2: IMPL_ORDER reversed. Group 3: IMPL_ORDER as written. And so on.
 * Bare-page entries are kept in their natural order; they do not have an
 * engine to swap.
 */
function permuteWorkEntries(entries: WorkEntry[]): WorkEntry[] {
  const byKey = new Map<string, WorkEntry[]>();
  for (const e of entries) {
    const k = `${e.variant}|${e.kind}`;
    const list = byKey.get(k) ?? [];
    list.push(e);
    byKey.set(k, list);
  }
  const out: WorkEntry[] = [];
  for (const [, list] of byKey) {
    // Partition into bare and engine; keep bare at the front, then alternate
    // engine groups by reversing every other one.
    const bare = list.filter((e) => e.isBare);
    const engine = list.filter((e) => !e.isBare);
    const groups: WorkEntry[][] = [];
    for (let i = 0; i < engine.length; i += IMPL_ORDER.length) {
      groups.push(engine.slice(i, i + IMPL_ORDER.length));
    }
    let alt = 0;
    for (const g of groups) {
      if (alt % 2 === 1) g.reverse();
      for (const e of g) out.push(e);
      alt++;
    }
    for (const e of bare) out.push(e);
  }
  return out;
}

test("Q03C-D2 first-input latency falsifier harness (diagnostic; never a receipt)", async ({ browser }) => {
  expect(COMMIT).toMatch(/^[0-9a-f]{40}$/);
  await ensureOutDir();

  const allRuns: PerRun[] = [];
  const log: string[] = [];
  const entries = permuteWorkEntries(buildWorkEntries());
  console.log(`D2_PLAN entries=${entries.length} runs_per_entry=${RUNS_PER_VARIANT_IMPL} host=${HOST} cpu=${CPU} os=${OS_LABEL} commit=${COMMIT.slice(0, 12)}`);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    for (let n = 0; n < RUNS_PER_VARIANT_IMPL; n++) {
      let context: BrowserContext | null = null;
      let page: Page | null = null;
      try {
        if (e.isBare) {
          const opened = await openBarePage(browser, e.passive === true, e.kind === "pan" ? "pan" : "wheel");
          context = opened.context; page = opened.page;
        } else {
          const opened = await openEnginePage(browser, e.impl as EngineImpl);
          context = opened.context; page = opened.page;
        }
        const center = e.isBare ? { x: 720, y: 450 } : (await benchEval(page, () => {
          const w = window as unknown as { __mmBench: { plotCenter: () => { x: number; y: number } } };
          return w.__mmBench.plotCenter();
        }));
        const rec = e.kind === "zoom"
          ? await runZoomGesture(context!, page!, center, e.impl, n, e.variant, e.preWarm, e.idleBeforeMs, true)
          : await runPanGesture(context!, page!, center, e.impl, n, e.variant, e.preWarm, e.idleBeforeMs, true);
        allRuns.push(rec);
        const line = `D2 ${e.variant} impl=${e.impl} kind=${e.kind} n=${n + 1} first_ms=${rec.firstMs == null ? "NaN" : round1(rec.firstMs)} rest_med_ms=${rec.restMedianMs == null ? "NaN" : round1(rec.restMedianMs)} n_in=${rec.nMarksInWindow} n_lat=${rec.nLatencies} pid=${rec.rendererPid ?? "null"} err=${rec.errors.length}`;
        console.log(line);
        log.push(line);
      } catch (err) {
        const line = `D2 ${e.variant} impl=${e.impl} kind=${e.kind} n=${n + 1} ERROR=${(err as Error).message}`;
        console.error(line);
        log.push(line);
      } finally {
        try { await page?.close().catch(() => undefined); } catch { /* ignore */ }
        try { await context?.close().catch(() => undefined); } catch { /* ignore */ }
      }
    }
  }

  const runsFile = path.join(TRACE_OUT, "runs.json");
  if (process.env.D2_APPEND === "1" && fs.existsSync(runsFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(runsFile, "utf8"));
      const combined = Array.isArray(prev.runs) ? prev.runs.concat(allRuns) : allRuns;
      fs.writeFileSync(runsFile, JSON.stringify({ commit: COMMIT, host: HOST, cpu: CPU, os: OS_LABEL, runs: combined }, null, 2) + "\n");
    } catch {
      fs.writeFileSync(runsFile, JSON.stringify({ commit: COMMIT, host: HOST, cpu: CPU, os: OS_LABEL, runs: allRuns }, null, 2) + "\n");
    }
  } else {
    fs.writeFileSync(runsFile, JSON.stringify({ commit: COMMIT, host: HOST, cpu: CPU, os: OS_LABEL, runs: allRuns }, null, 2) + "\n");
  }
  fs.appendFileSync(path.join(TRACE_OUT, "log.txt"), log.join("\n") + "\n");
  console.log(`D2_DONE runs=${allRuns.length} host=${HOST} cpu=${CPU} os=${OS_LABEL} commit=${COMMIT.slice(0, 12)}`);
});