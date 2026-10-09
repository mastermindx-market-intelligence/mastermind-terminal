import { expect, test } from "@playwright/test";

const macroOrigin = process.env.MMX_MACRO_FIXTURE_ORIGIN;
test.skip(!macroOrigin || process.env.MMX_INVESTOR_SHELL_PREVIEW !== "1", "Requires the explicit read-only Macro source fixture");

test("retained Macro controller opens native Analysis and returns to the same mounted page", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Mobile dismissal has its existing #697 owner");
  const native = new URL(baseURL!);
  const macro = new URL(macroOrigin!);
  // This proof is deliberately local-only. Never aim this test at customer
  // origins or use its transport mapping as authorization/hosting evidence.
  for (const origin of [native, macro]) {
    expect(["127.0.0.1", "localhost"]).toContain(origin.hostname);
    expect(origin.protocol).toBe("http:");
  }
  const target = `${macro.origin}/macro.html#overview`;
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if ([native.origin, macro.origin].includes(url.origin) && ["GET", "HEAD"].includes(request.method())) {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
  const failedRequests: string[] = [];
  context.on("requestfailed", request => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  await page.addInitScript((origin) => {
    const state = window as Window & { MM_TERMINAL_BASE?: string; __investorBridgeVisualReady?: boolean };
    state.MM_TERMINAL_BASE = `${origin}/terminal`;
    state.__investorBridgeVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { state.__investorBridgeVisualReady = true; }, { once: true });
  }, native.origin);
  const response = await page.goto(target, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  const trigger = page.locator(".site-nav .terminal-link");
  await expect(trigger).toBeVisible();
  expect(await trigger.getAttribute("href")).toBe("https://app.mastermind-x.com");
  // Only the endpoint is mapped for loopback transport. Both real controllers,
  // their from/ret/embed protocol and all page content remain unchanged.
  await trigger.evaluate((node, origin) => { (node as HTMLAnchorElement).href = `${origin}/terminal`; }, native.origin);
  await page.evaluate(() => {
    (window as Window & { __investorBridgeOriginalDocument?: boolean }).__investorBridgeOriginalDocument = true;
  });
  await trigger.click();
  const iframe = page.locator(`iframe[src^="${native.origin}/"]`);
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  const entry = new URL((await iframe.getAttribute("src"))!);
  expect(entry.searchParams.get("from")).toBe("macro");
  expect(entry.searchParams.get("ret")).toBe(target);
  expect(entry.searchParams.get("embed")).toBe("dashboard");
  const frame = page.frameLocator(`iframe[src^="${native.origin}/"]`);
  const contentFrame = await (await iframe.elementHandle())!.contentFrame();
  await expect.poll(() => contentFrame!.evaluate(() => Boolean((window as Window & { __investorBridgeVisualReady?: boolean }).__investorBridgeVisualReady)), { timeout: 15_000 }).toBe(true);
  const analysis = frame.locator("nav.appnav").getByRole("link", { name: "Analysis", exact: true });
  const analysisHref = await analysis.getAttribute("href");
  await analysis.click();
  try {
    await expect(frame.locator('[data-investor-shell="preview"]')).toBeVisible({ timeout: 15_000 });
  } catch (error) {
    await testInfo.attach("bridge-navigation-observation", { body: JSON.stringify({ analysisHref, pages: context.pages().map(p => ({ url: p.url(), frames: p.frames().map(f => f.url()) })), failedRequests }, null, 2), contentType: "application/json" });
    throw error;
  }
  await page.screenshot({ path: testInfo.outputPath("macro-native-analysis.png") });
  await frame.locator("header.topbar .brand-back").click();
  await expect(iframe).toBeHidden({ timeout: 10_000 });
  await expect(page).toHaveURL(target);
  expect(await page.evaluate(() => (window as Window & { __investorBridgeOriginalDocument?: boolean }).__investorBridgeOriginalDocument)).toBe(true);
  await expect(trigger).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("macro-retained-return.png") });
});
