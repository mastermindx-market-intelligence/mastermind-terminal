import { expect, test } from "@playwright/test";

// Real /options?tab=positioning route + real PositioningView/MarketStructureBody/HedgingCards.
// Only the /api/flow payloads are synthetic. We assert the snapshot hedge-sensitivity card's
// semantics — title, contract-strike axis, "+1% spot" caption, and coverage accounting where a
// zero greek stays KNOWN while a null/missing greek is excluded (partial 2/3). A QQQ revision
// then exercises a fresh fetch of the same card (3/3 distinct values, new date) untouched cache.
const SPY_DATE = "2026-10-01";
const QQQ_DATE = "2026-10-02";
const QQQ_REV_DATE = "2026-10-03";
const row = (strike: number, gamma_net: number | null, gamma_call: number, gamma_put: number) =>
  ({ strike, gamma_net, gamma_call, gamma_put });

const SPY_GEX = {
  root: "SPY", spot_ref: 100, asof: `${SPY_DATE}T20:00:00Z`,
  call_wall: 105, put_wall: 95, gamma_flip: 100,
  // 95 and 100 are KNOWN (100 is a legitimate ZERO); 105 is MISSING (null) → 2/3 supplied.
  by_strike: [row(95, -800, -900, 100), row(100, 0, 0, 0), row(105, null, 1210, -210)],
};
// full ladder: all three greeks known, distinct, at distinct strikes → 3/3.
const QQQ_BY_STRIKE = [row(395, 500, 400, 100), row(400, -750, -500, -250), row(405, 1250, 900, 350)];

for (const lang of ["en", "zh"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`positioning snapshot hedges (${lang}/OS-${theme})`, async ({ page }, info) => {
      const T = (en: string, zh: string) => (lang === "en" ? en : zh);
      const title = T("Snapshot hedge sensitivity by strike", "按行权价的快照对冲敏感度");
      const axis = T("Contract strike", "合约行权价");
      const perUnit = T("USD mn per +1% spot", "百万美元 / 标的 +1%");
      const cov23 = T("2/3 supplied rows known", "已知 2/3 条输入");
      const cov33 = T("3/3 supplied rows known", "已知 3/3 条输入");
      const partial = T("Partial snapshot · missing values excluded", "部分快照 · 缺失数值未计入");
      const spyDate = T(`Nightly EOD · as of ${SPY_DATE}`, `每日收盘 · 截至 ${SPY_DATE}`);
      const qqqDate = T(`Nightly EOD · as of ${QQQ_DATE}`, `每日收盘 · 截至 ${QQQ_DATE}`);
      const qqqRevDate = T(`Nightly EOD · as of ${QQQ_REV_DATE}`, `每日收盘 · 截至 ${QQQ_REV_DATE}`);

      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((cfg: { lang: string; theme: string }) => {
        localStorage.setItem("mm.lang", cfg.lang);
        document.documentElement.setAttribute("data-lang", cfg.lang);
      }, { lang, theme });

      const fetches: string[] = [];
      let qqqRev = 0;
      await page.route("**/api/flow?**", (route) => {
        const f = new URL(route.request().url()).searchParams.get("f") ?? "";
        fetches.push(f);
        if (f === "gex:SPY") return route.fulfill({ json: SPY_GEX });
        if (f === "gex:QQQ") {
          qqqRev += 1;
          const asof = qqqRev >= 2 ? `${QQQ_REV_DATE}T20:00:00Z` : `${QQQ_DATE}T20:00:00Z`;
          return route.fulfill({ json: { root: "QQQ", spot_ref: 400, asof, call_wall: 405, put_wall: 395, gamma_flip: 400, by_strike: QQQ_BY_STRIKE } });
        }
        // moves:SPY / moves:QQQ and every optional store (agg, matrix, quad, grades, …) empty.
        return route.fulfill({ json: {} });
      });

      await page.goto("/options?tab=positioning");
      // Terminal is dark-only; OS preference must not override it.
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.locator("#wtab-positioning")).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#msc-panel-body")).toBeVisible({ timeout: 30_000 });

      // Deepest element holding both the card title and the given coverage line = the card root.
      const card = (foot: string) =>
        page.locator(`xpath=//*[contains(., "${title}") and contains(., "${foot}")]`).last();

      const spyCard = card(cov23);
      await expect(spyCard).toBeVisible({ timeout: 30_000 });
      await expect(spyCard).toContainText(title);
      await expect(spyCard).toContainText(axis);
      await expect(spyCard).toContainText(perUnit);
      await expect(spyCard).toContainText(cov23);
      await expect(spyCard).toContainText(partial);
      await expect(page.locator("body")).toContainText(spyDate);
      await spyCard.screenshot({ path: info.outputPath(`${info.project.name}-${lang}-${theme}-hedges-partial.png`) });

      // QQQ revision: brand-new payload, 3/3 distinct values, new as-of date.
      const rootInput = page.locator('input[list="msc-roots"]');
      await rootInput.fill("QQQ");
      await rootInput.press("Enter");
      await expect(card(cov33)).toBeVisible({ timeout: 30_000 });
      await expect(card(cov33)).toContainText(cov33);
      await expect(page.getByText(partial)).toHaveCount(0);
      await expect(page.locator("body")).toContainText(qqqDate);

      // Reload → fresh document, same fetch path re-runs and returns the revised data; the
      // test mutates no cache, it only observes the app's existing fresh-fetch behaviour.
      await page.reload();
      await expect(page.locator("#msc-panel-body")).toBeVisible({ timeout: 30_000 });
      await rootInput.fill("QQQ");
      await rootInput.press("Enter");
      await expect(card(cov33)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("body")).toContainText(qqqRevDate);
      expect(fetches.filter((f) => f === "gex:QQQ").length).toBeGreaterThanOrEqual(2);
    });
  }
}
