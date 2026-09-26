import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const PHONE_PROJECT = "mobile";

async function openTerminal(page: Page, lang: "en" | "zh" = "en", symbol = "NVDA") {
  await page.addInitScript((language) => {
    localStorage.setItem("mm.lang", language);
    const ready = window as Window & { __mmChartHubReady?: boolean };
    ready.__mmChartHubReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      ready.__mmChartHubReady = true;
    }, { once: true });
  }, lang);
  await page.goto(`/terminal?symbol=${encodeURIComponent(symbol)}`);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmChartHubReady?: boolean }).__mmChartHubReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 20_000 },
  ).toBe(true);
}

async function openHub(page: Page) {
  const trigger = page.getByTestId("roller-more");
  await expect(trigger).toBeVisible();
  await trigger.click();
  const hub = page.getByRole("dialog", { name: /Analysis hub|分析中心/ });
  await expect(hub).toBeVisible();
  return { hub, trigger };
}

function supportedHubControls(hub: Locator) {
  return [
    hub.getByRole("button", { name: /Close|关闭/ }),
    hub.getByTestId("hub-tile-indicators"),
    hub.getByTestId("hub-tile-compare"),
    hub.getByTestId("hub-tile-alerts"),
    hub.getByTestId("hub-tile-chartType"),
    hub.getByTestId("hub-tile-workspaces"),
    hub.getByTestId("hub-tile-options"),
    hub.getByTestId("hub-tile-symbolDetails"),
  ];
}

async function activeElementIsInside(locator: Locator) {
  return locator.evaluate((root) => root.contains(document.activeElement));
}

async function dragHubDown(page: Page, hub: Locator) {
  const grip = await hub.locator(".mhub-grip").boundingBox();
  if (!grip) throw new Error("Analysis hub grip has no geometry");
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 170, { steps: 6 });
  await page.mouse.up();
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== PHONE_PROJECT, "Session B runs once in the phone project and resizes explicitly for tablet/desktop parity.");
});

test("MM-005: the hub owns the complete keyboard cycle and returns focus on dismissal", async ({ page }) => {
  await openTerminal(page);
  const { hub, trigger } = await openHub(page);
  const controls = supportedHubControls(hub);

  await expect(controls[0]).toBeFocused();
  for (let index = 1; index < controls.length; index += 1) {
    await page.keyboard.press("Tab");
    await expect(controls[index]).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(controls[0]).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(controls.at(-1)!).toBeFocused();
  expect(await activeElementIsInside(hub)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(hub).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await openHub(page);
  await page.locator(".mhub-scrim").click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId("analysis-hub")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const dragged = await openHub(page);
  await dragHubDown(page, dragged.hub);
  await expect(dragged.hub).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("MM-005: focus hands into supported overlays without racing back to the dismissed hub", async ({ page }) => {
  await openTerminal(page);
  const { hub, trigger } = await openHub(page);

  await hub.getByTestId("hub-tile-indicators").click();
  await expect(hub).toHaveCount(0);
  const indicators = page.locator("#indicator-library-dialog");
  await expect(indicators).toBeVisible();
  await expect.poll(() => activeElementIsInside(indicators)).toBe(true);
  await expect(trigger).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(indicators).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const reopened = await openHub(page);
  await reopened.hub.getByTestId("hub-tile-compare").click();
  const compare = page.locator(".smodal-cmp");
  await expect(compare).toBeVisible();
  await expect.poll(() => activeElementIsInside(compare)).toBe(true);
  await expect(reopened.hub).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
});

test("MM-006: only supported tools are actionable and chart type uses canonical persistent state", async ({ page }) => {
  await openTerminal(page);
  const { hub, trigger } = await openHub(page);

  await expect(hub.locator(".mhub-grid .mhub-tile")).toHaveCount(7);
  await expect(hub.getByTestId("hub-tile-options")).toBeEnabled();
  await expect(hub.getByTestId("hub-tile-objectTree")).toHaveCount(0);
  await expect(hub.getByTestId("hub-tile-templates")).toHaveCount(0);
  await expect(hub.getByTestId("hub-unavailable-tools")).toContainText("This panel isn't available in this version");
  await expect(hub.getByTestId("hub-unavailable-tools")).toContainText("Object tree");
  await expect(hub.getByTestId("hub-unavailable-tools")).not.toContainText("Templates");
  await expect(hub).not.toContainText("Not in this alpha");

  await hub.getByTestId("hub-tile-workspaces").tap();
  await expect(hub).toHaveCount(0);
  const workspaces = page.locator(".phone-workspaces-sheet:has([data-layout-save])");
  await expect(workspaces).toBeVisible();
  await expect(page.locator(".chart-tabs")).toBeHidden();

  // Rotating through the tablet breakpoint must dismiss the phone-only sheet permanently.
  // Returning to phone width should restore the phone chrome without resurrecting stale UI.
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(workspaces).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspaces).toHaveCount(0);

  const reopenedWorkspaces = await openHub(page);
  await reopenedWorkspaces.hub.getByTestId("hub-tile-workspaces").tap();
  await expect(workspaces).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(workspaces).toHaveCount(0);

  const chartHub = await openHub(page);
  await chartHub.hub.getByTestId("hub-tile-chartType").tap();
  await expect(chartHub.hub).toHaveCount(0);
  const picker = page.getByRole("dialog", { name: "Chart type" });
  await expect(picker).toBeVisible();
  await expect.poll(() => activeElementIsInside(picker)).toBe(true);
  await picker.getByRole("button", { name: "Line", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.ct") || "null"))).toBe("line");
  await expect(trigger).toBeFocused();

  const reopened = await openHub(page);
  await reopened.hub.getByTestId("hub-tile-chartType").click();
  const reopenedPicker = page.getByRole("dialog", { name: "Chart type" });
  await expect(reopenedPicker.getByRole("button", { name: /^Line(?: ✓)?$/ })).toHaveClass(/\bon\b/);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator(".chart-tabs")).toBeVisible();
  await expect(page.locator(".chart-tabs .pophost").filter({ has: page.locator(".chart-type-pop") }).locator("button.tbtn")).toContainText("Line");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".chart-tabs")).toBeVisible();
  await expect(page.locator(".chart-tabs .pophost").filter({ has: page.locator(".chart-type-pop") }).locator("button.tbtn")).toContainText("Line");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileAgain = await openHub(page);
  await mobileAgain.hub.getByTestId("hub-tile-chartType").click();
  await expect(page.getByRole("dialog", { name: "Chart type" }).getByRole("button", { name: /^Line(?: ✓)?$/ })).toHaveClass(/\bon\b/);
});

test("MM-006: Alerts and Symbol details act on the current symbol", async ({ page }) => {
  await openTerminal(page, "en", "AAPL");
  await page.evaluate(() => window.scrollTo(0, 0));
  const detailBoard = page.locator(".detail-board");
  await expect(detailBoard).toContainText("AAPL");

  const { hub, trigger } = await openHub(page);
  await hub.getByTestId("hub-tile-symbolDetails").tap();
  await expect(hub).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(
    () => detailBoard.evaluate((element) => element.getBoundingClientRect().top),
    { message: "Symbol details should scroll the current dossier to the viewport", timeout: 10_000 },
  ).toBeLessThan(96);

  const reopened = await openHub(page);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/alerts" && url.searchParams.get("sym") === "AAPL"),
    reopened.hub.getByTestId("hub-tile-alerts").tap(),
  ]);
  expect(new URL(page.url()).searchParams.get("sym")).toBe("AAPL");
});

