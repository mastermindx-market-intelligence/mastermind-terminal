import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type Bar } from "../pine-engine";
import { hashSource } from "../pine-engine/host-shared";
import type { PineResult } from "../pine-engine/host";
import {
  classifyPineRun, pineEngineFailure, pineFailurePinned, pineRowState, settleChartPineRun,
  PINE_ENGINE_WAIT_SLACK_MS, PINE_INTERRUPT_REISSUES,
} from "../pineChartRun";

// Chart-side settlement of a Pine host run (ChartPanel runPineHost). The host-driven cases use the
// REAL WorkerHost against a fake Worker, so a host message or flag change that would re-enable
// caching an engine failure as the script's result fails here.

function genBars(n: number): Bar[] {
  const bars: Bar[] = [];
  const start = Date.UTC(2023, 0, 2);
  for (let i = 0; i < n; i++) {
    const c = 100 + Math.sin(i / 7) * 5 + i * 0.02;
    const o = c - 0.3, h = Math.max(o, c) + 1, l = Math.min(o, c) - 1;
    bars.push({ time: new Date(start + i * 86400000).toISOString().slice(0, 10), o, h, l, c, v: 1_000_000 });
  }
  return bars;
}
const SRC_A = ['//@version=6', 'indicator("A", overlay=true)', "plot(ta.sma(close, 10))", ""].join("\n");
const SRC_B = ['//@version=6', 'indicator("B", overlay=true)', "plot(ta.ema(close, 5))", ""].join("\n");

describe("pineChartRun against the real WorkerHost (fake Worker + fake timers)", () => {
  let created: FakeWorker[] = [];
  let autoReady = true;
  let autoReply = true;

  class FakeWorker {
    onmessage: ((e: any) => void) | null = null;
    onerror: (() => void) | null = null;
    posted: any[] = [];
    terminated = false;
    constructor(_url: any, _opts: any) {
      created.push(this);
      if (autoReady) queueMicrotask(() => this.onmessage?.({ data: { kind: "ready" } }));
    }
    reply(msg: any) {
      if (this.terminated) return;
      if (msg.kind === "run") this.onmessage?.({ data: { kind: "ran", reqId: msg.reqId, ok: true, errors: [], result: { plots: [{ title: msg.source.includes('"A"') ? "A" : "B" }], shapes: [], hlines: [], warnings: [], meta: { overlay: true } } } });
      else if (msg.kind === "compile") this.onmessage?.({ data: { kind: "compiled", reqId: msg.reqId, ok: true, errors: [], astId: hashSource(msg.source) } });
    }
    postMessage(msg: any) {
      this.posted.push(msg);
      // reply on a macrotask-ish boundary so a sibling request can supersede first, as on a real worker
      if (autoReply) setTimeout(() => this.reply(msg), 5);
    }
    terminate() { this.terminated = true; }
  }

  beforeEach(() => {
    created = [];
    autoReady = true;
    autoReply = true;
    (globalThis as any).window = globalThis;
    (globalThis as any).Worker = FakeWorker as any;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).window;
    delete (globalThis as any).Worker;
    vi.resetModules();
  });

  it("a worker that never boots settles as unavailable/start — not a cacheable script outcome — and the same run retried succeeds", async () => {
    autoReady = false; autoReply = false;   // module evaluation hangs: no ready, no replies
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const bars = genBars(20);
    const issue = () => h.run({ slot: "s-a", source: SRC_A, bars, budgetMs: 2000 });

    let settled: Awaited<ReturnType<typeof settleChartPineRun>> | null = null;
    void settleChartPineRun(issue).then((s) => { settled = s; });
    await vi.advanceTimersByTimeAsync(host.WORKER_BOOT_TIMEOUT_MS);
    expect(settled).toBeNull();                         // the boot retry is still running: pending, not failed
    await vi.advanceTimersByTimeAsync(host.WORKER_BOOT_TIMEOUT_MS);
    expect(settled).toEqual({ kind: "unavailable", reason: "start", detail: "Pine engine failed to start" });

    // Retry with no symbol/TF/bars change: the host respawns on the next request.
    autoReady = true; autoReply = true;
    const again = settleChartPineRun(issue);
    await vi.advanceTimersByTimeAsync(50);
    const s2 = await again;
    expect(s2.kind).toBe("outcome");
    if (s2.kind === "outcome") { expect(s2.error).toBeNull(); expect(s2.result).toBeTruthy(); }
    h.dispose();
  });

  it("precondition: the compile of script B interrupts script A's in-flight run on the shared worker", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const bars = genBars(20);
    void h.compile(SRC_A);
    const runA = h.run({ slot: "s-a", source: SRC_A, bars, budgetMs: 2000 });
    void h.compile(SRC_B);   // supersedes compile A → resets the worker under run A
    const runB = h.run({ slot: "s-b", source: SRC_B, bars, budgetMs: 2000 });
    await vi.advanceTimersByTimeAsync(50);
    const a = await runA, b = await runB;
    expect(a.interrupted).toBe(true);
    expect(b.ok).toBe(true);
    h.dispose();
  });

  it("two scripts loaded together: the interrupted run is re-issued and BOTH settle with a result", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const bars = genBars(20);
    void h.compile(SRC_A);
    const a = settleChartPineRun(() => h.run({ slot: "s-a", source: SRC_A, bars, budgetMs: 2000 }));
    void h.compile(SRC_B);
    const b = settleChartPineRun(() => h.run({ slot: "s-b", source: SRC_B, bars, budgetMs: 2000 }));
    await vi.advanceTimersByTimeAsync(100);
    const [sa, sb] = await Promise.all([a, b]);
    expect(sa.kind).toBe("outcome");
    expect(sb.kind).toBe("outcome");
    if (sa.kind === "outcome") { expect(sa.error).toBeNull(); expect((sa.result as any).plots[0].title).toBe("A"); }
    if (sb.kind === "outcome") { expect(sb.error).toBeNull(); expect((sb.result as any).plots[0].title).toBe("B"); }
    h.dispose();
  });

  it("an interrupted run is NOT re-issued once a newer run for the same script owns the row", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const bars = genBars(20);
    let owner = true;
    let issues = 0;
    void h.compile(SRC_A);
    const a = settleChartPineRun(() => { issues++; return h.run({ slot: "s-a", source: SRC_A, bars, budgetMs: 2000 }); }, { current: () => owner });
    owner = false;            // a newer run for script A started (e.g. a second rebuild in the same commit)
    void h.compile(SRC_B);    // ...and the shared worker is reset under the old one
    await vi.advanceTimersByTimeAsync(50);
    expect(await a).toEqual({ kind: "superseded" });
    expect(issues).toBe(1);   // a re-issue here would supersede the newer run with stale inputs
    h.dispose();
  });

  it("a host disposed under the run settles as superseded (nothing to cache, nothing to show)", async () => {
    autoReply = false;
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const s = settleChartPineRun(() => h.run({ slot: "s-a", source: SRC_A, bars: genBars(20), budgetMs: 2000 }));
    await vi.advanceTimersByTimeAsync(1);
    h.dispose();
    await vi.advanceTimersByTimeAsync(1);
    // dispose settles every pending request interrupted; with no owner check it re-issues into a
    // disposed host, which answers cancelled → superseded.
    expect((await s).kind).toBe("superseded");
  });
});

