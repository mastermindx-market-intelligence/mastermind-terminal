// One-off measurement for PR #490 MAJOR-1 (review ruling): the round-3/round-4 stacking fix
// (.analysis-route .mobilebar{z-index:95} + the .fin-pane--workspace{top:52px} offset,
// app/globals.css) was asserted only through a source-level CSSOM test
// (lib/__tests__/appShellAnalysisZIndex.test.ts) — never through an actual rendered page. This
// script is the "before vs after" real-browser measurement the ruling asks for: computed
// z-index, position, and bounding boxes for the two colliding elements
// (.mobilebar and the Company Intelligence full-screen pane, .fin-pane / .fin-pane--workspace)
// at both contract viewports, plus a real elementFromPoint hit-test at the "Menu" button's
// center point (the actual user gesture the fix exists for — a z-index number alone does not
// prove a click reaches the button; app/fin.css `.fin-pane{z-index:90}` covers it below the fix).
//
// This is NOT part of the `test:e2e:responsive` suite (not in playwright.config.ts's testDir
// matching, and it is run with plain `node`, not `npx playwright test`) — house law forbids
// running that suite locally; this is a standalone script run once per side of the comparison
// and its output pasted into the PR body. Keep or delete after use (ruling's own words).
//
// Review round-6 addition: the round-5 artifact's BEFORE `.mobilebar` z-index read "1" at both
// viewports, which a plain `grep -rn mobilebar --include=*.css` cannot explain (only two
// declarations exist for a selector literally named `.mobilebar`: 30 and this PR's 95) — the
// review called that unreconcilable. It is real: `app/observatory.css`'s `.obs-ambient > *`
// resets every direct child's z-index to 1 (ambient-background layering), ties `.mobilebar`'s
// own specificity exactly (one class each; `>` and `*` add none), and wins on origin/master by
// coming later in source order — a rule a `mobilebar`-string grep cannot find because its
// selector text never contains that string. This script now asks the browser directly, via the
// CDP `CSS.getMatchedStylesForNode` cascade (not a text grep), which rules the browser actually
// matched against `.mobilebar` and which one supplied the winning z-index, and records that list
// in the JSON so the artifact explains its own number instead of asserting it.
//
// Usage: node e2e/tools/measure-analysis-mobilebar-stacking.mjs <port> <label> <outDir>
//   <label> is a free-text tag ("BEFORE-<sha>" / "AFTER-<sha>") embedded in the output filenames
//   and JSON so the two runs cannot be confused after the fact. Review round-10 (MAJOR-1): a
//   commit-sha-free label ("AFTER-this-pr") went stale silently across rounds and left the
//   reviewer no way to confirm a proof artifact's capture head equals the PR head — the label
//   is now expected to carry the sha of `capturedAtHead` below (the caller renames the committed
//   files to match after each run, since the sha of THIS round's own commit is not known until
//   after it is made). The JSON's own `capturedAtHead` field is the authoritative source — read
//   that, not just the filename, when checking provenance.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";

const [port, label, outDir] = process.argv.slice(2);
if (!port || !label || !outDir) {
  console.error("Usage: node measure-analysis-mobilebar-stacking.mjs <port> <label> <outDir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// Review round-10 (PR #490, MAJOR-1): the previous artifact carried no field identifying which
// commit's tree it was captured against, so a reviewer could not confirm a proof artifact's
// capture head equals the PR head. `git rev-parse HEAD`, run from this script's own directory,
// answers that honestly: it is the committed tree's HEAD at capture time. When a run swaps one
// file's contents in the working tree (the BEFORE side of this comparison always does — see the
// PR body's "BEFORE = <sha>'s app/globals.css swapped in" methodology) the sha below still names
// the real HEAD commit; it does not and cannot claim the working tree is byte-identical to that
// commit — the PR body states which file was swapped and why the isolation is still valid.
function currentGitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: import.meta.dirname, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
const capturedAtHead = currentGitHead();

const BRAIN_SCRIPT_SRC = "https://www.mastermind-x.com/mm_brain.js";
const METRICS = {
  sentiment: null, performance: null, confidence: null, combined: null,
  call_positivity: null, management_confidence: null, analyst_criticism: null,
  future_outlook: null, revenue_growth_pct: null, eps_growth_pct: null,
  gross_margin_pct: null, analysts_count: null, questions_count: null,
};

function companyContext() {
  const event = {
    event_id: "cie_stack_2026q1", ticker: "NVDA", fiscal_year: 2026, fiscal_quarter: 1,
    call_date: "2026-05-20", summary: null, highlights: [], positive_highlights: [],
    negative_highlights: [], key_quote: null, tags: [], metrics: METRICS,
    field_lineage: { summary: null, key_quote: null, metrics: METRICS, positive_highlights: [], negative_highlights: [], highlights: [], tags: {} },
    previous_event_deltas: METRICS,
    sources: [{ source_ref: "transcript", kind: "transcript", status: "present", citation_precision: "document", url: "/data/tx/NVDA/2026Q1.json.gz", receipt: { source_hash: "a".repeat(64), source_date: "2026-05-20", record_id: "2026Q1" } }],
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
  await page.route(BRAIN_SCRIPT_SRC, (route) => route.fulfill({
    contentType: "application/javascript",
    body: "(() => { window.MMBrain = { mounted: true, open() {} }; document.documentElement.dataset.rctxHost = 'mounted'; })();",
  }));
  await page.route("**/api/event-workspace/**", (route) => route.fulfill({
    status: 404,
    json: { ok: false, state: "error", available: false, error: { code: "not_found", message: "No event workspace", retryable: false } },
  }));
  await page.route("**/api/company-intelligence/NVDA**", (route) => route.fulfill({ json: { ok: true, state: "ready", context: companyContext() } }));
  await page.route("**/api/company-theme-context/NVDA**", (route) => route.fulfill({
    status: 404, json: { ok: false, state: "error", error: { code: "not_found", message: "No theme context", retryable: false } },
  }));
  await page.route("**/api/company-institutional-context/NVDA**", (route) => route.fulfill({
    status: 404, json: { ok: false, state: "error", error: { code: "not_found", message: "No institutional context", retryable: false } },
  }));
  await page.route("**/api/company-source-search/NVDA?**", (route) => route.fulfill({
    json: {
      schema: "mastermind.company-source-search/v1", state: "ready", ticker: "NVDA", query: "",
      spans: [], searched_event_ids: [], match_count_by_event: {}, count_capped_event_ids: [],
      truncated: false, corpus_revision: "stack_measure_revision",
    },
  }));
}

/** Real getComputedStyle + getBoundingClientRect for one selector, or null if absent. */
function readElement(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    zIndex: cs.zIndex,
    position: cs.position,
    top: cs.top,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right },
  };
}

function rectsOverlap(a, b) {
  if (!a || !b) return null;
  return a.rect.left < b.rect.right && a.rect.right > b.rect.left && a.rect.top < b.rect.bottom && a.rect.bottom > b.rect.top;
}

/**
 * Ask the browser's own cascade resolver (CDP `CSS.getMatchedStylesForNode`) which rules it
 * matched against `selector` and which of them set z-index, in cascade (source) order. This is
 * strictly more authoritative than a source grep: it also surfaces rules that match the element
 * through a compound selector (e.g. `.obs-ambient > *`) whose selector text never contains the
 * element's own class name, so a text search for that class would miss it entirely.
 */
async function matchedZIndexRules(client, root, selector) {
  const { nodeIds } = await client.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
  if (!nodeIds.length) return null;
  const matched = await client.send("CSS.getMatchedStylesForNode", { nodeId: nodeIds[0] });
  return (matched.matchedCSSRules || [])
    .map((m) => {
      const prop = (m.rule.style.cssProperties || []).find((p) => p.name === "z-index" && !p.disabled);
      return prop ? { selector: m.rule.selectorList.text, zIndex: prop.value } : null;
    })
    .filter(Boolean);
}

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "390x844", width: 390, height: 844 },
];

