import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { toggleToolbarReplay } from "./terminalToolbar";
import { makeLargeTradesFixture } from "../lib/largeTrades/fixtures";

// Bars are explicit chart-coordinate fixtures. Transaction quantities come from the route's
// separately declared deterministic execution fixture; no candle volume enters the study.
const DISPLAY_START = Date.parse("2026-10-05T09:30:00Z") / 1000;
async function prepare(page: Page, lang: "en" | "zh" = "en", theme = "dark", timeframe = "5s") {
  await page.addInitScript(({ lang, theme, timeframe }) => {
    localStorage.setItem("mm.startTf", JSON.stringify(timeframe));
    localStorage.setItem("mm.inds", JSON.stringify(["largeTrades"]));
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("theme", theme);
    localStorage.setItem("theme_auto", "0");
    localStorage.removeItem("mm.ws");
  }, { lang, theme, timeframe });
  await page.route("**/api/intraday?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sym") !== "AAPL") return route.continue();
    const step = timeframe === "1s" ? 1 : 5;
    const bars = Array.from({ length: 300 / step + 1 }, (_, i) => {
      const open = 225 + Math.sin(i / 7) * 0.05;
      const close = 225 + Math.sin((i + 1) / 7) * 0.05;
      return [DISPLAY_START + i * step, open, Math.max(open, close) + 0.04,
        Math.min(open, close) - 0.04, close, 7];
    });
    await route.fulfill({ json: { t: "AAPL", tf: timeframe, source: "large-trades-coordinate-fixture",
      session_date: "2026-10-05", bars } });
  });
  // The coordinate fixture is historical. Keep unrelated realtime quote fixtures from
  // appending a present-day candle and moving this known test window off screen.
  await page.route("**/api/quote?**", (route) => route.fulfill({ json: { quotes: {} } }));
}
async function openFixture(page: Page) {
  await page.goto("/terminal?symbol=AAPL");
  const overlay = page.getByTestId("large-trades-overlay");
  await expect(overlay).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(overlay).toHaveAttribute("data-mode", "fixture");
  await expect(page.getByTestId("large-trade-marker")).toHaveCount(4, { timeout: 45_000 });
  return overlay;
}
async function capture(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  await info.attach(name, { path: file, contentType: "image/png" });
}

