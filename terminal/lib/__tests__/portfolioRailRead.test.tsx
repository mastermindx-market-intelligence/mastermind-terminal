// @vitest-environment jsdom
//
// The terminal rail's Portfolio read state (F08-RAIL; macro#6819 C4 5995397563).
//
// The real `usePortfolioRailRead`, including its lazy trigger (the effect TerminalShell relies
// on), is mounted against a fetch whose responses the test releases by hand. The native rail
// mounted inside TerminalShell is driven by e2e/portfolio-rail-read-state.spec.ts. Mounted
// through react-dom/client as portfolioPageReadbackOrder.test.tsx does: this repo has no
// @testing-library.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { portfolioRailOwner, usePortfolioRailRead, type PortfolioRailRead } from "@/lib/usePortfolioRailRead";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── fetch the test releases by hand ──────────────────────────────────────────

type Held = { resolve: (r: Response) => void; reject: (e: unknown) => void };
let held: Held[] = [];
let realFetch: typeof fetch;

beforeEach(() => {
  held = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("/api/portfolio");
    expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
    return new Promise<Response>((resolve, reject) => { held.push({ resolve, reject }); });
  }) as unknown as typeof fetch;
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const book = (...rows: { id: string; ticker: string; status: string }[]) => json(200, { positions: rows });
const NVDA = { id: "p-nvda", ticker: "NVDA", status: "open" };
const AAPL = { id: "p-aapl", ticker: "AAPL", status: "open" };

async function flush() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}
async function answer(index: number, response: Response) {
  await act(async () => { held[index].resolve(response); });
  await flush();
}
async function refuse(index: number) {
  await act(async () => { held[index].reject(new TypeError("Failed to fetch")); });
  await flush();
}

// ── mount ───────────────────────────────────────────────────────────────────

const A = portfolioRailOwner("a@example.com", "uuid-a");
let latest: PortfolioRailRead;
let container: HTMLDivElement | null = null;
let root: Root | null = null;
const report = (read: PortfolioRailRead) => { latest = read; };

// Reports what each COMMITTED render returned, which is what the rail would paint.
function Harness({ owner, enabled }: { owner: string; enabled: boolean }) {
  const read = usePortfolioRailRead(owner, enabled);
  useEffect(() => { report(read); });
  return null;
}
async function render(owner: string, enabled = true) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => { root!.render(<Harness owner={owner} enabled={enabled} />); });
}
async function unmount() {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
}

afterEach(async () => {
  await unmount();
  globalThis.fetch = realFetch;
});

const tickers = () => latest.rows?.map((r) => r.ticker) ?? null;

// ── a read that did not answer is never an empty book ───────────────────────

describe("a first read that does not answer", () => {
  const failures: [string, (i: number) => Promise<void>][] = [
    ["503", (i) => answer(i, json(503, { error: "unavailable" }))],
    ["rejected fetch", (i) => refuse(i)],
    ["malformed 2xx (no positions)", (i) => answer(i, json(200, { ok: true }))],
    ["malformed 2xx (positions not an array)", (i) => answer(i, json(200, { positions: "NVDA" }))],
    ["2xx gateway page (not JSON)", (i) => answer(i, new Response("<html>bad gateway</html>", { status: 200 }))],
  ];
  for (const [label, fail] of failures) {
    it(`${label}: unavailable, never empty, and Retry recovers`, async () => {
      await render(A);
      expect(held).toHaveLength(1);
      expect(latest.rows).toBeNull();
      expect(latest.failed).toBe(false);

      await fail(0);
      expect(latest.rows).toBeNull();
      expect(latest.failed).toBe(true);

      await act(async () => { void latest.retry(); });
      expect(held).toHaveLength(2);
      expect(latest.busy).toBe(true);
      expect(latest.rows).toBeNull();

      await answer(1, book(NVDA));
      expect(tickers()).toEqual(["NVDA"]);
      expect(latest.failed).toBe(false);
      expect(latest.busy).toBe(false);
    });
  }

  it("a Retry that fails again stays unavailable and clears its busy state", async () => {
    await render(A);
    await answer(0, json(503, {}));
    await act(async () => { void latest.retry(); });
    expect(latest.busy).toBe(true);
    await answer(1, json(503, {}));
    expect(latest.rows).toBeNull();
    expect(latest.failed).toBe(true);
    expect(latest.busy).toBe(false);
  });
});

it("control: a valid empty book is an answered, empty read", async () => {
  await render(A);
  await answer(0, book());
  expect(latest.rows).toEqual([]);
  expect(latest.failed).toBe(false);
});

