import { test, expect, type Locator } from "@playwright/test";

/* Cycles lane e2e — the /dev/sector-cycles harness (deterministic inline
 * fixtures, no network, clearly labelled as fixture data on the page itself).
 *
 * Charter gate 4: keyboard and touch through family/phase/range/scale/leg
 * selection, chart↔table equivalence, capture→navigate→apply return, at
 * 1440×900, 820×1180 and 390×844 (desktop/tablet/mobile), light+dark, EN+ZH.
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
  fullscreenBtn: lang === "zh" ? "全屏" : "Full screen",
  changeSeries: lang === "zh" ? "更换序列" : "Change series",
  phaseAll: lang === "zh" ? "全部阶段" : "All phases",
  expansion: lang === "zh" ? "扩张" : "Expansion",
  selectedFoot: lang === "zh" ? "已选" : "Selected",
  troughWord: lang === "zh" ? "底部" : "trough",
  prov: lang === "zh" ? "暂定" : "Provisional",
  rs63: lang === "zh" ? "63个交易日" : "63 sessions",
  trough: lang === "zh" ? "底部" : "Trough",
  recovery: lang === "zh" ? "复苏" : "Recovery",
  energy: lang === "zh" ? "能源" : "Energy",
  financials: lang === "zh" ? "金融" : "Financials",
  aiInfra: lang === "zh" ? "AI 基础设施" : "AI Infrastructure",
  story: lang === "zh" ? "趋成熟" : "matured",
  mismatch: lang === "zh" ? "快照版本不一致" : "Snapshots do not match",
  /* v1.1 per-head forecast capabilities + SP11 dates + honest windows */
  range21: lang === "zh" ? "21个交易日" : "21 sessions",
  range252: lang === "zh" ? "252个交易日" : "252 sessions",
  range1mWord: lang === "zh" ? "1个月" : "1 month",
  durationWord: lang === "zh" ? "并非剩余上行空间" : "not remaining upside",
  firstKnown: lang === "zh" ? "最早可知" : "first known",
  pivotNote: lang === "zh" ? "转折日期为拐点日期" : "Turn dates are pivot dates",
  headWithheld: lang === "zh" ? "暂缓显示" : "Withheld",
  headWithdrawnWord: lang === "zh" ? "已撤回" : "Withdrawn",
  reasonUnknown: lang === "zh" ? "因未说明的原因暂缓显示" : "Withheld for an unstated reason",
  reasonFailed: lang === "zh" ? "研究检验未通过" : "research test failed",
  reasonEpoch: lang === "zh" ? "与研究协议的转折口径不一致" : "does not match the research protocol",
  horizon20: lang === "zh" ? "20 个已完结交易日" : "20 completed sessions",
  directional: lang === "zh" ? "周期段方向事实" : "Leg-direction fact",
  headsAbsent: lang === "zh" ? "未附带预测能力分块" : "No forecast capability block",
});


async function expectMeasuredPlot(svg: Locator) {
  await expect(svg).toBeVisible();
  const geometry = () => svg.evaluate((element) => {
    const chart = element as SVGSVGElement;
    return {
      container: chart.parentElement!.clientWidth,
      width: Number(chart.getAttribute("width")),
      viewBox: chart.viewBox.baseVal.width,
      rendered: chart.getBoundingClientRect().width,
    };
  });
  expect((await geometry()).container).toBeGreaterThanOrEqual(240);
  await expect.poll(async () => {
    const value = await geometry();
    return Math.max(
      Math.abs(value.width - value.container),
      Math.abs(value.viewBox - value.container),
      Math.abs(value.rendered - value.container),
    );
  }, { message: "SVG coordinates must follow the current measured content width" }).toBeLessThanOrEqual(1);
  return geometry();
}

async function expectAxisLabels(svg: Locator, expected: string[]) {
  await expectMeasuredPlot(svg);
  // Tick labels belong to grid groups; date/turn labels use other anchors.
  const ticks = svg.locator('g > text[text-anchor="end"]');
  await expect(ticks).toHaveText(expected);
  expect(new Set(await ticks.allTextContents()).size).toBe(expected.length);
  const bounds = await ticks.evaluateAll(elements => elements.map(element => {
    const label = element.getBoundingClientRect();
    const chart = (element as SVGElement).ownerSVGElement!.getBoundingClientRect();
    return { left: label.left - chart.left, right: chart.right - label.right };
  }));
  for (const bound of bounds) {
    expect(bound.left).toBeGreaterThanOrEqual(-1);
    expect(bound.right).toBeGreaterThanOrEqual(-1);
  }
}

