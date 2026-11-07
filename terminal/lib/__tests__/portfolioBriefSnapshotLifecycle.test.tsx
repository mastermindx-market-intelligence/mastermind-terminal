// @vitest-environment jsdom
//
// The canonical-read binding LIFECYCLE, on the real mounted PortfolioView.
//
// The brief may render its facts only for the authenticated owner and the canonical
// portfolio book that produced them. This suite mounts the REAL page and pins the
// lifecycle that makes that true:
//
//   * the binding is published from the SAME `decodePositionRead` acceptance that sets the
//     positions, and it reaches the panel as one stable identity;
//   * a canonical reread that lands a DIFFERENT book retires the old facts — a late
//     answer for the previous book can never paint under the new binding;
//   * a FAILED canonical read is unavailable, not a perpetual checking state, and the
//     brief's facts are retired while the positions table keeps its existing policy;
//   * a committed owner change retires the binding, and a late previous-owner answer
//     cannot paint;
//   * the opt-in is unconditional: the panel never falls back to a legacy request.
//
// No @testing-library/react in this repo — react-dom/client's createRoot plus react's
// act, per the PortfolioView failed-reread precedent.
//
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import type { Position } from "@/lib/portfolio";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children?: React.ReactNode; href: string }) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("@/components/PortfolioRisk.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("@/components/PortfolioRiskHistory.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("@/components/PortfolioTargets.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

vi.mock("@/lib/dataCache", () => ({ getJSON: vi.fn(async () => null) }));

import PortfolioView from "@/components/PortfolioView";
import { LangProvider, LEX } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER_ID = "3f0d4a5e-6c21-4f8a-9b77-2c9a1d5e7f30";
const OTHER_USER_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

function position(id: string, ticker: string, shares: number, entryPrice: number): Position {
  return {
    id,
    ticker,
    shares,
    entryPrice,
    entryDate: "2026-01-01",
    notes: null,
    status: "open",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/** The canonical Node book key of a set of positions — the unchanged owner. */
function bookKeyOf(positions: Position[]): string {
  return portfolioBookKey(positions);
}

/** A brief body whose context names a book and an owner. */
function briefFor(bookKey: string, owner: string, headline: string): unknown {
  return {
    schema: "portfolio_brief.v2",
    asof: "2026-11-02",
    generated_at: "2026-11-02T09:30:00+00:00",
    stale: false,
    weighting: { mode: "positions", label_en: "By cost basis", label_zh: "按成本权重" },
    book: { n: 1, covered: 1, uncovered: [] },
    population: {
      mode: "positions",
      label_en: "Your holdings",
      label_zh: "你的持仓",
      n: 1,
      disclosure_en: "This read describes the 1 name you hold.",
      disclosure_zh: "此判读描述你持有的 1 只个股。",
    },
    headline: { en: headline, zh: `${headline}（中文）` },
    sections: [],
    context: { version: "snapshot-v1", owner, bookKey, population: "positions" },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

type Harness = {
  container: HTMLDivElement;
  root: Root | undefined;
  /** The canonical books the canonical read will serve, in order. */
  books: Position[][];
  /** Every canonical read served so far. */
  canonicalReads: number;
  /** The brief requests the panel made, in order. */
  briefRequests: { headers: Record<string, string> }[];
  /** Deferred brief answers, so a late one can be delivered after a newer one. */
  briefAnswers: ReturnType<typeof deferred<unknown>>[];
  /** When true the canonical read fails. */
  failCanonical: boolean;
};

let harness: Harness;
let realFetch: typeof globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  harness = {
    container: document.createElement("div"),
    root: undefined,
    books: [],
    canonicalReads: 0,
    briefRequests: [],
    briefAnswers: [],
    failCanonical: false,
  };
  document.body.appendChild(harness.container);
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/portfolio-brief")) {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[key.toLowerCase()] = value;
      }
      harness.briefRequests.push({ headers });
      const answer = deferred<unknown>();
      harness.briefAnswers.push(answer);
      return await answer.promise;
    }
    if (url.includes("/api/portfolio/targets")) return json({}, 404);
    if (url.includes("/api/portfolio/risk-history")) return json({}, 404);
    if (url.includes("/api/portfolio?view=positions")) {
      harness.canonicalReads += 1;
      if (harness.failCanonical) return json({ error: "portfolio unavailable" }, 503);
      const book = harness.books[Math.min(harness.canonicalReads - 1, harness.books.length - 1)];
      return json({ positions: book, bookKey: bookKeyOf(book) });
    }
    if (url === "/api/portfolio") return json({}, 404);
    return json({}, 404);
  }) as typeof globalThis.fetch;
});

afterEach(async () => {
  await act(async () => { harness.root?.unmount(); });
  harness.root = undefined;
  harness.container.remove();
  globalThis.fetch = realFetch;
});

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function mount(seed: Position[], userId: string = USER_ID) {
  await act(async () => {
    harness.root = createRoot(harness.container);
    harness.root.render(
      React.createElement(
        LangProvider,
        null,
        React.createElement(PortfolioView, { positions: seed, email: "t@example.com", userId }),
      ),
    );
  });
  await flush();
}

function briefText() {
  return harness.container.querySelector(".pbrief")?.textContent ?? "";
}

