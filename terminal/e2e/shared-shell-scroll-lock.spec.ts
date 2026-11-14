import { expect, test } from "@playwright/test";

// Real AppShell, navigation and Tools dialog. The existing development-only
// identity seam is local test setup, not a production authentication bypass.
test.skip(process.env.MMX_SHARED_SHELL !== "1", "Existing beta opt-in required");

test("Tools handoff owns scroll only on touch and restores it on every close", async ({ context, page, baseURL }, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await context.addCookies([
    { name: "mm_e2e_rs30", value: "1", url: baseURL! },
    { name: "mm_e2e_guest", value: "1", url: baseURL! },
  ]);
  await page.route("**/data/manifest.json", route => route.fulfill({ json: {
    as_of: null, symbols: { AAPL: { name: "Apple Inc.", zh: "Apple", col: "#aaa", verdict: null, mkt: "NASDAQ", sec: "Equities" } },
  } }));
  await page.goto("/discover");
  await expect(page.locator('[data-shared-shell="beta"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  const original = await page.evaluate(() => ({ body: document.body.style.overflow, root: document.documentElement.style.overflow }));
  const directory = page.locator("#shared-shell-tools");
  const phone = page.viewportSize()!.width <= 860;
  for (let cycle = 0; cycle < 2; cycle++) {
    if (phone) {
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      await page.locator(".m-drawer.open").getByRole("button", { name: "Browse tools", exact: true }).click();
    } else {
      await page.locator("[data-tool-browser-trigger]").click();
    }
    await expect(directory).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(phone ? 1 : 0);
    await expect(directory.locator("[data-family]").first()).toBeFocused();
    await expect.poll(() => page.evaluate(() => ({ body: document.body.style.overflow, root: document.documentElement.style.overflow }))).toEqual(phone ? { body: "hidden", root: "hidden" } : original);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (cycle === 0) await page.screenshot({ path: info.outputPath("tools-scroll-owner.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(directory).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ({ body: document.body.style.overflow, root: document.documentElement.style.overflow }))).toEqual(original);
  }
  await page.screenshot({ path: info.outputPath("workspace-after-tools-close.png"), animations: "disabled" });
  expect(pageErrors).toEqual([]);
});