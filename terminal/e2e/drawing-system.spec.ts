import { expect, test, type Locator, type Page } from "@playwright/test";
import { DRAWING_TOOL_REGISTRY } from "../lib/drawingTools";
import { PHONE_MAX } from "./phoneChrome";
import { chooseToolbarSplit, runToolbarDetector, toggleToolbarReplay } from "./terminalToolbar";

// R2.1 retired the floating drawing dock on the PHONE (≤640px): the roller strip's pencil raises
// the Drawings sheet instead. Dock contracts therefore run at the tablet and desktop projects,
// where the dock still ships; the phone's own chrome is covered by mobile-chart-chrome.spec.ts
// and by the collision test below.
const SKIP_PHONE = "The phone has no floating dock since R2.1 — see mobile-chart-chrome.spec.ts.";
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) <= PHONE_MAX;

// Allows this suite to target an already-running same-worktree server when another
// local Next process owns the shared dev lock. The repository Playwright config
// remains the default in CI and normal `npm run test:e2e:responsive` runs.
const externalViewportMatch = process.env.DRAWING_E2E_VIEWPORT?.match(/^(\d+)x(\d+)$/);
if (process.env.DRAWING_E2E_BASE_URL || externalViewportMatch) {
  test.use({
    ...(process.env.DRAWING_E2E_BASE_URL
      ? { baseURL: process.env.DRAWING_E2E_BASE_URL }
      : {}),
    ...(externalViewportMatch
      ? {
          viewport: {
            width: Number(externalViewportMatch[1]),
            height: Number(externalViewportMatch[2]),
          },
        }
      : {}),
  });
}

/** OpenMarket's documented nine families and 99 tools, in product order. */
const TOOL_GROUPS = [
  {
    id: "lines",
    tools: [
      "trendline", "ray", "infoline", "extendedline", "trendangle", "hline",
      "horizontalray", "vline", "crossline", "channel", "regressiontrend",
      "flattopbottom", "disjointchannel", "pitchfork", "schiffpitchfork",
      "modifiedschiffpitchfork", "insidepitchfork",
    ],
  },
  {
    id: "fibonacci",
    tools: [
      "fib", "fibtrend", "fibchannel", "fibtimezone", "fibspeedresistancefan",
      "trendbasedfibtime", "fibcircles", "fibspiral", "fibspeedresistancearcs",
      "fibwedge", "pitchfan", "gannbox", "gannsquarefixed", "gannsquare", "gannfan",
    ],
  },
  {
    id: "patterns",
    tools: [
      "xabcd", "cypher", "headandshoulders", "abcd", "trianglepattern", "threedrives",
      "elliottimpulse", "elliottcorrection", "elliotttriangle", "elliottdoublecombo",
      "elliotttriplecombo", "cycliclines", "timecycles", "sineline",
    ],
  },
  {
    id: "forecasting",
    tools: [
      "longposition", "shortposition", "forecast", "ghostfeed", "barpattern", "sector",
      "anchoredvwap", "fixedrangevolumeprofile", "pricerange", "daterange",
      "dateandpricerange", "measure",
    ],
  },
  { id: "freehand", tools: ["brush", "highlighter", "path"] },
  {
    id: "shapes",
    tools: [
      "rect", "rotatedrect", "ellipse", "circle", "triangle", "polyline", "arc",
      "curve", "doublecurve",
    ],
  },
  {
    id: "arrows",
    tools: [
      "arrowmarker", "arrow", "arrowmarkleft", "arrowmarkright", "arrowmarktop",
      "arrowmarkbottom", "flagmark", "momentum", "flow", "emphasis", "whisper",
      "subtle", "divergence", "journey", "fork", "threepaths", "burj",
    ],
  },
  {
    id: "annotation",
    tools: [
      "text", "anchoredtext", "note", "anchorednote", "callout", "pricelabel",
      "pricenote", "signpost", "comment", "image",
    ],
  },
  { id: "emoji", tools: ["emoji", "icon"] },
] as const;

const TOOL_COUNT = 99;

const CHART_TYPES = [
  "Candles",
  "Hollow candles",
  "Heikin Ashi",
  "Bars",
  "Line",
  "Line with markers",
  "Step line",
  "Area",
  "Baseline",
] as const;

type DrawingSavePayload = {
  drawings?: Array<{
    id?: string;
    kind?: string;
    color?: string;
    fillColor?: string;
    width?: number;
    dash?: string;
    opacity?: number;
    locked?: boolean;
    text?: string;
    meta?: Record<string, unknown>;
    points?: unknown[];
  }>;
};

async function openTerminal(
  page: Page,
  options: { drawings?: unknown[]; onPut?: (payload: DrawingSavePayload) => void } = {},
) {
  await page.route("**/api/drawings**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ drawings: options.drawings ?? [] }),
      });
      return;
    }
    try { options.onPut?.(route.request().postDataJSON()); } catch {}
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.addInitScript(() => {
    localStorage.removeItem("mm.ct");
    localStorage.removeItem("mm.draw");
    localStorage.removeItem("mm.drawing.preferences");
    const readyWindow = window as Window & { __mmDrawingSystemReady?: boolean };
    readyWindow.__mmDrawingSystemReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmDrawingSystemReady = true;
    }, { once: true });
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await expect.poll(
    () => page.evaluate(() =>
      Boolean((window as Window & { __mmDrawingSystemReady?: boolean }).__mmDrawingSystemReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 15_000 },
  ).toBe(true);
  await expect(page.locator(".pane.on .drawing-layer")).toBeVisible();
}

async function selectMagnet(page: Page, mode: "off" | "weak" | "strong") {
  const trigger = page.getByTestId("drawing-magnet-trigger");
  await page.getByTestId("drawing-magnet-menu-trigger").click();
  const menu = page.getByTestId("drawing-magnet-menu");
  await expect(menu).toBeVisible();
  await menu.getByTestId(`drawing-magnet-${mode}`).click();
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("data-magnet-mode", mode);
}

function chartTypeButton(catalog: Locator, name: string): Locator {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return catalog.getByRole("button", { name: new RegExp(`^${escapedName}(?: ✓)?$`) });
}

async function dragDrawing(
  page: Page,
  layer: Locator,
  start: { x: number; y: number },
  end: { x: number; y: number },
  stepPauseMs = 0,
) {
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * start.x, box!.y + box!.height * start.y);
  await page.mouse.down();
  if (stepPauseMs > 0) {
    for (let step = 1; step <= 8; step += 1) {
      const progress = step / 8;
      await page.mouse.move(
        box!.x + box!.width * (start.x + (end.x - start.x) * progress),
        box!.y + box!.height * (start.y + (end.y - start.y) * progress),
      );
      await page.waitForTimeout(stepPauseMs);
    }
  } else {
    await page.mouse.move(
      box!.x + box!.width * end.x,
      box!.y + box!.height * end.y,
      { steps: 8 },
    );
  }
  await page.mouse.up();
}

async function expectChartLocal(
  page: Page,
  surface: Locator,
  options: { directChild?: boolean; clearOfDetails?: boolean } = {},
) {
  await expect(surface).toBeVisible();
  const metrics = await surface.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const chartBody = element.closest(".chart-body")
      ?? (element.parentElement?.classList.contains("chart-body") ? element.parentElement : null)
      ?? document.querySelector(".chart-body");
    const bodyRect = chartBody?.getBoundingClientRect();
    const details = document.querySelector(".detail-board");
    const detailRect = details?.getBoundingClientRect();
    return {
      directChartBodyChild: element.parentElement?.classList.contains("chart-body") === true,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      bodyLeft: bodyRect?.left ?? Number.NaN,
      bodyTop: bodyRect?.top ?? Number.NaN,
      bodyRight: bodyRect?.right ?? Number.NaN,
      bodyBottom: bodyRect?.bottom ?? Number.NaN,
      detailTop: detailRect && detailRect.height > 0 ? detailRect.top : null,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  if (options.directChild) expect(metrics.directChartBodyChild).toBe(true);
  expect(metrics.left).toBeGreaterThanOrEqual(metrics.bodyLeft - 1);
  expect(metrics.top).toBeGreaterThanOrEqual(metrics.bodyTop - 1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.bodyRight + 1);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.bodyBottom + 1);
  expect(metrics.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.top).toBeGreaterThanOrEqual(-1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  if (options.clearOfDetails && metrics.detailTop !== null) {
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.detailTop + 1);
  }
  return metrics;
}

async function expectNoDocumentOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))).toEqual({
    scrollWidth: page.viewportSize()?.width,
    clientWidth: page.viewportSize()?.width,
  });
}

