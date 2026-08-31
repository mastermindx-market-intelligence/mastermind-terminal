import { test, expect, type Page, type TestInfo } from "@playwright/test";
// The legend copy is imported, not transcribed: it is the single disclosure that carries the
// counterfactual, so an assertion that could drift away from it is worse than no assertion.
import { markerTooltipCopy, retroLegendCopy, washoutOverrideCopy } from "../lib/signalVerdict";

// ── THREE STATES OF ONE MECHANISM, ON ONE CHART ───────────────────────────────────────────
//
// Sibling of `washout-override.spec.ts`, and deliberately a SINGLE fixture: the three classes
// below are only meaningfully correct RELATIVE TO EACH OTHER, and every one of them has been
// mistaken for one of the others at some point in the mechanism's history. Rendering them one
// per fixture proves each looks like itself; rendering them side by side is what proves a
// reader can tell them apart.
//
//   1. a plain `regime_blocked` refusal   — slate ⊘, dimmed. The engine said no.
//   2. a RETRO PROJECTION                 — entry geometry, and since the operator's 2026-08-10
//                                           order NO marker-level mark of its own. Today's rule
//                                           WOULD have entered; the engine did not.
//   3. a live `reclaim_override_take`     — the same entry geometry. A real entry the keeper's
//                                           200-reclaim waiver let through (era gc_v2_wo2),
//                                           which anchors the card.
//
// THE HARD BOUNDARY this suite exists to hold. #2 and #3 are drawn IDENTICALLY on purpose — the
// question "would today's rule have entered here?" is an entry question, and the operator ruled
// the chart face stays clean. That makes the disclosure entirely a CARD responsibility, so the
// two claims this suite is really defending are:
//   (a) the card legend (`.sd-sig-legend`) renders whenever a re-marked fire is in the visible
//       list and NOT otherwise — asserted against `retroLegendCopy` itself so it cannot drift,
//       with a second fixture as the control. It is the only place a reader is told that a star
//       on the tape is a counterfactual, so it is pinned harder than anything else here.
//   (b) #2 never reaches the verdict: the rail card is anchored by #3 alone, and a chart
//       carrying a retro mark and nothing else still renders a refusal.
// Note what is deliberately NOT asserted: the markers' `<title>` tooltips as a disclosure tier.
// The signal layer is `pointer-events:none` (ChartPanel.tsx), so none of them can render.
//
// NOTE ON THEMES: the Terminal ships ONE theme (dark) — `terminal/app/settings.css` documents
// it. Both LANGUAGES are covered: desktop carries EN and ZH (the returning-user preseed path),
// tablet carries ZH on its own, matching the sibling spec's convention.

// A higher device pixel ratio for the SHOTS only. The markers are ~19px and the legend is the
// smallest copy on the card, so a 1x crop is unreadable to a PR reviewer — which would make the
// visual receipt for this change worthless, and the receipt is half the point of the suite.
// Geometry and computed styles are in CSS pixels and are unaffected.
test.use({ deviceScaleFactor: 3 });

// Hydration gate, same shape as washout-override.spec.ts (the helpers are per-spec there).
type VisualReadyDetail = { symbol: string; timeframe: string; generation: number; state: "data" | "empty" };
type ReadyReceipt = {
  detail: VisualReadyDetail;
  refusalAttached: boolean;
  signalLayerAttached: boolean;
  signalChildren: number;
  oracleLegendAttached: boolean;
};

async function armTerminalVisualReady(page: Page, expected = { symbol: "COST", timeframe: "D" }) {
  await page.addInitScript(({ symbol, timeframe }) => {
    type Detail = { symbol?: unknown; timeframe?: unknown; generation?: unknown; state?: unknown };
    type Receipt = {
      detail: Detail;
      refusalAttached: boolean;
      signalLayerAttached: boolean;
      signalChildren: number;
      oracleLegendAttached: boolean;
    };
    const readyWindow = window as Window & {
      __mmResponsiveVisualReady?: Receipt | null;
      __mmVisualReadyEvents?: Detail[];
    };
    readyWindow.__mmResponsiveVisualReady = null;
    readyWindow.__mmVisualReadyEvents = [];
    window.addEventListener("mm:terminal-visual-ready", (event) => {
      const detail = (event as CustomEvent<Detail>).detail;
      readyWindow.__mmVisualReadyEvents!.push(detail);
      if (detail?.state !== "data" || detail.symbol !== symbol || detail.timeframe !== timeframe
          || !Number.isInteger(detail.generation) || Number(detail.generation) <= 0) return;
      const signalLayer = document.querySelector("[data-sig-layer]");
      readyWindow.__mmResponsiveVisualReady = {
        detail,
        refusalAttached: document.querySelector('[data-sig-layer] circle[fill="none"]') !== null,
        signalLayerAttached: signalLayer !== null,
        signalChildren: signalLayer?.childElementCount ?? -1,
        oracleLegendAttached: [...document.querySelectorAll(".ind-name")]
          .some((node) => node.textContent?.includes("Golden Oracle Confluence")),
      };
    });
  }, expected);
}

