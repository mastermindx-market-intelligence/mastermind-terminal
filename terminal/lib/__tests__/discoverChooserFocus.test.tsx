// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverWorkspace from "@/components/workspaces/DiscoverWorkspace";

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useSearchParams: () => {
    const search = useSyncExternalStore(callback => {
      window.addEventListener("mmx:shell-location", callback);
      return () => window.removeEventListener("mmx:shell-location", callback);
    }, () => window.location.search, () => window.location.search);
    return new URLSearchParams(search);
  } };
});
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/dynamic", () => ({ default: () => () => <button>Study action</button> }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }), useT: () => (key: string) => key }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({}) }));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation", () => ({ useOptionalSharedShellPresentation: () => ({ context: { locale: "en" } }) }));
vi.mock("@/components/ScreenerView", () => ({ default: () => <button>Screener action</button> }));
vi.mock("@/components/heatmap/HeatmapPageRoot", () => ({ default: () => <button>Heatmap action</button> }));
vi.mock("@/components/workspaces/DiscoverFlowMounts", () => ({ DiscoverLeadersMount: () => <button>Leaders action</button>, DiscoverRadarMount: () => <button>Radar action</button> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root, external: HTMLButtonElement;
beforeEach(() => {
  window.history.replaceState(null, "", "/discover");
  external = document.createElement("button"); external.textContent = "Shell action"; document.body.append(external); external.focus();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); external.remove(); vi.restoreAllMocks(); });
const render = () => act(async () => root.render(<DiscoverWorkspace />));
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text)!;
const selected = () => host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
async function activate(target: HTMLButtonElement) { target.focus(); await act(async () => target.click()); }
function navigate(query: string) { window.history.pushState(null, "", "/discover" + query); window.dispatchEvent(new Event("mmx:shell-location")); }

describe("Discover chooser focus continuity", () => {
  it("keeps server-rendered actions unavailable until their owner hydrates and ready on return", async () => {
    await act(async () => root.unmount());
    host.innerHTML = renderToString(<DiscoverWorkspace />);
    const actions = () => [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(actions()).toHaveLength(7);
    expect(actions().every(action => action.disabled)).toBe(true);
    expect(document.activeElement).toBe(external);

    await act(async () => { root = hydrateRoot(host, <DiscoverWorkspace />); });
    expect(actions().every(action => !action.disabled)).toBe(true);
    expect(document.activeElement).toBe(external);
    await activate(button("Open Heatmap"));
    expect(selected().id).toBe("wtab-heatmap");
    expect(document.activeElement).toBe(selected());
    await activate(button("Discover ←"));
    expect(actions()).toHaveLength(7);
    expect(actions().every(action => !action.disabled)).toBe(true);
    expect(document.activeElement).toBe(host.querySelector("h1"));
  });

  it.each([["Open Heatmap", "heatmap"], ["Open Stock Screener", "screener"], ["Open study", "rs-pivot"]])("continues from %s into the selected tool and back to the chooser", async (label, key) => {
    await render(); expect(document.activeElement).toBe(external);
    await activate(button(label));
    expect(selected().id).toBe(`wtab-${key}`); expect(document.activeElement).toBe(selected());
    await activate(button("Discover ←"));
    const heading = host.querySelector("h1")!;
    expect(document.activeElement).toBe(heading); expect(heading.tabIndex).toBe(-1);
    external.focus(); await render(); expect(document.activeElement).toBe(external);
  });

  it("leaves direct loads and external URL changes in control of their existing focus", async () => {
    window.history.replaceState(null, "", "/discover?tab=heatmap");
    await render(); expect(document.activeElement).toBe(external);
    await act(async () => navigate("?tab=rs-pivot"));
    expect(selected().id).toBe("wtab-rs-pivot"); expect(document.activeElement).toBe(external);
    await act(async () => navigate("")); expect(document.activeElement).toBe(external);
  });

  it("preserves ordinary tab-key navigation after a chooser launch", async () => {
    await render(); await activate(button("Open Heatmap"));
    await act(async () => selected().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    expect(selected().id).toBe("wtab-sectors"); expect(document.activeElement).toBe(selected());
  });

  it("does not steal focus from a newer interaction before the view commits", async () => {
    await render(); const launch = button("Open Heatmap"); launch.focus();
    await act(async () => { launch.click(); external.focus(); });
    expect(selected().id).toBe("wtab-heatmap"); expect(document.activeElement).toBe(external);
  });

  it("cancels a superseded launch instead of carrying it into a later URL change", async () => {
    await render(); const launch = button("Open Heatmap"); launch.focus();
    await act(async () => { launch.click(); navigate("?tab=leaders"); });
    expect(selected().id).toBe("wtab-leaders"); expect(document.activeElement).not.toBe(selected());
    external.focus(); await act(async () => navigate("?tab=heatmap"));
    expect(document.activeElement).toBe(external);
  });

  it("cancels a return superseded by the same tool before a later unrelated chooser visit", async () => {
    await render(); await activate(button("Open Heatmap"));
    const back = button("Discover ←"); back.focus();
    await act(async () => { back.click(); navigate("?tab=heatmap"); });
    expect(selected().id).toBe("wtab-heatmap");
    await act(async () => navigate(""));
    expect(document.activeElement).not.toBe(host.querySelector("h1"));
  });
});

describe("MedTech on the current Discover tab owner", () => {
  const expectPanels = (activeKey: string) => {
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(8);
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute("aria-controls")!)!;
      const active = tab.id === `wtab-${activeKey}`;
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(panel.hidden).toBe(!active);
      expect(panel.childElementCount).toBe(active ? 1 : 0);
      expect(tab.getAttribute("aria-selected")).toBe(String(active));
    }
  };

  it("keeps MedTech between Catalysts and Leaders in keyboard history and returns focus to the chooser", async () => {
    window.history.replaceState(null, "", "/discover?tab=catalysts&origin=fixture#revision");
    await render();
    expectPanels("catalysts");
    selected().focus();

    for (const [key, active] of [["ArrowRight", "medtech"], ["ArrowRight", "leaders"], ["ArrowLeft", "medtech"]]) {
      await act(async () => selected().dispatchEvent(new KeyboardEvent("keydown", {
        key, bubbles: true, cancelable: true,
      })));
      expect(selected().id).toBe(`wtab-${active}`);
      expect(document.activeElement).toBe(selected());
      expectPanels(active);
      expect(window.location.search).toBe(`?tab=${active}&origin=fixture`);
      expect(window.location.hash).toBe("#revision");
    }

    await activate(button("Discover ←"));
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector("h1"));
    expect(window.location.search).toBe("?origin=fixture");
    expect(window.location.hash).toBe("#revision");
  });

  it("admits a direct MedTech URL without stealing existing shell focus", async () => {
    window.history.replaceState(null, "", "/discover?tab=medtech&origin=direct#revision");
    await render();
    expect(selected().id).toBe("wtab-medtech");
    expect(selected().textContent).toBe("MedTech");
    expectPanels("medtech");
    expect(document.activeElement).toBe(external);
  });
});
