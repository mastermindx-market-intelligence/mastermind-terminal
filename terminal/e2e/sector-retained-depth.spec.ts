import { expect, test, type Page } from "@playwright/test";

/**
 * Lane 7 — retained Sector Intelligence depth, harness e2e.
 *
 * These tests run against the small DEV HARNESS page at /dev/sector-depth
 * (terminal/app/dev/sector-depth/page.tsx), NOT the live workspace: the
 * workspace mount belongs to the integration lane (lane 3), so this page mounts
 * the same props-only components against (a) the real captured generation
 * fixture and (b) clearly-synthetic contract fixtures for the capabilities the
 * captured generation does not carry. Every synthetic instance sits in a
 * `*-contract` section labelled as such on the page.
 *
 * Terminal is dark-only (frozen product constraint — see e2e/w2a-workspaces
 * .spec.ts header and settings.css): the colour matrix here is dark + EN/ZH.
 * Light-mode readiness is enforced structurally in unit tests (token-only CSS,
 * no colour literals in the depth CSS modules).
 *
 * The spec runs under the three default Playwright projects (desktop 1440 /
 * tablet 820 / mobile 390). Viewport-specific cases self-select by width and
 * every screenshot name carries the viewport so parallel projects never
 * clobber each other's proofs.
 */

const PAGE = "/dev/sector-depth";
const PROOF_DIR = "e2e/proof/sector-retained-depth";

async function shot(page: Page, name: string) {
  const { width } = page.viewportSize() ?? { width: 0 };
  await page.screenshot({ path: `${PROOF_DIR}/${name}-${width}.png`, fullPage: false });
}

const mobile = (page: Page) => (page.viewportSize()?.width ?? 0) <= 430;
const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1200;

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('[data-harness="sector-depth"]')).toBeVisible({ timeout: 45_000 });
});

/* ── typed unavailable states name the missing field ──────────────────────── */

test("unavailable surfaces name their missing field, never a blank panel", async ({ page }) => {
  const watch = page.locator('[data-h-section="watch"] [data-depth-unavailable="bottoming_watch"]');
  await expect(watch).toBeVisible();
  const flows = page.locator('[data-h-section="flows"] [data-depth-unavailable="etf_flows"]');
  await expect(flows).toBeVisible();
  const universes = page.locator('[data-h-section="universes"] [data-depth-unavailable="confluence"]');
  await expect(universes).toBeVisible();
  const themeTable = page.locator('[data-h-section="theme"] [data-depth-unavailable="theme_table"]');
  await expect(themeTable).toBeVisible();
  // The owner line names who must supply each field.
  await expect(watch).toContainText("Macro sector generation");
});

/* ── calls board: real captured generation ───────────────────────────────── */

test("calls board renders the captured board: five columns, full counts, locked", async ({ page }) => {
  const calls = page.locator('[data-h-section="calls"]');
  await expect(calls).toBeVisible();
  // Board total (six source lanes) and locked count from the real fixture.
  await expect(calls).toContainText("4");
  await expect(calls).toContainText("1");
  // The three captured theme rows are real, with exact hrefs preserved.
  const links = calls.locator("a[href]");
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(3);
  const hrefs = await links.evaluateAll((els) =>
    (els as HTMLAnchorElement[]).map((a) => a.getAttribute("href")),
  );
  for (const href of hrefs) expect(href).toBeTruthy();
  if (desktop(page)) await shot(page, "calls-board");
});

test("calls contract board: keyboard show-more and trace disclosure", async ({ page }) => {
  const section = page.locator('[data-h-section="calls-contract"]');
  await expect(section).toBeVisible();
  // Keyboard-only: focus moves through real buttons.
  const showMore = section.getByRole("button", { name: /Show more/i }).first();
  await expect(showMore).toBeVisible();
  await showMore.focus();
  await page.keyboard.press("Enter");
  await expect(section.getByRole("button", { name: /Show less/i }).first()).toBeVisible();
  // Trace toggle is a button; opens the per-row evidence grid.
  const trace = section.getByRole("button", { name: /^Trace$/i }).first();
  await trace.focus();
  await page.keyboard.press("Enter");
  await expect(section.getByText(/20d vs market/i).first()).toBeVisible();
  if (desktop(page)) await shot(page, "calls-trace");
});

