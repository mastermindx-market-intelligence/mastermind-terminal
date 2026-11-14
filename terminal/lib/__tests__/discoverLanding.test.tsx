// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverLanding from "@/components/workspaces/DiscoverLanding";
import DiscoverWorkspace from "@/components/workspaces/DiscoverWorkspace";
import { resolveShellTarget } from "@/lib/sharedShellContracts";
import { sharedShellCatalog } from "@/lib/sharedShellRoutes";
import { parseProphetState } from "@/lib/prophetUrlState";

const locale = vi.hoisted(() => ({ lang: "en" }));
const renderTool = vi.hoisted(() => ({ screener: vi.fn(), heatmap: vi.fn(), dynamic: vi.fn(), leaders: vi.fn(), radar: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useLang: () => locale, useT: () => (key: string) => key }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => { renderTool.dynamic(); return null; } }));
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
  DiscoverLeadersMount: () => { renderTool.leaders(); return null; },
  DiscoverRadarMount: () => { renderTool.radar(); return null; },
}));
vi.mock("next/link", () => ({ default: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean }) => <a href={href} {...props} data-prefetch={String(prefetch)}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  locale.lang = "en"; window.history.replaceState(null, "", "/discover?workspaceMarket=us");
  for (const render of Object.values(renderTool)) render.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("The Discover chooser must not read tool data"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Discover question chooser", () => {
  it("opens each incumbent tool and the independent company-search scope", async () => {
    const onSelect = vi.fn(), onSearchCompanies = vi.fn();
    await act(async () => root.render(<DiscoverLanding ready onSelect={onSelect} onSearchCompanies={onSearchCompanies} />));
    const buttons = Array.from(host.querySelectorAll("button"));
    for (const label of ["Open Stock Screener", "Open Heatmap", "Open Sectors", "Open Leaders", "Open Leader Radar", "Open study", "Open Catalyst Intelligence"]) {
      const button = buttons.find(item => item.textContent?.trim() === label)!;
      expect(button.type).toBe("button");
      await act(async () => button.click());
    }
    expect(onSelect.mock.calls.map(([key]) => key)).toEqual(["screener", "heatmap", "sectors", "leaders", "radar", "rs-pivot", "catalysts"]);
    await act(async () => buttons.find(item => item.textContent?.trim() === "Search companies")!.click());
    expect(onSearchCompanies).toHaveBeenCalledTimes(1);
    const links = Array.from(host.querySelectorAll("a"));
    expect(links.map(link => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
      ["Open candidates", "/prophet?tab=candidates&workspaceMarket=us"],
      ["Full US stock workspace", "/us_stocks.html"],
      ["BioCatalyst Intelligence", "/biocatalyst.html"],
      ["Open Signal Board", "/confluence_screener.html"],
    ]);
    const candidates = new URL(links[0].href);
    expect(parseProphetState(candidates.searchParams, "canonical").lane).toBe("candidates");
    for (const link of links) {
      expect(link.dataset.prefetch).toBe("false");
      expect(link.getAttribute("target")).toBeNull();
      expect(resolveShellTarget(link.getAttribute("href")!, "/discover", "https://beta.mastermind-x.com", "https://www.mastermind-x.com", sharedShellCatalog).kind).toBe(link === links[0] ? "native" : "legacy");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses translated chooser controls and qualified regional Prophet wording", async () => {
    locale.lang = "zh";
    await act(async () => root.render(<DiscoverLanding ready onSelect={vi.fn()} onSearchCompanies={vi.fn()} />));
    expect(host.querySelector("h1")?.textContent).toBe("发现");
    expect(host.textContent).toContain("搜索公司");
    expect(host.textContent).not.toContain("Open Stock Screener");
    const prophet = host.querySelector('a[href="/us_stocks.html"]');
    expect(prophet?.textContent).toBe("完整美股工作区");
    expect(host.textContent).toContain("生物医药催化剂情报");
    expect(host.textContent).toContain("信号看板");
    expect(host.textContent).toContain("打开催化剂情报");
    expect(host.querySelector('a[href="/prophet/overview.html"]')).toBeNull();
  });
  it("keeps every engine and its saved filters unmounted while choosing", async () => {
    const reads = vi.spyOn(Storage.prototype, "getItem"), writes = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => root.render(<DiscoverWorkspace />));
    expect(host.querySelectorAll("main")).toHaveLength(1);
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    for (const render of Object.values(renderTool)) expect(render).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Saved in this browser");
    expect(host.textContent).not.toContain("on top of the existing screen");
  });
  it("uses the existing URL market for native handoff without changing regional depth links", async () => {
    window.history.replaceState(null, "", "/discover?workspaceMarket=hk&origin=fixture#source");
    await act(async () => root.render(<DiscoverLanding ready onSelect={vi.fn()} onSearchCompanies={vi.fn()} />));
    expect(host.querySelector('a[href="/prophet?tab=candidates&workspaceMarket=hk"]')).not.toBeNull();
    expect(host.querySelector('a[href="/us_stocks.html"]')?.textContent).toBe("Full US stock workspace");
    expect(window.location.search).toBe("?workspaceMarket=hk&origin=fixture");
    expect(window.location.hash).toBe("#source");
    expect(fetch).not.toHaveBeenCalled();
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
      expect(tabs).toHaveLength(6);

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
