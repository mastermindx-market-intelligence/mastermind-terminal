import { expect, test, type Page } from "@playwright/test";

/**
 * B5 — a newly published artifact must become visible to an ALREADY-OPEN tab.
 *
 * `dataCache` remembered every 404 for the lifetime of the tab. So:
 *   1. the client asks for XYZ.intel.json before it exists -> 404, remembered forever;
 *   2. the nightly publisher writes XYZ.intel.json;
 *   3. the user revisits XYZ in the same tab and the client does not even make the request.
 * The only cure was closing the tab.
 *
 * The absence cache is now bounded. This spec proves both halves of the contract that matters:
 * a 404 stays CHEAP inside its window (no request storm), and the artifact is discovered after
 * the window without reloading the tab.
 *
 * Time is driven by Playwright's clock so the recovery interval is exercised for real rather
 * than approximated by shortening it for tests.
 */

test.setTimeout(120_000);

const ABSENT_SYM = "NOSUCHINTEL";
const OTHER_SYM = "AAPL";

const MANIFEST = {
  as_of: "2026-08-19",
  symbols: {
    [ABSENT_SYM]: { name: "No Such Intel", sec: "stock", mkt: "NASDAQ", last: 10, chg: 0 },
    [OTHER_SYM]: { name: "Apple", sec: "stock", mkt: "NASDAQ", last: 233.1, chg: -0.4 },
  },
};

const PUBLISHED_INTEL = {
  symbol: ABSENT_SYM,
  cards: { ai_judgment: { verdict: "HOLD", gloss: "published while the tab was open" } },
  tape: { ai_lean: { dir: "NEUTRAL" } },
};

/** In-place symbol switch — the same event the watchlist and search use. No reload. */
const pick = (page: Page, sym: string) =>
  page.evaluate((s) => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: s } })), sym);

test("an artifact published while the tab is open is found after the recovery interval", async ({ page }) => {
  await page.clock.install();

  let published = false;
  const intelRequests: number[] = [];

  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  // coverage.json absent in this world: this case is purely about the RUNTIME absence cache.
  await page.route("**/data/coverage.json**", (route) => route.fulfill({ status: 404, body: "{}" }));
  await page.route(`**/data/${ABSENT_SYM}.intel.json`, async (route) => {
    intelRequests.push(Date.now());
    if (!published) return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"absent"}' });
    return route.fulfill({ json: PUBLISHED_INTEL });
  });

  await page.goto(`/terminal?symbol=${ABSENT_SYM}`);

  // 1. one request, one 404. (The deferred fetch runs on idle; poll rather than guess.)
  await expect.poll(() => intelRequests.length, { timeout: 45_000 }).toBe(1);

  // 2. the absence is CHEAP: bouncing away and back must not re-request inside the window.
  for (let i = 0; i < 3; i += 1) {
    await pick(page, OTHER_SYM);
    await page.waitForTimeout(150);
    await pick(page, ABSENT_SYM);
    await page.waitForTimeout(150);
  }
  expect(intelRequests.length).toBe(1);

  // 3. the publisher writes the artifact — the tab stays open, nothing is reloaded.
  published = true;
  await pick(page, OTHER_SYM);
  await pick(page, ABSENT_SYM);
  await page.waitForTimeout(300);
  expect(intelRequests.length).toBe(1);            // still inside the window: still no request

  // 4. …and after the recovery interval the client asks again and finds it.
  await page.clock.fastForward("11:00");           // ABSENCE_TTL is 10 minutes
  await pick(page, OTHER_SYM);
  await pick(page, ABSENT_SYM);
  await expect.poll(() => intelRequests.length, { timeout: 20_000 }).toBe(2);

  // 5. the artifact is now DATA, not a re-armed absence: the next revisit is served from cache.
  await pick(page, OTHER_SYM);
  await pick(page, ABSENT_SYM);
  await page.waitForTimeout(300);
  expect(intelRequests.length).toBe(2);
});

test("a coverage-asserted absence also expires, so the index cannot outlive what it describes", async ({ page }) => {
  await page.clock.install();

  let published = false;
  const intelRequests: number[] = [];
  let coverageServed = 0;

  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  // A FRESH coverage index listing neither symbol as having intel — the pre-seed path, which
  // suppresses the request before any 404 is ever observed.
  //
  // `as_of` is stamped from the PAGE's clock, not the test runner's. With page.clock.install()
  // the two are separate timelines, and the client gates pre-seeding on how old the document
  // looks to IT; a Node-side `new Date()` here can therefore read as stale and silently disable
  // the seeding this test is about.
  await page.route("**/data/coverage.json**", async (route) => {
    const now = await page.evaluate(() => Date.now()).catch(() => Date.now());
    coverageServed += 1;
    return route.fulfill({
      json: {
        as_of: new Date(now).toISOString(),
        generation: Math.floor(now / 1000),
        intel: [], fund: [], opts: [], ohlc: [ABSENT_SYM, OTHER_SYM],
      },
    });
  });
  await page.route(`**/data/${ABSENT_SYM}.intel.json`, async (route) => {
    intelRequests.push(Date.now());
    if (!published) return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"absent"}' });
    return route.fulfill({ json: PUBLISHED_INTEL });
  });

  await page.goto(`/terminal?symbol=${OTHER_SYM}`);
  // Wait for the index to have been SERVED, then let the client's seeding promise settle. A fixed
  // sleep raced the fetch on a loaded runner and the seeding had not happened yet, which made the
  // "zero network cost" assertion fail for the wrong reason.
  await expect.poll(() => coverageServed, { timeout: 45_000 }).toBeGreaterThan(0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

  await pick(page, ABSENT_SYM);
  await page.waitForTimeout(500);
  expect(intelRequests.length).toBe(0);            // coverage said absent: zero network cost

  // …and after the window the client asks again and finds what the publisher wrote.
  published = true;
  await page.clock.fastForward("31:00");           // COVERAGE_ABSENCE_TTL is 30 minutes
  // The per-symbol read is deferred to an idle callback, so give the switch more than one chance
  // to land rather than assuming a single pick schedules it.
  await expect.poll(async () => {
    await pick(page, OTHER_SYM);
    await pick(page, ABSENT_SYM);
    return intelRequests.length;
  }, { timeout: 45_000, intervals: [500, 1000, 2000, 3000] }).toBeGreaterThan(0);
});
