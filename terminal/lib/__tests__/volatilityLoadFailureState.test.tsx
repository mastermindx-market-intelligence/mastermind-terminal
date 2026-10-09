// @vitest-environment jsdom
/**
 * Failure-state truth on the Volatility tab: a read that did not land is not an absence.
 *
 * The REAL flowClientCache runs against an injected transport, so the whole chain is
 * exercised — fetch → classification → VolView state → rendered copy. A 5xx, a rejected
 * fetch and an unparseable body must render the load error; only a 404 from /api/flow
 * may render the coverage-gap empty state ("{sym} isn't in this nightly build"). The
 * same law applies one read lower, to the aggregate-trend store behind the spread panel:
 * an unread or still-pending store must never be described as unpublished. Each failed
 * read offers a Retry that really re-reads, so recovering never needs a page reload.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en", setLang: () => undefined }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { VolView } from "@/components/vol/VolView";
import { flowInvalidate } from "@/lib/flowClientCache";

const LOAD_ERROR = "Could not load volatility data";
const EMPTY_TITLE = "No volatility snapshot for this name yet";
const EMPTY_WHY_SPY = "SPY isn't in this nightly build";
const SPREAD_ABSENT_TITLE = "No IV − realized-vol spread history for this name";
const SPREAD_ABSENT_WHY = "it has not been published for this root";
const SPREAD_SHORT = "Not enough history";
const SPREAD_ERROR = "Could not load the spread history";
const SPREAD_LOADING = "Loading spread history";

const point = (strike: number, call_iv: number, put_iv: number) => ({ strike, call_iv, put_iv });
function volPayload(root: string, asof: string, base: number) {
  return {
    schema: "options_hub.vol/v1",
    root,
    asof,
    atm_iv: base,
    iv_52w_hi: base + 10,
    iv_52w_lo: base - 5,
    rv20: base - 1,
    vrp: 1,
    term: [
      { exp: "2026-10-23", dte: 28, atm_iv: base + 0.5 },
      { exp: "2026-11-20", dte: 56, atm_iv: base + 1.5 },
    ],
    smile: [{ exp: "2026-10-23", points: [point(90, base + 2, base + 3), point(100, base, base), point(110, base + 1, base + 2)] }],
    history: Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, iv_rank: null, atm_iv: base + i * 0.1, close: null })),
  };
}

// One injected transport answer per f-param. Anything unlisted is a published absence.
type Reply = { status: number; body: string } | "reject" | "pending";
const json = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body) });
const SPY_OK = json(200, volPayload("SPY", "2026-09-25", 12));
let replies: Record<string, Reply>;
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const f = new URL(String(input), "http://terminal.test").searchParams.get("f") ?? "";
  const reply = replies[f] ?? json(404, { error: "not published" });
  if (reply === "reject") throw new TypeError("Failed to fetch");
  if (reply === "pending") return new Promise<Response>(() => undefined);
  return new Response(reply.body, { status: reply.status, headers: { "content-type": "application/json" } });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  flowInvalidate();
  replies = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  flowInvalidate();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function mount() {
  await act(async () => root.render(<VolView />));
  await settle();
}
async function commitRoot(next: string) {
  const input = host.querySelector<HTMLInputElement>('input[list="vol-roots"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
}
const text = () => host.textContent ?? "";
const requested = (f: string) => fetchMock.mock.calls.filter(([u]) => String(u) === `/api/flow?f=${encodeURIComponent(f)}`).length;
const retryButton = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry") ?? null;
async function clickRetry() {
  const button = retryButton();
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
  await settle();
}

describe("Volatility tab: a failed snapshot read is not a coverage gap", () => {
  it.each([
    ["a 5xx from /api/flow", json(503, { error: "feed unavailable" })],
    ["a rejected fetch (network failure)", "reject" as const],
    ["an unparseable 200 body", { status: 200, body: "<html>upstream error page</html>" }],
  ])("renders the load error for %s", async (_label, reply) => {
    replies["vol:SPY"] = reply;
    await mount();
    expect(requested("vol:SPY")).toBe(1);
    expect(text()).toContain(LOAD_ERROR);
    expect(text()).not.toContain(EMPTY_TITLE);
    expect(text()).not.toContain(EMPTY_WHY_SPY);
    expect(retryButton()).not.toBeNull();
  });

  it("keeps the coverage-gap empty state for a real 404 absence, with nothing to retry", async () => {
    replies["vol:SPY"] = json(404, { error: "not published" });
    await mount();
    expect(text()).toContain(EMPTY_TITLE);
    expect(text()).toContain(EMPTY_WHY_SPY);
    expect(text()).not.toContain(LOAD_ERROR);
    expect(retryButton()).toBeNull();
  });

  it("re-reads in place: Retry asks the store again and renders what it answers", async () => {
    replies["vol:SPY"] = json(503, { error: "feed unavailable" });
    await mount();
    expect(text()).toContain(LOAD_ERROR);

    replies["vol:SPY"] = SPY_OK;
    await clickRetry();
    expect(requested("vol:SPY")).toBe(2);
    expect(text()).toContain("2026-09-25");
    expect(text()).not.toContain(LOAD_ERROR);
    expect(retryButton()).toBeNull();
  });

  it("does not remember a failed read: the next visit to the root reads again", async () => {
    replies["vol:SPY"] = json(503, { error: "feed unavailable" });
    await mount();
    expect(text()).toContain(LOAD_ERROR);

    replies["vol:SPY"] = SPY_OK;
    replies["vol:QQQ"] = json(200, volPayload("QQQ", "2026-09-26", 18));
    await commitRoot("QQQ");
    expect(text()).toContain("2026-09-26");
    await commitRoot("SPY");
    expect(requested("vol:SPY")).toBe(2);
    expect(text()).toContain("2026-09-25");
    expect(text()).not.toContain(LOAD_ERROR);
  });
});

describe("Volatility spread panel: the aggregate-trend read has its own failure state", () => {
  it.each([
    ["a 5xx", json(503, { error: "feed unavailable" })],
    ["a rejected fetch", "reject" as const],
  ])("does not call the history unpublished after %s", async (_label, reply) => {
    replies["vol:SPY"] = SPY_OK;
    replies["agg:SPY"] = reply;
    await mount();
    expect(requested("agg:SPY")).toBe(1);
    expect(text()).toContain("2026-09-25"); // the snapshot itself still rendered
    expect(text()).toContain(SPREAD_ERROR);
    expect(text()).not.toContain(SPREAD_ABSENT_TITLE);
    expect(text()).not.toContain(SPREAD_ABSENT_WHY);
    expect(text()).not.toContain(SPREAD_SHORT);
    expect(retryButton()).not.toBeNull();
  });

  it("does not claim absence while the store is still being read", async () => {
    replies["vol:SPY"] = SPY_OK;
    replies["agg:SPY"] = "pending";
    await mount();
    expect(requested("agg:SPY")).toBe(1);
    expect(text()).toContain(SPREAD_LOADING);
    expect(text()).not.toContain(SPREAD_ABSENT_TITLE);
    expect(text()).not.toContain(SPREAD_ABSENT_WHY);
    expect(text()).not.toContain(SPREAD_SHORT);
  });

  it("keeps the unpublished copy for a real 404 absence", async () => {
    replies["vol:SPY"] = SPY_OK;
    replies["agg:SPY"] = json(404, { error: "not published" });
    await mount();
    expect(text()).toContain(SPREAD_ABSENT_TITLE);
    expect(text()).toContain(SPREAD_ABSENT_WHY);
    expect(text()).not.toContain(SPREAD_ERROR);
    expect(text()).not.toContain(SPREAD_LOADING);
    expect(retryButton()).toBeNull();
  });

  it("re-reads only the spread store: the snapshot stays on screen while it does", async () => {
    replies["vol:SPY"] = SPY_OK;
    replies["agg:SPY"] = json(503, { error: "feed unavailable" });
    await mount();
    expect(text()).toContain(SPREAD_ERROR);
    // The snapshot is still cached, so a full re-read would refill the same text; only the
    // card's identity shows whether the snapshot ever left the screen.
    const snapshotCard = host.querySelector("section.fin-card");
    expect(snapshotCard).not.toBeNull();

    replies["agg:SPY"] = "pending";
    await clickRetry();
    expect(requested("agg:SPY")).toBe(2);
    expect(snapshotCard!.isConnected).toBe(true);
    expect(text()).toContain("2026-09-25");
    expect(text()).toContain(SPREAD_LOADING);
    expect(text()).not.toContain(SPREAD_ERROR);
  });

  it("renders what the spread re-read answers", async () => {
    replies["vol:SPY"] = SPY_OK;
    replies["agg:SPY"] = "reject";
    await mount();
    expect(text()).toContain(SPREAD_ERROR);

    replies["agg:SPY"] = json(404, { error: "not published" });
    await clickRetry();
    expect(requested("agg:SPY")).toBe(2);
    expect(text()).toContain(SPREAD_ABSENT_TITLE);
    expect(text()).not.toContain(SPREAD_ERROR);
    expect(retryButton()).toBeNull();
  });
});
