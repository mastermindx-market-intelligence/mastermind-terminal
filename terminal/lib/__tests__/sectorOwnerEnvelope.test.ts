import { describe, expect, it } from "vitest";
import { concentration, groupRows, readableOwnerEnvelope, sectorRows, themeEntryReady, themeRows, themeStaleLegs } from "../sectorIntelligence";

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