async function waitForTerminalVisualReady(page: Page, refusalExpected = true) {
  await expect.poll(
    () => page.evaluate(() =>
      Boolean((window as Window & { __mmResponsiveVisualReady?: boolean }).__mmResponsiveVisualReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 15_000 },
  ).toBe(true);
  const receipt = await page.evaluate(() =>
    (window as Window & { __mmResponsiveVisualReady?: ReadyReceipt | null }).__mmResponsiveVisualReady);
  expect(receipt?.refusalAttached,
    refusalExpected
      ? `visual-ready must not release while the seeded Oracle refusal is absent; receipt=${JSON.stringify(receipt)}`
      : "an ordinary no-signal generation must not invent an Oracle refusal",
  ).toBe(refusalExpected);
  return receipt!;
}

/** A synthetic daily OHLC series ending on the most recent weekday.
 *
 *  Same reason as the sibling spec: ChartPanel drops any slice signal dated after the last bar,
 *  and the rail card only grants an anchor full authority inside the 21-day staleness window —
 *  so a fixture fire recent enough for the CARD is newer than any committed bars. Taking the
 *  signal dates FROM the series is what stops the suite going red every time the calendar hands
 *  it a weekend.
 */
function ohlcFixture(days = 420) {
  const bars: [string, number, number, number, number, number][] = [];
  const start = Date.now() - days * 86_400_000;
  let px = 18;
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86_400_000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;   // weekdays only
    // a long slide into a washout, so the tape under the refusals reads like the real case
    px = Math.max(6, px * (1 - 0.0016) + Math.sin(i / 9) * 0.09);
    bars.push([d.toISOString().slice(0, 10), +(px * 1.004).toFixed(2), +(px * 1.012).toFixed(2),
               +(px * 0.988).toFixed(2), +px.toFixed(2), 1_500_000]);
  }
  return { t: "COST", o: 1, src: "e2e-fixture", bar_quality: "real_ohlc", bars };
}

const OHLC = ohlcFixture();
const BAR_DATES = OHLC.bars.map((b) => b[0]);
const BAR_CLOSES = OHLC.bars.map((b) => b[4]);
/** index counted back from the newest bar */
const back = (n: number) => BAR_DATES.length - 1 - n;

// Three fires, near enough to share one crop and far enough apart that two 19px marker pills
// never touch at the default ~240-bar view. Prices come off the bars for the same reason the
// dates do — a hardcoded price that drifts off the visible range is a scheduled failure.
const PLAIN_I = back(24), RETRO_I = back(12), TAKE_I = back(0);
const PLAIN_TS = BAR_DATES[PLAIN_I], RETRO_TS = BAR_DATES[RETRO_I], TAKE_TS = BAR_DATES[TAKE_I];

const OVERRIDE_CTX = {
  group_id: "uranium_miners",
  peer_dd: -0.388,
  basis: "basket",
  thresholds_hit: [20, 25, 30],
  as_of: TAKE_TS,
  name: "Uranium miners",
  name_zh: "铀矿商",
};

/** `mark_retro` writes retro_override + retro_ctx and NOTHING ELSE — no quality, no tier, no
 *  blocked flag, no ledger row. The fixture reproduces that literally: this fire is still, in
 *  every field the scored lane reads, the `regime_blocked` refusal it always was. */
const RETRO_CTX = { group_id: "uranium_miners", name: "Uranium miners", name_zh: "铀矿商" };

