import { expect, test, type Page } from "@playwright/test";
import { stubBoardWithCarr, stubObservationsUnavailable } from "./prophetCaseFixtures";

/**
 * Prophet company case (Lane C) — the Setup rebuilt as a verdict-first case
 * with Setup / Evidence / Context / History destinations, the developing
 * observation state, and the Save / Follow states. All unserved fields render
 * their designed unavailable states; nothing here depends on a live quote,
 * verdict, fundamentals or history producer.
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

test.describe("Company case (Lane C)", () => {
  test("a plan member's case reads verdict-first across its four destinations", async ({ page }) => {
    test.setTimeout(90_000);
    await stubBoardWithCarr(page);
    await stubObservationsUnavailable(page);
    await withLang(page);
    await page.goto(CARR_SETUP);

    const setup = page.getByTestId("prophet-sector-setup");
    await expect(setup).toBeVisible({ timeout: 15_000 });

    // The header orients in seconds: company, reported stance, two labeled
    // clocks (assessment dated by the plan's own open date; no quote feed),
    // and the honest not-produced verdict — never entry/stop/targets first.
    await expect(page.getByTestId("case-header")).toContainText("CARR");
    await expect(page.getByTestId("case-stance")).toContainText(/open model plan is running/i);
    await expect(page.getByTestId("case-clock-assessment")).toContainText("2026-10-20");
    await expect(page.getByTestId("case-clocks")).toContainText(/quote clock not published/i);
    await expect(page.getByTestId("case-verdict")).toContainText("Verdict not produced");

    // Setup tab (default): the labeled study — market and group over the same
    // window, the company's own leg honestly not produced (G10, G9).
    await expect(page.getByTestId("study-card")).toContainText("Separate the common move from the name");
    await expect(page.getByTestId("study-card")).toContainText("-5.6%"); // market, labeled
    await expect(page.getByTestId("study-card")).toContainText("+1.1%"); // group, labeled
    await expect(page.getByTestId("study-card")).toContainText("+6.7 pp");
    await expect(page.getByTestId("study-card")).toContainText(/not produced in this read/i);
    // Supports / challenges / next check: designed unavailable states (G8).
    await expect(page.getByTestId("supports-challenges")).toContainText(/not produced for this symbol/i);
    await expect(page.getByTestId("next-check")).toContainText(/no next check is scheduled/i);
    // The rail stays the only place with terms, labeled reported (G8/G22).
    await expect(page.getByTestId("entry-check")).toContainText("Entry assessment unavailable");
    await expect(page.getByTestId("model-plan-rail")).toContainText("CARR-BULL-20261016");

    // Evidence tab: what is published vs what this source does not carry —
    // no observation block for a plan member (G12, G13).
    await page.getByTestId("case-tab-evidence").click();
    await expect(page.getByTestId("evidence-fundamentals")).toContainText(/not published/i);
    await expect(page.getByTestId("evidence-fundamentals")).toContainText(/revenue, net income, diluted shares and EPS/i);
    await expect(page.getByTestId("evidence-sequence")).toContainText(/release, call and filing times/i);
    await expect(page.getByTestId("evidence-conclusion")).toContainText(/not enough published evidence/i);
    await expect(page.getByTestId("observation-evidence")).toHaveCount(0);
    await expect(page.getByTestId("entry-check")).toBeVisible();

    // Context tab: served membership with both clocks; the unserved
    // relationships are named, not hidden (G13).
    await page.getByTestId("case-tab-context").click();
    await expect(page.getByTestId("context-membership")).toContainText("at least 2026-08-13");
    await expect(page.getByTestId("context-membership")).toContainText("Roster effective 2023-05-09");
    await expect(page.getByTestId("context-relationships")).toContainText("Peer membership");
    await expect(page.getByTestId("context-relationships")).toContainText(/not served/i);

    // History tab: the designed unavailable state is the shipped contract
    // until the producer and its mockup exist (G14, census §5).
    await page.getByTestId("case-tab-history").click();
    await expect(page.getByTestId("history-panel")).toContainText(/assessment history not published/i);

    // Return context: back to Setup restores the study without a refetch of
    // the address (tab choice is view state; the symbol/group stay served).
    await page.getByTestId("case-tab-setup").click();
    await expect(page.getByTestId("study-card")).toBeVisible();
    await expect(page).toHaveURL(/prophetSymbol=CARR/);

    // Keyboard travel across the tabs (parallel destinations, roving focus).
    await page.getByTestId("case-tab-evidence").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("case-tab-context")).toBeFocused();
    await expect(page.getByTestId("context-membership")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("case-tab-evidence")).toBeFocused();
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

    // Not saved → the designed failure state with a retry (T2-20 #7).
    await page.getByTestId("save-security").click();
    await expect(page.getByTestId("save-result")).toContainText(/couldn't save to this list/i);
    await expect(page.getByTestId("save-result")).toContainText("Your list is unchanged");
    await page.getByTestId("save-result").getByRole("button", { name: /retry save/i }).click();

    // Saved → the confirmed state with the no-alerts footnote (T2-20 #1).
    await expect(page.getByTestId("save-result")).toContainText(/saved to your list/i);
    await expect(page.getByTestId("save-result")).toContainText(/does not save a dated thesis or start alerts/i);
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
      // Touch target floor at ≤640px: save is a real ≥44px target.
      const box = await page.getByTestId("save-security").boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
