import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";
import { computePortfolioRisk } from "../lib/portfolioRisk";
import type { Position } from "../lib/portfolio";
test.setTimeout(120_000);

const manifest = { symbols: {
  NVDA: { name: "NVIDIA", zh: "英伟达", last: 180.2, chg: 2.5, currency: "USD" },
  AAPL: { name: "Apple", zh: "苹果", last: 231.4, chg: -0.9, currency: "USD" },
  GLD: { name: "SPDR Gold Shares", zh: "SPDR 黄金ETF", last: 320.1, chg: .7, currency: "USD" },
  TLT: { name: "iShares 20+ Year Treasury", zh: "20年以上美国国债ETF", last: 89.2, chg: -.3, currency: "USD" },
  RKLB: { name: "Rocket Lab", zh: "火箭实验室", last: 46.3, chg: 1.1, currency: "USD" },
} };
const out = join(process.cwd(), "docs", "verification", "portfolio-workspace");
async function shot(page: Page, testInfo: TestInfo, label: string) {
  if (!process.env.TERMINAL_CROPS) return;
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: join(out, `${testInfo.project.name}-${label}.png`), fullPage: false, animations: "disabled" });
}
async function readBook(page: Page) {
  const response = await page.request.get("/api/portfolio?view=positions");
  expect(response.ok()).toBe(true);
  return await response.json() as { positions: Position[]; bookKey: string };
}
async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, lang = "en", malformed = false) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript(language => localStorage.setItem("mm.lang", language), lang);
  await page.route("**/data/manifest.json", route => route.fulfill({ json: manifest }));
  await page.route("**/api/quote**", route => route.fulfill({ json: { quotes: manifest.symbols } }));
  await page.route("**/api/portfolio-brief", route => route.fulfill({ json: { malformed: true } }));
  await page.route("**/api/portfolio/risk-history", async route => {
    const book = await readBook(page);
    await route.fulfill({ json: { bookKey: book.bookKey, history: null } });
  });
  await page.route("**/api/portfolio", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const book = await readBook(page);
    const artifacts = Object.fromEntries(book.positions.map(p => [p.ticker, { kind: "read" as const, facts: {
      ticker: p.ticker, sector: p.ticker === "GLD" || p.ticker === "TLT" ? null : "Information Technology",
      marketCap: p.ticker === "RKLB" ? 20e9 : 1e12, thinlyTraded: null,
    } }]));
    await route.fulfill({ json: { ...book, risk: malformed ? { schema: "portfolio_risk.v1" } : computePortfolioRisk(book.positions, artifacts, false) } });
  });
}
async function seedBook(page: Page) {
  for (const row of [
    { ticker: "NVDA", shares: "120", entryPrice: "138.40", entryDate: "2026-01-05", notes: "Core holding — first record." },
    { ticker: "AAPL", shares: "60", entryPrice: "244.10", entryDate: "2026-03-18" },
    { ticker: "GLD", shares: "40", entryPrice: "296.00", entryDate: "2025-11-02" },
    { ticker: "TLT", shares: "150", entryPrice: "94.30", entryDate: "2026-02-11" },
    { ticker: "NVDA", shares: "15", entryPrice: "155", notes: "Second record — keep its identity." },
    { ticker: "RKLB" },
  ]) {
    const response = await page.request.post("/api/portfolio", { data: { action: "create", entryCurrency: "USD", ...row } });
    expect(response.ok()).toBe(true);
  }
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

// Dark is the currently published shell theme. Light verifies Portfolio's Paper
// token compatibility only; this suite does not claim a global theme-setting flow.
for (const lang of ["en", "zh"]) for (const theme of ["dark", "light"]) {
  test(`workspace layout and record inspector — ${lang} ${theme}`, async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL, lang);
    await seedBook(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/portfolio");
    await expect(page.locator("[data-portfolio]")).toHaveAttribute("data-position-count", "6");
    await expect(page.locator("#portfolio-panel-overview")).toBeVisible();
    await expect(page.locator("[role=meter]")).toBeVisible();
    await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
    await expect(page.locator("[data-portfolio]")).toHaveCSS("background-color", theme === "light" ? "rgb(247, 248, 250)" : "rgb(10, 11, 14)");
    await noOverflow(page);
    await shot(page, testInfo, `${lang}-${theme}-overview`);
    await page.locator("#portfolio-tab-holdings").click();
    await expect(page.locator("#portfolio-panel-holdings")).toBeVisible();
    await expect(page.getByTestId("portfolio-open").locator("tr[data-ticker]")).toHaveCount(6);
    await noOverflow(page);
    const first = page.getByTestId("portfolio-open").locator("tr[data-ticker='NVDA']").first();
    await expect(first.locator("td").nth(1)).toBeVisible();
    await expect(first.locator("td").nth(2)).toBeVisible();
    await expect(first.locator("td").nth(3)).toBeVisible();
    await shot(page, testInfo, `${lang}-${theme}-holdings`);
    const second = page.getByTestId("portfolio-open").locator("tr[data-ticker='NVDA']").nth(1);
    await second.getByRole("button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Second record — keep its identity.");
    await expect(dialog).toContainText("155.00");
    await noOverflow(page);
    await shot(page, testInfo, `${lang}-${theme}-inspector`);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(second.getByRole("button")).toBeFocused();
    await page.locator("#portfolio-tab-risk").click();
    await expect(page.getByTestId("portfolio-shape")).toBeVisible();
    await shot(page, testInfo, `${lang}-${theme}-risk`);
    await page.locator("#portfolio-tab-targets").click();
    await expect(page.getByTestId("portfolio-targets")).toBeVisible();
    await shot(page, testInfo, `${lang}-${theme}-targets`);
    expect(errors).toEqual([]);
  });
}

