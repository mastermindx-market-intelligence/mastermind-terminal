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

  it("13. Q03b receipt: 9 top-level keys, 13 stat keys, METRIC_ORDER adds 4 input_to_present rows; rejects display / budgets / latency shape errors", () => {
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

    // 9 top-level keys, 13 gesture stat keys.
    const keyCount = (o: unknown) => (o && typeof o === "object" ? Object.keys(o as Record<string, unknown>).length : 0);
    expect(keyCount(r)).toBe(9);
    expect(keyCount(r.gesture.pan)).toBe(13);
    expect(keyCount(r.gesture.zoom)).toBe(13);

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
