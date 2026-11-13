import { expect, test, type Page } from "@playwright/test";
import { REAL_CARR_BOARD_PLAN, stubBoardWithCarr, stubObservationsUnavailable } from "./prophetCaseFixtures";

/**
 * Prophet company case (Lane C) — T2-C5's case-unpublished design at every
 * width: an arrival breadcrumb, the honest headline, ONE card for what is not
 * published, the served study, "You can still study" as the exit list, and a
 * closed "Original model plan" row that links to Plans (P0-1: no trade
 * ticket — no entry, stop, target, R multiple, conviction or sizing copy on
 * this surface). Evidence and Context hold only what is served.
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

/** P1-5 vocabulary contract: no internal words and no raw ids on the case. */
const INTERNAL_WORDS = /not served|in this read|board read|\bPIT\b|group\(s\)/i;

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
 * bottom clears the bar's top by 8px. Measured for both fixture symbols. */
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
  for (const lang of ["en", "zh"] as const) {
    test(`ticket is not shown when the board carries the plan (${lang})`, async ({ page }) => {
      test.setTimeout(60_000);
      // These populated source values must stay in Plans, not the company case.
      expect(REAL_CARR_BOARD_PLAN.entry).toBe(56.47);
      expect(REAL_CARR_BOARD_PLAN.invalidation).toBe(52.26);
      await stubBoardWithCarr(page);
      await stubObservationsUnavailable(page);
      await withLang(page, lang);
      await page.goto(CARR_SETUP);
      const setup = page.getByTestId("prophet-sector-setup");
      await expect(setup).toBeVisible({ timeout: 15_000 });
      const planRow = page.getByTestId("prophet-sector-plan-link");
      await expect(planRow).toBeVisible();
      await expect(planRow).toContainText("CARR-BULL-20261016");
      await expect(planRow).toHaveAttribute("href", /prophetPlan=CARR-BULL-20261016/);
      for (const price of ["$56.47", "$52.26", "$62.78", "$69.10"]) {
        await expect(setup, price).not.toContainText(price);
      }
      // Exact ticket labels: the unrelated unavailable "Entry assessment" row
      // and the Plans destination's explanatory sentence are intentionally kept.
      await expect(setup.getByText(/^(Entry|Stop|Invalidation|Target(?: [12])?|入场价?|止损价?|失效价?|目标价?(?: [12])?)$/i)).toHaveCount(0);
      await expect(setup).not.toContainText(/conviction|确信度|信心评分|53\/100|size down|减仓|缩小仓位/i);
      await expect(setup.locator('[data-testid="geometry-rail"], [data-testid="plan-thesis"]')).toHaveCount(0);
    });
  }
  test("a plan member's case says what is missing once and keeps the exit list", async ({ page }) => {
    test.setTimeout(90_000);
    await stubBoardWithCarr(page);
    await stubObservationsUnavailable(page);
    await withLang(page);
    await page.goto(CARR_SETUP);

    const setup = page.getByTestId("prophet-sector-setup");
    await expect(setup).toBeVisible({ timeout: 15_000 });

    // P1-1: the headline is the honest case state, not a plan announcement;
    // the served Prophet state is the one eyebrow chip (no clocks, no quote
    // line, no verdict card).
    await expect(page.getByTestId("case-header")).toContainText("CARR");
    await expect(page.getByTestId("case-stance")).toHaveText("Case not published yet");
    await expect(page.getByTestId("case-state-chip")).toHaveText("Open plan");
    await expect(page.getByTestId("case-header")).not.toContainText(/quote clock|verdict not produced/i);

    const viewportWidth = page.viewportSize()?.width ?? 1440;
    if (viewportWidth === 1440) {
      // The headline keeps the T2-C5 display size (~32px), not a card line.
      const stanceSize = await page.getByTestId("case-stance")
        .evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(stanceSize).toBeGreaterThanOrEqual(30);
    }

    // P1-7: the arrival breadcrumb names the group and the kept selection; the
    // same population href backs the bottom return.
    const back = page.getByTestId("prophet-sector-setup-back");
    await expect(back).toHaveAttribute("href", /prophetView=population/, { timeout: 10_000 });
    await expect(back).toHaveAttribute("href", /prophetSymbol=CARR/);
    await expect(back).toHaveAttribute("href", /prophetGroup=us_sector_industrials/);
    await expect(back).toContainText(/(Industrials \(Equal-Weight\) · members|Sector members) · CARR selected/);
    const backBottom = page.getByTestId("prophet-sector-setup-back-bottom");
    await expect(backBottom).toContainText("Back to sector members");
    await expect(backBottom).toHaveAttribute("href", /prophetSymbol=CARR/);
    await expect(backBottom).toHaveAttribute("href", /prophetView=population/);

    // P1-2 / P1-3: ONE card says what is unavailable — the ~12 per-field
    // blocks (verdict card, entry banner, supports/challenges, next check,
    // evidence conclusion rows, context cards) are gone.
    const card = page.getByTestId("case-unavailable");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Research case unavailable");
    await expect(card).toContainText(/has not published a case for CARR/i);
    for (const row of ["Verdict headline", "Research family", "Supports and challenges", "Next check", "Entry assessment"]) {
      await expect(card, row).toContainText(row);
    }
    await expect(card).toContainText("Not available");
    await expect(card).toContainText("Unavailable"); // the entry assessment row
    // P1-4: no date labeled an assessment anywhere on the case.
    await expect(setup).not.toContainText(/assessment 2026/i);
    const legacyBlocks = setup.locator(
      '[data-testid="case-verdict"], [data-testid="case-clocks"], [data-testid="case-entry-banner"],'
      + '[data-testid="entry-check"], [data-testid="supports-challenges"], [data-testid="next-check"],'
      + '[data-testid="evidence-conclusion"]');
    expect(await legacyBlocks.count()).toBe(0);

    // The served study keeps its real numbers (G9); the company's own leg is
    // plainly "Not available".
    const study = page.getByTestId("study-card");
    await expect(study).toContainText("Separate the common move from the name");
    await expect(study).toContainText("-5.6%");
    await expect(study).toContainText("+1.1%");
    await expect(study).toContainText("+6.7 pp");
    await expect(study).toContainText("Not available");
    await expect(page.getByTestId("prophet-sector-setup-membership")).toContainText("at least 2026-08-13");
    await expect(page.getByTestId("prophet-sector-setup-membership")).toContainText("Member of 2 groups");

    // P0-1: the rail is Save/Follow plus ONE closed, linked model-plan row.
    // The trade ticket — entry, stop, targets, R multiples, conviction,
    // management bullets, "size down" — does not exist on this surface.
    const rail = page.getByTestId("model-plan-rail");
    await expect(rail).toContainText("Original model plan · CARR-BULL-20261016");
    await expect(rail).toContainText("Opened 2026-10-20.");
    await expect(rail).toContainText(/not permission to trade/i);
    const planLink = page.getByTestId("prophet-sector-plan-link");
    await expect(planLink).toHaveAttribute("href", /prophetPlan=CARR-BULL-20261016/, { timeout: 10_000 });
    await expect(planLink).not.toHaveAttribute("href", /prophetLane=sector/);
    await expect(rail.locator("details")).toHaveCount(0);
    for (const banned of ["52.26", "56.47", "62.78", "69.10"]) {
      await expect(setup, banned).not.toContainText(banned);
    }
    await expect(setup).not.toContainText(/conviction/i);
    await expect(setup).not.toContainText(/size down/i);
    await expect(setup).not.toContainText(/\d\.\d+R\b/);
    expect(await page.getByTestId("geometry-rail").count()).toBe(0);
    // The Save action still sits before the plan row in the rail's DOM.
    await expect(page.locator('[data-testid="case-rail"] > [data-testid="save-follow"]').first()).toBeVisible();

    // "You can still study" is the honest exit list (T2-C5).
    const links = page.getByTestId("study-links");
    await expect(links).toContainText("You can still study");
    await expect(links).toContainText("Company evidence");
    await expect(links).toContainText("Context and peers");
    await expect(links).toContainText("Sources & method");
    await expect(page.getByTestId("prophet-sector-chart-link")).toContainText("Open CARR chart");

    // Its sources row opens the one owner of the per-source clocks (T2-16),
    // which now says "Not available" in plain words.
    await page.getByTestId("study-link-sources").click();
    const sheet = page.getByTestId("sources-sheet");
    await expect(sheet).toHaveAttribute("open", "");
    await expect(sheet).toContainText("Signal date 2026-10-20");
    await expect(sheet).toContainText("Prophet plans");
    await expect(sheet).toContainText("Not available");
    await expect(sheet).not.toContainText(/not served|board read/i);

    // The study list navigates to the served destinations.
    await page.getByTestId("study-link-evidence").click();
    await expect(page.getByTestId("evidence-tab")).toBeVisible();
    await page.getByTestId("case-tab-setup").click();
    await page.getByTestId("study-link-context").click();
    await expect(page.getByTestId("context-tab")).toBeVisible();

    // Evidence: one plain unavailable line for a plan member (no observation
    // block), and no repeated rail (P1-2, fix order item 7).
    await page.getByTestId("case-tab-evidence").click();
    await expect(page.getByTestId("evidence-unavailable")).toContainText("Evidence for this company is not available yet.");
    await expect(page.getByTestId("observation-evidence")).toHaveCount(0);
    await expect(page.getByTestId("case-rail")).toHaveCount(0);
    await expect(page.getByTestId("save-follow")).toHaveCount(0);
    await expect(page.getByTestId("evidence-tab")).not.toContainText(INTERNAL_WORDS);

    // Context: membership by display name only (no raw ids — P1-5) and one
    // plain line for the relationships that are not published.
    await page.getByTestId("case-tab-context").click();
    const membership = page.getByTestId("context-membership");
    await expect(membership).toContainText("Industrials (Equal-Weight)");
    await expect(membership).toContainText("Housing Chain");
    await expect(membership).not.toContainText(/us_sector_|housing\b(?! Chain)/i);
    await expect(page.getByTestId("context-unavailable")).toContainText("Company context is not available yet.");
    await expect(page.getByTestId("case-rail")).toHaveCount(0);
    await expect(page.getByTestId("context-relationships")).toHaveCount(0);
    await expect(page.getByTestId("context-peer")).toHaveCount(0);

    // No History destination: it has no Paper design (census G14) and gets
    // no build work before one (principal ruling) — the tab strip carries
    // no placeholder for it.
    await expect(page.getByTestId("case-tab-history")).toHaveCount(0);

    // Only the active tab points at a panel (item 14): inactive destinations
    // render no panel, so their tabs carry no dangling aria-controls.
    await expect(page.getByTestId("case-tab-context")).toHaveAttribute("aria-controls", "case-panel-context");
    await expect(page.getByTestId("case-tab-setup")).not.toHaveAttribute("aria-controls");
    await expect(page.getByTestId("case-tab-evidence")).not.toHaveAttribute("aria-controls");

    // Tab choice stays view state: the symbol/group in the address survive.
    await page.getByTestId("case-tab-setup").click();
    await expect(page.getByTestId("study-card")).toBeVisible();
    await expect(page).toHaveURL(/prophetSymbol=CARR/);

    // P1-5: no internal vocabulary anywhere on the case.
    await expect(setup).not.toContainText(INTERNAL_WORDS);

    // Keyboard travel across the tabs (parallel destinations, roving focus).
    await page.getByTestId("case-tab-evidence").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("case-tab-context")).toBeFocused();
    await expect(page.getByTestId("context-membership")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("case-tab-evidence")).toBeFocused();
  });

  test("the next action clears the disclaimer bar at 1440", async ({ page }) => {
    test.setTimeout(90_000);
    test.skip((page.viewportSize()?.width ?? 0) !== 1440,
      "the fold budget is the 1440×900 contract");
    await stubBoardWithCarr(page);
    await stubObservationsUnavailable(page);
    await withLang(page);

    await page.goto(CARR_SETUP);
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    await expectActionsClearDisclaimer(page);

    await page.goto(ADP_SETUP);
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("case-stance")).toHaveText("Case not published yet");
    await expectActionsClearDisclaimer(page);
  });

  test("a failed plan read states unknown instead of a false absence, and retry recovers", async ({ page }) => {
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
    await expect(rail).toContainText("Plan terms unavailable", { timeout: 15_000 });
    await expect(rail).toContainText("Status unknown");
    await expect(rail).toContainText(/loading failure, not a missing plan/i);
    // The false absence claim must not render for a failed read (item 1), and
    // the copy no longer says "board read" (P1-5).
    await expect(rail).not.toContainText("not in the current board read");
    await expect(rail).not.toContainText(/board read/i);
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
    // another-list exit (T2-20 #7, item 11). P2-6: the top button is not a
    // second save action while the failure panel shows.
    await page.getByTestId("save-security").click();
    await expect(page.getByTestId("save-result")).toContainText(/couldn't save to this list/i);
    await expect(page.getByTestId("save-result")).toContainText("Your list is unchanged");
    await expect(page.getByTestId("save-result")).toContainText("Choose another list");
    await expect(page.getByTestId("save-result").getByRole("link", { name: /choose another list/i })).toHaveAttribute("href", "/monitor");
    await expect(page.getByTestId("save-security")).toBeDisabled();
    await page.getByTestId("save-result").getByRole("button", { name: /retry save/i }).click();

    // Saved → the confirmed state with the no-alerts footnote, the view-list
    // link and a Done that dismisses the panel (T2-20 #1, item 11). P2-1: the
    // top button says "Saved ✓" — exactly one "Done" on the page.
    await expect(page.getByTestId("save-result")).toContainText(/saved to your list/i);
    await expect(page.getByTestId("save-result")).toContainText(/does not save a dated thesis or start alerts/i);
    await expect(page.getByTestId("save-result")).toContainText("View saved list");
    await expect(page.getByTestId("save-security")).toHaveText("Saved ✓");
    await expect(page.getByTestId("prophet-sector-setup").getByText("Done", { exact: true })).toHaveCount(1);
    await page.getByTestId("save-done").click();
    await expect(page.getByTestId("save-result")).toHaveCount(0);
    await expect(page.getByTestId("save-security")).toHaveText("Saved ✓");
    expect(calls).toBe(2);
    expect(JSON.parse(bodies[0])).toEqual({ action: "add", symbol: "CARR", section: "prophet" });

    // Follow: no change-feed producer exists — the designed "alerts aren't
    // available here" state (T2-20 #8).
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

      // The same T2-C5 case state, with the served observation date labeled as
      // what it is (P1-4), and the short breadcrumb form.
      await expect(page.getByTestId("case-stance")).toHaveText("Case not published yet");
      await expect(page.getByTestId("case-state-chip")).toHaveText("Early observation");
      const card = page.getByTestId("case-unavailable");
      await expect(card).toContainText("Research case unavailable");
      await expect(card).toContainText("Latest observation 2026-11-06");
      await expect(page.getByTestId("prophet-sector-setup-back")).toContainText("Sector members · ADP selected");

      // No plan is open → the row says so and still offers the exit to Plans;
      // no entry check and no trade terms (P0-1).
      const rail = page.getByTestId("model-plan-rail");
      await expect(rail).toContainText("No model plan is open for this name.");
      await expect(rail).toContainText("Browse model plans");
      await expect(page.getByTestId("entry-check")).toHaveCount(0);
      await expect(setup).not.toContainText(/entry assessment unavailable/i);

      // P1-6: at 390 the case's tabs start within the first screen; at 320 the
      // first screen gets past the header chips.
      const chipBox = await page.getByTestId("case-state-chip").boundingBox();
      expect(chipBox, `${size.width} state chip`).not.toBeNull();
      expect((chipBox!.y + chipBox!.height), `${size.width} chip bottom`).toBeLessThan(size.height);
      if (size.width >= 390) {
        const tabsBox = await page.getByTestId("case-tabs").boundingBox();
        expect(tabsBox, "tabs").not.toBeNull();
        expect(tabsBox!.y, "390: tabs start within the first screen").toBeLessThan(size.height);
      }

      // Zero page-level horizontal overflow at the contract widths.
      expect(await setup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      // Touch-target floor at ≤640px: every disclosure control and button on
      // the case page is ≥44px (fix r2 B1 — the tabs, back, save, follow and
      // the Sources & method summary are all covered by the one contract).
      await expectCaseTouchTargets(page);

      // Evidence keeps the served observation disclosure for this member.
      await page.getByTestId("case-tab-evidence").click();
      await expect(page.getByTestId("observation-evidence")).toHaveCount(1);
      await expect(page.getByTestId("evidence-unavailable")).toContainText("Evidence for this company is not available yet.");
    }
  });
});
