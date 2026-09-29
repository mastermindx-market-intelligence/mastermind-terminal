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

/** Price pane (top) and the lowest indicator sub-pane, in viewport coords. */
async function rangePaneBoxes(page: Page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".pane.on .chart-wrap canvas")]
      .map((canvas) => canvas.getBoundingClientRect())
      .filter((rect) => rect.width > 100 && rect.height > 40)
      .sort((a, b) => a.top - b.top)
      .map((rect) => ({
        top: rect.top, bottom: rect.bottom, height: rect.height,
        left: rect.left, width: rect.width,
      }));
    return boxes.length > 1 ? { price: boxes[0], indicator: boxes[boxes.length - 1] } : null;
  });
}

/**
 * Persisted anchors of the NEWEST saved drawing of one kind. The newest wins in both
 * directions — latest payload, last drawing within it — because the calibration below
 * can leave an earlier drawing of the same kind on the chart, and reading that one's
 * values instead would quietly compare a gesture against itself.
 */
function savedPoints(saves: DrawingSavePayload[], kind: string): Array<{ t?: string; p: number }> {
  for (let index = saves.length - 1; index >= 0; index -= 1) {
    const list = saves[index].drawings ?? [];
    for (let inner = list.length - 1; inner >= 0; inner -= 1) {
      const found = list[inner];
      if (found.kind === kind && found.points?.length) return found.points as Array<{ t?: string; p: number }>;
    }
  }
  return [];
}

/** How many drawings of one kind the newest save carries. */
function countSaved(saves: DrawingSavePayload[], kind: string): number {
  for (let index = saves.length - 1; index >= 0; index -= 1) {
    const list = saves[index].drawings;
    if (Array.isArray(list)) return list.filter((drawing) => drawing.kind === kind).length;
  }
  return 0;
}

async function pickTool(page: Page, group: string, tool: string) {
  await page.getByTestId(`drawing-group-${group}-menu-trigger`).click();
  const menu = page.getByTestId(`drawing-group-${group}-menu`);
  await expect(menu).toBeVisible();
  await menu.getByTestId(`drawing-tool-${tool}`).press("Enter");
  await expect(menu).toBeHidden();
  // Only start a gesture once the rail actually reports the tool armed.
  await expect(page.getByTestId(`drawing-group-${group}-main`)).toHaveAttribute("data-tool-id", tool);
  await expect(page.getByTestId(`drawing-group-${group}-main`)).toHaveAttribute("aria-pressed", "true");
}

type PaneBox = { top: number; bottom: number; height: number; left: number; width: number };
type Point = { x: number; y: number };
/** A gesture driver, so one contract can be proven with a mouse or with a finger. */
type DragGesture = (from: Point, to: Point) => Promise<void>;

/**
 * A real coarse-pointer drag. Every sample is dispatched ON THE DRAWING LAYER, because
 * the drawing surface binds pointermove/pointerup to its own SVG: a move sent to
 * `window` never reaches it and the gesture silently never commits.
 */
function touchGesture(page: Page, layer: Locator, firstPointerId = 900): DragGesture {
  let pointerId = firstPointerId;
  return async (from, to) => {
    const id = pointerId += 1;
    const send = (type: string, at: Point, buttons: number) => layer.dispatchEvent(type, {
      bubbles: true, pointerId: id, pointerType: "touch", isPrimary: true,
      button: 0, buttons, clientX: at.x, clientY: at.y,
    });
    await send("pointerdown", from, 1);
    // Travel, not a teleport: a finger that jumps in one sample is a different
    // gesture, and the pane lock has to hold across every intermediate move.
    for (const fraction of [0.35, 0.7, 1]) {
      await send("pointermove", {
        x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction,
      }, 1);
    }
    await send("pointerup", to, 0);
  };
}

function mouseGesture(page: Page): DragGesture {
  return async (from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y);
    await page.mouse.up();
  };
}

type Panes = { price: PaneBox; indicator: PaneBox };
type PaneProbe = () => Promise<Panes>;

/**
 * Re-measures the panes on demand. Arming a tool can scroll the DOCUMENT at compact
 * widths — the rail sits below the fold there — so a box measured before `pickTool` is
 * stale by the time the gesture runs, and every coordinate derived from it lands in the
 * wrong place. Measuring after arming is the same discipline the media-tools contract
 * uses, and it is why targets below are fractions of a freshly measured pane rather
 * than absolute viewport y values.
 */
function paneProbe(page: Page, layer: Locator): PaneProbe {
  return async () => {
    await layer.scrollIntoViewIfNeeded();
    const panes = await rangePaneBoxes(page);
    expect(panes, "a price pane and an indicator sub-pane should both be measurable").not.toBeNull();
    return panes!;
  };
}

/**
 * One calibration gesture down pane 0: from its top edge to `toFraction` of its height,
 * with the same tool the contract is about. Returns the pane as measured for this
 * gesture and the price the product itself persisted at each end.
 */
