import { expect, test, type Locator, type Page } from "./fixtures";
import { chooseToolbarSplit, runToolbarDetector, toggleToolbarReplay } from "./terminalToolbar";

type SavePayload = { drawings?: Array<{ id?: string; kind?: string; locked?: boolean; color?: string; meta?: Record<string, unknown> }> };

async function openTerminal(page: Page, options: { drawings?: unknown[]; onPut?: (payload: SavePayload) => void } = {}) {
  await page.route("**/api/drawings**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drawings: options.drawings ?? [] }) });
      return;
    }
    try { options.onPut?.(route.request().postDataJSON()); } catch {}
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.addInitScript(() => {
    localStorage.removeItem("mm.draw");
    localStorage.removeItem("mm.drawing.preferences");
    localStorage.removeItem("mm.drawing.recentColors.v1");
    const ready = window as Window & { __drawingReady?: boolean };
    ready.__drawingReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { ready.__drawingReady = true; }, { once: true });
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __drawingReady?: boolean }).__drawingReady)), { timeout: 15_000 }).toBe(true);
}

async function lineGeometry(line: Locator) {
  return line.evaluate((node) => {
    const element = node as SVGLineElement;
    return {
      x1: Number(element.getAttribute("x1")),
      y1: Number(element.getAttribute("y1")),
      x2: Number(element.getAttribute("x2")),
      y2: Number(element.getAttribute("y2")),
    };
  });
}

test("professional drawing placement, angle lock, keyboard editing, and cloning stay atomic", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, "Precision keyboard mechanics run once on desktop.");
  await openTerminal(page);

  const layer = page.locator(".pane.on .drawing-layer");
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  const point = (x: number, y: number) => ({ x: box!.x + box!.width * x, y: box!.y + box!.height * y });
  const trendlineButton = page.getByTestId("drawing-group-lines-main");
  const cursor = page.getByTestId("drawing-tool-cursor");
  const committed = layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])');

  // A stationary first click keeps one preview alive; the second click commits.
  await trendlineButton.click();
  const a = point(.23, .34), b = point(.57, .52);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y);
  await expect(layer.locator('g[data-id="_p"][data-drawing-kind="trendline"]')).toHaveCount(1);
  await expect(committed).toHaveCount(0);
  await page.mouse.click(b.x, b.y);
  await expect(committed).toHaveCount(1);
  await expect(cursor).toHaveAttribute("aria-pressed", "true");

  // Shift constrains a shallow gesture to a mathematically horizontal line.
  await trendlineButton.click();
  const c = point(.28, .66), d = point(.66, .70);
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(d.x, d.y, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(committed).toHaveCount(2);
  const constrained = committed.last().locator('line:not([stroke="transparent"])').first();
  const constrainedGeometry = await lineGeometry(constrained);
  expect(Math.abs(constrainedGeometry.y2 - constrainedGeometry.y1)).toBeLessThanOrEqual(1.5);

  // Select, nudge one bar, copy/paste, then command-drag another detached clone.
  const editable = committed.first().locator('line:not([stroke="transparent"])').first();
  const hit = committed.first().locator('line[stroke="transparent"]').first();
  await hit.click({ position: { x: 12, y: 6 } });
  const beforeNudge = await lineGeometry(editable);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await lineGeometry(editable)).x1).not.toBe(beforeNudge.x1);
  await page.keyboard.press("Meta+C");
  await page.keyboard.press("Meta+V");
  await expect(committed).toHaveCount(3);

  const pasteHit = committed.last().locator('line[stroke="transparent"]').first();
  const pasteGeometry = await lineGeometry(committed.last().locator('line:not([stroke="transparent"])').first());
  const svgBox = await layer.boundingBox();
  await page.keyboard.down("Meta");
  await page.mouse.move(svgBox!.x + (pasteGeometry.x1 + pasteGeometry.x2) / 2, svgBox!.y + (pasteGeometry.y1 + pasteGeometry.y2) / 2);
  await page.mouse.down();
  await page.mouse.move(svgBox!.x + (pasteGeometry.x1 + pasteGeometry.x2) / 2 + 54, svgBox!.y + (pasteGeometry.y1 + pasteGeometry.y2) / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Meta");
  await expect(committed).toHaveCount(4);
  await expect(pasteHit).toHaveCount(1);
});

