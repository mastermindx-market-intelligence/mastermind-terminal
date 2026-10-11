import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignalCard } from "@/components/prophet/SignalCard";
import type { PlanSummary } from "@/components/prophet/SignalCard";

const BASE = {
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
  pulse: "1d · pre-trigger · awaiting trigger",
  pulse_zh: "1天 · 触发前 · 等待触发",
} satisfies PlanSummary & { pulse: string; pulse_zh: string };

function render(plan: PlanSummary, lang: "en" | "zh"): string {
  return renderToStaticMarkup(
    createElement(SignalCard, { plan, lang, selected: false, onSelect: () => {} }),
  );
}

describe("Prophet producer-owned plan pulse", () => {
  it("renders the English producer pulse as quiet status context", () => {
    const html = render(BASE, "en");
    expect(html).toContain("obs-prophet-pulse");
    expect(html).toContain("Plan status");
    expect(html).toContain("1d · pre-trigger · awaiting trigger");
  });

  it("renders only the producer Chinese pulse in the Chinese view", () => {
    const html = render(BASE, "zh");
    expect(html).toContain("计划状态");
    expect(html).toContain("1天 · 触发前 · 等待触发");
    expect(html).not.toContain("Plan status");
    expect(html).not.toContain("awaiting trigger");
  });

  it("stays absent when the producer published no pulse", () => {
    const withoutPulse: PlanSummary = { ...BASE, pulse: undefined, pulse_zh: undefined };
    const html = render(withoutPulse, "en");
    expect(html).not.toContain("obs-prophet-pulse");
    expect(html).not.toContain("Plan status");
  });

  it("does not leak English into Chinese when the Chinese producer copy is unavailable", () => {
    const html = render({ ...BASE, pulse_zh: null }, "zh");
    expect(html).not.toContain("obs-prophet-pulse");
    expect(html).not.toContain("awaiting trigger");
  });
});