async function calibrationDrag(
  page: Page, saves: DrawingSavePayload[], probe: PaneProbe, toFraction: number,
  expected: number, drag: DragGesture,
) {
  await pickTool(page, "forecasting", "pricerange");
  const { price } = await probe();
  const topY = price.top + 1;
  const toY = price.top + Math.min(price.height - 1, Math.max(1, price.height * toFraction));
  await drag(
    { x: price.left + price.width * .28, y: topY },
    { x: price.left + price.width * .44, y: toY },
  );
  // Poll the drawing COUNT, not the point count. An earlier calibration drawing
  // already holds two points, so waiting on length alone would return before this
  // gesture committed and read the previous one's values.
  await expect.poll(() => countSaved(saves, "pricerange"), {
    message: `calibration gesture ${expected} should commit`,
  }).toBe(expected);
  const points = savedPoints(saves, "pricerange");
  expect(points).toHaveLength(2);
  return { atTop: points[0].p, atEnd: points[1].p, price, topY, toY };
}

/**
 * The visible price band of pane 0, measured by the product itself: one price-range
 * drag from the pane's top edge to its bottom edge persists both extremes. Every
 * owner-scale assertion below calibrates against this instead of a hardcoded ticker
 * price, so the contract holds whatever the local data serves.
 *
 * Readings are kept as "at the top edge" and "at the bottom edge" rather than min/max,
 * because an inverted scale legitimately reports the larger price at the bottom and a
 * min/max band would silently mislabel which one the clamp target is.
 */
async function calibratePriceBand(
  page: Page, saves: DrawingSavePayload[], probe: PaneProbe,
  options: { gesture?: DragGesture; sequence?: number } = {},
) {
  // Anchor the calibration on the pane's own edges. Its lower anchor is therefore
  // the price at the pane floor, which is exactly where the pane lock clamps a
  // gesture that continues past the separator — so the expected value below is a
  // measured control gesture, not an estimate.
  const drag = options.gesture ?? mouseGesture(page);
  const { atTop, atEnd: atBottom, topY, toY: bottomY } = await calibrationDrag(page, saves, probe, 1, options.sequence ?? 1, drag);
  expect(Math.abs(atBottom - atTop), "pane 0 should span a real price range").toBeGreaterThan(0);
  // Price per pixel of pane 0, so the tolerance below is a PIXEL budget. A
  // band-proportional tolerance is not discriminating: this chart's visible band is
  // ~7-260, and the lowest sub-pane is MACD at ~-0.8, so 6% of the band (15) is
  // wider than the corruption it has to catch (7.7).
  const pricePerPixel = Math.abs(atBottom - atTop) / Math.max(1, bottomY - topY);
  return {
    atTop, atBottom, topY, bottomY, drag, probe, pricePerPixel,
    low: Math.min(atTop, atBottom), high: Math.max(atTop, atBottom),
    // A normal scale falls as y grows. Recorded so a scale-mode test can prove the
    // mode it asked for is actually live instead of trusting that a keystroke landed.
    inverted: atTop < atBottom,
  };
}

type PriceBand = Awaited<ReturnType<typeof calibratePriceBand>>;

/**
 * Prove the price scale really is logarithmic, from measurements only. A linear scale
 * puts a pane's vertical midpoint at the ARITHMETIC mean of its edge readings; a
 * logarithmic one puts it at the GEOMETRIC mean. Without this a scale-mode test would
 * pass vacuously the day the keystroke that switches scales stops working.
 */
async function expectLogarithmicScale(
  page: Page, saves: DrawingSavePayload[], band: PriceBand, sequence: number,
) {
  expect(band.atTop, "a logarithmic scale cannot show a non-positive price").toBeGreaterThan(0);
  expect(band.atBottom, "a logarithmic scale cannot show a non-positive price").toBeGreaterThan(0);
  const { atEnd: atMid } = await calibrationDrag(page, saves, band.probe, 0.5, sequence, band.drag);
  const arithmetic = (band.atTop + band.atBottom) / 2;
  const geometric = Math.sqrt(band.atTop * band.atBottom);
  expect(
    Math.abs(atMid - geometric),
    `pane midpoint read ${atMid.toFixed(2)}; a logarithmic scale puts it at the geometric `
    + `mean ${geometric.toFixed(2)}, a linear one at ${arithmetic.toFixed(2)}`,
  ).toBeLessThan(Math.abs(atMid - arithmetic));
}

/**
 * The assertion that actually discriminates. A gesture locked to pane 0 and dragged
 * past its floor must persist the price AT that floor — the same value the control
 * gesture above persisted when it stopped 1px inside that floor. Band membership
 * alone is not enough: it passes vacuously when the gesture never moved, and passes
 * outright whenever a neighbouring pane's values fall inside the price band.
 */
