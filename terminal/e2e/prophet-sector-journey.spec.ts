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
 * value verbatim, nothing invented. The committed fixture board is the
 * 2026-07-07 generation and does not contain this plan; the review caught the
 * previous stub relabelling the SBUX template row as CARR, which put
 * Starbucks' levels and thesis on Carrier's setup. */
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
    // Overview: every group of the read (49 of them) with the coverage-honesty line.
    const picker = page.getByTestId("prophet-sector-picker");
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prophet-sector-pick-us_sector_industrials")).toContainText("Industrials");
    await expect(page.getByTestId("prophet-sector-picker-coverage")).toContainText("698 served members across 49 groups");
    await expect(page.getByTestId("prophet-sector-picker-coverage")).toContainText("outside these groups");

    // Pick Industrials → the full dated population (83 members on this read).
    await page.getByTestId("prophet-sector-pick-us_sector_industrials").click();
    await expect(page).toHaveURL(/prophetView=population&prophetGroup=us_sector_industrials/);
    const context = page.getByTestId("prophet-sector-context");
    await expect(context).toBeVisible({ timeout: 15_000 });
    // The two owners' clocks on one line; this read is mixed-basis (A1-7).
    const clocks = await page.getByTestId("prophet-sector-clocks").innerText();
    expect(clocks).toContain("2026-11-06");
    expect(clocks).toContain("2026-11-09");
    await expect(page.getByTestId("prophet-sector-verdict")).toContainText(/different sessions/i);

    const table = page.getByTestId("prophet-sector-member-table");
    await expect(table).toBeVisible();
    await expect(page.getByTestId("prophet-sector-state-CARR")).toContainText(/Open plan/i);
    await expect(page.getByTestId("prophet-sector-state-ADP")).toContainText(/Early observation/i);
    await expect(page.getByTestId("prophet-sector-state-ALLE")).toContainText(/No plan/i);
    await expect(page.getByTestId("prophet-sector-population-counts")).toContainText("83");
    // first_known is a lower bound — the "at least" wording is on the surface.
    await expect(table).toContainText("at least 2026-08-13");

    // Search filters before paging, and the address carries it.
    await page.getByTestId("prophet-sector-search").fill("CARR");
    await page.getByRole("button", { name: /^Search/ }).click();
    await expect(page).toHaveURL(/prophetQ=CARR/);
    await expect(page.getByTestId("prophet-sector-open-CARR")).toBeVisible();
    await page.getByTestId("prophet-sector-search-clear").click();
    await expect(page).not.toHaveURL(/prophetQ=/);

    // Back to the picker, then Defensives: an unserved member is visible there.
    await page.getByTestId("prophet-sector-back-picker").click();
    await expect(page).not.toHaveURL(/prophetView=population/);
    await page.getByTestId("prophet-sector-pick-defensives").click();
    await expect(page.getByTestId("prophet-sector-unserved")).toContainText("KVUE");

    // Back to Industrials → open CARR → the REAL board analysis by plan id.
    await page.getByTestId("prophet-sector-back-picker").click();
    await page.getByTestId("prophet-sector-pick-us_sector_industrials").click();
    await expect(page.getByTestId("prophet-sector-open-CARR")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-open-CARR").click();
    await expect(page).toHaveURL(/prophetView=setup&prophetSymbol=CARR&prophetPlan=CARR-BULL-20261016/);
    const setup = page.getByTestId("prophet-sector-setup");
    await expect(setup).toBeVisible({ timeout: 15_000 });
    // Both membership clocks, labeled — lower bound and roster date.
    await expect(page.getByTestId("prophet-sector-setup-membership")).toContainText("at least 2026-08-13");
    await expect(page.getByTestId("prophet-sector-setup-membership")).toContainText("Roster effective 2023-05-09");
    // AnalysisPanel renders the board's own plan body (not a recomposed copy) —
    // and the body must be CARR's OWN: asset, thesis, conviction and every
    // price level below are the real 2026-11-09 row's values. A relabelled
    // template of any other plan (the old bug: SBUX's numbers on Carrier's
    // setup) fails every check from here down.
    await expect(setup.locator(".obs-prophet-analysis").first()).toBeVisible();
    const setupText = await setup.innerText();
    expect(setupText).toContain("CARR");
    expect(setupText).toContain("conviction 53/100"); // the SBUX template reads 42/100
    expect(setupText).toContain("Industrials (Equal-Weight) basket"); // CARR's own basket clause
    expect(setupText).toContain(`$${(56.47).toFixed(2)}`); // entry
    expect(setupText).toContain(`$${(52.26).toFixed(2)}`); // invalidation
    expect(setupText).toContain(`$${(62.785).toFixed(2)}`); // T1
    expect(setupText).toContain(`$${(69.1).toFixed(2)}`); // T2
    // The template's own markers must be absent.
    expect(setupText).not.toContain("SBUX");
    expect(setupText).not.toContain(`${(104.3).toFixed(2)}`);

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
    // And the in-lane crumb returns to the population the row was opened from.
    await page.getByTestId("prophet-sector-setup-back").click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/prophetView=population/);
    await expect(page).toHaveURL(/prophetGroup=us_sector_industrials/);
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

  test("keyboard-only travel reaches the Setup without a pointer", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    await page.goto("/options?tab=prophet");
    // Land on the page, walk the tab order into the lane and through the picker.
    await page.getByTestId("prophet-lane-sector").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("prophet-sector-picker")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("prophet-sector-pick-us_sector_industrials").focus();
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
    await expect(unavailable).toContainText("not shown for this read");
    await expect(unavailable).toHaveAttribute("role", "status");
    // No table renders that could read as "this group has no members".
    await expect(page.getByTestId("prophet-sector-member-table")).toHaveCount(0);
    await expect(page.getByTestId("prophet-sector-population-empty")).toHaveCount(0);
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
      await expect(page.getByTestId("prophet-sector-context")).toBeVisible();
    }
  });

  test("Chinese readers get the same population in their language", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page, "zh");
    await page.goto("/options?tab=prophet&prophetLane=sector");
    await expect(page.getByTestId("prophet-sector-pick-us_sector_industrials")).toBeVisible({ timeout: 15_000 });
    // name_zh is populated (A2-2) and used in ZH.
    await expect(page.getByTestId("prophet-sector-pick-us_sector_industrials")).toContainText("工业（等权）");
    await page.getByTestId("prophet-sector-pick-us_sector_industrials").click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prophet-sector-population")).toContainText("预言台中的工业（等权）");
    await expect(page.getByTestId("prophet-sector-state-CARR")).toContainText("进行中计划");
    // The lower-bound wording survives translation.
    await expect(page.getByTestId("prophet-sector-member-table")).toContainText("至少 2026-08-13");
    await page.getByTestId("prophet-sector-open-CARR").click();
    await expect(page.getByTestId("prophet-sector-setup")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prophet-sector-setup")).toContainText("CARR 研究起点");
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

  test("the member row links into Prophet and the return restores the exact origin", async ({ page }) => {
    test.setTimeout(90_000);
    await withLang(page);
    // The dossier needs a decoding generation feed before it renders any view
    // (its honest no-generation state is a transport card, not the member
    // table), so this stub serves the whole sector-intelligence family the
    // same way sector-leadership-dossier.spec.ts does: the shared fixture for
    // every feed, the population capture extended with Prophet-eligible rows,
    // and a synthetic generation parent.
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
    await expect(page).toHaveURL(new RegExp(origin.replace(/[?&]/g, "\\$&")));
    await expect(page.getByRole("row", { name: /CARR/ }).first()).toBeVisible({ timeout: 20_000 });
  });
});
