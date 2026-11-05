// @vitest-environment jsdom
import { NEWS_VIEW } from "./fixtures/newsEditorial";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TickerNewsPanel from "@/components/news/TickerNewsPanel";
import panelStyles from "@/components/news/TickerNewsPanel.module.css";
import type {
  TickerNewsContentKind,
  TickerNewsReportingState,
  TickerNewsState,
  TickerNewsStoryRow,
} from "@/lib/newsTypes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// R2 lane split: lib/newsValidation.ts gains the publisher/annotation fields in lane
// L1's validation delta (spec §1). Until that lands, pass the two ADDITIVE fields
// through after the real parser runs, so this file pins the panel contract in any
// merge order. Only the two optional fields are added, exactly as §1 defines them
// for valid input; every other guarantee — unknown-key stripping included — stays
// the real parser's.
vi.mock("@/lib/newsValidation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/newsValidation")>();
  return {
    ...actual,
    parseStoryRow: (value: unknown) => {
      const parsed = actual.parseStoryRow(value);
      const raw = value as Record<string, unknown>;
      const annotation = raw.annotation as { event_type?: unknown } | null | undefined;
      return {
        ...parsed,
        publisher: typeof raw.publisher === "string" && raw.publisher.trim() !== ""
          ? raw.publisher.trim().toLowerCase()
          : undefined,
        annotation: annotation == null
          ? null
          : {
            event_type: typeof annotation.event_type === "string" && annotation.event_type !== ""
              ? annotation.event_type
              : null,
          },
      };
    },
  };
});

const row = (
  storyId: string,
  title: string,
  sequence = 1,
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
  updated_at: "2026-10-05T14:01:00+00:00",
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1", editorial_view: NEWS_VIEW,
  ...extra,
});

