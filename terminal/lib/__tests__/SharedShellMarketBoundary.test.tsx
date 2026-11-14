// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Boundary from "@/components/chrome/shared-shell/SharedShellMarketBoundary";
import { SHARED_SHELL_COPY } from "@/lib/sharedShellCopy";

const scope = vi.hoisted(() => ({ path: "/sectors", search: "workspaceMarket=us", lang: "en" as "en" | "zh" }));
vi.mock("next/navigation", () => ({ usePathname: () => scope.path, useSearchParams: () => new URLSearchParams(scope.search) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/sharedShellCopy", async original => {
  const actual = await original<typeof import("@/lib/sharedShellCopy")>();
  return { ...actual, useSharedShellT: () => (key: string) => actual.SHARED_SHELL_COPY[key](scope.lang) };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  scope.path = "/sectors"; scope.search = "workspaceMarket=us"; scope.lang = "en";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  window.history.replaceState({}, "", "/sectors?workspaceMarket=us");
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("unmounts a US consumer before showing another market and ignores its late response", async () => {
  const mounted = vi.fn(), cleanup = vi.fn();
  let resolve!: (value: string) => void;
  function Consumer() {
    const [reading, setReading] = useState("Loading US");
    useEffect(() => { mounted(); let current = true;
      new Promise<string>(done => { resolve = done; }).then(value => { if (current) setReading(value); });
      return () => { current = false; cleanup(); };
    }, []);
    return <div data-reading>{reading}</div>;
  }
  const render = () => act(async () => root.render(<Boundary><Consumer /></Boundary>));
  await render(); expect(mounted).toHaveBeenCalledTimes(1);
  scope.search = "workspaceMarket=cn"; await render();
  expect(cleanup).toHaveBeenCalledTimes(1); expect(host.querySelector("[data-reading]")).toBeNull();
  expect(host.textContent).toContain("China");
  await act(async () => resolve("Late US result"));
  expect(host.textContent).not.toContain("Late US result");
  scope.search = "workspaceMarket=hk"; await render();
  expect(mounted).toHaveBeenCalledTimes(1); expect(host.textContent).toContain("Hong Kong");
  expect(host.querySelector('a[href="/hk.html"]')).not.toBeNull();
  scope.search = "workspaceMarket=us"; await render(); expect(mounted).toHaveBeenCalledTimes(2);
});

it("keeps a personal workspace mounted while research context changes", async () => {
  const mounted = vi.fn();
  function Portfolio() { useEffect(() => { mounted(); }, []); return <p>All actual holdings</p>; }
  scope.path = "/portfolio";
  await act(async () => root.render(<Boundary><Portfolio /></Boundary>));
  scope.search = "workspaceMarket=cn";
  await act(async () => root.render(<Boundary><Portfolio /></Boundary>));
  expect(mounted).toHaveBeenCalledTimes(1); expect(host.textContent).toBe("All actual holdings");
});

it("provides localized coverage and lossless recovery for an unqualified deep link", async () => {
  scope.path = "/specialty.html"; scope.search = "workspaceMarket=cn&subject=abc"; scope.lang = "zh";
  window.history.replaceState({}, "", "/specialty.html?workspaceMarket=cn&subject=abc#details");
  await act(async () => root.render(<Boundary><p>Must remain hidden</p></Boundary>));
  expect(host.textContent).toContain(SHARED_SHELL_COPY.shellMarketCoverageTitle("zh"));
  expect(host.querySelector('a[href="/specialty.html?subject=abc#details"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Must remain hidden");
});

it("offers the resolved US engine when an unavailable selection starts from a China route", async () => {
  scope.path = "/sector_central_china.html"; scope.search = "workspaceMarket=hk";
  window.history.replaceState({}, "", "/sector_central_china.html?workspaceMarket=hk");
  await act(async () => root.render(<Boundary><p>Hidden China engine</p></Boundary>));
  expect(host.querySelector('a[href="/sector_central.html"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Hidden China engine");
});
