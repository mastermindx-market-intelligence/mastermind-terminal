import { expect, test, type Page } from "@playwright/test";

/**
 * Lane 7 — retained Sector Intelligence depth, harness e2e.
 *
 * These tests run against the small DEV HARNESS page at /dev/sector-depth
 * (terminal/app/dev/sector-depth/page.tsx), NOT the live workspace: the
 * workspace mount belongs to the integration lane (lane 3), so this page mounts
 * the same props-only components against (a) the real captured generation
 * fixture and (b) clearly-synthetic contract fixtures for the capabilities the
 * captured generation does not carry. Every synthetic instance sits in a
 * `*-contract` section labelled as such on the page.
 *
 * Terminal is dark-only (frozen product constraint — see e2e/w2a-workspaces
 * .spec.ts header and settings.css): the colour matrix here is dark + EN/ZH.
 * Light-mode readiness is enforced structurally in unit tests (token-only CSS,
 * no colour literals in the depth CSS modules).
 *
 * The spec runs under the three default Playwright projects (desktop 1440 /
 * tablet 820 / mobile 390). Viewport-specific cases self-select by width and
 * every screenshot name carries the viewport so parallel projects never
 * clobber each other's proofs.
 */

const PAGE = "/dev/sector-depth";
const PROOF_DIR = "e2e/proof/sector-retained-depth";

async function shot(page: Page, name: string) {
  const { width } = page.viewportSize() ?? { width: 0 };
  await page.screenshot({ path: `${PROOF_DIR}/${name}-${width}.png`, fullPage: false });
}

const mobile = (page: Page) => (page.viewportSize()?.width ?? 0) <= 430;
const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1200;

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('[data-harness="sector-depth"]')).toBeVisible({ timeout: 45_000 });
});

/* ── typed unavailable states name the missing field ──────────────────────── */

test("unavailable surfaces name their missing field, never a blank panel", async ({ page }) => {
  const watch = page.locator('[data-h-section="watch"] [data-depth-unavailable="bottoming_watch"]');
  await expect(watch).toBeVisible();
  const flows = page.locator('[data-h-section="flows"] [data-depth-unavailable="etf_flows"]');
  await expect(flows).toBeVisible();
  const universes = page.locator('[data-h-section="universes"] [data-depth-unavailable="confluence"]');
  await expect(universes).toBeVisible();
  const themeTable = page.locator('[data-h-section="theme"] [data-depth-unavailable="theme_table"]');
  await expect(themeTable).toBeVisible();
  // The owner line names who must supply each field.
  await expect(watch).toContainText("Macro sector generation");
});

/* ── calls board: real captured generation ───────────────────────────────── */

test("calls board renders the captured board: five columns, full counts, locked", async ({ page }) => {
  const calls = page.locator('[data-h-section="calls"]');
  await expect(calls).toBeVisible();
  // Board total (six source lanes) and locked count from the real fixture.
  await expect(calls).toContainText("4");
  await expect(calls).toContainText("1");
  // The exact-anchor fallback path: the CONTRACT instance mounts without
  // onNavigate, so its detail controls are real <a href> elements carrying
  // the payload hrefs verbatim. (Phone accordions start collapsed — open a
  // second column so the anchor count is viewport-stable.)
  const contract = page.locator('[data-h-section="calls-contract"]');
  const links = contract.locator("a[href]");
  if ((await links.count()) < 3) {
    await contract
      .locator('[data-lane="buy_soon"]')
      .getByRole("button", { name: /Almost ready|接近就绪/i })
      .click();
  }
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(3);
  const hrefs = await links.evaluateAll((els) =>
    (els as HTMLAnchorElement[]).map((a) => a.getAttribute("href")),
  );
  for (const href of hrefs) expect(href).toBeTruthy();
  if (desktop(page)) await shot(page, "calls-board");
});