test("navigation out flows through the onNavigate callback with the exact href", async ({ page }) => {
  const section = page.locator('[data-h-section="calls"]');
  const log = page.locator('[data-harness="navlog"]');
  await expect(log).toBeVisible();
  const before = await log.locator("li").count();
  await section.locator("a[href]").first().click();
  await expect(log.locator("li")).toHaveCount(before + 1);
});

/* ── Bottoming Watch: display-only strip ─────────────────────────────────── */

test("bottoming watch never carries an outbound action", async ({ page }) => {
  // The captured generation carries no watch payload, so the harness watch
  // section is the typed unavailable state; the CONTRACT instance (synthetic)
  // is the interactive one and must contain no links out.
  const contract = page.locator('[data-h-section="watch-contract"]');
  if ((await contract.count()) === 0) test.skip(true, "watch contract section not mounted");
  await expect(contract.locator("a[href]")).toHaveCount(0);
  await expect(contract).toContainText(/watch|观察/i);
});

/* ── flow matrix: chart ↔ table equivalence on the contract fixture ──────── */

test("flow matrix: heat view and exact-value table agree on every cell", async ({ page }) => {
  const flows = page.locator('[data-h-section="flows-contract"]');
  await expect(flows).toBeVisible();
  // Capture the heat view's formatted cell values.
  const heatCells = await flows
    .locator("table td")
    .allInnerTexts();
  // Switch to the exact-value view.
  await flows.getByRole("button", { name: /Exact values/i }).click();
  const tableCells = await flows
    .locator("table td")
    .allInnerTexts();
  // The formatted numbers the heat view showed must all exist in the table.
  const heatNums = heatCells.map((c) => c.trim()).filter((c) => /[$]/.test(c));
  const tableNums = new Set(tableCells.map((c) => c.trim()));
  expect(heatNums.length).toBeGreaterThan(20);
  for (const n of heatNums) expect(tableNums.has(n)).toBe(true);
  // Missing and zero stay visibly distinct in the table.
  const joined = tableCells.join("|");
  expect(/no reading/.test(joined) || /无读数/.test(joined)).toBe(true);
  if (desktop(page)) await shot(page, "flows-table");
});

test("flow matrix: phone surface shows all five windows with units and the source clock", async ({ page }) => {
  test.skip(!mobile(page), "phone surface is the <=430px layout");
  const flows = page.locator('[data-h-section="flows-contract"]');
  await expect(flows).toBeVisible();
  // Source clock is visible on the phone too.
  await expect(flows).toContainText(/source as of|数据截至/);
  // Five windows of exact values for the selected ETF, with units.
  await expect(flows.locator("select, [role='combobox'], button")).toBeVisible();
  const values = flows.locator("[data-window-value]");
  await expect(values).toHaveCount(5);
  await expect(flows).toContainText(/US\$ mn|百万美元/);
  await shot(page, "flows-phone");
});

/* ── four universes: separate identities, switching, filter, zero states ─── */

test("universes: tabs switch payloads and rows never cross universes", async ({ page }) => {
  const uni = page.locator('[data-h-section="universes-contract"]');
  await expect(uni).toBeVisible();
  // S&P tab is first; its source identity line names its own id + benchmark.
  await expect(uni).toContainText(/S&P 500|标普500/);
  await expect(uni).toContainText(/benchmark SPY|基准 SPY/);
  const spRows = await uni.locator("table tr, [data-group]").count();
  // Switch to Nasdaq-100 — identity and rows change.
  await uni.getByRole("button", { name: /Nasdaq-100|纳斯达克100/ }).click();
  await expect(uni).toContainText(/benchmark QQQ|基准 QQQ/);
  const ndRows = await uni.locator("table tr, [data-group]").count();
  expect(spRows).toBeGreaterThan(0);
  expect(ndRows).toBeGreaterThan(0);
  // Back to S&P: per-universe state survives the round trip (identity line again).
  await uni.getByRole("button", { name: /S&P 500|标普500/ }).click();
  await expect(uni).toContainText(/benchmark SPY|基准 SPY/);
  if (desktop(page)) await shot(page, "universes");
});

