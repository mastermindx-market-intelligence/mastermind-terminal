// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sharedShellTerminalHref, SHARED_SHELL_MARKETS } from "../sharedShellNavigation";
import { SHARED_SHELL_COPY } from "../sharedShellCopy";
import { sharedShellCatalog, sharedShellDirectory } from "../sharedShellRoutes";
import { safeMacroHref, macroReturnWorkspace } from "../originNav";

describe("Shared Shell investigation handoff", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("round trips an exact supported investigation URL through the chart return owner", () => {
    const investigation = "https://beta.mastermind-x.com/analysis?symbol=BRK-B&page=intelligence&pane=intelligence&tx=2026Q1&q=a%20b&q=a+b#reported-metric";
    const chart = new URL(sharedShellTerminalHref(investigation, "BRK-B"), "https://beta.mastermind-x.com");
    expect(chart.pathname).toBe("/terminal");
    expect(chart.searchParams.get("symbol")).toBe("BRK-B");
    expect(chart.searchParams.get("from")).toBe("macro");
    expect(safeMacroHref(chart.searchParams.get("ret"))).toBe(investigation);
    // This contract carries the current chart. It promises no historical interval.
    expect(chart.searchParams.has("date")).toBe(false);
    expect(chart.searchParams.has("event")).toBe(false);
  });
  it("never relays authentication material into the chart URL", () => {
    const href = sharedShellTerminalHref("https://beta.mastermind-x.com/analysis?symbol=AAPL&access_token=private", "AAPL");
    expect(href).not.toContain("private");
    expect(new URL(href, "https://beta.mastermind-x.com").searchParams.get("ret")).toBe("https://beta.mastermind-x.com/macro.html");
  });
  it("permits only the current loopback origin during local development proof", () => {
    vi.stubEnv("NODE_ENV", "development");
    const local = new URL("/analysis?symbol=AAPL&page=intelligence#source", window.location.href).href;
    expect(safeMacroHref(local)).toBe(local);
    const otherPort = new URL(local); otherPort.port = otherPort.port === "3117" ? "3118" : "3117";
    expect(safeMacroHref(otherPort.href)).toBe("");
    expect(safeMacroHref("http://untrusted.example/analysis?symbol=AAPL")).toBe("");
    expect(safeMacroHref(new URL("/terminal", local).href)).toBe("");
    vi.stubEnv("NODE_ENV", "production");
    expect(safeMacroHref(local)).toBe("");
    expect(safeMacroHref("https://beta.mastermind-x.com/analysis?symbol=AAPL")).toBe("https://beta.mastermind-x.com/analysis?symbol=AAPL");
  });
  it("does not advertise the known internal Caddy-denied tools", () => {
    for (const path of ["/committee.html", "/crossasset.html"]) {
      expect(sharedShellCatalog.legacyPaths).not.toContain(path);
      expect(sharedShellDirectory.some(entry => entry.href === path)).toBe(false);
    }
  });
  it("uses real EN/ZH copy for all five markets while preserving market destinations", () => {
    expect(SHARED_SHELL_MARKETS.map(({code,href}) => [code,href])).toEqual([
      ["US","/us_stocks.html"],["CN","/china.html"],["HK","/hk.html"],["CA","/canada.html"],["INTL","/intl.html"],
    ]);
    expect(SHARED_SHELL_MARKETS.map(({k}) => SHARED_SHELL_COPY[k]("zh"))).toEqual(["美国","中国","香港","加拿大","全球"]);
    expect(SHARED_SHELL_MARKETS.map(({k,label}) => SHARED_SHELL_COPY[k]("en") === label)).toEqual([true,true,true,true,true]);
  });
});

it("names only recognizable validated return workspaces",()=>{
 expect(macroReturnWorkspace("https://beta.mastermind-x.com/analysis?symbol=AAPL")).toBe("analysis");
 expect(macroReturnWorkspace("https://beta.mastermind-x.com/discover?tab=sectors")).toBe("discover");
 expect(macroReturnWorkspace("https://attacker.example/analysis")).toBeNull();
 expect(macroReturnWorkspace("https://beta.mastermind-x.com/bonds.html")).toBeNull();
});
