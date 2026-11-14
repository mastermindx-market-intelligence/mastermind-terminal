// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedPane, type FeedPayload, type FlowEvent } from "@/components/flowdesk/FeedPane";
import { FlowProjectionStrip } from "@/components/flowdesk/FlowProjectionStrip";
import { DEFAULT_FILTERS } from "@/components/flowdesk/FiltersPanel";
import { buildFlowProjection } from "@/lib/flowProjection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const event = (over: Partial<FlowEvent> = {}): FlowEvent => ({
  id: "first", ts: "2026-11-10T15:01:00Z", root: "AAPL", group: "Tech", group_zh: "科技",
  right: "C", exp: "2026-11-20", strike: 230, dte: 10, dte_bucket: "8_30d",
  mny_bucket: "atm", side: "~buy", n_prints: 2, size: 101, avg_price: 1,
  premium: 610000, premium_z: null, baseline_source: "floor", vol_gt_oi: null,
  repeated: false, zerodte: false, signing_source: "tape", ...over,
});
const rows = [
  event(),
  event({ id: "middle", ts: "2026-11-10T15:07:00Z", root: "NVDA", size: 102, premium: 620000 }),
  event({ id: "last", ts: "2026-11-10T15:17:00Z", root: "MSFT", size: 103, premium: 630000 }),
];
const payload = (events: FlowEvent[]): FeedPayload => ({
  asof: "2026-11-10T15:20:00Z", session_date: "2026-11-10", events, unusual_names: [],
});
let host: HTMLDivElement;
let root: Root;
let filters: typeof DEFAULT_FILTERS;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  filters = { ...DEFAULT_FILTERS };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
async function mount(events = rows) {
  await act(async () => root.render(
    <FeedPane feed={payload(events)} connected={false} flowMeta={null} enrich={null}
      lang="en" selectedId={null} onSelect={() => {}} filters={filters}
      onFiltersChange={() => {}} status="data" onRetry={() => {}} />,
  ));
}
const cards = () => [...host.querySelectorAll<HTMLElement>('[data-tut="flow-card"]')];
const bucketButtons = () => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Flow buckets"] button')];
const intervalButton = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Flow time projection"] button')].find(b => b.textContent === text)!;
async function activate(button: HTMLButtonElement) {
  // Native click without pointerdown models keyboard activation. Outside-pointer cleanup
  // must not accidentally conceal a missing selection-owned expansion reset.
  button.focus();
  await act(async () => button.click());
}
async function expand(card: HTMLElement) {
  await activate(card.querySelector<HTMLButtonElement>(".obs-fc-expand-btn")!);
  expect(host.querySelectorAll('[data-fc-open="1"]')).toHaveLength(1);
}

describe("projection controls describe their current state", () => {
  it.each(["en", "zh"] as const)("exposes the selected interval and omitted identities (%s)", async lang => {
    const projection = buildFlowProjection([event(), event({ id: "" })], 15);
    await act(async () => root.render(
      <FlowProjectionStrip projection={projection} selectedKey={null} interval={15}
        lang={lang} onSelect={() => {}} onInterval={() => {}} />,
    ));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.find(b => b.textContent === "15m")?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons.find(b => b.textContent === "5m")?.getAttribute("aria-pressed")).toBe("false");
    expect(host.textContent).toContain(lang === "zh" ? "事件标识无效" : "invalid event ID");
    expect(host.textContent).toContain("1");
  });
});

describe("real FeedPane selection preserves coverage and expansion ownership", () => {
  it("filters the existing ordered cards while leaving all-loaded coverage unchanged", async () => {
    await mount();
    const coverage = host.querySelector('[data-testid="flow-coverage"]')!.textContent;
    expect(cards()).toHaveLength(3);
    expect(cards()[0].textContent).toContain("MSFT");
    await activate(bucketButtons()[0]);
    expect(cards()).toHaveLength(2);
    expect(host.querySelector('[data-testid="flow-bucket-summary"] [data-metric="premium"] dd')?.textContent).toBe("$1,230,000");
    expect(cards()[0].textContent).toContain("NVDA");
    expect(cards()[1].textContent).toContain("AAPL");
    expect(host.querySelector(".obs-fd-count")?.textContent).toContain("2");
    expect(host.querySelector('[data-testid="flow-coverage"]')?.textContent).toBe(coverage);
    await activate(bucketButtons().find(b => b.textContent === "Clear bucket")!);
    expect(cards()).toHaveLength(3);
    expect(host.querySelector('[data-testid="flow-coverage"]')?.textContent).toBe(coverage);
  });

  it("collapses an expanded card when the interval changes by keyboard activation", async () => {
    await mount(); await expand(cards()[0]); await activate(intervalButton("5m"));
    expect(host.querySelectorAll('[data-fc-open="1"]')).toHaveLength(0);
    expect(intervalButton("5m").getAttribute("aria-pressed")).toBe("true");
  });

  it("does not revive a hidden expansion after selecting and clearing a different bucket", async () => {
    await mount(); await expand(cards()[0]); await activate(bucketButtons()[0]);
    expect(cards()).toHaveLength(2);
    await activate(bucketButtons().find(b => b.textContent === "Clear bucket")!);
    expect(cards()).toHaveLength(3);
    expect(host.querySelectorAll('[data-fc-open="1"]')).toHaveLength(0);
  });

  it("clears missing bucket state and expansion when a new feed removes that bucket", async () => {
    await mount(); await activate(bucketButtons()[0]); await expand(cards()[0]);
    await mount([rows[2]]);
    expect(host.querySelector('[data-testid="flow-bucket-summary"]')).toBeNull();
    expect(cards()).toHaveLength(1);
    expect(bucketButtons().some(b => b.textContent === "Clear bucket")).toBe(false);
    await mount(rows);
    expect(cards()).toHaveLength(3);
    expect(host.querySelectorAll('[data-fc-open="1"]')).toHaveLength(0);
  });
});

