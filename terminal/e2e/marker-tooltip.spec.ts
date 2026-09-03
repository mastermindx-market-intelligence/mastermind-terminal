import { expect, test, type Page, type TestInfo } from "@playwright/test";
// The tooltip wording is owned by the copy module and imported, never transcribed — the same
// reason washout-retro.spec.ts imports `retroLegendCopy`. Sentence-level copy contracts live in
// lib/__tests__/markerTooltipCopy.test.ts; this suite pins that they RENDER, and render wired.
import { markerTooltipCopy } from "../lib/signalVerdict";

// ── THE TOOLTIPS THAT SHIPPED TO NOBODY ────────────────────────────────────────────────────
//
// Four reviewed tooltip copies — the blocked ⊘ "not an entry" line, the washout-override
// candidate line, the two waived-entry lines, and the retro re-mark line — were written,
// asserted for CONTENT by the sibling suites, and displayed to no human being. The signal layer
// is built `pointer-events:none`, so no marker is hit-testable and the browser never surfaces a
// native SVG `<title>`. This suite is the first time any of them is proved to RENDER.
//
// It carries two claims, and the second is the load-bearing one:
//
//   1. DISPLAY — hovering a marker shows that marker's own title text, per class, verbatim.
//   2. THE CHART STILL WINS — a drag that STARTS on a marker pans exactly as before, a wheel
//      over a marker still zooms, and the crosshair does not drop out as the cursor crosses one.
//
// Claim 2 is why the repair is a JS hit test rather than `pointer-events:auto` on the markers.
// That obvious version is not a smaller version of this one, it is a broken one, and the
// `pointer-events` counterfactual test below demonstrates it against the live chart rather than
// asserting it in a comment: lightweight-charts owns pan/crosshair/zoom on its own canvas, which
// is a SIBLING subtree of the overlay layers (`wrap = el.parentElement`), so an event landing on
// a hit-testable marker bubbles to the wrapper and never reaches the chart at all.

test.use({ deviceScaleFactor: 3 });   // the markers are ~19px; a 1x crop is an unreadable receipt

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
 *  fixture cannot go red on a calendar roll (same reason as the sibling washout suites). */
function ohlcFixture(days = 420) {
  const bars: [string, number, number, number, number, number][] = [];
  const start = Date.now() - days * 86_400_000;
  let px = 18;
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86_400_000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    px = Math.max(6, px * (1 - 0.0016) + Math.sin(i / 9) * 0.09);
    bars.push([d.toISOString().slice(0, 10), +(px * 1.004).toFixed(2), +(px * 1.012).toFixed(2),
               +(px * 0.988).toFixed(2), +px.toFixed(2), 1_500_000]);
  }
  return { t: "COST", o: 1, src: "e2e-fixture", bar_quality: "real_ohlc", bars };
}

const OHLC = ohlcFixture();
const BAR_DATES = OHLC.bars.map((b) => b[0]);
const BAR_CLOSES = OHLC.bars.map((b) => b[4]);
const back = (n: number) => BAR_DATES.length - 1 - n;

// FIVE fires — one per tooltip class, spaced so no two 19px markers touch at the default view,
// and all far enough from the right edge that a marker is never clipped by the price axis.
const PLAIN_I = back(70), CAND_I = back(54), RETRO_I = back(38), OVR_I = back(22), RECL_I = back(6);
const PLAIN_TS = BAR_DATES[PLAIN_I], CAND_TS = BAR_DATES[CAND_I], RETRO_TS = BAR_DATES[RETRO_I];
const OVR_TS = BAR_DATES[OVR_I], RECL_TS = BAR_DATES[RECL_I];

const BLOCK_REASON = "bear_block: monthly-bear & below-200 & 2W-not-bull";
const OVERRIDE_CTX = {
  group_id: "uranium_miners", peer_dd: -0.388, basis: "basket",
  name: "Uranium miners", name_zh: "铀矿商",
};
const RETRO_CTX = { group_id: "uranium_miners", name: "Uranium miners", name_zh: "铀矿商" };