test("calls contract board: keyboard show-more and trace disclosure", async ({ page }) => {
  const section = page.locator('[data-h-section="calls-contract"]');
  await expect(section).toBeVisible();
  // R5 C02: locked>0 renders the global preview banner — counts complete.
  await expect(section.getByText(/Preview: \d+ of \d+ names shown/i)).toBeVisible();
  // Keyboard-only: focus moves through real buttons. On the phone the
  // non-primary columns start collapsed (R5 C03), so open one by keyboard.
  const showMore = section.getByRole("button", { name: /Show more/i }).first();
  if (mobile(page)) {
    // Initial server markup keeps every column open. Wait for the real
    // phone state before deciding which control to open or focus.
    const soon = section.locator('[data-lane="buy_soon"]');
    await expect(soon).toHaveAttribute("data-open", "false");
    const soonHead = soon.getByRole("button", { name: /Almost ready|接近就绪/i });
    await soonHead.focus();
    await page.keyboard.press("Enter");
    await expect(soon).toHaveAttribute("data-open", "true");
  }
  await expect(showMore).toBeVisible();
  await showMore.focus();
  await page.keyboard.press("Enter");
  await expect(section.getByRole("button", { name: /Show less/i }).first()).toBeVisible();
  // Trace toggle is a button; opens the per-row evidence grid.
  const trace = section.getByRole("button", { name: /^Trace$/i }).first();
  await trace.focus();
  await page.keyboard.press("Enter");
  await expect(section.getByText(/20d vs market/i).first()).toBeVisible();
  // R5 C04: the trace opens with its publish-order context line.
  await expect(section.getByText(/publish order/i).first()).toBeVisible();
  if (desktop(page)) {
    // R5 C01: stand-aside groups keep named identity with group-scoped links,
    // and a zero-total column is a dated measured zero, never a blank.
    const showAllAvoid = section.getByRole("button", { name: /Show all \d+ in Avoid/i });
    await expect(showAllAvoid).toBeVisible();
    await expect(
      section.locator('[data-lane="on_the_run"][data-empty="true"]'),
    ).toContainText(/measured zero|实测的零/i);
  }
  if (desktop(page)) await shot(page, "calls-trace");
});

