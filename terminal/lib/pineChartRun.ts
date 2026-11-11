// Chart-side settlement of one Pine host run (ChartPanel), plus the legend state it implies.
//
// A host PineResult carries two kinds of failure, and a chart has to treat them differently:
//   - SCRIPT outcomes (a result, a parse/runtime error, a budget breach) are a function of
//     (source, params, bars). Caching one under the script's data key is correct: the same bars
//     reproduce it.
//   - ENGINE outcomes (the worker never booted, crashed, could not be spawned or posted to, or was
//     reset under this run) say nothing about the script. ChartPanel used to cache them like a
//     result, so one cold start pinned "Pine engine failed to start" on the chart until the bars,
//     timeframe or symbol changed. A failed read rendered as the script's answer. These settle as
//     `unavailable`: shown as such, never cached, retryable.
//
// A run interrupted by a reset of the shared worker (another script's compile superseding the
// in-flight compile, a sibling's budget breach) did not run at all. It is re-issued on the same
// host a bounded number of times before it settles as `unavailable`. Without that, the first of two
// scripts compiled together came back with no plot, no error and nothing that would ever re-run it.
//
// host.ts retry semantics are untouched: this module only reads what the host settles with.
import type { PineError, PineResult, RunResult } from "./pine-engine/host";

export type PineEngineFailure = "start" | "crash" | "interrupted";

export type PineRunSettlement =
  // a newer run for the same slot owns the outcome (or the host was disposed): record nothing
  | { kind: "superseded" }
  // deterministic for (script, data): cache it
  | { kind: "outcome"; result: RunResult | null; error: string | null; astId?: string }
  // the engine, not the script, failed: never cache, offer a retry
  | { kind: "unavailable"; reason: PineEngineFailure; detail: string };

// Re-issues allowed for a run the host settled as interrupted. One covers the common case (the
// compile of the next script interrupts this one); two absorbs a second reset in the same burst.
export const PINE_INTERRUPT_REISSUES = 2;

// The host's own infrastructure messages (host.ts runtimeError call sites). Script errors from the
// engine never use these strings. lib/__tests__/pineChartRun.test.ts drives the real WorkerHost
// against a fake Worker, so a reworded host message fails that test rather than silently
// re-enabling the cache.
const START_FAILURE = "Pine engine failed to start";
const ENGINE_FAILURE_PREFIXES = ["pine worker crashed", "pine worker startup failed:", "pine worker postMessage failed:"];

export function pineEngineFailure(err: PineError | undefined): PineEngineFailure | null {
  if (!err || err.phase !== "runtime" || err.line !== 0) return null;
  if (err.message === START_FAILURE) return "start";
  if (ENGINE_FAILURE_PREFIXES.some((p) => err.message === p || err.message.startsWith(p))) return "crash";
  return null;
}

// Classify one settled host run. `null` (no reply at all) keeps the old "no output" script outcome.
export function classifyPineRun(out: PineResult | null): PineRunSettlement {
  if (!out) return { kind: "outcome", result: null, error: "Script produced no output" };
  if (out.interrupted) return { kind: "unavailable", reason: "interrupted", detail: "Script run was interrupted" };
  if (out.cancelled) return { kind: "superseded" };
  if (out.budgetExceeded) return { kind: "outcome", result: null, error: "Script exceeded the run budget (cancelled)", astId: out.astId };
  if (!out.ok) {
    const e = out.errors[0];
    const engine = pineEngineFailure(e);
    if (engine) return { kind: "unavailable", reason: engine, detail: e!.message };
    return { kind: "outcome", result: null, error: e ? (e.line ? `Line ${e.line}: ${e.message}` : e.message) : "Script failed to run", astId: out.astId };
  }
  return { kind: "outcome", result: out.result, error: null, astId: out.astId };
}

// Run `issue` (one host.run call) to a settlement. An interrupted run is issued again, up to
// `reissues` times, while `current()` still says this run owns its slot: a re-issue after the caller
// started a newer run for the same script would supersede that newer run with stale inputs. A throw
// from the host is an engine failure, not a script error.
export async function settleChartPineRun(
  issue: () => Promise<PineResult>,
  opts: { reissues?: number; current?: () => boolean } = {},
): Promise<PineRunSettlement> {
  const reissues = opts.reissues ?? PINE_INTERRUPT_REISSUES;
  for (let attempt = 0; ; attempt++) {
    let out: PineResult;
    try { out = await issue(); } catch (e) {
      return { kind: "unavailable", reason: "crash", detail: e instanceof Error && e.message ? e.message : "Script engine threw" };
    }
    if (out && out.interrupted) {
      if (opts.current && !opts.current()) return { kind: "superseded" };
      if (attempt < reissues) continue;
    }
    return classifyPineRun(out);
  }
}

// An engine failure is pinned to the request that failed (`key` = script · params · symbol ·
// timeframe · bar set). The SAME request is re-issued only by an explicit Retry: a background
// rebuild — a live splice every few seconds, an indicator toggle on the same bars — would otherwise
// restart a hung boot behind a row that says it failed, flipping it back to "running" before anyone
// could act on it. A different request (new bars, timeframe, symbol, edited script) runs fresh.
export type PineUnavailable = { reason: PineEngineFailure; key: string };
export function pineFailurePinned(unavail: PineUnavailable | undefined, key: string): boolean {
  return !!unavail && unavail.key === key;
}

// ── legend state ──────────────────────────────────────────────────────────────────────────────
// What a script's legend row says. The four-state law applied to one script: a run still in
// flight is not "no plot", and an engine failure is not the script's result.
export type PineRowState =
  | { kind: "ok" }
  | { kind: "intraday" }
  | { kind: "running" }      // in flight past the grace period
  | { kind: "engineWait" }   // in flight past the run budget: the run cannot still be executing
  | { kind: "unavailable"; reason: PineEngineFailure }
  | { kind: "error"; message: string };

// A run that settles inside this window never shows a pending state, so a replay tick or a live
// re-run does not flash the row.
export const PINE_PENDING_GRACE_MS = 400;
// The host arms a run's wall budget when the worker reports ready, then preempts the run at the
// budget. A run still in flight well past its budget is therefore waiting on the engine (module
// fetch/boot, up to 2 × WORKER_BOOT_TIMEOUT_MS with the boot retry), not executing.
export const PINE_ENGINE_WAIT_SLACK_MS = 600;

export function pineRowState(i: {
  intraday: boolean;
  inflightSince: number | null;   // when the current run started (null = nothing in flight)
  graceMs: number;                // 0 for an explicit retry: the row confirms the click at once
  budgetMs: number;
  now: number;
  hasPlot: boolean;               // the row still shows the previous run's series (a live re-run)
  unavailable: PineEngineFailure | null;
  error: string | undefined;
}): PineRowState {
  if (i.intraday) return { kind: "intraday" };
  if (i.inflightSince != null) {
    const age = i.now - i.inflightSince;
    if (age >= i.budgetMs + PINE_ENGINE_WAIT_SLACK_MS) return { kind: "engineWait" };
    // A plotted row re-running in place is not a row without a plot: say nothing until the engine
    // itself is overdue, so live re-runs never flash "running".
    if (age >= i.graceMs && !i.hasPlot) return { kind: "running" };
  }
  // Inside the grace period the row keeps what it said before the run started.
  if (i.unavailable) return { kind: "unavailable", reason: i.unavailable };
  if (i.error) return { kind: "error", message: i.error };
  return { kind: "ok" };
}
