import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fmtDate } from "../lib/finFormat";
import { expectTapTarget } from "./tapTarget";
import { isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

// E14 — Watchlist event planner. A real signed-in shell with seeded owner lists, opened from its
// real entry point (watchlist header on desktop, symbol bar on tablet/phone). Only the per-company
// fundamentals files (`/data/<SYM>.fund.json`) and the coverage index are answered at the HTTP
// boundary; everything else — the cache, the planner, the shell, MegaPane's Earnings page — is
// the product.
//
// With TERMINAL_CROPS=1 the crops test also writes the PR's EN/ZH dark screenshots:
//
//   TERMINAL_E2E_PORT=47240 TERMINAL_CROPS=1 \
//     npx playwright test e2e/watchlist-event-planner.spec.ts --workers=1 -g crops

test.setTimeout(120_000);

const CROPS = !!process.env.TERMINAL_CROPS;
const OUT = join(process.cwd(), "docs", "pr-crops", "e14-watchlist-event-planner");

/** A UTC calendar day `offset` days from the runner's today, as the producer writes it. */
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const AAPL_DAY = day(18);
const AAPL_MOVED = day(19);

const LISTS = {
  Default: [],
  "Event prep": ["AAPL", "MSFT", "NVDA", "AMD", "AVGO", "BTC-USD"].map((symbol) => ({ symbol, section: "EQUITIES" })),
  Chips: ["NVDA", "AVGO", "ARM"].map((symbol) => ({ symbol, section: "EQUITIES" })),
};

type Answer = { kind: "date"; date: string | null; period?: string } | { kind: "status"; status: number } | { kind: "hold" };

const fund = (date: string | null, period = "Q4 2026") => ({ ticker: "", asof: day(-10), earnings: { next_date: date, next_period: period } });

/** Answers each fundamentals file from `plan`, counting every request that reaches the network. */
async function steerFundamentals(page: Page, plan: Record<string, Answer>) {
  const counts = new Map<string, number>();
  const parked = new Map<string, Route>();
  await page.route("**/data/coverage.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/data/*.fund.json", async (route) => {
    const symbol = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!.replace(/\.fund\.json$/, ""));
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    const answer = plan[symbol] ?? { kind: "status", status: 404 };
    if (answer.kind === "hold") { parked.set(symbol, route); return; }
    if (answer.kind === "status") return route.fulfill({ status: answer.status, body: "" });
    return route.fulfill({ json: { ...fund(answer.date, answer.period), ticker: symbol } });
  });
  const total = () => [...counts.values()].reduce((a, b) => a + b, 0);
  const release = async (symbol: string, answer: Exclude<Answer, { kind: "hold" }>) => {
    const route = parked.get(symbol);
    expect(route, `no parked request for ${symbol}`).toBeTruthy();
    parked.delete(symbol);
    if (answer.kind === "status") await route!.fulfill({ status: answer.status, body: "" });
    else await route!.fulfill({ json: { ...fund(answer.date, answer.period), ticker: symbol } });
  };
  return { counts, parked, total, release };
}

