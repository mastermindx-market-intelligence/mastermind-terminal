import { expect, test, type Locator, type Page, type TestInfo } from "./fixtures";
import { E2E_WL_FLAGS_KEY, E2E_WL_NOTES_KEY, E2E_WLS_KEY, e2eWatchlistOwner, isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

const SEED = {
  lists: {
    Default: [],
    "Bulk Test": [
      { symbol: "AAPL", section: "Core" },
      { symbol: "MSFT", section: "Core" },
      { symbol: "NVDA", section: "Growth" },
      { symbol: "AMD", section: "Growth" },
    ],
    Other: [],
  },
  active: "Bulk Test",
  meta: {
    Default: { sections: [], collapsed: [] },
    "Bulk Test": { sections: ["Core", "Growth", "Archive"], collapsed: [] },
    Other: { sections: [], collapsed: [] },
  },
};

let owner = e2eWatchlistOwner();
/** This owner's saved payload, read out of the owner-scoped envelope. */
const savedState = (page: Page) => page.evaluate(([key, slot]) => {
  try { return JSON.parse(localStorage.getItem(key) || "{}")[slot] ?? {}; } catch { return {}; }
}, [E2E_WLS_KEY, owner] as const);
const savedMap = (page: Page, key: string) => page.evaluate(([storageKey, slot]) => {
  try { return JSON.parse(localStorage.getItem(storageKey) || "{}")[slot] ?? {}; } catch { return {}; }
}, [key, owner] as const);

async function boot(page: Page, testInfo: TestInfo, baseURL?: string) {
  // W1b: "Bulk Test" and "Other" are non-Default lists, so a signed-in mount now migrates them
  // into the server store behind /api/watchlist. Give each test its own store or the parallel
  // matrix's deletes and re-inserts reorder this rail (see e2e/watchlistStore.ts).
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  owner = e2eWatchlistOwner(storeKey);
  // A1: local watchlist state is owner-scoped, so the seed goes into the SIGNED-IN owner's slot.
  await seedOwnerWatchlists(page, storeKey, SEED);
  await page.goto("/terminal?symbol=AAPL");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".wl-select")).toContainText("Bulk Test");
  await expect(page.locator(".wl-row")).toHaveCount(4);
}

const row = (page: Page, symbol: string) => page.locator(`[data-watchlist-symbol="${symbol}"]`);

