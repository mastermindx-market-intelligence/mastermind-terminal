// AC-E17-03 / 04 / 05 — the dry run's pure core (lib/alertDryRun.ts): admission order, the
// fail-closed exits (missing / stale / forbidden / failed inputs are cannot_evaluate, never
// not_met), the explanation's identity + clocks, and the stateful-sequence rule (supplied state is
// refused; prior history is never replayed into an arming the alert never recorded).
//
// Events here are hand-placed on a 10-bar daily clock so every expectation is exact. Decisions
// are cross-checked against direct calls to the canonical evaluator, never against a copy of it.
import { describe, expect, it, vi } from "vitest";
import {
  DryRunAborted,
  admitDryRunRequest,
  barAgeDays,
  dryRunRequiredTier,
  explainDryRun,
  normalizeDryRunSymbol,
  readDryRunResult,
  runAlertDryRun,
} from "@/lib/alertDryRun";
import type { DryRunDeps, DryRunResult } from "@/lib/alertDryRun";
import { ALERT_DRY_RUN_SCHEMA, dryRunResult } from "@/lib/alertDryRunContract";
import { SUITE_ALERT_EVENTS, SUITE_EVENT_FRESH_BARS, evalSuiteEvent, evalSuiteSequence } from "@/lib/suiteAlerts";
import { ALERT_DRY_RUN_LEX } from "@/lib/alertDryRunLex";
import type { SuiteAlertCondition, SuiteSequenceCondition } from "@/lib/suiteAlerts";
import type { SuiteEvent } from "@/lib/indicator-canvas/types";
import type { SuiteSymbolData } from "@/lib/suiteAlertInputs";
import { suiteAlertFloorT } from "@/lib/suiteAlertInputs";

const DAY = 86_400;
const T0 = Date.UTC(2026, 2, 2) / 1000; // 2026-03-02
const N = 10; // bars 2026-03-02 .. 2026-03-11
const barsT = Array.from({ length: N }, (_, i) => T0 + i * DAY);
const DATA: SuiteSymbolData = {
  barsT,
  bars: barsT.map((t) => ({ time: t, o: 10, h: 11, l: 9, c: 10.5, v: 1000 })),
};
const NOW = (T0 + (N - 1) * DAY) * 1000 + 15 * 3_600_000; // 2026-03-11 15:00 UTC
const AS_OF = NOW - 2 * 3_600_000;

const ev = (type: string, i: number, extra: Partial<SuiteEvent> = {}): SuiteEvent => ({ type, dir: "bull", i, p: 10 + i, ...extra });
const bos: SuiteAlertCondition = { type: "suite_event", suite: "structure", event: "bos" };
const seq: SuiteSequenceCondition = {
  type: "suite_sequence",
  suite: "structure",
  steps: [{ event: "bos" }, { event: "choch" }],
  maxBarsBetween: 10,
};

function deps(events: SuiteEvent[], over: Partial<DryRunDeps> = {}) {
  const calls = { read: 0, compute: 0, plan: [] as string[] };
  const d: DryRunDeps = {
    readSymbolDoc: async () => {
      calls.read++;
      return { doc: { bars: [] }, asOfMs: AS_OF };
    },
    parseBars: () => DATA,
    computeEvents: async () => {
      calls.compute++;
      return events;
    },
    planAdmits: async (tier) => {
      calls.plan.push(tier);
      return true;
    },
    nowMs: () => NOW,
    ...over,
  };
  return { d, calls };
}

const run = (body: unknown, events: SuiteEvent[] = [], over: Partial<DryRunDeps> = {}) => {
  const { d, calls } = deps(events, over);
  return runAlertDryRun(body, d).then((r) => ({ r, calls }));
};

