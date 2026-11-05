import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * PP1-D — /options Exposure desk opens on the shared gamma map.
 * For every project × language, the Matrix view must mount the OptionsCompanion
 * with host="page" at the top of the desk, with the legacy dealer-hedge grid
 * hidden behind a closed named disclosure below it, with the session picker
 * and the EOD context belt beneath the map.
 */
const crops = process.env.OPTIONS_DESK_CROPS || "test-results/options-desk-map";

const beltName = (lang: "en" | "zh") =>
  lang === "zh" ? "收盘期权结构背景" : "End-of-day options structure context";

async function prepare(page: Page, lang: "en" | "zh", symbol = "SPY") {
  await page.addInitScript((locale) => {
    localStorage.setItem("mm.lang", locale);
    localStorage.removeItem("mm.optionsCompanion.v1");
    document.documentElement?.setAttribute("data-lang", locale);
  }, lang);
  // ?tab=prism deep-links to the gex (Exposure) view; the desk opens on "matrix".
  // Ruling 5: count the /api/flow?f=matrix:<ROOT> requests a single desk load issues.
  const matrixRequests: { url: string; at: number }[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (/[?&]f=matrix(?::|%3A)SPY(?:&|$)/.test(url)) {
      matrixRequests.push({ url, at: Date.now() });
    }
  });
  await page.goto(`/options?tab=prism&symbol=${symbol}`);
  // The Exposure desk is the page's first .obs-ambient. Wait for it.
  await page.locator(".obs-ambient").first().waitFor({ timeout: 30_000 });
  // The fixture leaves FLOW_FIXTURE=1, so the desk is entitled. The companion is
  // mounted after a tick — wait for the shared gamma map.
  await page.waitForTimeout(1500);
  (page as unknown as { __matrixRequests?: typeof matrixRequests }).__matrixRequests = matrixRequests;
}

async function firstPublishedCell(page: Page) {
  // Click the first published (non-missing, non-zero) cell so the inspector + selected-strip
  // become visible for the geometry assertions.
  const cell = page.locator("[data-options-grid] button[aria-label*='2026'][data-value]:not([data-value='missing']):not([data-value='0'])").first();
  await expect(cell).toBeVisible({ timeout: 20_000 });
  await cell.click();
}

