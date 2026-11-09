import { expect, test } from "@playwright/test";

test("stock analysis reads the exact ticker from the Options Hub and displays its source date", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL! }]);
  const legacyReads: string[] = [];
  let sourceSession = "2026-10-30";
  page.on("request", request => {
    if (/\/data\/NVDA\.opts\.json(?:\?|$)/.test(request.url())) legacyReads.push(request.url());
  });
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "vol:NVDA",
    route => route.fulfill({ json: {
      schema: "options_hub.vol/v1", root: "NVDA", asof: sourceSession, stale: sourceSession === "2026-10-30",
      term: [{ exp: "2026-11-27", dte: 28, atm_iv: 32.05 }],
      smile: [],
    } }));
  const response = await page.goto("/terminal?symbol=NVDA");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/terminal\?symbol=NVDA$/);
  await expect(page.locator(".detail-scroll .sa-iv-asof").first()).toContainText("2026-10-30", { timeout: 45_000 });
  await expect(page.locator(".detail-scroll .sa-iv-asof").first()).toContainText(/Cached after a feed error|显示缓存/);
  sourceSession = "2026-11-02";
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".detail-scroll .sa-iv-asof").first()).toContainText(sourceSession);
  expect(legacyReads).toEqual([]);
});
