import { expect, test } from "@playwright/test";
import fixture from "../public/data/flow_fixture.json";

for (const lang of ["en", "zh"] as const) {
  test(`phone Tape keeps full print identity and opens only the inspected print (${lang})`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "Phone tape layout");
    const base = fixture.feed.events[0];
    const feed = { ...fixture.feed, events: [
      { ...base, id: "phone-one", root: "NVDA", strike: 147.5, exp: "2027-01-15", right: "C", size: 1234, premium: 2_300_000, dte: 123, repeated: true, vol_gt_oi: null, swept: true, side: "~buy", ts: "2026-07-06T17:15:00Z" },
      { ...base, id: "phone-two", root: "SPY", premium: 3_000_000, ts: "2026-07-06T16:10:00Z" },
    ] };
    await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "feed",
      route => route.fulfill({ json: feed }));
    await page.goto("/options?tab=tape");
    const scroll = page.locator(".scr-table").filter({ has: page.locator("[data-tape-print]") });
    const row = scroll.locator('[data-tape-print="phone-one"]');
    const rows = scroll.locator("tbody tr");
    const ticker = row.getByRole("button", { name: "NVDA", exact: true });
    const inspect = row.getByRole("button", { name: /147\.5C.*2027-01-15/ });
    await expect(rows).toHaveCount(2);
    await expect(ticker).toBeVisible();
    await expect(ticker.getByText("147.5C 01/15", { exact: true })).toBeVisible();
    await expect(row.getByText("13:15", { exact: true })).toBeVisible();
    await expect(row.getByText(lang === "zh" ? "~买入" : "~buy", { exact: true })).toBeVisible();
    await expect(row.locator("td").nth(9)).toContainText("$2.3M");
    await expect(row.getByText(lang === "zh" ? "1,234 张" : "1,234 ct", { exact: true })).toBeVisible();
    const premium = scroll.locator("th").filter({ hasText: lang === "zh" ? "权利金" : "Prem" });
    await premium.getByRole("button").click();
    await expect(rows.first()).toHaveAttribute("data-tape-print", "phone-two");
    await inspect.focus();
    await page.keyboard.press("Enter");
    await expect(inspect).toHaveAttribute("aria-expanded", "true");
    const details = row.locator("#options-print-phone-one");
    await expect(details.getByText("2027-01-15", { exact: true })).toBeVisible();
    await expect(details.getByText(lang === "zh" ? "重复" : "repeat", { exact: true })).toBeVisible();
    await expect(details.getByText(lang === "zh" ? "扫单" : "swept", { exact: true })).toBeVisible();
    await expect(details.getByText(lang === "zh" ? "成交量与持仓量比较不可用" : "Volume vs OI unavailable", { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(2);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(() => scroll.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      const box = (await inspect.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      const detailsBox = (await details.boundingBox())!;
      expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(width + 1);
    }
    await inspect.tap();
    await expect(inspect).toHaveAttribute("aria-expanded", "false");
    await ticker.tap();
    await expect(rows).toHaveCount(1);
    await expect(ticker).toHaveAttribute("aria-pressed", "true");
    await ticker.tap();
    await expect(rows).toHaveCount(2);
  });
}
