import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignalCard } from "@/components/prophet/SignalCard";
import type { PlanSummary } from "@/components/prophet/SignalCard";

const BASE: PlanSummary = {
  id: "AMKR-BULL-20260917",
  asset: "AMKR",
  direction: "BULL",
  entry: 50.3,
  targets: [63.575, 76.85],
  invalidation: 41.45,
  horizon_days: 45,
  min_hold_days: 10,
  _signal_date: "2026-09-18",
  option_contract: null,
  phase: "pre_trigger",
  recommended_action: "wait",
  last_price: 50.3,
  entry_zone: {
    low: 48.52,
    high: 48.91,
    chase_above: 50.3,
    zone_class: "reset_band",
    stance: "wait",
    basis: "the pullback band the entry ladder already showed",
    basis_zh: "入场阶梯已经显示的回踩区间",
  },
  entry_zone_state: {
    state: "live",
    stance: "wait",
    sessions_remaining: 12,
  },
};

function render(plan: PlanSummary, lang: "en" | "zh"): string {
  return renderToStaticMarkup(
    createElement(SignalCard, { plan, lang, selected: false, onSelect: () => {} }),
  );
}

describe("Prophet opportunity box", () => {
  it("renders the structured live zone in English without replacing the plan entry", () => {
    const html = render(BASE, "en");
    expect(html).toContain("Opportunity box");
    expect(html).toContain("$48.52");
    expect(html).toContain("$48.91");
    expect(html).toContain("No chase &gt; $50.30");
    expect(html).toContain("Wait");
    expect(html).toContain("Plan anchor");
    expect(html).toContain("$50.30");
  });

  it("renders the same structured zone in Chinese without English label leakage", () => {
    const html = render(BASE, "zh");
    expect(html).toContain("机会区间");
    expect(html).toContain("不追高 &gt; $50.30");
    expect(html).toContain("等待");
    expect(html).toContain("计划锚点");
    expect(html).not.toContain("Opportunity box");
    expect(html).not.toContain("Plan anchor");
  });

  it("does not present a historical filled zone as a current opportunity", () => {
    const html = render({
      ...BASE,
      phase: "triggered_pre_t1",
      recommended_action: "hold",
      entry_zone_state: { state: "filled", stance: "wait", sessions_remaining: null },
    }, "en");
    expect(html).not.toContain("obs-prophet-entry-zone");
    expect(html).not.toContain("Opportunity box");
  });

  it("does not relabel an expired converted band as the current opportunity box", () => {
    const html = render({
      ...BASE,
      entry_zone_state: { state: "converted", stance: "starter", sessions_remaining: 0 },
    }, "en");
    expect(html).not.toContain("obs-prophet-entry-zone");
    expect(html).not.toContain("$48.52");
  });

  it("does not override a HOLD action with an unfilled historical entry band", () => {
    const html = render({
      ...BASE,
      phase: "triggered_pre_t1",
      recommended_action: "hold",
      entry_zone_state: { state: "live", stance: "wait", sessions_remaining: 6 },
    }, "en");
    expect(html).not.toContain("obs-prophet-entry-zone");
    expect(html).not.toContain("Opportunity box");
  });
});
