import { test, expect } from "@playwright/test";

/* Cycles lane e2e — the /dev/sector-cycles harness (deterministic inline
 * fixtures, no network, clearly labelled as fixture data on the page itself).
 *
 * Charter gate 4: keyboard and touch through family/phase/range/scale/leg
 * selection, chart↔table equivalence, capture→navigate→apply return, at
 * 1440×900 (desktop project) and 390×844 (mobile project), light+dark, EN+ZH.
 * The self-bound return router is exercised for real: leaving a subject
 * pushes its captured view onto the history entry being left; the browser
 * back button rebinds that subject (donor #10707 host contract) and the
 * two-phase codec restores the captured fields. */

const cases = [
  ["en", "dark"],
  ["zh", "light"],
] as const;

const T = (lang: "en" | "zh") => ({
  chart: lang === "zh" ? "图表" : "Chart",
  table: lang === "zh" ? "数据表" : "Data table",
  range: lang === "zh" ? "图表范围" : "Chart range",
  log: lang === "zh" ? "对数" : "Log",
  series: lang === "zh" ? "序列" : "Series",
  obs: lang === "zh" ? "观测日期" : "Observation date",
  exact: lang === "zh" ? "精确数值" : "Exact values",
  baskets: lang === "zh" ? "主题组合对比 SPY" : "Thematic Baskets vs SPY",
  sectorsTab: lang === "zh" ? "板块 ETF 对比 SPY" : "Sector ETFs vs SPY",
  apply: lang === "zh" ? "应用" : "Apply",
  legDetails: lang === "zh" ? "周期段详情" : "Leg details",
  fullscreen: lang === "zh" ? "周期全屏" : "Cycles fullscreen",
  openFullscreen: lang === "zh" ? "打开全屏" : "Open fullscreen",
  prov: lang === "zh" ? "暂定" : "Provisional",
  rs63: lang === "zh" ? "63个交易日" : "63 sessions",
  trough: lang === "zh" ? "底部" : "Trough",
  recovery: lang === "zh" ? "复苏" : "Recovery",
  energy: lang === "zh" ? "能源" : "Energy",
  financials: lang === "zh" ? "金融" : "Financials",
  aiInfra: lang === "zh" ? "AI 基础设施" : "AI Infrastructure",
  story: lang === "zh" ? "趋成熟" : "matured",
  mismatch: lang === "zh" ? "快照版本不一致" : "Snapshots do not match",
});

