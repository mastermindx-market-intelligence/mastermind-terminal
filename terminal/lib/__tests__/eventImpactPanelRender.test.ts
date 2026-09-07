// @vitest-environment jsdom
//
// Component render test for EventImpactPanel (MAJOR: acceptance 2 was unexercised at the render
// level — case 2/11 in eventImpact.test.ts only assert the pure presentCarried() helper and
// regex the source file, never React output). This mounts the real component with react-dom and
// asserts the rendered DOM text, not the source text.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React, { act } from "react";
import type { EventImpactRead } from "@/lib/eventImpact";
import type { Position } from "@/lib/portfolio";

// A mutable box so individual tests can render in "zh" (MAJOR 1, review r5: every test in this
// file used to hard-mock "en", so ZH copy for the three unreadable/locked states was never
// rendered or asserted anywhere — only checked NEGATIVELY (no 您, banned-word scan on the raw
// source). `vi.hoisted` is required because `vi.mock`'s factory is hoisted above this file's own
// top-level statements, so a plain `const` here would still be in the TDZ when the factory runs.
const { langBox } = vi.hoisted(() => ({ langBox: { lang: "en" as "en" | "zh" } }));
vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: langBox.lang, setLang: () => {} }),
}));

const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  langBox.lang = "en";
});

async function renderWith(
  body: EventImpactRead,
  status = 200,
  props: { positions?: Position[]; holdingsUnreadable?: boolean } = {}
) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const { default: EventImpactPanel } = await import("@/components/EventImpactPanel");
  root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(EventImpactPanel, {
        positions: props.positions ?? [],
        holdingsUnreadable: props.holdingsUnreadable ?? false,
      })
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("EventImpactPanel render (acceptance 2)", () => {
  it("renders 'not stated' text for a direction the source never carried", async () => {
    const body: EventImpactRead = {
      state: "ok",
      asof: "2026-09-05",
      heldTickers: 1,
      heldPositions: 1,
      unjoinable: [],
      events: [
        {
          eventId: "earnings|AAPL|2026-10-30",
          kind: "earnings",
          ticker: "AAPL",
          date: "2026-10-30",
          daysUntil: 5,
          positions: [{ id: "p1", ticker: "AAPL", shares: 10, status: "open" }],
          direction: { state: "not_stated" },
          mechanism: { state: "not_stated" },
          timeframe: { state: "not_stated" },
          sourcePath: "/data/portfolio_ctx.json",
        },
      ],
    };
    await renderWith(body);
    const slot = container.querySelector('[data-slot="direction"]');
    expect(slot?.getAttribute("data-stated")).toBe("0");
    expect(slot?.textContent).toContain("Not stated in the source");
    expect(container.textContent).not.toMatch(/bullish|bearish|neutral/i);
  });

  it("renders the carried verbatim text when the source states it", async () => {
    const body: EventImpactRead = {
      state: "ok",
      asof: "2026-09-05",
      heldTickers: 1,
      heldPositions: 1,
      unjoinable: [],
      events: [
        {
          eventId: "earnings|AAPL|2026-10-30",
          kind: "earnings",
          ticker: "AAPL",
          date: "2026-10-30",
          daysUntil: 5,
          positions: [{ id: "p1", ticker: "AAPL", shares: 10, status: "open" }],
          direction: { state: "stated", text: "Guidance raise expected", textZh: null },
          mechanism: { state: "not_stated" },
          timeframe: { state: "not_stated" },
          sourcePath: "/data/portfolio_ctx.json",
        },
      ],
    };
    await renderWith(body);
    const slot = container.querySelector('[data-slot="direction"]');
    expect(slot?.getAttribute("data-stated")).toBe("1");
    expect(slot?.textContent).toContain("Guidance raise expected");
  });

  it("renders a plain typed sentence, not a blank panel, when the calendar is unreadable", async () => {
    await renderWith({ state: "calendar_unreadable", detail: "bad schema" });
    const node = container.querySelector('[data-testid="event-impact-calendar-unreadable"]');
    expect(node).toBeTruthy();
    // RULING r3, item 1: this must be the CALENDAR sentence ("the event list is the part
    // that's missing"), never the upstream-locked sentence ("your positions are unaffected") —
    // the route bug this test guards against (see eventImpactRoute.test.ts case 16) confused
    // the two by letting an HTTP-fallback 401 relabel a disk-side parse failure.
    expect(node?.textContent).toContain("the event list is the part that's missing");
    expect(node?.textContent).not.toContain("Your positions are unaffected");
  });

  // Minor (review r5): a 429 (the route's own rate limit, fired BEFORE positions are ever read),
  // an unexpected/unparseable status, or a network failure must never render the
  // `calendar_unreadable` sentence ("Your positions are fine") — that claim was never
  // established. RED before the fix: these all fell into `calendar_unreadable` with a synthetic
  // `http_${status}`/"network" detail, the same family of defect as the withdrawn r2 string, one
  // state over.
  it("renders upstream-locked, never a fine/unaffected claim, on a 429 rate limit", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    const { default: EventImpactPanel } = await import("@/components/EventImpactPanel");
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(EventImpactPanel, { positions: [], holdingsUnreadable: false }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="event-impact-upstream-locked"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="event-impact-calendar-unreadable"]')).toBeNull();
    expect(container.textContent).not.toContain("Your positions are fine");
  });

  it("renders upstream-locked, never a fine/unaffected claim, on a fetch/network failure", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const { default: EventImpactPanel } = await import("@/components/EventImpactPanel");
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(EventImpactPanel, { positions: [], holdingsUnreadable: false }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="event-impact-upstream-locked"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="event-impact-calendar-unreadable"]')).toBeNull();
    expect(container.textContent).not.toContain("Your positions are fine");
  });

  it("renders a stale disclosure when the route served a cached-past-outage copy", async () => {
    const body: EventImpactRead = {
      state: "no_events",
      asof: "2026-09-05",
      heldTickers: 1,
      heldPositions: 1,
      unjoinable: [],
      stale: true,
    };
    await renderWith(body);
    expect(container.querySelector('[data-testid="event-impact-stale"]')).toBeTruthy();
  });

  it("renders a typed sentence, not a blank panel, on a 401 from the route", async () => {
    await renderWith({ state: "unauthenticated" }, 401);
    expect(container.querySelector('[data-testid="event-impact-unauthenticated"]')).toBeTruthy();
  });

  // BLOCKER 1 (review r2): the upstream artifact is regwalled in production, so a 401/403/timeout
  // must render its OWN typed, plain-language state — never a blank panel, and never the
  // `no_events` claim "no event touches your positions" (the source was never actually checked).
  it("renders the upstream-locked disclosure, never the no-events claim nor a fine/unaffected claim, when the source is locked out", async () => {
    await renderWith({ state: "upstream_locked" });
    const node = container.querySelector('[data-testid="event-impact-upstream-locked"]');
    expect(node).toBeTruthy();
    // MAJOR COPY RULING (r4): the withdrawn r2 string asserted "your positions are unaffected" —
    // a fact this state never checked. The current sentence says only that the calendar could
    // not be checked, never anything about the positions themselves.
    expect(node?.textContent).toContain("We couldn't check the event calendar just now");
    expect(node?.textContent).not.toContain("unaffected");
    expect(node?.textContent).not.toContain("Your positions are unaffected");
    expect(container.querySelector('[data-testid="event-impact-empty"]')).toBeNull();
  });

  // MAJOR 1 (review r2): the mount used to sit inside `{!unread && <>...</>}` in PortfolioView.tsx,
  // which made `holdingsUnreadable` structurally always false at the call site. This proves the
  // component's OWN unreadable branch actually renders when the prop is true — the fix is that the
  // call site can now pass `true` at all, which is a PortfolioView.tsx-level fact this render test
  // cannot see directly, but the branch under test is exactly the one that was dead code before.
  it("renders the holdings-unreadable state when holdingsUnreadable is true, never a fetch", async () => {
    await renderWith({ state: "ok", asof: "x", heldTickers: 0, heldPositions: 0, unjoinable: [], events: [] }, 200, {
      holdingsUnreadable: true,
    });
    const node = container.querySelector('[data-testid="event-impact-holdings-unreadable"]');
    expect(node).toBeTruthy();
    // MAJOR 1 (review r5): this used to assert only that the testid element exists — a truthiness
    // check alone would pass even if the wrong sentence (or an empty one) rendered here.
    expect(node?.textContent).toContain("We can't read your positions right now");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // MAJOR 1 (review r5): every test above hard-mocks lang "en", so the ZH half of the three
  // unreadable/locked sentences was never rendered or asserted anywhere in this suite — only
  // checked negatively (no 您, banned-word scan over the raw source in eventImpact.test.ts). These
  // three assert the actual DOM text a ZH-lang user sees, matching the EN assertions above.
  describe("ZH-lang render of the three unreadable/locked states", () => {
    it("holdings_unreadable renders its ZH sentence", async () => {
      langBox.lang = "zh";
      await renderWith({ state: "ok", asof: "x", heldTickers: 0, heldPositions: 0, unjoinable: [], events: [] }, 200, {
        holdingsUnreadable: true,
      });
      const node = container.querySelector('[data-testid="event-impact-holdings-unreadable"]');
      expect(node?.textContent).toContain("我们暂时读不到你的持仓");
      expect(node?.textContent).not.toMatch(/We can't read/);
    });

    it("calendar_unreadable renders its ZH sentence", async () => {
      langBox.lang = "zh";
      await renderWith({ state: "calendar_unreadable", detail: "bad schema" });
      const node = container.querySelector('[data-testid="event-impact-calendar-unreadable"]');
      expect(node?.textContent).toContain("缺的是事件列表");
      expect(node?.textContent).not.toMatch(/event list is the part/);
    });

    it("upstream_locked renders its ZH sentence, never the ZH 'unaffected' claim", async () => {
      langBox.lang = "zh";
      await renderWith({ state: "upstream_locked" });
      const node = container.querySelector('[data-testid="event-impact-upstream-locked"]');
      expect(node?.textContent).toContain("暂时无法判断你的持仓是否受影响");
      expect(node?.textContent).not.toContain("不受影响");
      expect(node?.textContent).not.toMatch(/We couldn't check/);
    });
  });

  // m2 (review r2): the initial paint must never claim "you hold nothing" before the fetch has
  // resolved. Asserted directly on the DOM synchronously after the first render commit, before the
  // fetch microtask queue is flushed.
  it("renders a neutral checking state before the fetch resolves, never the no-holdings claim", async () => {
    let resolveFetch: (() => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve(new Response(JSON.stringify({ state: "no_holdings" }), { status: 200 }));
        })
    );
    const { default: EventImpactPanel } = await import("@/components/EventImpactPanel");
    root = createRoot(container);
    act(() => {
      root.render(React.createElement(EventImpactPanel, { positions: [], holdingsUnreadable: false }));
    });
    expect(container.querySelector('[data-testid="event-impact-checking"]')).toBeTruthy();
    expect(container.textContent).not.toContain("Add a position and any event that names it");
    await act(async () => {
      resolveFetch?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  // m1 (review r2): the empty-state plural must count OPEN POSITIONS, not distinct tickers — two
  // positions in one ticker is "2 open positions", never "1".
  it("pluralizes the no-events count by open positions, not distinct tickers", async () => {
    const body: EventImpactRead = {
      state: "no_events",
      asof: "2026-09-05",
      heldTickers: 1,
      heldPositions: 2,
      unjoinable: [],
    };
    await renderWith(body);
    const node = container.querySelector('[data-testid="event-impact-empty"]');
    expect(node?.textContent).toContain("your 2 open positions");
  });

  // MAJOR (review r3): the modal single-position case is ungrammatical if only the digit changes
  // — "any of your 1 open positions" — so the singular phrasing must actually differ, not the
  // count alone. RED before the fix: the prior template always said "your {n} open positions".
  it("uses singular phrasing for exactly one open position, never 'your 1 open positions'", async () => {
    const body: EventImpactRead = {
      state: "no_events",
      asof: "2026-09-05",
      heldTickers: 1,
      heldPositions: 1,
      unjoinable: [],
    };
    await renderWith(body);
    const node = container.querySelector('[data-testid="event-impact-empty"]');
    expect(node?.textContent).toContain("your one open position");
    expect(node?.textContent).not.toContain("1 open positions");
  });

  // MAJOR (review r3): the position chip on the primary `ok` path must not say "You hold 1
  // shares" — RED before the fix, this was the un-pluralized string on the very first line of
  // the panel a single-position user sees.
  it("pluralizes the held-shares chip text ('1 share', never '1 shares')", async () => {
    const body: EventImpactRead = {
      state: "ok",
      asof: "2026-09-05",
      heldTickers: 1,
      heldPositions: 1,
      unjoinable: [],
      events: [
        {
          eventId: "earnings|AAPL|2026-10-30",
          kind: "earnings",
          ticker: "AAPL",
          date: "2026-10-30",
          daysUntil: 5,
          positions: [{ id: "p1", ticker: "AAPL", shares: 1, status: "open" }],
          direction: { state: "not_stated" },
          mechanism: { state: "not_stated" },
          timeframe: { state: "not_stated" },
          sourcePath: "/data/portfolio_ctx.json",
        },
      ],
    };
    await renderWith(body);
    expect(container.textContent).toContain("You hold 1 share");
    expect(container.textContent).not.toContain("You hold 1 shares");
  });

  // m4 (review r2): the 5-day highlight is a Terminal display choice, not part of the source, and
  // must be labelled as such rather than left as an unexplained colour.
  it("labels the 5-day highlight as a display convention, not a source claim", async () => {
    const body: EventImpactRead = {
      state: "ok",
      asof: "2026-09-05",
      heldTickers: 1,
      heldPositions: 1,
      unjoinable: [],
      events: [
        {
          eventId: "earnings|AAPL|2026-09-08",
          kind: "earnings",
          ticker: "AAPL",
          date: "2026-09-08",
          daysUntil: 3,
          positions: [{ id: "p1", ticker: "AAPL", shares: 10, status: "open" }],
          direction: { state: "not_stated" },
          mechanism: { state: "not_stated" },
          timeframe: { state: "not_stated" },
          sourcePath: "/data/portfolio_ctx.json",
        },
      ],
    };
    await renderWith(body);
    expect(container.querySelector('[data-testid="event-impact-row"]')?.getAttribute("data-near")).toBe("1");
    expect(container.querySelector('[data-testid="event-impact-near-legend"]')).toBeTruthy();
  });
});
