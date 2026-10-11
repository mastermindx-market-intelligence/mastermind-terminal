// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TickerNewsPanel from "@/components/news/TickerNewsPanel";
import { useNewsCatchup } from "@/components/news/useNewsCatchup";
import { NEWS_REVIEW_KEY } from "@/lib/newsReviewState";
import type { TickerNewsStoryRow } from "@/lib/newsTypes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (
  storyId: string,
  title: string,
  sequence: number,
  itemCount = 1,
  extra: Partial<TickerNewsStoryRow> = {},
): TickerNewsStoryRow => ({
  sequence,
  source: "benzinga",
  source_item_id: storyId + "-item",
  story_id: storyId,
  source_count: 1,
  item_count: itemCount,
  title,
  url: "https://www.benzinga.com/news/" + storyId,
  teaser: "Short lead",
  published_at: "2026-10-05T14:00:00+00:00",
  updated_at: null,
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1",
  ...extra,
});

const snapshot = (ticker: string, rows: TickerNewsStoryRow[], opts: { state?: string; hasMore?: boolean } = {}) => ({
  schema: "ticker_news.snapshot.v1",
  ticker,
  security_id: "SEC:" + ticker,
  state: opts.state ?? "live",
  rows,
  next_cursor: rows[rows.length - 1]?.sequence ?? null,
  has_more: opts.hasMore ?? false,
  source_health: { state: "live", last_successful_catchup: "2026-10-05T14:01:01+00:00" },
});

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  url: string;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  closed = false;
  readyState = FakeEventSource.OPEN;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, cb: EventListener) {
    const list = this.listeners.get(name) ?? [];
    list.push(cb as (event: MessageEvent) => void);
    this.listeners.set(name, list);
  }

  emit(name: string, payload: unknown) {
    for (const cb of this.listeners.get(name) ?? []) {
      cb(new MessageEvent(name, { data: JSON.stringify(payload) }));
    }
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

const CHANGE = {
  sequence: 99,
  kind: "upsert",
  source: "benzinga",
  source_item_id: "x",
  story_id: "ev2_a",
  title: "t",
  url: "https://www.benzinga.com/news/x",
  teaser: "",
  security_ids: ["SEC:NVDA"],
  universe_revision: "sp500-r1",
  observed_at: "2026-10-05T14:02:00+00:00",
};

let host: HTMLDivElement;
let root: Root;
let realFetch: typeof globalThis.fetch;
let realEventSource: typeof globalThis.EventSource;

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

/** A fetch that serves whatever `serve.current` holds, so a test can change the feed between loads. */
function feed(initial: () => Promise<Response>) {
  const serve = { current: initial };
  const fn = vi.fn(() => serve.current());
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return { serve, fn };
}

const stored = () => localStorage.getItem(NEWS_REVIEW_KEY);
const reviewOf = (id: string) =>
  host.querySelector<HTMLElement>(`article[data-story-id="${id}"]`)?.dataset.newsReview;
const markOne = (id: string) =>
  host.querySelector<HTMLButtonElement>(`article[data-story-id="${id}"] [data-news-mark-one]`);
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}
async function pushChange() {
  await act(async () => {
    FakeEventSource.instances[FakeEventSource.instances.length - 1].emit("upsert", CHANGE);
    await Promise.resolve();
  });
}

