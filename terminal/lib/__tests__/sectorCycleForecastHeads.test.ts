import { describe, expect, it } from "vitest";
import { FORECAST_HEAD_KEYS, forecastHeadsReading } from "../sectorCycleForecastHeads";

/* v1.1 per-head forecast capabilities, bound to the producer
 * (engine/sector_heads.py @d70025383c2d): head_capabilities() and withdraw()
 * both emit status "withheld" with a reason code from the eight-code
 * precedence ladder; no withdrawn/qualified status and no withdrawn_asof
 * field exist on the wire. All fixtures here are labelled FIXTURE — they
 * mirror the producer's shapes, they are not producer output. */

const PROTOCOL = "research/sector_completion_20261021/B12_V11_HEADS_PROTOCOL.md";
const REPORT = "research/sector_completion_20261021/b12/v11_heads_result.json";
const RESULTS = "research/sector_completion_20261021/B12_V11_HEADS_RESULTS.md";

const mkHead = (over: Record<string, unknown> = {}) => ({
  status: "withheld",
  reason_code: "live_state_not_protocol_epoch",
  research_disposition: "QUALIFIED_RESEARCH",
  research_reasons: [],
  evidence: { protocol: PROTOCOL, report_ref: REPORT, results_doc: RESULTS },
  target: "what this head measures",
  horizon_sessions: 20,
  market: "US",
  ...over,
});

/** The producer's output exactly (head_capabilities, record_kind="sector"). */
const wireBlock = (heads: Record<string, unknown> = {}) => ({
  schema: "sector_cycles.forecast_heads.v1",
  observed_cycles: "shown",
  protocol: PROTOCOL,
  report_ref: REPORT,
  heads: {
    remaining_return_distribution: mkHead({
      reason_code: "research_withheld_failed",
      research_disposition: "WITHHELD_FAILED",
      research_reasons: ["skill_ci90_includes_or_below_zero", "fails_bh_fdr_q0.10"],
    }),
    adverse_tail: mkHead(),
    target_before_invalidation: mkHead(),
    transition_time: mkHead(),
    ...heads,
  },
  may_rank: false,
  may_gate: false,
  may_size: false,
  may_trade: false,
  may_escalate: false,
});