function expectClampedToPaneBottom(value: number, band: PriceBand, what: string) {
  const budget = band.pricePerPixel * 3;
  expect(
    Math.abs(value - band.atBottom),
    `${what} should clamp to the price pane's bottom edge (~${band.atBottom.toFixed(2)} +/- ${budget.toFixed(2)}), got ${value}`,
  ).toBeLessThanOrEqual(budget);
}

function expectInsidePriceBand(value: number, band: PriceBand, what: string) {
  const budget = band.pricePerPixel * 3;
  expect(value, `${what} should stay on the price scale`).toBeGreaterThanOrEqual(band.low - budget);
  expect(value, `${what} should stay on the price scale`).toBeLessThanOrEqual(band.high + budget);
}

/**
 * TERMINAL-04's decisive contract. A price-bearing gesture that crosses a pane
 * separator must persist a value from the pane it STARTED in. #748 clipped the
 * rendered rectangle and left the saved number corrupt, which is what produced the
 * giant rectangles with impossible percentages: the continuation re-hit-tested onto
 * an oscillator and stored (for example) Stoch 44 as a $44 price.
 *
 * The band check is deliberately TWO-SIDED. An oscillator reading (0-100) lands
 * below a large-cap price band, but a volume reading lands far above it, so a
 * one-sided floor would pass on a volume sub-pane.
 */
test("a price-range drag crossing a pane separator persists an owner-scale value", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;
  const layer = page.locator(".pane.on .drawing-layer");

  // Magnet off: both gestures then read the scale directly, so an OHLC snap cannot
  // move a value and mask or fake the band check.
  await selectMagnet(page, "off");
  const band = await calibratePriceBand(page, saves, paneProbe(page, layer));

  await pickTool(page, "forecasting", "dateandpricerange");
  await page.mouse.move(price.left + price.width * .30, price.top + price.height * .52);
  await page.mouse.down();
  await page.mouse.move(indicator.left + indicator.width * .58, indicator.top + indicator.height * .55);
  await page.mouse.up();

  const range = layer.locator('g[data-drawing-kind="dateandpricerange"]:not([data-id="_p"])');
  await expect(range).toHaveCount(1);
  await expect(range).toHaveAttribute("clip-path", /drawing-pane-clip/);

  await expect.poll(() => savedPoints(saves, "dateandpricerange").length).toBe(2);
  const created = savedPoints(saves, "dateandpricerange");
  expectInsidePriceBand(created[0].p, band, "the anchor placed inside pane 0");
  expectClampedToPaneBottom(created[1].p, band, "the endpoint dragged into the indicator pane");

  const box = await range.locator('rect[data-geometry="1"]').first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(price.top - 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(price.bottom + 1);
});

test("an endpoint handle dragged across a pane separator keeps the owner scale", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;
  const layer = page.locator(".pane.on .drawing-layer");

  await selectMagnet(page, "off");
  const band = await calibratePriceBand(page, saves, paneProbe(page, layer));

  await pickTool(page, "forecasting", "dateandpricerange");
  await page.mouse.move(price.left + price.width * .30, price.top + price.height * .40);
  await page.mouse.down();
  await page.mouse.move(price.left + price.width * .52, price.top + price.height * .62);
  await page.mouse.up();

  const range = layer.locator('g[data-drawing-kind="dateandpricerange"]:not([data-id="_p"])');
  await expect(range).toHaveCount(1);

  // A freshly committed drawing is already selected, so its grips are on screen —
  // clicking the body again would only land on grip 0 and intercept the drag.
  const handle = range.locator('circle[data-handle="1"]').first();
  await expect(handle).toBeVisible();
  const grip = await handle.boundingBox();
  expect(grip).not.toBeNull();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(indicator.left + indicator.width * .60, indicator.top + indicator.height * .60);
  await page.mouse.up();

  await expect.poll(() => savedPoints(saves, "dateandpricerange").length).toBe(2);
  const edited = savedPoints(saves, "dateandpricerange");
  expectInsidePriceBand(edited[0].p, band, "the untouched anchor");
  // Also proves the drag actually took: an unmoved grip would still be mid-pane.
  expectClampedToPaneBottom(edited[1].p, band, "the grip dragged into the indicator pane");
});

