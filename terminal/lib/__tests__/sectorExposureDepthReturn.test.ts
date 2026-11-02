import { describe, expect, it } from "vitest";
import { DEFAULT_SECTOR_STATE, parseSectorState } from "../sectorIntelligence";
import { resolveSectorDepthReturn } from "../sectorDepthReturn";
import { encodeExposureOrigin, exposureOriginForCompany, exposureOriginForStep, isExposureOrigin, sectorOriginFromState } from "../exposureOrigin";

const opener = { ...DEFAULT_SECTOR_STATE, discoveryMode: "table" as const, matrixTimeframe: "1M" as const,
  matrixIndustry: "Hardware", company: "AAA" };
const state = { ...opener, workspace: "detail" as const, group: "semiconductors" };
const input = { state, depthReturn: opener, company: "AAA", roster: ["AAA", "BBB"],
  asOf: "2026-10-20", contentHash: "sha256:123456789", benchmark: "SPY" };

describe("Sector → Exposure → sector research return", () => {
  it("keeps the exact originating table selection inside both incumbent budgets", () => {
    const origin = sectorOriginFromState(input)!;
    expect(origin).not.toBeNull();
    expect(isExposureOrigin(origin)).toBe(true);
    expect(origin.returnHref.length).toBeLessThanOrEqual(512);
    expect(encodeExposureOrigin(origin)).not.toBeNull();
    expect(encodeExposureOrigin(origin)!.length).toBeLessThanOrEqual(1024);
    const params = new URL(origin.returnHref, "https://mastermind.invalid").searchParams;
    expect(resolveSectorDepthReturn(params.get("sectorReturn"), null)).toEqual(opener);
    expect(parseSectorState(params)).toEqual(state);
  });

  it("steps the current company while retaining the original outer selection and cohort receipt", () => {
    const origin = sectorOriginFromState(input)!;
    const stepped = exposureOriginForCompany(origin, "BBB", 1);
    expect(stepped).toMatchObject({ ...origin, company: "BBB", index: 1, returnHref: expect.any(String) });
    const params = new URL(stepped.returnHref, "https://mastermind.invalid").searchParams;
    expect(parseSectorState(params).company).toBe("BBB");
    expect(resolveSectorDepthReturn(params.get("sectorReturn"), null)).toEqual(opener);
    expect(isExposureOrigin(stepped)).toBe(true);
    expect(encodeExposureOrigin(stepped)).not.toBeNull();
  });

  it("falls back to the correct outer workspace and sector for an oversized opener", () => {
    const long = { ...opener, workspace: "breadth" as const, sector: "xle", theme: "light" as const,
      companyTableQuery: "科".repeat(60), matrixIndustry: "科".repeat(120) };
    const origin = sectorOriginFromState({ ...input, depthReturn: long })!;
    expect(origin).not.toBeNull();
    const params = new URL(origin.returnHref, "https://mastermind.invalid").searchParams;
    expect(resolveSectorDepthReturn(params.get("sectorReturn"), null)).toEqual({ ...DEFAULT_SECTOR_STATE,
      workspace: "breadth", sector: "xle", theme: "light" });
    expect(origin.returnHref.length).toBeLessThanOrEqual(512);
    expect(encodeExposureOrigin(origin)).not.toBeNull();
  });

  it("never returns an origin whose encoded wire form drops the depth context", () => {
    for (let length = 0; length <= 60; length++) {
      const origin = sectorOriginFromState({ ...input, depthReturn: { ...opener, companyTableQuery: "科".repeat(length) } });
      if (!origin) continue; // The unchanged size guard may make the action unavailable.
      expect(encodeExposureOrigin(origin), `CJK filter length ${length}`).not.toBeNull();
      const params = new URL(origin.returnHref, "https://mastermind.invalid").searchParams;
      expect(resolveSectorDepthReturn(params.get("sectorReturn"), null)?.workspace).toBe("discover");
    }
  });

  it.each(["https://example.com", "sectorWorkspace=detail", "sectorWorkspace=discover&sectorReturn=nested"])("rejects unqualified nested return %s", raw => {
    const origin = sectorOriginFromState(input)!;
    const url = new URL(origin.returnHref, "https://mastermind.invalid");
    url.searchParams.set("sectorReturn", raw);
    expect(isExposureOrigin({ ...origin, returnHref: url.pathname + url.search })).toBe(false);
  });

  it("rejects a duplicate depth return without changing the legacy origin shape", () => {
    const origin = sectorOriginFromState(input)!;
    const url = new URL(origin.returnHref, "https://mastermind.invalid");
    url.searchParams.append("sectorReturn", "sectorWorkspace=rotation");
    expect(isExposureOrigin({ ...origin, returnHref: url.pathname + url.search })).toBe(false);
    expect(Object.keys(origin).sort()).toEqual(["v", "kind", "returnHref", "sector", "group", "company", "index", "count", "sort", "query", "asOf", "contentHash", "method", "benchmark"].sort());
  });

  it("does not launder an unsupported opener through the size fallback", () => {
    expect(sectorOriginFromState({ ...input, depthReturn: { ...opener, sourcesOpen: true } })).toBeNull();
    expect(sectorOriginFromState({ ...input, depthReturn: { ...opener, workspace: "detail" } })).toBeNull();
    expect(sectorOriginFromState({ ...input, depthReturn: { ...opener, sourceFamily: "finviz" } })).toBeNull();
  });

  it("refuses an atomic A → ABCDEFGHIJ step at the actual 1008 → 1026 wire boundary", () => {
    const selected = { ...DEFAULT_SECTOR_STATE, workspace: "detail" as const, finvizTheme: "科".repeat(31), company: "A" };
    const origin = sectorOriginFromState({ ...input, state: selected, depthReturn: DEFAULT_SECTOR_STATE,
      company: "A", roster: ["A", "ABCDEFGHIJ"] })!;
    expect(encodeExposureOrigin(origin)!.length).toBe(1008);
    const href = new URL(origin.returnHref, "https://mastermind.invalid");
    href.searchParams.set("sectorCompany", "ABCDEFGHIJ");
    const tooLarge = { ...origin, company: "ABCDEFGHIJ", index: 1, returnHref: href.pathname + href.search };
    expect(isExposureOrigin(tooLarge)).toBe(true);
    expect(tooLarge.returnHref.length).toBeLessThanOrEqual(512);
    expect(encodeURIComponent(JSON.stringify(tooLarge)).length).toBe(1026);
    expect(encodeExposureOrigin(tooLarge)).toBeNull();
    const before = JSON.stringify(origin);
    expect(exposureOriginForStep(origin, { company: "ABCDEFGHIJ", index: 1 })).toBeNull();
    expect(JSON.stringify(origin)).toBe(before);
  });
});