describe("admission (exact request snapshot)", () => {
  it("refuses a non-object body or condition as malformed", () => {
    for (const body of [null, 7, "x", {}, { symbol: "AAPL" }, { symbol: "AAPL", condition: [] }, { symbol: "AAPL", condition: "bos" }]) {
      const a = admitDryRunRequest(body);
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.result).toMatchObject({ verdict: "cannot_evaluate", reason: "malformed" });
    }
  });

  it("answers unsupported for every non-suite condition type: the Python engine owns those", () => {
    for (const type of ["signal", "regime", "price", "rsi", "opt_gamma_flip", "opt_wall_touch", undefined, "nope"]) {
      const a = admitDryRunRequest({ symbol: "AAPL", condition: { type, op: ">", value: 1 } });
      expect(a.ok).toBe(false);
      if (!a.ok) {
        expect(a.result.verdict).toBe("unsupported");
        expect(a.result.reason).toBe("unsupported_type");
        expect(a.result.verdict).not.toBe("not_met");
      }
    }
  });

  it("refuses supplied engine state (_se / _sq / triggered) BEFORE validation, on both families", () => {
    const cases: Array<Record<string, unknown>> = [
      { ...bos, _se: { lastFiredT: 1 } },
      { ...bos, triggered: { at: "2026-03-01", value: 1, note: "x" } },
      { ...seq, _sq: { stepIdx: 1, armedT: T0 } },
      { ...seq, triggered: { at: "2026-03-01" } },
      // State on an otherwise INVALID condition still answers supplied_state, not malformed:
      { type: "suite_event", suite: "structure", event: "no_such_event", _se: {} },
      // Even an explicit undefined key is a supplied key.
      { ...bos, _se: undefined },
    ];
    for (const condition of cases) {
      const a = admitDryRunRequest({ symbol: "AAPL", condition });
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.result).toMatchObject({ verdict: "unsupported", reason: "supplied_state" });
    }
  });

  it("runs the canonical validators (same reasons the alerts POST route would reject)", () => {
    const bad = [
      { type: "suite_event", suite: "structure", event: "no_such_event" },
      { type: "suite_event", suite: "trend", event: "bos" },
      { type: "suite_event", suite: "structure", event: "bos", dir: "sideways" },
      { type: "suite_sequence", suite: "structure", steps: [{ event: "bos" }], maxBarsBetween: 10 },
      { type: "suite_sequence", suite: "structure", steps: [{ event: "bos" }, { event: "te_flip" }], maxBarsBetween: 10 },
      { type: "suite_sequence", suite: "structure", steps: [{ event: "bos" }, { event: "choch" }], maxBarsBetween: 1 },
    ];
    for (const condition of bad) {
      const a = admitDryRunRequest({ symbol: "AAPL", condition });
      expect(a.ok).toBe(false);
      if (!a.ok) {
        expect(a.result).toMatchObject({ verdict: "cannot_evaluate", reason: "malformed" });
        expect(a.result.detail).toBeTruthy();
      }
    }
  });

  it("admits only path-safe bar-file symbols", () => {
    expect(normalizeDryRunSymbol(" aapl ")).toBe("AAPL");
    for (const ok of ["BRK.B", "0700.HK", "BTC-USD", "^GSPC", "PARITY_FIXTURE"]) expect(normalizeDryRunSymbol(ok)).toBe(ok);
    for (const bad of ["", "   ", "../AAPL", "A/B", "A\\B", "..", "A..B", ".AAPL", "A B", "X".repeat(25), 7, null, undefined, "AAPL\u0000"]) {
      expect(normalizeDryRunSymbol(bad)).toBeNull();
    }
    const a = admitDryRunRequest({ symbol: "../../etc/passwd", condition: bos });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.result).toMatchObject({ verdict: "cannot_evaluate", reason: "invalid_symbol" });
  });
});

