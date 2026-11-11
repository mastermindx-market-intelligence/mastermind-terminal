import { describe, expect, it } from "vitest";
import {
  isAmbientCandleSuite,
  migrateMastermindCandlesDefault,
  MASTERMIND_CANDLES_SUITE_KEY,
} from "@/lib/mastermindCandlesDefault";

const DEFAULT_INDS = ["ema", "vol", "macd", "stochrsi"];

function trendParams(result: ReturnType<typeof migrateMastermindCandlesDefault>) {
  return result.params[MASTERMIND_CANDLES_SUITE_KEY];
}

describe("Mastermind Candles default rollout", () => {
  it("adds only Mastermind Candles for a first-time user", () => {
    const result = migrateMastermindCandlesDefault(DEFAULT_INDS, {}, [], false);

    expect(result.indicators).toEqual([...DEFAULT_INDS, "trend"]);
    expect(trendParams(result)).toMatchObject({
      "te.on": false,
      "fb.on": false,
      "vb.on": false,
      "cp.on": true,
      "dash.on": false,
    });
    expect(result.hidden).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it("turns Mastermind Candles on once for an existing Trend Waves user without changing siblings", () => {
    const result = migrateMastermindCandlesDefault(
      ["ema", "trend"],
      {
        trend: {
          "te.on": true,
          "fb.on": false,
          "vb.on": true,
          "cp.on": false,
          "dash.on": false,
          "cp.mode": "trendVolume",
        },
      },
      ["suite:trend/cp", "ema"],
      false,
    );

    expect(result.indicators).toEqual(["ema", "trend"]);
    expect(trendParams(result)).toMatchObject({
      "te.on": true,
      "fb.on": false,
      "vb.on": true,
      "cp.on": true,
      "dash.on": false,
      "cp.mode": "trendVolume",
    });
    expect(result.hidden).toEqual(["ema"]);
  });

  it("keeps stale settings but does not activate sibling Trend modules when the parent was inactive", () => {
    const result = migrateMastermindCandlesDefault(
      ["ema"],
      { trend: { "te.on": true, "cp.on": false, "cp.mode": "trend" } },
      ["trend"],
      false,
    );

    expect(result.indicators).toEqual(["ema", "trend"]);
    expect(trendParams(result)).toMatchObject({
      "te.on": false,
      "fb.on": false,
      "vb.on": false,
      "cp.on": true,
      "dash.on": false,
      "cp.mode": "trend",
    });
    expect(result.hidden).toEqual([]);
  });

  it("never re-adds the feature after the one-time rollout marker exists", () => {
    const result = migrateMastermindCandlesDefault(
      ["ema", "vol"],
      { trend: { "cp.on": false, "cp.mode": "momentumVolume" } },
      ["suite:trend/cp"],
      true,
    );

    expect(result.indicators).toEqual(["ema", "vol"]);
    expect(trendParams(result)).toEqual({ "cp.on": false, "cp.mode": "momentumVolume" });
    expect(result.hidden).toEqual(["suite:trend/cp"]);
    expect(result.changed).toBe(false);
  });
});


describe("rollout isolation and malformed preferences", () => {
  it("unhides only candles when a legacy suite-wide eye hid its siblings", () => {
    const result = migrateMastermindCandlesDefault(
      ["trend", "ema"], { trend: { "te.on": true, "vb.on": true, "cp.on": false } },
      ["trend", "ema", "suite:trend/fb"], false,
    );
    expect(result.hidden).not.toContain("trend");
    expect(result.hidden).not.toContain("suite:trend/cp");
    expect(result.hidden).toEqual(expect.arrayContaining(["ema", "suite:trend/te", "suite:trend/vb", "suite:trend/fb"]));
    expect(result.params.trend["te.on"]).toBe(true);
    expect(result.params.trend["vb.on"]).toBe(true);
  });

  it.each([null, false, 12, "bad", {}])("never throws on valid JSON of the wrong shape (%j)", (bad) => {
    const result = migrateMastermindCandlesDefault(bad as never, bad as never, bad as never, false);
    expect(result.indicators).toContain("trend");
    expect(result.params.trend["cp.on"]).toBe(true);
    expect(result.hidden).toEqual([]);
  });

  it("does not mutate the input and the second migration preserves later removal", () => {
    const ids = Object.freeze(["ema"]);
    const params = Object.freeze({ trend: Object.freeze({ "cp.mode": "trendVolume", custom: 12 }) });
    const hidden = Object.freeze(["ema"]);
    const first = migrateMastermindCandlesDefault(ids, params, hidden, false);
    const removed = migrateMastermindCandlesDefault(["ema"], first.params, first.hidden, true);
    expect(removed.indicators).toEqual(["ema"]);
    expect(removed.changed).toBe(false);
    expect(params.trend).toEqual({ "cp.mode": "trendVolume", custom: 12 });
  });
});


describe("anonymous candle-style slot exemption", () => {
  it("does not consume a third study slot and never exempts premium siblings", () => {
    const first = migrateMastermindCandlesDefault(["ema", "vol"], {}, [], false);
    expect(first.indicators.length - Number(isAmbientCandleSuite(first.indicators, first.params))).toBe(2);
    first.params.trend["te.on"] = true;
    expect(isAmbientCandleSuite(first.indicators, first.params)).toBe(false);
    expect(isAmbientCandleSuite(["ema"], first.params)).toBe(false);
  });
});