async function dragRow(page: Page, symbol: string, target: Locator, targetBias = 0.5) {
  const source = row(page, symbol);
  const from = await source.boundingBox();
  expect(from).not.toBeNull();
  // The table is intentionally wider than the narrow rail and can be
  // horizontally scrolled. Start from the visible center of the full row;
  // a clipped ticker cell can report coordinates underneath the chart even
  // though the row itself is visible.
  const viewportWidth = page.viewportSize()?.width ?? from!.x + from!.width;
  const visibleLeft = Math.max(0, from!.x);
  const visibleRight = Math.min(viewportWidth, from!.x + from!.width);
  const sourceX = visibleLeft + (visibleRight - visibleLeft) / 2;
  await page.mouse.move(sourceX, from!.y + from!.height / 2);
  await page.mouse.down();
  await expect(page.locator("body")).not.toHaveClass(/rail-resizing/);
  await page.mouse.move(sourceX, from!.y + from!.height / 2 + 9, { steps: 3 });
  // Under a parallel browser load the PointerSensor activation and React's
  // dragging class can land a frame after the final activation move. Wait for
  // that observable boundary before sending target moves; otherwise CDP can
  // deliver the entire second gesture before dnd-kit has installed its active
  // listeners, producing no onDragEnd at all.
  await expect(row(page, symbol)).toHaveClass(/dragging/);
  const to = await target.boundingBox();
  expect(to).not.toBeNull();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height * targetBias, { steps: 12 });
  await page.waitForTimeout(120);
  const settled = await target.boundingBox();
  expect(settled).not.toBeNull();
  await page.mouse.move(settled!.x + settled!.width / 2, settled!.y + settled!.height * targetBias, { steps: 4 });
  await page.mouse.up();
  await expect(row(page, symbol)).not.toHaveClass(/dragging/);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function dragSection(page: Page, section: string, target: Locator) {
  const handle = page.getByRole("button", { name: `Drag section ${section}` });
  await page.locator(`[data-watchlist-section-header="${section}"]`).evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const from = await handle.boundingBox();
  expect(from).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await expect(page.locator("body")).not.toHaveClass(/rail-resizing/);
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2 + 9, { steps: 3 });
  await expect(page.locator(`[data-watchlist-section-header="${section}"].dragging`)).toBeVisible();
  const to = await target.boundingBox();
  expect(to).not.toBeNull();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height * 0.75, { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect(page.locator(`[data-watchlist-section-header="${section}"].dragging`)).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function microDrag(page: Page, target: Locator, deltaY = 12) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator(".wl-row.dragging, .wl-sec.dragging")).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("Shift and Cmd/Ctrl select rows without breaking ordinary chart navigation", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The sortable rail is desktop chrome.");
  await boot(page, testInfo, baseURL);

  await row(page, "MSFT").click();
  await expect(page.locator(".mm-ptag-sym")).toHaveText("MSFT");
  await expect(page.locator("[data-testid='watchlist-selection-count']")).toHaveCount(0);

  await row(page, "AAPL").click();
  await row(page, "NVDA").click({ modifiers: ["Shift"] });
  await expect(page.locator("[data-testid='watchlist-selection-count']")).toHaveText("3 tickers selected");
  await expect(page.locator(".wl-row[aria-selected='true']")).toHaveCount(3);
  await expect(page.locator(".mm-ptag-sym")).toHaveText("AAPL");

  await row(page, "AMD").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator("[data-testid='watchlist-selection-count']")).toHaveText("4 tickers selected");
  await row(page, "MSFT").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator("[data-testid='watchlist-selection-count']")).toHaveText("3 tickers selected");
  await expect(row(page, "MSFT")).toHaveAttribute("aria-selected", "false");

  await row(page, "NVDA").focus();
  await page.keyboard.press("Shift+F10");
  const keyboardMenu = page.getByRole("menu", { name: "Selected ticker actions" });
  await expect(keyboardMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(keyboardMenu).toBeHidden();
  await expect(row(page, "NVDA")).toBeFocused();
});

test("right-click moves, deletes, and creates a watchlist from the selected symbols", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Context menu is a desktop pointer workflow.");
  await boot(page, testInfo, baseURL);

  await row(page, "AAPL").click();
  await row(page, "NVDA").click({ modifiers: ["Shift"] });
  await row(page, "NVDA").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Selected ticker actions" });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("3 tickers selected");

  await menu.getByRole("menuitem", { name: "Move to section" }).click();
  await menu.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.locator("[data-testid='watchlist-selection-count']")).toHaveCount(0);
  for (const symbol of ["AAPL", "MSFT", "NVDA"]) {
    await expect(row(page, symbol)).toHaveAttribute("data-watchlist-section", "Archive");
  }
  await expect.poll(async () => (await savedState(page)).lists["Bulk Test"]
    .filter((item: { section: string }) => item.section === "Archive").length).toBe(3);

  await row(page, "AAPL").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "NVDA").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "NVDA").click({ button: "right" });
  await page.getByRole("menu", { name: "Selected ticker actions" })
    .getByRole("menuitem", { name: "Create new watchlist" }).click();
  await page.locator("#wl-bulk-name").fill("Winners");
  await page.getByRole("menu", { name: "Selected ticker actions" }).getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".wl-select")).toContainText("Winners");
  await expect(row(page, "AAPL")).toBeVisible();
  await expect(row(page, "NVDA")).toBeVisible();
  await expect(row(page, "MSFT")).toHaveCount(0);
  await expect.poll(async () => (await savedState(page)).lists.Winners?.map((item: { symbol: string }) => item.symbol) ?? [])
    .toEqual(["AAPL", "NVDA"]);

  await row(page, "AAPL").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "NVDA").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "NVDA").click({ button: "right" });
  await page.getByRole("menu", { name: "Selected ticker actions" })
    .getByRole("menuitem", { name: "Delete 2 symbols" }).click();
  await expect(page.locator(".wl-row")).toHaveCount(0);
});

