import { expect, test, type Page } from "@playwright/test";

/**
 * B7 — premium-suite COMPUTATION arrives only when a suite is active.
 *
 * `lib/suites/registry.ts` used to import all 31 module implementations and expose identity AND
 * computation through one graph, so /terminal shipped the whole suite compute before a single
 * premium suite was switched on. The registry is now metadata-only; the implementations sit
 * behind a per-suite dynamic import (lib/suites/compute.ts).
 *
 * The markers below are string literals that exist ONLY in implementation files and in no
 * metadata file, so a hit means the computation itself reached the browser. Labels would prove
 * nothing — they are metadata and correctly stay eager.
 *
 * NOTE ON WHAT THIS SPEC CAN SEE: `npm run dev` splits chunks differently from a production
 * build, so the BYTE evidence for this wave lives in the PR (next build + next start, recorded
 * with e2e/tools/). What this spec fences is the behaviour that must hold in either mode — a
 * suite that is off computes nothing and draws nothing, and a suite that is on still draws
 * exactly what it drew before.
 */

test.setTimeout(120_000);

/** Implementation-only literals, one per suite. */
const COMPUTE_MARKERS: Record<string, string[]> = {
  trend: ["te_retest", "te_flip"],
  structure: ["ob_created", "Swing High"],
  pulse: ["pw-fill"],
  rsix: ["RSI entered overbought"],
  macdx: ["mx-eng-ob"],
};

/** Every JS body the page pulled, so a marker can be searched across the whole download. */
function collectScripts(page: Page): Map<string, string> {
  const bodies = new Map<string, string>();
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/_next/") || !url.includes(".js")) return;
    try { bodies.set(url, await res.text()); } catch { /* redirect / aborted */ }
  });
  return bodies;
}

const hasMarker = (bodies: Map<string, string>, marker: string) =>
  [...bodies.values()].some((body) => body.includes(marker));

async function seedIndicators(page: Page, inds: string[], params: Record<string, unknown> = {}) {
  await page.addInitScript(([i, p]) => {
    localStorage.setItem("mm.inds", JSON.stringify(i));
    localStorage.setItem("mm.indParams", JSON.stringify(p));
    localStorage.setItem("mm.devTier", "pro");
  }, [inds, params] as const);
}

test("with no premium suite active, no suite computation is downloaded", async ({ page }) => {
  const bodies = collectScripts(page);
  await seedIndicators(page, ["ema", "rsi"]);

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(4000);

  const leaked = Object.entries(COMPUTE_MARKERS)
    .flatMap(([suite, markers]) => markers.filter((m) => hasMarker(bodies, m)).map((m) => `${suite}:${m}`));
  expect(
    leaked,
    "suite computation reached a chart with no premium suite active — the eager registry is back",
  ).toEqual([]);

  // …and the chart is fully alive without it: this is not a chart that failed to boot.
  expect(await page.locator(".chart-wrap canvas").count()).toBeGreaterThan(3);
});

test("activating a suite fetches exactly that suite's computation, and it renders", async ({ page }) => {
  const bodies = collectScripts(page);
  await seedIndicators(page, ["trend"], { trend: {} });

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });

  // The active suite's computation arrives…
  await expect
    .poll(() => COMPUTE_MARKERS.trend.every((m) => hasMarker(bodies, m)), { timeout: 45_000 })
    .toBe(true);

  // …and it actually paints. Trend Waves is an overlay suite: its prims live in the price pane.
  await expect(page.locator("svg [data-ic-tip]").first()).toBeAttached({ timeout: 45_000 });

  // The suites that are NOT active stay unfetched — the split is per suite, not all-or-nothing.
  const others = Object.entries(COMPUTE_MARKERS)
    .filter(([suite]) => suite !== "trend")
    .flatMap(([suite, markers]) => markers.filter((m) => hasMarker(bodies, m)).map((m) => `${suite}:${m}`));
  expect(others, "an inactive suite's computation was downloaded too").toEqual([]);
});

test("a pane suite still builds its sub-pane and draws inside its declared range", async ({ page }) => {
  const bodies = collectScripts(page);
  await seedIndicators(page, ["rsix"], { rsix: {} });

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(() => COMPUTE_MARKERS.rsix.every((m) => hasMarker(bodies, m)), { timeout: 45_000 })
    .toBe(true);

  // A pane suite gets its own sub-pane — the allocation the lazy load must not have skipped.
  await expect.poll(async () => page.locator(".chart-wrap canvas").count(), { timeout: 45_000 })
    .toBeGreaterThan(3);
  await expect(page.locator("svg [data-ic-tip]").first()).toBeAttached({ timeout: 45_000 });
});
