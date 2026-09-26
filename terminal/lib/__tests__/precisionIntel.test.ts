import { describe, expect, it } from "vitest";
import { readPrecisionIntel } from "../precisionIntel";

describe("readPrecisionIntel", () => {
  it("adapts the existing intel/v1 entry, confluence, and sniper blocks without recomputing them", () => {
    const read = readPrecisionIntel({
      schema: "intel/v1",
      ticker: "AAPL",
      asof: "2026-09-23",
      analysis: {
        entry: {
          headline: "Awaiting confluence",
          headline_zh: "等待共振",
          action: "Wait for the 2D × 3D trigger.",
          action_zh: "等待 2D × 3D 触发。",
          grade: "solid",
          confidence: 72.4,
          next_trigger: "2D MACD cross with 3D confirmation",
          buy_zone: [181.2, 185.4],
          chase_above: 189.0,
          stop: 176.8,
          spot: 184.0,
          opens_lo: 2,
          opens_hi: 4,
        },
        confluence: {
          tier: "T3",
          sub: "projected",
          ticks: 1,
          bars_to_cross: 1.4,
          provisional: true,
          not_topped: false,
          htf_s1: true,
          asof: "2026-09-23",
        },
        sniper: {
          w2_washout: true,
          w2_stoch_d: 22.4,
          days_since_63d_low: 5,
          coiled: true,
          asof: "2026-09-23",
        },
      },
    });

    expect(read).toEqual({
      asof: "2026-09-23",
      entry: {
        headline: "Awaiting confluence",
        headlineZh: "等待共振",
        action: "Wait for the 2D × 3D trigger.",
        actionZh: "等待 2D × 3D 触发。",
        grade: "solid",
        bottomConfidence: 72.4,
        nextTrigger: "2D MACD cross with 3D confirmation",
        buyZone: [181.2, 185.4],
        chaseAbove: 189.0,
        stop: 176.8,
        spot: 184.0,
        opensLo: 2,
        opensHi: 4,
      },
      confluence: {
        tier: "T3",
        sub: "projected",
        ticks: 1,
        barsToCross: 1.4,
        provisional: true,
        notTopped: false,
        htfS1: true,
        asof: "2026-09-23",
      },
      sniper: {
        w2Washout: true,
        w2StochD: 22.4,
        daysSince63dLow: 5,
        coiled: true,
        asof: "2026-09-23",
      },
    });
  });

  it("preserves explicit false booleans instead of turning them into absence", () => {
    const read = readPrecisionIntel({
      analysis: {
        confluence: { provisional: false, not_topped: false, htf_s1: false },
        sniper: { w2_washout: false, coiled: false },
      },
    });

    expect(read?.confluence).toMatchObject({
      provisional: false,
      notTopped: false,
      htfS1: false,
    });
    expect(read?.sniper).toMatchObject({
      w2Washout: false,
      coiled: false,
    });
  });

  it("fails malformed numeric fields closed instead of inventing a display score", () => {
    const read = readPrecisionIntel({
      analysis: {
        entry: {
          headline: "Setup exists",
          confidence: 140,
          buy_zone: [190, 180],
          chase_above: "195",
        },
      },
    });

    expect(read?.entry?.headline).toBe("Setup exists");
    expect(read?.entry?.bottomConfidence).toBeNull();
    expect(read?.entry?.buyZone).toBeNull();
    expect(read?.entry?.chaseAbove).toBeNull();
  });

  it("returns null when no Precision intelligence block is present", () => {
    expect(readPrecisionIntel(null)).toBeNull();
    expect(readPrecisionIntel({ schema: "intel/v1", analysis: { factors: { z: 1.2 } } })).toBeNull();
    expect(readPrecisionIntel({ cards: { conviction: { score: 80 } } })).toBeNull();
  });
});
