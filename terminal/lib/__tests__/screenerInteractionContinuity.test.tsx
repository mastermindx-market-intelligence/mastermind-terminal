// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScreenerView from "@/components/ScreenerView";

const state = vi.hoisted(() => ({ revalidate: null as null | ((data: unknown) => void), push: vi.fn(), save: vi.fn(() => true), generation: 1, owner: "guest", ready: true, quoteCalls: [] as { regular: string[]; overnight: string[] }[] }));
const symbols = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`S${String(i).padStart(3, "0")}`, {
  name: i < 2 ? "Focus company" : `Company ${i}`, last: 10 + i, vol: 1000, chg: i % 2 ? 4 : -4, mkt: "US", sec: "Technology",
}]));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next/link", () => ({ default: ({ prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => { void prefetch; return <a {...props} />; } }));
vi.mock("@/lib/useMarketPrefs", () => ({ currentOwnerToken: () => ({owner:state.owner,generation:state.generation}), ownerTokenIsCurrent: (token: { owner: string; generation: number }) => token.owner === state.owner && token.generation === state.generation,
  useMarketPrefs: () => ({ prefs: {enabled:["us","cn","hk","ca","intl","crypto"]}, ready:true, owner:state.owner, base:"loaded", discover:{current:null,views:[],blocked:false}, discoverReady:state.ready,discoverBase:state.ready ? "loaded" : "pending",discoverSync:{phase:"local"},discoverIssue:null,discoverDevice:true,openDiscover:()=>{},retryDiscover:()=>{},reloadDiscover:()=>{},
    sync:{phase:"local"}, saveDiscover:state.save, deleteDiscover:()=>true, renameDiscover:()=>true }) }));
