/**
 * chartEngineCadence.test.ts — pure unit tests for the Q03 presented-frame
 * cadence parser + Playwright protocol helpers.
 *
 * Test files run under vitest Node environment (no jsdom pragma). Per task
 * spec the fixture is a real trimmed slice of a fresh Chromium CDP trace;
 * the Browser-pid copy and the M-B pre-window pair are derived IN THIS FILE
 * from that fixture (not edited into the fixture itself).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildCadenceReceipt,
  asTraceEvents,
  p50,
  p95,
  p99,
  parsePresentedFrames,
  gestureStats,
  gestureIntervals,
  userTimingMs,
  userTimingAllMs,
  inputLatencyStats,
  presentedIntervals,
  measureVsync,
  frameSequenceIntervals,
  checkInputMarkClock,
  validateCadenceReceipt,
  CADENCE_BUDGETS,
  type CadenceGestureStats,
  type CadenceDisplay,
  type ParsedPresentation,
} from "../chart-engine/bench/cadence";
import { percentile, UNMEASURED } from "../chart-engine/bench/corpus";
import { BUDGETS } from "../chart-engine/bench/receipt";

const FIX_DIR = path.resolve(__dirname, "fixtures", "chart-engine");
const SAMPLE = JSON.parse(readFileSync(path.join(FIX_DIR, "cadence-trace.sample.json"), "utf8"));
const RAF_ONLY = JSON.parse(readFileSync(path.join(FIX_DIR, "cadence-trace.raf-only.sample.json"), "utf8"));
const INPUT_SAMPLE = JSON.parse(readFileSync(path.join(FIX_DIR, "cadence-trace.input.sample.json"), "utf8"));

const SAMPLE_EVENTS = asTraceEvents(SAMPLE);
const INPUT_SAMPLE_EVENTS = asTraceEvents(INPUT_SAMPLE);
// The single pid the Q03b fixture carries (its renderer); used by 12b to
// derive a Browser-pid copy without hardcoding it twice.
const FIXTURE_PID_FOR_MARKS = 2;

// Pin the oracle literals computed in the throwaway script in $TMPDIR.
// The script never touches cadence.ts; the literals are the contract.
const ORACLE = {
  rendererPid: 2,
  presented: 19,
  partial: 0,
  dropped: 9,
  presentedMsLen: 19,
  presentedMsFirst: -117.511,
  presentedMsLast: 8019.647,
  winPresented: 17,
  winPartial: 0,
  winDropped: 9,
  intervalsCount: 16,
  p50: 42.865999999999985,
  p95: 3837.846,
  p99: 3837.846,
} as const;

describe("parsePresentedFrames (Q03)", () => {
  it("1. renders the sample fixture: rendererPid, counts, presentedMs literals match the oracle", () => {
    const parsed = parsePresentedFrames(SAMPLE_EVENTS);
    expect(parsed.rendererPid).toBe(ORACLE.rendererPid);
    expect(parsed.presented).toBe(ORACLE.presented);
    expect(parsed.partial).toBe(ORACLE.partial);
    expect(parsed.dropped).toBe(ORACLE.dropped);
    expect(parsed.presentedMs.length).toBe(ORACLE.presentedMsLen);
    expect(parsed.presentedMs[0]).toBe(ORACLE.presentedMsFirst);
    expect(parsed.presentedMs[parsed.presentedMs.length - 1]).toBe(ORACLE.presentedMsLast);
    // Frame-reducer rule: presented == #distinct presentation times (forks
    // de-duplicated), NOT the slice count.
    expect(parsed.presented).toBe(new Set(parsed.presentedMs).size);
    // A forked {ALL + DROPPED} pair is ONE presented frame, NOT a drop.
    expect(parsed.dropped).toBeLessThan(parsed.presentedMs.length + parsed.partial + parsed.dropped);
  });

  it("2. gestureStats in-window numbers and percentiles match the oracle; pre-window idle gap is excluded", () => {
    const parsed = parsePresentedFrames(SAMPLE_EVENTS);
    const startMs = userTimingMs(SAMPLE_EVENTS, "cadence:pan:start");
    const endMs = userTimingMs(SAMPLE_EVENTS, "cadence:pan:end");
    expect(startMs).not.toBeNull();
    expect(endMs).not.toBeNull();
    if (startMs == null || endMs == null) throw new Error("unreachable");
    // M-B guard: presentedMs[0] is at -117.511 (before the gesture window
    // start of 100 ms). The interval between that and the first in-window
    // entry MUST be excluded, so intervals.length == 16 (not 18).
    expect(parsed.presentedMs[0]).toBeLessThan(startMs);
    const intervals = gestureIntervals(parsed.presentedMs, startMs, endMs + 100);
    expect(intervals.length).toBe(ORACLE.intervalsCount);

    const stats = gestureStats(parsed, startMs, endMs, 200);
    expect(stats.presented).toBe(ORACLE.winPresented);
    expect(stats.partial).toBe(ORACLE.winPartial);
    expect(stats.dropped).toBe(ORACLE.winDropped);
    expect(stats.p50_ms).toBeCloseTo(ORACLE.p50, 9);
    expect(stats.p95_ms).toBeCloseTo(ORACLE.p95, 9);
    expect(stats.p99_ms).toBeCloseTo(ORACLE.p99, 9);
  });

  it("3. renderer selection: with a Browser-pid copy present the chosen pid is unchanged; missing/other pids throw", () => {
    // (a) Browser-pid copy: clone every renderer PipelineReporter event to pid 1
    // with the same id2 key so a Browser that also emitted PipelineReporter
    // does NOT change selection.
    const clone: unknown[] = [];
    const id2Keys = new Set<string>();
    for (const e of SAMPLE_EVENTS) {
      const r = e as { name?: unknown; pid?: unknown; id2?: { local?: unknown } };
      if (r.name === "PipelineReporter" && r.pid === ORACLE.rendererPid) {
        const id2 = r.id2;
        const local = id2?.local;
        if (typeof local === "string") id2Keys.add(local);
      }
    }
    let i = 0;
    for (const e of SAMPLE_EVENTS) {
      const r = e as { name?: unknown; pid?: unknown; id2?: { local?: unknown } };
      if (r.name === "PipelineReporter" && r.pid === ORACLE.rendererPid) {
        const localKey = [...id2Keys][i++ % Math.max(1, id2Keys.size)];
        const rec = e as Record<string, unknown>;
        clone.push({
          ...rec,
          pid: 1,
          id2: { local: `browser-${localKey}` },
        });
      }
    }
    const withBrowser = [...SAMPLE_EVENTS, ...clone];
    const parsed = parsePresentedFrames(withBrowser);
    expect(parsed.rendererPid).toBe(ORACLE.rendererPid);

    // Marks removed: now no blink.user_timing mark, AND two reporter pids (the
    // renderer pid still has its own events, Browser pid from clone). Without
    // a mark, the parser must throw "no presentation records in trace".
    const noMarks = SAMPLE_EVENTS.filter((e) => {
      const r = e as { cat?: unknown };
      return r.cat !== "blink.user_timing";
    });
    const noMarksWithBrowser = [...noMarks, ...clone];
    expect(() => parsePresentedFrames(noMarksWithBrowser))
      .toThrow(/no presentation records in trace/);

    // Marks present BUT pointing at a pid that has no PipelineReporter, while
    // some OTHER pid DOES have reporters (A2: throw, do not fall back).
    const noMarksRendererReporters = SAMPLE_EVENTS.filter((e) => {
      const r = e as { name?: unknown; pid?: unknown; cat?: unknown };
      return !(r.name === "PipelineReporter" && r.pid === ORACLE.rendererPid);
    });
    // Add one reporter event on pid 99 so two reporter pids exist; the
    // existing cadence:pan:start mark still points at pid 2 (which now has
    // no reporters at all).
    const otherPidReporters: unknown[] = [
      {
        name: "PipelineReporter",
        pid: 99,
        ph: "b",
        ts: 100_000,
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        args: {
          frame_reporter: { state: "STATE_PRESENTED_ALL", frame_source: 1, frame_sequence: 1 },
        },
      },
      {
        name: "PipelineReporter",
        pid: 99,
        ph: "e",
        ts: 100_500,
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        id2: { local: "0x1" },
      },
    ];
    expect(() => parsePresentedFrames([...noMarksRendererReporters, ...otherPidReporters]))
      .toThrow(/no presentation records in trace/);
  });

  it("4. raf-only fixture throws 'no presentation records'; [] and {} via asTraceEvents also throw (M-C)", () => {
    expect(() => parsePresentedFrames(asTraceEvents(RAF_ONLY))).toThrow(/no presentation records in trace/);
    expect(() => parsePresentedFrames(asTraceEvents([]))).toThrow(/no presentation records in trace/);
    expect(() => parsePresentedFrames(asTraceEvents({} as unknown))).toThrow(/no presentation records in trace/);
  });

  it("5. X form: a small synthetic 4-frame trace renders the same presentedMs in b/e and X form", () => {
    // 4 frames in a single track. pairKey = "0x1". Each b has the state and
    // frame metadata; each e ends the slice; the X variant collapses to one
    // event with ts+dur.
    const baseTs = 1_000_000;
    const state = "STATE_PRESENTED_ALL";
    const source = 42;
    const seqs = [10, 11, 12, 13];
    function beForm(): unknown[] {
      const ev: unknown[] = [];
      let t = baseTs;
      for (const s of seqs) {
        ev.push({
          name: "PipelineReporter",
          pid: 2,
          tid: 10,
          ph: "b",
          ts: t,
          cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
          id2: { local: "0x1" },
          args: { frame_reporter: { state, frame_source: source, frame_sequence: s } },
        });
        t += 1000;
        ev.push({
          name: "PipelineReporter",
          pid: 2,
          tid: 10,
          ph: "e",
          ts: t,
          cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
          id2: { local: "0x1" },
        });
      }
      return ev;
    }
    function xForm(): unknown[] {
      const ev: unknown[] = [];
      let t = baseTs;
      for (const s of seqs) {
        ev.push({
          name: "PipelineReporter",
          pid: 2,
          tid: 10,
          ph: "X",
          ts: t,
          dur: 1000,
          cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
          args: { frame_reporter: { state, frame_source: source, frame_sequence: s } },
        });
        t += 1000;
      }
      return ev;
    }
    const p1 = parsePresentedFrames(beForm());
    const p2 = parsePresentedFrames(xForm());
    expect(p1.presentedMs).toEqual(p2.presentedMs);
    expect(p1.presentedMs.length).toBe(4);
    expect(p2.presentedMs.length).toBe(4);
  });
});

describe("percentile shims and BUDGETS (Q03 / Q02 interop)", () => {
  it("6. [1..20] -> p50 10, p95 19, p99 20; [1..200] -> p95 190, p99 198 (M-D guard)", () => {
    const a = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(p50(a)).toBe(10);
    expect(p95(a)).toBe(19);
    expect(p99(a)).toBe(20);
    // Cross-check vs corpus.percentile, the canonical implementation.
    expect(p95(a)).toBe(percentile([...a], 0.95));
    expect(p99(a)).toBe(percentile([...a], 0.99));

    const b = Array.from({ length: 200 }, (_, i) => i + 1);
    expect(p95(b)).toBe(190);
    expect(p99(b)).toBe(198);
    expect(p95(b)).toBe(percentile([...b], 0.95));
    expect(p99(b)).toBe(percentile([...b], 0.99));
  });

  it("7. CADENCE_BUDGETS and BUDGETS are the canonical handshake", () => {
    expect(CADENCE_BUDGETS).toEqual({
      presented_p95_ms: 20,
      presented_p99_ms: 33.4,
      input_to_present_p95_ms: 20,
      input_to_present_p99_ms: 33.4,
    });
    expect(BUDGETS).toEqual({
      first_paint_ms: 150,
      pan_frame_p95_ms: 18,
      zoom_frame_p95_ms: 18,
      live_commit_ms: 4,
      screenshot_ms: 50,
      heap_mb: 60,
    });
  });
});

describe("inputLatencyStats / presentedIntervals / measureVsync / checkInputMarkClock (Q03b)", () => {
  // Test 9 first case: presentedMs [10, 20, 30, 40], start 5, end 35, marks
  // [5, 12, 12, 20, 33, 34.5, 50]. 50 lies outside [5, 35]. Two marks at 12
  // de-duplicate. So marks = [5, 12, 20, 33, 34.5]. For each, find the
  // FIRST presentedMs >= m with p <= 35 + 100 = 135 (no tail effect here).
  //   m=5   -> p=10   -> 5
  //   m=12  -> p=20   -> 8
  //   m=20  -> p=20   -> 0 (equality counts)
  //   m=33  -> p=40   -> 7
  //   m=34.5 -> p=40  -> 5.5
  // Sorted latencies = [0, 5, 5.5, 7, 8]. p50 = 5.5, p95 = 8, p99 = 8.
  // input_marks = 5, input_unpresented = 0.
  function parsedWithPresented(presentedMs: number[], extraFrames: ParsedPresentation["frames"] = []): ParsedPresentation {
    const presentedSet = new Set(presentedMs);
    const partial = extraFrames.filter((f) => f.state === "partial");
    const dropped = extraFrames.filter((f) => f.state === "dropped");
    const frames: ParsedPresentation["frames"] = [
      ...partial,
      ...dropped,
      ...presentedMs.map((ms) => ({ ms, state: "presented" as const })),
    ].sort((a, b) => a.ms - b.ms);
    return {
      frames,
      presentedMs,
      presented: presentedSet.size,
      partial: partial.length,
      dropped: dropped.length,
      rendererPid: 2,
    };
  }

  it("9a. first case: marks are de-duplicated and bounded by the window; at-or-after rule counts equality; latencies correct", () => {
    const parsed = parsedWithPresented([10, 20, 30, 40]);
    const stats = inputLatencyStats(parsed, [5, 12, 12, 20, 33, 34.5, 50], 5, 35);
    expect(stats.input_marks).toBe(5);
    expect(stats.input_unpresented).toBe(0);
    expect(stats.input_to_present_p50_ms).toBe(5.5);
    expect(stats.input_to_present_p95_ms).toBe(8);
    expect(stats.input_to_present_p99_ms).toBe(8);
  });

  // 9b: presentedMs [10, 200], start 0, end 50. mark 15 -> p must be >= 15 AND
  // <= 50 + 100 = 150. 10 is too early; 200 > 150, too late. So unpresented.
  // p95 is the percentile over the empty list -> UNMEASURED (a violation,
  // never NaN).
  it("9b. second case: input with no presentation in tail -> unpresented; p95 is UNMEASURED, never NaN", () => {
    const parsed = parsedWithPresented([10, 200]);
    const stats = inputLatencyStats(parsed, [15], 0, 50);
    expect(stats.input_marks).toBe(1);
    expect(stats.input_unpresented).toBe(1);
    expect(stats.input_to_present_p50_ms).toBe(UNMEASURED);
    expect(stats.input_to_present_p95_ms).toBe(UNMEASURED);
    expect(stats.input_to_present_p99_ms).toBe(UNMEASURED);
    expect(Number.isNaN(stats.input_to_present_p95_ms)).toBe(false);
  });

  // 9c: partial / dropped frames in parsed.frames must NEVER answer an
  // input — only presentedMs (which holds STATE_PRESENTED_ALL) does.
  it("9c. partial and dropped frames never answer an input; presentedMs is the only source", () => {
    const parsed: ParsedPresentation = {
      frames: [
        { ms: 10, state: "presented" },
        { ms: 20, state: "partial" },
        { ms: 30, state: "dropped" },
      ],
      presentedMs: [10],
      presented: 1,
      partial: 1,
      dropped: 1,
      rendererPid: 2,
    };
    // The mark at 15 must NOT pick up the partial at 20 or the dropped at
    // 30; only the presented frame at 10 is too early so input is
    // unpresented.
    const stats = inputLatencyStats(parsed, [15], 0, 50);
    expect(stats.input_unpresented).toBe(1);
    expect(stats.input_to_present_p95_ms).toBe(UNMEASURED);
  });

  it("10. inputLatencyStats throws 'no input marks' for [] and for marks all outside [start, end]", () => {
    const parsed = parsedWithPresented([10, 20, 30]);
    expect(() => inputLatencyStats(parsed, [], 0, 50)).toThrow(/no input marks/);
    expect(() => inputLatencyStats(parsed, [200, 300], 0, 50)).toThrow(/no input marks/);
    expect(() => inputLatencyStats(parsed, [-100, -50], 0, 50)).toThrow(/no input marks/);
  });

  it("11. presentedIntervals / measureVsync: rounded-mode ties -> smallest value; [0,-1,NaN] and [] throw; mean does not win", () => {
    expect(presentedIntervals([1, 1, 5, 9])).toEqual([4, 4]);
    // 16.66 -> 16.7, 16.68 -> 16.7, 16.71 -> 16.7, 33.4 -> 33.4, 8.3 -> 8.3.
    // counts: 16.7 x3, 33.4 x1, 8.3 x1. mode = 16.7, hz = round(1000/16.7) = 60.
    expect(measureVsync([16.66, 16.68, 16.71, 33.4, 8.3])).toEqual({ vsync_ms: 16.7, hz: 60 });
    // 10 x2, 20 x2 -> tie -> smallest -> 10 -> hz 100.
    expect(measureVsync([10, 10, 20, 20])).toEqual({ vsync_ms: 10, hz: 100 });
    // 10 x3, 40 x1 -> 10 / 100. Mean of rounded values would be
    // (10+10+10+40)/4 = 17.5 which is neither 60 Hz nor 120 Hz.
    expect(measureVsync([10, 10, 10, 40])).toEqual({ vsync_ms: 10, hz: 100 });
    expect(() => measureVsync([0, -1, Number.NaN])).toThrow(/no presented intervals/);
    expect(() => measureVsync([])).toThrow(/no presented intervals/);
  });

  it("12. checkInputMarkClock: equal deltas ok; one off by 0.5 fails; count mismatch fails; [] [] ok; userTimingAllMs returns sorted ascending marks", () => {
    // userTimingAllMs: sample fixture has the cadence:pan:start mark on the
    // renderer pid; we verify it returns a sorted ascending array.
    const marks = userTimingAllMs(SAMPLE_EVENTS, "cadence:pan:start", ORACLE.rendererPid);
    expect(marks.length).toBeGreaterThan(0);
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i]).toBeGreaterThanOrEqual(marks[i - 1] as number);
    }
    // Equal deltas -> ok.
    expect(checkInputMarkClock([1000, 1010, 1020], [1000, 1010, 1020])).toEqual({ ok: true, maxDeviationMs: 0 });
    // One delta off by 0.5 ms -> fail.
    const off = checkInputMarkClock([1000, 1010.5, 1020], [1000, 1010, 1020]);
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toMatch(/deviation at i=1/);
    // Count mismatch -> fail.
    const cm = checkInputMarkClock([1000, 1010], [1000, 1010, 1020]);
    expect(cm.ok).toBe(false);
    if (!cm.ok) expect(cm.reason).toMatch(/count mismatch trace=2 page=3/);
    // Empty -> ok.
    expect(checkInputMarkClock([], [])).toEqual({ ok: true, maxDeviationMs: 0 });
  });

  // The bench passes the renderer pid so a Browser-pid copy of the same mark
  // name cannot leak into the input set (and so cannot inflate input_marks or
  // trip the clock check's equal-count rule). Derived here from the real
  // fixture; the fixture itself stays a single-pid trace.
  it("12b. userTimingAllMs drops a Browser-pid copy of the same mark name when a pid is given", () => {
    const rendererPid = FIXTURE_PID_FOR_MARKS;
    const browserPid = rendererPid + 99;
    const copies = INPUT_SAMPLE_EVENTS.filter((e) => {
      const r = e as { cat?: unknown; name?: unknown };
      return r.cat === "blink.user_timing" && r.name === "cadence:pan:input";
    }).map((e) => ({ ...(e as Record<string, unknown>), pid: browserPid }));
    const withBrowser = [...INPUT_SAMPLE_EVENTS, ...copies];
    expect(userTimingAllMs(withBrowser, "cadence:pan:input", rendererPid).length).toBe(48);
    expect(userTimingAllMs(withBrowser, "cadence:pan:input").length).toBe(96);
    expect(userTimingAllMs(INPUT_SAMPLE_EVENTS, "cadence:pan:input", browserPid)).toEqual([]);
  });
});

describe("buildCadenceReceipt / validateCadenceReceipt (Q03)", () => {
  const GREEN_DISPLAY: CadenceDisplay = { vsync_ms: 16.7, hz: 60 };
  function greenStats(overrides: Partial<CadenceGestureStats> = {}): CadenceGestureStats {
    return {
      inputs: 200,
      input_hz: 20,
      presented: 200,
      partial: 0,
      dropped: 0,
      p50_ms: 8,
      p95_ms: 18,
      p99_ms: 28,
      input_marks: 200,
      input_unpresented: 0,
      input_to_present_p50_ms: 8,
      input_to_present_p95_ms: 18,
      input_to_present_p99_ms: 28,
      ...overrides,
    };
  }
  function greenReceipt() {
    return buildCadenceReceipt({
      commit: "a".repeat(40),
      impl: "mm",
      host: { os: "test-os", cpu: "test-cpu", dpr: 2 },
      display: { ...GREEN_DISPLAY },
      generated_at: "2026-01-01T00:00:00.000Z",
      pan: greenStats(),
      zoom: greenStats(),
    });
  }

  it("8a. over-budget pair -> violations in METRIC_ORDER, budget_ok false", () => {
    const r = buildCadenceReceipt({
      commit: "a".repeat(40),
      impl: "mm",
      host: { os: "x", cpu: "y", dpr: 2 },
      display: { ...GREEN_DISPLAY },
      generated_at: "2026-01-01T00:00:00.000Z",
      pan: greenStats({ p95_ms: 21 }), // over pan_p95 budget
      zoom: greenStats({ p99_ms: 40 }), // over zoom_p99 budget
    });
    expect(r.violations.map((v) => v.metric)).toEqual([
      "pan.presented_p95_ms",
      "zoom.presented_p99_ms",
    ]);
    expect(r.budget_ok).toBe(false);
    expect(r.violations[0]?.value).toBe(21);
    expect(r.violations[0]?.budget).toBe(20);
    expect(r.violations[1]?.value).toBe(40);
    expect(r.violations[1]?.budget).toBe(33.4);
  });

  it("8b. validates a built receipt; rejects missing key, extra top-level key, extra stat key, bad commit/impl/budgets/budget_ok/neg/NaN", () => {
    const r = greenReceipt();
    expect(validateCadenceReceipt(r).ok).toBe(true);

    // Missing top-level key.
    {
      const bad = { ...r } as Record<string, unknown>;
      delete bad.budget_ok;
      expect(validateCadenceReceipt(bad).ok).toBe(false);
    }
    // Extra top-level key (A3).
    {
      const bad = { ...r, surprise: 1 };
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /surprise/.test(e))).toBe(true);
    }
    // Extra stat key on gesture.pan (A3).
    {
      const bad = JSON.parse(JSON.stringify(r));
      bad.gesture.pan.bogus = 1;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /bogus/.test(e))).toBe(true);
    }
    // Bad commit.
    expect(validateCadenceReceipt({ ...r, commit: "abc" }).ok).toBe(false);
    // Bad impl.
    expect(validateCadenceReceipt({ ...r, impl: "x" }).ok).toBe(false);
    // Bad budgets.
    expect(validateCadenceReceipt({ ...r, budgets: { ...r.budgets, presented_p95_ms: 21 } }).ok).toBe(false);
    // budget_ok flipped to true when violations exist.
    {
      const badReceipt = greenReceipt();
      const r2 = buildCadenceReceipt({
        commit: "a".repeat(40),
        impl: "mm",
        host: { os: "x", cpu: "y", dpr: 2 },
        display: { ...GREEN_DISPLAY },
        generated_at: "2026-01-01T00:00:00.000Z",
        pan: greenStats({ p95_ms: 21 }),
        zoom: greenStats(),
      });
      const flipped = { ...r2, budget_ok: true };
      expect(validateCadenceReceipt(flipped).ok).toBe(false);
      // Just to silence "noUnused": badReceipt is unused.
      expect(validateCadenceReceipt(badReceipt).ok).toBe(true);
    }
    // Negative count.
    {
      const neg = JSON.parse(JSON.stringify(r));
      neg.gesture.pan.presented = -1;
      expect(validateCadenceReceipt(neg).ok).toBe(false);
    }
    // NaN p95.
    {
      const nan = JSON.parse(JSON.stringify(r));
      nan.gesture.pan.p95_ms = Number.NaN;
      expect(validateCadenceReceipt(nan).ok).toBe(false);
    }
  });

  it("13. Q03b receipt: 10 top-level keys, 13 stat keys, METRIC_ORDER adds 4 input_to_present rows; rejects display / budgets / latency shape errors", () => {
    const r = greenReceipt();
    expect(validateCadenceReceipt(r).ok).toBe(true);
    // Violations order: pan.presented_p95_ms, pan.presented_p99_ms,
    // zoom.presented_p95_ms, zoom.presented_p99_ms, pan.input_to_present_p95_ms,
    // pan.input_to_present_p99_ms, zoom.input_to_present_p95_ms,
    // zoom.input_to_present_p99_ms. We trigger only the input-to-present ones
    // by raising those metrics while keeping the presented ones at 18 / 28.
    const viol = buildCadenceReceipt({
      commit: "a".repeat(40),
      impl: "mm",
      host: { os: "x", cpu: "y", dpr: 2 },
      display: { vsync_ms: 16.7, hz: 60 },
      generated_at: "2026-01-01T00:00:00.000Z",
      pan: greenStats({ input_to_present_p95_ms: 25, input_to_present_p99_ms: 40 }),
      zoom: greenStats({ input_to_present_p95_ms: 25, input_to_present_p99_ms: 40 }),
    });
    expect(viol.violations.map((v) => v.metric)).toEqual([
      "pan.input_to_present_p95_ms",
      "pan.input_to_present_p99_ms",
      "zoom.input_to_present_p95_ms",
      "zoom.input_to_present_p99_ms",
    ]);

    // 10 top-level keys (9 v1 + `protocol`), 13 gesture stat keys. Q03c v2
    // bumps the top-level count by 1; the unit test is updated in lock-step
    // with the validator's TOP_LEVEL_KEYS.
    const keyCount = (o: unknown) => (o && typeof o === "object" ? Object.keys(o as Record<string, unknown>).length : 0);
    expect(keyCount(r)).toBe(10);
    expect(keyCount(r.gesture.pan)).toBe(13);
    expect(keyCount(r.gesture.zoom)).toBe(13);
    expect(r.protocol).toBe("q03b-v1");
    // missing protocol -> rejected
    {
      const bad = JSON.parse(JSON.stringify(r));
      delete bad.protocol;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /protocol/.test(e))).toBe(true);
    }
    // unknown protocol -> rejected
    {
      const bad = JSON.parse(JSON.stringify(r));
      bad.protocol = "q03b-v5";
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /protocol/.test(e))).toBe(true);
    }
    // v1 receipt carrying a v2-specific zoom key -> rejected
    {
      const bad = JSON.parse(JSON.stringify(r));
      bad.gesture.zoom.answered_by_prior_frame = 0;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /answered_by_prior_frame/.test(e))).toBe(true);
    }

    // display missing.
    {
      const bad = JSON.parse(JSON.stringify(r));
      delete bad.display;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /display/.test(e))).toBe(true);
    }
    // display extra key.
    {
      const bad = JSON.parse(JSON.stringify(r));
      bad.display.extra = 1;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /display key "extra"/.test(e))).toBe(true);
    }
    // hz 61 with vsync_ms 16.7 -> mismatch.
    {
      const bad = JSON.parse(JSON.stringify(r));
      bad.display.hz = 61;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /display\.hz/.test(e))).toBe(true);
    }
    // vsync_ms 0.
    {
      const bad = JSON.parse(JSON.stringify(r));
      bad.display.vsync_ms = 0;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /vsync_ms/.test(e))).toBe(true);
    }
    // budgets missing input_to_present_p99_ms.
    {
      const bad = JSON.parse(JSON.stringify(r));
      const budgets: Record<string, number> = { ...r.budgets };
      delete budgets.input_to_present_p99_ms;
      bad.budgets = budgets;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /budgets/.test(e))).toBe(true);
    }
    // budgets with an extra key.
    {
      const bad = JSON.parse(JSON.stringify(r));
      bad.budgets = { ...r.budgets, extra: 10 };
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /budgets/.test(e))).toBe(true);
    }
    // input_to_present_p95_ms set to 21 in budgets (canonical handshake).
    {
      const bad = JSON.parse(JSON.stringify(r));
      bad.budgets = { ...r.budgets, input_to_present_p95_ms: 21 };
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /budgets/.test(e))).toBe(true);
    }
    // input_unpresented > input_marks.
    {
      const bad = JSON.parse(JSON.stringify(r));
      bad.gesture.pan.input_marks = 10;
      bad.gesture.pan.input_unpresented = 11;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /input_unpresented/.test(e))).toBe(true);
    }
    // missing latency stat key.
    {
      const bad = JSON.parse(JSON.stringify(r));
      delete bad.gesture.zoom.input_to_present_p95_ms;
      const v = validateCadenceReceipt(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => /input_to_present_p95_ms/.test(e))).toBe(true);
    }
  });

  it("20. input_marks >= 1: a gesture.pan.input_marks of 0 is rejected with an error matching /input_marks/", () => {
    const r = greenReceipt();
    const bad = JSON.parse(JSON.stringify(r));
    bad.gesture.pan.input_marks = 0;
    bad.gesture.pan.input_unpresented = 0;
    const v = validateCadenceReceipt(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => /input_marks/.test(e))).toBe(true);
  });
});

describe("input-mark fixture (cadence-trace.input.sample.json) — Q03b", () => {
  // Oracle literals computed in the throwaway script in $TMPDIR. The script
  // never imports cadence.ts; nearest-rank percentile idx = min(n-1, max(0,
  // ceil(p*n)-1)) on the ascending list; 0.1 ms rounding as round(x*10)/10.
  const FIXTURE_ORACLE = {
    rendererPid: 2,
    presented: 30,
    partial: 0,
    dropped: 19,
    presentedMsLen: 30,
    presentedMsFirst: 1777316219.821,
    presentedMsLast: 1777325348.308,
    // in-window gestureStats numbers (window = [start, end + 100] ms):
    winPresented: 28,
    winPartial: 0,
    winDropped: 19,
    winIntervalsCount: 27,
    winP50: 46.35800004005432,
    winP95: 57.301000118255615,
    winP99: 7746.933000087738,
    winInputHz: 22.5,
    // raw input-mark count on pid 2:
    panRawMarksCount: 48,
    // inputLatencyStats numbers (the fixture has 24 unique marks in [start, end]):
    panInputMarks: 24,
    panInputUnpresented: 0,
    panP50: 7.929,
    panP95: 8.616,
    panP99: 8.687,
    // vsync numbers:
    vsyncMs: 36.8,
    vsyncHz: 27,
    seqIntervalsCount: 77,
    seqVsyncMs: 16.7,
    seqVsyncHz: 60,
  } as const;

  it("14. real input fixture: parsePresentedFrames, userTimingAllMs, inputLatencyStats return the oracle literals", () => {
    const parsed = parsePresentedFrames(INPUT_SAMPLE_EVENTS);
    expect(parsed.rendererPid).toBe(FIXTURE_ORACLE.rendererPid);
    expect(parsed.presented).toBe(FIXTURE_ORACLE.presented);
    expect(parsed.partial).toBe(FIXTURE_ORACLE.partial);
    expect(parsed.dropped).toBe(FIXTURE_ORACLE.dropped);
    expect(parsed.presentedMs.length).toBe(FIXTURE_ORACLE.presentedMsLen);
    expect(parsed.presentedMs[0]).toBeCloseTo(FIXTURE_ORACLE.presentedMsFirst, 6);
    expect(parsed.presentedMs[parsed.presentedMs.length - 1]).toBeCloseTo(FIXTURE_ORACLE.presentedMsLast, 6);

    const rawMarks = userTimingAllMs(INPUT_SAMPLE_EVENTS, "cadence:pan:input", FIXTURE_ORACLE.rendererPid);
    expect(rawMarks.length).toBe(FIXTURE_ORACLE.panRawMarksCount);

    const startMs = userTimingMs(INPUT_SAMPLE_EVENTS, "cadence:pan:start");
    const endMs = userTimingMs(INPUT_SAMPLE_EVENTS, "cadence:pan:end");
    expect(startMs).not.toBeNull();
    expect(endMs).not.toBeNull();
    if (startMs == null || endMs == null) throw new Error("unreachable");

    const lat = inputLatencyStats(parsed, rawMarks, startMs, endMs);
    expect(lat.input_marks).toBe(FIXTURE_ORACLE.panInputMarks);
    expect(lat.input_unpresented).toBe(FIXTURE_ORACLE.panInputUnpresented);
    expect(lat.input_to_present_p50_ms).toBeCloseTo(FIXTURE_ORACLE.panP50, 6);
    expect(lat.input_to_present_p95_ms).toBeCloseTo(FIXTURE_ORACLE.panP95, 6);
    expect(lat.input_to_present_p99_ms).toBeCloseTo(FIXTURE_ORACLE.panP99, 6);

    // Cross-check: gestureStats over the same window yields the in-window
    // counts and percentiles the oracle computed.
    const stats = gestureStats(parsed, startMs, endMs, 200);
    expect(stats.presented).toBe(FIXTURE_ORACLE.winPresented);
    expect(stats.partial).toBe(FIXTURE_ORACLE.winPartial);
    expect(stats.dropped).toBe(FIXTURE_ORACLE.winDropped);
    expect(stats.p50_ms).toBeCloseTo(FIXTURE_ORACLE.winP50, 6);
    expect(stats.p95_ms).toBeCloseTo(FIXTURE_ORACLE.winP95, 6);
    expect(stats.p99_ms).toBeCloseTo(FIXTURE_ORACLE.winP99, 6);
    expect(stats.input_hz).toBeCloseTo(FIXTURE_ORACLE.winInputHz, 6);
  });

  it("15. real fixture vsync: measureVsync(presented intervals) and measureVsync(frame-sequence intervals) match the oracle", () => {
    const parsed = parsePresentedFrames(INPUT_SAMPLE_EVENTS);
    const display = measureVsync(presentedIntervals(parsed.presentedMs));
    expect(display).toEqual({ vsync_ms: FIXTURE_ORACLE.vsyncMs, hz: FIXTURE_ORACLE.vsyncHz });
    const seq = frameSequenceIntervals(INPUT_SAMPLE_EVENTS, FIXTURE_ORACLE.rendererPid);
    expect(seq.length).toBe(FIXTURE_ORACLE.seqIntervalsCount);
    expect(measureVsync(seq)).toEqual({ vsync_ms: FIXTURE_ORACLE.seqVsyncMs, hz: FIXTURE_ORACLE.seqVsyncHz });
  });

  it("16. derived cases on the real fixture: removing all input marks throws; identical-ts duplicate does not change numbers; clock check ok on constant shift, fail on 0.5 ms shift", () => {
    const parsed = parsePresentedFrames(INPUT_SAMPLE_EVENTS);
    const rawMarks = userTimingAllMs(INPUT_SAMPLE_EVENTS, "cadence:pan:input", FIXTURE_ORACLE.rendererPid);
    const startMs = userTimingMs(INPUT_SAMPLE_EVENTS, "cadence:pan:start")!;
    const endMs = userTimingMs(INPUT_SAMPLE_EVENTS, "cadence:pan:end")!;

    // (a) every input mark removed -> inputLatencyStats throws "no input marks".
    expect(() => inputLatencyStats(parsed, [], startMs, endMs)).toThrow(/no input marks/);

    // (b) every input mark duplicated with an identical ts (a derived
    // pointermove + compatibility mousemove pair) -> input_marks and all
    // percentiles unchanged.
    const duplicated: number[] = [];
    for (const m of rawMarks) duplicated.push(m, m);
    const statsD = inputLatencyStats(parsed, duplicated, startMs, endMs);
    expect(statsD.input_marks).toBe(FIXTURE_ORACLE.panInputMarks);
    expect(statsD.input_unpresented).toBe(FIXTURE_ORACLE.panInputUnpresented);
    expect(statsD.input_to_present_p50_ms).toBeCloseTo(FIXTURE_ORACLE.panP50, 6);
    expect(statsD.input_to_present_p95_ms).toBeCloseTo(FIXTURE_ORACLE.panP95, 6);
    expect(statsD.input_to_present_p99_ms).toBeCloseTo(FIXTURE_ORACLE.panP99, 6);

    // (c) checkInputMarkClock accepts equal deltas after a constant shift;
    // rejects when one entry is moved by 0.5 ms.
    const shift = 1000;
    const shifted = rawMarks.map((m) => m + shift);
    expect(checkInputMarkClock(rawMarks, shifted)).toEqual({ ok: true, maxDeviationMs: 0 });
    const moved = [...shifted];
    moved[5] = (moved[5] ?? 0) + 0.5;
    const bad = checkInputMarkClock(rawMarks, moved);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/deviation at i=/);
  });

  it("17. receipt round-trip: build a receipt from the fixture stats (both slots), validateCadenceReceipt ok; violations match what the literals imply", () => {
    const parsed = parsePresentedFrames(INPUT_SAMPLE_EVENTS);
    const startMs = userTimingMs(INPUT_SAMPLE_EVENTS, "cadence:pan:start")!;
    const endMs = userTimingMs(INPUT_SAMPLE_EVENTS, "cadence:pan:end")!;
    const rawMarks = userTimingAllMs(INPUT_SAMPLE_EVENTS, "cadence:pan:input", FIXTURE_ORACLE.rendererPid);
    const display = measureVsync(presentedIntervals(parsed.presentedMs));

    // pan slot: real fixture stats.
    const panBase = gestureStats(parsed, startMs, endMs, 200);
    const panLat = inputLatencyStats(parsed, rawMarks, startMs, endMs);
    const pan = { ...panBase, ...panLat };

    // zoom slot: the fixture only carries pan data; the cadence display is
    // the same so we use the same per-gesture numbers for both slots.
    const zoom = { ...panBase, ...panLat };

    const receipt = buildCadenceReceipt({
      commit: "a".repeat(40),
      impl: "mm",
      host: { os: "test-os", cpu: "test-cpu", dpr: 2 },
      display,
      generated_at: "2026-01-01T00:00:00.000Z",
      pan,
      zoom,
    });
    const v = validateCadenceReceipt(receipt);
    expect(v.ok).toBe(true);

    // pan.presented_p95_ms and pan.presented_p99_ms both EXCEED their budgets;
    // the input-to-present percentiles do not; the zoom slot mirrors the pan
    // slot. The expected violation list is therefore:
    expect(receipt.violations.map((x) => x.metric)).toEqual([
      "pan.presented_p95_ms",
      "pan.presented_p99_ms",
      "zoom.presented_p95_ms",
      "zoom.presented_p99_ms",
    ]);
    expect(receipt.budget_ok).toBe(false);
  });
});

describe("frameSequenceIntervals (Q03b vsync cross-check)", () => {
  // Helper to build a synthetic PipelineReporter `b` event on pid 2 with
  // explicit src/seq/ts (used by the synthetic-trace tests).
  function bEvent(ts: number, src: number, seq: number, state: string): unknown {
    return {
      name: "PipelineReporter",
      cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
      ph: "b",
      ts,
      pid: 2,
      tid: 11,
      id2: { local: `0x${seq.toString(16)}` },
      args: { frame_reporter: { state, frame_source: src, frame_sequence: seq } },
    };
  }
  function eEvent(ts: number, seq: number): unknown {
    return {
      name: "PipelineReporter",
      cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
      ph: "e",
      ts,
      pid: 2,
      tid: 11,
      id2: { local: `0x${seq.toString(16)}` },
    };
  }
  // Wrap a list of `b` events into the (b, e) pair shape parsePresentedFrames
  // expects; the cross-check itself only needs the b side.
  function pairBs(events: readonly unknown[]): unknown[] {
    const out: unknown[] = [];
    for (const e of events) {
      out.push(e);
      const r = e as { ts?: number; id2?: { local?: string } };
      const seqMatch = r.id2?.local?.match(/^0x([0-9a-f]+)$/i);
      const seq = seqMatch ? Number(seqMatch[1]) : 0;
      out.push(eEvent((r.ts ?? 0) + 1000, seq));
    }
    return out;
  }

  it("18a. source 1: seqs 1,4,7,10,11 at 0,30,60,90,100 ms -> [10,10,10,10]; measureVsync -> {10,100}; raw begin-time differences yield 30", () => {
    const seqs = [1, 4, 7, 10, 11];
    const tss = [0, 30, 60, 90, 100]; // ms (microseconds)
    const us = tss.map((t) => t * 1000);
    const events = pairBs(seqs.map((s, i) => bEvent(us[i] ?? 0, 1, s, "STATE_PRESENTED_ALL")));
    const out = frameSequenceIntervals(events, 2);
    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo(10, 9);
    expect(out[1]).toBeCloseTo(10, 9);
    expect(out[2]).toBeCloseTo(10, 9);
    expect(out[3]).toBeCloseTo(10, 9);
    // measureVsync of these four values -> {10, 100}.
    expect(measureVsync(out)).toEqual({ vsync_ms: 10, hz: 100 });
    // The raw begin-time differences are [30,30,30,10]; their mode is 30,
    // which is NOT the slot — proving the division matters.
    expect(measureVsync(tss.slice(1).map((t, i) => t - (tss[i] ?? 0)))).toEqual({ vsync_ms: 30, hz: 33 });
  });

  it("18b. adding a forked repeat of key 1:7 at a different ts leaves the result unchanged", () => {
    const seqs = [1, 4, 7, 10, 11];
    const tss = [0, 30, 60, 90, 100];
    const us = tss.map((t) => t * 1000);
    const base = seqs.map((s, i) => bEvent(us[i] ?? 0, 1, s, "STATE_PRESENTED_ALL"));
    // A forked repeat of key 1:7 at a later ts (a second `b` with the same key).
    const forked = bEvent(62 * 1000, 1, 7, "STATE_DROPPED");
    const events = pairBs([...base, forked]);
    const out = frameSequenceIntervals(events, 2);
    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo(10, 9);
    expect(out[1]).toBeCloseTo(10, 9);
    expect(out[2]).toBeCloseTo(10, 9);
    expect(out[3]).toBeCloseTo(10, 9);
  });

  it("18c. adding a second source 2 with sequences 1,2,3 -> [10,10] appended; never pairs across sources", () => {
    const seqs1 = [1, 4, 7, 10, 11];
    const tss1 = [0, 30, 60, 90, 100];
    const seqs2 = [1, 2, 3];
    const tss2 = [5, 15, 25];
    const us1 = tss1.map((t) => t * 1000);
    const us2 = tss2.map((t) => t * 1000);
    const events1 = seqs1.map((s, i) => bEvent(us1[i] ?? 0, 1, s, "STATE_PRESENTED_ALL"));
    const events2 = seqs2.map((s, i) => bEvent(us2[i] ?? 0, 2, s, "STATE_PRESENTED_ALL"));
    const out = frameSequenceIntervals([...pairBs(events1), ...pairBs(events2)], 2);
    // Sorted ascending over the full result: four 10s from source 1 and two
    // 10s from source 2, none of which may be from a cross-source pair.
    expect(out.length).toBe(6);
    const sorted = [...out].sort((a, b) => a - b);
    for (const v of sorted) expect(v).toBeCloseTo(10, 9);
    // The source groups are reported in insertion order (source 1 first,
    // source 2 second); the assertion is the sorted multiset.
    expect([...out].sort((a, b) => a - b)).toEqual(sorted);
  });

  it("18d. other pids, an 'e' event, and a 'b' without frame_sequence change nothing", () => {
    const seqs = [1, 4, 7, 10, 11];
    const tss = [0, 30, 60, 90, 100];
    const us = tss.map((t) => t * 1000);
    const base = seqs.map((s, i) => bEvent(us[i] ?? 0, 2, s, "STATE_PRESENTED_ALL"));
    // Reporter on a different pid -> ignored.
    const otherPid = bEvent(60_000, 1, 99, "STATE_PRESENTED_ALL");
    // An 'e' event carries no args -> ignored.
    const eOnly = eEvent(60_000, 7);
    // A `b` without frame_source or without frame_sequence -> ignored.
    const noFrameSeq = {
      name: "PipelineReporter",
      cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
      ph: "b",
      ts: 60_000,
      pid: 2,
      tid: 11,
      id2: { local: "0xff" },
      args: { frame_reporter: { state: "STATE_PRESENTED_ALL", frame_source: 1 } },
    };
    const noFrameSrc = {
      name: "PipelineReporter",
      cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
      ph: "b",
      ts: 60_000,
      pid: 2,
      tid: 11,
      id2: { local: "0xfe" },
      args: { frame_reporter: { state: "STATE_PRESENTED_ALL", frame_sequence: 5 } },
    };
    // Also: a cadence:input mark on pid 2 must not enter the cross-check.
    const userTiming = {
      name: "cadence:pan:input",
      cat: "blink.user_timing",
      ph: "I",
      ts: 60_000,
      pid: 2,
      tid: 10,
      s: "t",
    };
    const out = frameSequenceIntervals(
      [...pairBs(base), otherPid, eOnly, noFrameSeq, noFrameSrc, userTiming],
      2,
    );
    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo(10, 9);
    expect(out[1]).toBeCloseTo(10, 9);
    expect(out[2]).toBeCloseTo(10, 9);
    expect(out[3]).toBeCloseTo(10, 9);
  });

  it("18e. a single key returns [] and measureVsync([]) throws", () => {
    const events = pairBs([bEvent(0, 1, 1, "STATE_PRESENTED_ALL")]);
    const out = frameSequenceIntervals(events, 2);
    expect(out).toEqual([]);
    expect(() => measureVsync(out)).toThrow(/no presented intervals/);
  });

  it("19. frameSequenceIntervals on the real fixture: 47 intervals and measureVsync -> {16.7, 60}", () => {
    // The Q03 fixture (cadence-trace.sample.json, SAMPLE_EVENTS), not the
    // Q03b input fixture: a trimmed Chromium 149 pan trace with a single
    // source (frame_source = 4294967296) and 48 distinct sequence keys -> 47
    // consecutive (begin-time diff / sequence diff) values; the mode is
    // 16.7 ms -> hz 60.
    const out = frameSequenceIntervals(SAMPLE_EVENTS, ORACLE.rendererPid);
    expect(out.length).toBe(47);
    expect(measureVsync(out)).toEqual({ vsync_ms: 16.7, hz: 60 });
  });
});

// ============================================================================
// Q03c v2 protocol: pure-module pins, dispatch invariants, and receipt keys.
// RED-first falsifiers are below; each one mutates the implementation, runs,
// quotes the RED, restores, and quotes GREEN in the bench's RESULT.md.
// ============================================================================

import {
  mulberry32,
  cadenceV2Seed,
  cadenceV2ScheduleMs,
  dispatchOnSchedule,
  countDispatched,
  cadenceInvalidLine,
  CADENCE_INVALID_FIELDS,
  parsePresentedFrameSpans,
  answeredByPriorFrame,
  leadinPresentations,
  inputLatenciesMs,
  CADENCE_V2_WHEELS,
  CADENCE_V2_GAP_MIN_MS,
  CADENCE_V2_GAP_JITTER_MS,
  CADENCE_V2_DISPATCH_DEV_MAX_MS,
  CADENCE_V2_HEARTBEAT_MIN_MS,
  CADENCE_V2_SEED_BASE,
  type CadenceProtocol,
  type CadenceEndMarkDiag,
  type CadenceDispatch,
  type CadenceAwakeStart,
  type CadenceZoomV2Stats,
} from "../chart-engine/bench/cadence";

describe("mulberry32 / cadenceV2Seed / cadenceV2ScheduleMs (Q03c)", () => {
  it("21. mulberry32(1) first three draws are exact: 0.6270739405881613, 0.002735721180215478, 0.5274470399599522", () => {
    const rng = mulberry32(1);
    expect(rng()).toBe(0.6270739405881613);
    expect(rng()).toBe(0.002735721180215478);
    expect(rng()).toBe(0.5274470399599522);
  });

  it("22. cadenceV2Seed(0) === 0x51C03B00 === 1371552512 (uint32)", () => {
    expect(cadenceV2Seed(0)).toBe(1371552512);
  });

  it("23. cadenceV2ScheduleMs(1371552512) length 60, offsets[0]=0, gaps 1..3 toBeCloseTo expected, offsets[59] 1169.298", () => {
    const off = cadenceV2ScheduleMs(1371552512);
    expect(off.length).toBe(60);
    expect(off[0]).toBe(0);
    const g = (i: number) => off[i] - off[i - 1];
    expect(g(1)).toBeCloseTo(21.462893, 6);
    expect(g(2)).toBeCloseTo(17.612321, 6);
    expect(g(3)).toBeCloseTo(17.157030, 6);
    expect(off[59]).toBeCloseTo(1169.298, 3);
    // Every gap must lie in [17, 23).
    for (let i = 1; i < off.length; i++) {
      const gap = off[i] - off[i - 1];
      expect(gap).toBeGreaterThanOrEqual(CADENCE_V2_GAP_MIN_MS);
      expect(gap).toBeLessThan(CADENCE_V2_GAP_MIN_MS + CADENCE_V2_GAP_JITTER_MS);
    }
  });

  it("24. the same seed gives the same schedule across two engines (engine independence)", () => {
    const a = cadenceV2ScheduleMs(cadenceV2Seed(0));
    const b = cadenceV2ScheduleMs(cadenceV2Seed(0));
    expect(a).toEqual(b);
  });

  it("25. gap bound: every gap over the first 10 per-run seeds lies in [17, 23) and offsets[0] === 0", () => {
    // The GOLDEN assertion: the first gap of the reference seed, exactly.
    const off = cadenceV2ScheduleMs(1371552512);
    const gap1 = off[1] - off[0];
    expect(gap1).toBeCloseTo(21.462893, 6);
    expect(gap1).toBeGreaterThanOrEqual(CADENCE_V2_GAP_MIN_MS);
    expect(gap1).toBeLessThan(CADENCE_V2_GAP_MIN_MS + CADENCE_V2_GAP_JITTER_MS);
    // The real pin (replaces the old self-referential `mutantUpper`
    // expectations, which only compared local variables and so could never
    // fail): across the ten per-run seeds the bench actually uses, EVERY
    // gap is inside the half-open band and the schedule always anchors at 0.
    for (let runIdx = 0; runIdx < 10; runIdx++) {
      const seed = (CADENCE_V2_SEED_BASE + runIdx) >>> 0;
      expect(cadenceV2Seed(runIdx)).toBe(seed);
      const offsets = cadenceV2ScheduleMs(seed);
      expect(offsets.length).toBe(CADENCE_V2_WHEELS);
      expect(offsets[0]).toBe(0);
      for (let i = 1; i < offsets.length; i++) {
        const gap = offsets[i] - offsets[i - 1];
        expect(gap).toBeGreaterThanOrEqual(CADENCE_V2_GAP_MIN_MS);
        expect(gap).toBeLessThan(CADENCE_V2_GAP_MIN_MS + CADENCE_V2_GAP_JITTER_MS);
      }
    }
  });
});

describe("dispatchOnSchedule / countDispatched (Q03c v2)", () => {
  it("26. SETTLES while every send is still pending; all 60 fired in order (no-ack-wait)", async () => {
    const offsets = cadenceV2ScheduleMs(cadenceV2Seed(0));
    let nowMs = 0;
    const sentIndices: number[] = [];
    // Sends that NEVER resolve. dispatchOnSchedule must settle right after
    // the last send is fired; if it awaited a send promise anywhere (the
    // bbde8e90 shape ended with `await Promise.allSettled(sendPromises)`)
    // the race below reports "timeout" instead of "settled".
    const send = (i: number): Promise<unknown> =>
      new Promise<unknown>(() => {
        sentIndices.push(i);
      });
    const resultP = dispatchOnSchedule(offsets, {
      nowMs: () => nowMs,
      waitUntilMs: async (target: number) => { while (nowMs < target) nowMs += 1; },
      send,
    });
    const outcome = await Promise.race([
      resultP.then(() => "settled" as const),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 200)),
    ]);
    expect(outcome).toBe("settled");
    const result = await resultP;
    // All 60 indices were sent, in order, and every raw promise is returned
    // for the bench to count AFTER the end mark.
    expect(sentIndices.length).toBe(CADENCE_V2_WHEELS);
    expect(sentIndices).toEqual(Array.from({ length: CADENCE_V2_WHEELS }, (_, i) => i));
    expect(result.sendPromises.length).toBe(CADENCE_V2_WHEELS);
  });

  it("26b. countDispatched counts fulfilments only: [resolved, rejected, resolved] === 2", async () => {
    const rejected: Promise<unknown> = Promise.reject(new Error("cdp send failed"));
    // Handled here so this test does not itself emit an unhandled rejection;
    // countDispatched still sees it as rejected.
    rejected.catch(() => undefined);
    const sends: Promise<unknown>[] = [Promise.resolve("a"), rejected, Promise.resolve("b")];
    expect(await countDispatched(sends)).toBe(2);
    expect(await countDispatched([])).toBe(0);
    expect(await countDispatched([Promise.resolve()])).toBe(1);
  });

  it("26c. rejecting sends neither hang dispatchOnSchedule nor surface as an unhandled rejection", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const offsets = [0, 5, 10];
      let nowMs = 0;
      const result = await dispatchOnSchedule(offsets, {
        nowMs: () => nowMs,
        waitUntilMs: async () => { nowMs += 1; },
        send: () => Promise.reject(new Error("cdp send failed")),
      });
      expect(result.sendPromises.length).toBe(3);
      // A full macrotask turn: Node only reports a rejection that nothing
      // handled by the end of the turn in which it was created. The no-op
      // `.catch()` dispatchOnSchedule attaches is what keeps this empty.
      await new Promise((r) => setTimeout(r, 50));
      expect(seen).toEqual([]);
      expect(await countDispatched(result.sendPromises)).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("27. devMaxMs equals injected max lateness (no floor)", async () => {
    const offsets = [0, 10, 20];
    let nowMs = 0;
    const result = await dispatchOnSchedule(offsets, {
      nowMs: () => nowMs,
      // Inject lateness: the wait advances the fake clock 1 ms per call, so
      // the observed `actual` is target + 1 on the first iteration only.
      waitUntilMs: async () => { nowMs += 1; },
      send: () => Promise.resolve(),
    });
    // After each waitUntilMs, nowMs = i + 1 ms past the loop's `t0`
    // (no reset), so the lateness is monotonically increasing from the
    // first call's `nowMs()` read (t0 = 0; first call returns 1; target
    // = 0 + 0 = 0 -> dev = 1). After loop body returns to next iteration
    // nowMs is now 2, target = 10, dev = -8 (overtake). So the maximum
    // observed dev is the very first iteration's 1 ms.
    expect(result.devMaxMs).toBe(1);
    expect(result.sendPromises.length).toBe(3);
    expect(await countDispatched(result.sendPromises)).toBe(3);
  });

  it("27b. devMaxMs is measured against the TARGET, not the previous send", async () => {
    const offsets = [0, 100];
    let nowMs = 0;
    const result = await dispatchOnSchedule(offsets, {
      nowMs: () => nowMs,
      // Each wait lands exactly 3 ms after its OWN target.
      waitUntilMs: async (t: number) => { nowMs = t + 3; },
      send: () => Promise.resolve(),
    });
    // i=0: target 0 -> actual 3 -> dev 3;  i=1: target 100 -> actual 103 -> dev 3.
    // A `dev = actual - previousActual` mutant gives i=1 dev = 103 - 3 = 100.
    expect(result.devMaxMs).toBe(3);
  });
});

describe("parsePresentedFrameSpans + answeredByPriorFrame (Q03c)", () => {
  it("28. parsePresentedFrameSpans presentMs set EQUALS parsePresentedFrames presentedMs on existing fixtures", () => {
    const parsedS = parsePresentedFrames(SAMPLE_EVENTS);
    const parsedIS = parsePresentedFrames(INPUT_SAMPLE_EVENTS);
    const spansS = parsePresentedFrameSpans(SAMPLE_EVENTS);
    const spansIS = parsePresentedFrameSpans(INPUT_SAMPLE_EVENTS);
    const setFromSpans = (arr: { beginMs: number; presentMs: number }[]) =>
      Array.from(new Set(arr.map((s) => s.presentMs))).sort((a, b) => a - b);
    expect(setFromSpans(spansS)).toEqual(parsedS.presentedMs);
    expect(setFromSpans(spansIS)).toEqual(parsedIS.presentedMs);
    // Lengths must match too (one entry per distinct presentMs).
    expect(new Set(spansS.map((s) => s.presentMs)).size).toBe(parsedS.presentedMs.length);
  });

  it("29. answeredByPriorFrame counts a begin-before-mark answer, not a begin-after-mark answer", () => {
    // Hand-crafted spans sorted by presentMs:
    // span A: beginMs=0, presentMs=10
    // span B: beginMs=15, presentMs=20
    // span C: beginMs=25, presentMs=30
    // markMs = 12 (between A.end and B.begin). Answering frame is B (first
    // presentMs >= 12), beginMs 15 > 12 -> answered_by_prior_frame = 0.
    // markMs = 16 (also before B.presentMs). Answering is still B; beginMs
    // 15 < 16 -> count = 1.
    const spans = [
      { beginMs: 0, presentMs: 10 },
      { beginMs: 15, presentMs: 20 },
      { beginMs: 25, presentMs: 30 },
    ];
    const marks = [12, 16];
    const startMarkMs = 0;
    const endMarkMs = 30;
    expect(answeredByPriorFrame(spans, marks, startMarkMs, endMarkMs)).toBe(1);
  });

  it("29b. answeredByPriorFrame uses a STRICT begin < mark (begin === mark does not count)", () => {
    // D-e: "answering frame's earliest PipelineReporter begin < mark".
    // A begin exactly at the mark must NOT count; a begin just before it must.
    expect(answeredByPriorFrame([{ beginMs: 20, presentMs: 30 }], [20], 0, 40)).toBe(0);
    expect(answeredByPriorFrame([{ beginMs: 19.999, presentMs: 30 }], [20], 0, 40)).toBe(1);
  });

  it("30. inputLatenciesMs agrees with inputLatencyStats (same latencies, same unpresented)", () => {
    const parsed = parsePresentedFrames(INPUT_SAMPLE_EVENTS);
    const rawMarks = userTimingAllMs(INPUT_SAMPLE_EVENTS, "cadence:pan:input", FIXTURE_PID_FOR_MARKS);
    const startMs = userTimingMs(INPUT_SAMPLE_EVENTS, "cadence:pan:start");
    const endMs = userTimingMs(INPUT_SAMPLE_EVENTS, "cadence:pan:end");
    if (startMs == null || endMs == null) throw new Error("unreachable");
    const rows = inputLatenciesMs(parsed, rawMarks, startMs, endMs);
    const lat = inputLatencyStats(parsed, rawMarks, startMs, endMs);
    // Each row.latencyMs must equal the per-input latency the stats would
    // compute. The two views must agree on input_marks and unpresented.
    expect(rows.length).toBe(lat.input_marks);
    const nullCount = rows.reduce((n, r) => (r.latencyMs == null ? n + 1 : n), 0);
    expect(nullCount).toBe(lat.input_unpresented);
  });

  it("31. leadinPresentations: window start INCLUSIVE, first input EXCLUSIVE; missing first input -> 0", () => {
    const presentedMs = [100, 150, 199, 200, 250, 300];
    // startMs = 250, firstInputMarkMs = 300, windowMs 200 -> [50, 300)
    // inclusive start 50, exclusive end 300 -> presentedMs in [50, 300) =
    // {100, 150, 199, 200, 250} = 5.
    expect(leadinPresentations(presentedMs, 250, 300, 200)).toBe(5);
    // Boundary: presentedMs exactly at startMs - window -> included.
    expect(leadinPresentations([50, 51], 250, 300, 200)).toBe(2);
    // Boundary: presentedMs exactly at firstInputMarkMs -> excluded.
    expect(leadinPresentations([300], 250, 300, 200)).toBe(0);
    // No first input -> 0.
    expect(leadinPresentations(presentedMs, 250, null)).toBe(0);
  });
});

describe("buildCadenceReceipt / validateCadenceReceipt — Q03c v2 receipt keys + INVALID rules", () => {
  function greenStatsV1(overrides: Partial<CadenceGestureStats> = {}): CadenceGestureStats {
    return {
      inputs: 200, input_hz: 20, presented: 200, partial: 0, dropped: 0,
      p50_ms: 8, p95_ms: 18, p99_ms: 28,
      input_marks: 200, input_unpresented: 0,
      input_to_present_p50_ms: 8, input_to_present_p95_ms: 18, input_to_present_p99_ms: 28,
      ...overrides,
    };
  }
  function greenStatsV2Zoom(overrides: Partial<CadenceZoomV2Stats> = {}): CadenceZoomV2Stats {
    // The v2 spec pins the dispatch to 60 wheels and the receipt's
    // input_marks MUST equal dispatch.scheduled (this is INVALID-rule 1).
    // We seed the v2 zoom with the matching numbers.
    return {
      ...greenStatsV1({ inputs: 60, input_hz: 50, presented: 60, input_marks: 60 }),
      dispatch: {
        gap_min_ms: 17, gap_jitter_ms: 6,
        seed: 1371552512,
        scheduled: 60, dispatched: 60,
        dispatch_dev_max_ms: 0.5,
      } as CadenceDispatch,
      awake_start: {
        heartbeat_ms: 200.5,
        heartbeat_mode: "until-first-input",
        leadin_presentations: 0,
      } as CadenceAwakeStart,
      answered_by_prior_frame: 0,
      ...overrides,
    };
  }
  function greenV2Receipt(overrides: Partial<{ zoom: CadenceZoomV2Stats }> = {}) {
    return buildCadenceReceipt({
      commit: "a".repeat(40),
      impl: "mm",
      host: { os: "test-os", cpu: "test-cpu", dpr: 2 },
      display: { vsync_ms: 16.7, hz: 60 },
      generated_at: "2026-01-01T00:00:00.000Z",
      pan: greenStatsV1(),
      zoom: overrides.zoom ?? greenStatsV2Zoom(),
      protocol: "q03b-v2" as CadenceProtocol,
    });
  }

  it("32. v1 default builder emits protocol 'q03b-v1' (top-level 10 keys) and validates", () => {
    const r = buildCadenceReceipt({
      commit: "a".repeat(40),
      impl: "mm",
      host: { os: "x", cpu: "y", dpr: 2 },
      display: { vsync_ms: 16.7, hz: 60 },
      generated_at: "2026-01-01T00:00:00.000Z",
      pan: greenStatsV1(),
      zoom: greenStatsV1(),
    });
    expect(r.protocol).toBe("q03b-v1");
    expect(Object.keys(r).length).toBe(10);
    expect(validateCadenceReceipt(r).ok).toBe(true);
  });

  it("33. v1 receipt carrying ANY v2 zoom key is rejected as unexpected", () => {
    const r = greenV2Receipt();
    // Demote to v1 but keep the v2 keys; validator must reject.
    const v1: Record<string, unknown> = { ...r, protocol: "q03b-v1" };
    const v = validateCadenceReceipt(v1);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const hasDispatchError = v.errors.some((e) => /dispatch|did not match|unexpected/.test(e));
      expect(hasDispatchError).toBe(true);
    }
  });

  it("34. v2 valid fixture: validate is OK, zoom has exactly 16 keys (13 + dispatch, awake_start, answered_by_prior_frame)", () => {
    const r = greenV2Receipt();
    expect(r.protocol).toBe("q03b-v2");
    expect(validateCadenceReceipt(r).ok).toBe(true);
    expect(Object.keys(r.gesture.zoom).length).toBe(16);
  });

  it("35. v2 dispatch shape: each of its 6 keys has the pinned value (gap_min_ms=17, gap_jitter_ms=6, seed uint32, scheduled=60, dispatched=60, dispatch_dev_max_ms finite>=0)", () => {
    function withDispatch(overrides: Partial<CadenceDispatch>): CadenceZoomV2Stats {
      return {
        ...greenStatsV2Zoom(),
        dispatch: { ...greenStatsV2Zoom().dispatch, ...overrides } as CadenceDispatch,
      };
    }
    const cases: Array<{ overrides: Partial<CadenceDispatch>; wantError: RegExp }> = [
      { overrides: { gap_min_ms: 16 as never }, wantError: /gap_min_ms/ },
      { overrides: { gap_jitter_ms: 7 as never }, wantError: /gap_jitter_ms/ },
      { overrides: { seed: 0.5 as never }, wantError: /seed/ },
      { overrides: { scheduled: 61 as never }, wantError: /scheduled/ },
      { overrides: { dispatched: 59 as never }, wantError: /dispatched/ },
      { overrides: { dispatch_dev_max_ms: Number.NaN as never }, wantError: /dispatch_dev_max_ms/ },
    ];
    for (const c of cases) {
      const r = greenV2Receipt({ zoom: withDispatch(c.overrides) });
      const v = validateCadenceReceipt(r);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => c.wantError.test(e))).toBe(true);
    }
  });

  it("36. v2 awake_start shape: heartbeat_ms finite>=200, heartbeat_mode in {through, until-first-input}, leadin_presentations int>=0", () => {
    const r = greenV2Receipt();
    // heartbeat_ms below min -> error.
    (r.gesture.zoom as CadenceZoomV2Stats).awake_start.heartbeat_ms = CADENCE_V2_HEARTBEAT_MIN_MS - 0.1;
    const v = validateCadenceReceipt(r);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => /heartbeat_ms/.test(e))).toBe(true);
    // heartbeat_mode unknown -> error.
    const r2 = greenV2Receipt();
    (r2.gesture.zoom as CadenceZoomV2Stats).awake_start.heartbeat_mode = "never" as never;
    const v2 = validateCadenceReceipt(r2);
    expect(v2.ok).toBe(false);
    if (!v2.ok) expect(v2.errors.some((e) => /heartbeat_mode/.test(e))).toBe(true);
    // leadin_presentations negative -> error.
    const r3 = greenV2Receipt();
    (r3.gesture.zoom as CadenceZoomV2Stats).awake_start.leadin_presentations = -1;
    const v3 = validateCadenceReceipt(r3);
    expect(v3.ok).toBe(false);
    if (!v3.ok) expect(v3.errors.some((e) => /leadin_presentations/.test(e))).toBe(true);
  });

  it("37. INVALID (q03b-v2) rule 1: gesture.zoom.input_marks !== dispatch.scheduled", () => {
    const r = greenV2Receipt();
    const gs = r.gesture.zoom as CadenceZoomV2Stats;
    gs.input_marks = 59; // not 60
    const v = validateCadenceReceipt(r);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const hit = v.errors.find((e) => e.startsWith("INVALID (q03b-v2):"));
      expect(hit).toBeDefined();
      expect(hit).toMatch(/input_marks|scheduled/);
    }
  });

  it("38. INVALID (q03b-v2) rule 2: gesture.zoom.input_unpresented !== 0", () => {
    const r = greenV2Receipt();
    const gs = r.gesture.zoom as CadenceZoomV2Stats;
    gs.input_unpresented = 1;
    const v = validateCadenceReceipt(r);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const hit = v.errors.find((e) => e.startsWith("INVALID (q03b-v2):"));
      expect(hit).toBeDefined();
      expect(hit).toMatch(/input_unpresented/);
    }
  });

  it("39. INVALID (q03b-v2) rule 3: dispatch.dispatch_dev_max_ms > 2", () => {
    const r = greenV2Receipt();
    const gs = r.gesture.zoom as CadenceZoomV2Stats;
    gs.dispatch.dispatch_dev_max_ms = CADENCE_V2_DISPATCH_DEV_MAX_MS + 0.001;
    const v = validateCadenceReceipt(r);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const hit = v.errors.find((e) => e.startsWith("INVALID (q03b-v2):"));
      expect(hit).toBeDefined();
      expect(hit).toMatch(/dispatch_dev_max_ms/);
    }
  });

  it("40. INVALID (q03b-v2) rule 4: heartbeat_mode='through' AND leadin_presentations>0", () => {
    const r = greenV2Receipt();
    const gs = r.gesture.zoom as CadenceZoomV2Stats;
    gs.awake_start.heartbeat_mode = "through";
    gs.awake_start.leadin_presentations = 1;
    const v = validateCadenceReceipt(r);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const hit = v.errors.find((e) => e.startsWith("INVALID (q03b-v2):"));
      expect(hit).toBeDefined();
      expect(hit).toMatch(/leadin_presentations|heartbeat_mode/);
    }
  });

  it("41. heartbeat_mode='through' with leadin_presentations=0 is NOT INVALID (accepted path)", () => {
    const r = greenV2Receipt();
    const gs = r.gesture.zoom as CadenceZoomV2Stats;
    gs.awake_start.heartbeat_mode = "through";
    gs.awake_start.leadin_presentations = 0;
    const v = validateCadenceReceipt(r);
    expect(v.ok).toBe(true);
  });

  it("42. heartbeat_mode='until-first-input' with leadin_presentations>=1 is NOT INVALID (accepted path)", () => {
    const r = greenV2Receipt();
    const gs = r.gesture.zoom as CadenceZoomV2Stats;
    gs.awake_start.heartbeat_mode = "until-first-input";
    gs.awake_start.leadin_presentations = 3;
    const v = validateCadenceReceipt(r);
    expect(v.ok).toBe(true);
  });

  it("43. answered_by_prior_frame out of range [0, input_marks] is rejected", () => {
    const r = greenV2Receipt();
    (r.gesture.zoom as CadenceZoomV2Stats).answered_by_prior_frame = 201;
    const v = validateCadenceReceipt(r);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => /answered_by_prior_frame/.test(e))).toBe(true);
  });

  it("44. the dispatch_dev_max_ms bound is inclusive: 2.0 validates, 2.001 is INVALID", () => {
    // Boundary pin, not a falsifier: < 2.0 is OK, = 2.0 is still OK,
    // > 2.0 is INVALID. Mutate `dispatch_dev_max_ms` to 2.0 (= bound) and
    // confirm validation still passes; mutate to 2.001 and confirm it
    // fails. Both branches are part of the GREEN contract.
    const okBase = greenV2Receipt();
    (okBase.gesture.zoom as CadenceZoomV2Stats).dispatch.dispatch_dev_max_ms = 2.0;
    expect(validateCadenceReceipt(okBase).ok).toBe(true);
    const redBase = greenV2Receipt();
    (redBase.gesture.zoom as CadenceZoomV2Stats).dispatch.dispatch_dev_max_ms = 2.001;
    const v = validateCadenceReceipt(redBase);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => /INVALID \(q03b-v2\):.*dispatch_dev_max_ms/.test(e))).toBe(true);
  });

  it("44b. a v2 receipt rejects an unexpected gesture.pan key (pan is always 13 keys)", () => {
    const r = greenV2Receipt();
    (r.gesture.pan as Record<string, unknown>).__extra_pan_key = 1;
    const v = validateCadenceReceipt(r);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => /unexpected gesture\.pan key/.test(e))).toBe(true);
  });

  it("45. cadenceInvalidLine prints exactly the pinned field keys in order and carries no latency number", () => {
    // A refused run is "repeated, never counted and never read", so its one
    // allowed log line must not leak a single latency / percentile / cadence
    // / answered value. The fixture stats carry distinctive ones.
    const zoom = greenStatsV2Zoom({
      input_marks: 59,
      input_to_present_p50_ms: 1.234,
      input_to_present_p95_ms: 12.345,
      input_to_present_p99_ms: 67.891,
      p95_ms: 67.891,
      p99_ms: 67.891,
    });
    const receipt = greenV2Receipt({ zoom });
    const v = validateCadenceReceipt(receipt);
    expect(v.ok).toBe(false);
    const errors = v.ok ? [] : v.errors.filter((e) => e.startsWith("INVALID (q03b-v2):"));
    expect(errors.length).toBeGreaterThan(0);
    const diag: CadenceEndMarkDiag = { zoom_marks_after_end: 0, zoom_end_minus_last_mark_ms: 3.5 };
    const line = cadenceInvalidLine("mm", 2, 3, receipt, diag, errors);
    expect(line.startsWith("CADENCE_INVALID mm ")).toBe(true);
    expect(line).toContain("run=2 attempt=3");
    // Exactly the pinned keys, in the pinned order.
    let prev = -1;
    for (const key of CADENCE_INVALID_FIELDS) {
      const idx = line.indexOf(`${key}=`);
      expect(idx, `field "${key}" missing or out of order in: ${line}`).toBeGreaterThan(prev);
      prev = idx;
    }
    expect(line).toContain("zoom_end_minus_last_mark_ms=3.5");
    // No latency, percentile, cadence or answered value of any kind.
    expect(line).not.toContain("12.345");
    expect(line).not.toContain("67.891");
    expect(line).not.toContain("1.234");
    expect(line).not.toContain("p95");
    expect(line).not.toContain("p99");
    expect(line).not.toContain("lat");
    expect(line).not.toContain("answered");
    expect(line).not.toContain("vsync");
    expect(line).not.toContain("CADENCE_DIAG");
  });
});


// ============================================================================
// q03b-v3 protocol: forward-anchored zoom latency. Pins for the Browser
// ForwardWheelEvent parser, the mark/forward pairing, the forward-anchored
// latency rows, the v3 receipt keys and the v3 INVALID rules.
// ============================================================================

import {
  wheelForwardsMs,
  pairWheelForwards,
  cadenceForwardBlock,
  forwardLatenciesMs,
  forwardLatencyStats,
  forwardAnsweredByPriorFrame,
  CADENCE_V3_FORWARD_EVENT,
  CADENCE_V3_STAMP_TO_FORWARD_MAX_MS,
  type CadenceZoomV3Stats,
  type CadenceForward,
} from "../chart-engine/bench/cadence";

function v3Parsed(presentedMs: number[]): ParsedPresentation {
  return {
    frames: presentedMs.map((ms) => ({ ms, state: "presented" as const })),
    presentedMs,
    presented: new Set(presentedMs).size,
    partial: 0,
    dropped: 0,
    rendererPid: 2,
  };
}

describe("wheelForwardsMs (q03b-v3)", () => {
  // Real-shape mini fixture: the metadata and ForwardWheelEvent shapes are
  // copied from a headed m2studio zoom trace (Browser pid 24775, Renderer
  // pid 24869); each non-zero wheel forward is followed by its zero-delta twin.
  const browser = { args: { name: "Browser" }, cat: "__metadata", name: "process_name", ph: "M", pid: 24775, tid: 0, ts: 0 };
  const renderer = { args: { name: "Renderer" }, cat: "__metadata", name: "process_name", ph: "M", pid: 24869, tid: 0, ts: 0 };
  const gpu = { args: { name: "GPU Process" }, cat: "__metadata", name: "process_name", ph: "M", pid: 24800, tid: 0, ts: 0 };
  const fwd = (pid: number, ts: number, dx: number, dy: number, ph = "X", name = CADENCE_V3_FORWARD_EVENT) =>
    ({ args: { dx, dy }, cat: "input", dur: 85, name, ph, pid, tdur: 74, tid: 88382549, ts, tts: 1553266 });
  const events = [
    browser, renderer, gpu,
    fwd(24775, 458169188841, 0, 120),
    fwd(24775, 458169188900, 0, 0), // zero-delta twin: dropped
    fwd(24869, 458169189000, 0, 120), // renderer pid: dropped
    fwd(24800, 458169189100, 0, 120), // GPU pid: dropped
    fwd(24775, 458169189200, 0, 120, "X", "RenderWidgetHostImpl::ForwardMouseEvent"), // wrong name: dropped
    fwd(24775, 458169189300, 0, 120, "E"), // end phase: dropped
    fwd(24775, 458169170000, -3, 0, "B"), // B phase with a dx-only delta: kept
    fwd(24775, 458169150000, 0, -120), // negative delta: kept
    { cat: "input", name: CADENCE_V3_FORWARD_EVENT, ph: "X", pid: 24775, ts: 458169160000 }, // no args: dropped
    { args: { data: { startTime: 5538.5 } }, cat: "blink.user_timing", name: "cadence:zoom:input", ph: "I", pid: 24869, s: "t", tid: 1, ts: 458169178466 },
  ];

  it("46. keeps only Browser-pid X/B forwards with a non-zero delta, as ts/1000 ms, sorted", () => {
    expect(wheelForwardsMs(events)).toEqual([458169150000 / 1000, 458169170000 / 1000, 458169188841 / 1000]);
  });

  it("47. with no Browser process_name metadata the result is [] (fail closed)", () => {
    expect(wheelForwardsMs(events.filter((e) => e !== browser))).toEqual([]);
    expect(wheelForwardsMs([renderer, gpu, fwd(24775, 1000, 0, 120)])).toEqual([]);
  });
});

describe("pairWheelForwards / cadenceForwardBlock (q03b-v3)", () => {
  it("48. marks are de-duplicated and windowed to [start, end]; forwards to [start, end + tail]; extra forwards are counted", () => {
    // start 5, end 100 -> forward window [5, 200].
    const p = pairWheelForwards([5, 5, 25, 45, 200], [3, 9, 30, 52, 140, 250], 5, 100);
    expect(p.marksMs).toEqual([5, 25, 45]);
    expect(p.forwardsMs).toEqual([9, 30, 52, 140]);
    expect(p.stampToForwardMs).toEqual([4, 5, 7]);
    expect(p.paired).toBe(3);
    const block = cadenceForwardBlock(p);
    expect(block).toEqual({
      forwards: 4,
      paired: 3,
      stamp_to_forward_min_ms: 4,
      stamp_to_forward_p50_ms: 5,
      stamp_to_forward_max_ms: 7,
    } satisfies CadenceForward);
  });

  it("49. the stamp-to-forward cap is inclusive at 30 ms and refuses 30+", () => {
    expect(CADENCE_V3_STAMP_TO_FORWARD_MAX_MS).toBe(30);
    const p = pairWheelForwards([0, 50], [30, 80.5], 0, 60);
    expect(p.stampToForwardMs).toEqual([30, 30.5]);
    expect(p.paired).toBe(1);
  });

  it("50. a forward after the next mark still pairs by index, and a negative delay is not paired", () => {
    // The 367f488e5c67 mm diag trace shape: wheel 0 is received 6.30 ms
    // before wheel 1 and forwarded 10.38 ms after its own stamp, so forward 0
    // lands after mark 1. Rounded here to whole ms.
    const compressed = pairWheelForwards([0, 6, 24], [10, 11, 29], 0, 30);
    expect(compressed.stampToForwardMs).toEqual([10, 5, 5]);
    expect(compressed.paired).toBe(3);
    expect(pairWheelForwards([0, 20], [21, 25], 0, 30).paired).toBe(2);
    expect(pairWheelForwards([0, 20], [20, 22], 0, 30).paired).toBe(2);
    const neg = pairWheelForwards([10, 40], [5, 45], 0, 50);
    expect(neg.stampToForwardMs).toEqual([-5, 5]);
    expect(neg.paired).toBe(1);
  });

  it("51. a dropped forward shifts the index pairing inside the cap, so only the forward count exposes it", () => {
    // Wheel 1's forward is missing: forward 43 lands on mark 20 (d = 23,
    // inside the cap). The pair count cannot see the shift; the forward
    // count (2, not 3) is what the validator's count rule refuses.
    const p = pairWheelForwards([0, 20, 40], [3, 43], 0, 50);
    expect(p.stampToForwardMs).toEqual([3, 23]);
    expect(p.paired).toBe(2);
    expect(cadenceForwardBlock(p).forwards).toBe(2);
    expect(p.marksMs).toHaveLength(3);
  });

  it("52. an empty pairing gives UNMEASURED min/p50/max", () => {
    expect(cadenceForwardBlock(pairWheelForwards([], [], 0, 10))).toEqual({
      forwards: 0,
      paired: 0,
      stamp_to_forward_min_ms: UNMEASURED,
      stamp_to_forward_p50_ms: UNMEASURED,
      stamp_to_forward_max_ms: UNMEASURED,
    });
  });
});

describe("forwardLatenciesMs / forwardLatencyStats / forwardAnsweredByPriorFrame (q03b-v3)", () => {
  // marks [5, 12, 33], forwards [7, 20, 36], start 5, end 35 (tail 135).
  // The presentation at 6 lands between mark 5 and its forward 7, so it can
  // only answer a mark-anchored row.
  // Forward-anchored: 7 -> 10 = 3, 20 -> 20 = 0 (equality counts), 36 -> 40 = 4.
  // Mark-anchored (v2) over the same presentations: 1, 8, 7.
  const parsed = v3Parsed([6, 10, 20, 30, 40, 300]);
  const pairing = pairWheelForwards([5, 12, 33], [7, 20, 36], 5, 35);

  it("53. latency is measured from the paired forward; equality counts; percentiles are nearest-rank", () => {
    const rows = forwardLatenciesMs(parsed, pairing, 35);
    expect(rows).toEqual([
      { markMs: 5, forwardMs: 7, latencyMs: 3, answerMs: 10 },
      { markMs: 12, forwardMs: 20, latencyMs: 0, answerMs: 20 },
      { markMs: 33, forwardMs: 36, latencyMs: 4, answerMs: 40 },
    ]);
    expect(forwardLatencyStats(rows)).toEqual({
      input_marks: 3,
      input_unpresented: 0,
      input_to_present_p50_ms: 3,
      input_to_present_p95_ms: 4,
      input_to_present_p99_ms: 4,
    });
    // Discriminates from the v2 mark anchor over the same data.
    const v2 = inputLatencyStats(parsed, [5, 12, 33], 5, 35);
    expect(v2.input_to_present_p50_ms).toBe(7);
    expect(v2.input_to_present_p95_ms).toBe(8);
  });

  it("54. a mark without a forward is unpresented even when a presentation follows it", () => {
    const p = pairWheelForwards([0, 20, 40], [3, 23], 0, 45);
    const rows = forwardLatenciesMs(v3Parsed([10, 30, 50]), p, 45);
    expect(rows[2]).toEqual({ markMs: 40, forwardMs: null, latencyMs: null, answerMs: null });
    const stats = forwardLatencyStats(rows);
    expect(stats.input_marks).toBe(3);
    expect(stats.input_unpresented).toBe(1);
    expect(stats.input_to_present_p95_ms).toBe(7);
  });

  it("55. a presentation after end + tail does not answer; empty input throws", () => {
    const rows = forwardLatenciesMs(v3Parsed([200]), pairWheelForwards([5], [8], 0, 10), 10);
    expect(rows[0]?.latencyMs).toBeNull();
    const stats = forwardLatencyStats(rows);
    expect(stats.input_unpresented).toBe(1);
    expect(stats.input_to_present_p95_ms).toBe(UNMEASURED);
    expect(() => forwardLatenciesMs(parsed, pairWheelForwards([], [], 0, 10), 10)).toThrow(/no input marks/);
    expect(() => forwardLatencyStats([])).toThrow(/no input marks/);
  });

  it("56. answered_by_prior_frame is forward-anchored and strict: a frame begun between mark and forward counts", () => {
    const rows = forwardLatenciesMs(parsed, pairing, 35);
    const spans = [
      { beginMs: 6, presentMs: 10 },
      { beginMs: 15, presentMs: 20 },
      { beginMs: 34, presentMs: 40 },
    ];
    expect(forwardAnsweredByPriorFrame(spans, rows)).toBe(3);
    // The v2 mark-anchored count over the same spans is 0.
    expect(answeredByPriorFrame(spans, [5, 12, 33], 5, 35)).toBe(0);
    // begin === forward is not "prior" (strict <).
    const equal = [
      { beginMs: 7, presentMs: 10 },
      { beginMs: 20, presentMs: 20 },
      { beginMs: 36, presentMs: 40 },
    ];
    expect(forwardAnsweredByPriorFrame(equal, rows)).toBe(0);
    // Unanswered rows never count.
    expect(forwardAnsweredByPriorFrame(spans, [{ markMs: 5, forwardMs: 7, latencyMs: null, answerMs: null }])).toBe(0);
  });
});

describe("buildCadenceReceipt / validateCadenceReceipt — q03b-v3 receipt keys + INVALID rules", () => {
  function v3Pan(): CadenceGestureStats {
    return {
      inputs: 200, input_hz: 20, presented: 200, partial: 0, dropped: 0,
      p50_ms: 8, p95_ms: 18, p99_ms: 28,
      input_marks: 200, input_unpresented: 0,
      input_to_present_p50_ms: 8, input_to_present_p95_ms: 18, input_to_present_p99_ms: 28,
    };
  }
  function greenStatsV3Zoom(forward: Partial<CadenceForward> = {}, overrides: Partial<CadenceZoomV3Stats> = {}): CadenceZoomV3Stats {
    return {
      ...v3Pan(),
      inputs: 60, input_hz: 50, presented: 60, input_marks: 60,
      dispatch: { gap_min_ms: 17, gap_jitter_ms: 6, seed: 1371552512, scheduled: 60, dispatched: 60, dispatch_dev_max_ms: 0.5 },
      awake_start: { heartbeat_ms: 200.5, heartbeat_mode: "through", leadin_presentations: 0 },
      answered_by_prior_frame: 0,
      forward: {
        forwards: 60, paired: 60,
        stamp_to_forward_min_ms: 3, stamp_to_forward_p50_ms: 5.3, stamp_to_forward_max_ms: 10.4,
        ...forward,
      },
      ...overrides,
    };
  }
  function greenV3Receipt(zoom: CadenceZoomV3Stats | CadenceZoomV2Stats = greenStatsV3Zoom(), protocol: CadenceProtocol = "q03b-v3") {
    return buildCadenceReceipt({
      commit: "a".repeat(40),
      impl: "mm",
      host: { os: "test-os", cpu: "test-cpu", dpr: 2 },
      display: { vsync_ms: 10, hz: 100 },
      generated_at: "2026-01-01T00:00:00.000Z",
      pan: v3Pan(),
      zoom,
      protocol,
    });
  }
  function withoutForward(z: CadenceZoomV3Stats): CadenceZoomV2Stats {
    const copy: Partial<CadenceZoomV3Stats> = { ...z };
    delete copy.forward;
    return copy as CadenceZoomV2Stats;
  }
  function errorsOf(r: unknown): string[] {
    const v = validateCadenceReceipt(r);
    return v.ok ? [] : v.errors;
  }

  it("57. v3 valid fixture: validates; protocol q03b-v3; zoom has 17 keys and forward exactly its 5 keys", () => {
    const r = greenV3Receipt();
    expect(r.protocol).toBe("q03b-v3");
    expect(Object.keys(r).length).toBe(10);
    expect(validateCadenceReceipt(r)).toEqual({ ok: true });
    expect(Object.keys(r.gesture.zoom).length).toBe(17);
    expect(Object.keys((r.gesture.zoom as CadenceZoomV3Stats).forward)).toEqual([
      "forwards", "paired", "stamp_to_forward_min_ms", "stamp_to_forward_p50_ms", "stamp_to_forward_max_ms",
    ]);
  });

  it("58. a v2 receipt carrying forward is refused; a v3 receipt without forward is refused", () => {
    expect(errorsOf(greenV3Receipt(greenStatsV3Zoom(), "q03b-v2"))).toContain('unexpected gesture.zoom key "forward"');
    const v2Zoom = withoutForward(greenStatsV3Zoom());
    const missing = errorsOf(greenV3Receipt(v2Zoom));
    expect(missing).toContain('missing gesture.zoom key "forward"');
    expect(missing).toContain("gesture.zoom.forward must be an object");
    // The same v2-shape zoom under q03b-v2 is valid.
    expect(validateCadenceReceipt(greenV3Receipt(v2Zoom, "q03b-v2"))).toEqual({ ok: true });
  });

  it("59. an unknown protocol names all four accepted values", () => {
    const r: Record<string, unknown> = { ...greenV3Receipt(), protocol: "q03b-v5" };
    expect(errorsOf(r)).toContain('protocol must be "q03b-v1", "q03b-v2", "q03b-v3" or "q03b-v4" (got "q03b-v5")');
  });

  it("60. each v3 forward rule fires alone with the INVALID (q03b-v3) prefix; 0 and 30 are the inclusive bounds", () => {
    const cases: Array<{ forward: Partial<CadenceForward>; want: string }> = [
      { forward: { forwards: 59 }, want: "INVALID (q03b-v3): gesture.zoom.forward.forwards (59) must equal dispatch.scheduled (60)" },
      { forward: { forwards: 61 }, want: "INVALID (q03b-v3): gesture.zoom.forward.forwards (61) must equal dispatch.scheduled (60)" },
      { forward: { paired: 59 }, want: "INVALID (q03b-v3): gesture.zoom.forward.paired (59) must equal dispatch.scheduled (60)" },
      { forward: { stamp_to_forward_min_ms: -0.1 }, want: "INVALID (q03b-v3): gesture.zoom.forward.stamp_to_forward_min_ms (-0.1) must be >= 0" },
      { forward: { stamp_to_forward_max_ms: 30.1 }, want: "INVALID (q03b-v3): gesture.zoom.forward.stamp_to_forward_max_ms (30.1) must be <= 30" },
    ];
    for (const c of cases) {
      expect(errorsOf(greenV3Receipt(greenStatsV3Zoom(c.forward)))).toEqual([c.want]);
    }
    expect(validateCadenceReceipt(greenV3Receipt(greenStatsV3Zoom({ stamp_to_forward_min_ms: 0, stamp_to_forward_max_ms: 30 })))).toEqual({ ok: true });
    // The empty-pairing block (UNMEASURED delays, zero counts) is INVALID, never valid.
    const empty = errorsOf(greenV3Receipt(greenStatsV3Zoom(cadenceForwardBlock(pairWheelForwards([], [], 0, 10)))));
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every((e) => e.startsWith("INVALID (q03b-v3): gesture.zoom.forward."))).toBe(true);
    expect(empty.some((e) => /stamp_to_forward_max_ms/.test(e))).toBe(true);
  });

  it("61. the four v2 INVALID rules carry the q03b-v3 prefix inside a v3 receipt", () => {
    const marks = errorsOf(greenV3Receipt(greenStatsV3Zoom({}, { input_marks: 59 })));
    expect(marks).toContain("INVALID (q03b-v3): gesture.zoom.input_marks (59) must equal dispatch.scheduled (60)");
    const unpresented = errorsOf(greenV3Receipt(greenStatsV3Zoom({}, { input_unpresented: 1 })));
    expect(unpresented).toContain("INVALID (q03b-v3): gesture.zoom.input_unpresented (1) must be 0");
    const dev = errorsOf(greenV3Receipt(greenStatsV3Zoom({}, {
      dispatch: { gap_min_ms: 17, gap_jitter_ms: 6, seed: 1371552512, scheduled: 60, dispatched: 60, dispatch_dev_max_ms: 2.5 },
    })));
    expect(dev).toContain("INVALID (q03b-v3): gesture.zoom.dispatch.dispatch_dev_max_ms (2.5) must be <= 2");
    const leadin = errorsOf(greenV3Receipt(greenStatsV3Zoom({}, {
      awake_start: { heartbeat_ms: 200.5, heartbeat_mode: "through", leadin_presentations: 1 },
    })));
    expect(leadin).toContain('INVALID (q03b-v3): gesture.zoom.awake_start.heartbeat_mode is "through" but leadin_presentations (1) is > 0');
    for (const errs of [marks, unpresented, dev, leadin]) {
      expect(errs.some((e) => e.startsWith("INVALID (q03b-v2):"))).toBe(false);
    }
  });

  it("62. forward shape errors: non-integer count, non-finite delay, unexpected and missing keys", () => {
    const nonInt = errorsOf(greenV3Receipt(greenStatsV3Zoom({ forwards: 59.5 })));
    expect(nonInt).toContain("gesture.zoom.forward.forwards must be a non-negative integer (got 59.5)");
    expect(nonInt.some((e) => e.startsWith("INVALID"))).toBe(false);
    const nan = errorsOf(greenV3Receipt(greenStatsV3Zoom({ stamp_to_forward_p50_ms: Number.NaN })));
    expect(nan).toContain("gesture.zoom.forward.stamp_to_forward_p50_ms must be a finite number (got null)");
    const extra = greenStatsV3Zoom();
    (extra.forward as Record<string, unknown>).latency_ms = 1;
    expect(errorsOf(greenV3Receipt(extra))).toContain('unexpected gesture.zoom.forward key "latency_ms"');
    const missing = greenStatsV3Zoom();
    delete (missing.forward as Partial<CadenceForward>).paired;
    expect(errorsOf(greenV3Receipt(missing))).toContain('missing gesture.zoom.forward key "paired"');
  });

  it("63. cadenceInvalidLine prints the v3 forward and pair counts in order and no delay or latency value", () => {
    const zoom = greenStatsV3Zoom(
      { forwards: 59, paired: 58, stamp_to_forward_min_ms: 3.21, stamp_to_forward_p50_ms: 5.43, stamp_to_forward_max_ms: 10.87 },
      { input_to_present_p50_ms: 1.234, input_to_present_p95_ms: 12.345, input_to_present_p99_ms: 67.891 },
    );
    const receipt = greenV3Receipt(zoom);
    const errors = errorsOf(receipt).filter((e) => e.startsWith("INVALID (q03b-v3):"));
    expect(errors.length).toBe(2);
    const diag: CadenceEndMarkDiag = { zoom_marks_after_end: 0, zoom_end_minus_last_mark_ms: 3.5 };
    const line = cadenceInvalidLine("mm", 1, 2, receipt, diag, errors);
    expect(line).toContain(" input_unpresented=0 forwards=59 paired=58 mapped=null main_tasks=null zoom_marks_after_end=0 ");
    let prev = -1;
    for (const key of CADENCE_INVALID_FIELDS) {
      const idx = line.indexOf(`${key}=`);
      expect(idx, `field "${key}" missing or out of order in: ${line}`).toBeGreaterThan(prev);
      prev = idx;
    }
    for (const leak of ["3.21", "5.43", "10.87", "1.234", "12.345", "67.891", "stamp_to_forward", "lat", "p95", "p99"]) {
      expect(line).not.toContain(leak);
    }
    // A v2 receipt has no forward block and prints null.
    const v2 = greenV3Receipt(withoutForward(greenStatsV3Zoom({}, { input_marks: 59 })), "q03b-v2");
    expect(cadenceInvalidLine("mm", 1, 1, v2, diag, [])).toContain(" forwards=null paired=null ");
  });
});


// ============================================================================
// q03b-v4 protocol: own-frame zoom answer. Pins for the EventLatency parser,
// the mutual-nearest forward mapping, the renderer main-thread task parser
// and busy bias, the own-frame rows (anchor = forward less the busy part of
// the hold, answer = the wheel's own frame's GPU swap end, fallback for a
// terminated slice), the v4 receipt keys and the v4 INVALID rules.
// ============================================================================

import {
  allWheelForwardsMs,
  parseWheelEventLatencies,
  mapForwardsToEventLatencies,
  rendererMainTopLevelTasks,
  mainThreadBusyMs,
  ownFrameLatenciesMs,
  cadenceOwnFrameBlock,
  ownFrameAnsweredByPriorFrame,
  CADENCE_V4_EVENT_LATENCY,
  CADENCE_V4_EVENT_LATENCY_CATEGORY,
  CADENCE_V4_EL_EVENT_TYPE,
  CADENCE_V4_EL_MAP_STAGE,
  CADENCE_V4_EL_COMMIT_STAGE,
  CADENCE_V4_EL_SWAP_END_STAGE,
  CADENCE_V4_EL_MAP_MAX_MS,
  CADENCE_V4_ZOOM_EXTRA_CATEGORIES,
  CADENCE_V4_MAIN_THREAD,
  type WheelEventLatency,
  type OwnFrameLatencyRow,
  type CadenceZoomV4Stats,
  type CadenceOwnFrame,
} from "../chart-engine/bench/cadence";

const V4_BROWSER = 24775;
const V4_RENDERER = 24869;

type V4Id = string | { global: string } | { plain: string };

/** One EventLatency-category event in the real nestable-async shape
 *  (`id2.local`, renderer pid, `ts` in us); times are given in ms. */