test("drawing registry and precision controls stay complete at every responsive width", async ({ page }) => {
  test.skip(isPhone(page), SKIP_PHONE);
  await openTerminal(page);

  const toolbar = page.getByTestId("drawing-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveAttribute("role", "toolbar");
  await expect(toolbar).toHaveAttribute("aria-label", "Drawing tools");
  await expect(toolbar.locator("[title]")).toHaveCount(0);

  const canonicalRegistry = DRAWING_TOOL_REGISTRY.map((group) => ({
    id: group.id,
    tools: group.tools.map((tool) => tool.id),
  }));
  expect(canonicalRegistry).toEqual(TOOL_GROUPS.map((group) => ({
    id: group.id,
    tools: [...group.tools],
  })));
  expect(canonicalRegistry.flatMap((group) => group.tools)).toHaveLength(TOOL_COUNT);
  await expect.poll(() => toolbar.locator("[data-group-id]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-group-id")),
  )).toEqual(TOOL_GROUPS.map((group) => group.id));

  const clearOfDetails = page.viewportSize()?.width === 390;
  for (const { id: group, tools: expectedTools } of TOOL_GROUPS) {
    const trigger = page.getByTestId(`drawing-group-${group}-menu-trigger`);
    await trigger.click();
    const menu = page.getByTestId(`drawing-group-${group}-menu`);
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("role", "menu");
    await expect.poll(
      () => menu.locator("[data-tool-id]").evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-tool-id"))),
      { message: `${group} should expose the canonical drawing registry in order` },
    ).toEqual([...expectedTools]);
    expect(await menu.locator("[data-tool-id]").evaluateAll((elements) =>
      elements.every((element) => Boolean(element.textContent?.trim())))).toBe(true);
    await expectChartLocal(page, menu, { directChild: true, clearOfDetails });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  }

  for (const utility of [
    { id: "magnet", triggerId: "drawing-magnet-menu-trigger" },
    { id: "clear", triggerId: "drawing-clear-trigger" },
  ] as const) {
    const trigger = page.getByTestId(utility.triggerId);
    const menu = page.getByTestId(`drawing-${utility.id}-menu`);
    await trigger.click();
    await expect(menu).toBeVisible();
    await expectChartLocal(page, menu, { directChild: true, clearOfDetails });
    if (utility.id === "clear") {
      await expect(menu.getByRole("menuitem")).toHaveCount(5);
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  }

  // Menu focus stays within the toolbar's logical order on both rail and dock layouts.
  const linesTrigger = page.getByTestId("drawing-group-lines-menu-trigger");
  const linesMenu = page.getByTestId("drawing-group-lines-menu");
  const lineTool = page.getByTestId("drawing-group-lines-main");
  const nextLogicalControl = page.getByTestId("drawing-group-fibonacci-main");
  await linesTrigger.click();
  await expect(linesMenu).toBeVisible();
  await expect(page.getByTestId("drawing-tool-trendline")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(linesMenu).toBeHidden();
  await expect(nextLogicalControl).toBeFocused();
  await linesTrigger.click();
  await expect(page.getByTestId("drawing-tool-trendline")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(linesMenu).toBeHidden();
  await expect(lineTool).toBeFocused();

  const magnetTrigger = page.getByTestId("drawing-magnet-trigger");
  await expect(magnetTrigger).toHaveAttribute("data-magnet-mode", "off");
  await magnetTrigger.click();
  await expect(magnetTrigger).toHaveAttribute("data-magnet-mode", "weak");
  await magnetTrigger.click();
  await expect(magnetTrigger).toHaveAttribute("data-magnet-mode", "off");
  await selectMagnet(page, "weak");
  await selectMagnet(page, "strong");
  await selectMagnet(page, "off");

  await lineTool.click();
  await expect(lineTool).toHaveAttribute("data-tool-id", "trendline");
  await expect(lineTool).toHaveAttribute("aria-pressed", "true");

  const palette = page.getByTestId("drawing-style-palette");
  const isCompact = (page.viewportSize()?.width ?? 1440) <= 860;
  if (isCompact) {
    const styleTrigger = page.getByTestId("drawing-style-trigger");
    await expect(styleTrigger).toBeVisible();
    await expect(palette).toBeHidden();
    await styleTrigger.click();
    await expect(palette).toBeVisible();
    await expectChartLocal(page, palette, { directChild: true, clearOfDetails });
  } else {
    await expect(palette).toBeVisible();
  }

  const red = page.getByTestId("drawing-style-color-2");
  const wide = page.getByTestId("drawing-style-width-4");
  const dotted = page.getByTestId("drawing-style-dash-dotted");
  await red.click();
  await wide.click();
  await dotted.click();
  await expect(red).toHaveAttribute("aria-pressed", "true");
  await expect(wide).toHaveAttribute("aria-pressed", "true");
  await expect(dotted).toHaveAttribute("aria-pressed", "true");

  if (isCompact) {
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(page.getByTestId("drawing-style-trigger")).toBeFocused();
  }

  await page.getByTestId("drawing-tool-cursor").click();
  await expect(page.getByTestId("drawing-tool-cursor")).toHaveAttribute("aria-pressed", "true");
  await expect(palette).toBeHidden();
  if (page.viewportSize()?.width === 390) {
    await expectChartLocal(page, toolbar, { directChild: true, clearOfDetails: true });
    await expectNoDocumentOverflow(page);
  }
});

test("desktop drawing labels and hover flyouts match the OpenMarket interaction contract", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 1440) <= 860,
    "Hover labels and delayed flyouts are a fine-pointer contract.",
  );
  await openTerminal(page);

  const toolbar = page.getByTestId("drawing-toolbar");
  await expect(toolbar.locator("[title]")).toHaveCount(0);

  const mainTool = page.getByTestId("drawing-group-lines-main");
  await mainTool.hover();
  const mainTip = page.getByRole("tooltip").filter({ hasText: "Trend Line" });
  await expect(mainTip).toBeVisible();
  await expect(mainTip).toContainText("Alt+T");
  await expect(mainTip).toContainText("Double-click to keep active");

  const clearTrigger = page.getByTestId("drawing-clear-trigger");
  await clearTrigger.hover();
  await expect(page.getByRole("tooltip").filter({ hasText: "Remove drawings" })).toBeVisible();
  await expect(clearTrigger).not.toHaveAttribute("title", /.+/);

  const chevron = page.getByTestId("drawing-group-lines-menu-trigger");
  const menu = page.getByTestId("drawing-group-lines-menu");
  await chevron.focus();
  await expect(page.getByRole("tooltip").filter({ hasText: /^Open / })).toHaveCount(0);
  await page.getByTestId("drawing-magnet-menu-trigger").focus();
  await expect(page.getByRole("tooltip").filter({ hasText: "Open magnet modes" })).toHaveCount(0);
  await page.evaluate(() => {
    const timedWindow = window as Window & {
      __mmDrawingHoverTiming?: { enteredAt: number | null; openedAfter: number | null };
    };
    const timing = { enteredAt: null as number | null, openedAfter: null as number | null };
    timedWindow.__mmDrawingHoverTiming = timing;
    const trigger = document.querySelector('[data-testid="drawing-group-lines-menu-trigger"]');
    trigger?.addEventListener("pointerenter", () => { timing.enteredAt = performance.now(); }, { once: true });
    const observer = new MutationObserver(() => {
      if (timing.enteredAt === null) return;
      if (!document.querySelector('[data-testid="drawing-group-lines-menu"]')) return;
      timing.openedAfter = performance.now() - timing.enteredAt;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await chevron.hover();
  await expect(menu).toBeVisible({ timeout: 1_200 });
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __mmDrawingHoverTiming?: { openedAfter: number | null } }
  ).__mmDrawingHoverTiming?.openedAfter ?? null)).not.toBeNull();
  const openAfter = await page.evaluate(() => (
    window as Window & { __mmDrawingHoverTiming?: { openedAfter: number | null } }
  ).__mmDrawingHoverTiming?.openedAfter ?? 0);
  expect(openAfter).toBeGreaterThanOrEqual(160);
  expect(openAfter).toBeLessThan(1_000);
  await expectChartLocal(page, menu, { directChild: true });

  await page.evaluate(() => {
    const timedWindow = window as Window & {
      __mmDrawingLeaveTiming?: {
        leftAt: number | null;
        closingAfter: number | null;
        hiddenAfter: number | null;
      };
    };
    const timing = { leftAt: null as number | null, closingAfter: null as number | null, hiddenAfter: null as number | null };
    timedWindow.__mmDrawingLeaveTiming = timing;
    const host = document.querySelector('[data-testid="drawing-group-lines"]');
    const menuElement = document.querySelector('[data-testid="drawing-group-lines-menu"]');
    host?.addEventListener("pointerleave", () => { timing.leftAt = performance.now(); }, { once: true });
    const observer = new MutationObserver(() => {
      if (timing.leftAt === null || !menuElement) return;
      if (timing.closingAfter === null && menuElement.getAttribute("data-state") === "closing") {
        timing.closingAfter = performance.now() - timing.leftAt;
      }
      if (!menuElement.isConnected) {
        timing.hiddenAfter = performance.now() - timing.leftAt;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-state"], childList: true, subtree: true });
  });
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width - 4, 4);
  await expect(menu).toBeHidden({ timeout: 2_000 });
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __mmDrawingLeaveTiming?: { hiddenAfter: number | null } }
  ).__mmDrawingLeaveTiming?.hiddenAfter ?? null)).not.toBeNull();
  const leaveTiming = await page.evaluate(() => (
    window as Window & {
      __mmDrawingLeaveTiming?: { closingAfter: number | null; hiddenAfter: number | null };
    }
  ).__mmDrawingLeaveTiming);
  expect(leaveTiming?.closingAfter).not.toBeNull();
  expect(leaveTiming!.closingAfter!).toBeGreaterThanOrEqual(120);
  expect(leaveTiming!.hiddenAfter!).toBeGreaterThanOrEqual(260);
  expect(leaveTiming!.hiddenAfter! - leaveTiming!.closingAfter!).toBeGreaterThanOrEqual(120);
});

