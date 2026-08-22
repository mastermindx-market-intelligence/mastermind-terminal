import { test as setup, expect } from "@playwright/test";

/**
 * Compile every surface the suite touches BEFORE the first spec runs, so that no test pays for a
 * cold `next dev` compile out of its own 30-second budget.
 *
 * This is NOT the flake fix — e2e/fixtures.ts is, and it carries that account. This addresses the
 * second, duller half of running the suite against a dev server: the FIRST test to reach a surface
 * is the one that waits for Turbopack to build it. Locally that cost was paid days ago, because
 * `reuseExistingServer: !CI` attaches to a server that compiled everything already; CI is the only
 * environment that meets these routes cold, on a runner roughly twice as slow. The existing
 * workarounds in the specs are the scar tissue from it — company-intelligence waits 60s for an
 * editor, and playwright.config.ts serialises that project entirely because "twelve simultaneous
 * cold starts have timed out locally and in CI".
 *
 * Doing it here means the compile happens once, under a timeout that exists for it, before any
 * assertion depends on it. Measured on a cold `.next` (2026-08-21): 34s, and a second pass over
 * the same routes compiled nothing — still nothing after three minutes idle, because Turbopack
 * does not dispose what it has built. One pass up front holds for the whole run.
 */

// Everything e2e/*.spec.ts navigates to (`grep -o 'goto("/…'`), plus the deep links that mount a
// lazily-built surface rather than another route. Keep this in step with the specs: a surface the
// suite reaches but this list misses is compiled mid-run, which is the defect above in miniature.
const ROUTES = [
  "/terminal?symbol=NVDA",
  "/terminal?symbol=AAPL",
  "/options",
  "/portfolio",
  "/alerts",
  "/discover",
  "/scripts",
  "/admin",
  "/analysis?symbol=NVDA&page=intelligence",
  "/embed/chart?symbol=NVDA",
];

// Every `?tab=` the specs deep-link to. Each one mounts its own lazily-built panel.
const OPTIONS_TABS = ["desk", "gex", "largest", "levels", "prism", "prophet", "screener",
  "statistics", "structure", "surface", "tape", "vol"];

// The fixture stores are keyed by cookie so tests can own their own copy. Warm-up traffic parks in
// a namespace no spec reads, so nothing it touches can reach a spec's store.
const ISOLATION = ["mm_e2e_scripts", "mm_e2e_wl", "mm_e2e_layouts"];

setup("compile every surface the suite touches", async ({ browser, baseURL }) => {
  setup.setTimeout(15 * 60_000);

  const visit = async (paths: string[], viewport: { width: number; height: number }) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(ISOLATION.map((name) => ({ name, value: "warmup", url: baseURL! })));
    const page = await context.newPage();
    for (const path of paths) {
      // A compile failure must not fail the gate here — the spec that owns the surface reports it
      // far better than a warm-up pass can. Only a server that never answers is worth failing on,
      // and the final reachability check below covers that.
      await page.goto(path, { waitUntil: "load", timeout: 180_000 }).catch(() => {});
      // Give the lazily-mounted panels a moment to request their chunks, which is what compiles
      // them. `load` fires before next/dynamic resolves.
      await page.waitForTimeout(1_500);
    }
    await context.close();
  };

  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 390, height: 844 };

  // Three lanes so Turbopack has work queued while it builds, rather than one round trip per
  // surface. Compilation itself is serialised server-side; this only removes the idle gaps.
  await Promise.all([
    visit(ROUTES, desktop),
    visit(OPTIONS_TABS.map((tab) => `/options?tab=${tab}`), desktop),
    // Mobile mounts different chrome (sheets, the phone toolbar) — its own chunks, its own compile.
    visit(["/terminal?symbol=NVDA", "/options", "/portfolio", "/alerts"], mobile),
  ]);

  // The one thing worth failing on: the server has to be serving the workspace the whole suite
  // starts from. Everything above is best-effort; this is not.
  const context = await browser.newContext({ viewport: desktop });
  const page = await context.newPage();
  await page.goto("/terminal?symbol=NVDA", { waitUntil: "load", timeout: 180_000 });
  await expect(page.locator(".pane").first()).toBeVisible({ timeout: 120_000 });
  await context.close();
});