/** Answer the newest brief request. */
async function answerLatest(body: unknown, status = 200) {
  const answer = harness.briefAnswers[harness.briefAnswers.length - 1];
  await act(async () => { answer.resolve(json(body, status)); });
  await flush();
}

describe("PortfolioView — the canonical binding lifecycle", () => {
  it("publishes the binding from the canonical read and renders only that book's brief", async () => {
    const book = [position("p1", "NVDA", 10, 150)];
    harness.books = [book];
    await mount(book);

    // The canonical read happened and the panel asked for the bound brief.
    expect(harness.canonicalReads).toBeGreaterThanOrEqual(1);
    expect(harness.briefRequests.length).toBeGreaterThanOrEqual(1);
    // The opt-in is unconditional: the request always names the snapshot contract.
    expect(harness.briefRequests[0].headers["x-mastermind-portfolio-context"]).toBe("snapshot-v1");

    // Nothing is rendered before the brief answers.
    expect(briefText()).not.toContain("BOOK A");

    await answerLatest(briefFor(bookKeyOf(book), USER_ID, "BOOK A"));
    expect(briefText()).toContain("BOOK A");
  });

  it("a canonical reread that lands another book retires the old facts", async () => {
    const first = [position("p1", "NVDA", 10, 150)];
    // The SAME COUNT, a different book: the shares changed.
    const second = [position("p1", "NVDA", 11, 150)];
    harness.books = [first, second];
    await mount(first);

    await answerLatest(briefFor(bookKeyOf(first), USER_ID, "BOOK A"));
    expect(briefText()).toContain("BOOK A");

    // A new server render (a new seed) starts a new canonical read.
    await act(async () => {
      harness.root!.render(
        React.createElement(
          LangProvider,
          null,
          React.createElement(PortfolioView, {
            positions: second,
            email: "t@example.com",
            userId: USER_ID,
          }),
        ),
      );
    });
    await flush();
    expect(harness.canonicalReads).toBeGreaterThanOrEqual(2);

    // The LATE answer for the PREVIOUS book arrives after the new binding is in place.
    // It must not paint: the facts belonged to a book the page is no longer showing.
    const late = harness.briefAnswers[0];
    await act(async () => {
      late.resolve(briefFor(bookKeyOf(first), USER_ID, "BOOK A"));
    });
    await flush();
    expect(briefText()).not.toContain("BOOK A");

    // The brief for the NEW book is what may render.
    await answerLatest(briefFor(bookKeyOf(second), USER_ID, "BOOK B"));
    expect(briefText()).toContain("BOOK B");
    expect(briefText()).not.toContain("BOOK A");
  });

  it("a failed canonical read is unavailable, not a perpetual checking state", async () => {
    const book = [position("p1", "NVDA", 10, 150)];
    harness.books = [book];
    await mount(book);
    await answerLatest(briefFor(bookKeyOf(book), USER_ID, "BOOK A"));
    expect(briefText()).toContain("BOOK A");

    // The next canonical read fails. The positions table keeps its existing policy...
    harness.failCanonical = true;
    await act(async () => {
      harness.root!.render(
        React.createElement(
          LangProvider,
          null,
          React.createElement(PortfolioView, {
            // A NEW seed array: the server re-rendered, so the canonical read runs
            // again — and this time it fails.
            positions: [...book],
            email: "t@example.com",
            userId: USER_ID,
          }),
        ),
      );
    });
    await flush();
    expect(harness.canonicalReads).toBeGreaterThanOrEqual(2);

    // ...but the brief's qualified facts are RETIRED.
    expect(briefText()).not.toContain("BOOK A");
    expect(briefText()).toContain(LEX.briefUnavailable[0]);
    expect(harness.container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("a committed owner change retires the binding and a late previous-owner answer cannot paint", async () => {
    const book = [position("p1", "NVDA", 10, 150)];
    harness.books = [book, book];
    await mount(book, USER_ID);

    // A committed account transition: a different owner, the same seed array.
    await act(async () => {
      harness.root!.render(
        React.createElement(
          LangProvider,
          null,
          React.createElement(PortfolioView, {
            positions: book,
            email: "other@example.com",
            userId: OTHER_USER_ID,
          }),
        ),
      );
    });
    await flush();

    // The previous owner's brief answer lands late.
    const late = harness.briefAnswers[0];
    await act(async () => {
      late.resolve(briefFor(bookKeyOf(book), USER_ID, "OLD OWNER BRIEF"));
    });
    await flush();
    expect(briefText()).not.toContain("OLD OWNER BRIEF");
  });

  it("the deliberate retry uses the existing canonical reload", async () => {
    const book = [position("p1", "NVDA", 10, 150)];
    harness.books = [book];
    harness.failCanonical = true;
    await mount(book);

    // The brief read settles as a failure, so the panel offers its honest retry.
    await answerLatest({}, 503);
    expect(briefText()).toContain(LEX.briefUnavailable[0]);

    const before = harness.canonicalReads;
    const button = [...harness.container.querySelectorAll<HTMLButtonElement>(".pbrief button")][0];
    expect(button, "the unavailable brief offers a retry").toBeDefined();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { button!.click(); });
    await flush();
    // The retry is the page's OWN canonical reload — one more positions read, not a
    // second reader and not a brief-only retry.
    expect(harness.canonicalReads).toBe(before + 1);
  });
});
