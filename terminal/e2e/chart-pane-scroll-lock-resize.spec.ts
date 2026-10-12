import { gzipSync } from "node:zlib";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

// The chart-hosted research pane (MegaPane) locks page scrolling while it presents as an overlay,
// and it presents as an overlay only at <=860px. The transcript drawer it opens locks page scrolling
// too. Both can be mounted at once, and the pane's lock turns on and off when the viewport crosses
// 860px while the drawer stays open. When each kept its own private copy of the overflow values, a
// resize made the two releases happen out of order and left a lock behind:
//   - D1: open both at <=860px, widen past 860px, close the drawer: the desktop page stays locked;
//   - D2: open both at >860px, narrow to <=860px, close the drawer: the page unlocks under the
//     still-open pane, and closing the pane then leaves the phone page locked.
// These cases drive the real resize sequences and read the inline overflow of <body> and <html>
// at every step. Every overflow check is soft and names its step, so a regression reports each
// step it breaks, not only the first. This spec writes no screenshots (TERMINAL_CROPS is ignored).

const ACTION = { timeout: 20_000 };
const STEP = { timeout: 10_000 };
const LOCKED: Overflow = { body: "hidden", root: "hidden" };
const BRAIN_SCRIPT_SRC = "https://www.mastermind-x.com/mm_brain.js";
const GENERATED_AT = "2026-08-01T00:00:00Z";
const CALL_ID = "2026Q3";
const soft = expect.configure({ soft: true });

type Overflow = { body: string; root: string };
type ScrollWindow = Window & { __mmChartPaneReady?: boolean; __mmScrollBefore?: Overflow };

// A synthetic call (no corpus text is committed): enough segments for the drawer to render a body.
const CALL = {
  schema: "mastermind.tx/v1",
  ticker: "NVDA",
  id: CALL_ID,
  period: "Q3 FY2026",
  date: "2025-11-19",
  title: "NVIDIA Earnings Call Q3 FY2026",
  segments: Array.from({ length: 12 }, (_, index) => ({
    speaker: index % 2 ? "Colette Kress" : "Jensen Huang",
    role: index % 2 ? "CFO" : "CEO",
    text: `Synthetic paragraph ${index + 1} about accelerated computing demand across data center customers.`,
  })),
};

async function routeArchive(page: Page) {
  await page.route(BRAIN_SCRIPT_SRC, (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route((url) => url.pathname === "/data/tx/index.json", (route) => route.fulfill({
    json: { schema: "mastermind.tx-index/v1", generated_at: GENERATED_AT, body_count: 1, symbols: { NVDA: [CALL_ID] } },
    headers: { "cache-control": "no-store" },
  }));
  await page.route((url) => url.pathname === "/data/tx/NVDA/index.json", (route) => route.fulfill({
    json: {
      schema: "mastermind.tx-symbol-index/v1",
      ticker: "NVDA",
      generated_at: GENERATED_AT,
      calls: [{
        id: CALL_ID,
        period: CALL.period,
        date: CALL.date,
        title: CALL.title,
        url: `/data/tx/NVDA/${CALL_ID}.json.gz`,
        segment_count: CALL.segments.length,
        speaker_count: 2,
        speakers: ["Jensen Huang", "Colette Kress"],
        qa_start: null,
        has_qa: false,
        source: "DefeatBeta",
      }],
    },
    headers: { "cache-control": "no-store" },
  }));
  await page.route((url) => /^\/data\/tx\/NVDA\/\d{4}Q[1-4]\.json\.gz$/.test(url.pathname), (route) => route.fulfill({
    body: gzipSync(JSON.stringify(CALL)),
    headers: { "content-type": "application/gzip", "cache-control": "no-store" },
  }));
}

// `before` is the inline overflow of <body> and <html> as the server sent them, recorded when the
// parser inserts <body> (a mutation callback runs before any page script can change either value).
async function prepare(page: Page) {
  await routeArchive(page);
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    const w = window as ScrollWindow;
    w.__mmChartPaneReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      w.__mmChartPaneReady = true;
    }, { once: true });
    const record = () => {
      if (w.__mmScrollBefore || !document.body) return Boolean(w.__mmScrollBefore);
      w.__mmScrollBefore = { body: document.body.style.overflow, root: document.documentElement.style.overflow };
      return true;
    };
    if (!record()) {
      const observer = new MutationObserver(() => {
        if (record()) observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    }
  });
}

function overflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => ({ body: document.body.style.overflow, root: document.documentElement.style.overflow }));
}

async function recordedBefore(page: Page): Promise<Overflow> {
  const before = await page.evaluate(() => (window as ScrollWindow).__mmScrollBefore ?? null);
  expect(before, "the init script should record the page's own overflow before anything opens").not.toBeNull();
  return before!;
}

async function expectOverflow(page: Page, expected: Overflow, step: string) {
  await soft.poll(() => overflow(page), { message: step, ...STEP }).toEqual(expected);
}

async function openTerminal(page: Page): Promise<Overflow> {
  await prepare(page);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator("html")).toHaveAttribute("data-lang", "en", ACTION);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible(ACTION);
  await expect.poll(
    () => page.evaluate(() => Boolean((window as ScrollWindow).__mmChartPaneReady)),
    { message: "the interactive Terminal should finish hydrating", ...ACTION },
  ).toBe(true);
  const before = await recordedBefore(page);
  expect(await overflow(page), "nothing holds a scroll lock before the pane opens").toEqual(before);
  return before;
}

async function press(target: Locator, testInfo: TestInfo) {
  if (testInfo.project.use.hasTouch) await target.tap(ACTION);
  else await target.click(ACTION);
}

function chartPane(page: Page) {
  return page.locator(".fin-pane.fin-pane--workspace");
}

function drawer(page: Page) {
  return page.locator(".fin-tx-modal-root .fin-tx-drawer");
}

// The real reader path: on a phone the Analysis hub's "Symbol details" tile scrolls the dossier
// into view; on every width the dossier's expand button opens the research pane.
async function openChartPane(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name === "mobile") {
    await press(page.getByTestId("roller-more"), testInfo);
    const hub = page.getByTestId("analysis-hub");
    await expect(hub).toBeVisible(ACTION);
    await press(hub.getByTestId("hub-tile-symbolDetails"), testInfo);
    await expect(hub).toHaveCount(0, ACTION);
  }
  const expand = page.locator(".detail-board .ex-btn");
  await expect(expand).toBeVisible(ACTION);
  await press(expand, testInfo);
  const pane = chartPane(page);
  await expect(pane).toBeVisible(ACTION);
  await expect(pane.locator(".fin-body")).toBeVisible(ACTION);
  return pane;
}

// Earnings → Transcripts through the pane's own navigation (the phone family sheet at <=860px).
async function showTranscripts(page: Page, pane: Locator, testInfo: TestInfo) {
  const trigger = pane.locator(".fin-family-mobile-trigger");
  if (await trigger.isVisible()) {
    await press(trigger, testInfo);
    const sheet = pane.locator(".fin-family-sheet");
    await expect(sheet).toBeVisible(ACTION);
    await press(sheet.locator('[data-fin-family-sheet="earnings"]'), testInfo);
    await expect(sheet).toHaveCount(0, ACTION);
    await press(pane.locator(".fin-local-mobile-tab", { hasText: "Transcripts" }), testInfo);
  } else {
    await press(pane.locator('[data-fin-family="earnings"]'), testInfo);
    await press(pane.locator('[data-fin-local="transcripts"]'), testInfo);
  }
  await expect(pane.locator(".fin-tx-library-row").first()).toBeVisible(ACTION);
}

async function openTranscript(page: Page, pane: Locator, testInfo: TestInfo) {
  await press(pane.locator(".fin-tx-library-row").first(), testInfo);
  await expect(drawer(page)).toBeVisible(ACTION);
}

async function closeTranscriptWithButton(page: Page, testInfo: TestInfo) {
  await press(drawer(page).getByRole("button", { name: "Close transcript" }), testInfo);
  await expect(drawer(page)).toHaveCount(0, ACTION);
}

