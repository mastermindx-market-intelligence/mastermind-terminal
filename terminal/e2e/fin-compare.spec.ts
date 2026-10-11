import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * E11 — Financials · Compare. Real multi-company comparison over committed fund.json
 * fixtures (copied from the published files), routed in place of `/data/<SYM>.fund.json`:
 *
 *  - one explicit frame (period kind · currency · statement family) set by the pane's company;
 *  - a bank (JPM) is refused on the industrial top line but compared on net income, a CNY reporter
 *    (0700.HK) is refused on currency amounts, and neither gets a value or a rank;
 *  - fiscal-relative and calendar-aligned columns are labelled differently and a June fiscal
 *    year (MSFT) is left out of calendar years instead of being guessed into one;
 *  - opening a cell embeds the existing Statements view on that company, statement, basis,
 *    period column and row, and the highlighted figure is the number the comparison printed;
 *  - a missing peer and a failed read are row states, never zeros; Retry recovers the failure;
 *  - a restated period carries its filing version.
 */

const FIXTURES = join(process.cwd(), "lib", "__tests__", "fixtures", "fin-compare");
type FundJson = Record<string, unknown> & { statements: Record<string, Record<string, unknown>> };
const fixture = (sym: string): FundJson => JSON.parse(readFileSync(join(FIXTURES, `${sym}.fund.json`), "utf8"));

const fundPattern = (sym: string) =>
  new RegExp(`/data/${encodeURIComponent(sym).replace(/\./g, "\\.")}\\.fund\\.json(?:\\?.*)?$`);

async function serveFund(page: Page, sym: string, body: FundJson = fixture(sym)): Promise<void> {
  await page.route(fundPattern(sym), (route: Route) => route.fulfill({ json: body }));
}

async function openCompare(page: Page): Promise<void> {
  await page.goto("/analysis?symbol=NVDA&page=compare");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });
  if (page.viewportSize()!.width <= 860) {
    await expect(page.locator(".fin-local-mobile-tab.on")).toHaveText("Compare");
  } else {
    await expect(page.locator('[data-fin-local="compare"]')).toHaveAttribute("aria-selected", "true");
  }
  await expect(page.locator('[data-fc-state="ready"]')).toBeVisible({ timeout: 30_000 });
}

async function addPeer(page: Page, sym: string): Promise<void> {
  const input = page.locator("#fc-add-peer");
  await input.fill(sym);
  await input.press("Enter");
  await expect(page.locator(`[data-fc-chip="${sym}"]`)).toBeVisible();
}

const cell = (page: Page, metric: string, sym: string, col: string) =>
  page.locator(`[data-fc-table="${metric}"] tr[data-fc-row="${sym}"] td[data-fc-col="${col}"]`);
const row = (page: Page, metric: string, sym: string) => page.locator(`[data-fc-table="${metric}"] tr[data-fc-row="${sym}"]`);

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // The research pane clips sideways overflow, so the document never sees it — measure the pane:
  // only the comparison tables' own scrollers may be wider than the screen.
  const pane = await page.locator(".fin-pane").first().evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(pane).toBeLessThanOrEqual(1);
}

/**
 * Nothing above the source panel was scrolled sideways to reveal the focused cell — only the
 * Statements table's own scroller may move. (`documentElement.scrollWidth` cannot see an
 * overflow-hidden pane that was slid left by `scrollIntoView({ inline })`.)
 */
async function expectPanelNotShifted(page: Page): Promise<void> {
  await page.waitForTimeout(150); // the reveal runs on the next animation frame
  const shifted = await page.locator("[data-fc-source]").evaluate((panel) => {
    const out: string[] = [];
    for (let el = panel.parentElement; el; el = el.parentElement) {
      if (el.scrollLeft !== 0) out.push(`${el.tagName.toLowerCase()}.${el.className}:${el.scrollLeft}`);
    }
    const box = panel.getBoundingClientRect();
    if (box.left < -1 || box.right > window.innerWidth + 1) out.push(`panel box ${box.left}..${box.right}`);
    return out;
  });
  expect(shifted).toEqual([]);
}

