// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayDeskDestinations from "@/components/workspaces/TodayDeskDestinations";
import routes from "@/lib/sharedShellRoutes.generated.json";
import { SHARED_SHELL_MARKETS } from "@/lib/sharedShellNavigation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const locale = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: locale.lang }) }));
vi.mock("next/link", () => ({ default: ({ children, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
  <a {...props} data-prefetch={String(prefetch)}>{children}</a> }));
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  locale.lang = "en"; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Destination navigation must not fetch intelligence"); }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async () => { await act(async () => root.render(<TodayDeskDestinations />)); };

describe("Today existing research destinations", () => {
  it("uses admitted routes and disables speculative loading of full workspaces", async () => {
    await render();
    const paths = new Set<string>([...routes.legacyPaths, ...routes.nativePaths]);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(8);
    for (const link of links) {
      expect(paths.has(new URL(link.href).pathname), link.getAttribute("href")!).toBe(true);
      expect(link.dataset.prefetch).toBe("false");
      expect(link.getAttribute("target")).toBeNull();
    }
    expect(container.querySelector('a[href="/discover?tab=catalysts"]')).toBeTruthy();
    expect(container.querySelector('a[href="/us_stocks.html"]')?.textContent).toContain("Prophet candidates");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reuses existing regional navigation and keeps it separate from the US reading", async () => {
    await render();
    const marketLinks = Array.from(container.querySelectorAll('[aria-label="Other market overviews"] a')).map(a => a.getAttribute("href"));
    expect(marketLinks).toEqual(SHARED_SHELL_MARKETS.filter(m => m.code !== "US").map(m => m.href));
    expect(container.textContent).not.toMatch(/\b(?:live|buy now|ranked|no risk)\b/i);
  });

  it("localizes the same destinations without changing their identity", async () => {
    await render(); const before = Array.from(container.querySelectorAll("a")).map(a => a.getAttribute("href"));
    locale.lang = "zh"; await render();
    expect(container.textContent).toContain("先知候选"); expect(container.textContent).toContain("公司催化剂");
    expect(container.textContent).toContain("香港"); expect(container.textContent).toContain("加拿大");
    expect(Array.from(container.querySelectorAll("a")).map(a => a.getAttribute("href"))).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});
