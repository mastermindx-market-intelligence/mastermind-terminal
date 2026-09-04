import { expect, test, type Page } from "@playwright/test";
import { PRICE_TAG_MIN_VALUE_WIDTH, PRICE_TAG_ROW_HEIGHT, PRICE_TAG_TIME_HEIGHT } from "@/lib/priceTagPlacement";
import { settled } from "./settle";

type LabelState = {
  primaryTop: number | null;
  primaryAnchorY: number | null;
  pricePaneTop: number;
  extendedTop: number | null;
  extendedNaturalTop: number | null;
  extendedAnchorY: number | null;
  extendedDocked: boolean;
  hoverTop: number | null;
  hoverText: string;
};

const labels = (page: Page): Promise<LabelState> => page.evaluate(() =>
  (window as Window & { __mmPriceLabels?: () => LabelState }).__mmPriceLabels?.() ?? {
    primaryTop: null,
    primaryAnchorY: null,
    pricePaneTop: 0,
    extendedTop: null,
    extendedNaturalTop: null,
    extendedAnchorY: null,
    extendedDocked: false,
    hoverTop: null,
    hoverText: "",
  });

async function routePremarket(page: Page, extPrice: number) {
  await page.route("**/api/quote?**", async (route) => {
    const url = new URL(route.request().url());
    const syms = (url.searchParams.get("syms") || "NVDA").split(",").filter(Boolean);
    const quotes = Object.fromEntries(syms.map((sym) => [sym, sym === "NVDA" ? {
      sym,
      last: 192.53,
      close: 192.53,
      prevClose: 195.74,
      regularPrice: 192.53,
      regularChg: -1.64,
      regularSessionDate: "2026-06-26",
      basis: "DELAYED_15M",
      marketSession: "pre",
      extPrice,
      extChg: ((extPrice - 192.53) / 192.53) * 100,
      extTs: 1_786_550_400,
      extSession: "pre",
    } : null]));
    await route.fulfill({ json: { quotes } });
  });
}

async function chartReady(page: Page) {
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 45_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:set-eth", { detail: { on: true } })));
  await expect(page.locator(".mm-exttag")).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => (await labels(page)).primaryAnchorY, { timeout: 45_000 }).not.toBeNull();
}

