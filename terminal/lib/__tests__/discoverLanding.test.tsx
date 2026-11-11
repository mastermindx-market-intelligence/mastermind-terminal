// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverLanding from "@/components/workspaces/DiscoverLanding";
import DiscoverWorkspace from "@/components/workspaces/DiscoverWorkspace";
import { resolveShellTarget } from "@/lib/sharedShellContracts";
import { sharedShellCatalog } from "@/lib/sharedShellRoutes";

const locale = vi.hoisted(() => ({ lang: "en" }));
const renderTool = vi.hoisted(() => ({ screener: vi.fn(), heatmap: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useLang: () => locale, useT: () => (key: string) => key }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({}) }));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation", () => ({
  useOptionalSharedShellPresentation: () => ({ context: { locale: locale.lang } }),
}));
vi.mock("@/components/ScreenerView", () => ({
  default: () => {
    renderTool.screener();
    return <main data-discover-tool="screener" />;
  },
}));
vi.mock("@/components/heatmap/HeatmapPageRoot", () => ({
  default: () => {
    renderTool.heatmap();
    return <main data-discover-tool="heatmap" />;
  },
}));
vi.mock("@/components/workspaces/DiscoverFlowMounts", () => ({
  DiscoverLeadersMount: () => null,
  DiscoverRadarMount: () => null,
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { locale.lang = "en"; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("Discover question chooser", () => {
  it("opens each incumbent tool and the independent company-search scope", async () => {
    const onSelect = vi.fn(), onSearchCompanies = vi.fn();
    await act(async () => root.render(<DiscoverLanding ready onSelect={onSelect} onSearchCompanies={onSearchCompanies} />));
    const buttons = Array.from(host.querySelectorAll("button"));
    for (const label of ["Open Stock Screener", "Open Heatmap", "Open Sectors", "Leaders", "Leader Radar", "Open study"]) {
      const button = buttons.find(item => item.textContent?.trim() === label)!;
      expect(button.type).toBe("button");
      await act(async () => button.click());
    }
    expect(onSelect.mock.calls.map(([key]) => key)).toEqual(["screener", "heatmap", "sectors", "leaders", "radar", "rs-pivot"]);
    await act(async () => buttons.find(item => item.textContent?.trim() === "Search companies")!.click());
    expect(onSearchCompanies).toHaveBeenCalledTimes(1);
    for (const link of host.querySelectorAll("a")) {
      expect(resolveShellTarget(link.getAttribute("href")!, "/discover", "https://beta.mastermind-x.com", "https://www.mastermind-x.com", sharedShellCatalog).kind).toBe("legacy");
    }
  });
  it("uses translated chooser controls and qualified regional Prophet wording", async () => {
    locale.lang = "zh";
    await act(async () => root.render(<DiscoverLanding ready onSelect={vi.fn()} onSearchCompanies={vi.fn()} />));
    expect(host.querySelector("h1")?.textContent).toBe("发现");
    expect(host.textContent).toContain("搜索公司");
    expect(host.textContent).not.toContain("Open Stock Screener");
    const prophet = host.querySelector('a[href="/us_stocks.html"]');
    expect(prophet?.textContent).toContain("美国股票");
    expect(host.querySelector('a[href="/prophet/overview.html"]')).toBeNull();
  });
});


describe("Discover tool tabs", () => {
  it("labels the active panel and keeps inactive tools unmounted through keyboard activation", async () => {
    const initialUrl = window.location.href;
    window.history.replaceState(null, "", "/discover?tab=heatmap&origin=fixture#evidence");
    renderTool.screener.mockClear();
    renderTool.heatmap.mockClear();

    try {
      await act(async () => root.render(<DiscoverWorkspace />));
      const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      expect(tabs).toHaveLength(7);

      const expectPanels = (activeKey: string) => {
        for (const tab of tabs) {
          const id = tab.getAttribute("aria-controls")!;
          const panel = document.getElementById(id);
          const active = tab.id === `wtab-${activeKey}`;
          expect(panel?.getAttribute("role")).toBe("tabpanel");
          expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
          expect(tab.getAttribute("aria-selected")).toBe(String(active));
          expect(panel?.hidden).toBe(!active);
          expect(panel?.childElementCount).toBe(active ? 1 : 0);
        }
        expect(host.querySelectorAll("[data-discover-tool]")).toHaveLength(1);
        expect(host.querySelector(`[data-discover-tool="${activeKey}"]`)).not.toBeNull();
      };

      expectPanels("heatmap");
      expect(renderTool.heatmap).toHaveBeenCalled();
      expect(renderTool.screener).not.toHaveBeenCalled();

      const heatmap = host.querySelector<HTMLButtonElement>("#wtab-heatmap")!;
      heatmap.focus();
      await act(async () => {
        heatmap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      });

      expectPanels("screener");
      expect(renderTool.screener).toHaveBeenCalled();
      expect(document.activeElement?.id).toBe("wtab-screener");
      expect(window.location.search).toBe("?tab=screener&origin=fixture");
      expect(window.location.hash).toBe("#evidence");
    } finally {
      window.history.replaceState(null, "", initialUrl);
    }
  });
});