for (const variant of [{ lang: "en", theme: "dark" }, { lang: "zh", theme: "dark" }] as const) {
  test("exact executions, reports and responsive inspection " + variant.lang + " " + variant.theme,
    async ({ page }, info) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await prepare(page, variant.lang, variant.theme);
      await openFixture(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      const mark = page.getByTestId("large-trade-marker").filter({ hasText: "1,301" });
      await expect(mark).toHaveAttribute("data-quantity", "1301");
      await expect(mark).toHaveAttribute("data-trade-count", "3");
      await expect(mark).toHaveAttribute("data-side-method", "exchange");
      await expect(page.getByTestId("large-trades-dock")).toContainText("2026-10-05");
      await expect(page.getByTestId("large-trades-dock")).toContainText("Synthetic fixture");
      await capture(page, info, "large-trades-" + variant.lang + "-" + variant.theme + "-chart");
      // The accessible list is the canonical compact-screen path even when large bubbles overlap.
      if (info.project.name === "desktop" && variant.lang === "en") await mark.click();
      else await page.getByTestId("large-trades-inspect").click();
      const panel = page.getByTestId("large-trades-inspector");
      await expect(panel).toBeVisible();
      await panel.getByTestId("large-trade-list-item").filter({ hasText: "1,301" }).click();
      const detail = page.getByTestId("large-trade-detail");
      await expect(detail).toContainText(variant.lang === "en" ? "Distinct orders" : "独立委托数");
      await expect(detail).toContainText(variant.lang === "en" ? "Not available" : "不可得");
      await capture(page, info, "large-trades-" + variant.lang + "-" + variant.theme + "-inspection-overview");
      await detail.getByTestId("large-trade-reports").locator("summary").click();
      await expect(detail.getByTestId("large-trade-reports").locator("li")).toHaveCount(3);
      await expect(detail.getByTestId("large-trade-reports")).toContainText("500");
      await expect(detail.getByTestId("large-trade-reports")).toContainText("501");
      await expect(detail.getByTestId("large-trade-reports")).toContainText("300");
      await expect(detail.getByTestId("large-trade-reports")).toContainText("2026-10-05T13:30:10.100000000Z");
      const close = panel.getByRole("button", { name: variant.lang === "en" ? "Close trade inspection" : "关闭成交详情", exact: true });
      await expect(close).toBeInViewport();
      if (info.project.name === "mobile") {
        // The workspace's fullscreen button must not paint over evidence or intercept Close.
        expect(await page.evaluate(() => {
          const fs = document.querySelector(".chart-fs-float")!.getBoundingClientRect();
          const hit = document.elementFromPoint(fs.x + fs.width / 2, fs.y + fs.height / 2);
          return !!hit?.closest('[data-testid="large-trades-inspector"]');
        })).toBe(true);
      }
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      await capture(page, info, "large-trades-" + variant.lang + "-" + variant.theme + "-inspection");
      if (variant.lang === "en") {
        await panel.getByTestId("large-trade-list-item").filter({ hasText: "1,500" }).click();
        await expect(panel.locator('[data-response-state="failed_continuation"]')).toBeVisible();
        await panel.getByTestId("large-trade-list-item").filter({ hasText: "1,600" }).click();
        await expect(panel.locator('[data-response-state="continued"]')).toBeVisible();
        await capture(page, info, "large-trades-adverse-selling-continued");
      }
      if (info.project.name === "mobile") await close.click();
      else await panel.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(page.getByTestId("large-trades-inspect")).toBeFocused();
      expect(errors.filter((error) => /LargeTrades|large.trades|QUANTITY_OVERFLOW/i.test(error))).toEqual([]);
    });
}

