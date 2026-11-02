import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

const LISTS = {
  lists: {
    Default: [{ symbol: "NVDA", section: "EQUITIES" }],
    Research: [{ symbol: "AAPL", section: "EQUITIES" }],
  },
  active: "Default",
  meta: {},
};

async function chart(page: Page) {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

async function search(page: Page, info: TestInfo, baseURL?: string) {
  const store = await isolateWatchlistStore(page, info, baseURL);
  await seedOwnerWatchlists(page, store, LISTS);
  await chart(page);
  const opener = info.project.name === "desktop"
    ? page.locator(".pair").first()
    : page.locator(".m-symbar [data-symbol-search]");
  await opener.focus();
  await page.keyboard.press("Enter");
  const input = page.locator(".sh input");
  await input.fill("AMD");
  await expect(page.locator(".sres .r .tk").first()).toHaveText("AMD", { timeout: 20_000 });
  return { opener, input };
}

async function focusIsWithin(page: Page, selector: string) {
  await expect.poll(() => page.evaluate(sel => {
    const scope = document.querySelector(sel);
    return !!scope?.contains(document.activeElement);
  }, selector)).toBe(true);
}

async function proof(page: Page, name: string) {
  if (!process.env.TERMINAL_SEARCH_PROOF) return;
  const dir = join(process.cwd(), "docs/pr-crops/ex03-search", process.env.TERMINAL_SEARCH_PROOF);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name + ".png") });
}

test("Compare owns focus from every control and returns it to its opener", async ({ page }, info) => {
  test.skip(info.project.name === "tablet", "Tablet continuation geometry is covered by the crop matrix.");
  await chart(page);
  const opener = info.project.name === "mobile" ? page.getByTestId("roller-more") : page.locator(".cmp-btn").first();
  await opener.click();
  if (info.project.name === "mobile") await page.getByTestId("hub-tile-compare").click();
  const input = page.locator(".smodal-cmp .sh input");
  await expect(input).toBeFocused();
  await proof(page, `${info.project.name}-compare`);
  await expect(page.locator(".scrim")).toHaveAttribute("role", "dialog");
  const dialog = page.getByRole("dialog", { name: "Compare — overlay symbols" });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close comparison", exact: true });
  await input.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await focusIsWithin(page, ".scrim[role=dialog]");
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    await focusIsWithin(page, ".scrim[role=dialog]");
  }
  await close.focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("Escape backs out of an inline list name, its picker, then search", async ({ page, baseURL }, info) => {
  test.skip(info.project.name === "mobile", "Phone primary search retains the incumbent sheet focus owner.");
  const { opener, input } = await search(page, info, baseURL);
  const add = page.locator(".sres .r .add").first();
  await add.focus();
  await page.keyboard.press("Enter");
  const picker = page.locator(".s-pick");
  await expect(picker.getByTestId("add-to-portfolio")).toBeFocused();
  await focusIsWithin(page, ".scrim[role=dialog]");
  const create = picker.locator(".s-pick-add");
  await create.focus();
  await page.keyboard.press("Enter");
  const name = picker.locator("input");
  await expect(name).toBeFocused();
  await name.fill("Uncommitted research");
  await page.keyboard.press("Escape");
  await expect(name).toBeHidden();
  await expect(create).toBeFocused();
  await expect(input).toHaveValue("AMD");
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(add).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".smodal")).toBeHidden();
  await expect(opener).toBeFocused();
});

test("keyboard save creates a watchlist once and restores focus after inline confirmation", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "desktop", "The existing add-to-list suite covers pointer persistence on desktop and phone.");
  const { input } = await search(page, info, baseURL);
  await page.locator(".sres .r .add").first().click();
  const picker = page.locator(".s-pick");
  await picker.locator(".s-pick-add").click();
  await picker.locator("input").fill("Keyboard research");
  await picker.locator(".s-pick-ok").focus();
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  await expect(page.locator(".s-added-note")).toContainText("Keyboard research");
  await expect(input).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await focusIsWithin(page, ".scrim[role=dialog]");
});

test("Portfolio handoff transfers focus to the position form without changing the chart", async ({ page, baseURL }, info) => {
  await search(page, info, baseURL);
  await page.locator(".sres .r .add").first().click();
  await page.getByTestId("add-to-portfolio").click();
  const position = page.getByRole("dialog").filter({ has: page.locator("input[name=ticker]") });
  await expect(position.locator("input[name=ticker]")).toHaveValue("AMD");
  await expect(position.locator("input[name=shares]")).toBeFocused();
  await expect(page.locator(".sh input")).toBeHidden();
  await expect(page.locator(".mm-ptag")).toContainText("NVDA");
  await page.keyboard.press("Escape");
  await expect(position).toBeHidden();
});