async function boot(page: Page, testInfo: TestInfo, baseURL: string | undefined, lang: "en" | "zh" = "en") {
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  await seedOwnerWatchlists(page, storeKey, {
    lists: LISTS,
    active: "Event prep",
    meta: Object.fromEntries(Object.keys(LISTS).map((name) => [name, { sections: name === "Default" ? [] : ["EQUITIES"], collapsed: [] }])),
  });
  await page.addInitScript((language) => {
    localStorage.setItem("mm.lang", language);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
  }, lang);
  // DIA is not in either list, so the shell's own fundamentals read never warms the planner's.
  await page.goto("/terminal?symbol=DIA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

const narrow = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 860;
const opener = (page: Page) => page.getByTestId(narrow(page) ? "m-events-open" : "wl-events-open");
const dialog = (page: Page) => page.getByTestId("wep-dialog");
const coverage = (page: Page) => page.getByTestId("wep-coverage");
const eventRow = (page: Page, symbol: string) => page.locator(`[data-testid="wep-event"][data-event-id^="earnings:${symbol}:"]`);

async function openPlanner(page: Page) {
  await expect(opener(page)).toBeVisible({ timeout: 20_000 });
  await opener(page).click();
  await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
}

/** Records every planner row ever inserted into the page, including rows that would only live one commit. */
async function recordPaintedRows(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __wepPainted: string[] }).__wepPainted = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const rows = node.matches('[data-testid="wep-event"]') ? [node] : [...node.querySelectorAll('[data-testid="wep-event"]')];
          for (const row of rows) seen.push(row.getAttribute("data-event-id") ?? "?");
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const paintedRows = (page: Page) => page.evaluate(() => (window as unknown as { __wepPainted: string[] }).__wepPainted);

test("list → agenda → company evidence: honest coverage, bounded reads, identity updates", async ({ page, baseURL }, testInfo) => {
  const plan: Record<string, Answer> = {
    AAPL: { kind: "date", date: AAPL_DAY },
    MSFT: { kind: "date", date: null },
    NVDA: { kind: "status", status: 503 },
    AMD: { kind: "status", status: 404 },
    AVGO: { kind: "date", date: day(60), period: "Q4 FY2026" },
  };
  const net = await steerFundamentals(page, plan);
  await boot(page, testInfo, baseURL);
  const beforeOpen = new Map(net.counts);
  await openPlanner(page);

  // ── AC-E14-04: coverage loss is visible and never reads as "no events" ──
  await expect(coverage(page)).toHaveAttribute("data-complete", "false", { timeout: 20_000 });
  await expect(coverage(page)).toHaveAttribute("data-unknown", "2", { timeout: 20_000 });
  await expect(coverage(page)).toContainText("Read 3 of 5 companies");
  await expect(coverage(page)).toContainText("1 could not be read");
  await expect(coverage(page)).toContainText("1 not covered by the source");
  await expect(coverage(page)).toContainText("1 not companies");
  await expect(page.getByTestId("wep-incomplete")).toBeVisible();
  await expect(page.getByTestId("wep-empty")).toHaveCount(0);
  await expect(page.locator('[data-testid="wep-other"][data-symbol="NVDA"]')).toContainText("Could not be read");
  await expect(page.locator('[data-testid="wep-other"][data-symbol="AMD"]')).toContainText("Not covered by the source");
  await expect(page.locator('[data-testid="wep-other"][data-symbol="MSFT"]')).toContainText("No upcoming date in the source");
  await expect(page.locator('[data-testid="wep-other"][data-symbol="BTC-USD"]')).toContainText("Not a company");

  // ── AC-E14-01: a date-only source record stays date-only ──
  const aapl = eventRow(page, "AAPL");
  await expect(aapl).toHaveCount(1);
  await expect(aapl).toHaveAttribute("data-precision", "date");
  await expect(aapl).toContainText("Date only · time not stated");
  await expect(aapl).toContainText("Confirmation not stated");
  expect(await aapl.textContent()).not.toMatch(/\d{1,2}:\d{2}/);
  expect(await dialog(page).textContent()).not.toMatch(/quiet/i);
  await expect(page.locator(`[data-day="${AAPL_DAY}"]`)).toHaveCount(1);

  // ── AC-E14-06: bounded network demand — one read per company, none for the crypto pair, no polling ──
  for (const symbol of ["AAPL", "MSFT", "NVDA", "AMD", "AVGO"]) {
    expect((net.counts.get(symbol) ?? 0) - (beforeOpen.get(symbol) ?? 0), `${symbol} reads`).toBe(1);
  }
  expect(net.counts.get("BTC-USD") ?? 0).toBe(0);
  const settledTotal = net.total();
  await page.waitForTimeout(3_000);
  expect(net.total(), "no scheduler: an idle open planner makes no further reads").toBe(settledTotal);

  if (narrow(page)) {
    for (const control of [page.getByTestId("wep-close"), page.getByTestId("wep-list"), page.getByTestId("wep-read-again"), aapl, page.getByTestId("wep-retry")]) {
      await expectTapTarget(control, { height: 44 });
    }
    const box = await page.getByTestId("wep-dialog").locator("> div").boundingBox();
    expect(box && box.width <= (page.viewportSize()?.width ?? 0) + 0.5).toBe(true);
  }

  // Retry is one forced read of that company only; success narrows the unknown count.
  plan.NVDA = { kind: "date", date: day(38), period: "Q3 FY2027" };
  await page.getByTestId("wep-retry").click();
  await expect(eventRow(page, "NVDA")).toHaveCount(1, { timeout: 20_000 });
  await expect(coverage(page)).toHaveAttribute("data-unknown", "1");
  expect((net.counts.get("NVDA") ?? 0) - (beforeOpen.get("NVDA") ?? 0)).toBe(2);
  expect(net.total()).toBe(settledTotal + 1);

  // ── AC-E14-03: a reschedule replaces the event by identity — one row, with the earlier day noted ──
  plan.AAPL = { kind: "date", date: AAPL_MOVED };
  const aaplBefore = net.counts.get("AAPL") ?? 0;
  await expect(page.getByTestId("wep-read-again")).toBeEnabled();
  await page.getByTestId("wep-read-again").click();
  await expect(page.locator(`[data-day="${AAPL_MOVED}"]`)).toHaveCount(1, { timeout: 20_000 });
  await expect(eventRow(page, "AAPL")).toHaveCount(1);
  await expect(page.locator(`[data-day="${AAPL_DAY}"]`)).toHaveCount(0);
  await expect(eventRow(page, "AAPL").getByTestId("wep-moved")).toContainText(`Moved from ${fmtDate(AAPL_DAY)}`);
  expect(net.counts.get("AAPL"), "Read again asks the network, not the cached copy").toBe(aaplBefore + 1);

  // ── AC-E14-04 (failure-state truth): a Read again that cannot reach the source never blanks a row.
  // AAPL keeps its row and date while the forced read is in flight and after it fails, labelled. ──
  plan.AAPL = { kind: "hold" };
  await expect(page.getByTestId("wep-read-again")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("wep-read-again").click();
  await expect.poll(() => net.parked.has("AAPL"), { timeout: 20_000 }).toBe(true);
  await expect(coverage(page)).toHaveAttribute("data-refreshing", "true", { timeout: 20_000 });
  await expect(page.getByTestId("wep-read-again")).toBeDisabled();
  await expect(eventRow(page, "AAPL")).toHaveCount(1);
  await expect(page.locator(`[data-day="${AAPL_MOVED}"]`)).toHaveCount(1);
  await net.release("AAPL", { kind: "status", status: 503 });
  await expect(coverage(page)).toHaveAttribute("data-refreshing", "false", { timeout: 20_000 });
  await expect(eventRow(page, "AAPL")).toHaveCount(1);
  await expect(page.locator(`[data-day="${AAPL_MOVED}"]`)).toHaveCount(1);
  await expect(eventRow(page, "AAPL").getByTestId("wep-earlier-copy")).toHaveText("Earlier copy · latest read failed");
  await expect(coverage(page)).toContainText("1 shown from an earlier copy");
  await expect(coverage(page)).toHaveAttribute("data-complete", "false");
  await expect(coverage(page)).toHaveAttribute("data-unknown", "2"); // AMD not covered + AAPL earlier copy
  await expect(page.locator('[data-testid="wep-other"][data-symbol="AAPL"]')).toHaveCount(0);
  plan.AAPL = { kind: "date", date: AAPL_MOVED };

  // ── AC-E14-06: the agenda row opens that company's own Earnings evidence ──
  await eventRow(page, "AAPL").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(".fin-earn-next")).toContainText(fmtDate(AAPL_MOVED), { timeout: 20_000 });
});

test("AC-E14-05: switching lists drops the previous list's late answers", async ({ page, baseURL }, testInfo) => {
  const plan: Record<string, Answer> = {
    AAPL: { kind: "hold" },
    MSFT: { kind: "hold" },
    NVDA: { kind: "date", date: day(38), period: "Q3 FY2027" },
    AMD: { kind: "date", date: day(25), period: "Q3 2026" },
    AVGO: { kind: "date", date: day(60), period: "Q4 FY2026" },
    ARM: { kind: "date", date: day(30), period: "Q2 FY2027" },
  };
  const net = await steerFundamentals(page, plan);
  await boot(page, testInfo, baseURL);
  await recordPaintedRows(page);
  await openPlanner(page);
  await expect.poll(() => net.parked.size, { timeout: 20_000 }).toBe(2);

  await page.getByTestId("wep-list").selectOption("Chips");
  await expect(coverage(page)).toHaveAttribute("data-complete", "true", { timeout: 20_000 });
  await expect(eventRow(page, "ARM")).toHaveCount(1);

  // The previous list's answers arrive now, after the switch.
  await net.release("AAPL", { kind: "date", date: AAPL_DAY });
  await net.release("MSFT", { kind: "date", date: day(20) });
  await page.waitForTimeout(1_500);

  await expect(eventRow(page, "AAPL")).toHaveCount(0);
  await expect(eventRow(page, "MSFT")).toHaveCount(0);
  await expect(dialog(page)).not.toContainText("AAPL");
  await expect(coverage(page)).toContainText("Read 3 of 3 companies");
  const painted = await paintedRows(page);
  expect(painted.some((id) => id.startsWith("earnings:AAPL:") || id.startsWith("earnings:MSFT:")), painted.join(",")).toBe(false);
  expect(painted.some((id) => id.startsWith("earnings:ARM:"))).toBe(true);
});

for (const lang of ["en", "zh"] as const) {
  test(`crops ${lang}`, async ({ page, baseURL }, testInfo) => {
    test.skip(!CROPS, "Crops are written only with TERMINAL_CROPS=1.");
    const plan: Record<string, Answer> = {
      AAPL: { kind: "date", date: AAPL_DAY },
      MSFT: { kind: "date", date: null },
      NVDA: { kind: "status", status: 503 },
      AMD: { kind: "status", status: 404 },
      AVGO: { kind: "date", date: day(60), period: "Q4 FY2026" },
    };
    const net = await steerFundamentals(page, plan);
    await boot(page, testInfo, baseURL, lang);
    await openPlanner(page);
    await expect(coverage(page)).toHaveAttribute("data-unknown", "2", { timeout: 20_000 });
    await expect(eventRow(page, "AVGO")).toHaveCount(1);
    expect(net.total()).toBeGreaterThan(0);
    await page.mouse.move(0, 0);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, `${testInfo.project.name}-${lang}.png`), animations: "disabled" });

    // Repair state: Read again cannot reach AAPL's source (its earlier answer stays, labelled) and
    // MSFT's source now carries a date that has already passed (outdated, never "no upcoming report").
    plan.AAPL = { kind: "status", status: 503 };
    plan.MSFT = { kind: "date", date: day(-3) };
    await page.getByTestId("wep-read-again").click();
    await expect(coverage(page)).toHaveAttribute("data-refreshing", "false", { timeout: 20_000 });
    await expect(eventRow(page, "AAPL").getByTestId("wep-earlier-copy")).toBeVisible({ timeout: 20_000 });
    await expect(coverage(page)).toHaveAttribute("data-unknown", "4");
    await expect(coverage(page)).toHaveAttribute("data-complete", "false");
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(OUT, `${testInfo.project.name}-${lang}-repair.png`), animations: "disabled" });
  });
}