test("dragging a whole range drawing across a pane separator keeps the owner scale", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;
  const layer = page.locator(".pane.on .drawing-layer");

  await selectMagnet(page, "off");
  const band = await calibratePriceBand(page, saves, paneProbe(page, layer));

  await pickTool(page, "forecasting", "dateandpricerange");
  await page.mouse.move(price.left + price.width * .30, price.top + price.height * .34);
  await page.mouse.down();
  await page.mouse.move(price.left + price.width * .52, price.top + price.height * .52);
  await page.mouse.up();

  const range = layer.locator('g[data-drawing-kind="dateandpricerange"]:not([data-id="_p"])');
  await expect(range).toHaveCount(1);
  await expect.poll(() => savedPoints(saves, "dateandpricerange").length).toBe(2);
  const before = savedPoints(saves, "dateandpricerange").map((point) => point.p);

  // Grab the body, clear of the corner grips, and translate it past the separator.
  // A whole-drawing move applies ONE shared delta, so an unlocked continuation
  // subtracts a price from an oscillator reading and drives both anchors off-scale.
  const body = range.locator('rect[data-geometry="1"]').first();
  const bodyBox = await body.boundingBox();
  expect(bodyBox).not.toBeNull();
  await page.mouse.move(bodyBox!.x + bodyBox!.width / 2, bodyBox!.y + bodyBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(indicator.left + indicator.width * .55, indicator.top + indicator.height * .58);
  await page.mouse.up();

  await expect.poll(() => {
    const now = savedPoints(saves, "dateandpricerange").map((point) => point.p);
    return now.length === 2 && now[0] !== before[0];
  }).toBe(true);
  const after = savedPoints(saves, "dateandpricerange").map((point) => point.p);

  // A move applies ONE shared delta to the original anchors, so the two assertions
  // below pin both anchors exactly — a stronger claim than band membership.
  //
  // Band membership would in fact be WRONG here: the grab point was the body centre,
  // so when it clamps to the pane floor the rigid lower edge is carried BELOW the
  // visible window. That is a price-scale value the user can scroll back to, not the
  // cross-scale corruption this packet is about.
  //
  // 1. The grabbed point — the body centre, i.e. the anchors' midpoint on a linear
  //    scale — must land on the price pane floor, because that is where the lock
  //    clamps a continuation that left the pane.
  expectClampedToPaneBottom((after[0] + after[1]) / 2, band, "the moved drawing's grabbed midpoint");
  // 2. The span is untouched, so the translation was rigid rather than collapsing.
  expect(after[0] - after[1]).toBeCloseTo(before[0] - before[1], 2);
  // It really did travel downward rather than being rejected outright.
  expect(after[0]).toBeLessThan(before[0]);
});

test("Shift+Measure crossing a pane separator keeps the owner scale", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;
  const layer = page.locator(".pane.on .drawing-layer");

  await selectMagnet(page, "off");
  const band = await calibratePriceBand(page, saves, paneProbe(page, layer));

  // Shift+drag measures without arming the rail, so it has its own snap call site.
  await page.keyboard.down("Shift");
  await page.mouse.move(price.left + price.width * .34, price.top + price.height * .45);
  await page.mouse.down();
  await page.mouse.move(indicator.left + indicator.width * .56, indicator.top + indicator.height * .58);
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const measure = layer.locator('g[data-drawing-kind="measure"]:not([data-id="_p"])');
  await expect(measure).toHaveCount(1);
  await expect(measure).toHaveAttribute("clip-path", /drawing-pane-clip/);
  await expect.poll(() => savedPoints(saves, "measure").length).toBe(2);
  const measured = savedPoints(saves, "measure");
  expectInsidePriceBand(measured[0].p, band, "the Shift+Measure origin");
  expectClampedToPaneBottom(measured[1].p, band, "the Shift+Measure endpoint in the indicator pane");
});

/**
 * The other half of Task 2's persistence rule: a saved range drawing must come back
 * exactly as stored. Ambiguous historical endpoints are NOT to be guessed at or
 * "repaired" on load — the migration path deliberately only touches drawings that
 * carry meta.pane, and a price-pane range carries none.
 *
 * Re-editing a committed drawing is covered by the handle test above: that gesture
 * reads its owner from the drawing's own persisted meta (drawingPaneKey), which is
 * the same code path a reloaded drawing takes. This test therefore asserts the load
 * half, which needs no pointer geometry and so cannot depend on where the reloaded
 * chart happens to place a bar.
 */
test("a reloaded range drawing is served back unrepaired and still clips to its pane", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const first: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => first.push(payload) });

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;

  await selectMagnet(page, "off");

  // Commit the corrupting gesture itself, so what gets reloaded is a real
  // cross-pane drawing rather than a hand-written fixture.
  await pickTool(page, "forecasting", "dateandpricerange");
  await page.mouse.move(price.left + price.width * .34, price.top + price.height * .44);
  await page.mouse.down();
  await page.mouse.move(indicator.left + indicator.width * .60, indicator.top + indicator.height * .55);
  await page.mouse.up();
  await expect.poll(() => savedPoints(first, "dateandpricerange").length).toBe(2);
  const stored = first[first.length - 1].drawings ?? [];
  const before = savedPoints(first, "dateandpricerange").map((point) => point.p);

  const second: DrawingSavePayload[] = [];
  await openTerminal(page, { drawings: stored, onPut: (payload) => second.push(payload) });

  const range = page.locator(".pane.on .drawing-layer")
    .locator('g[data-drawing-kind="dateandpricerange"]:not([data-id="_p"])');
  await expect(range).toHaveCount(1);
  // Ownership is re-derived on load, so the price-bearing range is clipped again.
  await expect(range).toHaveAttribute("clip-path", /drawing-pane-clip/);

  // Give hydration, the pane-layout measurement and the legacy-migration pass their
  // chance to write. Nothing may rewrite these anchors.
  await page.waitForTimeout(1_500);
  const rewritten = savedPoints(second, "dateandpricerange").map((point) => point.p);
  if (rewritten.length) {
    expect(rewritten).toEqual(before);
  } else {
    expect(second.flatMap((payload) => payload.drawings ?? [])
      .filter((drawing) => drawing.kind === "dateandpricerange")).toHaveLength(0);
  }
});