test("settings cap quantity markers and expose adaptive warmup", async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page);
  await openFixture(page);
  await page.getByTestId("large-trades-dock").getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.locator(".ind-set");
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Style", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Maximum displayed clusters", exact: true }).fill("2");
  await expect(page.getByTestId("large-trade-marker")).toHaveCount(2);
  await expect(page.getByTestId("large-trades-truncated")).toContainText("Showing 2 of 4 qualifying clusters.");
  await page.getByRole("switch", { name: "Show exact quantity labels", exact: true }).click();
  await expect(page.getByTestId("large-trade-marker").first()).toHaveText("");
  await settings.getByRole("button", { name: "Inputs", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Prior clusters retained", exact: true }).fill("100");
  await page.getByRole("spinbutton", { name: "Minimum calibration samples", exact: true }).fill("20");
  await page.getByRole("spinbutton", { name: "Maximum limited response (ticks)", exact: true }).fill("3");
  await page.getByRole("spinbutton", { name: "Minimum reversal (ticks)", exact: true }).fill("4");
  await page.getByRole("switch", { name: "Use prior-sample percentile", exact: true }).click();
  await expect(page.getByTestId("large-trade-marker")).toHaveCount(0);
  await expect(page.getByTestId("large-trades-dock")).toContainText("need more prior samples");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.indParams") || "{}").largeTrades))
    .toMatchObject({ baselineCount: 100, minBaseline: 20, maxResponseTicks: 3, reversalTicks: 4,
      maxMarkers: 2, showLabels: false, adaptive: true });
  await page.reload();
  await expect(page.getByTestId("large-trades-overlay")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(page.getByTestId("large-trades-dock")).toContainText("need more prior samples");
  await page.getByTestId("large-trades-dock").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Prior clusters retained", exact: true })).toHaveValue("100");
  await expect(page.getByRole("spinbutton", { name: "Minimum calibration samples", exact: true })).toHaveValue("20");
  await expect(page.getByRole("spinbutton", { name: "Maximum limited response (ticks)", exact: true })).toHaveValue("3");
  await expect(page.getByRole("spinbutton", { name: "Minimum reversal (ticks)", exact: true })).toHaveValue("4");
});

test("canonical replay excludes future executions and waits for price response", async ({ page }, info) => {
  test.setTimeout(120_000);
  await prepare(page, "en", "dark", "1s");
  await openFixture(page);
  await toggleToolbarReplay(page);
  const rail = page.locator("[data-replay-rail]");
  await expect(rail).toBeVisible();
  const slider = rail.getByRole("slider");
  await slider.focus();
  await slider.press("Home");
  // Canonical Replay starts at index20. At one-second resolution only the first
  // 10.2s cluster is known; the70s sell reports remain absent.
  await expect(page.getByTestId("large-trade-marker")).toHaveCount(1);
  await expect(page.getByTestId("large-trade-marker")).toHaveAttribute("data-quantity", "1301");
  await page.getByTestId("large-trades-inspect").click();
  await expect(page.locator('[data-response-state="pending"]')).toBeVisible();
  await capture(page, info, "large-trades-replay-pending");
  await page.getByTestId("large-trades-inspector").press("Escape");
  await slider.focus();
  for (let i = 0; i < 25; i++) await slider.press("ArrowRight");
  await page.getByTestId("large-trades-inspect").click();
  await expect(page.locator('[data-response-state="limited_response"]')).toBeVisible();
  await capture(page, info, "large-trades-replay-observed");
});

test("unavailable transaction source never turns coordinate candle volume into markers", async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page);
  await page.route("**/api/large-trades?**", (route) => route.fulfill({
    json: { state: "unavailable", reason: "feed_not_published" },
  }));
  await page.goto("/terminal?symbol=AAPL");
  await expect(page.getByTestId("large-trades-overlay")).toHaveAttribute("data-state", "unavailable", { timeout: 60_000 });
  await expect(page.getByTestId("large-trade-marker")).toHaveCount(0);
  await expect(page.getByTestId("large-trades-dock")).toContainText("has not been published");
});

test("an exact-arithmetic overflow is isolated as invalid evidence", async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page);
  const envelope = makeLargeTradesFixture();
  envelope.prints = envelope.prints.map((p) => ({ ...p, quantity: Number.MAX_SAFE_INTEGER }));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/large-trades?**", (route) => route.fulfill({ json: {
    state: "ready", envelope, artifactSha256: null,
    servedAtNs: (BigInt(Date.now()) * BigInt(1000000)).toString(),
  } }));
  await page.goto("/terminal?symbol=AAPL");
  await expect(page.getByTestId("large-trades-overlay")).toHaveAttribute("data-state", "invalid", { timeout: 60_000 });
  await expect(page.getByTestId("large-trade-marker")).toHaveCount(0);
  await expect(page.getByTestId("large-trades-dock")).toContainText("failed validation");
  await expect(page.locator(".chart-wrap").first()).toBeVisible();
  expect(errors.filter((error) => /QUANTITY_OVERFLOW|LargeTrades/i.test(error))).toEqual([]);
});

test("the canonical language event retitles the mounted legend, inspector and settings", async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page);
  await openFixture(page);
  const switchLang = async (lang: "en" | "zh") => {
    // Existing LangProvider contract, also exercised by the repository's locale tests.
    await page.evaluate((value) => {
      localStorage.setItem("mm.lang", value);
      document.documentElement.setAttribute("data-lang", value);
      window.dispatchEvent(new CustomEvent("mm:lang"));
    }, lang);
  };
  await switchLang("zh");
  await expect(page.getByTestId("large-trades-dock")).toContainText("大额成交");
  await expect(page.locator(".lg-name").filter({ hasText: /^大额成交$/ })).toHaveCount(1);
  await page.getByTestId("large-trades-inspect").click();
  await expect(page.getByTestId("large-trades-inspector")).toHaveAttribute("aria-label", "大额成交详情");
  await page.getByTestId("large-trades-inspector").press("Escape");
  await page.getByTestId("large-trades-dock").getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "最低实际成交量", exact: true })).toBeVisible();
  await page.locator(".ind-set").press("Escape");
  await switchLang("en");
  await expect(page.getByTestId("large-trades-dock")).toContainText("Large trades");
  await expect(page.locator(".lg-name").filter({ hasText: /^Large trades$/ })).toHaveCount(1);
});


