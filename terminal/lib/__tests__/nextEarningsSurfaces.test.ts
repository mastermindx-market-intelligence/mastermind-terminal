import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import EventEdgePop from "@/components/fin/EventEdgePop";
import { nextDateCountdown } from "@/lib/finFormat";
import EarningsPage from "@/components/fin/EarningsPage";
import OverviewPage from "@/components/fin/OverviewPage";
import type { Fund } from "@/lib/fund";
import { curateFundamentals } from "@/lib/copilotTools";

const anchor = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function krusFund(nextDate: string): Fund {
  return {
    schema: "mastermind.fund/v1",
    ticker: "KRUS",
    earnings: { next_date: nextDate, q: [], fy: [] },
  } as unknown as Fund;
}

function renderSurfaces(nextDate: string) {
  const fund = krusFund(nextDate);
  return {
    earnings: renderToStaticMarkup(createElement(EarningsPage, { fund, sym: "KRUS" })),
    overview: renderToStaticMarkup(createElement(OverviewPage, { fund, sym: "KRUS", onNavigate: () => {} })),
    eventEdge: renderToStaticMarkup(createElement(EventEdgePop, {
      anchor,
      intel: { analysis: { analyst: { next_date: nextDate } } },
      onClose: () => {},
    })),
    ai: curateFundamentals({
      schema: "mastermind.fund/v1",
      ticker: "KRUS",
      earnings: { next_date: nextDate, q: [] },
    }),
  };
}

describe("next earnings consumer defense", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps a stale KRUS date out of every surface that calls it next", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));

    const surfaces = renderSurfaces("2026-08-25");

    expect(surfaces.earnings).not.toContain("Aug 25, 2026");
    expect(surfaces.overview).not.toContain("Aug 25, 2026");
    expect(surfaces.eventEdge).not.toContain("Aug 25");
    expect(surfaces.ai.next_earnings).toBeNull();
  });

  it("keeps a future KRUS date available to every next-earnings surface", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));

    const surfaces = renderSurfaces("2026-09-15");

    expect(surfaces.earnings).toContain("Sep 15, 2026");
    expect(surfaces.overview).toContain("Sep 15, 2026");
    expect(surfaces.eventEdge).toContain("Sep 15");
    expect(surfaces.ai.next_earnings).toBe("2026-09-15");
  });

  it("keeps an impossible ISO-shaped legacy date out of every next surface", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));

    const surfaces = renderSurfaces("2026-09-31");

    expect(surfaces.earnings).not.toContain("Oct 1, 2026");
    expect(surfaces.overview).not.toContain("Oct 1, 2026");
    expect(surfaces.eventEdge).not.toContain("Oct 1");
    expect(surfaces.ai.next_earnings).toBeNull();
  });
});

// Two further "Next"-labelled surfaces that issue #474 never enumerated. Found by auditing
// every next_date reader in the tree rather than only the screenshot path.
describe("next_date surfaces outside the reported rail", () => {
  afterEach(() => vi.useRealTimers());

  it("FundamentalsDashboard's Next report date rendered a raw unguarded value", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));

    // The exact expression the component now uses for t("fdNextReport").
    const render = (nextDate: string | null | undefined) =>
      nextDateCountdown(nextDate) == null ? "-" : nextDate;

    expect(render("2026-07-07")).toBe("-");
    expect(render("2026-08-20")).toBe("-");
    expect(render("nan")).toBe("-");
    expect(render(null)).toBe("-");
    expect(render("2026-08-26")).toBe("2026-08-26");
    expect(render("2026-10-29")).toBe("2026-10-29");
  });

  it("StockAnalysis' earnings countdown chip fails closed on past and impossible dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));

    // sub={nDays != null ? `${nDays}d` : undefined}
    expect(nextDateCountdown("2026-07-07")).toBeNull();
    expect(nextDateCountdown("2026-09-31")).toBeNull();   // impossible calendar day
    expect(nextDateCountdown("2026-08-26")).toBe(0);
    expect(nextDateCountdown("2026-09-15")).toBe(20);
  });
});