const SLICE = {
  indicator: {
    signal_era: "gc_v2_wo2",
    state: {
      position_hint: "long", last_signal: "BUY", last_scored_signal: "BUY",
      last_scored_ts: RECL_TS, last_scored_basis: null,
      strong_bull: false, overbought: false, weeklyBull: false, above200: false,
    },
    signals: [
      // ⊘ the plain refusal — slate ring-slash
      {
        ts: PLAIN_TS, known_ts: PLAIN_TS, bar_index: PLAIN_I, type: "BUY", price: BAR_CLOSES[PLAIN_I],
        quality: "regime_blocked", blocked: true, tier: null, score: null, quality_reason: BLOCK_REASON,
      },
      // ⊘ the washout-override CANDIDATE — the same ring-slash, promoted to amber
      {
        ts: CAND_TS, known_ts: CAND_TS, bar_index: CAND_I, type: "BUY", price: BAR_CLOSES[CAND_I],
        quality: "regime_blocked", blocked: true, tier: null, score: null, quality_reason: BLOCK_REASON,
        override_candidate: true, override_ctx: OVERRIDE_CTX,
      },
      // ★ the RETRO projection — display-only counterfactual, entry geometry
      {
        ts: RETRO_TS, known_ts: RETRO_TS, bar_index: RETRO_I, type: "BUY", price: BAR_CLOSES[RETRO_I],
        quality: "regime_blocked", blocked: true, tier: null, score: null, quality_reason: BLOCK_REASON,
        retro_override: true, retro_ctx: RETRO_CTX,
      },
      // ★ the washout-override ENTRY (era gc_v2_wo1) — the regime veto was overridden
      {
        ts: OVR_TS, known_ts: OVR_TS, bar_index: OVR_I, type: "BUY", price: BAR_CLOSES[OVR_I],
        quality: "override_take", tier: "quality", score: 68,
        quality_reason: "washout override: uranium_miners −38.8% ≤ −20%",
        override_ctx: OVERRIDE_CTX,
      },
      // ★ the KEEPER's waived entry (era gc_v2_wo2) — the 200-reclaim leg was waived
      {
        ts: RECL_TS, known_ts: RECL_TS, bar_index: RECL_I, type: "BUY", price: BAR_CLOSES[RECL_I],
        quality: "reclaim_override_take", tier: "quality", score: 71,
        quality_reason: "reclaim waived: uranium_miners −38.8% ≤ −25% (era gc_v2_wo2)",
        override_ctx: OVERRIDE_CTX,
      },
    ],
    early_dots: [],
    warnings: [],
  },
  backtest: { metrics: { n_trades: 22, win_rate: 0.34, profit_factor: 1.6, cagr: 0.11 } },
};

async function applyZh(page: Page) {
  await page.locator(".mobilebar button.avatar").click();
  const settings = page.locator(".acs-card");
  await settings.getByRole("tab", { name: "Preferences" }).click();
  const zhButton = settings.getByRole("button", { name: "中文" });
  await zhButton.click();
  await expect(zhButton).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
}

async function openTerminal(page: Page, opts: { zh?: boolean; zhPreseed?: boolean } = {}) {
  if (opts.zhPreseed) {
    await page.addInitScript(() => { localStorage.setItem("mm.lang", "zh"); });
  }
  await page.route(/\/data\/COST\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(OHLC) });
  });
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(SLICE) });
  });
  // Golden Oracle markers are an OPT-IN study — seed the saved indicator set.
  await page.addInitScript(() => { localStorage.setItem("mm.inds", JSON.stringify(["_oracle"])); });
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=COST");
  await expect(page.locator(".workspace")).toBeVisible();
  await waitForTerminalVisualReady(page);
  if (opts.zh && !opts.zhPreseed) await applyZh(page);
  if (opts.zhPreseed) await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
  // the markers exist before any test touches them
  await expect(page.locator("[data-sig-layer] g title").first()).toBeAttached({ timeout: 20_000 });
}

