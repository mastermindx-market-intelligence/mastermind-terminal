// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceTabsProps } from "@/components/chrome/WorkspaceTabs";
import type { TabKey } from "@/components/OptionsHubView";
import OptionsWorkspace from "@/components/workspaces/OptionsWorkspace";

const hub = vi.hoisted(() => ({ mounts: 0 }));
const router = vi.hoisted(() => ({ frozenSearch: null as string | null }));
vi.mock("next/navigation", () => ({
  // Each render receives the current query, as Next's router supplies it after
  // native history navigation. Browser integration is covered by Playwright.
  useSearchParams: () => new URLSearchParams(router.frozenSearch ?? window.location.search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: "en" }),
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}));
vi.mock("@/lib/futuresUiCopy", () => ({ useFuturesText: () => (key: string) => key }));
// Navigation exercises the real Statistics view with an explicitly absent snapshot.
// Source transport and decoder behavior have their own contract/browser coverage.
vi.mock("@/lib/flowStream", () => ({
  useFlowStream: () => ({ data: null, connected: false, error: false, status: "absent", stale: false, retry: vi.fn() }),
}));
vi.mock("@/components/options/OptionsWorkflowGuide", () => ({ default: () => null }));
vi.mock("@/components/chrome/WorkspaceTabs", () => ({
  default: ({ tabs, active, onSelect }: WorkspaceTabsProps) => <nav>
    {tabs.map(({ key }) => <button key={key} id={`wtab-${key}`} role="tab" aria-selected={active === key}
      onClick={() => onSelect(key)}>{key}</button>)}
  </nav>,
}));
vi.mock("@/components/OptionsHubView", () => ({
  default: function Hub({ activeTab, onTab }: { activeTab: TabKey; onTab: (tab: TabKey) => void }) {
    const [instance] = React.useState(() => ++hub.mounts);
    return <section data-hub-view={activeTab} data-hub-instance={instance}>
      <button id="hub-tickers" onClick={() => onTab("tickers")}>Open ticker drill</button>
    </section>;
  },
}));

let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  hub.mounts = 0;
  router.frozenSearch = null;
  window.history.replaceState(null, "", "/options?tab=tape");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

const render = () => act(async () => root.render(<OptionsWorkspace />));
async function navigate(query: string) {
  window.history.replaceState(null, "", `/options${query}`);
  await render();
}
const active = (key: string) => node.querySelector(`#wtab-${key}`)?.getAttribute("aria-selected");
const view = () => node.querySelector("[data-hub-view]")?.getAttribute("data-hub-view");

it.each([
  ["?tab=prism", "gex", "exposure"],
  ["?tab=0dte", "zero_dte", "flow"],
  ["?tab=screener", "screener", "flow"],
  ["?tab=unknown", "tape", "flow"],
  ["?tab=constructor", "tape", "flow"],
  ["?tab=__proto__", "tape", "flow"],
  ["", "tape", "flow"],
])("selects %s synchronously without rewriting its URL", async (query, expectedView, category) => {
  await navigate(query);
  expect(view()).toBe(expectedView);
  expect(active(`cat-${category}`)).toBe("true");
  expect(window.location.search).toBe(query);
});

it("follows later query changes in the same mounted workspace and retains the Hub", async () => {
  await render();
  const instance = node.querySelector("[data-hub-instance]");
  await navigate("?tab=structure&root=QQQ&keep=original");
  expect(view()).toBe("structure");
  expect(active("cat-structure")).toBe("true");
  expect(node.querySelector("#wtab-structure")).toBeNull(); // a single-view category has no redundant second row
  await navigate("?tab=prism&root=QQQ&keep=original");
  expect(view()).toBe("gex");
  expect(active("cat-exposure")).toBe("true");
  expect(window.location.search).toBe("?tab=prism&root=QQQ&keep=original");
  expect(node.querySelector("[data-hub-instance]")).toBe(instance);
  expect(hub.mounts).toBe(1);
});

it("enters and leaves Statistics without inventing values when its snapshot is absent", async () => {
  await render();
  await navigate("?tab=statistics");
  expect(active("cat-statistics")).toBe("true");
  const statistics = node.querySelector('[data-options-ia-state="statistics-observed"]');
  expect(statistics).not.toBeNull();
  expect(statistics?.querySelector('[data-statistics-state="unavailable"]')?.textContent).toContain("No qualified observations yet");
  expect(statistics?.querySelector("table")).toBeNull();
  expect(view()).toBeUndefined();
  await navigate("?tab=volatility");
  expect(view()).toBe("volatility");
  expect(active("cat-volatility")).toBe("true");
  expect(node.querySelector('[data-options-ia-state="statistics-observed"]')).toBeNull();
});

