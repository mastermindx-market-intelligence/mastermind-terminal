import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// E02 visual evidence: the crops committed under `docs/pr-crops/e02-fundamental-screening/`,
// and the one REAL input → screen → statement drilldown.
//
// OPT-IN. It writes into the repo and reads a real generation from outside it, so it never runs
// as part of `test:e2e:responsive`:
//
//   node scripts/dist/gen_fundamental_scan.mjs --data-dir <dir>   # real fund.json + manifest.json
//   rm -rf .next && TERMINAL_E2E_PORT=47120 TERMINAL_CROPS=1 E02_REAL_DIR=<dir> \
//     npx playwright test e2e/screener-fundamental-crops.spec.ts --project=desktop --project=tablet --project=mobile
//
// `<dir>` holds production `manifest.json`, a sample of production `<SYM>.fund.json` files and
// the `scan/fundamental.json` the real generator wrote from them. Nothing here is synthesized:
// the screen, the evidence drawer and the statements page all read those files. Symbols whose
// fund.json is not in the sample are honestly `fund_absent` in that generation.

const REAL = process.env.E02_REAL_DIR ?? "";
test.skip(!process.env.TERMINAL_CROPS || !REAL, "Crop generator — set TERMINAL_CROPS=1 and E02_REAL_DIR to write PR artifacts.");
test.setTimeout(180_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "e02-fundamental-screening");
// The generation's own wall clock (generated_at 2026-10-11T00:00:00Z) — freshness is judged as
// it would have been the day it was published.
const NOW = new Date("2026-10-11T12:00:00Z");

const shot = (page: Page, name: string, lang: string, testInfo: TestInfo) =>
  page.screenshot({ path: join(OUT, `${name}-${lang}-${testInfo.project.name}.png`), fullPage: false, animations: "disabled" });

async function serveReal(page: Page, lang: "en" | "zh") {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  const file = (rel: string) => join(REAL, rel);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ path: file("manifest.json"), contentType: "application/json" }));
  await page.route("**/data/coverage.json**", (route) => route.fulfill({ status: 404, json: { error: "not found" } }));
  await page.route("**/data/scan/fundamental.json**", (route) =>
    route.fulfill({ path: file("scan/fundamental.json"), contentType: "application/json" }),
  );
  await page.route(/\/data\/[^/?]+\.fund\.json/, (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    const p = file(name);
    return existsSync(p) && !name.includes("..")
      ? route.fulfill({ path: p, contentType: "application/json" })
      : route.fulfill({ status: 404, json: { error: "not found" } });
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] real generation: screen → AAPL evidence → statements`, async ({ page }, testInfo) => {
    mkdirSync(OUT, { recursive: true });
    const scan = JSON.parse(readFileSync(join(REAL, "scan/fundamental.json"), "utf8"));
    const aapl = scan.rows.find((r: { sym: string }) => r.sym === "AAPL");
    expect(aapl?.status).toBe("observed");
    await serveReal(page, lang);

    await page.goto("/discover?tab=screener");
    await expect(page.locator("tbody tr .sym-cell").first()).toBeVisible({ timeout: 90_000 });
    await page.locator("[data-fund-toggle]").click();
    await expect(page.locator("[data-fund-scan]")).toHaveAttribute("data-fund-scan", "ready", { timeout: 30_000 });

    await page.locator("[data-fund-field-select]").selectOption("fund.net_margin_fy");
    await page.locator("[data-fund-min]").fill("20");
    await page.locator("[data-fund-commit]").click();
    await expect(page.locator("[data-fund-tally]")).toBeVisible();

    const row = page.locator("tbody tr", { has: page.locator(".sym-cell", { hasText: "Apple" }) });
    const cell = row.locator('[data-fund-cell="fund.net_margin_fy"]');
    // AC-E02-01 on a real artifact: 0.269151 is 26.9%, not 0.27% and not 2691%
    await expect(cell).toHaveText("26.9%");
    await cell.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await shot(page, "screen", lang, testInfo);

    await cell.click();
    const drawer = page.locator('[data-fund-evidence="AAPL"]');
    await expect(drawer.locator("[data-fund-ev-end]")).toHaveAttribute("data-fund-ev-end", aapl.fy.end);
    await expect(drawer.locator("[data-fund-ev-asof]")).toHaveAttribute("data-fund-ev-asof", aapl.asof);
    await expect(drawer.locator('[data-fund-ev-field="fund.net_margin_fy"]')).toHaveAttribute("data-fund-ev-same", "same");
    await expect(drawer.locator('[data-fund-ev-same="differs"]')).toHaveCount(0);
    await shot(page, "evidence", lang, testInfo);

    await drawer.locator("[data-fund-ev-statements]").click();
    await expect(page).toHaveURL(/\/terminal\?pane=statements&sym=AAPL/, { timeout: 30_000 });
    await expect(page.locator(".fin-doc-per").filter({ hasText: aapl.fy.label }).first()).toBeVisible({ timeout: 90_000 });
    await page.mouse.move(0, 0);
    await shot(page, "statements", lang, testInfo);
  });
}
