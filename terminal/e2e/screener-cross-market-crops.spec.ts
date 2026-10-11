import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path, { join } from "node:path";

// Visual evidence for E03 (cross-market classification and currency-aware screening) — the crops
// committed under `docs/pr-crops/e03-cross-market-classification/`.
//
// OPT-IN, following the e2e/admin-log-crops.spec.ts precedent. It writes into the repo, so it must
// never run as part of `test:e2e:responsive`:
//
//   TERMINAL_E2E_PORT=47130 TERMINAL_CROPS=1 \
//     npx playwright test e2e/screener-cross-market-crops.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
//
// Terminal is dark-only, so the language pair is the axis that matters. The data are the same
// committed fixtures e2e/screener-cross-market.spec.ts asserts against, on the same pinned clock.

test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "e03-cross-market-classification");
mkdirSync(OUT, { recursive: true });

const MANIFEST = JSON.parse(readFileSync(path.join(__dirname, "../../tests/fixtures/classification/manifest.json"), "utf8"));
const SCAN = JSON.parse(readFileSync(path.join(__dirname, "../lib/__tests__/fixtures/screenerScan/classification.producer.json"), "utf8"));

async function open(page: Page, lang: "en" | "zh") {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00Z"));
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/data/scan/classification.json**", (route) => route.fulfill({ json: SCAN }));
  await page.goto("/discover?tab=screener");
  await expect(page.locator("tbody tr .sym-cell").first()).toBeVisible({ timeout: 60_000 });
}

async function shoot(page: Page, file: string) {
  const strip = page.locator("[data-cm-strip]");
  await expect(strip).toBeVisible();
  // On a phone the filter bar fills the first screen; start the crop at the strip so it shows the
  // strip and the rows it describes together.
  if (page.viewportSize()!.width <= 640) await strip.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no horizontal page scroll").toBeLessThanOrEqual(1);
  await page.screenshot({ path: join(OUT, file), animations: "disabled" });
}

for (const lang of ["en", "zh"] as const) {
  test(`native GICS screen with stale and unclassified counts — ${lang}`, async ({ page }, testInfo) => {
    await open(page, lang);
    await page.locator('select.scr2-select:has(option[value="hk"])').selectOption("us");
    await page.locator('[data-cm-control="taxonomy"]').selectOption("gics_sector");
    await page.locator('[data-cm-control="label"]').selectOption("Information Technology");
    await expect(page.locator('[data-cm-excluded="stale"]')).toBeVisible();
    await shoot(page, `${testInfo.project.name}-${lang}-gics-stale.png`);
  });

  test(`market change to Hong Kong — HKD scope, cleared market-cap floor — ${lang}`, async ({ page }, testInfo) => {
    await open(page, lang);
    await page.locator('select.scr2-select:has(option[value="2000000000"])').selectOption("2000000000");
    await page.locator('[data-cm-control="liq"]').selectOption("5000000");
    await page.locator('select.scr2-select:has(option[value="hk"])').selectOption("hk");
    await page.locator('[data-cm-control="taxonomy"]').selectOption("yahoo_sector");
    await expect(page.locator('[data-cm-cleared="mcap"]')).toBeVisible();
    await expect(page.locator('[data-cm="money"]')).toHaveAttribute("data-cm-scope", "HKD");
    await shoot(page, `${testInfo.project.name}-${lang}-hk-money.png`);
  });
}
