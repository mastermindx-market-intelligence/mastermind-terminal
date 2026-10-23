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

describe("Options R1 W2A — explicit rotation method in the sector URL", () => {
  it("defaults to the incumbent method and admits only the named relative trend method", () => {
    expect(DEFAULT_SECTOR_STATE.rotationMethod).toBe("incumbent");
    expect(parseSectorState(new URLSearchParams("tab=sectors")).rotationMethod).toBe("incumbent");
    expect(parseSectorState(new URLSearchParams("sectorRotationMethod=relative_trend_ema")).rotationMethod).toBe("relative_trend_ema");
    expect(parseSectorState(new URLSearchParams("sectorRotationMethod=jdk")).rotationMethod).toBe("incumbent");
    expect(parseSectorState(new URLSearchParams("sectorRotationMethod=RELATIVE_TREND_EMA")).rotationMethod).toBe("incumbent");
  });
  it("round-trips the method with the rest of the rotation state and never writes it as a bare flag", () => {
    const state = { ...DEFAULT_SECTOR_STATE, workspace: "rotation" as const, rotationMethod: "relative_trend_ema" as const, rotationMode: "list" as const };
    const url = new URL(writeSectorState(new URL("https://example.test/discover"), state), "https://example.test");
    expect(url.searchParams.get("sectorRotationMethod")).toBe("relative_trend_ema");
    expect(parseSectorState(url.searchParams)).toEqual(state);
    const back = new URL(writeSectorState(url, { ...state, rotationMethod: "incumbent" }), "https://example.test");
    // The default method travels as the absence of the parameter so shared links keep their width budget.
    expect(back.searchParams.get("sectorRotationMethod")).toBeNull();
    expect(parseSectorState(back.searchParams).rotationMethod).toBe("incumbent");
  });
  it("names both W2 feeds in the Sources drawer lexicon in both languages", () => {
    expect(SECTOR_INTELLIGENCE_LEX.siFeedRelativeTrend).toEqual(["Sector relative trend", "板块相对趋势"]);
    expect(SECTOR_INTELLIGENCE_LEX.siFeedHoldings).toEqual(["Sector fund holdings coverage", "板块基金持仓覆盖"]);
  });
  it("names the intraday feed in both languages and gives every one of its labels a real zh pair", () => {
    expect(SECTOR_INTELLIGENCE_LEX.siFeedIntraday).toEqual(["Intraday relative moves", "盘中相对走势"]);
    for (const [key, pair] of Object.entries(SECTOR_INTELLIGENCE_LEX)) {
      if (!key.startsWith("siIntraday")) continue;
      expect(pair, key).toHaveLength(2);
      // Neither side may be the key itself or empty: a missing translation would leak raw English.
      expect(pair[0].length, key).toBeGreaterThan(0);
      expect(pair[1].length, key).toBeGreaterThan(0);
      expect(pair[0], key).not.toBe(key);
      expect(pair[1], key).not.toBe(pair[0]);
    }
  });
});
