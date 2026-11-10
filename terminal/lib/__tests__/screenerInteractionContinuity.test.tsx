// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScreenerView from "@/components/ScreenerView";

const state = vi.hoisted(() => ({ revalidate: null as null | ((data: unknown) => void), push: vi.fn() }));
const symbols = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`S${String(i).padStart(3, "0")}`, {
  name: i < 2 ? "Focus company" : `Company ${i}`, last: 10 + i, vol: 1000, chg: i % 2 ? 4 : -4, mkt: "US", sec: "Technology",
}]));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next/link", () => ({ default: ({ prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => { void prefetch; return <a {...props} />; } }));
vi.mock("@/lib/useMarketPrefs", () => ({ useMarketPrefs: () => ({ prefs: { enabled: [] }, ready: false }) }));
vi.mock("@/lib/dataCache", () => ({ getJSONResult: async (url: string, options?: { onRevalidate?: (data: unknown) => void }) => {
  if (url === "/data/manifest.json") { state.revalidate = options?.onRevalidate ?? null; return { status: "data", data: { symbols } }; }
  return { status: "absent" };
}, invalidate: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: async () => null }));
vi.mock("@/components/AssetLogo", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
let originalScrollTo: PropertyDescriptor | undefined;
beforeEach(async () => {
  localStorage.clear(); state.push.mockClear();
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
