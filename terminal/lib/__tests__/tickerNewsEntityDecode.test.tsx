// @vitest-environment jsdom
// Feed bodies arrive entity-encoded. The panel renders them through
// lib/newsDisplay.ts's decodeNewsText, so the reader sees "Nvidia & AMD" rather
// than "Nvidia &amp; AMD". The bytes that IDENTIFY the story — URL, story id,
// source ids, revision — are never decoded, because they are not display text.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TickerNewsPanel from "@/components/news/TickerNewsPanel";
import panelStyles from "@/components/news/TickerNewsPanel.module.css";
import { NEWS_VIEW } from "./fixtures/newsEditorial";
import type { TickerNewsStoryRow } from "@/lib/newsTypes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENCODED_TITLE = "Nvidia &amp; AMD rally &lt;5%&gt;";
const DECODED_TITLE = "Nvidia & AMD rally <5%>";
const ENCODED_TEASER = "OpenAI says &quot;no&quot; &amp; the market listens";
const DECODED_TEASER = 'OpenAI says "no" & the market listens';

const row = (storyId: string, title: string, extra: Partial<TickerNewsStoryRow> = {}): TickerNewsStoryRow => ({
  sequence: 2,
  source: "benzinga",
  source_item_id: storyId + "-item",
  story_id: storyId,
  source_count: 1,
  item_count: 1,
  title,
  // The query carries an entity on purpose: a URL is an address, not display
  // text, so the href must reach the DOM exactly as the feed sent it.
  url: "https://www.benzinga.com/news/" + storyId + "?src=a&amp=b",
  teaser: ENCODED_TEASER,
  published_at: "2026-10-05T14:00:00+00:00",
  updated_at: null,
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1",
  editorial_view: NEWS_VIEW,
  ...extra,
});

const snapshot = (ticker: string, rows: TickerNewsStoryRow[]) => ({
  schema: "ticker_news.snapshot.v1",
  editorial_view: NEWS_VIEW,
  ticker,
  security_id: "SEC:" + ticker,
  state: "live",
  rows,
  next_cursor: null,
  has_more: false,
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

  addEventListener(name: string, cb: (event: MessageEvent) => void) {
    const list = this.listeners.get(name) ?? [];
    list.push(cb);
    this.listeners.set(name, list);
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

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  realFetch = globalThis.fetch;
  realEventSource = globalThis.EventSource;
  FakeEventSource.instances = [];
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true, writable: true, value: FakeEventSource as unknown as typeof EventSource,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  globalThis.fetch = realFetch;
  Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: realEventSource });
  vi.restoreAllMocks();
});

describe("TickerNewsPanel — feed text is decoded for the reader", () => {
  it("renders the decoded headline and teaser, and leaves the row's URL untouched", async () => {
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [row("ev2_enc", ENCODED_TITLE)]))) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" userId="decode-test" />));

    const headline = host.querySelector("[data-news-headline]")!;
    expect(headline.textContent).toBe(DECODED_TITLE);
    expect(host.textContent).not.toContain("&amp;");
    expect(host.querySelector(`.${panelStyles.teaser}`)?.textContent).toBe(DECODED_TEASER);
    // The address is not display text: it keeps the bytes the feed sent.
    expect(headline.getAttribute("href")).toBe("https://www.benzinga.com/news/ev2_enc?src=a&amp=b");
  });

  it.each(["en", "zh"] as const)("gives the Mark reviewed control a decoded accessible name in %s", async (lang) => {
    globalThis.fetch = vi.fn(() => response(snapshot("NVDA", [row("ev2_enc", ENCODED_TITLE)]))) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang={lang} userId="decode-test" />));

    const mark = host.querySelector<HTMLButtonElement>("[data-news-mark-one]")!;
    expect(mark).toBeTruthy();
    const label = mark.getAttribute("aria-label") ?? "";
    expect(label).toContain(DECODED_TITLE);
    expect(label).not.toContain("&amp;");
  });

  it("renders an expanded member report with its decoded title", async () => {
    const member = row("ev2_enc_grp", ENCODED_TITLE, { item_count: 2, sequence: 2 });
    const earlier = { ...row("ev2_enc_grp", "Earlier report", { item_count: 2, sequence: 1 }), source_item_id: "ev2_enc_grp-earlier" };
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/stories/")) {
        return response({
          schema: "ticker_news.story.v1", editorial_view: NEWS_VIEW,
          story_id: "ev2_enc_grp", source_count: 1, item_count: 2,
          members: [member, earlier],
        });
      }
      return response(snapshot("NVDA", [row("ev2_enc_grp", ENCODED_TITLE, { item_count: 2, source_count: 1 })]));
    }) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<TickerNewsPanel symbol="NVDA" lang="en" userId="decode-test" />));

    const ladder = host.querySelector<HTMLButtonElement>("button[data-news-ladder]")!;
    expect(ladder).toBeTruthy();
    await act(async () => ladder.click());

    const evidence = host.querySelector(`.${panelStyles.evidence}`)!;
    expect(evidence).toBeTruthy();
    const memberTitles = [...evidence.querySelectorAll(`.${panelStyles.sourceLink}`)]
      .map((el) => el.textContent ?? "");
    expect(memberTitles.some((text) => text.includes(DECODED_TITLE))).toBe(true);
    expect(memberTitles.some((text) => text.includes("&amp;"))).toBe(false);
  });
});
