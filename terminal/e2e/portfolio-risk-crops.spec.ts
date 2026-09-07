import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

// B-F08-4 evidence generator (packet-required, ad-hoc — not part of test:e2e:responsive).
// OPT-IN via TERMINAL_CROPS=1. Positions come from real POSTs through /api/portfolio; the
// per-ticker artifact reads go through STOCKDATA_BASE (set by the invoking shell) so the
// gap states (missing/locked) are real transport outcomes, not mocked JSON.
//
// Round-2 review MAJOR 2 + MAJOR 4: point STOCKDATA_BASE at the COMMITTED fixture server
// (`e2e/fixtureStockdataServer.mjs`) before starting the e2e webServer — it is the only
// stockdata fixture in this repo that actually enforces the cookie gate (401 without the
// session cookie the spec sets below, 200 with it), and its fixture book spans >= 3 sectors
// and >= 3 company-size buckets for exactly the four tickers `seedBook()` opens positions in.
// The old, uncommitted fixture server this comment used to describe answered 200
// unconditionally, so the crops it produced never actually exercised the credentialed path —
// see the PR body's "State at head" section for how that was found and fixed.
test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "b-f08-4-risk");
const MODE = process.env.CROPS_MODE || "mixed";

// Minor-2 (round-2 re-review): synthetic tickers + fictional company names throughout, matching
// e2e/fixtureStockdataServer.mjs's FIXTURE_TICKERS — the crops this spec generates must never
// make a false sector/size statement about a real, recognizable company.
const MANIFEST = { symbols: {
  ZZTA: { name: "Zeta Tech Alpha", zh: "泽塔科技阿尔法", col: "#76b900", last: 175, chg: 1.2 },
  ZZTB: { name: "Zeta Comm Beta", zh: "泽塔通讯贝塔", col: "#8e8e93", last: 228.1, chg: -0.4 },
  ZZTC: { name: "Zeta Materials Gamma", zh: "泽塔材料伽马", col: "#e8b339", last: 318.4, chg: 0.6 },
  ZZTD: { name: "Zeta Financial Delta", zh: "泽塔金融德尔塔", col: "#4d82ff", last: 89.2, chg: -0.3 },
}};
const QUOTES = { quotes: {
  ZZTA: { last: 180.2, chg: 2.5 }, ZZTB: { last: 231.4, chg: -0.9 },
  ZZTC: { last: 320.1, chg: 0.7 }, ZZTD: { last: 89.5, chg: 0.1 },
}};

const shot = (page: Page, name: string, testInfo: TestInfo, lang = "en") =>
  page.screenshot({ path: join(OUT, `${name}-${lang}-${testInfo.project.name}-${MODE}.png`), fullPage: false });

// MAJOR 1 (round-2 review): at the 390 breakpoint the shell's own floating assistant launcher
// (a fixed-position element, pinned to the bottom of the viewport — a SHELL defect tracked
// separately as B-PLAT-7, never a defect in this component) can sit directly over the legend
// row of the last visible card. A fixed element cannot be scrolled out of the way itself, but
// scrolling the PAGE so every card sits higher in the viewport — clear of the region the bubble
// occupies — gives an honest, unobstructed crop of what this component actually renders.
//
// Round-2 re-review MAJOR 1 (follow-up): the first version of this helper queried a `<ul>` —
// but `Legend` (PortfolioView.tsx) renders `<div className={s.legend}>` / `<div
// className={s.legendRow}>`, never a `<ul>`. The ONLY `<ul>` in this section is `s.gapList`
// inside the "shape-gaps" `<details>`, which does not render at all for a fully-covered book —
// so `legend.count()` was 0 and the function returned immediately, doing NOTHING, which is
// exactly why the crop it produced still showed the "Industries" card's first legend row cut off
// by the bubble (RED before this fix — see the test below that proves it). The fix scrolls the
// LAST `[data-card]` article (a plain, unhashed attribute, not a CSS-module class name) to the
// bottom of the viewport: since every other card sits above it in document order, this clears
// the bubble's fixed footprint for every legend row on the page, not just one hard-coded target.
// Round-3 re-review Minor-3 (follow-up): block:"end" alone places the last card's BOTTOM edge
// flush with the viewport's bottom edge — exactly the screen region the shell's fixed launcher
// occupies, so the card that most needs clearing (whichever is last: "thickness"/liquidity in
// this component's card order) landed right back under it. The page has real content below the
// readout (the open-positions table), so there is room to scroll further; the extra wheel
// scroll pushes the card's bottom clear of the launcher's fixed footprint instead of flush
// against it.
async function scrollLegendClear(page: Page) {
  const shape = page.locator('[data-testid="portfolio-shape"]');
  if (!(await shape.count())) return;
  const lastCard = shape.locator("[data-card]").last();
  if (!(await lastCard.count())) return;
  await lastCard.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await page.mouse.wheel(0, 96);
}

