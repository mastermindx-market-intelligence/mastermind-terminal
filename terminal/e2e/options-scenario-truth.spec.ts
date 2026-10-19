import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Real /options?tab=positioning route, same entry as options-positioning-card-titles.
// PositioningView's default root is SPY. gex_fixture.json gives that root a vanna lens
// on every strike, finite gamma on every strike, by_strike_full_n equal to the ladder
// (not a window), and a stated dealer-sign convention. The grid therefore keeps the
// five measured IV rows. This spec does not add fixture rows.

type Strike = { gamma_net?: number | null; vanna_net?: number | null };
type GexRoot = {
  convention?: string | null;
  by_strike?: Strike[];
  by_strike_full_n?: number | null;
};

const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, "..", "public", "data", "gex_fixture.json"), "utf8"),
) as Record<string, GexRoot>;

const spy = FIXTURE.SPY;
const strikes = spy?.by_strike ?? [];
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const known = strikes.filter((r) => finite(r.gamma_net)).length;
const offered = strikes.length;
const full = typeof spy?.by_strike_full_n === "number" && spy.by_strike_full_n > 0 ? spy.by_strike_full_n : null;
const windowed = full != null && full > offered;
const hasVanna = strikes.some((r) => finite(r.vanna_net));
const convention = typeof spy?.convention === "string" && spy.convention.length > 0 ? spy.convention : null;

const COPY = {
  en: {
    title: "Hedge-flow scenarios",
    conventionLabel: "Convention",
    unstated: "not stated",
    coverage: windowed
      ? `Built from ${known} of ${offered} strikes with gamma data; the ladder is a window over ${full} strikes.`
      : `Built from ${known} of ${offered} strikes with gamma data.`,
    notInterval: "not a probability interval",
  },
  zh: {
    title: "对冲流量情景",
    conventionLabel: "约定",
    unstated: "未说明",
    coverage: windowed
      ? `由 ${offered} 个行权价中具备伽马数据的 ${known} 个构建；该梯图是 ${full} 个行权价上的一个窗口。`
      : `由 ${offered} 个行权价中具备伽马数据的 ${known} 个构建。`,
    notInterval: "不是概率区间",
  },
} as const;

async function openPositioning(page: Page, lang: "en" | "zh") {
  await page.addInitScript((locale) => {
    localStorage.setItem("mm.lang", locale);
    document.documentElement.setAttribute("data-lang", locale);
    document.documentElement.setAttribute("lang", locale === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto("/options?tab=positioning");
}

for (const lang of ["en", "zh"] as const) {
  test(`scenario grid states coverage and the sign convention (${lang})`, async ({ page }, testInfo) => {
    const copy = COPY[lang];
    await openPositioning(page, lang);

    const coverage = page.getByTestId("msc-scenario-coverage");
    await expect(coverage).toBeVisible({ timeout: 20_000 });
    await expect(coverage).toHaveText(copy.coverage);

    const card = coverage.locator("xpath=ancestor::section[1]");
    await expect(card.getByText(copy.title, { exact: true })).toBeVisible();
    const conventionLine = convention
      ? `${copy.conventionLabel}: ${convention}`
      : `${copy.conventionLabel}: ${copy.unstated}`;
    await expect(card).toContainText(conventionLine);
    await expect(card).toContainText(copy.notInterval);
    await expect(card.locator("tbody tr")).toHaveCount(hasVanna ? 5 : 1);

    await card.scrollIntoViewIfNeeded();
    await card.screenshot({
      path: testInfo.outputPath(`scenario-${testInfo.project.name}-${lang}.png`),
    });
  });
}
