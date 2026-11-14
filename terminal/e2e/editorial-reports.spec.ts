import { expect, test } from "@playwright/test";

// Supply an archive from the existing Macro builder to the host's exact public
// manifest URL during a qualification run. The application has no fixture switch.
test.skip(process.env.MMX_EDITORIAL_REPORTS_PROOF !== "1", "Requires the published archive or its server-side fixture");
test("published editorial archive restores search, all topics and sort in either language", async ({ page }) => {
  await page.goto("/research/reports?sort=old#reportList");
  const main = page.locator("main#shared-shell-content");
  await expect(main.getByRole("heading", { name: "Research Reports", exact: true })).toBeVisible();
  const rows = main.locator("#reportList a");
  await expect(rows.first()).toHaveAttribute("href", /^https:\/\/www\.mastermind-x\.com\/report_[a-z0-9_]+\.html$/);
  const excerpt = await rows.first().locator("p").innerText();
  await main.getByRole("searchbox").fill(excerpt);
  await expect(rows).toHaveCount(1);
  const topic = main.locator("#tagBar button").nth(1);
  await topic.click();
  await expect(page).toHaveURL(/tag=/);
  await page.goBack();
  await expect(main.locator("#repSort")).toHaveValue("old");
  await expect(main.locator("#repSearch")).toHaveValue(excerpt);
  await expect(rows).toHaveCount(1);
  await main.getByRole("searchbox").focus();
  await page.keyboard.press("Escape");
  await expect(main.getByRole("searchbox")).toHaveValue("");
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  await main.getByRole("searchbox").fill("query-with-no-editorial-results");
  await expect(main.locator("#noResults")).toBeVisible();
  await main.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows).toHaveCount(count);
  await expect(main.locator("#repSort")).toHaveValue("old");
  await page.getByRole("button", { name: "Chinese language", exact: true }).click();
  await expect(main.getByRole("heading", { name: "研究报告", exact: true })).toBeVisible();
  await expect(main.getByRole("searchbox")).toHaveAttribute("aria-label", "搜索报告");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
