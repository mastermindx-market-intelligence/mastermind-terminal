/**
 * First-paint bundle fence for the charting Terminal.
 *
 * Closed interaction surfaces must remain dynamic imports. A static import silently pushes their
 * implementation (and transitive dependencies) back onto every /terminal cold load.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

function staticSpecifiers(text: string): string[] {
  const out: string[] = [];
  const statement = /^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const match of text.matchAll(statement)) out.push(match[1]);
  return out;
}

describe("Terminal closed controls stay off the startup graph", () => {
  it("TerminalShell dynamically loads intent-only surfaces", () => {
    const text = source("components/TerminalShell.tsx");
    const staticImports = staticSpecifiers(text);
    for (const specifier of [
      "@/components/PositionModal",
      "@/components/LayoutMenu",
      "@/components/ChartTableView",
    ]) {
      expect(staticImports).not.toContain(specifier);
      expect(text).toContain(`dynamic(() => import("${specifier}")`);
    }
    expect(text).toContain("{layoutOpen && <LayoutMenu");
  });

  it("ChartPane loads chart settings only when the modal is opened", () => {
    const text = source("components/ChartPane.tsx");
    expect(staticSpecifiers(text)).not.toContain("@/components/ChartSettingsModal");
    expect(text).toContain('dynamic(() => import("@/components/ChartSettingsModal")');
    expect(text).toContain("{settingsModalOpen && (");
  });

  it("Terminal navigation prefetches sibling workspaces only after user intent", () => {
    const shell = source("components/TerminalShell.tsx");
    const appNav = source("components/AppNav.tsx");
    const mobileNav = source("components/MobileNav.tsx");
    expect(shell).toContain("<AppNav intentPrefetch />");
    expect(shell).toContain("intentPrefetch");
    expect(appNav).toContain("prefetch={intentPrefetch ? false : undefined}");
    expect(appNav).toContain("router.prefetch(href)");
    expect(mobileNav).toContain("prefetch={intentPrefetch ? false : undefined}");
    expect(mobileNav).toContain("router.prefetch(href)");
  });

  it("saved workspaces load on menu intent instead of chart boot", () => {
    const shell = source("components/TerminalShell.tsx");
    expect(shell).not.toContain("useEffect(() => { void refreshLayouts(); }, [refreshLayouts]);");
    expect(shell).toContain("const ensureLayoutsLoaded = useCallback(() => {");
    expect(shell).toContain("onMouseEnter={ensureLayoutsLoaded}");
    expect(shell).toContain("ensureLayoutsLoaded(); const willOpen = !layoutOpen");
  });

  it("the Terminal insight rail does not pull the full Forecast page into startup", () => {
    const stock = source("components/StockAnalysisImpl.tsx");
    const helper = source("lib/analystRating.ts");
    expect(staticSpecifiers(stock)).not.toContain("@/components/fin/ForecastPage");
    expect(staticSpecifiers(stock)).toContain("@/lib/analystRating");
    expect(staticSpecifiers(helper)).toEqual([]);
  });
});
