import { expect, test, type Page } from "@playwright/test";

// Browser proof for "Sync crosshair & time-axis across panes".
//
// The symbols below are routed to synthetic histories that START ON DIFFERENT DATES on purpose —
// that is the whole defect. Mirroring the source pane's LOGICAL range put every peer on the same
// BAR NUMBER, which on a later-listed symbol is a different year. Every assertion here is written
// against the CALENDAR window each pane displays (`__mmPaneSync().panes[].window`, epoch ms), so
// it passes only for an implementation that mirrors dates.
//
// The chart enables kinetic (momentum) scrolling for the mouse, so a released drag keeps gliding
// for a while. Nothing here asserts until `settleViewport` has seen the motion stop — a fixed wait
// would be a race, and asserting mid-glide measures the animation rather than the bus.

const DAY = 86_400_000;
const END = "2026-06-30";

type Bars = (string | number)[][];

/** `n` weekday sessions ending on END. */
function businessDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${END}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/** `n` seven-day sessions ending on END — a crypto calendar against an equity one. */
function everyDay(n: number): string[] {
  const end = Date.parse(`${END}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * DAY).toISOString().slice(0, 10));
}

function ohlc(times: string[], base: number): Bars {
  return times.map((t, i) => {
    const c = base * (1 + 0.25 * Math.sin(i / 37) + i / (times.length * 8));
    return [t, +(c * 0.995).toFixed(4), +(c * 1.01).toFixed(4), +(c * 0.99).toFixed(4), +c.toFixed(4), 1_000_000 + i];
  });
}

/**
 * Deliberately staggered listings, all ending on the same session. Pane order in the grid follows
 * the fixture watchlist: NVDA (the deep link) then BTC-USD, ETH-USD, AAPL.
 */
const DEEP: Record<string, string[]> = {
  NVDA: businessDays(1200),        // ~4.6 years of sessions
  "BTC-USD": everyDay(1400),       // a seven-day calendar, listed later
  "ETH-USD": businessDays(700),
  AAPL: businessDays(900),
};

type PaneState = {
  id: number;
  tf: string;
  logical: { from: number; to: number } | null;
  window: { from: number; to: number } | null;
};

const paneSync = (page: Page): Promise<{ enabled: boolean; panes: PaneState[] }> =>
  page.evaluate(() => (window as unknown as {
    __mmPaneSync?: () => { enabled: boolean; panes: PaneState[] };
  }).__mmPaneSync?.() ?? { enabled: false, panes: [] });

async function routeFixtures(page: Page, histories: Record<string, string[]> = DEEP) {
  let base = 40;
  for (const [sym, times] of Object.entries(histories)) {
    const bars = ohlc(times, (base += 35));
    await page.route(`**/data/${sym}.json**`, (route) =>
      route.fulfill({ json: { t: sym, o: 1, src: "e2e-fixture", bar_quality: "real_ohlc", bars } }));
  }
  // A live splice would append a bar at today's date and stretch the fixture histories.
  await page.route("**/api/quote?**", (route) => route.fulfill({ json: { quotes: {} } }));
}

const iso = (msValue: number) => new Date(Math.round(msValue / DAY) * DAY).toISOString().slice(0, 10);

function describePanes(panes: PaneState[]): string {
  return panes.map((p) => p.window
    ? `pane ${p.id} ${iso(p.window.from)}→${iso(p.window.to)} @ logical ${p.logical!.from.toFixed(1)}…${p.logical!.to.toFixed(1)}`
    : `pane ${p.id} (no window)`).join(" | ");
}

/** The widest calendar disagreement across panes, in days. */
function driftDays(panes: PaneState[]): number {
  if (!panes.length || panes.some((p) => p.window == null)) return Number.POSITIVE_INFINITY;
  const head = panes[0].window!;
  return Math.max(...panes.map((p) =>
    Math.max(Math.abs(p.window!.from - head.from), Math.abs(p.window!.to - head.to)) / DAY));
}

const fingerprint = (panes: PaneState[]) =>
  panes.map((p) => (p.logical ? `${p.logical.from.toFixed(3)}/${p.logical.to.toFixed(3)}` : "-")).join(",");

/**
 * Wait until every pane has stopped moving, then return the resting state. Two consecutive equal
 * samples: an animation in flight (kinetic glide) or a bus that keeps re-driving a pane would
 * never produce them, so this doubles as the no-oscillation assertion.
 */
async function settleViewport(page: Page, label = "viewport"): Promise<PaneState[]> {
  let panes: PaneState[] = [];
  let previous = "";
  try {
    await expect.poll(async () => {
      panes = (await paneSync(page)).panes;
      const now = fingerprint(panes);
      const steady = panes.length > 0 && now === previous;
      previous = now;
      return steady;
    }, { timeout: 20_000, intervals: [150] }).toBe(true);
  } catch (err) {
    throw new Error(`${label} never stopped moving: ${describePanes(panes)}`, { cause: err });
  }
  return panes;
}

/** Settle, then require every pane to be on the same calendar window. */
async function settledCalendar(page: Page, toleranceDays = 2.5): Promise<PaneState[]> {
  const panes = await settleViewport(page);
  expect(driftDays(panes), `panes disagree on the calendar: ${describePanes(panes)}`).toBeLessThan(toleranceDays);
  return panes;
}

/** The split control lives inline on a wide toolbar and inside the overflow menu otherwise. */
async function setSplit(page: Page, n: number) {
  const inline = page.locator('[data-toolbar-action="split"] button', { hasText: String(n) });
  if (await inline.isVisible().catch(() => false)) { await inline.click(); return; }
  await page.getByTestId("toolbar-more").click();
  await page.locator(".toolbar-overflow-group .seg button", { hasText: String(n) }).click();
}

async function toggleSync(page: Page) {
  const inline = page.locator('[data-toolbar-action="sync"]');
  if (await inline.isVisible().catch(() => false)) { await inline.click(); return; }
  await page.getByTestId("toolbar-more").click();
  await page.locator('[data-toolbar-menu-action="sync"]').click();
}

async function openGrid(page: Page, n: 2 | 4) {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
  await setSplit(page, n);
  await expect.poll(async () => (await paneSync(page)).panes.length, { timeout: 45_000 }).toBe(n);
  await expect.poll(async () => (await paneSync(page)).panes.every((p) => p.window != null), { timeout: 45_000 }).toBe(true);
  await settleViewport(page, "initial grid");
}

async function dragPane(page: Page, index: number, dx: number) {
  const box = await page.locator(".chart-wrap").nth(index).boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height * 0.5;
  const x = box!.x + box!.width * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 24 });
  await page.mouse.up();
}

// The multi-pane grid is a >=861px surface: `app/globals.css` collapses `.pane-grid` to a single
// column below that and hides every pane after the first, and the phone chrome drops the chart
// toolbar that owns the split/sync controls entirely. Desktop shows the grid; tablet keeps the
// panes mounted and synced behind that collapse, which is what `__mmPaneSync` reports there.
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The split/sync toolbar and the multi-pane grid do not exist at phone width.");
  await routeFixtures(page);
});

test("two panes with different listing dates hold the same calendar window through a manual pan", async ({ page }, testInfo) => {
  await openGrid(page, 2);

  await dragPane(page, 0, 260);                       // drag right → travel back in time
  const panes = await settledCalendar(page);

  // The dates agree; the BAR NUMBERS do not. That difference is the defect made visible: mirroring
  // `logical` would have forced the bar numbers to be equal and the calendars apart.
  expect(Math.abs(panes[0].logical!.from - panes[1].logical!.from)).toBeGreaterThan(5);

  testInfo.annotations.push({ type: "calendar", description: describePanes(panes) });
  if (testInfo.project.name === "desktop") {
    await page.locator(".pane-grid").screenshot({ path: "docs/pr-crops/pane-sync-time-axis/desktop-two-pane.png" });
  }
});

test("a four-pane grid of four history depths converges on one calendar window", async ({ page }, testInfo) => {
  await openGrid(page, 4);

  await dragPane(page, 0, 200);
  const panes = await settledCalendar(page);

  // Panes whose symbol starts later sit at a smaller bar index for the same dates.
  const spread = Math.max(...panes.map((p) => p.logical!.from)) - Math.min(...panes.map((p) => p.logical!.from));
  expect(spread).toBeGreaterThan(5);

  testInfo.annotations.push({ type: "calendar", description: describePanes(panes) });
  if (testInfo.project.name === "desktop") {
    await page.locator(".pane-grid").screenshot({ path: "docs/pr-crops/pane-sync-time-axis/desktop-four-pane.png" });
  }
});

test("wheel zoom and a programmatic view reset both travel by calendar", async ({ page }) => {
  await openGrid(page, 2);

  const box = await page.locator(".chart-wrap").nth(0).boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await settledCalendar(page);

  // Double-Escape is the product's own "reset chart view" — a programmatic setVisibleLogicalRange
  // with no pointer behind it.
  await page.locator(".chart-wrap").nth(0).click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settledCalendar(page);
});

test("a peer whose history never reaches the window parks at its own edge and stops", async ({ page }) => {
  // BTC-USD holds well under a year here, so a long pan back leaves it nothing to show.
  await routeFixtures(page, { ...DEEP, "BTC-USD": everyDay(220) });
  await openGrid(page, 2);

  await dragPane(page, 0, 900);
  const panes = await settleViewport(page, "no-overlap grid");

  // Documented edge policy: pinned at the library's own left limit — earliest bars at the right
  // edge — rather than pretending to show a window it has no data for. So the peer's window starts
  // LATER than the source's, which is the truthful statement "this symbol's history begins after
  // the window you are on", and the two calendars are allowed to disagree by a wide margin here.
  expect(panes[1].logical!.to, describePanes(panes)).toBeCloseTo(1, 1);
  expect(panes[1].window!.from, describePanes(panes)).toBeGreaterThan(panes[0].window!.from);
  expect(driftDays(panes), describePanes(panes)).toBeGreaterThan(30);

  // …and it STAYS there. A second pan in the same direction must not re-drive it.
  await dragPane(page, 0, 200);
  const after = await settleViewport(page, "no-overlap grid after a second pan");
  expect(after[1].logical!.to).toBeCloseTo(1, 1);
});

test("turning Sync off leaves every viewport independent", async ({ page }) => {
  await openGrid(page, 2);
  await dragPane(page, 0, 200);
  await settledCalendar(page);

  await toggleSync(page);
  await expect.poll(async () => (await paneSync(page)).enabled, { timeout: 10_000 }).toBe(false);

  const before = (await paneSync(page)).panes[1];
  await dragPane(page, 0, -280);
  const after = await settleViewport(page, "sync-off grid");
  expect(after[1].logical).toEqual(before.logical);                                          // peer never moved
  expect(Math.abs(after[0].window!.from - before.window!.from) / DAY).toBeGreaterThan(2);    // source did
});

test("removing a pane leaves no stale registration driving the grid", async ({ page }) => {
  await openGrid(page, 4);
  await dragPane(page, 0, 160);
  await settledCalendar(page);

  await setSplit(page, 2);
  await expect.poll(async () => (await paneSync(page)).panes.length, { timeout: 30_000 }).toBe(2);

  await dragPane(page, 0, -220);
  await settledCalendar(page);
});

test("the mirrored crosshair still resolves each pane's own value at the broadcast timestamp", async ({ page }) => {
  await openGrid(page, 2);

  const box = await page.locator(".chart-wrap").nth(0).boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height * 0.5);
  await page.mouse.move(box!.x + box!.width * 0.46, box!.y + box!.height * 0.5);

  // Both panes print a hover readout, and the peer's price is its OWN series value — the two
  // symbols trade at different levels, so a price-mirrored crosshair would show the wrong one.
  await expect.poll(async () => page.locator(".mm-hovertag").count(), { timeout: 15_000 }).toBeGreaterThan(1);
});
