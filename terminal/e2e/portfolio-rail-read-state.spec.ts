import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

// F08-RAIL (macro#6819 C4 5995397563): the terminal rail's Portfolio tab, mounted natively inside
// TerminalShell and opened through its real lazy trigger (the tab click). Only `/api/portfolio`
// GETs are steered, at the HTTP boundary. Positions are seeded through the real fixture route,
// and every interaction is browser-driven.
//
// The rail is desktop chrome, so this runs on the desktop project only. With TERMINAL_CROPS=1 it
// also writes the PR's crops (Terminal is dark-only, so EN/ZH is the axis that matters):
//
//   rm -rf .next && TERMINAL_E2E_PORT=3190 TERMINAL_CROPS=1 \
//     npx playwright test e2e/portfolio-rail-read-state.spec.ts --project=desktop

test.setTimeout(120_000);

const CROPS = !!process.env.TERMINAL_CROPS;
const OUT = join(process.cwd(), "docs", "pr-crops", "f08-rail-read-state");

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", zh: "英伟达", col: "#76b900", last: 175, chg: 1.2 },
    AAPL: { name: "Apple", zh: "苹果", col: "#8e8e93", last: 228.1, chg: -0.4 },
  },
};
const QUOTES = { quotes: { NVDA: { last: 180.2, chg: 2.5 }, AAPL: { last: 231.4, chg: -0.9 } } };

const COPY = {
  en: { unavailable: "Could not read your portfolio", retry: "Try again", empty: "No positions yet.", add: "Add position", stale: "Couldn't refresh. Showing your last read." },
  zh: { unavailable: "无法读取你的投资组合", retry: "重试", empty: "暂无持仓。", add: "添加持仓", stale: "未能刷新，显示的是上次读取的持仓。" },
};

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh = false) {
  test.skip(testInfo.project.name !== "desktop", "The rail's Portfolio tab is desktop chrome.");
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    document.documentElement.setAttribute("data-lang", useZh ? "zh" : "en");
    document.documentElement.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, zh);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: QUOTES }));
}

async function seed(page: Page, ticker: string): Promise<string> {
  const response = await page.request.post("/api/portfolio", {
    data: { action: "create", ticker, shares: "10", entryPrice: "150", entryDate: "2026-01-05" },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).position.id;
}

async function close(page: Page, id: string) {
  const response = await page.request.post("/api/portfolio", { data: { action: "close", id } });
  expect(response.ok()).toBe(true);
}

/**
 * Steer the rail's GETs. `next` decides each NEW request as it arrives: "pass" reaches the real
 * fixture route, "fail" is a 503, and "hold" parks the request until `release` answers it.
 */
async function steerBook(page: Page) {
  const gate = {
    next: "pass" as "pass" | "fail" | "hold",
    gets: 0,
    parked: [] as Route[],
  };
  await page.route("**/api/portfolio", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    gate.gets += 1;
    if (gate.next === "fail") return route.fulfill({ status: 503, json: { error: "unavailable" } });
    if (gate.next === "hold") { gate.parked.push(route); return; }
    return route.continue();
  });
  return gate;
}

async function openTerminal(page: Page) {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}
const tab = (page: Page, which: "portfolio" | "watchlists") => page.locator(`#rail-tab-${which}`);
const panel = (page: Page) => page.locator("#rail-panel-portfolio");

async function crop(page: Page, name: string) {
  if (!CROPS) return;
  mkdirSync(OUT, { recursive: true });
  const tabs = await page.getByTestId("rail-source-tabs").boundingBox();
  const body = await panel(page).boundingBox();
  expect(tabs && body).toBeTruthy();
  const x = Math.min(tabs!.x, body!.x) - 8;
  const y = tabs!.y - 8;
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x, y, width: Math.max(tabs!.width, body!.width) + 16, height: Math.min(body!.y + body!.height, y + 360) - y },
  });
}