test("Fibonacci and position inspectors drive durable analytical settings", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, "Dense analytical settings run once on desktop.");
  const saves: SavePayload[] = [];
  await openTerminal(page, {
    drawings: [
      { id: "settings-fib", kind: "fib", source: "user", points: [{ t: "2026-05-20", p: 176 }, { t: "2026-06-17", p: 210 }], color: "#4d82ff", width: 1.5, dash: "dashed", fillOpacity: .07 },
      { id: "settings-position", kind: "longposition", source: "user", points: [{ t: "2026-06-03", p: 198 }, { t: "2026-06-24", p: 216 }, { t: "2026-06-24", p: 189 }], color: "#4d82ff", fillOpacity: .2 },
    ],
    onPut: (payload) => saves.push(payload),
  });

  const layer = page.locator(".pane.on .drawing-layer");
  const inspector = page.getByRole("toolbar", { name: "Selected drawing properties" });
  const fib = layer.locator('g[data-id="settings-fib"]');
  const fibHit = fib.locator('line[stroke="transparent"]').last();
  await fibHit.dispatchEvent("pointerdown", { bubbles: true, pointerId: 501, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: 240, clientY: 240 });
  await fibHit.dispatchEvent("pointerup", { bubbles: true, pointerId: 501, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0, clientX: 240, clientY: 240 });
  await expect(inspector).toHaveAttribute("data-drawing-id", "settings-fib");
  await inspector.locator("[data-settings]").click();
  const fibSettings = inspector.locator('.draw-settings[data-settings-kind="fib"]');
  await expect(fibSettings).toBeVisible();
  await expect(fibSettings.locator("[data-fib-level]")).toHaveCount(24);
  await fibSettings.locator("[data-fib-reverse]").check();
  await fibSettings.locator("[data-fib-labels]").selectOption("price");
  await fibSettings.locator('[data-fib-value="0"]').fill("-7.25");
  await fibSettings.locator('[data-fib-value="0"]').press("Tab");
  await fibSettings.locator('[data-fib-level="0"]').check();
  await expect.poll(() => saves.some((payload) => payload.drawings?.some((drawing) => drawing.id === "settings-fib"
    && drawing.meta?.fibReverse === true
    && drawing.meta?.fibLabels === "price"
    && Array.isArray(drawing.meta?.fibLevelStyles)
    && (drawing.meta.fibLevelStyles as Array<{ value?: number }>)[0]?.value === -7.25)), { timeout: 5_000 }).toBe(true);

  const position = layer.locator('g[data-id="settings-position"]');
  const positionHit = position.locator("rect").first();
  await positionHit.dispatchEvent("pointerdown", { bubbles: true, pointerId: 502, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: 320, clientY: 320 });
  await positionHit.dispatchEvent("pointerup", { bubbles: true, pointerId: 502, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0, clientX: 320, clientY: 320 });
  await expect(inspector).toHaveAttribute("data-drawing-id", "settings-position");
  const positionSettings = inspector.locator('.draw-settings[data-settings-kind="longposition"]');
  if (!await positionSettings.isVisible()) await inspector.locator("[data-settings]").click();
  await expect(positionSettings).toBeVisible();
  await positionSettings.locator("[data-position-account]").fill("25000");
  await positionSettings.locator("[data-position-account]").press("Tab");
  await positionSettings.locator("[data-position-risk]").fill("2");
  await positionSettings.locator("[data-position-risk]").press("Tab");
  await expect.poll(() => saves.some((payload) => payload.drawings?.some((drawing) => drawing.id === "settings-position"
    && drawing.meta?.accountSize === 25_000
    && drawing.meta?.riskPercent === 2)), { timeout: 5_000 }).toBe(true);
  await expect(positionSettings.locator(".draw-position-summary")).toContainText("500");
  await positionSettings.locator("[data-position-risk-mode]").selectOption("money");
  await positionSettings.locator("[data-position-risk-amount]").fill("750");
  await positionSettings.locator("[data-position-risk-amount]").press("Tab");
  await expect.poll(() => saves.some((payload) => payload.drawings?.some((drawing) => drawing.id === "settings-position"
    && drawing.meta?.riskMode === "money"
    && drawing.meta?.riskAmount === 750)), { timeout: 5_000 }).toBe(true);
  await expect(positionSettings.locator(".draw-position-summary")).toContainText("750");
});

