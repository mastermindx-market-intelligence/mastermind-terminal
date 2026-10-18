import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const ROOT = join(__dirname, "..");
const READY = readFileSync(
  join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "ready.json"),
  "utf8",
);
const UNAVAILABLE = readFileSync(
  join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "unavailable.json"),
  "utf8",
);
const COHORT_ROUTE = /\/api\/nw\?f=selection_cohort_us$/;

/** Measured on master c9d211fd, TERMINAL_E2E_FIXTURE, 2026-10-06 */
const MASTER_GRID_CLIENT_HEIGHT_1440x900 = 476;

async function gotoProphetWithCohort(
  page: import("@playwright/test").Page,
  body: string,
  status = 200,
) {
  await page.route(COHORT_ROUTE, (route) =>
    route.fulfill({ status, contentType: "application/json", body }));
  await page.goto("/options?tab=prophet");
  await page.locator(".obs-prophet-grid").waitFor({ state: "visible", timeout: 60_000 });
}

async function assertGridGeometry(page: import("@playwright/test").Page, popoverOpen: boolean) {
  const tile = page.getByTestId("selection-cohort-tile");
  if (popoverOpen) {
    await tile.click();
    await expect(page.getByTestId("selection-cohort-popover")).toBeVisible();
  }
  const metrics = await page.evaluate(() => {
    const grid = document.querySelector(".obs-prophet-grid");
    return {
      gridH: grid?.clientHeight ?? 0,
      scrollH: document.scrollingElement?.scrollHeight ?? 0,
      innerH: window.innerHeight,
    };
  });
  expect(Math.abs(metrics.gridH - MASTER_GRID_CLIENT_HEIGHT_1440x900)).toBeLessThanOrEqual(1);
  expect(metrics.scrollH).toBeLessThanOrEqual(metrics.innerH);
}

async function assertMastheadStatsOneRow(page: import("@playwright/test").Page) {
  const tops = await page.locator(".obs-prophet-stat").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().top),
  );
  expect(tops.length).toBeGreaterThan(0);
  const first = tops[0];
  for (const top of tops) {
    expect(Math.abs(top - first)).toBeLessThanOrEqual(1);
  }
}

test.describe("Selection cohort masthead tile (D2)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop") {
      test.skip();
    }
  });

  test("grid height matches master with tile closed and popover open", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoProphetWithCohort(page, READY);
    await page.getByTestId("selection-cohort-tile").waitFor({ state: "visible", timeout: 20_000 });
    await assertGridGeometry(page, false);
    await assertGridGeometry(page, true);
  });

  test("masthead stats share one offsetTop at 1200x800 and 1440x900", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoProphetWithCohort(page, READY);
    for (const size of [{ width: 1200, height: 800 }, { width: 1440, height: 900 }] as const) {
      await page.setViewportSize(size);
      await page.getByTestId("selection-cohort-tile").waitFor({ state: "visible", timeout: 20_000 });
      await assertMastheadStatsOneRow(page);
    }
  });

  test("popover keyboard, pointer, focus, and stacking", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoProphetWithCohort(page, READY);
    const tile = page.getByTestId("selection-cohort-tile");
    await tile.waitFor({ state: "visible", timeout: 20_000 });
    await expect(tile).toHaveAttribute("aria-expanded", "false");

    await tile.focus();
    await page.keyboard.press("Enter");
    const popover = page.getByTestId("selection-cohort-popover");
    await expect(popover).toBeVisible();
    const bg = await popover.evaluate((el) => getComputedStyle(el).backgroundColor);
    const alpha = (() => {
      const slash = bg.match(/\/\s*([\d.]+%?)\s*\)\s*$/);
      if (slash) return slash[1].endsWith("%") ? parseFloat(slash[1]) / 100 : parseFloat(slash[1]);
      const rgba = bg.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/);
      return rgba ? parseFloat(rgba[1]) : 1;
    })();
    expect(alpha, `popover background must be an opaque overlay surface, got ${bg}`).toBeGreaterThanOrEqual(0.95);
    await expect(tile).toHaveAttribute("aria-expanded", "true");

    const topHit = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="selection-cohort-popover"]');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return hit ? el.contains(hit) : false;
    });
    expect(topHit).toBe(true);

    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(tile).toHaveAttribute("aria-expanded", "false");
    await expect(tile).toBeFocused();

    await tile.focus();
    await page.keyboard.press("Space");
    await expect(popover).toBeVisible();
    await tile.click();
    await expect(popover).toBeHidden();

    await tile.click();
    await expect(popover).toBeVisible();
    await page.mouse.click(200, 500);
    await expect(popover).toBeHidden();
    await expect(tile).toBeFocused();
  });

  test("media switch: card at 1180, tile at 1440", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoProphetWithCohort(page, READY);
    await page.setViewportSize({ width: 1180, height: 820 });
    const card = page.getByTestId("selection-cohort-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("selection-cohort-tile-wrap")).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("selection-cohort-tile")).toBeVisible();
    await expect(card).toBeHidden();
  });

  test("unavailable fixture shows em dash on tile", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoProphetWithCohort(page, UNAVAILABLE);
    const tile = page.getByTestId("selection-cohort-tile");
    await tile.waitFor({ state: "visible", timeout: 20_000 });
    await expect(tile.locator("b")).toHaveText("—");
  });

  test("exactly one cohort API request per page load", async ({ page }) => {
    test.setTimeout(60_000);
    let hits = 0;
    await page.route(COHORT_ROUTE, (route) => {
      hits += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: READY });
    });
    for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }] as const) {
      hits = 0;
      await page.setViewportSize(size);
      await page.goto("/options?tab=prophet");
      const surface =
        size.width >= 1181
          ? page.getByTestId("selection-cohort-tile")
          : page.getByTestId("selection-cohort-card");
      await surface.waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(500);
      expect(hits).toBe(1);
    }
  });
});
