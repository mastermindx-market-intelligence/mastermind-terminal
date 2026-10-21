import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Options R1 W3B — the constant-tenor comparison (VolComparePanel) on the
// Volatility tab. DRAFT: type-checked but NOT run in the building lane; the
// integrating seat runs it and captures the review crops.
//
// Mocking shape mirrors exposure-state-identity.spec.ts: page.route on
// **/api/flow?* keyed by the f= query param. The fixture is a synthetic W3B
// read (freeze §W3B), not market data. The clock is frozen at the fixture's
// read day so tenor labels (21D → 11 Nov) and the 2-trading-day horizon are
// deterministic at every project viewport.
const fixture = JSON.parse(readFileSync("e2e/fixtures/options-r1-w3b-vol.json", "utf8"));

async function openVolCompare(page: import("@playwright/test").Page, lang: "en" | "zh") {
  await page.addInitScript((locale) => {
    localStorage.setItem("mm.lang", locale);
  }, lang);
  // Freeze the clock at 2026-10-21 (the day after the nightly read): the panel
  // derives "today" in ET, so 23 Oct stays a 2-trading-day horizon and the
  // 21D interpolated expiry lands on 11 Nov.
  await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z"));
  await page.route("**/api/flow?*", async (route) => {
    const f = new URL(route.request().url()).searchParams.get("f");
    if (f === "vol:AAPL") await route.fulfill({ json: fixture });
    else if (f === "vol:SPY") await route.fulfill({ status: 404, json: {} });
    else if (f === "agg:AAPL" || f === "agg:SPY") await route.fulfill({ json: {} });
    else await route.fallback();
  });
  await page.goto("/options?tab=volatility");
  // The tab opens on SPY (a 404 coverage gap here); commit AAPL through the
  // ticker input VolView owns.
  await page.getByRole("combobox", { name: lang === "zh" ? "代码" : "Ticker", exact: true }).fill("AAPL");
  await page.getByRole("combobox", { name: lang === "zh" ? "代码" : "Ticker", exact: true }).press("Enter");
  const panel = page.getByTestId("vol-compare");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("vol-compare-strip")).toContainText("36.9 %");
  return panel;
}

test("the coverage strip reads the selected 23 Oct expiry as supplied with an unsupported delta axis", async ({ page }) => {
  const panel = await openVolCompare(page, "en");
  const strip = panel.getByTestId("vol-compare-strip");
  await expect(strip).toContainText("36.9 % · ATM IV · 23 Oct (2D) · supplied");
  await expect(strip).toContainText("side not stated by source");
  await expect(strip).toContainText("Delta axis unsupported · no spot or delta published");
});

test("the term table labels the 21D row as interpolated at 30.5%", async ({ page }) => {
  const panel = await openVolCompare(page, "en");
  const row21 = panel.locator("tbody tr").filter({ hasText: /^21D/ });
  await expect(row21).toHaveCount(1);
  await expect(row21).toContainText("30.5 %");
  await expect(row21).toContainText("interpolated · 14D → 30D");
  // The supplied expiries keep their own rows; 7D stays exactly as published
  // (IV and basis are separate cells, so assert them separately).
  const row7 = panel.locator("tbody tr").filter({ hasText: /^7D/ });
  await expect(row7).toContainText("34.8 %");
  await expect(row7).toContainText("supplied");
  await expect(row7).not.toContainText("interpolated");
});

test("the expected move is percent-only with its reason while no spot is supplied", async ({ page }) => {
  const panel = await openVolCompare(page, "en");
  const move = panel.getByTestId("vol-compare-move");
  await expect(move).toContainText("±3.3 %");
  await expect(move).toContainText("no spot supplied to this view");
  await expect(move).toContainText("no confidence level is attached");
  await expect(move).toContainText("2 trading days · 21 Oct → 23 Oct close");
  await expect(move).not.toContainText("$");
});

test("the skew table leaves the 110% wing blank with its reason", async ({ page }) => {
  const panel = await openVolCompare(page, "en");
  const skew = panel.getByTestId("vol-compare-skew");
  const row110 = skew.locator("tbody tr").filter({ hasText: /^110 %/ });
  await expect(row110).toContainText("—");
  await expect(row110).toContainText("unsupported · no strike supplied");
  // 95 % is a supplied strike on the fixture's 23 Oct smile (224.5 against the
  // 236.5 ATM proxy): it keeps the published wing IV and the supplied label.
  const row95 = skew.locator("tbody tr").filter({ hasText: /^95 %/ });
  await expect(row95).toContainText("40.8 %");
  await expect(row95).toContainText("supplied");
});

test("the events section says no calendar events are supplied", async ({ page }) => {
  const panel = await openVolCompare(page, "en");
  const events = panel.getByTestId("vol-compare-events");
  await expect(events).toContainText("No calendar events are supplied to this view.");
  await expect(events).toContainText("No event premium is estimated");
});

test("the zh view carries no English state words or machine tokens", async ({ page }) => {
  const panel = await openVolCompare(page, "zh");
  const text = await panel.innerText();
  expect(text).toContain("已提供");
  expect(text).toContain("插值");
  expect(text).toContain("平值IV");
  expect(text).toContain("不附带任何置信水平");
  expect(text).not.toMatch(/\b(supplied|interpolated|unsupported|SELECTED)\b/);
  expect(text).not.toMatch(/cmp[A-Z]/);
});

test("sections stack in order and the term table stays a table at every viewport", async ({ page }, info) => {
  const panel = await openVolCompare(page, "en");
  // Still a real table: all six columns visible, nothing hidden without a landing.
  for (const header of ["TENOR", "EXPIRY", "ATM IV", "BASIS", "EVENT WINDOW", "LEVEL"]) {
    await expect(panel.locator("th", { hasText: header }).first()).toBeVisible();
  }
  const order = await panel.evaluate((root) => {
    const top = (sel: string) => {
      const node = root.querySelector(sel);
      return node ? node.getBoundingClientRect().top : Number.NaN;
    };
    return [
      top('[data-testid="vol-compare-strip"]'),
      top("table"),
      top('[data-testid="vol-compare-answer"]'),
      top('[data-testid="vol-compare-move"]'),
      top('[data-testid="vol-compare-skew"]'),
      top('[data-testid="vol-compare-events"]'),
    ];
  });
  const stacked = order.every((y, i) => i === 0 || (!Number.isNaN(y) && y >= order[i - 1]!));
  expect(stacked, `section order ${JSON.stringify(order)}`).toBe(true);
  // Zero horizontal document overflow at the contract viewport (390 included).
  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
  await page.screenshot({ path: info.outputPath(`${info.project.name}-vol-compare.png`), fullPage: false });
});