const measureHelpers = (page: Page) => page.evaluate(() => {
  const round = (n: number) => Math.round(n * 100) / 100;
  const rectOf = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: round(r.x), y: round(r.y), top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), width: round(r.width), height: round(r.height) };
  };
  const clientBox = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const left = r.left + (parseFloat(s.borderLeftWidth) || 0);
    const top = r.top + (parseFloat(s.borderTopWidth) || 0);
    return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
  };
  const intersect = (a: { left: number; top: number; right: number; bottom: number } | null, b: { left: number; top: number; right: number; bottom: number } | null) => {
    if (!a || !b) return null;
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  const clipsOf = (el: Element) => {
    const clips: { left: number; top: number; right: number; bottom: number }[] = [];
    let n: Element | null = el.parentElement;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(`${s.overflowX}${s.overflowY}`)) clips.push(clientBox(n));
      n = n.parentElement;
    }
    return clips;
  };
  const wrapper = document.querySelector("[data-testid='gex-matrix-view']");
  const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const companion = document.querySelector("[data-options-companion][data-options-host='page']");
  const mapWrap = document.querySelector("[data-testid='gex-matrix-map']");
  const disclosure = document.querySelector("[data-testid='gex-legacy-hedge-matrix']");
  const grid = document.querySelector("[data-options-grid]") as HTMLElement | null;
  // The cells are sticky, not their thead ancestor. Count only unobscured rows.
  const theadBottom = Math.max(0, ...[...grid?.querySelectorAll("thead th") ?? []]
    .map((cell) => cell.getBoundingClientRect().bottom));
  let gridRegion = grid ? intersect(viewport, clientBox(grid)) : null;
  if (wrapper) gridRegion = intersect(gridRegion, clientBox(wrapper));
  if (grid) for (const clip of clipsOf(grid)) gridRegion = intersect(gridRegion, clip);
  const rowRegion = gridRegion ? { ...gridRegion, top: Math.max(gridRegion.top, theadBottom) } : null;
  const inside = (region: { left: number; top: number; right: number; bottom: number } | null, r: DOMRect, full: boolean) => {
    if (!region || r.height < 1 || r.width < 1) return false;
    const tol = 1;
    const vertically = r.top >= region.top - tol && r.bottom <= region.bottom + tol;
    if (!vertically) return false;
    return full ? r.left >= region.left - tol && r.right <= region.right + tol : r.right > region.left + tol && r.left < region.right - tol;
  };
  const rows = grid ? [...grid.querySelectorAll("tbody tr")] : [];
  const cols = grid ? [...grid.querySelectorAll("thead th")].slice(1) : [];
  const visibleStrikeRows = rows.filter((row) => inside(rowRegion, row.getBoundingClientRect(), false)).length;
  const visibleExpiryColumns = cols.filter((col) => inside(gridRegion, col.getBoundingClientRect(), true)).length;
  const rowHeights = rows.map((row) => round(row.getBoundingClientRect().height));
  const mapGrid = document.querySelector("[data-testid='options-map-grid']");
  const stripEl = document.querySelector("[data-testid='options-selected-summary']");
  const inspector = document.querySelector("[data-options-inspector]");
  const roller = document.querySelector("[data-testid='roller-more']");
  const nav = roller?.closest("[data-testid='roller-strip']");
  const navRect = nav && window.innerWidth <= 640 ? nav.getBoundingClientRect() : null;
  const bottomNavTop = navRect && navRect.height > 0 ? round(navRect.top) : null;
  const fullyVisible = (el: Element | null) => {
    if (!el) return false;
    let region = { ...viewport, bottom: bottomNavTop == null ? viewport.bottom : Math.min(viewport.bottom, bottomNavTop) };
    for (const c of clipsOf(el)) region = intersect(region, c)!;
    return inside(region, el.getBoundingClientRect(), true);
  };
  const inspect = document.querySelector('[data-testid="options-inspect-node"]');
  const session = document.querySelector('[data-options-session]');
  const scope = document.querySelector('[data-options-scope]');
  const total = document.querySelector('[data-options-total]');
  const ladderRegion = document.querySelector(".obs-gexdesk-ladder-region");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    companion: rectOf(companion),
    mapWrap: rectOf(mapWrap),
    mapGrid: rectOf(mapGrid),
    inspector: rectOf(inspector),
    selectedStrip: rectOf(stripEl),
    stripFullyVisible: fullyVisible(stripEl),
    inspectFullyVisible: fullyVisible(inspect), inspect: rectOf(inspect),
    inspectPaint: inspect ? { foreground: getComputedStyle(inspect).color, background: getComputedStyle(inspect).backgroundColor, disabled: (inspect as HTMLButtonElement).disabled } : null,
    inspectHit: (() => { if (!inspect) return false; const r = inspect.getBoundingClientRect(); const hit = document.elementFromPoint((r.left+r.right)/2, (r.top+r.bottom)/2); return hit === inspect || !!hit && inspect.contains(hit); })(),
    sessionVisible: fullyVisible(session), scopeVisible: fullyVisible(scope), totalVisible: fullyVisible(total),
    documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
    wrapperScrollTop: wrapper?.scrollTop ?? 0,
    visibleStrikeRows,
    visibleExpiryColumns,
    actualStrikeRows: rows.length,
    actualExpiryColumns: cols.length,
    rowHeights,
    disclosure: rectOf(disclosure),
    disclosureOpen: !!(disclosure as HTMLDetailsElement | null)?.open,
    ladderRegion: rectOf(ladderRegion),
    ladderRegionClientHeight: ladderRegion ? (ladderRegion as HTMLElement).clientHeight : null,
    ladderRegionScrollHeight: ladderRegion ? (ladderRegion as HTMLElement).scrollHeight : null,
    wrapperClientHeight: wrapper ? (wrapper as HTMLElement).clientHeight : null,
    wrapperScrollHeight: wrapper ? (wrapper as HTMLElement).scrollHeight : null,
    documentScrollHeight: document.documentElement.scrollHeight,
    bottomNavTop,
    controlsStyle: (() => { const el = document.querySelector('.obs-gexdesk-map-first .obs-gexdesk-controls'); if (!el) return null; const s = getComputedStyle(el); return { padding: s.padding, gap: s.gap, flexWrap: s.flexWrap, tickerWidth: (el.querySelector('input') as HTMLElement | null)?.getBoundingClientRect().width }; })(),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});