test("chart-spanning range and vertical tools are still not clipped to the price pane", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  await openTerminal(page);

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;
  const layer = page.locator(".pane.on .drawing-layer");

  // Date Range is intentionally a time-only tool: pane-clipping it would break the
  // product contract that #753 preserves while clipping the price-bearing siblings.
  await pickTool(page, "forecasting", "daterange");
  await page.mouse.move(price.left + price.width * .30, price.top + price.height * .50);
  await page.mouse.down();
  await page.mouse.move(price.left + price.width * .48, price.top + price.height * .56);
  await page.mouse.up();
  const dateRange = layer.locator('g[data-drawing-kind="daterange"]:not([data-id="_p"])');
  await expect(dateRange).toHaveCount(1);
  await expect(dateRange).not.toHaveAttribute("clip-path", /drawing-pane-clip/);

  await pickTool(page, "lines", "vline");
  await page.mouse.move(price.left + price.width * .62, price.top + price.height * .50);
  await page.mouse.down();
  await page.mouse.up();
  const vline = layer.locator('g[data-drawing-kind="vline"]:not([data-id="_p"])');
  await expect(vline).toHaveCount(1);
  await expect(vline).not.toHaveAttribute("clip-path", /drawing-pane-clip/);
  // It really does span past the separator into the indicator pane.
  const box = await vline.locator('line:not([stroke="transparent"])').first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeGreaterThan(indicator.top);
});

/** Pane 0 alone, for layouts where the sub-panes are no longer separately measurable. */
async function pricePaneBox(page: Page): Promise<PaneBox> {
  const box = await page.evaluate(() => {
    const rect = [...document.querySelectorAll(".pane.on .chart-wrap canvas")]
      .map((canvas) => canvas.getBoundingClientRect())
      .filter((candidate) => candidate.width > 100 && candidate.height > 40)
      .sort((a, b) => a.top - b.top)[0];
    return rect
      ? { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, width: rect.width }
      : null;
  });
  expect(box, "pane 0 should still be measurable").not.toBeNull();
  return box!;
}

/** The cross-pane gesture every scale/input/layout variant below repeats. */
async function crossPaneRange(page: Page, layer: Locator, probe: PaneProbe, drag: DragGesture) {
  await pickTool(page, "forecasting", "dateandpricerange");
  const { price: from, indicator: into } = await probe();
  await drag(
    { x: from.left + from.width * .30, y: from.top + from.height * .52 },
    { x: into.left + into.width * .58, y: into.top + into.height * .55 },
  );
  const range = layer.locator('g[data-drawing-kind="dateandpricerange"]:not([data-id="_p"])');
  await expect(range).toHaveCount(1);
  await expect(range).toHaveAttribute("clip-path", /drawing-pane-clip/);
  return range;
}

/**
 * The clamp happens in PIXEL space and converts afterwards, so it must survive a price
 * scale whose pixels are not linear in price. A repair that clamped the converted PRICE
 * between the pane's two extremes instead would pass on a linear scale and land in the
 * wrong place here, on the scale traders actually use for multi-year ranges.
 */
test("a cross-pane price gesture clamps on a logarithmic price scale", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;
  const layer = page.locator(".pane.on .drawing-layer");
  await selectMagnet(page, "off");

  await page.keyboard.press("Alt+l");            // the shipped logarithmic toggle
  const band = await calibratePriceBand(page, saves, paneProbe(page, layer));
  await expectLogarithmicScale(page, saves, band, 2);

  await crossPaneRange(page, layer, band.probe, band.drag);
  await expect.poll(() => savedPoints(saves, "dateandpricerange").length).toBe(2);
  const created = savedPoints(saves, "dateandpricerange");
  expectInsidePriceBand(created[0].p, band, "the anchor placed inside pane 0");
  expectClampedToPaneBottom(created[1].p, band, "the endpoint dragged into the indicator pane");
});

