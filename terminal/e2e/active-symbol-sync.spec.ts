import { expect, test, type Page } from "@playwright/test";
import { expectTapTarget } from "./tapTarget";

/**
 * The cross-route ticker cursor (lib/activeSymbol + lib/navSymbol + components/SymbolPicker).
 *
 * Reported on a phone, 2026-09-04: charting SMR, opened Analysis from the hamburger drawer, and
 * the workspace painted a full NVDA company-intelligence read. Nothing carried the symbol across
 * a navigation, so every workspace fell back to its own literal default.
 *
 * Runs in the three default responsive projects (1440×900 / 820×1180 / 390×844) because the two
 * nav surfaces differ by viewport — the drawer is the surface the bug was found on, and it is not
 * the same component as the desktop rail.
 */

// globals.css swaps the desktop rail + topbar for the mobilebar + drawer at ≤860px, so BOTH the
// phone and the 820 tablet navigate through the drawer. Deriving that from the viewport is how the
// first run of this spec went red at 820 only — read the chrome that actually rendered instead.
const usesDrawer = (page: Page) => page.locator(".mobilebar").first().isVisible();

/** The chart's own ticker readout, whichever chrome this viewport shipped. */
const chartSymbol = async (page: Page) =>
  (await usesDrawer(page)) ? page.locator(".m-symbar .m-sym b") : page.locator(".pair b");

/**
 * Open a chart on `symbol` and wait until the shell has actually published it.
 *
 * Asserting only the top-bar readout is not enough, and CI proved it: the chart painted MSFT
 * while the cursor was still unpublished, so this spec's next navigation raced a real product
 * gap (TerminalShell used to hold the cursor behind the workspace restore) and read as a flake.
 * The cursor IS the precondition every case here depends on, so wait for the cursor.
 */
async function chart(page: Page, symbol: string) {
  await page.goto(`/terminal?symbol=${symbol}`);
  await expect(await chartSymbol(page)).toHaveText(symbol, { timeout: 45_000 });
  await expect
    .poll(() => page.evaluate(() => { try { return localStorage.getItem("mm.activeSymbol"); } catch { return null; } }),
      { timeout: 20_000, message: `the chart never published ${symbol} as the cross-route cursor` })
    .toBe(symbol);
}

/** Follow a primary-nav destination the way a user does, through this viewport's own nav. */
async function navigateTo(page: Page, label: string) {
  if (await usesDrawer(page)) {
    await page.getByRole("button", { name: "Menu" }).first().click();
    await page.locator(".m-drawer.open").getByRole("link", { name: label }).click();
    return;
  }
  await page.locator(".appnav").getByRole("link", { name: label }).click();
}

const symbolChip = (page: Page) => page.locator(".sym-pick strong");

test("the workspace opens on the company you were looking at, not on a default", async ({ page }) => {
  await chart(page, "AAPL");
  await navigateTo(page, "Analysis");

  // The reported defect, stated as an assertion: this said NVDA.
  await expect(symbolChip(page)).toHaveText("AAPL", { timeout: 45_000 });
  // The nav names the symbol in the href, so the SERVER rendered the right company — the
  // workspace did not mount on a fallback and correct itself afterwards.
  await expect(page).toHaveURL(/[?&]symbol=AAPL\b/);
});

test("a bare /analysis visit still adopts the cursor", async ({ page }) => {
  await chart(page, "MSFT");
  // No param at all — the deep-link path is bypassed, leaving only the stored cursor.
  await page.goto("/analysis");
  await expect(symbolChip(page)).toHaveText("MSFT", { timeout: 45_000 });
  await expect(page).toHaveURL(/[?&]symbol=MSFT\b/);
});

test("changing the company on the workspace moves the global cursor", async ({ page }) => {
  await chart(page, "AAPL");
  await navigateTo(page, "Analysis");
  await expect(symbolChip(page)).toHaveText("AAPL", { timeout: 45_000 });

  const trigger = page.locator("button.sym-pick");
  // Touch viewports get a real tap target; the chip is the desk's primary control on this bar.
  if (await usesDrawer(page)) await expectTapTarget(trigger, { height: 44 });
  await trigger.click();

  // The chart's own dialog, in pick mode: search by ticker, commit by clicking the row.
  const dialog = page.locator(".smodal, .msheet-search").first();
  await expect(dialog).toBeVisible();
  await dialog.locator("input[role=combobox]").fill("MSFT");
  await dialog.locator(".r", { hasText: "MSFT" }).first().click();

  await expect(symbolChip(page)).toHaveText("MSFT");
  await expect(page).toHaveURL(/[?&]symbol=MSFT\b/);

  // …and the chart follows. Without this leg the cursor would only be a one-way seed.
  await navigateTo(page, "Chart");
  await expect(page).toHaveURL(/[?&]symbol=MSFT\b/);
  await expect(await chartSymbol(page)).toHaveText("MSFT", { timeout: 45_000 });
});

test("a picker with no symbol universe says so instead of claiming no matches", async ({ page }) => {
  // The manifest is a separate read from the dialog that presents it. Failing it must not render
  // as "No supported symbol matches" — that tells the user their company does not exist.
  await page.route("**/data/manifest.json", (route) => route.abort("failed"));
  await page.goto("/analysis?symbol=AAPL");
  await expect(symbolChip(page)).toHaveText("AAPL", { timeout: 45_000 });

  await page.locator("button.sym-pick").click();
  const dialog = page.locator(".smodal, .msheet-search").first();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".s-universe-failed")).toBeVisible({ timeout: 20_000 });
  await expect(dialog).not.toContainText("No supported symbol matches");
});
