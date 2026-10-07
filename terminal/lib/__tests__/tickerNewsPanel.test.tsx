// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TickerNewsPanel from "@/components/news/TickerNewsPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (storyId: string, title: string, sequence = 1, itemCount = 1) => ({
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
  updated_at: "2026-10-05T14:01:00+00:00",
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1",
});

const snapshot = (ticker: string, rows: ReturnType<typeof row>[], state = "live") => ({
  schema: "ticker_news.snapshot.v1",
  ticker,
  security_id: "SEC:" + ticker,
  state,
  rows,
  next_cursor: rows[rows.length - 1]?.sequence ?? null,
  has_more: false,
  source_health: { state: state === "quiet" ? "live" : state, last_successful_catchup: "2026-10-05T14:01:01+00:00" },
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

function deferredStoryJson(body: unknown, status = 200) {
  let releaseJson!: (value: unknown) => void;
  let enteredJson!: () => void;
  const jsonEntered = new Promise<void>((resolve) => {
    enteredJson = resolve;
  });
  const jsonPromise = new Promise<unknown>((resolve) => {
    releaseJson = resolve;
  });
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      enteredJson();
      return jsonPromise;
    },
  } as Response;
  return { response: Promise.resolve(res), jsonEntered, releaseJson };
}

beforeEach(() => {
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
  vi.restoreAllMocks();
});