function v4ElEvent(
  id: V4Id,
  name: string,
  ph: string,
  ms: number,
  o: { pid?: number; cat?: string; type?: string } = {},
): Record<string, unknown> {
  const ids = typeof id === "string" ? { id2: { local: id } } : "global" in id ? { id2: { global: id.global } } : { id: id.plain };
  return {
    cat: o.cat ?? CADENCE_V4_EVENT_LATENCY_CATEGORY,
    name,
    ph,
    pid: o.pid ?? V4_RENDERER,
    tid: 9,
    ts: Math.round(ms * 1000),
    ...ids,
    ...(name === CADENCE_V4_EVENT_LATENCY && ph === "b" ? { args: { event_latency: { event_type: o.type ?? "MOUSE_WHEEL" } } } : {}),
  };
}

/** One EventLatency slice with the optional map / Commit / swap-end stages
 *  (each a b/e pair) and an optional end (omitted -> left open). */
function v4ElSlice(
  id: V4Id,
  t: { begin: number; map?: number; commit?: number; swapEnd?: number; end?: number },
  o: { pid?: number; cat?: string; type?: string } = {},
): Record<string, unknown>[] {
  const out = [v4ElEvent(id, CADENCE_V4_EVENT_LATENCY, "b", t.begin, o)];
  const stage = (name: string, b: number, e: number) => out.push(v4ElEvent(id, name, "b", b, o), v4ElEvent(id, name, "e", e, o));
  if (t.map != null) stage(CADENCE_V4_EL_MAP_STAGE, t.map, t.map + 0.5);
  if (t.commit != null) stage(CADENCE_V4_EL_COMMIT_STAGE, t.commit, t.commit + 1);
  if (t.swapEnd != null) stage(CADENCE_V4_EL_SWAP_END_STAGE, t.swapEnd, t.swapEnd + 2);
  if (t.end != null) out.push(v4ElEvent(id, CADENCE_V4_EVENT_LATENCY, "e", t.end, o));
  return out;
}

