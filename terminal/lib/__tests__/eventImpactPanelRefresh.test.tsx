// @vitest-environment jsdom
//
// EventImpactPanel — refresh and lifetime discriminators.
//
// The defect these pin: the panel reloaded on `holdingsUnreadable` and `positions.length` ONLY,
// so a same-count edit to a holding (a new id, ticker, share count or status) left the previous
// read on screen as if it were current, and nothing fenced a late response, so an obsolete
// response could publish over the current facts and clear the current request's busy state.
//
// The panel is mounted directly here so the committed-input, request-lifetime and busy-state
// facts are observed exactly where they are decided. The ACTUAL caller composition
// (PortfolioView -> PortfolioWorkspace -> EventImpactPanel) is proved separately in
// eventImpactPanelActualCaller.test.tsx; the existing Portfolio owner-panel suite and the
// existing panel render suite keep their own coverage.
//
// Language: the panel's copy is a local [en, zh] table, so both registers are exercised.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventImpactPanel from "@/components/EventImpactPanel";
import { invalidationForKind, type EventImpactRead } from "@/lib/eventImpact";
import type { Position } from "@/lib/portfolio";

const langBox = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: langBox.lang, setLang: () => {} }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: Position = {
  id: "record-a",
  ticker: "NVDA",
  shares: 10,
  entryPrice: 100,
  entryCurrency: "USD",
  entryDate: null,
  notes: "Original record",
  status: "open",
  createdAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

type Pending = {
  response: ReturnType<typeof deferred<Response>>;
  body: ReturnType<typeof deferred<unknown>>;
};

/** The route's own projection: {id, ticker, shares, status} — the only fields a read depends on. */
function payload(marker: string, positions: readonly Position[]): EventImpactRead {
  return {
    state: "ok",
    asof: "2026-11-02",
    heldTickers: positions.length,
    heldPositions: positions.length,
    unjoinable: [],
    events: positions.map(p => ({
      eventId: `earnings|${p.ticker}|2026-11-10`,
      kind: "earnings",
      ticker: p.ticker,
      date: "2026-11-10",
      daysUntil: 8,
      positions: [{ id: p.id, ticker: p.ticker, shares: p.shares, status: p.status }],
      direction: { state: "not_stated" },
      // The SAME marker in both registers so the assertion is language-neutral.
      mechanism: { state: "stated", text: marker, textZh: marker },
      timeframe: { state: "not_stated" },
      invalidation: invalidationForKind("earnings", "2026-11-10"),
      sourcePath: "/data/portfolio_ctx.json",
    })),
  };
}

let node: HTMLDivElement;
let root: Root;
let requests: Pending[];

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

function mount(positions: Position[], holdingsUnreadable = false) {
  return act(async () => {
    root.render(
      <EventImpactPanel positions={positions} holdingsUnreadable={holdingsUnreadable} />
    );
  });
}

/** Answer the fetch, leaving the JSON body pending — the body is a separate awaitable stage. */
async function respond(p: Pending, ok: boolean, status: number) {
  await act(async () => {
    p.response.resolve({ ok, status, json: () => p.body.promise } as unknown as Response);
  });
  await flush();
}

async function settleBody(p: Pending, value: unknown) {
  await act(async () => { p.body.resolve(value); });
  await flush();
}

async function rejectBody(p: Pending, reason: unknown) {
  await act(async () => { p.body.reject(reason); });
  await flush();
}

async function rejectFetch(p: Pending, reason: unknown) {
  await act(async () => { p.response.reject(reason); });
  await flush();
}

/** The ordinary success path: fetch answered and body delivered. */
async function complete(p: Pending, marker: string, positions: readonly Position[]) {
  await respond(p, true, 200);
  await settleBody(p, payload(marker, positions));
}

const panel = () => node.querySelector('[data-testid="event-impact"]');
const panelText = () => panel()?.textContent ?? "";
const rows = () => panel()?.querySelectorAll('[data-testid="event-impact-row"]');
const checking = () => panel()?.querySelector('[data-testid="event-impact-checking"]');
const retryButton = () => panel()?.querySelector<HTMLButtonElement>('[data-testid="event-impact-upstream-locked"] button')
  ?? panel()?.querySelector<HTMLButtonElement>('[data-testid="event-impact-holdings-unreadable"] button');

beforeEach(() => {
  langBox.lang = "en";
  requests = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url !== "/api/event-impact") throw new Error(`Unexpected request: ${url}`);
    const pending: Pending = { response: deferred<Response>(), body: deferred<unknown>() };
    requests.push(pending);
    return pending.response.promise;
  }));
  node = document.createElement("div");
  document.body.appendChild(node);
  root = createRoot(node);
});

afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  langBox.lang = "en";
});

describe("EventImpactPanel — committed input identity", () => {
  it.each([
    ["id", { id: "record-b" }],
    ["ticker", { ticker: "AAPL" }],
    ["shares", { shares: 25 }],
    ["status", { status: "closed" as const }],
  ])("starts a fresh read when a same-count %s changes", async (_field, change) => {
    await mount([{ ...BASE }]);
    expect(requests).toHaveLength(1);
    await mount([{ ...BASE, ...change }]);
    expect(requests).toHaveLength(2);
  });

  it("does not reload for an identical semantic copy in a new array", async () => {
    await mount([{ ...BASE }]);
    expect(requests).toHaveLength(1);
    await mount([{ ...BASE }]);
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["entry price", { entryPrice: 150 }],
    ["entry date", { entryDate: "2026-11-01" }],
    ["notes", { notes: "Changed notes" }],
    ["entry currency", { entryCurrency: "EUR" }],
  ])("does not reload for a %s-only change, which the route never projects", async (_field, change) => {
    await mount([{ ...BASE }]);
    expect(requests).toHaveLength(1);
    await mount([{ ...BASE, ...change }]);
    expect(requests).toHaveLength(1);
  });
});

describe("EventImpactPanel — obsolete facts never read as current", () => {
  it("removes the previous read's rows when the committed input changes", async () => {
    await mount([{ ...BASE }]);
    await complete(requests[0], "OLD_FACT", [{ ...BASE }]);
    expect(panelText()).toContain("OLD_FACT");
    expect(rows()).toHaveLength(1);

    await mount([{ ...BASE, shares: 25 }]);
    // The fresh read has not resolved yet: the previous read's row must NOT be on screen as
    // current. The neutral busy state is the only honest thing to show.
    expect(panelText()).not.toContain("OLD_FACT");
    expect(rows()).toHaveLength(0);
    expect(checking()).toBeTruthy();

    await complete(requests[1], "NEW_FACT", [{ ...BASE, shares: 25 }]);
    expect(panelText()).toContain("NEW_FACT");
    expect(rows()).toHaveLength(1);
  });

  it("never shows the previous read's rows between the committed input and the fresh read", async () => {
    await mount([{ ...BASE }]);
    await complete(requests[0], "OLD_FACT", [{ ...BASE }]);
    await mount([{ ...BASE, shares: 25 }]);
    expect(panelText()).not.toContain("OLD_FACT");
    await respond(requests[1], true, 200);
    // Even once the response has landed, the BODY is still pending: still no obsolete rows.
    expect(panelText()).not.toContain("OLD_FACT");
    await settleBody(requests[1], payload("NEW_FACT", [{ ...BASE, shares: 25 }]));
    expect(panelText()).toContain("NEW_FACT");
  });
});

