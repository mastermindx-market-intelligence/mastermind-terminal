import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { browserFuturesFixture } from "./fixtures/futuresPublished";
import { parseFuturesRequest } from "../lib/futuresRequest";
async function prepare(page: Page) {
  const baseURL = test.info().project.use.baseURL || process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${process.env.TERMINAL_E2E_PORT || 3596}`;
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL }]);
}
async function noOverflow(page: Page) {
  const geometry = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const panels = [...document.querySelectorAll('[data-testid="futures-workspace"], [data-testid="futures-chart"], [data-testid="futures-workspace"] button, [data-testid="futures-workspace"] select')]
      .map(el => ({ tag: el.tagName, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }));
    return { documentFits: document.documentElement.scrollWidth <= width + 1, clipped: panels.filter(r => r.left < -1 || r.right > width + 1) };
  });
  expect(geometry.documentFits).toBe(true);
  expect(geometry.clipped).toEqual([]);
}
async function crop(page: Page, name: string) {
  const dir = process.env.FUTURES_WORKSPACE_EVIDENCE_DIR; if (!dir) return;
  mkdirSync(dir, { recursive: true });
  // Caption is injected by this test only; it is not a production source or UI toggle.
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="futures-workspace"]');
    if (!host || host.querySelector('[data-test-fixture-caption]')) return;
    const label = document.createElement('p'); label.dataset.testFixtureCaption = "true";
    label.textContent = "SYNTHETIC HTTP FIXTURE · PRODUCTION-ROUTE ACCEPTANCE TEST";
    label.style.cssText = 'padding:8px;border:1px solid #cca95f;color:#e6cd8c;font-size:12px'; host.prepend(label);
  });
  await page.screenshot({ path: path.join(dir, name + ".png"), fullPage: true });
}
async function reply(page: Page, outcome: () => string = () => "ok") {
  await page.route("**/api/futures?*", async route => {
    const query = parseFuturesRequest(new URL(route.request().url()).searchParams); if (!query) throw Error("bad UI query");
    const result = outcome();
    if (result !== "ok" && result !== "wrong-root" && result !== "stale") return route.fulfill({ status: result === "denied" ? 403 : 503,
      json: { error: result === "denied" ? "access_required" : result } });
    const data = browserFuturesFixture(query);
    if (result === "wrong-root") data.contract = query.pair === "ES" ? "NQZ6" : "ESZ6";
    if (result === "stale") { data.basis = "delayed"; data.availabilityBasis = "source_observed"; }
    await route.fulfill({ json: data, headers: { "Cache-Control": "private, no-store" } });
  });
}
test("existing Options navigation opens the production futures route and shares gamma across views", async ({ page }, info) => {
  await prepare(page); await reply(page);
  await page.goto("/options?tab=gex");
  const link = page.getByTestId("options-futures-link"); await expect(link).toBeVisible();
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await link.click(); await expect(page).toHaveURL(/\/options\/futures/);
  const view = page.getByTestId("futures-workspace"); await expect(view).toBeVisible();
  await expect(page.getByTestId("futures-chart")).toHaveAttribute("data-contract", "ESZ6");
  await expect(page.getByTestId("futures-volume")).toHaveText("4,203");
  const levels = await page.getByTestId("mapped-level").allTextContents(); expect(levels).toHaveLength(3);
  await crop(page, `${info.project.name}-options-futures-depth-en`);
  await page.getByRole("tab", { name: "Footprint", exact: true }).click();
  expect(await page.getByTestId("mapped-level").allTextContents()).toEqual(levels);
  await expect(page.getByTestId("futures-volume-profile")).toBeVisible(); await noOverflow(page);
  await page.getByLabel("Instrument", { exact: true }).selectOption("NQ");
  await expect(page.getByTestId("futures-chart")).toHaveAttribute("data-contract", "NQZ6");
  await expect(page.getByTestId("futures-volume")).toHaveText("4,202");
  await page.getByLabel("Expiry lens", { exact: true }).selectOption("zero"); await expect(page.getByTestId("mapped-level")).toHaveCount(3);
  await page.getByLabel("Interval", { exact: true }).selectOption("5"); await expect(page.getByTestId("futures-volume")).toHaveText("4,202");
  await crop(page, `${info.project.name}-options-futures-footprint-nq-en`);
  await noOverflow(page); expect(errors).toEqual([]);
});
test("denied refresh and wrong-root data clear previously visible chart values", async ({ page }, info) => {
  await prepare(page); let outcome = "ok"; await reply(page, () => outcome);
  await page.goto("/options/futures?pair=ES"); await expect(page.getByTestId("futures-chart")).toBeVisible();
  outcome = "denied"; await page.getByRole("button", { name: "Refresh source", exact: true }).click();
  await expect(page.getByTestId("futures-unavailable")).toContainText("access could not be confirmed");
  await expect(page.getByTestId("futures-chart")).toHaveCount(0); await expect(page.getByTestId("mapped-level")).toHaveCount(0);
  await crop(page, `${info.project.name}-options-futures-access-lost`);
  outcome = "wrong-root"; await page.getByRole("button", { name: "Refresh source", exact: true }).click();
  await expect(page.getByTestId("futures-unavailable")).toContainText("source checks"); await expect(page.getByTestId("futures-chart")).toHaveCount(0);
  outcome = "stale"; await page.getByRole("button", { name: "Refresh source", exact: true }).click();
  await expect(page.getByTestId("futures-unavailable")).toContainText("out of date"); await expect(page.getByTestId("futures-chart")).toHaveCount(0);
  await noOverflow(page);
});
test("missing source, replay cutoff and shared-language labels remain honest", async ({ page }, info) => {
  await prepare(page); let outcome = "source_unavailable"; await reply(page, () => outcome);
  await page.goto("/options/futures?pair=NQ");
  await expect(page.getByTestId("futures-unavailable")).toContainText("No sample data"); await expect(page.getByTestId("futures-chart")).toHaveCount(0);
  await crop(page, `${info.project.name}-options-futures-no-source-en`);
  outcome = "ok"; await page.getByRole("button", { name: "Refresh source", exact: true }).click();
  await expect(page.getByTestId("futures-chart")).toHaveAttribute("data-contract", "NQZ6");
  const selector = page.getByLabel("Published replay frames", { exact: true });
  const first = await selector.locator('option').nth(1).getAttribute('value'); await selector.selectOption(first!);
  await expect(page.getByTestId("futures-volume")).not.toHaveText("4,202");
  await expect(page).toHaveURL(/at=/); await page.getByRole("button", { name: "Language", exact: true }).click();
  await expect(page.getByTestId("futures-workspace")).toHaveAttribute("lang", "zh");
  await expect(page.getByTestId("futures-workspace")).not.toContainText("Displayed liquidity");
  await crop(page, `${info.project.name}-options-futures-replay-zh`);
  await noOverflow(page);
  const small = await page.getByTestId("futures-workspace").locator("button,select").evaluateAll(es => es.filter(e => e.getBoundingClientRect().height < 43).length);
  expect(small).toBe(0);
});
test("the real API has no fixture bypass despite the development page preview", async ({ page }) => {
  await prepare(page);
  const response = await page.request.get("/api/futures?pair=ES");
  expect(response.status()).toBe(403); expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: "access_required" });
});

test("an old instrument response cannot overwrite a newer selection", async ({ page }) => {
  await prepare(page);
  let releaseOld: () => void = () => {}; let esStarted = false;
  const hold = new Promise<void>(resolve => { releaseOld = resolve; });
  await page.route("**/api/futures?*", async route => {
    const request = parseFuturesRequest(new URL(route.request().url()).searchParams)!;
    if (request.pair === "ES") { esStarted = true; await hold; }
    try { await route.fulfill({ json: browserFuturesFixture(request) }); } catch { /* old aborted request has no recipient */ }
  });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto("/options/futures?pair=ES");
    await expect.poll(() => esStarted).toBe(true);
    await page.getByLabel("Instrument", { exact: true }).selectOption("NQ");
    await expect(page.getByTestId("futures-chart")).toHaveAttribute("data-contract", "NQZ6");
    releaseOld();
    await page.getByRole("tab", { name: "Footprint", exact: true }).click();
    await expect(page.getByTestId("futures-volume")).toHaveText("4,202");
    await expect(page.getByTestId("futures-chart")).toHaveAttribute("data-contract", "NQZ6");
    expect(errors).toEqual([]); await noOverflow(page);
  } finally { releaseOld(); }
});
