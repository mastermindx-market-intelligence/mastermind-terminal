import { expect, test, type Page } from "./fixtures";
import { gzipSync } from "node:zlib";
import { expectTapTarget } from "./tapTarget";
import aaplWorkspace from "../lib/__tests__/fixtures/aapl-event-workspace.json";

const SHA = "a".repeat(64);
const drawerFixtureBody = {
  schema: "mastermind.tx/v1",
  ticker: "NVDA",
  id: "2026Q1",
  period: "Q1 FY2026",
  date: "2026-05-20",
  title: "NVIDIA Earnings Call Q1 FY2026",
  segments: [
    { speaker: "Jensen Huang", role: "Chief Executive Officer", text: "Data center demand remained broad across cloud, enterprise, and sovereign AI customers." },
    { speaker: "Colette Kress", role: "Chief Financial Officer", text: "We continue to see data center demand across our compute platforms and networking products." },
  ],
};

const metrics = (overrides: Record<string, number | null> = {}) => ({
  sentiment: 68,
  performance: 72,
  confidence: 64,
  combined: 68,
  call_positivity: 71,
  management_confidence: 66,
  analyst_criticism: 22,
  future_outlook: 74,
  revenue_growth_pct: 18.4,
  eps_growth_pct: 21.1,
  gross_margin_pct: 74.2,
  analysts_count: 12,
  questions_count: 18,
  ...overrides,
});

function event(id: string, fiscalYear: number, fiscalQuarter: number, callDate: string, summary: string) {
  const eventMetrics = metrics();
  return {
    event_id: id,
    ticker: "NVDA",
    fiscal_year: fiscalYear,
    fiscal_quarter: fiscalQuarter,
    call_date: callDate,
    summary,
    highlights: ["Data-center demand remained broad across the period."],
    positive_highlights: ["Revenue growth accelerated with broad data-center demand."],
    negative_highlights: ["Supply and deployment timing remain watch items."],
    key_quote: "We continue to see broad demand across our platform.",
    tags: ["data center", "demand"],
    metrics: eventMetrics,
    field_lineage: {
      summary: "earnings_history",
      key_quote: "earnings_history",
      metrics: Object.fromEntries(Object.keys(eventMetrics).map((key) => [key, "score_overlay"])),
      positive_highlights: ["earnings_history"],
      negative_highlights: ["earnings_history"],
      highlights: ["earnings_history"],
      tags: { "data center": "earnings_history", demand: "earnings_history" },
    },
    previous_event_deltas: metrics({ revenue_growth_pct: 2.1, eps_growth_pct: 1.6, gross_margin_pct: 0.4, questions_count: 3 }),
    sources: [
      {
        source_ref: "earnings_history",
        kind: "earnings_history",
        status: "present",
        citation_precision: "document",
        url: "https://investor.nvidia.com/earnings",
        receipt: { source_hash: SHA, source_date: callDate, record_id: `${id}-earnings` },
      },
      {
        source_ref: "score_overlay",
        kind: "score_overlay",
        status: "metadata_only",
        citation_precision: "metadata",
        url: null,
        receipt: { source_hash: "b".repeat(64), source_date: callDate, record_id: `${id}-overlay` },
      },
      {
        source_ref: "transcript",
        kind: "transcript",
        status: "present",
        citation_precision: "document",
        url: `/data/tx/NVDA/${fiscalYear}Q${fiscalQuarter}.json.gz`,
        receipt: { source_hash: "c".repeat(64), source_date: callDate, record_id: `${fiscalYear}Q${fiscalQuarter}` },
      },
    ],
    claim_citations_pending: true,
  };
}

function contextFixture() {
  const latest = event(
    "cie_d8488221fd8c710c53d6537d",
    2026,
    1,
    "2026-05-20",
    "NVIDIA reported broad platform demand, with revenue growth and gross-margin discipline remaining central to the event read-through.",
  );
  const prior = event(
    "cie_4c0410e7c4358283cf37a557",
    2025,
    4,
    "2026-02-19",
    "The preceding event established the demand and supply baseline for this quarter-over-quarter comparison.",
  );
  return {
    schema: "company_intelligence_context.v1",
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-08-01T12:00:00Z",
    generation_id: "a".repeat(24),
    company: { ticker: "NVDA", display_name: "NVIDIA Corporation", exchange: null },
    status: "ready",
    latest_event_id: latest.event_id,
    latest_event: latest,
    history: [latest, prior],
    topics: {
      timeline: [
        { tag: "data center", first_event_id: prior.event_id, last_event_id: latest.event_id, event_count: 2, status: "persistent" },
        { tag: "demand", first_event_id: latest.event_id, last_event_id: latest.event_id, event_count: 1, status: "added" },
      ],
      added: ["demand"],
      dropped: [],
      persistent: ["data center"],
    },
    source_completeness: {
      earnings_history: { status: "present", event_count: 2 },
      score_overlay: { status: "metadata_only", event_count: 2 },
      transcripts: { status: "present", event_count: 2 },
    },
    warnings: [],
    missing_sources: [],
    transport_lineage: {
      earnings_manifest: { generation_id: "b".repeat(24), sha256: "d".repeat(64) },
      tx_index: { schema: "mastermind.tx-index/v1", generation_id: "c".repeat(24), sha256: "e".repeat(64) },
      builder: "company_intelligence.v1",
    },
  };
}

function themeContextFixture() {
  return {
    schema: "company_theme_exposure.v1",
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-08-01T12:00:00Z",
    generation_id: "f".repeat(24),
    status: "partial",
    company: { ticker: "NVDA" },
    company_intelligence: {
      generation_id: "a".repeat(24),
      context_sha256: "9".repeat(64),
      latest_event_id: "cie_d8488221fd8c710c53d6537d",
      latest_event_call_date: "2026-05-20",
    },
    exposures: [{
      theme_id: "ai_infrastructure",
      name_en: "AI Infrastructure",
      name_zh: "人工智能基础设施",
      basket_id: "ai_semiconductors",
      mapping_qualifier: "proxy",
    }],
    coverage: { status: "mixed", active_basket_count: 2, mapped_basket_count: 1, unmapped_basket_count: 1 },
    theme_state: { status: "stale", as_of: "2026-07-28", sha256: "8".repeat(64) },
    warnings: ["active_membership_unmapped", "theme_state_stale"],
  };
}

