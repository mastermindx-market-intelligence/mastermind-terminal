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

async function adjacentGapMetrics(page: Page, leftId: string, rightId: string) {
  const ids = { leftId, rightId };
  await page.getByTestId("roller-cluster").evaluate((cluster, pair) => {
    const left = cluster.querySelector<HTMLElement>(`[data-testid="${pair.leftId}"]`);
    const right = cluster.querySelector<HTMLElement>(`[data-testid="${pair.rightId}"]`);
    if (!left || !right) throw new Error(`missing adjacent actions ${pair.leftId}/${pair.rightId}`);
    const leftCenter = left.offsetLeft + left.offsetWidth / 2;
    const rightCenter = right.offsetLeft + right.offsetWidth / 2;
    cluster.scrollLeft = (leftCenter + rightCenter) / 2 - cluster.clientWidth / 2;
  }, ids);
  await page.waitForTimeout(50);
  return page.evaluate((pair) => {
    const left = document.querySelector<HTMLElement>(`[data-testid="${pair.leftId}"]`);
    const right = document.querySelector<HTMLElement>(`[data-testid="${pair.rightId}"]`);
    if (!left || !right) throw new Error(`missing adjacent actions ${pair.leftId}/${pair.rightId}`);
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    const x = (leftRect.right + rightRect.left) / 2;
    const y = (leftRect.top + leftRect.bottom) / 2;
    const owner = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>("button")?.dataset.testid ?? null;
    return { gap: rightRect.left - leftRect.right, owner };
  }, ids);
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

    const [symbolBefore, intervalBefore] = await Promise.all([
      page.getByTestId("roller-symbol").boundingBox(),
      page.getByTestId("roller-interval").boundingBox(),
    ]);
    expect(symbolBefore).not.toBeNull();
    expect(intervalBefore).not.toBeNull();

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

    for (let index = 1; index < ACTION_IDS.length; index += 1) {
      const leftId = ACTION_IDS[index - 1];
      const rightId = ACTION_IDS[index];
      const midpoint = await adjacentGapMetrics(page, leftId, rightId);
      expect(midpoint.gap, `${leftId}/${rightId} should retain a real dead gap`).toBeGreaterThanOrEqual(2);
      expect([leftId, rightId], `${leftId}/${rightId} must not share their midpoint`).not.toContain(midpoint.owner);
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
    const [symbolAfter, intervalAfter] = await Promise.all([
      page.getByTestId("roller-symbol").boundingBox(),
      page.getByTestId("roller-interval").boundingBox(),
    ]);
    expect(symbolAfter).not.toBeNull();
    expect(intervalAfter).not.toBeNull();
    expect(symbolAfter!.x).toBeCloseTo(symbolBefore!.x, 1);
    expect(intervalAfter!.x).toBeCloseTo(intervalBefore!.x, 1);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0);
  });
}

