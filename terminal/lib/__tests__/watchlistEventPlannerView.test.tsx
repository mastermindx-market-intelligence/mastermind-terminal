// @vitest-environment jsdom
// Watchlist event planner (E14) — the mounted view: the list-switch fence (AC-E14-05), the
// coverage-honest empty states (AC-E14-04) and date-only rows (AC-E14-01). Only the cache
// transport and the language context are replaced; the model and the component are real.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheOutcome, GetOpts } from "@/lib/dataCache";

type Revalidation = "ok" | "failed" | "superseded";

const transport = vi.hoisted(() => ({
  pending: [] as Array<{ url: string; opts?: GetOpts; resolve: (o: CacheOutcome) => void }>,
}));
vi.mock("@/lib/dataCache", () => ({
  getJSONResult: (url: string, opts?: GetOpts) => new Promise<CacheOutcome>((resolve) => transport.pending.push({ url, opts, resolve })),
}));
vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: "en", setLang: () => {} }),
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}));

import WatchlistEventPlanner from "@/components/events/WatchlistEventPlanner";
import { sessionSeenDays } from "@/lib/watchlistEventPlanner";

const fund = (next_date: unknown, next_period: unknown = "Q4 2026") => ({ asof: "2026-10-01", earnings: { next_date, next_period } });
const LISTS = {
  Tech: [{ symbol: "AAPL" }, { symbol: "MSFT" }],
  Chips: [{ symbol: "NVDA" }],
};

let host: HTMLDivElement;
let root: Root;
let painted: string[];
let observer: MutationObserver;

