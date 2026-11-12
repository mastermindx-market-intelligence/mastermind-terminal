import { expect, test, type Page } from "@playwright/test";
import { REAL_CARR_BOARD_PLAN, stubBoardWithCarr, stubObservationsUnavailable } from "./prophetCaseFixtures";

/**
 * Prophet company case (Lane C) — the Setup rebuilt as a verdict-first case
 * with Setup / Evidence / Context destinations, the developing observation
 * state, and the Save / Follow states. All unserved fields render their
 * designed unavailable states; nothing here depends on a live quote, verdict
 * or fundamentals producer. History has no Paper design (census G14) and so
 * has no destination here at all (principal ruling: no build work before
 * design).
 *
 * Data: the committed sector-member fixtures through the real BFF route
 * (FLOW_FIXTURE=1 webServer); the plan-member case extends the board fixture
 * through the same route-fetch seam the journey spec uses. Observation reads
 * are stubbed unavailable so the states are deterministic.
 */

const CARR_SETUP = "/options?tab=prophet&prophetLane=sector&prophetView=setup"
  + "&prophetGroup=us_sector_industrials&prophetSymbol=CARR&prophetPlan=CARR-BULL-20261016";
const ADP_SETUP = "/options?tab=prophet&prophetLane=sector&prophetView=setup"
  + "&prophetGroup=us_sector_industrials&prophetSymbol=ADP";

async function withLang(page: Page, lang: "en" | "zh" = "en") {
  await page.addInitScript(langCode => {
    localStorage.setItem("mm.lang", langCode);
  }, lang);
}

/** The case page's whole touch-target contract at phone widths: EVERY
 * disclosure control and button inside the case, not a hand-picked list —
 * so a new summary or action cannot ship below the 44px floor unnoticed
 * (fix r2 B1: the two summaries measured 12px and 10px). */
async function expectCaseTouchTargets(page: Page) {
  const controls = page.locator(
    '[data-testid="prophet-sector-setup"] summary, [data-testid="prophet-sector-setup"] button');
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    const label = (await control.innerText()).trim()
      || (await control.getAttribute("data-testid")) || `control ${index}`;
    const box = await control.boundingBox();
    expect(box?.height ?? 0, label).toBeGreaterThanOrEqual(44);
  }
}

/** M2 (round 3): the case's Save/Follow BUTTON — not its card — must be fully
 * visible above the hub's fixed disclaimer bar in the initial scrollport: its
 * bottom clears the bar's top by 8px. Measured for every fixture symbol, so a
 * wrapped stance heading cannot push the action under the bar. */
async function expectActionsClearDisclaimer(page: Page) {
  const barTop = await page.locator(".flow-disclaimer")
    .evaluate(el => el.getBoundingClientRect().top);
  expect(barTop).toBeGreaterThan(0);
  for (const testId of ["save-security", "follow-changes"]) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, testId).not.toBeNull();
    const bottom = box!.y + box!.height;
    expect(bottom, `${testId} bottom ${bottom} vs disclaimer bar top ${barTop}`)
      .toBeLessThanOrEqual(barTop - 8);
  }
}