describe("TickerNewsPanel", () => {
  it("renders a live ticker story feed and opens the original source", async () => {
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [row("ev2_a", "Nvidia launches accelerator")]))) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });

    expect(host.textContent).toContain("Nvidia launches accelerator");
    expect(host.textContent).toContain("Benzinga");
    const link = host.querySelector<HTMLAnchorElement>("a[data-news-headline]");
    expect(link?.href).toBe("https://www.benzinga.com/news/ev2_a");
    expect(link?.rel).toContain("noopener");
    expect(FakeEventSource.instances[0]?.url).toContain("symbol=NVDA");
  });

  it("requests the proven 20-story initial page", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      void input;
      return response(snapshot("NVDA", [row("ev2_a", "Nvidia launches accelerator")]));
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/news/NVDA?limit=20");
  });

  it("never paints a late prior-symbol response over the current ticker", async () => {
    let resolveA!: (r: Response) => void;
    const lateA = new Promise<Response>((resolve) => { resolveA = resolve; });
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/AAPL")) return lateA;
      if (url.includes("/MSFT")) return response(snapshot("MSFT", [row("ev2_m", "Microsoft current story")]));
      throw new Error("unexpected " + url);
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="AAPL" lang="en" />);
    });
    await act(async () => {
      root.render(<TickerNewsPanel symbol="MSFT" lang="en" />);
    });
    expect(host.textContent).toContain("Microsoft current story");

    await act(async () => {
      resolveA(new Response(JSON.stringify(snapshot("AAPL", [row("ev2_a", "Apple stale story")])), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      await lateA;
    });

    expect(host.textContent).toContain("Microsoft current story");
    expect(host.textContent).not.toContain("Apple stale story");
  });

  it("renders rights-unavailable as restricted rather than an empty-news claim", async () => {
    globalThis.fetch = vi.fn(() => response({ detail: "ticker news rights unavailable" }, 503)) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });

    expect(host.textContent).toContain("News access is unavailable");
    expect(host.textContent).not.toContain("No recent stories");
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("expands grouped coverage through the story endpoint", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/")) {
        return response({
          schema: "ticker_news.story.v1",
          story_id: "ev2_group",
          source_count: 1,
          item_count: 2,
          members: [
            row("ev2_group", "Primary headline", 2, 2),
            { ...row("ev2_group", "Earlier wording", 1, 2), source_item_id: "second" },
          ],
        });
      }
      return response(snapshot("NVDA", [row("ev2_group", "Primary headline", 2, 2)]));
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("2 reports"));
    expect(button).toBeTruthy();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("Earlier wording");
  });

  it("refreshes after an SSE change while keeping one stream per mounted symbol", async () => {
    let version = 0;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/stories/")) throw new Error("unexpected story fetch");
      version += 1;
      return response(snapshot("NVDA", [
        row("ev2_a", version === 1 ? "First headline" : "Corrected headline", version),
      ]));
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });
    expect(host.textContent).toContain("First headline");
    expect(FakeEventSource.instances).toHaveLength(1);

    await act(async () => {
      FakeEventSource.instances[0].emit("upsert", {
        sequence: 2,
        kind: "upsert",
        source: "benzinga",
        source_item_id: "1",
        story_id: "ev2_a",
        title: "Corrected headline",
        url: "https://www.benzinga.com/news/1",
        teaser: "",
        security_ids: ["SEC:NVDA"],
        universe_revision: "sp500-r1",
        observed_at: "2026-10-05T14:02:00+00:00",
      });
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Corrected headline");
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("renders bilingual quiet state without claiming the feed is broken", async () => {
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [], "quiet"))) as unknown as typeof globalThis.fetch;
    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="zh" />);
    });
    expect(host.textContent).toContain("暂时没有新的公司新闻");
    expect(host.textContent).not.toContain("不可用");
  });

  it("starts MSFT grouped detail immediately while a prior symbol's json() is still pending", async () => {
    const aaplDeferred = deferredStoryJson({
      schema: "ticker_news.story.v1",
      story_id: "ev2_aapl_grp",
      source_count: 1,
      item_count: 2,
      members: [row("ev2_aapl_grp", "Apple grouped", 2, 2)],
    });
    const msftDeferred = deferredStoryJson({
      schema: "ticker_news.story.v1",
      story_id: "ev2_msft_grp",
      source_count: 1,
      item_count: 2,
      members: [row("ev2_msft_grp", "Microsoft grouped", 2, 2)],
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/ev2_aapl_grp")) return aaplDeferred.response;
      if (url.includes("/stories/ev2_msft_grp")) return msftDeferred.response;
      if (url.includes("/AAPL")) {
        return response(snapshot("AAPL", [row("ev2_aapl_grp", "Apple grouped headline", 2, 2)]));
      }
      if (url.includes("/MSFT")) {
        return response(snapshot("MSFT", [row("ev2_msft_grp", "Microsoft grouped headline", 2, 2)]));
      }
      throw new Error("unexpected " + url);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="AAPL" lang="en" />);
    });
    const aaplButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("2 reports"));
    await act(async () => {
      aaplButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await aaplDeferred.jsonEntered;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="MSFT" lang="en" />);
    });
    expect(host.textContent).toContain("Microsoft grouped headline");

    const msftCallsBefore = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/stories/ev2_msft_grp")).length;
    const msftButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("2 reports"));
    await act(async () => {
      msftButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const msftStoryCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/stories/ev2_msft_grp"));
    expect(msftStoryCalls.length).toBe(msftCallsBefore + 1);
    await Promise.race([
      msftDeferred.jsonEntered,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
    expect(msftButton?.disabled).toBe(true);
  });

  it("ignores a stale prior-symbol json completion while the current symbol detail is pending", async () => {
    const aaplDeferred = deferredStoryJson({
      schema: "ticker_news.story.v1",
      story_id: "ev2_aapl_grp",
      source_count: 1,
      item_count: 2,
      members: [row("ev2_aapl_grp", "Apple grouped detail", 2, 2)],
    });
    const msftDeferred = deferredStoryJson({
      schema: "ticker_news.story.v1",
      story_id: "ev2_msft_grp",
      source_count: 1,
      item_count: 2,
      members: [row("ev2_msft_grp", "Microsoft grouped detail", 2, 2)],
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/ev2_aapl_grp")) return aaplDeferred.response;
      if (url.includes("/stories/ev2_msft_grp")) return msftDeferred.response;
      if (url.includes("/AAPL")) {
        return response(snapshot("AAPL", [row("ev2_aapl_grp", "Apple grouped headline", 2, 2)]));
      }
      if (url.includes("/MSFT")) {
        return response(snapshot("MSFT", [row("ev2_msft_grp", "Microsoft grouped headline", 2, 2)]));
      }
      throw new Error("unexpected " + url);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="AAPL" lang="en" />);
    });
    const aaplButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("2 reports"));
    await act(async () => {
      aaplButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await aaplDeferred.jsonEntered;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="MSFT" lang="en" />);
    });
    const msftButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("2 reports"));
    await act(async () => {
      msftButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await Promise.race([
      msftDeferred.jsonEntered,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);

    const callsBeforeAaplSettles = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/stories/")).length;
    await act(async () => {
      aaplDeferred.releaseJson({
        schema: "ticker_news.story.v1",
        story_id: "ev2_aapl_grp",
        source_count: 1,
        item_count: 2,
        members: [row("ev2_aapl_grp", "Apple grouped detail", 2, 2)],
      });
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("Apple grouped detail");
    expect(msftButton?.disabled).toBe(true);
    await act(async () => {
      msftButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const callsAfterSecondClick = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/stories/")).length;
    expect(callsAfterSecondClick).toBe(callsBeforeAaplSettles);
  });

  it("aborts an in-flight detail json on unmount without poisoning a remounted panel", async () => {
    let capturedSignal: AbortSignal | undefined;
    const pending = deferredStoryJson({
      schema: "ticker_news.story.v1",
      story_id: "ev2_nvda_grp",
      source_count: 1,
      item_count: 2,
      members: [row("ev2_nvda_grp", "Nvidia grouped detail", 2, 2)],
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/stories/")) {
        capturedSignal = init?.signal as AbortSignal | undefined;
        return pending.response;
      }
      return response(snapshot("NVDA", [row("ev2_nvda_grp", "Nvidia grouped headline", 2, 2)]));
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("2 reports"));
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await pending.jsonEntered;
    expect(capturedSignal).toBeDefined();

    await act(async () => {
      root.unmount();
    });
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      pending.releaseJson({
        schema: "ticker_news.story.v1",
        story_id: "ev2_nvda_grp",
        source_count: 1,
        item_count: 2,
        members: [row("ev2_nvda_grp", "Nvidia grouped detail", 2, 2)],
      });
      await Promise.resolve();
    });

    root = createRoot(host);
    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });
    const freshButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("2 reports"));
    expect(freshButton?.disabled).toBe(false);
    expect(host.textContent).not.toContain("Nvidia grouped detail");
  });

  it.each([404, 503])("shows unavailable for snapshot %i without retrying", async (status) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => response({ detail: "upstream missing" }, status));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    const panel = host.querySelector("[data-testid=ticker-news-panel]");
    expect(panel?.getAttribute("data-news-state")).toBe("unavailable");
    expect(host.querySelector("[role=status]")?.textContent).toContain("News is temporarily unavailable");
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/news/NVDA"))).toHaveLength(1);
    vi.useRealTimers();
  });

  it.each([401, 403])("shows restricted for snapshot %i", async (status) => {
    globalThis.fetch = vi.fn(() => response({ detail: "forbidden" }, status)) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });

    const panel = host.querySelector("[data-testid=ticker-news-panel]");
    expect(panel?.getAttribute("data-news-state")).toBe("restricted");
    expect(host.querySelector("[role=status]")?.textContent).toContain("News access is unavailable");
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("does not open a new stream or snapshot fetch after a terminal EventSource error", async () => {
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [row("ev2_a", "Headline")]))) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    const initialFetches = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    const stream = FakeEventSource.instances[0];
    stream.readyState = FakeEventSource.CLOSED;
    await act(async () => {
      stream.onerror?.(new Event("error"));
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Live updates interrupted");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialFetches);
  });
});