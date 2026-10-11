import { test, expect, type Page } from "@playwright/test";

const route = "/dev/settings?s=terminal&out=1";
const timeframes = ["1s", "5s", "15s", "30s", "1m", "5m", "15m", "30m", "1h", "2h", "4h", "D", "2D", "3D", "W", "2W", "1M", "3M"];
async function open(page: Page) {
  await page.goto(route);
  await expect(page.locator(".acs-card")).toBeVisible();
  await expect(page.locator(".acs-tfg button")).toHaveCount(18);
}

test("compact native shell has all destinations without decorative aurora", async ({ page }) => {
  await open(page);
  const box = await page.locator(".acs-card").boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1000);
  expect(box!.height).toBeLessThanOrEqual(660);
  await expect(page.locator(".acs-aurora")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(13);
  await expect(page.locator(".acs-nav-group-label")).toHaveText(["Account", "Workspace", "Connections"]);
  await expect(page.locator(".acs-me-sub")).toHaveText("Account & settings");
});

test("market and chart preferences still apply locally and survive reload", async ({ page }) => {
  await open(page);
  const market = page.locator('.acs-check:not([aria-disabled="true"])').first();
  const label = (await market.innerText()).trim();
  const before = await market.getAttribute("aria-pressed");
  await market.click();
  await expect(market).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
  await expect(page.locator(".acs-tfg button")).toHaveText(timeframes);
  await page.locator(".acs-tfg").getByRole("button", { name: "1h", exact: true }).click();
  await page.getByRole("button", { name: "Red up", exact: true }).click();
  await page.reload();
  await expect(page.locator(".acs-check").filter({ hasText: label })).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
  await expect(page.locator(".acs-tfg").getByRole("button", { name: "1h", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Red up", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("keyboard navigation, escape and focus restoration", async ({ page }) => {
  await open(page);
  const tab = page.getByRole("tab", { name: "Terminal", exact: true });
  await tab.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "Alert delivery", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  const reopen = page.getByRole("button", { name: "reopen", exact: true });
  await reopen.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reopen).toBeFocused();
});

for (const width of [320, 390, 820]) {
  test(`settings stay reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    if (width <= 640) {
      const picker = page.getByRole("combobox", { name: "Settings sections" });
      await expect(picker).toBeVisible();
      await expect(picker.locator("option")).toHaveCount(13);
      await picker.selectOption("sync");
      await expect(page.locator(".acs-sect")).toHaveAttribute("data-section", "sync");
      await picker.selectOption("terminal");
      const button = page.locator(".acs-tfg button").last();
      await button.scrollIntoViewIfNeeded();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator(".acs-x-m")).toBeInViewport();
      await expect(page.locator(".acs-rail .acs-signout")).toBeVisible();
    }
    expect(await page.locator(".acs-card").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.locator(".acs-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
}

test("Chinese labels fit the same mobile navigation and controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route + "&lang=zh");
  const picker = page.locator(".acs-section-select");
  await expect(picker).toBeVisible();
  await expect(picker.locator("option")).toHaveCount(13);
  await expect(page.locator(".acs-me-sub")).toHaveText("账户与设置");
  await expect(page.locator(".acs-tfg button")).toHaveCount(18);
  expect(await page.locator(".acs-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

// Exercise the production consumer, not a screenshot-only reconstruction.
test("the actual Terminal dashboard opens the redesigned user pane", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const readyWindow = window as Window & { __mmSettingsVisualReady?: boolean };
    window.addEventListener("mm:terminal-visual-ready", () => { readyWindow.__mmSettingsVisualReady = true; }, { once: true });
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __mmSettingsVisualReady?: boolean }).__mmSettingsVisualReady)), { timeout: 20_000 }).toBe(true);
  await page.locator(".topbar button.avatar").click();
  await expect(page.getByRole("dialog", { name: "Terminal", exact: true })).toBeVisible();
  await expect(page.locator(".acs-market-list .acs-check")).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath("terminal-dashboard-settings.png") });
});

for (const [label, width, height, lang] of [
  ["desktop-en", 1440, 900, "en"], ["desktop-zh", 1440, 900, "zh"],
  ["tablet-en", 820, 1180, "en"], ["mobile-en", 390, 844, "en"], ["mobile-zh", 390, 844, "zh"],
] as const) {
  test(`visual review ${label}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/dev/settings?s=terminal&lang=${lang}`);
    await expect(page.locator(".acs-tfg button")).toHaveCount(18);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(`${label}.png`) });
    if (width === 390) {
      await page.locator(".acs-color-options").scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`${label}-chart-defaults.png`) });
    }
  });
}

test("every account section remains reachable in a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await open(page);
  const destinations = await page.locator(".acs-nav-b").evaluateAll(tabs => tabs.map(tab => tab.id));
  for (const id of destinations) {
    await page.locator(`#${id}`).click();
    await expect(page.locator(".acs-head .acs-x")).toBeInViewport();
    expect(await page.locator(".acs-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1), id).toBe(true);
  }
});
