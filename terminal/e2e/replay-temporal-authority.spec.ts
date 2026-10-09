import { expect, test, type Page } from "@playwright/test";
import { isPhoneViewport } from "./phoneChrome";
import { chooseToolbarSplit, toggleToolbarReplay } from "./terminalToolbar";

// ─────────────────────────────────────────────────────────────────────────────
// Bar Replay temporal authority — the workspace may never present Replay while one
// of its charts silently stays at present time.
//
// What used to happen: `replayOn` / `replayIdx` were workspace-global and Replay was
// blocked only for MIXED timeframes, so two symbols on the same timeframe both
// entered Replay — but ChartPane handed the index to the ACTIVE pane only. The
// active chart sliced into history while its neighbour kept splicing live quotes,
// under one global "Replay" label. Measured on the shipped fixtures, the workspace
// showed AAPL at 2022-09-06 beside ARM at 2026-06-26, and clicking the other pane
// swapped which chart was historical without moving the transport at all.
//
// The contract now: Replay belongs to a workspace of ONE chart (lib/replayContract.ts).
// These specs assert the reachable states, not the internals.
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL = "/terminal?symbol=NVDA";
const ACT = { timeout: 20_000 } as const;   // playwright.config sets no actionTimeout → 0 = hang

const replayButton = (page: Page) => page.locator('[data-toolbar-action="replay"]');
const replayRail = (page: Page) => page.locator("[data-replay-rail]");
const replayChips = (page: Page) => page.locator(".pane .mm", { hasText: /^REPLAY$/ });

async function gotoTerminal(page: Page) {
  await page.goto(TERMINAL);
  await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible({ timeout: 45_000 });
  // The transport's span comes from the chart's own bar count, so Replay is not
  // offerable until that chart has measured itself. Assert the precondition here so
  // a slow first load reports as a slow load, not as a contract failure.
  await expect(replayButton(page)).toBeEnabled({ timeout: 45_000 });
}

/**
 * ≤640px replaces the chart toolbar with the roller strip + Analysis hub, and that hub
 * ships no replay launcher — its tiles are indicators / compare / alerts / chartType /
 * objectTree / templates / symbolDetails (components/mobile/AnalysisHubSheet.tsx). Bar
 * Replay is simply not reachable on the phone, which is pre-existing and untouched here;
 * `visual-intelligence.spec.ts` records the same fact. So these specs run where Replay
 * exists rather than pretending the phone has an entry point to assert against.
 */
const skipWithoutReplayEntry = (page: Page) =>
  test.skip(isPhoneViewport(page), "no phone entry point for Bar Replay (Analysis hub has no replay tile)");

test("Replay is offered to a single chart and reports that chart's own span", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await gotoTerminal(page);

  expect(await replayButton(page).getAttribute("data-replay-blocked")).toBeNull();

  await toggleToolbarReplay(page);
  const rail = replayRail(page);
  await expect(rail).toBeVisible(ACT);

  // The rail names the chart it is measuring, and its span is that chart's bar count.
  const chart = await rail.getAttribute("data-replay-chart");
  expect(chart).toMatch(/^NVDA\|/);
  await expect.poll(async () => Number(await rail.getAttribute("data-replay-total")), ACT).toBeGreaterThan(20);

  // Exactly one chart carries the REPLAY badge — the one the transport is driving.
  await expect(replayChips(page)).toHaveCount(1, ACT);
});

test("a second chart cannot be left at present time under a Replay label", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await gotoTerminal(page);

  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toBeVisible(ACT);
  await expect(replayChips(page)).toHaveCount(1, ACT);

  // Growing the workspace into a grid retires Replay in the same breath. This is the
  // invariant: there is no state with a Replay transport and a chart still at present.
  await chooseToolbarSplit(page, 2);
  await expect(page.locator(".chart-wrap")).toHaveCount(2, ACT);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect(replayChips(page)).toHaveCount(0, ACT);
  await expect(replayButton(page)).toBeDisabled(ACT);
  await expect(replayButton(page)).toHaveAttribute("data-replay-blocked", "multi-chart", ACT);

  // …and collapsing back to one chart offers it again.
  await chooseToolbarSplit(page, 1);
  await expect(page.locator(".chart-wrap")).toHaveCount(1, ACT);
  await expect(replayButton(page)).toBeEnabled(ACT);
  expect(await replayButton(page).getAttribute("data-replay-blocked")).toBeNull();
});

test("Replay cannot be entered from a grid, whatever its timeframes", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await gotoTerminal(page);

  // Same symbol, same timeframe: the old `mixedTfs` gate let this through, and it is
  // still a grid — one index cannot name one instant across two independent panes.
  await chooseToolbarSplit(page, 2);
  await expect(page.locator(".chart-wrap")).toHaveCount(2, ACT);
  await expect(replayButton(page)).toBeDisabled(ACT);
  await expect(replayButton(page)).toHaveAttribute("data-replay-blocked", "multi-chart", ACT);
  await expect(replayRail(page)).toHaveCount(0, ACT);
});

test("focusing another pane in a grid cannot resurrect a historical instant", async ({ page }) => {
  // Below ~860px a page-scrolling layout zeroes the chart grid's fill region, so the
  // second pane has no interactive box to focus. The contract it would demonstrate is
  // viewport-independent; only this gesture needs a pane you can actually click.
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "second pane has no interactive box below ~860px (page-scroll collapses the fill region)");
  test.slow();
  await gotoTerminal(page);

  await chooseToolbarSplit(page, 2);
  await expect(page.locator(".chart-wrap")).toHaveCount(2, ACT);

  // The old defect swapped WHICH chart was historical on every pane activation while the
  // global transport never moved. There is now no half-entered Replay to inherit, so
  // activation changes nothing about time — before or after the focus switch.
  const second = page.locator(".pane").nth(1);
  await expect(second).toBeVisible(ACT);
  await second.click(ACT);
  await expect(second).toHaveClass(/\bon\b/, ACT);
  await expect(replayButton(page)).toBeDisabled(ACT);
  await expect(replayButton(page)).toHaveAttribute("data-replay-blocked", "multi-chart", ACT);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect(replayChips(page)).toHaveCount(0, ACT);
});