test("favorite drawing tools are keyboard-reachable, draggable, responsive, and persistent", async ({ page }) => {
  test.skip(isPhone(page), SKIP_PHONE);
  await openTerminal(page);

  const compact = (page.viewportSize()?.width ?? 1440) <= 860;
  const clearOfDetails = page.viewportSize()?.width === 390;
  const trigger = page.getByTestId("drawing-group-lines-menu-trigger");
  await trigger.click();
  await expect(page.getByTestId("drawing-tool-trendline")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const star = page.getByTestId("drawing-favorite-trendline");
  await expect(star).toBeFocused();
  await expect(star).toHaveAttribute("role", "menuitemcheckbox");
  await page.keyboard.press("Enter");
  await expect(star).toHaveAttribute("aria-checked", "true");

  const strip = page.getByTestId("drawing-favorites-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute("data-favorite-count", "1");
  await expectChartLocal(page, strip, { directChild: true, clearOfDetails });
  await expectNoDocumentOverflow(page);

  await page.keyboard.press("Escape");
  const favoriteTool = page.getByTestId("drawing-favorite-tool-trendline");
  await favoriteTool.click();
  await expect(page.getByTestId("drawing-group-lines-main")).toHaveAttribute("aria-pressed", "true");

  const grip = page.getByTestId("drawing-favorites-grip");
  const gripBox = await grip.boundingBox();
  expect(gripBox).not.toBeNull();
  const leftBefore = await strip.evaluate((element) => Number.parseFloat((element as HTMLElement).style.left));
  await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    gripBox!.x + gripBox!.width / 2 + (compact ? 42 : 118),
    gripBox!.y + gripBox!.height / 2 + 18,
    { steps: 6 },
  );
  await page.mouse.up();
  const leftAfter = await strip.evaluate((element) => Number.parseFloat((element as HTMLElement).style.left));
  expect(leftAfter).toBeGreaterThan(leftBefore + 20);

  const favoriteMode = compact ? "compact" : "desktop";
  await expect.poll(() => page.evaluate((mode) => {
    const value = JSON.parse(localStorage.getItem("mm.drawing.favorites.v1") || "{}");
    return value.positions?.[mode]?.x;
  }, favoriteMode)).toBe(leftAfter);
  const storedPosition = await page.evaluate((mode) => {
    const value = JSON.parse(localStorage.getItem("mm.drawing.favorites.v1") || "{}");
    return value.positions?.[mode] as { x: number; y: number } | undefined;
  }, favoriteMode);
  expect(storedPosition).toBeDefined();

  // The rail star is the explicit show/hide control, and right-clicking the
  // floating strip provides the documented fast hide action.
  const stripToggle = page.getByTestId("drawing-favorites-toggle");
  await stripToggle.click();
  await expect(strip).toBeHidden();
  await expect(stripToggle).toHaveAttribute("data-favorites-visible", "false");
  await stripToggle.click();
  await expect(strip).toBeVisible();
  await strip.click({ button: "right" });
  await expect(strip).toBeHidden();
  await stripToggle.click();
  await expect(strip).toBeVisible();

  await page.reload();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  const restored = page.getByTestId("drawing-favorites-strip");
  await expect(restored).toBeVisible();
  await expect(page.getByTestId("drawing-favorites-toggle")).toHaveAttribute("data-favorite-count", "1");
  await expect.poll(() => restored.evaluate((element) => Number.parseFloat((element as HTMLElement).style.left))).toBe(storedPosition!.x);
  await expectChartLocal(page, restored, { directChild: true, clearOfDetails });
  await expectNoDocumentOverflow(page);

  await page.getByTestId("drawing-group-lines-menu-trigger").click();
  const restoredStar = page.getByTestId("drawing-favorite-trendline");
  await restoredStar.click();
  await expect(restoredStar).toHaveAttribute("aria-checked", "false");
  await expect(restored).toBeHidden();
  await expect(page.getByTestId("drawing-favorites-toggle")).toHaveAttribute("data-favorite-count", "0");
});

test("portalled drawing surfaces honor reduced motion and keep focus across the mobile breakpoint", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 1440) <= 860,
    "The breakpoint transition starts from the desktop drawing rail.",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTerminal(page);

  const toolbar = page.getByTestId("drawing-toolbar");
  const lineTool = page.getByTestId("drawing-group-lines-main");
  const linesTrigger = page.getByTestId("drawing-group-lines-menu-trigger");
  const linesMenu = page.getByTestId("drawing-group-lines-menu");
  await linesTrigger.click();
  await expect(linesMenu).toBeVisible();
  await expect(page.getByTestId("drawing-tool-trendline")).toBeFocused();
  expect(await linesMenu.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationName: style.animationName, transitionDuration: style.transitionDuration };
  })).toEqual({ animationName: "none", transitionDuration: "0s" });

  // 820x1180 is the compact-dock breakpoint now: R2.1 removed the dock from the PHONE
  // (≤640px) altogether, so the dock's own responsive remount is a tablet transition.
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(toolbar).toHaveAttribute("aria-orientation", "horizontal");
  await expect(linesMenu).toBeHidden();
  await expect(linesTrigger).toBeFocused();

  await lineTool.click();
  const styleTrigger = page.getByTestId("drawing-style-trigger");
  const palette = page.getByTestId("drawing-style-palette");
  await styleTrigger.click();
  await expect(palette).toBeVisible();
  await expect(page.getByTestId("drawing-style-color-0")).toBeFocused();
  expect(await palette.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationName: style.animationName, transitionDuration: style.transitionDuration };
  })).toEqual({ animationName: "none", transitionDuration: "0s" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(toolbar).toHaveAttribute("aria-orientation", "vertical");
  await expect(styleTrigger).toBeHidden();
  await expect(lineTool).toBeFocused();
});

test("phone drawing chrome keeps one collision-free editing surface", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "The reported regression is pinned to 390\u00d7844.");
  await openTerminal(page);

  const chartBody = page.locator(".chart-body");
  const details = page.locator(".detail-board").first();
  const layer = page.locator(".pane.on .drawing-layer");
  const selectionToolbar = page.getByRole("toolbar", { name: "Selected drawing properties" });
  const lines = layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])');

  // R2.1 — the floating dock (the original source of this collision) is gone from the phone
  // entirely; the roller strip's pencil is the only way to arm a tool here.
  await expect(page.getByTestId("drawing-toolbar")).toBeHidden();
  await expect(page.getByTestId("roller-strip")).toBeVisible();

  // Custom properties mirror iOS landscape safe-area env() values and make the
  // horizontal inset contract deterministic in desktop Chromium CI.
  await chartBody.evaluate((element) => {
    const body = element as HTMLElement;
    body.style.setProperty("--drawing-safe-left", "31px");
    body.style.setProperty("--drawing-safe-right", "27px");
  });
  await expectNoDocumentOverflow(page);
  const initialLayout = await Promise.all([
    chartBody.boundingBox(),
    details.boundingBox(),
  ]);

  await page.getByTestId("roller-draw").click();
  await page.getByTestId("drawings-tile-trendline").click();
  await expect(page.getByRole("dialog", { name: "Drawings" })).toBeHidden();

  // One-shot placement hands the chart back to the cursor and raises the object inspector —
  // which must be the ONLY floating editing surface on screen.
  await dragDrawing(page, layer, { x: 0.25, y: 0.35 }, { x: 0.57, y: 0.52 });
  await expect(lines).toHaveCount(1);
  await expect(page.getByTestId("drawing-tool-cursor")).toHaveAttribute("aria-pressed", "true");
  await expect(selectionToolbar).toBeVisible();
  const inspectorMetrics = await expectChartLocal(page, selectionToolbar, { clearOfDetails: true });
  expect(await page.locator("[data-testid='drawing-style-palette'], .draw-bar").evaluateAll((elements) =>
    elements.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }).length)).toBe(1);
  // …and it never reaches under the fixed roller strip.
  const stripTop = await page.getByTestId("roller-strip").evaluate((element) => element.getBoundingClientRect().top);
  expect(inspectorMetrics.bottom).toBeLessThanOrEqual(stripTop + 1);

  // The settings panel remains a renderer-owned descendant, but its fixed box is
  // clamped to the measured chart host rather than the full viewport. Pin the page at the top
  // before opening it: the inspector rides the chart body, and a scrolled document parks it
  // either under the mobile bar or under the fixed roller strip, where no click can land.
  // Polled because the chart's own late layout work can scroll the document back under us.
  // The inspector is itself a horizontal scroller wider than a phone, so the gear starts off to
  // the right of the viewport; bring both scrollers to rest before asking for a real click.
  const settingsTrigger = selectionToolbar.locator("[data-settings]");
  const viewportWidth = page.viewportSize()?.width ?? 390;
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await settingsTrigger.scrollIntoViewIfNeeded();
    const box = await settingsTrigger.boundingBox();
    const clear = box !== null
      && box.y > 60 && box.y + box.height < 780
      && box.x >= 0 && box.x + box.width <= viewportWidth;
    return clear ? "clear" : "obscured";
  }, { message: "the inspector should settle clear of the mobile bar and the roller strip" })
    .toBe("clear");
  await settingsTrigger.click();
  const settings = selectionToolbar.locator(".draw-settings");
  const settingsMetrics = await expectChartLocal(page, settings, { clearOfDetails: true });
  expect(settingsMetrics.left - settingsMetrics.bodyLeft).toBeGreaterThanOrEqual(31);
  expect(settingsMetrics.bodyRight - settingsMetrics.right).toBeGreaterThanOrEqual(27);
  await settingsTrigger.click();
  await expect(settings).toBeHidden();

  // Raising the Drawings sheet must overlay the page rather than expand it or push the company
  // detail card down (the original mobile breakage, re-asserted against the new surface).
  await page.getByTestId("roller-draw").click();
  await expect(page.getByRole("dialog", { name: "Drawings" })).toBeVisible();
  await expectNoDocumentOverflow(page);
  expect(await Promise.all([chartBody.boundingBox(), details.boundingBox()])).toEqual(initialLayout);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Drawings" })).toBeHidden();
});

