import { describe, expect, it } from "vitest";
import { sharedShellActiveKey } from "@/lib/sharedShellNavigation";

describe("regional overview navigation identity", () => {
  it.each(["/us_stocks.html", "/china.html", "/hk.html", "/canada.html", "/intl.html"])(
    "%s belongs to its market row without claiming the native Today page",
    path => expect(sharedShellActiveKey(path)).toBe(""),
  );

  it.each([
    ["/today", "shellToday"],
    ["/discover", "discover"],
    ["/discover/stock-screener", "discover"],
    ["/analysis", "analysis"],
    ["/stock.html", "analysis"],
    ["/china_lookup.html", "analysis"],
    ["/hk_lookup.html", "analysis"],
    ["/canada_stock.html", "analysis"],
    ["/intl_stock.html", "analysis"],
    ["/research", "shellResearch"],
    ["/stocks/earnings", "shellResearch"],
    ["/monitor", "shellMonitor"],
    ["/watchlist.html", "shellMonitor"],
    ["/portfolio", "portfolio"],
  ])("preserves the existing primary family for %s", (path, primary) => {
    expect(sharedShellActiveKey(path)).toBe(primary);
  });
});
