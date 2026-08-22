import { expect, test, type Page, type TestInfo } from "./fixtures";

// ── THE PRIMS THAT DELETED THE CHART'S GESTURES ─────────────────────────────────────────────
//
// `indicator-canvas/render.bindTooltip` set `pointer-events:auto` on every premium-suite prim
// carrying a tooltip, inside an indicator overlay that is itself `pointer-events:none`. #379 fixed
// the identical structural defect one layer up (signal markers) and reported this layer as the
// remaining hole; `lib/markerTooltip.ts` has carried the argument since.
//
// It is structural, not a matter of tuning: lightweight-charts owns pan, crosshair, wheel-zoom and
// pinch on ITS OWN canvas, which lives inside the chart container. The overlay layers are appended
// to the container's PARENT (`wrap = el.parentElement`), so the canvas is a SIBLING SUBTREE. An
// event landing on a hit-testable prim bubbles to the wrapper and stops — it never reaches the
// chart, and no propagation path would take it there. So a hit-testable prim does not "risk"
// swallowing a drag: it REMOVES the chart's gesture surface over its own footprint. Every premium
// tooltip prim — Trend Engine flip markers and their BUY/SELL pills, Flow Band, the Structure
// zones' stat chips — carried that hole in production.
//
// This suite carries two claims, and the second is the load-bearing one:
//
//   1. DISPLAY — hovering a prim shows its module's own tooltip, and a tap opens it on touch.
//   2. THE CHART STILL WINS — a drag that STARTS on a prim pans, a wheel over one zooms, and the
//      crosshair does not drop out as the cursor crosses it.
//
// Claim 2 is why the repair is a delegated JS hit test rather than `pointer-events:auto`, and the
// counterfactual below demonstrates that against the live chart rather than asserting it in prose.

test.use({ deviceScaleFactor: 3 });   // the prims are 6–20px; a 1x crop is an unreadable receipt

async function armTerminalVisualReady(page: Page) {
  await page.addInitScript(() => {
    const readyWindow = window as Window & { __mmResponsiveVisualReady?: boolean };
    readyWindow.__mmResponsiveVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmResponsiveVisualReady = true;
    }, { once: true });
  });
}

async function waitForTerminalVisualReady(page: Page) {
  await expect.poll(
    () => page.evaluate(() =>
      Boolean((window as Window & { __mmResponsiveVisualReady?: boolean }).__mmResponsiveVisualReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 15_000 },
  ).toBe(true);
}

/** Synthetic daily OHLC ending on the most recent weekday — dates come FROM the series so the
 *  fixture cannot go red on a calendar roll (same reason as the sibling marker/washout suites).
 *
 *  Shaped for the TREND ENGINE, which is the `trend` suite's only default-on prim emitter: a mild
 *  uptrend carrying a ~10-bar oscillation flips the engine roughly every 20 bars, so the default
 *  view always holds several flip markers + BUY/SELL pills at DIFFERENT x positions — which the
 *  wheel and lockstep assertions below need. Verified against the module offline before it was
 *  written into a browser test: 13 flip tooltips over 300 bars, 5 of them in the last 100. */
function ohlcFixture(days = 420) {
  const bars: [string, number, number, number, number, number][] = [];
  const start = Date.now() - days * 86_400_000;
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86_400_000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const base = 40 * Math.pow(1.1, i / 250);
    const px = base * (1 + 0.05 * Math.sin(i / 10) + 0.0125 * Math.sin(i / (10 / 3.7)));
    bars.push([d.toISOString().slice(0, 10), +(px * 0.998).toFixed(2), +(px * 1.010).toFixed(2),
               +(px * 0.990).toFixed(2), +px.toFixed(2), 1_500_000]);
  }
  return { t: "COST", o: 1, src: "e2e-fixture", bar_quality: "real_ohlc", bars };
}

const OHLC = ohlcFixture();