type Marker = { t: string; title: string; cx: number; cy: number };

/** Every titled marker currently painted, in VIEWPORT coordinates — the same space the mouse
 *  moves in, so a test never has to convert. */
async function markers(page: Page): Promise<Marker[]> {
  return page.locator("[data-sig-layer]").first().evaluate((svg) => {
    const out: { t: string; title: string; cx: number; cy: number }[] = [];
    for (const g of [...svg.querySelectorAll(":scope > g")]) {
      const title = g.querySelector(":scope > title")?.textContent;
      if (!title) continue;
      const b = g.getBoundingClientRect();
      if (!(b.width > 0) || !(b.height > 0)) continue;
      out.push({ t: title.split(" ·")[0], title, cx: b.x + b.width / 2, cy: b.y + b.height / 2 });
    }
    return out;
  });
}

/** The marker field, once it has STOPPED MOVING.
 *
 *  The chart keeps sizing after hydration — panes lay out, the price axis takes its final width,
 *  and every marker's coordinates move with it. Measuring mid-settle hands back positions that are
 *  already stale by the time a pointer lands on them, which on the 390px viewport is the whole
 *  difference between a tap that opens a tooltip and one that lands 20px away in empty chart. The
 *  interaction is fine there — proven by hand — so the wait belongs in the test, not a retry.
 *  Two consecutive identical reads, never a sleep. */
async function settledMarkers(page: Page): Promise<Marker[]> {
  let prev = "";
  let list: Marker[] = [];
  await expect.poll(async () => {
    list = await markers(page);
    const key = list.map((m) => `${m.t}@${Math.round(m.cx)},${Math.round(m.cy)}`).join("|");
    const settled = list.length > 0 && key === prev;
    prev = key;
    return settled;
  }, {
    message: "the marker field should stop moving before it is measured",
    timeout: 25_000,
    intervals: [150, 200, 300, 400, 500],
  }).toBe(true);
  return list;
}

/** Resolve a FIXTURE signal date to the marker the chart actually drew for it.
 *
 *  Not an exact-key lookup, because `resolveSigMarks` snaps every signal to its NEAREST bar and
 *  the chart's bar set is not byte-identical to the JSON the fixture serves — three of these five
 *  land a day or two off the date they were emitted with. Matching by nearest date reproduces the
 *  product's own resolution; the fires are ≥16 bars apart, so the tolerance below cannot make two
 *  of them ambiguous, and a mapping that ever drifts further than that fails loudly rather than
 *  silently asserting one class's copy against another class's marker. */
function pick(list: Marker[], ts: string): Marker {
  const want = Date.parse(ts);
  let best: Marker | null = null;
  let bestD = Infinity;
  for (const m of list) {
    const d = Math.abs(Date.parse(m.t) - want);
    if (d < bestD) { bestD = d; best = m; }
  }
  expect(best, `no marker was drawn anywhere near the fixture fire at ${ts}`).toBeTruthy();
  expect(bestD / 86_400_000,
    `the marker for ${ts} snapped to ${best!.t} — too far to be the same fire`).toBeLessThan(6);
  return best!;
}

const tip = (page: Page) => page.locator(".mm-sig-tip");

/** Give the pan test its visible-tooltip precondition without repeating the sibling tap test.
 *  Under a saturated full-suite runner, Playwright can split tap()'s down/up delivery beyond the
 *  product's intentional 300 ms long-press boundary. The sibling below retains that real-device
 *  tap proof; this helper isolates the separate claim that a traveling press dismisses the tip. */
async function primeVisibleTooltip(page: Page, marker: Marker) {
  await tip(page).evaluate((node: HTMLElement, selected) => {
    node.textContent = selected.title;
    node.setAttribute("data-marker-at", selected.t);
    node.style.left = "20px";
    node.style.top = "20px";
    node.style.display = "block";
  }, { t: marker.t, title: marker.title });
}

