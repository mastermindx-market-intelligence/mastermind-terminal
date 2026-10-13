// @vitest-environment jsdom
// Wave B3 — geometry pins for components/news/NewsFlowTally.tsx (design pin P10).
// jsdom has no ResizeObserver and reports clientWidth 0, so useChartWidth stays
// at its 296 fallback: bw=7, x0=14, xi(i)=14+9i, xToday=274 (P10 check values).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import NewsFlowTally from "@/components/news/NewsFlowTally";
import stripStyles from "@/components/news/NewsFlowStrip.module.css";
import { padDomain } from "@/components/charts/svgChart";
import type { TickerNewsFlow } from "@/lib/newsTypes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- contract section 5 fixtures (see newsFlowContract.test.ts) ----------------

const FLOW_METHOD =
  "distinct reports by source + source_item_id; active status only; " +
  "rights-allowed sources only; UTC calendar days; median of 28 prior days";

const flowProvenance = (publishedAt: number, receivedAt: number) => ({
  velocity_schema: "qbus.news_velocity.v1",
  sources_counted: ["benzinga"],
  status_counted: "active",
  distinct_by: "source + source_item_id",
  story_grouping: "news_cluster_members.cluster_id; a report in no cluster is its own story",
  cluster_policy_version: "qbus_news_cluster.v2",
  windows: {
    reports_24h: "rolling, closed at both ends: [as_of - 24h, as_of]",
    reports_7d: "rolling, closed at both ends: [as_of - 7d, as_of]",
    daily_28d: {
      start_date: "2026-09-14",
      end_date: "2026-10-11",
      unit: "UTC calendar day",
      excludes: "the current UTC day",
      order: "oldest first",
    },
  },
  calculation: { method: FLOW_METHOD, comparison_rule: "flow_compare.v1" },
  time_basis_counts_24h: { published_at: publishedAt, received_at: receivedAt },
});

const OK_DAILY = [2, 3, 1, 4, 2, 3, 0, 5, 2, 3, 2, 3, 1, 4, 2, 3, 2, 3, 1, 3, 2, 4, 2, 3, 2, 3, 2, 3];
const THIN_DAILY = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];

const FLOW_OK = {
  schema: "ticker_news.flow.v1", state: "ok", reason: null, coverage: "complete",
  as_of: "2026-10-12T10:30:00Z", reports_24h: 7, reports_7d: 21, stories_24h: 4,
  median_daily_28d: 2.5, daily_counts_28d: OK_DAILY, history_days_observed: 28,
  comparison: "busier", provenance: flowProvenance(6, 1),
} as unknown as TickerNewsFlow;

const FLOW_PARTIAL = { ...FLOW_OK, coverage: "partial", comparison: null } as unknown as TickerNewsFlow;

const FLOW_THIN = {
  schema: "ticker_news.flow.v1", state: "thin_history", reason: null, coverage: "complete",
  as_of: "2026-10-12T10:30:00Z", reports_24h: 2, reports_7d: 3, stories_24h: 2,
  median_daily_28d: null, daily_counts_28d: THIN_DAILY, history_days_observed: 6,
  comparison: "insufficient_history", provenance: flowProvenance(2, 0),
} as unknown as TickerNewsFlow;

const FLOW_ZERO_TODAY = {
  ...FLOW_OK, reports_24h: 0, reports_7d: 12, stories_24h: 0, median_daily_28d: 2,
  comparison: "quieter", provenance: flowProvenance(0, 0),
} as unknown as TickerNewsFlow;

// ---- P10 geometry, mirrored from the component (check values in the pin) -------

const BW = 7;
const X0 = 14;
const XI = (i: number) => X0 + i * (BW + 2);
const X_TODAY = X0 + 28 * BW + 64;
const HI = (maxDaily: number, r24: number, median: number | null) =>
  padDomain(0, Math.max(maxDaily, r24, median ?? 0, 1), { clampMin: 0 })[1];
const BAR_H = (v: number, hi: number) => (v <= 0 ? 0 : Math.max(2, Math.round((v / hi) * 90)));

let host: HTMLDivElement;
let root: Root;

function render(flow: TickerNewsFlow, lang: "en" | "zh" = "en") {
  act(() => {
    root.render(<NewsFlowTally flow={flow} lang={lang} />);
  });
  return host.querySelector("svg");
}

