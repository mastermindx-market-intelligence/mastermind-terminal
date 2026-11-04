import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { useLang } from "./layoutStore";

const bars = Array.from({ length: 260 }, (_, i) => {
  const close = 100 + i * 0.2 + Math.sin(i / 9) * 4;
  return [new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
    close - 0.6, close + 1.4, close - 1.2, close, 1000000 + i * 1000];
});

for (const lang of ["en", "zh"] as const) {
  const preference = lang === "zh" ? "en" : "zh";
  const contentLanguage = lang === "zh" ? "zh-CN" : "en";
  const documentLanguage = preference === "zh" ? "zh-CN" : "en";
  const rangeName = lang === "zh" ? "显示区间" : "Show range";

  async function checkLanguage(page: Page, info: TestInfo, phase: string) {
    const root = page.locator(".embed-root");
    const observed = await root.evaluate((node) => ({
      contentLanguage: node.closest("[lang]")?.getAttribute("lang"),
      documentLanguage: document.documentElement.lang,
      applicationLanguage: document.documentElement.dataset.lang,
      storedLanguage: localStorage.getItem("mm.lang"),
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await info.attach(`language-${phase}`, {
      body: Buffer.from(JSON.stringify(observed, null, 2)),
      contentType: "application/json",
    });
    expect(observed).toMatchObject({
      contentLanguage, documentLanguage,
      applicationLanguage: preference, storedLanguage: preference,
    });
    expect(observed.scrollWidth).toBe(observed.documentWidth);
  }

  async function capture(page: Page, info: TestInfo, phase: string) {
    const path = info.outputPath(`embed-${info.project.name}-${lang}-${phase}.png`);
    await page.screenshot({ path, animations: "disabled" });
    await info.attach(`embed-${phase}`, { path, contentType: "image/png" });
  }

  test(`embed ${lang} keeps its own language from loading through ready`, async ({ page }, info) => {
    await useLang(page, preference);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/data/NVDA.json", async (route) => {
      await pending;
      await route.fulfill({ json: { bars } });
    });
    try {
      await page.goto(`/embed/chart?symbol=nvda&lang=${lang}&theme=${lang === "zh" ? "light" : "dark"}&range=3M`);
      await expect(page.locator(".embed-skel")).toBeVisible();
      await expect(page.getByRole("navigation", { name: rangeName })).toBeVisible();
      await checkLanguage(page, info, "loading");
    } finally {
      release();
    }
    await expect(page.locator(".embed-chart-host canvas").first()).toBeVisible();
    await expect(page.locator(".embed-ticker")).toHaveText("NVDA");
    await expect(page.getByRole("button", { name: "3M", exact: true })).toHaveAttribute("aria-pressed", "true");
    const average = page.getByRole("button", { name: lang === "zh" ? "切换50日移动平均线" : "Toggle the 50-day moving average" });
    await average.click();
    await expect(average).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "1M", exact: true }).click();
    await expect(page.getByRole("button", { name: "1M", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".embed-attr")).toHaveAttribute("href", "https://app.mastermind-x.com/terminal?sym=NVDA&from=embed");
    await checkLanguage(page, info, "ready");
    await capture(page, info, "ready");
  });

  test(`embed ${lang} keeps its own language with no price history`, async ({ page }, info) => {
    await useLang(page, preference);
    await page.route("**/data/NVDA.json", (route) => route.fulfill({ json: { bars: [] } }));
    await page.goto(`/embed/chart?symbol=NVDA&lang=${lang}&theme=${lang === "zh" ? "dark" : "light"}`);
    await expect(page.locator(".embed-empty-title")).toHaveText(lang === "zh" ? "暂无图表数据" : "No chart data yet");
    await expect(page.locator(".embed-empty-body")).toContainText("NVDA");
    await expect(page.getByRole("link", { name: lang === "zh" ? "在终端打开" : "Open in Terminal" })).toHaveAttribute("href", "https://app.mastermind-x.com/terminal?sym=NVDA&from=embed");
    await checkLanguage(page, info, "empty");
    await capture(page, info, "empty");
  });

  test(`embed ${lang} keeps its own language for missing and invalid symbols`, async ({ page }, info) => {
    await useLang(page, preference);
    for (const [phase, symbolQuery] of [["missing", ""], ["invalid", "&symbol=bad%20symbol"]] as const) {
      await page.goto(`/embed/chart?lang=${lang}${symbolQuery}`);
      await expect(page.locator(".embed-empty-title")).toHaveText(lang === "zh" ? "请输入有效代码" : "Enter a valid symbol");
      await expect(page.locator(".embed-chart-host")).toHaveCount(0);
      await checkLanguage(page, info, phase);
    }
    await capture(page, info, "invalid");
  });
}
