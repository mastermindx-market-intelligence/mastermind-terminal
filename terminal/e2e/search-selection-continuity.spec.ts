import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_WLS_KEY, e2eWatchlistOwner, isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

test.setTimeout(90_000);

async function visibleSelection(input: Locator) {
  await expect.poll(() => input.evaluate(node => {
    const option = document.getElementById(node.getAttribute("aria-activedescendant") ?? "");
    const list = document.getElementById(node.getAttribute("aria-controls") ?? "");
    if (!option || !list) return false;
    const row = option.getBoundingClientRect();
    const owner = getComputedStyle(list).overflowY === "visible" ? list.closest<HTMLElement>(".msheet-body") : list;
    if (!owner) return false;
    const box = owner.getBoundingClientRect();
    const top = Math.max(box.top + owner.clientTop, node.getBoundingClientRect().bottom);
    const bottom = Math.min(box.top + owner.clientTop + owner.clientHeight, innerHeight);
    return row.top >= top - 1 && row.bottom <= bottom + 1;
  })).toBe(true);
}

async function walkResults(page: Page, input: Locator) {
  await input.click();
  const list = page.locator(`[id="${await input.getAttribute("aria-controls")}"]`);
  const scrollOwner = await list.evaluate(node => getComputedStyle(node).overflowY) === "visible" ? page.locator(".msheet-search .msheet-body") : list;
  await expect.poll(() => list.getByRole("option").count()).toBeGreaterThan(18);
  const before = await input.boundingBox();
  const pageScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  for (let i = 0; i < 18; i++) { await input.press("ArrowDown"); await visibleSelection(input); }
  expect(await scrollOwner.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(input).toBeFocused();
  const after = await input.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(pageScroll);
  return { list, scrollOwner };
}

test("ordinary search reveals long keyboard selections without moving the dialog", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  const opener = info.project.name === "desktop" ? page.locator(".pair").first() : page.locator(".m-symbar [data-symbol-search]");
  await opener.click();
  const input = page.locator(".sh input");
  await input.fill("A");
  const { list, scrollOwner } = await walkResults(page, input);
  await page.screenshot({ path: info.outputPath(`search-keyboard-${info.project.name}.png`) });

  // Hovering a partially clipped edge row must not move the list under the pointer.
  const bounds = await scrollOwner.boundingBox();
  const beforeHover = await scrollOwner.evaluate(node => node.scrollTop);
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height - 3);
  expect(await scrollOwner.evaluate(node => node.scrollTop)).toBe(beforeHover);
  await page.mouse.move(0, 0);
  await input.fill("AAPL");
  await expect(list.getByRole("option").first()).toContainText("AAPL");
  await visibleSelection(input);
  expect(await scrollOwner.evaluate(node => node.scrollTop)).toBe(0);
  await input.press("Escape");
  await expect(input).toBeHidden();
  await expect(opener).toBeFocused();
});

test("ordinary search keeps its query and selection across dialog and drawer presentations", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One explicit breakpoint-continuation case");
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await page.locator(".pair").first().click();
  const input = page.locator(".sh input"); await input.fill("A");
  await walkResults(page, input);
  const selectedId = await input.getAttribute("aria-activedescendant");
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport); await expect(input).toBeVisible();
    await expect(input).toHaveValue("A"); await expect(input).toHaveAttribute("aria-activedescendant", selectedId!);
    await visibleSelection(input);
  }
  await input.press("Escape"); await expect(input).toBeHidden();
  // Cross-presentation opener restoration is a separately recorded incumbent
  // focus-owner issue. The ordinary test above proves single-presentation return.
});

test("Add ignores a no-match query and commits a deliberate valid symbol once", async ({ page, baseURL }, info) => {
  const store = await isolateWatchlistStore(page, info, baseURL);
  const owner = e2eWatchlistOwner(store);
  await seedOwnerWatchlists(page, store, { lists: { "Search polish": [{ symbol: "MSFT", section: "EQUITIES" }] }, active: "Search polish" });
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  const viewport = page.viewportSize()!;
  // Add is a desktop rail entry; verify the same open task after narrowing too.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  const saved = () => page.evaluate(([key, slot]) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}")[slot];
    return (state?.lists?.["Search polish"] ?? []).map((item: { symbol: string }) => item.symbol);
  }, [E2E_WLS_KEY, owner]);
  await expect.poll(saved).toEqual(["MSFT"]);
  await page.locator(".wl-acts button").first().click();
  await page.setViewportSize(viewport);
  const input = page.locator(".smodal-add .sh input");
  await input.fill("zzzzzz-no-listing");
  await expect(page.locator(".smodal-add .empty")).toBeVisible();
  await input.press("Enter"); await input.press("Shift+Enter");
  await expect(input).toBeVisible(); expect(await saved()).toEqual(["MSFT"]);
  await input.fill("AAPL");
  await expect(page.locator(".smodal-add .r .tk").first()).toHaveText("AAPL");
  await input.press("Enter");
  await expect.poll(saved).toEqual(["MSFT", "AAPL"]);
  await expect(input).toBeFocused();
  await page.screenshot({ path: info.outputPath(`search-add-${info.project.name}.png`) });
});

test("Shared Companies keeps keyboard selection visible inside its own list", async ({ page }, info) => {
  test.skip(process.env.MMX_SHARED_SHELL !== "1", "Existing beta opt-in owns Shared Companies");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await page.route("**/data/manifest.json", route => route.fulfill({ json: { as_of: null, symbols: Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [`T${String(i).padStart(2, "0")}`, { name: `Sample company ${i}`, col: "#777", verdict: null, sec: "Equities", mkt: "NASDAQ" }]),
  ) } }));
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible({ timeout: 30_000 });
  const opener = info.project.name === "desktop" ? page.locator(".topbar .shared-shell-company-search") : page.locator(".mobilebar").getByRole("button", { name: "Search companies", exact: true });
  await opener.click();
  const input = page.getByRole("dialog").getByRole("combobox");
  await input.fill("Sample");
  await walkResults(page, input);
  await page.screenshot({ path: info.outputPath(`search-companies-${info.project.name}.png`) });
  await input.press("Escape"); await expect(input).toBeHidden(); await expect(opener).toBeFocused();
});