/**
 * Inverted is the orientation trap. The clamp target is the pane's LARGER price here,
 * so an implementation that reached for a minimum, or for `Math.min` of the band, fails
 * while still looking correct on every normal chart.
 */
test("a cross-pane price gesture clamps on an inverted price scale", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;
  const layer = page.locator(".pane.on .drawing-layer");
  await selectMagnet(page, "off");

  await page.keyboard.press("Alt+i");            // the shipped invert toggle
  const band = await calibratePriceBand(page, saves, paneProbe(page, layer));
  expect(band.inverted, "the scale must really be inverted before this contract means anything").toBe(true);

  await crossPaneRange(page, layer, band.probe, band.drag);
  await expect.poll(() => savedPoints(saves, "dateandpricerange").length).toBe(2);
  const created = savedPoints(saves, "dateandpricerange");
  expectInsidePriceBand(created[0].p, band, "the anchor placed inside pane 0");
  expectClampedToPaneBottom(created[1].p, band, "the endpoint dragged into the indicator pane");
  // Orientation-sensitive: dragging DOWN on an inverted scale must raise the price.
  expect(created[1].p, "the clamped endpoint should be above the anchor on an inverted scale")
    .toBeGreaterThan(created[0].p);
});

/**
 * A finger, not a mouse. Coarse pointers reach the same snap through a different event
 * path and a wider hit tolerance, and touch is how the reported giant rectangles were
 * drawn in the first place.
 */
test("a coarse-pointer cross-pane drag keeps the owner scale", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) > 860, "Fine-pointer paths are covered above; this is the touch proof.");
  test.skip(isPhone(page), SKIP_PHONE);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;
  const layer = page.locator(".pane.on .drawing-layer");
  await selectMagnet(page, "off");

  // The calibration travels the same touch path as the contract, so the control value
  // cannot come from a pointer type the product treats differently.
  const band = await calibratePriceBand(page, saves, paneProbe(page, layer), { gesture: touchGesture(page, layer) });

  await crossPaneRange(page, layer, band.probe, band.drag);
  await expect.poll(() => savedPoints(saves, "dateandpricerange").length).toBe(2);
  const created = savedPoints(saves, "dateandpricerange");
  expectInsidePriceBand(created[0].p, band, "the touch anchor placed inside pane 0");
  expectClampedToPaneBottom(created[1].p, band, "the touch endpoint dragged into the indicator pane");
});

/**
 * Pane layout is not fixed for the life of a chart. Collapsing a sub-pane hands pane 0
 * the freed rows, so its floor moves. The lock therefore has to read LIVE pane layout:
 * a snapshot taken at mount, or when the tool armed, would clamp at a y that is now
 * mid-pane and persist a price well above the real floor.
 */
test("collapsing the indicator pane moves the clamp to pane 0's new floor", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });

  const panes = await rangePaneBoxes(page);
  test.skip(!panes, "This chart mounted no indicator sub-pane.");
  const { price, indicator } = panes!;
  const layer = page.locator(".pane.on .drawing-layer");
  await selectMagnet(page, "off");

  await page.mouse.move(indicator.left + indicator.width * .55, indicator.top + 8);
  const paneOps = page.locator(".pane-ops:visible");
  await expect(paneOps).toBeVisible();
  await paneOps.getByRole("button", { name: "Collapse pane" }).click();
  const mask = page.locator("[data-collapsed-pane-mask]");
  await expect(mask).toHaveCount(1);
  const collapsed = await mask.boundingBox();
  expect(collapsed).not.toBeNull();

  const grown = await pricePaneBox(page);
  expect(grown.bottom, "collapsing should hand pane 0 real extra height").toBeGreaterThan(price.bottom + 8);
  expect(collapsed!.y, "the collapsed strip should sit below pane 0").toBeGreaterThanOrEqual(grown.bottom - 2);

  // A fixed probe: the collapsed layout is settled, and re-running the generic probe
  // would pick the collapsed sliver back up as if it were a full sub-pane.
  const collapsedProbe: PaneProbe = async () => ({
    price: grown,
    indicator: {
      top: collapsed!.y, bottom: collapsed!.y + collapsed!.height, height: collapsed!.height,
      left: collapsed!.x, width: collapsed!.width,
    },
  });
  const band = await calibratePriceBand(page, saves, collapsedProbe);
  await crossPaneRange(page, layer, collapsedProbe, band.drag);

  await expect.poll(() => savedPoints(saves, "dateandpricerange").length).toBe(2);
  const created = savedPoints(saves, "dateandpricerange");
  expectInsidePriceBand(created[0].p, band, "the anchor placed inside the grown pane 0");
  expectClampedToPaneBottom(created[1].p, band, "the endpoint dragged into the collapsed pane");
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

