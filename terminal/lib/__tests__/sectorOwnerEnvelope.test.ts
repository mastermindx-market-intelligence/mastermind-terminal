import { describe, expect, it } from "vitest";
import { concentration, groupRows, readableOwnerEnvelope, sectorRows, themeEntryReady, themeRows, themeStaleLegs, SECTOR_FEEDS, FINVIZ_FEEDS, PROXY_ONLY_SOURCES, feedSourceStamp } from "../sectorIntelligence";
import relativeTrendFixture from "./fixtures/sector-rotation-relative-trend.v1.json";
import holdingsCoverageFixture from "./fixtures/sector-holdings-coverage.v1.json";
import { basket, basketPulse, mixedPulse, observedComparison } from "./sectorIntradayFixture";

// Synthetic edge cases in the exact shapes observed in Macro owner files at
// 79dbe3f2431b9e21cabf23071f02eab5add57eb4. Actual-byte qualification is separate.
const sector = { id: "xlk", kind: "sector", ticker: "XLK", name: "Technology", heat: null };
const group = { key: "semiconductors", kind: "subsector", label: "Semiconductors", members: [] };
const theme = { theme_id: "memory_storage", name_en: "Memory", foresight: { stage: "WATCH", entry_ready: false } };
const themeFeed = { schema: "neuralweb.theme_state.v1", themes: [theme] };
const tiles = [1, 2, 3, 4, 5, 6].map((size, i) => ({ t: String.fromCharCode(65 + i), sector: "Technology", size }));
const heatmap = { size_basis: "marketcap", n_tiles: tiles.length, tiles };

describe("observed Sector Intelligence owner envelopes", () => {
  it("reads only the explicit sector collection and preserves a missing heat leg", () => {
    expect(sectorRows({ sectors: [sector], baskets: [{ ...sector, id: "basket", kind: "basket" }], market: { sample: sector } })).toEqual([sector]);
  });
  it("does not discover nested look-alike sector records", () => {
    expect(sectorRows({ debug: { sectors: [sector] } })).toEqual([]);
  });
  it("rejects duplicated or malformed sector identities without shrinking the population", () => {
    expect(sectorRows({ sectors: [sector, { ...sector }] })).toEqual([]);
    expect(sectorRows({ sectors: [sector, { id: "other" }] })).toEqual([]);
  });
  it("reads explicit subsectors then sector groups, without assigning holdings to an ETF", () => {
    const broad = { ...group, key: "sec-technology", kind: "sector", label: "Technology" };
    const data = { ok: true, subsectors: [group], sectors: [broad], double_gated: { misleading: group } };
    expect(groupRows(data)).toEqual([group, broad]);
    expect(groupRows(data)[0]).toBe(group);
  });
  it("does not accept the old synthetic groups envelope as a production source", () => {
    expect(groupRows({ groups: [group] })).toEqual([]);
  });
  it("refuses a failed or incomplete confluence envelope", () => {
    expect(groupRows({ ok: false, subsectors: [group], sectors: [] })).toEqual([]);
    expect(groupRows({ ok: true, subsectors: [group] })).toEqual([]);
  });
  it("requires the exact versioned theme-state schema", () => {
    expect(themeRows(themeFeed)).toEqual([theme]);
    expect(themeRows({ ...themeFeed, schema: "neuralweb.theme_state.v2" })).toEqual([]);
  });
  it("reads foresight entry readiness, never a conflicting flat field", () => {
    expect(themeEntryReady({ ...theme, entry_ready: true })).toBe(false);
    expect(themeEntryReady({ ...theme, foresight: { entry_ready: true } })).toBe(true);
  });
  it.each([null, undefined, {}, { entry_ready: "false" }])("keeps missing or mistyped foresight readiness unknown: %s", foresight => {
    const value = { ...theme, foresight };
    expect(themeRows({ ...themeFeed, themes: [value] })).toEqual([value]);
    expect(themeEntryReady(value)).toBeNull();
  });
  it("retains source stale-leg disclosure without turning it into a rank", () => {
    expect(themeStaleLegs({ stale_legs: ["a: stale", "b: missing", null] })).toEqual(["a: stale", "b: missing"]);
    expect(themeStaleLegs({})).toEqual([]);
  });
  it("bounds all source collection envelopes", () => {
    expect(readableOwnerEnvelope("sector", { sectors: Array(10001).fill(sector) })).toBe(false);
    for (const source of ["sector", "confluence", "themes", "heatmap"] as const) {
      expect(readableOwnerEnvelope(source, null)).toBe(false);
    }
  });
});

