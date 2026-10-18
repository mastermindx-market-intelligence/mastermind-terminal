// @vitest-environment jsdom
//
// The Portfolio page's readback ordering (F08; macro#6819 5979873599 — the page-side item named
// when B-F08-13 closed the same exposure in Settings).
//
// Two mechanisms, both in components/PortfolioView.tsx and both observable only with the real
// component mounted against a fetch whose responses the test releases by hand:
//
//   1. ONE mutation chain for the whole page — target saves and clears now join the chain that
//      position mutations always used, so a second write's POST is not sent until the first
//      write's re-read has settled.
//   2. Newest-read-wins — reload() is shared by the mount read, Retry and every chained mutation;
//      a read that was superseded while in flight writes nothing when its response finally lands.
//
// Mounted through react-dom/client (this repo has no @testing-library), as
// SectionPortfolioTargets.test.tsx does. The quote poll is answered with an empty payload and the
// manifest read with null; nothing shells out. Lives under lib/__tests__ because that is where
// vitest.config.ts looks for .tsx suites outside components/settings.
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement("a", { href: String(href), ...rest }, children),
}));
vi.mock("@/components/PortfolioBriefPanel", () => ({ default: () => null }));
vi.mock("@/components/EventImpactPanel", () => ({ default: () => null }));
vi.mock("@/components/PositionModal", () => ({ default: () => null }));
vi.mock("@/lib/dataCache", () => ({ getJSON: async () => null }));

import PortfolioView from "@/components/PortfolioView";
import { T_CLEAR, T_SAVE_FAIL, type PortfolioTargetsSummary } from "@/lib/portfolioTargets";
import type { Position } from "@/lib/portfolio";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── fetch the test releases by hand ──────────────────────────────────────────

type Pending = {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  resolve: (r: Response) => void;
};
const pending: Pending[] = [];
/** Every request the page issued, in order, except the quote poll. */
const calls: string[] = [];

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch() {
  const real = globalThis.fetch;
  pending.length = 0;
  calls.length = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.startsWith("/api/quote")) return jsonRes(200, { quotes: {} });
    calls.push(`${method} ${url}`);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    return new Promise<Response>((resolve) => { pending.push({ url, method, body, resolve }); });
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

/** The unanswered requests matching method + exact url, in issue order. */
const inflight = (method: string, url: string) => pending.filter((p) => p.method === method && p.url === url);

async function flush() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

async function release(p: Pending | undefined, status: number, body: unknown) {
  expect(p, "expected a request to release").toBeDefined();
  pending.splice(pending.indexOf(p!), 1);
  await act(async () => { p!.resolve(jsonRes(status, body)); });
  await flush();
}

// ── fixtures ────────────────────────────────────────────────────────────────

const position = (id: string, ticker: string, status: "open" | "closed"): Position => ({
  id, ticker, shares: 10, entryPrice: 100, entryDate: "2026-01-02", notes: null, status,
  createdAt: "2026-01-02T00:00:00.000Z",
});
const AAPL = position("p-aapl", "AAPL", "open");
const AAPL_CLOSED: Position = { ...AAPL, status: "closed" };
const MSFT = position("p-msft", "MSFT", "open");

const drift = (ticker: string, targetWeightPct: number): PortfolioTargetsSummary["drifts"][number] => ({
  ticker, currentWeightPct: 50, targetWeightPct, bandPct: 5, driftPct: 50 - targetWeightPct, status: "outside_band",
});
function summary(
  drifts: PortfolioTargetsSummary["drifts"] = [],
  untargeted: PortfolioTargetsSummary["untargeted"] = [],
  orphaned: PortfolioTargetsSummary["orphaned"] = [],
): PortfolioTargetsSummary {
  return { schema: "portfolio_targets.v1", weightBasis: "cost", targetsSumPct: 0, targetsSumOffBy100: 0, drifts, untargeted, orphaned };
}

// ── mount ───────────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let restoreFetch: (() => void) | null = null;

function mount(positions: Position[]) {
  restoreFetch = installFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<PortfolioView positions={positions} email="a@example.com" />); });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  restoreFetch?.();
  root = null; container = null; restoreFetch = null;
});

const button = (label: string) => container!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const clearButtons = () =>
  Array.from(container!.querySelectorAll<HTMLButtonElement>('section[data-testid="portfolio-targets"] button'))
    .filter((b) => b.textContent === T_CLEAR.en);
async function click(b: HTMLButtonElement | null | undefined) {
  expect(b, "expected the control to be on the page").toBeTruthy();
  await act(async () => { b!.click(); });
  await flush();
}

/** Answer one full page read (positions → targets → risk history) with the given book. */
async function answerRead(positions: Position[], targets: PortfolioTargetsSummary, which = 0) {
  await release(inflight("GET", "/api/portfolio")[which], 200, { positions, risk: null });
  await release(inflight("GET", "/api/portfolio/targets")[0], 200, { summary: targets });
  await release(inflight("GET", "/api/portfolio/risk-history")[0], 200, { history: null });
}

