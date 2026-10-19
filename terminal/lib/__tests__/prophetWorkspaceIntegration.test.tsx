// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/fin/FinCharts", () => ({ LineSeries: () => null }));
vi.mock("@/lib/useWorkspaceSource", () => ({ useWorkspaceSource: () => ({ status: "absent", data: null, refresh: "settled", retry: () => {} }) }));
vi.mock("@/components/fin/IntelligenceWorkspaceShell", () => ({ IntelligenceWorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
import OracleDash from "@/components/fin/OracleDash";
import { decodeProphetObservations } from "@/lib/prophetObservations";
import { prophetFixture } from "./prophetObservationsFixture";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Prophet evidence in the incumbent Intelligence workspace", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 }))); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  const render = async (zh = false, raw: unknown = prophetFixture()) => {
    const props = { prophet: { symbol: "KO", account: "reader-a", status: "ready" as const, data: decodeProphetObservations(raw, "KO") } };
    await act(async () => root.render(<OracleDash sym="KO" bars={[]} zh={zh} {...props} />));
  };
  it("shows the source event even when its new anchor has no admitted episode", async () => {
    await render();
    const section = host.querySelector('[data-testid="workspace-prophet-observations"]');
    expect(section).not.toBeNull(); expect(section?.textContent ?? "").toContain("Early 2-day confluence");
    expect(section?.textContent ?? "").toContain("2026-10-15");
    expect(section?.textContent ?? "").toContain("An existing episode has a different anchor");
    expect(section?.textContent ?? "").toContain("Watch evidence, not an entry instruction");
    expect(section?.textContent ?? "").not.toMatch(/Buy now|Entry open|Candidate accepted/);
    expect(host.querySelectorAll('[data-testid="workspace-prophet-observations"]')).toHaveLength(1);
  });
  it("does not mix English descriptions into the Chinese workspace", async () => {
    await render(true); const section = host.querySelector('[data-testid="workspace-prophet-observations"]');
    expect(section?.textContent ?? "").toContain("两日线早期共振");
    expect(section?.textContent ?? "").toContain("观察依据，非入场指令");
    expect(section?.textContent ?? "").not.toContain("Recorded evidence");
  });
  it("shows recorded price, reset, distance and confirmation without implying an entry", async () => {
    const raw = prophetFixture();
    const source_timing = { asof: "2026-10-16", close: 93.9, reset_low: 85.65, reset_low_date: "2026-10-02",
      off_reset_low_pct: 9.63, slow_tier_eligible: true, slow_tier_tier: "T2", slow_tier_bars_to_cross_3d: null,
      slow_tier_blocking: [], slow_tier_evaluated: true, slow_tier_above_200dma: true };
    const payload = { ...raw, rows: raw.rows.map(row => ({ ...row, source_timing })) };
    await render(false, payload);
    const section = host.querySelector('[data-testid="workspace-prophet-observations"]');
    expect(section?.textContent).toContain("$93.90"); expect(section?.textContent).toContain("$85.65");
    expect(section?.textContent).toContain("+9.63%"); expect(section?.textContent).toContain("Confirmed · T2");
    expect(section?.textContent).toContain("2026-10-02");
    expect(section?.textContent).not.toMatch(/Buy now|Entry open|Candidate accepted/);
    await render(true, payload);
    expect(section?.textContent).toContain("已确认 · T2");
    expect(section?.textContent).not.toContain("Recorded close");
  });
  it("labels older row evidence and the native confirmation blocker in the current language", async () => {
    const raw = prophetFixture();
    const source_timing = { asof: "2026-10-14", close: 91.7, reset_low: null, reset_low_date: null,
      off_reset_low_pct: null, slow_tier_eligible: false, slow_tier_tier: null, slow_tier_bars_to_cross_3d: 2,
      slow_tier_blocking: ["macd_below_signal"], slow_tier_evaluated: true, slow_tier_above_200dma: true };
    const payload = { ...raw, rows: raw.rows.map(row => ({ ...row, source_timing })) };
    await render(false, payload);
    const section = host.querySelector('[data-testid="workspace-prophet-observations"]');
    expect(section?.textContent).toContain("Price as of 2026-10-14");
    expect(section?.textContent).toContain("MACD below signal");
    expect(section?.textContent).toContain("Recorded evidence");
    await render(true, payload);
    expect(section?.textContent).toContain("MACD 低于信号线");
    expect(section?.textContent).not.toContain("MACD below signal");
  });

  it.each([
    { slow: [], counter: ["macd_below_signal"], other: false },
    { slow: ["macd_below_signal"], counter: ["other_native_condition"], other: true },
    { slow: ["macd_below_signal"], counter: ["macd_below_signal"], other: false },
  ])("preserves both confirmation and independent source conditions: %j", async ({ slow, counter, other }) => {
    const raw = prophetFixture();
    const source_timing = { asof: "2026-10-16", close: 93.9, reset_low: null, reset_low_date: null,
      off_reset_low_pct: null, slow_tier_eligible: false, slow_tier_tier: null, slow_tier_bars_to_cross_3d: null,
      slow_tier_blocking: slow, slow_tier_evaluated: true, slow_tier_above_200dma: true };
    const payload = { ...raw, rows: raw.rows.map(row => ({ ...row, source_timing,
      source_evidence: { ...row.source_evidence, counterevidence: counter } })) };
    await render(false, payload);
    const section = host.querySelector('[data-testid="workspace-prophet-observations"]');
    const text = section?.textContent ?? "";
    expect(text.match(/MACD below signal/g)).toHaveLength(1);
    expect(text.includes("Other recorded condition")).toBe(other);
    await render(true, payload);
    expect(section?.textContent).toContain("MACD 低于信号线");
    expect(section?.textContent).not.toContain("MACD below signal");
  });

});