describe("tier: the dry run never evaluates what its creator could not save", () => {
  it("an event's catalog tier; a sequence's highest step tier; unknown fails closed to pro", () => {
    for (const e of SUITE_ALERT_EVENTS) {
      expect(dryRunRequiredTier({ type: "suite_event", suite: e.suite, event: e.event })).toBe(e.tier === "free" || e.tier === "essential" ? e.tier : "pro");
    }
    expect(dryRunRequiredTier(seq)).toBe("essential");
    expect(dryRunRequiredTier({ ...seq, steps: [{ event: "bos" }, { event: "ob_touch" }] })).toBe("pro");
    expect(dryRunRequiredTier({ ...seq, steps: [] })).toBe("pro");
    expect(dryRunRequiredTier({ ...bos, event: "unknown_event" })).toBe("pro");
  });

  it("plan refusal → cannot_evaluate/plan_not_confirmed, and NOTHING is read or computed", async () => {
    const { r, calls } = await run({ symbol: "AAPL", condition: { ...bos, event: "ob_touch" } }, [ev("ob_touch", 9)], {
      planAdmits: async () => false,
    });
    expect(r).toMatchObject({ verdict: "cannot_evaluate", reason: "plan_not_confirmed", requiredTier: "pro", symbol: "AAPL" });
    expect(r.condition?.key).toBe("structure:ob_touch");
    expect(r.clocks).toBeUndefined();
    expect(r.decision).toBeUndefined();
    expect(calls.read).toBe(0);
    expect(calls.compute).toBe(0);
  });

  it("an unreachable billing authority is a refusal, not a grant", async () => {
    const { d } = deps([ev("bos", 9)], { planAdmits: () => Promise.reject(new Error("billing down")) });
    await expect(runAlertDryRun({ symbol: "AAPL", condition: bos }, d)).rejects.toThrow("billing down");
  });
});

describe("missing / stale / failed inputs are cannot_evaluate, never not_met (AC-E17-03)", () => {
  it("absent file → no_data", async () => {
    const { r, calls } = await run({ symbol: "AAPL", condition: bos }, [], { readSymbolDoc: async () => null });
    expect(r).toMatchObject({ verdict: "cannot_evaluate", reason: "no_data" });
    expect(calls.compute).toBe(0);
  });

  it("unparseable bars → no_data", async () => {
    const { r } = await run({ symbol: "AAPL", condition: bos }, [], { parseBars: () => null });
    expect(r).toMatchObject({ verdict: "cannot_evaluate", reason: "no_data" });
  });

  it("bars older than 5 days → stale_data, WITH the availability clock that proves it", async () => {
    const later = NOW + 6 * DAY * 1000;
    expect(barAgeDays(DATA, later)).toBe(6);
    const { r, calls } = await run({ symbol: "AAPL", condition: bos }, [ev("bos", 9)], { nowMs: () => later });
    expect(r).toMatchObject({ verdict: "cannot_evaluate", reason: "stale_data", timeframe: "1D" });
    expect(r.clocks).toMatchObject({ lastBarDate: "2026-03-11", barCount: N, evaluatedAt: new Date(later).toISOString() });
    expect(r.decision).toBeUndefined();
    expect(calls.compute).toBe(0);
  });

  it("5 days old is still evaluated (the bound is inclusive), e.g. over a long weekend", async () => {
    const at5 = NOW + 5 * DAY * 1000;
    expect(barAgeDays(DATA, at5)).toBe(5);
    const { r } = await run({ symbol: "AAPL", condition: bos }, [ev("bos", 9)], { nowMs: () => at5 });
    expect(["would_trigger", "not_met"]).toContain(r.verdict);
  });

  it("compute throw or non-array → compute_failed", async () => {
    const thrown = await run({ symbol: "AAPL", condition: bos }, [], { computeEvents: async () => { throw new Error("no runtime"); } });
    expect(thrown.r).toMatchObject({ verdict: "cannot_evaluate", reason: "compute_failed" });
    const junk = await run({ symbol: "AAPL", condition: bos }, [], { computeEvents: async () => ({}) as unknown as SuiteEvent[] });
    expect(junk.r).toMatchObject({ verdict: "cannot_evaluate", reason: "compute_failed" });
  });

  it("an aborted request stops before any further read", async () => {
    const ac = new AbortController();
    ac.abort();
    const { d, calls } = deps([ev("bos", 9)], { signal: ac.signal });
    await expect(runAlertDryRun({ symbol: "AAPL", condition: bos }, d)).rejects.toBeInstanceOf(DryRunAborted);
    expect(calls.read).toBe(0);
    expect(calls.plan).toEqual([]);
  });

  it("an abort mid-compute surfaces as DryRunAborted (no verdict for a cancelled request)", async () => {
    const ac = new AbortController();
    const { d } = deps([], {
      signal: ac.signal,
      computeEvents: async () => {
        ac.abort();
        return [ev("bos", 9)];
      },
    });
    await expect(runAlertDryRun({ symbol: "AAPL", condition: bos }, d)).rejects.toBeInstanceOf(DryRunAborted);
  });
});

