import { expect, test } from "@playwright/test";

const SHA = "a".repeat(64);
const BRAIN_SCRIPT_SRC = "https://www.mastermind-x.com/mm_brain.js";
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

test("the real Analysis shell hosts one-turn exact source sends in the existing Brain", async ({ page }) => {
  await page.route(BRAIN_SCRIPT_SRC, async (route) => route.fulfill({
    contentType: "application/javascript",
    body: `(() => {
      const cfg = window.MM_BRAIN_CFG;
      window.__MM_BRAIN_TEST_SENDS__ = [];
      window.MMBrain = {
        mounted: true,
        open() {
          document.documentElement.dataset.rctxOpenCount = String(
            Number(document.documentElement.dataset.rctxOpenCount || "0") + 1
          );
        },
        testSend() {
          const source = typeof cfg?.getCompanySourceSpan === "function"
            ? cfg.getCompanySourceSpan() ?? null
            : null;
          window.__MM_BRAIN_TEST_SENDS__.push(source);
          return source;
        },
      };
      document.documentElement.dataset.rctxHost = "mounted";
    })();`,
  }));
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
  await expect.poll(() => page.locator(`script[src="${BRAIN_SCRIPT_SRC}"]`).count()).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.rctxHost)).toBe("mounted");
  // Review repair 2b: a locator-based assertion (auto-retrying, no manual poll loop) right after
  // the mounted settle, reinforcing the poll above.
  await expect(page.locator(`script[src="${BRAIN_SCRIPT_SRC}"]`)).toHaveCount(1);
  expect(await page.evaluate(() => {
    const host = window as Window & { MMBrain?: { testSend?: () => unknown } };
    return host.MMBrain?.testSend?.() ?? null;
  })).toBeNull();
  await page.locator(".ci-lenses").getByRole("tab").nth(1).click();
  const search = page.locator(".ci-ts-search");
  await search.locator("input").fill("Exact source");
  await search.locator(".btn").click();
  await expect(page.locator(".ci-ts-results .ci-ts-span")).toHaveCount(1);

  await page.getByRole("button", { name: "Attach to Mastermind" }).click();
  const attachment = page.getByTestId("company-source-context-attachment");
  await expect(attachment).toContainText("Exact source attached");
  await attachment.getByRole("button", { name: "Ask Mastermind with source" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.rctxOpenCount)).toBe("1");

  const firstTurnSource = await page.evaluate(() => {
    const host = window as Window & { MMBrain?: { testSend?: () => unknown } };
    return host.MMBrain?.testSend?.() ?? null;
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
    const host = window as Window & { MMBrain?: { testSend?: () => unknown } };
    return host.MMBrain?.testSend?.() ?? null;
  })).toBeNull();

  await page.getByRole("button", { name: "Attach to Mastermind" }).click();
  await expect(attachment).toContainText("Exact source attached");
  await attachment.getByRole("button", { name: "Ask Mastermind with source" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.rctxOpenCount)).toBe("2");
  const secondTurnSource = await page.evaluate(() => {
    const host = window as Window & { MMBrain?: { testSend?: () => unknown } };
    return host.MMBrain?.testSend?.() ?? null;
  });
  expect(secondTurnSource).toEqual(firstTurnSource);
  await expect(attachment).toHaveCount(0);

  // Review repair 2c: the exact sequence of getCompanySourceSpan() reads the widget made across
  // this whole journey — cleared to null before each attach (the two `toBeNull()` testSend()
  // calls above), then the attached source on each "Ask Mastermind with source" send (the two
  // `toEqual(firstTurnSource)` testSend() calls above). Four calls total; this pins the exact
  // sequence rather than re-checking each call in isolation.
  expect(await page.evaluate(() => (window as unknown as { __MM_BRAIN_TEST_SENDS__?: unknown[] }).__MM_BRAIN_TEST_SENDS__))
    .toEqual([null, firstTurnSource, null, secondTurnSource]);

  // Review repair 2a: a client-side navigation away from /analysis (via the real nav "Chart"
  // link, NOT page.goto — this is a genuine App Router transition, not a fresh document load)
  // must reuse the SAME document-level Brain script rather than spawning a second one. Review
  // round 3, minor 1: this comment used to credit that reuse with also doing the symbol
  // rebind and pointed at AppShell's since-fixed `active=""` mount — corrected. The mount-once
  // install effect (components/BrainWidget.tsx `if (w.MMBrain) return`) is a deliberate no-op
  // here, because the singleton already exists from the /analysis mount; the rebind to
  // /terminal's own active symbol instead happens through the separate `[active]` effect's
  // `handoffMastermindBrainSymbol` call, which reassigns `MM_BRAIN_CFG.symbol` on every mount
  // regardless of the install effect's guard (lib/mastermindBrain.ts). AppShell no longer
  // mounts with an empty symbol either way — see lib/shellBrainSymbol.ts. Below 860px
  // (tablet/mobile projects) AppNav itself is `display:none` (globals.css) and MobileNav's
  // hamburger + drawer is the real entry point instead — same TOP list (AppNav.tsx), same href.
  //
  // Review repair round 2, MAJOR 2: the branch used to be picked with a one-shot
  // `appNavChart.isVisible()` probe. AppNav's Suspense fallback renders `<nav aria-label="Primary">`
  // with no links at all (components/AppNav.tsx), so on the desktop project the locator can
  // legitimately resolve to 0 elements while the real nav is still hydrating — `isVisible()` does
  // not wait for that, so it can read "not visible" on desktop and fall into the mobile branch,
  // where the "Menu" button is `display:none` and `.click()` times out. Pick the branch from the
  // same CSS breakpoint the app itself uses (globals.css `@media (max-width:860px)`) instead —
  // deterministic from the project's own viewport, no race against hydration.
  // Review round 3, minor 2: a `?? 0` default here would silently pick the mobile branch for
  // any project with no fixed viewport (page.viewportSize() returns null) — a branch that
  // cannot pass on a wide window. Every project in playwright.config.ts sets an explicit
  // viewport, so this should never actually be null; fail loudly instead of guessing if a
  // future project ever removes one.
  const viewportSize = page.viewportSize();
  if (!viewportSize) throw new Error("company-intelligence-rctx.spec.ts requires a project with a fixed viewport (page.viewportSize() was null)");
  const isDesktopNav = viewportSize.width > 860;
  const appNavChart = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Chart" });
  if (isDesktopNav) {
    await expect(appNavChart).toBeVisible();
    await appNavChart.click();
  } else {
    // PRODUCT FINDING (pre-existing, not caused by this repair or by BrainWidget/AppShell —
    // see the review-repair report), now FIXED: `.fin-pane--workspace` (the Company
    // Intelligence workspace pane) is `position:fixed; top:0; z-index:90` covering the full
    // viewport at <=860px, which used to outrank AppShell's `.mobilebar` (z-index:30) despite
    // the hamburger being later in paint order, so a real click on "Menu" intercepted pointer
    // events on `.fin-pane`'s own content instead. Fixed by geometry, not stacking: at
    // <=860px `.analysis-route .fin-pane--workspace` now starts at `top:52px` (globals.css),
    // below the mobile bar, so no z-index raise is needed. The round-8 raise
    // (`.analysis-route .mobilebar{z-index:95}`) was REMOVED in round 9 because it sat over
    // `.ci-evidence-close` and broke the company-intelligence mobile shard. The click below
    // is the real user gesture, not a hit-test bypass.
    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator(".m-nav").getByRole("link", { name: "Chart" }).click();
  }
  await expect(page).toHaveURL(/\/terminal(?:\?.*)?$/);
  await expect(page.locator(`script[src="${BRAIN_SCRIPT_SRC}"]`)).toHaveCount(1);
  await expect.poll(() =>
    page.evaluate(() => (window as unknown as { MM_BRAIN_CFG?: { symbol?: () => string } }).MM_BRAIN_CFG?.symbol?.())
  ).toBe("NVDA");

  // Review repair 2b: final re-assertion of the script-count invariant, at the very end of the
  // journey (analysis mount -> two turns -> in-app nav to the chart).
  await expect(page.locator(`script[src="${BRAIN_SCRIPT_SRC}"]`)).toHaveCount(1);
});