function institutionalContextFixture() {
  return {
    schema: "company_institutional_context.v1",
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-08-01T12:00:00Z",
    generation_id: "7".repeat(24),
    status: "ready",
    company: { ticker: "NVDA" },
    company_intelligence: {
      generation_id: "a".repeat(24),
      context_sha256: "6".repeat(64),
      latest_event_id: "cie_d8488221fd8c710c53d6537d",
      latest_event_call_date: "2026-05-20",
    },
    period: {
      build_as_of: "2026-08-01",
      consensus_period: "2026-03-31",
      comparison_period: "2025-12-31",
      filing_window_closed_on: "2026-05-15",
      consensus_available_on: "2026-05-15",
      latest_reporting_filing_date: "2026-05-15",
    },
    coverage: {
      configured_manager_count: 4,
      active_manager_count: 3,
      closed_manager_count: 1,
      reporting_manager_count: 3,
      missing_manager_count: 0,
      comparison_reporting_manager_count: 3,
      comparison_missing_manager_count: 0,
      resolved_position_count: 3,
      unresolved_position_count: 0,
    },
    positions: [
      {
        manager: "alpha", manager_name: "Alpha Capital", manager_style: "quality_growth", manager_grade: "A",
        action: "add", is_current_holder: true, value_usd: 12_000_000, book_weight_pct: 2.4, shares: 40_000,
        shares_change_pct: 25, period_end: "2026-03-31", filing_date: "2026-05-14",
        snapshot: { path: "data/smart_money/alpha/2026-03-31.parquet", sha256: "1".repeat(64), bytes: 2400 },
      },
      {
        manager: "gamma", manager_name: "Gamma Investments", manager_style: "compounder", manager_grade: "A-",
        action: "hold", is_current_holder: true, value_usd: 8_000_000, book_weight_pct: 1.8, shares: 26_000,
        shares_change_pct: 2, period_end: "2026-03-31", filing_date: "2026-05-15",
        snapshot: { path: "data/smart_money/gamma/2026-03-31.parquet", sha256: "2".repeat(64), bytes: 2100 },
      },
      {
        manager: "beta", manager_name: "Beta Partners", manager_style: "value", manager_grade: "B+",
        action: "trim", is_current_holder: true, value_usd: 8_000_000, book_weight_pct: 1.2, shares: 20_000,
        shares_change_pct: -15, period_end: "2026-03-31", filing_date: "2026-05-15",
        snapshot: { path: "data/smart_money/beta/2026-03-31.parquet", sha256: "3".repeat(64), bytes: 2200 },
      },
    ],
    consensus: {
      current_holder_count: 3, buyer_count: 1, trimmer_count: 1, exit_count: 0, unknown_move_count: 0,
      total_value_usd: 28_000_000, ownership_hhi: 0.346939, max_book_weight_pct: 2.4, avg_book_weight_pct: 1.8,
    },
    trend: {
      status: "available", direction: "accumulating", eligible_period_count: 3,
      periods: [
        { period_end: "2025-09-30", available_on: "2025-11-14", reporting_manager_count: 3, missing_manager_count: 0, holder_count: 1, total_value_usd: 9_000_000, eligible: true },
        { period_end: "2025-12-31", available_on: "2026-02-17", reporting_manager_count: 3, missing_manager_count: 0, holder_count: 2, total_value_usd: 18_000_000, eligible: true },
        { period_end: "2026-03-31", available_on: "2026-05-15", reporting_manager_count: 3, missing_manager_count: 0, holder_count: 3, total_value_usd: 28_000_000, eligible: true },
      ],
    },
    warnings: [],
  };
}

async function routeThemeContext(page: Page) {
  await page.route("**/api/company-theme-context/NVDA**", async (route) => {
    await route.fulfill({ json: { ok: true, state: "partial", context: themeContextFixture() } });
  });
}

async function routeInstitutionalContext(page: Page) {
  await page.route("**/api/company-institutional-context/NVDA**", async (route) => {
    await route.fulfill({ json: { ok: true, state: "ready", context: institutionalContextFixture() } });
  });
}

async function openCompanyIntelligence(page: Page, intelligenceLabel = "Intelligence") {
  await page.route("**/api/company-intelligence/NVDA**", async (route) => {
    await route.fulfill({ json: { ok: true, state: "ready", context: contextFixture() } });
  });
  await routeThemeContext(page);
  await page.goto("/analysis?symbol=NVDA&page=intelligence");
  // This is a server-seeded deep link, not a client-side redirect from Overview.
  await expect(page.locator(".fin-tabs").getByRole("tab", { name: intelligenceLabel, exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".ci-page")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "NVIDIA Corporation" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await routeInstitutionalContext(page);
  await page.route("**/api/event-workspace/**", async (route) => {
    await route.fulfill({
      status: 404,
      json: { ok: false, state: "error", available: false, error: { code: "not_found", message: "Event workspace is not covered", retryable: false } },
    });
  });
});

async function closeEvidenceOverlay(page: Page) {
  if (await page.locator(".ci-evidence-scrim.open").isVisible()) {
    await page.locator(".ci-evidence-close").click();
    await expect(page.locator(".ci-evidence")).toHaveAttribute("aria-hidden", "true");
  }
}

async function expectNoDocumentOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
}

