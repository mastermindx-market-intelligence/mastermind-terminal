import { describe, expect, it } from "vitest";
import {
  applyLayoutConfig, captureLayoutConfig, LAYOUT_SCHEMA_VERSION, normalizeLayoutConfig,
  type LayoutWorkspace,
} from "@/lib/layoutConfig";

// C5: a Saved Layout must reproduce the workspace it claims to save.
//
// The high-value assertion is the ROUND TRIP, done once against a deliberately non-default
// workspace, rather than many weak DOM checks: capture A, mutate every field to B, load A, and
// require the normalised snapshot to equal A's contract exactly.

const WORKSPACE_A: LayoutWorkspace = {
  panes: ["NVDA", "AAPL", "MSFT", "QQQ"],
  paneTfs: ["D", "3D", "W", "1M"],
  split: 4,
  activePane: 2,
  sync: false,                       // non-default: the app default is true
  chartType: "heikin",
  inds: ["ema", "macd", "vol"],
  indParams: {
    ema: { ma1Len: 21, ma2Len: 55, ma3Len: 233 },   // custom, not the 20/50/200 defaults
    macd: { fast: 8, slow: 21, signal: 5 },
    vol: { ma: 30 },
    rsi: { len: 2 },                                // NOT in `inds` — device-level, not layout-owned
  },
  hidden: ["macd", "cmp:SPY"],
  compare: ["SPY", "BTC-USD"],
  compareCfg: { SPY: { mode: "pct", color: "#f0f" }, "BTC-USD": { mode: "price", color: "#0ff" } },
  lockedVLine: "2026-08-14",
};

/** Every field different from A. */
const WORKSPACE_B: LayoutWorkspace = {
  panes: ["TSLA"],
  paneTfs: ["5m"],
  split: 1,
  activePane: 0,
  sync: true,
  chartType: "candles",
  inds: ["bb", "rsi"],
  indParams: { ema: { ma1Len: 9 }, bb: { len: 20 }, rsi: { len: 14 } },
  hidden: [],
  compare: [],
  compareCfg: {},
  lockedVLine: null,
};