test("MM-007: keyboard focus remains visibly contained inside the clipped action cluster", async ({ page }) => {
  await openTerminal(page, 390);
  await centerAction(page, "roller-draw");
  const draw = page.getByTestId("roller-draw");
  await draw.focus();
  await expect(draw).toBeFocused();

  const indicators = await draw.evaluate((button) => {
    const cluster = button.closest<HTMLElement>('[data-testid="roller-cluster"]');
    if (!cluster) throw new Error("missing roller cluster");
    const clip = cluster.getBoundingClientRect();
    return [button, ...button.querySelectorAll<HTMLElement>("*")].flatMap((element) => {
      const style = getComputedStyle(element);
      const width = Number.parseFloat(style.outlineWidth) || 0;
      if (width <= 0 || style.outlineStyle === "none") return [];
      const offset = Math.max(0, Number.parseFloat(style.outlineOffset) || 0);
      const expansion = width + offset;
      const rect = element.getBoundingClientRect();
      return [{
        testMarker: element.getAttribute("data-roller-visual") ?? element.getAttribute("data-testid") ?? element.tagName,
        fitsClip: rect.top - expansion >= clip.top
          && rect.bottom + expansion <= clip.bottom
          && rect.left - expansion >= clip.left
          && rect.right + expansion <= clip.right,
      }];
    });
  });

  expect(indicators, "the focused action needs one fully visible focus indicator").toContainEqual({
    testMarker: "true",
    fitsClip: true,
  });
});

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
  const tablet = testInfo.project.name === "tablet";
  const card = await openSeasonality(page, tablet ? 820 : 390, tablet ? 1180 : 844);
  const detail = card.getByTestId("seasonality-detail");
  const april = card.getByTestId("seasonality-month-3");
  const may = card.getByTestId("seasonality-month-4");
  const plot = card.getByRole("radiogroup", { name: "Seasonality · avg monthly return" });
  await expect(plot.getByRole("radio")).toHaveCount(12);

  const aprilTitle = await april.getAttribute("title");
  expect(aprilTitle).toMatch(/^Apr · [+-]?\d+\.\d% avg · WR \d+% · n=\d+$/);
  await touchCenter(page, april);
  await expect(detail).toHaveText(aprilTitle!);
  await expect(april).toHaveAttribute("role", "radio");
  await expect(april).toHaveAttribute("aria-checked", "true");
  await expect(april).not.toHaveAttribute("aria-pressed", /.+/);

  const selector = card.getByTestId("seasonality-month-select");
  const [plotLabel, selectorLabel] = await Promise.all([
    plot.getAttribute("aria-label"),
    selector.getAttribute("aria-label"),
  ]);
  expect(selectorLabel).toBe("Seasonality · avg monthly return · Jan–Dec");
  expect(selectorLabel).not.toBe(plotLabel);
  const selectorBox = await selector.boundingBox();
  const detailBox = await detail.boundingBox();
  expect(selectorBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(selectorBox!.height).toBeGreaterThanOrEqual(44);
  expect(detailBox!.height).toBeGreaterThanOrEqual(44);
  await selector.selectOption("4");
  const mayTitle = await may.getAttribute("title");
  await expect(detail).toHaveText(mayTitle!);
  await expect(selector).toHaveAttribute("aria-label", "Seasonality · avg monthly return · Jan–Dec");

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

  const context = card.getByTestId("seasonality-context");
  await expect(context).toHaveText("Current month highlighted · from NVDA history (display-only context).");
  await expect(context).not.toContainText("hover a bar");
  const contextGap = await context.evaluate((node) => {
    const controls = node.previousElementSibling;
    if (!(controls instanceof HTMLElement)) throw new Error("missing seasonality detail controls");
    const controlsRect = controls.getBoundingClientRect();
    return node.getBoundingClientRect().top - controlsRect.bottom;
  });
  expect(contextGap, "source and freshness context should remain visually separated from the selector detail").toBeGreaterThanOrEqual(8);
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
  const selector = card.getByTestId("seasonality-month-select");
  await expect(selector.locator("option").nth(8)).toContainText("月");
  await expect(selector).toHaveAttribute("aria-label", "季节性 · 月均收益 · 1月–12月");
  await expect(card.getByTestId("seasonality-context"))
    .toHaveText("高亮为当前月份 · 基于 NVDA 历史（仅供参考）。");
  await expect(card.getByTestId("seasonality-context")).not.toContainText("悬停");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
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

test("MM-008: 390x568 short-height keeps the selector and visible detail reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Short-height phone stress runs once.");
  const card = await openSeasonality(page, 390, 568);
  const selector = card.getByTestId("seasonality-month-select");
  const detail = card.getByTestId("seasonality-detail");
  await selector.scrollIntoViewIfNeeded();
  const [selectorBox, detailBox] = await Promise.all([selector.boundingBox(), detail.boundingBox()]);
  expect(selectorBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(selectorBox!.height).toBeGreaterThanOrEqual(44);
  expect(detailBox!.height).toBeGreaterThanOrEqual(44);
  expect(selectorBox!.y).toBeGreaterThanOrEqual(0);
  expect(detailBox!.y).toBeGreaterThanOrEqual(0);
  expect(Math.max(selectorBox!.y + selectorBox!.height, detailBox!.y + detailBox!.height)).toBeLessThanOrEqual(568);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
});

test("MM-008: desktop hover keeps native titles without overwriting the chosen month", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop hover proof runs once.");
  const card = await openSeasonality(page, 1440, 900);
  const selector = card.getByTestId("seasonality-month-select");
  const september = card.getByTestId("seasonality-month-8");
  const october = card.getByTestId("seasonality-month-9");
  await selector.selectOption("8");
  const septemberTitle = await september.getAttribute("title");
  const octoberTitle = await october.getAttribute("title");
  expect(octoberTitle).toMatch(/^Oct · [+-]?\d+\.\d% avg · WR \d+% · n=\d+$/);
  await expect(card.getByTestId("seasonality-detail")).toHaveText(septemberTitle!);
  await october.hover();
  await expect(october).toHaveAttribute("title", octoberTitle!);
  await expect(selector).toHaveValue("8");
  await expect(card.getByTestId("seasonality-detail")).toHaveText(septemberTitle!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
});
