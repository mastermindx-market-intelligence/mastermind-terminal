import { describe, expect, it } from "vitest";
import { sharedShellTerminalHref, SHARED_SHELL_MARKETS } from "../sharedShellNavigation";
import { SHARED_SHELL_COPY } from "../sharedShellCopy";
import { safeMacroHref } from "../originNav";

describe("Shared Shell investigation handoff", () => {
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
  it("uses real EN/ZH copy for all five markets while preserving market destinations", () => {
    expect(SHARED_SHELL_MARKETS.map(({code,href}) => [code,href])).toEqual([
      ["US","/us_stocks.html"],["CN","/china.html"],["HK","/hk.html"],["CA","/canada.html"],["INTL","/intl.html"],
    ]);
    expect(SHARED_SHELL_MARKETS.map(({k}) => SHARED_SHELL_COPY[k]("zh"))).toEqual(["美国","中国","香港","加拿大","全球"]);
    expect(SHARED_SHELL_MARKETS.map(({k,label}) => SHARED_SHELL_COPY[k]("en") === label)).toEqual([true,true,true,true,true]);
  });
});