/** No signal marks at all: the Golden Oracle study is off by default here, and an empty slice keeps
 *  the OTHER overlay's hit test out of this one's way. That the two coexist is proved by
 *  marker-tooltip.spec.ts staying green alongside this file. */
const SLICE = {
  indicator: {
    signal_era: "gc_v2_wo2",
    state: {
      position_hint: "flat", last_signal: null, last_scored_signal: null,
      last_scored_ts: null, last_scored_basis: null,
      strong_bull: false, overbought: false, weeklyBull: true, above200: true,
    },
    signals: [], early_dots: [], warnings: [],
  },
  backtest: { metrics: { n_trades: 18, win_rate: 0.44, profit_factor: 1.4, cagr: 0.13 } },
};

async function openTerminal(page: Page, opts: { zhPreseed?: boolean } = {}) {
  if (opts.zhPreseed) {
    await page.addInitScript(() => { localStorage.setItem("mm.lang", "zh"); });
  }
  await page.route(/\/data\/COST\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(OHLC) });
  });
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(SLICE) });
  });
  await page.addInitScript(() => {
    // `trend` (Trend Waves) is one of the two OVERLAY suites — its prims live in the price pane,
    // which is exactly where the deleted gestures were. Seeding indParams as well is what makes the
    // suite's own module defaults (te.on = true) load: TerminalShell's `allDefaults()` covers the
    // classic indicators only, and backfills a suite key from `suiteDefaults()` when it sees one.
    localStorage.setItem("mm.inds", JSON.stringify(["trend"]));
    localStorage.setItem("mm.indParams", JSON.stringify({ trend: {} }));
    // Trend Engine is an `essential`-tier module. The playwright webServer already runs with
    // TERMINAL_E2E_ENTITLEMENT=unlimited; this is the belt to that pair of braces, and it is read
    // straight from localStorage on mount with no env gate (lib/subscriptionTier.ts).
    localStorage.setItem("mm.devTier", "pro");
  });
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=COST");
  await expect(page.locator(".workspace")).toBeVisible();
  await waitForTerminalVisualReady(page);
  if (opts.zhPreseed) await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
  // the premium prims exist before any test touches them
  await expect(page.locator("svg [data-ic-tip]").first()).toBeAttached({ timeout: 25_000 });
}

type Prim = { tid: string; ord: number; cx: number; cy: number; w: number; h: number };

/** Every painted prim that carries a tooltip, in VIEWPORT coordinates — the same space the mouse
 *  moves in, so a test never has to convert. `ord` disambiguates the elements SHARING a tooltip id
 *  (a flip is a marker plus its BUY/SELL pill), and is stable because the renderer appends in
 *  z-order every frame. */
async function prims(page: Page): Promise<Prim[]> {
  return page.evaluate(() => {
    const out: { tid: string; ord: number; cx: number; cy: number; w: number; h: number }[] = [];
    const seen: Record<string, number> = {};
    for (const el of document.querySelectorAll("svg [data-ic-tip]")) {
      const tid = el.getAttribute("data-ic-tip") || "";
      const b = el.getBoundingClientRect();
      if (!tid || !(b.width > 0) || !(b.height > 0)) continue;
      const ord = (seen[tid] = (seen[tid] ?? -1) + 1);
      out.push({ tid, ord, cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height });
    }
    return out;
  });
}

/** The prim field, once it has STOPPED MOVING.
 *
 *  The chart keeps sizing after hydration — panes lay out, the price axis takes its final width,
 *  and every prim's coordinates move with it. Measuring mid-settle hands back positions that are
 *  already stale by the time a pointer lands on them, which on the 390px viewport is the whole
 *  difference between a tap that opens a tooltip and one that lands in empty chart. Two consecutive
 *  identical reads, never a sleep. */
