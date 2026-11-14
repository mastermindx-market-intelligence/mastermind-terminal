import { expect, test, type Page } from "@playwright/test";

/**
 * Canonical `/prophet` mount (Lane A URL contract, fix order "Also").
 *
 * The legacy `/options?tab=prophet` suite proves the board on the mount every
 * fixture environment serves; this focused configuration runs its own dev
 * server with MMX_SHARED_SHELL=1. In every fixture server the page's
 * development-only TERMINAL_E2E_FIXTURE seam, opted into per request by the
 * cookie set below, lets the CANONICAL spellings be proven in a real
 * browser: `tab` (today default), `sector`, `symbol` and the REPEATABLE `sel`.
 *
 * The board itself is proven once, on the legacy mount
 * (e2e/prophet-today.spec.ts); here the assertions are the address contract,
 * the `sel` round-trip, the one-row lane bar and the disclosure that keeps
 * Options Alpha / Issue Desk reachable at phone widths.
 */

// Opts this spec's requests into /prophet's development-only fixture seam; other
// fixture journeys (no cookie) keep the real shared-shell mount.
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "mm_e2e_prophet_canonical", value: "1", url: baseURL ?? "http://127.0.0.1" }]);
});

async function withLang(page: Page, lang: "en" | "zh" = "en") {
  await page.addInitScript(langCode => {
    localStorage.setItem("mm.lang", langCode);
  }, lang);
}

test("today is the default tab and every primary lane writes `tab`", async ({ page }) => {
  test.setTimeout(90_000);
  await withLang(page);
  await page.goto("/prophet");

  await expect(page.getByTestId("prophet-today-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("prophet-tab-today")).toHaveAttribute("aria-selected", "true");
  // Defaults stay out of the address.
  expect(new URL(page.url()).pathname).toBe("/prophet");
  expect(new URL(page.url()).search).toBe("");

  await page.getByTestId("prophet-tab-screener").click();
  await expect(page).toHaveURL(/[?&]tab=screener/);
  await expect(page.getByTestId("prophet-sector-picker")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("prophet-tab-plans").click();
  await expect(page).toHaveURL(/[?&]tab=plans/);
  await expect(page.locator("#prophet-panel-macro")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("prophet-tab-screener")).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page.getByTestId("prophet-tab-today")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("prophet-today-board")).toBeVisible();

  // P1-1: the selected lane carries the module's `.on` styling. The generated
  // class name is module-hashed, so the assertion is the COMPUTED style, not a
  // string: the selected tab is filled, its unselected siblings are not.
  const tabPaint = await page.getByRole("tab").evaluateAll(tabs => tabs.map(tab => ({
    testid: tab.getAttribute("data-testid"),
    selected: tab.getAttribute("aria-selected"),
    background: getComputedStyle(tab).backgroundColor,
  })));
  const selectedTab = tabPaint.find(tab => tab.testid === "prophet-tab-today")!;
  expect(selectedTab.selected).toBe("true");
  expect(selectedTab.background).not.toBe("rgba(0, 0, 0, 0)");
  for (const tab of tabPaint.filter(tab => tab.selected === "false")) {
    expect(tab.background).not.toBe(selectedTab.background);
  }
});

test("sector and symbol round-trip on the canonical keys", async ({ page }) => {
  test.setTimeout(90_000);
  await withLang(page);
  // Industrials publishes its population AND CARR's own symbol read in the
  // committed fixture (CLX's is not captured), so this proves the real setup.
  // The canonical link carries ONE key set: `sector` IS the population view —
  // no `prophetView` rides along (the pre-contract spelling is still read, see
  // the explicit-view leg at the end).
  await page.goto("/prophet?tab=sector&sector=us_sector_industrials");

  await expect(page.getByTestId("prophet-tab-screener")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("prophet-sector-open-CARR").click();
  await expect(page).toHaveURL(/[?&]tab=sector/);
  await expect(page).toHaveURL(/[?&]sector=us_sector_industrials/);
  await expect(page).toHaveURL(/[?&]symbol=CARR/);
  // `symbol` IS the setup view: the link mixes no key families.
  await expect(page).not.toHaveURL(/prophetView=/);
  await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 20_000 });

  // Back restores the population view with group and symbol in the address.
  await page.goBack();
  await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/[?&]sector=us_sector_industrials/);
  await expect(page).not.toHaveURL(/[?&]symbol=/);

  // A link minted before the contract (explicit `prophetView`) still reads.
  await page.goto("/prophet?tab=sector&sector=us_sector_industrials&prophetView=population");
  await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 20_000 });
});

