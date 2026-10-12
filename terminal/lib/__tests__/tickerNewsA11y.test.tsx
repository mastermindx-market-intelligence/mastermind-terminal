// @vitest-environment jsdom
// t-rail-a11y — accessibility and bilingual pins for the ticker-news rail.
//
// TEST-ONLY lane: this file pins the CURRENT behavior of TickerNewsPanel/NewsCatchup
// (characterization first) plus the a11y laws the rail is expected to hold. Known
// defects are pinned with it.fails and/or characterization tests and listed as GAPs;
// no component is edited here.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TickerNewsPanel from "@/components/news/TickerNewsPanel";
import type { TickerNewsStoryRow } from "@/lib/newsTypes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Lang = "en" | "zh";

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
  updated_at: "2026-10-05T14:01:00+00:00",
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1",
  ...extra,
});

// Two sources (so the source <select> renders), one grouped story (so the "N reports"
// disclosure renders) and enough rows that several "Mark reviewed" buttons coexist.
const richRows = (): TickerNewsStoryRow[] => [
  row("ev2_grp", "Grouped coverage headline", 3, 2),
  row("ev2_b", "Supply story", 2, 1, { source: "dowjones" }),
  row("ev2_a", "Launch story", 1, 1),
];

const snapshot = (ticker: string, rows: TickerNewsStoryRow[], opts: { state?: string } = {}) => ({
  schema: "ticker_news.snapshot.v1",
  ticker,
  security_id: "SEC:" + ticker,
  state: opts.state ?? "live",
  rows,
  next_cursor: rows[rows.length - 1]?.sequence ?? null,
  has_more: false,
  source_health: { state: "live", last_successful_catchup: "2026-10-05T14:01:01+00:00" },
});

const groupDetail = () => ({
  schema: "ticker_news.story.v1",
  story_id: "ev2_grp",
  source_count: 1,
  item_count: 2,
  members: [
    row("ev2_grp", "Grouped coverage headline", 2, 2),
    { ...row("ev2_grp", "Earlier wording", 1, 2, { source: "dowjones" }), source_item_id: "ev2_grp-earlier" },
  ],
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

/** A fetch that serves whatever `serve.current` holds (with the request URL), so a test can
 *  route snapshot vs story-detail requests or change the feed between loads. */
function feed(initial: (input: RequestInfo | URL) => Promise<Response>) {
  const serve = { current: initial };
  const fn = vi.fn((input: RequestInfo | URL) => serve.current(input));
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return { serve, fn };
}

/** jsdom's own window: Node's built-in `localStorage` global shadows jsdom's in this environment. */
const jsdomWindow = () => (globalThis as unknown as { jsdom: { window: Window & typeof globalThis } }).jsdom.window;

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

/** The rail tab that names the panel. TerminalShell.tsx:5780-5783 mounts the real one with
 *  `lang === "zh" ? "新闻" : "News"`; tests mount a stub with the same id/role/label. */
function mountRailTab(label: string) {
  const tab = document.createElement("button");
  tab.setAttribute("type", "button");
  tab.id = "rail-tab-news";
  tab.setAttribute("role", "tab");
  tab.textContent = label;
  document.body.appendChild(tab);
  return tab;
}

/**
 * Accessible-name computation for the name sources this rail uses: aria-labelledby,
 * aria-label, title, then flattened text content (name from content — what names a
 * <button>/<a> in practice). This is the same step testing-library's getByRole({ name })
 * performs; @testing-library is not a dependency of this repo, so the lane computes it
 * directly instead of adding one.
 */
function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .trim()
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null)
      .map((node) => accessibleName(node))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label && label.trim()) return label.replace(/\s+/g, " ").trim();
  const title = el.getAttribute("title");
  if (title && title.trim()) return title.replace(/\s+/g, " ").trim();
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** All <time> elements' dateTime attributes inside the panel. */
const timeValues = (panel: Element) =>
  [...panel.querySelectorAll("time")].map((el) => el.getAttribute("dateTime") ?? "");