test("an indicator-pane drawing stays in its pane when that pane y-axis rescales", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, { onPut: (payload) => saves.push(payload) });

  const chart = page.locator(".pane.on .chart-wrap");
  const layer = chart.locator(".drawing-layer");
  const strokes = layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])');

  const subPane = await page.evaluate(() => {
    const chart = document.querySelector(".pane.on .chart-wrap")?.getBoundingClientRect();
    const boxes = [...document.querySelectorAll(".pane.on .chart-wrap canvas")]
      .map((canvas) => canvas.getBoundingClientRect())
      .filter((rect) => rect.width > 100 && rect.height > 40)
      .sort((a, b) => a.top - b.top);
    const last = boxes[boxes.length - 1];
    return chart && boxes.length > 1
      ? { chartTop: chart.top, top: last.top, height: last.height, left: last.left, width: last.width }
      : null;
  });
  test.skip(!subPane, "This chart mounted no indicator sub-pane.");

  const anchorY = subPane!.top + subPane!.height * 0.5;
  await page.getByTestId("drawing-group-lines-main").click();
  await page.mouse.move(subPane!.left + subPane!.width * 0.30, anchorY);
  await page.mouse.down();
  await page.mouse.move(subPane!.left + subPane!.width * 0.55, anchorY + 8);
  await page.mouse.up();
  await expect(strokes).toHaveCount(1);
  await expect.poll(() =>
    saves.flatMap((payload) => payload.drawings ?? [])
      .find((drawing) => drawing.kind === "trendline")?.meta?.paneCoordSpace,
  ).toBe("pane-value-v2");

  const geometry = strokes.first().locator('line:not([stroke="transparent"])').first();
  const before = await geometry.boundingBox();
  expect(before).not.toBeNull();
  expect(before!.y).toBeGreaterThanOrEqual(subPane!.top - 1);
  expect(before!.y + before!.height).toBeLessThanOrEqual(subPane!.top + subPane!.height + 1);

  // This is the reported gesture: change the INDICATOR pane's own y-axis range.
  // The draw layer spans the whole chart, while LWC's priceToCoordinate values
  // are pane-local. The drawing must remain translated + clipped to this pane.
  const chartBox = await chart.boundingBox();
  expect(chartBox).not.toBeNull();
  await page.mouse.move(chartBox!.x + chartBox!.width - 6, anchorY);
  for (let notch = 0; notch < 5; notch += 1) await page.mouse.wheel(0, -360);

  await expect.poll(async () => {
    const box = await geometry.boundingBox();
    return box != null
      && box.y >= subPane!.top - 1
      && box.y + box.height <= subPane!.top + subPane!.height + 1;
  }, { message: "the rescaled drawing should settle inside its owning pane" }).toBe(true);
  await expect(strokes.first()).toHaveAttribute("clip-path", /drawing-pane-clip/);
});

test("legacy indicator-pane drawing coordinates migrate into pane value space", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  const saves: DrawingSavePayload[] = [];
  await openTerminal(page, {
    drawings: [{
      id: "legacy-macd-pane",
      kind: "trendline",
      points: [{ t: "2026-06-12", p: 0 }, { t: "2026-06-18", p: 1 }],
      color: "#4d82ff",
      width: 2,
      dash: "solid",
      meta: { pane: "macd" },
    }],
    onPut: (payload) => saves.push(payload),
  });

  await expect.poll(() =>
    saves.flatMap((payload) => payload.drawings ?? [])
      .find((drawing) => drawing.id === "legacy-macd-pane")?.meta?.paneCoordSpace,
    { timeout: 5_000, message: "legacy pane drawings should be persisted in the corrected coordinate space" },
  ).toBe("pane-value-v2");

  const migrated = saves.flatMap((payload) => payload.drawings ?? [])
    .find((drawing) => drawing.id === "legacy-macd-pane");
  expect(migrated?.points).toHaveLength(2);
  expect((migrated?.points?.[0] as { p?: number } | undefined)?.p).not.toBe(0);
  await expect(page.locator('.pane.on .drawing-layer g[data-id="legacy-macd-pane"]'))
    .toHaveAttribute("clip-path", /drawing-pane-clip/);
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

test("collapsing an indicator pane hides its plot and drawings until restore", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, DESKTOP_ONLY);
  await openTerminal(page);

  const layer = page.locator(".pane.on .drawing-layer");
  const strokes = layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])');
  const subPane = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".pane.on .chart-wrap canvas")]
      .map((canvas) => canvas.getBoundingClientRect())
      .filter((rect) => rect.width > 100 && rect.height > 40)
      .sort((a, b) => a.top - b.top);
    const last = boxes[boxes.length - 1];
    return boxes.length > 1 ? { top: last.top, height: last.height, left: last.left, width: last.width } : null;
  });
  test.skip(!subPane, "This chart mounted no indicator sub-pane.");

  const y = subPane!.top + subPane!.height * 0.52;
  await page.getByTestId("drawing-group-lines-main").click();
  await page.mouse.move(subPane!.left + subPane!.width * 0.34, y);
  await page.mouse.down();
  await page.mouse.move(subPane!.left + subPane!.width * 0.58, y + 5);
  await page.mouse.up();
  await expect(strokes).toHaveCount(1);

  await page.mouse.move(subPane!.left + subPane!.width * 0.55, subPane!.top + 8);
  const paneOps = page.locator(".pane-ops:visible");
  await expect(paneOps).toBeVisible();
  await paneOps.getByRole("button", { name: "Collapse pane" }).click();

  const mask = page.locator('[data-collapsed-pane-mask]');
  await expect(mask).toHaveCount(1);
  const collapsed = await mask.boundingBox();
  expect(collapsed).not.toBeNull();
  expect(collapsed!.height).toBeGreaterThan(2);
  expect(collapsed!.height).toBeLessThan(subPane!.height * 0.5);

  const topmostAtCenter = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return {
      mask: el?.getAttribute("data-collapsed-pane-mask") ?? null,
      tag: el?.tagName ?? null,
    };
  }, {
    x: collapsed!.x + collapsed!.width * 0.62,
    y: collapsed!.y + collapsed!.height * 0.5,
  });
  expect(topmostAtCenter.mask).not.toBeNull();

  const collapsedOps = page.locator(".pane-ops:visible");
  await collapsedOps.getByRole("button", { name: "Restore pane" }).click();
  await expect(mask).toHaveCount(0);
  await expect(strokes).toHaveCount(1);
  await expect.poll(async () => {
    const canvases = await page.locator(".pane.on .chart-wrap canvas").evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height).filter((height) => height > 40));
    return Math.max(...canvases);
  }).toBeGreaterThan(collapsed!.height * 2);
});


