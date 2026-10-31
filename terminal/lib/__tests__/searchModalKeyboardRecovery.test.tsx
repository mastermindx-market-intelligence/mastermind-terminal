// @vitest-environment jsdom
// Mount the real modal, deferred query, ranking, recent history, and EN/ZH lexicon.
// Removing the zero-row ArrowDown guard must break unchanged-query recovery.
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchModal from "@/components/SearchModal";
import { LangProvider, LEX } from "@/lib/i18n";
import { RECENTLY_VIEWED_KEY } from "@/lib/recentlyViewed";

// These unrelated service boundaries must not start onboarding or send analytics.
vi.mock("@/components/onboarding/OnboardingProvider", () => ({
  useOnboarding: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof SearchModal>;
const MANIFEST: Props["manifest"] = {
  AAPL: { name: "Apple Inc.", zh: "苹果公司", col: "#777", verdict: null, sec: "Stock", mkt: "NASDAQ" },
  AAPX: { name: "Apple Example", zh: "苹果示例", col: "#777", verdict: null, sec: "Stock", mkt: "NASDAQ" },
  MSFT: { name: "Microsoft", zh: "微软", col: "#777", verdict: null, sec: "Stock", mkt: "NASDAQ" },
};
const NO_WATCHLIST = new Set<string>();
let host: HTMLDivElement;
let root: Root;
let props: Props;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute("data-lang", "en");
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false, media, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => true,
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  props = {
    open: true, seed: "", mode: "pick", manifest: {}, inWatchlist: NO_WATCHLIST,
    universeState: "loading", onClose: vi.fn(), onPick: vi.fn(), onRetryUniverse: vi.fn(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  document.documentElement.removeAttribute("data-lang");
  vi.unstubAllGlobals();
});

async function render(update: Partial<Props> = {}) {
  props = { ...props, ...update };
  await act(async () => {
    // SymbolPicker mounts/unmounts the modal at its open boundary.
    root.render(<LangProvider>{props.open && <SearchModal {...props} />}</LangProvider>);
  });
}

const input = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
const options = () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));
const symbols = () => options().map(row => row.querySelector(".tk")?.textContent);

async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  act(() => { input().dispatchEvent(event); });
  return event;
}

function selected(symbol: string) {
  const rows = options();
  const chosen = rows.filter(row => row.getAttribute("aria-selected") === "true");
  expect(chosen).toHaveLength(1);
  expect(chosen[0].querySelector(".tk")?.textContent).toBe(symbol);
  expect(chosen[0].closest(".r")?.classList.contains("sel")).toBe(true);
  expect(input().getAttribute("aria-activedescendant")).toBe(chosen[0].id);
  expect(document.getElementById(chosen[0].id)).toBe(chosen[0]);
  expect(input().getAttribute("aria-expanded")).toBe("true");
  expect(input().getAttribute("aria-controls")).toBe(chosen[0].closest('[role="listbox"]')?.id);
}

function empty() {
  expect(options()).toHaveLength(0);
  expect(input().getAttribute("aria-activedescendant")).toBeNull();
  expect(input().getAttribute("aria-expanded")).toBe("false");
  expect(props.onPick).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
}