function v4ThreadName(pid: number, tid: number, name: string): Record<string, unknown> {
  return { args: { name }, cat: "__metadata", name: "thread_name", ph: "M", pid, tid, ts: 0 };
}

function v4Task(
  pid: number,
  tid: number,
  startMs: number,
  durMs: number,
  cat = "disabled-by-default-devtools.timeline,toplevel",
): Record<string, unknown> {
  return { args: {}, cat, name: "ThreadControllerImpl::RunTask", ph: "X", pid, tid, ts: Math.round(startMs * 1000), dur: Math.round(durMs * 1000) };
}

function v4Forward(ms: number, dy: number, pid = V4_BROWSER, ph = "X"): Record<string, unknown> {
  return { args: { dx: 0, dy }, cat: "input", dur: 85, name: CADENCE_V3_FORWARD_EVENT, ph, pid, tid: 1, ts: Math.round(ms * 1000) };
}

const V4_PROCESS_NAMES = [
  { args: { name: "Browser" }, cat: "__metadata", name: "process_name", ph: "M", pid: V4_BROWSER, tid: 0, ts: 0 },
  { args: { name: "Renderer" }, cat: "__metadata", name: "process_name", ph: "M", pid: V4_RENDERER, tid: 0, ts: 0 },
];

/** Rows rounded to 1e-6 ms so float noise from `ts / 1000` differences
 *  does not leak into exact row expectations. */
