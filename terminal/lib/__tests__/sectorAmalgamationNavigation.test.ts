import { describe, it, expect } from "vitest";
import { DEFAULT_SECTOR_STATE, SECTOR_VIEWS, parseSectorState, writeSectorState } from "../sectorIntelligence";
import { SECTOR_INTELLIGENCE_LEX } from "../sectorIntelligenceLex";

describe("One Sector Central journey — URL compatibility and context", () => {
  it("exposes five purposeful destinations, not two studies or a source-record dashboard", () => {
    expect(SECTOR_VIEWS).toEqual(["intelligence", "companies", "signals", "drivers", "history"]);
    expect(SECTOR_INTELLIGENCE_LEX.siTab).toEqual(["Sector Central", "板块中心"]);
  });
  it.each([["dossier", "signals"], ["themes", "drivers"], ["sources", "intelligence"]])("preserves the legacy %s bookmark", (old, current) => {
    const state = parseSectorState(new URLSearchParams(`sectorView=${old}&sectorCompany=MU&sectorQuery=MU&sectorSort=relative&group=semiconductors`));
    expect(state.view).toBe(current); expect(state.company).toBe("MU");
    expect(state.query).toBe("MU"); expect(state.sort).toBe("relative");
    expect(state.group).toBe("semiconductors"); expect(state.sourcesOpen).toBe(old === "sources");
  });
  it.each(SECTOR_VIEWS)("opens Sources over %s without losing the selected object", view => {
    const state = { ...DEFAULT_SECTOR_STATE, view, company: "MU", query: "MU", expanded: true, sourcesOpen: true };
    const href = writeSectorState(new URL("https://app.mastermind-x.com/discover?from=sector-map#selected"), state);
    const url = new URL(href, "https://app.mastermind-x.com");
    expect(parseSectorState(url.searchParams)).toEqual(state);
    expect(url.searchParams.get("from")).toBe("sector-map"); expect(url.hash).toBe("#selected");
    expect(url.searchParams.get("sectorSources")).toBe("1");
  });
  it("closes contextual Sources without resetting the research destination", () => {
    const state = { ...DEFAULT_SECTOR_STATE, view: "companies" as const, company: "AMD", query: "A", sourcesOpen: false };
    const url = new URL(writeSectorState(new URL("https://example.test/discover?sectorSources=1"), state), "https://example.test");
    expect(url.searchParams.has("sectorSources")).toBe(false);
    expect(parseSectorState(url.searchParams)).toEqual(state);
  });
  it("canonicalizes old URLs when the user next navigates", () => {
    const url = new URL("https://example.test/discover?sectorView=dossier&group=semiconductors");
    const result = new URL(writeSectorState(url, parseSectorState(url.searchParams)), url.origin);
    expect(result.searchParams.get("sectorView")).toBe("signals");
  });
  it("does not interpret arbitrary flags as open Sources", () => {
    expect(parseSectorState(new URLSearchParams("sectorSources=true&sectorView=unexpected")).sourcesOpen).toBe(false);
    expect(parseSectorState(new URLSearchParams("sectorSources=true&sectorView=unexpected")).view).toBe("intelligence");
  });
});
