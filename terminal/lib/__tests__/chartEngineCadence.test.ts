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
  validateCadenceReceipt,
  CADENCE_BUDGETS,
  type CadenceGestureStats,
} from "../chart-engine/bench/cadence";
import { percentile } from "../chart-engine/bench/corpus";
import { BUDGETS } from "../chart-engine/bench/receipt";

const FIX_DIR = path.resolve(__dirname, "fixtures", "chart-engine");
const SAMPLE = JSON.parse(readFileSync(path.join(FIX_DIR, "cadence-trace.sample.json"), "utf8"));
const RAF_ONLY = JSON.parse(readFileSync(path.join(FIX_DIR, "cadence-trace.raf-only.sample.json"), "utf8"));

const SAMPLE_EVENTS = asTraceEvents(SAMPLE);

// Pin the oracle literals computed in the throwaway script in $TMPDIR.
// The script never touches cadence.ts; the literals are the contract.
const ORACLE = {
  rendererPid: 2,
  presented: 19,
  partial: 0,
  dropped: 10,
  presentedMsLen: 19,
  presentedMsFirst: -115.798,
  presentedMsLast: 8225.11,
  winPresented: 17,
  winPartial: 0,
  winDropped: 10,
  intervalsCount: 16,
  p50: 44.46900000000002,
  p95: 4866.054,
  p99: 4866.054,
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
    // M-B guard: presentedMs[0] is at -115.798 (before the gesture window
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
    expect(CADENCE_BUDGETS).toEqual({ presented_p95_ms: 20, presented_p99_ms: 33.4 });
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

describe("buildCadenceReceipt / validateCadenceReceipt (Q03)", () => {
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
      ...overrides,
    };
  }
  function greenReceipt() {
    return buildCadenceReceipt({
      commit: "a".repeat(40),
      impl: "mm",
      host: { os: "test-os", cpu: "test-cpu", dpr: 2 },
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
});
