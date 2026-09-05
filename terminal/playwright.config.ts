import { defineConfig } from "@playwright/test";

// Shared worktrees frequently run responsive suites in parallel. Allow each
// checkout to reserve its own port instead of silently reusing another tree's
// dev server (3108 remains the local/CI default).
const port = Number(process.env.TERMINAL_E2E_PORT || 3108);
const baseURL = `http://127.0.0.1:${port}`;
const companyIntelligenceSpec = /company-intelligence\.spec\.ts/;
const terminalChromeIntermediateSpec = /terminal-chrome-responsive\.spec\.ts/;
// W2-A workspace-menu screenshots manage their own viewport per case (1440/820/390 in one file,
// spec §7) — same reason as terminalChromeIntermediateSpec: it must run ONCE, not once per default
// project, or every named screenshot gets clobbered three times over by parallel projects racing
// the same file paths.
const w2aWorkspacesSpec = /w2a-workspaces\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  // Compile every route the suite uses BEFORE any spec's clock starts. The suite runs against a
  // DEV server, so a route's first request pays a Turbopack compile inside whichever spec
  // happens to touch it first — the measured cause of CI's rotating e2e failures. See the
  // module header in e2e/globalSetup.ts for the numbers.
  globalSetup: "./e2e/globalSetup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Two retries, not one: at peak CI hours the pointer-heavy specs fail ~15-25% of
  // attempts each from runner contention alone (2026-09-04, runs 33900983026 ×2 —
  // rotating victims, every one green in the same tree's off-peak runs), and attempts
  // within one run share the same saturated VM so a single retry is a correlated
  // sample, not a fresh one. A consistent regression still fails 3/3 and reds the run.
  retries: process.env.CI ? 2 : 0,
  // Every worker below shares ONE dev server process (`webServer`, not one per worker) — that
  // server is the actual bottleneck, not the CPU count Playwright defaults to. Locally this
  // config auto-detects up to a dozen workers and still passes because the machine has cores to
  // spare; the CI runner does not, and every one of the specs that has recently gone red in CI
  // (crosshair-price-label, drawing-system, indicator-snapshot, marker-tooltip, layout-integrity,
  // watchlist-bulk-actions) reproduced 100% clean locally against this exact commit with no code
  // change — the failures are timing budgets (an `expect.poll`, a `toBeVisible`, a toolbar
  // remeasurement retry) losing a race against a saturated shared server, not a broken assertion.
  // Capping CI concurrency trades wall-clock time for headroom on those budgets, the same trade
  // #438 (bounded Playwright install) and #452 (route pre-warming) already made for this suite.
  // ONE worker, not two: at 2 workers on the 2-vCPU hosted runner the suite livelocks rather
  // than lags — run 33878617300 shows a click on a VISIBLE menu item unable to complete within
  // a 90s test clock on both attempts (Playwright's actionability stability check never sees a
  // quiet frame while the sibling worker mounts charts), so no finite budget fixes it. The job
  // has no timeout-minutes (6h default) and the required check reports late but honestly.
  workers: process.env.CI ? 1 : undefined,
  // The same saturated-runner arithmetic applies to each test's own clock: several specs
  // legitimately spend a 15-25s poll or two 20s visibility budgets before their last
  // assertion, which cannot fit the 30s default once the shared server adds measured
  // multi-second stalls (run 33873537063: every "flaky" retry-pass hit "Test timeout of
  // 30000ms exceeded" mid-poll, not a poll's own budget). CI-only, like the worker cap;
  // locally the default stands.
  timeout: process.env.CI ? 60_000 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    // Keep the broad responsive suite fully parallel. The Company Intelligence
    // workspace has a cold Next route plus source fixtures and is intentionally
    // isolated below: twelve simultaneous cold starts have timed out locally
    // and in CI, while one viewport at a time is deterministic.
    { name: "desktop", testIgnore: [companyIntelligenceSpec, terminalChromeIntermediateSpec, w2aWorkspacesSpec], use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", testIgnore: [companyIntelligenceSpec, terminalChromeIntermediateSpec, w2aWorkspacesSpec], use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: "mobile", testIgnore: [companyIntelligenceSpec, terminalChromeIntermediateSpec, w2aWorkspacesSpec], use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    {
      name: "company-intelligence-desktop",
      testMatch: companyIntelligenceSpec,
      workers: 1,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "company-intelligence-tablet",
      testMatch: companyIntelligenceSpec,
      dependencies: ["company-intelligence-desktop"],
      workers: 1,
      use: { viewport: { width: 820, height: 1180 }, hasTouch: true },
    },
    {
      name: "company-intelligence-mobile",
      testMatch: companyIntelligenceSpec,
      dependencies: ["company-intelligence-tablet"],
      workers: 1,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      name: "terminal-chrome-intermediate",
      testMatch: terminalChromeIntermediateSpec,
      workers: 1,
      use: { viewport: { width: 1180, height: 820 } },
    },
    {
      name: "w2a-workspaces",
      testMatch: w2aWorkspacesSpec,
      workers: 1,
      // hasTouch:true so the pointer:coarse 44px tap-target floor (globals.css) actually applies
      // when a case switches to the 820/390 breakpoints mid-test via page.setViewportSize.
      use: { viewport: { width: 1440, height: 900 }, hasTouch: true },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/terminal?symbol=NVDA`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // /analysis is normally member-gated. The page's local-only preview seam
      // keeps responsive visual tests focused on the workspace, not auth.
      ANALYSIS_LOCAL_PREVIEW: "1",
      // The owner console's existing dev hatch (lib/adminGate.ts), not a new seam: it grants
      // admin only when NODE_ENV === "development", which is exactly what `next dev` is here.
      // Production runs `next start` and can never satisfy it.
      ADMIN_DEV: "1",
      TERMINAL_E2E_FIXTURE: "1",
      TERMINAL_E2E_EMAIL: "responsive@example.com",
      TERMINAL_E2E_ENTITLEMENT: "unlimited",
      // All browser projects share one loopback IP. The fully-parallel matrix can
      // legitimately open hundreds of fixture feed + meta streams, so keep the
      // origin's production anti-scrape budget out of this deterministic test seam.
      RATE_LIMIT_MAX: "100000",
      // Exercise the second-resolution UI in deterministic route fixtures. Production remains
      // controlled by the server-only operator flag; this value exists only in the test process.
      HUB_REALTIME_QUOTES: "1",
      FLOW_FIXTURE: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
    },
  },
});