const browser = await chromium.launch();
const results = { label, port: Number(port), capturedAtHead, viewports: {} };

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await mockRoutes(page);
  await page.goto(`http://127.0.0.1:${port}/analysis?symbol=NVDA&page=intelligence`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".fin-pane").first().waitFor({ state: "attached", timeout: 30_000 });
  // Review round-10: waiting only for `.fin-pane` to attach (a structural skeleton element
  // present before real content loads) let one run's screenshot capture a still-loading
  // placeholder state — same DOM geometry, visibly different pixels, on a cold Turbopack
  // compile after a cache clear. Wait for real Company-Intelligence content text too, not just
  // the skeleton, before screenshotting.
  await page.getByText("REPORTED CHANGE").first().waitFor({ state: "visible", timeout: 30_000 });
  // Let layout settle (webfonts, one paint frame) before reading computed geometry.
  await page.waitForTimeout(500);

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const mobilebarZIndexCascade = await matchedZIndexRules(cdp, root, ".mobilebar");

  const mobilebar = await page.evaluate(readElement, ".mobilebar");
  const finPane = await page.evaluate(readElement, ".fin-pane.fin-pane--workspace");
  const finHead = await page.evaluate(readElement, ".fin-head");
  const menuButton = await page.evaluate(readElement, 'button[aria-label="Menu"]');

  // Real hit-test: what does the browser's own hit-testing return at the Menu button's
  // center point? This is the actual click-reachability the fix exists for, not an inference
  // from z-index numbers alone.
  const menuHitTest = menuButton
    ? await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const menu = document.querySelector('button[aria-label="Menu"]');
        return { hitElementTag: el ? el.tagName : null, hitElementIsMenuButton: !!(el && menu && (el === menu || menu.contains(el))) };
      }, { x: menuButton.rect.x + menuButton.rect.width / 2, y: menuButton.rect.y + menuButton.rect.height / 2 })
    : null;

  const screenshotFile = `${label}-${vp.name}.png`;
  await page.screenshot({ path: join(outDir, screenshotFile) });

  results.viewports[vp.name] = {
    mobilebar,
    // Every CSS rule the browser matched against `.mobilebar` that sets z-index, in cascade
    // (source) order — the last entry whose `zIndex` equals `mobilebar.zIndex` above is the
    // winner. Explains a computed value that a selector-text-only grep for "mobilebar" cannot
    // (see the `.obs-ambient > *` rule this uncovers on origin/master).
    mobilebarZIndexCascade,
    finPane,
    finHead,
    menuButton,
    menuHitTest,
    mobilebarOverlapsFinPane: rectsOverlap(mobilebar, finPane),
    finHeadCoveredByMobilebar: rectsOverlap(finHead, mobilebar),
    // Relative filename only — an absolute local path here would leak this machine's
    // username and session directory into a committed artifact (review round-10, Minor 2).
    screenshot: screenshotFile,
  };

  console.log(`[${label}] ${vp.name}`);
  console.log(JSON.stringify(results.viewports[vp.name], null, 2));
  await ctx.close();
}
await browser.close();

const jsonPath = join(outDir, `${label}.json`);
writeFileSync(jsonPath, JSON.stringify(results, null, 2));
console.log(`\nWrote ${jsonPath}`);
