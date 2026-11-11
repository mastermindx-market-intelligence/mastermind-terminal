import { expect, test, type Page } from "@playwright/test";
import { PRICE_TAG_MIN_VALUE_WIDTH, PRICE_TAG_ROW_HEIGHT, PRICE_TAG_TIME_HEIGHT } from "@/lib/priceTagPlacement";
import { settled, settledHoverLabel } from "./helpers/settled";

type LabelState = {
  primaryTop: number | null;
  primaryAnchorY: number | null;
  pricePaneTop: number;
  extendedTop: number | null;
  extendedNaturalTop: number | null;
  extendedAnchorY: number | null;
  extendedDocked: boolean;
  primaryDocked: boolean;
  timerOwner: "primary" | "extended" | null;
  optionTags: Array<{ key: string; price: number; top: number; naturalTop: number; anchorY: number; docked: boolean; lane: number; text: string }>;
  hoverTop: number | null;
  hoverText: string;
};

// Hosted desktop shards hide `.mm-hovertag` after leftover price text has already
// been written (job 101689653547). A local machine is 10/10 without this; set
// TERMINAL_E2E_CPU_THROTTLE=4 to replay the CI-shaped scheduler delay.
test.beforeEach(async ({ page }) => {
  const rate = Number(process.env.TERMINAL_E2E_CPU_THROTTLE || "");
  if (!Number.isFinite(rate) || rate <= 1) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
});

const labels = (page: Page): Promise<LabelState> => page.evaluate(() =>
  (window as Window & { __mmPriceLabels?: () => LabelState }).__mmPriceLabels?.() ?? {
    primaryTop: null,
    primaryAnchorY: null,
    pricePaneTop: 0,
    extendedTop: null,
    extendedNaturalTop: null,
    extendedAnchorY: null,
    extendedDocked: false,
    primaryDocked: false,
    timerOwner: null,
    optionTags: [],
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

async function routeRegularSession(page: Page) {
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
      marketSession: "regular",
      extPrice: null,
      extChg: null,
      extTs: null,
      extSession: null,
    } : null]));
    await route.fulfill({ json: { quotes } });
  });
}