test("the crosshair stays foreground while current and near-premarket labels remain pinned", async ({ page }) => {
  await routePremarket(page, 192.53); // exact collision: PRE must dock above yesterday's close
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const initial = await labels(page);
  expect(initial.primaryTop).not.toBeNull();
  expect(initial.primaryAnchorY).not.toBeNull();
  expect(initial.extendedDocked).toBe(true);
  expect(initial.extendedTop).toBe(initial.primaryTop! - PRICE_TAG_ROW_HEIGHT);

  const compact = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const tag = box(".mm-ptag");
    const sym = box(".mm-ptag-sym");
    const val = box(".mm-ptag-val");
    const cd = box(".mm-ptag-cd");
    const ext = box(".mm-exttag");
    const extValue = box(".mm-exttag-val");
    return {
      tagHeight: tag.height,
      extHeight: ext.height,
      valueWidth: val.width,
      seam: val.left - sym.right,
      countdownHeight: cd.height,
      countdownTop: cd.top,
      tagBottom: tag.bottom,
      numericSpineDelta: extValue.left - val.left,
      countdown: document.querySelector(".mm-ptag-cd")?.textContent ?? "",
    };
  });
  expect(compact.tagHeight).toBeCloseTo(PRICE_TAG_ROW_HEIGHT, 0);
  expect(compact.extHeight).toBeCloseTo(PRICE_TAG_ROW_HEIGHT, 0);
  // 66px is the compact floor. The shared lane may grow by a pixel or two when the live clock's
  // current glyphs need it; clipping prevention is part of the contract, exact width is not.
  expect(compact.valueWidth).toBeGreaterThanOrEqual(PRICE_TAG_MIN_VALUE_WIDTH);
  expect(compact.valueWidth).toBeLessThanOrEqual(PRICE_TAG_MIN_VALUE_WIDTH + 4);
  expect(compact.seam).toBeCloseTo(1, 0);
  expect(compact.countdownHeight).toBeCloseTo(PRICE_TAG_TIME_HEIGHT, 0);
  expect(compact.countdownTop).toBeCloseTo(compact.tagBottom, 0);
  expect(compact.numericSpineDelta).toBeCloseTo(0, 0);
  expect(compact.countdown).toMatch(/^(?:\d+d \d+h|\d{2}:\d{2}(?::\d{2})?)$/);

  const geom = await page.locator(".mm-ptag").evaluate((tag) => {
    const wrap = tag.parentElement!.getBoundingClientRect();
    return { wrapTop: wrap.top, wrapLeft: wrap.left, wrapRight: wrap.right, wrapWidth: wrap.width };
  });
  const x = geom.wrapLeft + geom.wrapWidth * 0.55;
  const y = initial.primaryAnchorY!;
  const nudge = async () => {
    await page.mouse.move(x, geom.wrapTop + y - 40);
    await page.mouse.move(x, geom.wrapTop + y);
  };
  const onPrice = await settled({
    drive: nudge,
    read: async () => ({ state: await labels(page), cross: await page.evaluate(() => (window as any).__mmCrosshairDodge?.().crossY ?? null) }),
    ok: ({ cross }) => cross != null && Math.abs(cross - y) <= 2,
    same: (a, b) => a.cross === b.cross && Math.abs((a.state.primaryTop ?? 0) - (b.state.primaryTop ?? 0)) <= 1,
    message: "the crosshair should settle on the current price without moving persistent labels",
  });
  expect(onPrice.state.primaryTop).toBeCloseTo(initial.primaryTop!, 0);
  expect(onPrice.state.extendedTop).toBeCloseTo(initial.extendedTop!, 0);

  await expect(page.locator(".mm-hovertag")).toBeVisible();
  // The pointer price is its own top-layer label. It may cover the persistent numeric cell, but it
  // is excluded from persistent collision layout and therefore cannot translate either badge.
  const foreground = await page.locator(".mm-hovertag").evaluate((el) => {
    const hover = el.getBoundingClientRect();
    const primary = document.querySelector<HTMLElement>(".mm-ptag-val")!.getBoundingClientRect();
    const extended = document.querySelector<HTMLElement>(".mm-exttag-val")!.getBoundingClientRect();
    return {
      z: getComputedStyle(el).zIndex,
      coversPrimaryNumericLane: hover.left <= primary.left + 0.5 && hover.right >= primary.right - 0.5,
      abovePrimary: Number(getComputedStyle(el).zIndex) > Number(getComputedStyle(document.querySelector<HTMLElement>(".mm-ptag")!).zIndex),
      aboveExtended: Number(getComputedStyle(el).zIndex) > Number(getComputedStyle(document.querySelector<HTMLElement>(".mm-exttag")!).zIndex),
      overlapsARequiredPersistentLane: !(hover.bottom <= primary.top || hover.top >= primary.bottom)
        || !(hover.bottom <= extended.top || hover.top >= extended.bottom),
    };
  });
  expect(foreground).toEqual({
    z: "6",
    coversPrimaryNumericLane: true,
    abovePrimary: true,
    aboveExtended: true,
    overlapsARequiredPersistentLane: true,
  });
});

test("a diverged premarket label remains on its true projected price", async ({ page }) => {
  await routePremarket(page, 220);
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const state = await labels(page);
  expect(state.extendedDocked).toBe(false);
  expect(state.extendedTop).toBeCloseTo(state.extendedNaturalTop!, 0);
  expect(Math.abs(state.extendedAnchorY! - state.primaryAnchorY!)).toBeGreaterThanOrEqual(PRICE_TAG_ROW_HEIGHT);
});

test("persistent and hover labels follow the price pane when a study moves above it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pane move controls are a desktop interaction.");
  // This walk alone spends two 20s visibility budgets plus a menu interaction before its
  // first assertion — it cannot fit even the raised CI default when the runner stalls
  // React commits, so it gets the same 90s clock as the other multi-stage walks.
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem("mm.inds", JSON.stringify(["rsi"])));
  await routePremarket(page, 192.53);
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const rsiLegend = page.locator(".lg-block").filter({ hasText: "RSI" }).first();
  await expect(rsiLegend).toBeVisible({ timeout: 20_000 });
  // The top-right pane strip is owned by React hover state and can unmount between Playwright's
  // actionability check and click on a saturated runner. The legend row's More button is always
  // mounted (native CSS reveals it), and its opened menu remains stable after the pointer moves.
  const rsiRow = rsiLegend.locator(".lg-row").filter({ hasText: "RSI" }).first();
  await rsiRow.hover();
  await rsiRow.getByRole("button", { name: "More" }).click();
  const paneMenu = page.locator(".lg-more");
  await expect(paneMenu).toBeVisible({ timeout: 20_000 });
  await paneMenu.getByText("Move pane up", { exact: true }).click();

  await expect.poll(async () => (await labels(page)).pricePaneTop, { timeout: 20_000 }).toBeGreaterThan(20);
  const state = await labels(page);
  expect(state.pricePaneTop).toBeGreaterThan(20);
  expect(state.primaryTop).toBeCloseTo(state.pricePaneTop + Math.round(state.primaryAnchorY! - 8), 0);
  expect(state.extendedTop).toBeCloseTo(state.primaryTop! - PRICE_TAG_ROW_HEIGHT, 0);

  const wrap = await page.locator(".chart-wrap").boundingBox();
  expect(wrap).not.toBeNull();
  const pointerX = wrap!.x + wrap!.width * 0.55;
  const pointerY = wrap!.y + state.pricePaneTop + state.primaryAnchorY!;
  await page.mouse.move(pointerX, pointerY - 35);
  await page.mouse.move(pointerX, pointerY);
  await expect(page.locator(".mm-hovertag")).toBeVisible();
  const hover = await page.locator(".mm-hovertag").boundingBox();
  expect(hover).not.toBeNull();
  expect(hover!.y).toBeGreaterThan(wrap!.y + state.pricePaneTop);
});