test("exiting Replay restores the chart without losing its symbol", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await gotoTerminal(page);

  await toggleToolbarReplay(page);
  const rail = replayRail(page);
  await expect(rail).toBeVisible(ACT);
  const total = Number(await rail.getAttribute("data-replay-total"));
  expect(total).toBeGreaterThan(20);

  // Step the transport and confirm every control addresses the same authority.
  const idxOf = async () => Number(await replayRail(page).getAttribute("data-replay-idx"));
  const start = await idxOf();
  await rail.getByRole("button", { name: "Next bar", exact: true }).click(ACT);
  await expect.poll(idxOf, ACT).toBe(start + 1);
  await rail.getByRole("button", { name: "Previous bar", exact: true }).click(ACT);
  await expect.poll(idxOf, ACT).toBe(start);

  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect(replayChips(page)).toHaveCount(0, ACT);
  await expect(page.locator(".chart-wrap")).toHaveCount(1, ACT);
  // The pane kept its assignment rather than remounting onto the landing symbol.
  await expect(page.locator(".pane .mm-ptag")).toContainText("NVDA", ACT);
  await expect(replayButton(page)).toBeEnabled(ACT);
});

// ─────────────────────────────────────────────────────────────────────────────
// A timeframe change must keep the replay DATE, not the bar number.
//
// What used to happen: the transport held an integer position, and a timeframe change
// carried that integer onto a differently-sized array. Measured at the pickup head on the
// NVDA fixture: Replay opened on daily bar ~1175; switching to weekly sliced the weekly
// array at that same 1176 — longer than the whole weekly history — so the chart jumped
// to the present under the REPLAY badge while the rail read "1176 / 260". Near the
// warmup floor the slice was padded to 20 bars instead, so a coarse timeframe showed
// bars from after the replay date.
//
// The contract now: the replay position is an INSTANT under the canonical bar identity
// (`time` = the bar, `closeTime` = when it became knowable), and every timeframe shows
// exactly the bars knowable at that instant. A timeframe that cannot honour it (another
// clock, or too little history before it) ends Replay and says so.
//
// These read what the CANVAS holds through the dev-only `__mmLiveBarGeneration` seam:
// study values live only in the chart canvas, so page text cannot witness them.
// ─────────────────────────────────────────────────────────────────────────────

type SeriesTail = { time: unknown; value: number | null } | null;
type Witness = {
  barCount: number;
  lastBar: { time: unknown; c: number } | null;
  priceTail: { time: unknown; value: number | null } | null;
  series: Record<string, SeriesTail[]>;
};

/** A daily-derived bar time as a session date ("YYYY-MM-DD"); null for anything else. */
const sessionDate = (t: unknown): string | null => (typeof t === "string" ? t.slice(0, 10) : null);
const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

async function witness(page: Page): Promise<Witness | null> {
  return page.evaluate(() => (window as unknown as { __mmLiveBarGeneration?: () => Witness }).__mmLiveBarGeneration?.() ?? null);
}

/**
 * The cadence of what the canvas holds: the median gap, in days, between its last few
 * candles. Daily candles sit 1–4 days apart, weekly ones 5–9. This is how a spec knows the
 * NEW timeframe's bars have landed, rather than the previous timeframe's still on screen.
 */
async function canvasCadenceDays(page: Page): Promise<number | null> {
  const rows = await page.evaluate(() => {
    const opts = (window as unknown as { __mmChartAxisOpts?: () => { contextProof?: { priceRows?: { time: unknown }[] } } | null }).__mmChartAxisOpts?.();
    return (opts?.contextProof?.priceRows ?? []).slice(-7).map((r) => r.time);
  });
  const dates = rows.map(sessionDate).filter((d): d is string => d != null);
  if (dates.length < 4) return null;
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d)).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

async function switchTimeframe(page: Page, tf: string) {
  // The same seam the chart's own "Back to daily" button and the native shell bridge use.
  await page.evaluate((t) => window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: t } })), tf);
}

async function onDailyChart(page: Page) {
  await switchTimeframe(page, "D");
  await expect.poll(() => canvasCadenceDays(page), { timeout: 45_000 }).toBeLessThanOrEqual(2);
}

/**
 * A study is BUILT when its first series holds a data point, not merely when its key exists
 * (`series[k]` gets its slot at `addSeries()`, before any data lands — live-bar-sync.spec.ts).
 */
const built = (w: Witness | null, k: string) => (w?.series[k]?.[0] ?? null) !== null;

/**
 * Where every study series that holds data ends, as `key#series@date`. Not every series ends on
 * the last candle — a highlight histogram (Stoch RSI's overbought/oversold bars) holds only the
 * days it highlights — so a return to live is checked against the live chart's OWN tails.
 */
function tailDates(w: Witness): string[] {
  const out: string[] = [];
  for (const [key, tails] of Object.entries(w.series)) {
    tails.forEach((tail, i) => {
      if (tail && tail.value != null) out.push(`${key}#${i}@${sessionDate(tail.time)}`);
    });
  }
  return out.sort();
}

