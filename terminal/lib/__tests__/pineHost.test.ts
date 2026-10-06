import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as parser from "../pine-engine/parser";
import { compile, runCompiled, runPine, type Bar } from "../pine-engine";
import { hashSource, barsToColumns, columnsToBars } from "../pine-engine/host-shared";

// Synthetic daily bars long enough for ta.* to warm up.
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

const SMA = ['//@version=6', 'indicator("S", overlay=true)', "plot(ta.sma(close, 10))", ""].join("\n");

describe("single parse — compile once, run the AST without re-parsing", () => {
  it("runPine() lexes+parses the source exactly ONCE (not twice)", () => {
    const spy = vi.spyOn(parser, "parse");
    runPine(SMA, genBars(40), {});
    expect(spy).toHaveBeenCalledTimes(1);   // was 2 before the split (index parsed, runtime re-parsed)
    spy.mockRestore();
  });

  it("compile() parses once; a subsequent runCompiled() does NOT parse again (AST reuse)", () => {
    const c = compile(SMA);
    expect(c.ok).toBe(true);
    expect(c.ast).toBeTruthy();
    const spy = vi.spyOn(parser, "parse");
    // three data-only re-runs off the same compiled AST — replay/live/param-edit pattern
    runCompiled(c.ast!, genBars(30), {});
    runCompiled(c.ast!, genBars(31), {});
    runCompiled(c.ast!, genBars(32), {});
    expect(spy).not.toHaveBeenCalled();   // AST reused → zero re-parses across data updates
    spy.mockRestore();
  });
});

