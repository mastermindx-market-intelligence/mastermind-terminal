import { describe, expect, it } from "vitest";
import {
  PRECISION_PRESETS,
  buildPrecisionPlan,
  detectPrecisionHorizon,
  inferPrecisionHorizon,
  precisionLayoutState,
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
    expect(inferPrecisionHorizon("2D")).toBe("swing");
    expect(inferPrecisionHorizon("3D")).toBe("swing");
    expect(inferPrecisionHorizon("W")).toBe("position");
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

  it("fails closed when the requested temporal regime is not actually available", () => {
    const plan = buildPrecisionPlan({
      horizon: "day",
      functional: new Set(["D", "2D", "3D", "W", "2W", "1M", "3M"]),
    });

    expect(plan.status).toBe("insufficient_timeframes");
    expect(plan.panes.length).toBeLessThan(4);
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
    expect(plan.panes.map((p) => p.tf)).toEqual(["D", "2D", "3D", "2W"]);
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


describe("precision entry layout state", () => {
  it("projects a ready plan onto the incumbent four-pane same-symbol grid", () => {
    const plan = buildPrecisionPlan({ horizon: "swing", functional: ALL });
    expect(precisionLayoutState("AAPL", plan)).toEqual({
      split: 4,
      panes: ["AAPL", "AAPL", "AAPL", "AAPL"],
      paneTfs: ["4h", "2D", "3D", "2W"],
      activePane: 0,
    });
  });

  it("does not project an insufficient plan", () => {
    const plan = buildPrecisionPlan({
      horizon: "day",
      functional: new Set(["D", "2D", "3D", "W", "2W", "1M", "3M"]),
    });
    expect(precisionLayoutState("7203.T", plan)).toBeNull();
  });

  it("detects the active precision horizon without adding new mode state", () => {
    expect(detectPrecisionHorizon({
      subject: "AAPL",
      panes: ["AAPL", "AAPL", "AAPL", "AAPL"],
      paneTfs: ["D", "3D", "W", "2W"],
      functional: ALL,
    })).toBe("position");

    expect(detectPrecisionHorizon({
      subject: "AAPL",
      panes: ["AAPL", "MSFT", "AAPL", "AAPL"],
      paneTfs: ["D", "3D", "W", "2W"],
      functional: ALL,
    })).toBeNull();
  });
});
