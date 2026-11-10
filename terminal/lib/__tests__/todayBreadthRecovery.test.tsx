// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayBreadthReading from "@/components/workspaces/TodayBreadthReading";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const locale = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: locale.lang }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => { throw Error("Breadth must reuse the parent identity owner"); } }));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
type Held = { url: string; init: RequestInit; resolve: (value: Response) => void; reject: (error: Error) => void };
let held: Held[]; let root: Root; let host: HTMLDivElement;
let scope: { current: AbortController }; let ended: ReturnType<typeof vi.fn>;
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); }
async function mount(ownerKey = A, enabled = true) {
  await act(async () => root.render(<TodayBreadthReading ownerKey={ownerKey} scope={scope} enabled={enabled} onUnauthenticated={ended} />)); await flush();
}
async function answer(index: number, value: unknown, status = 200) {
  await act(async () => held[index].resolve(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })));
  await flush();
}
const retry = () => host.querySelector<HTMLButtonElement>('button[aria-label="Check breadth again"]');
const live = () => ({ schema: "mmx.market_breadth.v1", asof: new Date().toISOString(), built_at: new Date().toISOString(),
  source_age_min: 0, session: "rth", delay_min: 15, usable: true, unusable_reason: null, coverage_pct: 99,
  large: { n: 500, adv_pct: 64, pa200: 72 }, comp: { n: 1500, adv_pct: 60, pa200: 68 } });
const withheld = (reason = "source_stale") => ({ ...live(), usable: false, unusable_reason: reason, large: null, comp: null });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T16:00:00Z")); locale.lang = "en";
  held = []; scope = { current: new AbortController() }; ended = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => held.push({ url, init, resolve, reject }))));
});
afterEach(async () => {
  await act(async () => { scope.current.abort(); root.unmount(); });
  host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe("Today breadth recovery on its incumbent reader", () => {
  it("offers one explicit retry after a failed read without an automatic loop", async () => {
    await mount(); await answer(0, { error: "unavailable" }, 503);
    expect(host.textContent).toContain("Breadth reading unavailable");
    expect(retry()).not.toBeNull(); expect(held).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(60_000)); await flush(); expect(held).toHaveLength(1);
    await act(async () => retry()!.click()); await flush(); expect(held).toHaveLength(2);
    expect(held.map(r => r.url)).toEqual(["/api/market-breadth", "/api/market-breadth"]);
    await answer(1, live()); expect(host.querySelector('[data-breadth="live"]')).not.toBeNull();
    expect(host.textContent).toContain("64% advancing"); expect(retry()).toBeNull();
  });

  it("coalesces repeated activation before React commits the loading state", async () => {
    await mount(); await answer(0, {}, 503); const button = retry()!;
    expect(button).not.toBeNull();
    await act(async () => { button.click(); button.click(); button.click(); }); await flush();
    expect(held).toHaveLength(2); expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it.each(["source_stale", "coverage_low", "feed_offline", "session_closed"])("retains source refusal %s until the user explicitly checks again", async reason => {
    await mount(); await answer(0, withheld(reason));
    expect(host.querySelector('[data-breadth="withheld"]')).not.toBeNull(); expect(host.textContent).not.toContain("64%");
    expect(retry()).not.toBeNull(); expect(held).toHaveLength(1);
    await act(async () => retry()!.click()); await flush(); await answer(1, withheld(reason));
    expect(host.querySelector('[data-breadth="withheld"]')).not.toBeNull(); expect(held).toHaveLength(2);
  });

  it("an expiring reading exposes recovery but never fetches automatically", async () => {
    await mount(); await answer(0, live());
    await act(async () => vi.advanceTimersByTime(26 * 60_000)); await flush();
    expect(host.querySelector('[data-breadth="withheld"]')).not.toBeNull(); expect(retry()).not.toBeNull();
    expect(host.textContent).not.toContain("64%"); expect(held).toHaveLength(1);
  });

  it("distinguishes access refusal and supplies no retry around it", async () => {
    await mount(); await answer(0, { error: "forbidden" }, 403);
    expect(host.textContent).toContain("Current access does not include this reading");
    expect(host.textContent).not.toContain("Breadth reading unavailable"); expect(host.querySelector("button")).toBeNull();
    expect(held).toHaveLength(1); expect(ended).not.toHaveBeenCalled();
  });

  it("a retry that returns 401 ends the private lifetime, including an empty error body", async () => {
    await mount(); await answer(0, {}, 503); expect(retry()).not.toBeNull();
    await act(async () => retry()!.click()); await flush();
    await act(async () => held[1].resolve(new Response(null, { status: 401 }))); await flush();
    expect(ended).toHaveBeenCalledTimes(1); expect(host.textContent).toBe(""); expect(held).toHaveLength(2);
  });

  it("scope abort removes retained values and prevents recovery from that lifetime", async () => {
    await mount(); await answer(0, live());
    await act(async () => scope.current.abort()); await flush();
    expect(host.textContent).toBe(""); expect(held).toHaveLength(1);
  });

  it("does not resurrect a late previous-owner response after a subject change", async () => {
    await mount(); await answer(0, {}, 503);
    await act(async () => retry()!.click()); await flush(); const previousScope = scope.current;
    await act(async () => { previousScope.abort(); scope.current = new AbortController(); });
    await mount(B); expect(held).toHaveLength(3);
    await answer(1, live()); expect(host.textContent).not.toContain("64%");
    await answer(2, withheld()); expect(host.querySelector('[data-breadth="withheld"]')).not.toBeNull();
  });

  it("cannot dispatch recovery while the parent holds reading admission", async () => {
    await mount(); await answer(0, {}, 503); await mount(A, false);
    expect(retry()).toBeNull(); expect(held).toHaveLength(1);
    await mount(A, true); expect(held).toHaveLength(2); await answer(1, live());
    expect(host.textContent).toContain("64% advancing");
  });

  it("reflow, language changes and keyboard focus do not create new reads", async () => {
    await mount(); await answer(0, {}, 503); expect(retry()).not.toBeNull();
    await act(async () => { retry()!.focus(); window.dispatchEvent(new Event("resize")); });
    expect(document.activeElement).toBe(retry()); locale.lang = "zh"; await mount();
    expect(host.querySelector('button[aria-label="重新读取市场广度"]')).not.toBeNull();
    expect(held).toHaveLength(1);
  });

  it("keeps keyboard focus on the same reading while the retry control is replaced", async () => {
    await mount(); await answer(0, {}, 503); retry()!.focus();
    await act(async () => retry()!.click()); await flush();
    const cell = host.querySelector('[data-breadth-cell]');
    expect(document.activeElement).not.toBe(document.body);
    expect(cell).not.toBeNull(); expect(document.activeElement).toBe(cell);
    await answer(1, live()); expect(document.activeElement).toBe(cell);
    expect(cell?.getAttribute("aria-label")).toBe("S&P 500 breadth");
  });

  it("a completed recovery does not steal focus from the user's next action", async () => {
    await mount(); await answer(0, {}, 503); retry()!.focus();
    await act(async () => retry()!.click()); await flush();
    const other = document.createElement("button"); other.textContent = "Other action"; document.body.appendChild(other); other.focus();
    await answer(1, live()); expect(document.activeElement).toBe(other); other.remove();
  });

  it("the incumbent request deadline makes a hung read recoverable", async () => {
    await mount(); await act(async () => vi.advanceTimersByTime(18_001)); await flush();
    expect(host.textContent).toContain("Breadth reading unavailable"); expect(retry()).not.toBeNull();
    expect(held[0].init.signal?.aborted).toBe(true); expect(held).toHaveLength(1);
  });
});