test("Add Symbol has an operable close control and the same focus boundary", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "desktop", "The watchlist rail is a desktop entry; the modal itself is checked at touch widths in the crop matrix.");
  const store = await isolateWatchlistStore(page, info, baseURL);
  await seedOwnerWatchlists(page, store, LISTS);
  await chart(page);
  const opener = page.locator(".wl-acts button").first();
  await opener.click();
  const dialog = page.getByRole("dialog").filter({ has: page.locator(".smodal-add") });
  const input = dialog.locator(".sh input");
  await expect(input).toBeFocused();
  await input.fill("AMD");
  const add = dialog.locator(".sres .r .add").first();
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  const remove = dialog.locator(".s-wl-remove").first();
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await input.press("Shift+Tab");
  const close = dialog.getByRole("button", { name: "Close add symbol", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("composing keys and chart shortcuts cannot escape a search task", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop keyboard isolation; the phone primary drawer retains its own keyboard contract.");
  await chart(page);
  await page.locator(".cmp-btn").first().click();
  const input = page.locator(".smodal-cmp .sh input");
  await input.dispatchEvent("keydown", { key: "Escape", code: "Escape", isComposing: true, bubbles: true });
  await expect(input).toBeVisible();
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true });
  await expect(input).toHaveValue("");
  const close = page.getByRole("button", { name: "Close comparison", exact: true });
  await close.focus();
  await page.keyboard.press("q");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(input).toHaveValue("");
  await expect(close).toBeFocused();
  await expect(page.locator(".smodal")).toHaveCount(1);
});

test("untyped opening matches the visible task and accessible symbol", async ({ page }, info) => {
  await chart(page);
  const desktop = info.project.name === "desktop";
  const opener = desktop ? page.locator(".pair").first() : page.locator("[data-symbol-search]");
  await expect(opener).toHaveAccessibleName("Symbol search — NVDA");
  if (!desktop) await expect(opener).toHaveAccessibleDescription(/192\.53/);
  await opener.focus();
  await page.keyboard.press("Enter");
  const input = page.locator(".sh input");
  await expect(input).toBeVisible();
  if (desktop) {
    await expect(input).toBeFocused();
    await expect(page.locator(".s-home")).toHaveCount(0);
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    const active = await input.getAttribute("aria-activedescendant");
    const selected = page.locator(`[id="${active}"]`);
    await expect(selected).toBeVisible();
    const symbol = await selected.locator(".tk").innerText();
    await page.keyboard.press("Enter");
    await expect(page.locator(".smodal")).toBeHidden();
    await expect(page.locator(".mm-ptag")).toContainText(symbol);
  } else {
    await expect(page.locator(".s-home")).toBeVisible();
    await expect(input).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
    await expect(opener).toBeFocused();
  }
});

test("a category that removes the focused picker recovers inside search", async ({ page, baseURL }, info) => {
  test.skip(info.project.name === "mobile", "Phone primary search retains its own sheet focus contract.");
  const { input } = await search(page, info, baseURL);
  await page.locator(".sres .r .add").first().click();
  await expect(page.getByTestId("add-to-portfolio")).toBeFocused();
  await page.getByRole("tab", { name: "Crypto", exact: true }).click();
  await expect(page.locator(".s-pick")).toBeHidden();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("AMD");
  await input.fill("Bitcoin");
  await expect(page.locator(".sres .r .tk").first()).toHaveText("BTC-USD");
  await focusIsWithin(page, ".scrim[role=dialog]");
});

test("Compare exposes only its current action and returns focus after adding or removing", async ({ page }, info) => {
  test.skip(info.project.name === "tablet", "Tablet continuation geometry is covered by the crop matrix.");
  await chart(page);
  const openCompare = async () => {
    if (info.project.name === "mobile") {
      await page.getByTestId("roller-more").click();
      await page.getByTestId("hub-tile-compare").click();
    } else await page.locator(".cmp-btn").first().click();
  };
  await openCompare();
  const input = page.locator(".smodal-cmp .sh input");
  await input.fill("AMD");
  const row = page.locator(".sres .r").first();
  await expect(row.locator(".tk")).toHaveText("AMD");
  const idle = row.locator(".cmp-add-idle");
  const choices = row.locator(".cmp-seg-half");
  const added = row.locator(".cmp-add-done");
  await expect(choices.nth(0)).toBeDisabled();
  await expect(choices.nth(1)).toBeDisabled();
  await expect(added).toBeDisabled();
  await idle.focus();
  await page.keyboard.press("Enter");
  await expect(choices.nth(0)).toBeFocused();
  await expect(idle).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".smodal-cmp")).toBeHidden();
  await openCompare();
  await input.fill("AMD");
  await expect(idle).toBeEnabled();
  await idle.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(choices.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(added).toBeFocused();
  await expect(added).toBeEnabled();
  await expect(choices.nth(0)).toBeDisabled();
  await page.locator(".scmp-chip button").focus();
  await page.keyboard.press("Enter");
  await expect(idle).toBeFocused();
  await expect(page.locator(".scmp-chip")).toHaveCount(0);
  await expect(idle).toBeEnabled();
  await idle.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(added).toBeFocused();
  await expect(added).toBeEnabled();
  await added.focus();
  await page.keyboard.press("Enter");
  await expect(idle).toBeFocused();
  await expect(idle).toBeEnabled();
  await expect(added).toBeDisabled();
});