describe("EventImpactPanel — expansion policy", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...BASE, id: `record-${i}`, ticker: `SYN${i}` }));

  it("keeps Show all across a same-count semantic change", async () => {
    await mount(many(7));
    await complete(requests[0], "OLD_FACT", many(7));
    expect(rows()).toHaveLength(6);
    const showAll = panel()?.querySelector<HTMLButtonElement>("button");
    expect(showAll?.textContent).toContain("7");
    await act(async () => { showAll?.click(); });
    expect(rows()).toHaveLength(7);

    await mount(many(7).map(p => (p.id === "record-0" ? { ...p, shares: 25 } : p)));
    expect(requests).toHaveLength(2);
    // The previous read's rows are obsolete the moment the input commits, so they are gone
    // while the fresh read is pending — the expansion STATE is what must survive.
    expect(rows()).toHaveLength(0);
    await complete(requests[1], "NEW_FACT", many(7));
    // Seven rows, not six: the expansion survived the same-count change.
    expect(rows()).toHaveLength(7);
  });

  it("still collapses when the open-position count changes", async () => {
    await mount(many(8));
    await complete(requests[0], "OLD_FACT", many(8));
    await act(async () => { panel()?.querySelector<HTMLButtonElement>("button")?.click(); });
    expect(rows()).toHaveLength(8);

    await mount(many(7));
    expect(rows()).toHaveLength(0); // the read for the new count has not resolved yet
    await complete(requests[1], "NEW_FACT", many(7));
    expect(rows()).toHaveLength(6); // collapsed back to the existing count boundary
  });

  it("still collapses when the book becomes unreadable", async () => {
    await mount(many(8));
    await complete(requests[0], "OLD_FACT", many(8));
    await act(async () => { panel()?.querySelector<HTMLButtonElement>("button")?.click(); });
    expect(rows()).toHaveLength(8);

    await mount(many(8), true);
    expect(rows()).toHaveLength(0);
    expect(panel()?.querySelector('[data-testid="event-impact-holdings-unreadable"]')).toBeTruthy();
  });

  // The round trips the one-way cases above cannot catch. The one-way cases only show that
  // the panel LOOKS collapsed while the boundaries differ; they cannot show what happens when
  // the boundaries come back. Storing the grant and comparing it against the current boundaries
  // masks the difference instead of ending the grant, so a later match reopens "Show all" for a
  // boundary the user never granted. The grant must be RETIRED at the boundary change, once.
  it("does not restore the expansion after a committed count round trip", async () => {
    await mount(many(8));
    await complete(requests[0], "OLD_FACT", many(8));
    expect(rows()).toHaveLength(6);
    await act(async () => { panel()?.querySelector<HTMLButtonElement>("button")?.click(); });
    expect(rows()).toHaveLength(8);

    // A DIFFERENT count is committed: the grant was made under eight positions, and seven is
    // not the boundary it was granted under.
    await mount(many(7));
    await complete(requests[1], "MID_FACT", many(7));
    expect(rows()).toHaveLength(6);

    // The count comes BACK to eight. The boundaries match again, but the grant must stay
    // retired: a later match must not restore it.
    await mount(many(8));
    await complete(requests[2], "BACK_FACT", many(8));
    expect(rows()).toHaveLength(6);
    // Collapsed, not emptied: the Show all control is offered again for the eight events.
    expect(panel()?.querySelector("button")?.textContent).toContain("8");
  });

  it("does not restore the expansion after a committed readability round trip", async () => {
    await mount(many(8));
    await complete(requests[0], "OLD_FACT", many(8));
    expect(rows()).toHaveLength(6);
    await act(async () => { panel()?.querySelector<HTMLButtonElement>("button")?.click(); });
    expect(rows()).toHaveLength(8);

    // The book becomes unreadable: a boundary the grant was not granted under.
    await mount(many(8), true);
    expect(rows()).toHaveLength(0);
    expect(panel()?.querySelector('[data-testid="event-impact-holdings-unreadable"]')).toBeTruthy();
    expect(requests).toHaveLength(1); // an unreadable book is not read

    // The book is readable again, with the same count and the same readability as when the
    // grant was made. The grant must stay retired: the boundaries match again, but the grant
    // does not come back.
    await mount(many(8), false);
    expect(requests).toHaveLength(2);
    await complete(requests[1], "BACK_FACT", many(8));
    expect(rows()).toHaveLength(6);
    expect(panel()?.querySelector("button")?.textContent).toContain("8");
  });
});

