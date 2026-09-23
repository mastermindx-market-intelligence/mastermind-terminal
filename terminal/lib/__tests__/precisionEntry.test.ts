import { describe, expect, it } from "vitest";
import {
  PRECISION_PRESETS,
  buildPrecisionPlan,
  inferPrecisionHorizon,
} from "../precisionEntry";
import { TF_CANONICAL_ORDER } from "../startTf";

const ALL = new Set(TF_CANONICAL_ORDER);

describe("precision entry timeframe selection", () => {
  it("keeps the four horizon defaults explicit and ordered by role", () => {
    expect(PRECISION_PRESETS).toEqual({
      day: ["5m", "15m", "1h", "4h"],
      swing: ["4h", "2D", "3D", "2W"],
      position: ["D", "3D", "W", "2W"],
      deep: ["3D", "W", "2W", "1M"],
    });

    const plan = buildPrecisionPlan({ horizon: "swing", functional: ALL });
    expect(plan.status).toBe("ready");
    expect(plan.source).toBe("horizon_default");
    expect(plan.panes.map((p) => [p.role, p.tf])).toEqual([
      ["execution", "4h"],
      ["trigger", "2D"],
      ["durability", "3D"],
      ["structure", "2W"],
    ]);
    expect(plan.split).toBe(4);
    expect(plan.sync).toBe(false);
    expect(plan.replay).toBe(false);
  });

  it("infers only a user-horizon default from the current chart timeframe", () => {
    expect(inferPrecisionHorizon("15m")).toBe("day");
    expect(inferPrecisionHorizon("4h")).toBe("swing");
    expect(inferPrecisionHorizon("D")).toBe("swing");
    expect(inferPrecisionHorizon("3D")).toBe("position");
    expect(inferPrecisionHorizon("2W")).toBe("deep");
    expect(inferPrecisionHorizon("garbage")).toBe("swing");
  });

  it("substitutes unavailable default intervals without stealing later exact panes", () => {
    const functional = new Set(["1h", "2h", "4h", "D", "3D", "W", "2W", "1M"]);
    const plan = buildPrecisionPlan({ horizon: "swing", functional });

    expect(plan.status).toBe("ready");
    expect(plan.panes.map((p) => p.tf)).toEqual(["4h", "D", "3D", "2W"]);
    expect(plan.panes[1]).toMatchObject({
      role: "trigger",
      requestedTf: "2D",
      tf: "D",
      substituted: true,
    });
    expect(plan.warnings).toContain("substituted:2D->D");
  });

  it("fails closed when the market cannot supply four distinct usable intervals", () => {
    const plan = buildPrecisionPlan({
      horizon: "day",
      functional: new Set(["D", "W", "1M"]),
    });

    expect(plan.status).toBe("insufficient_timeframes");
    expect(plan.panes).toHaveLength(3);
    expect(new Set(plan.panes.map((p) => p.tf)).size).toBe(plan.panes.length);
    expect(plan.warnings.some((w) => w.startsWith("missing:"))).toBe(true);
  });

  it("accepts only exact subject-bound, serveable Temporal Grain evidence", () => {
    const accepted = buildPrecisionPlan({
      horizon: "swing",
      subjectKey: "security:AAPL",
      functional: ALL,
      evidence: {
        authority: "temporal-grain",
        subjectKey: "security:AAPL",
        state: "accepted",
        timeframes: ["2h", "D", "W", "1M"],
        reason: "validated structural scale band",
      },
    });

    expect(accepted.source).toBe("temporal_grain");
    expect(accepted.adaptiveState).toBe("accepted");
    expect(accepted.panes.map((p) => p.tf)).toEqual(["2h", "D", "W", "1M"]);
    expect(accepted.reason).toBe("validated structural scale band");
  });

  it("rejects accepted evidence for another subject", () => {
    const plan = buildPrecisionPlan({
      horizon: "position",
      subjectKey: "security:MSFT",
      functional: ALL,
      evidence: {
        authority: "temporal-grain",
        subjectKey: "security:AAPL",
        state: "accepted",
        timeframes: ["2h", "D", "W", "1M"],
      },
    });

    expect(plan.source).toBe("horizon_default");
    expect(plan.adaptiveState).toBe("rejected");
    expect(plan.warnings).toContain("temporal_grain_subject_mismatch");
    expect(plan.panes.map((p) => p.tf)).toEqual(["D", "3D", "W", "2W"]);
  });

  it("rejects accepted evidence when its exact chart recipe cannot be served", () => {
    const plan = buildPrecisionPlan({
      horizon: "swing",
      subjectKey: "security:AAPL",
      functional: new Set(["D", "2D", "3D", "W", "2W", "1M"]),
      evidence: {
        authority: "temporal-grain",
        subjectKey: "security:AAPL",
        state: "accepted",
        timeframes: ["2h", "D", "W", "1M"],
      },
    });

    expect(plan.source).toBe("horizon_default");
    expect(plan.adaptiveState).toBe("rejected");
    expect(plan.warnings).toContain("temporal_grain_evidence_rejected");
    expect(plan.panes.map((p) => p.tf)).toEqual(["W", "2D", "3D", "2W"]);
  });

  it("does not turn abstention or unproven evidence into adaptive selection", () => {
    const abstain = buildPrecisionPlan({
      horizon: "deep",
      subjectKey: "security:AAPL",
      functional: ALL,
      evidence: {
        authority: "temporal-grain",
        subjectKey: "security:AAPL",
        state: "abstain",
        reason: "no stable scale",
      },
    });
    expect(abstain.source).toBe("horizon_default");
    expect(abstain.adaptiveState).toBe("abstained");
    expect(abstain.panes.map((p) => p.tf)).toEqual(["3D", "W", "2W", "1M"]);

    const unproven = buildPrecisionPlan({
      horizon: "day",
      subjectKey: "security:AAPL",
      functional: ALL,
      evidence: {
        authority: "temporal-grain",
        subjectKey: "security:AAPL",
        state: "unproven",
      },
    });
    expect(unproven.source).toBe("horizon_default");
    expect(unproven.adaptiveState).toBe("unproven");
  });

  it("rejects malformed accepted evidence rather than silently granting authority", () => {
    const plan = buildPrecisionPlan({
      horizon: "position",
      subjectKey: "security:AAPL",
      functional: ALL,
      evidence: {
        authority: "temporal-grain",
        subjectKey: "security:AAPL",
        state: "accepted",
        timeframes: ["4h", "4h", "D", "W"],
      },
    });

    expect(plan.source).toBe("horizon_default");
    expect(plan.adaptiveState).toBe("rejected");
    expect(plan.warnings).toContain("temporal_grain_evidence_rejected");
    expect(plan.panes.map((p) => p.tf)).toEqual(["D", "3D", "W", "2W"]);
  });
});