const SLICE = {
  indicator: {
    signal_era: "gc_v2_wo2",
    state: {
      // the waived entry IS an entry, so the scored lane walks to it
      position_hint: "long",
      last_signal: "BUY",
      last_scored_signal: "BUY",
      last_scored_ts: TAKE_TS,
      last_scored_basis: null,
      strong_bull: false,
      overbought: false,
      weeklyBull: false,
      above200: false,
    },
    signals: [
      // 1. the plain refusal — the control. Nothing about it may change.
      {
        ts: PLAIN_TS, known_ts: PLAIN_TS, bar_index: PLAIN_I, type: "BUY",
        price: BAR_CLOSES[PLAIN_I],
        quality: "regime_blocked", blocked: true, tier: null, score: null,
        quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull",
      },
      // 2. the retro projection — a PRE-FENCE refusal, re-marked display-only
      {
        ts: RETRO_TS, known_ts: RETRO_TS, bar_index: RETRO_I, type: "BUY",
        price: BAR_CLOSES[RETRO_I],
        quality: "regime_blocked", blocked: true, tier: null, score: null,
        quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull",
        retro_override: true, retro_ctx: RETRO_CTX,
      },
      // 3. the live waived entry — the keeper graded it, the waiver dropped its 200-reclaim leg
      {
        ts: TAKE_TS, known_ts: TAKE_TS, bar_index: TAKE_I, type: "BUY",
        price: BAR_CLOSES[TAKE_I],
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

/** `withRetro:false` drops fire #2 and NOTHING else — the control the legend assertion needs.
 *  A disclosure that renders unconditionally is not a disclosure, it is furniture; the only way
 *  to show the legend is doing work is to show the same card without it. */
const sliceFixture = (withRetro: boolean) => ({
  ...SLICE,
  indicator: {
    ...SLICE.indicator,
    signals: SLICE.indicator.signals.filter((s) => withRetro || !("retro_override" in s)),
  },
});

/** Flip the Terminal to Chinese through the real settings flow (no fixture shortcut — a
 *  language the user cannot actually reach is not a language the product ships). Viewport-bound
 *  to the tablet/mobile chrome; desktop uses `zhPreseed` (the RETURNING user's path). */
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

async function openTerminal(page: Page, opts: { zh: boolean; zhPreseed?: boolean; retro?: boolean }) {
  const slice = sliceFixture(opts.retro !== false);
  if (opts.zhPreseed) {
    await page.addInitScript(() => { localStorage.setItem("mm.lang", "zh"); });
  }
  await page.route(/\/data\/COST\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(OHLC) });
  });
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(slice) });
  });
  // Golden Oracle markers are an OPT-IN study (TerminalShell item-28) — seed the saved
  // indicator set so the marker geometry actually renders on the price series.
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["_oracle"]));
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
  });
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=COST");
  await expect(page.locator(".workspace")).toBeVisible();
  await waitForTerminalVisualReady(page);
  if (opts.zh && !opts.zhPreseed) await applyZh(page);
  if (opts.zhPreseed) await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
}

/** The amber `--signal` token, as the browser resolves it (#e8b339). */
const AMBER_RGB = "rgb(232, 179, 57)";
/** The refused-entry slate (#7c8aa0) — no CSS token, an inline hex in ChartPanel. */
const SLATE_RGB = "rgb(124, 138, 160)";

/** Mirror of signalVerdict's `fmtDate`, so the expected card sub-line is DERIVED from the
 *  fixture's own dates rather than hardcoded (the fixture moves with the calendar). */
const fmtSub = (iso: string, zh: boolean) =>
  new Date(Date.parse(iso)).toLocaleDateString(zh ? "zh-CN" : "en-US",
    { month: "short", day: "numeric", timeZone: "UTC" });

type MarkerRead = {
  opacity: string | null;
  ringSlashes: number;
  ringStroke: string | null;
  rect: { stroke: string; fill: string; strokeWidth: string | null; box: string } | null;
  texts: string[];
  title: string;
  cx: number;
};

/** Read all three markers out of the signal layer in one round trip.
 *
 *  Keyed on the marker's own BAR DATE, which every title carries as its `${m.t} · ` prefix.
 *  That is the only identifier that survives this change: since the operator's 2026-08-10 order
 *  the retro mark and the live waived entry are drawn identically on purpose, so neither shape
 *  nor glyph nor outline can tell them apart — which is exactly the claim this suite has to
 *  verify, and it cannot verify it using the thing under test as the selector. */