describe("settleChartPineRun bounds and failure shapes (scripted issue)", () => {
  const interrupted: PineResult = { ok: false, errors: [], result: null, cancelled: true, interrupted: true };

  it("re-issues an interrupted run at most PINE_INTERRUPT_REISSUES times, then reports the engine unavailable", async () => {
    let n = 0;
    const s = await settleChartPineRun(async () => { n++; return interrupted; });
    expect(n).toBe(1 + PINE_INTERRUPT_REISSUES);
    expect(s).toMatchObject({ kind: "unavailable", reason: "interrupted" });
  });

  it("a host that throws is an engine failure, not a script error", async () => {
    const s = await settleChartPineRun(async () => { throw new Error("boom"); });
    expect(s).toEqual({ kind: "unavailable", reason: "crash", detail: "boom" });
  });
});

describe("classifyPineRun separates script outcomes from engine outcomes", () => {
  const err = (message: string, line = 0, phase: "parse" | "runtime" = "runtime") => ({ ok: false, errors: [{ phase, line, col: 0, message }], result: null } as PineResult);

  it("engine messages from host.ts are unavailable", () => {
    expect(classifyPineRun(err("Pine engine failed to start"))).toMatchObject({ kind: "unavailable", reason: "start" });
    expect(classifyPineRun(err("pine worker crashed"))).toMatchObject({ kind: "unavailable", reason: "crash" });
    expect(classifyPineRun(err("pine worker startup failed: SecurityError"))).toMatchObject({ kind: "unavailable", reason: "crash" });
    expect(classifyPineRun(err("pine worker postMessage failed: DataCloneError"))).toMatchObject({ kind: "unavailable", reason: "crash" });
  });

  it("script errors, budget breaches and missing output stay cacheable outcomes", () => {
    expect(classifyPineRun(err("Undeclared identifier 'foo'", 3, "parse"))).toEqual({ kind: "outcome", result: null, error: "Line 3: Undeclared identifier 'foo'", astId: undefined });
    // the same text on a script line is the SCRIPT's error (e.g. a runtime.error() call), not the engine's
    expect(classifyPineRun(err("Pine engine failed to start", 4))).toMatchObject({ kind: "outcome", error: "Line 4: Pine engine failed to start" });
    expect(classifyPineRun({ ok: false, errors: [], result: null, budgetExceeded: true } as PineResult)).toMatchObject({ kind: "outcome", error: "Script exceeded the run budget (cancelled)" });
    expect(classifyPineRun(null)).toMatchObject({ kind: "outcome", error: "Script produced no output" });
    expect(pineEngineFailure(undefined)).toBeNull();
  });

  it("a plain cancellation is superseded; an interruption is unavailable", () => {
    expect(classifyPineRun({ ok: false, errors: [], result: null, cancelled: true } as PineResult)).toEqual({ kind: "superseded" });
    expect(classifyPineRun({ ok: false, errors: [], result: null, cancelled: true, interrupted: true } as PineResult)).toMatchObject({ kind: "unavailable", reason: "interrupted" });
  });
});