/** Every study tail the canvas holds must sit at or before the last candle. */
function studyTailsAfter(w: Witness, last: string): string[] {
  const late: string[] = [];
  for (const [key, tails] of Object.entries(w.series)) {
    for (const tail of tails) {
      const d = tail && tail.value != null ? sessionDate(tail.time) : null;
      if (d && d > last) late.push(`${key}@${d}`);
    }
  }
  return late;
}

test("a timeframe change keeps the replay date instead of the bar number", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await gotoTerminal(page);
  await onDailyChart(page);
  // Marks this document, so the return to live can be shown to happen without a reload.
  await page.evaluate(() => { (window as unknown as { __replayDoc?: number }).__replayDoc = 1; });
  const liveLast = sessionDate((await witness(page))?.lastBar?.time);
  expect(liveLast).not.toBeNull();
  await expect.poll(async () => {
    const w = await witness(page);
    return w ? [built(w, "ema"), built(w, "macd")] : null;
  }, ACT).toEqual([true, true]);
  const liveTails = tailDates((await witness(page))!);
  expect(liveTails).toContain(`ema#0@${liveLast}`);
  expect(liveTails).toContain(`macd#0@${liveLast}`);

  await toggleToolbarReplay(page);
  const rail = replayRail(page);
  await expect(rail).toBeVisible(ACT);
  await expect(rail).toHaveAttribute("data-replay-chart", "NVDA|D", ACT);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).not.toBe(liveLast);
  const cutoff = sessionDate((await witness(page))?.lastBar?.time)!;
  const dailyIdx = Number(await rail.getAttribute("data-replay-idx"));
  expect(cutoff < liveLast!).toBe(true);
  // The study checks below are only evidence if there are studies on the canvas to check: an
  // empty series map passes "no tail after the cutoff" vacuously. The default workspace carries
  // a moving average and MACD — both must hold data, ending on the replay date.
  await expect.poll(async () => {
    const w = await witness(page);
    return w ? [built(w, "ema"), built(w, "macd")] : null;
  }, ACT).toEqual([true, true]);
  const replayed = (await witness(page))!;
  expect(Object.keys(replayed.series).length).toBeGreaterThan(0);
  expect(sessionDate(replayed.series.ema[0]?.time)).toBe(cutoff);
  expect(sessionDate(replayed.series.macd[0]?.time)).toBe(cutoff);
  expect(studyTailsAfter(replayed, cutoff)).toEqual([]);
  // The replayed studies are not the live ones (else the return to live below proves nothing).
  expect(tailDates(replayed)).not.toEqual(liveTails);

  // ── to weekly: the chart ends at the replay date, not at bar #dailyIdx of the weekly array ──
  await switchTimeframe(page, "W");
  await expect(rail).toHaveAttribute("data-replay-chart", "NVDA|W", ACT);
  await expect.poll(() => canvasCadenceDays(page), { timeout: 45_000 }).toBeGreaterThanOrEqual(5);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).not.toBeNull();
  const weekly = (await witness(page))!;
  const weeklyLast = sessionDate(weekly.lastBar?.time)!;
  // A weekly candle is keyed by its last session, so the last one knowable at the replay
  // date closes on or before it — and is the week just before it, not some older week.
  expect(weeklyLast <= cutoff, `weekly chart ends ${weeklyLast}, after the replay date ${cutoff}`).toBe(true);
  expect(daysBetween(weeklyLast, cutoff)).toBeLessThan(10);
  // The canvas holds that same candle, and no study reaches past it.
  expect(sessionDate(weekly.priceTail?.time)).toBe(weeklyLast);
  expect(studyTailsAfter(weekly, weeklyLast)).toEqual([]);
  // The rail reports a position inside the weekly chart's own span.
  const weeklyIdx = Number(await rail.getAttribute("data-replay-idx"));
  const weeklyTotal = Number(await rail.getAttribute("data-replay-total"));
  expect(weeklyIdx).toBeGreaterThanOrEqual(20);
  expect(weeklyIdx).toBeLessThan(weeklyTotal);
  expect(weekly.barCount).toBe(weeklyIdx + 1);

  // ── back to daily: the same date, to the bar ──
  await switchTimeframe(page, "D");
  await expect(rail).toHaveAttribute("data-replay-chart", "NVDA|D", ACT);
  await expect.poll(() => canvasCadenceDays(page), { timeout: 45_000 }).toBeLessThanOrEqual(2);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).toBe(cutoff);
  await expect(rail).toHaveAttribute("data-replay-idx", String(dailyIdx), ACT);
  expect(studyTailsAfter((await witness(page))!, cutoff)).toEqual([]);

  // ── exit: the live series comes back on the same document ──
  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect(replayChips(page)).toHaveCount(0, ACT);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).toBe(liveLast);
  // …and so do the studies: every series ends exactly where it ended before Replay began.
  await expect.poll(async () => {
    const w = await witness(page);
    return w && built(w, "ema") && built(w, "macd") ? tailDates(w) : null;
  }, ACT).toEqual(liveTails);
  expect(await page.evaluate(() => (window as unknown as { __replayDoc?: number }).__replayDoc)).toBe(1);
  expect(pageErrors).toEqual([]);
});