test("MM-006: EN and ZH expose the same truthful capability decisions", async ({ page }) => {
  await openTerminal(page, "zh");
  const { hub } = await openHub(page);

  await expect(hub.getByTestId("hub-unavailable-tools")).toContainText("此面板在当前版本中不可用");
  await expect(hub.getByTestId("hub-unavailable-tools")).toContainText("对象树");
  await expect(hub.getByTestId("hub-unavailable-tools")).not.toContainText("模板");
  await expect(hub).not.toContainText("此版本暂未提供");
  await hub.getByTestId("hub-tile-chartType").click();
  await expect(page.getByRole("dialog", { name: "图表类型" })).toBeVisible();
});

test("MM-005/MM-006: hub controls stay nonoverlapping and reachable across phone widths", async ({ page }) => {
  await openTerminal(page);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const { hub } = await openHub(page);
    const geometry = await hub.evaluate((root) => {
      const viewportWidth = document.documentElement.clientWidth;
      const controls = Array.from(root.querySelectorAll<HTMLElement>("button.mhub-tile, button.mhub-close"));
      const rects = controls.map((control) => {
        const rect = control.getBoundingClientRect();
        const before = getComputedStyle(control, "::before");
        const insetX = Number.parseFloat(before.left) || 0;
        const insetY = Number.parseFloat(before.top) || 0;
        return {
          left: rect.left + Math.min(0, insetX),
          right: rect.right - Math.min(0, insetX),
          top: rect.top + Math.min(0, insetY),
          bottom: rect.bottom - Math.min(0, insetY),
          hitWidth: rect.width + 2 * Math.abs(Math.min(0, insetX)),
          hitHeight: rect.height + 2 * Math.abs(Math.min(0, insetY)),
        };
      });
      const overlaps = rects.some((a, index) => rects.slice(index + 1).some((b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5));
      return {
        viewportWidth,
        documentWidth: document.documentElement.scrollWidth,
        rects,
        overlaps,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.overlaps).toBe(false);
    for (const rect of geometry.rects) {
      expect(rect.hitWidth).toBeGreaterThanOrEqual(44);
      expect(rect.hitHeight).toBeGreaterThanOrEqual(44);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width + 0.5);
    }
    await page.keyboard.press("Escape");
    await expect(hub).toHaveCount(0);
  }
});