test("exact record edit survives canonical readback; dirty dismissal preserves the draft", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL); await seedBook(page); await page.goto("/portfolio");
  await page.locator("#portfolio-tab-holdings").click();
  const rows = page.getByTestId("portfolio-open").locator("tr[data-ticker='NVDA']");
  const original = await readBook(page);
  const secondId = original.positions.filter(p => p.ticker === "NVDA")[1].id;
  await rows.nth(1).getByRole("button").click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit NVDA", exact: true }).click();
  const editor = page.getByRole("dialog").filter({ has: page.locator("input[name='ticker']") });
  await editor.locator("input[name='shares']").fill("22");
  await page.keyboard.press("Escape");
  await expect(editor).toContainText("Discard your changes?");
  await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor.locator("input[name='shares']")).toHaveValue("22");
  await shot(page, testInfo, "en-dark-edit");
  await editor.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(editor).not.toBeVisible();
  const after = await readBook(page);
  expect(after.positions.find(p => p.id === secondId)?.shares).toBe(22);
  expect(after.positions.find(p => p.id === original.positions[0].id)?.shares).toBe(120);
  await page.getByRole("dialog").getByRole("button", { name: "Close details", exact: true }).click();
  await page.reload();
  await page.locator("#portfolio-tab-holdings").click();
  await expect(page.getByTestId("portfolio-open").locator(`tr[data-position-id="${secondId}"]`)).toContainText("22");
});

test("tabs, filters and malformed optional analysis leave holdings usable", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, "en", true); await seedBook(page); await page.goto("/portfolio");
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.locator("#portfolio-tab-overview").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#portfolio-tab-holdings")).toBeFocused();
  await expect(page.locator("#portfolio-tab-holdings")).toHaveAttribute("aria-selected", "true");
  const search = page.getByRole("searchbox");
  await search.fill("second record");
  await expect(page.getByTestId("portfolio-open").locator("tr[data-ticker]")).toHaveCount(1);
  await expect(page.getByTestId("portfolio-open").locator("tr[data-ticker]")).toContainText("NVDA");
  await search.fill("unmatched");
  await expect(page.locator("#portfolio-panel-holdings")).toContainText("No matching records");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.getByTestId("portfolio-open").locator("tr[data-ticker]")).toHaveCount(6);
  await page.locator("#portfolio-tab-risk").click();
  await expect(page.getByTestId("portfolio-shape-unavailable")).toBeVisible();
  await page.locator("#portfolio-tab-overview").click();
  await page.locator("summary").filter({ hasText: "From the desk" }).click();
  await expect(page.locator(".pbrief-unavailable")).toBeVisible();
  expect(errors).toEqual([]);
  await noOverflow(page);
});

test("a committed create with a lost response retries as one record, then a new intent gets a new ID", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const intents: string[] = [];
  let lost = false;
  await page.route("**/api/portfolio", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== "create") return route.fallback();
    intents.push(body.clientPositionId);
    if (!lost) { lost = true; await route.fetch(); return route.abort("failed"); }
    return route.continue();
  });
  await page.goto("/portfolio");
  await page.getByRole("button", { name: "Add position", exact: true }).first().click();
  let editor = page.getByRole("dialog");
  await editor.locator("input[name='ticker']").fill("NVDA");
  await editor.locator("input[name='shares']").fill("2");
  await editor.locator("input[name='entryPrice']").fill("100");
  await editor.locator("input[name='entryCurrency']").fill("USD");
  await editor.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(editor.getByRole("alert")).toBeVisible();
  const committed = await readBook(page);
  expect(committed.positions).toHaveLength(1);
  await editor.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(intents).toHaveLength(2); expect(intents[0]).toBe(intents[1]);
  expect((await readBook(page)).positions).toHaveLength(1);
  await page.getByRole("button", { name: "Add position", exact: true }).first().click();
  editor = page.getByRole("dialog");
  await editor.locator("input[name='ticker']").fill("NVDA");
  await editor.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(intents[2]).not.toBe(intents[0]);
  expect((await readBook(page)).positions).toHaveLength(2);
});

