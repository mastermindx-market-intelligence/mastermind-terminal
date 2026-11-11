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

    expect(readout.availability).toBe("unavailable");
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

  it("refuses non-positive or internally contradictory price geometry", () => {
    const badSpot = buildPrecisionEntryReadout({
      analysis: { entry: { spot: -1, buy_zone: { low: 90, high: 100 } } },
    });
    expect(badSpot.geometry.spot).toBeNull();
    expect(badSpot.geometry.location).toBe("unknown");

    const badZone = buildPrecisionEntryReadout({
      analysis: { entry: { spot: 95, buy_zone: { low: 0, high: 100 } } },
    });
    expect(badZone.geometry.buyZone).toBeNull();
    expect(badZone.geometry.location).toBe("unknown");

    const crossedContracts = buildPrecisionEntryReadout({
      analysis: {
        entry: {
          spot: 95,
          buy_zone: { low: 90, high: 100 },
          chase_above: 97,
        },
      },
    });
    expect(crossedContracts.geometry.location).toBe("unknown");
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

  it.each([
    ["empty", { entry: {}, confluence: {}, sniper: {} }],
    ["metadata-only", {
      entry: { schema: "entry/v1", asof: "2026-11-10", extra: 1 },
      confluence: { asof: "2026-11-10" },
      sniper: { asof: "2026-11-09" },
    }],
    ["malformed", {
      entry: { headline: 42, confidence: "60", spot: 0, stop: Infinity, buy_zone: [100, 90] },
      confluence: { ticks: 1.5, bars_to_cross: "0", htf_s1: "false", provisional: 0 },
      sniper: { coiled: "false", w2_washout: 0, w2_stoch_d: 101, days_since_63d_low: 1.5 },
    }],
  ])("keeps %s containers unavailable despite current freshness", (_name, analysis) => {
    const readout = buildPrecisionEntryReadout({
      schema: "intel/v1", asof: "2026-11-10", tape: { stale: false }, analysis,
    });
    expect(readout.availability).toBe("unavailable");
    expect(readout.freshness).toBe("current");
    expect(readout.asof.intel).toBe("2026-11-10");
    expect(readout.bottomConfidence).toBeNull();
    expect(readout.geometry.location).toBe("unknown");
  });

  it("reports partial coverage when only one populated section has validated facts", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: { entry: { headline: "Wait for confluence" }, confluence: {}, sniper: {} },
    });
    expect(readout.availability).toBe("partial");
    expect(readout.posture.headline).toBe("Wait for confluence");
  });

  it("counts the entry next-trigger fact only in its own source section", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: { entry: { next_trigger: "2D MACD" }, confluence: {}, sniper: { coiled: false } },
    });
    expect(readout.availability).toBe("partial");
    expect(readout.trigger.next).toBe("2D MACD");
    expect(readout.structure.coiled).toBe(false);
  });

  it("does not let derived unknown geometry qualify an empty entry section", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: { entry: {}, confluence: { htf_s1: false }, sniper: { coiled: false } },
    });
    expect(readout.availability).toBe("partial");
    expect(readout.geometry.location).toBe("unknown");
    expect(readout.trigger.htfS1).toBe(false);
    expect(readout.structure.coiled).toBe(false);
  });

  it("counts valid zero and false observations as evidence in all three sections", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: {
        entry: { confidence: 0 },
        confluence: { htf_s1: false, bars_to_cross: 0, ticks: 0 },
        sniper: { w2_stoch_d: 0, days_since_63d_low: 0, w2_washout: false, coiled: false },
      },
    });
    expect(readout.availability).toBe("ready");
    expect(readout.bottomConfidence).toBe(0);
    expect(readout.trigger).toMatchObject({ htfS1: false, barsToCross: 0, ticks: 0 });
    expect(readout.structure).toEqual({
      w2Washout: false, w2StochD: 0, daysSince63dLow: 0, coiled: false,
    });
  });

  it("keeps non-positive price fields unavailable instead of treating zero as price evidence", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: {
        entry: { spot: 0, stop: 0, chase_above: -1, buy_zone: [0, 100] },
        confluence: { asof: "2026-11-10" },
        sniper: { schema: "sniper/v1" },
      },
    });
    expect(readout.availability).toBe("unavailable");
    expect(readout.geometry).toEqual({
      spot: null, buyZone: null, chaseAbove: null, stop: null, location: "unknown",
    });
  });

  it("preserves the existing signed finite-number and integer contracts", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: {
        entry: { confidence: 0 },
        confluence: { ticks: -1, bars_to_cross: -0.5 },
        sniper: { days_since_63d_low: 0 },
      },
    });
    expect(readout.availability).toBe("ready");
    expect(readout.trigger.ticks).toBe(-1);
    expect(readout.trigger.barsToCross).toBe(-0.5);
    expect(readout.structure.daysSince63dLow).toBe(0);
  });

  it("counts a valid source band without inventing a spot or derived location", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: { entry: { buy_zone: [90, 100] }, confluence: {}, sniper: {} },
    });
    expect(readout.availability).toBe("partial");
    expect(readout.geometry.buyZone).toEqual({ low: 90, high: 100 });
    expect(readout.geometry.spot).toBeNull();
    expect(readout.geometry.location).toBe("unknown");
  });

  it("preserves validated canonical text facts without requiring visible raw enums", () => {
    const readout = buildPrecisionEntryReadout({
      analysis: { entry: { status: "await_confluence" }, confluence: { tier: "T3" }, sniper: { coiled: false } },
    });
    expect(readout.availability).toBe("ready");
    expect(readout.posture.status).toBe("await_confluence");
    expect(readout.trigger.tier).toBe("T3");
  });

});