describe("forecast heads reader (FIXTURE wire: sector_cycles.forecast_heads.v1)", () => {
  it("reads the producer's output: four heads, canonical order, evidence pointers, 20 sessions", () => {
    const r = forecastHeadsReading({ forecast_heads: wireBlock() });
    expect(r.state).toBe("ready");
    expect(r.observedCycles).toBe("shown");
    expect(r.heads.map((h) => h.key)).toEqual([...FORECAST_HEAD_KEYS]);
    expect(r.heads[0]).toMatchObject({
      status: "withheld",
      reasonCode: "research_withheld_failed",
      horizonSessions: 20,
      market: "US",
    });
    expect(r.heads[1].evidence).toEqual({
      protocol: PROTOCOL,
      reportRef: REPORT,
      resultsDoc: RESULTS,
    });
  });

  it("S1: the producer's withdraw() output reads verbatim — still withheld, its own reason code", () => {
    // withdraw(block, "adverse_tail", "parity_lost") writes status "withheld"
    // with the caller's reason; an unmapped code is carried verbatim.
    const r = forecastHeadsReading({
      forecast_heads: wireBlock({
        adverse_tail: mkHead({ reason_code: "parity_lost" }),
      }),
    });
    expect(r.state).toBe("ready");
    const at = r.heads.find((h) => h.key === "adverse_tail")!;
    expect(at.status).toBe("withheld");
    expect(at.reasonCode).toBe("parity_lost");
    // Siblings untouched — SP10 holds on the real shape.
    expect(r.heads.filter((h) => h.key !== "adverse_tail").every((h) => h.status === "withheld")).toBe(true);
  });

  it("only a truly missing block reads absent; a malformed attached block reads invalid (N1)", () => {
    expect(forecastHeadsReading({}).state).toBe("absent");
    expect(forecastHeadsReading(null).state).toBe("absent");
    expect(forecastHeadsReading(undefined).state).toBe("absent");
    // Attached but malformed — not absent: something WAS attached.
    expect(forecastHeadsReading({ forecast_heads: "garbage" }).state).toBe("invalid");
    expect(forecastHeadsReading({ forecast_heads: [1] }).state).toBe("invalid");
    expect(forecastHeadsReading({ forecast_heads: {} }).state).toBe("invalid");
    expect(forecastHeadsReading({ forecast_heads: 5 }).state).toBe("invalid");
  });

  it("a foreign schema or hidden observed cycles refuses the block", () => {
    expect(
      forecastHeadsReading({ forecast_heads: { ...wireBlock(), schema: "other.v9" } }).state,
    ).toBe("invalid");
    expect(
      forecastHeadsReading({
        forecast_heads: { ...wireBlock(), observed_cycles: "hidden" },
      }).state,
    ).toBe("invalid");
  });

  it("NEW-1: a block-level key outside the contract refuses the whole block", () => {
    // The producer emits exactly ten block-level fields. An extra key — an
    // authority claim the producer never made, or an estimate number — is a
    // contract violation: nothing outside the published fields is read.
    for (const extra of [{ may_publish: true }, { may_alert: 1 }, { p_one_sided: 0.018 }]) {
      const r = forecastHeadsReading({ forecast_heads: { ...wireBlock(), ...extra } });
      expect(r.state, JSON.stringify(extra)).toBe("invalid");
      expect(r.heads, JSON.stringify(extra)).toEqual([]);
    }
  });

  it("S4: every authority flag must be present and exactly false", () => {
    for (const bad of [
      { may_trade: "true" },
      { may_trade: 1 },
      { may_trade: undefined },
      { may_trade: null },
      { authority: { may_trade: true } },
    ]) {
      expect(
        forecastHeadsReading({ forecast_heads: { ...wireBlock(), ...bad } }).state,
        JSON.stringify(bad),
      ).toBe("invalid");
    }
    // A removed flag (spread of undefined) also refuses the block.
    const missingRank = wireBlock();
    delete (missingRank as Record<string, unknown>).may_rank;
    expect(forecastHeadsReading({ forecast_heads: missingRank }).state).toBe("invalid");
  });

  it("S3: a missing, null or malformed head degrades ONLY that head; siblings stay", () => {
    for (const value of [null, undefined, {}, "x", 5]) {
      const block = wireBlock() as { heads: Record<string, unknown> };
      if (value === undefined) delete block.heads.adverse_tail;
      else block.heads.adverse_tail = value;
      const r = forecastHeadsReading({ forecast_heads: block });
      expect(r.state, JSON.stringify(value)).toBe("ready");
      const at = r.heads.find((h) => h.key === "adverse_tail")!;
      expect(at.status).toBe("withheld");
      expect(at.reasonCode).toBe("payload_invalid");
      expect(at.target).toBeNull();
      for (const other of r.heads.filter((h) => h.key !== "adverse_tail")) {
        expect(other.status).toBe("withheld");
        expect(other.reasonCode).toBe(
          other.key === "remaining_return_distribution"
            ? "research_withheld_failed"
            : "live_state_not_protocol_epoch",
        );
      }
    }
  });

  it("S1/N4: statuses the producer cannot emit degrade that head only", () => {
    for (const status of ["withdrawn", "qualified", "WITHHELD", "pass"]) {
      const r = forecastHeadsReading({
        forecast_heads: wireBlock({
          adverse_tail: mkHead({ status, withdrawn_asof: "2026-11-04" }),
        }),
      });
      expect(r.state, status).toBe("ready");
      const at = r.heads.find((h) => h.key === "adverse_tail")!;
      expect(at.status, status).toBe("withheld");
      expect(at.reasonCode, status).toBe("payload_invalid");
      // Siblings keep their own published reasons.
      expect(
        r.heads.filter((h) => h.key !== "adverse_tail").every((h) => h.reasonCode !== "payload_invalid"),
      ).toBe(true);
    }
  });

  it("N2: horizon_sessions must be a positive integer", () => {
    for (const hz of [-3.5, 0, 2.5, "20", null, undefined]) {
      const r = forecastHeadsReading({
        forecast_heads: wireBlock({ adverse_tail: mkHead({ horizon_sessions: hz }) }),
      });
      const at = r.heads.find((h) => h.key === "adverse_tail")!;
      expect(at.reasonCode, JSON.stringify(hz)).toBe("payload_invalid");
      expect(at.horizonSessions).toBeNull();
    }
  });

  it("NOTE-3 (r3): horizon_sessions must be a safe integer within the 2520-session cap", () => {
    // The producer emits a fixed HORIZON_SESSIONS = 20 and states no maximum
    // (engine/sector_heads.py:32) — the cap is therefore the reviewer's 2520
    // (ten trading years), not a producer-stated bound. Anything beyond a
    // safe integer, non-positive, fractional, stringly or over the cap is a
    // contract violation for that head.
    for (const hz of [1e308, 2 ** 53 + 2, 2521, 0, -1, 20.5, "20", null]) {
      const r = forecastHeadsReading({
        forecast_heads: wireBlock({ adverse_tail: mkHead({ horizon_sessions: hz }) }),
      });
      const at = r.heads.find((h) => h.key === "adverse_tail")!;
      expect(at.reasonCode, String(hz)).toBe("payload_invalid");
      expect(at.horizonSessions, String(hz)).toBeNull();
    }
    // The producer's own value and the cap itself stay valid.
    for (const hz of [20, 2520]) {
      const r = forecastHeadsReading({
        forecast_heads: wireBlock({ adverse_tail: mkHead({ horizon_sessions: hz }) }),
      });
      const at = r.heads.find((h) => h.key === "adverse_tail")!;
      expect(at.reasonCode, String(hz)).not.toBe("payload_invalid");
      expect(at.horizonSessions, String(hz)).toBe(hz);
    }
  });

  it("degrading ONE head touches only that head; siblings keep their own reasons (SP10)", () => {
    const r = forecastHeadsReading({
      forecast_heads: wireBlock({ transition_time: mkHead({ status: "garbage" }) }),
    });
    expect(r.state).toBe("ready");
    const tt = r.heads.find((h) => h.key === "transition_time")!;
    expect(tt.status).toBe("withheld");
    expect(tt.reasonCode).toBe("payload_invalid");
    for (const other of r.heads.filter((h) => h.key !== "transition_time")) {
      expect(other.status).toBe("withheld");
      // Each sibling keeps its OWN published reason — untouched.
      expect(other.reasonCode).toBe(
        other.key === "remaining_return_distribution"
          ? "research_withheld_failed"
          : "live_state_not_protocol_epoch",
      );
      expect(other.target).toBe("what this head measures");
    }
  });

  it("the no-number invariant: an estimate field outside the contract refuses that head", () => {
    const r = forecastHeadsReading({
      forecast_heads: wireBlock({ adverse_tail: mkHead({ p10: -0.031 }) }),
    });
    const at = r.heads.find((h) => h.key === "adverse_tail")!;
    expect(at.reasonCode).toBe("payload_invalid");
    expect(at.target).toBeNull();
    expect(at.horizonSessions).toBeNull();
    expect(at.researchDisposition).toBeNull();
    // A number inside the evidence sub-object is dropped, never rendered.
    const nested = forecastHeadsReading({
      forecast_heads: wireBlock({
        adverse_tail: mkHead({ evidence: { protocol: PROTOCOL, skill: 0.02 } }),
      }),
    });
    expect(nested.state).toBe("ready");
    expect(nested.heads.find((h) => h.key === "adverse_tail")!.evidence.protocol).toBe(PROTOCOL);
  });

  it("all five reason-specific codes pass through verbatim for the lexicon", () => {
    const codes = [
      "research_withheld_failed",
      "live_state_not_protocol_epoch",
      "membership_not_point_in_time",
      "record_kind_not_evaluated",
      "market_not_evaluated",
    ] as const;
    for (const code of codes) {
      const r = forecastHeadsReading({
        forecast_heads: wireBlock({ adverse_tail: mkHead({ reason_code: code }) }),
      });
      expect(r.state).toBe("ready");
      expect(r.heads.find((h) => h.key === "adverse_tail")!.reasonCode).toBe(code);
    }
  });
});