test("a four-digit premarket quote expands the compact numeric lane instead of clipping", async ({ page }) => {
  await routePremarket(page, 1_322.30);
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const fit = await page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>(".mm-exttag-slot")!;
    const value = document.querySelector<HTMLElement>(".mm-exttag-val")!;
    const wrap = document.querySelector<HTMLElement>(".chart-wrap")!.getBoundingClientRect();
    const rect = value.getBoundingClientRect();
    return {
      text: value.textContent,
      fitsSlot: value.scrollWidth <= slot.clientWidth,
      insideChart: rect.left >= wrap.left && rect.right <= wrap.right,
    };
  });
  expect(fit).toMatchObject({ text: "1,322.30", fitsSlot: true, insideChart: true });
});

test("left-side and percentage scales keep the foreground label on the active axis with correct units", async ({ page }) => {
  // chartReady() only waits for the chart's OWN data-driven readiness (canvas + tags visible + a
  // resolved anchor Y) — it says nothing about whether the persisted chart settings this test just
  // wrote to localStorage have been APPLIED yet. That read is deliberately deferred to a mount
  // effect (ChartPane.tsx `useEffect(() => setChartSettings(load(...)), [])`) so SSR/hydration
  // never sees a value the server couldn't have rendered; once the resulting setState is actually
  // committed, ChartPanel.tsx's settings effect flips the scale side and repaints the tag in the
  // same commit (`renderTagRef.current?.()`). Both readiness signals are real but independently
  // async, and they race: on an unloaded machine the settings commit reliably wins before
  // chartReady() resolves, so a single boundingBox() read looked safe for years.
  //
  // This is not test noise, and it is not a Linux/headless rendering difference either (verified:
  // byte-for-byte identical wrong-axis value, box.x ~965 instead of ~113, reproduces on macOS with
  // zero code changes purely by CPU-throttling an otherwise-passing run). Instrumented tracing
  // through that repro (console-logged every ChartPane render + effect fire, since deleted) showed
  // the mount effect firing and calling setChartSettings within ~300ms of first paint every time —
  // the delay is NOT the effect being late. What's late is React actually getting a scheduler slot
  // to commit that state update: ChartPanel is simultaneously doing its own CPU-heavy mount work
  // (chart creation, data load, indicator build — see the `effectiveTimeframe` comment above EFFECT
  // 7 in ChartPanel.tsx, which measured a sibling instance of this exact shell-mount-effect-commit
  // pattern at "2.7-3.1s under CI-shaped CPU load"). Under artificial 4x CPU throttling the commit
  // was observed taking up to ~12s to land; it always landed eventually and stayed correct once it
  // did, which rules out a permanent ordering bug (e.g. Effect 7 firing before the chart exists) —
  // this is contention, not staleness. Poll for the side the test asked for, the same way the rest
  // of this file waits out every other async chart transition, instead of reading it once — with a
  // timeout generous enough to clear the observed contention tail, and a test-level budget to match.
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem("mm.chartSettings", JSON.stringify({ scaleLeft: true, mode: 2, scaleFontSize: 16 })));
  await routePremarket(page, 192.53);
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const state = await labels(page);
  const wrap = await page.locator(".chart-wrap").boundingBox();
  expect(wrap).not.toBeNull();
  for (const selector of [".mm-ptag", ".mm-exttag"]) {
    await expect.poll(
      async () => (await page.locator(selector).boundingBox())?.x ?? null,
      { message: `${selector} should settle onto the persisted left-side scale`, timeout: 20_000 },
    ).toBeCloseTo(wrap!.x + 1, 0);
  }

  const x = wrap!.x + wrap!.width * 0.55;
  await page.mouse.move(x, wrap!.y + state.primaryAnchorY! - 35);
  await page.mouse.move(x, wrap!.y + state.primaryAnchorY!);
  await expect(page.locator(".mm-hovertag")).toBeVisible();
  await expect(page.locator(".mm-hovertag")).toContainText(/%$/);
  const hover = await page.locator(".mm-hovertag").boundingBox();
  expect(hover).not.toBeNull();
  expect(hover!.x).toBeCloseTo(wrap!.x + 1, 0);
  expect(hover!.height).toBeGreaterThanOrEqual(28); // covers LWC's full 16px-font crosshair label
  const hoverFits = await page.locator(".mm-hovertag").evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(hoverFits).toBe(true);
});

