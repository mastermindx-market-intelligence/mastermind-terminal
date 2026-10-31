// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodaySinceLastVisit, { storageKey } from "@/components/workspaces/TodaySinceLastVisit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const i18n = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: i18n.lang }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => { throw new Error("TodaySinceLastVisit must not own identity"); } }));

type Held = { url: string; init?: RequestInit; resolve: (response: Response) => void; reject: (error: Error) => void };
let held: Held[]; let root: Root; let container: HTMLDivElement; let unauthenticated: ReturnType<typeof vi.fn>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function flush() { for (let n = 0; n < 4; n++) await act(async () => { await Promise.resolve(); }); }
async function answer(index: number, value: unknown, status = 200) { await act(async () => { held[index].resolve(json(value, status)); }); await flush(); }
async function fail(index: number) { await act(async () => { held[index].reject(new TypeError("Failed to fetch")); }); await flush(); }
async function mountNode(node: React.ReactNode) { await act(async () => root.render(node)); await flush(); }
async function renderOwner(ownerKey: string) {
  const scope = { current: new AbortController() };
  await mountNode(<TodaySinceLastVisit ownerKey={ownerKey} scope={scope} onUnauthenticated={unauthenticated} />);
  return scope;
}
const state = () => container.querySelector("[data-today-since-state]")?.getAttribute("data-today-since-state") ?? null;
const sentPrevious = (index: number) => JSON.parse(String(held[index].init?.body)).previous;
const BRIEF = { schema: "portfolio_brief.v2", state_digest: { names: { NVDA: "trend" } }, population: { disclosure_en: "Composed over the 3 names you hold.", disclosure_zh: "基于你持有的 3 个名称生成。" } };
const DIGEST_OLD = { names: { NVDA: "trend", AAPL: "chop" } };
const DIGEST_NEW = { names: { NVDA: "chop", AAPL: "chop" } };
const CURSOR = { scope: "device", note_en: "Your marker is kept on this device only.", note_zh: "你的标记仅保存在本设备。" };
function changes(lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return { schema: "portfolio_changes.v1", asof: "2026-10-30", first_visit: false, changes: lines, state_digest: DIGEST_NEW, cursor: CURSOR, ...extra };
}
const line = (ticker: string, en: string, zh = en) => ({ kind: "regime", en, zh, ticker });

