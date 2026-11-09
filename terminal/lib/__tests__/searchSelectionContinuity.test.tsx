// @vitest-environment jsdom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchModal from "@/components/SearchModal";
import { LangProvider } from "@/lib/i18n";

// Hold an old deferred snapshot explicitly. This tests the stale-result interval,
// not scheduler timing; the existing composition/recovery suites use the real hook.
const deferred = vi.hoisted(() => ({ held: null as string | null }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useDeferredValue: (value: string) => {
    const current = actual.useDeferredValue(value);
    return deferred.held ?? current;
  } };
});
vi.mock("@/components/onboarding/OnboardingProvider", () => ({ useOnboarding: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsPhone: () => false, useIsMobile: () => false }));
vi.mock("@/lib/sharedShellSearchCatalog", () => ({ loadSharedSearchCatalog: async () => ({ sharedShellDirectory: [], sharedShellCatalog: { nativePaths: [], legacyPaths: [] } }) }));
vi.mock("@/components/CompanyListingIdentity", () => ({ default: ({ onOpen }: { onOpen: () => void }) => <button onClick={onOpen}>Open Analysis</button> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof SearchModal>;
const row = (name: string) => ({ name, col: "#777", verdict: null, sec: "Equities", mkt: "NASDAQ" });
const manifest: Props["manifest"] = {
  AAPL: row("Apple"), MSFT: row("Microsoft"), NVDA: row("Nvidia"),
  ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`T${String(i).padStart(2, "0")}`, row(`Sample company ${i}`)])),
};
let host: HTMLDivElement, root: Root, props: Props;

beforeEach(() => {
  deferred.held = null; localStorage.clear(); document.documentElement.setAttribute("data-lang", "en");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { open: true, seed: "", manifest, mode: "pick", active: "NVDA", inWatchlist: new Set(),
    onClose: vi.fn(), onPick: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onToggleCompare: vi.fn() };
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.clear();
});
async function render(update: Partial<Props> = {}) {
  props = { ...props, ...update };
  await act(async () => root.render(<LangProvider><SearchModal {...props} /></LangProvider>));
}
const input = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
const list = () => document.getElementById(input().getAttribute("aria-controls")!)!;
const active = () => document.getElementById(input().getAttribute("aria-activedescendant")!)!;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(value: string, shiftKey = false) {
  await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })));
}
function noCommit() {
  for (const callback of [props.onPick, props.onAdd, props.onRemove, props.onToggleCompare, props.onClose]) expect(callback).not.toHaveBeenCalled();
}
function geometry(rowHeight = 44) {
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) { return this.getAttribute("role") === "listbox" ? 200 : 0; });
  vi.spyOn(Element.prototype, "clientTop", "get").mockImplementation(function (this: Element) { return this.getAttribute("role") === "listbox" ? 2 : 0; });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.getAttribute("role") === "listbox") return new DOMRect(20, 100, 400, 204);
    if (this.getAttribute("role") === "option") {
      const scroller = this.closest('[role="listbox"]')!;
      const index = [...scroller.querySelectorAll('[role="option"]')].indexOf(this);
      return new DOMRect(20, 102 + index * rowHeight - scroller.scrollTop, 400, rowHeight);
    }
    return new DOMRect();
  });
}
function visibleActive() {
  const bounds = active().getBoundingClientRect();
  expect(bounds.top).toBeGreaterThanOrEqual(102);
  expect(bounds.bottom).toBeLessThanOrEqual(302);
}