describe("pineRowState: what a script's legend row says", () => {
  const base = { intraday: false, inflightSince: null as number | null, graceMs: 400, budgetMs: 2000, now: 10_000, hasPlot: false, unavailable: null, error: undefined as string | undefined };

  it("in flight with no plot: quiet inside the grace period, running after it, engine wait past the budget", () => {
    expect(pineRowState({ ...base, inflightSince: 10_000 - 399 }).kind).toBe("ok");
    expect(pineRowState({ ...base, inflightSince: 10_000 - 400 }).kind).toBe("running");
    expect(pineRowState({ ...base, inflightSince: 10_000 - (2000 + PINE_ENGINE_WAIT_SLACK_MS - 1) }).kind).toBe("running");
    expect(pineRowState({ ...base, inflightSince: 10_000 - (2000 + PINE_ENGINE_WAIT_SLACK_MS) }).kind).toBe("engineWait");
  });

  it("a retry (grace 0) shows running at once; a plotted live re-run only speaks once the engine is overdue", () => {
    expect(pineRowState({ ...base, graceMs: 0, inflightSince: 10_000 }).kind).toBe("running");
    expect(pineRowState({ ...base, hasPlot: true, inflightSince: 10_000 - 1500 }).kind).toBe("ok");
    expect(pineRowState({ ...base, hasPlot: true, inflightSince: 10_000 - 60_000 }).kind).toBe("engineWait");
  });

  it("an engine failure is shown as unavailable, never as a clean row or the script's error", () => {
    expect(pineRowState({ ...base, unavailable: "start" })).toEqual({ kind: "unavailable", reason: "start" });
    expect(pineRowState({ ...base, unavailable: "start", error: "Line 2: old error" })).toEqual({ kind: "unavailable", reason: "start" });
    // a new run in flight past grace supersedes the stale failure text
    expect(pineRowState({ ...base, unavailable: "start", inflightSince: 10_000 - 500 }).kind).toBe("running");
    // inside grace the row keeps saying what it said
    expect(pineRowState({ ...base, unavailable: "start", inflightSince: 10_000 - 10 }).kind).toBe("unavailable");
  });

  it("intraday outranks everything; a script error shows when nothing is in flight", () => {
    expect(pineRowState({ ...base, intraday: true, unavailable: "start", inflightSince: 0 }).kind).toBe("intraday");
    expect(pineRowState({ ...base, error: "Line 3: x" })).toEqual({ kind: "error", message: "Line 3: x" });
    expect(pineRowState(base).kind).toBe("ok");
  });
});

describe("pineFailurePinned: an engine failure re-runs only on Retry or a changed request", () => {
  it("the same request stays failed; a different request, or no failure, runs", () => {
    const failed = { reason: "start" as const, key: "src|{}|NVDA|D|250:2026-10-09" };
    expect(pineFailurePinned(failed, failed.key)).toBe(true);
    // a live splice moves the last close in place: the request key (len:lastTime) is unchanged
    expect(pineFailurePinned(failed, "src|{}|NVDA|D|250:2026-10-09")).toBe(true);
    // a new bar, timeframe, symbol or edit is a different request
    expect(pineFailurePinned(failed, "src|{}|NVDA|D|251:2026-10-12")).toBe(false);
    expect(pineFailurePinned(failed, "src|{}|NVDA|W|250:2026-10-09")).toBe(false);
    expect(pineFailurePinned(undefined, failed.key)).toBe(false);
  });
});
