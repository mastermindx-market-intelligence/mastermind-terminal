import { expect, test } from "@playwright/test";

test("Positioning heat matrix has no unnamed table headers", async ({ page }, testInfo) => {
  await page.goto("/options?tab=positioning");

  const card = page.locator("section").filter({
    has: page.getByRole("group", { name: "Heat metric", exact: true }),
  });
  await expect(card).toHaveCount(1);
  const table = card.locator("table");
  await expect(table.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 });

  for (const metric of ["Net hedge", "OI", "Volume", "ΔOI"]) {
    await card.getByRole("button", { name: metric, exact: true }).click();
    const headers = table.locator("th");
    expect(await headers.count()).toBeGreaterThan(0);
    const unnamed = await headers.evaluateAll((nodes) => nodes
      .filter((node) => !(node.textContent?.trim() || node.getAttribute("aria-label")?.trim()))
      .map((node) => node.outerHTML));
    expect(unnamed).toEqual([]);
  }

  const screenshotPath = testInfo.outputPath("positioning-matrix-header.png");
  await card.screenshot({ path: screenshotPath });
  await testInfo.attach("positioning-matrix-header", {
    path: screenshotPath,
    contentType: "image/png",
  });
  console.log("POSITIONING_MATRIX_HEADER_PROOF", JSON.stringify({
    project: testInfo.project.name,
    retry: testInfo.retry,
    viewport: page.viewportSize(),
    metrics: ["Net hedge", "OI", "Volume", "ΔOI"],
    unnamedHeaders: [],
    screenshot: "positioning-matrix-header.png",
  }));
});

