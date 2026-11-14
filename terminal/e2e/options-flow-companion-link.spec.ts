import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import fixture from "../public/data/flow_fixture.json";
import { decodeTapeView } from "../lib/optionsTapeView";

const sharedShell = process.env.MMX_SHARED_SHELL === "1";
const themes = sharedShell ? ["dark", "light"] as const : ["dark"] as const;
const base = fixture.feed.events[0];
const mixedFeed = (symbol: string) => ({ ...fixture.feed, unusual_names: [], events: [
  { ...base, id: "companion-target-high", root: symbol, premium: 1_200_000 },
  { ...base, id: "companion-target-low", root: symbol, premium: 200_000 },
  { ...base, id: "companion-near-root", root: symbol + "X", premium: 7_770_000 },
  { ...base, id: "companion-other-root", root: "SPY", premium: 9_990_000 },
] });
test.setTimeout(90_000);
const chartSymbol = (page: Page) => page.viewportSize()!.width <= 860
  ? page.locator(".m-symbar .m-sym b") : page.locator(".pair b").first();

async function pointer(control: Locator, page: Page) {
  await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) await control.tap();
  else await control.click();
}
async function prepare(page: Page, lang: "en" | "zh", symbol: string, theme: "dark" | "light" = "dark") {
  const feed = mixedFeed(symbol);
  const reads = { stream: 0, poll: 0 };
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
    localStorage.removeItem("mm.optionsCompanion.v1");
  }, { lang, theme });
  await page.route(/\/api\/flow(?:\/stream)?\?/, route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("f") !== "feed") return route.continue();
    if (url.pathname.endsWith("/stream")) {
      reads.stream++;
      return route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
        body: "retry: 3600000\n\ndata: " + JSON.stringify(feed) + "\n\n" });
    }
    reads.poll++;
    return route.fulfill({ json: feed });
  });
  await page.goto("/terminal?" + new URLSearchParams({ symbol }));
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
  // Instrument identity remains valid when this fixture has no chart history.
  await expect(chartSymbol(page)).toHaveText(symbol);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("mm.activeSymbol"))).toBe(symbol);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  return reads;
}
async function openFlow(page: Page, lang: "en" | "zh") {
  const panel = page.locator("[data-options-companion]");
  if (!(await panel.isVisible())) {
    if (page.viewportSize()!.width <= 640) {
      await pointer(page.getByTestId("roller-more"), page);
      await pointer(page.getByTestId("hub-tile-options"), page);
    } else if (page.viewportSize()!.width <= 860) {
      await pointer(page.getByTestId("toolbar-more"), page);
      await pointer(page.locator('[data-toolbar-menu-action="options"]'), page);
    } else await pointer(page.getByTestId("options-rail-toggle"), page);
  }
  await expect(panel).toBeVisible();
  await pointer(panel.getByRole("tab", { name: lang === "zh" ? "资金流" : "Flow", exact: true }), page);
  return panel;
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + ".png"); await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}
async function follow(page: Page, panel: Locator, symbol: string) {
  const link = panel.locator('[data-options-flow-destination="tape"]');
  await link.scrollIntoViewIfNeeded(); await expect(link).toBeInViewport();
  await expect(link).toContainText(symbol);
  const href = await link.getAttribute("href"); expect(href).not.toBeNull();
  const url = new URL(href!, "http://localhost");
  expect(url.searchParams.get("tab")).toBe("tape");
  expect(decodeTapeView(url.searchParams.get("tapeView"))?.drillTicker).toBe(symbol);
  await link.focus(); await expect(link).toBeFocused(); await link.press("Enter");
  await expect(page).toHaveURL(/\/options\?tab=tape&tapeView=/);
  await expect(page.locator(".flow-drill-card")).toContainText(symbol, { timeout: 30_000 });
  return url;
}
async function exactPopulation(page: Page, symbol: string) {
  // The requested-root card can be server-rendered before the interactive Tape.
  // Wait for its incumbent hydration gate and real feed population before scrolling.
  await expect(page.locator(".flow-filter-bar > input")).toBeEnabled();
  await expect(page.locator('[data-options-export="tape-csv-v1"]')).toContainText("2");
  const table = page.locator("table.scr");
  const rows = table.locator("tbody tr").filter({ has: page.locator("td") });
  await expect(rows).toHaveCount(2);
  await expect(table).toBeVisible(); await table.scrollIntoViewIfNeeded();
  for (const row of await rows.all()) await expect(row).toContainText(symbol);
  await expect(table).not.toContainText(symbol + "X");
  await expect(table).not.toContainText("SPY");
  await expect(page.locator('[data-options-export="tape-csv-v1"]')).toContainText("2");
}