function v4Round(rows: readonly OwnFrameLatencyRow[]): OwnFrameLatencyRow[] {
  const q = (v: number | null) => (v == null ? null : Math.round(v * 1e6) / 1e6);
  return rows.map((r) => ({
    markMs: q(r.markMs) as number,
    forwardMs: q(r.forwardMs),
    mapDistMs: q(r.mapDistMs),
    biasMs: q(r.biasMs),
    anchorMs: q(r.anchorMs),
    commitMs: q(r.commitMs),
    swapEndMs: q(r.swapEndMs),
    fallback: r.fallback,
    latencyMs: q(r.latencyMs),
  }));
}

function v4El(mapMs: number, extra: Partial<WheelEventLatency> = {}): WheelEventLatency {
  return { beginMs: mapMs - 1, endMs: mapMs + 10, mapMs, commitMs: mapMs + 3, swapEndMs: mapMs + 8, ...extra };
}

describe("q03b-v4 constants and allWheelForwardsMs", () => {
  it("64. the v4 trace names, stage names, map bound and extra categories are pinned", () => {
    expect(CADENCE_V4_EVENT_LATENCY).toBe("EventLatency");
    expect(CADENCE_V4_EVENT_LATENCY_CATEGORY).toBe("cc,benchmark,input,input.scrolling");
    expect(CADENCE_V4_EL_EVENT_TYPE).toBe("MOUSE_WHEEL");
    expect(CADENCE_V4_EL_MAP_STAGE).toBe("BrowserMainToRendererCompositor");
    expect(CADENCE_V4_EL_COMMIT_STAGE).toBe("Commit");
    expect(CADENCE_V4_EL_SWAP_END_STAGE).toBe("SwapEndToPresentationCompositorFrame");
    expect(CADENCE_V4_EL_MAP_MAX_MS).toBe(0.1);
    expect(CADENCE_V4_MAIN_THREAD).toBe("CrRendererMain");
    expect([...CADENCE_V4_ZOOM_EXTRA_CATEGORIES]).toEqual(["input", "toplevel"]);
  });

  it("65. allWheelForwardsMs keeps every Browser-pid X/B forward of any delta; wheelForwardsMs keeps the non-zero ones", () => {
    const events = [
      ...V4_PROCESS_NAMES,
      v4Forward(30, 120),
      v4Forward(30.3, 0), // zero-delta twin: kept by allWheelForwardsMs only
      v4Forward(10, -120, V4_BROWSER, "B"),
      v4Forward(10.3, 0, V4_BROWSER, "B"),
      v4Forward(20, 120, V4_RENDERER), // renderer pid: dropped
      v4Forward(25, 120, V4_BROWSER, "E"), // end phase: dropped
      { cat: "input", name: CADENCE_V3_FORWARD_EVENT, ph: "X", pid: V4_BROWSER, ts: 40000 }, // no args: any-delta forward
      { ...v4Forward(50, 120), name: "RenderWidgetHostImpl::ForwardMouseEvent" }, // wrong name: dropped
    ];
    expect(allWheelForwardsMs(events)).toEqual([10, 10.3, 30, 30.3, 40]);
    expect(wheelForwardsMs(events)).toEqual([10, 30]);
    expect(allWheelForwardsMs(events.slice(1))).toEqual([]); // no Browser metadata: fail closed
  });
});