/** Structural fingerprint of a render: tag, role, data-* (name=value) and aria-* names only —
 *  everything that must NOT change between languages (aria/text VALUES are copy, excluded). */
function structureSignature(panel: Element): string[] {
  return [...panel.querySelectorAll("*")]
    .map((el) => {
      const attrs = [...el.attributes];
      const dataAttrs = attrs
        .filter((a) => a.name.startsWith("data-"))
        .map((a) => `${a.name}=${a.value}`)
        .sort()
        .join(",");
      const ariaNames = attrs.filter((a) => a.name.startsWith("aria-")).map((a) => a.name).sort().join(",");
      const role = el.getAttribute("role") ?? "";
      return `${el.tagName}|role=${role}|${dataAttrs}|${ariaNames}`;
    })
    .sort();
}

/** Non-empty text nodes of a render, in document order. */
function textNodes(panel: Element): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = (walker.currentNode.textContent ?? "").trim();
    if (text) out.push(text);
  }
  return out;
}

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
  document.getElementById("rail-tab-news")?.remove();
  globalThis.fetch = realFetch;
  Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: realEventSource });
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("t-rail-a11y — landmark and region naming", () => {
  it.each([
    ["en", "News"],
    ["zh", "新闻"],
  ] as const)("the tabpanel is named by the rail tab in %s", async (lang, tabLabel) => {
    mountRailTab(tabLabel);
    feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch story", 1)])));
    await render(<TickerNewsPanel symbol="NVDA" lang={lang} userId="user-a" />);

    const panel = host.querySelector('[role="tabpanel"][data-testid="ticker-news-panel"]');
    expect(panel).toBeTruthy();
    // The computed accessible name — what getByRole("tabpanel", { name }) matches on.
    expect(accessibleName(panel!)).toBe(tabLabel);
    expect(panel!.getAttribute("aria-labelledby")).toBe("rail-tab-news");
  });

  it("characterization: with no rail tab in the document the tabpanel name is empty (isolated mount)", async () => {
    // In the real shell TerminalShell.tsx:5779-5784 always mounts #rail-tab-news next to this
    // panel, so the empty name below is only reachable on an isolated mount (like this one).
    feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch story", 1)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    const panel = host.querySelector('[role="tabpanel"]');
    expect(panel).toBeTruthy();
    expect(accessibleName(panel!)).toBe("");
  });
});