test("`sel` round-trips on Today: toggle, reload keeps it, back removes it", async ({ page }) => {
  test.setTimeout(90_000);
  await withLang(page);
  await page.goto("/prophet");

  const clx = page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]');
  await expect(clx).toBeVisible({ timeout: 30_000 });
  const compare = clx.getByTestId("prophet-today-case-compare");
  await expect(compare).toHaveAttribute("aria-pressed", "false");

  await compare.click();
  await expect(page).toHaveURL(/[?&]sel=CLX/);
  await expect(compare).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("prophet-today-sel")).toContainText("CLX");

  // A reload re-reads the same selection from the address.
  await page.reload();
  await expect(page.getByTestId("prophet-today-board")).toBeVisible({ timeout: 30_000 });
  const compareAfter = page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]')
    .getByTestId("prophet-today-case-compare");
  await expect(compareAfter).toHaveAttribute("aria-pressed", "true");

  // Back/forward restore the exact prior selection.
  await page.goBack();
  await expect(page.getByTestId("prophet-today-board")).toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/[?&]sel=/);
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]')
    .getByTestId("prophet-today-case-compare")).toHaveAttribute("aria-pressed", "false");
  await page.goForward();
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]')
    .getByTestId("prophet-today-case-compare")).toHaveAttribute("aria-pressed", "true");
});

test("the lane tabs follow the tabs pattern (roving tabindex, arrows)", async ({ page, viewport }) => {
  // The secondary lanes are inline only above 640px, so the END tab differs by
  // width; the pattern itself is proven once, on the full lane row.
  test.skip((viewport?.width ?? 0) <= 640, "full lane row is desktop/tablet only");
  test.setTimeout(90_000);
  await withLang(page);
  await page.goto("/prophet");
  await expect(page.getByTestId("prophet-today-board")).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId("prophet-tab-today")).toHaveAttribute("tabindex", "0");
  await expect(page.getByTestId("prophet-tab-screener")).toHaveAttribute("tabindex", "-1");

  await page.getByTestId("prophet-tab-today").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("prophet-tab-candidates")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/[?&]tab=candidates/);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("prophet-tab-screener")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/[?&]tab=screener/);

  await page.keyboard.press("End");
  // End reaches the LAST visible tab: Issue Desk is inline above 640.
  await expect(page.getByTestId("prophet-tab-issue")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(page.getByTestId("prophet-tab-today")).toHaveAttribute("aria-selected", "true");
});

test("phone widths: one lane row with a More disclosure, content first, no sideways scroll", async ({ page }) => {
  test.setTimeout(90_000);
  await withLang(page);
  await page.goto("/prophet");
  await expect(page.getByTestId("prophet-today-hero")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("prophet-today-case").first()).toBeVisible({ timeout: 30_000 });

  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 600 }]) {
    await page.setViewportSize(size);
    // Each width starts on Today again: the disclosure walk below selects a
    // secondary lane, which unmounts the board.
    await page.getByTestId("prophet-tab-today").click();
    await expect(page.getByTestId("prophet-today-hero")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("prophet-today-case").first()).toBeVisible({ timeout: 30_000 });

    // ONE row: the three primary tabs and the More disclosure share a top line.
    const today = await page.getByTestId("prophet-tab-today").boundingBox();
    const plans = await page.getByTestId("prophet-tab-plans").boundingBox();
    const more = await page.getByTestId("prophet-lane-more").boundingBox();
    expect(today).not.toBeNull();
    expect(plans).not.toBeNull();
    expect(more).not.toBeNull();
    expect(Math.abs(today!.y - plans!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(today!.y - more!.y)).toBeLessThanOrEqual(2);
    expect(more!.x + more!.width).toBeLessThanOrEqual(size.width);

    // Captions are gone; the labels carry the lanes.
    await expect(page.getByTestId("prophet-tab-today")).not.toContainText("market vs sectors");

    // Content first: the hero's subject is in the FIRST viewport.
    await expect(page.getByTestId("prophet-today-hero").locator("h3")).toBeInViewport();

    // Secondary lanes live behind the disclosure.
    await page.getByTestId("prophet-lane-more").click();
    await expect(page.getByTestId("prophet-tab-options")).toBeVisible();
    await page.getByTestId("prophet-tab-options").click();
    await expect(page.getByTestId("prophet-tab-options")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/[?&]tab=options/);
    await expect(page.getByTestId("prophet-lane-more")).toContainText("Options Alpha");

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
