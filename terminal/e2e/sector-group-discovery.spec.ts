import { expect, test, type Page } from "@playwright/test";
import { sectorFixture, archivedMembers } from "./fixtures/sector-company-v3";

test.setTimeout(90000);
const url = "/discover?tab=sectors&sector=xlk&group=semiconductors&sectorTheme=light";
// An explicitly synthetic second group tests identity/return navigation, not current membership.
const groups = [
  { key: "semiconductors", label: "Semiconductors", label_zh: "半导体", n_members: 14, n_priced: 14, entry: { tier: "T1" }, regime: { state: "EXTENDED" }, members: archivedMembers },
  { key: "fixture-hardware", label: "Hardware test group", label_zh: "硬件测试分组", n_members: 1, n_priced: 0, entry: {}, regime: {}, members: [{ ticker: "TEST", price: null, ret_20d: null, vs_basket: null, stock_buyable: false }] },
];
async function prepare(page: Page, language = "en", denied = false) {
  await page.addInitScript(lang => { localStorage.setItem("mm.lang", lang); document.documentElement?.setAttribute("data-lang", lang); }, language);
  await page.route("**/api/sector-intelligence?**", route => {
    if (new URL(route.request().url()).searchParams.get("source") !== "confluence") return sectorFixture(route);
    return route.fulfill({ status: denied ? 401 : 200, json: { data: denied ? null : { as_of: "2026-09-23", groups }, receipt: {
      source: "confluence", status: denied ? "access" : "ready", path: "/marketdata/subsector_confluence.json", asOf: denied ? null : "2026-09-23", observedAt: "2026-09-26T10:00:00Z", stale: false, contentHash: null,
    } } });
  });
}

test("group discovery uses the real shared modal and returns focus on Escape", async ({ page }) => {
  await prepare(page); await page.goto(url);
  const trigger = page.getByRole("button", { name: "Browse company groups", exact: true });
  await trigger.click(); const dialog = page.getByRole("dialog", { name: "Browse company groups", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Groups are shown independently of the sector selection.");
  await expect(dialog.locator("[data-group-choice]")).toHaveCount(2);
  await expect(dialog.locator('[data-group-choice="semiconductors"]')).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Find a group", { exact: true }).focus();
  for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); }
  // Check the settled layout, without disabling the shared sheet's entrance animation.
  await dialog.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
  const size = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, bottom: el.getBoundingClientRect().bottom, height: window.innerHeight }));
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1); expect(size.bottom).toBeLessThanOrEqual(size.height + 1);
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("choosing another group resets only company context and browser Back restores the prior research", async ({ page }) => {
  await prepare(page); await page.goto(url + "&sectorCompany=MU&sectorQuery=MU&sectorSort=return&sectorExpanded=1");
  const root = page.getByTestId("sector-intelligence");
  await expect(root.getByTestId("sector-company-inspector")).toContainText("MU");
  await root.getByRole("button", { name: "Browse company groups", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Browse company groups", exact: true });
  await dialog.getByLabel("Find a group", { exact: true }).fill("hardware");
  await expect(dialog.locator("[data-group-choice]")).toHaveCount(1);
  await dialog.locator('[data-group-choice="fixture-hardware"]').click();
  await expect(dialog).not.toBeVisible(); await expect(page).toHaveURL(/group=fixture-hardware/);
  const state = new URL(page.url()).searchParams;
  expect(state.get("sector")).toBe("xlk"); expect(state.get("sectorTheme")).toBe("light");
  expect(state.get("sectorCompany")).toBeNull(); expect(state.get("sectorQuery")).toBeNull(); expect(state.get("sectorSort")).toBe("source");
  await expect(root.locator('[data-company-choice="TEST"]')).toBeVisible();
  await expect(root.getByTestId("sector-company-inspector")).toContainText("Select a company");
  await page.goBack(); await expect(page).toHaveURL(/group=semiconductors/);
  await expect(root.getByTestId("sector-company-inspector")).toContainText("MU");
  expect(new URL(page.url()).searchParams.get("sectorQuery")).toBe("MU");
  expect(new URL(page.url()).searchParams.get("sectorSort")).toBe("return");
});

test("same-group selection preserves context and no-match is a recoverable search state", async ({ page }) => {
  await prepare(page); await page.goto(url + "&sectorView=companies&sectorCompany=MU&sectorQuery=MU");
  await page.getByRole("button", { name: "Browse company groups", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Browse company groups", exact: true });
  await dialog.getByLabel("Find a group", { exact: true }).fill("not-present");
  await expect(dialog).toContainText("No groups match this search.");
  await dialog.getByRole("button", { name: "Clear search", exact: true }).click();
  const before = page.url(); await dialog.locator('[data-group-choice="semiconductors"]').click();
  expect(page.url()).toBe(before); await expect(page.getByTestId("sector-company-row")).toHaveCount(1);
});

test("Chinese group discovery and unavailable access remain explicit", async ({ page }) => {
  await prepare(page, "zh"); await page.goto(url);
  await page.getByRole("button", { name: "浏览公司分组", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "浏览公司分组", exact: true });
  await dialog.getByLabel("搜索分组", { exact: true }).fill("硬件"); await expect(dialog.locator("[data-group-choice]")).toHaveCount(1);
  await expect(dialog).toContainText("硬件测试分组"); await dialog.getByRole("button", { name: "关闭", exact: true }).click();
});

test("denied group feed never presents stale group choices", async ({ page }) => {
  await prepare(page, "en", true); await page.goto(url);
  await page.getByRole("button", { name: "Browse company groups", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Browse company groups", exact: true });
  await expect(dialog).toContainText("Sign in to read the company groups."); await expect(dialog.locator("[data-group-choice]")).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
  await dialog.getByRole("button", { name: "Review sources", exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page).toHaveURL(/sectorView=sources/);
});


test("history navigation closes the open group dialog and restores the prior company context", async ({ page }) => {
  await prepare(page); await page.goto(url);
  const root = page.getByTestId("sector-intelligence");
  await root.locator('[data-company-choice="MU"]').click();
  await expect(page).toHaveURL(/sectorCompany=MU/);
  const trigger = root.getByRole("button", { name: "Browse company groups", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Browse company groups", exact: true });
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(root.getByTestId("sector-company-inspector")).toContainText("Select a company");
  expect(new URL(page.url()).searchParams.get("sectorCompany")).toBeNull();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await page.goForward();
  await expect(root.getByTestId("sector-company-inspector")).toContainText("MU");
  await expect(dialog).not.toBeVisible();
});

test("single-company coverage uses singular copy and keeps zero priced visible", async ({ page }) => {
  await prepare(page); await page.goto(url);
  await page.getByRole("button", { name: "Browse company groups", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Browse company groups", exact: true });
  await expect(dialog.locator('[data-group-choice="fixture-hardware"]')).toContainText("1 company · 0 priced");
  await expect(dialog.locator('[data-group-choice="semiconductors"]')).toContainText("14 companies · 14 priced");
});
