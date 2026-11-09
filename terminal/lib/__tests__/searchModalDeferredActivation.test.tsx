// @vitest-environment jsdom
// Controlled React scheduling only: real query state, ranking, rows, handlers and
// listing preview remain mounted. No browser/server/provider/identity is acquired.
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchModal from "@/components/SearchModal";
import { LangProvider } from "@/lib/i18n";
import { trackSearch } from "@/lib/searchTrack";
import { ALL_MARKETS, DEFAULT_PREFS } from "@/lib/markets";
const scheduling = vi.hoisted(() => ({ held: undefined as string | undefined }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useDeferredValue: <T,>(value: T) => {
    const deferred = actual.useDeferredValue(value);
    return scheduling.held === undefined ? deferred : scheduling.held as T;
  } };
});
vi.mock("@/components/onboarding/OnboardingProvider", () => ({ useOnboarding: () => ({ open: vi.fn(), close: vi.fn() }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Props = ComponentProps<typeof SearchModal>;
const MANIFEST: Props["manifest"] = {
  MU: { name: "Micron Technology", col: "#777", verdict: null, sec: "Equities" },
  MSFT: { name: "Microsoft Corp", col: "#777", verdict: null, sec: "Equities" },
};
let host: HTMLDivElement, root: Root, props: Props;
beforeEach(() => {
  scheduling.held = "m";
  localStorage.clear();
  vi.mocked(trackSearch).mockClear();
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("no external fixture transport"); }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  props = { open: true, seed: "m", mode: "pick", manifest: MANIFEST, inWatchlist: new Set(), universeState: "ready", onPick: vi.fn(), onCompanyPick: vi.fn(), onClose: vi.fn(), onAdd: vi.fn() };
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); localStorage.clear();
  document.documentElement.removeAttribute("data-lang"); vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(<LangProvider><SearchModal {...props} /></LangProvider>)); }
const input = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
const rows = () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));
const ticker = (row: HTMLElement) => row.querySelector(".tk")?.textContent;
const selected = () => ticker(rows().find(row => row.getAttribute("aria-selected") === "true")!);
async function type(value: string) {
  await act(async () => { input().focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); });
}
function key(value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  act(() => { input().dispatchEvent(event); }); return event;
}
async function pending() {
  await type("MSFT");
  expect(input().value).toBe("MSFT");
  expect(selected()).toBe("MU"); // Decisive causal boundary: the obsolete rendered option.
}
async function settle() { scheduling.held = undefined; await render(); expect(selected()).toBe("MSFT"); }
function noActivation() { expect(props.onPick).not.toHaveBeenCalled(); expect(props.onAdd).not.toHaveBeenCalled(); expect(props.onCompanyPick).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled(); expect(trackSearch).not.toHaveBeenCalled(); }
describe.each(["en", "zh"] as const)("superseded deferred-query activation (%s)", lang => {
  async function mount(mode: Props["mode"] = "pick", companyScope = false) { props.mode = mode; props.companyScope = companyScope; document.documentElement.setAttribute("data-lang", lang); await render(); expect(selected()).toBe("MU"); }
  it.each(["pick", "go"] as const)("blocks pending arrows/Enter then commits the settled MSFT row once (%s)", async mode => {
    await mount(mode); await pending();
    expect(key("Enter").defaultPrevented).toBe(true); noActivation();
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(selected()).toBe("MU");
    expect(document.activeElement).toBe(input());
    await settle(); noActivation(); key("Enter");
    expect(props.onPick).toHaveBeenCalledTimes(1); expect(props.onPick).toHaveBeenCalledWith("MSFT"); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it.each(["pick", "go"] as const)("blocks a stale pointer row but preserves its settled counterpart (%s)", async mode => {
    await mount(mode); await pending();
    await act(async () => rows()[0].click()); noActivation();
    await act(async () => rows()[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(selected()).toBe("MU");
    await settle(); noActivation(); await act(async () => rows()[0].click());
    expect(props.onPick).toHaveBeenCalledTimes(1); expect(props.onPick).toHaveBeenCalledWith("MSFT"); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it("blocks stale listing preview and preserves an explicit non-first listing plus query reason", async () => {
    await mount("pick", true); await pending();
    await act(async () => rows()[0].click());
    expect(host.querySelector("[data-company-listing]")).toBeNull(); noActivation();
    await settle(); await type("m"); expect(selected()).toBe("MU");
    const explicit = rows().find(row => ticker(row) === "MSFT")!;
    await act(async () => explicit.click());
    const detail = host.querySelector<HTMLElement>('[data-company-listing="MSFT"]')!;
    expect(detail).not.toBeNull();
    await act(async () => detail.querySelector<HTMLButtonElement>("button")!.click());
    expect(props.onCompanyPick).toHaveBeenCalledTimes(1); expect(props.onCompanyPick).toHaveBeenCalledWith("MSFT", "m");
    expect(props.onPick).not.toHaveBeenCalled(); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it("does not activate a stale inline row action", async () => {
    await mount("go"); await pending();
    const add = rows()[0].closest(".r")!.querySelector<HTMLButtonElement>(".r-act button")!;
    expect(add).not.toBeNull(); await act(async () => add.click()); noActivation();
    await settle(); noActivation();
    const currentAdd = rows()[0].closest(".r")!.querySelector<HTMLButtonElement>(".r-act button")!;
    await act(async () => currentAdd.click());
    expect(props.onAdd).toHaveBeenCalledTimes(1); expect(props.onAdd).toHaveBeenCalledWith("MSFT");
  });
  it("keeps independent market-filter recovery available during a pending query", async () => {
    await mount(); await pending();
    props.marketPrefs = { ...DEFAULT_PREFS, enabled: ALL_MARKETS.filter(market => market !== "us") };
    props.prefsReady = true;
    props.onShowAllMarkets = vi.fn(() => { props.marketPrefs = { ...DEFAULT_PREFS, enabled: [...ALL_MARKETS] }; });
    await render();
    const recovery = host.querySelector<HTMLButtonElement>(".s-mkt-show")!;
    expect(recovery).not.toBeNull();
    const list = host.querySelector('[role="listbox"]');
    expect(recovery.closest('[role="listbox"]')).toBe(list);
    expect(list?.getAttribute("aria-busy")).toBe("true");
    expect(input().value).toBe("MSFT");
    await act(async () => recovery.click());
    expect(props.onShowAllMarkets).toHaveBeenCalledTimes(1); noActivation();
    await render(); expect(selected()).toBe("MU");
    key("Enter"); noActivation();
    await settle(); noActivation(); key("Enter");
    expect(props.onPick).toHaveBeenCalledTimes(1); expect(props.onPick).toHaveBeenCalledWith("MSFT");
  });
  it("keeps Escape available while a replacement query is pending", async () => {
    await mount(); await pending(); expect(key("Escape").defaultPrevented).toBe(true);
    expect(props.onClose).toHaveBeenCalledTimes(1); expect(props.onPick).not.toHaveBeenCalled(); expect(props.onAdd).not.toHaveBeenCalled(); expect(props.onCompanyPick).not.toHaveBeenCalled();
  });
});