for (const lang of ["en", "zh"] as const) for (const theme of themes) {
  test(`chart Flow opens exact-root Tape (${lang}, ${theme})`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    const viewport = page.viewportSize();
    const reads = await prepare(page, lang, "NVDA", theme);
    const panel = await openFlow(page, lang);
    await expect(panel.locator("[data-options-tape] article")).toHaveCount(2);
    const link = panel.getByRole("link", { name: lang === "zh" ? "NVDA · 交易动态 ↗" : "NVDA · Activity tape ↗", exact: true });
    await link.scrollIntoViewIfNeeded(); await expect(link).toBeInViewport();
    await capture(page, info, "chart-flow-source");
    const url = await follow(page, panel, "NVDA");
    await exactPopulation(page, "NVDA");
    if (sharedShell) {
      await expect(page.locator("html")).toHaveAttribute("data-mmx-shared-shell", "1");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    }
    await capture(page, info, "symbol-tape-destination");
    expect(page.viewportSize()).toEqual(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(reads.stream).toBeGreaterThan(0); expect(errors).toEqual([]);
    await info.attach("consumer-proof", { body: Buffer.from(JSON.stringify({ lang, theme, sharedShell, viewport,
      requestedView: decodeTapeView(url.searchParams.get("tapeView")), renderedRows: 2, reads, pageErrors: errors }, null, 2)),
      contentType: "application/json" });
  });
}

test("changing the chart root keeps a missing-root Tape exact while old feed remains", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const reads = await prepare(page, "en", "NVDA");
  let panel = await openFlow(page, "en");
  await expect(panel.locator("[data-options-tape] article")).toHaveCount(2);
  // Responsive sheets own their close button outside the companion body.
  await pointer(page.getByRole("button", { name: "Close options panel", exact: true }), page);
  await expect(panel).not.toBeVisible();
  if (info.project.name === "desktop") await pointer(page.locator(".pair").first(), page);
  else await pointer(page.locator(".m-symbar"), page);
  const input = page.locator(".sh input[role=combobox]");
  await input.fill("AMD");
  const option = page.locator(".sres [role=option]").filter({ has: page.locator(".tk").filter({ hasText: /^AMD$/ }) });
  await expect(option).toHaveCount(1); await pointer(option, page);
  await expect(chartSymbol(page)).toHaveText("AMD");
  panel = await openFlow(page, "en");
  await expect(panel.locator("[data-options-tape] article")).toHaveCount(0);
  await follow(page, panel, "AMD");
  await expect(page.locator('[data-options-export="tape-csv-v1"]')).toContainText("0");
  await expect(page.locator("table.scr")).not.toContainText("NVDA");
  await capture(page, info, "changed-root-empty-tape");
  expect(reads.stream).toBeGreaterThan(0); expect(errors).toEqual([]);
});

test("a dotted chart root reaches its exact Tape population", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await prepare(page, "en", "BRK.B");
  const panel = await openFlow(page, "en");
  await expect(panel.locator("[data-options-tape] article")).toHaveCount(2);
  await follow(page, panel, "BRK.B"); await exactPopulation(page, "BRK.B");
  await capture(page, info, "dotted-root-tape");
  expect(errors).toEqual([]);
});