async function readMarkers(
  page: Page,
  at: { plain: string; retro: string; waived: string },
): Promise<Record<"plain" | "retro" | "waived", MarkerRead | null>> {
  return page.locator("[data-sig-layer]").first().evaluate((svg, dates) => {
    const groups = [...svg.querySelectorAll("g")];
    const textsOf = (g: Element) => [...g.querySelectorAll("text")].map((t) => t.textContent ?? "");
    const titleOf = (g: Element) => g.querySelector("title")?.textContent ?? "";
    const read = (g: Element | undefined): MarkerRead | null => {
      if (!g) return null;
      const rect = g.querySelector<SVGRectElement>("rect");
      const ring = g.querySelector<SVGCircleElement>('circle[fill="none"]');
      const box = (g as SVGGElement).getBoundingClientRect();
      return {
        opacity: g.getAttribute("opacity"),
        ringSlashes: g.querySelectorAll('circle[fill="none"]').length,
        ringStroke: ring ? getComputedStyle(ring).stroke : null,
        rect: rect ? {
          stroke: getComputedStyle(rect).stroke,
          fill: getComputedStyle(rect).fill,
          strokeWidth: rect.getAttribute("stroke-width"),
          // pill geometry as the marker declares it — the equality claim below rides on this
          box: `${rect.getAttribute("width")}×${rect.getAttribute("height")}r${rect.getAttribute("rx")}`,
        } : null,
        texts: textsOf(g),
        title: titleOf(g),
        cx: box.x + box.width / 2,
      };
    };
    const at = (d: string) => read(groups.find((g) => titleOf(g).startsWith(`${d} ·`)));
    return { plain: at(dates.plain), retro: at(dates.retro), waived: at(dates.waived) };
    // (MarkerRead is declared in the spec's module scope; the browser only needs the shape)
  }, at) as Promise<Record<"plain" | "retro" | "waived", MarkerRead | null>>;
}

/** Crop tight around all THREE markers at once — the whole point of the fixture is that they
 *  are legible side by side, so the receipt has to show them side by side. */
async function cropThreeMarkers(page: Page, path: string) {
  const clip = await page.locator("[data-sig-layer]").first().evaluate((svg, dates) => {
    const groups = [...svg.querySelectorAll("g")];
    const titleOf = (g: Element) => g.querySelector("title")?.textContent ?? "";
    const wanted = dates
      .map((d) => groups.find((g) => titleOf(g).startsWith(`${d} ·`)))
      .filter(Boolean) as SVGGElement[];
    if (wanted.length < 3) return null;
    const boxes = wanted.map((g) => g.getBoundingClientRect());
    const x0 = Math.min(...boxes.map((b) => b.left));
    const x1 = Math.max(...boxes.map((b) => b.right));
    const y0 = Math.min(...boxes.map((b) => b.top));
    const y1 = Math.max(...boxes.map((b) => b.bottom));
    const padX = 24, padY = 20;
    return {
      x: Math.max(0, x0 - padX),
      y: Math.max(0, y0 - padY),
      width: Math.min(window.innerWidth - Math.max(0, x0 - padX), x1 - x0 + padX * 2),
      height: Math.min(window.innerHeight - Math.max(0, y0 - padY), y1 - y0 + padY * 2),
    };
  }, [PLAIN_TS, RETRO_TS, TAKE_TS]);
  if (!clip || clip.width <= 0 || clip.height <= 0) return;
  await page.screenshot({ path, clip });
}

/** Screenshot an element framed by the union of its own box and every descendant's, clamped to
 *  the viewport. `element.screenshot()` uses the element's box alone, which silently crops any
 *  child that overflows it — and a receipt with the evidence cropped off is worse than none. */