for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] desk map hierarchy, disclosure, geometry and history`, async ({ page }, info) => {
    test.setTimeout(150_000);
    const project = info.project.name;
    mkdirSync(crops, { recursive: true });
    await prepare(page, lang);

    // a. companion visible inside gex-matrix-view, page host, root = SPY
    const wrapper = page.locator("[data-testid='gex-matrix-view']");
    await expect(wrapper).toBeVisible({ timeout: 15000 });
    const companion = page.locator("[data-options-companion][data-options-host='page']");
    await expect(companion).toBeVisible({ timeout: 15000 });
    await expect(companion).toHaveAttribute("data-options-root", "SPY");

    await expect(companion.locator("[data-options-grid] table")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(250);
    const initial = await measureHelpers(page);
    expect(initial.documentScrollTop).toBe(0);
    expect(initial.wrapperScrollTop).toBe(0);
    writeFileSync(`${crops}/pp1d-${project}-${lang}-initial-dark.json`, JSON.stringify({ sourceHead: process.env.OPTIONS_SOURCE_HEAD, sourceDiffSha256: process.env.OPTIONS_SOURCE_DIFF_SHA256, ...initial }, null, 2));
    await page.screenshot({ path: `${crops}/pp1d-${project}-${lang}-initial-dark.png`, fullPage: false });

    // b. DOM order inside wrapper: companion first, then disclosure, then session picker, then belt
    const order = await page.evaluate(() => {
      const wrapper = document.querySelector("[data-testid='gex-matrix-view']");
      if (!wrapper) return null;
      const mapEl = wrapper.querySelector("[data-testid='gex-matrix-map']");
      const companionEl = wrapper.querySelector("[data-options-companion][data-options-host='page']");
      const disclosureEl = wrapper.querySelector("[data-testid='gex-legacy-hedge-matrix']");
      const beltEl = wrapper.querySelector("section[aria-label='End-of-day options structure context'], section[aria-label='收盘期权结构背景']");
      const picker = wrapper.querySelector("select[aria-label='Archived session'], select[aria-label='已归档交易日']");
      const cmp = (a: Element | null, b: Element | null) => {
        if (!a || !b) return -1;
        const pos = a.compareDocumentPosition(b);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
      };
      return {
        mapFirst: cmp(mapEl, companionEl),
        dlFirst: cmp(disclosureEl, companionEl),
        beltFirst: cmp(beltEl, companionEl),
        pickerFirst: cmp(picker, companionEl),
        companionFirst: cmp(companionEl, disclosureEl),
        disclosureFirst: cmp(disclosureEl, picker),
        pickerFirstOfBelt: cmp(picker, beltEl),
      };
    });
    expect(order).not.toBeNull();
    expect(order!.mapFirst, "gex-matrix-map precedes companion").toBe(1);
    expect(order!.dlFirst, "disclosure precedes companion (so disclosure is below companion)").toBe(-1);
    expect(order!.beltFirst, "belt is below companion").toBe(-1);
    expect(order!.pickerFirst, "session picker is below companion").toBe(-1);
    expect(order!.companionFirst, "companion is above disclosure").toBe(1);
    expect(order!.disclosureFirst, "disclosure is above picker").toBe(1);
    expect(order!.pickerFirstOfBelt, "picker is above belt").toBe(1);

    // Nothing of GexHistory or the belt precedes the companion anywhere in the document.
    const historyAboveCompanion = await page.evaluate(() => {
      const c = document.querySelector("[data-options-companion][data-options-host='page']");
      if (!c) return -1;
      // Search outside the wrapper too — the spec requires NO part of GexHistory or belt
      // precedes the companion anywhere.
      const historyPickers = Array.from(document.querySelectorAll("select[aria-label='Archived session'], select[aria-label='已归档交易日']"));
      const beltSections = Array.from(document.querySelectorAll("section[aria-label='End-of-day options structure context'], section[aria-label='收盘期权结构背景']"));
      for (const el of [...historyPickers, ...beltSections]) {
        const pos = el.compareDocumentPosition(c);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return 1;
      }
      return -1;
    });
    expect(historyAboveCompanion, "history + belt come after companion").toBe(-1);

    // c. disclosure closed, summary reads the ruling-2 text, no Strike table.
    const disclosure = page.locator("[data-testid='gex-legacy-hedge-matrix']");
    await expect(disclosure).toBeVisible();
    const expectedSummary = lang === "zh" ? "做市商对冲网格（行权价 × 到期日）" : "Dealer hedge grid by strike and expiry";
    await expect(disclosure.locator("summary")).toContainText(expectedSummary);
    const tableBefore = page.locator("[data-testid='gex-legacy-hedge-matrix'] table");
    expect(await tableBefore.count()).toBe(0);
    // Open it.
    await disclosure.locator("summary").click();
    const table = page.locator("[data-testid='gex-legacy-hedge-matrix'] table");
    await expect(table).toBeVisible();
    const rows = await page.locator("[data-testid='gex-legacy-hedge-matrix'] table tbody tr").count();
    expect(rows).toBeGreaterThanOrEqual(20);
    // Close it again.
    await disclosure.locator("summary").click();
    await expect(page.locator("[data-testid='gex-legacy-hedge-matrix'] table")).toHaveCount(0);

    // Select a cell before geometry assertions so the strip is on.
    await firstPublishedCell(page);
    // Wait for strip and inspector to settle.
    await page.locator("[data-testid='options-selected-summary']").waitFor({ timeout: 15000 });

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((next) => document.documentElement.setAttribute("data-theme", next), theme);
      await page.waitForTimeout(250);
      await page.evaluate(() => {
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
        const wrapper = document.querySelector('[data-testid="gex-matrix-view"]');
        if (wrapper) wrapper.scrollTop = 0;
      });
      const m = await measureHelpers(page);
      expect.soft(m.documentScrollTop, "initial document scrollTop is zero").toBe(0);
      expect.soft(m.wrapperScrollTop, "initial wrapper scrollTop is zero").toBe(0);
      expect.soft(m.sessionVisible, "initial source session visible").toBe(true);
      expect.soft(m.scopeVisible, "initial applied scope visible").toBe(true);
      expect.soft(m.totalVisible, "initial scope total visible, including withheld total").toBe(true);
      expect.soft(m.stripFullyVisible, "selected strip clears ALL clips").toBe(true);
      expect.soft(m.inspectFullyVisible, "Inspect node clears ALL clips").toBe(true);
      expect.soft(m.inspectHit, "Inspect node actual center is hit-testable").toBe(true);
      // Geometry per project — `expect.soft` so a 2d geometry failure does not mask
      // the 2e/2f/2g assertions after the loop. The 2d failure feeds run 2 sizing;
      // the 2e/2f/2g assertions are defects of F and must still be visible.
      if (project === "desktop") {
        expect.soft(m.documentScrollHeight, "documentScrollHeight ≤ viewport").toBeLessThanOrEqual(m.viewport.height + 1);
        expect.soft(m.selectedStrip!.bottom, "selectedStrip bottom ≤ 900").toBeLessThanOrEqual(900);
        expect.soft(m.visibleStrikeRows, "visibleStrikeRows ≥ 7").toBeGreaterThanOrEqual(7);
        expect.soft(m.visibleExpiryColumns, "visibleExpiryColumns ≥ 3").toBeGreaterThanOrEqual(3);
        expect.soft(m.inspector!.left, "inspector left ≥ mapGrid.right - 1").toBeGreaterThanOrEqual(m.mapGrid!.right - 1);
        const overlapTop = Math.max(m.mapGrid!.top, m.inspector!.top);
        const overlapBottom = Math.min(m.mapGrid!.bottom, m.inspector!.bottom);
        expect.soft(overlapBottom - overlapTop, "inspector vertically overlaps map").toBeGreaterThan(0);
        expect.soft(m.inspector!.width, "inspector width 288..320").toBeGreaterThanOrEqual(288);
        expect.soft(m.inspector!.width, "inspector width 288..320").toBeLessThanOrEqual(320);
        expect.soft(m.horizontalOverflow, "no horizontal overflow").toBe(false);
      }
      if (project === "tablet") {
        const rowHeights = m.rowHeights as number[];
        const tallEnough = (m.visibleStrikeRows as number) >= 6 && rowHeights.length >= 6 && rowHeights.every((h) => h >= 44);
        expect.soft(tallEnough, "≥ 6 rows × height ≥ 44").toBe(true);
        expect.soft(m.visibleExpiryColumns, "≥ 3 expiry columns").toBeGreaterThanOrEqual(3);
        expect.soft(m.inspector!.left, "inspector left ≥ mapGrid.right - 1").toBeGreaterThanOrEqual(m.mapGrid!.right - 1);
        const overlapTop = Math.max(m.mapGrid!.top, m.inspector!.top);
        const overlapBottom = Math.min(m.mapGrid!.bottom, m.inspector!.bottom);
        expect.soft(overlapBottom - overlapTop, "inspector vertically overlaps map").toBeGreaterThan(0);
        expect.soft(m.ladderRegionClientHeight, "no clip on ladderRegion").toBeGreaterThanOrEqual((m.ladderRegionScrollHeight ?? 0) - 1);
        expect.soft(m.wrapperClientHeight, "no clip on wrapper").toBeGreaterThanOrEqual((m.wrapperScrollHeight ?? 0) - 1);
        expect.soft(m.horizontalOverflow, "no horizontal overflow").toBe(false);
      }
      if (project === "mobile") {
        expect.soft(m.visibleStrikeRows, "≥ 7 visible rows at initial scrollTop zero").toBeGreaterThanOrEqual(7);
        expect.soft(m.rowHeights.every((h) => h >= 44), "rows ≥ 44px").toBe(true);
        expect.soft(m.visibleExpiryColumns, "≥ 3 expiry columns").toBeGreaterThanOrEqual(3);
        if (m.bottomNavTop != null) {
          expect.soft(m.selectedStrip!.bottom, "strip clears bottom nav").toBeLessThanOrEqual(m.bottomNavTop + 1);
        }
        const gridRect = await page.locator("[data-options-grid]").first().evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        });
        expect.soft(gridRect.right, "grid scroll box right ≤ 390").toBeLessThanOrEqual(390 + 1);
        expect.soft(m.ladderRegionClientHeight, "no clip on ladderRegion").toBeGreaterThanOrEqual((m.ladderRegionScrollHeight ?? 0) - 1);
        expect.soft(m.wrapperClientHeight, "no clip on wrapper").toBeGreaterThanOrEqual((m.wrapperScrollHeight ?? 0) - 1);
        expect.soft(m.horizontalOverflow, "no horizontal overflow").toBe(false);

      }

      // h. write the geometry JSON + screenshot for offline review.
      mkdirSync(crops, { recursive: true });
      writeFileSync(`${crops}/pp1d-${project}-${lang}-${theme}.json`, JSON.stringify({
        project, lang, theme, themeActivation: theme === "light" ? "isolated html data-theme compatibility probe" : "supported dark UI", sourceHead: process.env.OPTIONS_SOURCE_HEAD, sourceDiffSha256: process.env.OPTIONS_SOURCE_DIFF_SHA256, ...m,
      }, null, 2));
      await page.screenshot({ path: `${crops}/pp1d-${project}-${lang}-${theme}.png`, fullPage: false });
    }
    await page.getByTestId("options-inspect-node").click();
    await expect(page.locator("[data-options-inspector] [tabindex='-1']")).toBeFocused();

    // e. history still works: scroll picker in, pick oldest, expect gex-archived-matrix.
    await page.evaluate(() => {
      const picker = document.querySelector("select[aria-label='Archived session'], select[aria-label='已归档交易日']") as HTMLElement | null;
      picker?.scrollIntoView();
    });
    const picker = page.locator("select[aria-label='Archived session'], select[aria-label='已归档交易日']");
    await expect(picker).toBeVisible();
    const options = await picker.locator("option").allInnerTexts();
    // Pick the oldest (last) non-empty date value.
    let oldest: string | null = null;
    for (let i = options.length - 1; i >= 0; i--) {
      const v = (await picker.locator("option").nth(i).getAttribute("value")) ?? "";
      if (v && v !== "live") { oldest = v; break; }
    }
    expect(oldest).not.toBeNull();
    await picker.selectOption(oldest!);
    await expect(page.locator("[data-testid='gex-archived-matrix']")).toBeVisible({ timeout: 10000 });
    await expect(picker).toBeVisible();
    // Return to live.
    await picker.selectOption("");
    await expect(page.locator("[data-options-companion][data-options-host='page']")).toBeVisible();

    // f. belt region reachable and non-zero height.
    const beltRegion = page.getByRole("region", { name: beltName(lang), exact: true });
    await beltRegion.scrollIntoViewIfNeeded();
    const beltRect = await beltRegion.boundingBox();
    expect(beltRect).not.toBeNull();
    expect(beltRect!.height).toBeGreaterThan(0);

    // g. request count of ruling 5: ≥ 1.
    const matrixRequests = (page as unknown as { __matrixRequests?: { url: string; at: number }[] }).__matrixRequests ?? [];
    expect(matrixRequests.length).toBeGreaterThanOrEqual(1);
  });
}

// Reproduces the real published 93-row shape that exposed half-row centering.
// This isolated response is test data; live acceptance still uses genuine snapshots.
for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] 93-row map opens on complete rows below the sticky header`, async ({ page }, info) => {
    const strikes = Array.from({ length: 93 }, (_, i) => 732 + i);
    const expiries = ["2026-07-10", "2026-07-13", "2026-07-17"];
    const snapshot = {
      schema: "options_structure.matrix/v1", root: "SPY", spot: 778.1,
      asof: "2026-07-11T00:05:00Z", _build_meta: { asof_date: "2026-07-10" },
      strikes, expiries,
      cells: strikes.flatMap((strike) => expiries.map((expiry) => ({ strike, expiry,
        gex: (strike - 777.5) * 1e6, call_oi: 1, put_oi: 1, call_vol: 1, put_vol: 1 }))),
    };
    await page.route(/\/api\/flow\?f=matrix(?::|%3A)SPY(?:&|$)/, (route) => route.fulfill({ json: snapshot }));
    await prepare(page, lang);
    const grid = page.locator("[data-options-grid]");
    await expect(grid.locator("tbody tr")).toHaveCount(93);
    const initial = await measureHelpers(page);
    mkdirSync(crops, { recursive: true });
    writeFileSync(`${crops}/93-row-${info.project.name}-${lang}.json`, JSON.stringify({
      sourceHead: process.env.OPTIONS_SOURCE_HEAD, sourceDiffSha256: process.env.OPTIONS_SOURCE_DIFF_SHA256, ...initial,
    }, null, 2));
    await page.screenshot({ path: `${crops}/93-row-${info.project.name}-${lang}.png`, fullPage: false });
    expect(initial.actualStrikeRows).toBe(93);
    expect(initial.visibleStrikeRows).toBeGreaterThanOrEqual(info.project.name === "tablet" ? 6 : 7);
    expect(initial.visibleExpiryColumns).toBe(3);
    expect(initial.documentScrollTop).toBe(0);
    expect(initial.wrapperScrollTop).toBe(0);
    const reference = grid.locator('[data-reference-row="true"] button').first();
    const bounds = await reference.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await expect(page.getByTestId("options-selected-summary")).toContainText("778");
    const selected = await measureHelpers(page);
    expect(selected.visibleStrikeRows).toBeGreaterThanOrEqual(info.project.name === "tablet" ? 6 : 7);
    expect(selected.inspectFullyVisible).toBe(true);
    expect(selected.documentScrollTop).toBe(0);
    expect(selected.wrapperScrollTop).toBe(0);
  });
}