test("chart-type catalog exposes and applies the new line and area families", async ({ page }) => {
  test.skip(isPhone(page), SKIP_PHONE);
  await openTerminal(page);

  const popover = page.locator(".chart-type-pop");
  const host = page.locator(".pophost").filter({ has: popover });
  const trigger = host.locator(":scope > button.tbtn");
  await trigger.click();

  const desktop = (page.viewportSize()?.width ?? 1440) > 860;
  const catalog = desktop
    ? popover
    : page.getByRole("dialog", { name: "Chart type" });
  await expect(catalog).toBeVisible();
  for (const chartType of CHART_TYPES) {
    await expect(chartTypeButton(catalog, chartType)).toBeVisible();
  }

  await chartTypeButton(catalog, "Line with markers").click();
  await expect(catalog).toBeHidden();
  await expect(trigger).toContainText("Line with markers");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();

  await trigger.click();
  const reopenedCatalog = desktop
    ? popover
    : page.getByRole("dialog", { name: "Chart type" });
  await expect(reopenedCatalog).toBeVisible();
  await chartTypeButton(reopenedCatalog, "Baseline").click();
  await expect(reopenedCatalog).toBeHidden();
  await expect(trigger).toContainText("Baseline");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
});

test("drawing lifecycle supports one-shot, sticky, history, visibility, and scoped clear", async ({ page }) => {
  // This deliberately dense contract exercises the complete lifecycle in one
  // browser session. GitHub's two-worker runner can exceed Playwright's 30s
  // default even when the final clear assertion succeeds, so budget the test
  // independently without weakening any action or assertion timeout.
  test.setTimeout(60_000);
  test.skip(
    (page.viewportSize()?.width ?? 1440) <= 860,
    "Pointer lifecycle is covered once on the stable desktop canvas.",
  );
  await openTerminal(page);

  const layer = page.locator(".pane.on .drawing-layer");
  const trendlines = layer.locator('g[data-drawing-kind="trendline"]');
  const lineTool = page.getByTestId("drawing-group-lines-main");
  const cursor = page.getByTestId("drawing-tool-cursor");
  const sticky = page.getByTestId("drawing-sticky-toggle");

  // Secondary mouse input exits an armed tool without creating a drawing.
  await page.getByTestId("drawing-group-lines-menu-trigger").click();
  await page.getByTestId("drawing-tool-hline").click();
  await expect(lineTool).toHaveAttribute("data-tool-id", "hline");
  await expect(lineTool).toHaveAttribute("aria-pressed", "true");
  const rightClickBox = await layer.boundingBox();
  expect(rightClickBox).not.toBeNull();
  await page.mouse.click(
    rightClickBox!.x + rightClickBox!.width * 0.5,
    rightClickBox!.y + rightClickBox!.height * 0.5,
    { button: "right" },
  );
  await expect(layer.locator('g[data-drawing-kind="hline"]')).toHaveCount(0);
  await expect(cursor).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("drawing-group-lines-menu-trigger").click();
  await page.getByTestId("drawing-tool-trendline").press("Enter");
  await expect(lineTool).toHaveAttribute("data-tool-id", "trendline");

  await expect(trendlines).toHaveCount(0);
  await lineTool.click();
  await page.getByTestId("drawing-style-color-2").click();
  await page.getByTestId("drawing-style-width-4").click();
  await page.getByTestId("drawing-style-dash-dotted").click();
  await dragDrawing(page, layer, { x: 0.24, y: 0.34 }, { x: 0.58, y: 0.56 });

  await expect(trendlines).toHaveCount(1);
  await expect(cursor).toHaveAttribute("aria-pressed", "true");
  await expect(lineTool).toHaveAttribute("aria-pressed", "false");
  await expect(sticky).toHaveAttribute("data-sticky", "false");

  const trendline = trendlines.first();
  const visibleStroke = trendline.locator('line:not([stroke="transparent"])').first();
  await expect(visibleStroke).toHaveAttribute("stroke", "#f0566b");
  await expect(visibleStroke).toHaveAttribute("stroke-dasharray", "2 4");
  await expect.poll(
    () => visibleStroke.getAttribute("stroke-width").then((width) => Number(width)),
  ).toBeGreaterThanOrEqual(4);

  const selectionToolbar = page.getByRole("toolbar", { name: "Selected drawing properties" });
  await expect(selectionToolbar).toBeVisible();
  await expect(selectionToolbar.locator("[data-custom-color]")).toBeVisible();
  await expect(selectionToolbar.locator("[data-lock]")).toBeVisible();
  await expect(selectionToolbar.locator("[data-duplicate]")).toBeVisible();
  await expect(selectionToolbar.locator("[data-settings]")).toBeVisible();
  await selectionToolbar.locator("[data-settings]").click();
  await expect(selectionToolbar.locator(".draw-settings")).toBeVisible();
  await selectionToolbar.locator("[data-settings]").click();
  await expect(selectionToolbar.locator(".draw-settings")).toBeHidden();

  const hitStroke = trendline.locator('line[stroke="transparent"]').first();
  const lineGeometry = () => visibleStroke.evaluate((element) =>
    ["x1", "y1", "x2", "y2"].map((attribute) => element.getAttribute(attribute)).join(","));
  const geometryBeforeCancel = await lineGeometry();
  const dragOrigin = await hitStroke.evaluate((element) => {
    const line = element as SVGLineElement;
    const svgRect = line.ownerSVGElement!.getBoundingClientRect();
    const x1 = Number(line.getAttribute("x1"));
    const y1 = Number(line.getAttribute("y1"));
    const x2 = Number(line.getAttribute("x2"));
    const y2 = Number(line.getAttribute("y2"));
    return {
      x: svgRect.left + (x1 + x2) / 2,
      y: svgRect.top + (y1 + y2) / 2,
    };
  });
  const cancelPointerId = 91;
  await hitStroke.dispatchEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: cancelPointerId,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: dragOrigin.x,
    clientY: dragOrigin.y,
  });
  await page.evaluate(({ pointerId, x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x + 84,
      clientY: y + 36,
    }));
  }, { pointerId: cancelPointerId, ...dragOrigin });
  await expect.poll(lineGeometry, {
    message: "a selected drawing should preview its translated geometry during drag",
  }).not.toBe(geometryBeforeCancel);
  await page.evaluate(({ pointerId, x, y }) => {
    window.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: x + 84,
      clientY: y + 36,
    }));
  }, { pointerId: cancelPointerId, ...dragOrigin });
  await expect.poll(lineGeometry, {
    message: "pointercancel should restore the selected drawing's committed geometry",
  }).toBe(geometryBeforeCancel);

  const undo = page.getByTestId("drawing-undo");
  const redo = page.getByTestId("drawing-redo");
  await expect(undo).toBeEnabled();
  // A single undo must remove the original creation. If pointercancel had committed
  // the translated state, this undo would merely restore the original geometry.
  await undo.click();
  await expect(trendlines).toHaveCount(0);
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(trendlines).toHaveCount(1);

  const lockAll = page.getByTestId("drawing-lock-all");
  await expect(lockAll).toBeEnabled();
  await expect(lockAll).toHaveAttribute("data-user-drawing-count", "1");
  await lockAll.click();
  await expect(trendlines.first()).toHaveAttribute("data-locked", "true");
  await expect(lockAll).toHaveAttribute("data-drawings-locked", "true");
  // Global lock is a normal drawing transaction, so history can undo it.
  await undo.click();
  await expect(trendlines.first()).toHaveAttribute("data-locked", "false");
  await redo.click();
  await expect(trendlines.first()).toHaveAttribute("data-locked", "true");
  await lockAll.click();
  await expect(trendlines.first()).toHaveAttribute("data-locked", "false");

  const visibility = page.getByTestId("drawing-visibility-toggle");
  await visibility.click();
  await expect(visibility).toHaveAttribute("data-drawings-visible", "false");
  await expect(trendlines).toHaveCount(0);
  await visibility.click();
  await expect(visibility).toHaveAttribute("data-drawings-visible", "true");
  await expect(trendlines).toHaveCount(1);
  await page.keyboard.press("Control+Alt+H");
  await expect(visibility).toHaveAttribute("data-drawings-visible", "false");
  await expect(trendlines).toHaveCount(0);
  await visibility.click();
  await expect(visibility).toHaveAttribute("data-drawings-visible", "true");
  await expect(trendlines).toHaveCount(1);

  // Replay and multi-chart grids preserve existing objects but retire creation
  // until the single live chart context is restored.
  const drawingToolbar = page.getByTestId("drawing-toolbar");
  await lineTool.click();
  await toggleToolbarReplay(page);
  await expect(drawingToolbar).toHaveAttribute("data-creation-disabled", "replay");
  await expect(lineTool).toBeDisabled();
  await expect(cursor).toHaveAttribute("aria-pressed", "true");
  await expect(trendlines).toHaveCount(1);
  await toggleToolbarReplay(page);
  await expect(drawingToolbar).toHaveAttribute("data-creation-disabled", "false");
  await expect(lineTool).toBeEnabled();

  await lineTool.click();
  await chooseToolbarSplit(page, 2);
  await expect(page.locator('.pane-grid[data-n="2"]')).toBeVisible();
  await expect(drawingToolbar).toHaveAttribute("data-creation-disabled", "multi-chart");
  await expect(lineTool).toBeDisabled();
  await expect(cursor).toHaveAttribute("aria-pressed", "true");
  await chooseToolbarSplit(page, 1);
  await expect(drawingToolbar).toHaveAttribute("data-creation-disabled", "false");
  await expect(lineTool).toBeEnabled();

  await lineTool.dblclick();
  await expect(sticky).toHaveAttribute("data-sticky", "true");
  await expect(sticky).toHaveAttribute("data-stay-active", "false");
  await expect(lineTool).toHaveAttribute("aria-pressed", "true");
  await dragDrawing(page, layer, { x: 0.32, y: 0.62 }, { x: 0.69, y: 0.40 });
  await expect(trendlines).toHaveCount(2);
  await expect(lineTool).toHaveAttribute("aria-pressed", "true");
  // Escape exits the per-tool pin without turning on the persisted global Stay mode.
  await page.keyboard.press("Escape");
  await expect(cursor).toHaveAttribute("aria-pressed", "true");
  await expect(sticky).toHaveAttribute("data-sticky", "false");
  await expect(sticky).toHaveAttribute("data-stay-active", "false");

  const shapesTrigger = page.getByTestId("drawing-group-shapes-menu-trigger");
  await shapesTrigger.click();
  const shapesMenu = page.getByTestId("drawing-group-shapes-menu");
  await expect(shapesMenu).toBeVisible();
  await page.getByTestId("drawing-tool-triangle").press("Enter");
  await expect(shapesMenu).toBeHidden();
  const shapeTool = page.getByTestId("drawing-group-shapes-main");
  await expect(shapeTool).toHaveAttribute("data-tool-id", "triangle");
  await expect(shapeTool).toHaveAttribute("aria-pressed", "true");

  const layerBox = await layer.boundingBox();
  expect(layerBox).not.toBeNull();
  await page.mouse.click(
    layerBox!.x + layerBox!.width * 0.42,
    layerBox!.y + layerBox!.height * 0.32,
  );
  await page.mouse.move(
    layerBox!.x + layerBox!.width * 0.57,
    layerBox!.y + layerBox!.height * 0.48,
  );
  const trianglePreview = layer.locator('g[data-id="_p"][data-drawing-kind="triangle"]');
  const committedTriangles = layer.locator(
    'g[data-drawing-kind="triangle"]:not([data-id="_p"])',
  );
  await expect(trianglePreview).toHaveCount(1);
  await expect(committedTriangles).toHaveCount(0);

  await lineTool.click();
  await expect(lineTool).toHaveAttribute("aria-pressed", "true");
  await expect(trianglePreview).toHaveCount(0);
  await expect(committedTriangles).toHaveCount(0);
  await cursor.click();

  await runToolbarDetector(page, "Auto Fibonacci");
  const detectedFib = layer.locator('g[data-drawing-kind="fib"]');
  await expect(detectedFib).toHaveCount(1);

  const clearTrigger = page.getByTestId("drawing-clear-trigger");
  await clearTrigger.click();
  await page.getByTestId("drawing-clear-user").click();
  await expect(trendlines).toHaveCount(0);
  await expect(detectedFib).toHaveCount(1);

  await clearTrigger.click();
  await page.getByTestId("drawing-clear-detected").click();
  await expect(detectedFib).toHaveCount(0);
});

