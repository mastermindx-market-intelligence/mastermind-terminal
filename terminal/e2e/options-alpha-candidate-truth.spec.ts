import { expect, test, type Page } from "@playwright/test";

async function openAlpha(page: Page) {
  await page.goto("/options?tab=prophet");
  await page.getByRole("tab", { name: /Options Alpha/ }).click();
}

async function rawTokensOutsideDetails(page: Page): Promise<string[]> {
  return page.getByTestId("options-alpha-candidate-panel").evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("details").forEach((node) => node.remove());
    return (clone.textContent ?? "").match(/[A-Z_]{12,}/g) ?? [];
  });
}

test("candidate panel shows no raw reason code outside details", async ({ page }, testInfo) => {
  await openAlpha(page);
  const panel = page.getByTestId("options-alpha-candidate-panel");
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Fixture mode answers 503 for the candidate feed and never forms a row.
  // Assert only that unavailable state: no candidate and no abstention.
  await expect(panel.getByTestId("options-alpha-candidate-unavailable")).toBeVisible();
  await expect(panel.getByTestId("options-alpha-candidate-item")).toHaveCount(0);
  await expect(panel.getByTestId("options-alpha-candidate-abstention")).toHaveCount(0);
  expect(await rawTokensOutsideDetails(page)).toEqual([]);

  await page.screenshot({
    path: testInfo.outputPath(`candidate-truth-${testInfo.project.name}-en.png`),
    fullPage: true,
  });

  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await expect(panel.getByRole("heading", { name: "候选历史" })).toBeVisible();
  expect(await rawTokensOutsideDetails(page)).toEqual([]);

  await page.screenshot({
    path: testInfo.outputPath(`candidate-truth-${testInfo.project.name}-zh.png`),
    fullPage: true,
  });
});
