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

// ── request.security higher-timeframe publication (monthly, quarterly, multi-week, sessions) ──
// The reference model below is built here, independently of the engine: calendar periods group
// bars by ISO week / month / quarter of the bar date; session periods use the canonical
// lib/sessionBars grid at anchor 0 ([0], [1..m], [m+1..2m], …). A period's value may be shown
// (lookahead_off) only from the session that closes it, and only when a later session proves it
// closed; until then the previous closed period's value is carried.
const HTF_HOLIDAYS = new Set(["2025-01-20", "2025-02-17"]);
function tradingDays(from: string, to: string): Bar[] {
  const out: Bar[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) {
    const d = new Date(t);
    const time = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || HTF_HOLIDAYS.has(time)) continue;
    const i = out.length;
    const c = 100 + ((i * 7) % 13) + i * 0.1;   // non-monotone, every close distinct
    out.push({ time, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i });
  }
  return out;
}
type CalUnit = "W" | "M" | "Q" | "Y";
function calKey(time: string, unit: CalUnit): string {
  if (unit === "Y") return time.slice(0, 4);
  if (unit === "M") return time.slice(0, 7);
  if (unit === "Q") return time.slice(0, 4) + "Q" + Math.floor((Number(time.slice(5, 7)) - 1) / 3);
  const d = new Date(time + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
interface RefGroups { of: number[]; last: number[]; closed: boolean[] }
function calGroups(bars: Bar[], unit: CalUnit): RefGroups {
  const of: number[] = [], last: number[] = [];
  let key = "";
  bars.forEach((b, i) => { const k = calKey(b.time, unit); if (k !== key) { key = k; last.push(i); } else last[last.length - 1] = i; of.push(last.length - 1); });
  return { of, last, closed: last.map((_, g) => g < last.length - 1) };   // closed = a later session exists
}
function sessGroups(n: number, m: number): RefGroups {
  const of: number[] = [], last: number[] = [];
  for (let i = 0; i < n; i++) { const g = i === 0 ? 0 : Math.ceil(i / m); of.push(g); last[g] = i; }
  return { of, last, closed: last.map((l) => l % m === 0) };              // complete = its m-th session
}
function refHtfBars(bars: Bar[], G: RefGroups): Bar[] {
  const out: Bar[] = [];
  bars.forEach((b, i) => {
    const g = G.of[i]; const cur = out[g];
    if (!cur) out[g] = { ...b };
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; cur.time = b.time; }
  });
  return out;
}
/** Index of the higher-timeframe bar a lookahead_off request may show at chart bar i (-1 = none). */
function publishedGroup(G: RefGroups, i: number): number {
  const g = G.of[i];
  return G.closed[g] && i >= G.last[g] ? g : g - 1;
}
const refSma = (xs: number[], n: number) => xs.map((_, b) => { if (b < n - 1) return undefined; let s = 0; for (let j = b - n + 1; j <= b; j++) s += xs[j]; return s / n; });
function expectSeries(actual: (number | undefined)[], expected: (number | undefined)[], label: string) {
  expect(actual.length, label).toBe(expected.length);
  actual.forEach((v, i) => {
    if (expected[i] === undefined) expect(v, `${label} @${i}`).toBeUndefined();
    else expect(v, `${label} @${i}`).toBeCloseTo(expected[i]!, 9);
  });
}
function secPlot(bars: Bar[], tf: string, expr: string, extra = "", chartTf = "D") {
  const out = runPine(`//@version=6\nindicator("htf")\nplot(request.security(syminfo.tickerid, "${tf}", ${expr}${extra ? ", " + extra : ""}), "x")\n`, bars, { timeframe: chartTf, symbol: "TEST" });
  expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  return { x: out.result!.plots[0].data.map((p) => p.value), warnings: out.result!.warnings };
}
const at = (bars: Bar[], time: string) => { const i = bars.findIndex((b) => b.time === time); expect(i, time).toBeGreaterThanOrEqual(0); return i; };
const noBucketFallback = (warnings: string[]) => expect(warnings.filter((w) => /bucket mapping|not implemented/.test(w)), JSON.stringify(warnings)).toEqual([]);

describe("request.security shows a monthly or quarterly value only after the period closes", () => {
  const bars = tradingDays("2025-01-02", "2025-04-15");

  it("daily → 1M (lookahead_off) shows each month's close from its last session; the open final month carries the previous close", () => {
    const G = calGroups(bars, "M"), H = refHtfBars(bars, G);
    const got = secPlot(bars, "M", "close");
    expect(got.x[at(bars, "2025-01-30")]).toBeUndefined();                 // January is still open
    expect(got.x[at(bars, "2025-01-31")]).toBe(bars[at(bars, "2025-01-31")].c);
    expect(got.x[at(bars, "2025-02-27")]).toBe(bars[at(bars, "2025-01-31")].c);
    expect(got.x[at(bars, "2025-04-15")]).toBe(bars[at(bars, "2025-03-31")].c);   // April has no later session
    expectSeries(got.x, bars.map((_, i) => { const p = publishedGroup(G, i); return p >= 0 ? H[p].c : undefined; }), "1M close");
    expect(got.warnings.some((w) => w.includes("'M'") && w.includes("not confirmed")), JSON.stringify(got.warnings)).toBe(true);
    noBucketFallback(got.warnings);
  });

  it("changing the last session of a month cannot change any earlier displayed value", () => {
    const jan31 = at(bars, "2025-01-31");
    const b = bars.map((r) => ({ ...r }));
    b[jan31] = { ...b[jan31], h: 10000, l: 1, c: 9999, v: 1 };
    for (const extra of ["", "gaps=barmerge.gaps_on", "lookahead=barmerge.lookahead_off"]) {
      for (const expr of ["close", "high", "low", "volume", "ta.sma(close, 2)"]) {
        expect(secPlot(b, "M", expr, extra).x.slice(0, jan31), `${expr} ${extra}`).toEqual(secPlot(bars, "M", expr, extra).x.slice(0, jan31));
      }
    }
  });

  it("gaps_on shows a monthly value only on the session that closes the month", () => {
    const G = calGroups(bars, "M"), H = refHtfBars(bars, G);
    const got = secPlot(bars, "M", "close", "gaps=barmerge.gaps_on, lookahead=barmerge.lookahead_off");
    expectSeries(got.x, bars.map((_, i) => { const g = G.of[i]; return G.closed[g] && i === G.last[g] ? H[g].c : undefined; }), "1M gaps_on");
    noBucketFallback(got.warnings);
  });

  it("lookahead_on with close[1] shows the previous closed month on every session of the month", () => {
    const G = calGroups(bars, "M"), H = refHtfBars(bars, G);
    const got = secPlot(bars, "M", "close[1]", "lookahead=barmerge.lookahead_on");
    expectSeries(got.x, bars.map((_, i) => (G.of[i] > 0 ? H[G.of[i] - 1].c : undefined)), "1M lookahead_on close[1]");
    noBucketFallback(got.warnings);
  });

  it("daily → 3M groups by calendar quarter and shows the quarter only from its last session", () => {
    const G = calGroups(bars, "Q"), H = refHtfBars(bars, G);
    const got = secPlot(bars, "3M", "close");
    expect(got.x[at(bars, "2025-03-28")]).toBeUndefined();
    expect(got.x[at(bars, "2025-03-31")]).toBe(bars[at(bars, "2025-03-31")].c);
    expectSeries(got.x, bars.map((_, i) => { const p = publishedGroup(G, i); return p >= 0 ? H[p].c : undefined; }), "3M close");
  });

  it("monthly chart → 3M groups whole monthly bars into quarters without leaking the quarter close", () => {
    const daily = tradingDays("2024-01-02", "2025-06-13");
    const monthly = refHtfBars(daily, calGroups(daily, "M"));                // keyed by each month's last session, like the chart
    const G = calGroups(monthly, "Q"), H = refHtfBars(monthly, G);
    const got = secPlot(monthly, "3M", "close", "", "1M");
    expectSeries(got.x, monthly.map((_, i) => { const p = publishedGroup(G, i); return p >= 0 ? H[p].c : undefined; }), "1M chart → 3M");
    noBucketFallback(got.warnings);
  });
});

describe("request.security refuses periods it cannot rebuild honestly", () => {
  const bars = tradingDays("2025-01-02", "2025-04-15");
  const refused = (got: { x: (number | undefined)[]; warnings: string[] }, tf: string) => {
    expect(got.x.every((v) => v === undefined), `${tf} values ${JSON.stringify(got.x.slice(0, 12))}`).toBe(true);
    expect(got.warnings.some((w) => w.includes(`'${tf}'`) && w.includes("returning na")), JSON.stringify(got.warnings)).toBe(true);
    noBucketFallback(got.warnings);
  };

  it("multi-week periods have no known calendar phase in the loaded bars and return na with a reason", () => {
    refused(secPlot(bars, "2W", "close"), "2W");
    refused(secPlot(bars, "3W", "close", "lookahead=barmerge.lookahead_on"), "3W");
  });

  it("a weekly chart cannot be regrouped into months, and unsupported counts or intraday units are refused", () => {
    const weekly = refHtfBars(bars, calGroups(bars, "W"));
    refused(secPlot(weekly, "M", "close", "", "W"), "M");
    refused(secPlot(weekly, "M", "close", "lookahead=barmerge.lookahead_off", "W"), "M");
    refused(secPlot(bars, "5M", "close"), "5M");
    refused(secPlot(bars, "48H", "close"), "48H");
  });

  it("a period of the same length in a different unit is not the chart's own timeframe and is refused", () => {
    // 7 sessions are not one calendar week, 30 sessions are not one month, and 1440 minutes or
    // 24 hours are not one trading session, even though each pair has the same nominal seconds.
    const weekly = refHtfBars(bars, calGroups(bars, "W"));
    const longer = tradingDays("2024-01-02", "2025-04-15");
    const monthly = refHtfBars(longer, calGroups(longer, "M"));
    refused(secPlot(weekly, "7D", "close", "", "W"), "7D");
    refused(secPlot(monthly, "30D", "close", "", "M"), "30D");
    refused(secPlot(bars, "1440", "close"), "1440");
    refused(secPlot(bars, "24H", "close"), "24H");
    // the same unit and count is the chart's own timeframe and is answered in place
    expectSeries(secPlot(weekly, "1W", "close", "", "W").x, weekly.map((b) => b.c), "W chart, 1W");
    expectSeries(secPlot(monthly, "1M", "close", "", "M").x, monthly.map((b) => b.c), "M chart, 1M");
    expectSeries(secPlot(bars, "1D", "close").x, bars.map((b) => b.c), "D chart, 1D");
  });

  it("bar times that are not ascending calendar dates refuse a calendar request", () => {
    const b = bars.map((r) => ({ ...r }));
    [b[5], b[6]] = [{ ...b[6] }, { ...b[5] }];
    refused(secPlot(b, "M", "close"), "M");
  });
});

describe("request.security 2D / 3D use the canonical session grid", () => {
  const bars = tradingDays("2025-01-02", "2025-04-15");
  for (const m of [2, 3]) {
    it(`daily → ${m}D shows a session group only once all ${m} of its sessions are loaded and says the phase is the feed's first session`, () => {
      const G = sessGroups(bars.length, m), H = refHtfBars(bars, G);
      const got = secPlot(bars, `${m}D`, "close");
      expectSeries(got.x, bars.map((_, i) => { const p = publishedGroup(G, i); return p >= 0 ? H[p].c : undefined; }), `${m}D close`);
      expect(got.warnings.some((w) => w.includes(`'${m}D'`) && w.includes("no session anchor")), JSON.stringify(got.warnings)).toBe(true);
      noBucketFallback(got.warnings);
    });
  }

  // Reference grid at a nonzero phase: global index of row i is i + a; a group closes on a global
  // index ≡ 0 (mod m) and the next one opens on the following session (lib/sessionBars law).
  const anchoredGroups = (n: number, m: number, a: number): RefGroups => {
    const of: number[] = [], last: number[] = [];
    let g = -1;
    for (let i = 0; i < n; i++) { if (i === 0 || (i - 1 + a) % m === 0) g++; of.push(g); last[g] = i; }
    return { of, last, closed: last.map((l) => (l + a) % m === 0) };
  };
  const anchoredRun = (m: number, anchor: { v: number; date: string; index: number; basis: string }) => {
    const out = runPine(`//@version=6\nindicator("anchored")\nplot(request.security(syminfo.tickerid, "${m}D", close), "x")\n`, bars, { timeframe: "D", symbol: "TEST", sessionAnchor: anchor });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    return { x: out.result!.plots[0].data.map((p) => p.value), warnings: out.result!.warnings };
  };
  for (const [m, a] of [[3, 1], [3, 2], [2, 1]]) {
    it(`daily → ${m}D follows a published session anchor at phase ${a}, not the feed's first session`, () => {
      // The anchor names a session that is in the loaded bars and its global index; row 0 is then
      // global index a, exactly as ChartPanel.resampleTf builds the chart's own ${m}D bars.
      const anchor = { v: 1, date: bars[10].time, index: 10 + a, basis: "ipo" };
      const G = anchoredGroups(bars.length, m, a), H = refHtfBars(bars, G);
      const got = anchoredRun(m, anchor);
      expectSeries(got.x, bars.map((_, i) => { const p = publishedGroup(G, i); return p >= 0 ? H[p].c : undefined; }), `${m}D anchored at ${a}`);
      expect(got.x, "the anchor must change the grid").not.toEqual(secPlot(bars, `${m}D`, "close").x);
      expect(got.warnings.filter((w) => w.includes("session anchor") || w.includes("feed-phase")), JSON.stringify(got.warnings)).toEqual([]);
      noBucketFallback(got.warnings);
    });
  }
  it("a session anchor whose date is not among the loaded sessions falls back to the first loaded session and says so", () => {
    const G = sessGroups(bars.length, 3), H = refHtfBars(bars, G);
    const got = anchoredRun(3, { v: 1, date: "2019-01-02", index: 40, basis: "ipo" });
    expectSeries(got.x, bars.map((_, i) => { const p = publishedGroup(G, i); return p >= 0 ? H[p].c : undefined; }), "3D unresolved anchor");
    expect(got.warnings.some((w) => w.includes("'3D'") && w.includes("2019-01-02") && w.includes("not among the loaded sessions")), JSON.stringify(got.warnings)).toBe(true);
  });
});

describe("request.security prefix vs full history at every cutoff", () => {
  // Observation cutoff k: the prefix holds bars[0..k-1]; values at j < k are compared with the
  // full-history run. The ONE documented retrospective correction: for a calendar period (W, M,
  // 3M) the session that closes the period is only known to close it once a later session exists,
  // so at the cutoff j = k-1 that is such a session the prefix still carries the previous closed
  // value (gaps_off) or na (gaps_on). Session-count periods (2D, 3D) have no correction at all.
  const bars = tradingDays("2025-01-02", "2025-03-14");
  const kinds: [string, string][] = [["c", "close"], ["p", "close[1]"], ["f", "f(close + 0, 1)"], ["s", "ta.sma(close, 2)"], ["g", "close, gaps=barmerge.gaps_on"]];
  const src = (tf: string) => `//@version=6\nindicator("cut")\nf(src, n) => src[n]\n` + kinds.map(([t, e]) => `plot(request.security(syminfo.tickerid, "${tf}", ${e}), "${t}")`).join("\n") + "\n";
  const series = (b: Bar[], tf: string) => {
    const out = runPine(src(tf), b, { timeframe: "D", symbol: "TEST" });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    return Object.fromEntries(out.result!.plots.map((p) => [p.title, p.data.map((d) => d.value)])) as Record<string, (number | undefined)[]>;
  };
  const cases: [string, RefGroups | null][] = [["W", calGroups(bars, "W")], ["M", calGroups(bars, "M")], ["3M", calGroups(bars, "Q")], ["2D", null], ["3D", null]];
  for (const [tf, G] of cases) {
    it(`${tf}: every prefix agrees with full history except the documented period-close correction`, () => {
      const full = series(bars, tf);
      const closing = new Set<number>(G ? G.last.filter((_, g) => G.closed[g]) : []);
      const diffs: string[] = [];
      for (let k = 1; k <= bars.length; k++) {
        const pre = series(bars.slice(0, k), tf);
        for (const [t] of kinds) {
          for (let j = 0; j < k; j++) {
            if (Object.is(pre[t][j], full[t][j])) continue;
            const documented = G !== null && j === k - 1 && closing.has(j)
              && Object.is(pre[t][j], t === "g" ? undefined : (j > 0 ? full[t][j - 1] : undefined));
            if (!documented) diffs.push(`${t} cutoff=${k} bar=${j} prefix=${pre[t][j]} full=${full[t][j]}`);
          }
        }
        if (G && closing.has(k - 1)) expect(pre.c[k - 1], `close is corrected at cutoff ${k}`).not.toBe(full.c[k - 1]);
      }
      expect(diffs.slice(0, 20), `${diffs.length} undocumented differences`).toEqual([]);
    });
  }
});

describe("request.security contexts do not contaminate each other", () => {
  const bars = tradingDays("2025-01-02", "2025-04-15");
  const W = calGroups(bars, "W"), WH = refHtfBars(bars, W);
  const M = calGroups(bars, "M"), MH = refHtfBars(bars, M);
  const shown = (G: RefGroups, perHtf: (number | undefined)[]) => bars.map((_, i) => { const p = publishedGroup(G, i); return p >= 0 ? perHtf[p] : undefined; });

  it("a ta.* call inside a weekly request runs once per weekly bar, not once per daily bar", () => {
    expectSeries(secPlot(bars, "W", "ta.sma(close, 3)").x, shown(W, refSma(WH.map((b) => b.c), 3)), "weekly sma3");
  });

  it("barstate and ta.tr inside a weekly request describe the weekly bar", () => {
    expectSeries(secPlot(bars, "W", "barstate.isfirst ? 1 : 0").x, shown(W, WH.map((_, b) => (b === 0 ? 1 : 0))), "weekly isfirst");
    const tr = WH.map((b, k) => (k === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - WH[k - 1].c), Math.abs(b.l - WH[k - 1].c))));
    expectSeries(secPlot(bars, "W", "ta.tr").x, shown(W, tr), "weekly true range");
  });

  it("one user function used on the chart, in a weekly and in a monthly request keeps three separate histories", () => {
    const out = runPine(`//@version=6
indicator("ctx")
f() => ta.sma(close, 2) + (timeframe.ismonthly ? 1000 : timeframe.isweekly ? 100 : 0)
plot(f(), "d")
plot(request.security(syminfo.tickerid, "W", f()), "w")
plot(request.security(syminfo.tickerid, "M", f()), "m")
`, bars, { timeframe: "D", symbol: "TEST" });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    const p = (t: string) => out.result!.plots.find((q) => q.title === t)!.data.map((d) => d.value);
    const add = (xs: (number | undefined)[], k: number) => xs.map((x) => (x === undefined ? undefined : x + k));
    expectSeries(p("d"), refSma(bars.map((b) => b.c), 2), "chart f()");
    expectSeries(p("w"), shown(W, add(refSma(WH.map((b) => b.c), 2), 100)), "weekly f()");
    expectSeries(p("m"), shown(M, add(refSma(MH.map((b) => b.c), 2), 1000)), "monthly f()");
  });

  it("accepted weekly default publication is unchanged", () => {
    expectSeries(secPlot(bars, "W", "close").x, shown(W, WH.map((b) => b.c)), "weekly close");
  });

  it("a timeframe argument computed from timeframe.period still reads the requested context", () => {
    // Like the flagship's oneUp(timeframe.period): on the daily chart this asks for W, but inside
    // the weekly pass the same argument names M. The chart's request is still answered by W.
    const out = runPine(`//@version=6
indicator("tf arg")
up = timeframe.isdaily ? "W" : "M"
sec(_tf, _src) => request.security(syminfo.tickerid, _tf, _src, lookahead=barmerge.lookahead_off)
plot(request.security(syminfo.tickerid, up, close), "direct")
plot(sec(up, close), "fn")
`, bars, { timeframe: "D", symbol: "TEST" });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    const p = (t: string) => out.result!.plots.find((q) => q.title === t)!.data.map((d) => d.value);
    expectSeries(p("direct"), shown(W, WH.map((b) => b.c)), "direct up-TF");
    expectSeries(p("fn"), shown(W, WH.map((b) => b.c)), "function up-TF");
    expect(out.result!.warnings.filter((w) => w.includes("not evaluated")), JSON.stringify(out.result!.warnings)).toEqual([]);
  });

  it("a request inside a for loop, or reached twice on one bar, returns na with a reason", () => {
    const run = (body: string) => {
      const out = runPine(`//@version=6\nindicator("loop")\nsec(_src) => request.security(syminfo.tickerid, "W", _src)\nacc = 0.0\nfor j = 0 to 1\n    ${body}\nplot(acc, "x")\n`, bars, { timeframe: "D", symbol: "TEST" });
      expect(out.ok, JSON.stringify(out.errors)).toBe(true);
      return { x: out.result!.plots[0].data.map((d) => d.value), warnings: out.result!.warnings };
    };
    const direct = run(`acc := acc + request.security(syminfo.tickerid, "W", close)`);
    expect(direct.x.every((v) => v === undefined), JSON.stringify(direct.x.slice(0, 8))).toBe(true);
    expect(direct.warnings.some((w) => w.includes("'W'") && w.includes("for loop")), JSON.stringify(direct.warnings)).toBe(true);
    const viaFn = run(`acc := acc + sec(close)`);
    expect(viaFn.x.every((v) => v === undefined), JSON.stringify(viaFn.x.slice(0, 8))).toBe(true);
    // A function called from a loop is still inside the loop, so it gets the loop's own reason.
    expect(viaFn.warnings.some((w) => w.includes("'W'") && w.includes("for loop")), JSON.stringify(viaFn.warnings)).toBe(true);
    noBucketFallback(viaFn.warnings);
  });

  it("a request in a function called from a for loop is refused even when the loop runs once on the requested timeframe", () => {
    // The loop runs twice on the daily chart but once inside the weekly pass, so the weekly pass
    // records one value per weekly bar; the chart must not add that one value up twice.
    const out = runPine(`//@version=6
indicator("loop fn")
sec(_src) => request.security(syminfo.tickerid, "W", _src)
n = timeframe.isdaily ? 1 : 0
acc = 0.0
for j = 0 to n
    acc := acc + sec(close + j * 1000)
plot(acc, "acc")
plot(request.security(syminfo.tickerid, "W", close), "w")
`, bars, { timeframe: "D", symbol: "TEST" });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    const p = (t: string) => out.result!.plots.find((q) => q.title === t)!.data.map((d) => d.value);
    expect(p("acc").every((v) => v === undefined), JSON.stringify(p("acc").slice(0, 12))).toBe(true);
    expect(out.result!.warnings.some((w) => w.includes("'W'") && w.includes("for loop")), JSON.stringify(out.result!.warnings)).toBe(true);
    expectSeries(p("w"), shown(W, WH.map((b) => b.c)), "weekly close outside the loop");
  });
});