test("Company Intelligence keeps its context and evidence workflow responsive", async ({ page }, testInfo) => {
  await openCompanyIntelligence(page);
  await expectNoDocumentOverflow(page);
  await expect(page.getByRole("heading", { name: "Curated basket context" })).toBeVisible();
  await expect(page.locator(".ci-theme-card")).toContainText("AI Infrastructure");
  await expect(page.locator(".ci-theme-card")).toContainText("Proxy crosswalk");
  await expect(page.getByRole("heading", { name: "3 tracked managers reported a position" })).toBeVisible();
  const institutionalCard = page.locator(".ci-inst-card");
  await expect(institutionalCard).toContainText("Alpha Capital");
  await expect(institutionalCard).toContainText("HHI within this roster");
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-company-theme-context.png`), fullPage: false });
  await institutionalCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-company-institutional-context.png`), fullPage: false });

  const evidence = page.locator(".ci-evidence");
  const receipts = page.locator(".ci-receipts-button");
  const desktop = testInfo.project.name.endsWith("desktop");

  if (desktop) {
    await expect(evidence).toHaveAttribute("aria-hidden", "false");
    await expect(evidence).toHaveCSS("position", "sticky");
    await page.getByRole("button", { name: "Close evidence inspector" }).click();
    await expect(evidence).toHaveAttribute("aria-hidden", "true");
    await expect(evidence).toHaveAttribute("inert", "");
    await expect(evidence).not.toBeVisible();
    await expect(receipts).toBeFocused();
  } else {
    await expect(evidence).toHaveAttribute("aria-hidden", "true");
    await expect(evidence).toHaveAttribute("inert", "");
    await expect(evidence).toHaveCSS("position", "fixed");
  }

  // The closed mobile sheet remains in the DOM for its transform animation, so
  // this is a real tab-order assertion rather than merely checking aria-hidden.
  if (!desktop) {
    await receipts.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Ask Mastermind" })).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await page.locator(".ci-evidence").evaluate((rail) => !rail.contains(document.activeElement))).toBe(true);
  }

  await receipts.click();
  await expect(evidence).toHaveAttribute("aria-hidden", "false");
  if (!desktop) {
    await expect(page.locator(".ci-evidence-scrim")).toHaveClass(/open/);
    const close = page.locator(".ci-evidence-close");
    await expect(close).toBeFocused();
    const focusables = evidence.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
    const focusableCount = await focusables.count();
    // The inspector intentionally includes more than Close when the selected
    // receipt has a source link. Walk to the actual final control, then prove
    // the trap wraps forward (and backward) instead of assuming one Tab wraps.
    expect(focusableCount).toBeGreaterThan(1);
    for (let index = 1; index < focusableCount; index += 1) await page.keyboard.press("Tab");
    await expect(focusables.nth(focusableCount - 1)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(focusables.nth(focusableCount - 1)).toBeFocused();
  }
  if (desktop) {
    await page.getByRole("button", { name: "Close evidence inspector" }).click();
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(evidence).toHaveAttribute("aria-hidden", "true");
  await expect(evidence).toHaveAttribute("inert", "");
  await expect(receipts).toBeFocused();

  // The lens bar is its own roving tablist inside the Intelligence page; this
  // assertion protects it from being swallowed by the outer Financials tabs.
  const topics = page.locator(".ci-lenses").getByRole("tab", { name: "Topics" });
  // Start from the deliberately taller transcript workspace so both Terminal
  // hosts (inner .fin-body scroller and document scroller) exercise the same
  // sticky-lens reveal contract.
  await page.locator(".ci-lenses").getByRole("tab").nth(1).click();
  await expect(page.locator(".ci-ts-explorer")).toBeVisible();
  await page.locator(".ci-ts-explorer").evaluate((element) => {
    const inner = element.closest<HTMLElement>(".fin-body");
    element.style.minHeight = `${(inner?.clientHeight ?? window.innerHeight) + 800}px`;
  });
  await expect.poll(() => page.locator(".ci-ts-explorer").evaluate((element) => {
    const inner = element.closest<HTMLElement>(".fin-body");
    return inner ? inner.scrollHeight - inner.clientHeight : 0;
  })).toBeGreaterThan(0);
  const deepScroll = await page.evaluate(() => {
    // Multiple retained Financial panes can exist in the shell. Bind the
    // assertion to this workspace's actual scroll owner, not the first hidden
    // `.fin-body` elsewhere in the DOM.
    const explorer = document.querySelector<HTMLElement>(".ci-ts-explorer");
    const inner = explorer?.closest<HTMLElement>(".fin-body") ?? null;
    if (inner) {
      // Production uses smooth scrolling. Disable animation for this exact
      // geometry assertion so the coordinate is sampled after, not during,
      // the synthetic deep scroll.
      inner.style.scrollBehavior = "auto";
      inner.scrollTop = inner.scrollHeight;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    return { inner: inner?.scrollTop ?? 0, windowY: window.scrollY };
  });
  expect(Math.max(deepScroll.inner, deepScroll.windowY)).toBeGreaterThan(0);
  await topics.click();
  await expect(topics).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ci-panel-topics")).toContainText("What entered, persisted, or dropped");
  await expect.poll(() => page.evaluate(() => {
    const lenses = document.querySelector(".ci-lenses")?.getBoundingClientRect();
    const workspace = document.querySelector(".ci-workspace")?.getBoundingClientRect();
    return !!lenses && !!workspace && workspace.top >= lenses.bottom - 1;
  })).toBe(true);
  const afterReveal = await page.evaluate(() => ({
    inner: document.querySelector<HTMLElement>(".ci-ts-explorer")?.closest<HTMLElement>(".fin-body")?.scrollTop ?? 0,
    windowY: window.scrollY,
  }));
  expect(afterReveal.inner < deepScroll.inner || afterReveal.windowY < deepScroll.windowY).toBe(true);
  await expectNoDocumentOverflow(page);

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-company-intelligence.png`),
    fullPage: false,
  });
});

test("literal transcript search and compare use the local revision-verified BFF", async ({ page }, testInfo) => {
  await page.route("**/data/tx/NVDA/2026Q1.json.gz", async (route) => {
    await route.fulfill({ body: gzipSync(JSON.stringify(drawerFixtureBody)), headers: { "content-type": "application/gzip" } });
  });
  await openCompanyIntelligence(page);
  const transcript = page.locator(".ci-lenses").getByRole("tab").nth(1);
  await transcript.click();
  await expect(page.locator(".ci-ts-hero h3")).toBeVisible();

  const search = page.locator(".ci-ts-search");
  await search.locator("input").fill("quantum bicycle");
  await search.locator(".btn").click();
  await expect(page.locator(".ci-ts-state.empty strong")).toHaveText("No exact matches");
  await expect(page.locator(".ci-ts-state.empty p")).toHaveText("The selected events were checked for this literal phrase. No segment contains it; no expansion, paraphrase, or inferred relevance was used.");

  await search.locator("input").fill("data center");
  await search.locator(".btn").click();
  await expect(page.locator(".ci-ts-results .ci-ts-span")).toHaveCount(2);
  await expect(page.locator(".ci-ts-results mark").first()).toHaveText("Data center");
  await expect(page.locator(".ci-ts-hero")).toContainText("Find exact words across calls");

  const settings = page.locator('button[aria-label="Settings"]');
  const sourceButton = page.locator(".ci-ts-results .ci-ts-span-actions button").first();
  await sourceButton.scrollIntoViewIfNeeded();
  const scrollBeforeDrawer = await page.evaluate(() => ({
    inner: document.querySelector<HTMLElement>(".fin-body")?.scrollTop ?? 0,
    windowX: window.scrollX,
    windowY: window.scrollY,
  }));
  await sourceButton.click();
  const drawerRoot = page.locator(".fin-tx-modal-root");
  await expect(page.locator(".fin-tx-drawer")).toBeVisible();
  await expect(page.locator('.fin-tx-seg[data-segment="1"]')).toBeFocused();
  expect(await drawerRoot.evaluate((element) => element.parentElement === document.body)).toBe(true);
  expect(Number(await page.locator(".fin-tx-drawer").evaluate((element) => getComputedStyle(element).zIndex))).toBeGreaterThanOrEqual(241);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  expect(await settings.count()).toBeGreaterThan(0);
  expect(await settings.evaluateAll((buttons) => buttons.every((button) => !!button.closest("[inert]")))).toBe(true);
  await settings.first().evaluate((button) => (button as HTMLElement).focus());
  expect(await page.evaluate(() => !!document.activeElement?.closest(".fin-tx-drawer"))).toBe(true);
  await page.getByRole("button", { name: "Close transcript" }).click();
  await expect(page.locator(".fin-tx-drawer")).toHaveCount(0);
  await expect(sourceButton).toBeFocused();
  expect(await settings.evaluateAll((buttons) => buttons.every((button) => !button.closest("[inert]")))).toBe(true);
  await expect.poll(() => page.evaluate(() => ({
    inner: document.querySelector<HTMLElement>(".fin-body")?.scrollTop ?? 0,
    windowX: window.scrollX,
    windowY: window.scrollY,
  }))).toEqual(scrollBeforeDrawer);

  const receipt = page.locator(".ci-ts-results .ci-ts-span-actions button").nth(1);
  await receipt.scrollIntoViewIfNeeded();
  const scrollBeforeReceipt = await page.evaluate(() => ({
    inner: document.querySelector<HTMLElement>(".fin-body")?.scrollTop ?? 0,
    windowX: window.scrollX,
    windowY: window.scrollY,
  }));
  await receipt.click();
  const receiptWrap = page.locator(".ci-ts-dialog-wrap");
  const receiptClose = page.getByRole("button", { name: "Close source receipt" }).last();
  await expect(page.locator(".ci-ts-dialog")).toBeVisible();
  await expect(receiptClose).toBeFocused();
  await expect(page.locator(".ci-ts-dialog code").nth(1)).toHaveText(/^[a-f0-9]{64}$/);
  expect(await receiptWrap.evaluate((element) => element.parentElement === document.body)).toBe(true);
  expect(Number(await receiptWrap.evaluate((element) => getComputedStyle(element).zIndex))).toBeGreaterThanOrEqual(260);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");

  expect(await settings.count()).toBeGreaterThan(0);
  expect(await settings.evaluateAll((buttons) => buttons.every((button) => !!button.closest("[inert]")))).toBe(true);
  expect(await settings.first().evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return hit === button || button.contains(hit);
  })).toBe(false);
  await settings.first().evaluate((button) => (button as HTMLElement).focus());
  expect(await page.evaluate(() => !!document.activeElement?.closest(".ci-ts-dialog"))).toBe(true);
  await expect(page.locator(".acs-overlay.open")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator(".ci-ts-dialog")).toHaveCount(0);
  await expect(receipt).toBeFocused();
  expect(await settings.evaluateAll((buttons) => buttons.every((button) => !button.closest("[inert]")))).toBe(true);
  await expect.poll(() => page.evaluate(() => ({
    inner: document.querySelector<HTMLElement>(".fin-body")?.scrollTop ?? 0,
    windowX: window.scrollX,
    windowY: window.scrollY,
  }))).toEqual(scrollBeforeReceipt);

  await page.locator(".ci-ts-compare-controls > .btn").click();
  await expect(page.locator(".ci-ts-compare-grid")).toBeVisible();
  await expect(page.locator(".ci-ts-compare-col")).toHaveCount(2);
  await expectNoDocumentOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`transcript-search-compare-${testInfo.project.name}.png`), fullPage: false });
});

test("editing a transcript query invalidates an older in-flight result", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop race contract is sufficient");
  let releaseResponse!: () => void;
  let markRequested!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const requestSeen = new Promise<void>((resolve) => { markRequested = resolve; });
  await page.route("**/api/company-source-search/NVDA?**", async (route) => {
    markRequested();
    await responseGate;
    await route.fulfill({
      json: {
        schema: "mastermind.company-source-search/v1",
        state: "ready",
        ticker: "NVDA",
        query: "data center",
        searched_event_ids: ["cie_d8488221fd8c710c53d6537d"],
        match_count_by_event: { cie_d8488221fd8c710c53d6537d: 1 },
        count_capped_event_ids: [],
        truncated: false,
        corpus_revision: "txroot-race-20260801",
        spans: [{
          span_id: `txs1_${"f".repeat(64)}`,
          event_id: "cie_d8488221fd8c710c53d6537d",
          transcript_id: "2026Q1",
          ticker: "NVDA",
          document_sha256: "c".repeat(64),
          segment_index: 0,
          start_byte: 0,
          end_byte: 11,
          segment_text_sha256: "d".repeat(64),
          speaker: "Jensen Huang",
          role: "Chief Executive Officer",
          section: "prepared",
          excerpt: "Data center demand remained broad.",
          matched_text: "Data center",
          receipt: {
            revision_id: "txroot-race-20260801",
            document_sha256: "c".repeat(64),
            indexed_at: "2026-08-01T12:00:00Z",
            source_label: "Committed Mastermind transcript archive",
            source_url: "/data/tx/NVDA/2026Q1.json.gz",
            verification: "verified",
          },
        }],
      },
    });
  });

  await openCompanyIntelligence(page);
  await page.locator(".ci-lenses").getByRole("tab").nth(1).click();
  const search = page.locator(".ci-ts-search");
  await search.locator("input").fill("data center");
  await search.locator(".btn").click();
  await requestSeen;
  await expect(search.locator(".btn")).toHaveText("Searching…");
  await search.locator("input").fill("quantum bicycle");
  releaseResponse();
  await expect(search.locator(".btn")).toHaveText("Search exact phrase");
  await expect(page.locator(".ci-ts-state")).toHaveCount(0);
  await expect(page.locator(".ci-ts-results")).toHaveCount(0);
});

test("Analysis symbol URLs preserve valid market identifiers and refuse malformed ones", async ({ page }) => {
  const requested: string[] = [];
  await page.route("**/api/company-intelligence/**", async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: { ok: true, state: "ready", context: contextFixture() } });
  });

  await page.goto("/analysis?symbol=BRK.B&page=intelligence");
  await expect(page.locator(".analysis-context-identity strong")).toHaveText("BRK.B");
  await expect.poll(() => requested.some((path) => path.endsWith("/BRK.B"))).toBe(true);

  requested.length = 0;
  await page.getByLabel("Change symbol").fill("../NVDA");
  await page.getByLabel("Change symbol").press("Enter");
  await expect(page.locator(".analysis-invalid-state")).toBeVisible();
  await expect(page.locator(".analysis-invalid-state")).toContainText("not substituted with NVDA");
  await page.waitForTimeout(200);
  expect(requested).toEqual([]);

  await page.goto(`/analysis?symbol=${encodeURIComponent("../NVDA")}&page=intelligence`);
  await expect(page.locator(".analysis-invalid-state")).toBeVisible();
  await expect(page.locator(".analysis-invalid-state")).toContainText("not substituted with NVDA");
  await page.waitForTimeout(200);
  expect(requested).toEqual([]);
});

test("workspace Escape remains in analysis", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop interaction contract is sufficient");
  await openCompanyIntelligence(page);

  // In workspace mode Escape is not a Back-to-chart shortcut.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/analysis\?symbol=NVDA/);
  await expect(page.locator(".ci-page")).toBeVisible();
});

test("evidence receipts follow producer field lineage instead of guessing a source", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop lineage contract is sufficient");
  await openCompanyIntelligence(page);
  const sourceRow = page.locator(".ci-receipt-row").filter({ hasText: "Source family" });

  await page.locator(".ci-stance-copy").click();
  await expect(sourceRow).toContainText("Earnings history");
  await expect(page.locator(".ci-evidence-note")).toContainText("normalized field is attributed");
  await expect(page.locator(".ci-evidence-note")).not.toContainText("pinned to the complete event document");

  await page.locator(".ci-metric").filter({ hasText: "Revenue growth" }).click();
  await expect(sourceRow).toContainText("Event analysis");
  await expect(page.locator(".ci-evidence-derived")).toContainText("DERIVED COMPARISON");
  await expect(page.locator(".ci-evidence-note")).toContainText("not attributed to this source alone");
});

test("theme context stays pinned to the latest event and makes its receipts inspectable", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop semantic flow is sufficient");
  await openCompanyIntelligence(page);
  await page.getByLabel("Select company event").selectOption({ label: "Q4 FY2025 · 2026-02-19" });
  await expect(page.locator(".ci-theme-boundary")).toContainText("Pinned to the latest reported event");
  await page.locator(".ci-theme-boundary").getByRole("button", { name: "Use latest event" }).click();
  await expect(page.getByRole("heading", { name: "Curated basket context" })).toBeVisible();
  const themeReceipts = page.getByRole("button", { name: "View receipts" }).last();
  await expectTapTarget(themeReceipts, { height: 40 });
  await themeReceipts.click();
  await expect(page.locator(".ci-theme-receipts-panel")).toContainText("Latest event pin");
  await expect(page.locator(".ci-theme-receipts-panel")).toContainText("Context only");
});

test("current-event authority survives a theme-sidecar outage", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop failure-boundary contract is sufficient");
  await page.route("**/api/company-intelligence/NVDA**", async (route) => {
    await route.fulfill({ json: { ok: true, state: "ready", context: contextFixture() } });
  });
  await page.route("**/api/company-theme-context/NVDA**", async (route) => {
    await route.fulfill({
      status: 503,
      json: { ok: false, state: "error", error: { code: "upstream_unavailable", message: "opaque server failure", retryable: true } },
    });
  });
  await page.goto("/analysis?symbol=NVDA&page=intelligence");
  await expect(page.getByRole("heading", { name: "Verified theme context unavailable" })).toBeVisible();
  await expect(page.locator(".ci-theme-unavailable")).not.toContainText("opaque server failure");
  await page.getByLabel("Select company event").selectOption({ label: "Q4 FY2025 · 2026-02-19" });
  await expect(page.locator(".ci-theme-boundary")).toContainText("Q4 FY2025 is historical");
  await page.locator(".ci-theme-boundary").getByRole("button", { name: "Use latest event" }).click();
  await expect(page.getByLabel("Select company event")).toHaveValue("cie_d8488221fd8c710c53d6537d");
});

test("institutional context preserves point-in-time boundaries and receipt provenance", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop provenance flow is sufficient");
  await openCompanyIntelligence(page);
  const card = page.locator(".ci-inst-card");
  await expect(card).toContainText("13F · reported with filing lag");
  await expect(card).toContainText("$28M");
  await expect(card).toContainText("Accumulating");
  const provenance = card.getByRole("button", { name: "View provenance" });
  await expectTapTarget(provenance, { height: 40 });
  await provenance.click();
  await expect(page.locator(".ci-inst-receipts-panel")).toContainText("Company-context receipt");
  await expect(page.locator(".ci-inst-receipts-panel")).toContainText("Context only");

  await page.getByLabel("Select company event").selectOption({ label: "Q4 FY2025 · 2026-02-19" });
  const boundary = page.locator(".ci-inst-boundary");
  await expect(boundary).toContainText("today's filing set is not mixed into that older record");
  await expect(boundary).not.toContainText("Alpha Capital");
  await boundary.getByRole("button", { name: "Use latest event" }).click();
  await expect(page.getByRole("heading", { name: "3 tracked managers reported a position" })).toBeVisible();
});

test("a lagging theme sidecar is quarantined instead of relabelling the latest event", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop lineage contract is sufficient");
  await page.route("**/api/company-intelligence/NVDA**", async (route) => {
    await route.fulfill({ json: { ok: true, state: "ready", context: contextFixture() } });
  });
  const lagging = themeContextFixture();
  lagging.company_intelligence.generation_id = "7".repeat(24);
  lagging.company_intelligence.latest_event_id = "cie_4c0410e7c4358283cf37a557";
  await page.route("**/api/company-theme-context/NVDA**", async (route) => {
    await route.fulfill({ json: { ok: true, state: "partial", context: lagging } });
  });
  await page.goto("/analysis?symbol=NVDA&page=intelligence");
  await expect(page.getByRole("heading", { name: "Theme context is refreshing" })).toBeVisible();
  await expect(page.locator(".ci-theme-card")).not.toContainText("AI Infrastructure");
});

test("general highlights are not relabelled as Constructive without explicit positive lineage", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop semantic-label contract is sufficient");
  const fixture = contextFixture();
  fixture.latest_event.positive_highlights = [];
  fixture.latest_event.field_lineage.positive_highlights = [];
  await page.route("**/api/company-intelligence/NVDA**", async (route) => {
    await route.fulfill({ json: { ok: true, state: "ready", context: fixture } });
  });
  await page.goto("/analysis?symbol=NVDA&page=intelligence");
  const constructive = page.locator(".ci-change-columns > div").first();
  await expect(constructive).toContainText("no explicitly constructive highlight");
  await expect(constructive.locator(".ci-change-row")).toHaveCount(0);
});

test("Ask Mastermind hands off the current analysis ticker before opening a mounted Brain or routes to its Terminal host", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop interaction contract is sufficient");
  await page.addInitScript(() => {
    const brainWindow = window as Window & {
      MMBrain?: { open: () => void };
      MM_BRAIN_CFG?: { symbol?: () => string };
    };
    // Simulates a singleton left behind by Terminal AAPL before the client
    // navigates to /analysis?symbol=NVDA.
    brainWindow.MM_BRAIN_CFG = { symbol: () => "AAPL" };
    brainWindow.MMBrain = {
      open: () => {
        document.documentElement.dataset.brainOpened = "true";
        document.documentElement.dataset.brainSymbol = brainWindow.MM_BRAIN_CFG?.symbol?.() ?? "";
      },
    };
  });
  await openCompanyIntelligence(page);
  await page.getByRole("button", { name: "Ask Mastermind" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.brainOpened)).toBe("true");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.brainSymbol)).toBe("NVDA");

  await page.evaluate(() => { delete (window as Window & { MMBrain?: unknown }).MMBrain; });
  const terminalUrl = page.waitForURL((url) => url.pathname === "/terminal" && url.searchParams.get("symbol") === "NVDA" && url.searchParams.get("ai") === "1");
  await page.getByRole("button", { name: "Ask Mastermind" }).click();
  await terminalUrl;
});

test("Company Intelligence preserves its mobile workflow in Chinese", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("mobile"), "one mobile bilingual contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await page.route("**/api/company-intelligence/NVDA**", async (route) => {
    await route.fulfill({ json: { ok: true, state: "ready", context: contextFixture() } });
  });
  await routeThemeContext(page);
  await page.goto("/analysis?symbol=NVDA&page=intelligence");
  await expect(page.locator(".fin-tabs").getByRole("tab", { name: "公司情报", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".ci-hero").getByRole("button", { name: "查看凭证" })).toBeVisible();
  await expect(page.getByRole("button", { name: "询问 Mastermind" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "策展篮子背景" })).toBeVisible();
  await expect(page.locator(".ci-theme-card")).toContainText("代理映射");
  await expect(page.locator(".ci-theme-footer")).toContainText("已过期");
  await expect(page.locator(".ci-theme-footer")).not.toContainText("stale");
  await expect(page.getByRole("heading", { name: "3 家追踪管理人申报持仓" })).toBeVisible();
  await expect(page.locator(".ci-inst-card")).toContainText("仅限该名册的 HHI");
  await expectNoDocumentOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("mobile-company-intelligence-zh.png"),
    fullPage: false,
  });
});

test("transcript search copy switches cleanly between English and Chinese", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("mobile"), "one mobile bilingual interaction contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await openCompanyIntelligence(page, "公司情报");
  await page.locator(".ci-lenses").getByRole("tab", { name: "电话会", exact: true }).click();
  await expect(page.locator(".ci-ts-hero h3")).toHaveText("在电话会中找到准确出处");
  const search = page.locator(".ci-ts-search");
  await expect(search.getByRole("button", { name: "搜索准确短语" })).toBeVisible();
  await search.locator("input").fill("quantum bicycle");
  await search.getByRole("button", { name: "搜索准确短语" }).click();
  await expect(page.locator(".ci-ts-state.empty strong")).toHaveText("未找到精确命中");
  await expect(page.locator(".ci-ts-state.empty p")).toHaveText("已在选定事件中进行精确字面匹配；没有段落包含该短语。系统没有扩展、改写或推断关联内容。");
  await expectNoDocumentOverflow(page);
});

const AAPL_EVENT_ID = "evt_cik0000320193_2026q3_results";
const AAPL_GENERATION = "f709a0a6ec514282d5769e7d";

function aaplWorkspacePayload(overrides: Record<string, unknown> = {}) {
  const { state, ...workspaceOverrides } = overrides;
  const workspace = { ...aaplWorkspace, ...workspaceOverrides } as typeof aaplWorkspace & { generation_id: string; lifecycle: { state: string } };
  return {
    ok: true,
    state: typeof state === "string" ? state : "ready",
    available: true,
    event_id: AAPL_EVENT_ID,
    workspace,
    authority: "context_only",
    is_context_only: true,
    display_only: true,
    receipt: {
      generation_id: workspace.generation_id,
      workspace_sha256: "a".repeat(64),
      marker_sha256: "b".repeat(64),
      workspace_url: `https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev/company_intelligence/event_workspaces/generations/${workspace.generation_id}/workspaces/${AAPL_EVENT_ID}.json`,
    },
  };
}

function aaplOverlayContext() {
  const overlay = structuredClone(contextFixture());
  overlay.company.ticker = "AAPL";
  overlay.company.display_name = "Apple Inc.";
  overlay.latest_event.ticker = "AAPL";
  overlay.latest_event.fiscal_year = 2026;
  overlay.latest_event.fiscal_quarter = 3;
  overlay.latest_event.call_date = "2026-07-30";
  overlay.latest_event.summary = "Apple beats consensus after 14 analyst questions and a clear earnings miss recovery.";
  overlay.latest_event.metrics.questions_count = 14;
  overlay.latest_event.field_lineage.metrics.questions_count = "score_overlay";
  overlay.history = overlay.history.map((row) => (
    row.event_id === overlay.latest_event.event_id ? { ...overlay.latest_event } : { ...row, ticker: "AAPL" }
  ));
  return overlay;
}

async function openAaplWorkspace(page: Page, payload = aaplWorkspacePayload(), options: { v1?: "not_found" | "park" | "overlay" } = {}) {
  let releaseV1 = () => {};
  await page.unroute("**/api/event-workspace/**");
  await page.route("**/api/event-workspace/AAPL**", async (route) => {
    await route.fulfill({ json: payload });
  });
  if (options.v1 === "park") {
    const parked = new Promise<void>((resolve) => {
      releaseV1 = resolve;
    });
    await page.route("**/api/company-intelligence/AAPL**", async (route) => {
      await parked;
      await route.fulfill({
        status: 404,
        json: { ok: false, state: "error", error: { code: "not_found", message: "Company intelligence is not covered", retryable: false } },
      });
    });
  } else if (options.v1 === "overlay") {
    await page.route("**/api/company-intelligence/AAPL**", async (route) => {
      await route.fulfill({ json: { ok: true, state: "ready", context: aaplOverlayContext() } });
    });
    await page.route("**/api/company-theme-context/AAPL**", async (route) => {
      await route.fulfill({ json: { ok: true, state: "partial", context: { ...themeContextFixture(), company: { ticker: "AAPL" } } } });
    });
    await page.route("**/api/company-institutional-context/AAPL**", async (route) => {
      await route.fulfill({ json: { ok: true, state: "ready", context: { ...institutionalContextFixture(), company: { ticker: "AAPL" } } } });
    });
  } else {
    await page.route("**/api/company-intelligence/AAPL**", async (route) => {
      await route.fulfill({
        status: 404,
        json: { ok: false, state: "error", error: { code: "not_found", message: "Company intelligence is not covered", retryable: false } },
      });
    });
  }
  if (options.v1 !== "overlay") {
    await page.route("**/api/company-theme-context/AAPL**", async (route) => {
      await route.fulfill({
        status: 404,
        json: { ok: false, state: "error", error: { code: "not_found", message: "Theme context is not covered", retryable: false } },
      });
    });
    await page.route("**/api/company-institutional-context/AAPL**", async (route) => {
      await route.fulfill({
        status: 404,
        json: { ok: false, state: "error", error: { code: "not_found", message: "Institutional context is not covered", retryable: false } },
      });
    });
  }
  await page.goto("/analysis?symbol=AAPL&page=intelligence");
  await expect(page.locator(".ci-page")).toBeVisible({ timeout: 15_000 });
  return { releaseV1 };
}

test("AAPL intelligence opens the verified FY2026 Q3 event workspace", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openAaplWorkspace(page);
  const root = page.locator(".ci-page");
  await expect(root).toHaveAttribute("data-ci-plane", "event_workspace.v1");
  await expect(root).toHaveAttribute("data-ci-event-id", AAPL_EVENT_ID);
  await expect(root).toHaveAttribute("data-ci-generation-id", AAPL_GENERATION);
  await expect(root).toHaveAttribute("data-ci-transcript-id", "2026Q3");
  await expect(page.locator("[data-ci-glance-title]")).toContainText("Q3 FY2026");
  await expect(page.locator("[data-ci-glance-title]")).toContainText("Jul");
  await expect(page.locator(".ci-glance-lede")).toContainText("AAPL · Q3 FY2026 · 30 Jul");
  await expect(page.locator(".ci-brief")).toContainText("$109.4B");
  await expect(page.locator(".ci-brief")).toContainText("+16%");
  await expect(page.locator(".ci-brief")).toContainText("9–11%");
  await expect(page.locator(".ci-brief")).toContainText("100-year flood");
  await expect(page.locator(".ci-page")).not.toContainText(/\bbeats?\b/i);
  await expect(page.locator(".ci-page")).not.toContainText(/\bmisses?\b/i);
  await expect(page.locator(".ci-honest")).toContainText("Unavailable / unstructured");
  await expect(page.locator(".ci-honest")).not.toContainText("14");
  await expect(page.locator(".ci-honest")).toContainText("unlicensed");
  await expect(page.locator(".ci-honest")).toContainText("absent");
  await expect(page.locator(".ci-honest")).toContainText("not joined");
  await expect(page.locator(".ci-theme-card")).toHaveCount(0);
  await expect(page.locator(".ci-inst-card")).toHaveCount(0);
  await expect(page.locator(".ci-page")).not.toContainText("Current event");
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-aapl-brief.png`), fullPage: false });

  await page.getByRole("button", { name: "Revenue $109.4B · +16%" }).click();
  await expect(page.locator(".ci-receipt-card")).toHaveAttribute("data-ci-receipt-state", "byte_replayed");
  await expect(page.locator(".ci-evidence")).toContainText("Byte-replayed");
  await expect(page.locator(".ci-evidence")).toContainText("109,417");
  await expect(page.locator(".ci-evidence-note")).toContainText("producer-issued receipt");
  await expect(page.locator(".ci-evidence-note")).toContainText("did not recompute");
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-aapl-revenue-receipt.png`), fullPage: false });

  await closeEvidenceOverlay(page);
  await page.getByRole("button", { name: /Q4 revenue growth/ }).click();
  await expect(page.locator(".ci-evidence")).toContainText("9%-11%");
  await expect(page.locator(".ci-receipt-card")).toHaveAttribute("data-ci-receipt-state", "byte_replayed");

  await closeEvidenceOverlay(page);
  await page.locator(".ci-lenses").getByRole("tab", { name: "Results" }).click();
  await expect(page.locator("#ci-panel-results")).toContainText("No beat/miss");
  await expect(page.locator("#ci-panel-results")).toContainText("$109.4B");
  const typedAbsences = page.locator('[data-ci-results-region="typed-absences"]');
  const coverageStates = page.locator('[data-ci-results-region="coverage-states"]');
  await expect(typedAbsences).toContainText("TYPED ABSENCES");
  await expect(typedAbsences).toContainText("Analyst questions");
  await expect(typedAbsences).toContainText("Consensus");
  await expect(typedAbsences).toContainText("Slides");
  await expect(typedAbsences).not.toContainText("0000320193-26-000018");
  await expect(typedAbsences).not.toContainText("not joined");
  await expect(coverageStates).toContainText("COVERAGE STATES");
  await expect(coverageStates).toContainText("not joined");
  await expect(coverageStates).not.toContainText("TYPED ABSENCES");
  await expect(coverageStates).not.toContainText("0000320193-26-000018");
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-aapl-results.png`), fullPage: false });

  await closeEvidenceOverlay(page);
  await page.locator(".ci-lenses").getByRole("tab", { name: "Sources" }).click();
  await expect(page.locator("[data-ci-source-kind='issuer_release']")).toContainText("8-K / Exhibit 99.1");
  await expect(page.locator("[data-ci-source-kind='transcript']")).toContainText("2026Q3");
  await expect(page.locator("[data-ci-source-kind='issuer_release']")).toContainText("0000320193-26-000018");
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-aapl-sources.png`), fullPage: false });

  await closeEvidenceOverlay(page);
  await page.locator(".ci-lenses").getByRole("tab", { name: "Transcript" }).click();
  await expect(page.locator("#ci-panel-transcript")).toContainText(AAPL_EVENT_ID);
  await expect(page.locator("#ci-panel-transcript")).toContainText("AAPL/2026Q3");
  await expect(page.locator("#ci-panel-transcript")).toContainText("2026Q3");
  await expectNoDocumentOverflow(page);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-aapl-event-workspace.png`), fullPage: false });
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-aapl-transcript.png`), fullPage: false });
});

test("AAPL workspace correction advances generation without changing event identity", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop correction contract is sufficient");
  const corrected = "aaaaaaaaaaaaaaaaaaaaaaaa";
  await openAaplWorkspace(page);
  await expect(page.locator(".ci-page")).toHaveAttribute("data-ci-generation-id", AAPL_GENERATION);
  await page.unroute("**/api/event-workspace/AAPL**");
  await page.route("**/api/event-workspace/AAPL**", async (route) => {
    await route.fulfill({
      json: aaplWorkspacePayload({
        generation_id: corrected,
        lifecycle: { ...(aaplWorkspace as { lifecycle: object }).lifecycle, state: "corrected" },
      }),
    });
  });
  await page.reload();
  await expect(page.locator(".ci-page")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".ci-page")).toHaveAttribute("data-ci-event-id", AAPL_EVENT_ID);
  await expect(page.locator(".ci-page")).toHaveAttribute("data-ci-generation-id", corrected);
  await expect(page.locator(".ci-page")).not.toHaveAttribute("data-ci-generation-id", AAPL_GENERATION);
  await expect(page.locator(".ci-hero")).toContainText("Corrected");
});

test("AAPL workspace remains usable in Chinese without overflow", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("mobile"), "one mobile bilingual contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await openAaplWorkspace(page);
  await expect(page.locator(".ci-lenses").getByRole("tab", { name: "简报" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".ci-lenses").getByRole("tab", { name: "业绩" })).toBeVisible();
  await expect(page.getByRole("button", { name: "询问 Mastermind" })).toBeVisible();
  await expect(page.locator(".ci-honest")).toContainText("暂无结构化计数");
  await expect(page.locator(".ci-honest")).not.toContainText("14");
  const close = page.locator(".ci-evidence-close");
  await page.getByRole("button", { name: "查看凭证" }).click();
  await expect(page.locator(".ci-evidence")).toHaveAttribute("aria-hidden", "false");
  await expectTapTarget(close, { height: 44 });
  await closeEvidenceOverlay(page);
  await page.getByRole("button", { name: /营收/ }).click();
  await expect(page.locator(".ci-evidence-note")).toContainText("生产者凭证");
  await expect(page.locator(".ci-evidence-note")).toContainText("并未根据文档字节重新计算");
  await expectTapTarget(close, { height: 44 });
  await expectNoDocumentOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("mobile-aapl-event-workspace-zh.png"), fullPage: false });
});

test("AAPL last-verified state is visibly stale, not a live current event", async ({ page }, testInfo) => {
  await openAaplWorkspace(page, aaplWorkspacePayload({ state: "stale" }));
  const root = page.locator(".ci-page");
  await expect(root).toHaveAttribute("data-ci-freshness", "stale");
  await expect(page.locator(".ci-live-dot")).toHaveClass(/stale/);
  await expect(page.locator(".ci-hero")).toContainText("Last verified");
  await expect(page.locator("[data-ci-stale-banner]")).toContainText("Last verified · upstream temporarily unavailable");
  await expect(page.locator(".ci-page")).not.toContainText("Current event");
  await expect(page.locator(".ci-brief")).toContainText("$109.4B");
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-aapl-stale.png`), fullPage: false });
});

