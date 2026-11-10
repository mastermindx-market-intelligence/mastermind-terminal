import { describe, expect, it } from "vitest";
import { FORECAST_HEAD_KEYS, forecastHeadsReading } from "../sectorCycleForecastHeads";

/* v1.1 per-head forecast capabilities, bound to lane 8's published wire
 * `sector_cycles.forecast_heads.v1` (macro engine/sector_heads.py @3e6b51ef09fc).
 * All fixtures here are labelled FIXTURE — they mirror the wire shape, they
 * are not producer output. */

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

/** The lane-8 wire shape exactly as published today (all heads withheld). */
const wireBlock = (heads: Record<string, unknown> = {}) => ({
  schema: "sector_cycles.forecast_heads.v1",
  observed_cycles: "shown",
  protocol: PROTOCOL,
  report_ref: REPORT,
  heads: {
    remaining_return_distribution: mkHead({
      reason_code: "research_withheld_failed",
      research_disposition: "WITHHELD_FAILED",
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
  it("reads the published wire: four heads, canonical order, evidence pointers, 20 sessions", () => {
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

  it("a record without a block reads absent; nothing is inferred", () => {
    expect(forecastHeadsReading({}).state).toBe("absent");
    expect(forecastHeadsReading(null).state).toBe("absent");
    expect(forecastHeadsReading({ forecast_heads: {} }).state).toBe("absent");
  });

  it("a foreign schema, hidden observed cycles, a missing head or an authority claim refuses the block", () => {
    expect(
      forecastHeadsReading({ forecast_heads: { ...wireBlock(), schema: "other.v9" } }).state,
    ).toBe("invalid");
    expect(
      forecastHeadsReading({
        forecast_heads: { ...wireBlock(), observed_cycles: "hidden" },
      }).state,
    ).toBe("invalid");
    expect(
      forecastHeadsReading({
        forecast_heads: { ...wireBlock(), may_trade: true },
      }).state,
    ).toBe("invalid");
    expect(
      forecastHeadsReading({
        forecast_heads: { ...wireBlock(), heads: { ...wireBlock().heads, transition_time: undefined } },
      }).state,
    ).toBe("invalid");
  });

  it("withdrawal is a first-class state WITH its date — never a stale pass", () => {
    const r = forecastHeadsReading({
      forecast_heads: wireBlock({
        adverse_tail: mkHead({
          status: "withdrawn",
          reason_code: "research_withheld_failed",
          withdrawn_asof: "2026-11-04",
        }),
      }),
    });
    expect(r.state).toBe("ready");
    const at = r.heads.find((h) => h.key === "adverse_tail")!;
    expect(at.status).toBe("withdrawn");
    expect(at.withdrawnAsOf).toBe("2026-11-04");
    // Siblings untouched.
    expect(r.heads.filter((h) => h.key !== "adverse_tail").every((h) => h.status === "withheld")).toBe(true);
  });

  it("withdrawal is never downgraded to withholding; a stray date on a live head is refused", () => {
    // The wire has not published the withdrawal date field yet: the state is
    // still withdrawal (first-class), dated when the wire carries one.
    const noDate = forecastHeadsReading({
      forecast_heads: wireBlock({ adverse_tail: mkHead({ status: "withdrawn" }) }),
    });
    expect(noDate.state).toBe("ready");
    const noDateHead = noDate.heads.find((h) => h.key === "adverse_tail")!;
    expect(noDateHead.status).toBe("withdrawn");
    expect(noDateHead.withdrawnAsOf).toBeNull();

    const strayDate = forecastHeadsReading({
      forecast_heads: wireBlock({ adverse_tail: mkHead({ withdrawn_asof: "2026-11-04" }) }),
    });
    expect(
      strayDate.heads.find((h) => h.key === "adverse_tail")!.reasonCode,
    ).toBe("payload_invalid");
    expect(strayDate.state).toBe("ready");
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
  });

  it("all five published reason codes pass through verbatim for the lexicon", () => {
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