async function expectFullscreenControls(dialog: Locator) {
  const buttons = dialog.getByRole("button");
  await expect(buttons).toHaveCount(3);
  const geometry = await buttons.evaluateAll(elements => elements.map(element => {
    const button = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const lines = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
    return {
      label: element.textContent?.trim(),
      lines: lines.length,
      left: text.left - button.left,
      right: button.right - text.right,
      top: text.top - button.top,
      bottom: button.bottom - text.bottom,
    };
  }));
  for (const button of geometry) {
    expect(button.lines, button.label + " must stay on one readable line").toBe(1);
    for (const edge of [button.left, button.right, button.top, button.bottom]) {
      expect(edge, button.label + " text must fit inside its own button").toBeGreaterThanOrEqual(-1);
    }
  }
}

for (const [lang, theme] of cases) {
  const L = T(lang);

  for (const axisFixture of ["tiny", "fractional"] as const) {
    test(`cycles tick precision survives fullscreen ${axisFixture} ${lang} ${theme}`, async ({ page }, info) => {
      await page.goto("/dev/sector-cycles");
      await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
      await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true }).check();
      await page.getByLabel("Axis fixture").selectOption(axisFixture);
      await expect(page.getByText("Fixture data — not live evidence")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const panel = page.getByTestId("cycle-chart-panel");
      await panel.getByLabel(L.range).selectOption("0");
      const inlineLabels = axisFixture === "tiny"
        ? ["0.000", "0.005", "0.010"] : ["-2.5", "0.0", "2.5"];
      const fullscreenLabels = axisFixture === "tiny"
        ? ["0.0000", "0.0025", "0.0050", "0.0075", "0.0100"]
        : ["-4", "-2", "0", "2", "4"];
      await expectAxisLabels(panel.locator("svg"), inlineLabels);
      await panel.screenshot({
        path: info.outputPath(`cycles-precision-${axisFixture}-inline-${lang}-${info.project.name}.png`),
        animations: "disabled",
      });

      await panel.getByRole("button", { name: new RegExp(L.fullscreenBtn) }).click();
      const dialog = page.getByRole("dialog", { name: L.fullscreen });
      await expect(dialog).toBeVisible();
      await expectAxisLabels(dialog.locator("svg"), fullscreenLabels);
      await expectFullscreenControls(dialog);
      const viewport = page.viewportSize()!;
      const resizedWidth = viewport.width >= 981 ? 1280 : viewport.width >= 641 ? 760 : 430;
      await page.setViewportSize({ ...viewport, width: resizedWidth });
      await expectAxisLabels(dialog.locator("svg"), fullscreenLabels);
      await expectFullscreenControls(dialog);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await page.setViewportSize(viewport);
      await expectAxisLabels(panel.locator("svg"), inlineLabels);
      // Reopening creates a new measured DOM node; the retained component/ref
      // must attach its observer again instead of reusing the last width.
      await panel.getByRole("button", { name: new RegExp(L.fullscreenBtn) }).click();
      await expect(dialog).toBeVisible();
      await expectAxisLabels(dialog.locator("svg"), fullscreenLabels);
      await expectFullscreenControls(dialog);
      await dialog.screenshot({
        path: info.outputPath(`cycles-precision-${axisFixture}-fullscreen-${lang}-${info.project.name}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expectAxisLabels(panel.locator("svg"), inlineLabels);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    });
  }

  for (const transition of ["table", "empty"] as const) {
    test(`cycles chart measurement survives ${transition} transitions ${lang} ${theme}`, async ({ page }, info) => {
      await page.goto("/dev/sector-cycles");
      await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
      await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true }).check();

      const initialViewport = page.viewportSize()!;
      // Remain in the same responsive band, so a remounted panel cannot hide
      // the lost observer. The final capture returns to the contract viewport.
      const widths = initialViewport.width >= 981 ? [1100, 1280]
        : initialViewport.width >= 641 ? [700, 900] : [510, 430];
      const panel = page.getByTestId("cycle-chart-panel");
      const svg = panel.locator("svg");
      const expectThemePaint = async (selected: "light" | "dark") => {
        await expect.poll(() => panel.evaluate(element => {
          const root = document.documentElement;
          const tokens = getComputedStyle(root);
          const paint = getComputedStyle(element);
          return {
            theme: root.dataset.theme,
            appearance: root.dataset.terminalAppearance,
            sharedShell: root.dataset.mmxSharedShell ?? null,
            backgroundToken: tokens.getPropertyValue("--bg").trim(),
            secondaryPanelToken: tokens.getPropertyValue("--panel-2").trim(),
            textToken: tokens.getPropertyValue("--text").trim(),
            background: paint.backgroundColor,
            foreground: paint.color,
          };
        })).toEqual({
          theme: selected, appearance: "1", sharedShell: null,
          backgroundToken: selected === "light" ? "#f7f8fa" : "#0a0b0e",
          secondaryPanelToken: selected === "light" ? "#eef1f6" : "#15171d",
          textToken: selected === "light" ? "#202632" : "#d6dae3",
          background: selected === "light" ? "rgb(255, 255, 255)" : "rgb(13, 15, 19)",
          foreground: selected === "light" ? "rgb(32, 38, 50)" : "rgb(214, 218, 227)",
        });
      };
      await expectThemePaint(theme);
      const otherTheme = theme === "light" ? "dark" : "light";
      await page.getByRole("radio", { name: otherTheme === "light" ? "Light" : "Dark", exact: true }).check();
      await expectThemePaint(otherTheme);
      await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true }).check();
      await expectThemePaint(theme);
      const initial = await expectMeasuredPlot(svg);
      const originalPanel = await panel.elementHandle();
      const contentHost = await svg.locator("..").locator("..").elementHandle();
      expect(originalPanel).not.toBeNull();
      expect(contentHost).not.toBeNull();

      const observation = page.getByTestId("cycle-observation");
      if (transition === "table") {
        await panel.getByLabel(L.obs).focus();
        await page.keyboard.press("Home");
      }
      const date = (await observation.locator("time").textContent())!.trim();
      const value = (await observation.locator("strong").first().textContent())!.trim();
      const selectFamily = async (label: string) => {
        if (initialViewport.width <= 980) {
          await page.getByTestId("sector-cycle-lens").getByRole("button", { name: L.changeSeries, exact: true }).click();
          const sheet = page.getByRole("dialog");
          await expect(sheet).toBeVisible();
          await sheet.getByRole("button", { name: label, exact: true }).click();
          await expect(sheet).toBeHidden();
        } else {
          await page.getByTestId("cycle-phase-rail").getByRole("tab", { name: label }).click();
        }
      };

      if (transition === "table") {
        await panel.getByRole("button", { name: L.table, exact: true }).click();
        const row = panel.locator(`table tbody tr:has(> th:text-is("${date}"))`).first();
        await expect(row.locator("td").first()).toHaveText(value);
      } else {
        await selectFamily(L.baskets);
        await expect(panel.getByRole("status")).toBeVisible();
      }
      await expect(svg).toHaveCount(0);
      await page.setViewportSize({ ...initialViewport, width: widths[0] });
      expect(await originalPanel!.evaluate(node => node.isConnected)).toBe(true);
      expect(await contentHost!.evaluate(node => node.isConnected)).toBe(true);

      if (transition === "table") {
        await panel.getByRole("button", { name: L.chart, exact: true }).click();
      } else {
        await selectFamily(L.sectorsTab);
      }
      const restored = await expectMeasuredPlot(svg);
      expect(Math.abs(restored.container - initial.container)).toBeGreaterThan(1);
      expect(await svg.evaluate((node, original) => node.parentElement!.parentElement === original, contentHost)).toBe(true);
      expect(await panel.evaluate((node, original) => node === original, originalPanel)).toBe(true);
      await expect(observation.locator("time")).toHaveText(date);
      await expect(observation.locator("strong").first()).toHaveText(value);

      await page.setViewportSize({ ...initialViewport, width: widths[1] });
      await expectMeasuredPlot(svg);
      await page.setViewportSize(initialViewport);
      await expectMeasuredPlot(svg);
      await expect(observation.locator("time")).toHaveText(date);
      await expect(observation.locator("strong").first()).toHaveText(value);
      expect(await panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      await expectThemePaint(theme);
      await panel.screenshot({
        path: info.outputPath(`cycles-measurement-${transition}-${lang}-${info.project.name}.png`),
        animations: "disabled",
      });
    });
  }


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
    // Compact layouts use the real series picker on phones and tablets.
    const width = page.viewportSize()!.width;
    const usesPicker = width <= 980;
    const heroTicker = page.getByTestId("cycle-hero").locator("h3 > b");
    const openPicker = async () => {
      await expect(rail).toBeHidden();
      await lens.getByRole("button", { name: L.changeSeries, exact: true }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      return sheet;
    };
    const expectSelected = async (ticker: "XLK" | "XLE" | "XLF") => {
      await expect(heroTicker).toHaveText(ticker);
      if (usesPicker) {
        const sheet = await openPicker();
        await expect(sheet.getByRole("button", { name: new RegExp(ticker) }))
          .toHaveAttribute("aria-pressed", "true");
        // An unchanged Apply closes the picker without adding a history entry.
        await sheet.getByRole("button", { name: L.apply, exact: true }).click();
        await expect(sheet).toBeHidden();
      } else {
        await expect(rail.getByRole("button", { name: new RegExp(ticker) }))
          .toHaveAttribute("aria-pressed", "true");
      }
    };
    const selectSubject = async (ticker: "XLK" | "XLE" | "XLF", keyboard = false) => {
      const previousTicker = await heroTicker.textContent();
      const picker = usesPicker ? await openPicker() : rail;
      const subject = picker.getByRole("button", { name: new RegExp(ticker) });
      if (keyboard) {
        await subject.focus();
        await page.keyboard.press("Enter");
      } else {
        await subject.click();
      }
      await expect(subject).toHaveAttribute("aria-pressed", "true");
      if (usesPicker) {
        // Subject choice is a draft until the visible Apply control commits it.
        await expect(heroTicker).toHaveText(previousTicker!);
        await picker.getByRole("button", { name: L.apply, exact: true }).click();
        await expect(picker).toBeHidden();
      }
      await expectSelected(ticker);
    };
    const selectFamily = async (label: string) => {
      if (usesPicker) {
        const sheet = await openPicker();
        await sheet.getByRole("button", { name: label, exact: true }).click();
        // Family selection commits immediately and retires the open picker.
        await expect(sheet).toBeHidden();
      } else {
        await rail.getByRole("tab", { name: label }).click();
      }
    };
    await expectSelected("XLK");

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
    // Range controls count supplied observations, not elapsed calendar days.
    await expect(dataTable.locator("tbody tr")).toHaveCount(63);
    await expect(dataTable.locator("tbody tr").first().locator("th")).toHaveText("2026-05-02");
    await expect(dataTable.locator("tbody tr").last().locator("th")).toHaveText("2026-03-01");
    const row = dataTable.locator(`tbody tr:has(> th:text-is("${date}"))`);
    await expect(row).toHaveCount(1);
    await expect(row.locator("td").first()).toHaveText(chartValue);

    /* ── Range select: All and 21-session windows (exact boundaries) ── */
    await panel.getByLabel(L.range).selectOption("0");
    await expect(dataTable.locator("tbody tr")).toHaveCount(252);

    /* ── Panel fullscreen (R5-Y03) at the full window: turn labels visible,
     * the Chart/Exact toggle carries the same 252-row basis, Escape out. ── */
    await panel.getByRole("button", { name: new RegExp(L.fullscreenBtn) }).click();
    const fs = page.getByRole("dialog", { name: L.fullscreen });
    await expect(fs).toBeVisible();
    // Turn labels are visible on the measured chart (thinned by pixel gap).
    // Scope to <text> nodes: the turn markers' <title> tooltips also carry
    // the raw kind word, and the kept-label count varies by width.
    await expect(fs.locator("svg text").filter({ hasText: L.troughWord }).first()).toBeVisible();
    await fs.getByRole("button", { name: L.table, exact: true }).click();
    await expect(fs.locator("tbody tr")).toHaveCount(252);
    await fs.getByRole("button", { name: L.chart, exact: true }).click();
    await expect(fs.locator("svg")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(fs).toBeHidden();

    await panel.getByLabel(L.range).selectOption("21");
    await expect(dataTable.locator("tbody tr")).toHaveCount(21);
    await expect(dataTable.locator("tbody tr").first().locator("th")).toHaveText("2026-05-02");
    await expect(dataTable.locator("tbody tr").last().locator("th")).toHaveText("2026-04-12");

    /* ── Scale: the fixture RS crosses zero, so log is an honest refusal ── */
    await expect(panel.getByRole("option", { name: L.log, exact: true })).toHaveAttribute("disabled", "");

    await panel.getByRole("button", { name: L.chart, exact: true }).click();
    await expect(panel.locator("svg")).toBeVisible();

    /* ── Keyboard phase selection through the visible control ── */
    await selectSubject("XLE", true);
    await expect(page.getByTestId("cycle-hero")).toContainText(L.trough);

    /* ── Family: baskets universe, then back to sectors ── */
    await selectFamily(L.baskets);
    await expect(page.getByTestId("cycle-basket-compare")).toBeVisible();
    await expect(page.getByTestId("cycle-basket-compare")).toContainText(L.aiInfra);
    await selectFamily(L.sectorsTab);
    await expectSelected("XLE");

    /* ── Leg selection: the provisional leg keeps its label ── */
    const legs = page.getByTestId("cycle-leg-timeline");
    const provLeg = legs.getByRole("button").filter({ hasText: L.prov });
    await provLeg.click();
    const legDetail = page.getByTestId("cycle-leg-detail");
    await expect(legDetail).toBeVisible();
    await expect(legDetail).toContainText("→"); // dated from → to header
    await expect(legDetail.getByRole("button", { name: L.legDetails })).toBeVisible();

    /* ── Capture → navigate → apply return (self-bound router) ── */
    await selectSubject("XLK");
    const values = panel.locator(`details:has(summary:text-is("${L.exact}"))`);
    await values.locator("summary").click();
    await expect(values).toHaveAttribute("open", "");
    await selectSubject("XLF");
    await expect(page.getByTestId("cycle-hero")).toContainText(L.recovery);
    await page.goBack();
    await expectSelected("XLK");
    await expect(page.getByTestId("cycle-hero")).not.toContainText(L.recovery);
    await expect(values).toHaveAttribute("open", ""); // captured field restored

    /* ── No horizontal overflow at this width ── */
    expect(await lens.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);

    await lens.screenshot({
      path: info.outputPath(`cycles-core-${lang}-${info.project.name}.png`),
      animations: "disabled",
    });
  });

  /* ── v1.1: per-head forecast capabilities (lane 8 wire), withdrawal with
   * date, first-known vs pivot dates, and session-count windows. All states
   * ride the labelled fixture harness; no live record exists today. ── */
  test(`cycles forecast heads and first-known dates ${lang} ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "new-state proof is the 1440/390 contract");
    await page.goto("/dev/sector-cycles");
    await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
    await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark" }).check();
    const lens = page.getByTestId("sector-cycle-lens");
    await expect(lens).toBeVisible();

    /* Honest windows: the native ranges are session counts, never months,
     * and never Prophet's separate 20-session horizon. */
    const rangeSel = page.getByTestId("cycle-chart-panel").getByLabel(L.range);
    await expect(rangeSel.locator("option").nth(0)).toHaveText(L.range21);
    await expect(rangeSel.locator("option").nth(1)).toHaveText(L.rs63);
    await expect(rangeSel.locator("option").nth(2)).toHaveText(L.range252);
    await expect(rangeSel.locator("option", { hasText: L.range1mWord })).toHaveCount(0);

    /* The default 63-session window hides the confirmed turns that carry
     * first-known dates; widen to All so both date facts are on screen. */
    await rangeSel.selectOption("0");

    /* SP11: the turns card keeps pivot and first-known dates distinct. */
    const turns = page.getByTestId("cycle-turns");
    await expect(turns).toContainText(L.pivotNote);
    await expect(turns).toContainText(L.firstKnown);

    /* Today's fixture wire: four heads, each withheld on its OWN published
     * reason; no number is shown for any of them. */
    const heads = page.getByTestId("cycle-forecast-heads");
    await expect(heads.locator("[data-head]")).toHaveCount(4);
    await expect(heads.getByText(L.headWithheld, { exact: true })).toHaveCount(4);
    await expect(heads).toContainText(L.reasonFailed);
    await expect(heads).toContainText(L.reasonEpoch);
    await expect(heads).toContainText(L.horizon20);
    // The leg-direction note rides the target head only — the transition-
    // time head measures first-known timing, not a leg-direction fact.
    await expect(
      heads.locator('[data-head="target_before_invalidation"]'),
    ).toContainText(L.directional);
    await expect(heads.locator('[data-head="transition_time"]')).not.toContainText(L.directional);

    /* The producer's withdraw() shape: the withdrawn head stays "withheld"
     * with a caller-supplied reason code (parity_lost) that renders the
     * generic line — no Withdrawn status exists on the wire — and its
     * siblings and the observed facts remain. */
    await page.getByRole("radio", { name: "One head withdrawn", exact: true }).check();
    await expect(heads.locator('[data-status="withheld"]')).toHaveCount(4);
    await expect(heads.locator('[data-head="adverse_tail"]')).toContainText(L.reasonUnknown);
    await expect(heads).not.toContainText(L.headWithdrawnWord);
    await expect(page.getByTestId("cycle-hero")).toBeVisible();
    await expect(page.getByTestId("cycle-leg-timeline")).toBeVisible();
    await expect(turns).toContainText(L.firstKnown);
    await expect(page.getByTestId("cycle-timing")).toContainText(L.durationWord);
    await heads.screenshot({
      path: info.outputPath(`cycles-heads-${lang}-${theme}-${info.project.name}.png`),
      animations: "disabled",
    });

    /* The v1.1 screenshot contract is EN/ZH × light/dark at 390 + 1440: the
     * case loop carries two of the four combos, so capture the opposite theme
     * from the same withdrawn-head state before moving on. */
    const otherTheme = theme === "light" ? "dark" : "light";
    await page.getByRole("radio", { name: otherTheme === "light" ? "Light" : "Dark" }).check();
    await expect(heads.locator('[data-head="adverse_tail"]')).toContainText(L.reasonUnknown);
    await heads.screenshot({
      path: info.outputPath(`cycles-heads-${lang}-${otherTheme}-${info.project.name}.png`),
      animations: "disabled",
    });
    await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark" }).check();

    /* A record without the block is stated honestly; nothing is inferred. */
    await page.getByRole("radio", { name: "Heads absent", exact: true }).check();
    await expect(heads).toContainText(L.headsAbsent);
    await expect(heads.locator("[data-head]")).toHaveCount(0);
    // The observed Cycles experience is untouched by any heads state.
    await expect(page.getByTestId("cycle-leg-timeline")).toBeVisible();
    expect(await lens.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
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

  test(`cycles 768 structure ${lang}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "768 band is a desktop-project resize");
    await page.goto("/dev/sector-cycles");
    await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
    const lens = page.getByTestId("sector-cycle-lens");
    await expect(lens).toBeVisible();
    await page.setViewportSize({ width: 768, height: 1024 });

    /* R5-Y04: the rail collapses to the Change-series trigger; the full
     * picker (families, phases, rows) lives in the sheet it opens. */
    await expect(page.getByTestId("cycle-phase-rail")).toBeHidden();
    const trigger = lens.getByRole("button", { name: new RegExp(L.changeSeries) });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: L.sectorsTab })).toBeVisible();
    await sheet.getByRole("button", { name: L.apply, exact: true }).click();
    await expect(sheet).toBeHidden();

    /* Depth outcomes reflow to two columns with no horizontal overflow. */
    const cols = await page
      .getByTestId("cycle-depth-grid")
      .evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
    expect(cols).toBe(2);
    expect(await lens.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await lens.screenshot({
      path: info.outputPath(`cycles-768-${lang}.png`),
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
    /* ── R5-Y02 picker structure: 2×2 family control, phase filter chips,
     * selected-series footer with the same-basis rule note. ── */
    await expect(sheet.getByRole("button", { name: L.sectorsTab })).toBeVisible();
    await sheet.getByRole("button", { name: L.expansion, exact: true }).tap();
    await expect(sheet.locator("li")).toHaveCount(1); // only XLK sits in Expansion
    await sheet.getByRole("button", { name: L.phaseAll, exact: true }).tap();
    await expect(sheet.locator("li")).toHaveCount(5);
    await expect(sheet).toContainText(L.selectedFoot);
    // The price-cycle structures differ, but both retained RS series use TR.
    const xlfRow = sheet.locator("li").filter({ hasText: L.financials });
    await expect(xlfRow.getByRole("radio")).toBeEnabled();
    await xlfRow.getByRole("radio").check();
    // One comparison choice is retained; choosing Energy replaces Financials.
    const xleRow = sheet.locator("li").filter({ hasText: L.energy });
    await xleRow.getByRole("radio").check();
    await expect(xlfRow.getByRole("radio")).not.toBeChecked();
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
