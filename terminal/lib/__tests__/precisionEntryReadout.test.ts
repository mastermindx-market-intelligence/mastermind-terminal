import { describe, expect, it } from "vitest";
import { buildPrecisionEntryReadout } from "../precisionEntryReadout";

describe("Precision Entry intel readout", () => {
  it("projects canonical intel/v1 entry, confluence and 2W facts without inventing a score", () => {
    const readout = buildPrecisionEntryReadout({
      schema: "intel/v1",
      asof: "2026-09-23",
      tape: { stale: false },
      analysis: {
        entry: {
          status: "await_confluence",
          urgency: "watch",
          headline: "Wait for confluence",
          headline_zh: "等待共振",
          action: "Wait for the 2D×3D trigger.",
          action_zh: "等待 2D×3D 触发。",
          confidence: 72.4,
          next_trigger: "2D MACD x 3D StochRSI",
          spot: 118.5,
          buy_zone: [116, 120],
          chase_above: 123,
          stop: 111,
        },
        confluence: {
          tier: "T3",
          sub: "projected",
          ticks: 1,
          bars_to_cross: 1.4,
          provisional: true,
          not_topped: true,
          htf_s1: false,
          asof: "2026-09-23",
        },
        sniper: {
          w2_washout: true,
          w2_stoch_d: 22.4,
          days_since_63d_low: 8,
          coiled: true,
          asof: "2026-09-22",
        },
      },
    });

    expect(readout).toEqual({
      availability: "ready",
      freshness: "current",
      asof: {
        intel: "2026-09-23",
        confluence: "2026-09-23",
        sniper: "2026-09-22",
      },
      posture: {
        status: "await_confluence",
        urgency: "watch",
        headline: "Wait for confluence",
        headlineZh: "等待共振",
        action: "Wait for the 2D×3D trigger.",
        actionZh: "等待 2D×3D 触发。",
      },
      bottomConfidence: 72.4,
      trigger: {
        next: "2D MACD x 3D StochRSI",
        tier: "T3",
        sub: "projected",
        ticks: 1,
        barsToCross: 1.4,
        provisional: true,
        notTopped: true,
        htfS1: false,
      },
      structure: {
        w2Washout: true,
        w2StochD: 22.4,
        daysSince63dLow: 8,
        coiled: true,
      },
      geometry: {
        spot: 118.5,
        buyZone: { low: 116, high: 120 },
        chaseAbove: 123,
        stop: 111,
        location: "inside_buy_zone",
      },
    });
  });

  it("keeps missing and malformed fields unknown rather than coercing them to zero or false", () => {
    const readout = buildPrecisionEntryReadout({
      schema: "intel/v1",
      analysis: {
        entry: {
          status: "",
          confidence: "91",
          spot: Number.NaN,
          stop: Infinity,
        },
        confluence: {
          ticks: 1.5,
          bars_to_cross: "2",
          provisional: 0,
          htf_s1: "false",
        },
      },
    });

    expect(readout.availability).toBe("partial");
    expect(readout.freshness).toBe("unknown");
    expect(readout.posture.status).toBeNull();
    expect(readout.bottomConfidence).toBeNull();
    expect(readout.trigger).toMatchObject({
      ticks: null,
      barsToCross: null,
      provisional: null,
      htfS1: null,
    });
    expect(readout.geometry).toEqual({
      spot: null,
      buyZone: null,
      chaseAbove: null,
      stop: null,
      location: "unknown",
    });
  });

  it("refuses impossible bounded indicator values instead of displaying them", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: {
        entry: { confidence: 140 },
        sniper: { w2_stoch_d: -3 },
      },
    });

    expect(readout.bottomConfidence).toBeNull();
    expect(readout.structure.w2StochD).toBeNull();
  });

  it("preserves explicit false booleans because false is evidence, not absence", () => {
    const readout = buildPrecisionEntryReadout({
      tape: { stale: true },
      analysis: {
        confluence: {
          provisional: false,
          not_topped: false,
          htf_s1: false,
        },
        sniper: {
          w2_washout: false,
          coiled: false,
        },
      },
    });

    expect(readout.freshness).toBe("stale");
    expect(readout.trigger).toMatchObject({
      provisional: false,
      notTopped: false,
      htfS1: false,
    });
    expect(readout.structure).toMatchObject({
      w2Washout: false,
      coiled: false,
    });
  });

  it("accepts both buy-zone contract shapes and refuses reversed endpoints", () => {
    const tuple = buildPrecisionEntryReadout({
      analysis: { entry: { spot: 95, buy_zone: [90, 100] } },
    });
    expect(tuple.geometry.buyZone).toEqual({ low: 90, high: 100 });
    expect(tuple.geometry.location).toBe("inside_buy_zone");

    const objectBand = buildPrecisionEntryReadout({
      analysis: { entry: { spot: 89, buy_zone: { low: 90, high: 100 } } },
    });
    expect(objectBand.geometry.buyZone).toEqual({ low: 90, high: 100 });
    expect(objectBand.geometry.location).toBe("below_buy_zone");

    const malformed = buildPrecisionEntryReadout({
      analysis: { entry: { spot: 95, buy_zone: [100, 90] } },
    });
    expect(malformed.geometry.buyZone).toBeNull();
    expect(malformed.geometry.location).toBe("unknown");
  });

  it("reports literal chase geometry ahead of the broader zone relation", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: {
        entry: {
          spot: 125,
          buy_zone: [116, 120],
          chase_above: 123,
        },
      },
    });

    expect(readout.geometry.location).toBe("above_chase");
  });

  it("does not manufacture readiness when no Precision intel blocks exist", () => {
    const readout = buildPrecisionEntryReadout({
      schema: "intel/v1",
      asof: "2026-09-23",
      tape: { stale: false },
      cards: { ai_judgment: { verdict: "Buy" } },
    });

    expect(readout.availability).toBe("unavailable");
    expect(readout.freshness).toBe("current");
    expect(readout.bottomConfidence).toBeNull();
    expect(readout.trigger.next).toBeNull();
    expect(readout.structure.w2StochD).toBeNull();
  });

  it("preserves the raw canonical entry status instead of translating it into a new phase taxonomy", () => {
    for (const status of ["buy_now", "await_confluence", "extended", "blocked"]) {
      const readout = buildPrecisionEntryReadout({
        analysis: { entry: { status } },
      });
      expect(readout.posture.status).toBe(status);
    }
  });
});
