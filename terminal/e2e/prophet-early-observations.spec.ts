import { expect, test, type Page, type TestInfo } from "@playwright/test";
import nativeSource from "../test-fixtures/prophet_wmko_observations_fixture.json";

async function expectPhoneLauncherAtFold(page: Page, testInfo: TestInfo, budget: number | null, label: string, crop: string) {
  if (page.viewportSize()!.width > 640) return;
  const launcher = page.getByTestId("intelligence-launcher");
  const early = page.getByTestId("prophet-observation-launcher");
  const geometry = await launcher.evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, height: el.getBoundingClientRect().height, fold: window.innerHeight }));
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.fold + 1);
  expect(budget).not.toBeNull();
  expect(geometry.height).toBeLessThanOrEqual(budget!);
  await testInfo.attach(crop.replace(".png", "-geometry.json"), { body: JSON.stringify({ ...geometry, budget }), contentType: "application/json" });
  expect(await early.innerText()).toContain(label);
  expect(await early.innerText()).toContain("2026-10-16");
  expect(await early.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(crop) });
}

// Native committed source → backend query JSON → real client hook → shared launcher/workspace.
// Auth and source transport are local fixtures, not authenticated production evidence.
test("WM and KO evidence remains dated, source-bound and usable at every supported width", async ({ page, context, baseURL }, testInfo) => {
  const user = {
    id: "e2e-user-default", aud: "authenticated", role: "authenticated",
    email: "responsive@example.com", app_metadata: {}, user_metadata: {},
    created_at: "2026-10-18T00:00:00.000Z",
  };
  const session = {
    access_token: "fixture-access-token", refresh_token: "fixture-refresh-token",
    token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  };
  await context.addCookies([{
    name: "sb-127-auth-token.0",
    value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
    url: baseURL!,
  }]);
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    const ready = window as Window & { __mmProphetReady?: boolean };
    ready.__mmProphetReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { ready.__mmProphetReady = true; }, { once: true });
  });
  await page.route("**/auth/v1/**", route => route.fulfill({ status: 200, json: user }));
  // The house market fixture predates both tickers. Extend only its symbol picker metadata;
  // no fixture quote, verdict or Prophet event is fabricated for either company.
  await page.route("**/data/manifest.json", async route => {
    const response = await route.fetch();
    const manifest = await response.json();
    manifest.symbols.KO = { name: "Coca-Cola", sec: "Equities" };
    manifest.symbols.WM = { name: "Waste Management", sec: "Equities" };
    await route.fulfill({ response, json: manifest });
  });
  const requests: string[] = [];
  await page.route("**/api/prophet/observations?*", async route => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") ?? "";
    requests.push(ticker);
    if (ticker !== "KO" && ticker !== "WM") {
      await route.fulfill({ status: 503, json: { status: "UNAVAILABLE" } });
      return;
    }
    await route.fulfill({
      status: 200, json: nativeSource.responses[ticker],
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" },
    });
  });

  let phoneLauncherBudget: number | null = null;
  if (page.viewportSize()!.width <= 640) {
    // Measure the existing full-chart fold budget without inventing KO quote/history data.
    await page.goto("/terminal?symbol=NVDA");
    await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __mmProphetReady?: boolean }).__mmProphetReady)), { timeout: 20_000 }).toBe(true);
    phoneLauncherBudget = await page.getByTestId("intelligence-launcher").evaluate(el => window.innerHeight + 1 - el.getBoundingClientRect().top);
  }
  await page.goto("/terminal?symbol=KO");
  await expect.poll(() => requests.includes("KO"), { timeout: 45_000 }).toBe(true);
  const launcher = page.getByTestId("intelligence-launcher");
  const early = page.getByTestId("prophet-observation-launcher");
  await expect(early).toContainText("Early evidence");
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __mmProphetReady?: boolean }).__mmProphetReady)), { timeout: 20_000 }).toBe(true);
  // A dated ready response must fit the same phone fold as the unavailable source.
  await expectPhoneLauncherAtFold(page, testInfo, phoneLauncherBudget, "Early evidence — review", "ko-launcher-fold-en.png");
  await launcher.scrollIntoViewIfNeeded();
  await launcher.click();
  const workspace = page.getByTestId("intelligence-workspace");
  await expect(workspace).toHaveAttribute("data-phase", "open");
  await workspace.getByRole("tab", { name: "Research", exact: true }).click();
  const evidence = page.getByTestId("workspace-prophet-observations");
  await expect(evidence).toContainText("$93.90");
  await expect(evidence).toContainText("$85.65");
  await expect(evidence).toContainText("+9.63%");
  await expect(evidence).toContainText("Price as of 2026-10-16");
  await expect(evidence).toContainText("Confirmed · T2");
  await expect(evidence).toContainText("Watch evidence, not an entry instruction");
  await evidence.scrollIntoViewIfNeeded();
  expect(await evidence.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("ko-source-evidence-en.png") });

  await page.evaluate(() => {
    localStorage.setItem("mm.lang", "zh");
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await expect(evidence).toContainText("价格日期 2026-10-16");
  await expect(evidence).toContainText("观察依据，非入场指令");
  await page.screenshot({ path: testInfo.outputPath("ko-source-evidence-zh.png") });

  await workspace.getByRole("button", { name: "关闭情报工作区", exact: true }).click();
  await expect(workspace).toHaveCount(0);
  await expectPhoneLauncherAtFold(page, testInfo, phoneLauncherBudget, "早期迹象 · 待评估", "ko-launcher-fold-zh.png");
  const symbolPicker = page.viewportSize()!.width <= 860 ? page.locator(".m-symbar") : page.locator(".pair");
  await symbolPicker.click();
  const dialog = page.locator(".smodal, .msheet-search").first();
  await expect(dialog).toBeVisible();
  await dialog.locator("input[role=combobox]").fill("WM");
  await dialog.getByRole("option", { name: "W WM Waste Management", exact: true }).click();
  await expect.poll(() => requests.includes("WM")).toBe(true);
  await expect(early).toContainText("未纳入此扫描");
  await expectPhoneLauncherAtFold(page, testInfo, phoneLauncherBudget, "未纳入此扫描", "wm-launcher-fold-zh.png");
  if (page.viewportSize()!.width <= 640) {
    await page.evaluate(() => {
      localStorage.setItem("mm.lang", "en");
      document.documentElement.setAttribute("data-lang", "en");
      window.dispatchEvent(new CustomEvent("mm:lang"));
    });
    await expect(early).toContainText("Not monitored by this scan");
    await expectPhoneLauncherAtFold(page, testInfo, phoneLauncherBudget, "Not monitored by this scan", "wm-launcher-fold-en.png");
    await page.evaluate(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      window.dispatchEvent(new CustomEvent("mm:lang"));
    });
    await expect(early).toContainText("未纳入此扫描");
  }
  await launcher.scrollIntoViewIfNeeded();
  await launcher.click();
  await expect(evidence).toContainText("未纳入此扫描");
  await expect(evidence).not.toContainText("$93.90");
  await expect(evidence).not.toContainText("2026-10-02");
  expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("wm-source-coverage-zh.png") });
});