describe("EventImpactPanel — request retirement", () => {
  it("ignores a retired fetch that resolves after the current read", async () => {
    await mount([{ ...BASE }]);
    const old = requests[0];
    await mount([{ ...BASE, shares: 25 }]);
    expect(requests).toHaveLength(2);
    await complete(requests[1], "NEW_FACT", [{ ...BASE, shares: 25 }]);
    await complete(old, "OLD_FACT", [{ ...BASE }]);
    expect(panelText()).toContain("NEW_FACT");
    expect(panelText()).not.toContain("OLD_FACT");
  });

  it("ignores a retired JSON body that resolves after the current read", async () => {
    await mount([{ ...BASE }]);
    const old = requests[0];
    await respond(old, true, 200); // fetch answered, body still pending
    await mount([{ ...BASE, shares: 25 }]);
    await complete(requests[1], "NEW_FACT", [{ ...BASE, shares: 25 }]);
    await settleBody(old, payload("OLD_FACT", [{ ...BASE }]));
    expect(panelText()).toContain("NEW_FACT");
    expect(panelText()).not.toContain("OLD_FACT");
  });

  it("does not revive the first read after a committed A to B to A", async () => {
    await mount([{ ...BASE }]);
    const first = requests[0];
    await respond(first, true, 200);
    await mount([{ ...BASE, ticker: "AAPL" }]); // B
    expect(requests).toHaveLength(2);
    await mount([{ ...BASE }]); // back to A — the semantic key is A again
    expect(requests).toHaveLength(3);
    await complete(requests[2], "NEW_FACT", [{ ...BASE }]);
    // The OLDEST A resolves last. Semantic equality alone would let it through.
    await settleBody(first, payload("OLD_FACT", [{ ...BASE }]));
    expect(panelText()).toContain("NEW_FACT");
    expect(panelText()).not.toContain("OLD_FACT");
  });

  // Two distinct retirement points, both fenced. The FETCH stage: the request is still in
  // flight when the input changes, so its outcome arrives after the attempt was retired. The
  // BODY stage: the response was answered while the attempt was still current, and the body
  // arrives after the input changed.
  it.each([
    ["success", "ok"],
    ["401", "401"],
    ["429", "429"],
    ["network failure", "network"],
  ])("a retired %s (fetch stage) cannot overwrite the current result", async (_label, kind) => {
    await mount([{ ...BASE }]);
    const old = requests[0];
    await mount([{ ...BASE, shares: 25 }]);
    expect(requests).toHaveLength(2);
    await complete(requests[1], "NEW_FACT", [{ ...BASE, shares: 25 }]);

    if (kind === "ok") await complete(old, "OLD_FACT", [{ ...BASE }]);
    else if (kind === "401") { await respond(old, false, 401); await settleBody(old, { state: "unauthenticated" }); }
    else if (kind === "429") { await respond(old, false, 429); await settleBody(old, {}); }
    else await rejectFetch(old, new Error("network down"));

    expect(panelText()).toContain("NEW_FACT");
    expect(panelText()).not.toContain("OLD_FACT");
    expect(panel()?.querySelector('[data-testid="event-impact-unauthenticated"]')).toBeNull();
    expect(panel()?.querySelector('[data-testid="event-impact-upstream-locked"]')).toBeNull();
  });

  it.each([
    ["success", "ok"],
    ["typed 503", "503"],
    ["parse failure", "parse"],
  ])("a retired %s (body stage) cannot overwrite the current result", async (_label, kind) => {
    await mount([{ ...BASE }]);
    const old = requests[0];
    // The response is answered while this attempt is still current; the BODY arrives after the
    // input has changed and this attempt has been retired.
    await respond(old, kind !== "503", kind === "503" ? 503 : 200);
    await mount([{ ...BASE, shares: 25 }]);
    expect(requests).toHaveLength(2);
    await complete(requests[1], "NEW_FACT", [{ ...BASE, shares: 25 }]);

    if (kind === "ok") await settleBody(old, payload("OLD_FACT", [{ ...BASE }]));
    else if (kind === "503") await settleBody(old, { state: "calendar_unreadable", detail: "old" });
    else await rejectBody(old, new Error("bad json"));

    expect(panelText()).toContain("NEW_FACT");
    expect(panelText()).not.toContain("OLD_FACT");
    expect(panel()?.querySelector('[data-testid="event-impact-calendar-unreadable"]')).toBeNull();
    expect(panel()?.querySelector('[data-testid="event-impact-upstream-locked"]')).toBeNull();
  });

  it("a retired completion cannot clear the current request's busy state", async () => {
    await mount([{ ...BASE }]);
    const old = requests[0];
    await mount([{ ...BASE, shares: 25 }]);
    await respond(requests[1], false, 503);
    await settleBody(requests[1], { state: "upstream_locked" });
    expect(panel()?.querySelector('[data-testid="event-impact-upstream-locked"]')).toBeTruthy();

    // A fresh read of the CURRENT identity is in flight: the retry control must be busy.
    const retry = retryButton();
    expect(retry?.disabled).toBe(false);
    await act(async () => { retry?.click(); });
    expect(requests).toHaveLength(3);
    expect(retryButton()?.disabled).toBe(true);

    // The retired read completes late. It must neither publish nor clear the newer busy state.
    await respond(old, true, 200);
    await settleBody(old, payload("OLD_FACT", [{ ...BASE }]));
    expect(panelText()).not.toContain("OLD_FACT");
    expect(retryButton()?.disabled).toBe(true);
  });
});