async function expectPosition(pane: Locator, fixed: boolean, step: string) {
  const poll = expect.poll(() => pane.evaluate((el) => getComputedStyle(el).position), { message: step, ...ACTION });
  if (fixed) await poll.toBe("fixed");
  else await poll.not.toBe("fixed");
}

async function settle(page: Page) {
  // A negative check ("Escape did NOT close it") needs the handler's render to have had its chance.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 250)));
  }));
}

test("D1: open the pane and the transcript at <=860px, widen past 860px, close the drawer: the desktop page is unlocked", async ({ page }, testInfo) => {
  test.skip(!["mobile", "tablet"].includes(testInfo.project.name), "D1 starts with the chart-hosted pane presented as an overlay, which needs a <=860px project viewport");
  test.setTimeout(150_000);
  const start = testInfo.project.use.viewport!;
  const before = await openTerminal(page);

  const pane = await openChartPane(page, testInfo);
  await expectPosition(pane, true, "D1 the pane opens as an overlay");
  await expectOverflow(page, LOCKED, "D1 pane open at <=860px: body and html locked");

  await showTranscripts(page, pane, testInfo);
  await openTranscript(page, pane, testInfo);
  await expectOverflow(page, LOCKED, "D1 transcript open over the pane: body and html still locked");

  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0, ACTION);
  await expect(chartPane(page)).toHaveCount(1, ACTION);
  await expectOverflow(page, LOCKED, "D1 Escape closed only the drawer: the pane still holds the lock");

  await openTranscript(page, pane, testInfo);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(chartPane(page)).toHaveCount(1, ACTION);
  await expectPosition(pane, false, "D1 at 1440 the pane is back in its slot");
  await expect(drawer(page)).toBeVisible(ACTION);
  await expectOverflow(page, LOCKED, "D1 widened to 1440 with the drawer open: the drawer still holds the lock");

  await closeTranscriptWithButton(page, testInfo);
  await expectOverflow(page, before, "D1 drawer closed at 1440: body and html equal before");

  await page.keyboard.press("Escape");
  await settle(page);
  await expect(chartPane(page)).toHaveCount(1, ACTION);
  await expectOverflow(page, before, "D1 Escape at 1440 closes nothing and leaves overflow unchanged");

  await page.setViewportSize(start);
  await expectPosition(pane, true, "D1 back at the project viewport the pane is an overlay again");
  await expectOverflow(page, LOCKED, "D1 back at the project viewport: the pane locks body and html again");

  await press(pane.locator(".fin-head-back"), testInfo);
  await expect(chartPane(page)).toHaveCount(0, ACTION);
  await expectOverflow(page, before, "D1 Back to chart: body and html equal before");
});