test("a timeframe that cannot reach the replay date ends Replay instead of shifting it", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await gotoTerminal(page);
  await onDailyChart(page);
  const liveLast = sessionDate((await witness(page))?.lastBar?.time);

  await toggleToolbarReplay(page);
  const rail = replayRail(page);
  await expect(rail).toBeVisible(ACT);
  // Rewind to the warmup floor: the replay date is now ~one month into the daily history.
  const slider = rail.locator('input[type="range"]');
  await slider.focus(ACT);
  await page.keyboard.press("Home");
  await expect(rail).toHaveAttribute("data-replay-idx", "20", ACT);
  await expect.poll(async () => (await witness(page))?.barCount ?? 0, ACT).toBe(21);
  const cutoff = sessionDate((await witness(page))?.lastBar?.time)!;

  // Weekly has only a handful of candles before that date — too few to replay. Padding the
  // slice to the warmup floor would show weeks AFTER the replay date; instead Replay ends,
  // visibly, and the chart is live again.
  await switchTimeframe(page, "W");
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect(replayChips(page)).toHaveCount(0, ACT);
  await expect(page.locator(".undo-toast", { hasText: /Replay ended/ })).toBeVisible(ACT);
  await expect.poll(() => canvasCadenceDays(page), { timeout: 45_000 }).toBeGreaterThanOrEqual(5);
  await expect.poll(async () => {
    const last = sessionDate((await witness(page))?.lastBar?.time);
    return last != null && liveLast != null && daysBetween(last, liveLast) < 10;
  }, ACT).toBe(true);
  expect(cutoff < liveLast!).toBe(true);
  await expect(replayButton(page)).toBeEnabled(ACT);
  expect(pageErrors).toEqual([]);
});

test("an intraday timeframe cannot borrow a daily replay date", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await gotoTerminal(page);
  await onDailyChart(page);

  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toBeVisible(ACT);
  await expect(replayChips(page)).toHaveCount(1, ACT);

  // Daily bars are keyed by session date and intraday bars by the clock; a position on one
  // has no exact counterpart on the other, so the change ends Replay rather than guessing.
  await switchTimeframe(page, "1h");
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect(replayChips(page)).toHaveCount(0, ACT);
  await expect(page.locator(".undo-toast", { hasText: /Replay ended/ })).toBeVisible(ACT);
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing drawn over a replayed chart may come from after the replay date.
//
// The candles and studies were sliced, but three consumers read their OWN data instead:
// Gap Zones scanned the full daily history (a gap still open on the replay date was drawn
// faded as "filled" by a bar months later, and gaps that had not happened yet were projected
// into the empty space right of the last candle); Options Levels kept drawing the present
// day's dealer walls; and the live quote lane is a third input the replay must not take.
// Measured at the pickup head on the NVDA fixture, replayed to 2026-03-04.
// ─────────────────────────────────────────────────────────────────────────────

type DailyRow = [string, number, number, number, number, number];

async function fixtureRows(page: Page, symbol: string): Promise<DailyRow[]> {
  const res = await page.request.get(`/data/${symbol}.json`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { bars: DailyRow[] }).bars;
}

/** No live quote: the chart holds exactly the fixture's daily rows. */
const quietQuotes = (page: Page) => page.route("**/api/quote?**", (route) => route.fulfill({ json: { quotes: {} } }));

/**
 * What a chart holding ONLY `rows` draws with the Gap Zones defaults (min gap 0.3%, the 40
 * most recent filled zones, every open one). Written out here from the rule, not imported from
 * the code under test: a gap is a day whose whole range clears the prior day's, and it is filled
 * by the first later day that trades back into the band.
 */
function expectedGapCounts(rows: DailyRow[]): { open: number; filled: number } {
  let open = 0, filled = 0;
  for (let i = 1; i < rows.length; i++) {
    const [, , h, l] = rows[i];
    const [, , ph, pl] = rows[i - 1];
    let band: { up: boolean; lo: number; hi: number } | null = null;
    if (ph > 0 && l > ph && (l - ph) / ph >= 0.003) band = { up: true, lo: ph, hi: l };
    else if (pl > 0 && h < pl && (pl - h) / pl >= 0.003) band = { up: false, lo: h, hi: pl };
    if (!band) continue;
    let wasFilled = false;
    for (let j = i + 1; j < rows.length && !wasFilled; j++) wasFilled = band.up ? rows[j][3] <= band.lo : rows[j][2] >= band.hi;
    if (wasFilled) filled++; else open++;
  }
  return { open, filled: Math.min(40, filled) };
}

type ZoneBox = { left: number; right: number };
/** The drawn Gap Zones (open = solid, filled = faded) and where the last candle sits, in one frame. */
async function gapZones(page: Page): Promise<{ open: ZoneBox[]; filled: ZoneBox[]; lastBarX: number | null }> {
  return page.evaluate(() => {
    const rects = [...document.querySelectorAll<SVGRectElement>("[data-sig-layer] rect")];
    const boxes = (opacity: string) => rects
      .filter((r) => r.getAttribute("fill-opacity") === opacity)
      .map((r) => ({ left: Number(r.getAttribute("x")), right: Number(r.getAttribute("x")) + Number(r.getAttribute("width")) }));
    const axis = (window as unknown as { __mmChartAxisOpts?: () => { lastBarX?: number | null } | null }).__mmChartAxisOpts?.();
    return { open: boxes("0.15"), filled: boxes("0.05"), lastBarX: axis?.lastBarX ?? null };
  });
}
const zoneCounts = async (page: Page) => {
  const z = await gapZones(page);
  return { open: z.open.length, filled: z.filled.length };
};

test("Gap Zones under Replay show only the gaps and fills known on the replay date", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["gaps"]));
    localStorage.setItem("mm.indHidden", JSON.stringify([]));
    localStorage.setItem("mm.mastermindCandles.v1", "1");
  });
  await quietQuotes(page);
  await gotoTerminal(page);
  await onDailyChart(page);
  const rows = await fixtureRows(page, "NVDA");
  const liveLast = sessionDate((await witness(page))?.lastBar?.time);
  expect(liveLast).toBe(rows[rows.length - 1][0]);

  // Live: the reference agrees with the chart, and open zones run to the last candle.
  const live = expectedGapCounts(rows);
  await expect.poll(() => zoneCounts(page), ACT).toEqual(live);
  const liveZones = await gapZones(page);
  expect(liveZones.lastBarX).not.toBeNull();
  for (const z of liveZones.open) expect(Math.abs(z.right - liveZones.lastBarX!)).toBeLessThan(1.5);

  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toBeVisible(ACT);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).not.toBe(liveLast);
  const cutoff = sessionDate((await witness(page))?.lastBar?.time)!;
  const atCutoff = expectedGapCounts(rows.filter((r) => r[0] <= cutoff));
  // The fixture has to tell the two apart, or the replay assertion below proves nothing.
  expect(atCutoff).not.toEqual(live);
  await expect.poll(() => zoneCounts(page), ACT).toEqual(atCutoff);
  const replayZones = await gapZones(page);
  expect(replayZones.lastBarX).not.toBeNull();
  for (const z of [...replayZones.open, ...replayZones.filled]) {
    expect(z.right, `a zone reaches x=${z.right}, past the replay date's candle at ${replayZones.lastBarX}`)
      .toBeLessThanOrEqual(replayZones.lastBarX! + 1.5);
  }
  for (const z of replayZones.open) expect(Math.abs(z.right - replayZones.lastBarX!)).toBeLessThan(1.5);

  // Back to live: today's zones return on the same document.
  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect.poll(() => zoneCounts(page), ACT).toEqual(live);
});