// Round-2 re-review MAJOR 1 (follow-up) — "a committed frame proving it": rather than trust a
// screenshot a human might not scrutinize closely enough to notice a one-line clip, this asserts
// it in the DOM. `document.elementFromPoint` at a point near the BOTTOM of the given card — its
// trailing content, the specific spot the prior crop showed cut off by the shell's fixed floating
// launcher — must resolve to an element the card itself contains — if a fixed-position element
// from elsewhere in the page were still on top of it, `elementFromPoint` would return THAT
// element instead, and this fails. Ticker-agnostic, book-agnostic: only requires the card to
// exist. Round-3 re-review Minor-3: this now checks BOTH the "industries" card (the round-2
// repro case) and the "thickness"/liquidity card (the one the round-3 crop actually showed still
// obstructed — the permanent structural null this packet promises to print, per acceptance #2).
async function assertLegendUnobstructed(page: Page, cardName: "industries" | "thickness") {
  const selector = `[data-testid="portfolio-shape"] [data-card="${cardName}"]`;
  const card = page.locator(selector);
  if (!(await card.count())) return;
  const box = await card.boundingBox();
  if (!box) return;
  // Near the BOTTOM of the card (its last legend row / null sentence), not the top — the card's
  // header/bar sit safely above the fold; it is the trailing content that a bottom-anchored
  // fixed element can sit on top of.
  const point = { x: box.x + box.width / 2, y: box.y + box.height - 12 };
  const obstructed = await page.evaluate(({ x, y, sel }) => {
    const top = document.elementFromPoint(x, y);
    const card = document.querySelector(sel);
    return !(top && card && card.contains(top));
  }, { ...point, sel: selector });
  expect(
    obstructed,
    `a fixed-position element (e.g. the shell's floating assistant launcher, B-PLAT-7) sits on top of the ${cardName} card`,
  ).toBe(false);
}

// Meta-CEO B ruling (BLOCKER-1) + review MAJOR 3: `route.ts` now forwards the CALLER's own
// Supabase session cookie to every artifact fetch — an anonymous fan-out 401s in production, so
// evidence captured without this cookie exercises a path a signed-in user never takes. Same
// cookie SHAPE the unit test's fixture (`portfolioRouteRisk.test.ts` test 8) and macro's real
// gate (`sb-<project-ref>-auth-token`) use; `isSignedIn` gates whether a spec's crops are meant
// to show the covered (signed-in) or locked (signed-out) state.
const SESSION_COOKIE_NAME = "sb-testref-auth-token";
const SESSION_COOKIE_VALUE = "base64-eyJhY2Nlc3NfdG9rZW4iOiJmYWtlIn0";

async function setSessionCookie(page: Page, baseURL: string | undefined) {
  await page.context().addCookies([{
    name: SESSION_COOKIE_NAME,
    value: SESSION_COOKIE_VALUE,
    url: baseURL ?? "http://127.0.0.1:3108",
  }]);
}

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh = false, isSignedIn = true) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  if (isSignedIn) await setSessionCookie(page, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    document.documentElement.setAttribute("data-lang", useZh ? "zh" : "en");
    document.documentElement.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, zh);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: QUOTES }));
  await page.route("**/api/portfolio-brief", (route) => route.fulfill({ status: 404, json: {} }));
}

