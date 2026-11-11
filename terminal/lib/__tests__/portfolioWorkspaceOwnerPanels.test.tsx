// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortfolioView from "@/components/PortfolioView";
import { LangProvider } from "@/lib/i18n";
import type { Position } from "@/lib/portfolio";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { invalidationForKind, type EventImpactRead } from "@/lib/eventImpact";
import briefFixture from "./fixtures/portfolio_brief/concentrated_semis.json";

// Keep the actual view, workspace, both panels, decoders, and copy helpers. Only external
// transport is controlled: the old controller suite replaces both auxiliary panels with null.
vi.mock("@/lib/dataCache", () => ({ getJSON: async () => ({ symbols: {} }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Owner = "A" | "B";
type Panel = "brief" | "events";
const ids = { A: "11111111-1111-4111-8111-111111111111", B: "22222222-2222-4222-8222-222222222222" };
const record: Position = { id: "record-a", ticker: "NVDA", shares: 10, entryPrice: 100,
  entryCurrency: "USD", entryDate: null, notes: "A record", status: "open", createdAt: null };
const books: Record<Owner, Position[]> = {
  A: [record],
  B: [{ ...record, id: "record-b", notes: "B record" }],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Pending = {
  owner: Owner; panel: Panel; signal?: AbortSignal | null;
  response: ReturnType<typeof deferred<Response>>;
  body: ReturnType<typeof deferred<unknown>>; bodyHeld: boolean;
};
let owner: Owner;
let requests: Pending[];
let node: HTMLDivElement;
let root: Root;
const marker = (panel: Panel, who: Owner, generation = "current") => `OWNER_${who}_${panel.toUpperCase()}_${generation}`;
function payload(panel: Panel, who: Owner, generation = "current") {
  const text = marker(panel, who, generation);
  if (panel === "brief") return {
    ...briefFixture, book: { n: 1, covered: 1, uncovered: [] },
    headline: { en: text, zh: text },
  };
  return {
    state: "ok", asof: "2026-10-21", heldTickers: 1, heldPositions: 1, unjoinable: [],
    events: [{
      eventId: "earnings|NVDA|2026-10-30", kind: "earnings", ticker: "NVDA",
      date: "2026-10-30", daysUntil: 9,
      positions: [{ id: books[who][0].id, ticker: "NVDA", shares: 10, status: "open" }],
      direction: { state: "not_stated" },
      mechanism: { state: "stated", text, textZh: text },
      timeframe: { state: "not_stated" },
      invalidation: invalidationForKind("earnings", "2026-10-30"),
      sourcePath: "/data/portfolio_ctx.json",
    }],
  } satisfies EventImpactRead;
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function flush() {
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
}
async function show(who: Owner, seed = books[who], email = "same-address@example.test") {
  owner = who;
  await act(async () => {
    root.render(<LangProvider><PortfolioView positions={seed} email={email} userId={ids[who]} /></LangProvider>);
  });
  await flush();
  // The fixture uses the real server book key, so this exercises a successful canonical read.
  expect(node.textContent).toContain("Holdings checked");
  expect(node.textContent).not.toContain("The latest holdings check failed");
}
function forOwner(panel: Panel, who: Owner) {
  return requests.filter(item => item.panel === panel && item.owner === who);
}
async function holdBody(pending: Pending) {
  pending.bodyHeld = true;
  await act(async () => {
    pending.response.resolve({ ok: true, status: 200, json: () => pending.body.promise } as Response);
  });
  await flush();
}
async function settle(pending: Pending, who: Owner, generation = "current") {
  await act(async () => {
    if (pending.bodyHeld) pending.body.resolve(payload(pending.panel, who, generation));
    else pending.response.resolve(response(payload(pending.panel, who, generation)));
  });
  await flush();
}
beforeEach(() => {
  vi.useFakeTimers();
  owner = "A"; requests = [];
  document.documentElement.setAttribute("data-lang", "en");
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
    const captured = owner;
    const panel = input === "/api/portfolio-brief" ? "brief" : input === "/api/event-impact" ? "events" : null;
    if (panel) {
      const pending: Pending = { owner: captured, panel, signal: init?.signal,
        response: deferred<Response>(), body: deferred<unknown>(), bodyHeld: false };
      requests.push(pending);
      return pending.response.promise;
    }
    if (input === "/api/portfolio?view=positions") {
      return Promise.resolve(response({ positions: books[captured], bookKey: portfolioBookKey(books[captured]) }));
    }
    if (input.startsWith("/api/quote")) return Promise.resolve(response({ quotes: {} }));
    if (["/api/portfolio", "/api/portfolio/targets", "/api/portfolio/risk-history"].includes(input)) {
      return Promise.resolve(response({ error: "optional analysis unavailable" }, 503));
    }
    throw new Error(`Unexpected request: ${input}`);
  }));
  node = document.createElement("div"); document.body.appendChild(node); root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount()); node.remove();
  document.documentElement.removeAttribute("data-lang");
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe.each<Panel>(["brief", "events"])("Portfolio owner-scoped %s", panel => {
  it("retires the previous account's settled content before the next account's response", async () => {
    await show("A");
    await settle(forOwner(panel, "A")[0], "A");
    expect(node.textContent).toContain(marker(panel, "A"));
    await show("B"); // Distinct, equally sized nonempty books; the email deliberately stays equal.
    expect(node.textContent).not.toContain(marker(panel, "A"));
    expect(forOwner(panel, "B")).toHaveLength(1);
    await settle(forOwner(panel, "B")[0], "B");
    expect(node.textContent).toContain(marker(panel, "B"));
  });

  it.each(["fetch", "body"] as const)("ignores the previous account's late %s completion", async phase => {
    await show("A");
    const a = forOwner(panel, "A")[0];
    if (phase === "body") await holdBody(a);
    await show("B");
    const b = forOwner(panel, "B")[0];
    if (b) await settle(b, "B");
    await settle(a, "A");
    expect(node.textContent).not.toContain(marker(panel, "A"));
    expect(forOwner(panel, "B")).toHaveLength(1);
    expect(node.textContent).toContain(marker(panel, "B"));
    if (panel === "brief") expect(a.signal?.aborted).toBe(true);
  });

  it("does not revive a retired request after A to B to A", async () => {
    await show("A");
    const originalA = forOwner(panel, "A")[0];
    await holdBody(originalA);
    await show("B");
    await show("A");
    const nextA = forOwner(panel, "A").at(-1);
    if (nextA && nextA !== originalA) await settle(nextA, "A", "new");
    await settle(originalA, "A", "retired");
    expect(node.textContent).not.toContain(marker(panel, "A", "retired"));
    expect(node.textContent).toContain(marker(panel, "A", "new"));
    expect(forOwner(panel, "A")).toHaveLength(2);
  });

  it("preserves a live request through a same-owner seed and email refresh", async () => {
    await show("A");
    const a = forOwner(panel, "A")[0];
    await holdBody(a);
    await show("A", [...books.A], "changed-address@example.test");
    expect(forOwner(panel, "A")).toHaveLength(1);
    if (panel === "brief") expect(a.signal?.aborted).toBe(false);
    await settle(a, "A");
    expect(node.textContent).toContain(marker(panel, "A"));
  });
});