test("Magnet follows the nearest transformed price-pane series instead of the raw candle close", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Magnet pointer geometry is covered once on desktop.");
  await page.addInitScript(() => {
    localStorage.setItem("mm.ct", "heikin");
    localStorage.setItem("mm.inds", JSON.stringify(["ema"]));
    localStorage.setItem("mm.chartSettings", JSON.stringify({ crosshairMode: 1 }));
  });
  await routePremarket(page, 220);
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const wrap = await page.locator(".chart-wrap").boundingBox();
  expect(wrap).not.toBeNull();
  const probe = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>(".chart-wrap canvas")];
    const plot = canvases.find((canvas) => canvas.getBoundingClientRect().width > 200);
    const wrapRect = document.querySelector<HTMLElement>(".chart-wrap")!.getBoundingClientRect();
    if (!plot) return null;
    const rect = plot.getBoundingClientRect();
    return { x: rect.left + rect.width * 0.48, paneTop: rect.top - wrapRect.top, paneHeight: rect.height };
  });
  expect(probe).not.toBeNull();

  let snapped: LabelState | null = null;
  for (let offset = 0.25; offset <= 0.75; offset += 0.04) {
    const pointerY = probe!.paneTop + probe!.paneHeight * offset;
    await page.mouse.move(probe!.x, wrap!.y + pointerY - 12);
    await page.mouse.move(probe!.x, wrap!.y + pointerY);
    const state = await labels(page);
    if (state.hoverTop != null && Math.abs((state.hoverTop + 10.5) - pointerY) > 3) { snapped = state; break; }
  }
  expect(snapped, "Magnet should move the foreground tag onto a real series value").not.toBeNull();
  expect(snapped!.hoverText).not.toBe("");
});

test("a stationary foreground label refreshes when the price scale changes underneath it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Wheel-on-axis is a desktop/trackpad gesture.");
  await routePremarket(page, 220);
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const wrap = await page.locator(".chart-wrap").boundingBox();
  expect(wrap).not.toBeNull();
  const state = await labels(page);
  const pointerY = state.primaryAnchorY!;
  const pointerX = wrap!.x + wrap!.width * 0.55;
  const nudge = async () => {
    await page.mouse.move(pointerX, wrap!.y + pointerY - 35);
    await page.mouse.move(pointerX, wrap!.y + pointerY);
  };
  await settled({
    drive: nudge,
    read: () => page.evaluate(() => ({
      crossY: (window as any).__mmCrosshairDodge?.().crossY ?? null,
      hover: document.querySelector<HTMLElement>(".mm-hovertag")?.textContent ?? "",
    })),
    ok: (value) => value.crossY != null && Math.abs(value.crossY - pointerY) <= 2 && !!value.hover,
    same: (a, b) => a.crossY === b.crossY && a.hover === b.hover,
    message: "the stationary crosshair should settle before the scale changes",
  });
  const hover = page.locator(".mm-hovertag");
  await expect(hover).toBeVisible();
  const before = await hover.textContent();
  const topBefore = (await hover.boundingBox())!.y;

  // Dispatch a scale-wheel frame at another y without moving the real pointer. The price at the
  // stationary crosshair changes, so the foreground value must update in the same render frame.
  await page.locator(".chart-wrap").dispatchEvent("wheel", {
    deltaY: -600,
    deltaMode: 0,
    clientX: wrap!.x + wrap!.width - 6,
    clientY: wrap!.y + (pointerY > 120 ? pointerY - 80 : pointerY + 80),
    bubbles: true,
    cancelable: true,
  });
  await expect.poll(() => hover.textContent()).not.toBe(before);
  expect((await hover.boundingBox())!.y).toBeCloseTo(topBefore, 0);
});
