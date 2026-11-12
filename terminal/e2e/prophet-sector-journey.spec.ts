import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import populationWire from "../lib/__tests__/fixtures/sector_population.captured.v11_page1.json";
import { nativeGenerationFixture } from "../lib/__tests__/fixtures/sectorNativeGeneration";
import { stubBoardWithCarr, stubObservationsUnavailable } from "./prophetCaseFixtures";
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

/** The REAL CARR-BULL-20261016 board row behind stubBoardWithCarr lives in
 * e2e/prophetCaseFixtures.ts (byte-for-byte from the Prophet index capture
 * the v1 member fixtures were generated from — Macro `prophet-si`
 * `site/prophet/index.json`, asof 2026-11-09; every level, date, state and
 * the thesis already public in Macro `origin/main` at
 * `site/prophet/plans/CARR-BULL-20261016.json`, verified 2026-11-11). The
 * committed fixture board is the 2026-07-07 generation and does not contain
 * this plan; the review caught the previous stub relabelling the SBUX
 * template row as CARR, which put Starbucks' levels and thesis on Carrier's
 * setup. */



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
    // The case opens with the verdict-first header and the tabs, never an
    // entry/stop/target lead: the verdict renders its designed unavailable
    // state and the entry assessment stays labeled unavailable.
    await expect(page.getByTestId("case-verdict")).toContainText("Verdict not produced");
    await expect(page.getByTestId("case-tabs")).toBeVisible();
    await expect(page.getByTestId("entry-check")).toContainText("Entry assessment unavailable");
    // The Model plan rail renders the board's own row (not a recomposed copy)
    // — and it must be CARR's OWN: id, conviction, thesis and every price
    // level below are the real 2026-11-09 row's values. A relabelled template
    // of any other plan (the old bug: SBUX's numbers on Carrier's setup)
    // fails every check from here down.
    const rail = page.getByTestId("model-plan-rail");
    await expect(rail.locator('[data-testid="geometry-rail"]')).toBeVisible();
    await expect(rail).toContainText("CARR-BULL-20261016");
    await expect(rail).toContainText("53/100"); // the SBUX template reads 42/100
    const setupText = await setup.innerText();
    // The membership shown is the one the reader is investigating: CARR sits
    // in Housing AND Industrials and Housing is memberOf[0] in the capture —
    // arriving from the Industrials population must show Industrials' own
    // group context (study card, clocks, return), never Housing's. The
    // Context tab is not open on this default view, so "Housing" can only
    // reach the screen through the wrong-membership pick (review M1).
    expect(setupText).not.toContain("Housing");
    expect(setupText).toContain(`$${(56.47).toFixed(2)}`); // entry
    expect(setupText).toContain(`$${(52.26).toFixed(2)}`); // invalidation
    expect(setupText).toContain(`$${(62.785).toFixed(2)}`); // T1
    expect(setupText).toContain(`$${(69.1).toFixed(2)}`); // T2
    // The plan's own thesis stays available behind the rail's disclosure —
    // CARR's basket clause proves the row, and the template's own markers
    // (SBUX, its price) must be absent.
    await rail.locator('[data-testid="plan-thesis"] > summary').click();
    await expect(rail).toContainText("Industrials (Equal-Weight) basket"); // CARR's own basket clause
    const railText = await rail.innerText();
    expect(railText).not.toContain("SBUX");
    expect(railText).not.toContain(`${(104.3).toFixed(2)}`);

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
    // The header names the company and reports the no-plan stance in plain
    // words; the owner's reason stays translated — not a raw code, not a
    // stance beyond what the index reports.
    await expect(page.getByTestId("case-header")).toContainText("ALLE");
    await expect(page.getByTestId("case-stance")).toContainText(/no prophet plan is open/i);
    await expect(setup).toContainText(/no plan for this symbol/i);
    // The labeled group/market study replaces the old unlabeled return pair
    // (G10): market and group are named, the company's own leg is honestly
    // not produced.
    await expect(page.getByTestId("study-card")).toContainText(/not produced in this read/i);
    // The entry rail carries the missing-terms state and no plan rail.
    await expect(page.getByTestId("entry-check")).toContainText(/current entry terms are missing/i);
    await expect(page.getByTestId("model-plan-rail")).toContainText(/no model plan is open/i);
    // The existing chart destination, and no board panel anywhere.
    await expect(page.getByTestId("prophet-sector-chart-link")).toHaveAttribute("href", /\/analysis\?symbol=ALLE/);
    await expect(setup.locator(".obs-prophet-analysis")).toHaveCount(0);
    await page.getByTestId("prophet-sector-setup-back").click();
    await expect(page.getByTestId("prophet-sector-population")).toBeVisible();
  });

  test("keyboard-only travel reaches the Setup without a pointer", async ({ page }) => {
    test.setTimeout(60_000);
    await withLang(page);
    // The developing-observation card reads the observation source; keep this
    // journey hermetic with a deterministic unavailable answer.
    await stubObservationsUnavailable(page);
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
    // The case header and its states read natively in Chinese: kicker, stance,
    // the unavailable verdict, and the four tab destinations.
    await expect(page.getByTestId("case-header")).toContainText("公司案例");
    await expect(page.getByTestId("case-stance")).toContainText("进行中的模型计划");
    await expect(page.getByTestId("case-verdict")).toContainText("未产出结论");
    await expect(page.getByTestId("case-tabs")).toContainText("研究");
    await expect(page.getByTestId("case-tabs")).toContainText("证据");
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
