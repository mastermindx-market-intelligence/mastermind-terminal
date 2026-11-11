import { describe, expect, it } from "vitest";
import {
  HAZARD_HORIZONS,
  cellState,
  clockDisagreements,
  hazardPass,
  legFamily,
  openLegSessions,
  parityQualification,
  STATE_DISPLAY,
  type EstimateKinds,
} from "../sectorCycleHazard";

const passingKinds: EstimateKinds = {
  hazard: { "1m": "qualified_model_cell", "3m": "qualified_model_cell", "6m": "qualified_model_cell" },
  model_cell_current_claim: "parity_holds",
  live_feature_parity: { verdict: "PARITY_HOLDS" },
};
const cell = (over: Record<string, unknown> = {}) => ({
  p: 0.42,
  source: "MODEL",
  cell_verdict: "PASS",
  ...over,
});

describe("hazard cell qualification (MODEL vs PRIOR vs gap)", () => {
  it("a MODEL cell needs source, verdict, estimate-kind and current-claim parity, exactly", () => {
    for (const key of HAZARD_HORIZONS) {
      expect(hazardPass(cell(), passingKinds, key)).toBe(true);
      expect(
        hazardPass(cell({ source: "PRIOR" }), passingKinds, key),
      ).toBe(false);
      expect(hazardPass(cell({ cell_verdict: "FAIL" }), passingKinds, key)).toBe(false);
      expect(
        hazardPass(cell(), { ...passingKinds, hazard: { "1m": "x" } }, key),
      ).toBe(false);
      expect(
        hazardPass(cell(), { ...passingKinds, model_cell_current_claim: "parity_failed" }, key),
      ).toBe(false);
    }
  });
  it("cellState: pass, muted MODEL, prior, and gap — never zero", () => {
    const h = { "1m": cell(), "3m": cell({ source: "PRIOR", cell_verdict: null }), "6m": null };
    expect(cellState(h, passingKinds, "1m")).toBe("pass");
    expect(
      cellState(
        { "1m": cell() },
        { ...passingKinds, model_cell_current_claim: "parity_failed" },
        "1m",
      ),
    ).toBe("muted");
    expect(cellState(h, passingKinds, "3m")).toBe("prior");
    expect(cellState(h, passingKinds, "6m")).toBe("gap");
    expect(cellState({ unavailable: true }, passingKinds, "1m")).toBe("gap");
    expect(
      cellState(
        { "1m": cell() },
        { ...passingKinds, hazard: { "1m": "missing_estimate" } },
        "1m",
      ),
    ).toBe("gap");
    expect(cellState({}, passingKinds, "1m")).toBe("gap");
  });
});

describe("parity qualification", () => {
  const record = (estimateKinds: unknown) => ({ estimate_kinds: estimateKinds });
  const meta = (verdict: unknown) => ({ live_hazard_parity: { verdict } });
  it("PARITY_FAILS anywhere mutes the current claim; holds needs all three", () => {
    expect(
      parityQualification(
        record({ model_cell_current_claim: "parity_failed" }),
        meta("PARITY_HOLDS"),
      ),
    ).toBe("parity_failed");
    expect(
      parityQualification(
        record({ live_feature_parity: { verdict: "PARITY_FAILS" } }),
        meta("PARITY_HOLDS"),
      ),
    ).toBe("parity_failed");
    expect(parityQualification(record({}), meta("PARITY_FAILS"))).toBe("parity_failed");
    expect(
      parityQualification(
        record({
          model_cell_current_claim: "parity_holds",
          live_feature_parity: { verdict: "PARITY_HOLDS" },
        }),
        meta("PARITY_HOLDS"),
      ),
    ).toBe("parity_holds");
    expect(parityQualification(record({}), meta("PARITY_HOLDS"))).toBe("parity_not_established");
    expect(parityQualification({}, {})).toBe("parity_not_established");
  });
});

describe("leg family and clock disagreement", () => {
  const record = (now: unknown, rhythm?: unknown, proj?: unknown) => ({
    now,
    rhythm,
    proj,
  });
  it("maps each phase to its leg and expected turn", () => {
    expect(legFamily(record({ phase_v2: "Expansion" }))).toMatchObject({
      direction: "up",
      turn: "peak",
      hazardAgrees: null,
      rhythmAgrees: null,
    });
    expect(legFamily(record({ phase_v2: "Downturn" }))).toMatchObject({
      direction: "down",
      turn: "trough",
    });
    expect(legFamily(record({ phase_v2: "Sideways" })).direction).toBeNull();
  });
  it("an inverted hazard curve is withheld whole: disagreement flags it", () => {
    const rec = record(
      {
        phase_v2: "Trough",
        hazard: { direction: "up", turn_kind: "peak", epoch: "e1" },
      },
      { next_turn: "trough" },
    );
    const leg = legFamily(rec);
    expect(leg.hazardAgrees).toBe(false);
    expect(leg.rhythmAgrees).toBe(true);
    expect(clockDisagreements(rec)).toEqual(["hazard"]);
  });
  it("rhythm disagreement and legacy-read divergence are separate clocks", () => {
    expect(
      clockDisagreements(
        record({ phase_v2: "Recovery", phase: "Peak" }, { next_turn: "trough" }),
      ),
    ).toEqual(["rhythm", "read"]);
  });
  it("the ladder clock disagrees only through a known ladder state", () => {
    expect(
      clockDisagreements(
        record({
          phase_v2: "Expansion",
          divergence: true,
          clocks: { phase: "x", ladder: "ROLLING OVER", agree: false },
        }),
      ),
    ).toEqual(["ladder"]);
    expect(
      clockDisagreements(
        record({
          phase_v2: "Expansion",
          divergence: true,
          clocks: { phase: "x", ladder: "NOT A STATE", agree: false },
        }),
      ),
    ).toEqual([]);
    expect(STATE_DISPLAY["ROLLING OVER"]).toEqual(["TOPPING", "做顶中"]);
  });
});

describe("open-leg session count over a reconstructed series", () => {
  const points = [
    { date: "2026-09-01" },
    { date: "2026-09-02" },
    { date: "2026-09-03" },
    { date: "2026-09-04" },
    { date: "2026-09-07" },
  ];
  it("counts sessions strictly after the pivot, weekend restamps included as one session", () => {
    expect(openLegSessions(points, "2026-09-02")).toBe(3);
    expect(openLegSessions(points, "2026-09-07")).toBe(0);
    expect(openLegSessions(points, null)).toBeNull();
    expect(openLegSessions([], "2026-09-02")).toBeNull();
  });
});
