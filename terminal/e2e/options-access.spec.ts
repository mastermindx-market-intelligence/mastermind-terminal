import { expect, test, type Locator, type Page } from "@playwright/test";
import { SS_OPEN } from "../components/onboarding/types";

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.metadata.optionsAccess !== true, "Use playwright.options-access.config.ts with the real Options gate");
  await page.emulateMedia({ colorScheme: "dark" });
});

async function shellVisible(page: Page) {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const header = page.locator(page.viewportSize()!.width <= 900 ? ".mobilebar" : ".topbar");
  await expect(header).toBeVisible();
  expect((await header.boundingBox())!.y).toBeGreaterThanOrEqual(0);
}

async function reachable(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  const box = await target.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  expect(await target.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === node || node.contains(hit);
  })).toBe(true);
  await expect(target).toBeFocused();
  await shellVisible(page);
}

async function skipToGate(page: Page, zh = false) {
  const skip = page.getByRole("link", { name: zh ? "跳至内容" : "Skip to content", exact: true });
  await skip.focus();
  await skip.press("Enter");
  await expect(page.locator("main#shared-shell-content")).toBeFocused();
  await shellVisible(page);
}

test("Options paywall supports skip navigation and the existing Essential entry", async ({ page }, info) => {
  await page.goto("/options");
  const main = page.locator("main#shared-shell-content");
  for (const zh of [false, true]) {
    if (zh) {
      await page.getByRole("button", { name: "Light theme", exact: true }).click();
      await page.getByRole("button", { name: "Chinese language", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    }
    const action = main.getByRole("button", { name: zh ? "开启 7 天免费试用" : "Start 7-day free trial", exact: true });
    await expect(action).toBeVisible();
    await skipToGate(page, zh);
    await reachable(page, action);
    await action.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: zh ? "创建账户" : "Create your account", exact: true })).toBeVisible();
    expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "{}").plan, SS_OPEN)).toBe("essential");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await main.evaluate((node) => { node.scrollTop = 0; });
    await page.screenshot({ animations: "disabled", path: info.outputPath(`options-paywall-${zh ? "light-zh" : "dark-en"}.png`) });
  }
});

test("short Options access views scroll without moving the shell header", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Explicit viewport loop runs once");
  for (const viewport of [{ width: 568, height: 320 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/options");
    const main = page.locator("main#shared-shell-content");
    const action = main.getByRole("button", { name: "Start 7-day free trial", exact: true });
    await expect(action).toBeVisible();
    await skipToGate(page);
    await reachable(page, action);
    if (viewport.height === 320) expect(await main.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`options-short-${viewport.width}x${viewport.height}.png`) });
    await main.evaluate((node) => { node.scrollTop = 0; });
    await expect(main.getByRole("heading", { level: 1 })).toBeInViewport();
    expect((await main.boundingBox())!.y).toBeGreaterThanOrEqual(56);
  }
});

test("Options session recovery keeps its existing retry and no temporary upsell", async ({ page }) => {
  await page.addInitScript(() => {
    document.cookie = "sb-local-auth-token=fixture; path=/; SameSite=Lax";
    sessionStorage.setItem("mmx-member-session-restore", String(Date.now()));
  });
  await page.goto("/options");
  const main = page.locator("main#shared-shell-content");
  await expect(main.getByRole("heading", { name: "Unable to verify account access", exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Start 7-day free trial", exact: true })).toHaveCount(0);
  await skipToGate(page);
  const retry = main.getByRole("button", { name: "Try again", exact: true });
  await reachable(page, retry);
  await retry.press("Enter");
  await expect(main.getByRole("button", { name: "Start 7-day free trial", exact: true })).toBeVisible();
});

test("Options authority outage keeps retry and chart return reachable", async ({ page, context }, info) => {
  if (info.project.name === "desktop") await page.setViewportSize({ width: 568, height: 320 });
  // Existing dev-only shell identity fixture keeps chrome available while the
  // real Options auth reader encounters an unavailable loopback provider.
  const session = { access_token: "malformed-local-test-token", refresh_token: "local-test-only",
    expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer",
    user: { id: "00000000-0000-4000-8000-000000000001" } };
  await context.addCookies([
    { name: "mm_e2e_rs30", value: "1" }, { name: "mm_e2e_guest", value: "1" },
    { name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` },
  ].map((cookie) => ({ ...cookie, url: new URL(info.project.use.baseURL!).origin, sameSite: "Lax" as const })));
  await page.goto("/options");
  const main = page.locator("main#shared-shell-content");
  const heading = main.getByRole("heading", { name: "Options is temporarily unavailable", exact: true });
  await expect(heading).toBeVisible();
  await expect(main.locator('[role="status"]')).toContainText("This does not mean your subscription changed");
  await expect(main.getByRole("button", { name: "Start 7-day free trial", exact: true })).toHaveCount(0);
  await skipToGate(page);
  const retry = main.getByRole("button", { name: "Try again", exact: true });
  await reachable(page, retry);
  const reloaded = page.waitForEvent("domcontentloaded");
  await retry.press("Enter");
  await reloaded;
  await expect(heading).toBeVisible();
  const chart = main.getByRole("link", { name: "Go to chart", exact: true });
  await expect(chart).toHaveAttribute("href", "/terminal");
  await reachable(page, chart);
  await page.screenshot({ animations: "disabled", path: info.outputPath("options-outage-actions.png") });
  await chart.press("Enter");
  await expect(page).toHaveURL(/\/terminal(?:\?|$)/);
});
