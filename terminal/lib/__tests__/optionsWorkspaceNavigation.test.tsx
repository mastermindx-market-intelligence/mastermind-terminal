// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceTabsProps } from "@/components/chrome/WorkspaceTabs";
import type { TabKey } from "@/components/OptionsHubView";
import OptionsWorkspace from "@/components/workspaces/OptionsWorkspace";

const hub = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("next/navigation", () => ({
  // Each render receives the current query, as Next's router supplies it after
  // native history navigation. Browser integration is covered by Playwright.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: "en" }),
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}));
vi.mock("@/lib/futuresUiCopy", () => ({ useFuturesText: () => (key: string) => key }));
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
  expect(active("structure")).toBe("true");
  await navigate("?tab=prism&root=QQQ&keep=original");
  expect(view()).toBe("gex");
  expect(active("cat-exposure")).toBe("true");
  expect(window.location.search).toBe("?tab=prism&root=QQQ&keep=original");
  expect(node.querySelector("[data-hub-instance]")).toBe(instance);
  expect(hub.mounts).toBe(1);
});

it("enters and leaves the Statistics gate when the query changes", async () => {
  await render();
  await navigate("?tab=statistics");
  expect(active("cat-statistics")).toBe("true");
  expect(node.querySelector('[data-options-ia-state="statistics-pending"]')).not.toBeNull();
  expect(view()).toBeUndefined();
  await navigate("?tab=volatility");
  expect(view()).toBe("volatility");
  expect(active("cat-volatility")).toBe("true");
  expect(node.querySelector('[data-options-ia-state="statistics-pending"]')).toBeNull();
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