test("coarse pane collapse hides plot paint and remains restorable", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) > 860, "Coarse legend path only.");
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["stochrsi"]));
    localStorage.setItem("mm.lang", "en");
  });
  await openTerminal(page);

  const stoch = page.locator(".lg-row").filter({ hasText: /Stochastic RSI/i }).first();
  const legendToggle = page.locator(".lg-collapse").first();
  if (!(await stoch.isVisible().catch(() => false)) && await legendToggle.count()) {
    await legendToggle.click();
  }
  await expect(stoch).toBeVisible({ timeout: 10_000 });

  await stoch.locator(".lg-name").click();
  await expect(stoch).toHaveClass(/is-armed/);
  await stoch.getByRole("button", { name: "More" }).click();
  const menu = page.locator(".lg-more:visible");
  await expect(menu).toBeVisible();
  const collapseRow = menu.getByText("Collapse pane", { exact: true });
  const collapseBox = await collapseRow.boundingBox();
  expect(collapseBox).not.toBeNull();
  const collapseHit = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return {
      insideMenu: !!hit?.closest(".lg-more"),
      className: (hit as HTMLElement | null)?.className ?? "",
    };
  }, {
    x: collapseBox!.x + collapseBox!.width * 0.5,
    y: collapseBox!.y + collapseBox!.height * 0.5,
  });
  expect(collapseHit.insideMenu).toBe(true);
  await collapseRow.click();

  const mask = page.locator("[data-collapsed-pane-mask]");
  await expect(mask).toHaveCount(1);
  const collapsed = await mask.boundingBox();
  expect(collapsed).not.toBeNull();
  expect(collapsed!.height).toBeGreaterThan(2);
  expect(collapsed!.height).toBeLessThan(40);

  // LWC's pane separator deliberately owns the top paint slot while resizing. The opaque
  // collapsed-pane mask must still paint above both pane canvases, which hides series and
  // persisted drawing SVG output without disabling the separator.
  const stack = await page.evaluate(({ x, y }) =>
    document.elementsFromPoint(x, y).map((el) => ({
      tag: el.tagName,
      mask: el.getAttribute("data-collapsed-pane-mask"),
    })),
  {
    x: collapsed!.x + collapsed!.width * 0.65,
    y: collapsed!.y + collapsed!.height * 0.5,
  });
  const maskIndex = stack.findIndex((entry) => entry.mask != null);
  const canvasIndex = stack.findIndex((entry) => entry.tag === "CANVAS");
  expect(maskIndex).toBeGreaterThanOrEqual(0);
  expect(canvasIndex).toBeGreaterThan(maskIndex);

  const collapsedOps = page.locator(".pane-ops.is-collapsed:visible");
  await expect(collapsedOps).toBeVisible();
  const restore = collapsedOps.getByRole("button", { name: "Restore pane" });
  await expect(restore).toBeVisible();
  if (isPhone(page)) {
    // Phone still retires ordinary pane ops; collapse exposes exactly one recovery affordance.
    await expect(collapsedOps.locator("button:visible")).toHaveCount(1);
  }
  await restore.click();
  await expect(mask).toHaveCount(0);
});
