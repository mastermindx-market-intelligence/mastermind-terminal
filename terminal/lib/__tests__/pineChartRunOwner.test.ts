import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PINE_ENGINE_WAIT_SLACK_MS, PINE_PENDING_GRACE_MS, pineFailurePinned, pineRowState, settleChartPineRun } from "../pineChartRun";

// Execute the actual component's run/cache/legend closures with controlled host
// and clock ports. No replacement implementation of their ownership rules.
const panel = readFileSync(path.resolve(__dirname, "../../components/ChartPanel.tsx"), "utf8");
function source(from: string, to: string): string {
  const a = panel.indexOf(from), b = panel.indexOf(to, a);
  if (a < 0 || b <= a) throw new Error("ChartPanel owner seam missing");
  return ts.transpileModule(panel.slice(a, b), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const runSource = source("  const pineDataSig =", "\n\n  // ONE writer");
const legendSource = source("  const pineLegendEntry =", "\n\n  // Rebuild the per-pane legend registry");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const success = (astId: string) => ({ ok: true, errors: [], astId,
  result: { plots: [], shapes: [], hlines: [], warnings: [], meta: { overlay: true } } });
const unavailable = { ok: false, errors: [{ phase: "runtime", line: 0, col: 0, message: "Pine engine failed to start" }], result: null };
const A = { id: "script", name: "A", source: "plot(close)", params: { period: 10 } };
const B = { ...A, name: "B", params: { period: 20 } };

function harness() {
  const state = { now: 1000, timerId: 0, refreshes: 0,
    compile: async (_source: string): Promise<any> => ({ ok: true, errors: [], astId: "compiled" }),
    run: async (_request: any): Promise<any> => success("current") };
  const timers = new Map<number, { at: number; fn: () => void }>();
  const refs = {
    pineCacheRef: { current: new Map() }, pineAstRef: { current: new Map() },
    pineUnavailRef: { current: new Map() }, pineInflightRef: { current: new Map() },
    pineRunTokenRef: { current: 0 }, engineRef: { current: {} },
    timeframeRef: { current: "D" }, sessionAnchorRef: { current: { v: 1, date: "2026-01-02", index: 0, basis: "ipo" } },
    barsRef: { current: [{ time: "2026-01-02", o: 10, h: 11, l: 9, c: 10, v: 100 }] }, isIntradayRef: { current: false },
  };
  const ports = { ...refs, symbol: "NVDA", PINE_RUNTIME_CAP_MS: 2000, PINE_ENGINE_WAIT_SLACK_MS, PINE_PENDING_GRACE_MS,
    pineFailurePinned, pineRowState, settleChartPineRun,
    pineHost: () => ({ compile: (input: string) => state.compile(input), run: (input: any) => state.run(input) }),
    performance: { now: () => state.now }, rebuildPaneMeta: () => { state.refreshes++; }, pineColorOf: () => "#00ffff",
    setTimeout: (fn: () => void, ms: number) => { const id = ++state.timerId; timers.set(id, { at: state.now + ms, fn }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); } };
  const owner = new Function(...Object.keys(ports), runSource + legendSource +
    "\nreturn { runPineHost, pineCacheKey, pineCached, pineLegendEntry, clearPineInflight };")(...Object.values(ports));
  const advance = (ms: number) => {
    state.now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= state.now) { timers.delete(id); timer.fn(); }
  };
  return { ...owner, state, refs, timers, advance, rows: refs.barsRef.current };
}

describe("ChartPanel Pine request and settlement ownership", () => {
  it("A success / B infrastructure failure / A cache hit does not label A with B's failure", async () => {
    const h = harness();
    await h.runPineHost(A, h.rows);
    const cachedA = h.refs.pineCacheRef.current.get(A.id);
    h.state.run = async () => unavailable;
    await h.runPineHost(B, h.rows);
    expect(h.refs.pineCacheRef.current.get(A.id)).toBe(cachedA);
    expect(h.pineLegendEntry(B, "overlay", undefined).pineState).toBe("engineFail");
    expect(h.pineCached(A, h.rows)).not.toBeNull();
    expect(h.pineLegendEntry(A, "overlay", [{}]).pineState).toBeUndefined();
    expect(pineFailurePinned(h.refs.pineUnavailRef.current.get(A.id), h.pineCacheKey(B, h.rows))).toBe(true);
  });

  for (const nextFails of [false, true]) it("retired successful settlement cannot replace the newer " + (nextFails ? "failure" : "result"), async () => {
    const h = harness(), oldRun = deferred<any>(), oldCompile = deferred<any>();
    h.state.compile = () => oldCompile.promise;
    h.state.run = () => oldRun.promise;
    const old = h.runPineHost(A, h.rows);
    h.state.run = async () => nextFails ? unavailable : success("new-ast");
    await h.runPineHost(B, h.rows);
    const before = JSON.stringify({
      cache: [...h.refs.pineCacheRef.current], ast: [...h.refs.pineAstRef.current], unavailable: [...h.refs.pineUnavailRef.current],
    });
    oldCompile.resolve({ ok: true, errors: [], astId: "retired-compile-ast" });
    oldRun.resolve(success("retired-run-ast"));
    expect(await old).toBeNull();
    expect(JSON.stringify({
      cache: [...h.refs.pineCacheRef.current], ast: [...h.refs.pineAstRef.current], unavailable: [...h.refs.pineUnavailRef.current],
    })).toBe(before);
    expect(h.timers.size).toBe(0);
  });

  it("removal retires both the pending run and its warm compile without recreating cache or AST", async () => {
    const h = harness(), run = deferred<any>(), compile = deferred<any>();
    h.state.compile = () => compile.promise; h.state.run = () => run.promise;
    const pending = h.runPineHost(A, h.rows);
    h.clearPineInflight(); h.refs.pineAstRef.current.clear();
    compile.resolve({ ok: true, errors: [], astId: "removed-compile" });
    run.resolve(success("removed-run"));
    expect(await pending).toBeNull();
    expect(h.refs.pineCacheRef.current.size).toBe(0);
    expect(h.refs.pineAstRef.current.size).toBe(0);
    expect(h.refs.pineUnavailRef.current.size).toBe(0);
    expect(h.timers.size).toBe(0);
  });

  it("current successful settlement retains its AST and cache, then releases pending timers", async () => {
    const h = harness();
    expect(await h.runPineHost(A, h.rows)).toMatchObject({ error: null });
    expect(h.refs.pineAstRef.current.get(A.id).astId).toBe("current");
    expect(h.pineCached(A, h.rows)).not.toBeNull();
    expect(h.refs.pineInflightRef.current.size).toBe(0);
    expect(h.timers.size).toBe(0);
  });

  it("current infrastructure failure stays outside the script cache and has an explicit retry state", async () => {
    const h = harness(); h.state.run = async () => unavailable;
    expect(await h.runPineHost(A, h.rows)).toBeNull();
    expect(h.pineCached(A, h.rows)).toBeNull();
    expect(h.pineLegendEntry(A, "overlay", undefined).pineState).toBe("engineFail");
    expect(h.timers.size).toBe(0);
  });

  it("pending and waiting thresholds describe the actual current run", async () => {
    const h = harness(), run = deferred<any>(); h.state.run = () => run.promise;
    const pending = h.runPineHost(A, h.rows);
    expect(h.pineLegendEntry(A, "overlay", undefined).pineState).toBeUndefined();
    h.advance(PINE_PENDING_GRACE_MS + 16);
    expect(h.pineLegendEntry(A, "overlay", undefined).pineState).toBe("running");
    h.advance(2000 + PINE_ENGINE_WAIT_SLACK_MS);
    expect(h.pineLegendEntry(A, "overlay", undefined).pineState).toBe("engineWait");
    run.resolve(success("finished")); await pending;
    expect(h.pineLegendEntry(A, "overlay", [{}]).pineState).toBeUndefined();
  });
});