test("flagship geometry, editing, and path limits survive adversarial interaction", async ({ page }) => {
  // QUARANTINED — see e2e/QUARANTINE.md. On unmodified master this fails 3/3 attempts at
  // line 1140 below: after three Path clicks and a finishing double-click no committed
  // `g[data-drawing-kind="path"]` element exists. Evidence: run 33942726252, whose PR (#507)
  // changes only a .sql migration, so the failure is the base's, not that PR's.
  // Owner: issue #485 (R1 reliability program). No repair PR exists for this journey yet.
  test.fixme(true, "Path tool does not commit on double-click — issue #485; see e2e/QUARANTINE.md");
  // This intentionally monolithic contract performs several independent real
  // pointer transactions; saturated shared runners can exceed the default
  // budget while still advancing normally through every assertion.
  test.slow();
  test.skip(
    (page.viewportSize()?.width ?? 1440) <= 860,
    "Dense pointer geometry is exercised once on the stable desktop canvas.",
  );
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, {
    drawings: [
      { id: "vertical-contract", kind: "extendedline", source: "user", points: [{ t: "2026-06-12", p: 196 }, { t: "2026-06-12", p: 208 }], color: "#4d82ff", width: 2, dash: "solid" },
      { id: "text-contract", kind: "text", source: "user", points: [{ t: "2026-06-15", p: 204 }], color: "#4d82ff", text: "EDITME", fontSize: 16 },
      { id: "rigid-contract", kind: "trendline", source: "user", points: [{ t: "2026-06-18", p: 198 }, { t: "2026-06-25", p: 207 }], color: "#26c281", width: 2, dash: "solid" },
      { id: "fib-contract", kind: "fib", source: "user", points: [{ t: "2026-05-20", p: 176 }, { t: "2026-06-17", p: 210 }], color: "#4d82ff", width: 1.5, dash: "solid", fillOpacity: 0.07 },
    ],
    onPut: (payload) => saves.push(payload),
  });

  const layer = page.locator(".pane.on .drawing-layer");
  const layerBox = await layer.boundingBox();
  expect(layerBox).not.toBeNull();

  const vertical = layer.locator('g[data-id="vertical-contract"] line:not([stroke="transparent"])').first();
  // A mathematically vertical SVG line has a zero-width bounding box, so
  // Playwright correctly considers it non-visible even while it is rendered.
  await expect(vertical).toHaveCount(1);
  const verticalExtent = await vertical.evaluate((node) => {
    const line = node as SVGLineElement;
    return {
      y1: Number(line.getAttribute("y1")),
      y2: Number(line.getAttribute("y2")),
    };
  });
  expect(Math.min(verticalExtent.y1, verticalExtent.y2)).toBeCloseTo(0, 1);
  // Use the already-stabilized drawing-layer box. A quote repaint may replace
  // the SVG subtree between locator resolution and evaluation on slower CI
  // runners, making `ownerSVGElement` transiently null even though the line's
  // geometry is valid.
  expect(Math.max(verticalExtent.y1, verticalExtent.y2)).toBeCloseTo(layerBox!.height, 1);

  const text = layer.locator('g[data-id="text-contract"] text');
  await text.dblclick();
  await expect(page.locator(".text-edit")).toBeVisible();
  await page.locator(".text-edit").press("Escape");

  const fib = layer.locator('g[data-id="fib-contract"]');
  const fibHit = fib.locator('line:not([stroke="transparent"])').first();
  await fibHit.dispatchEvent("pointerdown", { bubbles: true, pointerId: 201, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: 240, clientY: 240 });
  await fibHit.dispatchEvent("pointerup", { bubbles: true, pointerId: 201, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0, clientX: 240, clientY: 240 });
  const inspector = page.getByRole("toolbar", { name: "Selected drawing properties" });
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute("data-drawing-id", "fib-contract");
  await inspector.locator('[data-w="4"]').click();
  await inspector.locator('[data-dash="dotted"]').click();
  const fibLevel = fib.locator("line").first();
  await expect(fibLevel).toHaveAttribute("stroke-dasharray", "2 4");
  await expect.poll(() => fibLevel.getAttribute("stroke-width").then(Number)).toBeGreaterThanOrEqual(4);
  const fill = inspector.locator('[data-fill-opacity="1"]');
  await fill.evaluate((input: HTMLInputElement) => {
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(fib.locator("rect").first()).toHaveAttribute("fill-opacity", "0.3");

  const customColor = inspector.locator('[data-custom-color="1"]');
  await customColor.evaluate((input: HTMLInputElement) => {
    input.value = "#ff00ff";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // A live language/quote rerender between native input and change must not
  // replace the inspector's draft with the last committed prop snapshot.
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await page.waitForTimeout(100);
  await expect.poll(() => customColor.evaluate((input) => input.isConnected)).toBe(true);
  await customColor.dispatchEvent("change");
  await expect.poll(
    () => saves.some((payload) => payload.drawings?.some((drawing) => drawing.id === "fib-contract" && drawing.color === "#ff00ff")),
    { timeout: 5_000, message: "the custom color should reach durable persistence" },
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "en");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });

  const rigid = layer.locator('g[data-id="rigid-contract"]');
  const rigidLine = rigid.locator('line:not([stroke="transparent"])').first();
  const rigidHit = rigid.locator('line[stroke="transparent"]').first();
  const span = () => rigidLine.evaluate((line) => Math.abs(Number(line.getAttribute("x2")) - Number(line.getAttribute("x1"))));
  const midpoint = () => rigidLine.evaluate((line) => (Number(line.getAttribute("x2")) + Number(line.getAttribute("x1"))) / 2);
  const spanBefore = await span();
  const midpointBefore = await midpoint();
  const rigidOrigin = await rigidHit.evaluate((node) => {
    const line = node as SVGLineElement;
    const svgRect = line.ownerSVGElement!.getBoundingClientRect();
    return {
      x: svgRect.left + (Number(line.getAttribute("x1")) + Number(line.getAttribute("x2"))) / 2,
      y: svgRect.top + (Number(line.getAttribute("y1")) + Number(line.getAttribute("y2"))) / 2,
    };
  });
  await rigidHit.dispatchEvent("pointerdown", { bubbles: true, pointerId: 301, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: rigidOrigin.x, clientY: rigidOrigin.y });
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 301, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: x + 500, clientY: y })), rigidOrigin);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:lang")));
  await page.waitForTimeout(50);
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 301, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0, clientX: x + 500, clientY: y })), rigidOrigin);
  await expect.poll(span).toBeCloseTo(spanBefore, 0);
  await expect.poll(() => midpoint().then((value) => Math.abs(value - midpointBefore))).toBeGreaterThan(2);

  await page.getByTestId("drawing-group-freehand-menu-trigger").click();
  await page.getByTestId("drawing-tool-brush").press("Enter");
  await page.mouse.move(layerBox!.x + layerBox!.width * .15, layerBox!.y + layerBox!.height * .35);
  await page.mouse.down();
  await page.mouse.move(layerBox!.x + layerBox!.width * .82, layerBox!.y + layerBox!.height * .62, { steps: 100 });
  await page.mouse.up();
  const brush = layer.locator('g[data-drawing-kind="brush"]').last();
  await expect(brush).toBeVisible();
  await expect(brush.locator("polyline")).toHaveCount(2);
  await expect(brush.locator('line[data-segment="1"]')).toHaveCount(0);
  await expect.poll(
    () => saves.flatMap((payload) => payload.drawings ?? []).find((drawing) => drawing.kind === "brush")?.points?.length ?? 0,
    { timeout: 5_000, message: "a dense Brush stroke should persist within the registry/API limit" },
  ).toBeGreaterThan(1);
  const savedBrush = saves.flatMap((payload) => payload.drawings ?? []).find((drawing) => drawing.kind === "brush");
  expect(savedBrush?.points?.length).toBeLessThanOrEqual(64);

  // Path is deliberately segmented (click-by-click), unlike Brush/Highlighter.
  // A final double-click completes one compound object instead of starting a
  // freehand pointer-drag or emitting an object per segment.
  await page.getByTestId("drawing-group-freehand-menu-trigger").click();
  await page.getByTestId("drawing-tool-path").press("Enter");
  const pathPoint = (x: number, y: number) => ({
    x: layerBox!.x + layerBox!.width * x,
    y: layerBox!.y + layerBox!.height * y,
  });
  const p1 = pathPoint(.18, .58);
  const p2 = pathPoint(.36, .43);
  const p3 = pathPoint(.55, .55);
  const p4 = pathPoint(.72, .34);
  await page.mouse.click(p1.x, p1.y);
  await page.mouse.click(p2.x, p2.y);
  await page.mouse.click(p3.x, p3.y);
  await page.mouse.dblclick(p4.x, p4.y, { delay: 60 });
  const path = layer.locator('g[data-drawing-kind="path"]:not([data-id="_p"])').last();
  await expect(path).toBeVisible();
  await expect(path.locator("polyline")).toHaveCount(2);
  await expect.poll(
    () => saves.flatMap((payload) => payload.drawings ?? []).filter((drawing) => drawing.kind === "path").at(-1)?.points?.length ?? 0,
    { timeout: 5_000, message: "double-click should persist one segmented Path" },
  ).toBeGreaterThanOrEqual(4);

  // Coarse pointers finish a segmented tool by tapping its final anchor again.
  // The second tap is deliberately 10px away—inside the 16px finger tolerance,
  // but well outside the desktop precision radius.
  await page.getByTestId("drawing-group-freehand-menu-trigger").click();
  await page.getByTestId("drawing-tool-path").press("Enter");
  const touchTap = async (point: { x: number; y: number }, pointerId: number) => {
    await layer.dispatchEvent("pointerdown", { bubbles: true, pointerId, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, clientX: point.x, clientY: point.y });
    await layer.dispatchEvent("pointerup", { bubbles: true, pointerId, pointerType: "touch", isPrimary: true, button: 0, buttons: 0, clientX: point.x, clientY: point.y });
  };
  const touchStart = pathPoint(.28, .68);
  const touchEnd = pathPoint(.48, .61);
  await touchTap(touchStart, 351);
  await touchTap(touchEnd, 352);
  await touchTap({ x: touchEnd.x, y: touchEnd.y + 10 }, 353);
  await expect(layer.locator('g[data-drawing-kind="path"]:not([data-id="_p"])')).toHaveCount(2);
  await expect.poll(
    () => saves.flatMap((payload) => payload.drawings ?? []).filter((drawing) => drawing.kind === "path").at(-1)?.points?.length ?? 0,
    { timeout: 5_000, message: "a repeated coarse-pointer endpoint should finish Path" },
  ).toBe(2);

  await page.getByTestId("drawing-group-shapes-menu-trigger").click();
  await page.getByTestId("drawing-tool-triangle").press("Enter");
  const triangleTool = page.getByTestId("drawing-group-shapes-main");
  const point = (x: number, y: number) => ({ clientX: layerBox!.x + layerBox!.width * x, clientY: layerBox!.y + layerBox!.height * y });
  const canceledFirst = point(.25, .25);
  await layer.dispatchEvent("pointerdown", { bubbles: true, pointerId: 401, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, ...canceledFirst });
  await layer.dispatchEvent("pointercancel", { bubbles: true, pointerId: 401, pointerType: "touch", isPrimary: true, button: 0, buttons: 0, ...canceledFirst });
  await expect(layer.locator('g[data-id="_p"][data-drawing-kind="triangle"]')).toHaveCount(0);
  await page.mouse.click(point(.32, .32).clientX, point(.32, .32).clientY);
  await page.mouse.click(point(.48, .46).clientX, point(.48, .46).clientY);
  const canceledFinal = point(.65, .30);
  await layer.dispatchEvent("pointerdown", { bubbles: true, pointerId: 402, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, ...canceledFinal });
  await layer.dispatchEvent("pointercancel", { bubbles: true, pointerId: 402, pointerType: "touch", isPrimary: true, button: 0, buttons: 0, ...canceledFinal });
  await expect(layer.locator('g[data-drawing-kind="triangle"]:not([data-id="_p"])')).toHaveCount(0);
  await expect(triangleTool).toHaveAttribute("aria-pressed", "true");
});