for (const lang of ["en", "zh"] as const) {
  const c = COPY[lang];

  test(`[${lang}] a first read that fails is unavailable, never the empty book, and Retry reads it`, async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL, lang === "zh");
    await seed(page, "NVDA");
    const gate = await steerBook(page);
    await openTerminal(page);

    gate.next = "fail";
    await tab(page, "portfolio").click();
    const unavailable = page.getByTestId("rail-portfolio-unavailable");
    await expect(unavailable).toBeVisible({ timeout: 20_000 });
    await expect(unavailable).toContainText(c.unavailable);
    await expect(panel(page)).not.toContainText(c.empty);
    await expect(panel(page).getByRole("link", { name: c.add })).toHaveCount(0);
    await crop(page, `unavailable-${lang}`);

    gate.next = "pass";
    await unavailable.getByRole("button", { name: c.retry }).click();
    await expect(panel(page).locator(".pf-board-row", { hasText: "NVDA" })).toBeVisible({ timeout: 20_000 });
    await expect(unavailable).toHaveCount(0);
    await expect(page.getByTestId("rail-portfolio-stale")).toHaveCount(0);
    await crop(page, `recovered-${lang}`);
  });

  test(`[${lang}] a failed refresh keeps the rows, says they are the last read, and Retry clears it`, async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL, lang === "zh");
    await seed(page, "NVDA");
    const gate = await steerBook(page);
    await openTerminal(page);

    await tab(page, "portfolio").click();
    const nvda = panel(page).locator(".pf-board-row", { hasText: "NVDA" });
    await expect(nvda).toBeVisible({ timeout: 20_000 });

    // Leaving and re-opening the tab is the lazy trigger's refresh.
    gate.next = "fail";
    await tab(page, "watchlists").click();
    await tab(page, "portfolio").click();
    const stale = page.getByTestId("rail-portfolio-stale");
    await expect(stale).toBeVisible({ timeout: 20_000 });
    await expect(stale).toContainText(c.stale);
    await expect(nvda).toBeVisible();
    await crop(page, `stale-${lang}`);

    gate.next = "pass";
    await stale.getByRole("button", { name: c.retry }).click();
    await expect(stale).toHaveCount(0, { timeout: 20_000 });
    await expect(nvda).toBeVisible();
  });
}

test("control: a valid empty book is the empty state with Add position", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await steerBook(page);
  await openTerminal(page);
  await tab(page, "portfolio").click();
  await expect(panel(page)).toContainText(COPY.en.empty, { timeout: 20_000 });
  await expect(panel(page).getByRole("link", { name: COPY.en.add })).toBeVisible();
  await expect(page.getByTestId("rail-portfolio-unavailable")).toHaveCount(0);
  await crop(page, "empty-control-en");
});

// C4 5997134203: the last good read had nothing open, so the rail shows the empty state. The failed
// refresh must still be QUALIFIED, never the bare empty state asserted as current.
for (const [label, closed] of [["an empty book", false], ["a book whose only position is closed", true]] as const) {
  test(`a failed refresh after ${label} is qualified as the last read, never the bare empty state`, async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL);
    if (closed) await close(page, await seed(page, "AAPL"));
    const gate = await steerBook(page);
    await openTerminal(page);

    await tab(page, "portfolio").click();
    await expect(panel(page)).toContainText(COPY.en.empty, { timeout: 20_000 });
    const stale = page.getByTestId("rail-portfolio-stale");
    await expect(stale).toHaveCount(0);

    gate.next = "fail";
    await tab(page, "watchlists").click();
    await tab(page, "portfolio").click();
    await expect(stale).toBeVisible({ timeout: 20_000 });
    await expect(stale).toContainText(COPY.en.stale);
    await expect(page.getByTestId("rail-portfolio-unavailable")).toHaveCount(0);
    expect(gate.gets).toBe(2);

    gate.next = "pass";
    await stale.getByRole("button", { name: COPY.en.retry }).click();
    await expect(stale).toHaveCount(0, { timeout: 20_000 });
    await expect(panel(page)).toContainText(COPY.en.empty);
    expect(gate.gets).toBe(3);
  });
}

test("an older read landing late cannot overwrite a newer one", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, "NVDA");
  const gate = await steerBook(page);
  await openTerminal(page);

  // Read 1 is parked; leaving and re-opening the tab issues read 2, which answers first.
  gate.next = "hold";
  await tab(page, "portfolio").click();
  await expect.poll(() => gate.parked.length, { timeout: 20_000 }).toBe(1);
  gate.next = "pass";
  await tab(page, "watchlists").click();
  await tab(page, "portfolio").click();
  const nvda = panel(page).locator(".pf-board-row", { hasText: "NVDA" });
  await expect(nvda).toBeVisible({ timeout: 20_000 });

  // Read 1 now lands, late, with an older EMPTY book. The rail must keep the newer answer.
  const landed = page.waitForResponse((r) => r.url().endsWith("/api/portfolio") && r.request().method() === "GET" && r.status() === 200);
  await gate.parked[0].fulfill({ json: { positions: [] } });
  await landed;
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await expect(nvda).toBeVisible();
  await expect(panel(page)).not.toContainText(COPY.en.empty);
  expect(gate.gets).toBe(2);
});
