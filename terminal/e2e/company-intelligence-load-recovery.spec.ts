import { expect, test, type Page } from "@playwright/test";
import workspace from "../lib/__tests__/fixtures/aapl-event-workspace.json";

const FIXED = new Date("2026-11-09T00:00:00Z");
const EVENT = "evt_cik0000320193_2026q3_results";
const payload = {
  ok: true, state: "ready", available: true, event_id: EVENT, workspace,
  authority: "context_only", is_context_only: true, display_only: true,
  receipt: { generation_id: workspace.generation_id, workspace_sha256: "a".repeat(64), marker_sha256: "b".repeat(64),
    workspace_url: `https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev/company_intelligence/event_workspaces/generations/${workspace.generation_id}/workspaces/${EVENT}.json` },
};
const failed = { ok: false, state: "error", available: false, error: { code: "upstream_unavailable", message: "Current source is temporarily unavailable", retryable: true } };
const absent = { ok: false, state: "error", error: { code: "not_found", message: "Company intelligence is not covered", retryable: false } };

async function setup(page: Page, lang: "en" | "zh") {
  await page.addInitScript(value => { localStorage.setItem("mm.lang", value); document.documentElement.setAttribute("data-lang", value); }, lang);
  await page.route("https://www.mastermind-x.com/mm_brain.js", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  // Exercise the same standard reader through beta's ordinary unpinned fallback.
  // The real production admission is not changed; this is the existing local fixture surface.
  await page.route("**/api/investigations/baseline?**", route => route.fulfill({ status: 503, json: { status: "unavailable" } }));
  await page.route("**/api/company-intelligence/AAPL**", route => route.fulfill({ status: 404, json: absent }));
  await page.route("**/api/company-theme-context/AAPL**", route => route.fulfill({ status: 404, json: absent }));
  await page.route("**/api/company-institutional-context/AAPL**", route => route.fulfill({ status: 404, json: absent }));
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

for (const lang of ["en", "zh"] as const) {
  test(`stalled Intelligence read becomes retryable and recovers the actual workspace (${lang})`, async ({ page }, info) => {
    await setup(page, lang); await page.clock.install({ time: FIXED });
    const attempts = new Set<string>(); let release!: () => void;
    const parked = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/event-workspace/AAPL**", async route => {
      // Development Strict Mode can repeat a mount; qualify the read nonce, not request count.
      const attempt = new URL(route.request().url()).searchParams.get("retry") ?? "missing";
      attempts.add(attempt);
      if (attempt === "0") await parked;
      await route.fulfill({ json: payload }).catch(error => {
        // The first request is deliberately aborted by the page deadline.
        if (attempt !== "0") throw error;
      });
    });
    try {
      await page.goto("/analysis?symbol=AAPL&page=intelligence");
      await expect.poll(() => attempts.has("0")).toBe(true);
      await expect(page.locator('.ci-page[aria-busy="true"]')).toBeVisible();
      await page.clock.fastForward(15_001);
      const retry = page.getByRole("button", { name: lang === "zh" ? "重试" : "Retry", exact: true });
      await expect(retry).toBeVisible(); await expect(page.locator('.ci-page[aria-busy="true"]')).toHaveCount(0);
      await expect(page.locator('[data-ci-plane="event_workspace.v1"]')).toHaveCount(0);
      await noOverflow(page);
      await page.screenshot({ animations: "disabled", path: info.outputPath(`${lang}-read-deadline.png`) });
      release(); await retry.click();
      await expect.poll(() => attempts.has("1")).toBe(true);
      await expect(page.locator(`[data-ci-event-id="${EVENT}"]`)).toBeVisible();
      await expect(page.locator('[data-ci-generation-id]')).toHaveAttribute('data-ci-generation-id', workspace.generation_id);
      await expect(page).toHaveURL(/\/analysis\?symbol=AAPL&page=intelligence$/);
      await page.locator("#ci-tab-results").click(); await expect(page.locator("#ci-tab-results")).toHaveAttribute("aria-selected", "true");
      await noOverflow(page);
      await page.screenshot({ animations: "disabled", path: info.outputPath(`${lang}-read-recovered.png`) });
    } finally { release(); }
  });
  test(`Retry is independent of wall-clock resolution (${lang})`, async ({ page }) => {
    await setup(page, lang); await page.clock.setFixedTime(FIXED);
    const attempts = new Set<string>();
    await page.route("**/api/event-workspace/AAPL**", route => {
      // Development Strict Mode can repeat a mount; qualify the read nonce, not request count.
      const attempt = new URL(route.request().url()).searchParams.get("retry") ?? "missing";
      attempts.add(attempt);
      return route.fulfill({ json: attempt === "2" ? payload : failed });
    });
    await page.goto("/analysis?symbol=AAPL&page=intelligence");
    const retry = page.getByRole("button", { name: lang === "zh" ? "重试" : "Retry", exact: true });
    await expect(retry).toBeVisible(); await retry.click();
    await expect.poll(() => attempts.has("1")).toBe(true); await expect(retry).toBeVisible(); await retry.click();
    await expect.poll(() => attempts.has("2")).toBe(true);
    await expect(page.locator(`[data-ci-event-id="${EVENT}"]`)).toBeVisible();
    await noOverflow(page);
  });
}
