import { expect, test } from "@playwright/test";

test("desktop chart context expands into the inspector rail instead of covering price", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) <= 860, "The adjacent inspector rail is desktop-only.");

  await page.goto("/terminal?symbol=NVDA");
  const trigger = page.locator("#visual-context-trigger-dock").getByRole("button", { name: "Chart context", exact: true });
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  const [triggerBox, initialRailBox, initialChartBox] = await Promise.all([
    trigger.boundingBox(),
    page.locator(".rail").boundingBox(),
    page.locator(".chart-wrap").first().boundingBox(),
  ]);
  expect(triggerBox).not.toBeNull();
  expect(initialRailBox).not.toBeNull();
  expect(initialChartBox).not.toBeNull();
  expect(triggerBox!.x).toBeGreaterThanOrEqual(initialRailBox!.x);
  expect(triggerBox!.x).toBeGreaterThanOrEqual(initialChartBox!.x + initialChartBox!.width);

  await trigger.click();

  const panel = page.getByRole("region", { name: "Chart context", exact: true });
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });

  const [panelBox, railBox, chartBox] = await Promise.all([
    panel.boundingBox(),
    page.locator(".rail").boundingBox(),
    page.locator(".chart-wrap").first().boundingBox(),
  ]);
  expect(panelBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(chartBox).not.toBeNull();

  expect(panelBox!.x).toBeGreaterThanOrEqual(railBox!.x);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width);
  expect(panelBox!.x).toBeGreaterThanOrEqual(chartBox!.x + chartBox!.width);
  await expect(page.locator(".wl-board")).toBeVisible();
  await expect(page.locator(".detail-board")).not.toBeVisible();

  await panel.getByRole("button", { name: "Close chart context", exact: true }).click();
  await expect(page.locator(".detail-board")).toBeVisible();
});

test("touch layouts keep chart context local to the chart", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 860, "Desktop uses the adjacent inspector rail.");

  await page.goto("/terminal?symbol=NVDA");
  const railTrigger = page.locator("#visual-context-trigger-dock").getByRole("button", { name: "Chart context", exact: true });
  await expect(railTrigger).toHaveCount(0);

  const trigger = page.getByRole("button", { name: "Chart context", exact: true });
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  const [triggerBox, chartBox] = await Promise.all([trigger.boundingBox(), page.locator(".chart-wrap").first().boundingBox()]);
  expect(triggerBox).not.toBeNull();
  expect(chartBox).not.toBeNull();
  expect(triggerBox!.x).toBeGreaterThanOrEqual(chartBox!.x);
  expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(chartBox!.x + chartBox!.width);

  await trigger.click();
  const panel = page.getByRole("region", { name: "Chart context", exact: true });
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });
  await expect(page.locator("#visual-context-panel-dock [data-visual-context-panel]")).toHaveCount(0);
});
