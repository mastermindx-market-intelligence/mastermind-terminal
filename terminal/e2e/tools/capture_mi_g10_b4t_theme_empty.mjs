// Crop capture for the B4 company theme-context empty state (PR evidence set
// terminal/docs/pr-crops/b-mi-g10-b4t-theme-empty). Captures
// section.ci-theme-card.ci-theme-empty, rendered when
// /api/company-theme-context/NVDA answers 404 not_found, at
// 1440x900/390x844 x en/zh x dark/light = 8 viewport-clipped PNGs from a
// throwaway next dev on 127.0.0.1 that this script starts and stops itself.
// The terminal shell is dark-only, so each light PNG is byte-identical to its
// dark twin; capture-log.json records that comparison. Fixtures and mocks are
// reused from terminal/e2e/tools/capture-rctx-analysis-crops.mjs.
// Usage (from terminal/): node e2e/tools/capture_mi_g10_b4t_theme_empty.mjs <port> <outDir>
import { createRequire } from "module";
import { execFileSync, spawn } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

// This file lives at terminal/e2e/tools/, so two levels up is terminal/.
const TERMINAL = fileURLToPath(new URL("../..", import.meta.url));
const { chromium } = createRequire(join(TERMINAL, "package.json"))("@playwright/test");

/** Language key is read from the app, not assumed — terminal/lib/i18n.tsx writes it. */
function languageStorageKeyFromI18n() {
  const src = readFileSync(join(TERMINAL, "lib/i18n.tsx"), "utf8");
  const m = src.match(/localStorage\.setItem\("([^"]+)",\s*l\)/);
  if (!m) throw new Error("could not read language storage key from terminal/lib/i18n.tsx");
  return m[1];
}
const LANG_STORAGE_KEY = languageStorageKeyFromI18n();

const [port, outDir] = process.argv.slice(2);
if (!port || !outDir) {
  console.error("Usage: node e2e/tools/capture_mi_g10_b4t_theme_empty.mjs <port> <outDir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: TERMINAL, encoding: "utf8" }).trim();
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

async function mockRoutes(page) {
  // Registered FIRST = lowest precedence: every non-127.0.0.1 request is aborted
  // (no external network) while the 127.0.0.1 mocks below still win their patterns.
  await page.route(/^(?!http:\/\/127\.0\.0\.1).*/, (route) => route.abort());
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
}

async function captureOne(browser, { width, height, lang, theme }) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await mockRoutes(page);
  if (lang === "zh") {
    const key = LANG_STORAGE_KEY;
    await page.addInitScript((storageKey) => { try { localStorage.setItem(storageKey, "zh"); } catch {} }, key);
  }
  await page.addInitScript((t) => { try { localStorage.setItem("theme", t); localStorage.setItem("theme_auto", "0"); } catch {} }, theme);
  await page.goto(`http://127.0.0.1:${port}/analysis?symbol=NVDA&page=intelligence`, { waitUntil: "domcontentloaded" });
  const card = page.locator("section.ci-theme-card.ci-theme-empty");
  await card.waitFor({ timeout: 60_000 });
  await card.scrollIntoViewIfNeeded();
  const dataThemeAfterMount = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  // app/layout.tsx hard-codes data-theme="dark"; force the requested theme and let CSS settle.
  await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(300);
  const row = await card.evaluate((el) => {
    const cs = getComputedStyle(el);
    const p = el.querySelector("p");
    const rect = el.getBoundingClientRect();
    return {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      bodyBackgroundColor: getComputedStyle(document.body).backgroundColor,
      cardBackgroundColor: cs.backgroundColor,
      borderTopStyle: cs.borderTopStyle,
      borderTopColor: cs.borderTopColor,
      pColor: p ? getComputedStyle(p).color : null,
      innerText: el.innerText,
      box: { x: Math.round(rect.x * 10) / 10, y: Math.round(rect.y * 10) / 10, width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 },
      scrollX: window.scrollX, scrollY: window.scrollY,
    };
  });
  row.dataThemeAfterMount = dataThemeAfterMount;
  const pad = 24;
  const clipX = Math.max(0, Math.round(row.box.x - pad));
  const clipY = Math.max(0, Math.round(row.box.y - pad));
  const clipW = Math.max(1, Math.min(Math.ceil(row.box.width) + pad * 2, width - clipX));
  const clipH = Math.max(1, Math.min(Math.ceil(row.box.height) + pad * 2, height - clipY));
  row.clip = { x: clipX, y: clipY, width: clipW, height: clipH };
  const file = `${width}x${height}-${lang}-${theme}-theme-empty.png`;
  await page.screenshot({ path: join(outDir, file), clip: row.clip, fullPage: false });
  await context.close();
  row.file = file; row.lang = lang; row.theme = theme; row.viewport = `${width}x${height}`;
  console.log(`[${row.viewport}-${lang}-${theme}] ${file} dataTheme=${row.dataTheme} (afterMount=${row.dataThemeAfterMount}) cardBg=${row.cardBackgroundColor} border=${row.borderTopStyle}/${row.borderTopColor} p=${row.pColor} box=${JSON.stringify(row.box)} clip=${JSON.stringify(row.clip)}`);
  return row;
}

function startDevServer(devPort) {
  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(devPort)], {
    cwd: TERMINAL,
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
    detached: true, // own process group, so SIGTERM reaches `next dev` under npm
  });
  return child;
}

async function waitForDevServer(devPort, timeoutMs = 240_000) {
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

function stopDevServer(child) {
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
}

const server = startDevServer(port);
process.on("SIGTERM", () => { stopDevServer(server); process.exit(143); });
try {
  await waitForDevServer(port);
} catch (err) {
  stopDevServer(server);
  throw err;
}

const browser = await chromium.launch();
const rows = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const lang of ["en", "zh"]) {
      for (const theme of ["dark", "light"]) {
        rows.push(await captureOne(browser, { ...viewport, lang, theme }));
      }
    }
  }
} finally {
  await browser.close();
  stopDevServer(server);
}

// Wait briefly for the port to actually close (SIGTERM delivered to the group).
for (let i = 0; i < 20; i++) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    await new Promise((r) => setTimeout(r, 500));
  } catch { break; }
}

const sha256Of = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const darkLightIdentical = {};
for (const vp of ["1440x900", "390x844"]) {
  for (const lang of ["en", "zh"]) {
    const darkFile = join(outDir, `${vp}-${lang}-dark-theme-empty.png`);
    const lightFile = join(outDir, `${vp}-${lang}-light-theme-empty.png`);
    const darkSha = sha256Of(darkFile);
    const lightSha = sha256Of(lightFile);
    darkLightIdentical[`${vp}-${lang}`] = { identical: darkSha === lightSha, darkSha, lightSha };
  }
}

const log = {
  capturedAtHead,
  langStorageKey: LANG_STORAGE_KEY,
  capturedAt: new Date().toISOString(),
  port: Number(port),
  captures: rows,
  darkLightIdentical,
};
writeFileSync(join(outDir, "capture-log.json"), `${JSON.stringify(log, null, 2)}\n`);
console.log(JSON.stringify(log, null, 2));