it("preserves unrelated query context and the Hub on category and internal drill selections", async () => {
  await navigate("?tab=tape&root=QQQ&view=matrix&tapeView=opaque&keep=original#details");
  const instance = node.querySelector("[data-hub-instance]");
  await act(async () => node.querySelector<HTMLButtonElement>("#wtab-cat-structure")!.click());
  await render();
  expect(view()).toBe("structure");
  expect(active("cat-structure")).toBe("true");
  await act(async () => node.querySelector<HTMLButtonElement>("#hub-tickers")!.click());
  await render();
  expect(view()).toBe("tickers");
  expect(active("cat-flow")).toBe("true");
  const url = new URL(window.location.href);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    tab: "tickers", root: "QQQ", view: "matrix", tapeView: "opaque", keep: "original",
  });
  expect(url.hash).toBe("#details");
  expect(node.querySelector("[data-hub-instance]")).toBe(instance);
  expect(hub.mounts).toBe(1);
});

it("offers every desk in its owning group and changes view without losing the existing path context", async () => {
  await navigate("?tab=prism&root=QQQ#details");
  const picker = node.querySelector<HTMLSelectElement>(".options-ia-category-row select")!;
  expect(picker.value).toBe("gex");
  expect([...picker.querySelectorAll("optgroup")].map(group => group.children.length)).toEqual([1, 7, 3, 1, 1, 1, 1]);
  expect(node.querySelector("#options-active-view")?.getAttribute("aria-labelledby")).toBe("wtab-gex");

  await act(async () => {
    picker.value = "0dte";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await render();
  expect(view()).toBe("zero_dte");
  expect(picker.value).toBe("0dte");
  expect(window.location.search + window.location.hash).toBe("?tab=0dte&root=QQQ#details");

  const before = window.history.length;
  await act(async () => node.querySelector<HTMLButtonElement>("#wtab-cat-flow")!.click());
  await render();
  expect(view()).toBe("zero_dte");
  expect(window.history.length).toBe(before);
  expect(hub.mounts).toBe(1);
});


it("keeps an owned selection immediate while Next's query transition lags, then follows Back/Forward", async () => {
  router.frozenSearch = "?tab=prism&root=QQQ&keep=original";
  window.history.replaceState(null, "", "/options?tab=prism&root=QQQ&keep=original#details");
  await render();
  const instance = node.querySelector("[data-hub-instance]");
  expect(view()).toBe("gex");

  // Next wraps native-history query propagation in a transition. A cold desk
  // can suspend that render even though pushState has already changed the URL.
  const picker = node.querySelector<HTMLSelectElement>(".options-ia-category-row select")!;
  await act(async () => {
    picker.value = "structure";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // No manual render: the workspace must observe its own write immediately.
  expect(window.location.search + window.location.hash).toBe("?tab=structure&root=QQQ&keep=original#details");
  expect(view()).toBe("structure");
  expect(active("cat-structure")).toBe("true");

  // A stale router render cannot take precedence over the current browser URL.
  await render();
  expect(view()).toBe("structure");

  await act(async () => {
    window.history.replaceState(null, "", "/options?tab=prism&root=QQQ&keep=original#details");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(view()).toBe("gex");
  expect(active("cat-exposure")).toBe("true");
  await act(async () => {
    window.history.replaceState(null, "", "/options?tab=structure&root=QQQ&keep=original#details");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(view()).toBe("structure");
  expect(window.location.search + window.location.hash).toBe("?tab=structure&root=QQQ&keep=original#details");
  expect(node.querySelector("[data-hub-instance]")).toBe(instance);
  expect(hub.mounts).toBe(1);
});


it("observes a Next query whose browser URL is written after render", async () => {
  function RouterCommit({ url }: { url: string }) {
    React.useInsertionEffect(() => {
      window.history.replaceState(null, "", url);
    }, [url]);
    return <OptionsWorkspace />;
  }
  router.frozenSearch = "?tab=prism&root=QQQ";
  window.history.replaceState(null, "", "/options?tab=prism&root=QQQ#details");
  await act(async () => root.render(<RouterCommit url="/options?tab=prism&root=QQQ#details" />));
  const instance = node.querySelector("[data-hub-instance]");
  expect(view()).toBe("gex");

  router.frozenSearch = "?tab=structure&root=QQQ";
  await act(async () => root.render(<RouterCommit url="/options?tab=structure&root=QQQ#details" />));
  expect(view()).toBe("structure");
  expect(active("cat-structure")).toBe("true");
  expect(window.location.search + window.location.hash).toBe("?tab=structure&root=QQQ#details");
  expect(node.querySelector("[data-hub-instance]")).toBe(instance);
  expect(hub.mounts).toBe(1);
});