test("switching sections keeps a pending target save and reopening reads it", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL); await seedBook(page);
  await page.request.post("/api/portfolio/targets", { data: { action: "set", ticker: "NVDA", targetWeightPct: 30, bandPct: 5 } });
  await page.goto("/portfolio");
  await page.locator("#portfolio-tab-targets").click();
  const field = page.getByRole("textbox", { name: "Target weight for NVDA, percent", exact: true });
  await field.fill("37");
  await page.locator("#portfolio-tab-holdings").click();
  await expect.poll(async () => {
    const response = await page.request.get("/api/portfolio/targets");
    const payload = await response.json();
    return payload.summary.drifts.find((row: { ticker: string }) => row.ticker === "NVDA")?.targetWeightPct;
  }).toBe(37);
  await page.locator("#portfolio-tab-targets").click();
  await expect(field).toHaveValue("37");
  await shot(page, testInfo, "en-dark-target-saved");
});

test("an unreadable book recovers in place without being called empty", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await page.context().addCookies([{ name: "mm_e2e_fault", value: "positions_read", url: baseURL! }]);
  const failedRead = page.waitForResponse(response => response.url().endsWith("/api/portfolio?view=positions") && response.status() === 503);
  await page.goto("/portfolio"); await failedRead;
  await expect(page.locator("[data-portfolio]")).toHaveAttribute("data-portfolio-state", "unreadable");
  await expect(page.getByRole("button", { name: "Add position", exact: true }).first()).toBeDisabled();
  await shot(page, testInfo, "en-dark-unreadable");
  await page.context().addCookies([{ name: "mm_e2e_fault", value: "", url: baseURL! }]);
  await page.getByRole("button", { name: "Refresh holdings", exact: true }).first().click();
  await expect(page.locator("[data-portfolio]")).toHaveAttribute("data-portfolio-state", "empty");
  await expect(page.getByRole("button", { name: "Add position", exact: true }).first()).toBeEnabled();
  await expect(page.locator("[data-portfolio]")).toHaveAttribute("data-position-count", "0");
  await shot(page, testInfo, "en-dark-empty");
});

for (const lang of ["en", "zh"] as const) {
  test("known position refusals stay actionable in the editor — " + lang, async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL, lang);
    const ids: string[] = [];
    let conflict = false;
    await page.route("**/api/portfolio", async route => {
      if (route.request().method() !== "POST") return route.fallback();
      ids.push(route.request().postDataJSON().clientPositionId);
      if (conflict) { conflict = false; return route.fulfill({ status: 409, json: { error: "position intent conflict" } }); }
      return route.fallback();
    });
    await page.goto("/portfolio");
    await page.getByRole("button", { name: lang === "zh" ? "添加持仓" : "Add position", exact: true }).first().click();
    const editor = page.getByRole("dialog").filter({ has: page.locator("input[name='ticker']") });
    const save = editor.getByRole("button", { name: lang === "zh" ? "保存持仓" : "Save position", exact: true });
    await editor.locator("input[name='ticker']").fill("NVDA");
    await editor.locator("input[name='shares']").fill("3O");
    await editor.locator("input[name='entryPrice']").fill("100");
    await editor.locator("input[name='entryCurrency']").fill("USD");
    await save.click();
    await expect(editor.getByRole("alert")).toContainText(lang === "zh" ? "请输入有效的数量" : "Enter a valid share count");
    await expect(editor.locator("input[name='shares']")).toHaveValue("3O");
    await expect(editor.locator("input[name='shares']")).toHaveAttribute("aria-invalid", "true");
    await expect(editor.locator("input[name='shares']")).toBeFocused();
    await noOverflow(page); await shot(page, testInfo, lang + "-editor-validation");
    await editor.locator("input[name='shares']").fill("10");
    await editor.locator("input[name='entryCurrency']").fill("usd");
    await save.click();
    await expect(editor.getByRole("alert")).toContainText(lang === "zh" ? "有效的入场币种代码" : "valid entry currency code");
    await expect(editor.locator("input[name='entryCurrency']")).toBeFocused();
    await editor.locator("input[name='entryCurrency']").fill("USD");
    conflict = true;
    await save.click();
    await expect(editor.getByRole("alert")).toContainText(lang === "zh" ? "检查现有记录" : "review the existing record");
    await expect(editor.locator("input[name='shares']")).toHaveValue("10");
    await save.click();
    await expect(editor).not.toBeVisible();
    expect(ids).toHaveLength(4); expect(new Set(ids).size).toBe(1);
    const book = await readBook(page);
    expect(book.positions).toHaveLength(1);
    expect(book.positions[0]).toMatchObject({ id: ids[0], shares: 10, entryCurrency: "USD" });
  });
}
