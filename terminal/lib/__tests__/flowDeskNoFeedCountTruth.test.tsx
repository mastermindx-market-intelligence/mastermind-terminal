// @vitest-environment jsdom
/**
 * Unknown is not zero in the Flow Desk toolbar (audit of #1198 @48fea0bc, N1).
 *
 * With no feed (the read failed, nothing is published, or a read is still in flight)
 * the toolbar used to print "0 SIGNALS" and the coverage line "No eligible premium in
 * this tape yet" right beside "Could not load flow feed". Both are readings of a tape
 * the desk never received. With no feed the toolbar names the held state instead, the
 * list keeps the reason (load error + why, the absent note, or the skeleton), and no
 * coverage claim is drawn. A loaded feed keeps its count and its coverage line.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowStreamStatus } from "@/lib/flowStream";
import { FeedPane, type FeedPayload, type FlowEvent } from "@/components/flowdesk/FeedPane";
import { DEFAULT_FILTERS } from "@/components/flowdesk/FiltersPanel";
import { FD } from "@/lib/flowdeskStrings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HELD = {
  unavailable: { en: "Feed not loaded", zh: "资金流未加载" },
  absent: { en: "No feed published", zh: "资金流未发布" },
  loading: { en: "Loading flow feed…", zh: "加载资金流中…" },
} as const;

const feedEv = (over: Partial<FlowEvent> = {}): FlowEvent => ({
  id: "ev1", ts: "2026-10-16T14:05:00Z", root: "SPX", group: "Index", group_zh: "指数",
  right: "C", exp: "2026-10-16", strike: 6000, dte: 0, dte_bucket: "0d",
  mny_bucket: "atm", side: "~buy", n_prints: 12, size: 250, avg_price: 3.1,
  premium: 930000, premium_z: 4.2, baseline_source: "90d", vol_gt_oi: true,
  repeated: false, zerodte: true, signing_source: "iso", ...over,
});
const feedPayload = (events: FlowEvent[]): FeedPayload => ({
  asof: "2026-10-16T15:00:00Z", session_date: "2026-10-16", events, unusual_names: [],
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(lang: "en" | "zh", feed: FeedPayload | null, status?: FlowStreamStatus) {
  await act(async () => root.render(
    <FeedPane
      feed={feed}
      connected={false}
      flowMeta={null}
      enrich={null}
      lang={lang}
      selectedId={null}
      onSelect={() => {}}
      filters={{ ...DEFAULT_FILTERS }}
      onFiltersChange={() => {}}
      status={status}
      onRetry={() => {}}
    />,
  ));
}

const toolbarCount = () => host.querySelector<HTMLElement>(".obs-fd-count")!;

describe.each([
  ["unavailable", "unavailable"],
  ["absent", "absent"],
  ["loading", "loading"],
  ["loading (status-less caller)", undefined],
] as const)("FeedPane with no feed (%s): no count, no coverage claim (N1)", (_label, status) => {
  const held = HELD[status ?? "loading"];

  it.each(["en", "zh"] as const)("the toolbar names the held state, not a count (%s)", async (lang) => {
    await mount(lang, null, status);
    const count = toolbarCount();
    expect(count).not.toBeNull();
    const text = count.textContent ?? "";
    expect(text, "a count was drawn for a feed that never loaded").not.toMatch(/\d/);
    expect(text).not.toContain("SIGNALS");
    expect(text).not.toContain("信号");
    const label = count.querySelector<HTMLElement>('[data-testid="flowfeed-count-held"]')!;
    expect(label).not.toBeNull();
    expect(label.getAttribute("data-held-state")).toBe(status ?? "loading");
    expect(label.textContent).toBe(held[lang]);
  });

  it.each(["en", "zh"] as const)("no coverage line and no 'no eligible premium' claim (%s)", async (lang) => {
    await mount(lang, null, status);
    expect(host.querySelector('[data-testid="flow-coverage"]')).toBeNull();
    const text = host.textContent ?? "";
    expect(text).not.toContain(FD.coverageEmpty.en);
    expect(text).not.toContain(FD.coverageEmpty.zh);
  });
});

describe("FeedPane with no feed: the list still carries the reason", () => {
  it.each(["en", "zh"] as const)("unavailable keeps the load error, its why and Retry (%s)", async (lang) => {
    await mount(lang, null, "unavailable");
    const alert = host.querySelector('[data-testid="flowfeed-load-error"]')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain(lang === "zh" ? FD.errFeed.zh : FD.errFeed.en);
    expect(alert.textContent).toContain(lang === "zh" ? FD.feedErrorWhy.zh : FD.feedErrorWhy.en);
    expect(alert.querySelector("button")).not.toBeNull();
  });

  it.each(["en", "zh"] as const)("absent keeps the absent note (%s)", async (lang) => {
    await mount(lang, null, "absent");
    const note = host.querySelector('[data-testid="flowfeed-absent"]')!;
    expect(note).not.toBeNull();
    expect(note.textContent).toBe(lang === "zh" ? FD.feedAbsent.zh : FD.feedAbsent.en);
  });
});

describe("FeedPane with a loaded feed keeps its count and coverage", () => {
  it.each(["en", "zh"] as const)("one event: '1' and the signals word, plus the coverage line (%s)", async (lang) => {
    await mount(lang, feedPayload([feedEv({})]), "data");
    const count = toolbarCount();
    expect(count.querySelector('[data-testid="flowfeed-count-held"]')).toBeNull();
    expect(count.textContent).toContain("1");
    expect(count.textContent).toContain(lang === "zh" ? "信号" : "SIGNALS");
    expect(host.querySelector('[data-testid="flow-coverage"]')).not.toBeNull();
  });

  it("an empty published tape still says it has no eligible premium (that is a reading)", async () => {
    await mount("en", feedPayload([]), "data");
    expect(toolbarCount().textContent).toContain("0");
    expect(host.querySelector('[data-testid="flow-coverage"]')?.textContent).toBe(FD.coverageEmpty.en);
  });
});
