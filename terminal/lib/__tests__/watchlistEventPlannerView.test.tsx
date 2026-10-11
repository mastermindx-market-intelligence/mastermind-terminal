// @vitest-environment jsdom
// Watchlist event planner (E14) — the mounted view: the list-switch fence (AC-E14-05), the
// coverage-honest empty states (AC-E14-04) and date-only rows (AC-E14-01). Only the cache
// transport and the language context are replaced; the model and the component are real.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheOutcome, GetOpts } from "@/lib/dataCache";

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
    expect(empty).toContain("2 more were not read");
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

  it("says no company has a date only when every company was read", async () => {
    await mount({ Pair: [{ symbol: "MSFT" }, { symbol: "NVDA" }] }, "Pair");
    await answer("MSFT", { status: "data", data: fund(null) });
    expect(document.querySelector('[data-testid="wep-empty"]')).toBeNull(); // still reading NVDA
    await answer("NVDA", { status: "data", data: fund("2026-10-01") }); // past → no upcoming date
    expect(coverage().getAttribute("data-complete")).toBe("true");
    expect(document.querySelector('[data-testid="wep-empty"]')?.textContent).toContain("None of the 2 companies");
    expect(text()).not.toMatch(/quiet/i);
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