test("extended hours owns the countdown while the static close and crosshair remain collision-free", async ({ page }) => {
  await routePremarket(page, 192.53); // exact collision: PRE must dock above yesterday's close
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const initial = await settled({
    read: () => labels(page),
    ok: (state) => state.timerOwner === "extended" && state.primaryTop != null && state.extendedTop != null,
    same: (prev, next) => prev.primaryTop != null && next.primaryTop != null
      && prev.extendedTop != null && next.extendedTop != null
      && Math.abs(prev.primaryTop - next.primaryTop) <= 1
      && Math.abs(prev.extendedTop - next.extendedTop) <= 1
      && Math.abs(prev.pricePaneTop - next.pricePaneTop) <= 1,
    message: "the persistent close/AH label geometry should settle before crosshair interaction",
  });
  expect(initial.primaryTop).not.toBeNull();
  expect(initial.primaryAnchorY).not.toBeNull();
  expect(initial.timerOwner).toBe("extended");
  expect(initial.extendedDocked).toBe(false);
  expect(initial.primaryDocked).toBe(true);
  expect(initial.primaryTop).toBe(initial.extendedTop! - PRICE_TAG_ROW_HEIGHT - 1);

  const compact = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const tag = box(".mm-ptag");
    const sym = box(".mm-ptag-sym");
    const val = box(".mm-ptag-val");
    const currentCd = document.querySelector<HTMLElement>(".mm-ptag-cd")!;
    const ext = box(".mm-exttag");
    const extValue = box(".mm-exttag-val");
    const extCdEl = document.querySelector<HTMLElement>(".mm-exttag-cd")!;
    const extCd = extCdEl.getBoundingClientRect();
    return {
      tagHeight: tag.height,
      extHeight: ext.height,
      valueWidth: val.width,
      seam: val.left - sym.right,
      currentCountdownDisplay: getComputedStyle(currentCd).display,
      extendedCountdownDisplay: getComputedStyle(extCdEl).display,
      countdownHeight: extCd.height,
      countdownTop: extCd.top,
      tagBottom: ext.bottom,
      numericSpineDelta: extValue.left - val.left,
      currentCountdown: currentCd.textContent ?? "",
      countdown: extCdEl.textContent ?? "",
    };
  });
  expect(compact.tagHeight).toBeCloseTo(PRICE_TAG_ROW_HEIGHT, 0);
  expect(compact.extHeight).toBeCloseTo(PRICE_TAG_ROW_HEIGHT, 0);
  // 66px is the compact floor. The shared lane may grow for the active AH countdown; clipping
  // prevention is the contract, not a brittle exact width for the current clock glyphs.
  expect(compact.valueWidth).toBeGreaterThanOrEqual(PRICE_TAG_MIN_VALUE_WIDTH);
  expect(compact.valueWidth).toBeLessThanOrEqual(PRICE_TAG_MIN_VALUE_WIDTH + 12);
  expect(compact.seam).toBeCloseTo(1, 0);
  expect(compact.currentCountdownDisplay).toBe("none");
  expect(compact.extendedCountdownDisplay).toBe("block");
  expect(compact.countdownHeight).toBeCloseTo(PRICE_TAG_TIME_HEIGHT, 0);
  expect(compact.countdownTop).toBeCloseTo(compact.tagBottom, 0);
  expect(compact.numericSpineDelta).toBeCloseTo(0, 0);
  expect(compact.currentCountdown).toBe("");
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
    read: async () => ({ state: await labels(page), cross: await page.evaluate(() => (window as Window & { __mmCrosshairDodge?: () => { crossY: number | null } }).__mmCrosshairDodge?.().crossY ?? null) }),
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
    const wrap = document.querySelector<HTMLElement>(".chart-wrap")!.getBoundingClientRect();
    const primaryTag = document.querySelector<HTMLElement>(".mm-ptag")!.getBoundingClientRect();
    const primary = document.querySelector<HTMLElement>(".mm-ptag-val")!.getBoundingClientRect();
    const extendedTag = document.querySelector<HTMLElement>(".mm-exttag")!.getBoundingClientRect();
    const extended = document.querySelector<HTMLElement>(".mm-exttag-val")!.getBoundingClientRect();
    return {
      z: getComputedStyle(el).zIndex,
      coversPrimaryNumericLane: hover.left <= primary.left + 0.5 && hover.right >= primary.right - 0.5,
      primaryMovedInward: primaryTag.right < wrap.right - 2,
      extendedMovedInward: extendedTag.right < wrap.right - 2,
      abovePrimary: Number(getComputedStyle(el).zIndex) > Number(getComputedStyle(document.querySelector<HTMLElement>(".mm-ptag")!).zIndex),
      aboveExtended: Number(getComputedStyle(el).zIndex) > Number(getComputedStyle(document.querySelector<HTMLElement>(".mm-exttag")!).zIndex),
      overlapsARequiredPersistentLane: !(hover.bottom <= primary.top || hover.top >= primary.bottom)
        || !(hover.bottom <= extended.top || hover.top >= extended.bottom),
    };
  });
  expect(foreground.z).toBe("6");
  expect(foreground.abovePrimary).toBe(true);
  expect(foreground.aboveExtended).toBe(true);
  expect(foreground.overlapsARequiredPersistentLane).toBe(true);
  // With Options Levels absent, preserve the Terminal's established axis contract: both quote
  // badges and the pointer label stay on the true edge, leaving the chart's reserved candle gap intact.
  expect(foreground.primaryMovedInward).toBe(false);
  expect(foreground.extendedMovedInward).toBe(false);
  expect(foreground.coversPrimaryNumericLane).toBe(true);
});

test("regular hours keeps the bar-close countdown on the current quote", async ({ page }) => {
  await routeRegularSession(page);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mm-exttag")).toBeHidden();
  await expect.poll(async () => (await labels(page)).timerOwner, { timeout: 45_000 }).toBe("primary");
  await expect(page.locator(".mm-ptag-cd")).toBeVisible();
  await expect(page.locator(".mm-ptag-cd")).toHaveText(/^(?:\d+d \d+h|\d{2}:\d{2}(?::\d{2})?)$/);
  await expect(page.locator(".mm-exttag-cd")).toBeHidden();
});