test("Replay hard-locks drawings and the quick bar keeps current plus recent colors", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, "Replay precision mechanics run once on desktop.");
  const saves: SavePayload[] = [];
  await openTerminal(page, {
    drawings: [
      { id: "replay-lock", kind: "trendline", source: "user", points: [{ t: "2026-05-20", p: 176 }, { t: "2026-06-17", p: 210 }], color: "#4d82ff", width: 2, dash: "solid" },
      { id: "replay-text", kind: "text", source: "user", points: [{ t: "2026-06-03", p: 198 }], text: "Replay note", color: "#4d82ff" },
      { id: "locked-text", kind: "text", source: "user", points: [{ t: "2026-06-10", p: 192 }], text: "Locked note", color: "#4d82ff", locked: true },
    ],
    onPut: (payload) => saves.push(payload),
  });

  const layer = page.locator(".pane.on .drawing-layer");
  const drawing = layer.locator('g[data-id="replay-lock"]');
  const replayText = layer.locator('g[data-id="replay-text"]');
  const lockedText = layer.locator('g[data-id="locked-text"]');
  const visibleLine = drawing.locator('line:not([stroke="transparent"])').first();
  const hitLine = drawing.locator('line[stroke="transparent"]').first();
  const inspector = page.getByRole("toolbar", { name: "Selected drawing properties" });
  const select = async (pointerId: number) => {
    await hitLine.dispatchEvent("pointerdown", { bubbles: true, pointerId, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: 360, clientY: 280 });
    await hitLine.dispatchEvent("pointerup", { bubbles: true, pointerId, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0, clientX: 360, clientY: 280 });
  };

  await lockedText.locator("text").first().dispatchEvent("dblclick", { bubbles: true, button: 0, clientX: 320, clientY: 300 });
  await expect(page.locator(".text-edit")).toHaveCount(0);

  await select(701);
  await expect(inspector).toBeVisible();
  await expect(inspector.locator('[data-color-role="current"]')).toHaveAttribute("data-c", "#4d82ff");
  await expect(inspector.locator('[data-color-role="recent"]')).toHaveCount(2);
  const picker = inspector.locator('[data-color-role="picker"]');
  await expect(picker).toBeVisible();
  const customColor = picker.locator('[data-custom-color="1"]');
  await expect(customColor).toBeVisible();
  await customColor.evaluate((node) => {
    const input = node as HTMLInputElement;
    input.value = "#8b5cf6";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(inspector.locator('[data-color-role="current"]')).toHaveAttribute("data-c", "#8b5cf6");
  await expect(inspector.locator('[data-color-role="recent"][data-c="#4d82ff"]')).toHaveCount(1);
  await inspector.locator('[data-color-role="recent"][data-c="#26c281"]').click();
  await expect(inspector.locator('[data-color-role="current"]')).toHaveAttribute("data-c", "#26c281");
  await expect(inspector.locator('[data-color-role="recent"][data-c="#8b5cf6"]')).toHaveCount(1);
  await expect(inspector.locator('[data-color-role="recent"][data-c="#4d82ff"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.drawing.recentColors.v1") || "[]"))).toEqual(["#26c281", "#8b5cf6", "#4d82ff"]);
  await expect.poll(() => saves.some((payload) => payload.drawings?.some((item) => item.id === "replay-lock" && item.color === "#26c281"))).toBe(true);
  const saveCountBeforeReplay = saves.length;

  await toggleToolbarReplay(page);
  await expect(drawing).toHaveAttribute("data-replay-locked", "true");
  await expect(drawing).toHaveAttribute("pointer-events", "none");
  await expect(inspector).toBeHidden();

  await replayText.locator("text").first().dispatchEvent("dblclick", { bubbles: true, button: 0, clientX: 330, clientY: 310 });
  await expect(page.locator(".text-edit")).toHaveCount(0);

  // Direct-dispatched events deliberately bypass hit testing. Replay still
  // rejects selection, drag, wheel recolor, delete and keyboard movement.
  await hitLine.dispatchEvent("pointerdown", { bubbles: true, pointerId: 702, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: 360, clientY: 280 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 702, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: 430, clientY: 330 })));
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 702, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0, clientX: 430, clientY: 330 })));
  await hitLine.dispatchEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await expect(drawing).toHaveCount(1);
  await expect(drawing).toHaveAttribute("data-replay-locked", "true");
  // Replay changes the visible bar domain, so SVG coordinates can legitimately
  // rescale. The persistence boundary is the invariant: no edit may commit.
  await page.waitForTimeout(500);
  expect(saves).toHaveLength(saveCountBeforeReplay);
  await expect(drawing).toHaveAttribute("style", /cursor:default/);

  // Shift+drag Measure bypasses the armed-tool rail, so it needs the same
  // Replay/grid creation gate rather than relying on tool === null.
  const replayBox = await layer.boundingBox();
  expect(replayBox).not.toBeNull();
  await page.keyboard.down("Shift");
  await page.mouse.move(replayBox!.x + replayBox!.width * .22, replayBox!.y + replayBox!.height * .68);
  await page.mouse.down();
  await page.mouse.move(replayBox!.x + replayBox!.width * .58, replayBox!.y + replayBox!.height * .42, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(layer.locator('g[data-drawing-kind="measure"]')).toHaveCount(0);

  await toggleToolbarReplay(page);
  await expect(drawing).toHaveAttribute("data-replay-locked", "false");
  await expect(drawing).toHaveAttribute("pointer-events", "all");
  await select(703);
  await expect(inspector).toBeVisible();
  const afterReplay = await lineGeometry(visibleLine);
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await lineGeometry(visibleLine)).y1).not.toBe(afterReplay.y1);

  await page.keyboard.press("Escape");
  await chooseToolbarSplit(page, 2);
  await expect(page.getByTestId("drawing-toolbar")).toHaveAttribute("data-creation-disabled", "multi-chart");
  const activeLayer = page.locator(".pane.on .drawing-layer");
  const gridBox = await activeLayer.boundingBox();
  expect(gridBox).not.toBeNull();
  await page.keyboard.down("Shift");
  await page.mouse.move(gridBox!.x + gridBox!.width * .20, gridBox!.y + gridBox!.height * .72);
  await page.mouse.down();
  await page.mouse.move(gridBox!.x + gridBox!.width * .56, gridBox!.y + gridBox!.height * .46, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator('g[data-drawing-kind="measure"]')).toHaveCount(0);
});

