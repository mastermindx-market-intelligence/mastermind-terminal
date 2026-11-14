import { describe, expect, it } from "vitest";
import { hasWorkspaceMarketCoverage, inheritWorkspaceMarketHref, marketNavigationHref, switchWorkspaceMarket, workspaceDocumentHref, workspaceMarket } from "../sharedShellMarket";
import { isLegacyShellPath } from "../sharedShellRoutes";
import { ECONOMIC_WORKSPACES } from "../shared-shell/macroEconomyPayload";

describe("URL-owned workspace market", () => {
  it.each(["/macro_monetary.html", ...Object.values(ECONOMIC_WORKSPACES).map(workspace => workspace.path)])("keeps %s native US coverage explicit without inventing regional readers", path => {
    expect(workspaceMarket(path)).toBe("us");
    expect(hasWorkspaceMarketCoverage(path)).toBe(true);
    expect(inheritWorkspaceMarketHref(path, "cn")).toBe(`${path}?workspaceMarket=cn`);
    for (const market of ["cn", "hk", "ca", "intl"] as const) {
      expect(hasWorkspaceMarketCoverage(path, `workspaceMarket=${market}`)).toBe(false);
    }
    const switched = switchWorkspaceMarket(`${path}?study=history&window=3m&display=table&series=US_SOURCE&observation=2026-10-01&evidence=private-source`, "cn");
    const url = new URL(switched, "https://shell.invalid");
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get("study")).toBe("history");
    expect(url.searchParams.get("display")).toBe("table");
    expect(url.searchParams.get("window")).toBe("3m");
    for (const key of ["series", "observation", "evidence"]) expect(url.searchParams.has(key)).toBe(false);
    expect(hasWorkspaceMarketCoverage(url.pathname, url.search)).toBe(false);
  });
  it("restores explicit context, infers known regional pages and rejects ambiguous links", () => {
    expect(workspaceMarket("/sectors")).toBe("us");
    expect(workspaceMarket("/china_stocks.html")).toBe("cn");
    expect(workspaceMarket("/sectors", "workspaceMarket=hk")).toBe("hk");
    expect(workspaceMarket("/analysis", "symbol=AAPL")).toBeNull();
    for (const search of ["workspaceMarket=global", "workspaceMarket=", "workspaceMarket=us&workspaceMarket=cn", "workspaceMarket=crypto"]) {
      expect(workspaceMarket("/sectors", search)).toBeNull();
      expect(hasWorkspaceMarketCoverage("/sectors", search)).toBe(false);
    }
  });
  it.each([
    ["/macro.html", "cn", "/china.html"],
    ["/china.html", "hk", "/hk.html"],
    ["/us_stocks.html", "ca", "/canada_stocks.html"],
    ["/hk_stocks.html", "intl", "/intl_stocks.html"],
    ["/sector_cycles.html", "cn", "/sector_cycles_china.html"],
    ["/sector_central.html", "cn", "/sector_central_china.html"],
  ] as const)("switches %s to its existing %s engine", (path, market, expected) => {
    const next = switchWorkspaceMarket(path, market);
    expect(next).toBe(expected);
    const url = new URL(next, "https://beta.mastermind-x.com");
    expect(isLegacyShellPath(url.pathname)).toBe(true);
    expect(hasWorkspaceMarketCoverage(url.pathname, url.search)).toBe(true);
  });
  it("keeps the task but never falls back to US for a missing regional engine", () => {
    const next = switchWorkspaceMarket("/sector_cycles.html?period=1M&sector=XLK#technology", "hk");
    expect(next).toBe("/sector_cycles.html?period=1M&workspaceMarket=hk");
    expect(hasWorkspaceMarketCoverage("/sector_cycles.html", "workspaceMarket=hk")).toBe(false);
    expect(hasWorkspaceMarketCoverage("/sectors", "workspaceMarket=cn&sectorJob=explore")).toBe(false);
    expect(hasWorkspaceMarketCoverage("/macro.html", "workspaceMarket=cn")).toBe(false);
  });
  it("keeps same-market deep links and compatible cross-market views", () => {
    expect(switchWorkspaceMarket("/sectors?sectorJob=explore&sector=XLK#sources", "us"))
      .toBe("/sectors?sectorJob=explore&sector=XLK&workspaceMarket=us#sources");
    expect(switchWorkspaceMarket("/sectors?sectorJob=explore&view=table&window=1M&sector=XLK#sources", "cn"))
      .toBe("/sectors?sectorJob=explore&view=table&window=1M&workspaceMarket=cn");
  });
  it("never changes a company, document, personal scope or opaque deep link", () => {
    for (const href of ["/analysis?symbol=0700.HK&page=intelligence#evidence", "/stock.html?ticker=AAPL#AAPL", "/research/report.html?revision=a#p4", "/unqualified.html?subject=abc#detail"]) {
      const before = new URL(href, "https://shell.invalid");
      const after = new URL(switchWorkspaceMarket(href, "cn"), before.origin);
      expect(after.pathname).toBe(before.pathname);
      expect(after.hash).toBe(before.hash);
      after.searchParams.delete("workspaceMarket");
      expect(after.search).toBe(before.search);
    }
    for (const path of ["/analysis", "/stock.html", "/portfolio", "/monitor", "/research", "/options/equity-replay"]) {
      expect(hasWorkspaceMarketCoverage(path, "workspaceMarket=cn")).toBe(true);
    }
    expect(hasWorkspaceMarketCoverage("/unqualified.html", "workspaceMarket=cn")).toBe(false);
  });
  it("returns to the selected Macro task after unsupported market coverage", () => {
    const away = switchWorkspaceMarket("/intelligence?workspaceMarket=us&macroWorkspace=liquidity_regime", "cn");
    expect(away).toBe("/intelligence?macroWorkspace=liquidity_regime&workspaceMarket=cn");
    expect(hasWorkspaceMarketCoverage("/intelligence", new URL(away, "https://shell.invalid").search)).toBe(false);
    expect(switchWorkspaceMarket(away, "us")).toBe("/intelligence?macroWorkspace=liquidity_regime&workspaceMarket=us");
  });
  it("decorates local navigation without rewriting external destinations", () => {
    expect(marketNavigationHref("/sectors?sectorJob=explore", "hk")).toBe("/sectors?sectorJob=explore&workspaceMarket=hk");
    expect(marketNavigationHref("/us_stocks.html", "cn")).toBe("/china_stocks.html");
    for (const href of ["https://example.com/a", "//example.com/a", "mailto:a@example.com", "#sources"]) {
      expect(marketNavigationHref(href, "cn")).toBe(href);
    }
  });
  it("preserves Intl's own market field and raw comma-separated selections", () => {
    const href = "/intl.html?view=overview&market=JP&pins=JP,KR&horizon=3m&basis=local&return_basis=price#history";
    expect(workspaceMarket("/intl.html", new URL(href, "https://shell.invalid").search)).toBe("intl");
    expect(switchWorkspaceMarket(href, "intl")).toBe(href);
    expect(inheritWorkspaceMarketHref(href, "cn")).toBe(href);
    expect(workspaceDocumentHref(href.replace("&pins=", "&workspaceMarket=intl&pins="))).toBe(href);
    expect(workspaceDocumentHref("/stock.html?ticker=AAPL&workspaceMarket=cn#AAPL")).toBe("/stock.html?ticker=AAPL#AAPL");
    expect(workspaceDocumentHref("/intl.html?view=overview&&market=JP")).toBe("/intl.html?view=overview&&market=JP");
  });
  it("keeps explicit regional destinations and carries context into native or issuer paths", () => {
    expect(inheritWorkspaceMarketHref("/china.html", "hk")).toBe("/china.html");
    expect(inheritWorkspaceMarketHref("/analysis?symbol=0700.HK", "cn")).toBe("/analysis?symbol=0700.HK&workspaceMarket=cn");
    expect(inheritWorkspaceMarketHref("/stock.html#AAPL", "cn")).toBe("/stock.html?workspaceMarket=cn#AAPL");
    expect(inheritWorkspaceMarketHref("/intl.html?market=JP&pins=JP,KR", "cn")).toBe("/intl.html?market=JP&pins=JP,KR");
  });
});

