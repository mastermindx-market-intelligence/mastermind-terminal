import { expect, test } from "./fixtures";

test("Flow Desk separates Connected transport from measured source freshness", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  if (zh) {
    await page.addInitScript(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      document.documentElement.setAttribute("lang", "zh-CN");
    });
  }

  await page.goto("/options?tab=desk");
  await expect(page.locator('[data-options-ia="seven-category-stage-a"]')).toBeVisible({ timeout: 15_000 });

  const timing = page.locator(".obs-fd-freshness");
  await expect(timing).toHaveAttribute("data-flow-freshness", "measured", { timeout: 15_000 });
  await expect(timing).toBeVisible();
  await expect(timing).toHaveAttribute("data-flow-timing-contract", "live_flow.meta/v2");
  await expect(timing).toHaveAttribute("data-flow-timing-authority", "display_only");
  await expect(timing).toHaveAttribute("data-flow-session", "last_session");
  await expect(timing.locator('[data-flow-transport="connected"]')).toContainText(zh ? "已连接" : "Connected");
  await expect(timing).toContainText(zh ? "市场休市" : "Market closed");
  await expect(timing).toContainText(zh ? "上一交易时段" : "Last session");
  await expect(timing).toContainText(zh ? "源响应" : "Source responses");
  await expect(timing).toContainText(zh ? "实测周期" : "Observed cycle");

  // Chain heat's recompute/build clock is intentionally not a freshness source.
  // Its receipt must resolve from fixture `source_asof`. The phone contract hides
  // the entire right rail, so there we pin the mounted contract rather than force
  // a new mobile surface into this scoped truth patch.
  const chainSource = page.locator('.obs-fd-chain [data-flow-artifact-freshness="source"]');
  if (testInfo.project.name === "mobile") await expect(chainSource).toHaveCount(1);
  else await expect(chainSource).toBeVisible({ timeout: 15_000 });
  await expect(chainSource).toHaveAttribute("data-flow-timing-authority", "display_only");
  await expect(chainSource).toHaveAttribute("title", "2026-07-07T16:00:00-04:00");
  await expect(chainSource).toContainText(zh ? "源数据" : "Source");

  const containment = await page.evaluate(() => {
    const receipt = document.querySelector<HTMLElement>(".obs-fd-freshness");
    const chain = document.querySelector<HTMLElement>(".obs-fd-chain");
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      receiptRight: receipt?.getBoundingClientRect().right ?? Infinity,
      chainRight: chain?.getBoundingClientRect().right ?? Infinity,
    };
  });
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewport + 1);
  expect(containment.receiptRight).toBeLessThanOrEqual(containment.viewport + 1);
  expect(containment.chainRight).toBeLessThanOrEqual(containment.viewport + 1);

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-flow-freshness-truth.png`),
    fullPage: false,
  });
});
