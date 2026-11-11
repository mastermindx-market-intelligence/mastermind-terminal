import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { browserFuturesFixture } from "./fixtures/futuresPublished";
import { parseFuturesRequest } from "../lib/futuresRequest";
for (const mode of ["book_only", "one_empty_interval"]) test(`${mode}: depth and chronology survive without fake price candles`, async ({ page }, info) => {
  const base = String(info.project.use.baseURL || "http://127.0.0.1:3596");
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: base }]);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  let expectedVolume = 0;
  await page.route("**/api/futures?*", route => {
    const request = parseFuturesRequest(new URL(route.request().url()).searchParams)!;
    const data = browserFuturesFixture(request);
    let known = 0, unknown = 0; expectedVolume = 0;
    data.frames.forEach((frame, i) => {
      if (mode === "book_only" || i === data.frames.length - 2) {
        frame.bar = { ...frame.bar, kind: "no_captured_trades", openTicks: null, highTicks: null, lowTicks: null, closeTicks: null,
          total: 0, buy: 0, sell: 0, unknown: 0, deltaKnown: 0, cells: [], availableAtNs: frame.bar.endNs };
      }
      if (mode === "book_only") frame.gex = { status: "unavailable", reason: "source_unavailable" };
      known += frame.bar.deltaKnown; unknown += frame.bar.unknown; expectedVolume += frame.bar.total;
      frame.bar.cvdKnown = known; frame.bar.cvd = unknown === 0 ? known : null;
    });
    return route.fulfill({ json: data });
  });
  await page.goto("/options/futures?pair=ES");
  await expect(page.getByTestId("futures-chart")).toBeVisible();
  await expect(page.getByTestId("futures-empty-notice")).toContainText("No candle prices are invented");
  await expect(page.getByTestId("futures-empty-interval")).toHaveCount(mode === "book_only" ? 24 : 1);
  await expect(page.getByTestId("futures-bar")).toHaveCount(mode === "book_only" ? 0 : 23);
  await expect(page.getByTestId("depth-gap")).toHaveCount(0);
  await expect(page.getByTestId("futures-volume")).toHaveText(expectedVolume.toLocaleString("en-US"));
  const heat = await page.getByTestId("futures-chart").locator('rect').evaluateAll(es => es.filter(e => (e.getAttribute("fill") || "").startsWith("rgba(")).length);
  expect(heat).toBeGreaterThan(100);
  const dir = process.env.FUTURES_EMPTY_EVIDENCE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.getByTestId("futures-chart").evaluate(el => { const p = document.createElement("p"); p.textContent = "SYNTHETIC BOOK / NO-CAPTURED-TRADE TEST"; p.style.cssText = "padding:8px;font-size:11px;color:#f2d28d"; el.prepend(p); });
    await page.getByTestId("futures-chart").screenshot({ path: path.join(dir, `${info.project.name}-${mode}-depth.png`) });
  }
  await page.getByRole("tab", { name: "Footprint", exact: true }).click();
  if (mode === "book_only") {
    await expect(page.getByTestId("futures-empty-interval")).not.toHaveCount(0);
    await expect(page.getByTestId("futures-bar")).toHaveCount(0);
  } else await expect(page.getByTestId("futures-empty-interval")).toHaveCount(1);
  if (mode === "book_only") { await expect(page.getByTestId("footprint-cell")).toHaveCount(0); await expect(page.getByTestId("futures-poc")).toHaveCount(0); }
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await expect(page.getByTestId("futures-empty-notice")).not.toContainText("No candle");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