test("peers share one explicit frame; other formats, currencies and split periods stay unavailable", async ({ page }) => {
  for (const sym of ["NVDA", "AMD", "INTC", "JPM", "0700.HK", "MSFT"]) await serveFund(page, sym);

  // Reached from the existing Financials family, next to Statements — no second router.
  await page.goto("/analysis?symbol=NVDA&page=statements");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });
  if (page.viewportSize()!.width <= 860) {
    await page.locator(".fin-local-mobile-tab", { hasText: "Compare" }).click();
  } else {
    await page.locator('[data-fin-local="compare"]').click();
  }
  await expect(page).toHaveURL(/[?&]page=compare\b/);
  await expect(page.locator('[data-fc-state="ready"]')).toBeVisible({ timeout: 30_000 });

  for (const sym of ["AMD", "INTC", "JPM", "0700.HK", "MSFT"]) await addPeer(page, sym);
  for (const sym of ["AMD", "INTC", "JPM", "0700.HK", "MSFT"]) {
    await expect(row(page, "revenue", sym)).toHaveAttribute("data-fc-row-state", "ready");
  }

  // AC-E11-01 — the frame is stated, not implied.
  await expect(page.locator("[data-fc-frame]")).toHaveText(
    "Frame set by NVDA: fiscal years · USD · industrial statements",
  );
  await expect(page.locator('[data-fc-table="revenue"] [data-fc-meta]')).toContainText("USD");

  // Fiscal-relative headers name fiscal generations, never calendar years.
  await expect(page.locator('[data-fc-table="revenue"] th[data-fc-col="F0"]')).toHaveText("Latest FY");
  await expect(page.locator('[data-fc-table="revenue"] th[data-fc-col="F1"]')).toHaveText("FY −1");
  await expect(page.locator('[data-fc-alignment-note]')).toContainText("Fiscal-relative");

  // Comparable cells carry the value, the company's own period and a rank among comparable rows.
  const nvda = cell(page, "revenue", "NVDA", "F0");
  await expect(nvda).toHaveAttribute("data-fc-status", "ok");
  await expect(nvda.locator("[data-fc-value]")).toHaveText("215.94B");
  await expect(nvda).toContainText("2026");
  const amd = cell(page, "revenue", "AMD", "F0");
  await expect(amd.locator("[data-fc-value]")).toHaveText("34.64B");
  await expect(amd).toContainText("2025");

  // AC-E11-04 — a bank's net revenue never sits in an industrial "Revenue" column…
  const jpmRevenue = cell(page, "revenue", "JPM", "F0");
  await expect(jpmRevenue).toHaveAttribute("data-fc-status", "noncomparable");
  await expect(jpmRevenue).toHaveAttribute("data-fc-reason", "family_mismatch");
  await expect(jpmRevenue.locator("[data-fc-value], [data-fc-rank]")).toHaveCount(0);
  await expect(jpmRevenue).toContainText("Other format");
  // …but the family-neutral net income line is compared.
  await expect(cell(page, "net_income", "JPM", "F0")).toHaveAttribute("data-fc-status", "ok");
  await expect(cell(page, "net_income", "JPM", "F0").locator("[data-fc-value]")).toHaveText("57.05B");

  // 0700.HK reports in CNY: refused on currency amounts, and the cell names its currency.
  const tencent = cell(page, "revenue", "0700.HK", "F0");
  await expect(tencent).toHaveAttribute("data-fc-status", "noncomparable");
  await expect(tencent).toHaveAttribute("data-fc-reason", "currency_mismatch");
  await expect(tencent.locator("[data-fc-value], [data-fc-rank]")).toHaveCount(0);

  // Ranks count only comparable rows: NVDA, AMD, INTC, MSFT carry revenue; JPM and 0700.HK do not.
  await expect(nvda.locator("[data-fc-rank]")).toHaveAttribute("data-fc-rank", "2/4");
  await expect(amd.locator("[data-fc-rank]")).toHaveAttribute("data-fc-rank", "4/4");

  // The peer limit is enforced with a message, not a silent drop.
  await page.locator("#fc-add-peer").fill("AAPL");
  await page.locator("#fc-add-peer").press("Enter");
  await expect(page.locator("[data-fc-peer-message]")).toHaveText("Up to 5 peers. Remove one to add another.");
  await expect(page.locator('[data-fc-chip="AAPL"]')).toHaveCount(0);

  await expectNoPageOverflow(page);

  // AC-E11-02 — calendar alignment relabels every column and places periods by date.
  await page.locator('[data-fc-align-option="calendar"]').click();
  await expect(page.locator('[data-fc-align-option="calendar"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-fc-alignment]")).toHaveAttribute("data-fc-alignment", "calendar");
  await expect(page.locator('[data-fc-table="revenue"] th[data-fc-col="CY2025"]')).toHaveText("CY 2025");
  await expect(page.locator('[data-fc-table="revenue"] th[data-fc-col="F0"]')).toHaveCount(0);
  await expect(page.locator('[data-fc-alignment-note]')).toContainText("Calendar-aligned");
  // NVDA's FY ending 2026-01-31 is (by majority of days) calendar 2025, and the cell says so.
  await expect(cell(page, "revenue", "NVDA", "CY2025").locator("[data-fc-value]")).toHaveText("215.94B");
  await expect(cell(page, "revenue", "NVDA", "CY2025")).toContainText("2026");
  // MSFT's July–June year splits evenly across two calendar years: left out, not guessed.
  const msft = cell(page, "revenue", "MSFT", "CY2025");
  await expect(msft).toHaveAttribute("data-fc-status", "unavailable");
  await expect(msft).toHaveAttribute("data-fc-reason", "calendar_straddle");
  await expect(msft.locator("[data-fc-value], [data-fc-rank]")).toHaveCount(0);

  // Interim calendar columns are calendar quarters, with each company's own fiscal label kept.
  await page.locator('[data-fc-basis-option="quarterly"]').click();
  await expect(page.locator('[data-fc-table="revenue"] th[data-fc-col="2026-Q2"]')).toHaveText("CQ2 2026");
  await expect(cell(page, "revenue", "NVDA", "2026-Q2")).toContainText("Q2 '27");
  await expect(cell(page, "revenue", "AMD", "2026-Q2")).toContainText("Q2 '26");

  await expectNoPageOverflow(page);
});