/** Hover a marker and wait for its tooltip — polled on the tooltip's own `data-marker-at`, so the
 *  wait is for the state being asserted rather than for a timeout. */
async function hoverMarker(page: Page, m: Marker) {
  await page.mouse.move(m.cx - 40, m.cy - 40);
  await page.mouse.move(m.cx, m.cy, { steps: 6 });
  await expect(tip(page)).toHaveAttribute("data-marker-at", m.t, { timeout: 5_000 });
  await expect(tip(page)).toBeVisible();
}

// ── 1. DISPLAY: five classes, five tooltips, the right words in each ────────────────────────
test("every marker class shows its own tooltip on hover", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "hover is a pointer-fine interaction");
  await openTerminal(page);
  const list = await settledMarkers(page);
  expect(list.length, "five fires in the slice should draw five markers").toBe(5);
  const plain = pick(list, PLAIN_TS), cand = pick(list, CAND_TS), retro = pick(list, RETRO_TS);
  const ovr = pick(list, OVR_TS), recl = pick(list, RECL_TS);

  // TWO CLAIMS, kept apart on purpose.
  //
  //   (a) the RENDERED tooltip is the marker's own `<title>`, verbatim — so the visible surface and
  //       the SVG title can never drift into two different sentences; and
  //   (b) that title is what `markerTooltipCopy` says for this class in this language.
  //
  // (b) is not a tautology and it is not where the WORDING is pinned — the wording is asserted
  // sentence by sentence, in both languages, in lib/__tests__/markerTooltipCopy.test.ts, which is
  // where a copy contract belongs now that the copy lives in a module. What (b) pins is the FIELD
  // WIRING: that ChartPanel hands the copy module the emitter context intact. That is a real bug
  // class — the marker geometry flattens `override_ctx` to its ENGLISH name for its own use, so a
  // zh reader sees 铀矿商 only because the whole ctx is threaded through as well.
  const expected = (m: Marker, kind: "blocked" | "candidate" | "entry" | "reclaim" | "retro", zh = false) =>
    markerTooltipCopy({
      t: m.t,
      type: "BUY",
      ...(kind === "retro"
        ? { quality: "regime_blocked", blocked: true, reason: BLOCK_REASON, retro: true, retroCtx: RETRO_CTX }
        : kind === "blocked"
          ? { quality: "regime_blocked", blocked: true, reason: BLOCK_REASON }
          : kind === "candidate"
            ? { quality: "regime_blocked", blocked: true, reason: BLOCK_REASON, overrideCandidate: true, overrideCtx: OVERRIDE_CTX }
            : kind === "entry"
              ? { quality: "override_take", overrideTake: true, overrideCtx: OVERRIDE_CTX }
              : { quality: "reclaim_override_take", overrideTake: true, reclaimWaived: true, overrideCtx: OVERRIDE_CTX }),
    }, zh);

  // ⊘ the plain refusal — the tooltip whose whole job is the words "not an entry"
  await hoverMarker(page, plain);
  expect(await tip(page).textContent()).toBe(plain.title);          // (a)
  expect(plain.title).toBe(expected(plain, "blocked"));             // (b)
  await expect(tip(page)).toContainText("not an entry");
  await tipShot(page, testInfo, "tooltip-1-blocked");

  // ⊘ the washout-override candidate — still a refusal, and it must still say so FIRST
  await hoverMarker(page, cand);
  const candTip = (await tip(page).textContent())!;
  expect(candTip).toBe(cand.title);
  expect(cand.title).toBe(expected(cand, "candidate"));
  expect(candTip.indexOf("not an entry")).toBeLessThan(candTip.indexOf("Washout override candidate"));
  await tipShot(page, testInfo, "tooltip-2-override-candidate");

  // ★ the washout-override entry — an entry, and the hover is where "most still stop out" lives
  await hoverMarker(page, ovr);
  expect(await tip(page).textContent()).toBe(ovr.title);
  expect(ovr.title).toBe(expected(ovr, "entry"));
  await expect(tip(page)).toContainText("most still stop out");
  await expect(tip(page)).not.toContainText("not an entry");
  await tipShot(page, testInfo, "tooltip-3-override-take");

  // ★ the keeper's waived entry — names the leg that was relieved, not the regime gate
  await hoverMarker(page, recl);
  expect(await tip(page).textContent()).toBe(recl.title);
  expect(recl.title).toBe(expected(recl, "reclaim"));
  await expect(tip(page)).toContainText("never reclaimed the 200-day");
  await tipShot(page, testInfo, "tooltip-4-reclaim-override-take");

  // ★ the RETRO re-mark — the branch #378 made reachable, rendered for the first time here.
  // It is drawn identically to the waived entry above, so this sentence is the only thing on the
  // chart that distinguishes them; it must be the retro copy and not either entry's.
  await hoverMarker(page, retro);
  const retroTip = (await tip(page).textContent())!;
  expect(retroTip).toBe(retro.title);
  expect(retro.title).toBe(expected(retro, "retro"));
  expect(retroTip, "the retro tooltip must date the rule it is measured against").toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(retroTip).toContain("it is not a call we made");
  expect(retroTip).not.toContain("Washout override entry");
  expect(retroTip).not.toContain("Reclaim waived — entry");
  await tipShot(page, testInfo, "tooltip-5-retro");

  // the five sentences really are five different sentences — one marker class cannot be wearing
  // another's copy and still pass everything above
  expect(new Set(list.map((x) => x.title)).size).toBe(5);

});

