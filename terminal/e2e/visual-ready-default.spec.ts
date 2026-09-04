import { expect, test } from "@playwright/test";

type VisualReadyDetail = {
  symbol: string;
  timeframe: string;
  generation: number;
  state: "data" | "empty";
};

type VisualReadyDiagnosticDetail = {
  symbol: string;
  timeframe: string;
  generation: number;
  state: "data";
  code: "render_not_ready";
  attempts: number;
};

declare global {
  interface Window {
    __mmDefaultVisualReadyEvents: VisualReadyDetail[];
    __mmDefaultVisualReadyDiagnostics: VisualReadyDiagnosticDetail[];
  }
}

test("the shipped default 3D multi-pane workspace reaches one truthful visual-ready edge", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("3D"));
    localStorage.setItem("mm.inds", JSON.stringify(["ema", "vol", "macd", "stochrsi"]));
    window.__mmDefaultVisualReadyEvents = [];
    window.__mmDefaultVisualReadyDiagnostics = [];
    window.addEventListener("mm:terminal-visual-ready", (event) => {
      window.__mmDefaultVisualReadyEvents.push(
        (event as CustomEvent<VisualReadyDetail>).detail,
      );
    });
    window.addEventListener("mm:terminal-visual-ready-diagnostic", (event) => {
      window.__mmDefaultVisualReadyDiagnostics.push(
        (event as CustomEvent<VisualReadyDiagnosticDetail>).detail,
      );
    });
  });

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 15_000 });

  // This is intentionally the shipped default multi-pane topology, not the empty-indicator shortcut
  // used by indicator-snapshot. The old eight-frame contract passed that shortcut while unrelated
  // real consumers lost their ready edge after MACD/StochRSI pane construction under CI load.
  await expect.poll(
    () => page.evaluate(() =>
      (window as Window & { __mmChartAxisOpts?: () => { paneTickMarkDensity?: unknown[] } | null })
        .__mmChartAxisOpts?.()?.paneTickMarkDensity?.length ?? 0),
    { message: "the default indicator set should build more than one chart pane", timeout: 15_000 },
  ).toBeGreaterThan(1);

  await expect.poll(
    () => page.evaluate(() =>
      window.__mmDefaultVisualReadyEvents.some((detail) =>
        detail.symbol === "NVDA"
        && detail.timeframe === "3D"
        && detail.state === "data"
        && Number.isInteger(detail.generation)
        && detail.generation > 0)
      || window.__mmDefaultVisualReadyDiagnostics.length > 0),
    {
      message: "the current default generation should become ready or return its typed render diagnostic",
      timeout: 15_000,
    },
  ).toBe(true);

  const receipt = await page.evaluate(() => ({
    ready: window.__mmDefaultVisualReadyEvents.filter((detail) =>
      detail.symbol === "NVDA"
      && detail.timeframe === "3D"
      && detail.state === "data"),
    diagnostics: window.__mmDefaultVisualReadyDiagnostics,
    requestedIndicators: localStorage.getItem("mm.inds"),
    paneCount: (window as Window & { __mmChartAxisOpts?: () => { paneTickMarkDensity?: unknown[] } | null })
      .__mmChartAxisOpts?.()?.paneTickMarkDensity?.length ?? 0,
  }));

  expect(receipt.requestedIndicators).toBe(JSON.stringify(["ema", "vol", "macd", "stochrsi"]));
  expect(receipt.paneCount).toBeGreaterThan(1);
  expect(receipt.diagnostics).toEqual([]);
  expect(receipt.ready).toHaveLength(1);
  expect(receipt.ready[0]!).toMatchObject({
    symbol: "NVDA",
    timeframe: "3D",
    state: "data",
  });
  expect(receipt.ready[0]!.generation).toBeGreaterThan(0);
});
