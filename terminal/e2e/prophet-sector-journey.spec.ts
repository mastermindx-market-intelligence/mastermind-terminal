import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import populationWire from "../lib/__tests__/fixtures/sector_population.captured.v11_page1.json";
import { nativeGenerationFixture } from "../lib/__tests__/fixtures/sectorNativeGeneration";
import { sectorFixture } from "./fixtures/sector-company-v3";

/**
 * Prophet × Sector Intelligence — the first vertical slice (Lead B).
 *
 * MAIN block (always runs, Prophet-side only): direct /prophet entry → sector
 * lane → picker → full dated population → real company Setup → sources, with
 * the whole investigation in the address (deep link, refresh, back/forward),
 * keyboard-only travel, contract widths, the honest no-plan Setup, the
 * fail-closed group:null read (A1-9/A2-4) and the designed not-available-yet
 * degradation that leaves the board usable.
 *
 * All data is Macro's final v1 fixture generation (FLOW_FIXTURE=1 webServer)
 * served through the real BFF route; the plan-member Setup extends the board
 * fixture through the same route-fetch seam the observation specs use.
 *
 * SECTOR-ENTRY block (skippable): the one sector-side commit that adds the
 * member-row link into /prophet and its exact return. Run without it:
 *   TERMINAL_E2E_SKIP_SECTOR_ENTRY=1 npx playwright test prophet-sector-journey
 */

async function withLang(page: Page, lang: "en" | "zh" = "en") {
  await page.addInitScript(langCode => {
    localStorage.setItem("mm.lang", langCode);
  }, lang);
}

const enterSectorLane = async (page: Page) => {
  await page.getByTestId("prophet-lane-sector").click();
  await expect(page.getByTestId("prophet-sector-lane")).toBeVisible();
};

/** The REAL CARR-BULL-20261016 board row, byte-for-byte from the Prophet index
 * capture the v1 member fixtures were generated from (Macro `prophet-si`
 * `site/prophet/index.json`, asof 2026-11-09, source_asof 2026-11-06; plan row
 * sha256 bcdb39369d807417503c65e25dc3ad62fe4b64d0b9f513a0e75678f2847e7808),
 * projected onto exactly the 19 keys the committed board rows carry — every
 * value verbatim, nothing invented. Every level, date, state and the thesis
 * are already public in Macro `origin/main` at `site/prophet/plans/
 * CARR-BULL-20261016.json` and `site/prophet/states/
 * CARR-BULL-20261016.json` (verified 2026-11-11). The committed fixture board
 * is the 2026-07-07 generation and does not contain this plan; the review
 * caught the previous stub relabelling the SBUX template row as CARR, which
 * put Starbucks' levels and thesis on Carrier's setup. */
const REAL_CARR_BOARD_PLAN = {
  id: "CARR-BULL-20261016",
  asset: "CARR",
  direction: "BULL",
  entry: 56.47,
  invalidation: 52.26,
  targets: [62.785, 69.1],
  trigger: 56.77,
  option_contract: null,
  _r_unit: 4.21,
  _conviction_score: 53,
  _signal_date: "2026-10-20",
  phase: "pre_trigger",
  management_confidence: 32.3,
  recommended_action: "wait",
  last_price: 52.38,
  state: {
    phase: "pre_trigger",
    management_confidence: 32.3,
    recommended_action: "wait",
    components: { validity: 0.1, progress: 0.0, pace: 24.9, retention: 50.0, overlay: 27.0 },
    geometry: {
      dist_to_stop_r: 0.029, dist_to_t1_r: 1.5, dist_to_t2_r: 3.0, horizon_pct_used: 42.2,
      p1: -0.6477, p2: -0.3238, p3: null, move_r: -0.971, mfe_r: 0.002, mae_r: -0.971,
    },
    change_reason: "",
  },
  what_to_do_now: [
    "A PIT price range or closing print touched the $55.72–$56.47 zone. This is not proof of order execution or of the separate closing trigger confirming.",
    "Any position remains conditional on the plan's separate trigger and risk rules, including the $52.26 invalidation boundary.",
  ],
  profit_plan: [
    { level: 62.785, label: "T1", action: "Scale out 40%, trail stop to entry", status: "ACTIVE" },
    { level: 69.1, label: "T2", action: "Close remaining 60%, exit full position", status: "PENDING" },
  ],
  thesis: "CARR — conviction 53/100 (neutral) Entry grade: strong. Drivers: entry. Cautions: Earnings in 5 days. The result can override the setup, so size down.; Its Industrials (Equal-Weight) basket is below its long-term trend. Size down: the tape is rewarding leaders, and this basket is not one.. Trust tier: Event edge: insider buying (lone FDR survivor) + earnings-surprise PEAD context + revisions — a confluence read, not a standalone alpha. Options positioning (as of 2026-10-21): the heaviest call open interest sat at $57.00, about 0.9% above the entry — dealer hedging tends to add friction into that level, which is a place price stalls, not a target. DISPLAY-ONLY: machine-generated from factor scores; no forward return guarantee; display-tier artifact.",
};

/** The board read extended by the REAL CARR plan row (above) at the browser
 * seam, so the Setup's plan join selects genuine 2026-11-09 evidence. */
async function stubBoardWithCarr(page: Page) {
  await page.route(
    url => url.pathname === "/api/flow" && url.searchParams.get("f") === "prophet_idx",
    async route => {
      const response = await route.fetch();
      const board = await response.json() as { plans: Record<string, unknown>[] };
      if (!board.plans.some(plan => plan.id === "CARR-BULL-20261016")) {
        board.plans.push(REAL_CARR_BOARD_PLAN);
      }
      await route.fulfill({ response, json: board });
    },
  );
}