describe("t-rail-a11y — interactive controls are named", () => {
  it.each(["en", "zh"] as const)("every interactive control has a non-empty accessible name (%s)", async (lang) => {
    feed(() => response(snapshot("NVDA", richRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang={lang} userId="user-a" />);

    const panel = host.querySelector("[data-testid=ticker-news-panel]")!;
    // The inventory this walker must have covered: headline links, the "N reports"
    // disclosure, per-story "Mark reviewed", "Mark shown", the four filter chips and the
    // source <select> (two sources in the fixture).
    expect(panel.querySelectorAll("a[data-news-headline]").length).toBe(3);
    expect(panel.querySelectorAll("button[aria-expanded]").length).toBe(1);
    expect(panel.querySelectorAll("[data-news-mark-one]").length).toBe(3);
    expect(panel.querySelectorAll("[data-news-mark-shown]").length).toBe(1);
    expect(panel.querySelectorAll("[data-news-filter]").length).toBe(4);
    expect(panel.querySelector("[data-news-source-filter]")).toBeTruthy();

    const controls = panel.querySelectorAll("button, a, select, input");
    expect(controls.length).toBeGreaterThan(0);
    const unnamed = [...controls].filter((el) => accessibleName(el) === "");
    expect(unnamed.map((el) => `${el.tagName}: ${el.outerHTML}`)).toEqual([]);
  });

  it("the grouped-coverage disclosure exposes aria-expanded and flips when expanded", async () => {
    feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/")) return response(groupDetail());
      return response(snapshot("NVDA", richRows()));
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    const disclosure = host.querySelector<HTMLButtonElement>("[data-testid=ticker-news-panel] button[aria-expanded]")!;
    expect(accessibleName(disclosure)).toBe("2 reports");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      disclosure.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(accessibleName(disclosure)).toBe("Hide reports");
  });

  it("each filter chip exposes aria-pressed and exactly one is pressed", async () => {
    feed(() => response(snapshot("NVDA", richRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    const chips = [...host.querySelectorAll("[data-news-filter]")];
    expect(chips.length).toBe(4);
    for (const chip of chips) {
      expect(["true", "false"]).toContain(chip.getAttribute("aria-pressed"));
      expect(accessibleName(chip)).not.toBe("");
    }
    expect(chips.filter((chip) => chip.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(chips.find((chip) => chip.getAttribute("aria-pressed") === "true")?.getAttribute("data-news-filter")).toBe("all");
  });
});

describe("t-rail-a11y — external links open safely in a new tab", () => {
  it.each(["en", "zh"] as const)("headline and grouped-source member links use _blank + noopener noreferrer (%s)", async (lang) => {
    feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/")) return response(groupDetail());
      return response(snapshot("NVDA", richRows()));
    });
    await render(<TickerNewsPanel symbol="NVDA" lang={lang} userId="user-a" />);

    const links = () => [...host.querySelectorAll("[data-testid=ticker-news-panel] a[href]")];
    expect(links().length).toBe(3); // three headline links, no members yet
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(links().length).toBe(5); // + two grouped-source member links

    for (const link of links()) {
      expect(link.getAttribute("target")).toBe("_blank");
      const rel = (link.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean);
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer"); // pinned as observed
    }
  });
});

describe("t-rail-a11y — no translated text in title attributes", () => {
  const noUrlRows = (): TickerNewsStoryRow[] => [row("ev2_a", "Launch story", 1, 1, { url: "" })];
  const allTitles = () =>
    [...host.querySelectorAll("[data-testid=ticker-news-panel] [title]")].map((el) => el.getAttribute("title") ?? "");

  it("EN: no CJK in any title attribute; the no-url headline carries the EN hint", async () => {
    feed(() => response(snapshot("NVDA", noUrlRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    expect(allTitles()).toEqual(["Source link unavailable"]);
    expect(allTitles().join("|")).not.toMatch(/[㐀-鿿]/);
  });

  // The law: never put translated text in HTML title=. TickerNewsPanel.tsx:201 renders
  // title={copy.sourceUnavailable} on the no-url headline, which is 原文链接不可用 in ZH —
  // so the law currently FAILS in ZH. Held as it.fails until the component is fixed (GAP).
  it.fails("ZH: no CJK in any title attribute (law; currently red at TickerNewsPanel.tsx:201)", async () => {
    feed(() => response(snapshot("NVDA", noUrlRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" userId="user-a" />);
    expect(allTitles().join("|")).not.toMatch(/[㐀-鿿]/);
  });

  it("characterization: the ZH no-url headline title is 原文链接不可用 (the defect it.fails above holds)", async () => {
    feed(() => response(snapshot("NVDA", noUrlRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" userId="user-a" />);
    expect(allTitles()).toEqual(["原文链接不可用"]);
  });
});

describe("t-rail-a11y — keyboard reachability", () => {
  it("no positive tabIndex, buttons are real type=button, no interactive role or tabindex on div/span", async () => {
    feed(() => response(snapshot("NVDA", richRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    const panel = host.querySelector("[data-testid=ticker-news-panel]")!;
    const positive = [...panel.querySelectorAll("[tabindex]")].filter(
      (el) => Number(el.getAttribute("tabindex")) > 0,
    );
    expect(positive).toEqual([]);

    const buttons = [...panel.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.filter((button) => button.getAttribute("type") !== "button")).toEqual([]);

    // DOM-level proxy for "no click handler on a div/span": nothing generic carries an
    // interactive role, a tabindex, or an inline onclick. (React attaches real handlers only
    // to the <button>/<select> elements above, per the component source.)
    const interactiveRoles = new Set([
      "button", "link", "tab", "checkbox", "radio", "switch", "option", "menuitem",
      "textbox", "listbox", "combobox", "scrollbar", "slider", "spinbutton",
    ]);
    const generic = [...panel.querySelectorAll("div, span")];
    const bad = generic.filter((el) => {
      const role = el.getAttribute("role");
      return (
        (role !== null && interactiveRoles.has(role)) ||
        el.hasAttribute("tabindex") ||
        el.hasAttribute("onclick")
      );
    });
    expect(bad.map((el) => el.outerHTML)).toEqual([]);

    // Everything keyboard-focusable in the panel is a real control element.
    const focusables = [...panel.querySelectorAll("*")].filter((el) => (el as HTMLElement).tabIndex >= 0);
    expect(focusables.length).toBeGreaterThan(0);
    expect(focusables.map((el) => el.tagName).every((tag) => ["BUTTON", "A", "SELECT", "INPUT", "TEXTAREA"].includes(tag))).toBe(true);
  });
});

describe("t-rail-a11y — load states announce themselves", () => {
  // For each load state: the panel's data-news-state matches AND a role="status" or
  // aria-live region with non-empty text is exposed. Ready-with-rows is announced by the
  // catch-up summary's aria-live="polite" span (NewsCatchup.tsx:57).
  const cases = [
    {
      name: "loading",
      state: "loading",
      serve: () => response(snapshot("NVDA", [row("ev2_a", "Launch story", 1)])),
      never: true,
      text: { en: "Loading company news…", zh: "正在载入公司新闻…" },
    },
    {
      name: "ready with rows",
      state: "live",
      serve: () => response(snapshot("NVDA", richRows())),
      never: false,
      text: { en: "3 new · 0 updated", zh: "3 条新 · 0 条更新" },
    },
    {
      name: "quiet empty",
      state: "quiet",
      serve: () => response(snapshot("NVDA", [], { state: "quiet" })),
      never: false,
      text: { en: "No new company news right now.", zh: "暂时没有新的公司新闻。" },
    },
    {
      name: "restricted",
      state: "restricted",
      serve: () => response({ detail: "forbidden" }, 403),
      never: false,
      text: { en: "News access is unavailable for this account or feed.", zh: "此账户或新闻源当前不可用。" },
    },
    {
      name: "unavailable",
      state: "unavailable",
      serve: () => response({ detail: "upstream missing" }, 503),
      never: false,
      text: { en: "News is temporarily unavailable.", zh: "新闻暂时不可用。" },
    },
  ] as const;

  it.each(cases.flatMap((c) => (["en", "zh"] as const).map((lang) => [c.name, lang, c] as const)))(
    "%s (%s) exposes data-news-state and a non-empty status/live region",
    async (_name, lang, c) => {
      // loading: a fetch that never settles keeps loadState at "loading".
      feed(() => (c.never ? new Promise<Response>(() => {}) : c.serve()));
      await render(<TickerNewsPanel symbol="NVDA" lang={lang} userId="user-a" />);

      const panel = host.querySelector("[data-testid=ticker-news-panel]")!;
      expect(panel.getAttribute("data-news-state")).toBe(c.state);

      const regions = [...panel.querySelectorAll('[role="status"], [aria-live]')];
      const withText = regions.filter((el) => (el.textContent ?? "").trim() !== "");
      expect(withText.length).toBeGreaterThan(0);
      expect(panel.textContent).toContain(c.text[lang]);
    },
  );
});

describe("t-rail-a11y — timestamps parse", () => {
  it("every story row renders a <time> whose dateTime parses and prefers updated_at", async () => {
    feed(() => response(snapshot("NVDA", richRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    const panel = host.querySelector("[data-testid=ticker-news-panel]")!;
    const values = timeValues(panel);
    expect(values).toHaveLength(3);
    for (const value of values) {
      expect(Number.isFinite(Date.parse(value))).toBe(true);
    }
    // updated_at (14:01:00) wins over published_at (14:00:00) and received_at (14:01:01).
    expect(new Set(values)).toEqual(new Set(["2026-10-05T14:01:00+00:00"]));
  });

  it("characterization: a row with no parseable time is refused by the contract, so no bad <time> can render", async () => {
    // TickerNewsPanel.tsx:184-196 would put the raw updated_at || published_at || received_at
    // into dateTime. But newsValidation.ts asTimestamp (line 52-61) rejects any value whose
    // Date.parse is NaN, so a row whose timestamps are all unparseable never survives
    // parseTickerNewsSnapshot: the panel shows unavailable instead of a row with an
    // unparseable dateTime. The candidate it.fails is therefore unreachable — pinned as-is.
    feed(() => response(snapshot("NVDA", [
      row("ev2_bad", "Unparseable time story", 1, 1, { updated_at: null, published_at: null, received_at: "not-a-date" }),
    ])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    const panel = host.querySelector("[data-testid=ticker-news-panel]")!;
    expect(panel.getAttribute("data-news-state")).toBe("unavailable");
    expect(panel.querySelectorAll("article")).toHaveLength(0);
    expect(timeValues(panel)).toEqual([]);
  });
});

describe("t-rail-a11y — EN/ZH parity", () => {
  it("the structure (roles, controls by role+data attribute) is identical between EN and ZH", async () => {
    feed(() => response(snapshot("NVDA", richRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    const en = structureSignature(host.querySelector("[data-testid=ticker-news-panel]")!);
    const enPanel = host.querySelector("[data-testid=ticker-news-panel]")!;
    expect(enPanel.getAttribute("data-news-state")).toBe("live");

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" userId="user-a" />);
    const zh = structureSignature(host.querySelector("[data-testid=ticker-news-panel]")!);
    expect(zh.length).toBe(en.length);
    expect(zh).toEqual(en);
  });

  it("only proper nouns, numbers, the symbol and feed content are identical text across languages", async () => {
    feed(() => response(snapshot("NVDA", richRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    const enTexts = textNodes(host.querySelector("[data-testid=ticker-news-panel]")!);

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" userId="user-a" />);
    const zhTexts = textNodes(host.querySelector("[data-testid=ticker-news-panel]")!);

    // Multiset intersection: what stayed byte-identical when the language changed.
    const remaining = new Map<string, number>();
    for (const text of zhTexts) remaining.set(text, (remaining.get(text) ?? 0) + 1);
    const shared = enTexts.filter((text) => {
      const n = remaining.get(text) ?? 0;
      if (n > 0) {
        remaining.set(text, n - 1);
        return true;
      }
      return false;
    });
    expect(shared.length).toBeGreaterThan(0);

    const allowedShared = new Set([
      "NVDA", "Benzinga", "Dowjones",
      "Grouped coverage headline", "Supply story", "Launch story", "Short lead",
    ]);
    const offenders = shared.filter((text) => !allowedShared.has(text) && !/^\d+$/.test(text) && !/^\d{1,2}:\d{2}\s?(AM|PM)?$/.test(text));
    expect(offenders).toEqual([]);
  });
});

describe("t-rail-a11y — no body or image from the feed", () => {
  it("sentinel body/image fields never reach the DOM and no <img> is rendered; teaser is text only", async () => {
    // The contract parser (newsValidation.ts parseStoryRow, lines 95-112) rebuilds each row
    // from known fields only, so unknown fields are dropped at the API boundary; this pins
    // the user-facing guarantee end to end — fixture through parse through render.
    const SENTINEL_TEXT = "SENTINEL-BODY-4b1c";
    const SENTINEL_URL = "https://sentinel.example/never.png";
    const tainted = (base: TickerNewsStoryRow) => ({
      ...base,
      body: SENTINEL_TEXT,
      content: SENTINEL_TEXT,
      html: `<img src="${SENTINEL_URL}">`,
      image_url: SENTINEL_URL,
      image: SENTINEL_TEXT,
      thumbnail: SENTINEL_URL,
    }) as TickerNewsStoryRow;

    feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/")) {
        return response({
          schema: "ticker_news.story.v1",
          story_id: "ev2_grp",
          source_count: 1,
          item_count: 2,
          members: [
            tainted(row("ev2_grp", "Grouped coverage headline", 2, 2)),
            tainted({ ...row("ev2_grp", "Earlier wording", 1, 2, { source: "dowjones" }), source_item_id: "ev2_grp-earlier" }),
          ],
        });
      }
      return response(snapshot("NVDA", [
        tainted(row("ev2_grp", "Grouped coverage headline", 3, 2)),
        row("ev2_b", "Supply story", 2, 1, { source: "dowjones" }),
      ]));
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);

    // Expand the grouped story so member rows render too.
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).not.toContain("SENTINEL");
    expect(host.textContent).not.toContain("sentinel.example");
    expect(host.querySelectorAll("img")).toHaveLength(0);

    // The teaser is part of the contract and renders as text, never markup.
    const teasers = [...host.querySelectorAll("[data-news-headline]")].map((el) => el.parentElement?.querySelector("p"));
    expect(teasers.filter(Boolean).map((p) => p!.textContent)).toEqual(["Short lead", "Short lead"]);
    expect(host.querySelectorAll("article > p").length).toBe(2);
  });
});

describe("t-rail-a11y — candidate defects probed (characterized, never fixed here)", () => {
  it("the live dot is a generic span whose aria-label is hard-coded English in both languages (TickerNewsPanel.tsx:160)", async () => {
    feed(() => response(snapshot("NVDA", [row("ev2_a", "Launch story", 1)])));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    const enDot = host.querySelector('[aria-label="live"]');
    expect(enDot?.tagName).toBe("SPAN");
    expect(enDot?.getAttribute("role")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" userId="user-a" />);
    const zhDot = host.querySelector('[aria-label="live"]');
    // ZH render exposes the same hard-coded English "live" — see GAP.
    expect(zhDot?.tagName).toBe("SPAN");
    expect(zhDot?.getAttribute("aria-label")).toBe("live");
  });

  it("the expanded grouped-source list is a generic div carrying aria-label (TickerNewsPanel.tsx:218)", async () => {
    feed((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stories/")) return response(groupDetail());
      return response(snapshot("NVDA", richRows()));
    });
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const list = [...host.querySelectorAll("div[aria-label]")].find((el) => (el.getAttribute("aria-label") ?? "").includes("reports"));
    expect(list).toBeTruthy();
    expect(list?.querySelectorAll("a[href]").length).toBe(2); // it holds the two member links
    expect(list?.getAttribute("role")).toBeNull(); // generic div: aria-label is not a supported name — see GAP
  });

  it("per-story Mark reviewed buttons share one identical accessible name in both languages (TickerNewsPanel.tsx:205)", async () => {
    feed(() => response(snapshot("NVDA", richRows())));
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    const enNames = [...host.querySelectorAll("[data-news-mark-one]")].map((el) => accessibleName(el));
    expect(enNames).toEqual(["Mark reviewed", "Mark reviewed", "Mark reviewed"]);

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" userId="user-a" />);
    const zhNames = [...host.querySelectorAll("[data-news-mark-one]")].map((el) => accessibleName(el));
    expect(zhNames).toEqual(["标为已读", "标为已读", "标为已读"]);
    // Judged a real defect: a screen-reader user browsing by button cannot tell WHICH
    // story a given "Mark reviewed" would mark. GAP, not fixed in this lane.
  });
});