describe("selection stays with the user", () => {
  it("repairs an out-of-range selection when the settled universe shrinks, then recovers from empty", async () => {
    geometry(); await render({ seed: "Sample" }); act(() => input().focus());
    for (let i = 0; i < 14; i++) await key("ArrowDown");
    await render({ manifest: { T00: manifest.T00, T01: manifest.T01 } });
    visibleActive(); expect(active().textContent).toContain("T01"); expect(document.activeElement).toBe(input());
    await render({ manifest: {} }); expect(input().getAttribute("aria-activedescendant")).toBeNull();
    await key("ArrowDown"); await render({ manifest: { T00: manifest.T00 } });
    visibleActive(); await key("Enter"); expect(props.onPick).toHaveBeenCalledWith("T00"); expect(props.onPick).toHaveBeenCalledTimes(1);
  });
  it("reveals keyboard movement locally and resets a deep list for a new query", async () => {
    geometry(); await render({ seed: "Sample" }); act(() => input().focus()); host.scrollTop = 37;
    for (let i = 0; i < 14; i++) { await key("ArrowDown"); visibleActive(); }
    expect(list().scrollTop).toBeGreaterThan(0); expect(document.activeElement).toBe(input()); expect(host.scrollTop).toBe(37);
    await type("Microsoft"); visibleActive(); expect(list().scrollTop).toBe(0); expect(active().textContent).toContain("MSFT"); noCommit();
  });
  it("does not scroll for hover and reveals a boundary selection even when its index stays zero", async () => {
    geometry(); await render({ seed: "Sample" }); list().scrollTop = 120;
    const first = list().querySelector('[role="option"]')!.closest(".r")!;
    await act(async () => first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
    expect(list().scrollTop).toBe(120);
    await key("ArrowUp"); visibleActive(); expect(list().scrollTop).toBe(0); noCommit();
  });
  it("reveals a restored company after the universe arrives, preserving exact identity and input focus", async () => {
    geometry(80); await render({ seed: "Sample", manifest: {}, universeState: "loading", companyScope: true,
      initialSelection: "T20", sharedSearch: { onOpenTool: vi.fn() } });
    act(() => input().focus()); await key("ArrowDown");
    await render({ manifest, universeState: "ready" }); visibleActive();
    expect(active().getAttribute("data-company-symbol")).toBe("T20"); expect(document.activeElement).toBe(input()); noCommit();
  });
});

describe("only the current query can commit", () => {
  it.each([false, true])("does not show a settled empty claim for a pending new query (shared=%s)", async shared => {
    await render({ seed: "zzzz-no-listing", companyScope: shared, sharedSearch: shared ? { onOpenTool: vi.fn() } : undefined });
    deferred.held = "zzzz-no-listing"; await type("Apple");
    const empty = shared ? list().parentElement!.querySelector<HTMLElement>('[role="status"]')! : list().querySelector<HTMLElement>(".empty")!;
    expect(empty.style.visibility).toBe("hidden"); expect(empty.getAttribute("aria-hidden")).toBe("true");
    deferred.held = null; await render(); expect(list().textContent).toContain("AAPL"); noCommit();
  });
  it.each([false, true])("does not add the chart symbol for a nonempty no-match query (shift=%s)", async shift => {
    await render({ mode: "add", seed: "zzzzzz-no-listing" });
    expect(list().querySelectorAll('[role="option"]')).toHaveLength(0);
    await key("Enter", shift); noCommit();
    await type("Apple"); await key("Enter", shift);
    expect(props.onAdd).toHaveBeenCalledTimes(1); expect(props.onAdd).toHaveBeenCalledWith("AAPL");
    expect(props.onClose).toHaveBeenCalledTimes(shift ? 1 : 0);
  });
  it("preserves the intentional blank-query add shortcut", async () => {
    await render({ mode: "add" }); await key("Enter"); expect(props.onAdd).toHaveBeenCalledTimes(1); expect(props.onAdd).toHaveBeenCalledWith("NVDA");
  });
  it.each(["pick", "go", "add", "compare"] as const)("keeps old %s rows visible but inert until the query catches up", async mode => {
    await render({ mode, seed: "Apple" }); deferred.held = "Apple"; await type("Microsoft");
    expect(input().value).toBe("Microsoft"); expect(list().getAttribute("aria-busy")).toBe("true"); expect(list().textContent).toContain("AAPL");
    await key("ArrowDown"); await key("Enter"); await key("Enter", true);
    await act(async () => (list().querySelector(".r-opt") as HTMLElement).click());
    const action = list().querySelector<HTMLButtonElement>(".r-act button");
    if (action) await act(async () => action.click());
    noCommit(); expect(host.querySelector(".is-choosing")).toBeNull();
    deferred.held = null; await render(); expect(list().getAttribute("aria-busy")).toBe("false"); expect(list().textContent).toContain("MSFT");
    await key("Enter");
    if (mode === "add") { expect(props.onAdd).toHaveBeenCalledTimes(1); expect(props.onAdd).toHaveBeenCalledWith("MSFT"); }
    else if (mode === "compare") expect(host.querySelector(".is-choosing")?.textContent).toContain("Price");
    else { expect(props.onPick).toHaveBeenCalledTimes(1); expect(props.onPick).toHaveBeenCalledWith("MSFT"); }
  });
});