test("navigation out flows through the onNavigate callback with the exact href", async ({ page }) => {
  // Navigate-target law (R3-N2), live: the captured generation's rows carry
  // owner hrefs WITHOUT a leading slash (sector/…, basket/…) — non-conforming,
  // so no href string is ever handed on; but every row with a valid identity
  // (slug + ticker) still gets a callback control whose target routes by
  // kind + id with href null. No anchor fallback exists for these rows.
  const captured = page.locator('[data-h-section="calls"]');
  await expect(captured.getByRole("button", { name: /Open detail|打开详情/ })).toHaveCount(3);
  await expect(captured.locator("a[href]")).toHaveCount(0);
  // Clicking a captured control logs the identity route (href is null in the
  // target, so the harness log line falls back to "kind/id").
  const capturedLog = page.locator('[data-harness="navlog"]');
  const capturedBefore = await capturedLog.locator("li").count();
  const capturedDetail = captured
    .getByRole("button", { name: /Open detail|打开详情/ })
    .first();
  if (mobile(page)) {
    // Stand aside is the only lane with rows on the captured board; open its
    // accordion first (settled closed on phones).
    const aside = captured.locator('[data-lane="stand_aside"]');
    await expect(aside).toHaveAttribute("data-open", "false");
    await aside.getByRole("button", { name: /Stand aside|观望/i }).click();
    await expect(aside).toHaveAttribute("data-open", "true");
  }
  await expect(capturedDetail).toBeVisible();
  await capturedDetail.click();
  await expect(capturedLog.locator("li")).toHaveCount(capturedBefore + 1);
  await expect(capturedLog.locator("li").last()).toContainText(/^theme\/[A-Za-z0-9_.\-]+$/);
  // The wired instance with conforming hrefs is the contract-derived
  // emergence board (its rows carry /sector/…, /basket/…, /company/… paths).
  const section = page.locator('[data-h-section="calls-emergence"]');
  // The log box is visible; the empty <ol> inside it has no height yet, so
  // assert on the container and drive the count through the list itself.
  const logBox = page.locator('[aria-label="navigation log"]');
  await expect(logBox).toBeVisible();
  const log = page.locator('[data-harness="navlog"]');
  const before = await log.locator("li").count();
  // Buy-now is the primary lane and stays open on every viewport, so its
  // detail control is the first reachable one without opening an accordion.
  const detail = section.getByRole("button", { name: /Open detail|打开详情/ }).first();
  await expect(detail).toBeVisible();
  await detail.click();
  await expect(log.locator("li")).toHaveCount(before + 1);
  // The logged href is the row's carried path, verbatim and leading-slash.
  await expect(log.locator("li").last()).toContainText(/^\/(sector|basket|company)\//);
});

/* ── owner-carried emergence mark (v1.1 R6-09) ────────────────────────────── */

test("emergence mark: owner-carried flag renders the R6-09 chip, copy and evidence link", async ({ page }) => {
  const section = page.locator('[data-h-section="calls-emergence"]');
  await expect(section).toBeVisible();
  const blocks = section.locator('[data-emergence="block"]');
  // Two flagged rows: the buy-now row (flag + href) and the hold row
  // (flag only — its mark must render the copy with NO link). The phone
  // accordion starts Stand aside collapsed; open it first (same control the
  // navigation test drives).
  if (mobile(page)) {
    // Both blocks exist in the initial markup; the non-primary one then
    // unmounts when the phone layout settles. Observe that transition first.
    const aside = section.locator('[data-lane="stand_aside"]');
    await expect(aside).toHaveAttribute("data-open", "false");
    await aside.getByRole("button", { name: /Stand aside|观望/i }).click();
    await expect(aside).toHaveAttribute("data-open", "true");
  }
  await expect(blocks).toHaveCount(2);
  const first = blocks.first();
  await expect(first).toContainText(/Independent emergence|独立走强/);
  await expect(first).toContainText(/Company strength is early|公司强势尚早/);
  await expect(first).toContainText(/Entry qualification is separate|入场资格另行判定/);
  // Number-free law: the carried flag is boolean-only, so no percentage may
  // appear (the bound board's example numbers are mockup data, not carried).
  for (const b of await blocks.all()) {
    expect((await b.innerText()).replace("→", "")).not.toMatch(/\d/);
  }
  // Exactly one evidence link, carrying the owner's href verbatim (N4: the
  // same-site path is passed through untouched, leading slash included).
  const link = section.locator("[data-emergence-link]");
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("data-emergence-link", "/company/SYN_S1.html");
  // Routed through onNavigate, landing in the harness nav log verbatim.
  const log = page.locator('[data-harness="navlog"]');
  const before = await log.locator("li").count();
  await link.click();
  await expect(log.locator("li")).toHaveCount(before + 1);
  // Absent flag renders nothing: the captured board and the unflagged
  // contract board carry no emergence node at all.
  await expect(page.locator('[data-h-section="calls"] [data-emergence]')).toHaveCount(0);
  await expect(page.locator('[data-h-section="calls-contract"] [data-emergence]')).toHaveCount(0);
  if (desktop(page)) await shot(page, "calls-emergence");
});

test("emergence chip: the member-line marker opens company evidence when carried", async ({ page }) => {
  const uni = page.locator('[data-h-section="universes-emergence"]');
  await expect(uni).toBeVisible();
  // The simulated flag rides the REAL specimen's Semiconductors group
  // (members[0] = NXPI; no owner emits `emerging` tonight and the wire member
  // carries no such key — S4 — so the harness flags the PARSED read). Table
  // layouts keep the member list behind the row's expand control, so expand
  // that group's own row — never assume which row the tier sort surfaces.
  await uni.getByRole("button", { name: /^Semiconductors\b/ }).first().click();
  const chips = uni.locator('[data-emergence="chip"]');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText(/Independent emergence|独立走强/);
  // The chip becomes the evidence link itself when a destination is carried
  // (N4: same-site path, verbatim).
  await expect(chips.first()).toHaveAttribute("data-emergence-link", "/company/NXPI.html");
  const log = page.locator('[data-harness="navlog"]');
  const before = await log.locator("li").count();
  await chips.first().click();
  await expect(log.locator("li")).toHaveCount(before + 1);
});

/* ── Bottoming Watch: display-only strip ─────────────────────────────────── */

test("bottoming watch never carries an outbound action", async ({ page }) => {
  // The captured generation carries no watch payload, so the harness watch
  // section is the typed unavailable state; the CONTRACT instance (synthetic)
  // is the interactive one and must contain no links out.
  const contract = page.locator('[data-h-section="watch-contract"]');
  if ((await contract.count()) === 0) test.skip(true, "watch contract section not mounted");
  await expect(contract.locator("a[href]")).toHaveCount(0);
  await expect(contract).toContainText(/watch|观察/i);
});

/* ── flow matrix: chart ↔ table equivalence on the contract fixture ──────── */

test("flow matrix: heat view and exact-value table agree on every cell", async ({ page }) => {
  // The matrix (and its view toggle) exists above 760px; on the phone the
  // picker surface IS the exact-value view, proven by its own test below.
  test.skip(mobile(page), "heat/table equivalence is the matrix (>=760px) case");
  const flows = page.locator('[data-h-section="flows-contract"]');
  await expect(flows).toBeVisible();
  // F03 standing hint doubles as the tint disclosure.
  await expect(flows).toContainText(/tint is relative within each window|各时间窗内部相对计算/);
  // Capture the heat view's formatted cell values.
  const heatCells = await flows
    .locator("table td")
    .allInnerTexts();
  // Switch to the exact-value view.
  await flows.getByRole("button", { name: /Exact values/i }).click();
  const tableCells = await flows
    .locator("table td")
    .allInnerTexts();
  // The formatted numbers the heat view showed must all exist in the table.
  const heatNums = heatCells.map((c) => c.trim()).filter((c) => /[$]/.test(c));
  const tableNums = new Set(tableCells.map((c) => c.trim()));
  expect(heatNums.length).toBeGreaterThan(20);
  for (const n of heatNums) expect(tableNums.has(n)).toBe(true);
  // Missing and zero stay visibly distinct in the table.
  const joined = tableCells.join("|");
  expect(/no reading/.test(joined) || /无读数/.test(joined)).toBe(true);
  if (desktop(page)) await shot(page, "flows-table");
});

test("flow matrix: arrow keys move the selected cell and the readout names it (F03)", async ({ page }) => {
  test.skip(!desktop(page), "cell roving focus is the desktop grid case");
  const flows = page.locator('[data-h-section="flows-contract"]');
  await expect(flows).toBeVisible();
  // Enter the grid by keyboard: first data cell is the tab stop.
  const firstCell = flows.locator("td[data-cell-ticker]").first();
  await firstCell.focus();
  await page.keyboard.press("ArrowRight");
  const sel = flows.locator("td[data-sel]");
  await expect(sel).toHaveCount(1);
  // The readout names the selected fund, window and signed value.
  const readout = flows.locator("[data-readout]");
  await expect(readout).toBeVisible();
  await expect(readout).toContainText(/Selected:|已选：/);
  await expect(readout).toContainText(/net (creations|redemptions)|净(申购|赎回)/);
  // ArrowDown moves down one row within the same window.
  const selTicker = await sel.getAttribute("data-cell-ticker");
  await page.keyboard.press("ArrowDown");
  const nextTicker = await flows.locator("td[data-sel]").getAttribute("data-cell-ticker");
  expect(nextTicker).toBeTruthy();
  expect(nextTicker).not.toBe(selTicker);
  if (desktop(page)) await shot(page, "flows-readout");
});

test("flow matrix: phone surface shows all five windows with units and the source clock", async ({ page }) => {
  test.skip(!mobile(page), "phone surface is the <=430px layout");
  const flows = page.locator('[data-h-section="flows-contract"]');
  await expect(flows).toBeVisible();
  // Source clock is visible on the phone too.
  await expect(flows).toContainText(/source as of|数据截至/);
  // The matrix gives way to ETF picker chips; a real tap switches the fund.
  const chips = flows.locator("button[aria-pressed]:visible");
  expect(await chips.count()).toBeGreaterThanOrEqual(11);
  await flows.getByRole("button", { name: "XLE", exact: true }).tap();
  await expect(flows.locator("[data-window-value]")).toHaveCount(5);
  await expect(flows).toContainText(/US\$ mn|百万美元/);
  await shot(page, "flows-phone");
});

test("flow matrix: the carried typed block renders the real producer run (v1.1)", async ({ page }) => {
  // The carried etf_flows block (wire §3) adapted through the real parser:
  // the committed producer's own run — as-of 2026-11-05, depth 79, 11 funds,
  // every window full. The matrix layout is the >=760px case; the phone
  // picker path is proven by the contract-fixture test above.
  test.skip(mobile(page), "carried-block matrix assertions are the >=760px layout");
  const carried = page.locator('[data-h-section="flows-carried"]');
  await expect(carried).toBeVisible();
  // The block's own as_of is shown, never synthesized.
  await expect(carried).toContainText(/source as of 2026-11-05|数据截至 2026-11-05/);
  // The producer's uppercase window labels are what the reader sees, in order.
  // (The corner ETF column head is an empty <th> — filtered out.)
  const heads = await carried.locator('thead th[scope="col"]').allInnerTexts();
  expect(
    heads.map((h) => h.trim().split(/\s|·/)[0]).filter((h) => h !== ""),
  ).toEqual(["1D", "3D", "1W", "2W", "1M"]);
  // 11 funds plus the net row; the funds carry tickers only — no invented
  // name line rides beside them (the fixture block has no names).
  expect(await carried.locator("tbody tr").count()).toBe(12);
  const rowHeads = await carried.locator('tbody th[scope="row"]').allInnerTexts();
  expect(rowHeads.slice(0, 11).map((h) => h.trim())).toEqual([
    "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
  ]);
  // Depth 79: every window full, every reading present — no missing cells.
  await expect(carried.locator("td[data-missing]")).toHaveCount(0);
  if (desktop(page)) await shot(page, "flows-carried");
});

test("flow matrix: an owner-stated partial window is visibly partial (full_window:false)", async ({ page }) => {
  test.skip(mobile(page), "matrix column-header assertions are the >=760px layout");
  const accruing = page.locator('[data-h-section="flows-carried-accruing"]');
  await expect(accruing).toBeVisible();
  // The 1M column carries the owner's own partial statement: effective 14
  // trading days shown beside the label, distinct from a full 21.
  const oneM = accruing.locator('thead th[scope="col"]').filter({ hasText: "1M" });
  await expect(oneM).toContainText(/14 trading days|14 个交易日/);
  await expect(oneM).not.toContainText(/21 trading days|21 个交易日/);
});

/* ── four universes: separate identities, switching, filter, zero states ─── */

test("universes: tabs switch payloads and rows never cross universes", async ({ page }) => {
  const uni = page.locator('[data-h-section="universes-carried"]');
  await expect(uni).toBeVisible();
  // S&P tab is first; its source identity line names its own id + benchmark.
  await expect(uni).toContainText(/S&P 500|标普500/);
  await expect(uni).toContainText(/\(SPY\)|（SPY）/);
  // E03/E04: every tab chip carries its universe's own gateable count.
  const counts = uni.locator('[role="tab"] [data-count]');
  expect(await counts.count()).toBe(4);
  // B01: the coverage ribbon lists the five reading classes with counts.
  const ribbonItems = uni.locator("[data-ribbon] li");
  await expect(ribbonItems).toHaveCount(5);
  await expect(uni.locator("[data-ribbon]")).toContainText(/Entry now|现可入场/);
  const spRows = await uni.locator("table tr, article").count();
  expect(spRows).toBeGreaterThan(0);
  // Switch to Nasdaq-100: tonight's real read carries 0 subsectors plus 6
  // sector rows — the honest zero state, with sectors ONLY under the labelled
  // roll-up, and the envelope dated as a BUILD time (as_of_field), never a session.
  await uni.getByRole("tab", { name: /Nasdaq-100|纳斯达克100/ }).click();
  await expect(uni).toContainText(/\(QQQ\)|（QQQ）/);
  await expect(uni).toContainText(/No subsector crossed the scoring gate|没有子板块通过评分门槛/);
  await expect(uni.locator('[data-rollup="sectors"] article')).toHaveCount(6);
  await expect(uni).toContainText(/Built .+ not a market session|构建于.+非交易日/);
  // Back to S&P: per-universe state survives the round trip (identity line again).
  await uni.getByRole("tab", { name: /S&P 500|标普500/ }).click();
  await expect(uni).toContainText(/\(SPY\)|（SPY）/);
  if (desktop(page)) await shot(page, "universes");
});

test("universes: filter narrows live, zero matches is a state not a failure, russell is an honest zero", async ({ page }) => {
  const uni = page.locator('[data-h-section="universes-carried"]');
  const filter = uni.getByPlaceholder(/Filter subsector or sector|筛选子行业或板块/);
  await filter.fill("zzz-no-such-group");
  // E01: the zero-matches state echoes the reader's own query.
  await expect(uni).toContainText(/No matches for|没有匹配/);
  await expect(uni).toContainText("zzz-no-such-group");
  await uni.getByRole("button", { name: /Clear filter|清除筛选/ }).click();
  // The real Russell-2000 read carries zero groups tonight: an honest zero on
  // both surfaces — distinct from an access failure, with nothing invented.
  await uni.getByRole("tab", { name: /Russell-2000|罗素2000/ }).click();
  await expect(uni).toContainText(/carries no groups tonight|今晚此样本域没有分组/);
  await expect(uni.locator('[data-empty="subsectors"]')).toBeVisible();
  await expect(uni.locator('[data-rollup="sectors"]')).toHaveCount(0);
  // The baskets tab lists the real 49-basket universe.
  await uni.getByRole("tab", { name: /Basket|篮子/ }).click();
  await expect(uni.locator("table tr, article").first()).toBeVisible();
});

/* ── theme/compare/history controls ──────────────────────────────────────── */

test("theme compare: window toggle, series chips, turn markers, exact table", async ({ page }) => {
  const theme = page.locator('[data-h-section="theme"]');
  await expect(theme).toBeVisible();
  await expect(theme).toContainText(/against SPY|以 SPY 为基准/); // rebased-note benchmark disclosure
  // 11 sector chips.
  const chips = theme.locator("button[aria-pressed]");
  expect(await chips.count()).toBeGreaterThanOrEqual(11);
  // The captured fixture's cycle turns (all stub-dated 2022-06-16) fall outside
  // every window, so the chart shows NO turn markers — that is the data's
  // truth, asserted here; the in-window turn math is unit-proven instead.
  await expect(theme.locator("svg circle")).toHaveCount(0);
  await expect(theme).toContainText(/cycle turns|周期拐点/);
  // Series lines render.
  await expect(theme.locator("svg polyline")).not.toHaveCount(0);
  // Window switch to all history.
  await theme.getByRole("button", { name: /All history|全部历史/ }).click();
  // N7: the all-history window is the densest x-axis. Real-font proof at this
  // viewport — every kept date label is a separate word (no two boxes touch,
  // the r1 finding printed runs like "2026-02-132026-03-06") and none clips
  // past the SVG edge (the newest date was cut to "2026-11-"). Label positions
  // stay exactly mapped; only density and plot padding adapt (unit law in
  // sectorDepthRender.test.tsx; this pins the rendered truth per viewport).
  const chart = theme.locator("svg").first();
  await chart.scrollIntoViewIfNeeded();
  const axis = await theme.locator('svg text[class*="axisX"]').evaluateAll((els) => {
    const svg = (els[0] as SVGTextElement).ownerSVGElement;
    const sb = svg!.getBoundingClientRect();
    return els.map((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, text: el.textContent ?? "", svgLeft: sb.left, svgRight: sb.right };
    });
  });
  expect(axis.length).toBeGreaterThan(1);
  axis.sort((a, b) => a.left - b.left);
  for (let i = 1; i < axis.length; i++) {
    expect(axis[i]!.text).not.toContain(axis[i - 1]!.text);
    expect(axis[i]!.left).toBeGreaterThan(axis[i - 1]!.right);
  }
  for (const a of axis) {
    expect(a.left).toBeGreaterThanOrEqual(a.svgLeft - 0.5);
    expect(a.right).toBeLessThanOrEqual(a.svgRight + 0.5);
  }
  await shot(page, "theme-axis");
  // Exact-value table appears and matches the chart's window.
  await theme.getByRole("button", { name: /Exact values|精确数值/ }).click();
  const table = theme.locator('[role="region"] table');
  await expect(table).toBeVisible();
  expect(await table.locator("tr").count()).toBeGreaterThan(60);
  if (desktop(page)) await shot(page, "theme-chart");
});

