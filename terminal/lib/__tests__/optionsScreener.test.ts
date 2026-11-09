import { describe, expect, it } from "vitest";
import {
  OPTIONS_SCREENER_CSV_COLUMNS,
  OPTIONS_SCREENER_EXPORT_SCHEMA,
  buildOptionsScreenerCsv,
  buildOptionsScreenerCsvFilename,
} from "@/lib/optionsCsv";
import {
  resolveScreenerSort,
  selectFreshRows,
  selectHotRows,
  selectOiRows,
  selectTopPremiumRows,
  selectUnusualRows,
  selectZeroDteRows,
  type ScreenerEventSource,
  type ScreenerHotSource,
  type ScreenerNameSource,
  type ScreenerOiSource,
} from "@/lib/optionsScreener";

const names: ScreenerNameSource[] = [
  { root: "NVDA", group: "Technology", group_zh: "科技", gross_premium_today: 100, prem_z: -3, baseline_source: "z252", n_obs: 200, call_prem_share: 0.7 },
  { root: "SPY", group: "Index", group_zh: "指数", gross_premium_today: 300, prem_z: 2, baseline_source: "z252", n_obs: 250, call_prem_share: 0.5 },
  { root: "IWM", group: "Index", group_zh: "指数", gross_premium_today: 200, prem_z: null, baseline_source: "warming", n_obs: 4, call_prem_share: 0.4 },
];

const events: ScreenerEventSource[] = [
  { root: "NVDA", group: "Technology", group_zh: "科技", premium: 70, vol_gt_oi: true, zerodte: true },
  { root: "NVDA", group: "Technology", group_zh: "科技", premium: 30, vol_gt_oi: true, zerodte: false },
  { root: "SPY", group: "Index", group_zh: "指数", premium: 200, vol_gt_oi: false, zerodte: true },
  { root: "SPY", group: "Index", group_zh: "指数", premium: 300, vol_gt_oi: null, zerodte: false },
];

const movers: ScreenerOiSource[] = [
  { root: "SPY", right: "C", exp: "2026-08-14", strike: 650, oi: 1000, oi_prev: 200, d_oi: 800, mid: 1.25 },
  { root: "IWM", right: "P", exp: "2026-08-14", strike: 220, oi: 900, oi_prev: 1800, d_oi: -900, mid: null },
];

const hot: ScreenerHotSource[] = [
  { root: "SPY", right: "C", exp: "2026-08-14", strike: 650, premium: 900, vol: 20, oi_prev: 10, vol_gt_oi: true, close: 1.2 },
  { root: "IWM", right: "P", exp: "2026-08-14", strike: 220, premium: 800, vol: 30, oi_prev: null, vol_gt_oi: null, close: 2.3 },
];

describe("Options Screener active-view selectors", () => {
  it("applies root/group filters and the visible order to name presets", () => {
    expect(selectTopPremiumRows(names, { root: "", group: "" }, "", -1).map((row) => row.root))
      .toEqual(["SPY", "IWM", "NVDA"]);
    expect(selectTopPremiumRows(names, { root: "", group: "Index" }, "gross", 1).map((row) => row.root))
      .toEqual(["IWM", "SPY"]);
    expect(selectUnusualRows(names, { root: "", group: "" }, "z", -1).map((row) => row.root))
      .toEqual(["NVDA", "SPY"]);
    expect(selectUnusualRows(names, { root: "IWM", group: "" }, "", -1)).toEqual([]);
  });

  it("derives Fresh and 0DTE aggregates without inventing missing observations", () => {
    expect(selectFreshRows(events, names, { root: "", group: "Technology" }, "", -1))
      .toEqual([{ preset: "fresh", root: "NVDA", group: "Technology", group_zh: "科技", n: 2, prem: 100 }]);
    expect(selectZeroDteRows(events, { root: "", group: "" }, "prem", -1))
      .toEqual([
        { preset: "zerodte", root: "SPY", group: "Index", group_zh: "指数", zd_prem: 200, total_prem: 500, zd_share: 0.4 },
        { preset: "zerodte", root: "NVDA", group: "Technology", group_zh: "科技", zd_prem: 70, total_prem: 100, zd_share: 0.7 },
      ]);
  });

  it("sorts ΔOI by absolute change and preserves the published Hot order", () => {
    expect(selectOiRows(movers, { root: "", group: "ignored" }, "", -1).map((row) => row.root))
      .toEqual(["IWM", "SPY"]);
    expect(selectHotRows(hot, { root: "IWM", group: "ignored" }))
      .toEqual([{ ...hot[1], preset: "hot" }]);
    expect(resolveScreenerSort("doi", "doi", -1, "by_premium"))
      .toEqual({ key: "abs_d_oi", direction: "desc" });
    expect(resolveScreenerSort("hot", "", -1, "by_volume"))
      .toEqual({ key: "volume", direction: "source" });
  });
});

