import { expect, test, type Locator, type Page } from "@playwright/test";

const PHONE_WIDTHS = [320, 360, 390, 430] as const;
const ACTION_IDS = ["roller-draw", "roller-more", "roller-undo", "roller-redo", "roller-share"] as const;

type TouchWindow = Window & {
  __mmPhoneReady?: boolean;
  __mmShareCount?: number;
};

async function openTerminal(page: Page, width: number, height = 844) {
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

test("MM-007: actual edge taps activate Draw, More and Share, and drawing history enables Undo/Redo", async ({ page }) => {
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