vi.mock("@/components/screener/useDiscoverQuotes", () => ({useDiscoverQuotes: (_owner: string, regular: string[], overnight: string[]) => { state.quoteCalls.push({ regular, overnight }); return {regular:{},overnight:{},now:Date.now(),status:"ready",regularStatus:"ready",overnightStatus:"ready"}; }}));
vi.mock("next/dynamic", () => ({ default: () => function Evidence({ onClose }: { onClose: () => void }) { return <dialog open data-test-evidence><button onClick={onClose}>Close evidence</button></dialog>; } }));
vi.mock("@/lib/dataCache", () => ({ getJSONResult: async (url: string, options?: { onRevalidate?: (data: unknown) => void }) => {
  if (url === "/data/manifest.json") { state.revalidate = options?.onRevalidate ?? null; return { status: "data", data: { symbols } }; }
  return { status: "absent" };
}, invalidate: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: async () => null }));
vi.mock("@/components/AssetLogo", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
let originalScrollTo: PropertyDescriptor | undefined;
const originalDialog = { showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close") };
beforeEach(async () => {
  localStorage.clear(); history.replaceState(null, "", "/"); state.push.mockClear(); state.save.mockClear(); state.generation = 1; state.owner = "guest"; state.ready = true; state.quoteCalls = [];
  // jsdom has no top layer. This tests logical opener restoration; real modal geometry and
  // native focus trapping are qualified by the responsive browser journey.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; this.querySelector<HTMLButtonElement>("button")?.focus(); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? this.scrollTop; } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<ScreenerView identity={{ kind: "guest" }} />); });
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  for (const key of ["showModal", "close"] as const) { const descriptor = originalDialog[key]; if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, key); }
});

const table = () => host.querySelector<HTMLDivElement>(".scr2-table")!;
const rows = () => [...host.querySelectorAll("tbody .sym-cell")];
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>(".scr2-search")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function scroll(top: number) { act(() => { table().scrollTop = top; table().dispatchEvent(new Event("scroll")); }); }

describe("Screener result continuity", () => {
  it("inspects, navigates and returns to the same viewport without saving a new view", async () => {
    scroll(4000); const before = table().scrollTop, writes = state.save.mock.calls.length;
    const opener = host.querySelector<HTMLButtonElement>("[data-discover-inspect]")!;
    const symbol = opener.dataset.discoverInspect;
    act(() => { opener.focus(); opener.click(); });
    expect(host.querySelector("[data-discover-inspector]")?.getAttribute("data-discover-inspector")).toBe(symbol);
    expect(state.push).not.toHaveBeenCalled();
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Next result"]')!.click(); });
    expect(host.querySelector("[data-discover-inspector]")?.getAttribute("data-discover-inspector")).not.toBe(symbol);
    expect(table().scrollTop).toBe(before);
    act(() => host.querySelector<HTMLButtonElement>('dialog [aria-label="Close"]')!.click());
    expect(document.activeElement).toBe(opener); expect(table().scrollTop).toBe(before);
    expect(state.save.mock.calls.length).toBe(writes);
  });

  it("does not let an inspection-only technical read alter chart destinations", async () => {
    const before = host.querySelector<HTMLAnchorElement>("a.sym-cell")!.getAttribute("href");
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-discover-inspect]")!.click(); });
    act(() => host.querySelector<HTMLButtonElement>('dialog [aria-label="Close"]')!.click());
    expect(host.querySelector<HTMLAnchorElement>("a.sym-cell")!.getAttribute("href")).toBe(before);
    expect(before).not.toContain("tf=");
  });

  it("opens one evidence surface and restores the logical field in the recreated inspector", async () => {
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-discover-inspect]")!.click(); });
    const value = host.querySelector<HTMLButtonElement>('[data-research-fund="fund.pe_ttm"]')!;
    act(() => value.click());
    expect(host.querySelector("[data-discover-inspector]")).toBeNull();
    expect(host.querySelectorAll("dialog")).toHaveLength(1);
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-test-evidence] button")!.click(); });
    expect(host.querySelectorAll("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(host.querySelector('[data-research-fund="fund.pe_ttm"]'));
  });

  it("caps comparisons at four and clears transient research on account generation change", async () => {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-discover-compare]")].slice(0, 5);
    for (const button of buttons) act(() => button.click());
    expect(host.querySelectorAll('[data-discover-compare][aria-pressed="true"]')).toHaveLength(4);
    expect(host.textContent).toContain("You can compare four stocks");
    const launch = [...host.querySelectorAll<HTMLButtonElement>("[data-discover-compare-tray] button")].find(button => button.textContent?.startsWith("Compare"))!;
    await act(async () => launch.click());
    expect(host.querySelectorAll("[data-discover-comparison] thead th")).toHaveLength(10); // five in each factual/historical matrix
    state.generation = 2;
    await act(async () => root.render(<ScreenerView identity={{ kind: "guest" }} />));
    expect(host.querySelector("[data-discover-comparison]")).toBeNull(); expect(host.querySelector("[data-discover-compare-tray]")).toBeNull();
  });

  it("closes the evidence handoff synchronously when the account generation changes", async () => {
    await act(async () => host.querySelector<HTMLButtonElement>("[data-discover-inspect]")!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-research-fund="fund.pe_ttm"]')!.click());
    expect(host.querySelector("[data-test-evidence]")).not.toBeNull();
    state.generation = 2;
    await act(async () => root.render(<ScreenerView identity={{ kind: "guest" }} />));
    expect(host.querySelector("[data-test-evidence]")).toBeNull(); expect(host.querySelector("[data-discover-inspector]")).toBeNull();
  });

  it("keeps demand empty until the incoming account workspace has hydrated", async () => {
    await search("S001");
    act(() => host.querySelector<HTMLButtonElement>("[data-discover-quote]")!.click());
    expect(host.querySelector("dialog")).not.toBeNull();
    state.owner = "account:next-user"; state.generation = 2; state.ready = false; state.quoteCalls = [];
    const identity = { kind: "account" as const, userId: "next-user", email: "next@example.test" };
    await act(async () => root.render(<ScreenerView identity={identity} />));
    expect(state.quoteCalls.length).toBeGreaterThan(0);
    expect(state.quoteCalls.every(call => call.regular.length === 0 && call.overnight.length === 0)).toBe(true);
    expect(host.querySelector("dialog")).toBeNull();
    state.ready = true;
    await act(async () => root.render(<ScreenerView identity={identity} />));
    expect(state.quoteCalls.at(-1)!.regular.length).toBeGreaterThan(1);
    expect(host.querySelector("dialog")).toBeNull(); expect(host.querySelector<HTMLInputElement>(".scr2-search")!.value).toBe("");
  });

  it.each(["s001", "$s001"])("retains normalized URL symbol %s through delayed workspace hydration", async symbol => {
    history.replaceState(null, "", `/?symbol=${encodeURIComponent(symbol)}`);
    state.ready = false; state.generation = 2;
    await act(async () => root.render(<ScreenerView identity={{ kind: "guest" }} />));
    state.ready = true;
    await act(async () => root.render(<ScreenerView identity={{ kind: "guest" }} />));
    expect(host.querySelector<HTMLInputElement>(".scr2-search")!.value).toBe("S001");
    expect(rows()).toHaveLength(1); expect(rows()[0].textContent).toContain("S001");
  });

  it("keeps a removed selected identity explicit instead of substituting another result", async () => {
    const opener = host.querySelector<HTMLButtonElement>("[data-discover-inspect]")!;
    const sym = opener.dataset.discoverInspect!;
    await act(async () => opener.click());
    const remaining = { ...symbols }; delete remaining[sym];
    act(() => state.revalidate?.({ symbols: remaining }));
    expect(host.querySelector("dialog")?.textContent).toContain(sym);
    expect(host.querySelector("dialog")?.textContent).toContain("This listing is no longer in the latest scan");
    expect(host.querySelector("[data-discover-inspector]")).toBeNull();
  });

  it("keeps monetary ties deterministic across manifest insertion orders", () => {
    const before = rows().map(node => node.textContent);
    act(() => state.revalidate?.({ symbols: Object.fromEntries(Object.entries(symbols).reverse()) }));
    expect(rows().map(node => node.textContent)).toEqual(before);
  });

  it("explains fundamental coverage before a filter or column is added", async () => {
    const before = [...host.querySelectorAll("thead [data-column]")].map(node => node.getAttribute("data-column"));
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-controls="discover-advanced"]')!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-fund-toggle]")!.click(); });
    const coverage = host.querySelector('[data-fund-coverage="fund.net_margin_fy"]');
    expect(coverage?.getAttribute("data-fund-total")).toBe("300");
    expect(coverage?.querySelector('[data-fund-status="unavailable"]')?.getAttribute("data-fund-n")).toBe("300");
    expect(host.querySelectorAll("thead [data-fund-col]")).toHaveLength(0);
    expect([...host.querySelectorAll("thead [data-column]")].map(node => node.getAttribute("data-column"))).toEqual(before);
  });

  it("reveals a small filtered result after scrolling deeply into a large universe", async () => {
    expect(rows().length).toBeGreaterThan(0); scroll(6000);
    expect(host.querySelector<HTMLTableRowElement>(".scr2-spacer")!.style.height).not.toBe("0px");
    await search("Focus company");
    expect(rows()).toHaveLength(2);
    expect(table().scrollTop).toBe(0);
    expect([...host.querySelectorAll<HTMLElement>(".scr2-spacer")].every((el) => parseFloat(el.style.height) < 100)).toBe(true);
    await search("unmatched phrase"); expect(rows()).toHaveLength(0);
    expect(host.querySelectorAll(".scr2-spacer")).toHaveLength(0);
    await search(""); expect(rows().length).toBeGreaterThan(0); expect(table().scrollTop).toBe(0);
  });

  it("preserves the viewport on a same-universe background refresh", () => {
    scroll(4000); const before = rows().map((el) => el.textContent);
    act(() => { state.revalidate?.({ symbols, as_of: "2026-11-09" }); });
    expect(table().scrollTop).toBe(4000);
    expect(rows().map((el) => el.textContent)).toEqual(before);
  });

  it("bounds the rendered window when a background result set shrinks", () => {
    scroll(6000);
    act(() => { state.revalidate?.({ symbols: { S000: symbols.S000, S001: symbols.S001 } }); });
    expect(rows()).toHaveLength(2);
    expect(host.querySelectorAll(".scr2-spacer")).toHaveLength(0);
  });

  it("uses a native sort button and a canonical link without intercepting nested actions", () => {
    const sort = host.querySelector<HTMLButtonElement>("thead th:first-child button");
    expect(sort).not.toBeNull();
    scroll(4000); act(() => sort!.click());
    expect(table().scrollTop).toBe(0);
    expect(sort!.closest("th")!.getAttribute("aria-sort")).toBe("descending");
    const link = host.querySelector<HTMLAnchorElement>("a.sym-cell");
    expect(link).not.toBeNull(); expect(link!.href).toContain("/terminal?sym=S299");
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    let preventedBeforeDocument = true;
    document.addEventListener("click", (event) => { preventedBeforeDocument = event.defaultPrevented; event.preventDefault(); }, { once: true });
    act(() => { link!.dispatchEvent(modified); });
    expect(preventedBeforeDocument).toBe(false); expect(state.push).not.toHaveBeenCalled();
    const row = link!.closest("tr")!; const nested = document.createElement("button"); row.append(nested);
    act(() => nested.click()); expect(state.push).not.toHaveBeenCalled();
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(state.push).toHaveBeenCalledWith("/terminal?sym=S299");
  });
});