describe("heatmap capitalization cohort binding", () => {
  it("uses the actual t field and an exact priced sector denominator", () => {
    const before = JSON.stringify(heatmap);
    expect(concentration(heatmap, "Technology")).toEqual({ share: 20 / 21, count: 6, names: ["F", "E", "D", "C", "B"] });
    expect(JSON.stringify(heatmap)).toBe(before);
    expect(concentration(heatmap, "Information Technology")).toBeNull();
  });
  it("does not accept the earlier fixture-only ticker alias", () => {
    expect(concentration({ ...heatmap, tiles: tiles.map(({ t, ...row }) => ({ ...row, ticker: t })) }, "Technology")).toBeNull();
  });
  it("rejects a non-capitalization size basis", () => {
    expect(concentration({ ...heatmap, size_basis: "volume" }, "Technology")).toBeNull();
  });
  it("refuses a truncated full heatmap envelope", () => {
    expect(concentration({ ...heatmap, n_tiles: 7 }, "Technology")).toBeNull();
  });
  it.each([null, 0, -1, Infinity, "6"])("does not drop an invalid size from the denominator: %s", size => {
    expect(concentration({ ...heatmap, tiles: [...tiles.slice(0, -1), { ...tiles[5], size }] }, "Technology")).toBeNull();
  });
  it("rejects duplicate ticker identities even across different sector labels", () => {
    expect(concentration({ ...heatmap, tiles: [...tiles.slice(0, -1), { ...tiles[0], sector: "Other" }] }, "Technology")).toBeNull();
  });
  it("does not claim top-five concentration from fewer than five names", () => {
    expect(concentration({ ...heatmap, n_tiles: 4, tiles: tiles.slice(0, 4) }, "Technology")).toBeNull();
  });
});

describe("Options R1 W2 owner envelopes", () => {
  it("lists the two W2 feeds then the intraday feed, in fetch order", () => {
    expect(SECTOR_FEEDS).toEqual(["sector", "generation", "confluence", "themes", "heatmap", "risk", "history", "events", "relative_trend", "holdings", "intraday"]);
  });
  it("admits the frozen relative trend feed only through its strict parser", () => {
    expect(readableOwnerEnvelope("relative_trend", relativeTrendFixture)).toBe(true);
    expect(readableOwnerEnvelope("relative_trend", { ...relativeTrendFixture, meta: { ...relativeTrendFixture.meta, schema: "sector_rotation.relative_trend.v2" } })).toBe(false);
    expect(readableOwnerEnvelope("relative_trend", { debug: relativeTrendFixture })).toBe(false);
  });
  it("admits the frozen holdings coverage feed only through its strict parser", () => {
    expect(readableOwnerEnvelope("holdings", holdingsCoverageFixture)).toBe(true);
    expect(readableOwnerEnvelope("holdings", { ...holdingsCoverageFixture, funds: holdingsCoverageFixture.funds.map(fund => ({ ...fund, extra: 1 })) })).toBe(false);
    expect(readableOwnerEnvelope("holdings", { sectors: [sector] })).toBe(false);
  });
});

