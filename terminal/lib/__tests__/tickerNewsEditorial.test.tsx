// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TickerNewsPanel from "@/components/news/TickerNewsPanel";
import { parseTickerNewsSnapshot, parseTickerNewsStory, tickerNewsViewQuery } from "@/lib/newsContract";
import type { TickerNewsEditorialView, TickerNewsStoryRow, TickerNewsViewMode } from "@/lib/newsTypes";
import { NEWS_REVIEW_KEY } from "@/lib/newsReviewState";
import { editorialView } from "./fixtures/newsEditorial";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function row(view = editorialView(), title = "Nvidia announces a new manufacturing site"): TickerNewsStoryRow {
  return {
    sequence: 3, source: "benzinga", source_item_id: "1", story_id: "ev2_company",
    source_count: 1, item_count: 1, title, url: "https://www.benzinga.com/news/1",
    teaser: "", published_at: "2026-10-21T12:00:00Z", updated_at: null,
    received_at: "2026-10-21T12:00:01Z", universe_revision: "u1",
    editorial_view: view,
    editorial: { schema: "ticker_news.editorial_view.v1", format: "unclassified",
      format_reason: null, company_reference: "headline", eligible: true },
  };
}

function snapshot(view = editorialView(), rows = [row(view)]) {
  return {
    schema: "ticker_news.snapshot.v1", editorial_policy: "ticker_news.curated.v1",
    editorial_view: view, change_sequence: 29, ticker: "NVDA", security_id: "SEC:NVDA",
    state: rows.length ? "live" : "quiet", rows, next_cursor: null, has_more: false,
    source_health: { state: "live" },
  };
}

function detail(view = editorialView(), title = "Earlier report") {
  return {
    schema: "ticker_news.story.v1", editorial_view: view, story_id: "ev2_company",
    source_count: 1, item_count: 2,
    members: [row(view), { ...row(view, title), sequence: 2, source_item_id: "2" }],
  };
}

function change(view = editorialView()) {
  return { ...row(view), sequence: 30, kind: "upsert", security_ids: ["SEC:NVDA"],
    observed_at: "2026-10-21T12:01:00Z" };
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

class Events extends EventTarget {
  static instances: Events[] = [];
  closed = false;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  constructor(readonly url: string) { super(); Events.instances.push(this); }
  close() { this.closed = true; }
  emit(name: string, payload: unknown) {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(payload) }));
  }
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // Node also exposes localStorage; use the actual jsdom browser store.
  const browserWindow = (globalThis as unknown as { jsdom: { window: Window & typeof globalThis } }).jsdom.window;
  Object.defineProperty(window, "localStorage", { value: browserWindow.localStorage, configurable: true, writable: true });
  localStorage.clear();
  Events.instances = [];
  vi.stubGlobal("EventSource", Events);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(lang: "en" | "zh" = "en") {
  await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang={lang} userId="reader" />));
}