function recordPaintedEvents(records: MutationRecord[]) {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      const rows = node.matches('[data-testid="wep-event"]') ? [node] : [...node.querySelectorAll('[data-testid="wep-event"]')];
      for (const row of rows) painted.push(row.getAttribute("data-event-id") ?? "?");
    }
  }
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
async function answer(symbol: string, outcome: CacheOutcome) {
  const index = transport.pending.findIndex((p) => p.url === `/data/${symbol}.fund.json`);
  expect(index, `no request for ${symbol}`).toBeGreaterThanOrEqual(0);
  const [request] = transport.pending.splice(index, 1);
  await act(async () => { request.resolve(outcome); await Promise.resolve(); });
  recordPaintedEvents(observer.takeRecords());
}
async function chooseList(name: string) {
  const select = document.querySelector<HTMLSelectElement>('[data-testid="wep-list"]')!;
  await act(async () => {
    select.value = name;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  recordPaintedEvents(observer.takeRecords());
}
const eventIds = () => [...document.querySelectorAll('[data-testid="wep-event"]')].map((e) => e.getAttribute("data-event-id"));
const coverage = () => document.querySelector('[data-testid="wep-coverage"]')!;
const text = () => document.querySelector('[data-testid="wep-dialog"]')?.textContent ?? "";

async function mount(lists: Record<string, { symbol: string }[]>, initialList: string) {
  await act(async () => {
    root.render(
      <WatchlistEventPlanner
        lists={lists}
        initialList={initialList}
        symbolInfo={(s) => (s === "AAPL" ? { name: "Apple Inc.", mkt: "NASDAQ" } : null)}
        onClose={() => {}}
        onOpenCompany={() => {}}
      />,
    );
  });
  recordPaintedEvents(observer.takeRecords());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 11, 14));
  transport.pending.length = 0;
  sessionSeenDays.clear();
  painted = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  observer = new MutationObserver(recordPaintedEvents);
  observer.observe(document.body, { childList: true, subtree: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  observer.disconnect();
  host.remove();
  vi.useRealTimers();
});

describe("AC-E14-05 · a late answer for the previous list never paints", () => {
  it("drops the prior list's events after a switch, in every commit", async () => {
    await mount(LISTS, "Tech");
    expect(transport.pending.map((p) => p.url).sort()).toEqual(["/data/AAPL.fund.json", "/data/MSFT.fund.json"]);

    await chooseList("Chips");
    expect(transport.pending.map((p) => p.url)).toContain("/data/NVDA.fund.json");

    // The previous list's answers arrive late.
    await answer("AAPL", { status: "data", data: fund("2026-10-29") });
    await answer("MSFT", { status: "data", data: fund("2026-10-28") });
    expect(eventIds()).toEqual([]);
    expect(text()).not.toContain("AAPL");

    await answer("NVDA", { status: "data", data: fund("2026-11-18", "Q3 FY2027") });
    expect(eventIds()).toEqual(["earnings:NVDA:Q3 FY2027"]);
    expect(painted).not.toContain("earnings:AAPL:Q4 2026");
    expect(painted).not.toContain("earnings:MSFT:Q4 2026");

    // Returning to the first list reads it again; nothing from the dropped answers is reused.
    await chooseList("Tech");
    expect(eventIds()).toEqual([]);
    await answer("AAPL", { status: "data", data: fund("2026-10-29") });
    expect(eventIds()).toEqual(["earnings:AAPL:Q4 2026"]);
  });
});

describe("AC-E14-04 · coverage is explicit", () => {
  it("never claims an empty list while a company is unread", async () => {
    await mount({ Mixed: [{ symbol: "MSFT" }, { symbol: "NVDA" }, { symbol: "XYZ" }, { symbol: "BTC-USD" }] }, "Mixed");
    expect(transport.pending.map((p) => p.url).sort()).toEqual(["/data/MSFT.fund.json", "/data/NVDA.fund.json", "/data/XYZ.fund.json"]);
    await answer("MSFT", { status: "data", data: fund(null) });
    await answer("NVDA", { status: "unavailable", reason: "server", httpStatus: 503 });
    await answer("XYZ", { status: "absent", httpStatus: 404 });

    expect(coverage().getAttribute("data-complete")).toBe("false");
    expect(coverage().getAttribute("data-unknown")).toBe("2");
    expect(document.querySelector('[data-testid="wep-incomplete"]')).not.toBeNull();
    const empty = document.querySelector('[data-testid="wep-empty"]')?.textContent ?? "";
    expect(empty).toContain("2 more have no current answer");
    expect(empty).not.toMatch(/None of the/);
    expect(text()).toContain("1 could not be read");
    expect(text()).toContain("1 not covered by the source");
    expect(text()).toContain("1 not companies");

    // Retrying the unreadable company is a forced network read; success completes coverage only
    // for the companies actually read (XYZ stays not covered).
    const retry = document.querySelector<HTMLButtonElement>('[data-testid="wep-retry"]')!;
    await act(async () => retry.click());
    const forced = transport.pending.find((p) => p.url === "/data/NVDA.fund.json");
    expect(forced?.opts).toEqual({ ttl: 0, swr: false });
    await answer("NVDA", { status: "data", data: fund(null) });
    expect(coverage().getAttribute("data-complete")).toBe("false");
    expect(coverage().getAttribute("data-unknown")).toBe("1");
  });

  it("says no company has a date only when every company has a current answer", async () => {
    await mount({ Pair: [{ symbol: "MSFT" }, { symbol: "NVDA" }] }, "Pair");
    await answer("MSFT", { status: "data", data: fund(null) });
    expect(document.querySelector('[data-testid="wep-empty"]')).toBeNull(); // still reading NVDA
    await answer("NVDA", { status: "data", data: fund(null) });
    expect(coverage().getAttribute("data-complete")).toBe("true");
    expect(document.querySelector('[data-testid="wep-empty"]')?.textContent).toContain("None of the 2 companies");
    expect(text()).not.toMatch(/quiet/i);
  });

  it("a date that has already passed is outdated, never proof of no upcoming report", async () => {
    await mount({ Pair: [{ symbol: "MSFT" }, { symbol: "NVDA" }] }, "Pair");
    await answer("MSFT", { status: "data", data: fund(null) });
    await answer("NVDA", { status: "data", data: fund("2026-10-01") }); // passed, no new date yet
    expect(coverage().getAttribute("data-complete")).toBe("false");
    expect(coverage().getAttribute("data-unknown")).toBe("1");
    expect(text()).toContain("1 with an outdated date");
    expect(document.querySelector('[data-testid="wep-incomplete"]')).not.toBeNull();
    const empty = document.querySelector('[data-testid="wep-empty"]')?.textContent ?? "";
    expect(empty).not.toMatch(/None of the/);
    expect(empty).toContain("1 more have no current answer");
  });
});

describe("AC-E14-01 · date-only rows", () => {
  it("label the missing time and carry no clock", async () => {
    await mount({ One: [{ symbol: "AAPL" }] }, "One");
    await answer("AAPL", { status: "data", data: fund("2026-10-29") });
    const row = document.querySelector('[data-testid="wep-event"]')!;
    expect(row.getAttribute("data-precision")).toBe("date");
    expect(row.textContent).toContain("Date only");
    expect(row.textContent).toContain("Confirmation not stated");
    expect(row.textContent).not.toMatch(/\d{1,2}:\d{2}/);
    expect(document.querySelector('[data-day="2026-10-29"]')?.textContent).toContain("Thu, Oct 29, 2026");
  });
});

describe("AC-E14-03 · Read again replaces by identity", () => {
  it("shows one row with the moved-from note after a reschedule", async () => {
    await mount({ One: [{ symbol: "AAPL" }] }, "One");
    await answer("AAPL", { status: "data", data: fund("2026-10-29") });
    const again = document.querySelector<HTMLButtonElement>('[data-testid="wep-read-again"]')!;
    await act(async () => again.click());
    const forced = transport.pending.find((p) => p.url === "/data/AAPL.fund.json");
    expect(forced?.opts).toEqual({ ttl: 0, swr: false });
    await answer("AAPL", { status: "data", data: fund("2026-10-30") });
    expect(eventIds()).toEqual(["earnings:AAPL:Q4 2026"]);
    expect(document.querySelector('[data-testid="wep-moved"]')?.textContent).toBe("Moved from Oct 29, 2026");
    expect(document.querySelector('[data-day="2026-10-29"]')).toBeNull();
  });
});

describe("Read again keeps each answer until its new one lands (failure-state truth)", () => {
  it("a 503 on Read again keeps AAPL's row and date, labelled as an earlier copy", async () => {
    await mount({ Two: [{ symbol: "AAPL" }, { symbol: "MSFT" }] }, "Two");
    await answer("AAPL", { status: "data", data: fund("2026-10-29") });
    await answer("MSFT", { status: "data", data: fund(null) });
    expect(coverage().getAttribute("data-complete")).toBe("true");
    const again = document.querySelector<HTMLButtonElement>('[data-testid="wep-read-again"]')!;
    await act(async () => again.click());
    // Every company of the batch is asked again from the network.
    expect(transport.pending.map((p) => [p.url, p.opts])).toEqual([
      ["/data/AAPL.fund.json", { ttl: 0, swr: false }],
      ["/data/MSFT.fund.json", { ttl: 0, swr: false }],
    ]);
    // While the forced reads are in flight, the rows and the date stay on screen.
    expect(eventIds()).toEqual(["earnings:AAPL:Q4 2026"]);
    expect(document.querySelector('[data-day="2026-10-29"]')).not.toBeNull();
    expect(document.querySelector('[data-symbol="MSFT"]')?.textContent).toContain("No upcoming date in the source");
    expect(again.disabled).toBe(true);
    expect(coverage().getAttribute("data-refreshing")).toBe("true");
    expect(text()).toContain("Reading again… 0 of 2");

    await answer("AAPL", { status: "unavailable", reason: "server", httpStatus: 503 });
    await answer("MSFT", { status: "unavailable", reason: "server", httpStatus: 503 });
    await flush();
    expect(eventIds()).toEqual(["earnings:AAPL:Q4 2026"]);
    expect(document.querySelector('[data-day="2026-10-29"]')?.textContent).toContain("Thu, Oct 29, 2026");
    expect(document.querySelector('[data-testid="wep-earlier-copy"]')?.textContent).toBe("Earlier copy · latest read failed");
    expect(document.querySelector('[data-symbol="MSFT"]')?.textContent).toContain("No upcoming date in the source · Earlier copy · latest read failed");
    expect(text()).toContain("2 shown from an earlier copy");
    expect(text()).not.toContain("could not be read");
    expect(document.querySelector('[data-testid="wep-retry"]')).toBeNull();
    expect(coverage().getAttribute("data-complete")).toBe("false");
    expect(coverage().getAttribute("data-unknown")).toBe("2");
    expect(coverage().getAttribute("data-refreshing")).toBe("false");
    expect(document.querySelector('[data-testid="wep-empty"]')).toBeNull();
    // The row was never taken down and painted again.
    expect(painted.filter((id) => id === "earnings:AAPL:Q4 2026")).toHaveLength(1);

    // A later Read again that reaches the source clears the label.
    expect(again.disabled).toBe(false);
    await act(async () => again.click());
    await answer("AAPL", { status: "data", data: fund("2026-10-29") });
    await answer("MSFT", { status: "data", data: fund(null) });
    await flush();
    expect(document.querySelector('[data-testid="wep-earlier-copy"]')).toBeNull();
    expect(text()).not.toContain("Earlier copy");
    expect(coverage().getAttribute("data-complete")).toBe("true");
  });

  it("a saved copy is labelled until its refresh confirms it, and a failed refresh marks it", async () => {
    await mount({ Two: [{ symbol: "AAPL" }, { symbol: "MSFT" }] }, "Two");
    const reqA = transport.pending.find((p) => p.url === "/data/AAPL.fund.json")!;
    let settleA!: (r: Revalidation) => void;
    let settleM!: (r: Revalidation) => void;
    await answer("AAPL", {
      status: "data", data: fund("2026-10-29"),
      stale: { ageMs: 9e6, source: "disk", revalidation: new Promise<Revalidation>((r) => { settleA = r; }) },
    });
    await answer("MSFT", {
      status: "data", data: fund(null),
      stale: { ageMs: 9e6, source: "disk", revalidation: new Promise<Revalidation>((r) => { settleM = r; }) },
    });
    expect(document.querySelector('[data-testid="wep-saved-copy"]')?.textContent).toBe("Saved copy · not yet confirmed");
    expect(document.querySelector('[data-symbol="MSFT"]')?.textContent).toContain("Saved copy · not yet confirmed");
    expect(text()).toContain("2 shown from a saved copy not yet confirmed");
    expect(coverage().getAttribute("data-complete")).toBe("false");
    expect(coverage().getAttribute("data-unknown")).toBe("2");

    // The cache's refresh answers AAPL (onRevalidate, then "ok"): the label clears.
    await act(async () => { reqA.opts!.onRevalidate!(fund("2026-10-29")); settleA("ok"); await Promise.resolve(); });
    expect(document.querySelector('[data-testid="wep-saved-copy"]')).toBeNull();
    expect(text()).toContain("1 shown from a saved copy not yet confirmed");

    // MSFT's refresh fails: the copy stays, now marked as an earlier copy.
    await act(async () => { settleM("failed"); await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelector('[data-symbol="MSFT"]')?.textContent).toContain("Earlier copy · latest read failed");
    expect(text()).toContain("1 shown from an earlier copy");
    expect(text()).not.toContain("saved copy not yet confirmed");
    expect(coverage().getAttribute("data-complete")).toBe("false");
    expect(coverage().getAttribute("data-unknown")).toBe("1");
  });

  it("a refresh the cache superseded leaves the saved-copy label in place", async () => {
    await mount({ One: [{ symbol: "AAPL" }] }, "One");
    await answer("AAPL", {
      status: "data", data: fund("2026-10-29"),
      stale: { ageMs: 9e6, source: "memory", revalidation: Promise.resolve<Revalidation>("superseded") },
    });
    await flush();
    expect(document.querySelector('[data-testid="wep-saved-copy"]')?.textContent).toBe("Saved copy · not yet confirmed");
    expect(coverage().getAttribute("data-complete")).toBe("false");
  });
});

describe("bounded demand", () => {
  it("reads at most 50 companies until the user asks for more", async () => {
    const big = Array.from({ length: 53 }, (_, i) => ({ symbol: `C${i}` }));
    await mount({ Big: big }, "Big");
    await flush();
    // The concurrency bound keeps four in flight; serve all 50 of the first batch.
    let served = 0;
    while (transport.pending.length) {
      const next = transport.pending[0];
      await answer(next.url.slice(6, -10), { status: "data", data: fund(null) });
      served += 1;
    }
    expect(served).toBe(50);
    expect(text()).toContain("3 not read yet");
    expect(coverage().getAttribute("data-complete")).toBe("false");
    const more = document.querySelector<HTMLButtonElement>('[data-testid="wep-read-more"]')!;
    await act(async () => more.click());
    while (transport.pending.length) {
      const next = transport.pending[0];
      await answer(next.url.slice(6, -10), { status: "data", data: fund(null) });
      served += 1;
    }
    expect(served).toBe(53);
    expect(coverage().getAttribute("data-complete")).toBe("true");
  });
});
