import { expect, test, type Page, type TestInfo } from "./fixtures";

/**
 * D6 — the search field's keyboard mechanics were fine; its SEMANTICS were missing.
 *
 * ArrowUp/ArrowDown/Enter moved a visible highlight while focus stayed in the input, but the
 * input was a plain <input> and the result rows were plain <div>s: nothing told assistive
 * technology that the field owned a result popup, that those rows were the options, or which
 * option was currently active. A sighted keyboard user and a screen-reader user were reading
 * two different products off the same DOM.
 *
 * The row anatomy matters as much as the roles. `option` is a "children presentational" role,
 * so the naive fix — role="option" on the whole `.r` — would have deleted the per-row Add
 * button from the accessibility tree. The option is therefore `.r-opt` (identity + info) and
 * the buttons live in `.r-act` beside it. Both halves are asserted below.
 *
 * D1 rides along: the placeholder may promise only identifiers search can actually resolve.
 */

/** Open the search surface each viewport actually presents (desktop modal / tablet sheet /
 *  phone drawer) and return its input. Same component and same ARIA in all three. */
async function openSearch(page: Page, testInfo: TestInfo, query?: string) {
  const desktop = testInfo.project.name === "desktop";
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  if (desktop) await page.locator(".pair").first().click();
  else await page.locator(".m-symbar").click();

  const input = page.locator(".sh input");
  await expect(input).toBeVisible({ timeout: 20_000 });
  if (query) {
    await input.click();
    await page.keyboard.type(query);
    await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
  }
  return input;
}

test("the search field is a combobox whose results are machine-readable options", async ({ page }, testInfo) => {
  const input = await openSearch(page, testInfo, "A");

  // 1. The field expresses combobox state and points at the result list.
  await expect(input).toHaveAttribute("role", "combobox");
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveAttribute("aria-autocomplete", "list");
  const listboxId = await input.getAttribute("aria-controls");
  expect(listboxId).toBeTruthy();
  const listbox = page.locator(`[id="${listboxId}"]`);
  await expect(listbox).toHaveAttribute("role", "listbox");

  // 2. The rows are options, not anonymous divs.
  expect(await listbox.locator('[role="option"]').count()).toBeGreaterThan(1);

  // 3. The ACTIVE option is named — the thing that was entirely absent before.
  const active = await input.getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
  expect(await listbox.locator('[role="option"][aria-selected="true"]').count()).toBe(1);
});

test("ArrowDown moves the active option and Enter opens the one it names", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Physical-keyboard navigation; the touch viewports select by tap.");
  const input = await openSearch(page, testInfo, "A");

  const listbox = page.locator(`[id="${await input.getAttribute("aria-controls")}"]`);
  const first = await input.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  const second = await input.getAttribute("aria-activedescendant");
  expect(second).not.toBe(first);
  await expect(page.locator(`[id="${second}"]`)).toHaveAttribute("aria-selected", "true");
  expect(await listbox.locator('[role="option"][aria-selected="true"]').count()).toBe(1);

  // The visual highlight and the machine-readable one are the SAME row — the divergence that
  // made this a real accessibility defect rather than a missing attribute.
  await expect(listbox.locator(".r.sel .r-opt")).toHaveAttribute("id", second!);

  // ArrowUp walks back.
  await page.keyboard.press("ArrowUp");
  expect(await input.getAttribute("aria-activedescendant")).toBe(first);

  // Enter opens the symbol the active option names.
  await page.keyboard.press("ArrowDown");
  const symbol = (await page.locator(`[id="${second}"] .tk`).innerText()).trim();
  await page.keyboard.press("Enter");
  await expect(page.locator(".mm-ptag")).toContainText(symbol, { timeout: 20_000 });
});

test("the Add control stays reachable beside the option, never inside it", async ({ page }, testInfo) => {
  await openSearch(page, testInfo, "A");

  const firstRow = page.locator(".sres .r").first();
  // The button is a SIBLING of the option. Inside it, `option`'s presentational children would
  // strip it from the accessibility tree — the exact regression this layout prevents.
  await expect(firstRow.locator(".r-act .add")).toHaveCount(1);
  await expect(firstRow.locator(".r-opt button")).toHaveCount(0);

  const add = firstRow.locator(".r-act .add");
  await expect(add).toBeVisible();
  expect(await add.getAttribute("title")).toBeTruthy();
});

test("the placeholder promises only what search implements, and that promise resolves", async ({ page }, testInfo) => {
  const input = await openSearch(page, testInfo);

  const placeholder = (await input.getAttribute("placeholder")) ?? "";
  expect(placeholder.length).toBeGreaterThan(0);
  expect(placeholder.toLowerCase()).not.toContain("isin");
  expect(placeholder.toLowerCase()).not.toContain("cusip");

  // What it does promise has to hold: a company NAME finds the ticker.
  await input.click();
  await page.keyboard.type("Apple");
  await expect(page.locator('.sres [role="option"] .tk').first()).toHaveText("AAPL", { timeout: 20_000 });
});