beforeEach(() => {
  // Node 26 ships its own experimental global localStorage getter that shadows jsdom's
  // Storage under vitest; force the window back onto jsdom's instance (same workaround
  // as ThesisWorkspaceLensRail.test.tsx).
  const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
  if (dom) Object.defineProperty(window, "localStorage", { value: dom.window.localStorage, configurable: true, writable: true });
  i18n.lang = "en"; held = []; unauthenticated = vi.fn(); window.localStorage.clear();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => held.push({ url: String(input), init, resolve, reject }))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("Today — since your last visit", () => {
  it("first visit on a device: posts previous=null, renders the first-visit line, stores the desk's digest", async () => {
    await renderOwner(A);
    expect(state()).toBe("loading");
    expect(held).toHaveLength(1); expect(held[0].url).toBe("/api/portfolio-brief");
    await answer(0, BRIEF);
    expect(held).toHaveLength(2); expect(held[1].url).toBe("/api/portfolio-changes");
    expect(held[1].init?.method).toBe("POST");
    expect(sentPrevious(1)).toBeNull();
    await answer(1, changes([], { first_visit: true }));
    expect(state()).toBe("ready");
    expect(container.textContent).toContain("First visit on this device");
    expect(JSON.parse(String(window.localStorage.getItem(storageKey(A))))).toEqual(DIGEST_NEW);
  });

  it("returning visit: posts the stored digest and renders the desk's lines, each ticker linking to Analysis", async () => {
    window.localStorage.setItem(storageKey(A), JSON.stringify(DIGEST_OLD));
    await renderOwner(A);
    await answer(0, BRIEF);
    expect(sentPrevious(1)).toEqual(DIGEST_OLD);
    await answer(1, changes([line("NVDA", "NVDA moved from Trend to Chop.", "NVDA 从趋势转为震荡。"), { kind: "sector", en: "Technology lost leadership.", zh: "科技失去领导地位。", sector: "Technology" }]));
    expect(state()).toBe("ready");
    expect(container.textContent).toContain("NVDA moved from Trend to Chop.");
    expect(container.textContent).toContain("Technology lost leadership.");
    const link = Array.from(container.querySelectorAll("a")).find(a => a.textContent === "NVDA");
    expect(link?.getAttribute("href")).toBe("/analysis?symbol=NVDA");
    expect(container.textContent).toContain("Composed over the 3 names you hold.");
    expect(container.textContent).toContain(CURSOR.note_en);
    expect(container.textContent).toContain("2026-10-30");
    expect(JSON.parse(String(window.localStorage.getItem(storageKey(A))))).toEqual(DIGEST_NEW);
  });

  it("no change: renders the quiet line, never invents a change", async () => {
    window.localStorage.setItem(storageKey(A), JSON.stringify(DIGEST_NEW));
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, changes([]));
    expect(container.textContent).toContain("Nothing the desk tracks moved");
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("caps the list at six lines and routes the rest to Portfolio", async () => {
    window.localStorage.setItem(storageKey(A), JSON.stringify(DIGEST_OLD));
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, changes(["A", "B", "C", "D", "E", "F", "G", "H"].map(t => line(t, `${t} changed.`))));
    expect(container.querySelectorAll("li")).toHaveLength(6);
    expect(container.textContent).toContain("2 further changes on Portfolio.");
  });

  it("free tier: a 403 on the brief renders the teaser and never posts the digest", async () => {
    window.localStorage.setItem(storageKey(A), JSON.stringify(DIGEST_OLD));
    await renderOwner(A);
    await answer(0, { error: "pro_required", tier: "free" }, 403);
    expect(state()).toBe("teaser");
    expect(held).toHaveLength(1);
    expect(container.textContent).toContain("See the Pro brief");
    expect(window.localStorage.getItem(storageKey(A))).toBe(JSON.stringify(DIGEST_OLD));
  });

  it("signed out: a 401 renders nothing and hands the departure to the parent", async () => {
    await renderOwner(A);
    await answer(0, { error: "unauthenticated" }, 401);
    expect(container.querySelector("[data-today-since-state]")).toBeNull();
    expect(unauthenticated).toHaveBeenCalledTimes(1);
    expect(held).toHaveLength(1);
  });

  it("desk unavailable: a 503 keeps the stored marker and offers one retry", async () => {
    window.localStorage.setItem(storageKey(A), JSON.stringify(DIGEST_OLD));
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, { error: "ctx_unavailable" }, 503);
    expect(state()).toBe("unavailable");
    expect(window.localStorage.getItem(storageKey(A))).toBe(JSON.stringify(DIGEST_OLD));
    const retry = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes("Check again"));
    expect(retry).toBeTruthy();
    await act(async () => retry!.click()); await flush();
    expect(state()).toBe("loading");
    expect(held).toHaveLength(3); expect(held[2].url).toBe("/api/portfolio-brief");
  });

  it("network failure on the brief is unavailable, not a crash", async () => {
    await renderOwner(A);
    await fail(0);
    expect(state()).toBe("unavailable");
  });

  it("a malformed desk payload is unavailable and does not overwrite the marker", async () => {
    window.localStorage.setItem(storageKey(A), JSON.stringify(DIGEST_OLD));
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, { schema: "portfolio_changes.v1", first_visit: false, changes: [{ kind: "x" }], state_digest: DIGEST_NEW });
    expect(state()).toBe("unavailable");
    expect(window.localStorage.getItem(storageKey(A))).toBe(JSON.stringify(DIGEST_OLD));
  });

  it("markers are per owner and the section remounts on owner change", async () => {
    window.localStorage.setItem(storageKey(A), JSON.stringify(DIGEST_OLD));
    const scope = { current: new AbortController() };
    await mountNode(<TodaySinceLastVisit ownerKey={A} scope={scope} onUnauthenticated={unauthenticated} />);
    await answer(0, BRIEF);
    expect(sentPrevious(1)).toEqual(DIGEST_OLD);
    const next = { current: new AbortController() };
    scope.current.abort();
    await mountNode(<TodaySinceLastVisit ownerKey={B} scope={next} onUnauthenticated={unauthenticated} />);
    expect(held).toHaveLength(3); expect(held[2].url).toBe("/api/portfolio-brief");
    await answer(2, BRIEF);
    expect(sentPrevious(3)).toBeNull();
  });

  it("a scope abort ends the section and drops any late answer", async () => {
    const scope = await renderOwner(A);
    await act(async () => scope.current!.abort()); await flush();
    expect(container.querySelector("[data-today-since-state]")).toBeNull();
    await answer(0, BRIEF);
    expect(held).toHaveLength(1);
    expect(window.localStorage.getItem(storageKey(A))).toBeNull();
  });

  it("renders the desk's zh sentence and zh chrome when the reader is in zh", async () => {
    i18n.lang = "zh";
    window.localStorage.setItem(storageKey(A), JSON.stringify(DIGEST_OLD));
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, changes([line("NVDA", "NVDA moved from Trend to Chop.", "NVDA 从趋势转为震荡。")]));
    expect(container.textContent).toContain("自你上次查看以来");
    expect(container.textContent).toContain("NVDA 从趋势转为震荡。");
    expect(container.textContent).not.toContain("NVDA moved from Trend to Chop.");
    expect(container.textContent).toContain(CURSOR.note_zh);
    expect(container.textContent).toContain("基于你持有的 3 个名称生成。");
  });
});