test("AAPL v2 brief renders while v1 is still parked", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop independence contract is sufficient");
  const { releaseV1 } = await openAaplWorkspace(page, aaplWorkspacePayload(), { v1: "park" });
  try {
    await expect(page.locator(".ci-page")).toHaveAttribute("data-ci-plane", "event_workspace.v1");
    await expect(page.locator(".ci-brief")).toContainText("$109.4B");
    await expect(page.locator(".ci-brief")).toContainText("9–11%");
    await expect(page.locator(".ci-theme-card")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-aapl-v2-without-v1.png`), fullPage: false });
  } finally {
    releaseV1();
  }
});

test("AAPL v1 score overlay cannot populate current Brief, Results, or Sources", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("desktop"), "one desktop overlay isolation contract is sufficient");
  await openAaplWorkspace(page, aaplWorkspacePayload(), { v1: "overlay" });
  await expect(page.locator(".ci-brief")).toContainText("$109.4B");
  await page.locator(".ci-lenses").getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#ci-panel-history")).toContainText("cie_d8488221fd8c710c53d6537d");
  await page.locator(".ci-lenses").getByRole("tab", { name: "Brief" }).click();
  await expect(page.locator(".ci-brief")).toContainText("$109.4B");
  await expect(page.locator(".ci-brief")).not.toContainText("14");
  await expect(page.locator(".ci-brief")).not.toContainText(/beats?/i);
  await expect(page.locator(".ci-honest")).not.toContainText("14");
  await expect(page.locator(".ci-theme-card")).toHaveCount(0);
  await expect(page.locator(".ci-inst-card")).toHaveCount(0);
  await page.locator(".ci-lenses").getByRole("tab", { name: "Results" }).click();
  await expect(page.locator("#ci-panel-results")).toContainText("$109.4B");
  await expect(page.locator("#ci-panel-results")).not.toContainText("14");
  await page.locator(".ci-lenses").getByRole("tab", { name: "Sources" }).click();
  await expect(page.locator("#ci-panel-sources")).toContainText("8-K / Exhibit 99.1");
  await expect(page.locator("#ci-panel-sources")).not.toContainText("14");
  await expect(page.locator("#ci-panel-sources")).not.toContainText(/score overlay/i);
});