test("the countdown migrates back to the current quote when extended hours ends live", async ({ page }) => {
  test.setTimeout(60_000);
  let extended = true;
  let requests = 0;
  await page.route("**/api/quote?**", async (route) => {
    requests++;
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
      marketSession: extended ? "pre" : "regular",
      extPrice: extended ? 192.53 : null,
      extChg: extended ? 0 : null,
      extTs: extended ? 1_786_550_400 : null,
      extSession: extended ? "pre" : null,
    } : null]));
    await route.fulfill({ json: { quotes } });
  });

  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);
  await expect.poll(async () => (await labels(page)).timerOwner).toBe("extended");

  const requestsBeforeClose = requests;
  extended = false;
  await expect.poll(() => requests, { timeout: 20_000 }).toBeGreaterThan(requestsBeforeClose);
  await expect.poll(async () => (await labels(page)).timerOwner, { timeout: 20_000 }).toBe("primary");
  await expect(page.locator(".mm-exttag")).toBeHidden();
  await expect(page.locator(".mm-ptag-cd")).toBeVisible();
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
  const rsiRow = rsiLegend.locator(".lg-row").filter({ hasText: "RSI" }).first();
  const paneMenu = page.locator(".lg-more");
  // .lg-ic is display:none until .lg-row:hover (globals.css). A one-shot hover+click lets
  // Playwright scroll, lose :hover, then retry the detached node without re-hovering.
  await settled({
    drive: async (last) => {
      if (last?.open) return;
      if (await paneMenu.isVisible().catch(() => false)) return;
      await rsiRow.hover();
      try {
        await rsiRow.getByRole("button", { name: "More" }).click({ timeout: 3_000 });
      } catch {
        // Remount or lost hover — the next drive re-hovers and clicks a fresh node.
      }
    },
    read: async () => ({ open: await paneMenu.isVisible().catch(() => false) }),
    ok: (value) => value.open,
    same: (prev, next) => prev.open && next.open,
    message: "the RSI pane menu should stay open after More is clicked",
  });
  await paneMenu.getByText("Move pane up", { exact: true }).click();

  await expect.poll(async () => (await labels(page)).pricePaneTop, { timeout: 20_000 }).toBeGreaterThan(20);
  const state = await labels(page);
  expect(state.pricePaneTop).toBeGreaterThan(20);
  // Extended hours is the active timed quote, so it stays on its true projection after a pane move;
  // the regular close is the collision-resolved static neighbor above it.
  expect(state.extendedTop).toBeCloseTo(state.pricePaneTop + Math.round(state.extendedAnchorY! - 8), 0);
  expect(state.primaryTop).toBeCloseTo(state.extendedTop! - PRICE_TAG_ROW_HEIGHT - 1, 0);

  const wrap = await page.locator(".chart-wrap").boundingBox();
  expect(wrap).not.toBeNull();
  const pointerX = wrap!.x + wrap!.width * 0.55;
  const pointerY = wrap!.y + state.pricePaneTop + state.primaryAnchorY!;
  await page.mouse.move(pointerX, pointerY - 35);
  await page.mouse.move(pointerX, pointerY);
  await expect(page.locator(".mm-hovertag")).toBeVisible();
  await expect.poll(
    async () => (await page.locator(".mm-hovertag").boundingBox())?.y ?? null,
    { message: "the hover label should have a laid-out box after the pane move", timeout: 20_000 },
  ).toBeGreaterThan(wrap!.y + state.pricePaneTop);
});