test("settings normalize stored bounds and persist the exact applied criteria", async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("large-trades-bounds-seeded")) return;
    sessionStorage.setItem("large-trades-bounds-seeded", "1");
    localStorage.setItem("mm.indParams", JSON.stringify({ largeTrades: {
      minQuantity: 100.4, maxGapMs: 60000, percentile: 1, responseWindowMs: 3600000,
      maxMarkers: 9999, baselineCount: 4, minBaseline: -1, maxResponseTicks: -3,
      reversalTicks: 0, adaptive: false,
    } }));
  });
  await openFixture(page);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("mm.indParams") || "{}").largeTrades);
  await expect.poll(saved).toMatchObject({ minQuantity: 100, maxGapMs: 10000,
    percentile: 50, responseWindowMs: 300000, maxMarkers: 1000, baselineCount: 10,
    minBaseline: 2, maxResponseTicks: 0, reversalTicks: 1 });
  await page.getByTestId("large-trades-dock").getByRole("button", { name: "Settings", exact: true }).click();
  const field = (name: string) => page.getByRole("spinbutton", { name, exact: true });
  await expect(field("Maximum gap (milliseconds)")).toHaveValue("10000");
  await expect(field("Maximum gap (milliseconds)")).toHaveAttribute("max", "10000");
  await expect(field("Prior-sample percentile")).toHaveValue("50");
  await expect(field("Prior-sample percentile")).toHaveAttribute("min", "50");
  await expect(field("Prior-sample percentile")).toHaveAttribute("max", "100");
  await expect(field("Response window (milliseconds)")).toHaveValue("300000");
  await expect(field("Response window (milliseconds)")).toHaveAttribute("min", "1000");
  await expect(field("Response window (milliseconds)")).toHaveAttribute("max", "300000");
  await field("Maximum gap (milliseconds)").fill("60000");
  await field("Prior-sample percentile").fill("99.99");
  await field("Response window (milliseconds)").fill("1");
  await field("Minimum executed quantity").fill("1000.4");
  await expect(field("Maximum gap (milliseconds)")).toHaveValue("10000");
  await expect(field("Prior-sample percentile")).toHaveValue("100");
  await expect(field("Response window (milliseconds)")).toHaveValue("1000");
  await expect(field("Minimum executed quantity")).toHaveValue("1000");
  await page.locator(".ind-set").getByRole("button", { name: "Style", exact: true }).click();
  await expect(field("Maximum displayed clusters")).toHaveAttribute("max", "1000");
  await field("Maximum displayed clusters").fill("9999");
  await expect(field("Maximum displayed clusters")).toHaveValue("1000");
  await page.locator(".ind-set").press("Escape");
  await expect.poll(saved).toMatchObject({ minQuantity: 1000, maxGapMs: 10000,
    percentile: 100, responseWindowMs: 1000, maxMarkers: 1000 });
  await page.reload();
  await openFixture(page);
  await expect.poll(saved).toMatchObject({ minQuantity: 1000, maxGapMs: 10000,
    percentile: 100, responseWindowMs: 1000, maxMarkers: 1000 });
  await page.getByTestId("large-trades-inspect").click();
  const detail = page.getByTestId("large-trade-detail");
  await expect(detail.getByText("Applied threshold", { exact: true })
    .locator("xpath=following-sibling::dd[1]")).toHaveText("1,000 shares");
});
