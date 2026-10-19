// @vitest-environment jsdom
// Reading-sidebar behavior of the redesigned TickerNewsPanel
// (sol/web-terminal-news-sidebar-20261018-c4). The review/catch-up workflow —
// NewsCatchupBar, per-row reviewed marks, the all/updated/new/reviewed chips — no
// longer mounts in the live panel; its storage primitive stays standalone and is
// covered by newsReviewState.test.ts. This suite pins what the reading surface
// now promises: read-only rendering (no review state, no storage writes),
// source filtering and its reset, date separators, and row/group reading.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TickerNewsPanel from "@/components/news/TickerNewsPanel";
import type { TickerNewsStoryRow } from "@/lib/newsTypes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REVIEW_KEY = "mm.newsReview.v1";

let storySeq = 0;
const row = (
  title: string,
  receivedAt: string,
  extra: Partial<TickerNewsStoryRow> = {},
): TickerNewsStoryRow => {
  storySeq += 1;
  return {
    sequence: storySeq,
    source: "benzinga",
    source_item_id: "item-" + storySeq,
    story_id: "ev2_s" + storySeq,
    source_count: 1,
    item_count: 1,
    title,
    url: "https://www.benzinga.com/news/" + storySeq,
    teaser: "",
    published_at: receivedAt,
    updated_at: receivedAt,
    received_at: receivedAt,
    universe_revision: "sp500-r1",
    ...extra,
  };
};