for (const [lang, theme] of cases) {
  const L = T(lang);

  test(`cycles core journey ${lang} ${theme}`, async ({ page }, info) => {
    await page.goto("/dev/sector-cycles");
    await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
    await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true }).check();

    const lens = page.getByTestId("sector-cycle-lens");
    await expect(lens).toBeVisible();
    // Fixture honesty is visible on the harness itself.
    await expect(page.getByText(/Fixture data/)).toBeVisible();

    const rail = page.getByTestId("cycle-phase-rail");
    const panel = page.getByTestId("cycle-chart-panel");
    const xlk = rail.getByRole("button", { name: /XLK/ });
    await expect(xlk).toHaveAttribute("aria-pressed", "true");

    /* ── Keyboard: observation cursor to the first date of the window ── */
    const obs = page.getByTestId("cycle-observation");
    await lens.getByLabel(L.obs).focus();
    await page.keyboard.press("Home");
    await expect(obs.locator("time")).not.toBeEmpty();
    const date = (await obs.locator("time").textContent())!.trim();
    const chartValue = (await obs.locator("strong").first().textContent())!.trim();

    /* ── Chart↔table equivalence at the cursor date (same formatter) ── */
    await panel.getByRole("button", { name: L.table, exact: true }).click();
    const dataTable = panel.locator("table").first();
    await expect(dataTable).toBeVisible();
    await expect(dataTable.locator("tbody tr")).toHaveCount(64); // 3-month window: 63-day span, inclusive endpoints
    const row = dataTable.locator(`tbody tr:has(> th:text-is("${date}"))`);
    await expect(row).toHaveCount(1);
    await expect(row.locator("td").first()).toHaveText(chartValue);

    /* ── Range select: All and 1-month windows (exact row counts) ── */
    await panel.getByLabel(L.range).selectOption("0");
    await expect(dataTable.locator("tbody tr")).toHaveCount(252);
    await panel.getByLabel(L.range).selectOption("21");
    await expect(dataTable.locator("tbody tr")).toHaveCount(22); // 21-day span, inclusive

    /* ── Scale: the fixture RS crosses zero, so log is an honest refusal ── */
    await expect(panel.getByRole("option", { name: L.log, exact: true })).toHaveAttribute("disabled", "");

    await panel.getByRole("button", { name: L.chart, exact: true }).click();
    await expect(panel.locator("svg")).toBeVisible();

    /* ── Keyboard phase selection through the rail ── */
    const xle = rail.getByRole("button", { name: /XLE/ });
    await xle.focus();
    await page.keyboard.press("Enter");
    await expect(xle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cycle-hero")).toContainText(L.trough);

    /* ── Family: baskets universe, then back to sectors ── */
    await rail.getByRole("tab", { name: L.baskets }).click();
    await expect(page.getByTestId("cycle-basket-compare")).toBeVisible();
    await expect(page.getByTestId("cycle-basket-compare")).toContainText(L.aiInfra);
    await rail.getByRole("tab", { name: L.sectorsTab }).click();
    await expect(rail.getByRole("button", { name: /XLE/ })).toHaveAttribute("aria-pressed", "true");

    /* ── Leg selection: the provisional leg keeps its label ── */
    const legs = page.getByTestId("cycle-leg-timeline");
    const provLeg = legs.getByRole("button").filter({ hasText: L.prov });
    await provLeg.click();
    const legDetail = page.getByTestId("cycle-leg-detail");
    await expect(legDetail).toBeVisible();
    await expect(legDetail).toContainText("→"); // dated from → to header
    await expect(legDetail.getByRole("button", { name: L.legDetails })).toBeVisible();

    /* ── Capture → navigate → apply return (self-bound router) ── */
    await xlk.click();
    await expect(xlk).toHaveAttribute("aria-pressed", "true");
    const values = panel.locator(`details:has(summary:text-is("${L.exact}"))`);
    await values.locator("summary").click();
    await expect(values).toHaveAttribute("open", "");
    const xlf = rail.getByRole("button", { name: /XLF/ });
    await xlf.click();
    await expect(xlf).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cycle-hero")).toContainText(L.recovery);
    await page.goBack();
    await expect(xlk).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cycle-hero")).not.toContainText(L.recovery);
    await expect(values).toHaveAttribute("open", ""); // captured field restored

    /* ── No horizontal overflow at this width ── */
    expect(await lens.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);

    await lens.screenshot({
      path: info.outputPath(`cycles-core-${lang}-${info.project.name}.png`),
      animations: "disabled",
    });
  });

  test(`cycles replaced generation withholds ${lang}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "generation switch is viewport-independent");
    await page.goto("/dev/sector-cycles");
    await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
    const lens = page.getByTestId("sector-cycle-lens");
    await expect(page.getByTestId("cycle-phase-rail")).toBeVisible();
    await page.getByRole("radio", { name: "Generation replaced", exact: true }).check();
    await expect(lens).toContainText(L.mismatch);
    // A replaced generation never renders the old history or roster.
    await expect(page.getByTestId("cycle-phase-rail")).toHaveCount(0);
    await expect(page.getByTestId("cycle-chart-panel")).toHaveCount(0);
    await lens.screenshot({
      path: info.outputPath(`cycles-replaced-${lang}.png`),
      animations: "disabled",
    });
  });

  test(`cycles mobile sheets ${lang}`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "half-sheet/full-sheet journey is the 390 contract");
    await page.goto("/dev/sector-cycles");
    await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
    const lens = page.getByTestId("sector-cycle-lens");
    const panel = page.getByTestId("cycle-chart-panel");
    await expect(lens).toBeVisible();

    /* ── Series half-sheet: same-basis refusal, comparison via draft+Apply ── */
    await panel.getByRole("button", { name: new RegExp(L.series) }).tap();
    let sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible();
    // XLF is price-basis vs XLK's total return: refused with the reason.
    const xlfRow = sheet.locator("li").filter({ hasText: L.financials });
    await expect(xlfRow.getByRole("checkbox")).toBeDisabled();
    await expect(xlfRow).toContainText(lang === "zh" ? "口径" : "basis");
    // XLE shares the tr basis: selectable, then committed through Apply.
    const xleRow = sheet.locator("li").filter({ hasText: L.energy });
    await xleRow.getByRole("checkbox").tap();
    await sheet.getByRole("button", { name: L.apply, exact: true }).tap();
    await expect(sheet).toBeHidden();
    await expect(panel).toContainText(`${L.energy} · ${L.rs63}`);

    /* ── Leg sheet: full-height dialog, story, fullscreen, keyboard, drag ── */
    const legs = page.getByTestId("cycle-leg-timeline");
    const provLeg = legs.getByRole("button").filter({ hasText: L.prov });
    await provLeg.tap();
    await page.getByTestId("cycle-leg-detail").getByRole("button", { name: L.legDetails }).tap();
    sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(L.story);

    // Landscape fullscreen (844×486): crosshair keyboard + values, Escape out.
    await page.setViewportSize({ width: 844, height: 486 });
    await sheet.getByRole("button", { name: L.openFullscreen }).tap();
    const fs = page.getByRole("dialog", { name: L.fullscreen });
    await expect(fs).toBeVisible();
    const fsValues = page.getByTestId("cycle-fullscreen-values");
    const fsDate0 = (await fsValues.locator("time").textContent())!.trim();
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => (await fsValues.locator("time").textContent())!.trim())
      .not.toBe(fsDate0);
    await page.keyboard.press("Escape");
    await expect(fs).toBeHidden();
    // One modal at a time: the fullscreen replaced the leg sheet, so Escape
    // leaves no dialog at all.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });

    // Re-open the leg sheet (leg buttons toggle: reselect after the earlier
    // selection) and drag its handle down to dismiss.
    await legs.getByRole("button").filter({ hasText: L.prov }).tap(); // deselect
    await legs.getByRole("button").filter({ hasText: L.prov }).tap(); // select again
    await page.getByTestId("cycle-leg-detail").getByRole("button", { name: L.legDetails }).tap();
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    const grab = page.locator('[role="dialog"]').locator("button").first();
    const box = (await grab.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 140, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('[role="dialog"]')).toBeHidden();

    expect(await lens.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await lens.screenshot({
      path: info.outputPath(`cycles-sheets-${lang}.png`),
      animations: "disabled",
    });
  });
}
