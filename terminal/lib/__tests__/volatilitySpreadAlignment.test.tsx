// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VolVrpPanel } from "@/components/vol/VolVrpPanel";
import type { AggTrendPayload } from "@/lib/aggTrend";

let host: HTMLDivElement;
let root: Root;
const base = Date.UTC(2026, 4, 1);
function day(i: number) { return new Date(base + i * 86_400_000).toISOString().slice(0, 10); }
function history(n = 90): AggTrendPayload {
  let spot = 100;
  const series = Array.from({ length: n }, (_, i) => {
    const row = { d: day(i), s: spot, iv: 0.20 };
    spot = i % 2 === 0 ? spot * 1.008 : spot / 1.008;
    return row;
  });
  return { schema: "options_hub.aggtrend/v1", root: "SPY", asof: series.at(-1)!.d, series };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(sourceAsOf: string | null, agg = history()) {
  await act(async () => root.render(<VolVrpPanel vrp={1.25} agg={agg} sourceAsOf={sourceAsOf} lang="en" />));
}

describe("IV-realized-vol historical session alignment", () => {
  it("withholds current percentile/trend/change when history ends before the source snapshot", async () => {
    const agg = history(); const historyDay = agg.series!.at(-1)!.d; const current = day(110);
    await render(current, agg);
    expect(host.textContent).toContain(`Derived history ends ${historyDay}; current source snapshot is ${current}`);
    expect(host.textContent).toContain("Withheld · sessions differ");
    expect(host.textContent).toContain("Reported spread now");
    expect(host.textContent).toContain("1.25");
    expect(host.textContent).toContain("withheld until sessions align");
    expect(host.querySelector("svg")).toBeTruthy(); // historical context remains visible
  });

  it("enables derived range/trend/change only when the history reaches the exact source session", async () => {
    const agg = history(); const current = agg.series!.at(-1)!.d;
    await render(current, agg);
    expect(host.textContent).toContain(`Derived history reaches the current source session · ${current}`);
    expect(host.textContent).not.toContain("Withheld · sessions differ");
    expect(host.textContent).toMatch(/Lower range|Middle range|Upper range/);
    expect(host.textContent).toContain("vol pts");
  });

  it("never substitutes the derived last value for a missing source-reported headline", async () => {
    const agg = history();
    await act(async () => root.render(<VolVrpPanel vrp={null} agg={agg} sourceAsOf={agg.series!.at(-1)!.d} lang="en" />));
    const current = [...host.querySelectorAll(".fin-kpi")].find(node => node.textContent?.includes("Reported spread now"));
    expect(current?.textContent).toContain("—");
  });

  it("does not call stale history 'current' when the source session itself is unavailable", async () => {
    const agg = history(); const historyDay = agg.series!.at(-1)!.d;
    await render(null, agg);
    expect(host.textContent).toContain(`Derived history through ${historyDay}`);
    expect(host.textContent).toContain("Withheld · sessions differ");
  });
});
