import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { OPTIONS_IA_CATEGORIES } from "../optionsIa";
import { sharedShellCatalog, sharedShellDirectory } from "../sharedShellRoutes";
import { SHARED_SHELL_LEGACY_ORIGIN } from "../sharedShellOrigins";
import { megaMenuSections, type MegaMenuSection } from "../sharedShellMegaMenu";

function members(section: MegaMenuSection) {
  return [
    ...section.groups.flatMap(group => group.items),
    ...(section.explore ?? []),
    ...(section.moreGroups ?? []).flatMap(group => group.items),
  ];
}
const items = megaMenuSections.flatMap(members);

describe("Shared Shell tool discovery", () => {
  it("keeps the six task families and the Paper research layout", () => {
    expect(megaMenuSections.map(section => section.title.en)).toEqual([
      "Markets & macro", "Stocks & sectors", "Options & flows", "Research", "Portfolio & alerts", "Global markets",
    ]);
    const research = megaMenuSections.find(section => section.id === "research")!;
    expect(research.groups.map(group => group.items.map(item => item.title.en))).toEqual([
      ["Intelligence Hub", "Research Reports"], ["Theme Tracker", "Foresight"], ["Fund Flows", "Cycle Intelligence"],
    ]);
    for (const section of megaMenuSections) {
      const sectionItems = members(section);
      expect(new Set(sectionItems.map(item => item.href)).size).toBe(sectionItems.length);
      for (const group of section.groups) {
        for (const item of group.items) {
          expect(item.description?.en.trim()).toBeTruthy();
          expect(item.description?.zh.trim()).toBeTruthy();
        }
      }
    }
  });

  it("uses the actual owners of native workspaces and opens every other tool at its published origin", () => {
    const native = new Set<string>(sharedShellCatalog.nativePaths);
    // These are direct Next routes, independent of the published legacy-frame bridge snapshot.
    for (const path of ["/brain", "/market-reference"]) {
      expect(existsSync(new URL("../../app/(shell)" + path + "/page.tsx", import.meta.url)), path).toBe(true);
      native.add(path);
    }
    const legacy = new Set<string>(sharedShellCatalog.legacyPaths);
    // The Macro research menu publishes these on its own origin. They are not admitted legacy shell pages.
    const macroOnly = new Set(["/gmi.html", "/expectation_surface.html"]);
    const optionsTabs = OPTIONS_IA_CATEGORIES.flatMap(category => category.views.map(view => view.pageKey));
    for (const item of items) {
      const url = new URL(item.href, "https://shell.test");
      if (item.native) {
        expect(url.origin).toBe("https://shell.test");
        expect(native.has(url.pathname), url.pathname).toBe(true);
        if (url.pathname === "/options" && url.searchParams.has("tab")) {
          expect(optionsTabs).toContain(url.searchParams.get("tab"));
        }
      } else if (url.origin === SHARED_SHELL_LEGACY_ORIGIN) {
        expect(legacy.has(url.pathname) || macroOnly.has(url.pathname), item.href).toBe(true);
        expect(url.searchParams.has("mmx_shell")).toBe(false);
        expect(url.searchParams.has("mmx_generation")).toBe(false);
      } else {
        expect(item.href).toBe("https://bot.mastermind-x.com");
      }
    }
  });

  it("preserves regional pages, anchors and the distinction between the US Prophet board and native model plans", () => {
    const hrefs = new Set(items.map(item => item.href));
    for (const path of ["/us_stocks.html", "/sector_central.html#confluence", "/sector_central_china.html#confluence",
      "/hk_heatmap.html", "/canada_heatmap.html", "/intl_stocks.html", "/vector.html#strategy-track-record"]) {
      expect(hrefs.has(SHARED_SHELL_LEGACY_ORIGIN + path)).toBe(true);
    }
    expect(hrefs.has("/prophet")).toBe(true);
    expect(hrefs.has("/market-reference")).toBe(true);
    expect(hrefs.has("/intelligence?macroWorkspace=liquidity_regime")).toBe(true);
    expect(hrefs.has("/sectors?sectorWorkspace=cycles")).toBe(true);
  });

  it("keeps every published product-menu entry reachable through a desk or its native replacement", () => {
    const hrefs = new Set(items.map(item => item.href));
    for (const entry of sharedShellDirectory) {
      if (!entry.group.startsWith("product_nav.") || entry.href === "/start.html") continue;
      const href = entry.href === "/reference.html" ? "/market-reference" : SHARED_SHELL_LEGACY_ORIGIN + entry.href;
      expect(hrefs.has(href), entry.href).toBe(true);
    }
  });
});
