import { describe, expect, it } from "vitest";
import { computeFlowScore, type ScorerInput } from "@/lib/flowScore";

const BASE: ScorerInput = {
  premium: 1_200_000,
  premium_z: 2,
  vol_gt_oi: true,
  repeated: false,
  n_prints: 1,
  side: "~buy",
  signing_source: "tape",
  zerodte: false,
  dte: 10,
  dte_bucket: "8_30d",
  mny_bucket: "atm",
};

function score(bucket: unknown) {
  return computeFlowScore({ ...BASE, mny_bucket: bucket } as ScorerInput);
}

function moneyness(result: ReturnType<typeof computeFlowScore>) {
  return result.components.find((component) => component.key === "moneynessProximity")?.value;
}

function otherComponents(result: ReturnType<typeof computeFlowScore>) {
  return result.components.filter((component) => component.key !== "moneynessProximity");
}

describe("flow score moneyness parity", () => {
  it.each(["unknown", null, undefined, "", "way_itm", "UNKNOWN", "__proto__", "constructor", 7, {}])(
    "uses the canonical missing-data factor for %j without poisoning the score",
    (bucket) => {
      const result = score(bucket);
      const baseline = score("atm");
      expect(moneyness(result)).toBe(6);
      expect(Number.isFinite(result.score)).toBe(true);
      expect(result.components.every((component) => Number.isFinite(component.value))).toBe(true);
      expect(result.score).toBe(baseline.score - 4);
      expect(otherComponents(result)).toEqual(otherComponents(baseline));
    },
  );

  // Weighted contributions from the existing Python engine/flow_enrich.py law.
  it.each([["atm", 10], ["near_otm", 8.5], ["itm", 5], ["far_otm", 3]] as const)(
    "preserves the measured %s contribution",
    (bucket, expected) => {
      const result = score(bucket);
      expect(moneyness(result)).toBe(expected);
      expect(Number.isFinite(result.score)).toBe(true);
      expect(otherComponents(result)).toEqual(otherComponents(score("atm")));
    },
  );
});