test("D2: open the pane and the transcript at >860px, narrow to 390px, close the drawer then the pane: the phone page is unlocked", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "D2 starts with the chart-hosted pane in its desktop slot, which needs the 1440px project viewport");
  test.setTimeout(150_000);
  const before = await openTerminal(page);

  const pane = await openChartPane(page, testInfo);
  await expectPosition(pane, false, "D2 at 1440 the pane opens in its slot");
  await expectOverflow(page, before, "D2 pane open at 1440: no lock (the pane scrolls inside its slot)");

  await showTranscripts(page, pane, testInfo);
  await openTranscript(page, pane, testInfo);
  await expectOverflow(page, LOCKED, "D2 transcript open at 1440: body and html locked");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectPosition(pane, true, "D2 narrowed to 390 the pane is an overlay");
  await expect(drawer(page)).toBeVisible(ACTION);
  await expectOverflow(page, LOCKED, "D2 narrowed to 390 with the drawer open: body and html locked");

  await closeTranscriptWithButton(page, testInfo);
  await expect(chartPane(page)).toHaveCount(1, ACTION);
  await expectOverflow(page, LOCKED, "D2 drawer closed at 390 with the pane still open: body and html STILL locked");

  // The page behind the overlay is taller than the phone viewport, so an unlocked page would
  // scroll: the pane's own scroller is put at its end and a wheel over the pane chains to the page.
  const scrollable = await page.evaluate(() => (document.scrollingElement?.scrollHeight ?? 0) > window.innerHeight);
  if (scrollable) {
    await page.evaluate(() => {
      document.querySelector<HTMLElement>(".fin-pane--workspace .fin-body")?.scrollTo({ top: 1e6, behavior: "instant" });
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.mouse.move(195, 422);
    await page.mouse.wheel(0, 800);
    await settle(page);
    await page.waitForTimeout(400);
    soft(await page.evaluate(() => window.scrollY), "D2 a wheel over the open pane at 390 must not scroll the page behind it").toBe(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  } else {
    testInfo.annotations.push({ type: "note", description: "page not taller than 390x844; behavioural scroll check not applicable" });
  }

  await page.keyboard.press("Escape");
  await expect(chartPane(page)).toHaveCount(0, ACTION);
  await expectOverflow(page, before, "D2 Escape closed the pane at 390: body and html equal before");
});

test("ROT: rotate the tablet with the transcript open over the pane, close it, rotate back, Escape: no lock is left", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet", "ROT rotates the 820x1180 tablet viewport to 1180x820 and back");
  test.setTimeout(150_000);
  const start = testInfo.project.use.viewport!;
  const before = await openTerminal(page);

  const pane = await openChartPane(page, testInfo);
  await expectPosition(pane, true, "ROT portrait: the pane opens as an overlay");
  await expectOverflow(page, LOCKED, "ROT portrait pane open: body and html locked");

  await showTranscripts(page, pane, testInfo);
  await openTranscript(page, pane, testInfo);

  await page.setViewportSize({ width: start.height, height: start.width });
  await expectPosition(pane, false, "ROT landscape 1180: the pane is back in its slot");
  await expect(drawer(page)).toBeVisible(ACTION);
  await expectOverflow(page, LOCKED, "ROT landscape with the drawer open: the drawer still holds the lock");

  await closeTranscriptWithButton(page, testInfo);
  await expectOverflow(page, before, "ROT landscape drawer closed: body and html equal before");

  await page.setViewportSize(start);
  await expectPosition(pane, true, "ROT back to portrait: the pane is an overlay again");
  await expectOverflow(page, LOCKED, "ROT back to portrait: the pane locks body and html again");

  await page.keyboard.press("Escape");
  await expect(chartPane(page)).toHaveCount(0, ACTION);
  await expectOverflow(page, before, "ROT Escape closed the pane: body and html equal before");
});

test("A11Y-ESC: with the transcript open over the phone pane, the first Escape closes only the drawer and the second closes the pane", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the Escape order is pinned on the 390x844 phone viewport");
  test.setTimeout(150_000);
  await openTerminal(page);
  const pane = await openChartPane(page, testInfo);
  await showTranscripts(page, pane, testInfo);
  await openTranscript(page, pane, testInfo);

  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0, ACTION);
  await settle(page);
  await expect(chartPane(page)).toHaveCount(1, ACTION);

  await page.keyboard.press("Escape");
  await expect(chartPane(page)).toHaveCount(0, ACTION);
  expect(new URL(page.url()).pathname).toBe("/terminal");
});

test("ANALYSIS: the /analysis workspace on a phone holds no scroll lock and Escape keeps the route", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the embedded /analysis workspace is pinned on the 390x844 phone viewport");
  test.setTimeout(120_000);
  await prepare(page);
  await page.goto("/analysis?symbol=NVDA");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });
  const pane = page.locator(".analysis-shell .fin-pane--workspace");
  await expect(pane).toHaveCount(1, ACTION);
  await expect(pane).toBeVisible(ACTION);
  await expect(page.locator(".fin-head-back")).toHaveCount(0, ACTION);
  const before = await recordedBefore(page);
  await expectOverflow(page, before, "ANALYSIS the embedded workspace holds no scroll lock");

  await page.keyboard.press("Escape");
  await settle(page);
  expect(new URL(page.url()).pathname).toBe("/analysis");
  await expect(pane).toHaveCount(1, ACTION);
  await expect(pane).toBeVisible(ACTION);
  await expectOverflow(page, before, "ANALYSIS Escape leaves overflow unchanged");
});
