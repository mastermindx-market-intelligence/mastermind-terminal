// One-off recapture for PR #490 review-round FIX_REQUIRED MAJOR-2: the four committed
// EN/ZH x 1440/390 crops under e2e/proof/rctx-analysis/ were captured at `1d961eed8`
// (2026-09-01), which predates `5934bd0cf` (2026-09-06, "round-3 review repair — fin-pane
// header collision"). That commit added the `@media (max-width:860px){ .analysis-route
// .fin-pane--workspace{top:52px} }` offset in app/globals.css, so the 390px crops no longer
// depict the shipped composition. This script re-captures all four crops fresh at the current
// head, mirroring the exact user journey in e2e/company-intelligence-rctx.spec.ts (mock the
// same data routes; let the REAL production `mm_brain.js` load and render, since the crops
// exist to show the real widget's appearance, not the spec's headless UI-less test stub).
//
// This is NOT part of the `test:e2e:responsive` suite (run with plain `node`, not `npx
// playwright test`) — house law forbids running that suite locally; this is a standalone
// one-off script, same class as e2e/tools/measure-analysis-mobilebar-stacking.mjs.
//
// Usage: node e2e/tools/capture-rctx-analysis-crops.mjs <port> <outDir>
// Starts its own `next dev` on <port> (ANALYSIS_LOCAL_PREVIEW=1, same env as
// playwright.config.ts webServer) so /analysis is not member-gated, then exits
// the server when the crops are written.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execFileSync, spawn } from "child_process";

/** Language key is read from the app, not assumed — terminal/lib/i18n.tsx writes it. */
function languageStorageKeyFromI18n() {
  const src = readFileSync(join(import.meta.dirname, "../../lib/i18n.tsx"), "utf8");
  const m = src.match(/localStorage\.setItem\("([^"]+)",\s*l\)/);
  if (!m) throw new Error("could not read language storage key from terminal/lib/i18n.tsx");
  return m[1];
}
const LANG_STORAGE_KEY = languageStorageKeyFromI18n();

