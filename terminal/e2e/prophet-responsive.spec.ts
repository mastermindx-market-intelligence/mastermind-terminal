import { expect, test } from "./fixtures";

async function activeWorkspaceTabFits(page: import("@playwright/test").Page) {
  return page.locator(".wtabs").first().evaluate((nav) => {
    const active = nav.querySelector<HTMLElement>(".obs-pillnav-tab.on");
    if (!active) return false;
    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    return activeRect.left >= navRect.left - 1 && activeRect.right <= navRect.right + 1;
  });
}

test("Prophet keeps Macro Plans and Options Alpha separate at every contract viewport", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/options?tab=prophet");

  const navLabelsFit = await page.locator(".obs-pillnav-tab").evaluateAll((tabs) =>
    tabs.every((tab) => tab.scrollWidth <= tab.clientWidth + 1),
  );
  expect(navLabelsFit, "Options navigation labels must not overflow shrunken tabs").toBe(true);
  await expect.poll(() => activeWorkspaceTabFits(page)).toBe(true);

  const macroTab = page.getByRole("tab", { name: /Macro Plans/ });
  const optionsTab = page.getByRole("tab", { name: /Options Alpha/ });
  await expect(macroTab).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
  await expect(optionsTab).toHaveAttribute("aria-selected", "false");

  await optionsTab.click();
  await expect(optionsTab).toHaveAttribute("aria-selected", "true");
  const desk = page.getByTestId("options-alpha-desk");
  await expect(desk).toBeVisible({ timeout: 15_000 });
  await expect(desk).toContainText("Options-originated research");
  await expect(desk).toContainText("Display only");
  await expect(desk).toContainText("Macro feedback");
  await expect(desk).toContainText("Weight 0");
  await expect(desk).toContainText("Withheld until calibrated");
  await expect(desk).toContainText("Research fire · not an issued position");
  await expect(desk).toContainText("neither operator-issued nor automatic portfolio positions");
  await expect(desk).toContainText("2026-08-07T21:20:00.123456Z");
  await expect(desk).toContainText("Prospective accrual");
  await expect(desk).toContainText("Konseki Market Memory");
  await expect(desk).toContainText("Context only · weight 0");
  await expect(page.getByTestId("options-alpha-horizon-1h")).toContainText("Not instrumented");
  await expect(page.getByTestId("options-alpha-horizon-5d")).toContainText("Legacy clocks");
  await expect(desk).toContainText("Flow Leader");
  await expect(desk).toContainText("Flow Washout");
  await expect(page.getByTestId("options-alpha-fire")).toHaveCount(1);
  await expect(page.getByTestId("options-alpha-execution-withheld")).toContainText("Contract / strike / expiry");
  await expect(page.getByTestId("options-alpha-execution-withheld")).toContainText("Withheld · null");
  await expect(page.getByTestId("options-alpha-watch")).toHaveCount(2);
  await expect(page.getByTestId("options-alpha-ledger-row")).toHaveCount(2);
  const researchQueue = page.getByTestId("options-alpha-research-queue");
  await expect(researchQueue).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("options-alpha-watch").first()).not.toBeVisible();

  const sectionOrder = await page.locator("[data-testid='options-alpha-fires-section'], [data-testid='options-alpha-accrual'], [data-testid='options-alpha-readiness']")
    .evaluateAll((nodes) => nodes.map((node) => ({
      id: node.getAttribute("data-testid"),
      top: node.getBoundingClientRect().top,
    })));
  expect(sectionOrder.find((item) => item.id === "options-alpha-fires-section")?.top)
    .toBeLessThan(sectionOrder.find((item) => item.id === "options-alpha-accrual")?.top ?? Infinity);
  expect(sectionOrder.find((item) => item.id === "options-alpha-fires-section")?.top)
    .toBeLessThan(sectionOrder.find((item) => item.id === "options-alpha-readiness")?.top ?? Infinity);

  const containment = await page.locator(".obs-prophet-lane-shell").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(containment.scrollWidth).toBeLessThanOrEqual(containment.clientWidth + 1);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-prophet-options-alpha.png`),
    fullPage: false,
  });

  await researchQueue.locator("summary").click();
  await expect(researchQueue).toHaveAttribute("open", "");
  await expect(page.getByTestId("options-alpha-watch").first()).toBeVisible();
  await expect(researchQueue).toContainText("Minute tick");
  await expect(researchQueue).toContainText("Flow z · magnitude only");
  await expect(researchQueue).toContainText("Not reliable · magnitude only");
  await expect(researchQueue).toContainText("Board A #2");

  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await expect(desk).toContainText("期权原生研究");
  await expect(desk).toContainText("校准完成前暂不发布");
  await expect(desk).toContainText("资金流 z · 仅强度");
  await expect(desk).toContainText("分钟级成交");
  await expect(desk).toContainText("研究触发 · 非已发布持仓");
  await expect(desk).toContainText("仅作背景 · 权重 0");
  await expect.poll(() => activeWorkspaceTabFits(page)).toBe(true);
  for (const englishReceipt of [
    "Options-flow context is available",
    "Directional signing history is still accruing",
    "No take-profit time or exit window",
    "The matched Macro-versus-options attribution cohort",
    "Recurring premium concentration cleared",
    "Fixture evidence exercises",
  ]) {
    await expect(desk).not.toContainText(englishReceipt);
  }
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-prophet-options-alpha-zh.png`),
    fullPage: false,
  });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "en");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await expect(optionsTab).toContainText("Options Alpha");
  await expect.poll(() => activeWorkspaceTabFits(page)).toBe(true);

  await macroTab.click();
  await expect(macroTab).toHaveAttribute("aria-selected", "true");
  const geometryRail = page.getByTestId("geometry-rail").first();
  await expect(geometryRail).toBeVisible({ timeout: 15_000 });
  const labels = geometryRail.getByTestId("geometry-label");
  await expect(labels.first()).toBeVisible({ timeout: 15_000 });
  const boxes = (await labels.evaluateAll((nodes) => nodes
    .filter((node) => (node as HTMLElement).offsetParent !== null)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, label: node.getAttribute("data-level") };
    }))).sort((a, b) => a.top - b.top);
  expect(boxes.length).toBeGreaterThanOrEqual(4);
  for (let index = 1; index < boxes.length; index++) {
    expect(
      boxes[index].top,
      `${boxes[index - 1].label} and ${boxes[index].label} geometry labels must not overlap`,
    ).toBeGreaterThanOrEqual(boxes[index - 1].bottom - 0.5);
  }

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-prophet-geometry.png`),
    fullPage: false,
  });
});

test("Options Alpha visibly marks an API-served stale artifact", async ({ page }) => {
  await page.route("**/api/flow?f=options_prophet_idx", async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as Record<string, unknown>;
    await route.fulfill({ response, json: { ...payload, stale: true } });
  });

  await page.goto("/options?tab=prophet");
  await page.getByRole("tab", { name: /Options Alpha/ }).click();
  const warning = page.getByTestId("options-alpha-stale");
  await expect(warning).toBeVisible({ timeout: 15_000 });
  await expect(warning).toContainText("Cached or aged evidence");
  await expect(warning).toContainText("stale research context");
});
