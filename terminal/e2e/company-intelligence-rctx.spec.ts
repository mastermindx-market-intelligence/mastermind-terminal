import { expect, test } from "@playwright/test";

const SHA = "a".repeat(64);
const METRICS = {
  sentiment: null, performance: null, confidence: null, combined: null,
  call_positivity: null, management_confidence: null, analyst_criticism: null,
  future_outlook: null, revenue_growth_pct: null, eps_growth_pct: null,
  gross_margin_pct: null, analysts_count: null, questions_count: null,
};

function companyContext() {
  const event = {
    event_id: "cie_rctx_2026q1",
    ticker: "NVDA",
    fiscal_year: 2026,
    fiscal_quarter: 1,
    call_date: "2026-05-20",
    summary: null,
    highlights: [],
    positive_highlights: [],
    negative_highlights: [],
    key_quote: null,
    tags: [],
    metrics: METRICS,
    field_lineage: {
      summary: null,
      key_quote: null,
      metrics: METRICS,
      positive_highlights: [],
      negative_highlights: [],
      highlights: [],
      tags: {},
    },
    previous_event_deltas: METRICS,
    sources: [{
      source_ref: "transcript",
      kind: "transcript",
      status: "present",
      citation_precision: "document",
      url: "/data/tx/NVDA/2026Q1.json.gz",
      receipt: { source_hash: SHA, source_date: "2026-05-20", record_id: "2026Q1" },
    }],
    claim_citations_pending: true,
  };
  return {
    schema: "company_intelligence_context.v1",
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-08-30T00:00:00Z",
    generation_id: "b".repeat(24),
    company: { ticker: "NVDA", display_name: "NVIDIA Corporation", exchange: null },
    status: "ready",
    latest_event_id: event.event_id,
    latest_event: event,
    history: [event],
    topics: { timeline: [], added: [], dropped: [], persistent: [] },
    source_completeness: {
      earnings_history: { status: "missing", event_count: 0 },
      score_overlay: { status: "missing", event_count: 0 },
      transcripts: { status: "present", event_count: 1 },
    },
    warnings: [],
    missing_sources: [],
    transport_lineage: {
      earnings_manifest: { generation_id: "c".repeat(24), sha256: "d".repeat(64) },
      tx_index: { schema: "mastermind.tx-index/v1", generation_id: "e".repeat(24), sha256: "f".repeat(64) },
      builder: "company_intelligence.v1",
    },
  };
}

const sourceSpan = {
  span_id: `txs1_${"1".repeat(64)}`,
  ticker: "NVDA",
  event_id: "cie_rctx_2026q1",
  transcript_id: "2026Q1",
  document_sha256: "2".repeat(64),
  segment_index: 7,
  start_byte: 144,
  end_byte: 173,
  segment_text_sha256: "3".repeat(64),
  speaker: "Verified Speaker",
  role: "Chief Executive Officer",
  section: "prepared",
  excerpt: "Exact source context is attached.",
  matched_text: "Exact source",
  receipt: {
    revision_id: "rctx_revision_2026q1",
    document_sha256: "2".repeat(64),
    indexed_at: "2026-08-30T00:00:00Z",
    source_label: "Verified fixture transcript",
    source_url: "/data/tx/NVDA/2026Q1.json.gz",
    verification: "verified",
  },
};

test("an exact source span is consumed by only the next Brain turn until explicitly re-attached", async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as Window & {
      MMBrain?: { open: () => void };
      MM_BRAIN_CFG?: { symbol?: () => string; getCompanySourceSpan?: () => unknown };
    };
    host.MM_BRAIN_CFG = { symbol: () => "AAPL" };
    host.MMBrain = {
      open: () => {
        document.documentElement.dataset.rctxOpened = "true";
      },
    };
  });
  await page.route("**/api/event-workspace/**", async (route) => route.fulfill({
    status: 404,
    json: { ok: false, state: "error", available: false, error: { code: "not_found", message: "No event workspace", retryable: false } },
  }));
  await page.route("**/api/company-intelligence/NVDA**", async (route) => route.fulfill({ json: { ok: true, state: "ready", context: companyContext() } }));
  await page.route("**/api/company-theme-context/NVDA**", async (route) => route.fulfill({
    status: 404,
    json: { ok: false, state: "error", error: { code: "not_found", message: "No theme context", retryable: false } },
  }));
  await page.route("**/api/company-institutional-context/NVDA**", async (route) => route.fulfill({
    status: 404,
    json: { ok: false, state: "error", error: { code: "not_found", message: "No institutional context", retryable: false } },
  }));
  await page.route("**/api/company-source-search/NVDA?**", async (route) => route.fulfill({
    json: {
      schema: "mastermind.company-source-search/v1",
      state: "ready",
      ticker: "NVDA",
      query: "Exact source",
      spans: [sourceSpan],
      searched_event_ids: ["cie_rctx_2026q1"],
      match_count_by_event: { cie_rctx_2026q1: 1 },
      count_capped_event_ids: [],
      truncated: false,
      corpus_revision: "rctx_revision_2026q1",
    },
  }));

  await page.goto("/analysis?symbol=NVDA&page=intelligence");
  await page.locator(".ci-lenses").getByRole("tab").nth(1).click();
  const search = page.locator(".ci-ts-search");
  await search.locator("input").fill("Exact source");
  await search.locator(".btn").click();
  await expect(page.locator(".ci-ts-results .ci-ts-span")).toHaveCount(1);

  await page.getByRole("button", { name: "Attach to Mastermind" }).click();
  const attachment = page.getByTestId("company-source-context-attachment");
  await expect(attachment).toContainText("Exact source attached");
  await attachment.getByRole("button", { name: "Ask Mastermind with source" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.rctxOpened)).toBe("true");

  const firstTurnSource = await page.evaluate(() => {
    const host = window as Window & { MM_BRAIN_CFG?: { getCompanySourceSpan?: () => unknown } };
    return host.MM_BRAIN_CFG?.getCompanySourceSpan?.() ?? null;
  });
  expect(firstTurnSource).toEqual({
    schema: "mastermind.research-context-ref/v1",
    kind: "company_source_span",
    authority: "context_only",
    ticker: "NVDA",
    event_id: "cie_rctx_2026q1",
    transcript_id: "2026Q1",
    revision_id: "rctx_revision_2026q1",
    document_sha256: "2".repeat(64),
    segment_index: 7,
    start_byte: 144,
    end_byte: 173,
    segment_text_sha256: "3".repeat(64),
    span_id: `txs1_${"1".repeat(64)}`,
  });
  await expect(attachment).toHaveCount(0);
  expect(await page.evaluate(() => {
    const host = window as Window & { MM_BRAIN_CFG?: { getCompanySourceSpan?: () => unknown } };
    return host.MM_BRAIN_CFG?.getCompanySourceSpan?.() ?? null;
  })).toBeNull();

  await page.getByRole("button", { name: "Attach to Mastermind" }).click();
  await expect(attachment).toContainText("Exact source attached");
  await attachment.getByRole("button", { name: "Ask Mastermind with source" }).click();
  expect(await page.evaluate(() => {
    const host = window as Window & { MM_BRAIN_CFG?: { getCompanySourceSpan?: () => unknown } };
    return host.MM_BRAIN_CFG?.getCompanySourceSpan?.() ?? null;
  })).toEqual(firstTurnSource);
  await expect(attachment).toHaveCount(0);
});