describe("decision = the canonical evaluator; explanation = identity + both clocks (AC-E17-01/04)", () => {
  const floorT = suiteAlertFloorT(new Date(NOW).toISOString());

  it("a bullish BOS confirmed today → would_trigger with the evaluator's own note", async () => {
    const events = [ev("bos", 9), ev("choch", 6)];
    const { r } = await run({ symbol: "aapl", condition: { ...bos, dir: "bull" } }, events);
    const canon = evalSuiteEvent({ ...bos, dir: "bull" }, events, barsT, floorT);
    expect(canon.fired).toBe(true);
    expect(r.verdict).toBe("would_trigger");
    expect(r.decision).toMatchObject({ fired: true, note: canon.note, value: canon.value, confirmedDate: "2026-03-11" });
    expect(r).toMatchObject({ symbol: "AAPL", timeframe: "1D", basis: "daily_bars_module_defaults", readOnly: true, schema: ALERT_DRY_RUN_SCHEMA });
    expect(r.condition).toMatchObject({
      type: "suite_event",
      suite: "structure",
      key: "structure:bos",
      tier: "essential",
      steps: [{ event: "bos", label: "Break of structure (BOS)", dir: "bull" }],
    });
    expect(r.clocks).toEqual({
      evaluatedAt: new Date(NOW).toISOString(),
      lastBarDate: "2026-03-11",
      barCount: N,
      sourceAsOf: new Date(AS_OF).toISOString(),
      freshFrom: "2026-03-09",
      freshTo: "2026-03-11",
      creationFloorDate: "2026-03-11",
    });
    expect(r.trace).toEqual([
      { id: "data", status: "pass" },
      { id: "fresh_window", status: "pass" },
      { id: "event_in_window", status: "pass", at: "2026-03-11" },
      { id: "filters", status: "pass", at: "2026-03-11" },
      { id: "creation_floor", status: "pass", at: "2026-03-11" },
    ]);
    // Recent lists only the requested type (choch is not part of this condition).
    expect(r.recent).toEqual([{ event: "bos", dir: "bull", anchorDate: "2026-03-11", confirmedDate: "2026-03-11" }]);
  });

  it("an event confirmed YESTERDAY is in the fresh window but before a new alert's floor → not_met", async () => {
    const events = [ev("bos", 8)];
    const { r } = await run({ symbol: "AAPL", condition: bos }, events);
    expect(evalSuiteEvent(bos, events, barsT, floorT).fired).toBe(false);
    expect(r.verdict).toBe("not_met");
    expect(r.trace?.find((s) => s.id === "event_in_window")).toEqual({ id: "event_in_window", status: "pass", at: "2026-03-10" });
    expect(r.trace?.find((s) => s.id === "filters")).toEqual({ id: "filters", status: "not_applicable" });
    expect(r.trace?.find((s) => s.id === "creation_floor")).toEqual({ id: "creation_floor", status: "fail" });
  });

  it("a direction mismatch fails the filter step and skips the floor step", async () => {
    const { r } = await run({ symbol: "AAPL", condition: { ...bos, dir: "bull" } }, [ev("bos", 9, { dir: "bear" })]);
    expect(r.verdict).toBe("not_met");
    expect(r.trace?.map((s) => [s.id, s.status])).toEqual([
      ["data", "pass"], ["fresh_window", "pass"], ["event_in_window", "pass"], ["filters", "fail"], ["creation_floor", "skipped"],
    ]);
  });

  it("a strength floor is the evaluator's, not a copy (49.6 rounds in the note, not in the filter)", async () => {
    const cond: SuiteAlertCondition = { type: "suite_event", suite: "structure", event: "fvg_retest", minStrength: 50 };
    const events = [ev("fvg_retest", 9, { strength: 49.6 })];
    const { r } = await run({ symbol: "AAPL", condition: cond }, events);
    expect(r.verdict).toBe(evalSuiteEvent(cond, events, barsT, floorT).fired ? "would_trigger" : "not_met");
    expect(r.verdict).toBe("not_met");
    expect(r.trace?.find((s) => s.id === "filters")?.status).toBe("fail");
    expect(r.recent).toEqual([{ event: "fvg_retest", dir: "bull", strength: 50, anchorDate: "2026-03-11", confirmedDate: "2026-03-11" }]);
  });

  it("nothing in the fresh window → event_in_window fails; old events still listed (anchor vs confirmation)", async () => {
    const { r } = await run({ symbol: "AAPL", condition: bos }, [ev("bos", 2, { confirmedAt: 5 }), ev("bos", 1)]);
    expect(r.verdict).toBe("not_met");
    expect(r.trace?.find((s) => s.id === "event_in_window")).toEqual({ id: "event_in_window", status: "fail" });
    expect(r.recent).toEqual([
      { event: "bos", dir: "bull", anchorDate: "2026-03-04", confirmedDate: "2026-03-07" },
      { event: "bos", dir: "bull", anchorDate: "2026-03-03", confirmedDate: "2026-03-03" },
    ]);
  });

  it("a delayed confirmation counts on its CONFIRMATION bar (event clock vs availability clock)", async () => {
    const events = [ev("bos", 4, { confirmedAt: 9 })];
    const { r } = await run({ symbol: "AAPL", condition: bos }, events);
    expect(r.verdict).toBe("would_trigger");
    expect(r.decision?.note).toBe(evalSuiteEvent(bos, events, barsT, floorT).note);
    expect(r.recent?.[0]).toMatchObject({ anchorDate: "2026-03-06", confirmedDate: "2026-03-11" });
  });

  it("recent events are bounded to 5, newest confirmation first", async () => {
    const { r } = await run({ symbol: "AAPL", condition: bos }, Array.from({ length: 9 }, (_, i) => ev("bos", i)));
    expect(r.recent).toHaveLength(5);
    expect(r.recent?.map((e) => e.confirmedDate)).toEqual(["2026-03-10", "2026-03-09", "2026-03-08", "2026-03-07", "2026-03-06"]);
  });
});