async function settledPrims(page: Page): Promise<Prim[]> {
  let prev = "";
  let list: Prim[] = [];
  await expect.poll(async () => {
    list = await prims(page);
    const key = list.map((p) => `${p.tid}#${p.ord}@${Math.round(p.cx)},${Math.round(p.cy)}`).join("|");
    const settled = list.length > 0 && key === prev;
    prev = key;
    return settled;
  }, {
    message: "the premium prim field should stop moving before it is measured",
    timeout: 30_000,
    intervals: [150, 200, 300, 400, 500],
  }).toBe(true);
  return list;
}

/** The first element painted for a tooltip id — the flip MARKER, since the renderer z-sorts and the
 *  marker (z 3) precedes its pill (z 4). Stable across repaints without needing element identity,
 *  which the layer destroys every frame. */
function byTid(list: Prim[], tid: string): Prim {
  const hit = list.find((p) => p.tid === tid && p.ord === 0);
  expect(hit, `no prim is painted for ${tid} any more`).toBeTruthy();
  return hit!;
}

/** Prims far enough inside the viewport to be dragged from, wheeled over and swept across without
 *  the gesture leaving the pane or the price axis clipping the prim. */
async function usable(page: Page, list: Prim[]): Promise<Prim[]> {
  const vp = page.viewportSize()!;
  return list.filter((p) =>
    p.cx > 150 && p.cx < vp.width - 170 && p.cy > 120 && p.cy < vp.height - 190);
}

/** One usable prim per tooltip id, left to right — distinct chart positions, never a marker and its
 *  own pill counted as two. */
async function targets(page: Page): Promise<Prim[]> {
  const list = await usable(page, await settledPrims(page));
  const byId = new Map<string, Prim>();
  for (const p of list) if (p.ord === 0 && !byId.has(p.tid)) byId.set(p.tid, p);
  const out = [...byId.values()].sort((a, b) => a.cx - b.cx);
  expect(out.length, "the fixture should paint at least two premium prims inside the viewport")
    .toBeGreaterThanOrEqual(2);
  return out;
}

/** A point ON the chart overlay and as far as possible from every painted prim.
 *
 *  Not a hard-coded corner: a corner can land outside the wrapper entirely (nothing to dismiss the
 *  tooltip, because the listeners live on the wrapper) or inside another prim's TAP box, which
 *  re-opens the tooltip the tap was meant to close. Both of those failed on tablet before this
 *  existed. Measured from the overlay's own rect, so it follows the viewport. */
async function emptySpot(page: Page, list: Prim[]): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(() => {
    const b = document.querySelector("svg [data-ic-tip]")!.closest("svg")!.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  let best = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  let bestD = -Infinity;
  for (let fx = 0.08; fx <= 0.92; fx += 0.04) {
    for (let fy = 0.10; fy <= 0.90; fy += 0.04) {
      const x = box.x + box.w * fx, y = box.y + box.h * fy;
      let d = Infinity;
      for (const p of list) {
        d = Math.min(d, Math.hypot(x - p.cx, y - p.cy) - Math.max(p.w, p.h) / 2);
      }
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
  }
  expect(bestD, "the fixture left nowhere on the chart clear of a prim to tap").toBeGreaterThan(60);
  return best;
}

const tip = (page: Page) => page.locator(".ic-tip");

/** Hover a prim and wait for its tooltip — polled on the tooltip's own `data-ic-tip-for`, so the
 *  wait is for the state being asserted rather than for a timeout. */
async function hoverPrim(page: Page, p: Prim) {
  await page.mouse.move(p.cx - 60, p.cy - 50);
  await page.mouse.move(p.cx, p.cy, { steps: 6 });
  await expect(tip(page)).toHaveAttribute("data-ic-tip-for", p.tid, { timeout: 5_000 });
  await expect(tip(page)).toBeVisible();
}

/** Crop the tooltip together with the prim it belongs to — a tooltip shot on its own proves the box
 *  rendered, not that it rendered ON the thing the reader pointed at. */
async function tipShot(page: Page, testInfo: TestInfo, name: string) {
  const clip = await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>(".ic-tip");
    if (!t || t.style.display === "none") return null;
    const at = t.getAttribute("data-ic-tip-for");
    const boxes = [t.getBoundingClientRect()];
    for (const el of document.querySelectorAll(`svg [data-ic-tip="${at}"]`)) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) boxes.push(b);
    }
    const pad = 18;
    const x = Math.max(0, Math.min(...boxes.map((b) => b.left)) - pad);
    const y = Math.max(0, Math.min(...boxes.map((b) => b.top)) - pad);
    return {
      x, y,
      width: Math.min(window.innerWidth - x, Math.max(...boxes.map((b) => b.right)) + pad - x),
      height: Math.min(window.innerHeight - y, Math.max(...boxes.map((b) => b.bottom)) + pad - y),
    };
  });
  if (!clip || clip.width <= 0 || clip.height <= 0) return;
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), clip });
}