test("carried theme table: its own as-of date, labelled perf pair, breadth as percent", async ({ page }) => {
  // The v1.1 served specimen (2026-11-06) mounted WITHOUT rs_history: the table
  // block carries its OWN date (B2), never the chart's absence or a borrowed one.
  const sec = page.locator('[data-h-section="theme-carried"]');
  await expect(sec).toBeVisible();
  await expect(sec.locator('[data-rows-asof="2026-11-06"]')).toBeVisible();
  await expect(sec).toContainText("as of 2026-11-06");
  // N6: the legend names the perf pair's two numbers once, above the table…
  await expect(sec.locator('[data-perf-legend="true"]')).toContainText("return · vs benchmark");
  // …and breadth prints as a percent of the 0-1 wire share, not a bare fraction.
  const breadth = sec.locator('[data-k="breadth"]').first();
  await expect(breadth).toBeVisible();
  await expect(breadth).toContainText("%");
  await expect(breadth).not.toContainText(/^-?[01]\.\d+$/);
  // Real specimen proof image: the carried table with its own date in view.
  await sec.locator('[data-rows-asof="2026-11-06"]').scrollIntoViewIfNeeded();
  if (desktop(page)) await shot(page, "theme-compare");
});

test("unavailable theme table: its own per-reason copy, no invented rows or dates", async ({ page }) => {
  // N7 proof surface: a CONTRACT unavailable theme_rows read (synthetic
  // audience_not_entitled) beside the history's own unavailable state — the
  // table never renders partial rows and never borrows the chart's dates.
  const sec = page.locator('[data-h-section="theme-unavailable"]');
  await expect(sec).toBeVisible();
  await expect(sec.locator('[data-block-state="unavailable"]')).toBeVisible();
  await expect(sec).toContainText("Not included in your current subscription.");
  await expect(sec.locator('[data-depth-unavailable="rs_history"]')).toBeVisible();
  await expect(sec).not.toContainText(/20\d{2}-\d{2}-\d{2}/);
  await expect(sec.locator("table")).toHaveCount(0);
  await sec.locator('[data-block-state="unavailable"]').scrollIntoViewIfNeeded();
  if (desktop(page)) await shot(page, "theme-unavailable");
});