describe("stateful sequences: exact initial state only; prior events are never invented (AC-E17-05)", () => {
  const floorT = suiteAlertFloorT(new Date(NOW).toISOString());

  it("step A today → SIMULATED arming, labelled as such; prior history marked unsupported", async () => {
    const events = [ev("bos", 9)];
    const { r } = await run({ symbol: "AAPL", condition: seq }, events);
    const canon = evalSuiteSequence(seq, events, barsT, floorT);
    expect(canon.fired).toBe(false);
    expect(canon.state).toMatchObject({ stepIdx: 1, armedT: barsT[9] });
    expect(r.verdict).toBe("not_met");
    expect(r.sequenceState).toEqual({ input: "initial", output: "simulated_armed", armedDate: "2026-03-11" });
    expect(r.condition).toMatchObject({ type: "suite_sequence", key: "structure:bos>choch", maxBarsBetween: 10, tier: "essential" });
    expect(r.trace?.map((s) => [s.id, s.status])).toEqual([
      ["data", "pass"], ["fresh_window", "pass"], ["initial_state", "pass"], ["sequence_replay", "fail"], ["prior_history", "unsupported"],
    ]);
  });

  it("A yesterday + B today: history WOULD complete it, but the dry run does not replay it", async () => {
    const events = [ev("bos", 8), ev("choch", 9)];
    // The falsifier this guards: replaying pre-creation history fabricates a completion.
    expect(evalSuiteSequence(seq, events, barsT, Number.NEGATIVE_INFINITY).fired).toBe(true);
    const { r } = await run({ symbol: "AAPL", condition: seq }, events);
    expect(r.verdict).toBe("not_met");
    expect(r.sequenceState).toEqual({ input: "initial", output: "idle" });
    expect(r.decision?.fired).toBe(false);
    expect(r.recent?.map((e) => e.event)).toEqual(["choch", "bos"]);
  });

  it("a supplied armed state is refused, never evaluated as if recorded", async () => {
    const { r, calls } = await run({ symbol: "AAPL", condition: { ...seq, _sq: { stepIdx: 1, armedT: barsT[8] } } }, [ev("choch", 9)]);
    expect(r).toMatchObject({ verdict: "unsupported", reason: "supplied_state" });
    expect(calls.read).toBe(0);
    expect(calls.plan).toEqual([]);
  });
});