describe.each(["en", "zh"] as const)("SearchModal keyboard recovery (%s)", lang => {
  const query = lang === "zh" ? "苹果" : "apple";

  async function mount(update: Partial<Props> = {}) {
    document.documentElement.setAttribute("data-lang", lang);
    await render(update);
    expect(input().placeholder).toBe(LEX.searchInputPlaceholder[lang === "zh" ? 1 : 0]);
    await type(query); // act settles the real deferred value before the empty-list keys.
    expect(input().value).toBe(query);
  }

  it.each(["pick", "go"] as const)("selects the first arriving match after empty ArrowDown in %s mode", async mode => {
    await mount({ mode });
    const originalInput = input();
    const originalListbox = originalInput.getAttribute("aria-controls");
    empty();
    for (let i = 0; i < 3; i++) expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(key("Enter").defaultPrevented).toBe(true);
    empty();

    await render({ manifest: MANIFEST, universeState: "ready" });
    expect(input()).toBe(originalInput);
    expect(input().getAttribute("aria-controls")).toBe(originalListbox);
    expect(input().value).toBe(query);
    expect(symbols()).toEqual(["AAPL", "AAPX"]);
    selected("AAPL");
    expect(options()[0].querySelector(".nm")?.textContent).toBe(lang === "zh" ? "苹果公司" : "Apple Inc.");
    key("Enter");
    expect(props.onPick).toHaveBeenCalledTimes(1);
    expect(props.onPick).toHaveBeenCalledWith("AAPL");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("recovers the same query when Retry transitions through an empty pending universe", async () => {
    await mount({ universeState: "unavailable" });
    const retryButton = host.querySelector<HTMLButtonElement>(".s-universe-failed button");
    expect(retryButton?.textContent).toBe(LEX.searchUniverseRetry[lang === "zh" ? 1 : 0]);
    expect(retryButton).toBeTruthy();
    act(() => { retryButton!.click(); });
    expect(props.onRetryUniverse).toHaveBeenCalledTimes(1);
    await render({ universeState: "loading" });
    for (let i = 0; i < 3; i++) key("ArrowDown");
    empty();
    const originalInput = input();
    await render({ manifest: MANIFEST, universeState: "ready" });
    expect(input()).toBe(originalInput);
    expect(input().value).toBe(query);
    selected("AAPL");
    key("Enter");
    expect(props.onPick).toHaveBeenCalledTimes(1);
    expect(props.onPick).toHaveBeenCalledWith("AAPL");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a genuinely empty universe inert under arrows and Enter", async () => {
    await mount({ universeState: "ready" });
    for (const value of ["ArrowDown", "ArrowDown", "ArrowUp", "Enter"]) {
      expect(key(value).defaultPrevented).toBe(true);
      empty();
    }
  });

  it("preserves populated arrow bounds and one Enter selection", async () => {
    await mount({ manifest: MANIFEST, universeState: "ready" });
    selected("AAPL");
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    selected("AAPL");
    for (let i = 0; i < 3; i++) expect(key("ArrowDown").defaultPrevented).toBe(true);
    selected("AAPX");
    key("ArrowUp"); selected("AAPL");
    key("ArrowDown"); key("Enter");
    expect(props.onPick).toHaveBeenCalledTimes(1);
    expect(props.onPick).toHaveBeenCalledWith("AAPX");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("resets selection on a changed query and on clearing back to Recent", async () => {
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(["MSFT", "AAPL"]));
    await mount({ manifest: MANIFEST, universeState: "ready" });
    key("ArrowDown"); selected("AAPX");
    await type("aap"); selected("AAPL");
    key("ArrowDown"); selected("AAPX");
    await type("");
    expect(symbols()).toEqual(["MSFT", "AAPL"]);
    selected("MSFT");
    expect(props.onPick).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("reopens cleanly after closing while the universe is still loading", async () => {
    await mount();
    key("ArrowDown"); key("Escape");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await render({ open: false });
    await render({ manifest: MANIFEST, universeState: "ready" });
    expect(input()).toBeNull();
    expect(props.onPick).not.toHaveBeenCalled();
    await render({ open: true });
    expect(input().value).toBe("");
    await type(query);
    selected("AAPL");
  });

  it("preserves mouse selection after matches arrive", async () => {
    await mount();
    key("ArrowDown");
    await render({ manifest: MANIFEST, universeState: "ready" });
    act(() => { options()[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    selected("AAPX");
    act(() => { options()[1].click(); });
    expect(props.onPick).toHaveBeenCalledTimes(1);
    expect(props.onPick).toHaveBeenCalledWith("AAPX");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