test("opening a cell lands on the exact company, period and row in the Statements view", async ({ page }) => {
  for (const sym of ["NVDA", "AMD", "JPM"]) await serveFund(page, sym);
  await openCompare(page);
  await addPeer(page, "AMD");
  await addPeer(page, "JPM");
  await expect(row(page, "revenue", "AMD")).toHaveAttribute("data-fc-row-state", "ready");

  // Annual peer cell → AMD's FY 2025 income statement, revenue row.
  const opener = page.locator('[data-fc-cell="revenue:AMD:F0"]');
  const compared = (await opener.locator("[data-fc-value]").textContent())?.trim();
  expect(compared).toBe("34.64B");
  await opener.click();
  const panel = page.locator("[data-fc-source]");
  await expect(panel).toHaveAttribute("data-fc-source", "AMD:annual:income:4");
  await expect(panel).toHaveAttribute("data-fc-source-end", "2025-12-31");
  await expect(panel.locator("[data-fc-source-for]")).toContainText("AMD");
  await expect(panel.locator("[data-fc-source-for]")).toContainText("2025");
  await expect(panel.locator('thead th[data-focus="true"]')).toHaveText("2025");
  const focusCell = panel.locator('td[data-focus-cell="true"]');
  await expect(focusCell).toHaveCount(1);
  await expect(focusCell.locator(".fin-cell-v")).toHaveText(compared!);
  await expectPanelNotShifted(page);
  // The embedded Statements view opened on the source statement and basis, not its defaults' guess.
  await expect(panel.locator(".fin-toggle button.on", { hasText: "Income statement" })).toHaveCount(1);
  await expect(panel.locator(".fin-toggle button.on", { hasText: /^Annual$/ })).toHaveCount(1);

  // Close returns focus to the comparison cell that opened it.
  await panel.locator("[data-fc-close-source]").click();
  await expect(panel).toHaveCount(0);
  await expect(opener).toBeFocused();

  // A refused cell still opens its own source, saying why it was left out.
  await page.locator('[data-fc-cell="revenue:JPM:F0"]').click();
  await expect(panel).toHaveAttribute("data-fc-source", /^JPM:annual:income:/);
  await expect(panel.locator("[data-fc-source-refusal]")).toHaveAttribute("data-fc-source-refusal", "family_mismatch");
  await panel.locator("[data-fc-close-source]").click();

  // Interim: the newest AMD quarter, not NVDA's differently numbered fiscal quarter.
  await page.locator('[data-fc-basis-option="quarterly"]').click();
  const qOpener = page.locator('[data-fc-cell="revenue:AMD:F0"]');
  await expect(qOpener).toContainText("Q2 '26");
  const qCompared = (await qOpener.locator("[data-fc-value]").textContent())?.trim();
  expect(qCompared).toBe("11.54B");
  await qOpener.click();
  await expect(panel).toHaveAttribute("data-fc-source", /^AMD:quarterly:income:\d+$/);
  await expect(panel).toHaveAttribute("data-fc-source-end", "2026-06-30");
  await expect(panel.locator('thead th[data-focus="true"]')).toHaveText("Q2 '26");
  await expect(panel.locator('td[data-focus-cell="true"] .fin-cell-v')).toHaveText(qCompared!);
  await expectPanelNotShifted(page);

  // The anchor's own cell opens the anchor's statements.
  await panel.locator("[data-fc-close-source]").click();
  await page.locator('[data-fc-cell="net_income:NVDA:F0"]').click();
  await expect(panel).toHaveAttribute("data-fc-source", /^NVDA:quarterly:income:\d+$/);
  await expect(panel.locator('thead th[data-focus="true"]')).toHaveText("Q2 '27");
  await expect(panel.locator('td[data-focus-cell="true"] .fin-cell-v')).toHaveText(/^59\.69B/);

  await expectNoPageOverflow(page);
});