/** Present-day option levels: a ladder, an expected move and a current state, dated 2026-06-26. */
const OPTION_LEVELS = [185, 188, 190, 193, 197, 200];
async function routeOptionLevels(page: Page) {
  await page.route("**/api/flow?**", async (route) => {
    const f = new URL(route.request().url()).searchParams.get("f");
    if (f === "gex:NVDA") {
      await route.fulfill({ json: {
        schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-06-26",
        spot_ref: 192.5, call_wall: null, put_wall: null, gamma_flip: null,
        by_strike: [
          { strike: 190, gamma_net: 80, gamma_call: 100, gamma_put: -20 },
          { strike: 191, gamma_net: 10, gamma_call: 20, gamma_put: -10 },
        ],
      } });
      return;
    }
    if (f === "moves:NVDA") {
      await route.fulfill({ json: {
        schema: "options_hub.moves/v1", root: "NVDA", asof: "2026-06-26",
        expected_move: { lo: 188, hi: 197 },
      } });
      return;
    }
    if (f === "gexstate:NVDA") {
      await route.fulfill({ json: {
        schema: "options_structure.gex_state/v1", root: "NVDA",
        asof: "2026-06-26T16:00:00-04:00", spot: 192.5,
        call_wall: 200, put_wall: 185, gamma_flip: 193, net_gex_bn: 0.11,
      } });
      return;
    }
    await route.continue();
  });
}
const optionLinePrices = (page: Page) => page.evaluate(() => {
  const lines = (window as unknown as { __mmIndicatorPriceLines?: () => Record<string, Array<{ price: number }>> })
    .__mmIndicatorPriceLines?.().optlevels ?? [];
  return lines.map((line) => line.price).sort((a, b) => a - b);
});

test("Options Levels dated after the replay date are not drawn over it", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["optlevels"]));
    localStorage.setItem("mm.indHidden", JSON.stringify([]));
    localStorage.setItem("mm.mastermindCandles.v1", "1");
  });
  await quietQuotes(page);
  await routeOptionLevels(page);
  await gotoTerminal(page);
  await onDailyChart(page);
  await page.evaluate(() => { (window as unknown as { __replayDoc?: number }).__replayDoc = 1; });

  // Live: the levels are drawn, lines and badges both.
  await expect.poll(() => optionLinePrices(page), { timeout: 45_000 }).toEqual(OPTION_LEVELS);
  await expect(page.locator(".mm-optlevel-tag:visible")).toHaveCount(6, ACT);
  const liveLast = sessionDate((await witness(page))?.lastBar?.time);

  // Replay rewinds to a date months before the snapshot: neither the lines nor the badges may
  // stay, and the legend says why the study is empty.
  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toBeVisible(ACT);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).not.toBe(liveLast);
  expect(sessionDate((await witness(page))?.lastBar?.time)! < "2026-06-26").toBe(true);
  await expect.poll(() => optionLinePrices(page), ACT).toEqual([]);
  await expect(page.locator(".mm-optlevel-tag:visible")).toHaveCount(0, ACT);
  await expect.poll(() => page.locator(".lg-name", { hasText: /newer than the replay date/ }).count(), ACT).toBeGreaterThan(0);

  // Back to live without a reload: the same levels return.
  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect.poll(() => optionLinePrices(page), ACT).toEqual(OPTION_LEVELS);
  await expect(page.locator(".mm-optlevel-tag:visible")).toHaveCount(6, ACT);
  expect(await page.evaluate(() => (window as unknown as { __replayDoc?: number }).__replayDoc)).toBe(1);
});