test("drawing toolbar and favorite controls retain focus across responsive remounts", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, "The focus transition starts in the desktop rail.");
  await page.addInitScript(() => {
    localStorage.setItem("mm.drawing.favorites.v1", JSON.stringify({
      ids: ["trendline"],
      visible: true,
      positions: { desktop: { x: 72, y: 12 }, compact: { x: 12, y: 54 } },
    }));
  });
  await openTerminal(page);

  const lineGroup = page.getByTestId("drawing-group-lines-main");
  await lineGroup.focus();
  await expect(lineGroup).toBeFocused();
  // 820x1180 is the compact-dock breakpoint now: R2.1 removed the dock from the PHONE
  // (≤640px) altogether, so the dock's own responsive remount is a tablet transition.
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.getByTestId("drawing-group-lines-main")).toBeFocused();

  const favoriteTool = page.getByTestId("drawing-favorite-tool-trendline");
  await expect(favoriteTool).toBeVisible();
  await favoriteTool.focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("drawing-favorite-tool-trendline")).toBeFocused();

  const hide = page.getByTestId("drawing-favorites-hide");
  await hide.focus();
  await hide.press("Enter");
  await expect(page.getByTestId("drawing-favorites-strip")).toBeHidden();
  await expect(page.getByTestId("drawing-favorites-toggle")).toBeFocused();
});