/** Crop the tooltip together with the marker it belongs to — a tooltip shot on its own proves the
 *  box rendered, not that it rendered ON the thing the reader pointed at. */
async function tipShot(page: Page, testInfo: TestInfo, name: string) {
  const clip = await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>(".mm-sig-tip");
    if (!t || t.style.display === "none") return null;
    const at = t.getAttribute("data-marker-at");
    const layer = document.querySelector("[data-sig-layer]");
    const g = [...(layer?.querySelectorAll(":scope > g") ?? [])]
      .find((n) => (n.querySelector(":scope > title")?.textContent ?? "").startsWith(`${at} ·`));
    const boxes = [t.getBoundingClientRect(), ...(g ? [g.getBoundingClientRect()] : [])];
    const pad = 16;
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

// ── 2. THE CHART STILL WINS ─────────────────────────────────────────────────────────────────
//
// The markers themselves are the pan witness: renderSignals re-lays them on every visible-range
// change, so a marker that moved with the drag IS the viewport that panned, measured in the
// product's own coordinates and needing no test hook.
test("a drag that starts on a marker pans the chart", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "mouse drag");
  await openTerminal(page);
  const before = await settledMarkers(page);
  const m = pick(before, RETRO_TS);

  // Rightward: it scrolls BACK into history, which the fixture has 420 bars of, so the pan can
  // never be swallowed by the right-edge clamp instead of by a bug.
  const dx = 180;
  await page.mouse.move(m.cx, m.cy);
  await page.mouse.down();
  await page.mouse.move(m.cx + dx, m.cy, { steps: 15 });
  await page.mouse.up();

  await expect.poll(async () => Math.round(pick(await markers(page), RETRO_TS).cx),
    { message: "the marker should travel with the chart it sits on", timeout: 5_000 },
  ).toBeGreaterThan(Math.round(m.cx) + dx * 0.5);

  // …and it travelled by the drag distance, not merely somewhere. A marker that moved a few px
  // would mean the chart took part of the gesture and dropped the rest.
  const after = await markers(page);
  const moved = pick(after, RETRO_TS).cx - m.cx;
  expect(Math.abs(moved - dx)).toBeLessThan(dx * 0.35);
  // the whole marker field moved together — the chart panned, one marker did not wander
  const movedOther = pick(after, OVR_TS).cx - pick(before, OVR_TS).cx;
  expect(Math.abs(movedOther - moved)).toBeLessThan(4);
});

