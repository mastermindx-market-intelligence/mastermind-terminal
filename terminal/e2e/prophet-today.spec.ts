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
 * bounded population walk therefore settles on defensives (rank 2 by group
 * return, the first candidate with a published population). Every assertion
 * below rides the committed fixtures verbatim.
 */

async function withLang(page: Page, lang: "en" | "zh" = "en") {
  await page.addInitScript(langCode => {
    localStorage.setItem("mm.lang", langCode);
  }, lang);
}

/** The secondary lanes sit behind the More disclosure at ≤640 (M1/M3). */
async function revealOptionsLane(page: Page) {
  const more = page.getByTestId("prophet-lane-more");
  if (await more.isVisible()) await more.click();
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

  // The market-to-sector assessment leads with the LEADING sector — the top
  // return group whose population is published (fixture: Housing leads returns
  // but has no published population, so the walk settles on Defensives). The
  // assessment is one sentence built from the published relative measure.
  const hero = page.getByTestId("prophet-today-hero");
  await expect(hero).toBeVisible({ timeout: 30_000 });
  await expect(hero).toContainText("Defensives");
  await expect(hero).toContainText("Defensives is ahead of the market.");
  await expect(hero).toContainText("Expansion");
  await expect(hero).toContainText("+10.4%");
  await expect(hero).toContainText("-5.6%");
  await expect(hero).toContainText("+16.0 pp");
  await expect(page.getByTestId("prophet-today-clocks")).toContainText("2026-11-06");
  await expect(page.getByTestId("prophet-today-clocks")).toContainText("2026-11-09");
  await expect(page.getByTestId("prophet-today-verdict")).toContainText(/different sessions/i);

  // Honesty: the fixture produces no breadth for ANY group — the hero says so
  // in the owner's reason vocabulary, never a zero.
  await expect(hero).toContainText("not produced");
  await expect(page.getByTestId("prophet-today-open-plans")).toHaveText("6");

  // B1: the leadership table sits directly under the assessment, BEFORE the
  // cases; every row is the sector journey in the address.
  const table = page.getByTestId("prophet-today-table");
  await expect(table).toBeVisible();
  await expect(table).toContainText("Housing");
  await expect(table).toContainText("+14.1%");
  await expect(page.getByTestId("prophet-today-leader-row").first()).toContainText("Housing");
  // Research cases follow the table: wait for the settled walk to render the
  // first card, then read the DOM order (the order check must never race the
  // population walk's case read).
  const firstCase = page.getByTestId("prophet-today-case").first();
  await expect(firstCase).toBeVisible({ timeout: 15_000 });
  const order = await page.evaluate(() => {
    const heroEl = document.querySelector('[data-testid="prophet-today-hero"]');
    const tableEl = document.querySelector('[data-testid="prophet-today-leadership"]');
    const caseEl = document.querySelector('[data-testid="prophet-today-case"]');
    if (!heroEl || !tableEl || !caseEl) return { heroBeforeTable: false, tableBeforeCase: false };
    return {
      heroBeforeTable: !!(heroEl.compareDocumentPosition(tableEl) & Node.DOCUMENT_POSITION_FOLLOWING),
      tableBeforeCase: !!(tableEl.compareDocumentPosition(caseEl) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(order.heroBeforeTable).toBe(true);
  expect(order.tableBeforeCase).toBe(true);

  // Research cases follow the table: the group's open plans, entry honesty on
  // every card and the member-level relative measure's designed absence.
  const clx = page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]');
  await expect(clx).toContainText("Open plan");
  await expect(clx).toContainText("Long");
  await expect(clx).toContainText("Opened 2026-10-20");
  await expect(firstCase).toContainText("No entry assessment is published for this member.");
  // M2: "Return vs sector" carries the designed unavailable label — the wire
  // publishes that measure for groups, not members.
  await expect(clx.getByTestId("prophet-today-case-vs-sector")).toHaveText("not published");
  await expect(firstCase).toContainText("Return vs sector");
  // Defensives has exactly six open plans and no early observations in the
  // committed fixture, so every case is shown and no fold is invented.
  await expect(page.getByTestId("prophet-today-case")).toHaveCount(6);
  await expect(page.getByTestId("prophet-today-more-cases")).toHaveCount(0);
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
  await page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]')
    .getByTestId("prophet-today-case-setup").click();
  await expect(page).toHaveURL(/prophetLane=sector/);
  await expect(page).toHaveURL(/prophetSymbol=CLX/);
  await expect(page.getByTestId("prophet-tab-screener")).toHaveAttribute("aria-selected", "true");
  // The setup view reads the symbol's own membership. The committed fixture
  // publishes symbol reads for ADP and CARR only, so CLX lands on the lane's
  // designed not-found state — the action and its address are what this test
  // proves; a real setup render is proven against the CARR fixture in
  // prophet-sector-journey.spec.ts.
  await expect(page.getByTestId("prophet-sector-symbol-notfound")).toBeVisible({ timeout: 15_000 });

  // Primary and secondary lanes ride the lane key; the incumbent default
  // (plans) stays OUT of the address.
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
  await revealOptionsLane(page);
  await page.getByTestId("prophet-tab-options").click();
  await expect(page).toHaveURL(/prophetLane=options/);
  await expect(page.getByTestId("options-alpha-desk")).toBeVisible({ timeout: 15_000 });
});

test("`sel` round-trips on the legacy mount as repeatable `prophetSel`", async ({ page }) => {
  test.setTimeout(90_000);
  await withLang(page);
  await page.goto(BOARD);
  await expect(page.getByTestId("prophet-today-board")).toBeVisible({ timeout: 20_000 });

  const clx = page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]');
  const compare = clx.getByTestId("prophet-today-case-compare");
  await expect(compare).toHaveAttribute("aria-pressed", "false");

  await compare.click();
  await expect(page).toHaveURL(/prophetSel=CLX/);
  await expect(page).not.toHaveURL(/[?&]sel=/);
  await expect(compare).toHaveAttribute("aria-pressed", "true");

  // Reload re-reads the same selection from the legacy spelling.
  await page.reload();
  await expect(page.getByTestId("prophet-today-board")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]')
    .getByTestId("prophet-today-case-compare")).toHaveAttribute("aria-pressed", "true");

  // Back removes it; forward restores it.
  await page.goBack();
  await expect(page).not.toHaveURL(/prophetSel=/);
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]')
    .getByTestId("prophet-today-case-compare")).toHaveAttribute("aria-pressed", "false");
  await page.goForward();
  await expect(page.locator('[data-testid="prophet-today-case"][data-symbol="CLX"]')
    .getByTestId("prophet-today-case-compare")).toHaveAttribute("aria-pressed", "true");
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
    // leading sector's sentence — is visible in the FIRST viewport, past the
    // shell and lane navigation, never below it.
    await expect(page.getByTestId("prophet-today-hero").locator("h3")).toBeInViewport();
    // The research cases begin within the second screen — the assessment leads
    // and the cases follow, they are not buried (the compact composition puts
    // the leadership list after them).
    const caseBox = await page.getByTestId("prophet-today-case").first().boundingBox();
    expect(caseBox).not.toBeNull();
    expect(caseBox!.y).toBeLessThan(size.height * 2);
    // M5: at ≤640 the leadership table is a 44px-row list with NO inner
    // horizontal scroll — and the page itself never scrolls sideways.
    const innerScroll = await page.getByTestId("prophet-today-leadership")
      .locator("[class*=tableScroll]").evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    expect(innerScroll.scrollWidth).toBeLessThanOrEqual(innerScroll.clientWidth + 1);
    const rowHeights = await page.getByTestId("prophet-today-leader-row")
      .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    for (const height of rowHeights) expect(height).toBeGreaterThanOrEqual(43.5);
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
  // P3: the in-body title + subtitle are the design's Prophet words.
  await expect(page.getByTestId("prophet-today-board")).toContainText("预言台");
  await expect(page.getByTestId("prophet-today-board")).toContainText("找到领涨，再找个股。");
  await expect(page.getByTestId("prophet-today-board")).toContainText("仅作描述");
  await expect(page.getByTestId("prophet-today-board")).toContainText("进行中计划");
  await expect(page.getByTestId("prophet-today-verdict")).toContainText("不同交易日");
  // P4: the owner's phase vocabulary is translated through our strings.
  await expect(page.getByTestId("prophet-today-owner-label")).toHaveText("扩张");
  const firstCase = page.getByTestId("prophet-today-case").first();
  await expect(firstCase).toContainText("进行中计划");
  await expect(firstCase).toContainText("该成分暂无已发布的入场评估。");
  await expect(firstCase).toContainText("相对行业收益");
  await expect(firstCase).toContainText("未发布");
  // No English receipts leak into the zh board.
  await expect(page.getByTestId("prophet-today-hero")).not.toContainText("Market & sector leadership");
  await expect(page.getByTestId("prophet-today-hero").locator("h3")).not.toContainText("ahead of the market");
  await expect(firstCase).not.toContainText("No entry assessment");
});
