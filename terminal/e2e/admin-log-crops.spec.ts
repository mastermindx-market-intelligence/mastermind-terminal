import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { settled } from "./settle";

// Visual evidence for the /admin Search Log responsive fix — the crops committed under
// `docs/pr-crops/admin-log-responsive/`.
//
// OPT-IN, following the e2e/portfolio-crops.spec.ts and e2e/search-a11y-crops.spec.ts precedent.
// It writes into the repo, so it must never run as part of `test:e2e:responsive`:
//
//   TERMINAL_E2E_PORT=3299 TERMINAL_CROPS=1 \
//     npx playwright test e2e/admin-log-crops.spec.ts --workers=1
//
// Terminal is dark-only (no `[data-theme]` branch in globals.css), so the language pair is the
// axis that matters: the header labels and every state string come from LEX tuples.

test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "admin-log-responsive");
mkdirSync(OUT, { recursive: true });

const SEED = [
  { symbol: "NVDA", source: "chart-search", query: "nvidia earnings" },
  { symbol: "BTC-USD", source: "chart-search", query: "bitcoin" },
  { symbol: "TSLA", source: "positioning-tab", query: "tesla short interest squeeze setup" },
  { symbol: "0700.HK", source: "watchlist-add", query: "tencent" },
  { symbol: "600519", source: "screener", query: "贵州茅台" },
  { symbol: "SPY", source: "gex-desk", query: null },
];

async function open(page: Page, lang: "en" | "zh") {
  for (const row of SEED) {
    await page.request.post("/api/track/search", {
      data: { symbol: row.symbol, source: row.source, ...(row.query ? { query: row.query } : {}) },
    });
  }
  await page.addInitScript((l) => {
    window.localStorage.setItem("mm.lang", l as string);
    document.documentElement.setAttribute("data-lang", l as string);
  }, lang);
  await page.goto("/admin");
  // Not `tbody tr` — that matches the loading state row too, and the crop would be of a spinner.
  await expect(page.locator(".adm-log tbody tr:not(.empty-row)").first()).toBeVisible({ timeout: 60_000 });
}

/** The Log panel, screenshotted only once its box has stopped moving. */
function logPanel(page: Page) {
  return page.locator(".adm-log").locator("xpath=ancestor::div[contains(@class,'panel')][1]");
}

async function shoot(page: Page, path: string) {
  const panel = logPanel(page);
  await panel.scrollIntoViewIfNeeded();
  // Rows arriving (and the KPI panel above resizing) shift this box while it is being measured —
  // an unsettled capture came back as a 235px strip of the panel above it.
  const box = JSON.parse(await settled({
    read: async () => JSON.stringify(await panel.boundingBox()),
    ok: (v) => !!v && v !== "null",
    same: (a, b) => a === b,
    message: "the Log panel never stopped moving",
  })) as { x: number; y: number; width: number; height: number };

  // The dev event store is a process-global ring, so by the last project the log holds every row
  // the suite has ever written. Cap the crop: the evidence is the layout, not the row count.
  const viewport = page.viewportSize()!;
  const y = Math.max(0, box.y);
  await page.screenshot({
    path,
    clip: {
      x: box.x,
      y,
      width: box.width,
      height: Math.min(box.height - (y - box.y), viewport.height - y, 620),
    },
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`search log — ${lang}`, async ({ page }, testInfo) => {
    await open(page, lang);
    await shoot(page, join(OUT, `${testInfo.project.name}-${lang}-log.png`));
  });
}

test("search log — outage state", async ({ page }, testInfo) => {
  await open(page, "en");
  await page.route("**/api/admin/searches**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "events_unavailable" }) }));
  await page.locator(".adm-filters input").fill("ZZZZ");
  await expect(page.locator(".adm-log tr.empty-row td")).toBeVisible({ timeout: 30_000 });
  await shoot(page, join(OUT, `${testInfo.project.name}-en-unavailable.png`));
});