test("the pointer-events repair would have broken that drag", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "mouse drag");
  // THE COUNTERFACTUAL, run against the live chart rather than argued in a comment. Making the
  // markers hit-testable is the obvious way to revive a native `<title>` — and it silently takes
  // the chart's gestures away over every marker's footprint, because the lightweight-charts canvas
  // is a sibling subtree of this overlay and never receives an event that lands here. If this test
  // ever goes green-by-panning, the structural claim in lib/markerTooltip.ts is wrong and the
  // simpler implementation should replace this one.
  await openTerminal(page);
  const m = pick(await settledMarkers(page), RETRO_TS);

  await page.locator("[data-sig-layer]").first().evaluate((svg) => {
    for (const g of svg.querySelectorAll(":scope > g")) g.setAttribute("pointer-events", "all");
  });

  await page.mouse.move(m.cx, m.cy);
  await page.mouse.down();
  await page.mouse.move(m.cx + 180, m.cy, { steps: 15 });
  await page.mouse.up();

  expect(
    Math.abs(pick(await markers(page), RETRO_TS).cx - m.cx),
    "a hit-testable marker swallows the drag — which is why the shipped layer stays pointer-events:none",
  ).toBeLessThan(4);
});

test("the crosshair tracks continuously across a marker", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "crosshair is a pointer-fine interaction");
  await openTerminal(page);
  const m = pick(await settledMarkers(page), RETRO_TS);

  // Diagonally across the marker, so the crosshair's Y has to CHANGE at every step: a constant-y
  // sweep would pass even against a crosshair frozen at its last position.
  const cross = () => page.evaluate(() => (window as Window & {
    __mmCrosshairDodge?: () => { crossY: number | null };
  }).__mmCrosshairDodge?.().crossY ?? null);

  await page.mouse.move(m.cx - 60, m.cy - 30);
  await expect.poll(cross, { message: "the crosshair should be live before the sweep" }).not.toBeNull();

  const seen: number[] = [];
  for (let i = 0; i <= 12; i++) {
    await page.mouse.move(m.cx - 60 + i * 10, m.cy - 30 + i * 5);
    const y = await cross();
    expect(y, `the crosshair dropped out at step ${i} — directly over the marker`).not.toBeNull();
    seen.push(y as number);
  }
  // it MOVED across the sweep (a live crosshair, not a stuck one) and never repeated a stall
  expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]);
  expect(new Set(seen).size).toBeGreaterThan(6);
});

test("a wheel over a marker still zooms the chart", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "wheel");
  await openTerminal(page);
  const before = await settledMarkers(page);
  const m = pick(before, RETRO_TS);
  const span = (list: Marker[]) => Math.abs(pick(list, RECL_TS).cx - pick(list, PLAIN_TS).cx);
  const span0 = span(before);

  await page.mouse.move(m.cx, m.cy);
  await page.mouse.wheel(0, -240);

  // bar spacing changed → the distance between two fixed markers changed. Same witness as the
  // pan test, and the gesture the naive repair would also have eaten.
  await expect.poll(async () => Math.round(span(await markers(page))),
    { message: "a wheel over a marker should still reach the chart", timeout: 5_000 })
    .not.toBe(Math.round(span0));
});

// ── 3. TOUCH: a tap must not dead-end ───────────────────────────────────────────────────────
test("tapping a marker opens its tooltip, and tapping away dismisses it", async ({ page }, testInfo) => {
  test.skip(!["tablet", "mobile"].includes(testInfo.project.name), "touch viewports only");
  await openTerminal(page);
  const target = pick(await settledMarkers(page), RETRO_TS);

  await page.touchscreen.tap(target.cx, target.cy);
  await expect(tip(page)).toBeVisible({ timeout: 5_000 });
  await expect(tip(page)).toHaveAttribute("data-marker-at", target.t);
  expect(await tip(page).textContent()).toBe(target.title);
  await tipShot(page, testInfo, `tooltip-tap-${testInfo.project.name}`);

  // A tapped tooltip has no hover to dismiss it, so the next press must — otherwise it is litter
  // pinned over the chart. Tapped well clear of every marker.
  const box = await page.locator("[data-sig-layer]").first().boundingBox();
  await page.touchscreen.tap((box?.x ?? 0) + 20, (box?.y ?? 0) + 20);
  await expect(tip(page)).toBeHidden();
});

