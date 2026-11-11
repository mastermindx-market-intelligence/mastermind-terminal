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
    expect(cards()).toHaveLength(1);
    expect(bucketButtons().some(b => b.textContent === "Clear bucket")).toBe(false);
    await mount(rows);
    expect(cards()).toHaveLength(3);
    expect(host.querySelectorAll('[data-fc-open="1"]')).toHaveLength(0);
  });
});