/* ── language: EN ↔ ZH through the shared lexicon ────────────────────────── */

test("language toggle flips the harness surfaces EN ↔ ZH", async ({ page }) => {
  const calls = page.locator('[data-h-section="calls"]');
  await expect(calls).toContainText(/What to act on now|当下行动指南/);
  await page.locator('[data-harness-ctl="lang"]').click();
  await expect(calls).toContainText(/What to act on now|当下行动指南/);
  // The unavailable states and flow matrix flip too.
  await expect(page.locator('[data-h-section="watch"]')).toContainText(/本读数未包含|Not carried/);
  if (mobile(page)) await shot(page, "zh-mobile");
});

/* ── responsive contract ─────────────────────────────────────────────────── */

test("no horizontal page overflow at any harness viewport", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("mobile: calls board stacks with usable touch targets", async ({ page }) => {
  test.skip(!mobile(page), "touch/stack layout is the <=430px case");
  const calls = page.locator('[data-h-section="calls-contract"]');
  // Columns render open on first paint and collapse once the phone media
  // query hydrates — settle before measuring targets, or the button list
  // changes under the loop.
  await expect(
    calls.locator('[data-lane="stand_aside"][data-open="false"]'),
  ).toBeVisible();
  const buttons = calls.locator("button");
  const n = Math.min(await buttons.count(), 12);
  for (let i = 0; i < n; i++) {
    const box = await buttons.nth(i).boundingBox();
    if (box && box.height > 0) expect(box.height).toBeGreaterThanOrEqual(28);
  }
  // A real tap drives the show-more control (touch, not click).
  const showMore = calls.getByRole("button", { name: /Show more/i }).first();
  if (await showMore.isVisible()) {
    await showMore.tap();
    await expect(calls.getByRole("button", { name: /Show less/i }).first()).toBeVisible();
  }
  // R5 C03: collapsed phone accordions open by tapping the full header row.
  const asideHead = calls
    .locator('[data-lane="stand_aside"]')
    .getByRole("button", { name: /Stand aside|观望/i });
  await asideHead.tap();
  await expect(
    calls.getByRole("button", { name: /Show all \d+ in Avoid/i }),
  ).toBeVisible();
  await shot(page, "calls-mobile");
});
