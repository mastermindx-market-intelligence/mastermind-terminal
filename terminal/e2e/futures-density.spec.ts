import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browserFuturesFixture } from "./fixtures/futuresPublished";
import { parseFuturesRequest } from "../lib/futuresRequest";

test("dense source keeps offscreen gamma out of the DOM and preserves billion-dollar relative sizes", async ({ page }, info) => {
  const base = String(info.project.use.baseURL || "http://127.0.0.1:3596");
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: base }]);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/futures?*", route => {
    const request = parseFuturesRequest(new URL(route.request().url()).searchParams)!;
    const data = browserFuturesFixture(request);
    for (const frame of data.frames) {
      if (frame.gex.status !== "ok") continue;
      const p = frame.gex.projection;
      p.mapped.forEach((row, i) => { row.gammaNetMn = [800, -1600, 3200][i]; });
      p.mapped.push(...Array.from({ length: 200 }, (_, i) => {
        const sourceStrike = 6000 + i * 5, futuresPrice = sourceStrike * p.ratio;
        return { sourceStrike, futuresPrice, displayTickPrice: Math.round(futuresPrice * 4) / 4, gammaNetMn: 1e6 };
      }));
    }
    return route.fulfill({ json: data });
  });
  await page.goto("/options/futures?pair=ES");
  await expect(page.getByTestId("futures-chart")).toBeVisible();
  await expect(page.getByTestId("mapped-level")).toHaveCount(203); // raw inspector remains complete
  await expect(page.getByTestId("gex-bubble")).toHaveCount(72); // 24 frames x three visible strikes, not 4,872 SVG nodes
  const radii = await page.getByTestId("gex-bubble").evaluateAll(es => es.slice(0, 3).map(e => Number(e.getAttribute("r"))));
  expect(radii[0]).toBeLessThan(radii[1]); expect(radii[1]).toBeLessThan(radii[2]);
  await expect(page.getByTestId("gex-visual-scale")).toContainText("5B");
  expect(errors).toEqual([]);
  const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    gammaCircles: document.querySelectorAll('[data-testid="gex-bubble"]').length }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  const dir = process.env.FUTURES_DENSITY_EVIDENCE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    // This fixture caption is test-only, never a production data toggle.
    await page.getByTestId("futures-chart").evaluate(el => { const p = document.createElement("p");
      p.textContent = "SYNTHETIC DENSE-SOURCE DISPLAY TEST"; p.style.cssText = "padding:8px;font-size:11px;color:#f2d28d"; el.prepend(p); });
    await page.getByTestId("futures-chart").screenshot({ path: path.join(dir, `${info.project.name}-dense-gamma.png`) });
    writeFileSync(path.join(dir, `${info.project.name}-dense-gamma.json`), JSON.stringify({ viewport: info.project.use.viewport,
      synthetic: true, admittedGammaRowsPerFrame: 203, admittedFrames: 24, sourceTableRows: 203,
      svgGammaCirclesBeforeRepair: 4872, svgGammaCircles: geometry.gammaCircles, radii, scaleLabel: "5B",
      note: "DOM counts and relative-size witness; not an exchange-latency or live-capacity claim" }, null, 2) + "\n");
  }
});
