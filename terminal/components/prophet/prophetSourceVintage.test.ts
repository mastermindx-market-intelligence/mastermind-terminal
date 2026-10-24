import { describe, expect, it } from "vitest";
import { prophetSourceVintage } from "./prophetSourceVintage";

describe("Prophet private source-data vintage", () => {
  it("never substitutes the later publication clock for missing source evidence", () => {
    expect(prophetSourceVintage({ source_unknown: true }, "en")).toEqual({
      label: null, warnings: ["unknown"],
    });
    expect(prophetSourceVintage(null, "zh")).toEqual({
      label: null, warnings: ["unknown"],
    });
  });
  it("keeps source date and vintage classifications distinct from publication time", () => {
    const actual = prophetSourceVintage({
      source_asof: "2026-10-20", source_delayed: true, source_mixed_vintage: true,
    }, "en");
    expect(actual.label).toContain("Oct");
    expect(actual.label).toContain("20");
    expect(actual.warnings).toEqual(["delayed", "mixed"]);
  });
  it("shows unknown together with delayed or mixed metadata, not a fresh badge", () => {
    expect(prophetSourceVintage({
      source_asof: null, source_unknown: true, source_delayed: true, source_mixed_vintage: true,
    }, "zh").warnings).toEqual(["unknown", "delayed", "mixed"]);
  });
  it("rejects junk dates and impossible calendar dates", () => {
    for (const raw of ["garbage", "", "2026-02-30", "2026-13-01"]) {
      expect(prophetSourceVintage({ source_asof: raw }, "en")).toEqual({
        label: null, warnings: ["unknown"],
      });
    }
  });
  it("preserves a valid date in both languages without asserting that it is fresh", () => {
    const en = prophetSourceVintage({ source_asof: "2026-10-23" }, "en");
    const zh = prophetSourceVintage({ source_asof: "2026-10-23" }, "zh");
    expect(en.label).toBeTruthy();
    expect(zh.label).toBeTruthy();
    expect(en.warnings).toEqual([]);
    expect(zh.warnings).toEqual([]);
    expect(en.label).not.toBe(zh.label);
  });
  it("does not silently trust malformed or partial date strings", () => {
    expect(prophetSourceVintage({ source_asof: "2026-10-23-random" }, "en").warnings).toEqual(["unknown"]);
  });
});