async function cropUnion(page: Page, selector: string, path: string, pad = 10) {
  const clip = await page.locator(selector).first().evaluate((el, padding) => {
    const boxes = [el, ...el.querySelectorAll("*")].map((n) => n.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    if (!boxes.length) return null;
    const x = Math.max(0, Math.min(...boxes.map((b) => b.left)) - padding);
    const y = Math.max(0, Math.min(...boxes.map((b) => b.top)) - padding);
    return {
      x, y,
      width: Math.min(window.innerWidth - x, Math.max(...boxes.map((b) => b.right)) + padding - x),
      height: Math.min(window.innerHeight - y, Math.max(...boxes.map((b) => b.bottom)) + padding - y),
    };
  }, pad);
  if (!clip || clip.width <= 0 || clip.height <= 0) return;
  await page.screenshot({ path, clip });
}

/** Everything the three states must be true of, in one language. */
async function assertThreeStates(page: Page, zh: boolean, tag: string, testInfo: TestInfo) {
  const out = (name: string) => testInfo.outputPath(`${tag}-${name}.png`);

  // ── 1/2/3 on the chart: three markers, three different things ──────────────────────────
  const sigLayer = page.locator("[data-sig-layer]").first();
  await expect(sigLayer.locator('circle[fill="none"]').first()).toBeAttached();
  const m = await readMarkers(page, { plain: PLAIN_TS, retro: RETRO_TS, waived: TAKE_TS });
  expect(m.plain, "the plain regime_blocked refusal should draw a ring-slash").not.toBeNull();
  expect(m.retro, "the retro projection should draw an entry-geometry marker").not.toBeNull();
  expect(m.waived, "the waived entry should draw an entry marker with its own hover").not.toBeNull();

  // 1. the refusal is untouched: slate ⊘, dimmed to background, no entry geometry anywhere
  expect(m.plain!.ringSlashes).toBeGreaterThanOrEqual(1);
  expect(m.plain!.ringStroke).toBe(SLATE_RGB);
  expect(m.plain!.opacity).toBe("0.62");
  expect(m.plain!.rect).toBeNull();                    // no pill: a refusal never wears one
  expect(m.plain!.texts).not.toContain("★");
  // The marker hover is BILINGUAL since the marker-tooltip repair. It was English-only for as
  // long as it existed, which no one could see because the layer is `pointer-events:none`;
  // making it visible made that a live regression for zh readers, so the copy moved into the
  // copy module and this assertion moved with it.
  expect(m.plain!.title).toContain(zh ? "被趋势闸拦截 — 非入场信号" : "blocked by the regime gate — not an entry");

  // 2. the retro projection wears ENTRY geometry, and carries NO marker-level mark of its own
  // (operator order 2026-08-10). The star it wears is the entry star; the only thing that says
  // it is a counterfactual lives on the card, which is why the legend below is pinned hardest.
  expect(m.retro!.rect).not.toBeNull();
  expect(m.retro!.rect!.stroke).toBe(AMBER_RGB);       // the washout signature
  expect(m.retro!.rect!.strokeWidth).toBe("1.6");
  expect(m.retro!.rect!.fill).not.toBe("none");        // solid, like the entry it is asking about
  expect(m.retro!.ringSlashes).toBe(0);                // it left the refusal geometry behind
  expect(m.retro!.texts).toEqual(["★"]);               // the star, and NOTHING else
  // the tier badge is absent — a counterfactual was never graded by the recipe
  expect(m.retro!.texts).not.toContain("Q");
  expect(m.retro!.texts).not.toContain("A+");
  // its hover must never claim the entry happened, whatever else it says — in either language
  expect(m.retro!.title).not.toContain(washoutOverrideCopy(OVERRIDE_CTX, zh, "reclaim")!.line);
  expect(m.retro!.title).not.toContain(washoutOverrideCopy(OVERRIDE_CTX, zh, "entry")!.line);
  // …and it must say the INTENDED thing, verbatim. Until #378 this branch was unreachable (SOFT_Q
  // always won), and until the marker-tooltip repair the string it emitted displayed to nobody —
  // so for the whole of this class's history the copy was only ever pinned by the two negatives
  // above, which any wrong-but-different sentence would also have satisfied. The tooltip renders
  // now, so the assertion is the whole sentence. The rule date is the one variable: it is a
  // constant in ChartPanel that moves when the rule does, so it is validated for SHAPE and then
  // substituted, which pins every word around it without scheduling a red for the day it changes.
  expect(m.retro!.title, "the retro tooltip must name WHICH rule the counterfactual is measured against")
    .toMatch(/\d{4}-\d{2}-\d{2}/);
  // The WHOLE sentence, in the language under test, from the same copy function the product
  // calls. Not a tautology: it pins that ChartPanel hands the copy module the right FIELDS. The
  // retro context is the one that matters — `name_zh` lives only there, and the marker geometry
  // flattens the group to its ENGLISH name, so a zh reader sees 铀矿商 only if the ctx is threaded
  // through intact. Reconstructing the mark from the fixture is what makes that checkable.
  expect(m.retro!.title).toBe(markerTooltipCopy({
    t: RETRO_TS, type: "BUY", quality: "regime_blocked", blocked: true, retro: true, retroCtx: RETRO_CTX,
  }, zh));

  // 3. the live waived entry: the SAME pill, and no tag — this one really happened
  expect(m.waived!.rect).not.toBeNull();
  expect(m.waived!.rect!.stroke).toBe(AMBER_RGB);
  expect(m.waived!.rect!.strokeWidth).toBe("1.6");
  expect(m.waived!.rect!.fill).not.toBe("none");
  expect(m.waived!.ringSlashes).toBe(0);
  expect(m.waived!.texts).toContain("★");
  expect(m.waived!.texts).toContain("Q");              // recipe tier: the keeper graded this one
  // NOTE — the `<title>` assertions here and above check the COPY. That a reader can now actually
  // SEE it is a separate claim, proved in `marker-tooltip.spec.ts`: the layer is still created
  // `pointer-events:none` and no marker re-enables it (which is what keeps chart drags intact), so
  // the tooltip is driven by a JS hit test instead, and that suite is where the rendered surface
  // and its drag-safety are pinned. Either way the disclosure this suite holds the product to is
  // the card legend further down — a hover is invisible on touch, in a screenshot, and to anyone
  // skimming, so it is a bonus tier and never the disclosure.
  expect(m.waived!.title).toContain(washoutOverrideCopy(OVERRIDE_CTX, zh, "reclaim")!.line);
  expect(m.waived!.title).toContain(zh ? "铀矿商" : "Uranium miners");
  expect(m.waived!.title).toContain("−38%");
  // the waived LEG, named — this class relieved the 200-reclaim, not the regime veto
  expect(m.waived!.title).toContain(zh ? "只差收复200日线" : "never reclaimed the 200-day");
  expect(m.waived!.title).not.toContain(zh ? "非入场信号" : "not an entry");

  // …and the two really are the same marker. This is the ASSERTED, INTENDED state after the
  // 2026-08-10 order, not an accident: identical pill geometry, identical amber outline,
  // identical fill. It is also the exact reason the card legend below is not optional — with
  // the markers indistinguishable, the card is the only place the counterfactual is disclosed.
  expect(m.retro!.rect!.box).toBe(m.waived!.rect!.box);
  expect(m.retro!.rect!.stroke).toBe(m.waived!.rect!.stroke);
  expect(m.retro!.rect!.strokeWidth).toBe(m.waived!.rect!.strokeWidth);
  expect(m.retro!.rect!.fill).toBe(m.waived!.rect!.fill);
  // three markers, left to right, at three different places on the tape
  expect(m.plain!.cx).toBeLessThan(m.retro!.cx);
  expect(m.retro!.cx).toBeLessThan(m.waived!.cx);
  await cropThreeMarkers(page, out("chart-three-states"));

  // ── the rail: anchored by the LIVE entry, in the ordinary entry language ────────────────
  const signalButton = page.locator(".sig-btn");
  await signalButton.scrollIntoViewIfNeeded();
  await expect(signalButton.locator(".sig-btn-go .sig-btn-vd")).toHaveText(zh ? "买入" : "Buy");
  const railTitle = (await signalButton.getAttribute("title")) ?? "";
  if (zh) {
    expect(railTitle).toContain("次根K线");
    expect(railTitle).toContain("多数仍会止损离场 — 止损才是保护");
  } else {
    expect(railTitle).toContain("the keeper would refuse this");
    expect(railTitle).toContain("it held the next bar but never reclaimed the 200-day");
    expect(railTitle).toContain("most still stop out — the stop is the protection");
  }
  await signalButton.screenshot({ path: out("rail") });

  // ── THE HARD BOUNDARY ──────────────────────────────────────────────────────────────────
  // The retro fire sits between the refusal and the entry on the tape. It must contribute
  // NOTHING to the verdict: not the label, not the date, not one clause of the hover.
  expect(railTitle).not.toContain(zh ? "按当前规则本会入场" : "Would have entered under today's rule");
  expect(railTitle).not.toContain(zh ? "事后按当前规则重标" : "re-marked under the current rule");
  expect(railTitle).not.toContain(zh ? "非入场信号" : "not an entry");

  // ── the card: entry verdict, ONE disclosure line, the recipe's grade beside it ──────────
  await signalButton.click();
  const dialog = page.locator(".sd-scrim");
  await expect(dialog).toBeVisible();
  const go = dialog.locator(".sd-go");
  await expect(go.locator(".od-verdict")).toHaveText(zh ? "买入" : "Buy");
  // dated from the LIVE entry — the retro fire is 12 bars older and never anchors
  await expect(go.locator(".od-vsub")).toHaveText(fmtSub(TAKE_TS, zh));
  expect(fmtSub(TAKE_TS, zh)).not.toBe(fmtSub(RETRO_TS, zh));   // the check has teeth

  const line2 = go.locator(".od-vline2");
  await expect(line2).toHaveCount(1);
  await expect(line2).toHaveCSS("color", AMBER_RGB);
  if (zh) {
    // ZH reclaim wording is mid-correction — assert the SHAPE (see the vitest suite's note):
    // the washout half is pinned, the head must simply not borrow the sibling class's name.
    await expect(line2).toContainText("铀矿商板块距高点 −38%");
    await expect(line2).not.toContainText("深度洗盘例外");
  } else {
    await expect(line2).toHaveText("Reclaim waived — entry — Uranium miners −38% from highs");
  }
  // the quality chip names the class in the card body, and the TIER beside it proves the
  // recipe graded this entry — a null tier here would mean it took the refused path after all
  await expect(go.locator(".sig-dims")).toBeVisible();
  const quality = go.locator(".sig-dim-v").first();
  await expect(quality).toHaveCSS("color", AMBER_RGB);
  if (zh) {
    await expect(quality).not.toHaveText("");
    await expect(quality).not.toHaveText(/[A-Za-z]{4,}/);   // a real translation, not the EN string
  } else {
    await expect(quality).toHaveText("Reclaim waived");
  }
  await expect(go.locator(".sig-dims .sig-dim-v").nth(1)).toHaveText(zh ? "优质" : "Quality");
  // the refusal's own "⃠ Entry blocked" strip belongs to a blocked LATEST signal — not here
  await expect(go.locator(".sig-conflict")).toHaveCount(0);
  await go.locator(".sig-card").screenshot({ path: out("card-reclaim-waived") });

  // ── the signal history: three rows, three different rows ────────────────────────────────
  const rows = go.locator(".sd-siglist .sd-sigrow");
  await expect(rows).toHaveCount(3);                    // newest first: waived, retro, refusal

  // row 0 — the live waived entry: a solid BUY pill and the class's own qualifier
  const waivedRow = rows.nth(0);
  await expect(waivedRow.locator(".sd-sig-badge")).toHaveText("BUY");
  await expect(waivedRow.locator(".sd-sig-badge")).not.toHaveClass(/hollow/);
  if (zh) {
    await expect(waivedRow.locator(".sd-sig-q")).not.toHaveText(/[A-Za-z]{4,}/);
    await expect(waivedRow.locator(".sd-sig-q")).not.toHaveText("");
  } else {
    await expect(waivedRow.locator(".sd-sig-q")).toHaveText("Reclaim waived");
  }

  // row 1 — the retro projection: the BUY badge (it is asking an entry question), hollow (it
  // is not one), and the qualifier that says so in the row itself
  const retroRow = rows.nth(1);
  await expect(retroRow.locator(".sd-sig-badge")).toHaveText("BUY");
  await expect(retroRow.locator(".sd-sig-badge")).toHaveClass(/hollow/);
  await expect(retroRow.locator(".sd-sig-q")).toHaveText(zh ? "（事后重标）" : "(retro)");
  await expect(retroRow).toHaveAttribute("title", zh
    ? /按当前规则事后重标（2026-08-10）/
    : /Re-marked under the current rule \(2026-08-10\)/);
  await expect(retroRow).toHaveAttribute("title", zh
    ? /当时系统并未入场/
    : /the system refused this live/);

  // ── THE DISCLOSURE TIER OF RECORD ──────────────────────────────────────────────────────
  // The chart markers are deliberately identical, so this legend is not one disclosure among
  // several — it is the only place a reader is told, WITHOUT ASKING, that a star on the tape is a
  // counterfactual. The marker tooltip now renders and says so too, and that changes nothing here:
  // it costs a hover or a tap, and it is gone from any screenshot. Asserted as RENDERED TEXT
  // (never an attribute), and
  // compared against the exported copy itself so the assertion cannot drift from the product.
  const legend = go.locator(".sd-sig-legend");
  await expect(legend).toHaveCount(1);
  await expect(legend).toBeVisible();
  await expect(legend).toHaveText(retroLegendCopy(zh));
  // it resolves the label the rows actually carry — a legend that quotes a different token
  // than the row suffix explains nothing
  await expect(legend).toContainText(zh ? "（事后重标）" : "(retro)");

  // row 2 — the plain refusal, untouched: BLOCKED badge, "not an entry", hollow
  const blockedRow = rows.nth(2);
  await expect(blockedRow.locator(".sd-sig-badge")).toHaveText(zh ? "已拦截" : "BLOCKED");
  await expect(blockedRow.locator(".sd-sig-badge")).toHaveClass(/hollow/);
  await expect(blockedRow.locator(".sd-sig-q")).toHaveText(zh ? "非入场信号" : "not an entry");

  // the three qualifiers are three different words — the list is the same claim as the chart
  const qualifiers = await go.locator(".sd-siglist .sd-sigrow .sd-sig-q").allTextContents();
  expect(new Set(qualifiers).size).toBe(3);
  // Framed from the DESCENDANTS' union, not the section's own box: the rows overflow their
  // container on both sides, so an element screenshot clips the price column AND the legend's
  // first word. This crop is the visual receipt for the whole disclosure argument — the
  // "(retro)" label and the sentence that resolves it have to be legible in one frame.
  await cropUnion(page, ".sd-go .od-sig-section", out("history-rows"));

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("empty readiness stays explicit and cannot release a completed-data consumer", async ({ page }) => {
  await page.route(/\/data\/COST\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...OHLC, bars: [] }) });
  });
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["_oracle"]));
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
  });
  await armTerminalVisualReady(page);

  await page.goto("/terminal?symbol=COST");
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { __mmVisualReadyEvents?: VisualReadyDetail[] }).__mmVisualReadyEvents
      ?.some((detail) => detail.symbol === "COST" && detail.timeframe === "D" && detail.state === "empty") ?? false,
  ), { message: "the no-data generation should publish its explicit empty receipt" }).toBe(true);
  expect(await page.evaluate(() =>
    (window as Window & { __mmResponsiveVisualReady?: ReadyReceipt | null }).__mmResponsiveVisualReady,
  )).toBeNull();
  await expect(page.getByText("No daily history for COST yet.")).toBeVisible();
});