test("each drawing tool keeps its own defaults and fill color contract", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 1440) <= 860,
    "Per-tool registry defaults only need one stable desktop proof.",
  );
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });
  const layer = page.locator(".pane.on .drawing-layer");

  await page.getByTestId("drawing-group-freehand-menu-trigger").click();
  await page.getByTestId("drawing-tool-highlighter").press("Enter");
  await dragDrawing(page, layer, { x: .2, y: .3 }, { x: .58, y: .48 });
  await expect.poll(() => {
    const drawing = saves.flatMap((payload) => payload.drawings ?? []).find((item) => item.kind === "highlighter");
    return drawing ? { color: drawing.color, width: drawing.width, opacity: drawing.opacity } : null;
  }, { timeout: 5_000 }).toEqual({ color: "#4d82ff", width: 8, opacity: .28 });
  await expect(page.getByTestId("drawing-group-freehand-main")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("drawing-sticky-toggle")).toHaveAttribute("data-sticky", "true");
  await expect(page.getByTestId("drawing-sticky-toggle")).toHaveAttribute("data-stay-active", "false");

  await page.getByTestId("drawing-group-fibonacci-menu-trigger").click();
  await page.getByTestId("drawing-tool-fib").press("Enter");
  await dragDrawing(page, layer, { x: .28, y: .28 }, { x: .63, y: .61 });
  await expect.poll(() => {
    const drawing = saves.flatMap((payload) => payload.drawings ?? []).find((item) => item.kind === "fib");
    return drawing ? { color: drawing.color, dash: drawing.dash } : null;
  }, { timeout: 5_000 }).toEqual({ color: "#4d82ff", dash: "dashed" });

  await page.getByTestId("drawing-group-shapes-menu-trigger").click();
  await page.getByTestId("drawing-tool-rect").press("Enter");
  await expect(page.getByTestId("drawing-group-shapes-main")).toHaveAttribute("aria-pressed", "true");
  const rectangleActivation = Number(await layer.getAttribute("data-tool-activation"));
  expect(rectangleActivation).toBeGreaterThan(1);
  // A replayed commit from an older activation of this same tool must not
  // disarm the newly selected Rectangle transaction.
  await page.evaluate(({ activation }) => {
    window.dispatchEvent(new CustomEvent("mm:drawing-committed", {
      detail: { kind: "rect", activation: activation - 1 },
    }));
  }, { activation: rectangleActivation });
  await expect(page.getByTestId("drawing-group-shapes-main")).toHaveAttribute("aria-pressed", "true");
  await expect(layer).toHaveAttribute("data-tool-activation", String(rectangleActivation));
  const red = page.getByTestId("drawing-style-color-2");
  await red.click();
  await expect(red).toHaveAttribute("aria-pressed", "true");
  // Escape must cancel the whole pointer transaction, including capture and
  // the palette's temporary click-through state, before another drag begins.
  const layerBox = await layer.boundingBox();
  expect(layerBox).not.toBeNull();
  await page.mouse.move(layerBox!.x + layerBox!.width * .72, layerBox!.y + layerBox!.height * .18);
  await page.mouse.down();
  const creationPalette = page.locator(".drawing-creation-palette");
  await expect(creationPalette).toHaveCSS("pointer-events", "none");
  await page.keyboard.press("Escape");
  await expect(creationPalette).toHaveCSS("pointer-events", "auto");
  await page.mouse.up();
  // Keep this placement clear of the earlier Highlighter/Fib hit regions so
  // the assertion isolates new-tool creation from existing-drawing selection.
  // A paced drag gives the endpoint palette time to follow every pointer step;
  // it must remain click-through until the creation transaction finishes.
  await dragDrawing(page, layer, { x: .72, y: .18 }, { x: .86, y: .38 }, 24);
  await expect(layer.locator('g[data-drawing-kind="rect"]:not([data-id="_p"])')).toBeVisible();
  await expect.poll(() => {
    const drawing = saves.flatMap((payload) => payload.drawings ?? []).find((item) => item.kind === "rect");
    return drawing ? { color: drawing.color, fillColor: drawing.fillColor } : null;
  }, { timeout: 10_000 }).toEqual({ color: "#f0566b", fillColor: "#f0566b" });
});