test("bulk drawing controls preserve source scopes and lock only user-authored objects", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, "Bulk semantics run once on desktop.");
  const saves: SavePayload[] = [];
  await openTerminal(page, {
    drawings: [
      { id: "bulk-user", kind: "trendline", source: "user", points: [{ t: "2026-05-20", p: 176 }, { t: "2026-06-17", p: 210 }] },
      { id: "bulk-detector", kind: "hline", source: "detector", auto: true, points: [{ t: "2026-06-17", p: 188 }] },
    ],
    onPut: (payload) => saves.push(payload),
  });

  const lockAll = page.getByTestId("drawing-lock-all");
  await expect(lockAll).toHaveAttribute("data-user-drawing-count", "1");
  await lockAll.click();
  await expect.poll(() => saves.some((payload) => {
    const user = payload.drawings?.find((drawing) => drawing.id === "bulk-user");
    const detector = payload.drawings?.find((drawing) => drawing.id === "bulk-detector");
    return user?.locked === true && detector?.locked !== true;
  }), { timeout: 5_000 }).toBe(true);

  await page.getByTestId("drawing-clear-trigger").click();
  const clearDetected = page.getByTestId("drawing-clear-detected");
  await expect(clearDetected).toContainText("1");
  await clearDetected.click();
  await expect.poll(() => saves.some((payload) => (
    payload.drawings?.length === 1 && payload.drawings[0]?.id === "bulk-user"
  )), { timeout: 5_000 }).toBe(true);

  await page.getByTestId("drawing-clear-trigger").click();
  await page.getByTestId("drawing-clear-user").click();
  await expect.poll(() => saves.some((payload) => payload.drawings?.length === 0), { timeout: 5_000 }).toBe(true);
});

test("detector commands remain scoped to the pane that dispatched them", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) <= 860, "Pane command routing runs once on desktop.");
  await openTerminal(page);

  await chooseToolbarSplit(page, 2);
  const panes = page.locator(".pane-grid > .pane");
  await expect(panes).toHaveCount(2);

  const detectFib = async () => {
    await runToolbarDetector(page, "Auto Fibonacci");
  };
  const paneFib = (index: number) => panes.nth(index).locator('g[data-drawing-kind="fib"]');

  await detectFib();
  await expect(paneFib(0)).toHaveCount(1);
  await panes.nth(1).locator(".pane-hd").click();
  await expect(panes.nth(1)).toHaveClass(/\bon\b/);
  await expect(paneFib(1)).toHaveCount(0);

  await detectFib();
  await expect(paneFib(1)).toHaveCount(1);
  await page.getByTestId("drawing-clear-trigger").click();
  await page.getByTestId("drawing-clear-detected").click();
  await expect(paneFib(1)).toHaveCount(0);

  await panes.nth(0).locator(".pane-hd").click();
  await expect(panes.nth(0)).toHaveClass(/\bon\b/);
  await expect(paneFib(0)).toHaveCount(1);
});