const snapshot = (ticker: string, rows: TickerNewsStoryRow[], state = "live") => ({
  schema: "ticker_news.snapshot.v1", editorial_view: NEWS_VIEW,
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

const SHARED_GROUP_STORY_ID = "ev2_shared_grp";

/** The readable label text of one ladder step (the glyph span is aria-hidden decoration). */
const stepLabel = (step: Element): string =>
  [...step.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();

/** Parser-valid grouped story with two members; same story_id, distinct member headlines per ticker fixture. */
function twoMemberStoryDetail(
  storyId: string,
  primaryMemberTitle: string,
  earlierMemberTitle: string,
) {
  return {
    schema: "ticker_news.story.v1", editorial_view: NEWS_VIEW,
    story_id: storyId,
    source_count: 1,
    item_count: 2,
    members: [
      row(storyId, primaryMemberTitle, 2, 2),
      { ...row(storyId, earlierMemberTitle, 1, 2), source_item_id: storyId + "-earlier" },
    ],
  };
}

/** Grouped story with three members; distinct member headlines and item ids. */
function threeMemberStoryDetail(storyId: string, primary: string, second: string, third: string) {
  return {
    schema: "ticker_news.story.v1", editorial_view: NEWS_VIEW,
    story_id: storyId,
    source_count: 3,
    item_count: 3,
    members: [
      row(storyId, primary, 3, 3),
      { ...row(storyId, second, 2, 3), source_item_id: storyId + "-second" },
      { ...row(storyId, third, 1, 3), source_item_id: storyId + "-third" },
    ],
  };
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
  it.each(["en", "zh"] as const)("labels curated publishers and press releases in %s, including expanded reports", async (lang) => {
    const consoleError = vi.spyOn(console, "error");
    const release = { ...row("ev2_release", "Company announces quarterly results", 2, 2),
      source: "massive:globenewswire.com", content_kind: "press_release" as const, source_count: 2 };
    const reporting = { ...row("ev2_release", "Company raises revenue outlook", 1, 2),
      source: "massive:reuters.com", source_item_id: release.source_item_id, content_kind: "reporting" as const, source_count: 2 };
    const other = { ...reporting, ...row("ev2_other", "Company completes acquisition", 3), source: "benzinga" };
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/stories/")) return response({
        schema: "ticker_news.story.v1", editorial_view: NEWS_VIEW, story_id: release.story_id,
        source_count: 2, item_count: 2, members: [release, reporting],
      });
      return response({ ...snapshot("NVDA", [release, other]), editorial_policy: "ticker_news.curated.v1" });
    }) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang={lang} userId="editorial-test" />));
    const releaseLabel = lang === "zh" ? "GlobeNewswire · 公司公告" : "GlobeNewswire · Press release";
    // R2 (spec §3.1): the meta row names the outlet without the "· Press release"
    // suffix — the suffixed label appears only on the expanded member row.
    expect(host.textContent).toContain("GlobeNewswire");
    expect(host.textContent).not.toContain(releaseLabel);
    expect(host.textContent).not.toContain("massive:");
    expect(host.querySelector('option[value=""]')?.textContent)
      .toBe(lang === "zh" ? "全部精选来源" : "All curated sources");
    expect(host.querySelector('[data-testid="ticker-news-panel"]')?.getAttribute("data-news-editorial-policy"))
      .toBe("ticker_news.curated.v1");
    const expand = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
    await act(async () => expand.click());
    expect(host.textContent).toContain("Reuters");
    expect(host.textContent?.split(releaseLabel)).toHaveLength(2);
    expect(consoleError.mock.calls.some((args) => args.some((value) => String(value).includes("same key")))).toBe(false);
  });

  it("fails closed when an older API cannot acknowledge the requested view", async () => {
    globalThis.fetch = vi.fn(() => response({ ...snapshot("NVDA", [row("ev2_old", "Company reports results")]), editorial_view: undefined })) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" />));
    expect(host.textContent).not.toContain("Curated reporting");
    expect(host.querySelector('[data-testid="ticker-news-panel"]')?.hasAttribute("data-news-editorial-policy")).toBe(false);
  });

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
          schema: "ticker_news.story.v1", editorial_view: NEWS_VIEW,
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

  it("keeps unchanged expanded coverage but drops rejected members when its group revision changes", async () => {
    let currentSequence = 2;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/stories/")) {
        return response(twoMemberStoryDetail("ev2_group", "Qualified report", "Rejected member wording"));
      }
      return response({ ...snapshot("NVDA", [row("ev2_group", "Qualified report", currentSequence, currentSequence === 2 ? 2 : 1)]),
        editorial_policy: "ticker_news.curated.v1" });
    }) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click());
    expect(host.textContent).toContain("Rejected member wording");
    const refresh = (sequence: number) => FakeEventSource.instances[0].emit("upsert", {
      ...row("ev2_group", "Qualified report", sequence), kind: "upsert",
      security_ids: ["SEC:NVDA"], observed_at: "2026-10-05T14:02:00+00:00",
    });
    await act(async () => { refresh(3); await Promise.resolve(); });
    expect(host.textContent).toContain("Rejected member wording");
    currentSequence = 4;
    await act(async () => { refresh(4); await Promise.resolve(); });
    expect(host.textContent).toContain("Qualified report");
    expect(host.textContent).not.toContain("Rejected member wording");
    expect(host.querySelector('button[aria-expanded="true"]')).toBeNull();
  });

  it.each(["sequence", "policy"] as const)("ignores an outstanding detail after its %s changes and allows a fresh expansion", async (change) => {
    const staleBody = twoMemberStoryDetail("ev2_group", "Qualified report", "Rejected stale member");
    const late = deferredStoryJson(staleBody);
    let refreshed = false;
    let detailCalls = 0;
    const pending: { signal: AbortSignal | null } = { signal: null };
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/stories/")) {
        detailCalls += 1;
        if (detailCalls === 1) { pending.signal = init?.signal ?? null; return late.response; }
        return response(twoMemberStoryDetail("ev2_group", "Qualified report", "Current qualified member"));
      }
      return response({ ...snapshot("NVDA", [row("ev2_group", "Qualified report", refreshed && change === "sequence" ? 3 : 2, 2)]),
        ...(refreshed || change === "sequence" ? { editorial_policy: "ticker_news.curated.v1" } : {}) });
    }) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click());
    await late.jsonEntered;
    refreshed = true;
    await act(async () => {
      FakeEventSource.instances[0].emit("upsert", {
        ...row("ev2_group", "Qualified report", 3), kind: "upsert",
        security_ids: ["SEC:NVDA"], observed_at: "2026-10-05T14:02:00+00:00",
      });
      await Promise.resolve();
    });
    expect(pending.signal?.aborted).toBe(true);
    const freshButton = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
    expect(freshButton.disabled).toBe(false);
    await act(async () => freshButton.click());
    expect(detailCalls).toBe(2);
    expect(host.textContent).toContain("Current qualified member");
    await act(async () => { late.releaseJson(staleBody); await Promise.resolve(); });
    expect(host.textContent).not.toContain("Rejected stale member");
    expect(host.textContent).toContain("Current qualified member");
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
        universe_revision: "sp500-r1", editorial_view: NEWS_VIEW,
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
      schema: "ticker_news.story.v1", editorial_view: NEWS_VIEW,
      story_id: "ev2_aapl_grp",
      source_count: 1,
      item_count: 2,
      members: [row("ev2_aapl_grp", "Apple grouped", 2, 2)],
    });
    const msftDeferred = deferredStoryJson({
      schema: "ticker_news.story.v1", editorial_view: NEWS_VIEW,
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
    const aaplDeferred = deferredStoryJson(
      twoMemberStoryDetail(SHARED_GROUP_STORY_ID, "Apple member primary", "Apple member earlier"),
    );
    const msftDeferred = deferredStoryJson(
      twoMemberStoryDetail(SHARED_GROUP_STORY_ID, "Microsoft member primary", "Microsoft member earlier"),
    );
    let sharedStoryDetailFetch = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/stories/${SHARED_GROUP_STORY_ID}`)) {
        sharedStoryDetailFetch += 1;
        return sharedStoryDetailFetch === 1 ? aaplDeferred.response : msftDeferred.response;
      }
      if (url.includes("/AAPL")) {
        return response(snapshot("AAPL", [row(SHARED_GROUP_STORY_ID, "Apple grouped headline", 2, 2)]));
      }
      if (url.includes("/MSFT")) {
        return response(snapshot("MSFT", [row(SHARED_GROUP_STORY_ID, "Microsoft grouped headline", 2, 2)]));
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
    await msftDeferred.jsonEntered;

    const callsBeforeAaplSettles = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/stories/")).length;
    await act(async () => {
      aaplDeferred.releaseJson(
        twoMemberStoryDetail(SHARED_GROUP_STORY_ID, "Apple member primary", "Apple member earlier"),
      );
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("Apple member primary");
    expect(host.textContent).not.toContain("Apple member earlier");
    expect(msftButton?.disabled).toBe(true);
    await act(async () => {
      msftButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const callsAfterSecondClick = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/stories/")).length;
    expect(callsAfterSecondClick).toBe(callsBeforeAaplSettles);

    await act(async () => {
      msftDeferred.releaseJson(
        twoMemberStoryDetail(SHARED_GROUP_STORY_ID, "Microsoft member primary", "Microsoft member earlier"),
      );
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Microsoft member primary");
    expect(host.textContent).toContain("Microsoft member earlier");
  });

  it("aborts an in-flight detail json on unmount without poisoning a remounted panel", async () => {
    const remountStoryId = "ev2_nvda_grp";
    let firstSignal: AbortSignal | undefined;
    const oldMountPending = deferredStoryJson(
      twoMemberStoryDetail(remountStoryId, "Old mount member primary", "Old mount member earlier"),
    );
    const newMountPending = deferredStoryJson(
      twoMemberStoryDetail(remountStoryId, "New mount member primary", "New mount member earlier"),
    );
    let storyFetchCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/stories/")) {
        storyFetchCount += 1;
        if (storyFetchCount === 1) {
          firstSignal = init?.signal as AbortSignal | undefined;
          return oldMountPending.response;
        }
        return newMountPending.response;
      }
      return response(snapshot("NVDA", [row(remountStoryId, "Nvidia grouped headline", 2, 2)]));
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("2 reports"));
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await oldMountPending.jsonEntered;
    expect(firstSignal).toBeDefined();

    await act(async () => {
      root.unmount();
    });
    expect(firstSignal?.aborted).toBe(true);

    root = createRoot(host);
    await act(async () => {
      root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
    });
    const freshButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("2 reports"));
    await act(async () => {
      freshButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await newMountPending.jsonEntered;

    await act(async () => {
      oldMountPending.releaseJson(
        twoMemberStoryDetail(remountStoryId, "Old mount member primary", "Old mount member earlier"),
      );
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("Old mount member primary");
    expect(host.textContent).not.toContain("Old mount member earlier");

    await act(async () => {
      newMountPending.releaseJson(
        twoMemberStoryDetail(remountStoryId, "New mount member primary", "New mount member earlier"),
      );
      await Promise.resolve();
    });
    expect(host.textContent).toContain("New mount member primary");
    expect(host.textContent).toContain("New mount member earlier");
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
    const snapshotCalls = (fetchMock.mock.calls as unknown[][]).filter((c) => String(c[0]).includes("/api/news/NVDA"));
    expect(snapshotCalls).toHaveLength(1);
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
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Retry")).toBe(false);
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

describe("R2 evidence ladder", () => {
  it("renders the evidence ladder button with steps and separators for a 3-report row", async () => {
    const grouped = { ...row("ev2_ladder3", "Nvidia ramps output", 2, 3), source_count: 3, reporting_state: "no_material_difference" as const };
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [grouped]))) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" />));

    const ladder = host.querySelector<HTMLButtonElement>("[data-news-ladder]")!;
    expect(ladder.tagName).toBe("BUTTON");
    expect(ladder.getAttribute("type")).toBe("button");
    expect(ladder.getAttribute("aria-expanded")).toBe("false");
    expect(ladder.getAttribute("aria-label")).toBe("Show the reports behind this story");
    expect([...ladder.querySelectorAll("[data-step]")].map((el) => el.getAttribute("data-step")))
      .toEqual(["kind", "outlets", "reports", "agreement"]);
    expect(ladder.querySelectorAll(`.${panelStyles.sep}`)).toHaveLength(3);
    expect([...ladder.querySelectorAll(`.${panelStyles.sep}`)].map((el) => el.textContent)).toEqual(["›", "›", "›"]);
    expect([...ladder.querySelectorAll("[data-step]")].map(stepLabel))
      .toEqual(["Reporting", "3 outlets", "3 reports", "Reports agree"]);
  });

  it("renders a static ladder chain, no button and no NEXT CHECK for a 1-report row", async () => {
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [row("ev2_single", "Solo headline", 1, 1)]))) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" />));

    const staticLadder = host.querySelector("[data-news-ladder='static']");
    expect(staticLadder?.tagName).toBe("SPAN");
    expect(host.querySelector("button[data-news-ladder]")).toBeNull();
    expect(host.querySelector("[data-next-check]")).toBeNull();
    expect(host.querySelector("[data-agreement]")).toBeNull();
    expect([...(staticLadder?.querySelectorAll("[data-step]") ?? [])].map(stepLabel))
      .toEqual(["Reporting", "1 outlet", "1 report"]);
    expect(staticLadder?.querySelectorAll(`.${panelStyles.sep}`)).toHaveLength(2);
  });

  it.each([
    ["no_material_difference", "=", "Reports agree"],
    ["reports_differ", "≠", "Reports differ"],
    ["comparison_limited", "~", "Comparison limited"],
    ["not_compared", "–", "Not compared"],
  ] as const)("shows the %s agreement glyph and label", async (reportingState, glyph, label) => {
    const grouped = { ...row("ev2_agree", "Story headline", 2, 3), source_count: 3, reporting_state: reportingState };
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [grouped]))) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" />));

    const glyphEl = host.querySelector("[data-agreement]")!;
    expect(glyphEl.getAttribute("data-agreement")).toBe(reportingState);
    expect(glyphEl.getAttribute("aria-hidden")).toBe("true");
    expect(glyphEl.textContent).toBe(glyph);
    expect(glyphEl.parentElement?.textContent).toContain(label);
  });

  const nextCheckTable: ReadonlyArray<{
    reporting: TickerNewsReportingState | undefined;
    snapshotState: TickerNewsState;
    key: "next.differ" | "next.limited" | "next.announcement" | "next.catchup" | null;
    line: string | null;
    kind?: TickerNewsContentKind;
  }> = [
    { reporting: "reports_differ", snapshotState: "live", key: "next.differ", line: "Compare outlets before relying on one report" },
    { reporting: "comparison_limited", snapshotState: "live", key: "next.limited", line: "Some sources can't be compared" },
    { reporting: undefined, snapshotState: "live", key: "next.announcement", line: "Read the company announcement first", kind: "press_release" },
    { reporting: undefined, snapshotState: "catching_up", key: "next.catchup", line: "Recheck after catch-up" },
    { reporting: undefined, snapshotState: "degraded", key: "next.catchup", line: "Recheck after catch-up" },
    { reporting: undefined, snapshotState: "live", key: null, line: null },
  ];
  it.each(nextCheckTable)("NEXT CHECK rule: $reporting row in a $snapshotState snapshot → $key", async ({ reporting, snapshotState, key, line, kind }) => {
    const fixture = {
      ...row("ev2_next", "Story headline", 2, 3),
      source_count: 3,
      reporting_state: reporting,
      ...(kind ? { content_kind: kind } : {}),
    };
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [fixture], snapshotState))) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" />));

    const nextLine = host.querySelector("[data-next-check]");
    if (key === null) {
      expect(nextLine).toBeNull();
      return;
    }
    expect(nextLine?.getAttribute("data-next-check")).toBe(key);
    expect(nextLine?.textContent).toContain("Next check");
    expect(nextLine?.textContent).toContain(line!);
  });

  it("expands into the evidence view with clocks, group note, two members, show-more and DOM order", async () => {
    const grouped = { ...row("ev2_ladder3", "Primary wording", 3, 3), source_count: 3, reporting_state: "not_compared" as const };
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/stories/")) {
        return response(threeMemberStoryDetail("ev2_ladder3", "Primary wording", "Second wording", "Third wording"));
      }
      return response(snapshot("NVDA", [grouped], "catching_up"));
    }) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" userId="r2-order" />));

    const ladder = host.querySelector<HTMLButtonElement>("[data-news-ladder]")!;
    await act(async () => ladder.click());
    const evidence = host.querySelector<HTMLDivElement>("div[role='group'][aria-label='3 reports']")!;
    expect(ladder.getAttribute("aria-expanded")).toBe("true");
    const clocksText = evidence.querySelector(`.${panelStyles.clocks}`)!.textContent ?? "";
    expect(clocksText).toContain("Published");
    expect(clocksText).toContain("Updated");
    expect(clocksText).toContain("Received");
    expect(evidence.textContent).toContain("Grouped because these reports describe the same event.");
    expect(evidence.querySelectorAll(`a.${panelStyles.sourceLink}`)).toHaveLength(2);
    expect(host.textContent).not.toContain("Third wording");
    const more = evidence.querySelector<HTMLButtonElement>(`button.${panelStyles.moreReports}`)!;
    expect(more.textContent).toBe("Show 1 more report");
    await act(async () => more.click());
    expect(evidence.querySelectorAll(`a.${panelStyles.sourceLink}`)).toHaveLength(3);
    expect(host.textContent).toContain("Third wording");
    expect(host.querySelector("button.moreReports")).toBeNull();

    // DOM order: ladder → evidence view → NEXT CHECK → Mark reviewed.
    const article = host.querySelector("article[data-story-id='ev2_ladder3']")!;
    const evidenceEl = article.querySelector("div[role='group']")!;
    const nextCheckEl = article.querySelector("[data-next-check]")!;
    const markOne = article.querySelector("[data-news-mark-one]")!;
    expect(markOne).toBeTruthy();
    expect((ladder.compareDocumentPosition(evidenceEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect((evidenceEl.compareDocumentPosition(nextCheckEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect((nextCheckEl.compareDocumentPosition(markOne) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect(nextCheckEl.getAttribute("data-next-check")).toBe("next.catchup");
    expect(nextCheckEl.textContent).toContain("Next check");
    expect(nextCheckEl.textContent).toContain("Recheck after catch-up");

    // A null updated_at omits the Updated clock.
    await act(async () => root.unmount());
    root = createRoot(host);
    const nullUpdated = row("ev2_ladder3", "Primary wording", 3, 3, { source_count: 3, updated_at: null, reporting_state: "not_compared" });
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/stories/")) {
        return response(threeMemberStoryDetail("ev2_ladder3", "Primary wording", "Second wording", "Third wording"));
      }
      return response(snapshot("NVDA", [nullUpdated]));
    }) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" />));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-news-ladder]")!.click());
    const clocks2 = host.querySelector(`.${panelStyles.clocks}`)!.textContent ?? "";
    expect(clocks2).toContain("Published");
    expect(clocks2).not.toContain("Updated");
    expect(clocks2).toContain("Received");
  });

  it("shows the topic family only when the annotation carries an event type", async () => {
    const renderTopic = async (annotation: { event_type: string | null } | null) => {
      const annotated = { ...row("ev2_topic", "Company cuts outlook", 2, 1), annotation };
      globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [annotated]))) as unknown as typeof globalThis.fetch;
      await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" />));
    };
    await renderTopic({ event_type: "guidance_cut" });
    expect(host.querySelector(`.${panelStyles.topic}`)?.textContent).toBe("Guidance");

    await act(async () => root.unmount());
    root = createRoot(host);
    await renderTopic({ event_type: null });
    expect(host.querySelector(`.${panelStyles.topic}`)).toBeNull();
    expect(host.textContent).not.toContain("Guidance");
  });

  it("reads the ZH ladder and the fixed restricted and unavailable copy", async () => {
    const grouped = { ...row("ev2_ladder3", "Nvidia ramps output", 2, 3), source_count: 3, reporting_state: "no_material_difference" as const };
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [grouped]))) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="zh" />));
    const ladder = host.querySelector("[data-news-ladder]")!;
    expect([...ladder.querySelectorAll("[data-step]")].map(stepLabel))
      .toEqual(["媒体报道", "3 家媒体", "3 条报道", "报道一致"]);

    await act(async () => root.unmount());
    root = createRoot(host);
    globalThis.fetch = vi.fn(() => response({ detail: "forbidden" }, 401)) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="zh" />));
    expect(host.textContent).toContain("此账户或新闻源暂无新闻访问权限。");
    expect(host.textContent).not.toContain("此账户或新闻源当前不可用。");
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("重试");

    await act(async () => root.unmount());
    root = createRoot(host);
    globalThis.fetch = vi.fn(() => response({ detail: "upstream missing" }, 503)) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="zh" />));
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain("重试");
  });
});