test.describe("Company case (Lane C)", () => {
  test("a plan member's case reads verdict-first across its destinations", async ({ page }) => {
    test.setTimeout(90_000);
    await stubBoardWithCarr(page);
    await stubObservationsUnavailable(page);
    await withLang(page);
    await page.goto(CARR_SETUP);

    const setup = page.getByTestId("prophet-sector-setup");
    await expect(setup).toBeVisible({ timeout: 15_000 });

    // The header orients in seconds (T2-03): the STANCE line is the large
    // heading and the ticker rides the eyebrow; two labeled clocks (assessment
    // dated by the plan's own open date; no quote feed) and the honest
    // not-produced verdict — never entry/stop/targets first.
    await expect(page.getByTestId("case-header")).toContainText("CARR");
    await expect(page.getByTestId("case-stance")).toContainText(/open model plan is running/i);
    await expect(page.getByTestId("case-clock-assessment")).toContainText("2026-10-20");
    await expect(page.getByTestId("case-clocks")).toContainText(/quote clock not published/i);
    await expect(page.getByTestId("case-verdict")).toContainText("Verdict not produced");
    // The compact entry banner is a phone-width device (T2-12): hidden on
    // desktop/tablet, visible at contract phone widths.
    const viewportWidth = page.viewportSize()?.width ?? 1440;
    if (viewportWidth > 640) {
      await expect(page.getByTestId("case-entry-banner")).toBeHidden();
    } else {
      await expect(page.getByTestId("case-entry-banner")).toBeVisible();
      // B1 (fix r2): every disclosure control and button on the case page is
      // a real ≥44px touch target, the plan-thesis summary included.
      await expectCaseTouchTargets(page);
    }

    if (viewportWidth === 1440) {
      // M1 (fix r2): the stance is the case's display heading at the designed
      // T2-03 size (~32px), not a card-sized line.
      const stanceSize = await page.getByTestId("case-stance")
        .evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(stanceSize).toBeGreaterThanOrEqual(30);
    }

    // Setup tab (default): the labeled study — market and group over the same
    // window, the company's own leg honestly not produced (G10, G9). The dated
    // membership line lives HERE, once (fix order item 15).
    await expect(page.getByTestId("study-card")).toContainText("Separate the common move from the name");
    await expect(page.getByTestId("study-card")).toContainText("-5.6%"); // market, labeled
    await expect(page.getByTestId("study-card")).toContainText("+1.1%"); // group, labeled
    await expect(page.getByTestId("study-card")).toContainText("+6.7 pp");
    await expect(page.getByTestId("study-card")).toContainText(/not produced in this read/i);
    await expect(page.getByTestId("prophet-sector-setup-membership")).toContainText("at least 2026-08-13");
    // Supports / challenges / next check: designed unavailable states (G8),
    // with the chart link and reported footnote attached to the next check
    // (fix order item 16) — nothing floats at the tab's bottom.
    await expect(page.getByTestId("supports-challenges")).toContainText(/not produced for this symbol/i);
    await expect(page.getByTestId("next-check")).toContainText(/no next check is scheduled/i);
    await expect(page.getByTestId("next-check")).toContainText("Open CARR chart");
    await expect(page.getByTestId("next-check")).toContainText(/not a recommendation/i);

    // The rail stays the only place with terms, labeled reported (G8/G22):
    // entry state first, Save/Follow directly after it (fix order item 5),
    // then the model plan — and no R/R chip on this surface (item 3).
    const rail = page.getByTestId("entry-check-rail");
    await expect(page.getByTestId("entry-check")).toContainText("Entry assessment unavailable");
    await expect(rail.locator('[data-testid="entry-check"] + [data-testid="save-follow"]')).toBeVisible();
    await expect(page.getByTestId("model-plan-rail")).toContainText("CARR-BULL-20261016");
    // The R/R chip is hidden on this surface (item 3) — assert VISIBILITY, not
    // text: Playwright's text match reads textContent, which still carries
    // display:none content.
    await expect(page.getByTestId("geometry-rail").locator("span", { hasText: "R/R" })).toBeHidden();

    // Sources & method (T2-16): every source keeps its own clock — the plan
    // row's own signal date, the roster's own effective date, and per-source
    // not-served states; never one merged "as of".
    const sheet = page.getByTestId("sources-sheet");
    await expect(sheet).toContainText("Sources & method");
    await sheet.locator("summary").click();
    await expect(sheet).toContainText("Signal date 2026-10-20");
    await expect(sheet).toContainText("No live quote feed");
    await expect(sheet).toContainText(/not served on this surface/i);

    // Evidence tab: what is published vs what this source does not carry —
    // no observation block for a plan member (G12, G13). The rail carries the
    // conclusion as per-field unavailable rows + next checks (fix order item
    // 7): no repeated entry check, model plan or save on this destination.
    await page.getByTestId("case-tab-evidence").click();
    await expect(page.getByTestId("evidence-fundamentals")).toContainText(/not published/i);
    await expect(page.getByTestId("evidence-fundamentals")).toContainText(/revenue, net income, diluted shares and EPS/i);
    await expect(page.getByTestId("evidence-sequence")).toContainText(/release, call and filing times/i);
    await expect(page.getByTestId("evidence-conclusion")).toContainText(/not enough published evidence/i);
    await expect(page.getByTestId("evidence-conclusion")).toContainText("Reported growth");
    await expect(page.getByTestId("evidence-conclusion")).toContainText("Consensus surprise");
    await expect(page.getByTestId("evidence-conclusion")).toContainText("Matched revisions");
    await expect(page.getByTestId("evidence-conclusion")).toContainText("Entry decision");
    await expect(page.getByTestId("evidence-conclusion")).toContainText("Next checks");
    await expect(page.getByTestId("observation-evidence")).toHaveCount(0);
    await expect(page.getByTestId("entry-check")).toHaveCount(0);
    await expect(page.getByTestId("model-plan-rail")).toHaveCount(0);
    await expect(page.getByTestId("save-follow")).toHaveCount(0);

    // Context tab: membership without the repeated dated line (item 15 — that
    // line stays on Setup); the unserved relationships are named, not hidden
    // (G13), including the dated peer comparison and Foresight / Winner
    // health unavailable states (item 8). No rail on this destination.
    await page.getByTestId("case-tab-context").click();
    await expect(page.getByTestId("context-membership")).toContainText(/industrials/i);
    await expect(page.getByTestId("context-membership")).not.toContainText("Roster effective");
    await expect(page.getByTestId("context-relationships")).toContainText("Peer membership");
    await expect(page.getByTestId("context-relationships")).toContainText(/not served/i);
    await expect(page.getByTestId("context-peer")).toContainText("Dated peer comparison");
    await expect(page.getByTestId("context-peer")).toContainText(/not published for this group/i);
    await expect(page.getByTestId("context-foresight")).toContainText("Foresight");
    await expect(page.getByTestId("context-foresight")).toContainText("Context unavailable");
    await expect(page.getByTestId("context-winner")).toContainText("Winner health");
    await expect(page.getByTestId("context-winner")).toContainText("Context unavailable");
    await expect(page.getByTestId("entry-check-rail")).toHaveCount(0);

    // No History destination: it has no Paper design (census G14) and gets
    // no build work before one (principal ruling) — the tab strip carries
    // no placeholder for it.
    await expect(page.getByTestId("case-tab-history")).toHaveCount(0);

    // Only the active tab points at a panel (item 14): inactive destinations
    // render no panel, so their tabs carry no dangling aria-controls.
    await expect(page.getByTestId("case-tab-context")).toHaveAttribute("aria-controls", "case-panel-context");
    await expect(page.getByTestId("case-tab-setup")).not.toHaveAttribute("aria-controls");
    await expect(page.getByTestId("case-tab-evidence")).not.toHaveAttribute("aria-controls");

    // Return context: back to Setup restores the study without a refetch of
    // the address (tab choice is view state; the symbol/group stay served).
    await page.getByTestId("case-tab-setup").click();
    await expect(page.getByTestId("study-card")).toBeVisible();
    await expect(page).toHaveURL(/prophetSymbol=CARR/);

    // Back to population is a real link that keeps the symbol (item 10): the
    // population row this case came from keeps its identity. What the
    // population does with it is that surface's own order.
    const back = page.getByTestId("prophet-sector-setup-back");
    await expect(back).toHaveAttribute("href", /prophetView=population/, { timeout: 10_000 });
    await expect(back).toHaveAttribute("href", /prophetSymbol=CARR/);
    await expect(back).toHaveAttribute("href", /prophetGroup=us_sector_industrials/);

    // Keyboard travel across the tabs (parallel destinations, roving focus).
    await page.getByTestId("case-tab-evidence").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("case-tab-context")).toBeFocused();
    await expect(page.getByTestId("context-membership")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("case-tab-evidence")).toBeFocused();
  });

  test("the next action clears the disclaimer bar at 1440, at any headline length", async ({ page }) => {
    test.setTimeout(90_000);
    test.skip((page.viewportSize()?.width ?? 0) !== 1440,
      "the fold budget is the 1440×900 contract");
    await stubBoardWithCarr(page);
    await stubObservationsUnavailable(page);
    await withLang(page);

    // CARR: a one-line stance, and the plan's management notes make the entry
    // check the tall block above the action.
    await page.goto(CARR_SETUP);
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    const carrStance = page.getByTestId("case-stance");
    expect(carrStance).toHaveCount(1);
    expect((await carrStance.boundingBox())!.height, "CARR stance is one line").toBeLessThan(50);
    await expectActionsClearDisclaimer(page);

    // ADP: the 32px stance wraps to two lines and the header grows by a line —
    // the round-3 regression had the button under the bar here (y 821).
    await page.goto(ADP_SETUP);
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    const adpStance = page.getByTestId("case-stance");
    expect(await adpStance.evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize)))
      .toBeGreaterThanOrEqual(30);
    expect((await adpStance.boundingBox())!.height, "ADP stance is two lines").toBeGreaterThan(50);
    await expectActionsClearDisclaimer(page);
  });

  test("a failed board read states unknown instead of a false absence, and retry recovers", async ({ page }) => {
    test.setTimeout(60_000);
    await stubObservationsUnavailable(page);
    await withLang(page);

    // Every board read 503s until the test releases the stub — a read
    // failure, never a published absence. Gating on a flag (not a call
    // counter) keeps this deterministic under dev-mode StrictMode, which
    // double-invokes the read effect; the release happens only after the
    // unavailable state is asserted, and the retry's refresh read then lands.
    let boardReads = 0;
    let realReads = 0;
    let serveRealBoard = false;
    await page.route(
      url => url.pathname === "/api/flow" && url.searchParams.get("f") === "prophet_idx",
      async route => {
        boardReads += 1;
        if (!serveRealBoard) {
          await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
          return;
        }
        realReads += 1;
        const response = await route.fetch();
        const board = await response.json() as { plans: Record<string, unknown>[] };
        if (!board.plans.some(plan => plan.id === "CARR-BULL-20261016")) {
          board.plans.push(REAL_CARR_BOARD_PLAN as unknown as Record<string, unknown>);
        }
        await route.fulfill({ response, json: board });
      },
    );

    await page.goto(CARR_SETUP);
    const rail = page.getByTestId("model-plan-rail");
    await expect(rail).toContainText("Assessment data unavailable", { timeout: 15_000 });
    await expect(rail).toContainText("Status unknown");
    await expect(rail).toContainText(/read failure, not a published absence/i);
    // The false absence claim must not render for a failed read (item 1).
    await expect(rail).not.toContainText("not in the current board read");
    await expect(rail).not.toContainText("CARR-BULL-20261016");
    expect(boardReads).toBeGreaterThanOrEqual(1);
    expect(realReads).toBe(0);

    serveRealBoard = true;
    await page.getByTestId("prophet-sector-plan-retry").click();
    await expect(rail).toContainText("CARR-BULL-20261016");
    expect(realReads).toBeGreaterThanOrEqual(1);
  });

  test("save rides the existing watchlist API and follow states its absence", async ({ page }) => {
    test.setTimeout(60_000);
    await stubBoardWithCarr(page);
    await stubObservationsUnavailable(page);
    await withLang(page);

    // First POST fails (upstream error), the retry succeeds — the two real
    // outcomes of the existing endpoint; the body must be the endpoint's own
    // contract (action/symbol/section), not a new producer.
    const bodies: string[] = [];
    let calls = 0;
    await page.route("**/api/watchlist", async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      calls += 1;
      bodies.push(route.request().postData() ?? "");
      await route.fulfill(calls === 1
        ? { status: 502, contentType: "application/json", body: '{"error":"upstream"}' }
        : { status: 200, contentType: "application/json", body: '{"ok":true}' });
    });

    await page.goto(CARR_SETUP);
    await expect(page.getByTestId("save-follow")).toBeVisible({ timeout: 15_000 });

    // Not saved → the designed failure state: Retry primary plus the
    // another-list exit to the monitor surface (T2-20 #7, item 11).
    await page.getByTestId("save-security").click();
    await expect(page.getByTestId("save-result")).toContainText(/couldn't save to this list/i);
    await expect(page.getByTestId("save-result")).toContainText("Your list is unchanged");
    await expect(page.getByTestId("save-result")).toContainText("Choose another list");
    await expect(page.getByTestId("save-result").getByRole("link", { name: /choose another list/i })).toHaveAttribute("href", "/monitor");
    await page.getByTestId("save-result").getByRole("button", { name: /retry save/i }).click();

    // Saved → the confirmed state with the no-alerts footnote, the view-list
    // link and a Done that dismisses the panel (T2-20 #1, item 11).
    await expect(page.getByTestId("save-result")).toContainText(/saved to your list/i);
    await expect(page.getByTestId("save-result")).toContainText(/does not save a dated thesis or start alerts/i);
    await expect(page.getByTestId("save-result")).toContainText("View saved list");
    await page.getByTestId("save-done").click();
    await expect(page.getByTestId("save-result")).toHaveCount(0);
    expect(calls).toBe(2);
    expect(JSON.parse(bodies[0])).toEqual({ action: "add", symbol: "CARR", section: "prophet" });

    // Follow: no change-feed producer exists — the designed "alerts aren't
    // available here" state, with save still offered (T2-20 #8).
    await page.getByTestId("follow-changes").click();
    await expect(page.getByTestId("follow-panel")).toContainText(/alerts aren't available here/i);
    await expect(page.getByTestId("follow-panel")).toContainText(/does not yet provide a supported change feed/i);
    await page.getByTestId("follow-panel").getByRole("button", { name: /back to setup/i }).click();
    await expect(page.getByTestId("follow-panel")).toHaveCount(0);
  });

  test("a developing observation stays honest at phone width", async ({ page }) => {
    test.setTimeout(60_000);
    await stubObservationsUnavailable(page);
    await withLang(page);
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 600 }]) {
      await page.setViewportSize(size);
      await page.goto(ADP_SETUP);
      const setup = page.getByTestId("prophet-sector-setup");
      await expect(setup).toBeVisible({ timeout: 15_000 });

      // The compact entry-state banner sits directly under the header at
      // ≤640 (T2-12 order, item 6): the reader meets the amber state before
      // the deep content.
      const banner = page.getByTestId("case-entry-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/entry assessment unavailable/i);

      // The observation line and badge come from the sector contract; the
      // known list states the source is unreadable (deterministic 503), and
      // missing / next-check are the designed states (T2-22, G13).
      const card = page.getByTestId("observation-card");
      await expect(card).toBeVisible();
      await expect(card).toContainText("Early observation · 2026-11-06");
      await expect(card).toContainText("Observation only");
      await expect(card).toContainText(/not readable right now/i);
      await expect(card).toContainText(/no entry assessment is attached/i);
      await expect(card).toContainText(/does not schedule a next check/i);

      // The entry rail carries the missing-terms state; the amber assessment
      // banner stays first (T2-12).
      await expect(page.getByTestId("entry-check")).toContainText(/entry assessment unavailable/i);
      await expect(page.getByTestId("entry-check")).toContainText(/current entry terms are missing/i);
      await expect(page.getByTestId("model-plan-rail")).toContainText(/no model plan is open/i);

      // Zero page-level horizontal overflow at the contract widths.
      expect(await setup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      // Touch-target floor at ≤640px: every disclosure control and button on
      // the case page is ≥44px (fix r2 B1 — the tabs, back, save, follow and
      // the Sources & method summary are all covered by the one contract).
      await expectCaseTouchTargets(page);
    }
  });
});
