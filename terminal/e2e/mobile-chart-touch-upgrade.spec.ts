import { expect, test, type Locator, type Page } from "@playwright/test";

const PHONE_WIDTHS = [320, 360, 390, 430] as const;
const ACTION_IDS = ["roller-draw", "roller-more", "roller-undo", "roller-redo", "roller-share"] as const;

type TouchWindow = Window & {
  __mmPhoneReady?: boolean;
  __mmShareCount?: number;
};

async function openChart(page: Page, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    const ready = window as TouchWindow;
    ready.__mmPhoneReady = false;
    ready.__mmShareCount = 0;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => { ready.__mmShareCount = (ready.__mmShareCount ?? 0) + 1; },
    });
    window.addEventListener("mm:terminal-visual-ready", () => { ready.__mmPhoneReady = true; }, { once: true });
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(
    () => page.evaluate(() => Boolean((window as TouchWindow).__mmPhoneReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 20_000 },
  ).toBe(true);
}

async function openTerminal(page: Page, width: number, height = 844) {
  await openChart(page, width, height);
  await expect(page.getByTestId("roller-strip")).toBeVisible();
}

async function centerAction(page: Page, testId: string) {
  await page.getByTestId("roller-cluster").evaluate((cluster, id) => {
    const button = cluster.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!button) throw new Error(`missing ${id}`);
    const clusterRect = cluster.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const contentCenter = cluster.scrollLeft + buttonRect.left - clusterRect.left + buttonRect.width / 2;
    cluster.scrollLeft = contentCenter - cluster.clientWidth / 2;
  }, testId);
  await page.waitForTimeout(50);
}

async function actionPointMetrics(page: Page, testId: string) {
  await centerAction(page, testId);
  return page.getByTestId(testId).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const owner = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest<HTMLButtonElement>("button")?.dataset.testid ?? null;
    const visual = button.querySelector<HTMLElement>("[data-roller-visual]")?.getBoundingClientRect();
    return {
      targetWidth: rect.width,
      targetHeight: rect.height,
      visualWidth: visual?.width ?? 0,
      visualHeight: visual?.height ?? 0,
      centerX: cx,
      centerY: cy,
      owners: {
        left: owner(cx - 21, cy),
        right: owner(cx + 21, cy),
        top: owner(cx, cy - 21),
        bottom: owner(cx, cy + 21),
      },
    };
  });
}

async function tapActionEdge(page: Page, testId: string, side: "left" | "right" = "left") {
  await centerAction(page, testId);
  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2 + (side === "left" ? -21 : 21);
  const y = box!.y + box!.height / 2;
  await page.touchscreen.tap(x, y);
}

async function dragDrawing(page: Page, layer: Locator) {
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.57, box!.y + box!.height * 0.52, { steps: 8 });
  await page.mouse.up();
}

for (const width of PHONE_WIDTHS) {
  test(`MM-007: roller actions own disjoint 44px point-hit regions at ${width}px`, async ({ page }) => {
    await openTerminal(page, width);

    const wheelBefore = await page.getByTestId("roller-symbol").boundingBox();
    expect(wheelBefore).not.toBeNull();

    for (const id of ACTION_IDS) {
      const metrics = await actionPointMetrics(page, id);
      expect(metrics.targetWidth).toBeGreaterThanOrEqual(44);
      expect(metrics.targetHeight).toBeGreaterThanOrEqual(44);
      expect(metrics.visualWidth).toBeCloseTo(28, 0);
      expect(metrics.visualHeight).toBeCloseTo(28, 0);
      expect(metrics.owners, `${id} should own all four 42px edge probes`).toEqual({
        left: id,
        right: id,
        top: id,
        bottom: id,
      });
    }

    const layout = await page.getByTestId("roller-cluster").evaluate((cluster, ids) => {
      const buttons = ids.map((id) => cluster.querySelector<HTMLElement>(`[data-testid="${id}"]`)!);
      const centers = buttons.map((button) => button.offsetLeft + button.offsetWidth / 2);
      return {
        clientWidth: cluster.clientWidth,
        scrollWidth: cluster.scrollWidth,
        centerGaps: centers.slice(1).map((center, index) => center - centers[index]),
      };
    }, ACTION_IDS);
    for (const gap of layout.centerGaps) expect(gap - 44).toBeGreaterThanOrEqual(2);
    if (width === 320) expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
    else expect(layout.scrollWidth).toBeGreaterThanOrEqual(layout.clientWidth);

    await page.getByTestId("roller-cluster").evaluate((cluster) => { cluster.scrollLeft = cluster.scrollWidth; });
    const wheelAfter = await page.getByTestId("roller-symbol").boundingBox();
    expect(wheelAfter).not.toBeNull();
    expect(wheelAfter!.x).toBeCloseTo(wheelBefore!.x, 1);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0);
  });
}