describe("parseWheelEventLatencies (q03b-v4)", () => {
  const events = [
    ...V4_PROCESS_NAMES,
    // A: kept; a second Commit begin inside the slice does not move the first.
    ...v4ElSlice("0x1", { begin: 4, map: 5.01, commit: 8, swapEnd: 14, end: 20 }),
    v4ElEvent("0x1", CADENCE_V4_EL_COMMIT_STAGE, "b", 9),
    // B: a mouse move, not a wheel: dropped.
    ...v4ElSlice("0x2", { begin: 4.5, map: 5.5, commit: 8, swapEnd: 14, end: 15 }, { type: "MOUSE_MOVED" }),
    // C: another pid: dropped.
    ...v4ElSlice("0x3", { begin: 4, map: 6, commit: 8, swapEnd: 14, end: 20 }, { pid: V4_BROWSER }),
    // D: a category that is not the exact EventLatency category: dropped.
    ...v4ElSlice("0x4", { begin: 4, map: 7, commit: 8, swapEnd: 14, end: 20 }, { cat: "input" }),
    // E: never reached its mapping stage: dropped.
    ...v4ElSlice("0x5", { begin: 6, commit: 9, swapEnd: 15, end: 21 }),
    // F: still open when the trace ends: dropped.
    ...v4ElSlice("0x6", { begin: 30, map: 31, commit: 33 }),
    // G: id 0x1 reused after A closed; terminated before Commit.
    ...v4ElSlice("0x1", { begin: 22, map: 22.02, end: 26 }),
    // H: id in id2.global.
    ...v4ElSlice({ global: "g7" }, { begin: 2, map: 3, commit: 7, swapEnd: 12, end: 13 }),
    // I: id in the plain `id` field.
    ...v4ElSlice({ plain: "0x9" }, { begin: 40, map: 41, commit: 45, swapEnd: 50, end: 52 }),
    // J: the map stage begins at the EventLatency's own ts and is listed
    // first; the swap-end stage is an instant ("n").
    v4ElEvent("0xa", CADENCE_V4_EL_MAP_STAGE, "b", 60),
    v4ElEvent("0xa", CADENCE_V4_EVENT_LATENCY, "b", 60),
    v4ElEvent("0xa", CADENCE_V4_EL_COMMIT_STAGE, "b", 63),
    v4ElEvent("0xa", CADENCE_V4_EL_SWAP_END_STAGE, "n", 66),
    v4ElEvent("0xa", CADENCE_V4_EVENT_LATENCY, "e", 70),
    // An event with no id at all: dropped.
    { cat: CADENCE_V4_EVENT_LATENCY_CATEGORY, name: CADENCE_V4_EVENT_LATENCY, ph: "b", pid: V4_RENDERER, ts: 80000, args: { event_latency: { event_type: "MOUSE_WHEEL" } } },
  ];

  it("66. keeps closed renderer-pid MOUSE_WHEEL slices that reached the map stage, sorted by map begin", () => {
    expect(parseWheelEventLatencies(events, V4_RENDERER)).toEqual([
      { beginMs: 2, endMs: 13, mapMs: 3, commitMs: 7, swapEndMs: 12 },
      { beginMs: 4, endMs: 20, mapMs: 5.01, commitMs: 8, swapEndMs: 14 },
      { beginMs: 22, endMs: 26, mapMs: 22.02, commitMs: null, swapEndMs: null },
      { beginMs: 40, endMs: 52, mapMs: 41, commitMs: 45, swapEndMs: 50 },
      { beginMs: 60, endMs: 70, mapMs: 60, commitMs: 63, swapEndMs: 66 },
    ] satisfies WheelEventLatency[]);
  });

  it("85. an id that begins again while open drops both slices until both end; the id is usable afterwards", () => {
    const reused = [
      ...V4_PROCESS_NAMES,
      // 0xb opens at 90 and begins again at 92 before either ends: both dropped,
      // including the second slice's stages.
      v4ElEvent("0xb", CADENCE_V4_EVENT_LATENCY, "b", 90),
      v4ElEvent("0xb", CADENCE_V4_EL_MAP_STAGE, "b", 91),
      v4ElEvent("0xb", CADENCE_V4_EL_MAP_STAGE, "e", 91.5),
      ...v4ElSlice("0xb", { begin: 92, map: 93, commit: 95, swapEnd: 97, end: 99 }),
      v4ElEvent("0xb", CADENCE_V4_EVENT_LATENCY, "e", 100),
      // A clean reuse after both ends: kept.
      ...v4ElSlice("0xb", { begin: 110, map: 111, commit: 113, swapEnd: 115, end: 117 }),
      // A neighbour id is unaffected.
      ...v4ElSlice("0xc", { begin: 90.5, map: 91.25, commit: 94, swapEnd: 96, end: 98 }),
    ];
    expect(parseWheelEventLatencies(reused, V4_RENDERER)).toEqual([
      { beginMs: 90.5, endMs: 98, mapMs: 91.25, commitMs: 94, swapEndMs: 96 },
      { beginMs: 110, endMs: 117, mapMs: 111, commitMs: 113, swapEndMs: 115 },
    ] satisfies WheelEventLatency[]);
  });

  it("67. a renderer pid with no EventLatency gives []", () => {
    expect(parseWheelEventLatencies(events, 1)).toEqual([]);
    expect(parseWheelEventLatencies([], V4_RENDERER)).toEqual([]);
  });
});

