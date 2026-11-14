// @vitest-environment jsdom
/** Real candidate presenter, lane composition, URL owner and request boundary.
 * Only unrelated engines and HTTP are substituted with original synthetic data.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const locale = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: locale.lang }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowPrefetch: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => { void prefetch; return <a {...props}>{children}</a>; } }));
vi.mock("@/components/prophet/OptionsAlphaView", () => ({ OptionsAlphaView: () => <p>Existing options</p> }));
vi.mock("@/components/prophet/OptionsIssueDeskView", () => ({ OptionsIssueDeskView: () => <p>Existing issue desk</p> }));
vi.mock("@/components/prophet/ProphetView", () => ({ ProphetView: () => <p>Existing model plans</p> }));
vi.mock("@/components/prophet/today/TodayView", () => ({ TodayView: () => <p>Existing Today</p> }));
vi.mock("@/components/prophet/sector/ProphetSectorView", () => ({ ProphetSectorView: () => <p>Existing Screener</p> }));
import { ProphetLanesView } from "@/components/prophet/ProphetLanesView";
import type { ProphetCandidateBoundary } from "@/components/prophet/candidates/ProphetCandidateView";
import { candidatePoolFixture } from "./fixtures/prophetCandidatePool";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const fetcher = vi.fn<typeof fetch>();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
let host: HTMLDivElement, root: Root, reading: ProphetCandidateBoundary;
const q = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
const query = () => new URLSearchParams(window.location.search);
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent === text)!;
const tick = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
async function mount(href = "/prophet?tab=candidates&workspaceMarket=us", boundary = true) {
  window.history.replaceState({}, "", href);
  await act(async () => root.render(<ProphetLanesView reading={boundary ? reading : undefined} />));
  await tick();
}
async function click(node: HTMLElement) { expect(node).not.toBeNull(); await act(async () => node.click()); await tick(); }
async function draft(text: string) {
  const input = q<HTMLInputElement>("#prophet-candidate-search");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function search(text: string) {
  await draft(text);
  await act(async () => { q("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
async function popTo(href: string) {
  await act(async () => { window.history.replaceState({}, "", href); window.dispatchEvent(new PopStateEvent("popstate")); });
  await tick();
}
function pending() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  locale.lang = "en";
  reading = { scope: { current: new AbortController() }, invalidateIdentity: vi.fn() };
  fetcher.mockReset().mockImplementation(async () => json(candidatePoolFixture()));
  vi.stubGlobal("fetch", fetcher);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); reading.scope.current?.abort(); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/");
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("native complete candidate investigation", () => {
  it("keeps the complete source, zero and unscored values while list/detail/back retain the search and focus", async () => {
    await mount("/prophet?tab=candidates&workspaceMarket=us&study=retained");
    expect(q('[data-testid="prophet-tab-candidates"]').getAttribute("aria-selected")).toBe("true");
    expect(q('[data-testid="prophet-tab-candidates"]').tabIndex).toBe(0);
    expect(q('[data-testid="prophet-tab-candidates"]').getAttribute("aria-controls")).toBe("prophet-panel-candidates");
    expect(host.querySelectorAll("[data-candidate]")).toHaveLength(4);
    expect(q('[data-candidate="DEMOB"]').closest("li")!.textContent).toContain("0.0");
    expect(q('[data-candidate="DEMOC"]').closest("li")!.textContent).toContain("Not scored");
    await search("Technology");
    expect(host.querySelectorAll("[data-candidate]")).toHaveLength(2);
    expect(query().get("prophetQ")).toBe("Technology");
    q('[data-testid="prophet-candidates"]').scrollTop = 137;
    await click(q('[aria-label="Inspect DEMOC"]'));
    expect(query().get("symbol")).toBe("DEMOC");
    expect(query().get("prophetView")).toBeNull();
    expect(query().get("study")).toBe("retained");
    expect(q("h2").textContent).toBe("Cedar Networks");
    expect(document.activeElement).toBe(q("h2"));
    expect(host.textContent).toContain("This candidate appears in the publication’s eligible pool.");
    await click(Array.from(host.querySelectorAll("a")).find(a => a.textContent?.includes("All candidates"))!);
    expect(query().get("symbol")).toBeNull();
    expect(query().get("prophetQ")).toBe("Technology");
    expect(document.activeElement).toBe(q('[data-candidate="DEMOC"]'));
    expect(q('[data-testid="prophet-candidates"]').scrollTop).toBe(137);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("commits bilingual search once and clears its wider grammar before leaving for the Sector API", async () => {
    locale.lang = "zh"; await mount();
    const push = vi.spyOn(window.history, "pushState");
    await draft("晨光"); expect(push).not.toHaveBeenCalled();
    expect(host.querySelectorAll("[data-candidate]")).toHaveLength(4);
    await search("晨光"); expect(push).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll("[data-candidate]")).toHaveLength(1);
    expect(q('[data-candidate="DEMOD"]').textContent).toContain("查看候选");
    expect(query().get("prophetQ")).toBe("晨光");
    await click(q('[data-testid="prophet-tab-screener"]'));
    expect(query().get("tab")).toBe("screener"); expect(query().has("prophetQ")).toBe(false);
    expect(host.textContent).toContain("Existing Screener");
  });

  it("clears an invalid draft even when the committed query was already empty", async () => {
    await mount(); await search("invalid\u0001query");
    expect(q<HTMLInputElement>("input").getAttribute("aria-invalid")).toBe("true");
    await click(button("Clear search"));
    expect(q<HTMLInputElement>("input").value).toBe("");
    expect(q<HTMLInputElement>("input").hasAttribute("aria-invalid")).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll("[data-candidate]")).toHaveLength(4);
  });

  it("restores shared detail/popstate and names an absent selection without choosing a replacement", async () => {
    const shared = "/prophet?tab=candidates&symbol=DEMOC&prophetQ=Technology&workspaceMarket=us";
    await mount(shared); expect(q("h2").textContent).toBe("Cedar Networks");
    await popTo("/prophet?tab=candidates&symbol=DEMOX&prophetQ=Technology&workspaceMarket=us");
    expect(host.textContent).toContain("DEMOX is not in this publication");
    expect(host.textContent).not.toContain("Cedar Networks");
    expect(host.querySelectorAll("[data-candidate]")).toHaveLength(0);
    await popTo(shared); expect(q("h2").textContent).toBe("Cedar Networks");
    await popTo("/prophet?tab=candidates&prophetQ=Technology&workspaceMarket=us");
    expect(document.activeElement).toBe(q('[data-candidate="DEMOC"]'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("opens the actual source disclosure and keeps generic plans free of a stale selection", async () => {
    await mount("/prophet?tab=candidates&symbol=DEMOC&prophetQ=Cedar&prophetPlan=OLD-PLAN&workspaceMarket=us");
    await click(button("Sources & method"));
    expect(q<HTMLDetailsElement>("details").open).toBe(true);
    expect(document.activeElement).toBe(q("summary"));
    expect(q("details").textContent).toContain(candidatePoolFixture().source.sha256);
    await click(Array.from(host.querySelectorAll("a")).find(a => a.textContent?.includes("Browse model plans"))!);
    expect(query().get("tab")).toBe("plans");
    for (const key of ["symbol", "sector", "prophetQ", "prophetPlan"]) expect(query().has(key)).toBe(false);
    expect(host.textContent).toContain("Existing model plans");
  });

  it("distinguishes no search matches from a verified empty publication", async () => {
    await mount(); await search("Zephyr");
    expect(host.textContent).toContain("No candidates match this search");
    expect(host.textContent).toContain("0 / 4"); expect(host.textContent).not.toContain("No eligible candidates in this publication");
    const empty = candidatePoolFixture(); empty.projection.rows = []; empty.projection.status = "empty";
    for (const key of Object.keys(empty.projection.counts) as (keyof typeof empty.projection.counts)[]) empty.projection.counts[key] = 0;
    fetcher.mockResolvedValueOnce(json(empty)); await click(button("Refresh"));
    expect(host.textContent).toContain("No eligible candidates in this publication");
    expect(host.textContent).toContain("0 / 0");
  });

  it("shows unavailable counts and an explicit unknown date from a typed unavailable response", async () => {
    const value = candidatePoolFixture(); value.projection.status = "unavailable";
    value.projection.reason = "candidate_pool_absent"; value.projection.rows = [];
    value.projection.source_digest = null; value.projection.as_of = null;
    for (const key of Object.keys(value.projection.counts) as (keyof typeof value.projection.counts)[]) value.projection.counts[key] = null;
    fetcher.mockResolvedValueOnce(json(value, 503)); await mount();
    expect(host.textContent).toContain("Candidate count unavailable");
    expect(host.textContent).toContain("Date unavailable");
    expect(host.querySelectorAll("[data-candidate]")).toHaveLength(0);
    expect(host.textContent).not.toContain("0 / 0");
  });

  it("clears private names on denied refresh and returns through the existing Today owner", async () => {
    await mount(); expect(host.textContent).toContain("Aster Instruments");
    fetcher.mockResolvedValueOnce(json({ error: "full_access_required" }, 403)); await click(button("Refresh"));
    expect(host.textContent).not.toContain("Aster Instruments");
    expect(host.textContent).toContain("Your access does not include this candidate reading");
    expect(host.querySelector("details")).toBeNull();
    await click(button("Back to Prophet Today"));
    expect(host.textContent).toContain("Existing Today"); expect(query().get("tab")).toBeNull();
  });

  it("aborts departing-lane reads and ignores a late response without ending the account", async () => {
    const late = pending(); fetcher.mockReturnValueOnce(late.promise); await mount();
    const signal = fetcher.mock.calls[0][1]!.signal!;
    await click(q('[data-testid="prophet-tab-today"]'));
    expect(signal.aborted).toBe(true); expect(reading.scope.current!.signal.aborted).toBe(false);
    late.resolve(json(candidatePoolFixture())); await tick();
    expect(host.textContent).not.toContain("Aster Instruments"); expect(reading.invalidateIdentity).not.toHaveBeenCalled();
  });

  it("never accepts a prior-account result or lets its late 401 invalidate the new identity", async () => {
    const late = pending(); fetcher.mockReturnValueOnce(late.promise); await mount();
    reading.scope.current!.abort(); reading.scope.current = new AbortController();
    late.resolve(json({ error: "old_identity" }, 401)); await tick();
    expect(reading.invalidateIdentity).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("Aster Instruments");
  });

  it("closes the current identity on 401 without waiting for a response body", async () => {
    fetcher.mockResolvedValueOnce(new Response("not-json", { status: 401 })); await mount();
    expect(reading.invalidateIdentity).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Aster Instruments");
  });

  it("does not add a candidate read or identity owner to the legacy Options mount", async () => {
    await mount("/options?tab=prophet&prophetLane=candidates", false);
    expect(host.querySelector('[data-testid="prophet-tab-candidates"]')).toBeNull();
    expect(q<HTMLAnchorElement>('a[href="/prophet?tab=candidates"]').textContent).toContain("Open the complete candidate workspace");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
