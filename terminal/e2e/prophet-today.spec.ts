import { expect, test, type Page } from "@playwright/test";

/**
 * Prophet Today — the board Prophet opens on (Lane A, gaps G1/G2/G21).
 *
 * The board is proven here on the legacy `/options?tab=prophet` mount — the
 * surface today's fixture and CI environments actually serve — through the
 * same components the canonical `/prophet` route renders. The canonical mount
 * (Shared Shell beta) gates on live server auth plus the options entitlement
 * and carries no fixture seam yet, so its browser proof lands when that page
 * gains the FLOW_FIXTURE exemption its `/options` sibling already has. What
 * the two mounts spell differently is only the URL key family, and both
 * spellings are pinned in `lib/__tests__/prophetUrlState.test.ts` (canonical
 * `tab`/`sector`/`symbol`/repeatable `sel`, default lane `today`, defaults out
 * of the address); the board contract itself — reading order, the population
 * walk, null honesty, `sel` chips — is pinned in
 * `lib/__tests__/prophetTodayView.test.tsx`.
 *
 * Journey law under test, not screenshots: Prophet opens on content (the
 * market-to-sector assessment and research cases, never a navigation-only
 * screen), every committed action carries the investigation in the address,
 * nulls render their owner's reason instead of invented numbers, and the first
 * mobile viewport is content at 390/320 with zero horizontal page overflow.
 *
 * The committed fixture index publishes 3 of 49 group populations; the board's
 * bounded population walk therefore settles on us_sector_industrials (7 open
 * plans — the first candidate with a published population). Every assertion
 * below rides the committed fixtures verbatim.
 */

async function withLang(page: Page, lang: "en" | "zh" = "en") {
  await page.addInitScript(langCode => {
    localStorage.setItem("mm.lang", langCode);
  }, lang);
}

/** The board on the legacy mount: the hub's `tab=prophet` plus today's lane. */
const BOARD = "/options?tab=prophet&prophetLane=today";

test("opens on Today: assessment and research cases", async ({ page }) => {
  test.setTimeout(90_000);
  await withLang(page);
  await page.goto(BOARD);

  // Today carries the board, and the board — not a navigation-only screen —
  // opens under it.
  await expect(page.getByTestId("prophet-tab-today")).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
  await expect(page.getByTestId("prophet-tab-today")).toHaveAttribute("aria-controls", "prophet-panel-today");
  const board = page.getByTestId("prophet-today-board");
  await expect(board).toBeVisible();

  // The market-to-sector assessment leads: the focus group's own read, both
  // measures, and the two owners' clocks on one line with the mixed-basis
  // verdict in plain words (fixture: 2026-11-06 vs 2026-11-09, gap 3).
  const hero = page.getByTestId("prophet-today-hero");
  await expect(hero).toBeVisible({ timeout: 20_000 });
  await expect(hero).toContainText("Industrials (Equal-Weight)");
  await expect(hero).toContainText("Recovery");
  await expect(hero).toContainText("+1.1%");
  await expect(hero).toContainText("-5.6%");
  await expect(hero).toContainText("+6.7 pp");
  await expect(page.getByTestId("prophet-today-clocks")).toContainText("2026-11-06");
  await expect(page.getByTestId("prophet-today-clocks")).toContainText("2026-11-09");
  await expect(page.getByTestId("prophet-today-verdict")).toContainText(/different sessions/i);

  // Honesty: the fixture produces no breadth for ANY group — the hero says so
  // in the owner's reason vocabulary, never a zero.
  await expect(hero).toContainText("not produced");
  await expect(page.getByTestId("prophet-today-open-plans")).toHaveText("7");

  // Research cases follow the assessment: open plans first, entry honesty on
  // every card, and the population basis stamped once on the section.
  const firstCase = page.getByTestId("prophet-today-case").first();
  await expect(firstCase).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="CARR"]')).toContainText("Open plan");
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="CARR"]')).toContainText("Long");
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="CARR"]')).toContainText("Opened 2026-10-20");
  await expect(firstCase).toContainText("No entry assessment is published for this member.");
  // Early observations sit behind the Still-developing fold with the rest named.
  const more = page.getByTestId("prophet-today-more-cases");
  await expect(more).not.toHaveAttribute("open", "");
  await expect(more.locator("summary")).toContainText("12 further cases");
  await more.locator("summary").click();
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="ADP"]')).toBeVisible();
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="ADP"]')).toContainText("Early observation");

  // The leadership table closes the board: ranked by group return, one as-of,
  // and every row is the sector journey in the address.
  const table = page.getByTestId("prophet-today-table");
  await expect(table).toBeVisible();
  await expect(table).toContainText("Housing");
  await expect(table).toContainText("+14.1%");
  await expect(page.getByTestId("prophet-today-leader-row").first()).toContainText("Housing");
});