describe("mapForwardsToEventLatencies (q03b-v4)", () => {
  it("68. each forward maps to its nearest EventLatency with the distance", () => {
    const els = [v4El(10.02), v4El(30.05), v4El(50)];
    const maps = mapForwardsToEventLatencies([10, 30], [10, 10.5, 30, 30.5], els);
    expect(maps.map((m) => (m == null ? null : m.el))).toEqual([els[0], els[1]]);
    expect(maps[0]?.distMs).toBeCloseTo(0.02, 9);
    expect(maps[1]?.distMs).toBeCloseTo(0.05, 9);
  });

  it("69. a distance above the 0.1 ms bound, a tie between two EventLatencies, and no EventLatency are unmapped", () => {
    expect(mapForwardsToEventLatencies([10], [10], [v4El(10.125)])).toEqual([null]);
    expect(mapForwardsToEventLatencies([10], [10], [v4El(10.0625)])[0]?.distMs).toBe(0.0625);
    expect(mapForwardsToEventLatencies([10], [10], [v4El(9.9375), v4El(10.0625)])).toEqual([null]);
    expect(mapForwardsToEventLatencies([10, 30], [10, 30], [])).toEqual([null, null]);
  });

  it("70. a zero-delta forward as near or nearer to the EventLatency's map begin unmaps the wheel forward", () => {
    // Nearer competitor (0.03125 vs 0.09375), equidistant competitor (0.0625
    // each side), and a farther competitor (0.1875 vs 0.0625: mapped).
    expect(mapForwardsToEventLatencies([10], [10, 10.0625], [v4El(10.09375)])).toEqual([null]);
    expect(mapForwardsToEventLatencies([10], [10, 10.125], [v4El(10.0625)])).toEqual([null]);
    expect(mapForwardsToEventLatencies([10], [10, 10.25], [v4El(10.0625)])[0]?.distMs).toBe(0.0625);
  });

  it("71. two forwards claiming one EventLatency are both unmapped", () => {
    // Synthetic input: allForwardsMs omits the wheel forwards here, so only the
    // duplicate-claim rule can refuse the shared EventLatency. A real run passes
    // every forward, and the mutual-nearest rule then unmaps the farther
    // claimant first (same INVALID outcome).
    const el = v4El(10.0625);
    expect(mapForwardsToEventLatencies([10, 10.125], [], [el])).toEqual([null, null]);
    expect(mapForwardsToEventLatencies([10], [], [el])).toEqual([{ el, distMs: 0.0625 }]);
  });
});