test("pane-anchored notes stay fixed while calculated labels never open a text editor", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 1440) <= 860,
    "Pane anchoring and precise double-click targeting only need one desktop proof.",
  );
  await openTerminal(page, {
    drawings: [
      {
        id: "pane-anchor-contract",
        kind: "anchoredtext",
        source: "user",
        points: [{ t: "2026-06-12", p: 198 }],
        color: "#4d82ff",
        text: "FIXED",
        fontSize: 16,
        meta: { paneAnchor: { x: .22, y: .27 } },
      },
      {
        id: "price-label-contract",
        kind: "pricelabel",
        source: "user",
        points: [{ t: "2026-06-18", p: 204 }],
        color: "#26c281",
      },
      {
        id: "vwap-label-contract",
        kind: "anchoredvwap",
        source: "user",
        points: [{ t: "2026-06-20", p: 201 }],
        color: "#e8b339",
      },
    ],
  });
  const layer = page.locator(".pane.on .drawing-layer");
  const fixedText = layer.locator('g[data-id="pane-anchor-contract"] text').first();
  const position = () => fixedText.evaluate((node) => ({
    x: Number(node.getAttribute("x")),
    y: Number(node.getAttribute("y")),
  }));
  const before = await position();
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * .74, box!.y + box!.height * .42);
  await page.mouse.wheel(0, -720);
  await page.waitForTimeout(180);
  await expect.poll(position).toEqual(before);

  await layer.locator('g[data-id="price-label-contract"] [data-geometry="1"]').first().dblclick({ force: true });
  await expect(page.locator(".text-edit")).toHaveCount(0);
  await layer.locator('g[data-id="vwap-label-contract"] [data-geometry="1"]').first().dblclick({ force: true });
  await expect(page.locator(".text-edit")).toHaveCount(0);
});

test("media tools choose and persist real emoji, icons, and bounded local images", async ({ page }) => {
  test.skip(isPhone(page), SKIP_PHONE);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });
  const layer = page.locator(".pane.on .drawing-layer");
  const at = async (x: number, y: number) => {
    // The compact dock may be reached after the document itself scrolls. Bring
    // the chart back into view before translating semantic chart coordinates so
    // a placement can never become an off-viewport negative mouse position.
    await layer.scrollIntoViewIfNeeded();
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    return { x: box!.x + box!.width * x, y: box!.y + box!.height * y };
  };

  await page.getByTestId("drawing-group-emoji-menu-trigger").click();
  await page.getByTestId("drawing-tool-emoji").press("Enter");
  const emojiPoint = await at(.36, .34);
  await page.mouse.click(emojiPoint.x, emojiPoint.y);
  const emojiPicker = page.getByTestId("drawing-media-picker");
  await expect(emojiPicker).toBeVisible();
  await expectChartLocal(page, emojiPicker);
  const dismissPoint = await at(.94, .06);
  await page.mouse.click(dismissPoint.x, dismissPoint.y);
  await expect(emojiPicker).toBeHidden();
  await page.waitForTimeout(80);
  await expect(page.getByTestId("drawing-media-picker")).toHaveCount(0);
  const replacementEmojiPoint = await at(.36, .34);
  await page.mouse.click(replacementEmojiPoint.x, replacementEmojiPoint.y);
  await expect(emojiPicker).toBeVisible();
  await page.getByTestId("drawing-media-choice-emoji-3").click();
  await expect(layer.locator('g[data-drawing-kind="emoji"] [data-media-choice="🚀"]')).toHaveCount(1);
  await expect.poll(() => saves.flatMap((payload) => payload.drawings ?? []).find((drawing) => drawing.kind === "emoji")?.text).toBe("🚀");
  await expect(page.getByTestId("drawing-media-picker")).toHaveCount(0);
  await expect(page.getByTestId("drawing-tool-cursor")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("drawing-group-emoji-menu-trigger").click();
  await page.getByTestId("drawing-tool-icon").press("Enter");
  await expect(page.getByTestId("drawing-group-emoji-main")).toHaveAttribute("data-tool-id", "icon");
  await expect(page.getByTestId("drawing-group-emoji-main")).toHaveAttribute("aria-pressed", "true");
  const iconPoint = await at(.48, .43);
  await page.mouse.click(iconPoint.x, iconPoint.y);
  const iconPicker = page.getByTestId("drawing-media-picker");
  await expect(iconPicker).toBeVisible();
  await page.getByTestId("drawing-media-choice-icon-2").focus();
  await page.keyboard.press("Enter");
  await expect(layer.locator('g[data-drawing-kind="icon"] [data-media-choice="bolt"]')).toHaveCount(1);
  await expect.poll(() => saves.flatMap((payload) => payload.drawings ?? []).find((drawing) => drawing.kind === "icon")?.meta?.iconId).toBe("bolt");

  await page.getByTestId("drawing-group-annotation-menu-trigger").click();
  await page.getByTestId("drawing-tool-image").press("Enter");
  await layer.scrollIntoViewIfNeeded();
  const chooserPromise = page.waitForEvent("filechooser");
  await dragDrawing(page, layer, { x: .24, y: .26 }, { x: .56, y: .54 });
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "chart-note.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4SIAAAAASUVORK5CYII=", "base64"),
  });
  await expect.poll(() => saves.flatMap((payload) => payload.drawings ?? []).find((drawing) => drawing.kind === "image")?.meta?.imageSrc).toMatch(/^data:image\/png;base64,/);
  const renderedImage = layer.locator('g[data-drawing-kind="image"] image[data-media-image="1"]');
  await expect(renderedImage).toHaveCount(1);
  await expect.poll(() => layer.locator('g[data-drawing-kind="image"]').getAttribute("data-media-state")).toBe("loaded");
  await expectNoDocumentOverflow(page);
});

test("dense collections save beyond Chromium's keepalive request quota", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 1440) <= 860,
    "The persistence transport boundary only needs one stable desktop proof.",
  );
  const densePaths = Array.from({ length: 32 }, (_, drawingIndex) => ({
    id: `dense-path-${drawingIndex}`,
    kind: "path",
    source: "user",
    color: "#4d82ff",
    width: 2.5,
    dash: "dotted",
    points: Array.from({ length: 64 }, (_, pointIndex) => ({
      t: `2026-${String(1 + Math.floor(pointIndex / 28)).padStart(2, "0")}-${String(1 + (pointIndex % 28)).padStart(2, "0")}`,
      p: 150.123456789 + drawingIndex * 0.137 + pointIndex * 0.019,
    })),
  }));
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { drawings: densePaths, onPut: (payload) => saves.push(payload) });

  await page.getByTestId("drawing-group-lines-menu-trigger").click();
  await page.getByTestId("drawing-tool-hline").press("Enter");
  const layer = page.locator(".pane.on .drawing-layer");
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.55, box!.y + box!.height * 0.45);

  await expect.poll(() => saves.length, {
    timeout: 5_000,
    message: "a payload above the browser keepalive quota should reach the API",
  }).toBeGreaterThan(0);
  expect(JSON.stringify(saves.at(-1)).length).toBeGreaterThan(65_536);
});

test("the drawing cap rejects object 501 without evicting object 1", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 1440) <= 860,
    "The collection ceiling only needs one stable desktop proof.",
  );
  const drawings = Array.from({ length: 500 }, (_, index) => ({
    id: `limit-line-${index}`,
    kind: "hline",
    source: "user",
    points: [{ t: "2026-06-12", p: 80 + index * 0.2 }],
    color: "#4d82ff",
    width: 1.5,
    dash: "solid",
  }));
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { drawings, onPut: (payload) => saves.push(payload) });

  await page.getByTestId("drawing-group-lines-menu-trigger").click();
  await page.getByTestId("drawing-tool-hline").press("Enter");
  const layer = page.locator(".pane.on .drawing-layer");
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.55, box!.y + box!.height * 0.45);

  await expect(page.locator('.undo-toast[role="alert"]').filter({ hasText: "500 drawing limit reached" })).toBeVisible();
  await expect(layer.locator('g[data-id="limit-line-0"]')).toHaveCount(1);
  await expect(layer.locator('g[data-drawing-kind="hline"]:not([data-id="_p"])')).toHaveCount(500);
  await page.waitForTimeout(800);
  expect(saves).toHaveLength(0);
});

