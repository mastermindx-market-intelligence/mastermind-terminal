// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverLanding from "@/components/workspaces/DiscoverLanding";
import { resolveShellTarget } from "@/lib/sharedShellContracts";
import { sharedShellCatalog } from "@/lib/sharedShellRoutes";

const locale = vi.hoisted(() => ({ lang: "en" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => locale }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { locale.lang = "en"; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("Discover question chooser", () => {
  it("opens each incumbent tool and the independent company-search scope", async () => {
    const onSelect = vi.fn(), onSearchCompanies = vi.fn();
    await act(async () => root.render(<DiscoverLanding onSelect={onSelect} onSearchCompanies={onSearchCompanies} />));
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
    await act(async () => root.render(<DiscoverLanding onSelect={vi.fn()} onSearchCompanies={vi.fn()} />));
    expect(host.querySelector("h1")?.textContent).toBe("发现");
    expect(host.textContent).toContain("搜索公司");
    expect(host.textContent).not.toContain("Open Stock Screener");
    const prophet = host.querySelector('a[href="/us_stocks.html"]');
    expect(prophet?.textContent).toContain("美国股票");
    expect(host.querySelector('a[href="/prophet/overview.html"]')).toBeNull();
  });
});
