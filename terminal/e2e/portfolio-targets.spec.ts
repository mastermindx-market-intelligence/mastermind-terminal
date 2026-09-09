import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";

test.setTimeout(120_000);

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", zh: "英伟达", col: "#76b900", last: 175, chg: 1.2 },
    AAPL: { name: "Apple", zh: "苹果", col: "#8e8e93", last: 228.1, chg: -0.4 },
  },
};
const QUOTES = { quotes: { NVDA: { last: 180, chg: 2.5 }, AAPL: { last: 228, chg: 0 } } };

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh = false) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    document.documentElement.setAttribute("data-lang", useZh ? "zh" : "en");
    document.documentElement.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, zh);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: QUOTES }));
  await page.route("**/api/portfolio-brief", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ tier: "free" }) }));
}

async function seedPosition(page: Page, draft: { ticker: string; shares: string; entryPrice: string }) {
  const response = await page.request.post("/api/portfolio", { data: { action: "create", ...draft } });
  expect(response.ok(), `seeding ${draft.ticker} failed: ${response.status()}`).toBe(true);
  return (await response.json()).position as { id: string; ticker: string };
}

const section = (page: Page) => page.getByTestId("portfolio-targets");
const card = (page: Page, ticker: string) => section(page).locator(`[data-ticker='${ticker}']`).first();

test("a signed-in user sets a target on a held position and sees the gap computed", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await page.goto("/portfolio");
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await expect(section(page)).toContainText("Your targets vs. what you hold");
  await expect(page.getByTestId("targets-untargeted")).toContainText("NVDA");

  await page.getByLabel("Target weight for NVDA, percent").fill("80");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "outside_band", { timeout: 15_000 });
  await expect(card(page, "NVDA")).toContainText("Outside your band");
  await expect(card(page, "NVDA")).toContainText("+20 pts");
  await expect(card(page, "NVDA")).toContainText("Saved");
});

test("editing the band changes a holding's status between inside and outside", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await page.goto("/portfolio");
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Target weight for NVDA, percent").fill("95");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "within_band", { timeout: 15_000 });
  await expect(card(page, "NVDA")).toContainText("Inside your band");

  await page.getByLabel("Band for NVDA, percentage points").fill("4");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "outside_band", { timeout: 15_000 });
  await expect(card(page, "NVDA")).toContainText("Outside your band");
});

test("clearing a target returns the holding to the untargeted list", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await page.goto("/portfolio");
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Target weight for NVDA, percent").fill("80");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "outside_band", { timeout: 15_000 });
  await card(page, "NVDA").getByRole("button", { name: "Clear target" }).click();
  await expect(page.getByTestId("targets-untargeted")).toContainText("NVDA", { timeout: 15_000 });
  await expect(section(page).locator("[data-status='outside_band']")).toHaveCount(0);
});

test("closing the underlying position surfaces its target as orphaned, not deleted", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const nvda = await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await seedPosition(page, { ticker: "AAPL", shares: "10", entryPrice: "200" });
  await page.goto("/portfolio");
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Target weight for NVDA, percent").fill("80");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "outside_band", { timeout: 15_000 });

  const closed = await page.request.post("/api/portfolio", { data: { action: "close", id: nvda.id } });
  expect(closed.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId("targets-orphaned")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("targets-orphaned")).toContainText("NVDA");
  await expect(page.getByTestId("targets-orphaned")).toContainText("Targets on positions you no longer hold");
  await expect(section(page).locator("[data-ticker='NVDA'][data-status='outside_band']")).toHaveCount(0);
});

test("EN/ZH toggle renders the section title and status labels in the selected language", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await page.goto("/portfolio");
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Target weight for NVDA, percent").fill("80");
  await expect(card(page, "NVDA")).toContainText("Outside your band", { timeout: 15_000 });
  await expect(section(page)).toContainText("Your targets vs. what you hold");

  await page.evaluate(() => {
    localStorage.setItem("mm.lang", "zh");
    document.documentElement.setAttribute("data-lang", "zh");
    document.documentElement.setAttribute("lang", "zh-CN");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });

  await expect(section(page)).toContainText("你的目标权重与实际持仓", { timeout: 15_000 });
  await expect(card(page, "NVDA")).toContainText("超出容忍区间");
  await expect(section(page)).not.toContainText("Your targets vs. what you hold");
  await expect(card(page, "NVDA")).not.toContainText("Outside your band");
});