test("account drawing loads fail closed and retry without issuing a destructive save", async ({ page }) => {
  test.skip(isPhone(page), SKIP_PHONE);
  let getCount = 0;
  let putCount = 0;
  await page.route("**/api/drawings**", async (route) => {
    if (route.request().method() === "GET") {
      getCount += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ drawings: [], error: "fixture outage" }),
      });
      return;
    }
    putCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.addInitScript(() => {
    localStorage.removeItem("mm.draw");
    localStorage.removeItem("mm.drawing.preferences");
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();

  const lineTool = page.getByTestId("drawing-group-lines-main");
  await lineTool.click();
  await expect(lineTool).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/Saved drawings could not be loaded/)).toContainText("Drawing changes are paused");

  await expect.poll(() => getCount, {
    message: "a failed authoritative drawing load should retry",
    timeout: 5_000,
  }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(750);
  expect(putCount).toBe(0);
});

test("a symbol change keeps the renderer alive and never leaks the old symbol's drawings", async ({ page }) => {
  test.skip(isPhone(page), "The dock is the tool source here; the phone path is its own spec.");
  await openTerminal(page);

  // Draw a trendline on NVDA.
  const layer = page.locator(".pane.on .drawing-layer");
  const lines = layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])');
  await page.getByTestId("drawing-group-lines-main").click();
  await dragDrawing(page, layer, { x: 0.28, y: 0.34 }, { x: 0.55, y: 0.52 });
  await expect(lines).toHaveCount(1);

  // Tag the live canvas. If a symbol change tore the renderer down — which is what used to
  // happen, and what left the chart blank for about a second — this node would not come back.
  await page.evaluate(() => {
    (document.querySelector(".chart-wrap canvas") as HTMLCanvasElement & { __mmSurvivor?: number }).__mmSurvivor = 1;
  });

  // Hold the incoming symbol's bars so the swap window is observable — this IS the second the
  // chart used to spend blank. Reduced motion removes the 160ms ramp, so the dim is a value to
  // read rather than a moving target.
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/data\/AAPL\.(json|slice\.json)/, async (route) => { await held; await route.continue(); });

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: "AAPL" } })));

  // Mid-swap: the OUTGOING chart is still on screen, dimmed and desaturated — not blank.
  const pane = page.locator(".pane.on");
  await expect(pane).toHaveAttribute("data-swapping", "1");
  expect(await page.locator(".pane.on .chart-wrap").evaluate((el) => getComputedStyle(el).opacity)).toBe("0.45");
  expect(await page.locator(".pane.on .chart-wrap").evaluate((el) => getComputedStyle(el).filter)).toContain("saturate");

  release();
  await expect.poll(() => page.locator(".pane.on .pane-hd b, .m-symbar").first().innerText()).toContain("AAPL");

  // Same canvas node, so the chart was never torn down…
  expect(await page.evaluate(() => Boolean(
    (document.querySelector(".chart-wrap canvas") as HTMLCanvasElement & { __mmSurvivor?: number })?.__mmSurvivor,
  ))).toBe(true);
  // …and the swap settles rather than leaving the chart dimmed.
  await expect(pane).not.toHaveAttribute("data-swapping", "1");
  await expect.poll(() => page.locator(".pane.on .chart-wrap").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

  // NVDA's trendline must not follow the symbol over.
  await expect(lines).toHaveCount(0);

  // …and the same renderer carries the round trip back, still without a teardown. (The drawings
  // themselves are re-fetched per symbol, which this suite stubs empty — their persistence is
  // the store's contract, covered elsewhere.)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: "NVDA" } })));
  await expect.poll(() => page.locator(".pane.on .pane-hd b, .m-symbar").first().innerText()).toContain("NVDA");
  await expect(pane).not.toHaveAttribute("data-swapping", "1");
  expect(await page.evaluate(() => Boolean(
    (document.querySelector(".chart-wrap canvas") as HTMLCanvasElement & { __mmSurvivor?: number })?.__mmSurvivor,
  ))).toBe(true);
});

// ── release, future time, and freehand selection ──────────────────────────────
// Three defects the operator hit in one session: a drag that never finished on
// mouse-up, drawings pinned at the live edge, and a brush stroke that turned
// into a chain of circles the moment it was selected.

const DESKTOP_ONLY = "Pointer-geometry contracts run once on the stable desktop canvas.";

/** Plot box EXCLUDING the price-axis band, so gutter maths is viewport-independent. */
async function plotBox(page: Page) {
  const box = await page.locator(".pane.on .chart-wrap canvas").first().boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test("a drag released in the future gutter finishes instead of following the cursor", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  await openTerminal(page);

  const layer = page.locator(".pane.on .drawing-layer");
  const trendlines = layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])');
  await expect(trendlines).toHaveCount(0);

  await page.getByTestId("drawing-group-lines-main").click();
  await expect(page.getByTestId("drawing-group-lines-main")).toHaveAttribute("data-tool-id", "trendline");

  // Entirely inside the blank area past the newest candle, and near-horizontal —
  // the exact gesture whose two anchors used to collapse onto the last bar and
  // be misread as a stationary click.
  const plot = await plotBox(page);
  const y = plot.y + plot.height * 0.4;
  const from = plot.x + plot.width - 46;
  const to = plot.x + plot.width - 8;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move((from + to) / 2, y + 1);
  await page.mouse.move(to, y + 1);
  await page.mouse.up();

  await expect(trendlines).toHaveCount(1);
  // Nothing is left armed and tracking the pointer.
  await expect(layer.locator('g[data-id="_p"]')).toHaveCount(0);
  await expect(page.getByTestId("drawing-tool-cursor")).toHaveAttribute("aria-pressed", "true");

  // The object spans real future bars rather than collapsing to zero width.
  const stroke = trendlines.first().locator('line:not([stroke="transparent"])').first();
  const width = await stroke.evaluate((el) =>
    Math.abs(Number(el.getAttribute("x2")) - Number(el.getAttribute("x1"))));
  expect(width).toBeGreaterThan(8);
});

test("an indicator-pane drawing holds its place when the price scale rescales", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  await openTerminal(page);

  const layer = page.locator(".pane.on .drawing-layer");
  const strokes = layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])');

  // Lowest tall canvas = the bottom indicator pane (the short one is the time axis).
  const subPane = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".pane.on .chart-wrap canvas")]
      .map((canvas) => canvas.getBoundingClientRect())
      .filter((rect) => rect.width > 100 && rect.height > 40)
      .sort((a, b) => a.top - b.top);
    const last = boxes[boxes.length - 1];
    return boxes.length > 1 ? { top: last.top, height: last.height, left: last.left, width: last.width } : null;
  });
  test.skip(!subPane, "This chart mounted no indicator sub-pane.");

  const y = subPane!.top + subPane!.height * 0.5;
  await page.getByTestId("drawing-group-lines-main").click();
  await page.mouse.move(subPane!.left + subPane!.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(subPane!.left + subPane!.width * 0.5, y + 6);
  await page.mouse.up();
  await expect(strokes).toHaveCount(1);

  const before = await strokes.first().evaluate((el) => (el as SVGGElement).getBBox().y);

  // Zoom the MAIN price axis. The sub-pane object is anchored to its own scale,
  // so this must not move it — it used to be re-extrapolated and slide away.
  const plot = await plotBox(page);
  await page.mouse.move(plot.x + plot.width + 20, plot.y + plot.height * 0.4);
  for (let notch = 0; notch < 6; notch += 1) await page.mouse.wheel(0, 120);

  await expect.poll(async () => strokes.first().evaluate((el) => (el as SVGGElement).getBBox().y))
    .toBeCloseTo(before, 0);
});

test("selecting a brush stroke shows its bounds, not a handle per sample", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  await openTerminal(page);

  const layer = page.locator(".pane.on .drawing-layer");
  const brush = layer.locator('g[data-drawing-kind="brush"]:not([data-id="_p"])');

  const freehand = page.getByTestId("drawing-group-freehand-main");
  await freehand.click();
  await expect(freehand).toHaveAttribute("data-tool-id", "brush");
  await expect(freehand).toHaveAttribute("aria-pressed", "true");
  await dragDrawing(page, layer, { x: 0.3, y: 0.3 }, { x: 0.55, y: 0.45 }, 12);
  await expect(brush).toHaveCount(1);

  // The stroke is sampled into many anchors, so a handle per anchor would bury
  // it; selection shows the extent plus the two endpoints instead.
  const sampled = await brush.first().locator("[data-geometry]").first()
    .evaluate((el) => (el.getAttribute("points") ?? el.getAttribute("d") ?? "").split(/[ ,]+/).length);
  expect(sampled).toBeGreaterThan(8);

  // Back to the cursor, then select the stroke by clicking a point that is
  // genuinely ON it — a curved path's bounding-box centre sits in empty space.
  await page.getByTestId("drawing-tool-cursor").click();
  await expect(page.getByTestId("drawing-tool-cursor")).toHaveAttribute("aria-pressed", "true");
  const onStroke = await brush.first().locator("[data-geometry]").first().evaluate((el) => {
    const parts = (el.getAttribute("points") ?? "").trim().split(/\s+/);
    const [x, y] = (parts[Math.floor(parts.length / 2)] ?? parts[0]).split(",").map(Number);
    const box = (el as SVGElement).ownerSVGElement!.getBoundingClientRect();
    return { x: box.left + x, y: box.top + y };
  });
  await page.mouse.click(onStroke.x, onStroke.y);

  // Selected: the extent plus two endpoint grips, NOT a handle per sample.
  await expect(brush.first().locator("[data-selection-bounds]")).toHaveCount(1);
  await expect(brush.first().locator("circle[data-handle]")).toHaveCount(2);
});