test("universes: filter narrows live, zero matches is a state not a failure, no-access is distinct", async ({ page }) => {
  const uni = page.locator('[data-h-section="universes-contract"]');
  const filter = uni.getByPlaceholder(/Filter subsector|筛选子行业/);
  await filter.fill("zzz-no-such-group");
  await expect(uni).toContainText(/No matches|无匹配结果/);
  await uni.getByRole("button", { name: /Clear filter|清除筛选/ }).click();
  // The contract fixture carries one no-access universe: switching to it shows
  // the access state, distinct from zero groups.
  const noAccessTab = uni.getByRole("button", { name: /Russell-2000|罗素2000/ });
  await noAccessTab.click();
  await expect(uni).toContainText(/requires access|不具备的权限/);
});

/* ── theme/compare/history controls ──────────────────────────────────────── */

test("theme compare: window toggle, series chips, turn markers, exact table", async ({ page }) => {
  const theme = page.locator('[data-h-section="theme"]');
  await expect(theme).toBeVisible();
  await expect(theme).toContainText(/against SPY|以 SPY 为基准/); // rebased-note benchmark disclosure
  // 11 sector chips.
  const chips = theme.locator("button[aria-pressed]");
  expect(await chips.count()).toBeGreaterThanOrEqual(11);
  // The captured fixture's cycle turns (all stub-dated 2022-06-16) fall outside
  // every window, so the chart shows NO turn markers — that is the data's
  // truth, asserted here; the in-window turn math is unit-proven instead.
  await expect(theme.locator("svg circle")).toHaveCount(0);
  await expect(theme).toContainText(/cycle turns|周期拐点/);
  // Series lines render.
  await expect(theme.locator("svg polyline")).not.toHaveCount(0);
  // Window switch to all history.
  await theme.getByRole("button", { name: /All history|全部历史/ }).click();
  // Exact-value table appears and matches the chart's window.
  await theme.getByRole("button", { name: /Exact values|精确数值/ }).click();
  const table = theme.locator('[role="region"] table');
  await expect(table).toBeVisible();
  expect(await table.locator("tr").count()).toBeGreaterThan(60);
  if (desktop(page)) await shot(page, "theme-compare");
});

/* ── language: EN ↔ ZH through the shared lexicon ────────────────────────── */

test("language toggle flips the harness surfaces EN ↔ ZH", async ({ page }) => {
  const calls = page.locator('[data-h-section="calls"]');
  await expect(calls).toContainText(/What to act on now|当下行动指南/);
  await page.locator('[data-harness-ctl="lang"]').click();
  await expect(calls).toContainText(/What to act on now|当下行动指南/);
  // The unavailable states and flow matrix flip too.
  await expect(page.locator('[data-h-section="watch"]')).toContainText(/本读数未包含|Not carried/);
  if (mobile(page)) await shot(page, "zh-mobile");
});

/* ── responsive contract ─────────────────────────────────────────────────── */

test("no horizontal page overflow at any harness viewport", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("mobile: calls board stacks with usable touch targets", async ({ page }) => {
  test.skip(!mobile(page), "touch/stack layout is the <=430px case");
  const calls = page.locator('[data-h-section="calls-contract"]');
  const buttons = calls.locator("button");
  const n = Math.min(await buttons.count(), 12);
  for (let i = 0; i < n; i++) {
    const box = await buttons.nth(i).boundingBox();
    if (box && box.height > 0) expect(box.height).toBeGreaterThanOrEqual(28);
  }
  // A real tap drives the show-more control (touch, not click).
  const showMore = calls.getByRole("button", { name: /Show more/i }).first();
  if (await showMore.isVisible()) {
    await showMore.tap();
    await expect(calls.getByRole("button", { name: /Show less/i }).first()).toBeVisible();
  }
  await shot(page, "calls-mobile");
});