async function select(mode: TickerNewsViewMode) {
  const control = host.querySelector<HTMLSelectElement>("select[data-news-view-select]")!;
  await act(async () => {
    control.value = mode;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function panel() { return host.querySelector<HTMLElement>("[data-testid=ticker-news-panel]")!; }

describe("editorial view contract", () => {
  it.each(["news", "company", "all"] as const)("acknowledges %s and the full change watermark", (mode) => {
    const parsed = parseTickerNewsSnapshot(snapshot(editorialView(mode)));
    expect(parsed.editorial_view?.mode).toBe(mode);
    expect(parsed.change_sequence).toBe(29);
    expect(parsed.rows[0].editorial?.company_reference).toBe("headline");
  });

  it("rejects mixed contexts in snapshots and expanded story members", () => {
    const mixed = { ...snapshot(), rows: [row(editorialView("company"))] };
    expect(() => parseTickerNewsSnapshot(mixed)).toThrow("editorial_view_mismatch");
    expect(() => parseTickerNewsStory({ ...detail(), members: [row(), row(editorialView("all"))] }))
      .toThrow("editorial_view_mismatch");
  });

  it.each(["quality", "", "all&view=company"])("does not forward an ambiguous or unsupported view: %s", (mode) => {
    expect(() => tickerNewsViewQuery(new URLSearchParams("view=" + mode))).toThrow();
  });

  it("forwards only a closed view and valid revision", () => {
    const query = tickerNewsViewQuery(new URLSearchParams("view=company&view_revision=" + "b".repeat(64) + "&source=fool"));
    expect([...query.keys()]).toEqual(["view", "view_revision"]);
    expect(() => tickerNewsViewQuery(new URLSearchParams("view_revision=" + "a".repeat(64)))).toThrow();
  });
});

describe("editorial views in the mounted Terminal", () => {
  it("requests News by default and resumes after hidden as well as visible changes", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(snapshot()));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(String(fetcher.mock.calls[0][0])).toContain("view=news");
    expect(panel().dataset.newsView).toBe("news");
    expect(Events.instances[0].url).toContain("after_sequence=29");
    expect(Events.instances[0].url).toContain("view_revision=" + "a".repeat(64));
    expect(host.textContent).toContain("Identified roundups");
  });

  it.each([undefined, editorialView("all")])("fails closed without the requested server acknowledgement", async (ack) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...snapshot(), editorial_view: ack })));
    await mount();
    expect(panel().dataset.newsState).toBe("unavailable");
    expect(host.querySelector("[data-news-headline]")).toBeNull();
    expect(Events.instances).toHaveLength(0);
  });

  it("hides the old view during a switch and rejects an old in-flight refresh", async () => {
    const late = deferred();
    const company = deferred();
    let newsReads = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://fixture.test");
      if (url.searchParams.get("view") === "company") return company.promise;
      newsReads += 1;
      return newsReads === 1 ? Promise.resolve(Response.json(snapshot())) : late.promise;
    }));
    await mount();
    const oldStream = Events.instances[0];
    await act(async () => oldStream.emit("upsert", change()));
    await select("company");
    expect(oldStream.closed).toBe(true);
    expect(host.querySelector("[data-news-headline]")).toBeNull();
    expect(panel().dataset.newsState).toBe("loading");
    await act(async () => company.resolve(Response.json(snapshot(editorialView("company"), [row(editorialView("company"), "Nvidia current company view")]))));
    await act(async () => late.resolve(Response.json(snapshot(editorialView(), [row(editorialView(), "Stale broader result")]))));
    expect(host.textContent).toContain("Nvidia current company view");
    expect(host.textContent).not.toContain("Stale broader result");
    expect(panel().dataset.newsView).toBe("company");
  });

  it("closes and resnapshots on reset, fencing old requests and stream callbacks", async () => {
    const late = deferred();
    const next = editorialView("news", "d".repeat(64));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(snapshot()))
      .mockImplementationOnce(() => late.promise)
      .mockResolvedValueOnce(Response.json(snapshot(next, [row(next, "Nvidia current context")])));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    const old = Events.instances[0];
    await act(async () => old.emit("upsert", change()));
    await act(async () => old.emit("reset", {
      schema: "ticker_news.reset.v1", ticker: "NVDA", editorial_view: next,
    }));
    expect(old.closed).toBe(true);
    expect(Events.instances).toHaveLength(2);
    expect(Events.instances[1].url).toContain(next.revision);
    await act(async () => late.resolve(Response.json(snapshot())));
    await act(async () => old.emit("upsert", change()));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("Nvidia current context");
  });

  it("invalidates old story details when the same group is opened in another view", async () => {
    const held = deferred();
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://fixture.test");
      const view = editorialView(url.searchParams.get("view") as TickerNewsViewMode);
      if (url.pathname.includes("/stories/")) {
        return view.mode === "news" ? held.promise : Promise.resolve(Response.json(detail(view, "Current company member")));
      }
      return Promise.resolve(Response.json(snapshot(view, [{ ...row(view), item_count: 2 }])));
    });
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    await select("company");
    await act(async () => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    await act(async () => held.resolve(Response.json(detail(editorialView(), "Old news member"))));
    expect(host.textContent).toContain("Current company member");
    expect(host.textContent).not.toContain("Old news member");
    const paths = fetcher.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/stories/"));
    expect(paths.every((url) => url.includes("ticker=NVDA") && url.includes("view_revision="))).toBe(true);
  });

  it("keeps review marks across views and offers broader coverage from an empty mention view", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const mode = new URL(String(input), "https://fixture.test").searchParams.get("view") as TickerNewsViewMode;
      const view: TickerNewsEditorialView = { ...editorialView(mode), name_coverage: mode === "company" ? "symbols_only" : "names_and_symbols" };
      return Promise.resolve(Response.json(snapshot(view, mode === "company" ? [] : [row(view)])));
    }));
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-news-mark-one]")!.click());
    const marks = localStorage.getItem(NEWS_REVIEW_KEY);
    expect(marks).toBeTruthy();
    await select("company");
    expect(host.textContent).toContain("Company-name coverage is limited");
    expect(host.textContent).toContain("No matching company mentions");
    expect(host.querySelector("select[data-news-view-select]")).not.toBeNull();
    await select("all");
    expect(host.querySelector("article")?.getAttribute("data-news-review")).toBe("reviewed");
    expect(localStorage.getItem(NEWS_REVIEW_KEY)).toBe(marks);
  });

  it("renders bilingual view copy without mixing interface languages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(snapshot())));
    await mount("zh");
    expect(host.textContent).toContain("新闻与公告");
    expect(host.textContent).toContain("公司提及");
    expect(host.textContent).not.toContain("News & announcements");
    expect(host.textContent).not.toContain("Identified roundups");
  });
});

it.each(["view", "ticker"] as const)("requires a fresh acknowledgement when returning to the same %s", async (transition) => {
  const alternate = deferred();
  const returning = deferred();
  const unavailableFlow = {
    schema: "ticker_news.flow.v1", state: "unavailable", reason: "calculation_failed",
    coverage: "complete", as_of: null, reports_24h: null, reports_7d: null,
    stories_24h: null, median_daily_28d: null, daily_counts_28d: null,
    history_days_observed: null, comparison: null, provenance: null,
  };
  const first = { ...snapshot(), flow: unavailableFlow };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json(first))
    .mockImplementationOnce(() => alternate.promise)
    .mockImplementationOnce(() => returning.promise);
  vi.stubGlobal("fetch", fetcher);
  await mount();
  expect(host.querySelector("[data-news-headline]")).not.toBeNull();
  expect(host.querySelector('[data-flow-state]')).not.toBeNull();
  const oldStream = Events.instances[0];
  if (transition === "view") {
    await select("company");
    await select("news");
  } else {
    await act(async () => root.render(<TickerNewsPanel symbol="MSFT" lang="en" userId="reader" />));
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" userId="reader" />));
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(oldStream.closed).toBe(true);
  expect(panel().dataset.newsState).toBe("loading");
  expect(host.querySelector("[data-news-headline]")).toBeNull();
  expect(host.querySelector('[data-flow-state]')).toBeNull();
  const next = editorialView("news", "d".repeat(64));
  await act(async () => returning.resolve(Response.json(snapshot(next, [row(next, "Fresh returning view")]))));
  await act(async () => alternate.resolve(Response.json(snapshot(editorialView("company")))));
  expect(host.textContent).toContain("Fresh returning view");
  expect(panel().dataset.newsState).toBe("live");
  expect(Events.instances.at(-1)?.url).toContain(next.revision);
});
