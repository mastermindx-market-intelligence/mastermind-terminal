import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const ROOT = join(__dirname, "..");
const READY = readFileSync(join(ROOT, "public", "data", "nw_selection_cohort_us_fixture.json"), "utf8");
const EMPTY = readFileSync(
  join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "empty.json"),
  "utf8",
);
const COHORT_ROUTE = /\/api\/nw\?f=selection_cohort_us$/;

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const card = page.getByTestId("selection-cohort-card");
  const prophet = page.locator(".obs-prophet").first();
  const cardBox = await card.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(cardBox.scrollWidth).toBeLessThanOrEqual(cardBox.clientWidth + 1);
  const prophetBox = await prophet.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(prophetBox.scrollWidth).toBeLessThanOrEqual(prophetBox.clientWidth + 1);
}

test.describe("Selection cohort card on Prophet Macro Plans", () => {
  test("ready fixture shows shared-theme context", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.route(COHORT_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: READY }));
    await page.goto("/options?tab=prophet");
    const card = page.getByTestId("selection-cohort-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "ready");
    await assertNoHorizontalOverflow(page);
    if (testInfo.project.name === "desktop") {
      const gridH = await page.locator(".obs-prophet-grid").evaluate((el) => el.clientHeight);
      expect(gridH).toBeGreaterThanOrEqual(360);
    }
  });

  test("503 feed -> unavailable", async ({ page }) => {
    test.setTimeout(60_000);
    await page.route(COHORT_ROUTE, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "feed unavailable" }),
      }));
    await page.goto("/options?tab=prophet");
    const card = page.getByTestId("selection-cohort-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "unavailable");
    await assertNoHorizontalOverflow(page);
  });

  test("empty selection -> empty state", async ({ page }) => {
    test.setTimeout(60_000);
    await page.route(COHORT_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: EMPTY }));
    await page.goto("/options?tab=prophet");
    const card = page.getByTestId("selection-cohort-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "empty");
    await assertNoHorizontalOverflow(page);
  });

  test("zh READY shows 共同主题", async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
    await page.route(COHORT_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: READY }));
    await page.goto("/options?tab=prophet");
    const card = page.getByTestId("selection-cohort-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText("共同主题");
    await assertNoHorizontalOverflow(page);
  });
});
