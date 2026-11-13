// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FuturesPublishedView } from "../futuresTransport";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ owner: "test" }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/lib/futuresUiCopy", () => ({ useFuturesText: () => (key: string) => key }));
vi.mock("@/components/futures/FuturesMicrostructureChart", () => ({
  default: ({ mode, showCvd }: { mode: string; showCvd: boolean }) =>
    <div data-testid="mock-futures-renderer" data-mode={mode} data-cvd={showCvd ? "on" : "off"} />,
}));
vi.mock("@/components/futures/useFuturesWorkspace", () => ({ useFuturesWorkspace: vi.fn() }));

import FootprintChartPane from "@/components/futures/FootprintChartPane";
import { useFuturesWorkspace } from "@/components/futures/useFuturesWorkspace";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(useFuturesWorkspace).mockReset();
  vi.mocked(useFuturesWorkspace).mockReturnValue({ key: "test", status: "unavailable", reason: "source_unavailable" });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

async function render(symbol: string, timeframe: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(FootprintChartPane, { symbol, timeframe, dataReady: true })); });
  return host;
}

describe("main-chart footprint consumer", () => {
  it("never requests bid/ask order flow for unrelated stock symbols", async () => {
    const el = await render("NVDA", "1m");
    expect(el.querySelector('[data-testid="footprint-unavailable"]')).toBeTruthy();
    expect(el.textContent).toContain("stock candles cannot provide bid/ask volume");
    expect(useFuturesWorkspace).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toContain("pair=NQ");
  });

  it("refuses an ES timeframe for which the real futures API has no source contract", async () => {
    const el = await render("ES", "15m");
    expect(el.textContent).toContain("1m and 5m");
    expect(useFuturesWorkspace).not.toHaveBeenCalled();
  });

  it("shows an honest source outage instead of fake footprint numbers", async () => {
    const el = await render("ES", "1m");
    expect(vi.mocked(useFuturesWorkspace)).toHaveBeenCalledWith(
      expect.objectContaining({ pair: "ES", intervalMinutes: 1, priceStepTicks: 1 }),
      expect.any(String), 0);
    expect(el.textContent).toContain("OHLC volume is not substituted");
    expect(el.querySelector('[data-testid="mock-futures-renderer"]')).toBeNull();
  });

  it("displays provenance, captured totals and coverage warnings from the admitted source", async () => {
    const data = {
      contract: "NQZ6", sourceId: "captured_test", cutoffMs: 1730000000000,
      basis: "historical", tradeCoverage: "partial", lowTick: 100, highTick: 200,
      frames: [{ bar: { total: 120, deltaKnown: 35, unknown: 7 } }],
    } as unknown as FuturesPublishedView;
    vi.mocked(useFuturesWorkspace).mockReturnValue({ key: "test", status: "data", data });
    const el = await render("NQ", "5m");
    expect(el.querySelector('[data-testid="footprint-source-basis"]')?.textContent).toContain("Historical capture");
    expect(el.querySelector('[data-testid="footprint-partial-coverage"]')?.textContent).toContain("Incomplete trade coverage");
    expect(el.querySelector('[data-testid="footprint-summary"]')?.textContent).toContain("120");
    expect(el.querySelector('[data-testid="footprint-summary"]')?.textContent).toContain("+35");
    expect(el.querySelector('[data-testid="footprint-summary"]')?.textContent).toContain("7");
    expect(el.querySelector('[data-testid="mock-futures-renderer"]')?.getAttribute("data-mode")).toBe("footprint");
    const cvd = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(cvd?.checked).toBe(true);
    await act(async () => { cvd?.click(); });
    expect(el.querySelector('[data-testid="mock-futures-renderer"]')?.getAttribute("data-cvd")).toBe("off");
    const rows = el.querySelector<HTMLSelectElement>('select[aria-label="Ticks per price row"]');
    await act(async () => {
      if (rows) { rows.value = "4"; rows.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    expect(vi.mocked(useFuturesWorkspace)).toHaveBeenLastCalledWith(
      expect.objectContaining({ pair: "NQ", intervalMinutes: 5, priceStepTicks: 4 }),
      expect.any(String), 0);
  });
});