// ── a failed refresh keeps the last good read, qualified ───────────────────

it("a failed refresh keeps the rows and marks them as the last good read", async () => {
  await render(A);
  await answer(0, book(NVDA));
  const rows = latest.rows;

  await act(async () => { void latest.load(); });
  await answer(1, json(503, {}));
  expect(latest.rows).toBe(rows);
  expect(latest.failed).toBe(true);

  await act(async () => { void latest.retry(); });
  await answer(2, book(NVDA, AAPL));
  expect(tickers()).toEqual(["NVDA", "AAPL"]);
  expect(latest.failed).toBe(false);
});

it("an unchanged book keeps the same rows array (no re-render of the workspace)", async () => {
  await render(A);
  await answer(0, book(NVDA));
  const rows = latest.rows;
  await act(async () => { void latest.load(); });
  await answer(1, book({ ...NVDA }));
  expect(latest.rows).toBe(rows);
});

// ── an older read never overwrites a newer one ──────────────────────────────

describe("read ordering", () => {
  it("an older success landing late does not overwrite a newer success", async () => {
    await render(A);
    await act(async () => { void latest.load(); });
    await answer(1, book(NVDA, AAPL));
    await answer(0, book(NVDA));
    expect(tickers()).toEqual(["NVDA", "AAPL"]);
  });

  it("an older success landing late does not overwrite a newer EMPTY answer", async () => {
    await render(A);
    await act(async () => { void latest.load(); });
    await answer(1, book());
    await answer(0, book(NVDA));
    expect(latest.rows).toEqual([]);
  });

  it("an older failure landing late does not qualify a newer success", async () => {
    await render(A);
    await act(async () => { void latest.load(); });
    await answer(1, book(NVDA));
    await answer(0, json(503, {}));
    expect(tickers()).toEqual(["NVDA"]);
    expect(latest.failed).toBe(false);
  });

  it("an older success or failure does not settle a newer read that is still pending", async () => {
    await render(A);
    await act(async () => { void latest.load(); });
    await answer(0, book(NVDA));
    expect(latest.rows).toBeNull();
    expect(latest.failed).toBe(false);
    await act(async () => { void latest.load(); });
    await answer(1, json(503, {}));
    expect(latest.rows).toBeNull();
    expect(latest.failed).toBe(false);
    await answer(2, book(AAPL));
    expect(tickers()).toEqual(["AAPL"]);
  });

  // C4 5997134203: the old read's fetch has ANSWERED but its JSON is still parsing when a newer read
  // starts through a real trigger. Whether that JSON then resolves or rejects, the newer read stays
  // pending. The generation check runs after the body settles, never before it.
  const triggers: [string, () => Promise<void>][] = [
    ["Retry", async () => { await act(async () => { void latest.retry(); }); }],
    ["the lazy trigger re-enabling", async () => { await render(A, false); await render(A, true); }],
  ];
  for (const [trigger, start] of triggers) {
    for (const outcome of ["resolves", "rejects"] as const) {
      it(`old fetch answered with its JSON held, newer read via ${trigger} pending, old JSON ${outcome}: the newer read stays pending`, async () => {
        await render(A);
        let body!: { resolve: (value: unknown) => void; reject: (error: unknown) => void };
        const parsing = {
          ok: true,
          status: 200,
          json: () => new Promise((resolve, reject) => { body = { resolve, reject }; }),
        } as unknown as Response;
        await answer(0, parsing);
        expect(body).toBeDefined();
        expect(latest.rows).toBeNull();

        await start();
        expect(held).toHaveLength(2);
        const busy = latest.busy;
        await act(async () => {
          if (outcome === "resolves") body.resolve({ positions: [NVDA] });
          else body.reject(new SyntaxError("Unexpected token < in JSON"));
        });
        await flush();
        expect(latest.rows).toBeNull();
        expect(latest.failed).toBe(false);
        expect(latest.busy).toBe(busy);

        await answer(1, book(AAPL));
        expect(tickers()).toEqual(["AAPL"]);
        expect(latest.busy).toBe(false);
      });
    }
  }

  it("a superseded Retry does not clear the newer read's state when it lands", async () => {
    await render(A);
    await answer(0, json(503, {}));
    await act(async () => { void latest.retry(); });
    await act(async () => { void latest.load(); });
    await answer(1, book(NVDA));
    expect(latest.rows).toBeNull();
    await answer(2, json(503, {}));
    expect(latest.rows).toBeNull();
    expect(latest.failed).toBe(true);
    expect(latest.busy).toBe(false);
  });
});

// ── the owner boundary ──────────────────────────────────────────────────────