describe("Options Screener CSV", () => {
  it("emits the stable v1 contract with display-only provenance and raw numeric values", () => {
    const rows = selectFreshRows(events, names, { root: "NVDA", group: "Technology" }, "prem", -1);
    const csv = buildOptionsScreenerCsv(rows, {
      preset: "fresh",
      sourceSchema: "live_flow.feed/v1",
      sourceAsof: "2026-08-10T15:42:00Z",
      sessionDate: "2026-08-10",
      displayStale: false,
      rootFilter: "NVDA",
      groupFilter: "Technology",
      sortKey: "premium",
      sortDirection: "desc",
    });
    const lines = csv.slice(1).split("\r\n");
    const header = lines[0].split(",");
    const row = lines[1].split(",");

    expect(lines[0]).toBe(OPTIONS_SCREENER_CSV_COLUMNS.join(","));
    expect(row).toHaveLength(header.length);
    expect(row[header.indexOf("export_schema")]).toBe(OPTIONS_SCREENER_EXPORT_SCHEMA);
    expect(row[header.indexOf("authority")]).toBe("display_only");
    expect(row[header.indexOf("interpretation_basis")]).toBe("vol_gt_oi_heuristic_not_confirmed");
    expect(row[header.indexOf("source_cadence")]).toBe("intraday");
    expect(row[header.indexOf("root_filter")]).toBe("NVDA");
    expect(row[header.indexOf("group_filter")]).toBe("Technology");
    expect(row[header.indexOf("fresh_hits")]).toBe("2");
    expect(row[header.indexOf("fresh_premium")]).toBe("100");
    expect(row[header.indexOf("vol_gt_oi")]).toBe("");
  });

  it("keeps nightly ΔOI non-directional and missing mid blank", () => {
    const rows = selectOiRows(movers, { root: "IWM", group: "" }, "doi", -1);
    const csv = buildOptionsScreenerCsv(rows, {
      preset: "doi",
      sourceSchema: "options_oi_movers/v1",
      sourceAsof: "2026-08-09T23:00:00Z",
      sessionDate: "2026-08-09",
      displayStale: null,
      sortKey: "abs_d_oi",
      sortDirection: "desc",
    });
    const lines = csv.slice(1).split("\r\n");
    const header = lines[0].split(",");
    const row = lines[1].split(",");

    expect(row).toHaveLength(header.length);
    expect(row[header.indexOf("interpretation_basis")]).toBe("oi_change_t1_minus_t2_non_directional");
    expect(row[header.indexOf("source_cadence")]).toBe("nightly_close");
    expect(row[header.indexOf("d_oi")]).toBe("-900");
    expect(row[header.indexOf("mid")]).toBe("");
    expect(row[header.indexOf("display_stale")]).toBe("");
  });

  it("builds deterministic active-view filenames from source metadata", () => {
    expect(buildOptionsScreenerCsvFilename({
      preset: "hot",
      hotView: "by_volume",
      sessionDate: "2026-08-09",
      sourceAsof: "2026-08-09T23:00:00Z",
    })).toBe("mastermind-options-screener_hot-by_volume_2026-08-09_20260809T230000Z.csv");
  });
});


describe("D08A source-value qualification", () => {
  it("keeps absent OI mid prices after real zero and positive marks in both sort directions", () => {
    const rows: ScreenerOiSource[] = [
      { root: "MISSING", right: "C", exp: "2026-11-06", strike: 100, oi: 100, oi_prev: 90, d_oi: 10, mid: null },
      { root: "ZERO", right: "C", exp: "2026-11-06", strike: 100, oi: 100, oi_prev: 90, d_oi: 10, mid: 0 },
      { root: "PRICED", right: "C", exp: "2026-11-06", strike: 100, oi: 100, oi_prev: 90, d_oi: 10, mid: 1.25 },
    ];
    expect(selectOiRows(rows, { root: "", group: "" }, "mid", 1).map((row) => row.root))
      .toEqual(["ZERO", "PRICED", "MISSING"]);
    expect(selectOiRows(rows, { root: "", group: "" }, "mid", -1).map((row) => row.root))
      .toEqual(["PRICED", "ZERO", "MISSING"]);
  });

  it("withholds an undefined 0DTE premium share without erasing real zero ratios", () => {
    const rows: ScreenerEventSource[] = [
      { root: "NO_DENOM", group: "Index", group_zh: "指数", premium: 0, vol_gt_oi: null, zerodte: true },
      { root: "HALF", group: "Index", group_zh: "指数", premium: 50, vol_gt_oi: null, zerodte: true },
      { root: "HALF", group: "Index", group_zh: "指数", premium: 50, vol_gt_oi: null, zerodte: false },
      { root: "ZERO", group: "Index", group_zh: "指数", premium: 0, vol_gt_oi: null, zerodte: true },
      { root: "ZERO", group: "Index", group_zh: "指数", premium: 100, vol_gt_oi: null, zerodte: false },
    ];
    const sorted = selectZeroDteRows(rows, { root: "", group: "" }, "share", 1);
    expect(sorted.map((row) => row.root)).toEqual(["ZERO", "HALF", "NO_DENOM"]);
    expect(sorted.map((row) => row.zd_share)).toEqual([0, 0.5, null]);
    expect(selectZeroDteRows(rows, { root: "", group: "" }, "share", -1).map((row) => row.root))
      .toEqual(["HALF", "ZERO", "NO_DENOM"]);
    const csv = buildOptionsScreenerCsv(sorted, {
      preset: "zerodte", sortKey: "zerodte_share", sortDirection: "asc",
      sourceSchema: "live_flow.feed/v1", sessionDate: "2026-10-30",
    });
    const [header, ...records] = csv.slice(1).split("\r\n");
    const columns = header.split(",");
    const rootIdx = columns.indexOf("root");
    const shareIdx = columns.indexOf("zerodte_share");
    const rowsByRoot = Object.fromEntries(records.filter(Boolean).map((line) => {
      const cells = line.split(",");
      return [cells[rootIdx], cells[shareIdx]];
    }));
    expect(rowsByRoot).toMatchObject({ ZERO: "0", HALF: "0.5", NO_DENOM: "" });
  });
});