test.describe("Prophet-side journey (no sector-side dependency)", () => {
  test("lane → picker → population → real Setup → sources, all in the address", async ({ page }) => {
    test.setTimeout(90_000);
    await stubBoardWithCarr(page);
    await withLang(page);
    await page.goto("/options?tab=prophet");

    // The board is intact: the new lane is a fourth peer, the first lane still opens.
    await expect(page.getByRole("tab", { name: /Sector context/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Macro Plans/ })).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });

    await enterSectorLane(page);
    await expect(page).toHaveURL(/prophetLane=sector/);
    // Overview: the leadership table — every group of the read (49), ranked by
    // return versus market; the coverage-honesty line stays. Breadth is not
    // produced anywhere in this read, so its column drops out and one line
    // under the table says so (never 49 repetitions of "not produced").
    const picker = page.getByTestId("prophet-sector-picker");
    await expect(picker).toBeVisible({ timeout: 15_000 });
    const leadership = page.getByTestId("prophet-sector-leadership-table");
    await expect(leadership).toBeVisible();
    await expect(leadership.locator("tbody tr").first()).toContainText("Housing Chain"); // ranked first: +19.6 pp
    const industrialsRow = leadership.locator("tr", { has: page.getByTestId("prophet-sector-pick-us_sector_industrials") });
    await expect(industrialsRow).toContainText("Industrials");
    await expect(industrialsRow).toContainText("+6.7 pp");
    await expect(page.getByTestId("prophet-sector-picker-coverage")).toContainText("698 companies across 49 groups");
    await expect(page.getByTestId("prophet-sector-picker-coverage")).toContainText("outside these groups");
    await expect(page.getByTestId("prophet-sector-breadth-none")).toContainText(/not available/i);

    // SX01's hero summary names the top-ranked group from SERVED figures only.
    const hero = page.getByTestId("prophet-sector-leadership-hero");
    await expect(hero).toBeVisible();
    await expect(hero).toContainText("Housing Chain leads this read");
    await expect(page.getByTestId("prophet-sector-leadership-hero-figures"))
      .toContainText("+14.1%");
    await expect(page.getByTestId("prophet-sector-leadership-hero-figures"))
      .toContainText("+19.6 pp");

    // Pick Industrials → its focus page (SX02). The address keeps the group
    // under the lane's own keys; overview is the default view so prophetView
    // stays absent.
    await page.getByTestId("prophet-sector-pick-us_sector_industrials").click();
    const focus = page.getByTestId("prophet-sector-focus");
    await expect(focus).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/prophetGroup=us_sector_industrials/);
    await expect(page).not.toHaveURL(/prophetView=/);
    await expect(focus).toContainText("Industrials");
    await expect(focus).toContainText("ahead of the market"); // +6.7 pp read earns the lead intro
    // P1-4: the panels the wire cannot fill are ONE plain line, not four
    // refusal panels; the Sector Intelligence handoff stays a link, never a
    // copy, and the words are the reader's, not the pipeline's.
    await expect(page.getByTestId("prophet-sector-focus-si")).toHaveAttribute("href", "/sectors?group=us_sector_industrials");
    const limitation = page.getByTestId("prophet-sector-focus-unavailable");
    await expect(limitation).toContainText(/not available for this group yet/i);
    expect(await limitation.innerText()).not.toMatch(/on this wire|not served|not published/i);
    // P1-5: SX02's breadcrumb and its return contract both reach Today.
    await expect(page.getByTestId("prophet-sector-focus-breadcrumb")).toContainText("Today");
    await expect(page.getByTestId("prophet-sector-focus-breadcrumb")).toHaveAttribute("href", /tab=prophet/);
    await expect(page.getByTestId("prophet-sector-focus-return-today")).toContainText("Return to Today");
    // The group's own numbers live on this page — clocks, verdict and ink.
    const clocks = await page.getByTestId("prophet-sector-clocks").innerText();
    expect(clocks).toContain("2026-11-06");
    expect(clocks).toContain("2026-11-09");
    await expect(page.getByTestId("prophet-sector-verdict")).toContainText(/different sessions/i);
    // P2: the strip's figures carry the leadership table's semantic ink.
    const figureInk = (stat: string) =>
      page.getByTestId(`prophet-sector-stat-${stat}`).locator("b")
        .evaluate(node => getComputedStyle(node).color);
    const [groupInk, marketInk, relativeInk, breadthInk] =
      [await figureInk("group"), await figureInk("market"), await figureInk("relative"), await figureInk("breadth")];
    expect(relativeInk).toBe(groupInk); // +1.1% and +6.7 pp: both the up tone
    expect(groupInk).not.toBe(breadthInk); // never the neutral ink
    expect(marketInk).not.toBe(breadthInk); // −5.6%: the down tone
    expect(marketInk).not.toBe(groupInk);
    // P14: the descriptive-only boundary is stated on the focus page itself.
    await expect(page.getByTestId("prophet-sector-focus-disclaimer"))
      .toContainText("does not decide entry, size or timing for any name");
    // M8: the members control is the page's primary action.
    const membersAction = page.getByTestId("prophet-sector-focus-members");
    await expect(membersAction).toContainText("Research these names");
    const membersBox = await membersAction.boundingBox();
    expect(membersBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    // M4: the view change moves focus to the new view's heading.
    await expect(focus.locator("h3").first()).toBeFocused();

    // The members: the focus's own action opens the full dated population
    // (83 members on this read). Param order follows the address's history
    // (group was already present), so assert each key on its own.
    await page.getByTestId("prophet-sector-focus-members").click();
    await expect(page).toHaveURL(/prophetView=population/);
    await expect(page).toHaveURL(/prophetGroup=us_sector_industrials/);
    // M4: the new view's heading takes focus, so a screen reader announces it.
    await expect(page.getByTestId("prophet-sector-population").locator("h3").first()).toBeFocused();
    // P1-7: the population opens on a ONE-LINE sector header, not the whole
    // focus card again.
    const contextLine = page.getByTestId("prophet-sector-context-line");
    await expect(contextLine).toBeVisible({ timeout: 15_000 });
    await expect(contextLine).toContainText("Industrials");
    await expect(contextLine).toContainText("+6.7 pp vs market");
    await expect(page.getByTestId("prophet-sector-context")).toHaveCount(0);

    const table = page.getByTestId("prophet-sector-member-table");
    await expect(table).toBeVisible();
    // P0-1: the roster is ordered by the sector's own list, not by plan state —
    // ADP (an early observation) opens it, and CARR is not promoted.
    await expect(table.locator("tbody tr").first()).toContainText("ADP");
    await expect(table.locator("tbody tr").first()).not.toContainText("CARR");
    // The plan-state ink is neutral: a live plan reads the same as "No plan".
    const stateInk = (symbol: string) =>
      page.getByTestId(`prophet-sector-state-${symbol}`)
        .evaluate(node => getComputedStyle(node).color);
    expect(await stateInk("CARR")).toBe(await stateInk("ALLE"));
    // Plan state is a later, secondary filter — never the leading chip.
    const chips = page.locator('[data-testid^="prophet-sector-filter-"]');
    await expect(chips.first()).toHaveAttribute("data-testid", "prophet-sector-filter-all");
    await expect(chips.nth(1)).toHaveAttribute("data-testid", "prophet-sector-filter-early_observation");
    await expect(chips.last()).toHaveAttribute("data-testid", "prophet-sector-filter-open_plan");
    // SX04's evidence columns exist; the read has no figures, said once.
    await expect(table.locator("thead")).toContainText("Return");
    await expect(table.locator("thead")).toContainText("Vs sector");
    await expect(page.getByTestId("prophet-sector-measures-note")).toContainText(/not available for these companies yet/i);
    await expect(page.getByTestId("prophet-sector-state-CARR")).toContainText(/Open plan/i);
    await expect(page.getByTestId("prophet-sector-state-ADP")).toContainText(/Early observation/i);
    await expect(page.getByTestId("prophet-sector-state-ALLE")).toContainText(/No plan/i);
    await expect(page.getByTestId("prophet-sector-population-counts")).toContainText("83 companies");
    // first_known is a lower bound — the "at least" wording is on the surface.
    await expect(table).toContainText("at least 2026-08-13");

    // Search filters before paging, and the address carries it.
    await page.getByTestId("prophet-sector-search").fill("CARR");
    await page.getByRole("button", { name: /^Search/ }).click();
    await expect(page).toHaveURL(/prophetQ=CARR/);
    await expect(page.getByTestId("prophet-sector-open-CARR")).toBeVisible();
    await page.getByTestId("prophet-sector-search-clear").click();
    await expect(page).not.toHaveURL(/prophetQ=/);

    // Back through the focus to the leadership table, then Defensives: an
    // unserved member is visible there.
    await page.getByTestId("prophet-sector-population-back").click();
    await expect(page.getByTestId("prophet-sector-focus")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-focus-back").click();
    await expect(page).not.toHaveURL(/prophetGroup=/);
    await page.getByTestId("prophet-sector-pick-defensives").click();
    await page.getByTestId("prophet-sector-focus-members").click();
    await expect(page.getByTestId("prophet-sector-unserved")).toContainText("KVUE");

    // Back to Industrials → open CARR → the REAL board analysis by plan id.
    await page.getByTestId("prophet-sector-population-back").click();
    await page.getByTestId("prophet-sector-focus-back").click();
    await page.getByTestId("prophet-sector-pick-us_sector_industrials").click();
    await page.getByTestId("prophet-sector-focus-members").click();
    await expect(page.getByTestId("prophet-sector-open-CARR")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-open-CARR").click();
    await expect(page).toHaveURL(/prophetView=setup&prophetSymbol=CARR&prophetPlan=CARR-BULL-20261016/);
    const setup = page.getByTestId("prophet-sector-setup");
    await expect(setup).toBeVisible({ timeout: 15_000 });
    // Both membership clocks, labeled — lower bound and roster date.
    await expect(page.getByTestId("prophet-sector-setup-membership")).toContainText("at least 2026-08-13");
    await expect(page.getByTestId("prophet-sector-setup-membership")).toContainText("Roster effective 2023-05-09");
    // AnalysisPanel renders the board's own plan body (not a recomposed copy).
    // Deliberately NOT asserted: entry, invalidation, targets, conviction and
    // the thesis text. #1477 removes that trade ticket, and no test of ours may
    // lock it in — this only proves the plan is named and its panel mounted.
    await expect(setup.locator(".obs-prophet-analysis").first()).toBeVisible();
    const setupText = await setup.innerText();
    expect(setupText).toContain("CARR");
    // The membership shown is the one the reader is investigating: CARR sits
    // in Housing AND Industrials and Housing is memberOf[0] in the capture —
    // arriving from the Industrials population must show Industrials' own
    // group context ("What {group} is doing", clocks, return), never
    // Housing's. also_in_groups is never rendered, so "Housing" can only
    // reach the screen through the wrong-membership pick (review M1).
    expect(setupText).not.toContain("Housing");

    // Sources: both generations, one destination, the A2 disclosure vocabulary.
    await page.getByTestId("prophet-sector-sources").locator("summary").click();
    const sources = page.getByTestId("prophet-sector-sources");
    await expect(sources).toContainText("qualify-2026-11-06");
    await expect(sources).toContainText("2026-11-06");
    await expect(sources).toContainText("lower bounds from stored snapshots");
    await expect(sources).toContainText("current-basis GICS");
    await expect(sources).toContainText("no trade instructions");

    // Deep link: a fresh load of the same address restores the same Setup.
    const setupUrl = new URL(page.url());
    await page.goto("/options?tab=prophet");
    await expect(page.getByTestId("prophet-sector-lane")).toHaveCount(0);
    await page.goto(setupUrl.pathname + setupUrl.search);
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });

    // Refresh keeps it; back/forward walk the address history exactly — the
    // entry before this deep-linked Setup is the board lane it was entered
    // through in this leg, and forward restores the Setup byte-for-byte.
    await page.reload();
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(page.getByRole("tab", { name: /Macro Plans/ })).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await page.goForward();
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    // And the in-lane crumb returns to the population the row was opened from,
    // with that member still named in the address (M10).
    await page.getByTestId("prophet-sector-setup-back").click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/prophetView=population/);
    await expect(page).toHaveURL(/prophetGroup=us_sector_industrials/);
    await expect(page).toHaveURL(/prophetSymbol=CARR/);
    // The returned member's row is highlighted and brought into view.
    const returnedRow = page.getByTestId("prophet-sector-member-table").locator('tr[data-highlight="true"]');
    await expect(returnedRow).toContainText("CARR");
    await expect(returnedRow).toBeInViewport();
    // P1: the row the reader returned to is the current one in this list.
    await expect(returnedRow).toHaveAttribute("aria-current", "true");
    // M1: focus lands on the population heading once that highlight and scroll
    // have happened — not left on the document body.
    await expect(page.getByTestId("prophet-sector-population").locator("h3").first()).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName ?? "")).toBe("H3");
  });

  test("a member without a plan gets an honest Setup, never a manufactured signal", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    // The fixture set carries symbol files for ADP and CARR only; the no-plan
    // Setup rides the same contract shape built from ALLE's own member row in
    // the committed group fixture — nothing about ALLE is invented here.
    await page.route("**/api/prophet/sector-members?*symbol=ALLE*", async route => {
      const group = JSON.parse(readFileSync(
        "public/data/prophet_sector_members_fixture/group_us_sector_industrials.json", "utf8"));
      const member = group.members.find((m: { symbol: string }) => m.symbol === "ALLE");
      await route.fulfill({
        status: 200,
        json: {
          schema: group.schema, mode: "symbol", captured_at: group.captured_at,
          sector_ref: group.sector_ref, prophet_ref: group.prophet_ref,
          compatibility: group.compatibility, disclosure: group.disclosure,
          symbol: "ALLE", member_of: [{ group: group.group, member }], prophet: member.prophet,
        },
        headers: { "Content-Type": "application/json" },
      });
    });
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetView=population&prophetGroup=us_sector_industrials");
    await expect(page.getByTestId("prophet-sector-state-ALLE")).toContainText(/No plan/i, { timeout: 15_000 });
    await page.getByTestId("prophet-sector-open-ALLE").click();
    const setup = page.getByTestId("prophet-sector-setup");
    await expect(setup).toBeVisible({ timeout: 15_000 });
    await expect(setup).toContainText("ALLE setup");
    // The owner's reason, translated — not a raw code, not a stance.
    await expect(setup).toContainText(/no plan for this symbol/i);
    // The existing chart destination, and no board panel anywhere.
    await expect(page.getByTestId("prophet-sector-chart-link")).toHaveAttribute("href", /\/analysis\?symbol=ALLE/);
    await expect(setup.locator(".obs-prophet-analysis")).toHaveCount(0);
    await page.getByTestId("prophet-sector-setup-back").click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible();
  });

  test("a roster plan missing from today's board states the drift plainly", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    // The committed board fixture is the 2026-07-07 generation and does not
    // carry CARR-BULL-20261016, while the member fixture (2026-11-09) does. The
    // Setup must not contradict the population: it names what the member list
    // reports, says the board does not carry the plan, and sends the reader to
    // the board that owns the levels. No level is reconstructed here.
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetView=setup&prophetSymbol=CARR&prophetPlan=CARR-BULL-20261016&prophetGroup=us_sector_industrials");
    const setup = page.getByTestId("prophet-sector-setup");
    await expect(setup).toBeVisible({ timeout: 15_000 });
    const missing = page.getByTestId("prophet-sector-plan-missing");
    await expect(missing).toBeVisible({ timeout: 15_000 });
    await expect(missing).toContainText("not on today's board");
    await expect(missing).toContainText("The member list reports Open plan, opened 2026-10-20");
    expect(await missing.innerText()).not.toMatch(/board read|on this wire|not served/i);
    await expect(page.getByTestId("prophet-sector-plan-board")).toHaveAttribute("href", /tab=prophet/);
    await expect(setup.locator(".obs-prophet-analysis")).toHaveCount(0);
  });

  test("keyboard-only travel reaches the Setup without a pointer", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    await page.goto("/options?tab=prophet");
    // Land on the page, walk the tab order into the lane, through the
    // leadership table, the focus and into the population.
    await page.getByTestId("prophet-lane-sector").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("prophet-sector-picker")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-pick-us_sector_industrials").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("prophet-sector-focus")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-focus-members").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("prophet-sector-member-table")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-open-ADP").focus();
    await expect(page.getByTestId("prophet-sector-open-ADP")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    // Early observation members show the observation line, not a plan panel.
    await expect(page.getByTestId("prophet-sector-setup-observation")).toBeVisible();
  });

  test("the fail-closed group read (group null) states unavailability, never an empty list", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    // A1-9/A2-4 bytes: 200 envelope, group null, configured null, empty lists.
    await page.route("**/api/prophet/sector-members?*group=us_sector_industrials*", async route => {
      const base = JSON.parse(readFileSync(
        "public/data/prophet_sector_members_fixture/group_us_sector_industrials.json", "utf8"));
      await route.fulfill({
        status: 200,
        json: {
          ...base, group: null,
          counts: { configured: null, served: 0, accounted_unserved: 0, unaccounted: 0,
            open_plan: 0, resolved_plan: 0, early_observation: 0, none: 0, unavailable: 0 },
          members: [], unserved: [],
          sector_ref: null,
          compatibility: { status: "sector_unavailable", sector_session: null, prophet_asof: "2026-11-09", session_gap: null, reason: null },
        },
        headers: { "Content-Type": "application/json" },
      });
    });
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetView=population&prophetGroup=us_sector_industrials");
    const unavailable = page.getByTestId("prophet-sector-group-unavailable");
    await expect(unavailable).toBeVisible({ timeout: 15_000 });
    await expect(unavailable).toContainText("group context is not shown");
    await expect(unavailable).toHaveAttribute("role", "status");
    // No table renders that could read as "this group has no members".
    await expect(page.getByTestId("prophet-sector-member-table")).toHaveCount(0);
    await expect(page.getByTestId("prophet-sector-population-empty")).toHaveCount(0);
  });

  test("a fail-closed group read on the focus page drops its numbers (B1)", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    await page.route("**/api/prophet/sector-members?*group=us_sector_industrials*", async route => {
      const base = JSON.parse(readFileSync(
        "public/data/prophet_sector_members_fixture/group_us_sector_industrials.json", "utf8"));
      await route.fulfill({
        status: 200,
        json: {
          ...base, group: null,
          counts: { configured: null, served: 0, accounted_unserved: 0, unaccounted: 0,
            open_plan: 0, resolved_plan: 0, early_observation: 0, none: 0, unavailable: 0 },
          members: [], unserved: [],
          sector_ref: null,
          compatibility: { status: "sector_unavailable", sector_session: null, prophet_asof: "2026-11-09", session_gap: null, reason: null },
        },
        headers: { "Content-Type": "application/json" },
      });
    });
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetGroup=us_sector_industrials");
    const focus = page.getByTestId("prophet-sector-focus");
    await expect(focus).toBeVisible({ timeout: 15_000 });
    // The designed not-available block replaces the lead line and the numbers.
    const notServed = page.getByTestId("prophet-sector-focus-not-served");
    await expect(notServed).toBeVisible();
    await expect(notServed).toContainText("Group measures not available");
    await expect(notServed).toHaveAttribute("role", "status");
    await expect(page.getByTestId("prophet-sector-context")).toHaveCount(0);
    // No member count is spoken; the action is the count-free destination.
    const members = page.getByTestId("prophet-sector-focus-members");
    await expect(members).toContainText("Open the full population");
    expect(await members.innerText()).not.toMatch(/\d/);
  });

  test("a refreshed compare address says the selection was lost (M3)", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetView=compare&prophetGroup=us_sector_industrials");
    const lost = page.getByTestId("prophet-sector-compare-lost");
    await expect(lost).toBeVisible({ timeout: 15_000 });
    await expect(lost).toContainText("comparison selection was not kept in this address");
    await expect(page.getByTestId("prophet-sector-compare")).toHaveCount(0);
    await page.getByTestId("prophet-sector-compare-lost-back").click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 15_000 });
  });

  test("a setup address with no symbol says so instead of an empty Setup (M3)", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetView=setup&prophetGroup=us_sector_industrials");
    const missing = page.getByTestId("prophet-sector-setup-no-symbol");
    await expect(missing).toBeVisible({ timeout: 15_000 });
    await expect(missing).toContainText("does not name a company");
    await expect(page.getByTestId("prophet-sector-setup")).toHaveCount(0);
  });

  test("upstream absence degrades to the designed not-available-yet state", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    // The Macro endpoint is not deployed yet: the BFF sees 404/502/timeout.
    await page.route("**/api/prophet/sector-members**", route =>
      route.fulfill({ status: 503, json: { error: "source_unavailable" } }));
    await page.goto("/options?tab=prophet&prophetLane=sector");
    const unavailable = page.getByTestId("prophet-sector-index-unavailable");
    await expect(unavailable).toBeVisible({ timeout: 15_000 });
    await expect(unavailable).toContainText("Sector context is not available yet");
    await expect(unavailable).toHaveAttribute("role", "status");
    // The board itself keeps working — the lanes were never coupled.
    await page.getByRole("tab", { name: /Macro Plans/ }).click();
    await expect(page.locator("#prophet-panel-macro")).toContainText(/SBUX|UBER|BA|LRN/, { timeout: 20_000 });
    // And the sector lane still says so plainly when re-entered.
    await page.getByTestId("prophet-lane-sector").click();
    await expect(page.getByTestId("prophet-sector-index-unavailable")).toBeVisible({ timeout: 15_000 });
  });

  test("the relative-leader-falling read states what the advantage does not mean (SX09 #01)", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    // The committed reads are all same-sign (ahead AND up, or behind); this
    // stub rewrites only the industrials context to the specimen's case —
    // relative advantage positive, absolute group return negative — so the
    // designed line has honest numbers to carry.
    await page.route("**/api/prophet/sector-members?*group=us_sector_industrials*", async route => {
      const base = JSON.parse(readFileSync(
        "public/data/prophet_sector_members_fixture/group_us_sector_industrials.json", "utf8"));
      base.group.context = {
        ...base.group.context,
        group_return_pct: -2.0, market_return_pct: -4.0, relative_pp: 2.0,
      };
      await route.fulfill({
        status: 200, json: base,
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
    });
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetGroup=us_sector_industrials");
    const lead = page.getByTestId("prophet-sector-relative-lead");
    await expect(lead).toBeVisible({ timeout: 15_000 });
    await expect(lead).toContainText("Ahead of the market. Still falling.");
    await expect(lead).toContainText("Sector -2.0% · market -4.0% · advantage 2.0 pp");
    await expect(lead).toContainText(/does not turn the absolute return green/i);
    await expect(lead).toHaveAttribute("role", "status");
  });

  test("selecting members carries into the compare view and back (T2-06 → T2-07/T2-13)", async ({ page }) => {
    test.setTimeout(90_000);
    await withLang(page);
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetView=population&prophetGroup=us_sector_industrials");
    await expect(page.getByTestId("prophet-sector-member-table")).toBeVisible({ timeout: 15_000 });
    // The wire carries no per-member return/versus/breadth/research fields:
    // ONE honest line under the table, never per-row null spam.
    await expect(page.getByTestId("prophet-sector-measures-note"))
      .toContainText("not available for these companies yet");

    // Select two names; the tray names the count, carries a removable chip per
    // name, and the compare affordance needs two.
    await page.getByTestId("prophet-sector-select-CARR").check();
    const tray = page.getByTestId("prophet-sector-selection");
    await expect(tray).toContainText("1 selected");
    await expect(page.getByTestId("prophet-sector-compare-selected")).toBeDisabled();
    await page.getByTestId("prophet-sector-select-ADP").check();
    await expect(tray).toContainText("2 selected");
    await expect(tray).toContainText("CARR");
    await expect(tray).toContainText("ADP");
    await expect(tray).toContainText("Selections stay fixed as you change filters");
    await expect(page.getByTestId("prophet-sector-compare-selected")).toBeEnabled();

    // A third name reaches the cap; the cap is stated, never a silent no-op.
    await page.getByTestId("prophet-sector-select-ALLE").check();
    await expect(tray).toContainText("3 selected");
    await expect(tray).toContainText("Up to 3 names can be compared");

    // A chip removes exactly its name; the count follows.
    await page.getByTestId("prophet-sector-selection-remove-ALLE").click();
    await expect(tray).toContainText("2 selected");
    await expect(tray).not.toContainText("ALLE");

    // Selections survive a filter change: search narrows the table, the tray
    // keeps both names.
    await page.getByTestId("prophet-sector-search").fill("CARR");
    await page.getByRole("button", { name: /^Search/ }).click();
    await expect(page.getByTestId("prophet-sector-open-CARR")).toBeVisible();
    await expect(page.getByTestId("prophet-sector-select-ADP")).toHaveCount(0); // off-page now
    await expect(tray).toContainText("2 selected");
    await page.getByTestId("prophet-sector-search-clear").click();
    await expect(page.getByTestId("prophet-sector-select-ADP")).toBeVisible();

    // Compare is its OWN view (M3): a self-describing address, no symbol, and
    // one card per name; no combined score is ever assigned.
    await page.getByTestId("prophet-sector-compare-selected").click();
    const compare = page.getByTestId("prophet-sector-compare");
    await expect(compare).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/prophetView=compare/);
    await expect(page).not.toHaveURL(/prophetSymbol=/);
    // This read is mixed-basis (A1-7): ONE banner sentence carries both the
    // clock difference and the no-combined-arithmetic rule (SX09 #08).
    const banner = page.getByTestId("prophet-sector-compare-banner");
    await expect(banner).toContainText("different clocks");
    await expect(banner).toContainText("no combined score or ranking assigned");
    expect(await banner.innerText()).not.toMatch(/No combined score is assigned/);
    const carrCard = page.getByTestId("prophet-sector-compare-card-CARR");
    const adpCard = page.getByTestId("prophet-sector-compare-card-ADP");
    await expect(carrCard).toBeVisible({ timeout: 15_000 });
    await expect(adpCard).toBeVisible({ timeout: 15_000 });
    await expect(carrCard).toContainText(/Open plan/i);
    await expect(adpCard).toContainText(/Early observation/i);
    // P0-2: compare shows evidence, never direction/phase/opened — reached
    // from a sector-strength page those read as an entry checklist.
    await expect(carrCard).not.toContainText(/Direction/i);
    await expect(carrCard).not.toContainText(/Before trigger/i);
    await expect(carrCard).not.toContainText(/Opened/i);
    await expect(page.getByTestId("prophet-sector-compare-phase-CARR")).toHaveCount(0);
    // T2-07's anatomy is not on this read: one plain unavailable line.
    await expect(page.getByTestId("prophet-sector-compare-evidence-CARR"))
      .toContainText("Support, challenge and next check are not available");
    // M6: each card names its own single open action.
    await expect(page.getByTestId("prophet-sector-compare-open-CARR")).toContainText("Open setup");
    // Each case keeps its own clock — both owners' sessions on the card.
    await expect(page.getByTestId("prophet-sector-compare-clocks-CARR")).toContainText("2026-11-06");
    await expect(page.getByTestId("prophet-sector-compare-clocks-CARR")).toContainText("2026-11-09");
    // The unserved per-name fields state their absence in the designed words.
    await expect(carrCard).toContainText("window series is not available");
    await expect(carrCard).toContainText("Entry state unavailable");
    // A card opens its own setup; the lane's own back control returns to the
    // population with the selection intact (the interim selection rides the
    // lane's state, so a browser-back parse would drop it — the in-lane path
    // is the journey's own return).
    await page.getByTestId("prophet-sector-compare-open-CARR").click();
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-setup-back").click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 15_000 });

    // The population restored from the setup keeps the selection: tray count
    // and both checkboxes unchanged.
    await expect(page.getByTestId("prophet-sector-selection")).toContainText("2 selected");
    await expect(page.getByTestId("prophet-sector-select-CARR")).toBeChecked();
    await expect(page.getByTestId("prophet-sector-select-ADP")).toBeChecked();
    // And the compare's own back control does the same from the compare view.
    await page.getByTestId("prophet-sector-compare-selected").click();
    await expect(compare).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-compare-back").click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prophet-sector-selection")).toContainText("2 selected");

    // Phone and the smallest contract width: the compare cards stack to one
    // column with zero horizontal overflow (T2-13).
    await page.getByTestId("prophet-sector-compare-selected").click();
    await expect(compare).toBeVisible({ timeout: 15_000 });
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 600 }]) {
      await page.setViewportSize(size);
      await expect(carrCard).toBeVisible();
      expect(await page.getByTestId("prophet-sector-lane").evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  });

  test("390 and 320 keep the population readable with touch-sized controls", async ({ page }) => {
    test.setTimeout(90_000);
    await withLang(page);
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetView=population&prophetGroup=us_sector_industrials");
    await expect(page.getByTestId("prophet-sector-member-table")).toBeVisible({ timeout: 15_000 });
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 600 }]) {
      await page.setViewportSize(size);
      const lane = page.getByTestId("prophet-sector-lane");
      await expect(lane).toBeVisible();
      // Zero page-level horizontal overflow at the contract widths; the member
      // table owns its own scroll wrapper.
      expect(await lane.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      // Touch target floor at ≤640px: the row control is a real ≥44px target.
      const box = await page.getByTestId("prophet-sector-open-CARR").boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(page.getByTestId("prophet-sector-context-line")).toBeVisible();
    }
    // The compare checkbox meets the same floor, and the selection tray —
    // sticky at the lane's bottom edge at phone width — never adds overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("prophet-sector-select-CARR").check();
    await expect(page.getByTestId("prophet-sector-selection")).toContainText("1 selected");
    const wrap = await page.getByTestId("prophet-sector-select-wrap-CARR").boundingBox();
    expect(wrap?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.getByTestId("prophet-sector-lane").evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("the leadership table stacks into cards at ≤640 (SX06/SX08)", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/options?tab=prophet&prophetLane=sector");
    const leadership = page.getByTestId("prophet-sector-leadership-table");
    await expect(leadership).toBeVisible({ timeout: 15_000 });
    // The header row is replaced by in-card labels; each group is one card.
    await expect(leadership.locator("thead")).toBeHidden();
    const firstRow = leadership.locator("tbody tr").first();
    await expect(firstRow).toContainText("Housing Chain");
    await expect(firstRow.locator("td").nth(1)).toContainText("Window return");
    // The single Research action stays a ≥44px full-width target.
    const action = page.getByTestId("prophet-sector-pick-us_sector_industrials");
    const box = await action.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.getByTestId("prophet-sector-lane").evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("phone touch targets meet 44px: remove, checkbox, compare-open, sources", async ({ page }) => {
    test.setTimeout(90_000);
    await stubBoardWithCarr(page);
    await withLang(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/options?tab=prophet&prophetLane=sector&prophetView=population&prophetGroup=us_sector_industrials");
    await expect(page.getByTestId("prophet-sector-select-CARR")).toBeVisible({ timeout: 15_000 });

    // Checkbox target and its card-only visible label.
    const wrap = page.getByTestId("prophet-sector-select-wrap-CARR");
    const wrapBox = await wrap.boundingBox();
    expect(wrapBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(wrapBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(wrap).toContainText("Compare");

    // Selection chip remove control.
    await page.getByTestId("prophet-sector-select-CARR").check();
    const remove = page.getByTestId("prophet-sector-selection-remove-CARR");
    const removeBox = await remove.boundingBox();
    expect(removeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(removeBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The compare card's open action, then the Setup's sources controls.
    await page.getByTestId("prophet-sector-search").fill("CARR");
    await page.getByRole("button", { name: /^Search/ }).click();
    await page.getByTestId("prophet-sector-open-CARR").click();
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    const sources = page.getByTestId("prophet-sector-sources");
    await sources.locator("summary").click();
    const summaryBox = await sources.locator("summary").boundingBox();
    expect(summaryBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    const copyBox = await sources.getByRole("button", { name: "Copy" }).first().boundingBox();
    expect(copyBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(copyBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.getByTestId("prophet-sector-lane").evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("Chinese readers get the same population in their language", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page, "zh");
    await page.goto("/options?tab=prophet&prophetLane=sector");
    await expect(page.getByTestId("prophet-sector-leadership-table")).toBeVisible({ timeout: 15_000 });
    // name_zh is populated (A2-2) and used in ZH — in the row, and on the focus.
    const row = page.getByTestId("prophet-sector-leadership-table")
      .locator("tr", { has: page.getByTestId("prophet-sector-pick-us_sector_industrials") });
    await expect(row).toContainText("工业（等权）");
    await page.getByTestId("prophet-sector-pick-us_sector_industrials").click();
    const focus = page.getByTestId("prophet-sector-focus");
    await expect(focus).toBeVisible({ timeout: 15_000 });
    await expect(focus).toContainText("工业（等权）");
    await expect(focus).toContainText("全部行业组"); // the focus's back control, in ZH
    await page.getByTestId("prophet-sector-focus-members").click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prophet-sector-population")).toContainText("预言台中的工业（等权）");
    await expect(page.getByTestId("prophet-sector-state-CARR")).toContainText("进行中计划");
    // The lower-bound wording survives translation.
    await expect(page.getByTestId("prophet-sector-member-table")).toContainText("至少 2026-08-13");
    await page.getByTestId("prophet-sector-open-CARR").click();
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prophet-sector-setup")).toContainText("CARR 研究起点");
  });

  test("a >100-member group pages: Next/Prev issues the new offset and the rows change", async ({ page }) => {
    test.setTimeout(90_000);
    await withLang(page);
    // The committed industrials capture has 83 members — one page, no pager
    // journey. This wire keeps the capture's shape and swaps in a 130-member
    // roster across two offset-keyed pages of unique symbols, so the pager has
    // a second page and the fetch key has to carry offset (review M2): before
    // that fix, Next relabelled the pager and left page one's rows on screen
    // under a "101–130" label.
    const group = JSON.parse(readFileSync(
      "public/data/prophet_sector_members_fixture/group_us_sector_industrials.json", "utf8")) as {
      members: Record<string, unknown>[];
      counts: Record<string, number | null>;
    } & Record<string, unknown>;
    const template = group.members.find(
      member => (member.prophet as Record<string, unknown>).state === "none")!;
    const rows = (offset: number, count: number) => Array.from({ length: count }, (_, i) => ({
      ...template,
      symbol: `Z${String(offset + i).padStart(3, "0")}`,
      name: `Paged Member ${offset + i}`,
    }));
    const requestedOffsets: number[] = [];
    await page.route("**/api/prophet/sector-members?*group=us_sector_industrials*", async route => {
      const offset = Number(new URL(route.request().url()).searchParams.get("offset") ?? "0");
      requestedOffsets.push(offset);
      const pageMeta = offset === 0
        ? { offset: 0, limit: 100, total_matching: 130, next_offset: 100, q: null, state: null }
        : { offset: 100, limit: 100, total_matching: 130, next_offset: null, q: null, state: null };
      return route.fulfill({
        status: 200,
        json: {
          ...group,
          counts: { ...group.counts, configured: 130, served: 130, none: 130,
            open_plan: 0, resolved_plan: 0, early_observation: 0, unavailable: 0 },
          members: offset === 0 ? rows(0, 100) : rows(100, 30),
          page: pageMeta,
        },
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
    });
    await page.goto("/options?tab=prophet");
    await enterSectorLane(page);
    await page.getByTestId("prophet-sector-pick-us_sector_industrials").click();
    await expect(page.getByTestId("prophet-sector-focus")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-focus-members").click();
    await expect(page.getByTestId("prophet-sector-open-Z000")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prophet-sector-pager")).toContainText("Showing 1 of 130–100");
    await expect(page.getByTestId("prophet-sector-open-Z099")).toBeVisible();

    // Next: a NEW request carrying the new offset — and the first row changes.
    await page.getByTestId("prophet-sector-page-next").click();
    await expect(page.getByTestId("prophet-sector-open-Z100")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prophet-sector-open-Z000")).toHaveCount(0);
    await expect(page.getByTestId("prophet-sector-open-Z129")).toBeVisible();
    await expect(page.getByTestId("prophet-sector-pager")).toContainText("Showing 101 of 130–130");
    await expect(page).toHaveURL(/prophetOffset=100/);

    // Prev: back to page one — again a request, again the rows change, and
    // offset 0 leaves the address entirely.
    await page.getByTestId("prophet-sector-page-prev").click();
    await expect(page.getByTestId("prophet-sector-open-Z000")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prophet-sector-open-Z100")).toHaveCount(0);
    await expect(page).not.toHaveURL(/prophetOffset=/);

    // The decisive read: every page turn reached the wire with its own offset.
    const turns = requestedOffsets.filter((offset, i) => i === 0 || offset !== requestedOffsets[i - 1]);
    expect(turns).toEqual([0, 100, 0]);
  });
});

test.describe("Sector → Prophet entry (needs the isolated sector-side commit)", () => {
  test.skip(() => !!process.env.TERMINAL_E2E_SKIP_SECTOR_ENTRY, "set TERMINAL_E2E_SKIP_SECTOR_ENTRY=1 to run without the sector row-link commit");

  /** The population wire the golden capture decoder accepts, filtered to the
   * Industrials basket with Prophet-eligible rows — the sector side's own wire
   * shape, extended by nothing this test invents beyond its rows. The decoder's
   * paging laws: a page never carries more rows than its own limit (the
   * capture's limit is 2, so the 3-row page must raise it), and a final page
   * says complete:true exactly when its cursor is cleared. */
  function industrialsPopulationWire() {
    const body = JSON.parse(JSON.stringify(populationWire)) as {
      page: {
        rows: Record<string, unknown>[];
        filter: { group: string | null };
        limit: number;
        total_matching: number;
        next_cursor: null;
        complete: boolean;
      };
    };
    const row = (ordinal: number, symbol: string, name: string, industry: string) => ({
      ...body.page.rows[0],
      ordinal, group_id: "us_sector_industrials", symbol, name,
      industry: { status: "available", label: industry },
      prophet_eligibility: { status: "eligible" },
    });
    body.page.rows = [
      row(0, "CARR", "Carrier Global", "Building Products"),
      row(1, "ALLE", "Allegion plc", "Industrials"),
      row(2, "ADP", "Automatic Data Processing", "Industrials"),
    ];
    body.page.filter.group = "us_sector_industrials";
    body.page.limit = 3;
    body.page.total_matching = 3;
    body.page.next_cursor = null;
    body.page.complete = true;
    return body;
  }

  /** The workspace stub every sector-entry test shares: the whole
   * sector-intelligence family served the way sector-leadership-dossier.spec.ts
   * serves it — the shared fixture for every feed, the population capture
   * extended with Prophet-eligible rows, and a synthetic generation parent
   * (the dossier needs a decoding generation feed before it renders any
   * view). */
  async function stubSectorWorkspace(page: Page) {
    await page.route("**/api/sector-intelligence?**", async route => {
      const source = new URL(route.request().url()).searchParams.get("source") || "";
      if (source === "population") {
        return route.fulfill({
          status: 200,
          json: industrialsPopulationWire(),
          headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
        });
      }
      if (source === "generation") {
        return route.fulfill({ status: 200, json: { data: nativeGenerationFixture({
          as_of: "2026-11-06",
          sectors: [{ id: "xlk", name: "Technology", name_zh: "科技", ticker: "XLK",
            momentum: { rs_21d_rank: 1, rs_rank: 3, above_200d: true, lead: "leading" },
            heat: { breadth_pct: 58, adv: 46, dec: 33, heat_1M: 7.01 },
            cycle: { phaseLabel: "Rolling over" }, conviction: { label_en: "Cautious" }, rotation: { state: "TURN SIGNALED" } }],
        }), receipt: { source, path: "/api/sector-generation?audience=preview", status: "ready",
          asOf: "2026-11-06", observedAt: "2026-11-06T21:00:00Z", stale: false, contentHash: "sha256:transport" } } });
      }
      if (source === "sector") {
        return route.fulfill({ status: 200, json: { data: {
          as_of: "2026-11-06",
          sectors: [{ id: "xlk", name: "Technology", name_zh: "科技", ticker: "XLK",
            momentum: { rs_21d_rank: 1, rs_rank: 3, above_200d: true, lead: "leading" },
            heat: { breadth_pct: 58, adv: 46, dec: 33, heat_1M: 7.01 },
            cycle: { phaseLabel: "Rolling over" }, conviction: { label_en: "Cautious" }, rotation: { state: "TURN SIGNALED" } }],
        }, receipt: { source, path: "/sectordata/sector_central.json", status: "ready",
          asOf: "2026-11-06", observedAt: "2026-11-06T21:00:00Z", stale: false, contentHash: "sha256:transport" } } });
      }
      return sectorFixture(route);
    });
  }

  test("the member row links into Prophet and the return restores the exact origin", async ({ page }) => {
    test.setTimeout(90_000);
    await withLang(page);
    await stubSectorWorkspace(page);

    // The dossier's Companies view needs the full workspace state in the
    // address: sectorWorkspace=detail alone keeps the legacy detail surface —
    // the native dossier (population members) is active only with a sectorJob.
    const origin = "/discover?tab=sectors&sectorWorkspace=detail&sectorJob=research&sectorView=companies&group=us_sector_industrials";
    await page.goto(origin);
    // The sector side's own table is up (its wire, its decoder).
    const carrRow = page.getByRole("row", { name: /CARR/ }).first();
    await expect(carrRow).toBeVisible({ timeout: 20_000 });
    // The row carries ONLY the link affordance — no Prophet state text (an
    // entitled-only fact is not leaked to this surface).
    await expect(carrRow).toContainText(/Prophet/i);

    const link = carrRow.getByTestId("population-row-prophet").first();
    await expect(link).toHaveAttribute("href",
      /prophetLane=sector&prophetView=population&prophetGroup=us_sector_industrials&prophetFrom=/);
    // The entitled reader follows it into the population.
    await link.click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/prophetGroup=us_sector_industrials/);

    // Exact return: the labelled control goes back to the exact origin address.
    const back = page.getByTestId("prophet-sector-return");
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(page.getByRole("row", { name: /CARR/ }).first()).toBeVisible({ timeout: 20_000 });
  });

  /** M3's shared proof, run at desktop and at 390px: the picker's group and
   * the applied search ride the page's address under the population block's
   * own prophet-prefixed keys, so BOTH return paths — the labelled Prophet
   * return control and browser Back — restore the exact selection. */
  async function assertPopulationFiltersSurviveTheProphetRoundTrip(page: Page) {
    const carrRow = page.getByRole("row", { name: /CARR/ }).first();
    await expect(carrRow).toBeVisible({ timeout: 20_000 });

    // Change the picker's group, then apply a search, before leaving.
    await page.locator("#sector-population-group").selectOption("us_sector_industrials");
    await expect(page).toHaveURL(/prophetPopulationGroup=us_sector_industrials/);
    await page.locator("#sector-population-q").fill("CA");
    await page.locator("#sector-population-q").press("Enter");
    await expect(page).toHaveURL(/prophetPopulationQ=CA/);
    await expect(page.getByRole("row", { name: /CARR/ }).first()).toBeVisible({ timeout: 20_000 });

    const restored = async () => {
      await expect(page.getByRole("row", { name: /CARR/ }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("#sector-population-group")).toHaveValue("us_sector_industrials");
      await expect(page.locator("#sector-population-q")).toHaveValue("CA");
      await expect(page).toHaveURL(/prophetPopulationGroup=us_sector_industrials/);
      await expect(page).toHaveURL(/prophetPopulationQ=CA/);
    };

    // Return path 1: the labelled Prophet return control.
    await carrRow.getByTestId("population-row-prophet").first().click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("prophet-sector-return").click();
    await restored();

    // Return path 2: browser Back onto the same workspace address.
    await page.getByRole("row", { name: /CARR/ }).first()
      .getByTestId("population-row-prophet").first().click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await restored();
  }

  test("the picker's group and search ride the address and survive the Prophet round-trip (desktop)", async ({ page }) => {
    test.setTimeout(90_000);
    await withLang(page);
    await stubSectorWorkspace(page);
    const origin = "/discover?tab=sectors&sectorWorkspace=detail&sectorJob=research&sectorView=companies&group=us_sector_industrials";
    await page.goto(origin);
    await assertPopulationFiltersSurviveTheProphetRoundTrip(page);
  });

  test("the same round-trip at 390px, on a 44px Prophet row link", async ({ page }) => {
    test.setTimeout(90_000);
    await withLang(page);
    await stubSectorWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const origin = "/discover?tab=sectors&sectorWorkspace=detail&sectorJob=research&sectorView=companies&group=us_sector_industrials";
    await page.goto(origin);
    // m3: the row's Prophet affordance is a thumb-sized target at phone
    // width, not the 13px text line it wraps.
    const link = page.getByRole("row", { name: /CARR/ }).first()
      .getByTestId("population-row-prophet").first();
    await expect(link).toBeVisible({ timeout: 20_000 });
    const box = await link.boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
    await assertPopulationFiltersSurviveTheProphetRoundTrip(page);
  });
});