test("MM-007: actual edge taps activate Draw, More and Share, and drawing history enables Undo/Redo", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Touch activation proof runs in touch projects.");
  await openTerminal(page, 390);

  await tapActionEdge(page, "roller-draw", "left");
  await expect(page.getByRole("dialog", { name: "Drawings" })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Drawings" })).toBeHidden();

  await tapActionEdge(page, "roller-more", "right");
  await expect(page.getByTestId("analysis-hub")).toBeVisible({ timeout: 20_000 });
  await page.locator(".mhub-close").click({ timeout: 20_000 });
  await expect(page.getByTestId("analysis-hub")).toBeHidden();

  await tapActionEdge(page, "roller-share", "right");
  await expect.poll(() => page.evaluate(() => (window as TouchWindow).__mmShareCount ?? 0)).toBe(1);

  await expect(page.getByTestId("roller-undo")).toBeDisabled();
  await expect(page.getByTestId("roller-redo")).toBeDisabled();
  await page.getByTestId("roller-draw").click({ timeout: 20_000 });
  await page.getByTestId("drawings-tile-trendline").click({ timeout: 20_000 });
  const layer = page.locator(".pane.on .drawing-layer");
  await expect(layer).toBeVisible();
  await dragDrawing(page, layer);
  await expect(page.getByTestId("roller-undo")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("roller-undo").click({ timeout: 20_000 });
  await expect(page.getByTestId("roller-redo")).toBeEnabled({ timeout: 20_000 });
});


const SEASONALITY_INTEL = {
  symbol: "NVDA",
  cards: { ai_judgment: { verdict: "HOLD", gloss: "fixture research context" } },
  tape: { ai_lean: { dir: "NEUTRAL" } },
};

async function openSeasonality(page: Page, width = 390, height = 844) {
  // The default responsive fixture intentionally has OHLC but no Intel artifact. StockAnalysis
  // drops its injected `beforeIv` slot in that empty branch, so give this component-focused suite
  // the smallest accepted Intel payload and keep production composition outside Session C scope.
  await page.route(/\/data\/NVDA\.intel\.json(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(SEASONALITY_INTEL),
  }));
  await openChart(page, width, height);
  const card = page.getByTestId("seasonality-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible({ timeout: 20_000 });
  return card;
}

async function touchCenter(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function switchLanguage(page: Page, lang: "en" | "zh") {
  await page.evaluate((next) => {
    localStorage.setItem("mm.lang", next);
    document.documentElement.setAttribute("data-lang", next);
    window.dispatchEvent(new CustomEvent("mm:lang"));
  }, lang);
}

function sparseSeasonalityPayload() {
  const bars: [string, number, number, number, number, number][] = [];
  let close = 100;
  for (const month of [1, 2]) {
    for (let day = 1; day <= 20; day += 1) {
      close += month === 1 ? 0.4 : -0.2;
      const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      bars.push([date, close - 0.5, close + 1, close - 1, close, 1_000_000 + day]);
    }
  }
  return { t: "NVDA", o: 1, src: "session-c", bar_quality: "real_ohlc", bars };
}

test("MM-008: touch, selector and keyboard expose visible English month detail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Touch interaction proof runs in touch projects.");
  const card = await openSeasonality(page);
  const detail = card.getByTestId("seasonality-detail");
  const april = card.getByTestId("seasonality-month-3");
  const may = card.getByTestId("seasonality-month-4");
  await expect(card.locator('button[data-testid^="seasonality-month-"]')).toHaveCount(12);

  const aprilTitle = await april.getAttribute("title");
  expect(aprilTitle).toMatch(/^Apr · [+-]?\d+\.\d% avg · WR \d+% · n=\d+$/);
  await touchCenter(page, april);
  await expect(detail).toHaveText(aprilTitle!);
  await expect(april).toHaveAttribute("aria-pressed", "true");

  const selector = card.getByTestId("seasonality-month-select");
  expect((await selector.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await selector.selectOption("4");
  const mayTitle = await may.getAttribute("title");
  await expect(detail).toHaveText(mayTitle!);

  await may.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(april).toBeFocused();
  await expect(detail).toHaveText(aprilTitle!);
  await page.keyboard.press("Home");
  await expect(card.getByTestId("seasonality-month-0")).toBeFocused();
  await page.keyboard.press("End");
  await expect(card.getByTestId("seasonality-month-11")).toBeFocused();

  expect(await card.locator('button[data-testid^="seasonality-month-"]').evaluateAll((buttons) =>
    buttons.filter((button) => (button as HTMLElement).tabIndex === 0).length)).toBe(1);
  await expect(card.getByTestId("seasonality-context")).not.toContainText("hover a bar");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
});

test("MM-008: live Chinese locale preserves values and translated semantics", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Touch interaction proof runs in touch projects.");
  const card = await openSeasonality(page);
  await switchLanguage(page, "zh");
  await expect(card).toContainText("季节性 · 月均收益");

  const september = card.getByTestId("seasonality-month-8");
  const title = await september.getAttribute("title");
  expect(title).toContain("均值");
  expect(title).toContain("胜率");
  expect(title).not.toContain(" avg ");
  expect(title).not.toContain(" WR ");
  await touchCenter(page, september);
  await expect(card.getByTestId("seasonality-detail")).toHaveText(title!);
  await expect(card.getByTestId("seasonality-month-select").locator("option").nth(8)).toContainText("月");
  await expect(card.getByTestId("seasonality-context")).not.toContainText("悬停");
});

test("MM-008: sparse history announces an understandable no-samples state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Touch interaction proof runs in touch projects.");
  await page.route(/\/data\/NVDA\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sparseSeasonalityPayload()),
    });
  });
  const card = await openSeasonality(page);
  const january = card.getByTestId("seasonality-month-0");
  const february = card.getByTestId("seasonality-month-1");
  const februaryTitle = await february.getAttribute("title");
  expect(februaryTitle).toMatch(/^Feb · -\d+\.\d% avg · WR 0% · n=1$/);
  await expect(february.locator('[data-direction="down"]')).toBeVisible();
  await touchCenter(page, february);
  await expect(card.getByTestId("seasonality-detail")).toHaveText(februaryTitle!);

  const englishTitle = await january.getAttribute("title");
  expect(englishTitle).toBe("Jan · no samples");
  await touchCenter(page, january);
  await expect(card.getByTestId("seasonality-detail")).toHaveText(englishTitle!);
  await expect(card.getByTestId("seasonality-detail")).not.toContainText("0%");

  await switchLanguage(page, "zh");
  const chineseTitle = await january.getAttribute("title");
  expect(chineseTitle).toContain("无样本");
  await expect(card.getByTestId("seasonality-detail")).toHaveText(chineseTitle!);
});

test("MM-008: desktop hover keeps the native title and visible detail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop hover proof runs once.");
  const card = await openSeasonality(page, 1440, 900);
  const october = card.getByTestId("seasonality-month-9");
  const title = await october.getAttribute("title");
  await october.hover();
  await expect(card.getByTestId("seasonality-detail")).toHaveText(title!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
});