test("a missing peer and a failed read are row states, and Retry recovers the failure", async ({ page }) => {
  await serveFund(page, "NVDA");
  await page.route(fundPattern("ZZZZ"), (route) => route.fulfill({ status: 404, body: "not found" }));
  let healthy = false;
  await page.route(fundPattern("AAPL"), (route) =>
    healthy ? route.fulfill({ json: fixture("AAPL") }) : route.fulfill({ status: 500, body: "boom" }),
  );
  await openCompare(page);

  // Admission messages: invalid, the anchor itself, a duplicate.
  const input = page.locator("#fc-add-peer");
  const message = page.locator("[data-fc-peer-message]");
  await input.fill("NVDA");
  await input.press("Enter");
  await expect(message).toHaveText("NVDA already sets the frame.");
  await input.fill("??");
  await input.press("Enter");
  await expect(message).toHaveText("Enter a ticker such as AMD, 0700.HK or BRK.B.");

  await addPeer(page, "ZZZZ");
  await input.fill("zzzz");
  await input.press("Enter");
  await expect(message).toHaveText("ZZZZ is already pinned.");

  const missing = row(page, "revenue", "ZZZZ");
  await expect(missing).toHaveAttribute("data-fc-row-state", "absent");
  await expect(missing).toContainText("Statements for ZZZZ are not published.");
  await expect(missing.locator("[data-fc-value], [data-fc-rank], [data-fc-retry]")).toHaveCount(0);

  await addPeer(page, "AAPL");
  const failed = row(page, "revenue", "AAPL");
  await expect(failed).toHaveAttribute("data-fc-row-state", "unavailable");
  await expect(failed).toContainText("could not be read (server error)");
  await expect(failed.locator("[data-fc-value], [data-fc-rank]")).toHaveCount(0);
  // The anchor's rank ignores rows that could not be read.
  await expect(cell(page, "revenue", "NVDA", "F0").locator("[data-fc-rank]")).toHaveCount(0);

  healthy = true;
  await failed.locator('[data-fc-retry="AAPL"]').click();
  await expect(failed).toHaveAttribute("data-fc-row-state", "ready");
  await expect(cell(page, "revenue", "AAPL", "F0")).toHaveAttribute("data-fc-status", "ok");
  await expect(cell(page, "revenue", "NVDA", "F0").locator("[data-fc-rank]")).toHaveAttribute("data-fc-rank", /\/2$/);

  // Removing a peer drops its row, and its remove button is labelled.
  await page.getByRole("button", { name: "Remove ZZZZ" }).click();
  await expect(row(page, "revenue", "ZZZZ")).toHaveCount(0);

  await expectNoPageOverflow(page);
});

test("a restated period keeps its filing version in the cell and the source", async ({ page }) => {
  const intc = fixture("INTC");
  const annual = intc.statements.annual as Record<string, unknown> & { periods: string[] };
  const n = annual.periods.length;
  // The FY 2024 column was re-filed; the producer records the latest filing date and the flag.
  annual.filed_by_period = annual.periods.map((_, i) => (i === n - 2 ? "2026-01-30" : null));
  annual.restated_by_period = annual.periods.map((_, i) => i === n - 2);
  await serveFund(page, "NVDA");
  await serveFund(page, "INTC", intc);
  await openCompare(page);
  await addPeer(page, "INTC");
  await expect(row(page, "revenue", "INTC")).toHaveAttribute("data-fc-row-state", "ready");

  const restated = cell(page, "revenue", "INTC", "F1");
  await expect(restated).toHaveAttribute("data-fc-status", "ok");
  await expect(restated).toContainText("2024");
  const badge = restated.locator("[data-fc-restated]");
  await expect(badge).toHaveText("Restated");
  await expect(badge).toHaveAttribute("title", /^More than one filing reported this period\. .*filed /);
  // An unrestated period carries no badge.
  await expect(cell(page, "revenue", "INTC", "F0").locator("[data-fc-restated]")).toHaveCount(0);

  await restated.locator("button").click();
  const panel = page.locator("[data-fc-source]");
  await expect(panel).toHaveAttribute("data-fc-source", `INTC:annual:income:${n - 2}`);
  await expect(panel.locator("[data-fc-source-restated]")).toContainText("earlier figures are not retained by the source");
  await expect(panel.locator('thead th[data-focus="true"]')).toHaveText("2024");
});
