import { expect, test, type Page } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";

test.setTimeout(90000);
const url = "/discover?tab=sectors&sector=xlk&group=semiconductors&sectorTheme=light";
async function prepare(page: Page, language = "en") {
  await page.addInitScript(lang => { localStorage.setItem("mm.lang", lang); document.documentElement?.setAttribute("data-lang", lang); }, language);
  await page.route("**/api/sector-intelligence?**", route => sectorFixture(route));
}
async function noOverflow(page: Page) {
  const root = page.getByTestId("sector-intelligence");
  expect(await root.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("overview comparison selects a company, preserves source semantics and opens existing research", async ({ page }) => {
  await prepare(page); await page.goto(url);
  const root = page.getByTestId("sector-intelligence");
  await expect(root.getByRole("heading", { name: "Leading, with mixed timing", exact: true })).toBeVisible();
  await expect(root.locator('[data-company-choice]')).toHaveCount(6);
  const inspector = root.getByTestId("sector-company-inspector");
  await expect(inspector).toContainText("Select a company");
  await root.locator('[data-company-choice="MU"]').click();
  await expect(inspector.getByRole("heading", { name: "MU", exact: true })).toBeVisible();
  await expect(inspector).toContainText("+14.9%"); await expect(inspector).toContainText("+1.9pp");
  await expect(page).toHaveURL(/sectorCompany=MU/);
  const href = await inspector.getByRole("link").getAttribute("href");
  expect(href).toBe("/analysis?symbol=MU&page=overview");
  await root.getByRole("button", { name: "Show all companies", exact: true }).click();
  await expect(root.locator('[data-company-choice]')).toHaveCount(14);
  await root.locator('[data-company-choice="INTC"]').click();
  await inspector.getByText("Signal details", { exact: true }).click();
  await expect(inspector).toContainText("No"); await expect(inspector).toContainText("Not rated");
  await expect(inspector).toContainText("+27.2pp"); await expect(inspector).toContainText("+40.1%");
  await expect(root).not.toContainText("63.2%"); // No invented complete heatmap cohort.
  await noOverflow(page);
});

test("table selection and browser Back restore exact comparison context", async ({ page }) => {
  await prepare(page); await page.goto(url);
  const root = page.getByTestId("sector-intelligence");
  await root.locator('[data-company-choice="MU"]').click();
  await root.getByRole("button", { name: /Open company table/ }).click();
  await root.getByLabel("Display order", { exact: true }).selectOption("relative");
  await root.getByLabel("Find a ticker", { exact: true }).fill("INTC");
  await expect(root.getByTestId("sector-company-row")).toHaveCount(1);
  await root.getByRole("button", { name: "Select company: INTC", exact: true }).click();
  await expect(root.getByTestId("sector-company-inspector")).toContainText("INTC");
  await page.goBack();
  await expect(root.getByRole("tab", { name: "Companies & exposure", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(root.getByLabel("Find a ticker", { exact: true })).toHaveValue("INTC");
  await expect(root.getByLabel("Display order", { exact: true })).toHaveValue("relative");
  await page.goBack();
  await expect(root.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(root.getByTestId("sector-company-inspector")).toContainText("MU");
  await noOverflow(page);
});

test("shared language, dark appearance and keyboard selection remain synchronized", async ({ page }) => {
  await prepare(page, "zh"); await page.goto(url + "&sectorCompany=MU");
  const root = page.getByTestId("sector-intelligence");
  await expect(root.getByRole("heading", { name: "比较公司", exact: true })).toBeVisible();
  await root.getByRole("button", { name: "使用深色视图", exact: true }).click();
  await expect(root).toHaveAttribute("data-sector-theme", "dark");
  await root.locator('[data-company-choice="MU"]').focus(); await page.keyboard.press("ArrowDown");
  await expect(root.getByTestId("sector-company-inspector").getByRole("heading", { name: "NXPI", exact: true })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(root.getByTestId("sector-company-inspector").getByRole("heading", { name: "MPWR", exact: true })).toBeVisible();
  await expect(root).not.toContainText("Select a company"); await noOverflow(page);
});

test("refresh after lost source access clears previously visible company data", async ({ page }) => {
  await prepare(page); await page.goto(url + "&sectorCompany=MU");
  const root = page.getByTestId("sector-intelligence");
  await expect(root.getByTestId("sector-company-inspector")).toContainText("+14.9%");
  await page.unroute("**/api/sector-intelligence?**");
  await page.route("**/api/sector-intelligence?**", route => sectorFixture(route, "access"));
  await root.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(root.getByRole("heading", { name: "Sector data requires access", exact: true })).toBeVisible();
  await expect(root.locator('[data-company-choice]')).toHaveCount(0);
  await expect(root.getByTestId("sector-company-inspector").getByRole("link")).toHaveCount(0);
  await expect(root).not.toContainText("+14.9%"); await noOverflow(page);
});