describe("AST cache key by source hash", () => {
  it("hashSource is stable and distinguishes different sources", () => {
    expect(hashSource(SMA)).toBe(hashSource(SMA));
    expect(hashSource(SMA)).not.toBe(hashSource(SMA + "\nplot(close)"));
    expect(hashSource(SMA)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("plot() na → whitespace gap emission (LWC breaks the line)", () => {
  it("a line plot that goes na for a stretch emits whitespace points (time, no value) at the gap, not dropped points", () => {
    // plots the bar index while close>prev, else na → alternating valued/na line-series bars
    const src = [
      "//@version=6",
      'indicator("Gap", overlay=false)',
      "cond = close > close[1]",
      "plot(cond ? close : na)",
      "",
    ].join("\n");
    const bars = genBars(60);
    const out = runPine(src, bars, {});
    expect(out.ok).toBe(true);
    const plot = out.result!.plots[0];
    expect(plot.kind).toBe("line");
    // one point PER BAR (gaps included) — length equals bar count, unlike the old drop-na behavior
    expect(plot.data.length).toBe(bars.length);
    const gaps = plot.data.filter((d) => d.value === undefined);
    const valued = plot.data.filter((d) => d.value !== undefined);
    expect(gaps.length).toBeGreaterThan(0);          // some na bars → whitespace gap points
    expect(valued.length).toBeGreaterThan(0);        // some real values
    for (const g of gaps) { expect(typeof g.time).toBe("string"); expect(g.value).toBeUndefined(); }  // {time} only
  });

  it("a histogram plot omits na bars (discrete series — no whitespace filler)", () => {
    const src = [
      "//@version=6",
      'indicator("H", overlay=false)',
      "cond = close > close[1]",
      "plot(cond ? close : na, style=plot.style_histogram)",
      "",
    ].join("\n");
    const bars = genBars(60);
    const out = runPine(src, bars, {});
    const plot = out.result!.plots[0];
    expect(plot.kind).toBe("histogram");
    expect(plot.data.length).toBeLessThan(bars.length);        // na bars dropped, not gap-filled
    expect(plot.data.every((d) => d.value !== undefined)).toBe(true);
  });
});

describe("plotshape series-bool semantics", () => {
  it("plotshape with a FINITE numeric condition is a type error (warned, no per-bar markers)", () => {
    const src = ['//@version=6', 'indicator("N", overlay=true)', "plotshape(close, style=shape.circle)", ""].join("\n");
    const out = runPine(src, genBars(40), {});
    expect(out.ok).toBe(true);
    expect(out.result!.shapes.length).toBe(0);                 // did NOT fire on every non-zero bar
    expect(out.result!.warnings.some((w) => /series bool/.test(w))).toBe(true);
  });

  it("plotshape with a real boolean condition still fires markers", () => {
    const src = ['//@version=6', 'indicator("B", overlay=true)', "plotshape(close > close[1], style=shape.triangleup)", ""].join("\n");
    const out = runPine(src, genBars(40), {});
    expect(out.ok).toBe(true);
    expect(out.result!.shapes.length).toBeGreaterThan(0);
    expect(out.result!.warnings.some((w) => /series bool/.test(w))).toBe(false);
  });
});

// The honesty patch: deferred builtins draw nothing, so they must SAY so. Before this, a pasted
// SMC script full of box/label/fill calls reported "✓ Compiled successfully" and rendered nothing.
describe("deferred builtins are reported, never silently swallowed", () => {
  it("NOOP-namespace calls and fill/bgcolor/barcolor/alertcondition each warn exactly once per name", () => {
    const src = [
      "//@version=6",
      'indicator("Honesty", overlay=true)',
      "up = close > close[1]",
      'label.new(bar_index, high, "x")',
      "box.new(bar_index, high, bar_index, low)",
      "p1 = plot(close)",
      "p2 = plot(open)",
      "fill(p1, p2, color=color.new(color.blue, 90))",
      "bgcolor(up ? color.new(color.green, 90) : na)",
      "barcolor(up ? color.green : color.red)",
      'alertcondition(up, "Up", "up bar")',
      "",
    ].join("\n");
    const out = runPine(src, genBars(40), {});
    expect(out.ok, "run errors: " + JSON.stringify(out.errors)).toBe(true);
    const w = out.result!.warnings;
    const dump = " | warnings=" + JSON.stringify(w);
    for (const fn of ["label.new", "box.new", "fill", "bgcolor", "barcolor", "alertcondition"]) {
      // exactly one — deduped per (namespace.method) even though every one of the 40 bars called it
      expect(w.filter((x) => x === `${fn}() is not supported yet — its output is suppressed`).length, fn + dump).toBe(1);
    }
    // member READS of the same namespaces stay silent, and return values are unchanged (plots intact)
    expect(w.some((x) => /^label\.style_/.test(x)), dump).toBe(false);
    expect(out.result!.plots.length).toBe(2);
  });

  it("a script using only supported builtins stays warning-free", () => {
    const out = runPine(SMA, genBars(40), {});
    expect(out.result!.warnings).toEqual([]);
  });
});

// No-op builtins must still EVALUATE their arguments: a ta.* that appears only inside
// fill/bgcolor/… args has per-call-site state that must advance on every bar (the same
// series-desync class the engine avoids for and/or/ternary). Before this fix the whole
// argument list was skipped, so such state silently froze.
describe("deferred builtins still evaluate their arguments (series-state sync)", () => {
  it("a ta.* used only inside bgcolor() args yields the same series as one at top level", () => {
    // grab() smuggles the value computed inside bgcolor's args out through a global,
    // so the test can compare it bar-for-bar against an identical top-level ta.sma.
    const src = [
      "//@version=6",
      'indicator("BgArgs", overlay=false)',
      "var float captured = na",
      "grab(x) =>",
      "    captured := x",
      "    x",
      "bgcolor(grab(ta.sma(close, 5)) > 0 ? color.new(color.green, 90) : na)",
      'plot(captured, "inner")',
      'plot(ta.sma(close, 5), "ref")',
      "",
    ].join("\n");
    const out = runPine(src, genBars(40), {});
    expect(out.ok, "run errors: " + JSON.stringify(out.errors)).toBe(true);
    const inner = out.result!.plots.find((p) => p.title === "inner")!;
    const ref = out.result!.plots.find((p) => p.title === "ref")!;
    expect(inner).toBeTruthy();
    expect(ref).toBeTruthy();
    // point-for-point identical, including the warm-up gap bars
    expect(inner.data.map((d) => [d.time, d.value])).toEqual(ref.data.map((d) => [d.time, d.value]));
    // guard against a trivially-equal pair of all-gap series
    expect(inner.data.filter((d) => d.value !== undefined).length).toBeGreaterThan(0);
    // the honesty warning is unchanged: still exactly one, still na-returning no-op
    expect(out.result!.warnings.filter((w) => w === "bgcolor() is not supported yet — its output is suppressed").length).toBe(1);
  });

  it("plot() calls nested inside fill() args still register and accumulate their series", () => {
    const src = [
      "//@version=6",
      'indicator("FillArgs", overlay=false)',
      'fill(plot(ta.sma(close, 3), "a"), plot(close, "b"))',
      "",
    ].join("\n");
    const bars = genBars(30);
    const out = runPine(src, bars, {});
    expect(out.ok, "run errors: " + JSON.stringify(out.errors)).toBe(true);
    const titles = out.result!.plots.map((p) => p.title);
    expect(titles).toContain("a");
    expect(titles).toContain("b");
    const b = out.result!.plots.find((p) => p.title === "b")!;
    expect(b.data.length).toBe(bars.length);   // accumulated on every bar, not just registered once
    expect(out.result!.warnings.filter((w) => w === "fill() is not supported yet — its output is suppressed").length).toBe(1);
  });
});

describe("columnar bar packing round-trips (transferable worker payload)", () => {
  it("barsToColumns → columnsToBars reproduces the bars and lists transferable buffers", () => {
    const bars = genBars(12);
    const { payload, transfer } = barsToColumns(bars);
    expect(payload.n).toBe(12);
    expect(transfer.length).toBe(5);                            // o/h/l/c/v ArrayBuffers
    const back = columnsToBars(payload);
    expect(back).toEqual(bars);
  });
});

// ── worker host: cancellation/supersession + wall-budget preemption, via a stubbed Worker ─────────
describe("PineHost worker: supersession + budget error shape (stubbed Worker)", () => {
  let created: StubWorker[] = [];
  class StubWorker {
    onmessage: ((e: any) => void) | null = null;
    onerror: (() => void) | null = null;
    posted: any[] = [];
    terminated = false;
    replyWith: ((msg: any) => any) | null = null;   // if set, auto-reply to run/compile
    constructor(_url: any, _opts: any) { created.push(this); }
    postMessage(msg: any) {
      this.posted.push(msg);
      if (this.replyWith) { const r = this.replyWith(msg); if (r) queueMicrotask(() => this.onmessage?.({ data: r })); }
    }
    terminate() { this.terminated = true; }
  }

  beforeEach(() => {
    created = [];
    (globalThis as any).window = globalThis;
    (globalThis as any).Worker = StubWorker as any;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).window;
    delete (globalThis as any).Worker;
    vi.resetModules();
  });

  it("hasWorker() true; a run that never replies resolves as budgetExceeded and terminates+respawns", async () => {
    const host = await import("../pine-engine/host");
    expect(host.hasWorker()).toBe(true);
    const h = host.createPineHost();
    expect(h.usingWorker).toBe(true);

    // this run's worker never replies → the wall-budget timer must fire
    const p = h.run({ slot: "s1", source: SMA, bars: genBars(10), budgetMs: 500 });
    await vi.advanceTimersByTimeAsync(600);
    const res = await p;
    expect(res.budgetExceeded).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.errors[0].message).toMatch(/budget/);
    expect(created[0].terminated).toBe(true);   // worker was terminated on breach

    // next run respawns a fresh worker
    const w0 = created.length;
    void h.run({ slot: "s1", source: SMA, bars: genBars(10), budgetMs: 500 });
    expect(created.length).toBe(w0 + 1);
    h.dispose();
  });

  it("a newer run for the same slot supersedes the in-flight one (cancelled:true, no crosstalk)", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const first = h.run({ slot: "same", source: SMA, bars: genBars(10), budgetMs: 5000 });
    const second = h.run({ slot: "same", source: SMA, bars: genBars(10), budgetMs: 5000 });
    const r1 = await first;
    expect(r1.cancelled).toBe(true);   // superseded
    expect(r1.result).toBeNull();
    // let the second one time out cleanly so no timer leaks into the next test
    await vi.advanceTimersByTimeAsync(6000);
    await second;
    h.dispose();
  });

  it("SSR/no-Worker → createPineHost() returns a sync host that still runs", async () => {
    delete (globalThis as any).Worker;
    vi.resetModules();
    const host = await import("../pine-engine/host");
    expect(host.hasWorker()).toBe(false);
    const h = host.createPineHost();
    expect(h.usingWorker).toBe(false);
    const r = await h.run({ slot: "x", source: SMA, bars: genBars(20) });
    expect(r.ok).toBe(true);
    expect(r.result!.plots.length).toBe(1);
  });
});

// ── A02 frozen lifecycle contract (compile budget, honest sibling interruption, dispose, generations) ──
// These cases encode the containment contract against the actual host module + fake Worker/timers.
// They are written to FAIL on the supplied unmodified host and pass after a minimal lifecycle fix.
describe("A02 PineHost lifecycle contract (fake Worker + fake timers)", () => {
  let created: StubWorker[] = [];
  let postThrows = false;
  let spawnThrows = false;
  let autoReply: "none" | "success" = "none";

  class StubWorker {
    onmessage: ((e: any) => void) | null = null;
    onerror: (() => void) | null = null;
    posted: any[] = [];
    terminated = false;
    replyWith: ((msg: any) => any) | null = null;
    constructor(_url: any, _opts: any) {
      if (spawnThrows) throw new Error("pine worker startup failed (stub)");
      created.push(this);
    }
    postMessage(msg: any) {
      if (postThrows) throw new Error("pine postMessage failed (stub)");
      this.posted.push(msg);
      let r: any = null;
      if (this.replyWith) r = this.replyWith(msg);
      else if (autoReply === "success") {
        if (msg.kind === "compile") r = { kind: "compiled", reqId: msg.reqId, ok: true, errors: [], astId: hashSource(msg.source) };
        else if (msg.kind === "run") r = { kind: "ran", reqId: msg.reqId, ok: true, errors: [], result: { plots: [], shapes: [], warnings: [] } };
      }
      if (r) queueMicrotask(() => this.onmessage?.({ data: r }));
    }
    terminate() { this.terminated = true; }
  }

  beforeEach(() => {
    created = [];
    postThrows = false;
    spawnThrows = false;
    autoReply = "none";
    (globalThis as any).window = globalThis;
    (globalThis as any).Worker = StubWorker as any;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).window;
    delete (globalThis as any).Worker;
    vi.resetModules();
  });

  it("compile has a finite wall budget; overdue compile terminates worker and settles once (compile-shaped)", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    expect(h.usingWorker).toBe(true);

    const p = h.compile(SMA);
    await vi.advanceTimersByTimeAsync(1600); // DEFAULT 1500ms compile budget + slack
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.budgetExceeded).toBe(true);
    expect(res.astId).toBeNull();
    expect(res.errors[0].message).toMatch(/budget/);
    expect(created[0].terminated).toBe(true);

    // recovery: a later compile on a fresh worker still succeeds
    autoReply = "success";
    const rec = await h.compile(SMA);
    expect(rec.ok).toBe(true);
    expect(rec.astId).toBe(hashSource(SMA));
    expect(created.length).toBe(2);
    expect(created[1].terminated).toBe(false);
    h.dispose();
  });

  it("superseding a compile cancels the stale one, terminates/preempts its worker, and lets the latest compile proceed", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const src1 = SMA;
    const src2 = SMA + "\nplot(close)";

    const c1 = h.compile(src1);
    autoReply = "success"; // latest compile's fresh generation auto-answers
    const c2 = h.compile(src2); // latest must actually preempt stale compile work

    const r1 = await c1;
    expect(r1.ok).toBe(false);
    expect(r1.cancelled).toBe(true);
    expect(r1.astId).toBeNull();

    // stale compile's worker generation was terminated (not left running the stale parse)
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(created[0].terminated).toBe(true);
    expect(created.length).toBeGreaterThanOrEqual(2); // fresh worker for the latest compile

    autoReply = "success";
    const r2 = await c2;
    expect(r2.ok).toBe(true);
    expect(r2.astId).toBe(hashSource(src2));
    h.dispose();
  });

  it("run-budget breach settles only the offending run as budgetExceeded; sibling queued request is interrupted, not budget-exceeded", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const a = h.run({ slot: "a", source: SMA, bars: genBars(10), budgetMs: 300 });
    const b = h.run({ slot: "b", source: SMA, bars: genBars(10), budgetMs: 800 });

    await vi.advanceTimersByTimeAsync(400); // only A's 300ms budget elapses
    const ra = await a;
    const rb = await b;

    // A breached its own wall budget
    expect(ra.budgetExceeded).toBe(true);
    expect(ra.ok).toBe(false);
    expect(ra.errors[0].message).toMatch(/budget/);

    // B was queued/sibling — must say cancelled/interrupted, NOT claim it consumed A's budget
    expect(rb.ok).toBe(false);
    expect(rb.cancelled).toBe(true);
    expect(rb.interrupted).toBe(true);
    expect(rb.budgetExceeded).toBeFalsy();
    expect(rb.errors.some((e) => /budget/.test(e.message))).toBe(false);
    expect(created[0].terminated).toBe(true);
    h.dispose();
  });

  it("compile-budget breach interrupts a sibling run honestly (cancelled/interrupted, not budgetExceeded)", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const runP = h.run({ slot: "s", source: SMA, bars: genBars(10), budgetMs: 5000 });
    const cP = h.compile(SMA); // compile default budget 1500ms; never replies

    await vi.advanceTimersByTimeAsync(1600);
    const c = await cP;
    expect(c.ok).toBe(false);
    expect(c.budgetExceeded).toBe(true);
    expect(c.astId).toBeNull();

    const r = await runP;
    expect(r.ok).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(r.interrupted).toBe(true);
    expect(r.budgetExceeded).toBeFalsy();
    expect(created[0].terminated).toBe(true);
    h.dispose();
  });

  it("disposed WorkerHost: typed cancellation, no sync compile/run, parser never invoked, no new worker", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    expect(h.usingWorker).toBe(true);
    h.dispose();

    const spy = vi.spyOn(parser, "parse");
    const c = await h.compile(SMA);
    const r = await h.run({ slot: "x", source: SMA, bars: genBars(10) });
    expect(c.ok).toBe(false);
    expect(c.cancelled).toBe(true);
    expect(c.astId).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(r.result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(created.length).toBe(0); // dispose must not lazily spawn
    spy.mockRestore();
  });

  it("disposed SyncHost: typed cancellation, parser never invoked", async () => {
    delete (globalThis as any).Worker;
    vi.resetModules();
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    expect(h.usingWorker).toBe(false);
    h.dispose();

    const spy = vi.spyOn(parser, "parse");
    const c = await h.compile(SMA);
    const r = await h.run({ slot: "x", source: SMA, bars: genBars(10) });
    expect(c.ok).toBe(false);
    expect(c.cancelled).toBe(true);
    expect(c.astId).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(r.result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reset of shared worker settles interrupted other requests honestly (dispose with in-flight work)", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const runP = h.run({ slot: "s", source: SMA, bars: genBars(10), budgetMs: 5000 });
    const cP = h.compile(SMA);
    h.dispose();

    const r = await runP;
    const c = await cP;
    expect(r.ok).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(r.interrupted).toBe(true);
    expect(r.budgetExceeded).toBeFalsy();
    expect(c.ok).toBe(false);
    expect(c.cancelled).toBe(true);
    expect(c.astId).toBeNull();
    expect(created[0].terminated).toBe(true);
  });

  it("late onerror/onmessage from a terminated worker generation cannot cancel/settle a newer request", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();

    // gen1: compile never replies → budget breach terminates it
    const c1 = h.compile(SMA);
    await vi.advanceTimersByTimeAsync(1600);
    const r1 = await c1;
    expect(r1.budgetExceeded).toBe(true);
    expect(created[0].terminated).toBe(true);
    const stale = created[0];

    // gen2: a newer in-flight run
    autoReply = "none";
    const runP = h.run({ slot: "s", source: SMA, bars: genBars(10), budgetMs: 5000 });
    expect(created.length).toBe(2);
    const fresh = created[1];

    // stale generation callbacks must be ignored — they must NOT failAll/cancel the newer request
    stale.onerror?.();
    stale.onmessage?.({ data: { kind: "ran", reqId: runP as any, ok: false, errors: [], result: null } });
    // also fire a plausible stale compiled/run reply carrying a non-existent reqId shape
    stale.onmessage?.({ data: { kind: "compiled", reqId: 999999, ok: true, errors: [], astId: "dead" } });

    // newer request still in flight (not settled by stale callbacks)
    let settledEarly = false;
    void runP.then(() => { settledEarly = true; });
    await Promise.resolve();
    expect(settledEarly).toBe(false);

    // fresh generation still answers the newer request
    fresh.onmessage?.({ data: { kind: "ran", reqId: fresh.posted[0].reqId, ok: true, errors: [], result: { plots: [], shapes: [], warnings: [] } } });
    const rr = await runP;
    expect(rr.ok).toBe(true);
    h.dispose();
  });

  it("worker constructor (startup) throw settles compile/run promises instead of stranding them", async () => {
    spawnThrows = true;
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();

    let cRes: any; let cThrew = false;
    try { cRes = await h.compile(SMA); } catch { cThrew = true; }
    expect(cThrew).toBe(false);
    expect(cRes.ok).toBe(false);

    let rRes: any; let rThrew = false;
    try { rRes = await h.run({ slot: "s", source: SMA, bars: genBars(5), budgetMs: 500 }); } catch { rThrew = true; }
    expect(rThrew).toBe(false);
    expect(rRes.ok).toBe(false);
    h.dispose();
  });

  it("postMessage throw settles the request promise (typed outcome, no hang, no strand)", async () => {
    postThrows = true;
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();

    let cRes: any; let cThrew = false;
    try { cRes = await h.compile(SMA); } catch { cThrew = true; }
    expect(cThrew).toBe(false);
    expect(cRes.ok).toBe(false);

    let rRes: any; let rThrew = false;
    try { rRes = await h.run({ slot: "s", source: SMA, bars: genBars(5), budgetMs: 500 }); } catch { rThrew = true; }
    expect(rThrew).toBe(false);
    expect(rRes.ok).toBe(false);
    h.dispose();
  });

  it("sibling interruption identity: the interrupted sibling is its own request (slot/reqId identity preserved in settlement shape)", async () => {
    const host = await import("../pine-engine/host");
    const h = host.createPineHost();
    const keep = h.run({ slot: "keep", source: SMA, bars: genBars(10), budgetMs: 300 });
    const drop = h.run({ slot: "drop", source: SMA, bars: genBars(10), budgetMs: 900 });
    await vi.advanceTimersByTimeAsync(400);
    const rk = await keep;
    const rd = await drop;
    expect(rk.budgetExceeded).toBe(true);
    expect(rd.interrupted).toBe(true);
    expect(rd.cancelled).toBe(true);
    expect(rd.budgetExceeded).toBeFalsy();
    // honest shape: sibling still carries run payload fields (result null) rather than a compile-only shape
    expect(rd).toHaveProperty("result", null);
    h.dispose();
  });
});