describe("rendererMainTopLevelTasks / mainThreadBusyMs (q03b-v4)", () => {
  const events = [
    ...V4_PROCESS_NAMES,
    v4ThreadName(V4_RENDERER, 7, "CrRendererMain"),
    v4ThreadName(V4_RENDERER, 8, "Compositor"),
    v4ThreadName(V4_BROWSER, 7, "CrBrowserMain"),
    v4Task(V4_RENDERER, 7, 10, 5), // [10, 15]
    v4Task(V4_RENDERER, 7, 11, 2), // nested: dropped
    v4Task(V4_RENDERER, 7, 14, 4), // starts inside [10, 15], ends later: kept as [15, 18]
    v4Task(V4_RENDERER, 7, 16, 2), // [16, 18] ends at the kept end 18: nested, dropped
    v4Task(V4_RENDERER, 7, 20, 3, "toplevel"), // [20, 23]
    v4Task(V4_RENDERER, 7, 20, 1, "toplevel"), // same start, shorter: dropped
    v4Task(V4_RENDERER, 7, 30, 2, "toplevel.flow"), // not the "toplevel" token: dropped
    v4Task(V4_RENDERER, 7, 40, -1), // negative duration: dropped
    v4Task(V4_RENDERER, 8, 50, 5), // compositor thread: dropped
    v4Task(V4_BROWSER, 7, 60, 5), // same tid on the Browser pid: dropped
    { cat: "toplevel", name: "RunTask", ph: "B", pid: V4_RENDERER, tid: 7, ts: 70000 }, // not a complete slice: dropped
    v4Task(V4_RENDERER, 7, 80, 0), // zero duration: kept
  ];

  it("72. keeps the outermost toplevel X slices of the renderer main thread", () => {
    const tasks = rendererMainTopLevelTasks(events, V4_RENDERER);
    expect(tasks).toEqual([
      { startMs: 10, endMs: 15 },
      { startMs: 15, endMs: 18 },
      { startMs: 20, endMs: 23 },
      { startMs: 80, endMs: 80 },
    ]);
    // No CrRendererMain on the pid: fail closed.
    expect(rendererMainTopLevelTasks(events.filter((e) => (e.args as { name?: string } | undefined)?.name !== "CrRendererMain"), V4_RENDERER)).toEqual([]);
    expect(rendererMainTopLevelTasks(events, V4_BROWSER)).toEqual([]);
  });

  it("73. busy is the remainder of the task spanning the instant: start inclusive, end exclusive", () => {
    const tasks = rendererMainTopLevelTasks(events, V4_RENDERER);
    expect(mainThreadBusyMs(tasks, 12)).toBe(3);
    expect(mainThreadBusyMs(tasks, 10)).toBe(5);
    expect(mainThreadBusyMs(tasks, 15)).toBe(3);
    expect(mainThreadBusyMs(tasks, 17)).toBe(1);
    expect(mainThreadBusyMs(tasks, 18)).toBe(0);
    expect(mainThreadBusyMs(tasks, 19)).toBe(0);
    expect(mainThreadBusyMs(tasks, 22.5)).toBe(0.5);
    expect(mainThreadBusyMs(tasks, 5)).toBe(0);
    expect(mainThreadBusyMs(tasks, 80)).toBe(0);
    expect(mainThreadBusyMs([], 12)).toBe(0);
  });
});

