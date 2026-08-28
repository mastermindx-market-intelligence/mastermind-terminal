/**
 * globalSetup — compile every route the suite uses BEFORE any spec's clock starts.
 *
 * ── The failure this removes ──────────────────────────────────────────────────────────────
 *
 * `playwright.config.ts` runs the suite against a DEV server (`npm run dev`), and Next compiles
 * a route on its first request. So whichever spec happens to touch a route first pays a
 * Turbopack compile INSIDE its own timeout budget — and on a cold checkout (which is what CI
 * always is) that is enough to push a timing-sensitive spec over the edge.
 *
 * It is not hypothetical, and it is not "CI is slow". Measured on ONE machine, same commit:
 *
 *   warm `.next/`            → 516 passed, 0 failed, 0 flaky, ~5.5 min   (four consecutive runs)
 *   after `rm -rf .next`     → 511 passed, 0 failed, 5 FLAKY, ~8.5 min
 *
 * The five cold flakes were company-intelligence:709/:1019, drawing-system:491,
 * options-workflow-guide:157 and pine-editor-integrity:218 — every one recovered by the single
 * CI retry, which is exactly the margin a slower runner does not have. On CI the same
 * population crosses from flaky to FAILED, and the victim set ROTATES between attempts of the
 * identical SHA (observed on PR #441: three attempts, three different sets, only live-candle
 * recurring). A rotating victim set is the signature of a shared resource, not of a bug in any
 * one spec — which is why raising the timeout on whichever spec failed last is not a fix.
 *
 * ── Why warming, rather than the other candidates ─────────────────────────────────────────
 *
 * Building once and serving with `next start` would also remove per-route compilation, and is
 * the better long-term answer, but it changes how EVERY spec runs (production gating, env
 * inlining, the `ANALYSIS_LOCAL_PREVIEW` seam) and deserves its own change with its own proof.
 * This is the additive, reversible half: it changes no server mode and no spec, and it targets
 * the measured cause directly. Raising timeouts was rejected outright — it hides the signal,
 * and since the set rotates, the next cold run simply picks different victims.
 *
 * Keep ROUTES in step with the suite. A route that is missing here is not broken, it is merely
 * back to paying its own compile; the list is derived from every `page.goto()` in e2e/.
 */
import type { FullConfig } from "@playwright/test";

/** Every route the suite navigates to, plus the API routes its first assertions depend on. */
const ROUTES = [
  "/terminal?symbol=NVDA",
  "/options",
  "/portfolio",
  "/alerts",
  "/analysis",
  "/discover",
  "/admin",
  "/embed/chart?symbol=NVDA",
  "/login",
  // API routes compile on first request too, and these are awaited inside specs rather than
  // during navigation — so their compile lands squarely inside an `expect.poll` budget.
  "/api/me",
  "/api/watchlist",
  "/api/layouts",
];

/** One request, with its own ceiling: a warm-up must never outlast the thing it protects. */
async function warm(url: string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: control.signal });
    // The STATUS is irrelevant — 401/404/307 all mean the route compiled, which is the point.
    return `${res.status} in ${Date.now() - started}ms`;
  } catch (err) {
    return `skipped after ${Date.now() - started}ms (${(err as Error).name})`;
  } finally {
    clearTimeout(timer);
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use?.baseURL
    ?? `http://127.0.0.1:${process.env.TERMINAL_E2E_PORT || 3108}`;

  // Playwright's ordering of webServer vs globalSetup has moved between releases, so do not
  // assume the server is already up — wait for it rather than warming into a closed port.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/login`, { signal: AbortSignal.timeout(5_000) });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  // SERIAL, not parallel: twelve simultaneous cold compiles contend for the same dev server and
  // measure worse than doing them one at a time.
  const started = Date.now();
  for (const route of ROUTES) {
    const result = await warm(`${base}${route}`, 90_000);
    console.log(`[warmup] ${route} → ${result}`);
  }
  console.log(`[warmup] ${ROUTES.length} routes compiled in ${Math.round((Date.now() - started) / 1000)}s`);
}