describe("request.security call sites reached on only some higher-timeframe bars", () => {
  // The call site sits under `if close > 200`, which holds only in even months. Inside the monthly
  // pass it is therefore skipped on every odd month, so its ta.sma would run over a thinned monthly
  // history. Such a value is not the requested series: it is refused with a reason.
  const bars: Bar[] = [];
  for (let t = Date.parse("2025-01-02T00:00:00Z"); bars.length < 160; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() % 6 === 0) continue;
    const i = bars.length; const mo = d.getUTCMonth() + 1;
    const c = (mo % 2 === 0 ? 300 : 100) + i * 0.5;
    bars.push({ time: d.toISOString().slice(0, 10), o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i });
  }
  const M = calGroups(bars, "M"), MH = refHtfBars(bars, M);
  const sma2 = refSma(MH.map((b) => b.c), 2);
  const run = (cond: string, la: string) => {
    const out = runPine(`//@version=6
indicator("x")
v = 0.0
if ${cond}
    v := request.security(syminfo.tickerid, "M", ta.sma(close, 2), lookahead = barmerge.${la})
u = request.security(syminfo.tickerid, "M", ta.sma(close, 2), lookahead = barmerge.${la})
plot(v, "cond")
plot(u, "uncond")
`, bars, { timeframe: "D", symbol: "T" });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    const p = (t: string) => out.result!.plots.find((q) => q.title === t)!.data.map((d) => d.value);
    return { cond: p("cond"), uncond: p("uncond"), warnings: out.result!.warnings };
  };
  const expectedUncond = (la: string) => bars.map((_, i) => { const g = la === "lookahead_on" ? M.of[i] : publishedGroup(M, i); return g >= 0 ? sma2[g] : undefined; });

  for (const la of ["lookahead_on", "lookahead_off"]) {
    it(`a monthly request under a condition that skips some months (${la}) returns na with a reason`, () => {
      const got = run("close > 200", la);
      const reached = bars.map((b) => b.c > 200);
      expect(reached.filter(Boolean).length).toBeGreaterThan(40);
      const shownValues = bars.flatMap((b, i) => (reached[i] && got.cond[i] !== undefined ? [`${b.time}=${got.cond[i]}`] : []));
      expect(shownValues.slice(0, 5), `${shownValues.length} values from a thinned monthly history`).toEqual([]);
      bars.forEach((b, i) => { if (!reached[i]) expect(got.cond[i], b.time).toBe(0); });
      expect(got.warnings.some((w) => w.includes("not reached on every 'M' bar")), JSON.stringify(got.warnings)).toBe(true);
      expectSeries(got.uncond, expectedUncond(la), `unconditional ${la}`);
    });

    it(`a monthly request under a condition that holds on every monthly bar is still answered (${la})`, () => {
      // Skipped on half the daily bars, but reached on every monthly bar inside the monthly pass.
      const got = run("timeframe.isdaily ? bar_index % 2 == 0 : true", la);
      const exp = expectedUncond(la);
      expectSeries(got.uncond, exp, `unconditional ${la}`);
      expectSeries(got.cond, bars.map((_, i) => (i % 2 === 0 ? exp[i] : 0)), `conditional ${la}`);
      expect(got.warnings.filter((w) => w.includes("not reached")), JSON.stringify(got.warnings)).toEqual([]);
    });
  }
});