test("a single ticker has TradingView-style actions plus our move and new-list actions", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Context menus are desktop chrome.");
  await boot(page, testInfo, baseURL);

  await row(page, "MSFT").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Selected ticker actions" });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("MSFT");
  for (const label of [
    "Flag / unflag MSFT", "Unflag all symbols", "Add MSFT to watchlist", "Add MSFT to compare",
    "Add note for MSFT", "Financials", "Move to section", "Create new watchlist", "Add section", "Add symbol", "Delete symbol",
  ]) await expect(menu).toContainText(label);
  await expect(page.locator("[data-testid='watchlist-selection-count']")).toHaveCount(0);

  await menu.getByRole("button", { name: "Flag color 1" }).click();
  await expect.poll(async () => (await savedMap(page, E2E_WL_FLAGS_KEY)).MSFT).toBe("#f23645");

  await row(page, "MSFT").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Add note for MSFT" }).click();
  await page.locator("#wl-symbol-note").fill("Wait for the earnings retest");
  await menu.getByRole("button", { name: "Save" }).click();
  await expect(row(page, "MSFT").locator(".wl-note-mark")).toBeVisible();
  await expect.poll(async () => (await savedMap(page, E2E_WL_NOTES_KEY)).MSFT).toBe("Wait for the earnings retest");

  await row(page, "MSFT").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Add MSFT to watchlist" }).click();
  await menu.getByRole("menuitem", { name: "Other" }).click();
  await expect.poll(async () => (await savedState(page)).lists.Other?.map((item: { symbol: string }) => item.symbol)).toEqual(["MSFT"]);

  await row(page, "MSFT").click({ button: "right" });
  await page.getByRole("menu", { name: "Selected ticker actions" }).getByRole("menuitem", { name: "Add MSFT to compare" }).click();
  await expect(page.locator(".cmp-badge")).toHaveText("1");

  await row(page, "MSFT").click({ button: "right" });
  await page.getByRole("menu", { name: "Selected ticker actions" }).getByRole("menuitem", { name: /Financials/ }).click();
  await expect(page.getByRole("region", { name: /Microsoft Corp · Overview/ })).toBeVisible();
});

test("adding and removing section dividers preserves the ordered symbol stream", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Section menus are desktop chrome.");
  await boot(page, testInfo, baseURL);

  await row(page, "MSFT").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Selected ticker actions" });
  await menu.getByRole("menuitem", { name: "Add section" }).click();
  await page.locator("#wl-bulk-name").fill("Mega Caps");
  await menu.getByRole("button", { name: "Create" }).click();
  await expect(page.locator('[data-watchlist-section-header="Mega Caps"]')).toBeVisible();
  await expect(row(page, "MSFT")).toHaveAttribute("data-watchlist-section", "Mega Caps");
  await expect(row(page, "AAPL")).toHaveAttribute("data-watchlist-section", "Core");

  const growth = page.locator('[data-watchlist-section-header="Growth"]');
  await growth.click({ button: "right" });
  const sectionMenu = page.getByRole("menu", { name: "Section actions for Growth" });
  await sectionMenu.getByRole("menuitem", { name: "Remove section" }).click();
  await expect(page.locator('[data-watchlist-section-header="Growth"]')).toHaveCount(0);
  await expect(page.locator(".wl-row")).toHaveCount(4);
  await expect(row(page, "NVDA")).toHaveAttribute("data-watchlist-section", "Mega Caps");
  await expect(row(page, "AMD")).toHaveAttribute("data-watchlist-section", "Mega Caps");

  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-watchlist-section-header="Growth"]')).toHaveCount(0);
  await expect(page.locator(".wl-row")).toHaveCount(4);
  await expect(row(page, "NVDA")).toHaveAttribute("data-watchlist-section", "Mega Caps");
});

test("removing the first divider creates an unsectioned run instead of deleting or regrouping symbols", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Section menus are desktop chrome.");
  await boot(page, testInfo, baseURL);

  await page.locator('[data-watchlist-section-header="Core"]').click({ button: "right" });
  await page.getByRole("menu", { name: "Section actions for Core" }).getByRole("menuitem", { name: "Remove section" }).click();
  await expect(page.locator('[data-watchlist-section-header="Core"]')).toHaveCount(0);
  await expect(page.locator(".wl-row")).toHaveCount(4);
  await expect(row(page, "AAPL")).toHaveAttribute("data-watchlist-section", "");
  await expect(row(page, "MSFT")).toHaveAttribute("data-watchlist-section", "");
  await expect.poll(() => page.locator(".wl-row").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-symbol")))).toEqual(["AAPL", "MSFT", "NVDA", "AMD"]);
});

