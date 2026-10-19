import { expect, test, type Page } from "@playwright/test";

const IMPL_QUERY = [
  { label: "lwc", query: "" },
  { label: "engine-mm-query", query: "&engine=mm" },
] as const;

const SEED_TRENDLINE = {
  id: "e2e-engine-trend",
  kind: "trendline",
  points: [{ t: "2024-06-03", p: 180 }, { t: "2024-06-10", p: 195 }],
  schemaVersion: 1,
  source: "user",
  locked: false,
  hidden: false,
  z: 0,
  color: "var(--brand-2)",
  width: 2,
  dash: "solid",
  opacity: 1,
  extend: "none",
};

type DrawWindow = Window & {
  __mmChartEngineImpl?: () => string | null;
};

async function mountedImpl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as DrawWindow;
    const hook = w.__mmChartEngineImpl?.();
    if (hook != null) return hook;
    return document.querySelector("[data-chart-engine]")?.getAttribute("data-chart-engine") ?? null;
  });
}

async function bootChart(page: Page, query: string, drawings: unknown[] = []) {
  const store = { drawings: [...drawings] };
  await page.route("**/api/drawings**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ drawings: store.drawings }),
      });
      return;
    }
    const body = route.request().postDataJSON() as {
      drawings?: Array<{ source?: string }>; owner_id?: string; aiSchemaVersion?: number;
    };
    if (Array.isArray(body.drawings)) store.drawings = body.drawings.filter(d => d.source !== "detector");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, aiSchemaVersion: 1, owner_id: body.owner_id, count: store.drawings.length,
    }) });
  });
  await page.goto(`/terminal?symbol=AAPL${query}`);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => mountedImpl(page), { timeout: 30_000 }).not.toBeNull();
  test.info().annotations.push({ type: "mountedEngineImpl", description: String(await mountedImpl(page)) });
  await expect(page.locator(".pane.on .drawing-layer")).toBeVisible();
  return store;
}

for (const impl of IMPL_QUERY) {
  test.describe(`chart-engine drawings [${impl.label}]`, () => {
    test("A01: stored document renders on default and engine=mm routes", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Heavy drawing case is desktop-only.");
      const layer = page.locator(".pane.on .drawing-layer");
      await bootChart(page, impl.query, [SEED_TRENDLINE]);
      await expect(layer.locator(`g[data-drawing-id="${SEED_TRENDLINE.id}"]`)).toHaveCount(1, { timeout: 20_000 });
      const altQuery = impl.query.includes("engine=mm") ? "" : "&engine=mm";
      await bootChart(page, altQuery, [SEED_TRENDLINE]);
      await expect(layer.locator(`g[data-drawing-id="${SEED_TRENDLINE.id}"]`)).toHaveCount(1, { timeout: 20_000 });
    });

    test("A04: NOSUCH.TEST empty pane does not overwrite stored drawings", async ({ page }) => {
      const store = await bootChart(page, impl.query, [SEED_TRENDLINE]);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: "NOSUCH.TEST" } })));
      await expect.poll(async () => page.locator(".chart-empty").isVisible(), { timeout: 30_000 }).toBe(true);
      expect(store.drawings).toHaveLength(1);
      expect((store.drawings[0] as { id: string }).id).toBe(SEED_TRENDLINE.id);
    });
  });
}

test.describe("chart-engine drawings [mobile A03]", () => {
  test("A03: seeded drawing projects on 390×844 mobile viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "A03 runs in the mobile project.");
    const layer = page.locator(".pane.on .drawing-layer");
    await bootChart(page, "", [SEED_TRENDLINE]);
    const line = layer.locator(`g[data-drawing-id="${SEED_TRENDLINE.id}"]`);
    await expect(line).toBeVisible({ timeout: 45_000 });
    const box = await line.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(4);
    expect(box!.height).toBeGreaterThan(4);
  });
});

