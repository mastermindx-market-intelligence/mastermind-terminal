// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MacroDashboard from "@/components/macro/MacroDashboard";
import { macroFixture } from "./fixtures/macroDashboard";
import { macroForecastFixture } from "./fixtures/macroForecast";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const identity = vi.hoisted(() => ({ owner: "11111111-1111-4111-8111-111111111111", lang: "en", failure: false, listener: null as null | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: identity.lang }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/macro.html", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => { void prefetch; return <a {...props}>{children}</a>; } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: identity.owner } }, error: identity.failure ? Error("unavailable") : null }), onAuthStateChange: (listener: typeof identity.listener) => { identity.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } }) }));
type Held = { init?: RequestInit; resolve: (value: Response) => void };
let root: Root, host: HTMLDivElement, requests: Held[];
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
async function mount(owner = A) { await act(async () => root.render(<MacroDashboard ownerKey={owner} />)); await flush(); }
async function answer(index = 0, body: unknown = macroFixture(), status = 200) { await act(async () => requests[index].resolve(Response.json(body, { status }))); await flush(); }
beforeEach(() => {
  identity.owner = A; identity.lang = "en"; identity.failure = false; identity.listener = null;
  window.history.replaceState({}, "", "/macro.html");
  requests = []; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ init, resolve }))));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("native Macro lifetime and interactions", () => {
  it("investigates date-selected forecast evidence without reviving withheld model claims", async () => {
    window.history.replaceState({}, "", "/macro.html#releases?date=2026-11-16");
    await mount(); await answer(0, { ...macroFixture(), release_forecast: macroForecastFixture(), release_forecast_sha256: "e".repeat(64) });
    const dialog = host.querySelector("dialog")!;
    expect(dialog.textContent).toContain("Older model snapshot");
    expect(dialog.textContent).toContain("Model + benchmark blend");
    expect(dialog.textContent).not.toContain("9.99");
    const click = async (name: string) => act(async () => [...dialog.querySelectorAll("button")].find(button => button.textContent === name)!.click());
    await click("Models");
    expect(dialog.textContent).toContain("Claim withdrawn");
    expect(dialog.textContent).not.toContain("777");
    await click("History");
    expect(dialog.textContent).toContain("Excluded / unqualified");
    expect(dialog.textContent).not.toContain("Mean absolute error");
    await click("2026-11-19");
    expect(dialog.textContent).toContain("Benchmarks only · no house forecast");
    expect(dialog.textContent).toContain("Initial claims level · thousands");
    expect(window.location.hash).toContain("date=2026-11-19");
    await click("Models");
    expect(dialog.textContent).toContain("223.75");
    expect(dialog.textContent).not.toContain("Experimental model point");
    await click("Date unconfirmed");
    expect(dialog.textContent).toContain("The source has not published a retail projection.");
  });
  it("pins default release identity and preserves the tab through refresh without switching targets", async () => {
    window.history.replaceState({}, "", "/macro.html#releases?date=2026-11-16");
    const source = macroForecastFixture();
    await mount(); await answer(0, { ...macroFixture(), release_forecast: source, release_forecast_sha256: "e".repeat(64), release_forecast_state: "available" });
    expect(decodeURIComponent(window.location.hash)).toContain("cpi_headline");
    const models = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === "Models")!;
    await act(async () => models.click());
    expect(window.location.hash).toContain("tab=models");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh readings"]')!.click());
    await answer(1, { ...macroFixture(), release_forecast: { ...source, upcoming: source.upcoming.slice(1) }, release_forecast_sha256: "f".repeat(64), release_forecast_state: "available" });
    expect(host.querySelector("dialog")?.textContent).toContain("This exact release is no longer present");
    expect(decodeURIComponent(window.location.hash)).toContain("cpi_headline");
  });
  it("retains the forecast only for a temporary read failure, and clears explicit qualification refusal", async () => {
    window.history.replaceState({}, "", "/macro.html#releases?date=2026-11-16");
    await mount(); await answer(0, { ...macroFixture(), release_forecast: macroForecastFixture(), release_forecast_sha256: "e".repeat(64), release_forecast_state: "available" });
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh readings"]')!.click());
    await answer(1, { ...macroFixture(), release_forecast: null, release_forecast_state: "unavailable" });
    expect(host.querySelector("dialog")?.textContent).toContain("Forecast refresh unavailable");
    expect(host.querySelector("dialog")?.textContent).toContain("2026-10-16");
    expect(host.querySelector("dialog")?.textContent).toContain("Model + benchmark blend");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh readings"]')!.click());
    await answer(2, { ...macroFixture(), release_forecast: null, release_forecast_state: "unqualified" });
    expect(host.querySelector("dialog")?.textContent).not.toContain("Model + benchmark blend");
    expect(host.querySelector("dialog")?.textContent).toContain("Forecast publication unavailable");
  });
  it("renders genuine zero, historical qualification and the actual producer display fields", async () => {
    await mount(); await answer();
    expect(host.textContent).toContain("Current assessment unavailable");
    expect(host.textContent).toContain("Historical reading");
    expect(host.textContent).toContain("Extreme fear");
    expect(host.textContent).toContain("6,000.00");
    expect(host.textContent).toContain("Payrolls");
    expect(host.querySelector("iframe")).toBeNull();
    const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Table view")!;
    await act(async () => button.click());
    expect(host.querySelector("table")?.textContent).toContain("2026-11-12—");
  });
  it("opens old deep links, keeps unavailable scares empty and closes a direct-link drawer", async () => {
    window.history.replaceState({}, "", "/macro.html?workspaceMarket=us#dlg-risk");
    await mount(); await answer();
    expect(host.querySelector("dialog[open]")?.textContent).toContain("Breadth");
    expect(host.querySelector("dialog[open]")?.textContent).not.toContain("99/100");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Close detail"]')!.click());
    expect(host.querySelector("dialog")).toBeNull();
    expect(window.location.search).toBe("?workspaceMarket=us");
  });
  it("preserves partial risk evidence and only exposes odds bound to their exact history", async () => {
    window.history.replaceState({}, "", "/macro.html#risk");
    const body = macroFixture();
    Object.assign(body.market_state.radar, { dd21: .2, dd_base: { h21: .1 }, dd_evidence: { horizons: { h21: { matched: true, displayed_probability: .2, n: 60, events: 12, observed_rate: .2, thin: true } } }, scares: [{ label_en: "Partial scare", reading_state: "PARTIAL", display_score: 70, partial_composition: true, n_legs_resolved: 2, n_legs_registered: 4 }] });
    await mount(); await answer(0, body);
    const dialog = host.querySelector("dialog")!;
    expect(dialog.textContent).toContain("70/100");
    expect(dialog.textContent).toContain("Thin historical sample");
    expect(dialog.textContent).toContain("20%");
    const five = [...dialog.querySelectorAll("button")].find(button => button.textContent === "5d")!;
    await act(async () => five.click());
    expect(dialog.textContent).toContain("Matching estimate evidence unavailable");
    expect(dialog.textContent).not.toContain("20%");
  });
  it("clears all data on sign-out and cannot resurrect it from a late response", async () => {
    await mount(); await answer();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh readings"]')!.click());
    await act(async () => identity.listener!("SIGNED_OUT", null));
    expect(requests[1].init?.signal?.aborted).toBe(true);
    await answer(1);
    expect(host.textContent).not.toContain("Published historical stance.");
    expect(host.textContent).toContain("Private readings have been cleared");
  });
  it("destroys A→B→A data and ignores the previous account response", async () => {
    await mount(); await answer(); identity.owner = B; await mount(B); identity.owner = A; await mount(A);
    expect(host.textContent).not.toContain("Published historical stance.");
    await answer(1); expect(host.textContent).not.toContain("Published historical stance.");
    await answer(2); expect(host.textContent).toContain("Published historical stance.");
  });
  it("keeps identity failure separate and supports Chinese source labels", async () => {
    identity.failure = true; await mount(); expect(requests).toHaveLength(0);
    expect(host.textContent).toContain("could not verify");
  });
  it("uses Chinese copy with zero and the source's own older brief date", async () => {
    identity.lang = "zh"; window.history.replaceState({}, "", "/macro.html#brief");
    await mount(); await answer();
    expect(host.textContent).toContain("宏观仪表盘");
    expect(host.textContent).toContain("极度恐慌");
    expect(host.querySelector("dialog")?.textContent).toContain("2026-10-01");
    expect(host.querySelector("dialog")?.textContent).toContain("较早的来源简报。");
  });
});
