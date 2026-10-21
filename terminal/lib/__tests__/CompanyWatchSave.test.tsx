// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountIdentity } from "../accountIdentity";
const { state } = vi.hoisted(() => ({ state: { identity: { kind: "guest" } as AccountIdentity, lang: "en" } }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => state.identity }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: state.lang }) }));
import CompanyWatchSave from "@/components/fin/CompanyWatchSave";
const A = "6ed52847-3cbe-49d2-b54d-33d39ef482cf", B = "7ed52847-3cbe-49d2-b54d-33d39ef482cf";
const L1 = "8ed52847-3cbe-49d2-b54d-33d39ef482cf", L2 = "9ed52847-3cbe-49d2-b54d-33d39ef482cf";
const inventory = (present = false) => ({ lists: [
  { id: L1, name: "Private Core", position: 0, symbols: [] },
  { id: L2, name: "Research", position: 1, symbols: present ? [{ symbol: "AAPL", section: "Watchlist", position: 0 }] : [] },
], sharedWithMe: [{ id: "read-only", name: "Shared read only", symbols: [] }] });
const json = (raw: unknown, status = 200) => new Response(JSON.stringify(raw), { status });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>;
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function render(symbol = "AAPL") { await act(async () => root.render(<CompanyWatchSave symbol={symbol} />)); await flush(); }
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === label);
  if (!button) throw new Error(`missing button ${label}: ${host.textContent}`);
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush();
}
async function chooseResearch() { const select = host.querySelector("select")!; await act(async () => { select.value = L2; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  state.identity = { kind: "account", userId: A, email: "display@example.test" }; state.lang = "en";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Company save through the existing watchlist owner", () => {
  it("distinguishes guest, restricted, unavailable and real empty", async () => {
    state.identity = { kind: "guest" }; await render(); expect(host.textContent).toContain("Sign in to save"); expect(fetchMock).not.toHaveBeenCalled();
    state.identity = { kind: "account", userId: A, email: "same@example.test" }; fetchMock.mockResolvedValueOnce(json({}, 403)); await render(); expect(host.textContent).toContain("access restricted");
    state.identity = { kind: "account", userId: B, email: "same@example.test" }; fetchMock.mockResolvedValueOnce(json({}, 503)); await render(); expect(host.textContent).toContain("Watchlists unavailable");
    fetchMock.mockResolvedValueOnce(json({ lists: [], sharedWithMe: inventory().sharedWithMe })); await click("Retry list read"); expect(host.textContent).toContain("No owned watchlists"); expect(host.querySelector("select")).toBeNull();
  });
  it("posts the exact chosen owned list and waits for a fresh membership read", async () => {
    const post = deferred<Response>(), after = deferred<Response>();
    fetchMock.mockResolvedValueOnce(json(inventory())).mockReturnValueOnce(post.promise).mockReturnValueOnce(after.promise);
    await render(); await chooseResearch(); await click("Save");
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(host.textContent).toContain("Saving AAPL"); expect(host.textContent).not.toContain("Shared read only");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "add", listId: L2, symbols: ["AAPL"], section: "Watchlist" });
    await act(async () => post.resolve(json({ ok: true }))); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(host.textContent).toContain("Checking AAPL membership"); expect(host.textContent).not.toContain("AAPL saved to watchlist");
    await act(async () => after.resolve(json(inventory(true)))); await flush(); expect(host.textContent).toContain("AAPL saved to watchlist");
  });
  it("keeps absent membership unknown and locks duplicate submission", async () => {
    fetchMock.mockResolvedValueOnce(json(inventory())).mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(json(inventory()));
    await render(); await chooseResearch(); await click("Save"); expect(host.textContent).toContain("Save unconfirmed");
    expect([...host.querySelectorAll("button")].find(b => b.textContent === "Save")?.disabled).toBe(true);
    fetchMock.mockResolvedValueOnce(json(inventory(true))); await click("Check status");
    expect(host.textContent).toContain("AAPL saved to watchlist"); expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("does not replay a timed-out effect", async () => {
    vi.useFakeTimers(); fetchMock.mockResolvedValueOnce(json(inventory())).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(json(inventory()));
    await render(); await chooseResearch(); await click("Save"); await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); await flush();
    expect(host.textContent).toContain("Save unconfirmed"); expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json(inventory(true))); await click("Check status"); expect(host.textContent).toContain("AAPL saved to watchlist");
  });
  it("hides old private state at UUID transition and discards its late POST", async () => {
    const post = deferred<Response>(), next = deferred<Response>();
    fetchMock.mockResolvedValueOnce(json(inventory())).mockReturnValueOnce(post.promise).mockReturnValueOnce(next.promise);
    await render(); await chooseResearch(); await click("Save"); state.identity = { kind: "account", userId: B, email: "display@example.test" }; await render();
    expect(host.textContent).not.toContain("Private Core"); expect(host.textContent).not.toContain("Saving AAPL");
    await act(async () => post.resolve(json({ ok: true }))); await flush(); expect(fetchMock).toHaveBeenCalledTimes(3); expect(host.textContent).not.toContain("saved to watchlist");
    await act(async () => next.resolve(json({ lists: [], sharedWithMe: [] }))); await flush(); expect(host.textContent).toContain("No owned watchlists");
  });
  it("never labels a prior-symbol save as confirmation of a newly selected symbol", async () => {
    const post = deferred<Response>(); fetchMock.mockResolvedValueOnce(json(inventory())).mockReturnValueOnce(post.promise).mockResolvedValueOnce(json(inventory(true)));
    await render(); await chooseResearch(); await click("Save"); await render("NVDA"); expect(host.textContent).toContain("Saving AAPL");
    await act(async () => post.resolve(json({ ok: true }))); await flush(); expect(host.textContent).toContain("AAPL saved to watchlist"); expect(host.textContent).not.toContain("NVDA saved");
  });
  it("restores an unknown save after remount and never repeats POST while membership is absent", async () => {
    fetchMock.mockResolvedValueOnce(json(inventory())).mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(json(inventory()));
    await render(); await chooseResearch(); await click("Save"); expect(host.textContent).toContain("Save unconfirmed");
    await act(async () => root.unmount()); root = createRoot(host);
    fetchMock.mockResolvedValueOnce(json(inventory())).mockResolvedValueOnce(json(inventory()));
    await render(); expect(host.textContent).toContain("Save unconfirmed");
    expect([...host.querySelectorAll("button")].find(b => b.textContent === "Save")?.disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json(inventory(true))); await click("Check status"); expect(host.textContent).toContain("AAPL saved to watchlist");
  });
  it("sends no mutation if the browser cannot retain its exact pending request", async () => {
    fetchMock.mockResolvedValueOnce(json(inventory())); await render(); await chooseResearch();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("storage denied"); });
    await click("Save"); expect(host.textContent).toContain("No new save was sent");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("bounds a hanging initial GET and exposes a usable read-only retry", async () => {
    vi.useFakeTimers(); fetchMock.mockImplementationOnce(() => new Promise(() => {})); await render();
    expect(host.textContent).toContain("Loading watchlists");
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); await flush();
    expect(host.textContent).toContain("Watchlists unavailable");
    fetchMock.mockResolvedValueOnce(json(inventory())); await click("Retry list read");
    expect(host.querySelector("select")).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("bounds a hanging post-response GET, preserves unknown and enables same-operation checking", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json(inventory())).mockResolvedValueOnce(json({ ok: true })).mockImplementationOnce(() => new Promise(() => {}));
    await render(); await chooseResearch(); await click("Save"); expect(host.textContent).toContain("Checking AAPL membership");
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); await flush();
    expect(host.textContent).toContain("Save unconfirmed");
    expect([...host.querySelectorAll("button")].find(b => b.textContent === "Check status")?.disabled).toBe(false);
    fetchMock.mockResolvedValueOnce(json(inventory(true))); await click("Check status");
    expect(host.textContent).toContain("AAPL saved to watchlist");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("keeps a server failure uncertain and provides Chinese controls", async () => {
    state.lang = "zh"; fetchMock.mockResolvedValueOnce(json(inventory())).mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json(inventory()));
    await render(); await chooseResearch(); await click("保存"); expect(host.textContent).toContain("保存状态未确认"); expect(host.textContent).toContain("核对状态");
  });
});