describe("owner boundary", () => {
  it("same email, different user id: a different owner", () => {
    expect(portfolioRailOwner("a@example.com", "uuid-a")).not.toBe(portfolioRailOwner("a@example.com", "uuid-b"));
    expect(portfolioRailOwner("a@example.com", "uuid-a")).not.toBe(portfolioRailOwner("b@example.com", "uuid-a"));
    expect(portfolioRailOwner("a@example.com")).not.toBe(portfolioRailOwner("b@example.com"));
    expect(portfolioRailOwner("", "uuid-a")).toBe("");
  });

  it("an owner change clears the book in the same render and re-reads for the new owner", async () => {
    const B = portfolioRailOwner("a@example.com", "uuid-b");
    await render(A);
    await answer(0, book(NVDA));
    expect(tickers()).toEqual(["NVDA"]);

    await act(async () => { root!.render(<Harness owner={B} enabled />); });
    expect(latest.rows).toBeNull();
    expect(latest.failed).toBe(false);
    expect(held).toHaveLength(2);
    await answer(1, book(AAPL));
    expect(tickers()).toEqual(["AAPL"]);
  });

  it("the outgoing owner's in-flight read never lands under the incoming owner", async () => {
    const B = portfolioRailOwner("a@example.com", "uuid-b");
    await render(A);
    await render(B);
    expect(held).toHaveLength(2);
    await answer(0, book(NVDA));
    expect(latest.rows).toBeNull();
    await answer(0 + 1, book());
    expect(latest.rows).toEqual([]);
  });

  it("the outgoing owner's in-flight FAILURE does not mark the incoming owner unavailable", async () => {
    const B = portfolioRailOwner("b@example.com", "uuid-b");
    await render(A);
    await render(B);
    await answer(0, json(503, {}));
    expect(latest.failed).toBe(false);
  });

  it("sign-out rejects the outgoing read, including across an A → signed-out → A round trip", async () => {
    await render(A);
    await render("", false);
    expect(latest.rows).toBeNull();
    await render(A);
    expect(held).toHaveLength(2);
    await answer(0, book(NVDA));
    expect(latest.rows).toBeNull();
    await answer(1, book());
    expect(latest.rows).toEqual([]);
  });

  // C4 5997134203: A has ANSWERED before the transition. The saved snapshot must be dropped, not
  // masked, so the new A read starts unanswered (Loading, not A's old rows) and, if it fails, is
  // unavailable rather than A's old rows qualified as a last read.
  const away: [string, () => Promise<void>][] = [
    ["signed out", () => render("", false)],
    ["account B, whose read is still pending", () => render(portfolioRailOwner("b@example.com", "uuid-b"))],
  ];
  for (const [label, leave] of away) {
    it(`A answered → ${label} → A: the new A read is unanswered while pending and unavailable when it fails`, async () => {
      await render(A);
      await answer(0, book(NVDA));
      expect(tickers()).toEqual(["NVDA"]);

      await leave();
      expect(latest.rows).toBeNull();
      await render(A);
      const fresh = held.length - 1;
      expect(fresh).toBeGreaterThan(0);
      expect(latest.rows).toBeNull();
      expect(latest.failed).toBe(false);

      await answer(fresh, json(503, {}));
      expect(latest.rows).toBeNull();
      expect(latest.failed).toBe(true);

      for (let i = 1; i < fresh; i++) await answer(i, book(AAPL));
      expect(latest.rows).toBeNull();
    });
  }

  it("a read outlives a sign-out and the same owner's return without a new read: still rejected", async () => {
    await render(A);
    await render("", false);
    await render(A, false);
    expect(held).toHaveLength(1);
    await answer(0, book(NVDA));
    expect(latest.rows).toBeNull();
  });

  it("unmount rejects the outgoing read without writing state", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await render(A);
    await unmount();
    await answer(0, book(NVDA));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

// ── the lazy trigger ────────────────────────────────────────────────────────

describe("lazy trigger", () => {
  it("fetches nothing while disabled, once when enabled, and again on each re-enable", async () => {
    await render(A, false);
    expect(held).toHaveLength(0);
    await render(A, true);
    expect(held).toHaveLength(1);
    await render(A, true);
    expect(held).toHaveLength(1);
    await render(A, false);
    await render(A, true);
    expect(held).toHaveLength(2);
  });

  it("an owner change while disabled fetches nothing, and shows nothing of the old owner", async () => {
    await render(A, true);
    await answer(0, book(NVDA));
    await render(portfolioRailOwner("b@example.com", "uuid-b"), false);
    expect(held).toHaveLength(1);
    expect(latest.rows).toBeNull();
  });
});