// A Prophet candidate receipt is dated by the day the board surfaced it, but it ships with a
// return marked to market through the ledger's LATEST pricing date. Surfaced before the replay
// date and priced long after it, the receipt used to print that later return on the replayed
// chart's marker. The receipt itself is fair to show from its surfacing date; its return is not.
const PROPHET_RECEIPT = {
  id: "replay-e2e-1", market: "us", system: "prophet", definition: "us_prophet_v2", authority: "candidate",
  surfaced_at: "2025-03-03", entry_date: "2025-03-04", entry_basis: "next_open", entry_price: 201.25,
  rank: 7, tier: null, state: "matured", maturity: "matured", latest_price: 276.72, return_pct: 37.5,
  excess_pct: 20.1, sessions: 160, source_artifact: "us_track_ledger.json", source_as_of: "2026-06-26",
  priced_through: "2026-06-26",
} as const;
async function routeProphetReceipt(page: Page) {
  await page.route("**/data/NVDA.slice.json", async (route) => {
    const res = await route.fetch();
    const doc = res.ok() ? await res.json() : {};
    doc.opportunities = {
      schema: "opportunity_timeline.v1", as_of: "2026-06-26", priced_through: { us: "2026-06-26" },
      events: [PROPHET_RECEIPT],
    };
    await route.fulfill({ json: doc });
  });
}
const prophetTitles = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-signal-source="prophet_board"] title')].map((t) => t.textContent ?? ""));

test("a Prophet receipt under Replay shows no return priced after the replay date", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await routeProphetReceipt(page);
  await quietQuotes(page);
  await gotoTerminal(page);
  await page.evaluate(() => { (window as unknown as { __replayDoc?: number }).__replayDoc = 1; });

  // Live: the receipt is on the chart with its rank and the return measured through today.
  await expect.poll(() => prophetTitles(page), { timeout: 45_000 }).toEqual([expect.stringContaining("rank #7")]);
  expect((await prophetTitles(page))[0]).toContain("+37.5%");
  const liveLast = sessionDate((await witness(page))?.lastBar?.time);

  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toBeVisible(ACT);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).not.toBe(liveLast);
  const cutoff = sessionDate((await witness(page))?.lastBar?.time)!;
  // The case under test needs the replay date between the receipt's surfacing and its pricing,
  // or "no return shown" would hold vacuously (no receipt at all, or a return already known).
  expect(cutoff >= PROPHET_RECEIPT.surfaced_at, `replay date ${cutoff} precedes the receipt`).toBe(true);
  expect(cutoff < PROPHET_RECEIPT.priced_through, `replay date ${cutoff} is not before the pricing date`).toBe(true);
  // The receipt stays — it was surfaced by then — but without a return from after the replay date.
  await expect.poll(async () => (await prophetTitles(page)).map((t) => [t.includes("rank #7"), t.includes("%")]), ACT)
    .toEqual([[true, false]]);

  // Back to live without a reload: the return is there again.
  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect.poll(() => prophetTitles(page), ACT).toEqual([expect.stringContaining("+37.5%")]);
  expect(await page.evaluate(() => (window as unknown as { __replayDoc?: number }).__replayDoc)).toBe(1);
});

test("changing the symbol under Replay ends it on the new symbol's live chart", async ({ page }, testInfo) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await quietQuotes(page);
  await gotoTerminal(page);
  await onDailyChart(page);
  const aapl = await fixtureRows(page, "AAPL");
  const nvdaLast = sessionDate((await witness(page))?.lastBar?.time);

  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toBeVisible(ACT);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).not.toBe(nvdaLast);

  // The real symbol search, as a user switches symbols.
  if (testInfo.project.name === "desktop") await page.locator(".pair").first().click(ACT);
  else await page.locator(".m-symbar").click(ACT);
  const input = page.locator(".sh input");
  await expect(input).toBeVisible(ACT);
  await input.click(ACT);
  await page.keyboard.type("AAPL");
  await expect(page.locator(".sres .r").first()).toBeVisible(ACT);
  await page.locator(".sres .r").filter({ hasText: /AAPL/ }).first().locator(".r-opt").click(ACT);
  await expect(page.locator(".mm-ptag-sym")).toHaveText("AAPL", { timeout: 30_000 });

  // No replay of the old symbol is carried onto the new one: no transport, no badge, and the
  // chart holds AAPL's own history to its own last session.
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect(replayChips(page)).toHaveCount(0, ACT);
  const last = aapl[aapl.length - 1];
  await expect.poll(async () => {
    const w = await witness(page);
    return w ? [sessionDate(w.lastBar?.time), w.barCount, w.lastBar?.c] : null;
  }, { timeout: 45_000 }).toEqual([last[0], aapl.length, last[4]]);
});

