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

  await toggleToolbarReplay(page);
  const rail = replayRail(page);
  await expect(rail).toBeVisible(ACT);
  await expect(rail).toHaveAttribute("data-replay-chart", "NVDA|D", ACT);
  await expect.poll(async () => sessionDate((await witness(page))?.lastBar?.time), ACT).not.toBe(liveLast);
  const cutoff = sessionDate((await witness(page))?.lastBar?.time)!;
  const dailyIdx = Number(await rail.getAttribute("data-replay-idx"));
  expect(cutoff < liveLast!).toBe(true);

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
