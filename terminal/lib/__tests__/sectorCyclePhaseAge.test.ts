import { describe, expect, it } from "vitest";
import { phaseAge } from "../sectorCyclePhaseAge";

describe("phase age: measured, lower bound, unavailable", () => {
  it("measures actual sessions and requires cross-field agreement", () => {
    expect(
      phaseAge({
        phase_v2_age: { status: "measured", sessions: 34 },
        phase_v2_age_status: "measured",
        phase_v2_age_sessions: 34,
        freq: "D",
      }),
    ).toEqual({ value: 34, status: "measured", observedFrom: null, reason: null });
    // No denormalized fields at all: the structured block stands alone.
    expect(phaseAge({ phase_v2_age: { status: "measured", sessions: 7 } })).toEqual(
      { value: 7, status: "measured", observedFrom: null, reason: null },
    );
  });
  it("a lower bound states its own history start and never masquerades as measured", () => {
    expect(
      phaseAge({
        phase_v2_age: {
          status: "lower_bound",
          sessions: 112,
          observed_from: "2026-06-02",
        },
        phase_v2_age_status: "lower_bound",
        phase_v2_age_sessions: 112,
      }),
    ).toEqual({
      value: 112,
      status: "lower_bound",
      observedFrom: "2026-06-02",
      reason: null,
    });
    // A lower bound without its observed-from date cannot be stated honestly.
    expect(
      phaseAge({
        phase_v2_age: { status: "lower_bound", sessions: 112 },
        phase_v2_age_status: "lower_bound",
        phase_v2_age_sessions: 112,
      }).status,
    ).toBe("unavailable");
  });
  it("insufficient history is unavailable with its reason, distinct from not-logged", () => {
    expect(
      phaseAge({
        phase_v2_age: { status: "insufficient_history", sessions: 3 },
        phase_v2_age_status: "insufficient_history",
        phase_v2_age_sessions: 3,
      }),
    ).toMatchObject({ status: "unavailable", reason: "insufficient_history" });
    expect(phaseAge({ freq: "D" })).toMatchObject({
      status: "unavailable",
      reason: "not_logged",
    });
  });
  it("unknown phase is a separate unavailable state", () => {
    expect(phaseAge({ phase_v2_age: { status: "measured", sessions: 5 } }, false)).toMatchObject(
      { status: "unavailable", reason: "unknown_phase" },
    );
  });
  it("corrupt or disagreeing records are refused, not shrunk", () => {
    // Cross-field disagreement between block and denormalized fields.
    expect(
      phaseAge({
        phase_v2_age: { status: "measured", sessions: 34 },
        phase_v2_age_status: "lower_bound",
        phase_v2_age_sessions: 34,
      }),
    ).toMatchObject({ status: "unavailable", reason: "cross_field_mismatch" });
    expect(
      phaseAge({
        phase_v2_age: { status: "measured", sessions: 34 },
        phase_v2_age_status: "measured",
        phase_v2_age_sessions: 40,
      }),
    ).toMatchObject({ status: "unavailable", reason: "cross_field_mismatch" });
    // Zero, fractional and negative counts are not ages.
    for (const sessions of [0, -3, 4.5])
      expect(
        phaseAge({ phase_v2_age: { status: "measured", sessions } }).value,
      ).toBeNull();
    // Unknown status strings stay unavailable, never guessed.
    expect(
      phaseAge({ phase_v2_age: { status: "maybe", sessions: 4 } }).status,
    ).toBe("unavailable");
  });
  it("only a daily forward log qualifies: weekly restamps do not add sessions", () => {
    expect(
      phaseAge({
        phase_v2_age: { status: "measured", sessions: 34 },
        freq: "W",
      }),
    ).toMatchObject({ status: "unavailable", reason: "freq_mismatch" });
    expect(
      phaseAge({ phase_v2_age: { status: "measured", sessions: 34 }, freq: null }),
    ).toMatchObject({ status: "measured" });
  });
});