const snapshot = (ticker: string, rows: TickerNewsStoryRow[], opts: { state?: string } = {}) => ({
  schema: "ticker_news.snapshot.v1",
  ticker,
  security_id: "SEC:" + ticker,
  state: opts.state ?? "live",
  rows,
  next_cursor: rows[rows.length - 1]?.sequence ?? null,
  has_more: false,
  source_health: { state: "live", last_successful_catchup: rows[0]?.received_at ?? null },
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
function feed(initial: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const serve = { current: initial };
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => serve.current(input, init));
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return { serve, fn };
}

const snapshotRoute = (body: () => Promise<Response>) => (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/stories/")) throw new Error("unexpected story fetch: " + url);
  return body();
};

const rowIds = () =>
  [...host.querySelectorAll("article[data-story-id]")].map((el) => el.getAttribute("data-story-id"));

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
  // One extra turn so the snapshot fetch's promise chain settles inside act.
  await act(async () => {
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
  storySeq = 0;
  Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: FakeEventSource as unknown as typeof EventSource });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  globalThis.fetch = realFetch;
  Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: realEventSource });
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("reading sidebar — the review surface is gone and nothing is written", () => {
  it("renders stories with no catch-up bar, no mark controls and no review-state chips", async () => {
    feed(snapshotRoute(() => response(snapshot("NVDA", [
      row("Launch story", "2026-10-05T14:00:00+00:00"),
      row("Supply story", "2026-10-05T13:00:00+00:00", { source: "dowjones" }),
    ]))));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    expect(rowIds()).toHaveLength(2);
    expect(host.querySelector("[data-news-catchup]")).toBeNull();
    expect(host.querySelector("[data-news-catchup-summary]")).toBeNull();
    expect(host.querySelector("[data-news-mark-one]")).toBeNull();
    expect(host.querySelector("[data-news-mark-shown]")).toBeNull();
    expect(host.querySelector("[data-news-review-receipt]")).toBeNull();
    expect(host.querySelector("[data-news-filter]")).toBeNull();
    expect(host.querySelector("article[data-news-review]")).toBeNull();
    expect(host.textContent).not.toContain("Mark reviewed");
    expect(host.textContent).not.toContain("new · ");
  });

  it("reading interactions — expanding a grouped story and filtering by source — write no review storage", async () => {
    const { fn } = feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/")) {
        return response({
          schema: "ticker_news.story.v1",
          story_id: "ev2_grp1",
          source_count: 1,
          item_count: 2,
          members: [
            row("Grouped primary", "2026-10-05T14:00:00+00:00", { story_id: "ev2_grp1", item_count: 2 }),
            { ...row("Grouped earlier", "2026-10-05T13:30:00+00:00", { story_id: "ev2_grp1", item_count: 2, source: "dowjones" }), source_item_id: "grp1-earlier" },
          ],
        });
      }
      return response(snapshot("NVDA", [
        row("Grouped primary", "2026-10-05T14:00:00+00:00", { story_id: "ev2_grp1", item_count: 2, title: "Grouped primary" }),
        row("Solo story", "2026-10-05T13:00:00+00:00", { source: "dowjones" }),
      ]));
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    await click(host.querySelector("button[aria-expanded]"));
    expect(host.textContent).toContain("Grouped earlier");
    const select = host.querySelector<HTMLSelectElement>("[data-news-source-filter]");
    await act(async () => {
      select!.value = "dowjones";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(localStorage.getItem(REVIEW_KEY)).toBeNull();
    // No write-shaped request left the panel either: only the snapshot, the story and no POSTs.
    const methods = fn.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET");
    expect(methods.every((m) => m === "GET")).toBe(true);
  });

  it("a failed load shows the failure, no rows and no review controls, and stores nothing", async () => {
    feed(snapshotRoute(() => response({ detail: "upstream down" }, 502)));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    expect(host.querySelector("[data-testid=ticker-news-panel]")?.getAttribute("data-news-state")).toBe("unavailable");
    expect(host.querySelector("article[data-story-id]")).toBeNull();
    expect(host.querySelector("[data-news-mark-one]")).toBeNull();
    expect(localStorage.getItem(REVIEW_KEY)).toBeNull();
  });
});

describe("reading sidebar — source select", () => {
  const twoSources = () => snapshot("NVDA", [
    row("Launch story", "2026-10-05T14:00:00+00:00"),
    row("Wire note", "2026-10-05T13:30:00+00:00", { source: "dowjones" }),
    row("Guidance story", "2026-10-05T13:00:00+00:00"),
    row("Desk story", "2026-10-05T12:30:00+00:00", { source: "dowjones" }),
  ]);

  it("with more than one source the select offers every source plus All, and filters visible stories", async () => {
    feed(snapshotRoute(() => response(twoSources())));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);

    const select = host.querySelector<HTMLSelectElement>("[data-news-source-filter]");
    expect(select).toBeTruthy();
    expect([...select!.options].map((o) => o.value)).toEqual(["", "benzinga", "dowjones"]);
    expect(select?.getAttribute("aria-label")).toBe("Filter news by source");

    await act(async () => {
      select!.value = "dowjones";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rowIds()).toHaveLength(2);
    // Every remaining row is a Dowjones row.
    const sourceTexts = [...host.querySelectorAll("article[data-story-id]")].map(
      (el) => el.querySelector("article > div span, article > div")?.textContent ?? "",
    );
    expect(sourceTexts.filter((t) => t.includes("Dowjones"))).toHaveLength(2);
    // The ready announcement counts the filtered rows, not the whole feed.
    expect([...host.querySelectorAll('[role="status"]')].map((el) => el.textContent)).toContain("2 headlines shown");

    await act(async () => {
      select!.value = "";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rowIds()).toHaveLength(4);
  });

  it("with a single source there is no source select", async () => {
    feed(snapshotRoute(() => response(snapshot("NVDA", [
      row("Launch story", "2026-10-05T14:00:00+00:00"),
      row("Supply story", "2026-10-05T13:00:00+00:00"),
    ]))));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    expect(host.querySelector("[data-news-source-filter]")).toBeNull();
    expect(rowIds()).toHaveLength(2);
  });

  it("a ticker change resets the source selection and never paints the prior ticker's rows", async () => {
    const { serve } = feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/MSFT")) return response(snapshot("MSFT", [row("Microsoft story", "2026-10-05T15:00:00+00:00")]));
      return response(twoSources());
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    const select = host.querySelector<HTMLSelectElement>("[data-news-source-filter]")!;
    await act(async () => {
      select.value = "dowjones";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rowIds()).toHaveLength(2);

    serve.current = (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/MSFT")) return response(snapshot("MSFT", [row("Microsoft story", "2026-10-05T15:00:00+00:00")]));
      // A late NVDA refresh must not leak back into the MSFT panel either.
      return response(twoSources());
    };
    await render(<TickerNewsPanel symbol="MSFT" lang="en" />);

    expect(host.textContent).toContain("Microsoft story");
    expect(host.textContent).not.toContain("Launch story");
    expect(host.textContent).not.toContain("Desk story");
    // MSFT serves one source, so the select is gone — the NVDA selection cannot survive.
    expect(host.querySelector("[data-news-source-filter]")).toBeNull();
  });
});

describe("reading sidebar — date separators", () => {
  const localeDate = (raw: string, lang: "en" | "zh") =>
    new Date(raw).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", year: "numeric" });

  it("groups rows under one header per local day, newest first, without repeating a day", async () => {
    const rows = [
      row("Launch story", "2026-10-06T14:00:00+00:00"),
      row("Wire note", "2026-10-06T09:00:00+00:00", { source: "dowjones" }),
      row("Guidance story", "2026-10-05T21:00:00+00:00"),
      row("Supply story", "2026-10-05T15:00:00+00:00"),
    ];
    feed(snapshotRoute(() => response(snapshot("NVDA", rows))));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);

    const headers = [...host.querySelectorAll("[data-news-date]")].map((el) => el.textContent);
    expect(headers).toEqual([localeDate(rows[0].received_at, "en"), localeDate(rows[2].received_at, "en")]);

    // Each story sits after its own day header and before the next one.
    const order = [...host.querySelectorAll("[data-news-date], article[data-story-id]")].map((el) =>
      el.tagName === "H3" ? `day:${el.textContent}` : el.getAttribute("data-story-id"),
    );
    expect(order).toEqual([
      `day:${headers[0]}`, "ev2_s1", "ev2_s2",
      `day:${headers[1]}`, "ev2_s3", "ev2_s4",
    ]);
  });

  it("renders the day header in the active language", async () => {
    feed(snapshotRoute(() => response(snapshot("NVDA", [
      row("Launch story", "2026-10-06T14:00:00+00:00"),
      row("Supply story", "2026-10-05T15:00:00+00:00"),
    ]))));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    const en = [...host.querySelectorAll("[data-news-date]")].map((el) => el.textContent);

    await act(async () => root.unmount());
    root = createRoot(host);
    feed(snapshotRoute(() => response(snapshot("NVDA", [
      row("Launch story", "2026-10-06T14:00:00+00:00"),
      row("Supply story", "2026-10-05T15:00:00+00:00"),
    ]))));
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" />);
    const zh = [...host.querySelectorAll("[data-news-date]")].map((el) => el.textContent);

    expect(zh).toEqual([localeDate("2026-10-06T14:00:00+00:00", "zh"), localeDate("2026-10-05T15:00:00+00:00", "zh")]);
    expect(zh).not.toEqual(en);
  });
});

describe("reading sidebar — rows read as source, time, headline, teaser", () => {
  it("keeps the source link honest: external headline links open safely; a missing link says so off-screen", async () => {
    feed(snapshotRoute(() => response(snapshot("NVDA", [
      row("Launch story", "2026-10-05T14:00:00+00:00"),
      row("Desk brief", "2026-10-05T13:00:00+00:00", { url: "" }),
    ]))));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);

    const linked = host.querySelector<HTMLAnchorElement>('article[data-story-id="ev2_s1"] a[data-news-headline]');
    expect(linked?.getAttribute("href")).toBe("https://www.benzinga.com/news/1");
    expect(linked?.getAttribute("target")).toBe("_blank");
    expect(linked?.getAttribute("rel")).toContain("noopener");

    const staticRow = host.querySelector('article[data-story-id="ev2_s2"]');
    expect(staticRow?.querySelector("a[data-news-headline]")).toBeNull();
    expect(staticRow?.querySelector("span[data-news-headline]")?.textContent).toBe("Desk brief");
    expect(staticRow?.textContent).toContain("Source link unavailable");
  });

  it("shows the teaser only when it adds something beyond the title", async () => {
    feed(snapshotRoute(() => response(snapshot("NVDA", [
      row("Launch story", "2026-10-05T14:00:00+00:00", { teaser: "The chipmaker expanded its platform." }),
      row("Echo headline", "2026-10-05T13:00:00+00:00", { teaser: "Echo headline" }),
    ]))));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);

    expect(host.querySelector('article[data-story-id="ev2_s1"] p')?.textContent).toBe("The chipmaker expanded its platform.");
    expect(host.querySelector('article[data-story-id="ev2_s2"] p')).toBeNull();
  });

  it("announces the ready count once per filtered view in both languages", async () => {
    const rows = () => snapshot("NVDA", [
      row("Launch story", "2026-10-05T14:00:00+00:00"),
      row("Wire note", "2026-10-05T13:00:00+00:00", { source: "dowjones" }),
    ]);
    feed(snapshotRoute(() => response(rows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    const statusTexts = () => [...host.querySelectorAll('[role="status"]')].map((el) => el.textContent);
    expect(statusTexts()).toContain("2 headlines shown");

    await act(async () => root.unmount());
    root = createRoot(host);
    feed(snapshotRoute(() => response(rows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" />);
    expect([...host.querySelectorAll('[role="status"]')].map((el) => el.textContent)).toContain("显示 2 条新闻");
  });
});

describe("reading sidebar — grouped reports (+/- disclosure)", () => {
  const groupedSnapshot = () => snapshot("NVDA", [
    row("Grouped primary", "2026-10-05T14:00:00+00:00", { story_id: "ev2_grp1", item_count: 2 }),
    row("Solo story", "2026-10-05T13:00:00+00:00"),
  ]);
  const groupDetail = () => ({
    schema: "ticker_news.story.v1",
    story_id: "ev2_grp1",
    source_count: 1,
    item_count: 2,
    members: [
      row("Grouped primary", "2026-10-05T14:00:00+00:00", { story_id: "ev2_grp1", item_count: 2 }),
      { ...row("Grouped earlier", "2026-10-05T13:30:00+00:00", { story_id: "ev2_grp1", item_count: 2, source: "dowjones" }), source_item_id: "grp1-earlier" },
    ],
  });
  const disclosure = () => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!;

  it("expands through the story endpoint, then collapses and re-expands with a fresh fetch", async () => {
    let storyFetches = 0;
    feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/ev2_grp1")) {
        storyFetches += 1;
        return response(groupDetail());
      }
      return response(groupedSnapshot());
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);

    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
    // The +/- glyph is decoration; the button's name comes from its text, not the glyph.
    const glyph = disclosure().querySelector("span[aria-hidden]");
    expect(glyph?.textContent).toBe("+");

    await click(disclosure());
    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    expect(glyph?.textContent).toBe("−");
    expect(host.textContent).toContain("Grouped earlier");
    expect(storyFetches).toBe(1);

    await click(disclosure());
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("Grouped earlier");

    await click(disclosure());
    expect(host.textContent).toContain("Grouped earlier");
    expect(storyFetches).toBe(2);
  });

  it("disables the disclosure while the detail request is in flight", async () => {
    let release!: (value: Response | PromiseLike<Response>) => void;
    const gate = new Promise<Response>((resolve) => { release = resolve; });
    feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/ev2_grp1")) return gate;
      return response(groupedSnapshot());
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);

    await click(disclosure());
    expect(disclosure().disabled).toBe(true);
    release(response(groupDetail()));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(disclosure().disabled).toBe(false);
    expect(host.textContent).toContain("Grouped earlier");
  });

  it("a failed detail load shows a visible error with a working retry", async () => {
    let storyFetches = 0;
    feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/ev2_grp1")) {
        storyFetches += 1;
        return storyFetches === 1 ? response({ detail: "boom" }, 500) : response(groupDetail());
      }
      return response(groupedSnapshot());
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);

    await click(disclosure());
    const error = [...host.querySelectorAll('[role="status"]')].find((el) =>
      el.textContent === "Reports could not be loaded. Try again.",
    );
    expect(error).toBeTruthy();
    expect(host.textContent).not.toContain("Grouped earlier");

    await click(disclosure());
    expect(host.textContent).toContain("Grouped earlier");
    expect([...host.querySelectorAll('[role="status"]')].map((el) => el.textContent))
      .not.toContain("Reports could not be loaded. Try again.");
  });

  it("a symbol change abandons an in-flight detail and never paints it over the new ticker", async () => {
    let releaseNvda!: (value: Response | PromiseLike<Response>) => void;
    const nvdaGate = new Promise<Response>((resolve) => { releaseNvda = resolve; });
    let storySignal: AbortSignal | undefined;
    feed((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/stories/ev2_grp1")) {
        storySignal = init?.signal as AbortSignal | undefined;
        return nvdaGate;
      }
      if (url.includes("/MSFT")) return response(snapshot("MSFT", [row("Microsoft story", "2026-10-05T15:00:00+00:00")]));
      return response(groupedSnapshot());
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    await click(disclosure());
    expect(storySignal).toBeDefined();

    await render(<TickerNewsPanel symbol="MSFT" lang="en" />);
    expect(host.textContent).toContain("Microsoft story");

    releaseNvda(response(groupDetail()));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // The late NVDA member must not appear under the MSFT panel…
    expect(host.textContent).not.toContain("Grouped earlier");
    expect(host.textContent).not.toContain("Grouped primary");
    // …and the discarded request was aborted, not left running.
    expect(storySignal?.aborted).toBe(true);
  });

  it("renders the group note and member links of an expanded group", async () => {
    feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/ev2_grp1")) return response(groupDetail());
      return response(groupedSnapshot());
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    await click(disclosure());

    const group = host.querySelector('[role="group"][aria-label="2 reports"]');
    expect(group).toBeTruthy();
    expect(group?.querySelector("p")?.textContent).toContain("Grouped because these reports describe the same event");
    const memberLink = group?.querySelector<HTMLAnchorElement>("a[href]");
    expect(memberLink?.getAttribute("target")).toBe("_blank");
    expect(memberLink?.getAttribute("rel")).toContain("noopener");
    expect(group?.textContent).toContain("Dowjones");
  });
});
