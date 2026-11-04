import { expect, test, type Page } from "@playwright/test";

// Runs real AppShell/ShellDirectory/Link and the existing development-only
// identity seam. No alternative directory renderer or production auth change.
test.skip(process.env.MMX_SHARED_SHELL !== "1", "Existing beta opt-in required");
test.use({ colorScheme: "dark" });
const directory = (page: Page) => page.locator(".shared-shell-directory[open]");
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
  if (page.viewportSize()!.width <= 860) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.locator(".m-drawer.open").getByRole("button", { name: "All tools", exact: true }).click();
  } else {
    await page.locator(".topbar .shared-shell-directory-trigger").click();
  }
  await expect(directory(page)).toBeVisible();
  await expect(directory(page).getByRole("searchbox")).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(1);
}

async function contained(page: Page) {
  const box = await directory(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}


test("four-identity facet preserves the real query corpus through keyboard and touch recovery", async ({ page }, info) => {
  await open(page);
  const dialog = directory(page);
  await dialog.getByRole("searchbox").fill("options");
  const before = await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  expect(before).toHaveLength(12);
  const expected = before.filter(href => ["/options", "/options.html", "/options_screener.html", "/options/futures"].includes(href!));
  const touch = info.project.use.hasTouch === true;
  await dialog.evaluate(element => {
    Reflect.set(window, "__f01FacetPointers", []);
    element.addEventListener("pointerdown", event => {
      (Reflect.get(window, "__f01FacetPointers") as string[]).push((event as PointerEvent).pointerType);
    });
  });
  const facet = dialog.getByRole("button", { name: "Options & futures", exact: true });
  if (touch) await facet.tap(); else await facet.click();
  await expect(facet).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("status")).toHaveText("4 in this category");
  expect(await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")))).toEqual(expected);
  expect(await dialog.locator(".shared-directory-link small").allTextContents()).toEqual(expected);
  const reset = dialog.getByRole("button", { name: "Show all 12 matches", exact: true });
  expect((await reset.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await contained(page);
  await page.screenshot({ animations: "disabled", path: info.outputPath("options-facet-dark-en.png") });
  if (touch) await reset.tap(); else { await reset.focus(); await page.keyboard.press("Enter"); }
  await expect(dialog.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("searchbox")).toHaveValue("options");
  expect(await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")))).toEqual(before);
  expect(await page.evaluate(() => document.activeElement?.isConnected && !!document.querySelector(".shared-shell-directory[open]")?.contains(document.activeElement))).toBe(true);
  const pointers = await page.evaluate(() => Reflect.get(window, "__f01FacetPointers") as string[]);
  if (touch) expect(pointers.filter(kind => kind === "touch")).toHaveLength(2);
  await info.attach("facet-corpus-and-input", { body: JSON.stringify({ before, facet: expected, touch, pointers }), contentType: "application/json" });
});

test("empty facet recovers a real query with more than 48 results to its first batch", async ({ page }, info) => {
  await open(page);
  const dialog = directory(page);
  await dialog.getByRole("searchbox").fill("fund");
  await expect(dialog.locator(".shared-directory-link")).toHaveCount(48);
  const firstBatch = await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  const countText = await dialog.getByRole("status").innerText();
  const total = Number(countText.match(/^([\d,]+) matches/)?.[1].replaceAll(",", ""));
  expect(total).toBeGreaterThan(48);
  await dialog.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(dialog.locator(".shared-directory-link")).toHaveCount(Math.min(total, 96));
  await dialog.getByRole("button", { name: "Options & futures", exact: true }).click();
  await expect(dialog.locator(".shared-directory-link")).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "No matches in this category", exact: true })).toBeVisible();
  const reset = dialog.getByRole("button", { name: `Show all ${total} matches`, exact: true });
  if (info.project.use.hasTouch) await reset.tap(); else { await reset.focus(); await page.keyboard.press("Enter"); }
  await expect(dialog.getByRole("searchbox")).toHaveValue("fund");
  await expect(dialog.locator(".shared-directory-link")).toHaveCount(48);
  expect(await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")))).toEqual(firstBatch);
  await expect(dialog.getByRole("status")).toContainText(`Showing 48 of ${total}`);
  await expect(dialog.getByRole("button", { name: "Show more", exact: true })).toBeVisible();
  await contained(page);
  await info.attach("facet-batch-recovery", { body: JSON.stringify({ query: "fund", total, firstBatch }), contentType: "application/json" });
});

test("facet follows actual locale controls without expanding Chinese search aliases", async ({ page }, info) => {
  await open(page);
  let dialog = directory(page);
  await dialog.getByRole("searchbox").fill("options");
  await dialog.getByRole("button", { name: "Options & futures", exact: true }).click();
  const retained = await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await page.getByRole("button", { name: "Chinese language", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("main").first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+k");
  dialog = directory(page);
  await expect(dialog.getByRole("button", { name: "期权与期货", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")))).toEqual(retained);
  await expect(dialog.getByRole("searchbox")).toHaveValue("options");
  await page.setViewportSize({ width: 320, height: 420 });
  await contained(page);
  await page.screenshot({ animations: "disabled", path: info.outputPath("options-facet-short-light-zh.png") });
  const lastDestination = dialog.locator(".shared-directory-link").last();
  await lastDestination.scrollIntoViewIfNeeded();
  const lastBox = await lastDestination.boundingBox();
  const viewport = await dialog.locator(".shared-directory-results").boundingBox();
  expect(lastBox!.y).toBeGreaterThanOrEqual(viewport!.y - 1);
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height + 1);
  await expect(lastDestination).toHaveAttribute("href", "/options_screener.html");
  await page.screenshot({ animations: "disabled", path: info.outputPath("options-facet-short-last-destination.png") });
  await dialog.getByRole("button", { name: "全部", exact: true }).click();
  await dialog.getByRole("searchbox").fill("期权");
  const chineseAll = await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  expect(chineseAll.length).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "期权与期货", exact: true }).click();
  const chineseFacet = await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  expect(chineseFacet).toEqual(chineseAll.filter(href => retained.includes(href)));
  await dialog.getByRole("button", { name: "全部", exact: true }).click();
  expect(await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")))).toEqual(chineseAll);
  await expect(dialog.getByRole("searchbox")).toHaveValue("期权");
  await info.attach("facet-locale-corpus", { body: JSON.stringify({ chineseAll, chineseFacet, englishFacet: retained }), contentType: "application/json" });
});

test("query-wide recovery is distinct from category scope in the real catalogue", async ({ page }, info) => {
  await open(page);
  const dialog = directory(page);
  await dialog.getByRole("searchbox").fill("options");
  await expect(dialog.locator(".shared-directory-link")).toHaveCount(12);
  const before = await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(n => n.getAttribute("href")));
  expect(before).toEqual(expect.arrayContaining(["/options", "/options.html", "/options_screener.html", "/options/futures"]));
  await dialog.getByRole("button", { name: "Workspaces", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("2 in this category");
  await expect(dialog.locator(".shared-directory-link")).toHaveCount(2);
  const recovery = dialog.getByRole("button", { name: "Show all 12 matches", exact: true });
  expect((await recovery.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await contained(page);
  await page.screenshot({ animations: "disabled", path: info.outputPath("category-recovery-dark-en.png") });
  await recovery.focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "All", exact: true })).toBeFocused();
  await expect(dialog.getByRole("searchbox")).toHaveValue("options");
  expect(await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(n => n.getAttribute("href")))).toEqual(before);
  await dialog.getByRole("button", { name: "Research", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "No matches in this category", exact: true })).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("0 in this category");
  await expect(dialog.getByRole("button", { name: "Show all 12 matches", exact: true })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: info.outputPath("empty-category-dark-en.png") });
});

test("clear query, batching and same-instance reopen retain the correct state", async ({ page }) => {
  await open(page); const dialog = directory(page);
  await dialog.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(dialog.locator(".shared-directory-link")).toHaveCount(96);
  await page.keyboard.press("Escape"); await open(page);
  await expect(dialog.locator(".shared-directory-link")).toHaveCount(96);
  await dialog.getByRole("searchbox").fill("no-such-directory-destination-20261104");
  await expect(dialog.getByRole("heading", { name: "No pages found", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Tools", exact: true }).click();
  await dialog.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(dialog.getByRole("searchbox")).toHaveValue("");
  await expect(dialog.getByRole("searchbox")).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Tools", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".shared-directory-results")).not.toHaveAttribute("aria-live", /.+/);
  await expect(dialog.getByRole("status")).toHaveAttribute("aria-atomic", "true");
});

test("actual locale/theme controls preserve a filtered directory across reopen", async ({ page }, info) => {
  await open(page); let dialog = directory(page);
  await dialog.getByRole("searchbox").fill("options");
  await dialog.getByRole("button", { name: "Workspaces", exact: true }).click();
  const identities = await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(n => n.getAttribute("href")));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await page.getByRole("button", { name: "Chinese language", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // Keyboard invocation uses the existing shell listener after the old modal closed.
  await page.locator("main").first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+k"); dialog = directory(page);
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole("searchbox")).toHaveValue("options");
  await expect(dialog.getByRole("button", { name: "工作区", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(n => n.getAttribute("href")))).toEqual(identities);
  await expect(dialog.getByRole("button", { name: "查看全部 12 个匹配结果", exact: true })).toBeVisible();
  await contained(page);
  await page.screenshot({ animations: "disabled", path: info.outputPath("category-recovery-light-zh.png") });
  await page.setViewportSize({ width: 320, height: 420 });
  await contained(page); await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeVisible();
  await expect(dialog.getByRole("searchbox")).toBeVisible();
  await page.screenshot({ animations: "disabled", path: info.outputPath("short-320-light-zh.png") });
});

test("drawer-to-directory and resize close return to a visible persistent control", async ({ page }, info) => {
  await open(page); await directory(page).getByRole("searchbox").fill("options");
  if (info.project.name === "desktop") await page.setViewportSize({ width: 320, height: 844 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await page.screenshot({ animations: "disabled", path: info.outputPath("visible-focus-return.png") });
});

test("shortcut from BODY returns to a meaningful visible shell control", async ({ page }, info) => {
  // Establish the mounted shell through its actual UI before testing its global
  // listener; an SSR heading alone does not prove that listener is installed.
  await open(page); await page.keyboard.press("Escape");
  await expect(directory(page)).toHaveCount(0);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  const before = await page.evaluate(() => ({ tabIndex: document.body.getAttribute("tabindex"), x: scrollX, y: scrollY }));
  await page.keyboard.press("ControlOrMeta+k");
  await expect(directory(page)).toBeVisible();
  await expect(directory(page).getByRole("searchbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(directory(page)).toHaveCount(0);
  const returnTarget = page.viewportSize()!.width <= 860
    ? page.getByRole("button", { name: "Open navigation", exact: true })
    : page.locator(".topbar .shared-shell-directory-trigger");
  await expect(returnTarget).toBeFocused(); await expect(returnTarget).toBeVisible();
  expect(await page.evaluate(() => ({ tabIndex: document.body.getAttribute("tabindex"), x: scrollX, y: scrollY }))).toEqual(before);
  await page.screenshot({ animations: "disabled", path: info.outputPath("shortcut-meaningful-return.png") });
});

test("Show all reveals its focused category inside the scrolled strip", async ({ page }, info) => {
  await page.setViewportSize({ width: info.project.name === "mobile" ? 390 : 320, height: 844 });
  await open(page);
  const dialog = directory(page);
  const search = dialog.getByRole("searchbox");
  await search.fill("options");
  const before = await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(n => n.getAttribute("href")));
  await dialog.getByRole("button", { name: "About", exact: true }).click();
  const strip = dialog.locator(".shared-directory-filters");
  await strip.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const all = dialog.getByRole("button", { name: "All", exact: true });
  const geometry = () => all.evaluate(element => {
    const strip = element.closest(".shared-directory-filters")!;
    const outer = strip.getBoundingClientRect(); const target = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { scrollLeft: strip.scrollLeft, left: target.left, right: target.right,
      top: target.top, bottom: target.bottom,
      focusOutset: Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)),
      clipLeft: outer.left + strip.clientLeft, clipRight: outer.left + strip.clientLeft + strip.clientWidth,
      clipTop: outer.top + strip.clientTop, clipBottom: outer.top + strip.clientTop + strip.clientHeight };
  });
  const clipped = await geometry();
  expect(clipped.scrollLeft).toBeGreaterThan(0);
  expect(clipped.left < clipped.clipLeft - 1 || clipped.right > clipped.clipRight + 1).toBe(true);
  const scrollBefore = await page.evaluate(() => ({ x: scrollX, y: scrollY,
    main: [...document.querySelectorAll("main, .main2")].map(node => ({ x: node.scrollLeft, y: node.scrollTop })) }));
  await dialog.getByRole("button", { name: `Show all ${before.length} matches`, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(all).toBeFocused(); await expect(all).toHaveAttribute("aria-pressed", "true");
  const revealed = await geometry();
  expect(revealed.focusOutset).toBeGreaterThan(0);
  expect(revealed.left - revealed.focusOutset).toBeGreaterThanOrEqual(revealed.clipLeft - 1);
  expect(revealed.right + revealed.focusOutset).toBeLessThanOrEqual(revealed.clipRight + 1);
  expect(revealed.top - revealed.focusOutset).toBeGreaterThanOrEqual(revealed.clipTop - 1);
  expect(revealed.bottom + revealed.focusOutset).toBeLessThanOrEqual(revealed.clipBottom + 1);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY,
    main: [...document.querySelectorAll("main, .main2")].map(node => ({ x: node.scrollLeft, y: node.scrollTop })) }))).toEqual(scrollBefore);
  await expect(search).toHaveValue("options");
  expect(await dialog.locator(".shared-directory-link").evaluateAll(nodes => nodes.map(n => n.getAttribute("href")))).toEqual(before);
  await page.screenshot({ animations: "disabled", path: info.outputPath("revealed-category-focus.png") });
});

test("directory transfers once to the real company picker and respects composing Escape", async ({ page }) => {
  await open(page); const input = directory(page).getByRole("searchbox");
  await input.dispatchEvent("compositionstart", { data: "期" });
  await input.dispatchEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
  await expect(directory(page)).toBeVisible();
  await input.dispatchEvent("compositionend", { data: "期权" });
  await directory(page).locator(".shared-directory-footer button").click();
  await expect(directory(page)).toHaveCount(0); await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Search companies");
  await expect(page.getByRole("dialog").getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("native dialog cancellation respects the captured Escape owner", async ({ page }) => {
  await open(page); const input = directory(page).getByRole("searchbox");
  // Native Escape after composition ends in a child listener must still belong
  // to that composition. This exercises native dialog cancellation in Chromium;
  // it does not establish an operating-system IME or assistive-technology pass.
  await input.dispatchEvent("compositionstart", { data: "期" });
  await input.evaluate(element => element.addEventListener("keydown", () => {
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "期权" }));
  }, { once: true }));
  await page.keyboard.press("Escape");
  await expect(directory(page)).toBeVisible(); await expect(input).toBeFocused();
  const guarded = await input.evaluate(element => {
    const modal = element.closest("dialog")!;
    for (const signal of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...signal }));
      modal.requestClose();
      if (!modal.open) return false;
    }
    // Consumed protection cannot block a second independent request, even
    // before a keyup or the expiry task has run.
    modal.requestClose();
    return true;
  });
  expect(guarded).toBe(true);
  await expect(directory(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("real Next Link keeps the current directory on modified activation", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "Single real new-tab browser case");
  await open(page); await directory(page).getByRole("searchbox").fill("options");
  const link = directory(page).locator('a[href="/options"]');
  const popupPromise = context.waitForEvent("page");
  await link.click({ modifiers: ["ControlOrMeta"] });
  const popup = await popupPromise; await popup.waitForURL(/\/options$/); await popup.close();
  await expect(directory(page)).toBeVisible();
  await expect(directory(page).getByRole("searchbox")).toHaveValue("options");
  await link.click(); await expect(page).toHaveURL(/\/options$/); await expect(directory(page)).toHaveCount(0);
});