// Product rule (Meta-CEO B ruling r5, 2026-09-07): the shell's ACTIVE symbol always wins. When
// /analysis adopts an existing document Brain host, the host's stale MM_BRAIN_CFG.symbol is
// overwritten by the route's own symbol — a user who navigates to /analysis?symbol=NVDA must get
// a Brain about NVDA, never whatever the adopted host happened to be preseeded with. Same law as
// #508 ("carry the active company across workspaces"). This is the same mechanism the unit test
// lib/__tests__/brainWidgetColdSymbol.test.ts already pins at the component level; that test is
// unchanged by this ruling.
test("Analysis adopts an existing document Brain host, overwriting its stale symbol with the route's active symbol, without racing a second widget script", async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as Window & {
      MMBrain?: { open: () => void };
      MM_BRAIN_CFG?: { symbol?: () => string };
    };
    host.MM_BRAIN_CFG = { symbol: () => "stale-preseed" };
    host.MMBrain = { open: () => undefined };
  });
  await page.route(BRAIN_SCRIPT_SRC, async (route) => route.fulfill({
    contentType: "application/javascript",
    body: "document.documentElement.dataset.unexpectedSecondBrain = 'true';",
  }));

  await page.goto("/analysis?symbol=NVDA&page=intelligence");

  // The route's own active symbol (NVDA) wins over the adopted host's stale preseed — see the
  // product rule above.
  await expect.poll(() =>
    page.evaluate(() => {
      const host = window as Window & { MM_BRAIN_CFG?: { symbol?: () => string } };
      return host.MM_BRAIN_CFG?.symbol?.();
    })
  ).toBe("NVDA");
  await expect(page.locator(`script[src="${BRAIN_SCRIPT_SRC}"]`)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.unexpectedSecondBrain)).toBeUndefined();
});
