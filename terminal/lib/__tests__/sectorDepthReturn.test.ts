import { describe, expect, it } from "vitest";
import { DEFAULT_SECTOR_STATE } from "../sectorIntelligence";
import { encodeSectorDepthReturn, parseSectorDepthReturn, resolveSectorDepthReturn, sectorDepthReturnQuery, sectorDepthReturnHistory, SECTOR_DEPTH_RETURN_HISTORY_KEY } from "../sectorDepthReturn";

describe("sector research depth return", () => {
  it("keeps the ordinary Discover opener compact", () => {
    expect(encodeSectorDepthReturn(DEFAULT_SECTOR_STATE)).toBe("sectorWorkspace=discover");
    expect(parseSectorDepthReturn("sectorWorkspace=discover")).toEqual(DEFAULT_SECTOR_STATE);
  });

  it("round trips the selected company, period, industry, search and representation", () => {
    const state = { ...DEFAULT_SECTOR_STATE, sector: "xlf", group: "", company: "JPM", theme: "light" as const,
      discoveryMode: "table" as const, matrixTimeframe: "1M" as const, matrixIndustry: "Banks",
      matrixBand: "mega" as const, companyTableQuery: "JPM", companyTableSort: "performance" as const };
    expect(parseSectorDepthReturn(encodeSectorDepthReturn(state))).toEqual(state);
  });

  it.each(["rotation", "breadth"] as const)("preserves the %s opener", workspace => {
    const state = { ...DEFAULT_SECTOR_STATE, workspace, sector: "xle", rotationMode: "list" as const,
      rotationQuery: "Energy", rotationMethod: "relative_trend_ema" as const };
    expect(parseSectorDepthReturn(encodeSectorDepthReturn(state))).toEqual(state);
  });

  it("uses the incumbent bounds and preserves non-ASCII filters", () => {
    const state = { ...DEFAULT_SECTOR_STATE, discoveryQuery: "科技", matrixIndustry: "半导体" };
    expect(parseSectorDepthReturn(encodeSectorDepthReturn(state))).toEqual(state);
  });

  it.each([null, "", "/discover?sectorWorkspace=discover", "https://example.com", "//example.com",
    "sectorWorkspace=detail", "sectorWorkspace=discover&next=https%3A%2F%2Fexample.com",
    "sectorWorkspace=discover&sectorWorkspace=rotation", "sectorWorkspace=discover&sectorSources=1",
    "sectorWorkspace=discover&sectorReturn=sectorWorkspace%3Ddiscover", "sectorWorkspace=discover#fragment",
    "sectorWorkspace=discover&sectorMatrixTimeframe=bogus", "sectorWorkspace=discover&sectorSource=finviz",
    "sectorWorkspace=discover&sector=xlk", "x".repeat(8193)])("rejects unqualified or noncanonical snapshot %s", raw => {
    expect(parseSectorDepthReturn(raw)).toBeNull();
  });

  it("does not create recursive, Finviz or open-dialog snapshots", () => {
    expect(encodeSectorDepthReturn({ ...DEFAULT_SECTOR_STATE, workspace: "detail" })).toBeNull();
    expect(encodeSectorDepthReturn({ ...DEFAULT_SECTOR_STATE, sourceFamily: "finviz" })).toBeNull();
    expect(encodeSectorDepthReturn({ ...DEFAULT_SECTOR_STATE, sourcesOpen: true })).toBeNull();
  });

  it("retains every legal maximum-length filter in bounded same-tab history", () => {
    const state = { ...DEFAULT_SECTOR_STATE, workspace: "breadth" as const, theme: "light" as const, sector: "xle",
      finvizTheme: "科".repeat(180), finvizSubtheme: "科".repeat(180), discoveryQuery: "科".repeat(60),
      companyTableQuery: "科".repeat(60), matrixIndustry: "科".repeat(120), rotationQuery: "科".repeat(60), query: "科".repeat(40) };
    const snapshot = encodeSectorDepthReturn(state)!;
    expect(snapshot.length).toBeGreaterThan(1024);
    expect(snapshot.length).toBeLessThanOrEqual(8192);
    expect(parseSectorDepthReturn(snapshot)).toEqual(state);
    const query = sectorDepthReturnQuery(state)!;
    expect(query.length).toBeLessThanOrEqual(1024);
    expect(resolveSectorDepthReturn(query, snapshot)).toEqual(state);
    expect(resolveSectorDepthReturn(query, null)).toEqual({ ...DEFAULT_SECTOR_STATE, workspace: "breadth", sector: "xle", theme: "light" });
    expect(resolveSectorDepthReturn("sectorWorkspace=rotation", snapshot)?.workspace).toBe("rotation");
    expect(resolveSectorDepthReturn(query, { snapshot })).toEqual(resolveSectorDepthReturn(query, null));
  });
});


describe("sector application history does not impersonate the router", () => {
  it("passes only the owned opener snapshot so Next synchronizes the new URL", () => {
    const snapshot = encodeSectorDepthReturn({ ...DEFAULT_SECTOR_STATE, sector: "xle", workspace: "rotation" });
    const state = sectorDepthReturnHistory(snapshot);
    expect(state).toEqual({ [SECTOR_DEPTH_RETURN_HISTORY_KEY]: snapshot });
    expect(state).not.toHaveProperty("__NA");
    expect(state).not.toHaveProperty("_N");
    expect(state).not.toHaveProperty("__PRIVATE_NEXTJS_INTERNALS_TREE");
    // The installed Next owner treats either flag as an internal update and
    // skips application URL synchronization. This is the observed Back defect.
    const wouldSynchronize = !(state as Record<string, unknown>).__NA && !(state as Record<string, unknown>)._N;
    expect(wouldSynchronize).toBe(true);
    expect(resolveSectorDepthReturn(sectorDepthReturnQuery({ ...DEFAULT_SECTOR_STATE, sector: "xle", workspace: "rotation" }), state[SECTOR_DEPTH_RETURN_HISTORY_KEY])).toMatchObject({ sector: "xle", workspace: "rotation" });
  });
  it("drops the old opener when leaving research without borrowing framework state", () => {
    expect(sectorDepthReturnHistory(null)).toEqual({});
  });
});