/** jsdom's own window: Node's built-in `localStorage` global shadows jsdom's in this environment. */
const jsdomWindow = () => (globalThis as unknown as { jsdom: { window: Window & typeof globalThis } }).jsdom.window;

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: jsdomWindow().localStorage, configurable: true, writable: true });
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  realFetch = globalThis.fetch;
  realEventSource = globalThis.EventSource;
  FakeEventSource.instances = [];
  Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: FakeEventSource as unknown as typeof EventSource });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  globalThis.fetch = realFetch;
  Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: realEventSource });
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("AC-E13-01 — a failed or partial load never marks unseen stories reviewed", () => {
  it("a failed first load shows no review controls, writes nothing, and the clock moving changes nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T15:00:00Z"));
    feed(() => response({ detail: "upstream down" }, 502));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    expect(host.querySelector("[data-news-catchup]")).toBeNull();
    expect(host.querySelector("[data-news-mark-one]")).toBeNull();
    expect(host.querySelector("[data-news-mark-shown]")).toBeNull();
    vi.setSystemTime(new Date("2026-12-31T00:00:00Z"));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    expect(stored()).toBeNull();
  });

  it("a failed background refresh hides the rows and their review controls instead of marking them", async () => {
    const { serve } = feed(() => response(snapshot("NVDA", [row("ev2_a", "First", 2), row("ev2_b", "Second", 1)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    await click(markOne("ev2_b"));
    const before = stored();

    serve.current = () => response({ detail: "upstream down" }, 502);
    await pushChange();

    expect(host.textContent).toContain("News is temporarily unavailable");
    expect(host.querySelector("article[data-story-id]")).toBeNull();
    expect(host.querySelector("[data-news-mark-shown]")).toBeNull();
    expect(stored()).toBe(before);
  });

  it("a partial page (has_more) marks only the presented stories; a later, older arrival is still new", async () => {
    const { serve } = feed(() => response(snapshot("NVDA", [
      row("ev2_c", "Third", 30, 1, { received_at: "2026-10-05T19:31:00+00:00" }),
      row("ev2_b", "Second", 20),
    ], { hasMore: true })));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    await click(host.querySelector("[data-news-mark-shown]"));

    const slot = JSON.parse(stored()!)["account:user-a"].NVDA;
    expect(Object.keys(slot.stories).sort()).toEqual(["ev2_b", "ev2_c"]);
    // The receipt is the newest presented record's own source time.
    expect(slot.through).toEqual({ sequence: 30, at: "2026-10-05T19:31:00+00:00" });

    // A story the collector received late (older sequence, older time) appears on the next load.
    serve.current = () => response(snapshot("NVDA", [
      row("ev2_c", "Third", 30, 1, { received_at: "2026-10-05T19:31:00+00:00" }),
      row("ev2_b", "Second", 20),
      row("ev2_late", "Late arrival", 12, 1, { received_at: "2026-10-05T09:00:00+00:00" }),
    ]));
    await pushChange();

    expect(reviewOf("ev2_late")).toBe("new");
    expect(reviewOf("ev2_b")).toBe("reviewed");
    expect(host.querySelector("[data-news-catchup-summary]")?.textContent).toBe("1 new · 0 updated");
  });

  it("an interrupted review keeps what was marked and leaves the rest new", async () => {
    feed(() => response(snapshot("NVDA", [row("ev2_c", "Third", 3), row("ev2_b", "Second", 2), row("ev2_a", "First", 1)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    await click(markOne("ev2_b"));
    await act(async () => root.unmount());

    root = createRoot(host);
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    expect(reviewOf("ev2_b")).toBe("reviewed");
    expect(reviewOf("ev2_a")).toBe("new");
    expect(reviewOf("ev2_c")).toBe("new");
    expect(host.querySelector("[data-news-review-receipt]")).toBeNull();
  });
});

describe("AC-E13-02 — a corrected story is distinguishable from an unchanged read story", () => {
  it("shows Updated with the kind of change, and Reviewed for the unchanged one", async () => {
    const { serve } = feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch", 5), row("ev2_b", "Supply", 4)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    await click(host.querySelector("[data-news-mark-shown]"));
    expect(reviewOf("ev2_a")).toBe("reviewed");

    serve.current = () => response(snapshot("NVDA", [
      row("ev2_a", "Launch (corrected)", 9),
      row("ev2_b", "Supply", 4),
    ]));
    await pushChange();
    expect(reviewOf("ev2_a")).toBe("updated");
    expect(reviewOf("ev2_b")).toBe("reviewed");
    expect(host.querySelector(`article[data-story-id="ev2_a"] [data-news-change]`)?.textContent)
      .toBe("Revised since your review");
    expect(host.querySelector(`article[data-story-id="ev2_b"] [data-news-change]`)).toBeNull();

    serve.current = () => response(snapshot("NVDA", [
      row("ev2_a", "Launch (corrected)", 11, 3),
      row("ev2_b", "Supply", 4),
    ]));
    await pushChange();
    expect(host.querySelector(`article[data-story-id="ev2_a"] [data-news-change]`)?.textContent)
      .toBe("2 more reports since your review");
    expect(host.querySelector("[data-news-catchup-summary]")?.textContent).toBe("0 new · 1 updated");
  });

  it("renders the review states in Chinese", async () => {
    feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch", 5), row("ev2_b", "Supply", 4)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" userId="user-a" />);
    await click(markOne("ev2_b"));
    expect(host.querySelector("[data-news-catchup-summary]")?.textContent).toBe("1 条新 · 0 条更新");
    expect(reviewOf("ev2_b")).toBe("reviewed");
    expect(markOne("ev2_b")).toBeNull();
    expect(host.querySelector(`article[data-story-id="ev2_b"]`)?.textContent).toContain("已读");
    expect(markOne("ev2_a")?.textContent).toBe("标为已读");
  });
});

describe("AC-E13-03 — review state is private to the signed-in account", () => {
  it("an account switch shows the new account's own state and never the previous account's", async () => {
    feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch", 5), row("ev2_b", "Supply", 4)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    await click(host.querySelector("[data-news-mark-shown]"));
    expect(reviewOf("ev2_a")).toBe("reviewed");

    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-b" />);
    expect(reviewOf("ev2_a")).toBe("new");
    expect(reviewOf("ev2_b")).toBe("new");
    expect(Object.keys(JSON.parse(stored()!))).toEqual(["account:user-a"]);

    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    expect(reviewOf("ev2_a")).toBe("reviewed");
  });

  it("never classifies with the previous account's marks, even for one render", () => {
    const rows = [row("ev2_a", "Launch", 5)];
    localStorage.setItem(NEWS_REVIEW_KEY, JSON.stringify({
      "account:user-a": { NVDA: { stories: { ev2_a: [5, 1] }, through: null } },
    }));
    const seen: { userId: string; mode: string; status: string | undefined }[] = [];
    function Probe({ userId }: { userId: string }) {
      const c = useNewsCatchup({ userId, ticker: "NVDA", presented: rows });
      seen.push({ userId, mode: c.mode, status: c.classify(rows[0])?.status });
      return null;
    }
    act(() => root.render(<Probe userId="user-a" />));
    act(() => root.render(<Probe userId="user-b" />));
    expect(seen.some((s) => s.userId === "user-a" && s.status === "reviewed")).toBe(true);
    expect(seen.filter((s) => s.userId === "user-b").map((s) => s.status)).not.toContain("reviewed");
    expect(seen.find((s) => s.userId === "user-b")?.mode).toBe("pending");
    expect(seen[seen.length - 1]).toEqual({ userId: "user-b", mode: "saved", status: "new" });
  });

  it("does not adopt guest marks, and leaves the guest slot byte-identical", async () => {
    const guest = JSON.stringify({ NVDA: { stories: { ev2_a: [5, 1], ev2_b: [4, 1] }, through: null } });
    localStorage.setItem(NEWS_REVIEW_KEY, `{"guest":${guest}}`);
    feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch", 5), row("ev2_b", "Supply", 4)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    expect(reviewOf("ev2_a")).toBe("new");
    expect(reviewOf("ev2_b")).toBe("new");
    await click(markOne("ev2_a"));
    expect(JSON.stringify(JSON.parse(stored()!).guest)).toBe(guest);
  });

  it("with no account identity it says marks need an account and offers no mark controls", async () => {
    feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch", 5)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    expect(host.textContent).toContain("Review marks need a signed-in account.");
    expect(host.querySelector("[data-news-mark-one]")).toBeNull();
    expect(host.textContent).toContain("Launch");
    expect(stored()).toBeNull();
  });

  it("when the device store refuses a write, marks last for the session and the panel says so", async () => {
    feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch", 5), row("ev2_b", "Supply", 4)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    vi.spyOn(jsdomWindow().Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await click(markOne("ev2_a"));
    expect(reviewOf("ev2_a")).toBe("reviewed");
    expect(host.textContent).toContain("Review marks can't be saved on this device. They last for this session only.");
    expect(stored()).toBeNull();
  });
});

describe("AC-E13-04 — filters use supplied metadata and keep honest states", () => {
  it("filters by review state and by the feed's own source field; there is no topic filter", async () => {
    feed(() => response(snapshot("NVDA", [
      row("ev2_a", "Launch", 5),
      row("ev2_b", "Supply", 4, 1, { source: "dowjones" }),
      row("ev2_c", "Guidance", 3),
    ])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    await click(markOne("ev2_c"));

    await click(host.querySelector('[data-news-filter="new"]'));
    expect([...host.querySelectorAll("article[data-story-id]")].map((a) => a.getAttribute("data-story-id")))
      .toEqual(["ev2_a", "ev2_b"]);
    await click(host.querySelector('[data-news-filter="reviewed"]'));
    expect([...host.querySelectorAll("article[data-story-id]")].map((a) => a.getAttribute("data-story-id")))
      .toEqual(["ev2_c"]);
    await click(host.querySelector('[data-news-filter="updated"]'));
    expect(host.querySelector("article[data-story-id]")).toBeNull();
    expect(host.querySelector("[data-news-filter-empty]")?.textContent).toBe("No stories match this filter.");
    await click(host.querySelector('[data-news-filter="all"]'));

    const select = host.querySelector<HTMLSelectElement>("[data-news-source-filter]");
    expect([...select!.options].map((o) => o.value)).toEqual(["", "benzinga", "dowjones"]);
    await act(async () => {
      select!.value = "dowjones";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect([...host.querySelectorAll("article[data-story-id]")].map((a) => a.getAttribute("data-story-id")))
      .toEqual(["ev2_b"]);
    expect(host.querySelector("[data-news-catchup-summary]")?.textContent).toBe("1 new · 0 updated");
    expect(host.textContent?.toLowerCase()).not.toContain("topic");
  });

  it("shows no source filter when the feed supplies a single source", async () => {
    feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch", 5), row("ev2_b", "Supply", 4)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    expect(host.querySelector("[data-news-catchup]")).toBeTruthy();
    expect(host.querySelector("[data-news-source-filter]")).toBeNull();
  });

  it("restricted and quiet feeds keep their own messages and show no review controls", async () => {
    feed(() => response({ detail: "ticker news rights unavailable" }, 503));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    expect(host.textContent).toContain("News access is unavailable");
    expect(host.querySelector("[data-news-catchup]")).toBeNull();
    expect(host.textContent).not.toContain("No stories match");

    await act(async () => root.unmount());
    root = createRoot(host);
    feed(() => response(snapshot("NVDA", [], { state: "quiet" })));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    expect(host.textContent).toContain("No new company news right now.");
    expect(host.querySelector("[data-news-catchup]")).toBeNull();
    expect(host.querySelector("[data-news-filter-empty]")).toBeNull();
  });
});

describe("AC-E13-05 — marking reviewed changes nothing at the source and sends nothing", () => {
  it("issues no request, opens no stream, sends no beacon or notification, and leaves the story as presented", async () => {
    const { fn } = feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch", 5, 2), row("ev2_b", "Supply", 4)])));
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
    const notify = vi.fn();
    Object.defineProperty(globalThis, "Notification", { configurable: true, writable: true, value: notify });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    const articleHtml = () =>
      [...host.querySelectorAll("article[data-story-id]")].map((a) => ({
        title: a.querySelector("[data-news-headline]")?.textContent,
        href: a.querySelector("a[data-news-headline]")?.getAttribute("href"),
        teaser: a.querySelector("p")?.textContent,
      }));
    const before = articleHtml();
    const fetches = fn.mock.calls.length;
    const streams = FakeEventSource.instances.length;

    await click(markOne("ev2_a"));
    await click(host.querySelector("[data-news-mark-shown]"));

    expect(fn.mock.calls.length).toBe(fetches);
    expect(FakeEventSource.instances.length).toBe(streams);
    expect(beacon).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(articleHtml()).toEqual(before);
    expect(host.textContent).toContain("2 reports");
    // Only references are kept: no title, teaser or link reaches storage.
    expect(stored()).not.toContain("Launch");
    expect(stored()).not.toContain("benzinga.com");
    delete (globalThis as { Notification?: unknown }).Notification;
  });
});
