import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { stubObservationsUnavailable } from "./prophetCaseFixtures";
import { stubRotationReadArrival } from "./prophetRotationReadFixtures";
import { rotationSpecimen, ROTATION_BANNED_WORDS } from "./prophetRotationSpecimens";
import { ROTATION_READ_COPY } from "../lib/prophetRotationRead";

const crops = process.env.PROPHET_ROTATION_CROPS;
const setupUrl = (symbol: string) => `/options?tab=prophet&prophetLane=sector&prophetView=setup&prophetGroup=us_sector_industrials&prophetSymbol=${symbol}`;

async function stubCompany(page: Page, symbol: string) {
  // Reuse the existing real BFF fixture; only identify the synthetic specimen's
  // company at the browser seam. No extra production endpoint or fixture flag.
  await page.route(url => url.pathname === "/api/prophet/sector-members" && url.searchParams.has("symbol"), async route => {
    const url = new URL(route.request().url()); url.searchParams.set("symbol", "ADP");
    const response = await route.fetch({ url: url.toString() });
    const data = await response.json();
    data.symbol = symbol;
    for (const entry of data.member_of ?? []) { entry.member.symbol = symbol; entry.member.name = symbol; }
    await route.fulfill({ response, json: data });
  });
  await stubObservationsUnavailable(page);
}
async function ready(page: Page) {
  await page.route(url => url.pathname === "/api/sector-intelligence" && url.searchParams.get("source") === "rotation_read",
    route => route.fulfill({ json: { data: rotationSpecimen(), receipt: { source: "rotation_read", status: "ready" } } }));
}
for (const lang of ["en", "zh"] as const) {
  for (const symbol of ["INTC", "CRM", "DUK", "CRSP"]) {
    test(`${symbol} breadth specimen (${lang})`, async ({ page }, testInfo) => {
      await page.addInitScript(code => localStorage.setItem("mm.lang", code), lang);
      await stubCompany(page, symbol); await ready(page);
      await page.goto(setupUrl(symbol));
      const block = page.getByTestId("rotation-read");
      await expect(block.getByTestId("rotation-row").first()).toBeVisible({ timeout: 30_000 });
      await expect(block).not.toContainText(ROTATION_BANNED_WORDS);
      await expect(block).toContainText(lang === "en" ? ROTATION_READ_COPY : "仅描述现状，不作预测");
      await expect(block.locator("a")).toHaveCount(0);
      await expect(block).toContainText(lang === "en" ? "Week ending Nov 6, 2026" : "截至 2026年11月6日 的一周");
      const visibleRows = block.getByTestId("rotation-row").filter({ visible: true });
      await expect(visibleRows).toHaveCount(symbol === "DUK" ? 1 : 3);
      await expect(visibleRows.first()).toContainText(lang === "en" ? "SECTOR" : "行业");
      if (symbol === "INTC") {
        await expect(visibleRows.first()).toContainText(lang === "en" ? "↗ Improving" : "↗ 改善");
        await expect(visibleRows.nth(2)).toContainText(lang === "en" ? "As of Oct 30, 2026" : "截至 2026年10月30日");
        await expect(visibleRows.nth(2)).toContainText("−6");
      }
      if (symbol === "CRM") {
        await expect(visibleRows.first()).toContainText(lang === "en" ? "↘ Deteriorating" : "↘ 走弱");
        await expect(visibleRows.nth(1)).toContainText(lang === "en" ? "→ Flat" : "→ 持平");
      }
      if (symbol === "CRSP") {
        await expect(visibleRows.nth(1)).toContainText(lang === "en" ? "Too few members to read" : "成员过少");
        await expect(visibleRows.nth(2)).toContainText(lang === "en" ? "Not available" : "暂不可用");
        for (const index of [1, 2]) {
          await expect(visibleRows.nth(index)).not.toContainText(/↗|↘|→/);
          await expect(visibleRows.nth(index)).toContainText("—");
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const tabsBottom = await page.getByTestId("case-tabs").evaluate(el => el.getBoundingClientRect().bottom);
      const blockTop = await block.evaluate(el => el.getBoundingClientRect().top);
      const firstSection = await page.getByTestId("case-unavailable").evaluate(el => el.getBoundingClientRect().top);
      expect(blockTop).toBeGreaterThanOrEqual(tabsBottom);
      expect(firstSection).toBeGreaterThan(blockTop);
      await expect(page.getByTestId("case-stance")).toHaveText(lang === "en" ? "Case not published yet" : "案例尚未发布");
      if (crops) {
        await block.screenshot({ path: path.join(crops, `${symbol.toLowerCase()}-${lang}-${testInfo.project.name}.png`) });
        if (symbol === "INTC") await page.screenshot({ path: path.join(crops, `setup-${lang}-${testInfo.project.name}.png`), fullPage: true });
      }
      const disclosure = block.getByRole("button");
      if (symbol === "INTC" || symbol === "CRM") {
        await expect(disclosure).toHaveText(new RegExp(symbol === "INTC" ? "\\+1" : "\\+2"));
        await expect(disclosure).toHaveAttribute("aria-expanded", "false");
        expect((await disclosure.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await disclosure.focus(); await page.keyboard.press("Enter");
        await expect(disclosure).toHaveAttribute("aria-expanded", "true");
        await expect(block.getByTestId("rotation-row").filter({ visible: true })).toHaveCount(symbol === "INTC" ? 4 : 5);
        await expect(block).not.toContainText(ROTATION_BANNED_WORDS);
        if (crops) await block.screenshot({ path: path.join(crops, `${symbol.toLowerCase()}-expanded-${lang}-${testInfo.project.name}.png`) });
        await page.keyboard.press("Space");
        await expect(disclosure).toHaveAttribute("aria-expanded", "false");
        await expect(disclosure).toBeFocused();
      } else await expect(disclosure).toHaveCount(0);
      await page.getByTestId("case-tab-context").click();
      await expect(block).toHaveCount(0);
      await page.getByTestId("case-tab-setup").click();
      await expect(page.getByTestId("rotation-read")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`prophetSymbol=${symbol}`));
    });
  }
}
for (const stage of ["missing_file", "stale", "unavailable", "signed_out", "unknown_source", "wrong_schema", "invalid_body", "not_entitled", "missing_ticker"] as const) {
  test(`whole read quiet: ${stage}`, async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
    await stubCompany(page, "INTC");
    if (["wrong_schema", "invalid_body", "not_entitled", "missing_ticker"].includes(stage)) {
      await page.route(url => url.pathname === "/api/sector-intelligence" && url.searchParams.get("source") === "rotation_read", route => {
        if (stage === "invalid_body") return route.fulfill({ status: 200, body: "not json" });
        if (stage === "not_entitled") return route.fulfill({ status: 403, json: { data: null } });
        const data = rotationSpecimen();
        return route.fulfill({ json: { data: stage === "wrong_schema" ? { ...data, schema: "other/v1" } : { ...data, companies: {} } } });
      });
    } else await stubRotationReadArrival(page, stage as Parameters<typeof stubRotationReadArrival>[1]);
    const response = page.waitForResponse(url => new URL(url.url()).searchParams.get("source") === "rotation_read");
    await page.goto(setupUrl("INTC"));
    await (await response).finished();
    const block = page.getByTestId("rotation-read");
    await expect(block).toHaveText("Sector and theme rotation · Not availableFrom Sector Intelligence", { timeout: 30_000 });
    await expect(block.getByTestId("rotation-row")).toHaveCount(0);
    await expect(block).not.toContainText(ROTATION_READ_COPY);
    await expect(block).not.toContainText(ROTATION_BANNED_WORDS);
    await expect(block.locator('button,a,[role="alert"]')).toHaveCount(0);
    if (crops && stage === "missing_file") await block.screenshot({ path: path.join(crops, `unavailable-en-${testInfo.project.name}.png`) });
  });
}
test("missing file lights up on foreground return without reload and clears on access loss", async ({ page }) => {
  await stubCompany(page, "INTC");
  let available = false;
  let entitled = true;
  await page.route(url => url.pathname === "/api/sector-intelligence" && url.searchParams.get("source") === "rotation_read", route =>
    route.fulfill({ status: !entitled ? 403 : available ? 200 : 404, json: { data: available && entitled ? rotationSpecimen() : null } }));
  await page.goto(setupUrl("INTC"));
  const block = page.getByTestId("rotation-read");
  await expect(block).toContainText("Not available");
  available = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(block).toContainText("↗ Improving");
  entitled = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(block).toContainText("Sector and theme rotation · Not available");
  await expect(block.getByTestId("rotation-row")).toHaveCount(0);
});