describe("EventImpactPanel — unreadable transitions", () => {
  it("invalidates, fetches nothing and settles busy when the book becomes unreadable", async () => {
    await mount([{ ...BASE }]);
    await complete(requests[0], "OLD_FACT", [{ ...BASE }]);
    expect(panelText()).toContain("OLD_FACT");

    await mount([{ ...BASE }], true);
    expect(requests).toHaveLength(1); // no read for an unreadable book
    expect(panelText()).not.toContain("OLD_FACT");
    expect(panel()?.querySelector('[data-testid="event-impact-holdings-unreadable"]')).toBeTruthy();
    // Busy settled: the retry control is usable, not stuck on a read that never happened.
    expect(retryButton()?.disabled).toBe(false);
  });

  it("reloads when the book becomes readable again", async () => {
    await mount([{ ...BASE }], true);
    expect(requests).toHaveLength(0);
    await mount([{ ...BASE }], false);
    expect(requests).toHaveLength(1);
    await complete(requests[0], "RECOVERED", [{ ...BASE }]);
    expect(panelText()).toContain("RECOVERED");
  });
});

describe("EventImpactPanel — effect lifetime", () => {
  it("does not publish a result that arrives after unmount", async () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => { errors.push(event.error ?? event.message); };
    window.addEventListener("error", onError);
    await mount([{ ...BASE }]);
    const pending = requests[0];
    await respond(pending, true, 200);
    act(() => root.unmount());
    await settleBody(pending, payload("LATE_FACT", [{ ...BASE }]));
    window.removeEventListener("error", onError);
    expect(panelText()).not.toContain("LATE_FACT");
    expect(errors).toHaveLength(0);
  });

  it.each(["before-current", "after-current"] as const)(
    "admits one StrictMode read and retires a committed input's body %s",
    async (order) => {
      const StrictMode = (await import("react")).StrictMode;
      const render = (positions: Position[]) => act(async () => {
        root.render(
          <StrictMode>
            <EventImpactPanel positions={positions} holdingsUnreadable={false} />
          </StrictMode>
        );
      });
      await render([{ ...BASE }]);
      await flush();
      // The throwaway setup is revoked before admission; only the live setup reads.
      expect(requests).toHaveLength(1);
      const retired = requests[0];
      await respond(retired, true, 200);

      const edited = [{ ...BASE, shares: 25 }];
      await render(edited);
      await flush();
      expect(requests).toHaveLength(2);
      const current = requests[1];
      expect(current).not.toBe(retired);
      expect(checking()).toBeTruthy();

      if (order === "before-current") {
        await settleBody(retired, payload("RETIRED_FACT", [{ ...BASE }]));
        expect(checking()).toBeTruthy();
        expect(panelText()).not.toContain("RETIRED_FACT");
      }
      await complete(current, "CURRENT_FACT", edited);
      if (order === "after-current") {
        await settleBody(retired, payload("RETIRED_FACT", [{ ...BASE }]));
      }
      expect(panelText()).toContain("CURRENT_FACT");
      expect(panelText()).not.toContain("RETIRED_FACT");
      expect(checking()).toBeFalsy();
      expect(requests).toHaveLength(2);
    },
  );
});

describe("EventImpactPanel — language register", () => {
  it.each([
    ["en", "Checking your positions", "We can't read your positions right now"],
    ["zh", "正在检查你的持仓", "我们暂时读不到你的持仓"],
  ])("keeps the %s busy and unreadable copy in its own register", async (lang, busyCopy, unreadableCopy) => {
    langBox.lang = lang as "en" | "zh";
    await mount([{ ...BASE }]);
    expect(panelText()).toContain(busyCopy);
    await complete(requests[0], "FACT", [{ ...BASE }]);
    await mount([{ ...BASE }], true);
    expect(panelText()).toContain(unreadableCopy);
    expect(panelText()).not.toContain(busyCopy);
  });
});
