import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { settled } from "./settle";

// Visual evidence for E11 (Financials · Compare) — the crops committed under
// `docs/pr-crops/e11-fin-compare/`.
//
// OPT-IN, following the e2e/admin-log-crops.spec.ts precedent. It writes into the repo, so it must
// never run as part of `test:e2e:responsive`:
//
//   TERMINAL_E2E_PORT=47210 TERMINAL_CROPS=1 \
//     npx playwright test e2e/fin-compare-crops.spec.ts --workers=1
//
// Terminal is dark-only (no `[data-theme]` branch in globals.css), so the language pair is the
// axis that matters: every Compare string comes from lib/finCompareLex EN/ZH tuples. The numbers
// are the committed fund.json fixtures (copies of published files), not production reads.

test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(180_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "e11-fin-compare");
mkdirSync(OUT, { recursive: true });

const FIXTURES = join(process.cwd(), "lib", "__tests__", "fixtures", "fin-compare");
const PEERS = ["AMD", "INTC", "JPM", "0700.HK", "MSFT"];

async function open(page: Page, lang: "en" | "zh") {
  for (const sym of ["NVDA", ...PEERS]) {
    const body = JSON.parse(readFileSync(join(FIXTURES, `${sym}.fund.json`), "utf8"));
    const re = new RegExp(`/data/${sym.replace(/\./g, "\\.")}\\.fund\\.json(?:\\?.*)?$`);
    await page.route(re, (route) => route.fulfill({ json: body }));
  }
  await page.addInitScript((l) => {
    window.localStorage.setItem("mm.lang", l as string);
    window.localStorage.setItem("theme", "dark");
    window.localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-lang", l as string);
  }, lang);
  await page.goto("/analysis?symbol=NVDA&page=compare");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 60_000 });
  await expect(page.locator('[data-fc-state="ready"]')).toBeVisible({ timeout: 30_000 });
  const input = page.locator("#fc-add-peer");
  for (const sym of PEERS) {
    await input.fill(sym);
    await input.press("Enter");
    await expect(page.locator(`[data-fc-table="revenue"] tr[data-fc-row="${sym}"]`)).toHaveAttribute(
      "data-fc-row-state",
      "ready",
    );
  }
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

/** Wait for a box to stop moving before it is captured. */
async function steady(page: Page, selector: string) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await settled({
    read: async () => JSON.stringify(await el.boundingBox()),
    ok: (v) => !!v && v !== "null",
    same: (a, b) => a === b,
    message: `${selector} never stopped moving`,
  });
  return el;
}

for (const lang of ["en", "zh"] as const) {
  test(`compare crops · ${lang}`, async ({ page }, info) => {
    const tag = `${info.project.name}-${lang}`;
    await page.route(/\/data\/ZZZZ\.fund\.json(?:\?.*)?$/, (route) => route.fulfill({ status: 404, body: "not found" }));
    await open(page, lang);

    // 1. The top of the page: the Financials local tabs with Compare selected, and the controls.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(OUT, `${tag}-top.png`), animations: "disabled" });

    // 2. Fiscal-relative, annual: the industrial top line (JPM refused on format, 0700.HK on
    //    currency) and the family-neutral net income line (JPM compared).
    for (const metric of ["revenue", "net_income"]) {
      const table = await steady(page, `[data-fc-table="${metric}"]`);
      await table.screenshot({ path: join(OUT, `${tag}-fiscal-${metric}.png`), animations: "disabled" });
    }

    // 3. Calendar-aligned: relabelled columns, and MSFT's split June year left out.
    await page.locator('[data-fc-align-option="calendar"]').click();
    await expect(page.locator('[data-fc-table="revenue"] th[data-fc-col="CY2025"]')).toBeVisible();
    const calendar = await steady(page, '[data-fc-table="revenue"]');
    await calendar.screenshot({ path: join(OUT, `${tag}-calendar-revenue.png`), animations: "disabled" });
    await page.locator('[data-fc-align-option="fiscal"]').click();

    // 4. Source drilldown: AMD's latest FY revenue opens AMD's Statements on that column and row.
    await page.locator('[data-fc-cell="revenue:AMD:F0"]').click();
    const focus = page.locator('[data-fc-source] td[data-focus-cell="true"]');
    await expect(focus).toHaveCount(1);
    // As it lands: the source heading names the exact company and period (the pane scrolls smoothly).
    await steady(page, "[data-fc-source]");
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(OUT, `${tag}-source.png`), animations: "disabled" });
    if (info.project.name === "mobile") {
      // On a phone the highlighted cell sits one scroll below the heading; show it too.
      await focus.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
      await page.waitForTimeout(300); // let the smooth scroll start before sampling for rest
      await steady(page, '[data-fc-source] td[data-focus-cell="true"]');
      await page.screenshot({ path: join(OUT, `${tag}-source-cell.png`), animations: "disabled" });
    }
    await page.locator("[data-fc-close-source]").click();

    // 5. A peer with no published statements is a row state — no zero, no rank.
    await page.getByRole("button", { name: lang === "zh" ? "移除 MSFT" : "Remove MSFT" }).click();
    const input = page.locator("#fc-add-peer");
    await input.fill("ZZZZ");
    await input.press("Enter");
    await expect(page.locator('[data-fc-table="revenue"] tr[data-fc-row="ZZZZ"]')).toHaveAttribute("data-fc-row-state", "absent");
    await page.mouse.move(0, 0);
    const missing = await steady(page, '[data-fc-table="revenue"]');
    await missing.screenshot({ path: join(OUT, `${tag}-missing-peer.png`), animations: "disabled" });
  });
}
