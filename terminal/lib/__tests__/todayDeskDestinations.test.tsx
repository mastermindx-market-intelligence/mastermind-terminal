// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayDeskDestinations from "@/components/workspaces/TodayDeskDestinations";
import routes from "@/lib/sharedShellRoutes.generated.json";
import { parseSectorState } from "@/lib/sectorIntelligence";
import { parseProphetState } from "@/lib/prophetUrlState";

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
    expect(links).toHaveLength(5);
    for (const link of links) {
      expect(paths.has(new URL(link.href).pathname), link.getAttribute("href")!).toBe(true);
      expect(link.dataset.prefetch).toBe("false");
      expect(link.getAttribute("target")).toBeNull();
    }
    expect(container.querySelector('a[href="/discover?tab=catalysts"]')).toBeTruthy();
    expect(container.querySelector('a[href="/us_stocks.html"]')?.textContent).toContain("Full US stock workspace");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enters the native candidate and Explore owners while global chrome keeps market selection", async () => {
    await render();
    const candidates=new URL(container.querySelector<HTMLAnchorElement>('a[href^="/prophet?"]')!.href);
    const sectors=new URL(container.querySelector<HTMLAnchorElement>('a[href^="/sectors?"]')!.href);
    expect(candidates.pathname).toBe("/prophet");
    expect(parseProphetState(candidates.searchParams,"canonical").lane).toBe("candidates");
    expect(parseSectorState(sectors.searchParams,sectors.pathname).sectorJob).toBe("explore");
    expect(candidates.searchParams.get("workspaceMarket")).toBe("us");expect(sectors.searchParams.get("workspaceMarket")).toBe("us");
    expect(container.querySelector('[aria-label="Other market overviews"]')).toBeNull();
    expect(container.querySelector('a[href="/macro_context.html"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b(?:live|buy now|ranked|no risk)\b/i);
  });

  it("localizes the same destinations without changing their identity", async () => {
    await render(); const before = Array.from(container.querySelectorAll("a")).map(a => a.getAttribute("href"));
    locale.lang = "zh"; await render();
    expect(container.textContent).toContain("先知候选"); expect(container.textContent).toContain("公司催化剂");
    expect(container.textContent).toContain("完整的美股工作区");expect(container.textContent).toContain("完整的已发布候选池");
    expect(Array.from(container.querySelectorAll("a")).map(a => a.getAttribute("href"))).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});