test.describe("chart-engine drawings [mobile A03 handle grab]", () => {
  test.use({ deviceScaleFactor: 2 });

  for (const impl of IMPL_QUERY) {
    test(`A03: DOM handle grab at DPR 2 [${impl.label}]`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "A03 handle grab runs in the mobile project.");
      const dpr = await page.evaluate(() => window.devicePixelRatio);
      test.info().annotations.push({ type: "devicePixelRatio", description: String(dpr) });

      const store = await bootChart(page, impl.query, [SEED_TRENDLINE]);
      const layer = page.locator(".pane.on .drawing-layer");
      const drawing = layer.locator(`g[data-drawing-id="${SEED_TRENDLINE.id}"]`);
      await expect(drawing).toBeVisible({ timeout: 45_000 });
      const visibleLine = drawing.locator('line[data-geometry="1"]').first();
      await expect(visibleLine).toBeVisible({ timeout: 15_000 });
      // The drawing layer re-renders (React replaces the <g>) while the chart settles, so one
      // measurement right after toBeVisible can land on a fresh, unlaid-out node and read 0.
      let select = { x: 0, y: 0 };
      await expect.poll(async () => {
        select = await visibleLine.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        return select.x > 0 && select.y > 0;
      }, { timeout: 15_000 }).toBe(true);
      expect(select.x).toBeGreaterThan(0);
      expect(select.y).toBeGreaterThan(0);
      await page.mouse.click(select.x, select.y);

      const grip = drawing.locator("circle[data-handle]").first();
      await expect(grip).toBeVisible({ timeout: 15_000 });
      let gripCenter = { x: 0, y: 0 };
      await expect.poll(async () => {
        gripCenter = await grip.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        return gripCenter.x > 0 && gripCenter.y > 0;
      }, { timeout: 15_000 }).toBe(true);

      const before = JSON.parse(JSON.stringify(store.drawings[0])) as { points: { t: string; p: number }[] };
      const startX = gripCenter.x + 3;
      const startY = gripCenter.y;
      const pointerId = 12;
      await grip.dispatchEvent("pointerdown", {
        bubbles: true, pointerId, pointerType: "touch", isPrimary: true, button: 0, buttons: 1,
        clientX: startX, clientY: startY,
      });
      await page.evaluate(({ pointerId, x, y }) => {
        window.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true, pointerId, pointerType: "touch", isPrimary: true, buttons: 1, clientX: x, clientY: y,
        }));
      }, { pointerId, x: startX + 40, y: startY + 40 });
      await page.evaluate(({ pointerId, x, y }) => {
        window.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true, pointerId, pointerType: "touch", isPrimary: true, button: 0, buttons: 0, clientX: x, clientY: y,
        }));
      }, { pointerId, x: startX + 40, y: startY + 40 });
      await expect.poll(() => {
        const row = store.drawings[0] as { points: { t: string; p: number }[] };
        return row.points[0].p !== before.points[0].p || row.points[0].t !== before.points[0].t;
      }, { timeout: 15_000 }).toBe(true);
      const afterGrab = store.drawings[0] as { points: { t: string; p: number }[] };
      expect(afterGrab.points[1]).toEqual(before.points[1]);

      const grips = drawing.locator("circle[data-handle]");
      const boxes = await grips.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect()),
      );
      expect(boxes.length).toBeGreaterThanOrEqual(2);
      const ghostX = (boxes[0].left + boxes[1].right) / 2;
      const ghostY = boxes[0].top - 20;
      const ghostBefore = JSON.parse(JSON.stringify(store.drawings[0]));
      const ghostPointer = 13;
      await page.evaluate(({ pointerId, x, y }) => {
        window.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, pointerId, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y,
        }));
      }, { pointerId: ghostPointer, x: ghostX, y: ghostY });
      await page.evaluate(({ pointerId, x, y }) => {
        window.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true, pointerId, pointerType: "touch", isPrimary: true, buttons: 1, clientX: x, clientY: y,
        }));
      }, { pointerId: ghostPointer, x: ghostX + 30, y: ghostY + 30 });
      await page.evaluate(({ pointerId, x, y }) => {
        window.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true, pointerId, pointerType: "touch", isPrimary: true, button: 0, buttons: 0, clientX: x, clientY: y,
        }));
      }, { pointerId: ghostPointer, x: ghostX + 30, y: ghostY + 30 });
      await expect.poll(() => JSON.stringify(store.drawings[0])).toBe(JSON.stringify(ghostBefore));
    });
  }
});
