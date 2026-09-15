import { describe, expect, it } from "vitest";
import {
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