test("section dividers collapse, rename, reorder downward, and remain non-destructive", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Section controls are desktop chrome.");
  test.slow();
  await boot(page, testInfo, baseURL);

  await microDrag(page, page.getByRole("button", { name: "Drag section Core" }));
  await expect.poll(() => page.locator("[data-watchlist-section-header]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-section-header")))).toEqual(["Core", "Growth", "Archive"]);

  const growth = page.locator('[data-watchlist-section-header="Growth"]');
  await growth.locator(".wl-sec-toggle").click();
  await expect(row(page, "NVDA")).toBeHidden();
  await growth.locator(".wl-sec-toggle").click();
  await expect(row(page, "NVDA")).toBeVisible();

  await page.locator('[data-watchlist-section-header="Archive"]').click({ button: "right" });
  const sectionMenu = page.getByRole("menu", { name: "Section actions for Archive" });
  await sectionMenu.getByRole("menuitem", { name: "Rename section" }).click();
  await page.locator("#wl-section-rename").fill("Later");
  await sectionMenu.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('[data-watchlist-section-header="Later"]')).toBeVisible();

  await dragSection(page, "Core", page.locator('[data-watchlist-section-header="Growth"]'));
  await expect.poll(() => page.locator("[data-watchlist-section-header]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-section-header")))).toEqual(["Growth", "Core", "Later"]);
  await expect.poll(() => page.locator(".wl-row").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-symbol")))).toEqual(["NVDA", "AMD", "AAPL", "MSFT"]);

  await page.locator('[data-watchlist-section-header="Core"]').click({ button: "right" });
  await page.getByRole("menu", { name: "Section actions for Core" }).getByRole("menuitem", { name: "Remove section" }).click();
  await expect.poll(() => page.locator(".wl-row").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-symbol")))).toEqual(["NVDA", "AMD", "AAPL", "MSFT"]);
  await expect(row(page, "AAPL")).toHaveAttribute("data-watchlist-section", "Growth");

  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.locator(".wl-row").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-symbol")))).toEqual(["NVDA", "AMD", "AAPL", "MSFT"]);
});

test("renaming a watchlist preserves its empty and collapsed section dividers", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Named-list controls are desktop chrome.");
  await boot(page, testInfo, baseURL);

  await page.locator('[data-watchlist-section-header="Growth"] .wl-sec-toggle').click();
  await expect(row(page, "NVDA")).toBeHidden();
  await page.locator(".wl-select").click();
  page.once("dialog", (dialog) => dialog.accept("Renamed List"));
  await page.locator(".wl-list-row").filter({ hasText: "Bulk Test" }).locator('[title="Rename"]').click();

  await expect(page.locator(".wl-select")).toContainText("Renamed List");
  await expect(page.locator('[data-watchlist-section-header="Archive"]')).toBeVisible();
  await expect(row(page, "NVDA")).toBeHidden();
  await expect.poll(async () => (await savedState(page)).meta["Renamed List"]).toEqual({
    sections: ["Core", "Growth", "Archive"],
    collapsed: ["Growth"],
  });

  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".wl-select")).toContainText("Renamed List");
  await expect(page.locator('[data-watchlist-section-header="Archive"]')).toBeVisible();
  await expect(row(page, "NVDA")).toBeHidden();
});