describe("request.security prefix vs full history across a year rollover, 12M, a 7-day calendar and a mid-period start", () => {
  // Same observation-cutoff check as above, plus the full run against the reference model, on
  // calendars the first loop does not cover: a start in the middle of a week, month and quarter
  // that runs across a year boundary (W, M, 3M, 12M, 3D), and a seven-session week such as a
  // crypto feed (W, M, 7D, 2D), where seven sessions and one week are different periods.
  const calendarDays = (from: string, to: string): Bar[] => {
    const out: Bar[] = [];
    for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) {
      const i = out.length; const c = 100 + ((i * 7) % 13) + i * 0.1;
      out.push({ time: new Date(t).toISOString().slice(0, 10), o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i });
    }
    return out;
  };
  const rollover = tradingDays("2024-11-13", "2025-02-12");   // starts on a Wednesday mid-month, mid-quarter
  const sevenDay = calendarDays("2025-01-01", "2025-03-05");  // Wednesday start, weekends included
  const kinds: [string, string][] = [["c", "close"], ["p", "close[1]"], ["s", "ta.sma(close, 2)"], ["g", "close, gaps=barmerge.gaps_on"]];
  const src = (tf: string) => `//@version=6\nindicator("cut")\n` + kinds.map(([t, e]) => `plot(request.security(syminfo.tickerid, "${tf}", ${e}), "${t}")`).join("\n") + "\n";
  const series = (b: Bar[], tf: string) => {
    const out = runPine(src(tf), b, { timeframe: "D", symbol: "TEST" });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    return Object.fromEntries(out.result!.plots.map((p) => [p.title, p.data.map((d) => d.value)])) as Record<string, (number | undefined)[]>;
  };
  const cases: [string, Bar[], string, RefGroups, boolean][] = [
    ["rollover", rollover, "W", calGroups(rollover, "W"), true],
    ["rollover", rollover, "M", calGroups(rollover, "M"), true],
    ["rollover", rollover, "3M", calGroups(rollover, "Q"), true],
    ["rollover", rollover, "12M", calGroups(rollover, "Y"), true],
    ["rollover", rollover, "3D", sessGroups(rollover.length, 3), false],
    ["7-day", sevenDay, "W", calGroups(sevenDay, "W"), true],
    ["7-day", sevenDay, "M", calGroups(sevenDay, "M"), true],
    ["7-day", sevenDay, "7D", sessGroups(sevenDay.length, 7), false],
    ["7-day", sevenDay, "2D", sessGroups(sevenDay.length, 2), false],
  ];
  for (const [cal, bars, tf, G, calendar] of cases) {
    it(`${cal} calendar, ${tf}: the full run matches the reference model and every prefix agrees except the period-close correction`, () => {
      const H = refHtfBars(bars, G);
      const full = series(bars, tf);
      expectSeries(full.c, bars.map((_, i) => { const p = publishedGroup(G, i); return p >= 0 ? H[p].c : undefined; }), `${cal} ${tf} close`);
      expectSeries(full.g, bars.map((_, i) => { const g = G.of[i]; return G.closed[g] && i === G.last[g] ? H[g].c : undefined; }), `${cal} ${tf} gaps_on`);
      const closing = new Set<number>(calendar ? G.last.filter((_, g) => G.closed[g]) : []);
      const diffs: string[] = [];
      for (let k = 1; k <= bars.length; k++) {
        const pre = series(bars.slice(0, k), tf);
        for (const [t] of kinds) {
          for (let j = 0; j < k; j++) {
            if (Object.is(pre[t][j], full[t][j])) continue;
            const documented = calendar && j === k - 1 && closing.has(j)
              && Object.is(pre[t][j], t === "g" ? undefined : (j > 0 ? full[t][j - 1] : undefined));
            if (!documented) diffs.push(`${t} cutoff=${k} bar=${j} prefix=${pre[t][j]} full=${full[t][j]}`);
          }
        }
      }
      expect(diffs.slice(0, 20), `${diffs.length} undocumented differences`).toEqual([]);
      if (tf === "7D") expect(full.c, "seven sessions are not one calendar week here").not.toEqual(series(bars, "W").c);
    });
  }
});