const [port, outDir] = process.argv.slice(2);
if (!port || !outDir) {
  console.error("Usage: node capture-rctx-analysis-crops.mjs <port> <outDir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: import.meta.dirname, encoding: "utf8" }).trim();
}
const capturedAtHead = currentGitHead();

const SHA = "a".repeat(64);
const METRICS = {
  sentiment: null, performance: null, confidence: null, combined: null,
  call_positivity: null, management_confidence: null, analyst_criticism: null,
  future_outlook: null, revenue_growth_pct: null, eps_growth_pct: null,
  gross_margin_pct: null, analysts_count: null, questions_count: null,
};
function companyContext() {
  const event = {
    event_id: "cie_rctx_2026q1", ticker: "NVDA", fiscal_year: 2026, fiscal_quarter: 1,
    call_date: "2026-05-20", summary: null, highlights: [], positive_highlights: [],
    negative_highlights: [], key_quote: null, tags: [], metrics: METRICS,
    field_lineage: { summary: null, key_quote: null, metrics: METRICS, positive_highlights: [], negative_highlights: [], highlights: [], tags: {} },
    previous_event_deltas: METRICS,
    sources: [{ source_ref: "transcript", kind: "transcript", status: "present", citation_precision: "document", url: "/data/tx/NVDA/2026Q1.json.gz", receipt: { source_hash: SHA, source_date: "2026-05-20", record_id: "2026Q1" } }],
    claim_citations_pending: true,
  };
  return {
    schema: "company_intelligence_context.v1", authority: "context_only", is_context_only: true,
    generated_at: "2026-08-30T00:00:00Z", generation_id: "b".repeat(24),
    company: { ticker: "NVDA", display_name: "NVIDIA Corporation", exchange: null },
    status: "ready", latest_event_id: event.event_id, latest_event: event, history: [event],
    topics: { timeline: [], added: [], dropped: [], persistent: [] },
    source_completeness: {
      earnings_history: { status: "missing", event_count: 0 },
      score_overlay: { status: "missing", event_count: 0 },
      transcripts: { status: "present", event_count: 1 },
    },
    warnings: [], missing_sources: [],
    transport_lineage: {
      earnings_manifest: { generation_id: "c".repeat(24), sha256: "d".repeat(64) },
      tx_index: { schema: "mastermind.tx-index/v1", generation_id: "e".repeat(24), sha256: "f".repeat(64) },
      builder: "company_intelligence.v1",
    },
  };
}
const sourceSpan = {
  span_id: `txs1_${"1".repeat(64)}`, ticker: "NVDA", event_id: "cie_rctx_2026q1", transcript_id: "2026Q1",
  document_sha256: "2".repeat(64), segment_index: 7, start_byte: 144, end_byte: 173,
  segment_text_sha256: "3".repeat(64), speaker: "Verified Speaker", role: "Chief Executive Officer",
  section: "prepared", excerpt: "Exact source context is attached.", matched_text: "Exact source",
  receipt: {
    revision_id: "rctx_revision_2026q1", document_sha256: "2".repeat(64), indexed_at: "2026-08-30T00:00:00Z",
    source_label: "Verified fixture transcript", source_url: "/data/tx/NVDA/2026Q1.json.gz", verification: "verified",
  },
};

async function mockRoutes(page) {
  await page.route("**/api/event-workspace/**", (route) => route.fulfill({
    status: 404,
    json: { ok: false, state: "error", available: false, error: { code: "not_found", message: "No event workspace", retryable: false } },
  }));
  await page.route("**/api/company-intelligence/NVDA**", (route) => route.fulfill({ json: { ok: true, state: "ready", context: companyContext() } }));
  await page.route("**/api/company-theme-context/NVDA**", (route) => route.fulfill({
    status: 404,
    json: { ok: false, state: "error", error: { code: "not_found", message: "No theme context", retryable: false } },
  }));
  await page.route("**/api/company-institutional-context/NVDA**", (route) => route.fulfill({
    status: 404,
    json: { ok: false, state: "error", error: { code: "not_found", message: "No institutional context", retryable: false } },
  }));
  await page.route("**/api/company-source-search/NVDA?**", (route) => route.fulfill({
    json: {
      schema: "mastermind.company-source-search/v1", state: "ready", ticker: "NVDA", query: "Exact source",
      spans: [sourceSpan], searched_event_ids: ["cie_rctx_2026q1"], match_count_by_event: { cie_rctx_2026q1: 1 },
      count_capped_event_ids: [], truncated: false, corpus_revision: "rctx_revision_2026q1",
    },
  }));
}

async function captureOne(browser, { width, height, lang, label }) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await mockRoutes(page);
  if (lang === "zh") {
    const key = LANG_STORAGE_KEY;
    await page.addInitScript((storageKey) => { try { localStorage.setItem(storageKey, "zh"); } catch {} }, key);
  }
  await page.goto(`http://127.0.0.1:${port}/analysis?symbol=NVDA&page=intelligence`, { waitUntil: "domcontentloaded" });
  // components/BrainWidget.tsx appends the <script src="…/mm_brain.js"> tag
  // (document.body.appendChild); wait for that tag, not a fixed sleep.
  await page.waitForSelector('script[src="https://www.mastermind-x.com/mm_brain.js"]', { state: "attached", timeout: 20_000 });
  await page.locator(".ci-lenses").getByRole("tab").nth(1).click();
  const search = page.locator(".ci-ts-search");
  await search.locator("input").fill("Exact source");
  await search.locator(".btn").click();
  await page.locator(".ci-ts-results .ci-ts-span").first().waitFor({ timeout: 10_000 });
  const attachName = lang === "zh" ? "附加给 Mastermind" : "Attach to Mastermind";
  const askName = lang === "zh" ? "带来源询问 Mastermind" : "Ask Mastermind with source";
  await page.getByRole("button", { name: attachName }).click();
  const attachment = page.getByTestId("company-source-context-attachment");
  await attachment.waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: askName }).click();
  // Give the real widget's own panel-open animation a moment to settle before the crop.
  await page.waitForTimeout(1500);
  const geometry = await page.evaluate(() => {
    const bar = document.querySelector(".mobilebar");
    const pane = document.querySelector(".fin-pane--workspace");
    const barRect = bar ? bar.getBoundingClientRect() : null;
    const paneRect = pane ? pane.getBoundingClientRect() : null;
    return {
      mobilebarHeight: barRect ? barRect.height : null,
      mobilebarBottom: barRect ? barRect.bottom : null,
      workspaceTop: paneRect ? paneRect.top : null,
    };
  });
  const fileBase = `${width}x${height}-${lang}-analysis-brain-panel-open-source-attached`;
  const pngPath = join(outDir, `${fileBase}.png`);
  await page.screenshot({ path: pngPath, fullPage: false });
  await context.close();
  console.log(`[${label}] wrote ${pngPath} workspaceTop=${geometry.workspaceTop} mobilebarBottom=${geometry.mobilebarBottom}`);
  return { fileBase, geometry };
}

function startDevServer(devPort) {
  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(devPort)], {
    cwd: join(import.meta.dirname, "../.."),
    env: {
      ...process.env,
      ANALYSIS_LOCAL_PREVIEW: "1",
      ADMIN_DEV: "1",
      TERMINAL_E2E_FIXTURE: "1",
      TERMINAL_E2E_EMAIL: "responsive@example.com",
      TERMINAL_E2E_ENTITLEMENT: "unlimited",
      RATE_LIMIT_MAX: "100000",
      FLOW_FIXTURE: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function waitForDevServer(devPort, timeoutMs = 120_000) {
  const url = `http://127.0.0.1:${devPort}/analysis?symbol=NVDA`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status > 0) return;
    } catch { /* still booting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server on ${devPort} did not become ready`);
}

const server = startDevServer(port);
try {
  await waitForDevServer(port);
} catch (err) {
  server.kill("SIGTERM");
  throw err;
}

const browser = await chromium.launch();
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const lang of ["en", "zh"]) {
      const label = `${viewport.width}x${viewport.height}-${lang}`;
      results.push(await captureOne(browser, { ...viewport, lang, label }));
    }
  }
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

writeFileSync(join(outDir, `capture-log-${capturedAtHead.slice(0, 8)}.txt`),
  `capturedAtHead=${capturedAtHead}\nlangStorageKey=${LANG_STORAGE_KEY}\ncapturedAt=${new Date().toISOString()}\nfiles=\n${results.map((r) => `  ${r.fileBase}.png workspaceTop=${r.geometry.workspaceTop} mobilebarBottom=${r.geometry.mobilebarBottom}`).join("\n")}\n`);
console.log("capturedAtHead", capturedAtHead);
console.log("langStorageKey", LANG_STORAGE_KEY);