test("committed actions carry the journey in the address", async ({ page }) => {
  test.setTimeout(90_000);
  await withLang(page);
  await page.goto(BOARD);
  await expect(page.getByTestId("prophet-today-board")).toBeVisible({ timeout: 20_000 });

  // A leadership row opens the sector journey: lane + view + group in the open.
  // Row 2 (Defensives, +10.4%): the fixture publishes its population, so the
  // journey lands on the real population table — row 1 (Housing) honestly
  // reports its unpublished read instead.
  await page.getByTestId("prophet-today-leader-row").nth(1).click();
  await expect(page).toHaveURL(/prophetLane=sector/);
  await expect(page).toHaveURL(/prophetView=population/);
  await expect(page).toHaveURL(/prophetGroup=defensives/);
  await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("prophet-tab-screener")).toHaveAttribute("aria-selected", "true");

  // Back to Today, then a case's Company setup: lane + symbol.
  await page.goBack();
  await expect(page.getByTestId("prophet-today-board")).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="prophet-today-case"][data-symbol="CARR"]')
    .getByTestId("prophet-today-case-setup").click();
  await expect(page).toHaveURL(/prophetLane=sector/);
  await expect(page).toHaveURL(/prophetSymbol=CARR/);
  await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });

  // Primary and secondary lanes ride the lane key; the incumbent default
  // (plans) stays OUT of the address. The compare selection `sel` is the
  // canonical mount's contract key — its chips, order and removal are pinned
  // in the codec and board unit suites.
  await page.goBack();
  await expect(page.getByTestId("prophet-today-board")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("prophet-tab-screener").click();
  await expect(page).toHaveURL(/prophetLane=screener/);
  await expect(page.getByTestId("prophet-sector-picker")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("prophet-tab-plans").click();
  await expect(page).not.toHaveURL(/prophetLane=/);
  await expect(page.locator("#prophet-panel-macro")).toBeVisible();
  await page.getByTestId("prophet-tab-today").click();
  await expect(page).toHaveURL(/prophetLane=today/);
  await page.getByTestId("prophet-tab-options").click();
  await expect(page).toHaveURL(/prophetLane=options/);
  await expect(page.getByTestId("options-alpha-desk")).toBeVisible({ timeout: 15_000 });
});

test("a deep-linked group wins the focus, even when its population is not published", async ({ page }) => {
  test.setTimeout(60_000);
  await withLang(page);
  // housing leads the fixture's returns but has no published population file:
  // the hero still carries its index context; the cases block says so in plain
  // words instead of an empty-looking list.
  await page.goto("/options?tab=prophet&prophetLane=today&prophetGroup=housing");
  const hero = page.getByTestId("prophet-today-hero");
  await expect(hero).toBeVisible({ timeout: 20_000 });
  await expect(hero).toContainText("Housing");
  await expect(hero).toContainText("+14.1%");
  await expect(page.getByTestId("prophet-today-cases-notfound")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("prophet-today-cases-notfound")).toContainText(/not in the current sector read/i);
});

test("390 opens on content; 320 never scrolls the page sideways", async ({ page }) => {
  test.setTimeout(60_000);
  await withLang(page);
  await page.goto(BOARD);
  await expect(page.getByTestId("prophet-today-hero")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("prophet-today-case").first()).toBeVisible({ timeout: 15_000 });

  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 600 }]) {
    await page.setViewportSize(size);
    // First screen is content (T2-10/SX06): the assessment's subject — the
    // focus group's own heading — is visible in the FIRST viewport, past the
    // shell and lane navigation, never below it.
    await expect(page.getByTestId("prophet-today-hero").locator("h3")).toBeInViewport();
    // The research cases begin within the second screen — the assessment leads
    // and the cases follow, they are not buried.
    const caseBox = await page.getByTestId("prophet-today-case").first().boundingBox();
    expect(caseBox).not.toBeNull();
    expect(caseBox!.y).toBeLessThan(size.height * 2);
    // Zero horizontal page overflow — the leadership table scrolls inside its
    // own panel, never the page.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("the board is bilingual: zh carries its own words", async ({ page }) => {
  test.setTimeout(60_000);
  await withLang(page, "zh");
  await page.goto(BOARD);
  await expect(page.getByTestId("prophet-today-hero")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("prophet-today-board")).toContainText("预言台今日");
  await expect(page.getByTestId("prophet-today-hero")).toContainText("行业焦点");
  await expect(page.getByTestId("prophet-today-board")).toContainText("仅作描述");
  await expect(page.getByTestId("prophet-today-board")).toContainText("进行中计划");
  await expect(page.getByTestId("prophet-today-verdict")).toContainText("不同交易日");
  const firstCase = page.getByTestId("prophet-today-case").first();
  await expect(firstCase).toContainText("进行中计划");
  await expect(firstCase).toContainText("该成分暂无已发布的入场评估。");
  // No English receipts leak into the zh board.
  await expect(page.getByTestId("prophet-today-hero")).not.toContainText("Sector focus");
  await expect(firstCase).not.toContainText("No entry assessment");
});
