import { expect, test } from "@playwright/test";
import { openIndicatorLibrary } from "./phoneChrome";

for (const lang of ["en", "zh"] as const) test(`Reversal & Reclaim applies real studies and restores the exact previous workspace (${lang})`, async ({ page }, testInfo) => {
  await page.addInitScript(lang => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mm.inds", JSON.stringify(["ema", "rsix"]));
    localStorage.setItem("mm.indParams", JSON.stringify({ rsix: { "eng.len": 21 }, trend: { "te.sensitivity": 8, "te.autoOpt": true } }));
    (window as Window & { __workflowReady?: boolean }).__workflowReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { (window as Window & { __workflowReady?: boolean }).__workflowReady = true; }, { once: true });
  }, lang);
  await page.goto("/terminal?symbol=NVDA");
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __workflowReady?: boolean }).__workflowReady)), { timeout: 15_000 }).toBe(true);
  const readState = () => page.evaluate(() => ({
    active: JSON.parse(localStorage.getItem("mm.inds") || "[]").sort(),
    params: JSON.parse(localStorage.getItem("mm.indParams") || "{}"),
  }));
  const before = await readState();
  await openIndicatorLibrary(page);
  const library = page.locator(".imodal-library");
  await library.getByTestId("open-chart-workflows").click();
  const card = library.getByTestId("workflow-reversal-reclaim");
  await expect(card).toBeVisible();
  await card.getByTestId("apply-chart-workflow").click();
  await expect(card.getByTestId("apply-chart-workflow")).toBeDisabled();
  await expect.poll(async () => (await readState()).active).toContain("structure");
  const applied = await readState();
  expect(applied.active).toEqual(expect.arrayContaining(["structure", "trend", "rsix", "gaps"]));
  expect(applied.active).not.toContain("ema");
  expect(applied.params.rsix["eng.len"]).toBe(21);
  expect(applied.params.trend["te.sensitivity"]).toBe(8);
  expect(applied.params.trend["te.autoOpt"]).toBe(false);
  await card.screenshot({ path: testInfo.outputPath(`reclaim-workflow-${lang}.png`) });
  await card.getByTestId("view-workflow-chart").click();
  await expect(library).toBeHidden();
  await expect(page.locator(".chart-wrap").first()).toContainText("RSI");
  await page.screenshot({ path: testInfo.outputPath(`reclaim-chart-${lang}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openIndicatorLibrary(page);
  await library.getByRole("button", { name: lang === "en" ? "Systems & Presets 5" : "系统与预设 5", exact: true }).click();
  await library.getByTestId("undo-chart-workflow").click();
  await expect.poll(readState).toEqual(before);
});


for (const tier of ["free", "essential"] as const) test(`workflow respects the existing ${tier} entitlement`, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The actual entitlement boundary is shared across viewports.");
  await page.route("**/api/me", route => route.fulfill({ json: { tier, features: [], status: "active" } }));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await openIndicatorLibrary(page);
  await page.getByTestId("open-chart-workflows").click();
  const button = page.getByTestId("apply-chart-workflow");
  await expect(button).toBeDisabled();
  await expect(button).toHaveText("Requires Pro");
  await expect(page.getByTestId("undo-chart-workflow")).toHaveCount(0);
});

test("a later manual study change invalidates one-step undo without overwriting it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The React workspace state and undo guard are shared.");
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await openIndicatorLibrary(page);
  const library = page.locator(".imodal-library");
  await library.getByTestId("open-chart-workflows").click();
  await library.getByTestId("apply-chart-workflow").click();
  await expect(library.getByTestId("undo-chart-workflow")).toBeVisible();
  await library.getByRole("button", { name: "All indicators", exact: false }).click();
  await library.getByRole("switch", { name: "Volume", exact: true }).click();
  await library.getByTestId("open-chart-workflows").click();
  await expect(library.getByTestId("undo-chart-workflow")).toHaveCount(0);
  await expect(library.getByTestId("apply-chart-workflow")).toBeEnabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.inds") || "[]"))).toContain("vol");
  // Reverting the manual edit must not revive an older one-step undo promise.
  await library.getByRole("button", { name: "All indicators", exact: false }).click();
  await library.getByRole("switch", { name: "Volume", exact: true }).click();
  await library.getByTestId("open-chart-workflows").click();
  await expect(library.getByTestId("apply-chart-workflow")).toBeDisabled();
  await expect(library.getByTestId("undo-chart-workflow")).toHaveCount(0);
});


test("workflow evidence guides return to the same configured workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The existing Guide Center owns the shared return path.");
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await openIndicatorLibrary(page);
  const library = page.locator(".imodal-library");
  await library.getByTestId("open-chart-workflows").click();
  const card = library.getByTestId("workflow-reversal-reclaim");
  await card.getByTestId("apply-chart-workflow").click();
  await card.getByRole("button", { name: "Read the guide", exact: false }).first().click();
  const guide = page.locator(".gp-center");
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("Smart S/R");
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await expect(card.getByTestId("apply-chart-workflow")).toBeDisabled();
  await expect(card.getByTestId("undo-chart-workflow")).toBeVisible();
});