test("dense option levels use gex_state fallback and fan their badges without moving the active AH quote", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mm.inds", JSON.stringify(["optlevels"])));
  await routePremarket(page, 192.50);
  await page.route("**/api/flow?**", async (route) => {
    const f = new URL(route.request().url()).searchParams.get("f");
    if (f === "gex:NVDA") {
      await route.fulfill({ json: {
        schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-09-14",
        spot_ref: 192.50, call_wall: null, put_wall: null, gamma_flip: null,
        by_strike: [
          { strike: 192.46, gamma_net: 80, gamma_call: 100, gamma_put: -20 },
          { strike: 192.48, gamma_net: 10, gamma_call: 20, gamma_put: -10 },
        ],
      } });
      return;
    }
    if (f === "moves:NVDA") {
      await route.fulfill({ json: {
        schema: "options_hub.moves/v1", root: "NVDA", asof: "2026-09-14",
        expected_move: { lo: 192.44, hi: 192.58 },
      } });
      return;
    }
    if (f === "gexstate:NVDA") {
      await route.fulfill({ json: {
        schema: "options_structure.gex_state/v1", root: "NVDA",
        asof: "2026-09-16T16:00:00-04:00", spot: 192.50,
        call_wall: 192.60, put_wall: 192.42, gamma_flip: 192.52, net_gex_bn: 0.11,
      } });
      return;
    }
    await route.continue();
  });
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);
  await expect(page.locator(".mm-optlevel-tag:visible")).toHaveCount(6, { timeout: 45_000 });

  const state = await labels(page);
  expect(state.timerOwner).toBe("extended");
  expect(state.optionTags.map((tag) => tag.key).sort()).toEqual(
    ["abs_gamma", "call_wall", "em_hi", "em_lo", "gamma_flip", "put_wall"].sort(),
  );
  expect(state.optionTags.some((tag) => tag.docked)).toBe(true);
  for (const tag of state.optionTags) expect(Number.isFinite(tag.anchorY)).toBe(true);
  expect(Object.fromEntries(state.optionTags.map((tag) => [tag.key, tag.price]))).toEqual({
    call_wall: 192.60,
    put_wall: 192.42,
    gamma_flip: 192.52,
    abs_gamma: 192.46,
    em_lo: 192.44,
    em_hi: 192.58,
  });

  const expectedLinePrices = [192.42, 192.44, 192.46, 192.52, 192.58, 192.60];
  await expect.poll(async () => page.evaluate(() => {
    const lines = (window as Window & { __mmIndicatorPriceLines?: () => Record<string, Array<{ price: number; axisLabelVisible: boolean }>> })
      .__mmIndicatorPriceLines?.().optlevels ?? [];
    return lines.map((line) => line.price).sort((a, b) => a - b);
  }), { timeout: 20_000 }).toEqual(expectedLinePrices);

  const geometry = await page.evaluate(({ row, timer }) => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const wrap = rect(".chart-wrap");
    const current = rect(".mm-ptag");
    const extended = rect(".mm-exttag");
    const extTimed = getComputedStyle(document.querySelector<HTMLElement>(".mm-exttag-cd")!).display !== "none";
    const boxes = [
      { id: "close", left: current.left - wrap.left, right: current.right - wrap.left, top: current.top - wrap.top, bottom: current.top - wrap.top + row },
      { id: "extended", left: extended.left - wrap.left, right: extended.right - wrap.left, top: extended.top - wrap.top, bottom: extended.top - wrap.top + row + (extTimed ? timer : 0) },
      ...[...document.querySelectorAll<HTMLElement>(".mm-optlevel-tag")]
        .filter((el) => getComputedStyle(el).display !== "none")
        .map((el) => {
          const box = el.getBoundingClientRect();
          return { id: el.dataset.levelKey!, left: box.left - wrap.left, right: box.right - wrap.left, top: box.top - wrap.top, bottom: box.bottom - wrap.top };
        }),
      ...[...document.querySelectorAll<HTMLElement>(".chart-fs-float, [data-visual-context] > button[aria-controls], .lg-block")]
        .filter((el) => {
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
        })
        .map((el, index) => {
          const box = el.getBoundingClientRect();
          return { id: `obstacle-${index}`, obstacle: true, left: box.left - wrap.left, right: box.right - wrap.left, top: box.top - wrap.top, bottom: box.bottom - wrap.top };
        }),
    ];
    const overlaps: string[] = [];
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const x = boxes[a].left < boxes[b].right && boxes[a].right > boxes[b].left;
      const y = boxes[a].top < boxes[b].bottom && boxes[a].bottom > boxes[b].top;
      if (x && y) overlaps.push(`${boxes[a].id}/${boxes[b].id}`);
    }
    return { boxes, overlaps, wrapWidth: wrap.width, wrapHeight: wrap.height };
  }, { row: PRICE_TAG_ROW_HEIGHT, timer: PRICE_TAG_TIME_HEIGHT });
  expect(geometry.overlaps).toEqual([]);
  for (const box of geometry.boxes.filter((item) => !("obstacle" in item))) {
    expect(box.left, `${box.id} left`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${box.id} right`).toBeLessThanOrEqual(geometry.wrapWidth);
    expect(box.top, `${box.id} top`).toBeGreaterThanOrEqual(0);
    expect(box.bottom, `${box.id} bottom`).toBeLessThanOrEqual(geometry.wrapHeight);
  }

  // A resize cannot move the exact price lines or reintroduce overlaps; overflow may fan inward.
  await page.setViewportSize({ width: 1440, height: 430 });
  await expect(page.locator(".mm-optlevel-tag:visible")).toHaveCount(6, { timeout: 20_000 });
  await expect.poll(async () => page.evaluate(() => {
    const lines = (window as Window & { __mmIndicatorPriceLines?: () => Record<string, Array<{ price: number }>> })
      .__mmIndicatorPriceLines?.().optlevels ?? [];
    return lines.map((line) => line.price).sort((a, b) => a - b);
  })).toEqual(expectedLinePrices);
  const resizedOverlaps = await page.evaluate(() => {
    const visible = [".mm-ptag", ".mm-exttag", ".mm-optlevel-tag", ".chart-fs-float", "[data-visual-context] > button[aria-controls]", ".lg-block"]
      .flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)])
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => ({ id: element.dataset.levelKey ?? element.className, box: element.getBoundingClientRect() }));
    const overlaps: string[] = [];
    for (let a = 0; a < visible.length; a++) for (let b = a + 1; b < visible.length; b++) {
      const A = visible[a].box, B = visible[b].box;
      if (A.left < B.right && A.right > B.left && A.top < B.bottom && A.bottom > B.top) overlaps.push(`${visible[a].id}/${visible[b].id}`);
    }
    return overlaps;
  });
  expect(resizedOverlaps).toEqual([]);
});

test("mounted options levels consume a newly published state snapshot without reloading the chart", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("mm.inds", JSON.stringify(["optlevels"])));
  await routePremarket(page, 192.50);

  let published = false;
  let stateRequests = 0;
  await page.route("**/api/flow?**", async (route) => {
    const f = new URL(route.request().url()).searchParams.get("f");
    if (f === "gex:NVDA") {
      await route.fulfill({ json: {
        schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-09-14",
        spot_ref: 192.50, call_wall: null, put_wall: null, gamma_flip: null, by_strike: [],
      } });
      return;
    }
    if (f === "moves:NVDA") {
      await route.fulfill({ json: {
        schema: "options_hub.moves/v1", root: "NVDA", asof: "2026-09-14",
        expected_move: { lo: 192.44, hi: 192.58 },
      } });
      return;
    }
    if (f === "gexstate:NVDA") {
      stateRequests += 1;
      await route.fulfill({ json: {
        schema: "options_structure.gex_state/v1", root: "NVDA",
        asof: published ? "2026-09-17T16:00:00-04:00" : "2026-09-16T16:00:00-04:00",
        spot: 192.50,
        call_wall: published ? 192.64 : 192.60,
        put_wall: 192.42,
        gamma_flip: 192.52,
        net_gex_bn: 0.11,
      } });
      return;
    }
    await route.continue();
  });

  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);
  await expect.poll(async () => {
    const state = await labels(page);
    return state.optionTags.find((tag) => tag.key === "call_wall")?.price ?? null;
  }, { timeout: 20_000 }).toBe(192.60);
  expect(stateRequests).toBe(1);

  // flowClientCache becomes stale after 25s. One visible refresh must await that stale
  // revalidation and consume the new payload; no second synthetic wake/reload is allowed.
  published = true;
  await page.clock.fastForward("00:26");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect.poll(() => stateRequests, { timeout: 20_000 }).toBe(2);
  await expect.poll(async () => {
    const state = await labels(page);
    return state.optionTags.find((tag) => tag.key === "call_wall")?.price ?? null;
  }, { timeout: 20_000 }).toBe(192.64);
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
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["optlevels"]));
    localStorage.setItem("mm.chartSettings", JSON.stringify({ scaleLeft: true, mode: 2, scaleFontSize: 16 }));
  });
  await routePremarket(page, 192.53);
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const wrap = await page.locator(".chart-wrap").boundingBox();
  expect(wrap).not.toBeNull();
  // Persistent labels belong to the left scale, but compact layouts may move them inward just
  // enough to clear fixed chrome. The pointer label remains the exact axis-edge consumer below.
  for (const selector of [".mm-ptag", ".mm-exttag"]) {
    await expect.poll(async () => {
      const box = await page.locator(selector).boundingBox();
      return !!box
        && box.x >= wrap!.x + 1
        && box.x + box.width <= wrap!.x + wrap!.width
        && box.x < wrap!.x + wrap!.width * 0.45;
    }, { message: `${selector} should settle on the left-scale side without leaving the chart`, timeout: 20_000 }).toBe(true);
  }

  await expect(page.locator(".mm-optlevel-tag:visible").first()).toBeVisible({ timeout: 20_000 });
  const optionBox = await page.locator(".mm-optlevel-tag:visible").first().boundingBox();
  expect(optionBox).not.toBeNull();
  expect(optionBox!.x).toBeGreaterThanOrEqual(wrap!.x + 1);
  expect(optionBox!.x).toBeLessThan(wrap!.x + wrap!.width * 0.45);
  await expect(page.locator(".mm-optlevel-tag:visible").first()).toHaveText(/%$/);

  const leftObstacleOverlaps = await page.evaluate(() => {
    const labels = [...document.querySelectorAll<HTMLElement>(".mm-ptag, .mm-exttag, .mm-optlevel-tag")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      });
    const obstacles = [...document.querySelectorAll<HTMLElement>(
      ".chart-fs-float, [data-visual-context] > button[aria-controls], .lg-block",
    )].filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    });
    return labels.flatMap((label) => obstacles.filter((obstacle) => {
      const A = label.getBoundingClientRect(), B = obstacle.getBoundingClientRect();
      return A.left < B.right && A.right > B.left && A.top < B.bottom && A.bottom > B.top;
    }).map(() => label.dataset.levelKey ?? label.className));
  });
  expect(leftObstacleOverlaps).toEqual([]);

  // Sibling :364-366: one move to the last-price overlay point. A y-35 approach can leave the
  // price pane, and under load that leave lands after the target move, so the tag ends up hidden
  // with its leftover text (hoverTagPaint.ts:20 "hide" -> ChartPanel.tsx:3620 display:none).
  const label = await settledHoverLabel(page, {
    move: async () => {
      const wrapNow = await page.locator(".chart-wrap").boundingBox();
      const now = await labels(page);
      if (!wrapNow || now.primaryAnchorY == null) return;
      await page.mouse.move(wrapNow.x + wrapNow.width * 0.55, wrapNow.y + now.pricePaneTop + now.primaryAnchorY);
    },
    message: "the left-scale hover label should stay visible with a stable box",
  });
  // hoverLabelOk() already required visible + non-empty text + a laid-out box; the % unit is ours.
  expect(label.text).toMatch(/%$/);
  const hover = label.box;
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
  // Two 20s settle budgets plus a wheel-driven refresh. Under 4× CPU throttle the
  // previous 30s default died inside the first settle (10/10 local, this packet).
  test.setTimeout(90_000);
  await routePremarket(page, 220);
  await page.goto("/terminal?symbol=NVDA");
  await chartReady(page);

  const wrap = await page.locator(".chart-wrap").boundingBox();
  expect(wrap).not.toBeNull();
  const state = await labels(page);
  const pointerY = state.primaryAnchorY!;
  // Re-read wrap + pane offset on every drive. A one-shot wrap.y + anchorY can
  // land in the legend while the price pane is still committing (hosted Shape A/B:
  // leftover `.mm-hovertag` text, display:none). Same overlay point as the pane-move
  // walk above — last price, pane-scoped.
  const hover = await settledHoverLabel(page, {
    move: async () => {
      const wrapNow = await page.locator(".chart-wrap").boundingBox();
      const now = await labels(page);
      if (!wrapNow || now.primaryAnchorY == null) return;
      const x = wrapNow.x + wrapNow.width * 0.55;
      const y = wrapNow.y + now.pricePaneTop + now.primaryAnchorY;
      // One move to the last-price overlay point. A y-35 approach can leave the
      // price pane and hide the tag; under throttle that leave arrives after the
      // target move and the box never repeats.
      await page.mouse.move(x, y);
    },
    message: "the stationary hover label should stay visible with a stable box before the scale changes",
  });
  const before = hover.text;
  expect(hover.box, "the stationary hover label should have a laid-out box before the scale changes").not.toBeNull();
  const hoverTopBefore = hover.box!.y;

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
  await expect.poll(() => page.locator(".mm-hovertag").textContent()).not.toBe(before);
  await expect(page.locator(".mm-hovertag")).toBeVisible();
  await expect.poll(
    async () => (await page.locator(".mm-hovertag").boundingBox())?.y ?? null,
    { message: "the stationary hover label should keep a laid-out box after the scale change", timeout: 20_000 },
  ).toBeCloseTo(hoverTopBefore, 0);
});