// ── 1. DISPLAY ──────────────────────────────────────────────────────────────────────────────
test("hovering a premium prim shows its module's tooltip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "hover is a pointer-fine interaction");
  await openTerminal(page);
  const list = await targets(page);
  const target = list[Math.floor(list.length / 2)];

  await hoverPrim(page, target);
  const box = tip(page);
  // a real tooltip: a non-empty title AND the module's stat rows, not an empty shell
  const title = await box.locator("> div").first().textContent();
  expect((title ?? "").trim().length, "the tooltip title should not be empty").toBeGreaterThan(2);
  expect(await box.locator("> div").count(), "the module's stat rows should render").toBeGreaterThan(1);
  await tipShot(page, testInfo, "prim-tooltip-1-hover");

  // …and it belongs to the prim under the cursor: moving to a DIFFERENT prim retargets it
  const other = list.find((p) => p.tid !== target.tid)!;
  await hoverPrim(page, other);
  await expect(box).toHaveAttribute("data-ic-tip-for", other.tid);

  // …and empty chart dismisses it, so it is not litter pinned over the pane
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width - 200, 140);
  await expect(box).toBeHidden();
});

// ── 2. THE CHART STILL WINS ─────────────────────────────────────────────────────────────────
//
// The prims themselves are the pan witness: the indicator overlay re-lays them on every visible-
// range change, so a prim that moved with the drag IS the viewport that panned, measured in the
// product's own coordinates and needing no test hook.
test("a drag that starts on a premium prim pans the chart", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "mouse drag");
  await openTerminal(page);
  const before = await targets(page);
  const target = before[Math.floor(before.length / 2)];
  const other = before.find((p) => p.tid !== target.tid)!;

  // Rightward: it scrolls BACK into history, which the fixture has 300 bars of, so the pan can
  // never be swallowed by the right-edge clamp instead of by a bug.
  const dx = 180;
  await page.mouse.move(target.cx, target.cy);
  await page.mouse.down();
  await page.mouse.move(target.cx + dx, target.cy, { steps: 15 });
  await page.mouse.up();

  await expect.poll(async () => Math.round(byTid(await prims(page), target.tid).cx),
    { message: "the prim should travel with the chart it sits on", timeout: 5_000 },
  ).toBeGreaterThan(Math.round(target.cx) + dx * 0.5);

  // …and it travelled BY the drag distance, not merely somewhere. A prim that moved a few px would
  // mean the chart took part of the gesture and dropped the rest.
  const after = await prims(page);
  const moved = byTid(after, target.tid).cx - target.cx;
  expect(Math.abs(moved - dx)).toBeLessThan(dx * 0.35);
  // the whole field moved together — the chart panned, one prim did not wander
  const movedOther = byTid(after, other.tid).cx - other.cx;
  expect(Math.abs(movedOther - moved)).toBeLessThan(4);
});

