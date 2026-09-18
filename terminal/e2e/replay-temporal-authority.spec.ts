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
