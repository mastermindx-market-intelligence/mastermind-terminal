import { expect, test } from "@playwright/test";
import { candidateFixture } from "../lib/__tests__/prophetCandidatesFixture";

test.beforeEach(async ({ context, baseURL, page }) => {
  await context.addCookies([{ name: "mm_e2e_prophet_canonical", value: "1", url: baseURL ?? "http://127.0.0.1" }]);
  await page.addInitScript(() => { localStorage.setItem("mm.lang", "en"); });
  await page.route("**/api/prophet/candidates", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(candidateFixture()) }));
});

test("complete native candidate search, inspection, source disclosure and return", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.goto("/prophet?tab=candidates");
  const workspace = page.getByTestId("prophet-candidates");
  await expect(workspace.getByTestId("candidate-row")).toHaveCount(4, { timeout: 45_000 });
  await expect(page.getByTestId("prophet-tab-candidates")).toHaveAttribute("aria-selected", "true");
  await expect(workspace.getByTestId("candidate-row").nth(1)).toContainText("0.0");
  await expect(workspace.getByTestId("candidate-row").nth(2)).toContainText("Not scored");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("candidates.png"), fullPage: true });
  await workspace.getByRole("searchbox").fill("Technology");
  await workspace.getByRole("button", { name: "Search", exact: true }).click();
  await expect(workspace.getByTestId("candidate-row")).toHaveCount(2);
  await expect(page).toHaveURL(/prophetQ=Technology/);
  await workspace.getByRole("button", { name: "Inspect DEMOC", exact: true }).click();
  await expect(page).toHaveURL(/symbol=DEMOC/);
  await expect(workspace.getByRole("heading", { name: "Cedar Networks" })).toBeFocused();
  await expect(workspace.getByTestId("candidate-detail")).toContainText("Sector display limit reached");
  await expect(workspace.getByRole("link", { name: /Company intelligence/ })).toHaveAttribute("href", "/analysis?symbol=DEMOC&page=intelligence");
  await workspace.getByRole("button", { name: "Sources & method", exact: true }).click();
  await expect(workspace.locator("details")).toHaveAttribute("open", "");
  await expect(workspace.locator("summary")).toBeFocused();
  await page.screenshot({ path: info.outputPath("candidate-detail.png"), fullPage: true });
  await workspace.getByRole("button", { name: "All candidates", exact: true }).click();
  await expect(workspace.getByTestId("candidate-row")).toHaveCount(2);
  await expect(workspace.getByRole("button", { name: "Inspect DEMOC" })).toBeFocused();
  await page.goBack();
  await expect(workspace.getByTestId("candidate-detail")).toBeVisible();
  await page.reload();
  await expect(workspace.getByRole("heading", { name: "Cedar Networks" })).toBeVisible();
});

test("320px Chinese detail and lane controls remain readable", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "one narrow-phone proof");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 780 });
  await page.addInitScript(() => { localStorage.setItem("mm.lang", "zh"); });
  await page.goto("/prophet?tab=candidates");
  await expect(page.getByTestId("candidate-row")).toHaveCount(4, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "全部候选股票" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const tabs = await page.getByRole("tab").filter({ visible: true }).evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })));
  expect(new Set(tabs.map(tab => Math.round(tab.top))).size).toBe(1);
  expect(tabs.every(tab => tab.height >= 44)).toBe(true);
  await page.screenshot({ path: info.outputPath("candidates-320-zh.png"), fullPage: true });
  await page.getByRole("button", { name: "查看 DEMOC 候选" }).click();
  await expect(page.getByTestId("candidate-detail")).toContainText("未评分");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("candidate-detail-320-zh.png"), fullPage: true });
});
