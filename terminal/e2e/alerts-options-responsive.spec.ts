import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const MANIFEST = {
  symbols: {
    SPY: { name: "SPDR S&P 500 ETF", last: 701.25, regimeBull: true },
    QQQ: { name: "Invesco QQQ", last: 620.4, regimeBull: true },
  },
};
const EVIDENCE = process.env.ALERTS_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "..", "docs", "pr-crops", "options-alert-source-truth");

test.beforeAll(() => {
  if (EVIDENCE) mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("covered-tape options alerts stay honest and contained", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  let posted: Record<string, unknown> | null = null;

  await page.addInitScript((lang) => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement.setAttribute("data-lang", lang);
  }, zh ? "zh" : "en");
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/alerts", async (route) => {
    if (route.request().method() === "POST") {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          alert: {
            id: "market-burst",
            active: true,
            created_at: "2026-08-11T15:00:00Z",
            ...(posted as object),
          },
        },
      });
      return;
    }
    await route.fulfill({ json: { alerts: [] } });
  });

  await page.goto("/alerts");
  // The category select exists in the server-rendered markup before React attaches its handler, so
  // a fast `selectOption` can change the DOM value while `cat` state never moves — the options
  // sub-form then never renders and the failure reads as "element not found". /alerts hydrates
  // through a lazy boundary since #431, which widens that window enough for a cold route compile
  // to lose the race. Retry the USER ACTION until the app responds to it.
  const kind = page.locator('select:has(option[value="opt_premium_burst"])');
  await expect(async () => {
    await page.locator(".alert-form > select").first().selectOption("options");
    await expect(kind).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator('.alert-form select:has(option[value="SPY"])')).toHaveCount(1);

  await kind.selectOption("opt_premium_burst");
  await expect(page.locator('.alert-form select:has(option[value="SPY"])')).toHaveCount(0);
  await expect(page.locator(".opt-preview-txt")).toContainText(zh ? "覆盖范围内" : "covered options tape");
  await page.locator(".alert-form button").click();

  await expect.poll(() => posted).not.toBeNull();
  expect(posted).toMatchObject({
    symbol: "MARKET",
    condition: { type: "opt_premium_burst", root: "MARKET", leg: "ncp" },
  });
  await expect(page.locator(".arow .tk")).toHaveText("MARKET");
  await expect(page.locator(".arow .cond")).toContainText(zh ? "覆盖范围内" : "covered options tape");

  const containment = await page.evaluate(() => {
    const form = document.querySelector<HTMLElement>(".alert-form");
    const inputs = [...document.querySelectorAll<HTMLElement>(".alert-form select, .alert-form input, .alert-form button")];
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      formClientWidth: form?.clientWidth ?? 0,
      formScrollWidth: form?.scrollWidth ?? 0,
      minControlHeight: Math.min(...inputs.map((node) => node.getBoundingClientRect().height)),
    };
  });
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewport + 1);
  expect(containment.formScrollWidth).toBeLessThanOrEqual(containment.formClientWidth + 1);
  expect(containment.minControlHeight).toBeGreaterThanOrEqual(32);

  const name = `${testInfo.project.name}-${zh ? "zh" : "en"}-market-wide.png`;
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: false });
  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE_DIR, name), fullPage: false });
});