// A live quote is the third input a replayed chart must not take. The harness is the one
// live-bar-sync.spec.ts uses for its append case: a smooth daily history and a quote lane
// whose answer the test switches to a new session.
const LIVE_SYMBOL = "NVDA";
const LIVE_LAST_SESSION = "2026-08-06";   // Thursday
const LIVE_NEXT_SESSION = "2026-08-07";   // Friday — the session a live quote appends
function liveSessionDates(count: number, lastISO: string): string[] {
  const out: string[] = [];
  const d = new Date(`${lastISO}T00:00:00Z`);
  while (out.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
const LIVE_BARS: DailyRow[] = liveSessionDates(262, LIVE_LAST_SESSION).map((date, i) => {
  const c = Number((120 + Math.sin(i / 9) * 8 + i * 0.04).toFixed(2));
  return [date, Number((c - 0.5).toFixed(2)), Number((c + 1.1).toFixed(2)), Number((c - 1.3).toFixed(2)), c, 1_000_000 + i * 1_000];
});
const LIVE_PREV_CLOSE = LIVE_BARS[LIVE_BARS.length - 1][4];
const LIVE_PRICE = Number((LIVE_PREV_CLOSE * 1.25).toFixed(2));
type LiveQuote = { basis: string; last: number; sessionDate: string; seconds: number };
const rthAt = (date: string, hour: number, minute: number) =>
  Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`) / 1000;
/** The status line's Day change for a session of LIVE_BARS, as the chart prints it. */
function liveBarsDayText(session: string): string {
  const i = LIVE_BARS.findIndex((r) => r[0] === session);
  expect(i, `${session} is not a session of the fixture`).toBeGreaterThan(0);
  const pct = ((LIVE_BARS[i][4] - LIVE_BARS[i - 1][4]) / LIVE_BARS[i - 1][4]) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
const dayChange = (page: Page) => page.locator(".statusline .status-day b").first();
function liveQuoteBody(q: LiveQuote, syms: string[]) {
  return { quotes: Object.fromEntries(syms.map((sym) => [sym, sym === LIVE_SYMBOL ? {
    sym, last: q.last, prevClose: LIVE_PREV_CLOSE, chg: ((q.last - LIVE_PREV_CLOSE) / LIVE_PREV_CLOSE) * 100,
    open: LIVE_PREV_CLOSE, high: Math.max(q.last, LIVE_PREV_CLOSE), low: Math.min(q.last, LIVE_PREV_CLOSE),
    vol: 12_345_678, ts: q.seconds, asOfMs: q.seconds * 1000, lagMs: 40, live: q.basis !== "EOD", basis: q.basis,
    market: "us", marketSession: "rth", regularSessionDate: q.sessionDate, regularSession: "rth",
    regularPrice: q.last, regularChg: ((q.last - LIVE_PREV_CLOSE) / LIVE_PREV_CLOSE) * 100,
  } : null])) };
}

test("a live quote cannot advance a replayed chart, and is there on the return to live", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  let quote: LiveQuote = { basis: "EOD", last: LIVE_PREV_CLOSE, sessionDate: LIVE_LAST_SESSION, seconds: rthAt(LIVE_LAST_SESSION, 15, 0) };
  let served = 0;
  await page.route(`**/data/${LIVE_SYMBOL}.json`, (route) =>
    route.fulfill({ json: { t: LIVE_SYMBOL, o: LIVE_SYMBOL, src: "replay-temporal-e2e", bars: LIVE_BARS } }));
  await page.route(`**/data/${LIVE_SYMBOL}.slice.json`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/quote?**", async (route) => {
    const syms = (new URL(route.request().url()).searchParams.get("syms") || LIVE_SYMBOL).split(",").filter(Boolean);
    const body = liveQuoteBody(quote, syms);
    await route.fulfill({ json: body });
    if (syms.includes(LIVE_SYMBOL)) served++;
  });
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    localStorage.setItem("mm.inds", JSON.stringify(["ema"]));
    localStorage.setItem("mm.indHidden", JSON.stringify([]));
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    // The opt-in "Day" change on the status line reads the quote on a live chart.
    localStorage.setItem("mm.chartSettings", JSON.stringify({ showLastDayChange: true }));
    localStorage.removeItem("mm.ws");
  });
  await gotoTerminal(page);
  await expect.poll(async () => {
    const w = await witness(page);
    return w ? [w.barCount, sessionDate(w.lastBar?.time)] : null;
  }, { timeout: 60_000 }).toEqual([LIVE_BARS.length, LIVE_LAST_SESSION]);
  // Live, the Day change is the quote's (flat on the last session's close).
  await expect(dayChange(page)).toHaveText("+0.00%", ACT);

  await toggleToolbarReplay(page);
  const rail = replayRail(page);
  await expect(rail).toBeVisible(ACT);
  await expect.poll(async () => (await witness(page))?.barCount ?? 0, ACT).toBeLessThan(LIVE_BARS.length);
  const frozen = (await witness(page))!;
  const idx = await rail.getAttribute("data-replay-idx");
  const total = await rail.getAttribute("data-replay-total");
  // A replayed chart's Day change is its own last session against the one before — not the
  // quote's day, which belongs to a session the replayed chart has not reached.
  const frozenDay = liveBarsDayText(sessionDate(frozen.lastBar?.time)!);
  expect(frozenDay, "the fixture must tell the replayed day from the quote's").not.toBe("+0.00%");
  await expect(dayChange(page)).toHaveText(frozenDay, ACT);

  // A real-time quote for a NEW session — on a live chart this appends a bar (proved below).
  quote = { basis: "REALTIME", last: LIVE_PRICE, sessionDate: LIVE_NEXT_SESSION, seconds: rthAt(LIVE_NEXT_SESSION, 15, 30) };
  served = 0;
  await expect.poll(() => served, { message: "the quote lane should keep answering under Replay", timeout: 45_000 }).toBeGreaterThanOrEqual(3);
  const after = (await witness(page))!;
  expect([after.barCount, after.lastBar]).toEqual([frozen.barCount, frozen.lastBar]);
  expect(after.priceTail).toEqual(frozen.priceTail);
  await expect(rail).toHaveAttribute("data-replay-idx", idx!, ACT);
  await expect(rail).toHaveAttribute("data-replay-total", total!, ACT);
  await expect(dayChange(page)).toHaveText(frozenDay, ACT);
  // Stepping repaints the status line while the quote says +25%: the step's own day, not that.
  await rail.getByRole("button", { name: "Next bar", exact: true }).click(ACT);
  await expect.poll(async () => (await witness(page))?.barCount ?? 0, ACT).toBe(frozen.barCount + 1);
  const steppedDay = liveBarsDayText(sessionDate((await witness(page))?.lastBar?.time)!);
  expect(steppedDay).not.toBe("+25.00%");
  await expect(dayChange(page)).toHaveText(steppedDay, ACT);

  // Negative control: the same quote, once Replay ends, does append the new session.
  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect.poll(async () => {
    const w = await witness(page);
    return w ? [w.barCount, sessionDate(w.lastBar?.time), w.priceTail?.value] : null;
  }, { timeout: 45_000 }).toEqual([LIVE_BARS.length + 1, LIVE_NEXT_SESSION, LIVE_PRICE]);
  // …and the Day change is the quote's again.
  await expect(dayChange(page)).toHaveText("+25.00%", ACT);
});

// The Golden Oracle chip names one verdict for the chart, and under Replay it may name only a
// verdict the chart's own markers could show by then. A signal is dated by the session it fired on
// but becomes known on `known_ts`; the chip used to bound the scan by the replayed bar's date
// alone, so it printed a verdict two sessions before anyone could have known it.
const ORACLE_SIGNAL = { ts: "2026-06-03", known: "2026-06-05" } as const;
const oracleChip = (page: Page) => page.locator(".statusline .mm", { hasText: "Golden Oracle" });

test("the Golden Oracle chip under Replay waits for its verdict to be known", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["_oracle"]));
    localStorage.setItem("mm.indHidden", JSON.stringify([]));
    localStorage.setItem("mm.mastermindCandles.v1", "1");
  });
  await page.route("**/data/NVDA.slice.json", async (route) => {
    const res = await route.fetch();
    const doc = await res.json();
    const signals = doc.indicator.signals as Array<{ ts: string; known_ts?: string }>;
    const last = signals[signals.length - 1];
    // The case needs the fixture's newest signal to be the one moved, or the chip proves nothing.
    expect(last.ts).toBe(ORACLE_SIGNAL.ts);
    last.known_ts = ORACLE_SIGNAL.known;
    await route.fulfill({ json: doc });
  });
  await quietQuotes(page);
  await gotoTerminal(page);
  await onDailyChart(page);
  const rows = await fixtureRows(page, "NVDA");
  const at = rows.findIndex((r) => r[0] === ORACLE_SIGNAL.ts);
  expect(at).toBeGreaterThan(20);
  expect(rows[at + 2][0]).toBe(ORACLE_SIGNAL.known);

  // Live: the newest signal is the verdict (a SELL with no basis reads as a structure Stop).
  await expect(oracleChip(page)).toHaveText("Golden Oracle · Stop", ACT);

  await toggleToolbarReplay(page);
  const rail = replayRail(page);
  await expect(rail).toBeVisible(ACT);
  const slider = rail.locator('input[type="range"]');
  await slider.focus(ACT);
  await page.keyboard.press("End");
  await expect(rail).toHaveAttribute("data-replay-idx", String(rows.length - 1), ACT);
  for (let i = rows.length - 1; i > at; i--) await page.keyboard.press("ArrowLeft");
  await expect(rail).toHaveAttribute("data-replay-idx", String(at), ACT);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).toBe(ORACLE_SIGNAL.ts);

  // On the session the signal fired it is not yet known: the chip keeps the verdict before it.
  await expect(oracleChip(page)).toHaveText("Golden Oracle · Buy", ACT);
  const next = rail.getByRole("button", { name: "Next bar", exact: true });
  await next.click(ACT);
  await expect(rail).toHaveAttribute("data-replay-idx", String(at + 1), ACT);
  await expect(oracleChip(page)).toHaveText("Golden Oracle · Buy", ACT);
  // The session it became known on, the chip names it.
  await next.click(ACT);
  await expect(rail).toHaveAttribute("data-replay-idx", String(at + 2), ACT);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).toBe(ORACLE_SIGNAL.known);
  await expect(oracleChip(page)).toHaveText("Golden Oracle · Stop", ACT);

  // Back to live: the live verdict is unchanged.
  await slider.focus(ACT);
  await page.keyboard.press("Home");
  await expect(rail).toHaveAttribute("data-replay-idx", "20", ACT);
  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect(oracleChip(page)).toHaveText("Golden Oracle · Stop", ACT);
});

// The status dot names the quote feed (delayed / live). A replayed chart takes no quote, so the
// dot must not claim a feed for it; the feed's dot returns with the live chart.
test("a replayed chart's status dot claims no quote feed", async ({ page }) => {
  skipWithoutReplayEntry(page);
  test.slow();
  const rowsDoc = await (await page.request.get("/data/NVDA.json")).json() as { bars: DailyRow[] };
  const last = rowsDoc.bars[rowsDoc.bars.length - 1];
  await page.route("**/api/quote?**", async (route) => {
    const syms = (new URL(route.request().url()).searchParams.get("syms") || "NVDA").split(",").filter(Boolean);
    await route.fulfill({ json: { quotes: Object.fromEntries(syms.map((sym) => [sym, sym === "NVDA" ? {
      sym, last: last[4], prevClose: last[4], chg: 0, open: last[1], high: last[2], low: last[3], vol: last[5],
      ts: rthAt(last[0], 19, 0), asOfMs: rthAt(last[0], 19, 0) * 1000, lagMs: 900_000, live: true, basis: "DELAYED_15M",
      market: "us", marketSession: "rth", regularSessionDate: last[0], regularSession: "rth", regularPrice: last[4], regularChg: 0,
    } : null])) } });
  });
  await gotoTerminal(page);
  await onDailyChart(page);
  const dot = page.locator(".statusline .status-market-dot").first();
  // Live: the delayed feed is named — else the replay assertion below holds vacuously.
  await expect(dot).toHaveClass(/\bis-delayed\b/, ACT);

  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toBeVisible(ACT);
  await expect(replayChips(page)).toHaveCount(1, ACT);
  await expect(dot).not.toHaveClass(/\bis-(delayed|live)\b/, ACT);
  await replayRail(page).getByRole("button", { name: "Next bar", exact: true }).click(ACT);
  await expect(dot).not.toHaveClass(/\bis-(delayed|live)\b/, ACT);

  await toggleToolbarReplay(page);
  await expect(replayRail(page)).toHaveCount(0, ACT);
  await expect(dot).toHaveClass(/\bis-delayed\b/, ACT);
});