test("the full ticker row freely reorders and crosses sections without selecting text", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The sortable rail is desktop chrome.");
  test.slow();
  await boot(page, testInfo, baseURL);

  const source = row(page, "AMD");
  const target = page.locator('[data-watchlist-section-header="Archive"]');
  await expect(source).toHaveAttribute("data-watchlist-section", "Growth");
  await target.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  expect(await source.evaluate((element) => getComputedStyle(element).userSelect)).toBe("none");

  await microDrag(page, row(page, "AAPL").locator(".tk"));
  await expect.poll(() => page.locator('[data-watchlist-section="Core"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-symbol")))).toEqual(["AAPL", "MSFT"]);

  await row(page, "MSFT").click();
  await expect(page.locator(".mm-ptag-sym")).toHaveText("MSFT");

  await dragRow(page, "AAPL", row(page, "MSFT"));
  await expect.poll(() => page.locator('[data-watchlist-section="Core"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-symbol")))).toEqual(["MSFT", "AAPL"]);

  await dragRow(page, "AAPL", row(page, "NVDA"), 0.25);
  await expect.poll(() => page.locator('[data-watchlist-section="Growth"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-symbol")))).toEqual(["AAPL", "NVDA", "AMD"]);

  await dragRow(page, "AMD", target);

  await expect(source).toHaveAttribute("data-watchlist-section", "Archive");
  await dragRow(page, "NVDA", page.locator(".wl-root-drop"));
  await expect(row(page, "NVDA")).toHaveAttribute("data-watchlist-section", "");
  await expect(page.locator(".mm-ptag-sym")).toHaveText("MSFT");
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await expect.poll(async () => (await savedState(page)).lists["Bulk Test"]).toEqual([
    { symbol: "NVDA", section: "" },
    { symbol: "MSFT", section: "Core" },
    { symbol: "AAPL", section: "Growth" },
    { symbol: "AMD", section: "Archive" },
  ]);

  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".wl-select")).toContainText("Bulk Test");
  await expect.poll(() => page.locator(".wl-row").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-watchlist-symbol")))).toEqual(["NVDA", "MSFT", "AAPL", "AMD"]);
});

test("the lifted ticker stays anchored to the exact pointer grab point", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The sortable rail is desktop chrome.");
  await boot(page, testInfo, baseURL);

  const source = row(page, "AAPL");
  const section = page.locator('[data-watchlist-section-header="Core"]');
  const crossSection = page.locator('[data-watchlist-section-header="Growth"]');
  const crossRow = row(page, "NVDA");
  await source.scrollIntoViewIfNeeded();
  const before = await source.boundingBox();
  const sectionBefore = await section.boundingBox();
  expect(before).not.toBeNull();
  expect(sectionBefore).not.toBeNull();

  const viewportWidth = page.viewportSize()?.width ?? before!.x + before!.width;
  const visibleLeft = Math.max(0, before!.x);
  const visibleRight = Math.min(viewportWidth, before!.x + before!.width);
  const pointerDown = {
    x: visibleLeft + (visibleRight - visibleLeft) / 2,
    y: before!.y + before!.height * 0.37,
  };
  const grabOffsetY = pointerDown.y - before!.y;

  await page.evaluate(() => {
    (window as Window & { __wlPointer?: { x: number; y: number } }).__wlPointer = { x: 0, y: 0 };
    window.addEventListener("pointermove", (event) => {
      (window as Window & { __wlPointer?: { x: number; y: number } }).__wlPointer = { x: event.clientX, y: event.clientY };
    }, { capture: true });
  });

  await page.mouse.move(pointerDown.x, pointerDown.y);
  await page.mouse.down();
  // Cross the 6px activation threshold with one natural vertical movement.
  // The lifted visual must immediately catch up to that same coordinate.
  await page.mouse.move(pointerDown.x, pointerDown.y + 8);
  await expect(source).toHaveClass(/dragging/);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const activatedGeometry = await source.evaluate((element) => {
    const visual = document.querySelector<HTMLElement>('[data-watchlist-drag-visual="AAPL"]')!;
    const rect = visual.getBoundingClientRect();
    const pointer = (window as Window & { __wlPointer?: { x: number; y: number } }).__wlPointer!;
    return { top: rect.top, pointerY: pointer.y };
  });
  expect(Math.abs((activatedGeometry.pointerY - activatedGeometry.top) - grabOffsetY)).toBeLessThanOrEqual(1.5);
  // Hold beyond the old 110ms root-drop expansion: the cursor-to-row offset must
  // remain exact even after every drag-state visual has settled.
  await page.waitForTimeout(180);

  const geometry = await page.locator('[data-watchlist-drag-visual="AAPL"]').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const pointer = (window as Window & { __wlPointer?: { x: number; y: number } }).__wlPointer;
    return { top: rect.top, width: rect.width, height: rect.height, pointer };
  });
  const sectionAfter = await section.boundingBox();
  expect(geometry.pointer).toBeTruthy();
  expect(Math.abs((geometry.pointer!.y - geometry.top) - grabOffsetY)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(geometry.width - before!.width)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(geometry.height - before!.height)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(sectionAfter!.y - sectionBefore!.y)).toBeLessThanOrEqual(0.5);

  for (const target of [crossSection, crossRow]) {
    const targetBox = await target.boundingBox();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(pointerDown.x, targetBox!.y + targetBox!.height / 2);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const crossGeometry = await page.locator('[data-watchlist-drag-visual="AAPL"]').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const pointer = (window as Window & { __wlPointer?: { x: number; y: number } }).__wlPointer!;
      return { top: rect.top, pointerY: pointer.y };
    });
    expect(Math.abs((crossGeometry.pointerY - crossGeometry.top) - grabOffsetY)).toBeLessThanOrEqual(1.5);
  }

  await page.mouse.up();
  await expect(source).not.toHaveClass(/dragging/);
});