describe("explainDryRun is deterministic and side-effect free", () => {
  it("same inputs → identical result; inputs are not mutated", () => {
    const events = [ev("bos", 9), ev("choch", 8)];
    const snapshot = JSON.stringify({ events, seq, barsT });
    const input = { symbol: "AAPL", kind: "sequence" as const, condition: seq, data: DATA, events, nowMs: NOW, sourceAsOfMs: AS_OF };
    const a = explainDryRun(input);
    const b = explainDryRun(input);
    expect(a).toEqual(b);
    expect(JSON.stringify({ events, seq, barsT })).toBe(snapshot);
  });
});

describe("client reading of the wire (readDryRunResult)", () => {
  const good = (verdict: DryRunResult["verdict"], extra: Partial<DryRunResult> = {}) => ({ ...dryRunResult(verdict), ...extra });

  it("accepts well-formed results", () => {
    expect(readDryRunResult(good("cannot_evaluate", { reason: "stale_data" }))).not.toBeNull();
    expect(readDryRunResult(good("unsupported", { reason: "supplied_state" }))).not.toBeNull();
    const evaluated = good("not_met", { clocks: {} as never, condition: {} as never, decision: { fired: false } });
    expect(readDryRunResult(evaluated)).not.toBeNull();
  });

  it("anything else is unavailable (null), never a quiet not_met", () => {
    const bad: unknown[] = [
      null,
      "<html>502 Bad Gateway</html>",
      { error: "dry_run_unavailable" },
      { ...dryRunResult("not_met"), schema: "alert-dry-run/0" },
      { ...dryRunResult("not_met"), readOnly: false },
      { schema: ALERT_DRY_RUN_SCHEMA, verdict: "not_met" },
      { ...dryRunResult("cannot_evaluate"), verdict: "maybe" },
      // An evaluated verdict without its clocks / identity / decision cannot be trusted.
      dryRunResult("not_met"),
      { ...dryRunResult("would_trigger"), clocks: {}, condition: {} },
    ];
    for (const b of bad) expect(readDryRunResult(b)).toBeNull();
  });

  it("readOnly is a constant of every result the core can produce", () => {
    const spy = vi.fn();
    for (const v of ["would_trigger", "not_met", "cannot_evaluate", "unsupported"] as const) {
      const r = dryRunResult(v, { readOnly: false as never, schema: "x" as never });
      spy(r);
      expect(r.readOnly).toBe(true);
      expect(r.schema).toBe(ALERT_DRY_RUN_SCHEMA);
    }
    expect(spy).toHaveBeenCalledTimes(4);
  });
});

describe("trace copy derives its numbers and dates (no hard-coded window, no ambiguous 'today')", () => {
  it("the fresh-window step interpolates the evaluator constant in both languages", () => {
    expect(SUITE_EVENT_FRESH_BARS).toBeGreaterThan(0);
    for (const s of ALERT_DRY_RUN_LEX["drStep.fresh_window"]) {
      expect(s).toContain("{n}");
      expect(s).not.toMatch(/\d/); // the bar count comes only from SUITE_EVENT_FRESH_BARS
    }
  });

  it("every floor-bearing step names the UTC creation day", () => {
    for (const k of ["drStep.creation_floor", "drStep.sequence_replay", "drStep.prior_history"]) {
      for (const s of ALERT_DRY_RUN_LEX[k]) {
        expect(s).toContain("{date}");
        expect(s).toContain("UTC");
      }
    }
  });

  it("no dry-run string says 'today' (the floor is a UTC calendar day, not the viewer's local day)", () => {
    for (const [en, zh] of Object.values(ALERT_DRY_RUN_LEX)) {
      expect(en).not.toMatch(/\btoday\b/i);
      expect(zh).not.toMatch(/今天|今日/);
    }
  });
});
