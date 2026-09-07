import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// B-PLAT-7 re-scope (2026-09-07): the bubble in the 390 crops of terminal#490/#524 was never a
// production launcher — AppShell mounts no floating control on any route (BrainWidget uses
// anchor:"top"). It was the Next.js dev-tools indicator, rendered because next.config.ts set no
// `devIndicators` key. The fix (next.config.ts) suppresses the indicator ONLY when
// TERMINAL_E2E_FIXTURE is set — the one flag playwright.config.ts already sets on this suite's
// dev server env for every project, so a local `npm run dev` (no flag) keeps the indicator.
//
// This is the RED-first proof for that fix: before it existed (no `devIndicators` key at all —
// the shape of `next.config.ts` on origin/master before this PR), the dev server always mounts
// the indicator and the DOM check below fails. Reverting the `devIndicators` line in
// next.config.ts (or hard-coding `devIndicators: false` unconditionally, the ORIGINAL/wrong form
// of this fix) both make this spec pass for the wrong reason or fail — either way this spec is
// the thing that would have caught the original defect.
//
// The Next dev overlay always mounts a `<nextjs-portal>` shadow-DOM host on <body> — that
// element exists whether or not the indicator itself is shown (it also hosts the error overlay),
// so it cannot be the query. `devIndicators` controls only the toggle button inside it, which
// carries `data-nextjs-dev-tools-button` (node_modules/next/dist/compiled/next-devtools) — THAT
// is the element the 390 crops actually showed, and the one this test queries for.
const NEXT_DEV_INDICATOR_SELECTOR = "[data-nextjs-dev-tools-button]";

// Evidence matrix (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06 — light n/a, the
// shell is dark-only by construction). One dark/EN/390 crop of /alerts is committed here, taken
// by this same passing run, showing no indicator bubble at the final head.
const PROOF_DIR = join(process.cwd(), "e2e", "proof", "plat-dev-indicator");
mkdirSync(PROOF_DIR, { recursive: true });

test("no Next.js dev indicator on /alerts at 390x844 under the capture flag", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the frozen spec's assertion is the 390x844 viewport specifically");

  await page.goto("/alerts");
  await expect(page.locator(".pg, .main2").first()).toBeVisible({ timeout: 45_000 });
  // The dev overlay script attaches asynchronously after hydration; give it a beat so an
  // eventual mount would have shown up before we assert its absence.
  await page.waitForTimeout(500);

  await expect(page.locator(NEXT_DEV_INDICATOR_SELECTOR)).toHaveCount(0);

  await page.screenshot({ path: join(PROOF_DIR, "dark-en-390-alerts.png"), fullPage: false });
});