test("the pointer-events repair would have broken that drag", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "mouse drag");
  // THE COUNTERFACTUAL, run against the live chart rather than argued in a comment. Making the
  // prims hit-testable is the obvious way to get a tooltip back — it is what this layer SHIPPED —
  // and it silently takes the chart's gestures away over every prim's footprint, because the
  // lightweight-charts canvas is a sibling subtree of this overlay and never receives an event that
  // lands here. `auto` is the exact attribute the deleted `bindTooltip` line set.
  //
  // If this test ever goes green-by-panning, the structural claim in lib/markerTooltip.ts is wrong
  // and the simple repair should replace ours.
  //
  // Written as a WITHIN-TEST A/B on the same prim, in the same session: the same drag is run first
  // against the shipped layer and then against the injected one. A no-pan assertion on its own
  // would also be satisfied by a prim that simply sits somewhere undraggable, which would make the
  // most load-bearing test in this file the one most likely to be passing for the wrong reason.
  await openTerminal(page);
  const list = await targets(page);
  const target = list[Math.floor(list.length / 2)];

  const drag = async (from: Prim) => {
    await page.mouse.move(from.cx, from.cy);
    await page.mouse.down();
    await page.mouse.move(from.cx + 180, from.cy, { steps: 15 });
    await page.mouse.up();
    return Math.abs(byTid(await prims(page), from.tid).cx - from.cx);
  };

  // CONTROL — the shipped layer, this prim, this gesture: it pans.
  expect(await drag(target), "the control drag did not pan, so the injection below proves nothing")
    .toBeGreaterThan(60);

  // …now make the prims hit-testable exactly as the deleted `bindTooltip` line did, and repeat it.
  const settled = await settledPrims(page);
  const again = byTid(settled, target.tid);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("svg [data-ic-tip]")) {
      el.setAttribute("pointer-events", "auto");
    }
  });

  expect(
    await drag(again),
    "a hit-testable prim swallows the drag — which is why the shipped layer stays pointer-events:none",
  ).toBeLessThan(4);
});

test("a wheel over a premium prim still zooms the chart", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "wheel");
  await openTerminal(page);
  const before = await targets(page);
  const target = before[Math.floor(before.length / 2)];
  // The two prims NEAREST the wheel anchor, not the outermost pair: zooming in pushes everything
  // away from the cursor, and a far prim can be pushed off the pane entirely — where the renderer
  // culls it and the witness disappears instead of moving. Near the anchor the span still changes
  // with bar spacing while both ends stay painted.
  const pair = [...before].sort((p, q) => Math.abs(p.cx - target.cx) - Math.abs(q.cx - target.cx))
    .slice(0, 2).sort((p, q) => p.cx - q.cx);
  const [a, b] = pair;
  const span = (list: Prim[]) => Math.abs(byTid(list, b.tid).cx - byTid(list, a.tid).cx);
  const span0 = span(before);
  expect(span0, "two distinct prims are needed as the zoom witness").toBeGreaterThan(20);

  await page.mouse.move(target.cx, target.cy);
  await page.mouse.wheel(0, -240);

  // bar spacing changed → the distance between two fixed prims changed. Same witness as the pan
  // test, and the gesture the naive repair would also have eaten.
  await expect.poll(async () => Math.round(span(await prims(page))),
    { message: "a wheel over a prim should still reach the chart", timeout: 5_000 })
    .not.toBe(Math.round(span0));
});

