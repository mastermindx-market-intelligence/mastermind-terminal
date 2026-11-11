// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionsPlanComparePanel } from "@/components/options/OptionsPlanComparePanel";
import { preparePlanExpiryRequest, readPlanPayoff } from "../optionsPlanPayoff";
import { draft, response } from "./fixtures/optionsPlanPayoff";
import type { QualifiedPlanScenario } from "../optionsPlanScenarioCompare";

let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function scenario(entry = 2): QualifiedPlanScenario {
  const source = draft(); source.legs[0].assumptions.entry!.premium_per_unit = entry;
  const request = preparePlanExpiryRequest(source); if (!request.ok) throw Error(request.reason);
  const raw = response(request.value);
  raw.curve.pnl = request.value.spots.map(spot => Math.max(spot - 765, 0) * 100 - entry * 100);
  raw.curve.cost = entry * 100; raw.curve.max_loss = -entry * 100; raw.curve.breakevens = [765 + entry];
  const payoff = readPlanPayoff(raw, request.value); if (!payoff) throw Error("invalid test response");
  return { draft: request.value.draft, payoff };
}
async function render(baseline = scenario(), candidate = scenario(4), lang: "en" | "zh" = "en", onClear = vi.fn()) {
  await act(async () => root.render(<OptionsPlanComparePanel baseline={baseline} candidate={candidate} lang={lang} onPin={() => undefined} onClear={onClear} />));
}
describe("Plan comparison preserves evidence and native-owner truth", () => {
  it("shows every raw API decimal rather than rounding a tiny nonzero outcome to zero", async () => {
    const a = scenario(), b = scenario(4);
    a.payoff.curve.pnl[0] = 0.000012345678;
    b.payoff.curve.pnl[0] = 0.000013345679;
    await render(a, b);
    const first = host.querySelector('[data-testid="plan-comparison-points"] tbody tr')!;
    expect(first.children[1].textContent).toBe(String(a.payoff.curve.pnl[0]));
    expect(first.children[2].textContent).toBe(String(b.payoff.curve.pnl[0]));
    expect(first.children[3].textContent).toBe(String(b.payoff.curve.pnl[0] - a.payoff.curve.pnl[0]));
  });
  it("does not declare an existing saved-research input unsaved", async () => {
    await render();
    expect(host.textContent).not.toContain("Neither scenario is saved");
    expect(host.textContent).toContain("Pinning does not save");
  });
  it("localizes buy/sell assumptions and call/put contract labels in Chinese", async () => {
    await render(scenario(), scenario(4), "zh");
    const changes = host.querySelector('[data-testid="plan-assumption-diff"]')!;
    expect(changes.textContent).toContain("买入");
    expect(changes.textContent).toContain("看涨");
    expect(changes.textContent).not.toMatch(/\bbuy\b|\bsell\b/);
  });
  it("returns keyboard focus to the comparison heading when Clear removes its own control", async () => {
    const clear = vi.fn(); await render(scenario(), scenario(4), "en", clear);
    const button = host.querySelector<HTMLButtonElement>('[data-testid="plan-clear-baseline"]')!;
    button.focus(); await act(async () => button.click());
    expect(clear).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(host.querySelector("h3"));
  });
  it("discloses each calculation clock separately from the shared dated reference", async () => {
    const baseline = scenario(), candidate = scenario(4);
    candidate.payoff.known_by = "2026-10-24T12:05:00Z";
    await render(baseline, candidate);
    const clocks = host.querySelector('[data-testid="plan-comparison-clocks"]');
    expect(clocks).not.toBeNull();
    expect(clocks!.textContent).toContain("Baseline calculated at");
    expect(clocks!.textContent).toContain("2026-10-24T12:00:00Z");
    expect(clocks!.textContent).toContain("Revised calculated at");
    expect(clocks!.textContent).toContain("2026-10-24T12:05:00Z");
  });
  it("withholds the overlay and exact differences when the dated reference changed", async () => {
    const a = scenario(), b = scenario(4); b.payoff.source_boundary.reference_sha256 = "d".repeat(64);
    await render(a, b);
    expect(host.querySelector('[data-testid="plan-compare-withheld"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="plan-compare-overlay"]')).toBeNull();
    expect(host.querySelector('[data-testid="plan-comparison-points"]')).toBeNull();
  });
  it("withholds incumbent-retired account research on every stale rerender", async () => {
    let valid = true;
    const a = scenario(), b = scenario(4);
    const props = {
      baseline: a, candidate: b, lang: "en" as const,
      onPin: () => undefined, onClear: () => undefined,
      isScopeCurrent: () => valid,
    };
    await act(async () => root.render(<OptionsPlanComparePanel {...props} />));
    expect(host.querySelector('[data-testid="plan-compare-overlay"]')).not.toBeNull();
    valid = false;
    await act(async () => root.render(<OptionsPlanComparePanel {...props} />));
    expect(host.querySelector('[data-testid="plan-scenario-compare"]')).toBeNull();
    await act(async () => root.render(<OptionsPlanComparePanel {...props} />));
    expect(host.querySelector('[data-testid="plan-scenario-compare"]')).toBeNull();
  });

});
