// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayWatchAttention from "@/components/workspaces/TodayWatchAttention";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const i18n = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
const child = vi.hoisted(() => ({ mounts: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: i18n.lang }) }));
// Solely a prop inspector: owner + selection + callback. The real fetch boundary
// stays this surface's own /api/watchlist call; the parent composes the actual child.
vi.mock("@/components/workspaces/MonitorEventAttention", () => ({
  default: (props: Record<string, unknown>) => {
    child.mounts.push(props);
    const selection = props.selection === null || props.selection === undefined ? "null" : JSON.stringify(props.selection);
    return <div data-testid="event-child" data-selection={selection} data-owner={String(props.subjectId)} />;
  },
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => { throw new Error("TodayWatchAttention must not own identity"); } }));

type Held = { url: string; init?: RequestInit; resolve: (response: Response) => void };
let held: Held[]; let root: Root; let container: HTMLDivElement; let unauthenticated: ReturnType<typeof vi.fn>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function flush() { for (let n = 0; n < 4; n++) await act(async () => { await Promise.resolve(); }); }
async function answer(index: number, value: unknown, status = 200) { await act(async () => { held[index].resolve(json(value, status)); }); await flush(); }
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.includes(text));
  expect(button, text).toBeTruthy();
  await act(async () => button!.click()); await flush();
}
async function mountNode(node: React.ReactNode) { await act(async () => root.render(node)); await flush(); }
function childProps() { expect(child.mounts.length > 0).toBe(true); return child.mounts[child.mounts.length - 1]; }
function watchRow(id: string, name: string, position: number, symbols: string[]) {
  return { id, name, position, symbols: symbols.map((symbol, index) => ({ symbol, section: "us_equities", position: index })) };
}
async function renderOwner(ownerKey: string) {
  const scope = { current: new AbortController() };
  await mountNode(<TodayWatchAttention ownerKey={ownerKey} scope={scope} onUnauthenticated={unauthenticated} />);
  return scope;
}
beforeEach(() => {
  i18n.lang = "en"; child.mounts = []; held = []; unauthenticated = vi.fn();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(resolve => held.push({ url: String(input), init, resolve }))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Today watchlist attention", () => {
  it("reads owned watchlists once, renders actual rows and selects no event", async () => {
    await renderOwner(A);
    expect(held).toHaveLength(1); expect(held[0].url).toBe("/api/watchlist");
    await answer(0, { lists: [watchRow("wl-energy", "Energy", 0, ["XOM", "CVX"])] });
    expect(container.textContent).toContain("Energy");
    expect(container.textContent).toContain("XOM"); expect(container.textContent).toContain("CVX");
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
    expect(child.mounts).toHaveLength(0);
    expect(container.textContent).toContain("Choose a saved symbol");
    expect(held.every(request => request.url === "/api/watchlist")).toBe(true);
  });

  it("explicit check passes the exact list and symbol to the existing child", async () => {
    await renderOwner(A);
    await answer(0, { lists: [watchRow("wl-energy", "Energy", 0, ["XOM", "CVX"])] });
    const checks = Array.from(container.querySelectorAll("button")).filter(node => node.textContent?.includes("Check event evidence"));
    expect(checks).toHaveLength(2);
    await act(async () => checks[1].click()); await flush();
    expect(childProps().selection).toEqual({ listId: "wl-energy", symbol: "CVX" });
    expect(childProps().lang).toBe("en");
    expect(childProps().subjectId).toBe(A);
    expect(typeof childProps().onUnauthenticated).toBe("function");
    expect(held).toHaveLength(1);
  });

  it("refresh clears the selected child, hides old rows while pending and never rechecks removed membership", async () => {
    await renderOwner(A);
    await answer(0, { lists: [watchRow("wl-a", "Alpha", 0, ["AAPL", "MSFT"])] });
    await click("Check event evidence");
    expect(childProps().selection).toEqual({ listId: "wl-a", symbol: "AAPL" });
    await click("Refresh lists");
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
    expect(container.textContent).not.toContain("AAPL");
    expect(container.textContent).toContain("Refreshing saved watchlists");
    await answer(1, { lists: [watchRow("wl-a", "Alpha", 0, ["MSFT"])] });
    expect(container.textContent).toContain("MSFT");
    expect(container.textContent).not.toContain("AAPL");
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
    expect(held.every(request => request.url === "/api/watchlist")).toBe(true);
  });

  it("a pending read for a departed owner cannot overwrite the new owner's rows", async () => {
    await renderOwner(A);
    await renderOwner(B);
    await answer(1, { lists: [watchRow("wl-b", "Beta", 0, ["0700.HK"])] });
    await answer(0, { lists: [watchRow("wl-a", "Alpha", 0, ["XOM"])] });
    expect(container.textContent).toContain("Beta");
    expect(container.textContent).toContain("0700.HK");
    expect(container.textContent).not.toContain("XOM");
    expect(container.textContent).not.toContain("Alpha");
  });

  it("503 is unavailable with retry and the retry rereads the same owner scope", async () => {
    await renderOwner(A);
    await answer(0, { error: "storage unavailable" }, 503);
    expect(container.textContent).toContain("could not be read");
    expect(container.textContent).not.toContain("No saved watchlists yet");
    await click("Check again");
    expect(held).toHaveLength(2); expect(held[1].url).toBe("/api/watchlist");
    await answer(1, { lists: [watchRow("wl-a", "Alpha", 0, ["XOM"])] });
    expect(container.textContent).toContain("XOM");
  });

  it("a stalled watchlist read reaches the read deadline and offers the same retry", async () => {
    vi.useFakeTimers();
    await renderOwner(A);
    await act(async () => { vi.advanceTimersByTime(18_000); });
    await flush();
    expect(container.textContent).toContain("could not be read");
    expect(container.textContent).not.toContain("No saved watchlists yet");
    vi.useRealTimers();
    await click("Check again");
    expect(held).toHaveLength(2);
    await answer(1, { lists: [watchRow("wl-a", "Alpha", 0, ["XOM"])] });
    expect(container.textContent).toContain("XOM");
  });

  it("401 invalidates through the parent and hides every private row", async () => {
    await renderOwner(A);
    await answer(0, { lists: [watchRow("wl-a", "Alpha", 0, ["XOM"])] });
    await click("Refresh lists");
    await answer(1, { error: "unauthorized" }, 401);
    expect(unauthenticated).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("XOM");
    expect(container.textContent).not.toContain("Alpha");
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
  });

  it("403 stays a local rights state, distinct from unavailable and empty", async () => {
    await renderOwner(A);
    await answer(0, { error: "forbidden" }, 403);
    expect(container.textContent).toContain("Current access does not permit");
    expect(container.textContent).not.toContain("could not be read");
    expect(container.textContent).not.toContain("No saved watchlists yet");
    expect(unauthenticated).not.toHaveBeenCalled();
  });

  it("A→B→A destroys the selection and requires a fresh A read with no resurrection", async () => {
    await renderOwner(A);
    await answer(0, { lists: [watchRow("wl-a", "Alpha", 0, ["XOM"])] });
    await click("Check event evidence");
    expect(childProps().selection).toEqual({ listId: "wl-a", symbol: "XOM" });
    await renderOwner(B);
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
    expect(container.textContent).not.toContain("XOM");
    await answer(1, { lists: [watchRow("wl-b", "Beta", 0, ["0700.HK"])] });
    expect(container.textContent).toContain("0700.HK");
    await renderOwner(A);
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
    expect(container.textContent).not.toContain("0700.HK");
    await answer(2, { lists: [watchRow("wl-a", "Alpha", 0, ["XOM"])] });
    expect(container.textContent).toContain("XOM");
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
  });

  it("shared_with_me lists never render; owned lists only", async () => {
    await renderOwner(A);
    await answer(0, {
      lists: [watchRow("wl-a", "Alpha", 0, ["XOM"])],
      shared_with_me: [{ id: "sh", name: "Peer", position: 0, symbols: [{ symbol: "TSLA", section: "x", position: 0 }] }],
    });
    expect(container.textContent).toContain("XOM");
    expect(container.textContent).not.toContain("TSLA");
    expect(container.textContent).not.toContain("Peer");
  });

  it("caps the briefing at three symbols and routes the rest to Monitor", async () => {
    await renderOwner(A);
    await answer(0, { lists: [watchRow("wl-a", "Alpha", 0, ["AAPL", "MSFT", "NVDA"]), watchRow("wl-b", "Beta", 1, ["XOM", "CVX"])] });
    const checks = Array.from(container.querySelectorAll("button")).filter(node => node.textContent?.includes("Check event evidence"));
    expect(checks).toHaveLength(3);
    expect(container.textContent).toContain("2 more saved entries on Monitor");
    expect(container.querySelector('a[href="/monitor"]')).toBeTruthy();
    expect(container.textContent).not.toContain("CVX");
  });

  it("empty owned lists and lists without members stay distinct", async () => {
    await renderOwner(A);
    await answer(0, { lists: [watchRow("wl-empty", "Empty list", 0, [])] });
    expect(container.textContent).toContain("Your saved watchlists have no symbols yet");
    expect(container.textContent).not.toContain("No saved watchlists yet");
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
    await renderOwner(B);
    await answer(1, { lists: [] });
    expect(container.textContent).toContain("No saved watchlists yet");
    expect(container.textContent).not.toContain("have no symbols yet");
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
  });

  it("renders the Zh copy pair for the same payload", async () => {
    i18n.lang = "zh";
    await renderOwner(A);
    await answer(0, { lists: [watchRow("wl-a", "能源", 0, ["XOM"])] });
    expect(container.textContent).toContain("关注事项");
    expect(container.textContent).toContain("核对事件证据");
    expect(container.textContent).toContain("打开监控");
    expect(Array.from(container.querySelectorAll("button")).filter(node => node.textContent?.includes("刷新列表"))).toHaveLength(1);
  });

  it("a parent scope abort hides all private rows while mounted", async () => {
    const scope = await renderOwner(A);
    await answer(0, { lists: [watchRow("wl-a", "Alpha", 0, ["XOM"])] });
    expect(container.textContent).toContain("XOM");
    await act(async () => { scope.current!.abort(); });
    await flush();
    expect(container.textContent).not.toContain("XOM");
    expect(container.textContent).not.toContain("Alpha");
    expect(container.querySelector('[data-testid="event-child"]')).toBeNull();
  });

  it("a malformed owned payload is unavailable, never silently empty", async () => {
    await renderOwner(A);
    await answer(0, { lists: {} });
    expect(container.textContent).toContain("could not be read");
    expect(container.textContent).not.toContain("No saved watchlists yet");
    expect(unauthenticated).not.toHaveBeenCalled();
  });
});