const bars = (svg: Element | null) => svg?.querySelectorAll(`rect.${stripStyles.bar}`) ?? [];
const zeroDots = (svg: Element | null) => svg?.querySelectorAll(`rect.${stripStyles.zeroDot}`) ?? [];
const medianLine = (svg: Element | null) => svg?.querySelector(`line.${stripStyles.median}`) ?? null;
const noRecordLine = (svg: Element | null) => svg?.querySelector(`line.${stripStyles.noRecord}`) ?? null;
const todayRect = (svg: Element | null) => svg?.querySelector(`rect.${stripStyles.today}`) ?? null;
const labelTexts = (svg: Element | null) =>
  [...(svg?.querySelectorAll(`text.${stripStyles.tallyLabel}`) ?? [])].map((el) => el.textContent);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("NewsFlowTally — FLOW_OK geometry at the 296 fallback width", () => {
  it("draws 28 bars-or-dots with exactly one zero dot (index 6)", () => {
    const svg = render(FLOW_OK);
    expect(svg).toBeTruthy();
    expect(bars(svg).length).toBe(27);
    expect(zeroDots(svg).length).toBe(1);
    expect(bars(svg).length + zeroDots(svg).length).toBe(28);
    expect(zeroDots(svg)[0].getAttribute("x")).toBe(String(XI(6) + Math.floor((BW - 2) / 2)));
    expect(zeroDots(svg)[0].getAttribute("y")).toBe("98");
  });

  it("draws no no-record line (all 28 days observed)", () => {
    const svg = render(FLOW_OK);
    expect(noRecordLine(svg)).toBeNull();
    expect(labelTexts(svg)).not.toContain("no record");
  });

  it("draws the median hairline at yM from the formula, with its label", () => {
    const svg = render(FLOW_OK);
    const hi = HI(5, 7, 2.5);
    const yM = Math.round(100 - (2.5 / hi) * 90) + 0.5;
    const line = medianLine(svg)!;
    expect(line.getAttribute("x1")).toBe(String(X0));
    expect(line.getAttribute("x2")).toBe(String(XI(27) + BW));
    expect(line.getAttribute("y1")).toBe(String(yM));
    expect(line.getAttribute("y2")).toBe(String(yM));
    const label = [...(svg?.querySelectorAll(`text.${stripStyles.tallyLabel}`) ?? [])].find(
      (el) => el.textContent === "typical",
    );
    expect(label?.getAttribute("x")).toBe(String(X0));
    expect(label?.getAttribute("y")).toBe(String(yM - 3));
  });

  it("draws the today mark outlined at x 274.625", () => {
    const svg = render(FLOW_OK);
    const today = todayRect(svg)!;
    expect(today.getAttribute("x")).toBe("274.625");
    const hi = HI(5, 7, 2.5);
    const hT = BAR_H(7, hi);
    expect(today.getAttribute("y")).toBe(String(100 - hT + 0.625));
    expect(today.getAttribute("height")).toBe(String(hT - 1.25));
    expect(today.getAttribute("width")).toBe(String(BW - 1.25));
    const label = [...(svg?.querySelectorAll(`text.${stripStyles.tallyLabel}`) ?? [])].find(
      (el) => el.textContent === "24h",
    );
    expect(label?.getAttribute("x")).toBe(String(X_TODAY + BW));
    expect(label?.getAttribute("y")).toBe("114");
    expect(label?.getAttribute("text-anchor")).toBe("end");
  });

  it("the svg is a 1:1 pixel box with role=img", () => {
    const svg = render(FLOW_OK)!;
    expect(svg.getAttribute("width")).toBe("296");
    expect(svg.getAttribute("height")).toBe("120");
    expect(svg.getAttribute("viewBox")).toBe("0 0 296 120");
    expect(svg.getAttribute("preserveAspectRatio")).toBeNull();
    expect(svg.getAttribute("role")).toBe("img");
  });
});

describe("NewsFlowTally — FLOW_THIN geometry", () => {
  it("draws 1 bar, 5 zero dots, the no-record run and its label, and no median", () => {
    const svg = render(FLOW_THIN);
    expect(bars(svg).length).toBe(1);
    expect(zeroDots(svg).length).toBe(5);
    const bar = bars(svg)[0];
    expect(bar.getAttribute("x")).toBe(String(XI(22)));
    const line = noRecordLine(svg)!;
    expect(line.getAttribute("x1")).toBe(String(X0));
    expect(line.getAttribute("x2")).toBe(String(XI(21) + BW));
    expect(line.getAttribute("x2")).toBe("210");
    expect(line.getAttribute("y1")).toBe("99.5");
    expect(medianLine(svg)).toBeNull();
    expect(labelTexts(svg)).toContain("no record");
    expect(labelTexts(svg)).not.toContain("typical");
    expect(labelTexts(svg)).toContain("24h");
  });
});

describe("NewsFlowTally — partial coverage and zero today", () => {
  it("dashes the today mark when coverage is partial", () => {
    const svg = render(FLOW_PARTIAL);
    const today = todayRect(svg)!;
    expect(today.getAttribute("class")).toContain(stripStyles.todayPartial);
  });

  it("a rolling window with zero reports is an outlined stub of height 0.75", () => {
    const svg = render(FLOW_ZERO_TODAY);
    const today = todayRect(svg)!;
    expect(today.getAttribute("height")).toBe("0.75");
  });
});

describe("NewsFlowTally — aria carries the numbers (EN and ZH)", () => {
  it("state ok names the days on record, the median and the last 24 hours", () => {
    const svg = render(FLOW_OK, "en")!;
    expect(svg.getAttribute("aria-label")).toBe(
      "Daily report counts for the 28 days before today (28 days on record), typical day 2.5, last 24 hours 7",
    );
  });

  it("state thin_history omits the median and keeps the counts", () => {
    const svg = render(FLOW_THIN, "zh")!;
    expect(svg.getAttribute("aria-label")).toBe(
      "今天之前28天每日报道数（有记录 6 天），近24小时 2 条",
    );
  });

  it("partial coverage appends the incompleteness note", () => {
    const svg = render(FLOW_PARTIAL, "en")!;
    expect(svg.getAttribute("aria-label")).toBe(
      "Daily report counts for the 28 days before today (28 days on record), typical day 2.5, last 24 hours 7. Counts may be incomplete",
    );
  });
});

describe("NewsFlowTally — empty data", () => {
  it("renders no svg when daily_counts_28d or reports_24h is null, but keeps the wrapper", () => {
    render({
      ...FLOW_OK,
      state: "unavailable",
      reason: "calculation_failed",
      as_of: null,
      reports_24h: null,
      reports_7d: null,
      stories_24h: null,
      median_daily_28d: null,
      daily_counts_28d: null,
      history_days_observed: null,
      comparison: null,
      provenance: null,
    } as unknown as TickerNewsFlow);
    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector("div")).toBeTruthy();
  });
});