// W1b: bulk move and bulk delete used to sync ONLY when the active list was "Default" — on any
// named list they were localStorage-only, so the same account on another device never saw them.
// The same two gestures must now reach the server list "Bulk Test" migrated into on mount.
test("bulk move and bulk delete on a NAMED list reach the server", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Context menu is a desktop pointer workflow.");
  await boot(page, testInfo, baseURL);

  const serverList = async (name: string) => page.evaluate(async (listName) => {
    const payload = await (await fetch("/api/watchlist", { headers: { Accept: "application/json" } })).json();
    const list = payload.lists.find((row: { name: string }) => row.name === listName);
    return list ? list.symbols.map((row: { symbol: string; section: string }) => [row.symbol, row.section]) : null;
  }, name);

  // The mount migration carried the local list up verbatim — order and sections included.
  await expect.poll(() => serverList("Bulk Test"), { timeout: 30_000 }).toEqual([
    ["AAPL", "Core"], ["MSFT", "Core"], ["NVDA", "Growth"], ["AMD", "Growth"],
  ]);

  // A plain click sets the anchor without selecting; Shift then takes the range.
  await row(page, "AAPL").click();
  await row(page, "MSFT").click({ modifiers: ["Shift"] });
  await expect(page.locator("[data-testid='watchlist-selection-count']")).toHaveText("2 tickers selected");
  await row(page, "MSFT").click({ button: "right" });
  await page.getByRole("menu", { name: "Selected ticker actions" })
    .getByRole("menuitem", { name: "Move to section" }).click();
  await page.getByRole("menu", { name: "Selected ticker actions" })
    .getByRole("menuitem", { name: "Archive" }).click();
  await expect.poll(() => serverList("Bulk Test"), { timeout: 15_000 }).toEqual([
    ["AAPL", "Archive"], ["MSFT", "Archive"], ["NVDA", "Growth"], ["AMD", "Growth"],
  ]);

  await row(page, "NVDA").click();
  await row(page, "AMD").click({ modifiers: ["Shift"] });
  await expect(page.locator("[data-testid='watchlist-selection-count']")).toHaveText("2 tickers selected");
  await row(page, "AMD").click({ button: "right" });
  await page.getByRole("menu", { name: "Selected ticker actions" })
    .getByRole("menuitem", { name: "Delete 2 symbols" }).click();
  await expect.poll(() => serverList("Bulk Test"), { timeout: 15_000 }).toEqual([
    ["AAPL", "Archive"], ["MSFT", "Archive"],
  ]);
  // Scoped to the targeted list: Default is a different row set and must be untouched.
  expect(await serverList("Default")).toHaveLength(6);
});

test("smaller viewports retain the mobile watchlist surface without desktop bulk chrome leaking", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Desktop behavior is covered above.");
  await boot(page, testInfo, baseURL);
  await expect(page.locator(".rail .wl-board")).toBeHidden();
  await expect(page.locator("[data-testid='watchlist-selection-count']")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth + 1),
  );
});
