import { describe, expect, it } from "vitest";
import { IND_DEFS, defaultVis, withDefaults } from "../indicators";
import { settingsFromParams } from "../largeTrades/engine";

describe("large-trades settings integration", () => {
  it("declares the same numeric limits the engine applies", () => {
    for (const field of IND_DEFS.largeTrades.fields.filter((f) => f.type === "number")) {
      const low = settingsFromParams({ [field.key]: -Number.MAX_VALUE });
      const high = settingsFromParams({ [field.key]: Number.MAX_VALUE });
      expect(field.min, field.key + " minimum").toBe(low[field.key as keyof typeof low]);
      expect(field.max, field.key + " maximum").toBe(high[field.key as keyof typeof high]);
      expect(field.step! % 1, field.key + " integer step").toBe(0);
    }
    expect(IND_DEFS.largeTrades.defaults.maxMarkers).toBe(250);
  });

  it("normalizes saved criteria while preserving registry metadata and the caller's object", () => {
    const visibility = defaultVis();
    const saved = { maxGapMs: 60000, percentile: 99.99, responseWindowMs: 1,
      maxMarkers: 9999, minQuantity: 1000.4, _vis: visibility, extraPreference: "keep" };
    const effective = withDefaults("largeTrades", saved);
    expect(effective).toMatchObject({ maxGapMs: 10000, percentile: 100,
      responseWindowMs: 1000, maxMarkers: 1000, minQuantity: 1000,
      _vis: visibility, extraPreference: "keep" });
    expect(saved).toMatchObject({ maxGapMs: 60000, percentile: 99.99,
      responseWindowMs: 1, maxMarkers: 9999, minQuantity: 1000.4 });
    expect(settingsFromParams(effective)).toEqual(settingsFromParams(saved));
  });

  it("backfills invalid stored types from the same engine defaults", () => {
    const saved = { adaptive: "yes", percentile: null, maxMarkers: NaN, aggregate: 0 };
    const effective = withDefaults("largeTrades", saved);
    expect(settingsFromParams(effective)).toEqual(settingsFromParams(saved));
    expect(effective).toMatchObject({ adaptive: false, percentile: 95, maxMarkers: 250, aggregate: true });
  });

  it("retains existing parameter behavior for unrelated studies", () => {
    expect(withDefaults("ema", { ma1Len: 10000.5 }).ma1Len).toBe(10000.5);
    expect(withDefaults("pine", { customLength: 0.25 }).customLength).toBe(0.25);
  });
});