describe("selected Flow interval explains its observed activity", () => {
  const summary = () => host.querySelector<HTMLElement>('[data-testid="flow-bucket-summary"]');
  const metric = (key: string) => summary()?.querySelector('[data-metric="' + key + '"] dd')?.textContent;
  async function renderSelection(events: FlowEvent[], lang: "en" | "zh" = "en", selected: number | null = 0) {
    const projection = buildFlowProjection(events, 15);
    await act(async () => root.render(
      <FlowProjectionStrip projection={projection} selectedKey={selected === null ? null : projection.buckets[selected]?.key ?? "removed"}
        interval={15} lang={lang} onSelect={() => {}} onInterval={() => {}} />,
    ));
    return projection;
  }

  it.each(["en", "zh"] as const)("separates premium, event aggregates, reported prints and contract volume (%s)", async lang => {
    await renderSelection([
      event(),
      event({ id: "put", ts: "2026-11-10T15:02:00Z", right: "P", side: "~sell", premium: 75.5, size: 5, n_prints: 1 }),
      event({ id: "unknown", ts: "2026-11-10T15:03:00Z", right: "?" as FlowEvent["right"], side: "?" as FlowEvent["side"], premium: 25, size: 3, n_prints: 4 }),
      event({ id: "excluded", ts: "2026-11-10T15:04:00Z", premium: -1 }),
    ], lang);
    expect(summary()).not.toBeNull();
    expect(summary()?.textContent).toContain("2026-11-10 · 10:00–10:15 EST");
    expect(metric("premium")).toBe("$610,100.50");
    expect(metric("events")).toBe("3");
    expect(metric("prints")).toBe("7");
    expect(metric("contracts")).toBe("109");
    expect(summary()?.textContent).toContain(lang === "zh" ? "事件聚合" : "Event aggregates");
    expect(summary()?.textContent).toContain(lang === "zh" ? "报告成交笔数" : "Reported prints");
    expect(summary()?.textContent).toContain(lang === "zh" ? "合约成交量" : "Contract volume");
    expect(metric("calls")).toBe("$610,000");
    expect(metric("puts")).toBe("$75.50");
    expect(metric("unknown-right")).toBe("$25");
    expect(metric("estimated-buy")).toBe("$610,000");
    expect(metric("estimated-sell")).toBe("$75.50");
    expect(metric("mixed")).toBe("$0");
    expect(metric("unknown-side")).toBe("$25");
    expect(summary()?.textContent).toContain(lang === "zh" ? "根据当前筛选" : "Current filters");
    expect(summary()?.textContent).toContain(lang === "zh" ? "估算成交方向" : "Estimated trade side");
    expect(summary()?.querySelector("details")?.open).toBe(false);
    expect(host.textContent).toContain(lang === "zh" ? "数值无效" : "invalid value");
  });

  it("keeps genuine zero quantities visible and withdraws an unselected or missing interval", async () => {
    await renderSelection([event({ premium: 0, size: 0, n_prints: 0 })]);
    expect(metric("premium")).toBe("$0");
    expect(metric("events")).toBe("1");
    expect(metric("prints")).toBe("0");
    expect(metric("contracts")).toBe("0");
    await renderSelection(rows, "en", null);
    expect(summary()).toBeNull();
    await renderSelection(rows, "en", 99);
    expect(summary()).toBeNull();
  });

  it("distinguishes the same local time on different dates and across EST/EDT", async () => {
    const events = [
      event({ id: "summer", ts: "2026-07-10T14:01:00Z" }),
      event({ id: "winter", ts: "2026-11-10T15:01:00Z" }),
    ];
    const projection = await renderSelection(events);
    const names = bucketButtons().slice(0, 2).map(b => b.getAttribute("aria-label"));
    expect(names[0]).toContain("2026-07-10 · 10:00–10:15 EDT");
    expect(names[1]).toContain("2026-11-10 · 10:00–10:15 EST");
    expect(bucketButtons()[0].textContent).toContain("2026-07-10");
    expect(bucketButtons()[1].textContent).toContain("2026-11-10");
    expect(projection.buckets.map(b => b.key)).toEqual(["2026-07-10T14:00:00.000Z", "2026-11-10T15:00:00.000Z"]);
  });

  it("distinguishes repeated daylight-saving clock times on one local date", async () => {
    await renderSelection([
      event({ id: "first-one", ts: "2026-11-01T05:01:00Z" }),
      event({ id: "second-one", ts: "2026-11-01T06:01:00Z" }),
    ]);
    const buttons = bucketButtons().slice(0, 2);
    expect(buttons[0].getAttribute("aria-label")).toContain("2026-11-01 · 01:00–01:15 EDT");
    expect(buttons[1].getAttribute("aria-label")).toContain("2026-11-01 · 01:00–01:15 EST");
    expect(buttons[0].textContent).toContain("EDT");
    expect(buttons[1].textContent).toContain("EST");
  });

  it("shows both dates when an interval ends on the next New York day", async () => {
    const projection = buildFlowProjection([event({ ts: "2026-11-10T04:01:00Z" })], 60);
    await act(async () => root.render(
      <FlowProjectionStrip projection={projection} selectedKey={projection.buckets[0].key}
        interval={60} lang="en" onSelect={() => {}} onInterval={() => {}} />,
    ));
    expect(summary()?.textContent).toContain("2026-11-09 23:00 EST – 2026-11-10 00:00 EST");
  });
});
