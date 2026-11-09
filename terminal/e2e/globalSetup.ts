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
 * Keep ROUTES in fixtureWarmup.cjs in step with the suite. A route that is missing here is not broken, it is merely
 * back to paying its own compile; the list is derived from every `page.goto()` in e2e/.
 */
import type { FullConfig } from "@playwright/test";
import { warmFixtureRoutes } from "./fixtureWarmup.cjs";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use?.baseURL
    ?? `http://127.0.0.1:${process.env.TERMINAL_E2E_PORT || 3108}`;
  await warmFixtureRoutes(base);
}