describe("ownFrameLatenciesMs / cadenceOwnFrameBlock / ownFrameAnsweredByPriorFrame (q03b-v4)", () => {
  // Three wheels: marks 100 / 120 / 140, end mark 145 (tail 245). Forwards
  // 105 / 122 / 141, each followed by its zero-delta twin 0.3 ms later.
  //  wheel 0: the main thread is busy until 103 at the mark (busy 3 <= hold
  //    5): anchor 102; own frame swaps at 114 -> 12.
  //  wheel 1: busy until 130 at the mark, longer than the 2 ms hold: the bias
  //    is capped at the hold, anchor 120 (= the mark). Its own slice
  //    terminated at 126 without a frame; the first presented wheel frame
  //    committing at-or-after 126 is Q (commit 127, swap 133) -> 13. S
  //    commits at 126.5 but never swapped and is skipped.
  //  wheel 2: idle at the mark: anchor 141; own frame swaps at 150 -> 9.
  // Q and S map more than 2 ms from any forward: nobody's own frame.
  // P is a frame committed before wheel 0's anchor that swaps at 106, after
  // wheel 0's forward and before its own frame: the trap a first-presented-
  // frame answer falls into.
  const events = [
    ...V4_PROCESS_NAMES,
    v4ThreadName(V4_RENDERER, 7, "CrRendererMain"),
    v4Task(V4_RENDERER, 7, 98, 5),
    v4Task(V4_RENDERER, 7, 119, 11),
    v4Forward(105, 120), v4Forward(105.3, 0),
    v4Forward(122, 120), v4Forward(122.3, 0),
    v4Forward(141, 120), v4Forward(141.3, 0),
    ...v4ElSlice("0xp", { begin: 89, map: 90, commit: 99, swapEnd: 106, end: 108 }),
    ...v4ElSlice("0x0", { begin: 104, map: 105.008, commit: 108, swapEnd: 114, end: 117 }),
    ...v4ElSlice("0x1", { begin: 121, map: 122.012, end: 126 }),
    ...v4ElSlice("0xs", { begin: 125, map: 125.5, commit: 126.5, end: 131 }),
    ...v4ElSlice("0xq", { begin: 124, map: 124.5, commit: 127, swapEnd: 133, end: 135 }),
    ...v4ElSlice("0x2", { begin: 140, map: 141.004, commit: 145, swapEnd: 150, end: 152 }),
  ];
  const marks = [100, 120, 140];
  const endMark = 145;

  function rowsOf(evts: readonly unknown[], m: readonly number[] = marks, end = endMark): OwnFrameLatencyRow[] {
    const pairing = pairWheelForwards(m, wheelForwardsMs(evts), m[0] ?? 0, end);
    return ownFrameLatenciesMs(
      pairing,
      allWheelForwardsMs(evts),
      parseWheelEventLatencies(evts, V4_RENDERER),
      rendererMainTopLevelTasks(evts, V4_RENDERER),
      end,
    );
  }

  it("74. anchor = forward - min(busy at mark, hold); answer = the wheel's own frame swap, or the fallback frame", () => {
    const rows = rowsOf(events);
    expect(v4Round(rows)).toEqual([
      { markMs: 100, forwardMs: 105, mapDistMs: 0.008, biasMs: 3, anchorMs: 102, commitMs: 108, swapEndMs: 114, fallback: false, latencyMs: 12 },
      { markMs: 120, forwardMs: 122, mapDistMs: 0.012, biasMs: 2, anchorMs: 120, commitMs: 127, swapEndMs: 133, fallback: true, latencyMs: 13 },
      { markMs: 140, forwardMs: 141, mapDistMs: 0.004, biasMs: 0, anchorMs: 141, commitMs: 145, swapEndMs: 150, fallback: false, latencyMs: 9 },
    ] satisfies OwnFrameLatencyRow[]);
    expect(forwardLatencyStats(rows)).toEqual({
      input_marks: 3,
      input_unpresented: 0,
      input_to_present_p50_ms: 12,
      input_to_present_p95_ms: 13,
      input_to_present_p99_ms: 13,
    });
    expect(ownFrameAnsweredByPriorFrame(rows)).toBe(0);
    const block = cadenceOwnFrameBlock(rows, 2);
    expect({ ...block, map_max_ms: Math.round(block.map_max_ms * 1e6) / 1e6 }).toEqual({
      mapped: 3, fallback: 1, map_max_ms: 0.012, bias_p50_ms: 2, bias_max_ms: 3, main_tasks: 2,
    } satisfies CadenceOwnFrame);
  });

  it("75. the own-frame answer discriminates from the v3 first-presentation answer over the same frames", () => {
    // v3 answers wheel 0 with P's swap at 106 (1 ms from the forward); v4
    // answers it with its own frame (12 ms from the anchor).
    const v3 = forwardLatenciesMs(v3Parsed([106, 114, 133, 150]), pairWheelForwards(marks, wheelForwardsMs(events), 100, endMark), endMark);
    expect(v3[0]?.latencyMs).toBe(1);
    expect(rowsOf(events)[0]?.latencyMs).toBe(12);
  });

  it("76. a frame swapped after end + tail is unpresented; a fallback with no later presented frame is unpresented", () => {
    const late = [
      ...events.filter((e) => (e as { id2?: { local?: string } }).id2?.local !== "0x2"),
      ...v4ElSlice("0x2", { begin: 140, map: 141.004, commit: 145, swapEnd: 245.5, end: 250 }),
    ];
    const lateRows = rowsOf(late);
    expect(v4Round([lateRows[2] as OwnFrameLatencyRow])[0]).toEqual({
      markMs: 140, forwardMs: 141, mapDistMs: 0.004, biasMs: 0, anchorMs: 141, commitMs: 145, swapEndMs: 245.5, fallback: false, latencyMs: null,
    });
    expect(forwardLatencyStats(lateRows).input_unpresented).toBe(1);
    // Drop Q and wheel 2's frame: wheel 1's fallback finds no presented frame
    // committing at-or-after 126.
    const noLater = events.filter((e) => {
      const id = (e as { id2?: { local?: string } }).id2?.local;
      return id !== "0xq" && id !== "0x2";
    });
    const r1 = rowsOf(noLater)[1] as OwnFrameLatencyRow;
    expect(r1.fallback).toBe(true);
    expect(r1.swapEndMs).toBeNull();
    expect(r1.latencyMs).toBeNull();
  });

  it("86. a fallback over frames sharing one Commit begin takes the later swap end", () => {
    const pairing = pairWheelForwards([0], [3], 0, 45);
    const own = v4El(3.01, { endMs: 5, commitMs: null, swapEndMs: null });
    // Listed earlier-swap first, both by map begin and by array order.
    const tieA = v4El(4, { commitMs: 6, swapEndMs: 9 });
    const tieB = v4El(4.5, { commitMs: 6, swapEndMs: 12 });
    for (const els of [[own, tieA, tieB], [own, tieB, tieA]]) {
      const r = ownFrameLatenciesMs(pairing, [3], els, [], 45)[0] as OwnFrameLatencyRow;
      expect(r.fallback).toBe(true);
      expect(r.swapEndMs).toBe(12);
      expect(r.latencyMs).toBe(9);
    }
  });

  it("77. a mark without a forward, an unmapped forward and a forward before its mark", () => {
    const pairing = pairWheelForwards([0, 20, 40], [3, 23], 0, 45);
    const rows = ownFrameLatenciesMs(pairing, [3, 23], [v4El(3.01)], [{ startMs: -1, endMs: 1 }], 45);
    expect(v4Round(rows)).toEqual([
      { markMs: 0, forwardMs: 3, mapDistMs: 0.01, biasMs: 1, anchorMs: 2, commitMs: 6.01, swapEndMs: 11.01, fallback: false, latencyMs: 9.01 },
      { markMs: 20, forwardMs: 23, mapDistMs: null, biasMs: 0, anchorMs: 23, commitMs: null, swapEndMs: null, fallback: false, latencyMs: null },
      { markMs: 40, forwardMs: null, mapDistMs: null, biasMs: null, anchorMs: null, commitMs: null, swapEndMs: null, fallback: false, latencyMs: null },
    ]);
    // A forward before its mark never gets a negative bias: anchor = forward.
    const early = ownFrameLatenciesMs(pairWheelForwards([10], [9], 0, 20), [9], [v4El(9)], [{ startMs: 5, endMs: 15 }], 20);
    expect(early[0]?.biasMs).toBe(0);
    expect(early[0]?.anchorMs).toBe(9);
    expect(() => ownFrameLatenciesMs(pairWheelForwards([], [], 0, 10), [], [], [], 10)).toThrow(/no input marks/);
  });

  it("78. the own_frame block of unmapped rows carries UNMEASURED distances; answered_by_prior_frame is strict", () => {
    const pairing = pairWheelForwards([0], [], 0, 10);
    const block = cadenceOwnFrameBlock(ownFrameLatenciesMs(pairing, [], [], [], 10), 0);
    expect(block).toEqual({ mapped: 0, fallback: 0, map_max_ms: UNMEASURED, bias_p50_ms: UNMEASURED, bias_max_ms: UNMEASURED, main_tasks: 0 });
    const row = (commitMs: number, latencyMs: number | null): OwnFrameLatencyRow => ({
      markMs: 0, forwardMs: 5, mapDistMs: 0, biasMs: 1, anchorMs: 4, commitMs, swapEndMs: 9, fallback: false, latencyMs,
    });
    expect(ownFrameAnsweredByPriorFrame([row(3.9, 5), row(4, 5), row(3, null)])).toBe(1);
  });
});

describe("buildCadenceReceipt / validateCadenceReceipt — q03b-v4 receipt keys + INVALID rules", () => {
  function v4Pan(): CadenceGestureStats {
    return {
      inputs: 200, input_hz: 20, presented: 200, partial: 0, dropped: 0,
      p50_ms: 8, p95_ms: 18, p99_ms: 28,
      input_marks: 200, input_unpresented: 0,
      input_to_present_p50_ms: 8, input_to_present_p95_ms: 18, input_to_present_p99_ms: 28,
    };
  }
  function greenStatsV4Zoom(own: Partial<CadenceOwnFrame> = {}, overrides: Partial<CadenceZoomV4Stats> = {}): CadenceZoomV4Stats {
    return {
      ...v4Pan(),
      inputs: 60, input_hz: 50, presented: 60, input_marks: 60,
      dispatch: { gap_min_ms: 17, gap_jitter_ms: 6, seed: 1371552512, scheduled: 60, dispatched: 60, dispatch_dev_max_ms: 0.5 },
      awake_start: { heartbeat_ms: 200.5, heartbeat_mode: "through", leadin_presentations: 0 },
      answered_by_prior_frame: 0,
      forward: { forwards: 60, paired: 60, stamp_to_forward_min_ms: 3, stamp_to_forward_p50_ms: 5.3, stamp_to_forward_max_ms: 10.4 },
      own_frame: { mapped: 60, fallback: 1, map_max_ms: 0.015, bias_p50_ms: 0, bias_max_ms: 5.2, main_tasks: 412, ...own },
      ...overrides,
    };
  }
  function greenV4Receipt(zoom: CadenceZoomV4Stats | CadenceZoomV3Stats = greenStatsV4Zoom(), protocol: CadenceProtocol = "q03b-v4") {
    return buildCadenceReceipt({
      commit: "a".repeat(40),
      impl: "mm",
      host: { os: "test-os", cpu: "test-cpu", dpr: 2 },
      display: { vsync_ms: 10, hz: 100 },
      generated_at: "2026-01-01T00:00:00.000Z",
      pan: v4Pan(),
      zoom,
      protocol,
    });
  }
  function withoutOwnFrame(z: CadenceZoomV4Stats): CadenceZoomV3Stats {
    const copy: Partial<CadenceZoomV4Stats> = { ...z };
    delete copy.own_frame;
    return copy as CadenceZoomV3Stats;
  }
  function errorsOf(r: unknown): string[] {
    const v = validateCadenceReceipt(r);
    return v.ok ? [] : v.errors;
  }

  it("79. v4 valid fixture: validates; protocol q03b-v4; zoom has 18 keys and own_frame exactly its 6 keys", () => {
    const r = greenV4Receipt();
    expect(r.protocol).toBe("q03b-v4");
    expect(Object.keys(r).length).toBe(10);
    expect(validateCadenceReceipt(r)).toEqual({ ok: true });
    expect(Object.keys(r.gesture.zoom).length).toBe(18);
    expect(Object.keys((r.gesture.zoom as CadenceZoomV4Stats).own_frame)).toEqual([
      "mapped", "fallback", "map_max_ms", "bias_p50_ms", "bias_max_ms", "main_tasks",
    ]);
  });

  it("80. a v3 receipt carrying own_frame is refused; a v4 receipt without own_frame is refused", () => {
    expect(errorsOf(greenV4Receipt(greenStatsV4Zoom(), "q03b-v3"))).toContain('unexpected gesture.zoom key "own_frame"');
    const v3Zoom = withoutOwnFrame(greenStatsV4Zoom());
    const missing = errorsOf(greenV4Receipt(v3Zoom));
    expect(missing).toContain('missing gesture.zoom key "own_frame"');
    expect(missing).toContain("gesture.zoom.own_frame must be an object");
    expect(validateCadenceReceipt(greenV4Receipt(v3Zoom, "q03b-v3"))).toEqual({ ok: true });
  });

  it("81. each v4 own-frame rule fires alone with the INVALID (q03b-v4) prefix; 0.1 ms and 1 task are the inclusive bounds", () => {
    const cases: Array<{ own: Partial<CadenceOwnFrame>; want: string }> = [
      { own: { mapped: 59 }, want: "INVALID (q03b-v4): gesture.zoom.own_frame.mapped (59) must equal dispatch.scheduled (60)" },
      { own: { mapped: 61 }, want: "INVALID (q03b-v4): gesture.zoom.own_frame.mapped (61) must equal dispatch.scheduled (60)" },
      { own: { map_max_ms: 0.11 }, want: "INVALID (q03b-v4): gesture.zoom.own_frame.map_max_ms (0.11) must be <= 0.1" },
      { own: { main_tasks: 0 }, want: "INVALID (q03b-v4): gesture.zoom.own_frame.main_tasks (0) must be >= 1" },
    ];
    for (const c of cases) {
      expect(errorsOf(greenV4Receipt(greenStatsV4Zoom(c.own)))).toEqual([c.want]);
    }
    expect(validateCadenceReceipt(greenV4Receipt(greenStatsV4Zoom({ map_max_ms: 0.1, main_tasks: 1 })))).toEqual({ ok: true });
    // The block of an all-unmapped run is INVALID, never valid.
    const empty = errorsOf(greenV4Receipt(greenStatsV4Zoom(cadenceOwnFrameBlock(ownFrameLatenciesMs(pairWheelForwards([0], [], 0, 10), [], [], [], 10), 0))));
    expect(empty).toEqual([
      "INVALID (q03b-v4): gesture.zoom.own_frame.mapped (0) must equal dispatch.scheduled (60)",
      `INVALID (q03b-v4): gesture.zoom.own_frame.map_max_ms (${UNMEASURED}) must be <= 0.1`,
      "INVALID (q03b-v4): gesture.zoom.own_frame.main_tasks (0) must be >= 1",
    ]);
  });

  it("82. the v2 and v3 INVALID rules carry the q03b-v4 prefix inside a v4 receipt", () => {
    expect(errorsOf(greenV4Receipt(greenStatsV4Zoom({}, { input_unpresented: 1 })))).toEqual([
      "INVALID (q03b-v4): gesture.zoom.input_unpresented (1) must be 0",
    ]);
    const fwd = errorsOf(greenV4Receipt(greenStatsV4Zoom({}, {
      forward: { forwards: 59, paired: 60, stamp_to_forward_min_ms: 3, stamp_to_forward_p50_ms: 5.3, stamp_to_forward_max_ms: 10.4 },
    })));
    expect(fwd).toEqual(["INVALID (q03b-v4): gesture.zoom.forward.forwards (59) must equal dispatch.scheduled (60)"]);
  });

  it("83. own_frame shape errors: non-integer count, negative or non-finite ms, fallback above mapped, unexpected and missing keys", () => {
    const nonInt = errorsOf(greenV4Receipt(greenStatsV4Zoom({ mapped: 59.5 })));
    expect(nonInt).toContain("gesture.zoom.own_frame.mapped must be a non-negative integer (got 59.5)");
    expect(nonInt.some((e) => e.startsWith("INVALID"))).toBe(false);
    expect(errorsOf(greenV4Receipt(greenStatsV4Zoom({ bias_max_ms: -1 })))).toEqual([
      "gesture.zoom.own_frame.bias_max_ms must be a finite number >= 0 (got -1)",
    ]);
    expect(errorsOf(greenV4Receipt(greenStatsV4Zoom({ bias_p50_ms: Number.NaN })))).toContain(
      "gesture.zoom.own_frame.bias_p50_ms must be a finite number >= 0 (got null)",
    );
    expect(errorsOf(greenV4Receipt(greenStatsV4Zoom({ fallback: 61, mapped: 60 })))).toEqual([
      "gesture.zoom.own_frame.fallback (61) must be <= mapped (60)",
    ]);
    const extra = greenStatsV4Zoom();
    (extra.own_frame as Record<string, unknown>).latency_ms = 1;
    expect(errorsOf(greenV4Receipt(extra))).toContain('unexpected gesture.zoom.own_frame key "latency_ms"');
    const missing = greenStatsV4Zoom();
    delete (missing.own_frame as Partial<CadenceOwnFrame>).main_tasks;
    expect(errorsOf(greenV4Receipt(missing))).toContain('missing gesture.zoom.own_frame key "main_tasks"');
  });

  it("84. cadenceInvalidLine prints the v4 mapped and main-task counts in order and no distance, bias or latency value", () => {
    const zoom = greenStatsV4Zoom(
      { mapped: 59, map_max_ms: 0.0137, bias_p50_ms: 1.2468, bias_max_ms: 7.5319, main_tasks: 412 },
      { input_to_present_p50_ms: 1.234, input_to_present_p95_ms: 12.345, input_to_present_p99_ms: 67.891 },
    );
    const receipt = greenV4Receipt(zoom);
    const errors = errorsOf(receipt).filter((e) => e.startsWith("INVALID (q03b-v4):"));
    expect(errors).toEqual(["INVALID (q03b-v4): gesture.zoom.own_frame.mapped (59) must equal dispatch.scheduled (60)"]);
    const diag: CadenceEndMarkDiag = { zoom_marks_after_end: 0, zoom_end_minus_last_mark_ms: 3.5 };
    const line = cadenceInvalidLine("mm", 1, 2, receipt, diag, errors);
    expect(line).toContain(" forwards=60 paired=60 mapped=59 main_tasks=412 zoom_marks_after_end=0 ");
    let prev = -1;
    for (const key of CADENCE_INVALID_FIELDS) {
      const idx = line.indexOf(`${key}=`);
      expect(idx, `field "${key}" missing or out of order in: ${line}`).toBeGreaterThan(prev);
      prev = idx;
    }
    for (const leak of ["0.0137", "1.2468", "7.5319", "1.234", "12.345", "67.891", "bias", "map_max", "fallback", "lat", "p95", "p99"]) {
      expect(line).not.toContain(leak);
    }
  });
});