test("a touch press that travels is a pan, not a tooltip tap", async ({ page }, testInfo) => {
  test.skip(!["tablet", "mobile"].includes(testInfo.project.name), "touch viewports only");
  await openTerminal(page);
  const m = pick(await settledMarkers(page), RETRO_TS);

  await primeVisibleTooltip(page, m);          // prime only the drag test's open-tip precondition
  await expect(tip(page)).toBeVisible({ timeout: 5_000 });

  // …and a press that TRAVELS from the same marker is the chart's pan gesture, so it must close
  // the tooltip and never re-open one at the end. The pan itself belongs to lightweight-charts and
  // is untouched by this PR (no hit-testing changed); what is under test is that the tap path does
  // not mistake a drag for a tap and litter a tooltip over the pane the reader just moved.
  // Synthetic pointer events, because Playwright's touchscreen exposes tap() only.
  await page.locator("[data-sig-layer]").first().evaluate((node, at) => {
    const send = (type: string, x: number, y: number) => node.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y,
    }));
    send("pointerdown", at.x, at.y);
    for (let i = 1; i <= 8; i++) send("pointermove", at.x + i * 12, at.y);
    send("pointerup", at.x + 96, at.y);
  }, { x: m.cx, y: m.cy });

  await expect(tip(page)).toBeHidden();
});

// ── 4. THE TOOLTIP IS THE MARKER'S OWN STRING, IN EVERY LANGUAGE ────────────────────────────
test("the zh view renders the markers in 中文, not English", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "hover is a pointer-fine interaction");
  await openTerminal(page, { zh: true, zhPreseed: true });
  const list = await settledMarkers(page);

  // THE REGRESSION THIS SUITE EXISTS TO PREVENT. These tooltips were English literals inside
  // ChartPanel's render loop for as long as they existed — invisible to the bilingual-UI law only
  // because `pointer-events:none` meant no reader could reach them. Reviving them without moving
  // the copy would have shipped English into a Chinese product; this asserts it did not.
  for (const ts of [PLAIN_TS, CAND_TS, RETRO_TS, OVR_TS, RECL_TS]) {
    const marker = pick(list, ts);
    await hoverMarker(page, marker);
    expect(await tip(page).textContent()).toBe(marker.title);   // the render invariant, in zh too
    // No English PROSE. `BUY` is the emitter's signal type and rides the glyph in both languages,
    // and `quality_reason` is a raw latin diagnostic slug the product passes through untranslated
    // in both — so the check is for lowercase RUNS outside that slug, the same shape signalVerdict's
    // own zh assertions use.
    const prose = marker.title.replace(BLOCK_REASON, "");
    expect(prose, `${ts} still carries English prose in the zh view`).not.toMatch(/[a-z]{4,}/);
  }

  // the group name comes from the ctx's OWN zh name — the marker geometry flattens it to English
  expect(pick(list, CAND_TS).title).toContain("铀矿商");
  expect(pick(list, RETRO_TS).title).toContain("铀矿商");
  // and the two claims that matter most, in the reader's language
  expect(pick(list, PLAIN_TS).title).toContain("非入场信号");
  expect(pick(list, RETRO_TS).title).toContain("当时系统并未入场");

  // Receipts: the tooltip in 中文, and the same tooltip inside the Chinese product surface.
  await hoverMarker(page, pick(list, RETRO_TS));
  await tipShot(page, testInfo, "tooltip-6-zh");
  await page.screenshot({ path: testInfo.outputPath("tooltip-7-zh-in-zh-ui.png") });
});
