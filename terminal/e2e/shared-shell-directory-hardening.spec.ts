import { expect, test, type Page } from "@playwright/test";

// Runs real AppShell/ShellMegaMenu/Link and the existing development-only
// identity seam. No alternative directory renderer or production auth change.
test.skip(process.env.MMX_SHARED_SHELL !== "1", "Existing beta opt-in required");
test.use({ colorScheme: "dark" });
const directory = (page: Page) => page.locator("#shared-shell-tools");
const observations = new WeakMap<Page, { pageErrors: string[]; consoleErrors: string[]; failedRequests: string[]; httpErrors: string[] }>();

test.beforeEach(async ({ context, page, baseURL }) => {
  const observed = { pageErrors: [] as string[], consoleErrors: [] as string[], failedRequests: [] as string[], httpErrors: [] as string[] };
  observations.set(page, observed);
  page.on("pageerror", error => { if (observed.pageErrors.length < 40) observed.pageErrors.push(error.message.slice(0,1000)); });
  page.on("console", message => { if (message.type() === "error" && observed.consoleErrors.length < 40) {
    const location = message.location();
    const source = location.url ? new URL(location.url).pathname : "unknown";
    observed.consoleErrors.push(`${message.text().slice(0,1000)} [${source}:${location.lineNumber}]`);
  } });
  page.on("requestfailed", request => { if (observed.failedRequests.length < 40) observed.failedRequests.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`); });
  page.on("response", response => { if (response.status() >= 400 && observed.httpErrors.length < 40) observed.httpErrors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  await context.addCookies([
    { name: "mm_e2e_rs30", value: "1", url: baseURL! },
    { name: "mm_e2e_guest", value: "1", url: baseURL! },
  ]);
  await page.route("**/data/manifest.json", route => route.fulfill({ json: {
    as_of: null, symbols: { AAPL: { name: "Apple Inc.", zh: "苹果公司", col: "#aaa", verdict: null, mkt: "NASDAQ", sec: "Equities" } },
  } }));
  await page.goto("/discover");
  await expect(page.locator('[data-shared-shell="beta"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
});

test.afterEach(async ({ page }, info) => {
  await info.attach("browser-observations", { body: JSON.stringify({
    basis: "Existing development fixture; real AppShell/Directory/Link, controlled company manifest, no production acceptance",
    viewport: page.viewportSize(), url: page.url(), observed: observations.get(page),
  }, null, 2), contentType: "application/json" });
  expect(observations.get(page)?.pageErrors ?? [], "Uncaught browser errors").toEqual([]);
});

async function open(page: Page) {
  const phone = page.viewportSize()!.width <= 860;
  if (phone) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    const drawer = page.locator(".m-drawer.open");
    await expect(drawer.getByRole("link", { name: "Terminal", exact: true })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Mastermind AI", exact: true })).toHaveAttribute("href", /^\/brain/);
    await drawer.getByRole("button", { name: "Browse tools" }).click();
  } else {
    await page.locator("[data-tool-browser-trigger]").click();
  }
  await expect(directory(page)).toBeVisible();
  await expect(directory(page).locator("[data-family]")).toHaveCount(6);
  await expect(directory(page).getByRole("searchbox")).toHaveCount(0);
}

test("browse each tool family, expand secondary desks and follow native links", async ({ page }, info) => {
  await open(page);
  const nav = directory(page);
  await nav.getByRole("button", { name: /Options & flows/ }).click();
  const tape = nav.getByRole("link", { name: /^Options tape/ });
  await expect(tape).toHaveAttribute("href", /^\/options\?tab=tape/);
  const more = nav.locator("summary");
  await more.focus(); await page.keyboard.press("Enter");
  await expect(nav.getByRole("link", { name: "Market tide", exact: true })).toBeVisible();
  await expect(nav.locator('a[href^="https://www.mastermind-x.com/"]').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("browse-options-dark-en.png"), animations: "disabled" });
  await nav.getByRole("button", { name: /Markets & macro/ }).click();
  await nav.getByRole("link", { name: "Market Reference", exact: true }).click();
  await expect(page).toHaveURL(/\/market-reference(\?|$)/);
  await expect(directory(page)).toHaveCount(0);
});

test("keyboard activation restores focus and releases the touch sheet", async ({ page }) => {
  await open(page);
  const nav = directory(page);
  await nav.locator("[data-family]").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(nav.locator("[data-family]").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(nav.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(nav).toHaveCount(0);
  await expect(page.locator(page.viewportSize()!.width <= 860 ? "[data-shell-menu-opener]:visible" : "[data-tool-browser-trigger]")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).not.toBe("hidden");
});

test("pointer crosses from the rail into family rows and dismisses outside", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop hover interaction");
  const opener = page.locator("[data-tool-browser-trigger]");
  await opener.hover();
  await expect(directory(page)).toBeVisible();
  await directory(page).getByRole("button", { name: /Research/ }).hover();
  await expect(directory(page).getByRole("heading", { name: /Research/ }).first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".topbar-brand-group").click({ position: { x: 5, y: 5 } });
  await expect(directory(page)).toHaveCount(0);
});

test("light Chinese browse and independent search stay reachable at narrow widths", async ({ page }, info) => {
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await page.getByRole("button", { name: "Chinese language", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(directory(page)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 560 });
  await expect(directory(page).getByRole("button", { name: /研究/ })).toBeVisible();
  await directory(page).getByRole("button", { name: /研究/ }).click();
  await expect(directory(page).getByRole("link").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("browse-research-light-zh.png"), animations: "disabled" });
  await page.keyboard.press("Escape"); await page.keyboard.press("/");
  await expect(page.getByRole("dialog").getByRole("combobox")).toBeFocused();
});

test("modified navigation retains the selected tool family for the original tab", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "Single real new-tab browser case");
  await open(page);
  const link = directory(page).getByRole("link", { name: "Market Reference", exact: true });
  const spawned = context.waitForEvent("page");
  await link.click({ modifiers: ["ControlOrMeta"] });
  const popup = await spawned;
  await popup.waitForURL(/\/market-reference(\?|$)/);
  await popup.close();
  await expect(directory(page)).toBeVisible();
});