test("the crosshair tracks continuously across a premium prim", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "crosshair is a pointer-fine interaction");
  await openTerminal(page);
  const list = await targets(page);
  const target = list[Math.floor(list.length / 2)];

  // Diagonally across the prim, so the crosshair's Y has to CHANGE at every step: a constant-y
  // sweep would pass even against a crosshair frozen at its last position.
  const cross = () => page.evaluate(() => (window as Window & {
    __mmCrosshairDodge?: () => { crossY: number | null };
  }).__mmCrosshairDodge?.().crossY ?? null);

  await page.mouse.move(target.cx - 60, target.cy - 30);
  await expect.poll(cross, { message: "the crosshair should be live before the sweep" }).not.toBeNull();

  const seen: number[] = [];
  for (let i = 0; i <= 12; i++) {
    await page.mouse.move(target.cx - 60 + i * 10, target.cy - 30 + i * 5);
    const y = await cross();
    expect(y, `the crosshair dropped out at step ${i} — directly over the prim`).not.toBeNull();
    seen.push(y as number);
  }
  expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]);
  expect(new Set(seen).size).toBeGreaterThan(6);
});

// ── 3. TOUCH: a tap must not dead-end ───────────────────────────────────────────────────────
test("tapping a premium prim opens its tooltip, and tapping away dismisses it", async ({ page }, testInfo) => {
  test.skip(!["tablet", "mobile"].includes(testInfo.project.name), "touch viewports only");
  await openTerminal(page);
  const all = await settledPrims(page);
  const list = await targets(page);
  const target = list[Math.floor(list.length / 2)];

  await page.touchscreen.tap(target.cx, target.cy);
  await expect(tip(page)).toBeVisible({ timeout: 5_000 });
  await expect(tip(page)).toHaveAttribute("data-ic-tip-for", target.tid);
  await tipShot(page, testInfo, `prim-tooltip-tap-${testInfo.project.name}`);

  // A tapped tooltip has no hover to dismiss it, so the next press must — otherwise it is litter
  // pinned over the chart. Tapped on chart that is provably clear of every prim.
  const away = await emptySpot(page, all);
  await page.touchscreen.tap(away.x, away.y);
  await expect(tip(page)).toBeHidden();
});

test("a touch press that travels is a pan, not a tooltip tap", async ({ page }, testInfo) => {
  test.skip(!["tablet", "mobile"].includes(testInfo.project.name), "touch viewports only");
  await openTerminal(page);
  const list = await targets(page);
  const target = list[Math.floor(list.length / 2)];

  await page.touchscreen.tap(target.cx, target.cy);      // prime: a still tap DOES open it…
  await expect(tip(page)).toBeVisible({ timeout: 5_000 });

  // …and a press that TRAVELS from the same prim is the chart's pan gesture, so it must close the
  // tooltip and never re-open one at the end. Synthetic pointer events, because Playwright's
  // touchscreen exposes tap() only.
  await page.evaluate((at) => {
    const layer = document.querySelector("svg [data-ic-tip]")!.closest("svg")!;
    const send = (type: string, x: number, y: number) => layer.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y,
    }));
    send("pointerdown", at.x, at.y);
    for (let i = 1; i <= 8; i++) send("pointermove", at.x + i * 12, at.y);
    send("pointerup", at.x + 96, at.y);
  }, { x: target.cx, y: target.cy });

  await expect(tip(page)).toBeHidden();
});

// ── 4. THE TOOLTIP FOLLOWS THE READER'S LANGUAGE ────────────────────────────────────────────
test("the zh view renders the prim tooltip in 中文", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "hover is a pointer-fine interaction");
  await openTerminal(page, { zhPreseed: true });
  const list = await targets(page);
  const target = list[Math.floor(list.length / 2)];

  await hoverPrim(page, target);
  await expect(tip(page)).toBeVisible();
  // Suite tooltip copy is MODULE-owned and lang-aware (`ctx.lang`); the sentence-level contract
  // belongs to lib/__tests__/suiteModules.test.ts, so this is a WIRING check only — that the zh
  // document reaches the module and its zh strings reach the DOM. `入场价` is the Trend Engine's
  // Entry row label and rides every flip tooltip it emits.
  await expect(tip(page)).toContainText("入场价");
  await tipShot(page, testInfo, "prim-tooltip-2-zh");
  await page.screenshot({ path: testInfo.outputPath("prim-tooltip-3-zh-in-zh-ui.png") });
});