describe("C5 round trip", () => {
  it("restores the saved workspace after every field has been changed", () => {
    const configA = captureLayoutConfig(WORKSPACE_A);
    const loaded = applyLayoutConfig(normalizeLayoutConfig(configA), WORKSPACE_B);

    expect(captureLayoutConfig(loaded)).toEqual(configA);

    // Spelled out for the fields the shipped v1 config silently dropped, so a regression names itself.
    expect(loaded.sync).toBe(false);                                  // was NOT saved before
    expect(loaded.split).toBe(4);                                     // was inferred from pane count
    expect(loaded.indParams.ema).toEqual({ ma1Len: 21, ma2Len: 55, ma3Len: 233 });  // was NOT saved
    expect(loaded.hidden).toEqual(["cmp:SPY", "macd"]);               // was NOT saved
    expect(loaded.paneTfs).toEqual(["D", "3D", "W", "1M"]);
    expect(loaded.chartType).toBe("heikin");
    expect(loaded.compareCfg).toEqual(WORKSPACE_A.compareCfg);
    expect(loaded.lockedVLine).toBe("2026-08-14");
  });

  it("is idempotent — loading the same layout twice lands in the same place", () => {
    const configA = captureLayoutConfig(WORKSPACE_A);
    const once = applyLayoutConfig(normalizeLayoutConfig(configA), WORKSPACE_B);
    const twice = applyLayoutConfig(normalizeLayoutConfig(configA), once);
    expect(captureLayoutConfig(twice)).toEqual(captureLayoutConfig(once));
  });

  it("leaves parameters of studies the layout does not enable alone", () => {
    const loaded = applyLayoutConfig(normalizeLayoutConfig(captureLayoutConfig(WORKSPACE_A)), WORKSPACE_B);
    // B had rsi(14) and the layout does not enable rsi, so the device keeps its own value…
    expect(loaded.indParams.rsi).toEqual({ len: 14 });
    // …and A's rsi(2) was never stored in the first place: a layout owns what it activates.
    expect(captureLayoutConfig(WORKSPACE_A).indParams).not.toHaveProperty("rsi");
  });

  it("stamps the schema version and does not store device preferences", () => {
    const config = captureLayoutConfig(WORKSPACE_A) as Record<string, unknown>;
    expect(config.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    // Ruled device-level, not layout-owned (see the module header).
    for (const excluded of ["favTF", "drawings", "dtm", "watchlist", "wl"]) {
      expect(config).not.toHaveProperty(excluded);
    }
  });
});

describe("legacy configs still load", () => {
  // Exactly the shape the shipped v1 `saveLayout()` wrote.
  const V1 = {
    panes: ["NVDA", "AAPL"],
    paneTfs: ["D", "W"],
    activePane: 1,
    tf: "D",
    chartType: "bars",
    inds: ["ema", "vol"],
    favTF: ["D", "3D", "W", "1M"],
    compare: ["SPY"],
    compareCfg: { SPY: { mode: "pct" } },
    lockedVLine: null,
  };

  it("restores what v1 stored", () => {
    const loaded = applyLayoutConfig(normalizeLayoutConfig(V1), WORKSPACE_B);
    expect(loaded.panes).toEqual(["NVDA", "AAPL"]);
    expect(loaded.paneTfs).toEqual(["D", "W"]);
    expect(loaded.split).toBe(2);            // derived from pane count, exactly as the old loader did
    expect(loaded.activePane).toBe(1);
    expect(loaded.chartType).toBe("bars");
    expect(loaded.inds).toEqual(["ema", "vol"]);
    expect(loaded.compare).toEqual(["SPY"]);
    expect(loaded.lockedVLine).toBeNull();
  });

  it("does not claim fields v1 never owned — and takes a FIXED default for sync", () => {
    const normalized = normalizeLayoutConfig(V1);
    expect(normalized.indParams).toBeNull();
    expect(normalized.hidden).toBeNull();
    expect(normalized.sync).toBe(true);      // fixed compat default, not "whatever is on screen"

    const loaded = applyLayoutConfig(normalized, WORKSPACE_B);
    expect(loaded.indParams).toEqual(WORKSPACE_B.indParams);   // untouched, not reset to defaults
    expect(loaded.hidden).toEqual(WORKSPACE_B.hidden);
  });

  it("is stable across loads: a v1 layout restores the same way from any starting workspace", () => {
    const fromB = applyLayoutConfig(normalizeLayoutConfig(V1), WORKSPACE_B);
    const fromA = applyLayoutConfig(normalizeLayoutConfig(V1), WORKSPACE_A);
    // The fields the layout OWNS must not depend on where the load started.
    for (const key of ["panes", "paneTfs", "split", "activePane", "sync", "chartType", "inds", "compare", "compareCfg", "lockedVLine"] as const) {
      expect(fromA[key]).toEqual(fromB[key]);
    }
  });

  it("ignores favTF — timeframe favourites are a device preference, not layout state", () => {
    const loaded = applyLayoutConfig(normalizeLayoutConfig(V1), WORKSPACE_B) as Record<string, unknown>;
    expect(loaded).not.toHaveProperty("favTF");
  });

  it("handles the oldest shape, a single `active` symbol", () => {
    const loaded = applyLayoutConfig(normalizeLayoutConfig({ active: "TSLA", tf: "W" }), WORKSPACE_A);
    expect(loaded.panes).toEqual(["TSLA"]);
    expect(loaded.paneTfs).toEqual(["W"]);
    expect(loaded.split).toBe(1);
  });
});

describe("malformed and future configs fail soft", () => {
  it("survives junk without throwing and claims nothing", () => {
    for (const junk of [null, undefined, 42, "layout", [], { panes: "NVDA" }, { inds: [1, 2] }]) {
      const loaded = applyLayoutConfig(normalizeLayoutConfig(junk), WORKSPACE_A);
      expect(loaded).toEqual(WORKSPACE_A);
    }
  });

  it("ignores unknown fields from a future version but honours the ones it knows", () => {
    const future = { ...captureLayoutConfig(WORKSPACE_A), schemaVersion: 99, quantumPanes: { a: 1 }, favTF: ["Z"] };
    const loaded = applyLayoutConfig(normalizeLayoutConfig(future), WORKSPACE_B);
    expect(captureLayoutConfig(loaded)).toEqual(captureLayoutConfig(WORKSPACE_A));
  });

  it("clamps an out-of-range active pane instead of pointing at nothing", () => {
    const loaded = applyLayoutConfig(normalizeLayoutConfig({ schemaVersion: 2, panes: ["NVDA"], activePane: 9 }), WORKSPACE_A);
    expect(loaded.activePane).toBe(0);
  });

  it("rejects a nonsense split rather than storing it", () => {
    const loaded = applyLayoutConfig(normalizeLayoutConfig({ schemaVersion: 2, panes: ["A", "B"], split: 7 }), WORKSPACE_A);
    expect(loaded.split).toBe(2);
  });
});