test("an ordinary no-indicator no-signal generation still publishes truthful data readiness", async ({ page }) => {
  await page.route(/\/data\/COST\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(OHLC) });
  });
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", "[]");
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
  });
  await armTerminalVisualReady(page);

  await page.goto("/terminal?symbol=COST");
  const receipt = await waitForTerminalVisualReady(page, false);
  expect(receipt.detail).toMatchObject({ symbol: "COST", timeframe: "D", state: "data" });
  expect(receipt.detail.generation).toBeGreaterThan(0);
});

test("a retro projection, a refusal and a waived entry read as three different things", async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === "desktop";
  // Desktop carries the PR's visual receipt in BOTH languages — the second load has the
  // language already saved, which is what a returning zh user actually gets. The other
  // viewports keep the suite's one-language-per-project convention (zh rides tablet).
  const zhFirst = !desktop && testInfo.project.name === "tablet";
  await openTerminal(page, { zh: zhFirst });
  await assertThreeStates(page, zhFirst, zhFirst ? "retro-zh" : "retro-en", testInfo);
  if (desktop) {
    await openTerminal(page, { zh: true, zhPreseed: true });
    await assertThreeStates(page, true, "retro-zh", testInfo);
  }
});

// ── the control: the legend is CONDITIONAL ────────────────────────────────────────────────
// The card legend is the disclosure that resolves the "(retro)" label into plain words, and
// the claim being made about it is that it appears BECAUSE a re-marked fire is on screen. The
// only way to show that is the same card without one: identical fixture, fire #2 removed. If
// this test ever passes for the wrong reason — legend always rendered — the assertion above
// stops proving anything at all.
test("the retro legend renders only when a re-marked fire is actually in the list", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  await openTerminal(page, { zh, retro: false });

  const signalButton = page.locator(".sig-btn");
  await signalButton.scrollIntoViewIfNeeded();
  await signalButton.click();
  const go = page.locator(".sd-scrim .sd-go");
  await expect(go).toBeVisible();

  // the same two survivors, still rendering exactly as they do in the three-fire card
  const rows = go.locator(".sd-siglist .sd-sigrow");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator(".sd-sig-badge")).toHaveText("BUY");
  await expect(rows.nth(1).locator(".sd-sig-badge")).toHaveText(zh ? "已拦截" : "BLOCKED");
  // …no "(retro)" row, and therefore no legend to resolve one
  await expect(go.locator(".sd-siglist .sd-sig-q", { hasText: zh ? "（事后重标）" : "(retro)" }))
    .toHaveCount(0);
  await expect(go.locator(".sd-sig-legend")).toHaveCount(0);
  // and the verdict is unchanged — removing the counterfactual moved nothing about the read
  await expect(go.locator(".od-verdict")).toHaveText(zh ? "买入" : "Buy");
  await expect(go.locator(".od-vsub")).toHaveText(fmtSub(TAKE_TS, zh));
});
