// @vitest-environment jsdom
// Journey 6 (E5) — the "updated since you saved" annotation: the original basis stays visible,
// the current revision is one action away through the existing ladder toggle, an out-of-order
// older copy renders nothing, and the surface keeps complete focus outlines with no left accent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NEWS_VIEW } from "./fixtures/newsEditorial";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TickerNewsPanel from "@/components/news/TickerNewsPanel";
import { NEWS_REVIEW_KEY } from "@/lib/newsReviewState";
import type { TickerNewsRightsBasis, TickerNewsStoryRow } from "@/lib/newsTypes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RIGHTS_1: TickerNewsRightsBasis = {
  receipt_id: "rr_panel_0001",
  source: "benzinga",
  provider: "fixture-provider",
  effective_at: "2026-10-01T00:00:00Z",
  expires_at: "2027-10-01T00:00:00Z",
};
const RIGHTS_2: TickerNewsRightsBasis = { ...RIGHTS_1, receipt_id: "rr_panel_0002" };

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
  universe_revision: "sp500-r1", editorial_view: NEWS_VIEW,
  ...extra,
});

const snapshot = (ticker: string, rows: TickerNewsStoryRow[], rights: TickerNewsRightsBasis) => ({
  schema: "ticker_news.snapshot.v1", editorial_view: NEWS_VIEW,
  ticker,
  security_id: "SEC:" + ticker,
  rights_basis: rights,
  state: "live",
  rows,
  next_cursor: rows[rows.length - 1]?.sequence ?? null,
  has_more: false,
  source_health: { state: "live", last_successful_catchup: "2026-10-05T14:01:01+00:00" },
});

/** `ticker_news.story.v1` — what `/api/news/stories/<id>` returns for the ladder detail. */
const storyDetail = (members: TickerNewsStoryRow[]) => ({
  schema: "ticker_news.story.v1",
  story_id: members[0].story_id,
  source_count: new Set(members.map((member) => member.source)).size,
  item_count: members.length,
  members,
  editorial_view: NEWS_VIEW,
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
  story_id: "ev2_s",
  title: "t",
  url: "https://www.benzinga.com/news/x",
  teaser: "",
  security_ids: ["SEC:NVDA"],
  universe_revision: "sp500-r1", editorial_view: NEWS_VIEW,
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

/** fetch dispatches by URL: snapshot loads from `news`, ladder details from `story`. */
function feed(initialNews: () => Promise<Response>) {
  const serve = { news: initialNews, story: (() => response({ detail: "no story" }, 404)) as (url: string) => Promise<Response> };
  const fn = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return url.includes("/api/news/stories/") ? serve.story(url) : serve.news();
  });
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return { serve, fn };
}

const stored = () => localStorage.getItem(NEWS_REVIEW_KEY);
const storedBasis = (id: string) =>
  JSON.parse(stored()!)["account:user-a"].NVDA.basis?.[id] ?? null;
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

const FIRST = [row("ev2_s", "Launch", 5, 3), row("ev2_o", "Supply", 4)];
const CORRECTED = [row("ev2_s", "Launch (corrected)", 9, 2), row("ev2_o", "Supply", 4)];

describe("AC-J6 — a corrected save keeps the original evidence basis visible", () => {
  it("EN: captures the basis on mark, annotates the drift with the original values, opens the current ladder through the existing toggle", async () => {
    const { serve, fn } = feed(() => response(snapshot("NVDA", FIRST, RIGHTS_1)));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    await click(markOne("ev2_s"));

    expect(storedBasis("ev2_s")).toEqual({
      report_key: "benzinga:ev2_s-item",
      sequence: 5,
      item_count: 3,
      view_revision: NEWS_VIEW.revision,
      rights: RIGHTS_1,
      at: "2026-10-05T14:01:01+00:00",
    });
    // While the presentation still matches the saved basis there is nothing to say.
    expect(host.querySelector("[data-news-saved-basis]")).toBeNull();

    serve.news = () => response(snapshot("NVDA", CORRECTED, RIGHTS_2));
    await pushChange();

    const note = host.querySelector("[data-news-saved-basis]");
    expect(note).toBeTruthy();
    expect(note!.textContent).toContain("Updated since you saved");
    // The ORIGINAL basis values, not the current ones.
    expect(note!.textContent).toContain("revision 5");
    expect(note!.textContent).toContain("3 reports");
    expect(note!.textContent).not.toContain("revision 9");
    const button = note!.querySelector<HTMLButtonElement>("[data-news-open-current]");
    expect(button?.textContent).toBe("Open current");
    expect(button?.type).toBe("button");
    // No inline outline suppression anywhere on the control.
    expect(button?.getAttribute("style")).toBeNull();
    expect(button?.style.outline).toBe("");

    serve.story = () => response(storyDetail([
      row("ev2_s", "Launch (corrected)", 9, 1),
      row("ev2_s", "Mirror report", 8, 1, { source: "reuters", source_item_id: "ev2_s-mirror" }),
    ]));
    await click(button);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    // The existing ladder toggle fetched and rendered the current revision's members.
    expect(fn.mock.calls.some((call) => String(call[0]).includes("/api/news/stories/ev2_s"))).toBe(true);
    const ladder = host.querySelector<HTMLButtonElement>('article[data-story-id="ev2_s"] [data-news-ladder]');
    expect(ladder?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('article[data-story-id="ev2_s"] [role="group"][aria-label="2 reports"]')).toBeTruthy();
    // Opening the current revision wrote nothing: the first capture stands.
    expect(storedBasis("ev2_s")).toEqual({
      report_key: "benzinga:ev2_s-item",
      sequence: 5,
      item_count: 3,
      view_revision: NEWS_VIEW.revision,
      rights: RIGHTS_1,
      at: "2026-10-05T14:01:01+00:00",
    });
  });

  it("ZH: the annotation and the open-current control render with the lex strings", async () => {
    const { serve } = feed(() => response(snapshot("NVDA", FIRST, RIGHTS_1)));
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" userId="user-a" />);
    await click(markOne("ev2_s"));

    serve.news = () => response(snapshot("NVDA", CORRECTED, RIGHTS_2));
    await pushChange();

    const note = host.querySelector("[data-news-saved-basis]");
    expect(note?.textContent).toContain("保存后已有更新");
    expect(note?.textContent).toContain("修订 5");
    expect(note?.textContent).toContain("3 条报道");
    expect(note!.querySelector<HTMLButtonElement>("[data-news-open-current]")?.textContent).toBe("查看当前");
  });

  it("an out-of-order older presentation renders no annotation and leaves the basis untouched", async () => {
    const { serve } = feed(() => response(snapshot("NVDA", FIRST, RIGHTS_1)));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    await click(markOne("ev2_s"));
    const captured = storedBasis("ev2_s");

    serve.news = () => response(snapshot("NVDA", [row("ev2_s", "Launch", 3, 3), row("ev2_o", "Supply", 4)], RIGHTS_1));
    await pushChange();

    expect(host.querySelector("[data-news-saved-basis]")).toBeNull();
    expect(storedBasis("ev2_s")).toEqual(captured);
  });

  it("the annotation surface declares no left border and no outline suppression", () => {
    const css = readFileSync(join(process.cwd(), "components/news/NewsCatchup.module.css"), "utf8");
    expect(css).not.toContain("border-left");
    expect(css).not.toContain("outline:none");
    expect(css).not.toContain("outline: none");
    // A complete focus outline for the open-current control rides the module's existing rule.
    expect(css).toContain(".openCurrent:focus-visible");
  });
});