describe("catalyst intraday owner envelope", () => {
  it("admits the basket-pulse contract itself, whether or not a comparison is present yet", () => {
    expect(readableOwnerEnvelope("intraday", mixedPulse())).toBe(true);
    expect(readableOwnerEnvelope("intraday", basketPulse([basket("ai_infra", undefined)]))).toBe(true);
    expect(readableOwnerEnvelope("intraday", basketPulse([]))).toBe(true);
  });
  it("refuses a look-alike envelope, a non-US market and a duplicated basket identity", () => {
    expect(readableOwnerEnvelope("intraday", { ...basketPulse([]), schema: "basket_pulse.v2" })).toBe(false);
    expect(readableOwnerEnvelope("intraday", { ...basketPulse([]), market: "hk" })).toBe(false);
    expect(readableOwnerEnvelope("intraday", basketPulse([basket("ai_infra", observedComparison()), basket("ai_infra", observedComparison())]))).toBe(false);
    expect(readableOwnerEnvelope("intraday", { sectors: [sector] })).toBe(false);
  });
  it("does not let an intraday comparison object smuggle itself into another feed's envelope", () => {
    expect(readableOwnerEnvelope("sector", basketPulse([basket("ai_infra", observedComparison())]))).toBe(false);
    expect(readableOwnerEnvelope("intraday", themeFeed)).toBe(false);
  });
});

describe("rotation_read proxy-only source (COO rulings 57/65)", () => {
  // Labels and counts only; made-up house group ids, no vendor name or number.
  const rotationRead = {
    schema: "si.rotation_read/v1", as_of: "2026-11-06", built_at: "2026-11-07T08:00:00Z",
    status: "ok", basis: "current_roster",
    copy: ["Breadth change inside the group on today's roster. Description only; not a forecast."],
    groups: [
      { group_id: "us_sector_alpha", family: "sector", name: "Alpha", as_of: "2026-11-06", status: "ok",
        n_members: 5, n_counted: 4, pct_above_200: 50, chg_13w: 2, chg_26w: 1, direction: "improving", run_weeks: 3, rank_13w: 1, n_ranked: 2 },
      { group_id: "us_theme_beta", family: "theme", name: "Beta", as_of: "2026-11-06", status: "ok",
        n_members: 3, n_counted: 3, pct_above_200: 66.7, chg_13w: -1, chg_26w: 0, direction: "flat", run_weeks: 1, rank_13w: 2, n_ranked: 2 },
    ],
    companies: { AAA: { sector: "us_sector_alpha", themes: ["us_theme_beta"] } },
  };
  it("keeps rotation_read out of the workspace fetch lists", () => {
    expect(SECTOR_FEEDS).not.toContain("rotation_read");
    expect(FINVIZ_FEEDS).not.toContain("rotation_read");
    expect(PROXY_ONLY_SOURCES).toEqual(["rotation_read", "flagship_cycles"]);
  });
  it("admits the strict v1 envelope and stamps the receipt from its own as_of day", () => {
    expect(readableOwnerEnvelope("rotation_read", rotationRead)).toBe(true);
    expect(feedSourceStamp("rotation_read", rotationRead)).toBe("2026-11-06");
  });
  it("admits stale and unavailable panels as envelopes", () => {
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, status: "stale" })).toBe(true);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, status: "unavailable" })).toBe(true);
  });
  it("refuses a wrong schema id, a missing groups list and a non-house family", () => {
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, schema: "si.rotation_read/v2" })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, groups: undefined })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, groups: [{ ...rotationRead.groups[0], family: "subsector" }] })).toBe(false);
  });
  it("refuses an open status set, a non-day as_of and a non-plain companies map", () => {
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, status: "ready" })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, as_of: "2026-11-31" })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, as_of: "2026-11-06T00:00:00Z" })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, companies: null })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, companies: [] })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, companies: undefined })).toBe(false);
  });
  it("refuses rows without a string group_id and collections beyond the shared owner bound", () => {
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, groups: [{ family: "sector" }] })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, groups: [{ group_id: 7, family: "sector" }] })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", { ...rotationRead, groups: Array(10001).fill(rotationRead.groups[0]) })).toBe(false);
    expect(readableOwnerEnvelope("rotation_read", null)).toBe(false);
  });
  it("does not let the rotation read smuggle itself into another feed's envelope", () => {
    expect(readableOwnerEnvelope("sector", rotationRead)).toBe(false);
    expect(readableOwnerEnvelope("heatmap", rotationRead)).toBe(false);
  });
});