// ────────────────────────────────────────────────────────────────────────────

describe("PortfolioView readback ordering (F08 page-side; macro#6819 5979873599)", () => {
  it("a mount read that lands AFTER a chained close does not resurrect the open row (newest read wins)", async () => {
    mount([AAPL]);
    expect(inflight("GET", "/api/portfolio")).toHaveLength(1);        // the mount read, still open

    await click(button("Close AAPL"));
    const posts = inflight("POST", "/api/portfolio");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ action: "close", id: "p-aapl" });
    await release(posts[0], 200, { ok: true, position: AAPL_CLOSED });

    // Two reads of the book are now in flight: [0] the mount read, [1] the close's re-read.
    expect(inflight("GET", "/api/portfolio")).toHaveLength(2);
    await answerRead([AAPL_CLOSED], summary([], [], [{ ticker: "AAPL", targetWeightPct: 10, bandPct: 5 }]), 1);
    expect(button("Close AAPL")).toBeNull();
    expect(button("Reopen AAPL")).not.toBeNull();
    expect(container!.querySelector(".pf-failure")).toBeNull();        // postcondition held on its own readback

    // The mount read lands LAST, carrying the pre-close book and the pre-close targets.
    await answerRead([AAPL], summary([drift("AAPL", 10)]), 0);
    expect(button("Close AAPL")).toBeNull();                            // RED on master: AAPL painted open again
    expect(button("Reopen AAPL")).not.toBeNull();
    expect(container!.querySelector('[data-testid="targets-orphaned"]')).not.toBeNull();
    expect(clearButtons()).toHaveLength(0);                             // and no target card came back either
  });

  it("target clears join the page chain: the second POST waits for the first write's re-read", async () => {
    mount([AAPL, MSFT]);
    await answerRead([AAPL, MSFT], summary([drift("AAPL", 10), drift("MSFT", 20)]));
    expect(clearButtons()).toHaveLength(2);
    const before = calls.length;

    await click(clearButtons()[0]);                                     // AAPL
    await click(clearButtons()[1]);                                     // MSFT, while AAPL's write is in flight
    let posts = inflight("POST", "/api/portfolio/targets");
    expect(posts).toHaveLength(1);                                      // RED on master: both POSTs in flight at once
    expect(posts[0].body).toEqual({ action: "clear", ticker: "AAPL" });

    await release(posts[0], 200, { ok: true });
    await answerRead([AAPL, MSFT], summary([drift("MSFT", 20)], [{ ticker: "AAPL", currentWeightPct: 50 }]));
    posts = inflight("POST", "/api/portfolio/targets");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ action: "clear", ticker: "MSFT" });
    await release(posts[0], 200, { ok: true });
    await answerRead([AAPL, MSFT], summary([], [{ ticker: "AAPL", currentWeightPct: 50 }, { ticker: "MSFT", currentWeightPct: 50 }]));

    expect(clearButtons()).toHaveLength(0);
    const untargeted = container!.querySelector('[data-testid="targets-untargeted"]')!.textContent ?? "";
    expect(untargeted).toContain("AAPL");
    expect(untargeted).toContain("MSFT");
    expect(calls.slice(before)).toEqual([
      "POST /api/portfolio/targets", "GET /api/portfolio", "GET /api/portfolio/targets", "GET /api/portfolio/risk-history",
      "POST /api/portfolio/targets", "GET /api/portfolio", "GET /api/portfolio/targets", "GET /api/portfolio/risk-history",
    ]);
  });

  it("a refused target write rejects only its own caller and does not wedge the chain (positive control)", async () => {
    mount([AAPL, MSFT]);
    await answerRead([AAPL, MSFT], summary([drift("AAPL", 10), drift("MSFT", 20)]));

    await click(clearButtons()[0]);                                     // AAPL
    await release(inflight("POST", "/api/portfolio/targets")[0], 400, { error: "unknown_ticker" });
    expect(inflight("GET", "/api/portfolio")).toHaveLength(0);          // a refused write is not re-read
    expect(container!.querySelector('section[data-testid="portfolio-targets"]')!.textContent).toContain(T_SAVE_FAIL.en);
    expect(clearButtons()).toHaveLength(2);                             // AAPL's target survived its refused clear

    await click(clearButtons()[1]);                                     // MSFT — the chain is not wedged
    const posts = inflight("POST", "/api/portfolio/targets");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ action: "clear", ticker: "MSFT" });
    await release(posts[0], 200, { ok: true });
    await answerRead([AAPL, MSFT], summary([drift("AAPL", 10)], [{ ticker: "MSFT", currentWeightPct: 50 }]));
    expect(clearButtons()).toHaveLength(1);
  });
});
