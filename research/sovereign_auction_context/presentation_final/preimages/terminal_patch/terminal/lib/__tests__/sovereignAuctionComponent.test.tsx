// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SovereignAuctionContext from "@/components/SovereignAuctionContext";
import { LangProvider, LEX } from "@/lib/i18n";
import { validateSovereignAuctionContext } from "@/lib/sovereignAuctionContext";
const auth = vi.hoisted(() => ({ listener: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void), unsubscribe: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: (listener: typeof auth.listener) => { auth.listener = listener; return { data: { subscription: { unsubscribe: auth.unsubscribe } } }; } } }) }));
const RAW = JSON.parse(readFileSync(join(__dirname, "fixtures/sovereign_auction_context_w1.json"), "utf8")).sovereign_auction_context;
const NOW = Date.parse("2026-10-08T22:16:00Z");
const validated = validateSovereignAuctionContext(RAW, NOW);
if (!validated.ok) throw new Error("Pinned W1 fixture invalid");
const PAYLOAD = validated.context;
let host: HTMLDivElement, root: Root;
const body = () => host.textContent ?? "";
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function mount() {
  await act(async () => root.render(<LangProvider><SovereignAuctionContext /></LangProvider>));
  await settle();
}
beforeEach(() => {
  auth.listener = null; auth.unsubscribe.mockClear();
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubGlobal("fetch", vi.fn());
  document.documentElement.setAttribute("data-lang", "en");
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("independent sovereign auction display", () => {
  it("renders exact producer identity, clocks, amount and null result without nested anchors", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(PAYLOAD), { status: 200 })); await mount();
    expect(body()).toContain("auction:912797SU2:2026-10-13"); expect(body()).toContain("95000000000 USD");
    expect(body()).toContain(PAYLOAD.decision_cutoff_utc); expect(body()).toContain(PAYLOAD.source_observed_at);
    expect(body()).toContain(LEX.saResultsNotObserved[0]); expect(body()).toContain(LEX.saFreshnessUnassessed[0]);
    expect(host.querySelector("a a")).toBeNull(); expect(host.querySelectorAll("li")).toHaveLength(3);
    expect(host.querySelector("details")?.style.maxWidth).toBe("100%");
  });
  it("stays visible when incumbent market_plane is absent", async () => {
    vi.mocked(fetch).mockImplementation(async url => String(url).includes("sovereign_auction_context") ? new Response(JSON.stringify(PAYLOAD), { status: 200 }) : new Response(null, { status: 503 }));
    await mount(); expect(host.querySelector('[data-testid="sovereign-auction-context"]')).not.toBeNull(); expect(body()).toContain("912797SU2");
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes("f=sovereign_auction_context"))).toBe(true);
  });
  it("EN/ZH copies remain separated and both themes use shared tokens", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(PAYLOAD), { status: 200 })); await mount();
    expect(body()).toContain(LEX.saTitle[0]); expect(body()).not.toContain(LEX.saTitle[1]);
    await act(async () => { document.documentElement.setAttribute("data-lang", "zh"); window.dispatchEvent(new CustomEvent("mm:lang")); });
    expect(body()).toContain(LEX.saTitle[1]); expect(body()).not.toContain(LEX.saTitle[0]);
    for (const theme of ["light", "dark"]) { document.documentElement.setAttribute("data-theme", theme); expect(host.querySelector("details")?.getAttribute("style")).toContain("var(--muted)"); }
    // DOM/style assertions do not claim responsive browser layout verification.
  });
  it.each([401, 403, 503])("clears previous entitled state after status %s", async status => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(PAYLOAD), { status: 200 })).mockResolvedValueOnce(new Response(null, { status }));
    await mount(); expect(body()).toContain("912797SU2");
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); }); await settle();
    expect(body()).not.toContain("912797SU2"); expect(host.querySelectorAll("li")).toHaveLength(0);
    expect(body()).toContain(LEX[status === 401 ? "saSignIn" : status === 403 ? "saNotEntitled" : "saUnavailable"][0]);
  });
  it("clears prior caller bytes synchronously on a session storage change", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(PAYLOAD), { status: 200 })).mockImplementationOnce(() => new Promise(() => {}));
    await mount(); expect(body()).toContain("912797SU2");
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "sb-project-auth-token" })));
    expect(body()).not.toContain("912797SU2");
  });
  it("same-tab sign-out clears state and prevents later polling from reusing previous caller bytes", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(PAYLOAD), { status: 200 }));
    await mount(); expect(body()).toContain("912797SU2");
    await act(async () => auth.listener?.("SIGNED_OUT", null));
    expect(body()).not.toContain("912797SU2"); expect(body()).toContain(LEX.saSignIn[0]);
    const calls = vi.mocked(fetch).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(fetch).toHaveBeenCalledTimes(calls);
  });
  it("rejects malformed refreshed context instead of retaining old data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(PAYLOAD), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ ...PAYLOAD, probabilities: .5 }), { status: 200 }));
    await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(300_000); }); await settle();
    expect(body()).not.toContain("912797SU2"); expect(body()).toContain(LEX.saUnavailable[0]);
  });
  it("aborts an in-flight old response and cannot restore it after same-tab sign-out", async () => {
    let finishOld: (value: Response) => void = () => {};
    const oldResponse = new Promise<Response>(resolve => { finishOld = resolve; });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(PAYLOAD), { status: 200 })).mockReturnValueOnce(oldResponse);
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    const oldSignal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    await act(async () => auth.listener?.("SIGNED_OUT", null));
    expect(oldSignal?.aborted).toBe(true); expect(body()).not.toContain("912797SU2");
    await act(async () => finishOld(new Response(JSON.stringify(PAYLOAD), { status: 200 }))); await settle();
    expect(body()).not.toContain("912797SU2"); expect(body()).toContain(LEX.saSignIn[0]);
  });
  it("a new principal cannot inherit an older principal's overlapping response", async () => {
    let finishOld: (value: Response) => void = () => {};
    const oldResponse = new Promise<Response>(resolve => { finishOld = resolve; });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(PAYLOAD), { status: 200 }))
      .mockReturnValueOnce(oldResponse).mockResolvedValueOnce(new Response(null, { status: 403 }));
    await mount();
    await act(async () => auth.listener?.("SIGNED_IN", { user: { id: "old-principal" }, access_token: "old-session" }));
    expect(body()).not.toContain("912797SU2");
    const oldSignal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    await act(async () => auth.listener?.("SIGNED_IN", { user: { id: "new-principal" }, access_token: "new-session" })); await settle();
    expect(oldSignal?.aborted).toBe(true); expect(body()).toContain(LEX.saNotEntitled[0]);
    await act(async () => finishOld(new Response(JSON.stringify(PAYLOAD), { status: 200 }))); await settle();
    expect(body()).not.toContain("912797SU2"); expect(body()).toContain(LEX.saNotEntitled[0]);
  });
});
