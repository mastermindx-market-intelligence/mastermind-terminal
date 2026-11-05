import { describe, expect, it } from "vitest";
import {
  DEFAULT_WATCHLIST_SETTINGS,
  WATCHLIST_SETTINGS_VERSION,
  resolveWatchlistSettings,
} from "../watchlistSettings";

describe("resolveWatchlistSettings", () => {
  it("turns logos on once for a legacy workspace", () => {
    const result = resolveWatchlistSettings({
      ...DEFAULT_WATCHLIST_SETTINGS,
      logo: false,
      disp: "both",
    }, 0);

    expect(result.migrated).toBe(true);
    expect(result.version).toBe(WATCHLIST_SETTINGS_VERSION);
    expect(result.settings.logo).toBe(true);
    expect(result.settings.disp).toBe("both");
  });

  it("preserves an explicit logo-off choice after migration", () => {
    const result = resolveWatchlistSettings({
      ...DEFAULT_WATCHLIST_SETTINGS,
      logo: false,
    }, WATCHLIST_SETTINGS_VERSION);

    expect(result.migrated).toBe(false);
    expect(result.settings.logo).toBe(false);
  });

  it("preserves legacy columns and custom widths while adding new defaults", () => {
    const result = resolveWatchlistSettings({
      tableView: false,
      cols: { last: false, volume: true },
      colW: { sym: 180 },
      disp: "name",
      logo: false,
    }, 0);

    expect(result.settings).toMatchObject({
      tableView: false,
      cols: {
        last: false,
        changePct: true,
        change: false,
        volume: true,
        ext: true,
        extPct: true,
      },
      colW: { sym: 180 },
      disp: "name",
      logo: true,
    });
  });

  it("gives a fresh workspace the complete current defaults", () => {
    const result = resolveWatchlistSettings(undefined, Number.NaN);

    expect(result.migrated).toBe(true);
    expect(result.settings).toEqual(DEFAULT_WATCHLIST_SETTINGS);
  });

  it("adds Ext % to a current-version workspace without changing explicit column choices", () => {
    const result = resolveWatchlistSettings({
      ...DEFAULT_WATCHLIST_SETTINGS,
      cols: {
        last: true,
        changePct: true,
        change: false,
        volume: false,
        ext: false,
      },
    }, WATCHLIST_SETTINGS_VERSION);

    expect(result.migrated).toBe(false);
    expect(result.settings.cols.ext).toBe(false);
    expect(result.settings.cols.extPct).toBe(true);
  });

  it("preserves an explicit Ext %-off choice", () => {
    const result = resolveWatchlistSettings({
      ...DEFAULT_WATCHLIST_SETTINGS,
      cols: { ...DEFAULT_WATCHLIST_SETTINGS.cols, extPct: false },
    }, WATCHLIST_SETTINGS_VERSION);

    expect(result.settings.cols.extPct).toBe(false);
  });

  it.each([
    ["numeric string", "180"],
    ["negative", -12],
    ["zero", 0],
    ["below resize floor", 43.999],
    ["boolean true", true],
    ["boolean false", false],
    ["null", null],
    ["array", [180]],
    ["object", { width: 180 }],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
  ])("omits %s from saved column widths", (_case, width) => {
    const result = resolveWatchlistSettings({ colW: { sym: width } }, WATCHLIST_SETTINGS_VERSION);
    expect(result.settings.colW).toEqual({});
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["boolean", false],
    ["number", 180],
    ["string", "180"],
    ["array", [["sym", 180]]],
  ])("ignores a %s colW container", (_case, colW) => {
    const result = resolveWatchlistSettings({ colW }, WATCHLIST_SETTINGS_VERSION);
    expect(result.settings.colW).toEqual({});
  });

  it("preserves finite numeric widths at the floor, fractional widths, and unknown keys", () => {
    const colW = Object.freeze({
      sym: 180,
      last: 44,
      extPct: 44.5,
      futureColumn: 127.25,
      numericString: "180",
      negative: -12,
      zero: 0,
      undersize: 43.5,
      boolean: true,
      empty: null,
      nested: { width: 180 },
      infinite: Number.POSITIVE_INFINITY,
    });
    const saved = Object.freeze({
      tableView: false,
      cols: Object.freeze({ last: false, extPct: false }),
      disp: "both",
      logo: false,
      colW,
    });
    const defaultsBefore = JSON.parse(JSON.stringify(DEFAULT_WATCHLIST_SETTINGS));

    const result = resolveWatchlistSettings(saved, WATCHLIST_SETTINGS_VERSION);

    expect(result.settings.colW).toEqual({
      sym: 180,
      last: 44,
      extPct: 44.5,
      futureColumn: 127.25,
    });
    expect(result.settings.colW).not.toBe(colW);
    expect(result.settings).toMatchObject({
      tableView: false,
      disp: "both",
      logo: false,
      cols: { last: false, extPct: false, ext: true },
    });
    expect(saved.colW).toBe(colW);
    expect(DEFAULT_WATCHLIST_SETTINGS).toEqual(defaultsBefore);
    expect(result.settings.colW).not.toBe(DEFAULT_WATCHLIST_SETTINGS.colW);
  });
});
