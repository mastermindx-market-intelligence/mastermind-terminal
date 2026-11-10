// @vitest-environment jsdom
/**
 * sectorPopulationMembers.test.tsx — permanent component gates for the member
 * table (review 14:21Z: B1, B2, N4), converted from the independent reviewer's
 * jsdom probes (l3probes/members.test.tsx P1/P2).
 *
 * Laws pinned here:
 *   - B1: the wire carries `group_index` only on the UNFILTERED first page.
 *     Choosing a basket (or applying a search) must never disable the picker —
 *     the captured list lives for the capture's life, so the reader can always
 *     go back to "All" or pick another basket.
 *   - B2: submitting an UNCHANGED query fires no request (run is keyed on
 *     [group, applied]) and therefore must never enter a loading state that
 *     nothing will leave — the table stays on screen.
 *   - N4: a failed "Load more" keeps every page already loaded; the failure is
 *     a per-page line with its own retry, and a successful retry extends the
 *     list — the reader never loses context to a transport failure.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import SectorPopulationMembers from "@/components/sector-intelligence/SectorPopulationMembers";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "sector_population.captured.v11_page1.json"), "utf8")) as Record<string, unknown>;

const urls: string[] = [];
/** The wire's page discipline: a filtered or continuation page carries no
 * group_index; only the unfiltered first page does. */
const pageFor = (url: string, mutate?: (page: Record<string, unknown>) => void): string => {
  const u = new URL(url, "http://x");
  const data = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
  const page = data.page as Record<string, unknown>;
  const g = u.searchParams.get("group"), q = u.searchParams.get("q");
  if (g || q) {
    delete page.group_index;
    page.filter = { group: g, q };
    page.next_cursor = null;
    page.complete = true;
  }
  mutate?.(page);
  return JSON.stringify(data);
};

let cursorResponse: (() => Response) | null = null;

beforeEach(() => {
  urls.length = 0;
  cursorResponse = null;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    urls.push(String(input));
    await new Promise(resolve => setTimeout(resolve, 5));
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const u = new URL(String(input), "http://x");
    if (u.searchParams.get("cursor") !== null && cursorResponse !== null) return cursorResponse();
    return new Response(pageFor(String(input)), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
};

async function mount(): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<LangProvider><SectorPopulationMembers /></LangProvider>);
  });
  await flush();
  return { container, root };
}

const table = (c: HTMLElement): HTMLElement | null => c.querySelector('[data-testid="sector-population-table"]');
const loading = (c: HTMLElement): boolean => !!c.querySelector('[data-testid="sector-population-loading"]');
const groupOptions = (c: HTMLElement): string[] =>
  [...c.querySelectorAll("select option")].map(option => (option as HTMLOptionElement).value);
const chooseGroup = async (c: HTMLElement, value: string): Promise<void> => {
  const select = c.querySelector("select") as HTMLSelectElement;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
};

describe("SectorPopulationMembers — review gates", () => {
  it("B1: choosing a basket never disables the group picker", async () => {
    const { container, root } = await mount();
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    const before = groupOptions(container);
    expect(before.length).toBeGreaterThan(2); // "All" + the capture's groups

    const basket = before[1];
    await chooseGroup(container, basket);
    // The filtered page carries NO group_index — the picker must stay alive on
    // the capture's captured list, not the current page's.
    expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(false);
    expect(groupOptions(container)).toEqual(before);
    expect(new URL(urls[urls.length - 1], "http://x").searchParams.get("group")).toBe(basket);

    // And back to "All" — the same capture, the same list.
    await chooseGroup(container, "");
    expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(false);
    expect(table(container)).not.toBeNull();
    act(() => root.unmount());
  });

  it("B2: an unchanged search submit never enters a loading state nothing will leave", async () => {
    const { container, root } = await mount();
    expect(table(container)).not.toBeNull();
    const fetchesBefore = urls.length;

    // Empty box on first view: applied is already null — nothing may change.
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(loading(container)).toBe(false);
    expect(table(container)).not.toBeNull();
    expect(urls.length).toBe(fetchesBefore);

    // Same non-empty query resubmitted: one flight for the change, none for the repeat.
    const input = container.querySelector("#sector-population-q") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "AAPL");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(loading(container)).toBe(false);
    expect(table(container)).not.toBeNull();
    const afterFirst = urls.length;
    expect(afterFirst).toBe(fetchesBefore + 1);

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(loading(container)).toBe(false);
    expect(table(container)).not.toBeNull();
    expect(urls.length).toBe(afterFirst);
    act(() => root.unmount());
  });

  it("B2 (group form): re-selecting the current group fires nothing", async () => {
    const { container, root } = await mount();
    const basket = groupOptions(container)[1];
    await chooseGroup(container, basket);
    const before = urls.length;
    await chooseGroup(container, basket); // same value again
    expect(urls.length).toBe(before);
    expect(loading(container)).toBe(false);
    expect(table(container)).not.toBeNull();
    act(() => root.unmount());
  });

  it("N4: a failed Load more keeps the loaded pages and retries only the failed page", async () => {
    const { container, root } = await mount();
    const rowsAfterFirst = () => [...container.querySelectorAll('[data-testid="sector-population-table"] tbody tr')];
    expect(rowsAfterFirst().length).toBe((fixture.page as { rows: unknown[] }).rows.length);

    // The continuation dies in transport: the loaded page must survive.
    cursorResponse = () => new Response(JSON.stringify({ schema: "sector_generation.error/v1", code: "SERVICE_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } });
    const loadMore = () => container.querySelector('[data-testid="sector-population-load-more"]');
    await act(async () => { (loadMore() as HTMLButtonElement).click(); });
    await flush();
    expect(table(container)).not.toBeNull(); // never a destroyed list
    expect(rowsAfterFirst().length).toBe((fixture.page as { rows: unknown[] }).rows.length);
    expect(container.querySelector('[data-testid="sector-population-page-failure"]')).not.toBeNull();
    expect(loadMore()).toBeNull(); // the failed affordance is replaced, not duplicated

    // Retry: only the failed continuation re-runs, and the list grows.
    cursorResponse = () => new Response(pageFor("", page => {
      (page.rows as Array<Record<string, unknown>>).forEach((row, index) => { row.symbol = `ZZ${index}`; });
      page.complete = true;
      page.next_cursor = null;
    }), { status: 200, headers: { "content-type": "application/json" } });
    await act(async () => {
      (container.querySelector('[data-testid="sector-population-page-retry"]') as HTMLButtonElement).click();
    });
    await flush();
    expect(container.querySelector('[data-testid="sector-population-page-failure"]')).toBeNull();
    expect(rowsAfterFirst().length).toBe((fixture.page as { rows: unknown[] }).rows.length * 2);
    const lastUrl = new URL(urls[urls.length - 1], "http://x");
    expect(lastUrl.searchParams.get("cursor")).not.toBeNull();
    act(() => root.unmount());
  });
});
