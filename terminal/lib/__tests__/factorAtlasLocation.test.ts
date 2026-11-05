import { describe, expect, it } from "vitest";
import { decodeFactorLocation, encodeFactorLocation } from "../factorAtlasLocation";

const ids = ["mag7", "defense", "ai_infra", "SEC:US-XNYS/ABC"];
const fallback = ["mag7", "defense"];
const window = { anchorDate: "2026-01-28", endDate: "2026-01-30" };

describe("Factor Atlas shareable source-history window", () => {
  it("keeps the existing default without mutating unrelated query parameters", () => {
    expect(decodeFactorLocation("?tab=sectors", ids, fallback, window)).toMatchObject({
      valid: true, explicit: false, selection: fallback, window,
    });
  });
  it("round trips a multi-factor selection and exact window as independent repeated IDs", () => {
    const search = encodeFactorLocation("?tab=sectors&theme=light", ["defense", "SEC:US-XNYS/ABC"],
      { anchorDate: "2026-01-29", endDate: "2026-01-30" });
    expect(search).toContain("tab=sectors");
    expect(search).toContain("theme=light");
    expect(decodeFactorLocation(search, ids, fallback, window)).toEqual({
      valid: true, explicit: true, reason: null, selection: ["defense", "SEC:US-XNYS/ABC"],
      window: { anchorDate: "2026-01-29", endDate: "2026-01-30" },
    });
  });
  it("preserves a deliberately empty selection across navigation", () => {
    const query = encodeFactorLocation("", [], window);
    expect(decodeFactorLocation(query, ids, fallback, window)).toMatchObject({ valid: true, explicit: true, selection: [] });
  });
  it("does not invent a default basket for an unknown ID", () => {
    expect(decodeFactorLocation("?faFactor=UNKNOWN&faStart=2026-01-28&faEnd=2026-01-30",ids,fallback,window))
      .toMatchObject({ valid: false, selection: [], reason: "INVALID_FACTOR_LINK" });
  });
  it.each([
    "?faFactor=mag7",
    "?faStart=2026-01-28&faEnd=2026-01-30",
    "?faFactor=mag7&faStart=2026-01-28",
    "?faFactor=mag7&faStart=2026-02-30&faEnd=2026-03-01",
    "?faFactor=mag7&faStart=2026-01-31&faEnd=2026-01-30",
    "?faFactor=mag7&faStart=2026-01-30&faEnd=2026-01-30",
    "?faFactor=mag7&faFactor=mag7&faStart=2026-01-28&faEnd=2026-01-30",
    "?faFactor=%3Cscript%3E&faStart=2026-01-28&faEnd=2026-01-30",
  ])("refuses malformed or unauthorized saved links: %s", query => {
    const result = decodeFactorLocation(query,ids,fallback,window);
    expect(result.valid).toBe(false);
    expect(result.selection).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("<script>");
  });
  it("refuses more than eight active IDs", () => {
    const many = Array.from({length: 9}, (_, i) => `factor-${i}`);
    const params = new URLSearchParams();
    for (const id of many) params.append("faFactor", id);
    params.set("faStart", window.anchorDate);
    params.set("faEnd", window.endDate);
    expect(decodeFactorLocation("?" + params.toString(), many, fallback, window))
      .toMatchObject({ valid: false, selection: [] });
  });
  it("refuses more than eight write-side selections", () => {
    const many = Array.from({length: 9}, (_, i) => `factor-${i}`);
    expect(() => encodeFactorLocation("", many, window)).toThrow();
  });
  it("preserves unrelated search state and uses only finite bounded dates", () => {
    const search = encodeFactorLocation("?tab=factors&faFactor=bad&faStart=2020-01-01&faEnd=2020-01-02&lang=zh",
      ["mag7"], window);
    const parsed = new URLSearchParams(search);
    expect(parsed.get("tab")).toBe("factors");
    expect(parsed.get("lang")).toBe("zh");
    expect(parsed.getAll("faFactor")).toEqual(["mag7"]);
    expect(parsed.get("faStart")).toBe("2026-01-28");
  });
});
