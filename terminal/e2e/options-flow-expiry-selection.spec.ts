import { expect, test, type Page } from "@playwright/test";
import fixture from "./fixtures/options-r1-w3a-flow.json";

test.setTimeout(75_000);
const sharedShell = process.env.MMX_SHARED_SHELL === "1";
const themes = sharedShell ? ["dark", "light"] as const : ["dark"] as const;
const selectedDate = "2026-10-23";
const otherDate = "2027-10-23";

// Test data through the incumbent REST/SSE transport. No production availability claim.
const nextYearCall = {
  ...fixture.feed.events[0], id: "expiry-next-year-call", exp: otherDate,
  dte: 367, dte_bucket: "90p",
};
const nextYearPut = {
  ...fixture.feed.events[2], id: "expiry-next-year-put", exp: otherDate,
  dte: 367, dte_bucket: "90p",
};
const initialFeed = { ...fixture.feed, events: [...fixture.feed.events, nextYearCall] };
const changedFeed = { ...fixture.feed, events: [nextYearCall, nextYearPut] };

async function setup(page: Page, lang: "en" | "zh", theme: "dark" | "light") {
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
    localStorage.setItem("flowdesk.tutorial.seen", "1");
  }, { lang, theme });
  let current = initialFeed;
  await page.route(/\/api\/flow(?:\/stream)?\?/, async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("f") !== "feed") return route.continue();
    if (url.pathname.endsWith("/stream")) {
      return route.fulfill({
        status: 200, contentType: "text/event-stream",
        body: `data: ${JSON.stringify(current)}\n\n`,
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) });
  });
  return { changeFeed: () => { current = changedFeed; } };
}

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("flowdesk.filters.v1") ?? "null"));
const cards = (page: Page) => page.locator('[data-tut="flow-card"]');

for (const lang of ["en", "zh"] as const) for (const theme of themes) {
  test(`exact expiry survives source changes and reload, then clears independently (${lang}, ${theme})`, async ({ page }, info) => {
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/flow") && !["GET", "HEAD"].includes(request.method())) {
        writes.push(request.method() + " " + new URL(request.url()).pathname);
      }
    });
    await page.emulateMedia({ colorScheme: theme });
    const feed = await setup(page, lang, theme);
    await page.goto("/options?tab=desk");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    if (sharedShell) await expect(page.locator("html")).toHaveAttribute("data-mmx-shared-shell", "1");
    const coverage = page.locator('[data-testid="flow-coverage"]');
    await expect(coverage).toBeVisible();
    await expect(cards(page).filter({ hasText: otherDate })).toHaveCount(1);
    const initialCoverage = await coverage.textContent();

    const openFilters = page.getByRole("button", { name: lang === "zh" ? "筛选" : "Filters", exact: true });
    await openFilters.click();
    const panel = page.locator('[data-tut="flow-filter-panel"]');
    const expiry = page.locator('[data-testid="flow-filter-exp"]');
    const selected = expiry.getByRole("button", { name: "Oct 23, 2026", exact: true });
    const other = expiry.getByRole("button", { name: "Oct 23, 2027", exact: true });
    const all = expiry.getByRole("button", { name: lang === "zh" ? "全部到期" : "All expirations", exact: true });
    await expect(selected).toBeVisible();
    await expect(other).toBeVisible();
    await selected.focus();
    await page.keyboard.press("Enter");
    await panel.getByRole("button", { name: lang === "zh" ? "认购" : "Call", exact: true }).click();
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect(cards(page).filter({ hasText: otherDate })).toHaveCount(0);
    await expect.poll(async () => (await stored(page))?.right).toBe("C");
    await expect(coverage).toHaveText(initialCoverage ?? "");
    const beforeRefresh = await stored(page);
    expect(beforeRefresh.exp).toBe(selectedDate);

    // The native EventSource reconnect reads the changed frame through the real hook.
    await selected.focus();
    feed.changeFeed();
    const retained = expiry.getByRole("button", {
      name: lang === "zh" ? "已选到期日：Oct 23, 2026" : "Selected expiry: Oct 23, 2026",
      exact: true,
    });
    await expect(retained).toBeVisible({ timeout: 15_000 });
    await expect(retained).toBeFocused();
    await expect(retained).toHaveAttribute("aria-pressed", "true");
    await expect(all).toHaveAttribute("aria-pressed", "false");
    await expect(cards(page)).toHaveCount(0);
    await expect(coverage).not.toHaveText(initialCoverage ?? "");
    const changedCoverage = await coverage.textContent();
    expect(await stored(page)).toEqual(beforeRefresh);

    await page.reload();
    await expect(coverage).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await openFilters.click();
    await expect(retained).toBeVisible();
    await expect(retained).toHaveAttribute("aria-pressed", "true");
    await expect(other).toHaveAttribute("aria-pressed", "false");
    await expect(coverage).toHaveText(changedCoverage ?? "");
    expect(await stored(page)).toEqual(beforeRefresh);
    await retained.scrollIntoViewIfNeeded();
    const viewport = page.viewportSize()!;
    for (const target of [all, retained, other]) {
      const bounds = await target.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      if (info.project.name !== "desktop") expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    const screenshotPath = info.outputPath(`expiry-retained-${lang}-${theme}.png`);
    await page.screenshot({ path: screenshotPath });
    await info.attach("retained-expiry", { path: screenshotPath, contentType: "image/png" });

    await all.focus();
    await page.keyboard.press("Enter");
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(retained).toHaveCount(0);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toContainText(otherDate);
    expect(await stored(page)).toEqual({ ...beforeRefresh, exp: null });
    await expect(coverage).toHaveText(changedCoverage ?? "");
    await expect(panel.getByRole("button", { name: lang === "zh" ? "认购" : "Call", exact: true })).toHaveClass(/on/);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