async function seedBook(page: Page) {
  const rows = [
    { ticker: "ZZTA", shares: "120", entryPrice: "138.40", entryDate: "2026-01-05" },
    { ticker: "ZZTB", shares: "60", entryPrice: "244.10", entryDate: "2026-03-18" },
    { ticker: "ZZTC", shares: "40", entryPrice: "296.00", entryDate: "2025-11-02" },
    { ticker: "ZZTD", shares: "150", entryPrice: "94.30", entryDate: "2026-02-11" },
  ];
  for (const row of rows) {
    const r = await page.request.post("/api/portfolio", { data: { action: "create", ...row } });
    expect(r.ok()).toBe(true);
  }
}

test("risk readout — mixed/outage book, EN", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, false);
  await seedBook(page);
  await page.goto("/portfolio");
  const shape = page.getByTestId("portfolio-shape");
  await expect(shape).toBeVisible({ timeout: 20_000 });
  // MAJOR 2 (round-2 review): the ONLY DOM proof this crop actually exercised the credentialed
  // fan-out path (this spec sets the session cookie above via `prepare(..., isSignedIn)`) rather
  // than the anonymous one, which an unauthenticated caller can equally reach.
  // Minor-4 (round-2 re-review): `data-coverage-source="credentialed"` on its own only proves the
  // cookie was PRESENT, not that the regwall actually opened for it — assert `data-shape-read` is
  // also non-zero in the SAME frame, so the credentialed claim is backed by an actual read.
  await expect(shape).toHaveAttribute("data-coverage-source", "credentialed");
  await expect(shape).not.toHaveAttribute("data-shape-read", "0");
  if (testInfo.project.name === "mobile") {
    await scrollLegendClear(page);
    await assertLegendUnobstructed(page, "industries");
    await assertLegendUnobstructed(page, "thickness");
  }
  await shot(page, "risk-book", testInfo, "en");
  if (MODE === "mixed") {
    const gaps = page.getByTestId("shape-gaps");
    if (await gaps.count()) {
      await gaps.locator("summary").focus();
      await shot(page, "risk-gaps-focus", testInfo, "en");
    }
  }
});

test("risk readout — mixed/outage book, ZH", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, true);
  await seedBook(page);
  await page.goto("/portfolio");
  const shape = page.getByTestId("portfolio-shape");
  await expect(shape).toBeVisible({ timeout: 20_000 });
  await expect(shape).toHaveAttribute("data-coverage-source", "credentialed");
  await expect(shape).not.toHaveAttribute("data-shape-read", "0");
  if (testInfo.project.name === "mobile") {
    await scrollLegendClear(page);
    await assertLegendUnobstructed(page, "industries");
    await assertLegendUnobstructed(page, "thickness");
  }
  await shot(page, "risk-book", testInfo, "zh");
});

// MAJOR 2 (round-2 review): the anonymous path must NEVER render the same attribute value a
// credentialed caller gets — this is the assertion the reviewer asked for, that the fixture
// stockdata server's cookie gate (e2e/fixtureStockdataServer.mjs) makes possible to prove.
test("risk readout — signed-out caller never renders data-coverage-source=credentialed", async ({ page, baseURL }, testInfo) => {
  test.skip(MODE !== "mixed", "Anonymous-path proof only needed once.");
  await prepare(page, testInfo, baseURL, false, /* isSignedIn */ false);
  await seedBook(page);
  await page.goto("/portfolio");
  const shape = page.getByTestId("portfolio-shape");
  await expect(shape).toBeVisible({ timeout: 20_000 });
  await expect(shape).not.toHaveAttribute("data-coverage-source", "credentialed");
  await expect(shape).toHaveAttribute("data-coverage-source", "anonymous");
});

test("risk readout — empty book renders nothing", async ({ page, baseURL }, testInfo) => {
  test.skip(MODE !== "mixed", "Empty-book crop only needed once.");
  await prepare(page, testInfo, baseURL, false);
  await page.goto("/portfolio");
  await expect(page.locator(".pf-empty")).toBeVisible();
  await expect(page.getByTestId("portfolio-shape")).toHaveCount(0);
  await shot(page, "risk-empty", testInfo);
});
