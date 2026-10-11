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
    const symbol = url.searchParams.get("sym");
    if (symbol !== "AAPL" && symbol !== "NVDA") return route.continue();
    const step = timeframe === "1s" ? 1 : 5;
    const bars = Array.from({ length: 300 / step + 1 }, (_, i) => {
      const open = 225 + Math.sin(i / 7) * 0.05;
      const close = 225 + Math.sin((i + 1) / 7) * 0.05;
      return [DISPLAY_START + i * step, open, Math.max(open, close) + 0.04,
        Math.min(open, close) - 0.04, close, 7];
    });
    await route.fulfill({ json: { t: symbol, tf: timeframe, source: "large-trades-coordinate-fixture",
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
        // Inspection stays inside its owning plot and below the native header targets.
        expect(await close.evaluate((node) => {
          const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return node.contains(hit);
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

// Preference hydration can briefly retain default panes. A ready feed is not native geometry
// readiness: wait for the requested topology, the filled host and two identical measured frames.
async function settledTradeChart(page: Page, expectedSubpanes = 0) {
  let previous = "";
  await expect.poll(async () => {
    const state = await page.locator(".chart-wrap").first().evaluate((wrap) => {
      const body = wrap.closest<HTMLElement>(".chart-body"), table = wrap.querySelector(".tv-lightweight-charts table");
      const root = wrap.getBoundingClientRect(), native = table?.getBoundingClientRect();
      const rows = [...(table?.querySelectorAll("tr") ?? [])].filter((row) => row.querySelector("canvas"));
      return { declared: Number(getComputedStyle(body!).getPropertyValue("--subpanes")),
        drawn: rows.length - 2, fills: !!native && Math.abs(root.height - native.height) <= 1,
        geometry: [root.x, root.y, root.width, root.height,
          ...[...wrap.querySelectorAll<HTMLElement>('[data-testid="large-trade-marker"]')]
            .map((node) => [node.style.left, node.style.top, node.style.visibility].join(":"))] };
    });
    const key = JSON.stringify(state.geometry);
    const ready = state.declared === expectedSubpanes && state.drawn === expectedSubpanes && state.fills;
    const stable = ready && key === previous; previous = ready ? key : "";
    return stable;
  }, { timeout: 25_000, intervals: [150, 200, 300, 400] }).toBe(true);
}

async function nativeTradePanePoint(page: Page, paneIndex: number) {
  return page.locator(".chart-wrap").first().evaluate((wrap, index) => {
    const rows = [...wrap.querySelectorAll(".tv-lightweight-charts table tr")]
      .filter((row) => row.querySelector("canvas") && row.getBoundingClientRect().height > 3);
    const row = rows[index];
    if (!row) throw new Error("Requested native pane has no visible row");
    const canvas = [...row.querySelectorAll("canvas")].sort((a, b) =>
      b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    const r = canvas.getBoundingClientRect();
    for (const ry of [0.65, 0.8, 0.45]) for (const rx of [0.42, 0.7, 0.25]) {
      const x = r.x + r.width * rx, y = r.y + r.height * ry;
      const hit = document.elementFromPoint(x, y);
      if (hit?.tagName === "CANVAS" && row.contains(hit) && x >= 0 && y >= 0
        && x < innerWidth && y < innerHeight) return { x, y, hit: hit.tagName, pane: r.toJSON() };
    }
    throw new Error("No unobstructed native pane touch target");
  }, paneIndex);
}

async function trustedTradeDoubleTap(page: Page, info: TestInfo, point: { x: number; y: number }, name: string) {
  await page.evaluate(() => {
    const w = window as unknown as { __ltTouchWitness: unknown[] };
    w.__ltTouchWitness = [];
    const record = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      w.__ltTouchWitness.push({ type: event.type, trusted: event.isTrusted, pointerType: event.pointerType,
        at: event.timeStamp, x: event.clientX, y: event.clientY, target: (event.target as Element)?.tagName });
    };
    // Retain all four native events, then detach both observers.
    let count = 0;
    const all = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      record(event);
      if (++count === 4) { document.removeEventListener("pointerdown", all, true); document.removeEventListener("pointerup", all, true); }
    };
    document.addEventListener("pointerdown", all, true); document.addEventListener("pointerup", all, true);
  });
  const session = await page.context().newCDPSession(page);
  const dispatchStartedAt = new Date().toISOString(), dispatchStartedMs = Date.now();
  try {
    // Queue native touch protocol events in order in one local turn. No DOM dispatch,
    // source timestamp substitution, driver round-trip between taps or relaxed app threshold.
    const touchPoints = [{ x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1, id: 1 }];
    await Promise.all([
      session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints }),
      session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }),
      session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints }),
      session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }),
    ]);
  } finally { await session.detach(); }
  const witness = await page.evaluate(() => (window as unknown as { __ltTouchWitness: {
    type: string; trusted: boolean; pointerType: string; at: number; x: number; y: number; target: string;
  }[] }).__ltTouchWitness);
  await info.attach(name, { body: JSON.stringify({ point, witness, suppliedTimestamps: false,
    dispatchStartedAt, dispatchElapsedMs: Date.now() - dispatchStartedMs }, null, 2), contentType: "application/json" });
  expect(witness).toHaveLength(4);
  expect(witness.every((event) => event.trusted && event.pointerType === "touch" && event.target === "CANVAS")).toBe(true);
  const up = witness.filter((event) => event.type === "pointerup");
  expect(up[1].at - up[0].at).toBeLessThan(350);
}

async function boundedTradeDock(page: Page, info: TestInfo, name: string) {
  const proof = await page.getByTestId("large-trades-dock").evaluate((dock) => {
    const root = dock.closest(".chart-wrap")!;
    const row = [...root.querySelectorAll(".tv-lightweight-charts table tr")].find((tr) => tr.querySelector("canvas"))!;
    const canvas = [...row.querySelectorAll("canvas")].sort((a, b) =>
      b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    const plot = canvas.getBoundingClientRect(), d = dock.getBoundingClientRect();
    return { plot: plot.toJSON(), dock: d.toJSON(), viewport: { width: innerWidth, height: innerHeight } };
  });
  expect(proof.dock.x).toBeGreaterThanOrEqual(Math.max(0, proof.plot.x));
  expect(proof.dock.y).toBeGreaterThanOrEqual(Math.max(0, proof.plot.y + 48));
  expect(proof.dock.right).toBeLessThanOrEqual(Math.min(proof.viewport.width, proof.plot.right) + 1);
  expect(proof.dock.bottom).toBeLessThanOrEqual(Math.min(proof.viewport.height, proof.plot.bottom) + 1);
  await info.attach(name, { body: JSON.stringify(proof, null, 2), contentType: "application/json" });
}

test("large trade markers clear synchronously when a nonprice pane is maximized and restore", async ({ page }, info) => {
  test.setTimeout(120_000);
  await prepare(page);
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["largeTrades", "rsi"]));
    localStorage.setItem("mm.chartSettings", JSON.stringify({ paneButtons: "always" }));
  });
  await openFixture(page);
  await settledTradeChart(page, 1);
  await boundedTradeDock(page, info, "price-owned-dock-before-maximize");
  const visibleMarkers = page.locator('[data-testid="large-trade-marker"]:visible');
  await expect.poll(() => visibleMarkers.count()).toBeGreaterThan(0);
  const admittedCount = await visibleMarkers.count();
  if (info.project.name === "mobile") {
    // The existing phone contract hides pane buttons and owns maximize/restore with actual touch.
    const rsiPoint = await nativeTradePanePoint(page, 1);
    await trustedTradeDoubleTap(page, info, rsiPoint, "phone-maximize-native-touch-events");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __mmPaneMaximized(): string | null }).__mmPaneMaximized())).not.toBeNull();
    await expect(visibleMarkers).toHaveCount(0);
    await capture(page, info, "large-trades-phone-touch-maximized-fixed");
    await expect(page.getByTestId("large-trades-dock")).toBeHidden();
    const restorePoint = await nativeTradePanePoint(page, 0);
    await trustedTradeDoubleTap(page, info, restorePoint, "phone-restore-native-touch-events");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __mmPaneMaximized(): string | null }).__mmPaneMaximized())).toBeNull();
    await settledTradeChart(page, 1);
    await expect(visibleMarkers).toHaveCount(admittedCount);
    await boundedTradeDock(page, info, "price-owned-dock-after-phone-restore");
    await capture(page, info, "large-trades-phone-touch-restored-fixed");
    return;
  }
  const maximize = page.locator(".pane-ops").getByRole("button", { name: "Maximize pane", exact: true });
  await expect(maximize).toHaveCount(1);
  // The real pane-control callback must hide its sibling layer before measure/React/RAF catches up.
  const immediateCount = await maximize.evaluate((button) => {
    (button as HTMLButtonElement).click();
    return Array.from(document.querySelectorAll('[data-testid="large-trade-marker"]'))
      .filter((node) => getComputedStyle(node).visibility === "visible").length;
  });
  expect(immediateCount).toBe(0);
  const restore = page.locator(".pane-ops").getByRole("button", { name: "Restore pane", exact: true });
  await expect(restore).toBeVisible();
  if (info.project.name === "tablet") {
    const ops = await restore.boundingBox(), fullscreen = await page.locator(".chart-fs-float").boundingBox();
    expect(ops!.x + ops!.width).toBeLessThanOrEqual(fullscreen!.x);
    expect(await restore.evaluate((node) => { const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
  }
  await expect(visibleMarkers).toHaveCount(0);
  await expect(page.getByTestId("large-trades-dock")).toBeHidden();
  await expect(page.getByTestId("large-trades-inspector")).toBeHidden();
  await capture(page, info, "large-trades-nonprice-maximized-fixed");
  await restore.click();
  await expect(maximize).toBeVisible();
  await settledTradeChart(page, 1);
  await boundedTradeDock(page, info, "price-owned-dock-after-pointer-restore");
  await expect(visibleMarkers).toHaveCount(admittedCount);
  await capture(page, info, "large-trades-price-restored-fixed");
  // Also exercise the ordinary pointer path after the layout has settled.
  await maximize.click();
  await expect(visibleMarkers).toHaveCount(0);
  await restore.click();
  await expect(visibleMarkers).toHaveCount(admittedCount);
  if (info.project.name === "tablet") {
    await page.locator(".pane-ops").getByRole("button", { name: "Collapse pane", exact: true }).click();
    const collapsed = page.locator(".pane-ops.is-collapsed").getByRole("button", { name: "Restore pane", exact: true });
    await expect(collapsed).toBeVisible(); await collapsed.click();
    await expect(page.locator(".pane-ops.is-collapsed")).toHaveCount(0);
    await expect(visibleMarkers).toHaveCount(admittedCount);
    await page.locator(".chart-fs-float").click();
    await expect(page.locator(".chart-fs-float")).toHaveAttribute("title", /Exit|Restore/i);
    await page.locator(".chart-fs-float").click();
    await expect(page.locator(".chart-fs-float")).toHaveAttribute("title", "Fullscreen chart");
    await expect(visibleMarkers).toHaveCount(admittedCount);
    await capture(page, info, "large-trades-tablet-restore-and-fullscreen-fixed");
  }
});

test("large trade markers and inspection co-hide in a short price pane and return after resize", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One native separator policy case; responsive owner transitions are covered separately.");
  test.setTimeout(120_000);
  await prepare(page);
  await page.addInitScript(() => localStorage.setItem("mm.inds", JSON.stringify(["largeTrades", "rsi"])));
  await openFixture(page); await settledTradeChart(page, 1);
  const visible = page.locator('[data-testid="large-trade-marker"]:visible');
  const count = await visible.count(); expect(count).toBeGreaterThan(0);
  await page.getByTestId("large-trades-inspect").click();
  await expect(page.getByTestId("large-trades-inspector")).toBeVisible();
  const separator = await page.locator(".chart-wrap").evaluate((wrap) => {
    const rows = [...wrap.querySelectorAll(".tv-lightweight-charts table tr")];
    const row = rows.find((tr) => !tr.querySelector("canvas") && tr.getBoundingClientRect().height > 0);
    if (!row) throw new Error("Native pane separator is absent");
    const r = row.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    return { x: r.x + r.width * 0.22, y: r.y + r.height / 2, smallY: w.y + 90 };
  });
  await page.mouse.move(separator.x, separator.y); await page.mouse.down();
  await page.mouse.move(separator.x, separator.smallY, { steps: 8 }); await page.mouse.up();
  await expect(page.getByTestId("large-trades-overlay")).toHaveAttribute("data-owner-visible", "false");
  await expect(visible).toHaveCount(0);
  await expect(page.getByTestId("large-trades-dock")).toBeHidden();
  await expect(page.getByTestId("large-trades-inspector")).toBeHidden();
  await capture(page, info, "large-trades-short-owner-co-hidden");
  const current = await page.locator(".chart-wrap").evaluate((wrap) => {
    const row = [...wrap.querySelectorAll(".tv-lightweight-charts table tr")]
      .find((tr) => !tr.querySelector("canvas") && tr.getBoundingClientRect().height > 0)!;
    const r = row.getBoundingClientRect(); return { x: r.x + r.width * 0.22, y: r.y + r.height / 2 };
  });
  await page.mouse.move(current.x, current.y); await page.mouse.down();
  await page.mouse.move(current.x, separator.y, { steps: 8 }); await page.mouse.up();
  await settledTradeChart(page, 1);
  await expect(page.getByTestId("large-trades-overlay")).toHaveAttribute("data-owner-visible", "true");
  await expect(visible).toHaveCount(count);
  await expect(page.getByTestId("large-trades-inspector")).toBeVisible();
  await page.getByRole("button", { name: "Close trade inspection", exact: true }).click();
  await boundedTradeDock(page, info, "short-owner-restored-dock-bounds");
  await capture(page, info, "large-trades-short-owner-restored");
});

type TradePngFrame = { width: number; height: number; pixels: Uint8ClampedArray; text: string[] };
declare global {
  interface Window {
    __ltPngFrames: TradePngFrame[];
    __ltHoldImageDecode: boolean;
    __ltImageReleases: (() => void)[];
  }
}
async function observeTradePng(page: Page) {
  await page.addInitScript(() => {
    window.__ltPngFrames = []; window.__ltHoldImageDecode = false; window.__ltImageReleases = [];
    const text = new WeakMap<HTMLCanvasElement, string[]>();
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (value, x, y, maxWidth) {
      const rows = text.get(this.canvas) ?? []; rows.push(value); text.set(this.canvas, rows);
      if (maxWidth === undefined) fillText.call(this, value, x, y); else fillText.call(this, value, x, y, maxWidth);
    };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      const rows = text.get(this) ?? [], context = this.getContext("2d");
      if (context && rows.includes("MASTERMIND") && rows.includes("TERMINAL")) {
        window.__ltPngFrames.push({ width: this.width, height: this.height,
          pixels: context.getImageData(0, 0, this.width, this.height).data, text: [...rows] });
      }
      return toBlob.call(this, callback, type, quality);
    };
    // Delay delivery of the existing SVG decoder's load event, after its synchronous clone.
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", { configurable: true, get: src.get,
      set(value: string) {
        if (window.__ltHoldImageDecode && value.startsWith("blob:") && this.onload) {
          const loaded = this.onload;
          this.onload = (event: Event) => { window.__ltImageReleases.push(() => loaded.call(this, event)); };
        }
        src.set!.call(this, value);
      } });
  });
}
async function downloadTradePng(page: Page, info: TestInfo, name: string) {
  const before = await page.evaluate(() => window.__ltPngFrames.length);
  const pending = page.waitForEvent("download");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "download" } })));
  const download = await pending;
  const file = info.outputPath(name + ".png"); await download.saveAs(file);
  await info.attach(name, { path: file, contentType: "image/png" });
  await expect.poll(() => page.evaluate(() => window.__ltPngFrames.length)).toBe(before + 1);
  return { index: before, filename: download.suggestedFilename() };
}

test("native PNG includes visible executions, quantity labels and provenance but excludes inspection controls", async ({ page }, info) => {
  test.setTimeout(120_000);
  await prepare(page); await observeTradePng(page);
  await page.clock.setFixedTime(new Date("2026-10-11T11:00:00Z"));
  await openFixture(page);
  await expect.poll(() => page.locator('[data-testid="large-trade-marker"]:visible').count()).toBeGreaterThan(0);
  await settledTradeChart(page);
  await capture(page, info, "large-trades-export-visible-chart");
  const first = await downloadTradePng(page, info, "large-trades-native-export");
  expect(first.filename).toBe("AAPL_5s_20261011.png");
  const proof = await page.evaluate((index) => {
    const png = window.__ltPngFrames[index];
    const frame = (window as unknown as { __mmLargeTradesSnapshot: import("../lib/largeTrades/snapshot").LargeTradesExportFrame }).__mmLargeTradesSnapshot;
    const probe = document.createElement("canvas"); probe.width = probe.height = 1;
    const ctx = probe.getContext("2d")!;
    const borderHits = frame.markers.map((mark) => {
      ctx.fillStyle = mark.border; ctx.fillRect(0, 0, 1, 1);
      const expected = ctx.getImageData(0, 0, 1, 1).data;
      const scale = png.width / frame.cssWidth;
      let hits = 0;
      // Sample the outer circular stroke away from text; the native PNG must contain real marker pixels.
      for (let i = 0; i < 120; i++) {
        const angle = i * Math.PI * 2 / 120;
        const x = Math.round((mark.x + Math.cos(angle) * (mark.width / 2 - 0.5)) * scale);
        const y = Math.round(104 + (mark.y + Math.sin(angle) * (mark.height / 2 - 0.5)) * 2);
        if (x < frame.plot.x * scale || x > (frame.plot.x + frame.plot.width) * scale
          || y < 104 + frame.plot.y * 2 || y > 104 + (frame.plot.y + frame.plot.height) * 2) continue;
        const at = (y * png.width + x) * 4;
        if ([0, 1, 2].every((c) => Math.abs(png.pixels[at + c] - expected[c]) < 50)) hits++;
      }
      return { quantity: mark.quantity, reports: mark.reports, hits };
    });
    return { text: png.text, width: png.width, height: png.height, cssHeight: frame.cssHeight,
      quantities: frame.markers.map((mark) => mark.label?.text), borderHits, footer: frame.footer };
  }, first.index);
  expect(proof.height).toBeGreaterThan(104 + proof.cssHeight * 2);
  expect(proof.borderHits.some((mark) => mark.hits >= 12)).toBe(true);
  for (const label of proof.quantities) if (label) expect(proof.text).toContain(label);
  expect(proof.text.join(" ")).toContain("Test fixture");
  expect(proof.text.join(" ")).toContain("shares");
  expect(proof.text.join(" ")).toContain("Distinct orders: Not available");
  expect(proof.text.join(" ")).toContain("Synthetic executions");
  expect(proof.text).not.toContain("Refresh transaction evidence");
  await page.getByTestId("large-trades-inspect").click();
  await expect(page.getByTestId("large-trades-inspector")).toBeVisible();
  const inspection = await downloadTradePng(page, info, "large-trades-native-export-inspector-excluded");
  expect(await page.evaluate(({ a, b }) => {
    const before = window.__ltPngFrames[a], after = window.__ltPngFrames[b];
    if (before.width !== after.width || before.height !== after.height) return -1;
    return before.pixels.reduce((n, value, i) => n + (value !== after.pixels[i] ? 1 : 0), 0);
  }, { a: first.index, b: inspection.index })).toBe(0);
});

test("native PNG preserves disabled quantity labels and canonical replay admission", async ({ page }, info) => {
  test.setTimeout(120_000);
  await prepare(page, "en", "dark", "1s"); await observeTradePng(page);
  await openFixture(page);
  await page.getByTestId("large-trades-dock").getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".ind-set").getByRole("button", { name: "Style", exact: true }).click();
  await page.getByRole("switch", { name: "Show exact quantity labels", exact: true }).click();
  await page.keyboard.press("Escape");
  const noLabels = await downloadTradePng(page, info, "large-trades-native-export-labels-off");
  expect(await page.evaluate(() => {
    const frame = (window as unknown as { __mmLargeTradesSnapshot: import("../lib/largeTrades/snapshot").LargeTradesExportFrame }).__mmLargeTradesSnapshot;
    return frame.markers.every((mark) => mark.label === null);
  })).toBe(true);
  expect(await page.evaluate((index) => window.__ltPngFrames[index].text.some((text) =>
    ["1,301", "1,500", "1,800", "1,600"].includes(text)), noLabels.index)).toBe(false);
  await toggleToolbarReplay(page);
  const slider = page.locator("[data-replay-rail]").getByRole("slider");
  await slider.focus(); await slider.press("Home");
  await expect(page.getByTestId("large-trade-marker")).toHaveCount(1);
  await expect(page.getByTestId("large-trade-marker")).toHaveAttribute("data-quantity", "1301");
  const replay = await downloadTradePng(page, info, "large-trades-native-export-replay");
  expect(await page.evaluate((index) => {
    const frame = (window as unknown as { __mmLargeTradesSnapshot: import("../lib/largeTrades/snapshot").LargeTradesExportFrame }).__mmLargeTradesSnapshot;
    return { quantities: frame.markers.map((mark) => mark.quantity), replay: frame.replay, text: window.__ltPngFrames[index].text.join(" ") };
  }, replay.index)).toMatchObject({ quantities: [1301], replay: expect.stringContaining("intraday:"), text: expect.stringContaining("Replay cutoff (UTC)") });
});

test("native PNG freezes its admitted symbol and marker frame across asynchronous decoding", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One asynchronous ownership case; responsive export is covered separately.");
  test.setTimeout(120_000);
  await prepare(page); await observeTradePng(page); await openFixture(page);
  await settledTradeChart(page);
  await expect(page.locator('[data-testid="large-trade-marker"]:visible')).toHaveCount(4);
  await page.evaluate(() => { window.__ltHoldImageDecode = true; });
  const pending = page.waitForEvent("download");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "download" } })));
  await expect.poll(() => page.evaluate(() => window.__ltImageReleases.length)).toBeGreaterThan(0);
  await page.getByTestId("large-trades-dock").getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".ind-set").getByRole("button", { name: "Style", exact: true }).click();
  await page.getByRole("switch", { name: "Show exact quantity labels", exact: true }).click();
  await page.keyboard.press("Escape");
  try {
    // Symbol selection is intentionally disabled in canonical replay; change symbol first.
    await page.keyboard.press("Control+K");
    const search = page.locator('input[role="combobox"]');
    await search.fill("NVDA"); await search.press("Enter");
    await expect(page.getByTestId("large-trades-overlay")).toHaveAttribute("data-symbol", "NVDA");
    await toggleToolbarReplay(page);
    await page.locator("[data-replay-rail]").getByRole("slider").press("Home");
  } finally {
    await page.evaluate(() => { window.__ltHoldImageDecode = false; window.__ltImageReleases.splice(0).forEach((release) => release()); });
  }
  const downloaded = await pending;
  expect(downloaded.suggestedFilename()).toMatch(/^AAPL_5s_/);
  const file = info.outputPath("large-trades-native-export-frozen-before-symbol-change.png");
  await downloaded.saveAs(file); await info.attach("frozen-before-symbol-change", { path: file, contentType: "image/png" });
  expect(await page.evaluate(() => window.__ltPngFrames.at(-1)!.text)).toEqual(expect.arrayContaining(["AAPL", "1,301", "1,500", "1,800", "1,600"]));
  expect(await page.evaluate(() => window.__ltPngFrames.at(-1)!.text)).not.toContain("NVDA");
});

test("native PNG waits while the requested symbol has no accepted native source", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1000, "One source-ownership admission case.");
  test.setTimeout(120_000);
  await prepare(page); await observeTradePng(page); await openFixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/intraday?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("sym") !== "NVDA") return route.fallback();
    await held; await route.fulfill({ json: { t: "NVDA", tf: "5s", bars: [] } }).catch(() => {});
  });
  try {
    await page.keyboard.press("Control+K");
    const search = page.locator('input[role="combobox"]'); await search.fill("NVDA"); await search.press("Enter");
    await expect(page.getByTestId("large-trades-overlay")).toHaveAttribute("data-symbol", "NVDA");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "download" } })));
    await expect(page.locator(".chart-wrap")).toContainText("Loading…");
    expect(await page.evaluate(() => window.__ltPngFrames.length)).toBe(0);
  } finally { release(); }
});

test("left price scale places executions after the native axis and exports the same plot", async ({ page }, info) => {
  test.setTimeout(120_000);
  await prepare(page); await observeTradePng(page);
  await page.addInitScript(() => localStorage.setItem("mm.chartSettings", JSON.stringify({ scaleLeft: true })));
  await openFixture(page);
  await settledTradeChart(page);
  const marker = page.locator('[data-testid="large-trade-marker"]:visible').first();
  await expect(marker).toBeVisible();
  const coordinate = await marker.evaluate((node) => {
    const axis = (window as unknown as { __mmChartAxisOpts(): {
      leftScaleWidth: number; timeBarSpacing: number; lastBarX: number; rowCount: number;
    } }).__mmChartAxisOpts();
    const root = node.closest(".chart-wrap")!.getBoundingClientRect(), rect = node.getBoundingClientRect();
    const quantity = Number((node as HTMLElement).dataset.quantity);
    // Match the actual visible fixture execution to its existing5s native bar.
    const index = ({ 1301: 2, 1500: 14, 1800: 26, 1600: 38 } as Record<number, number>)[quantity];
    return { actual: rect.x + rect.width / 2 - root.x,
      expected: axis.leftScaleWidth + axis.lastBarX - (axis.rowCount - 1 - index) * axis.timeBarSpacing,
      axisWidth: axis.leftScaleWidth, quantity };
  });
  expect(coordinate.axisWidth).toBeGreaterThan(0);
  expect(Math.abs(coordinate.actual - coordinate.expected)).toBeLessThan(1);
  await capture(page, info, "large-trades-left-axis-aligned");
  await downloadTradePng(page, info, "large-trades-native-export-left-axis");
  const exported = await page.evaluate((quantity) => {
    const frame = (window as unknown as { __mmLargeTradesSnapshot: import("../lib/largeTrades/snapshot").LargeTradesExportFrame }).__mmLargeTradesSnapshot;
    return { plot: frame.plot, x: frame.markers.find((mark) => mark.quantity === quantity)?.x };
  }, coordinate.quantity);
  expect(exported.plot.x).toBe(coordinate.axisWidth);
  expect(Math.abs(exported.x! - coordinate.expected)).toBeLessThan(1);
});

test("native PNG retains complete IEX historical attribution and terms from the reviewed real archive", async ({ page }, info) => {
  test.setTimeout(120_000);
  const artifact = process.env.MMX_LARGE_TRADES_RESEARCH_ARTIFACT;
  test.skip(!artifact, "Requires the explicitly supplied reviewed IEX archive; never substitutes fixtures.");
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { validateLargeTradesEnvelope } = await import("../lib/largeTrades/engine");
  const { utcMsToDisplayEpoch } = await import("../lib/largeTrades/chartProjection");
  const bytes = await readFile(artifact!), raw: unknown = JSON.parse(bytes.toString("utf8"));
  if (!validateLargeTradesEnvelope(raw)) throw new Error("Invalid supplied historical artifact");
  const envelope = raw, symbol = envelope.instrument.symbol, artifactSha256 = createHash("sha256").update(bytes).digest("hex");
  expect(envelope.provenance).toMatchObject({ provider: "IEX", dataMode: "historical", scope: "venue", coverage: "partial" });
  const candles = new Map<number, number[]>();
  for (const print of envelope.prints.filter((print) => print.kind === "trade" && print.eligible)) {
    const time = Math.floor(utcMsToDisplayEpoch(Number(BigInt(print.eventNs) / BigInt(1000000)), envelope.instrument.timezone));
    const price = print.priceInt / envelope.instrument.priceScale, bar = candles.get(time);
    if (bar) { bar[2] = Math.max(bar[2], price); bar[3] = Math.min(bar[3], price); bar[4] = price; bar[5] += print.quantity; }
    else candles.set(time, [time, price, price, price, price, print.quantity]);
  }
  await prepare(page, "en", "dark", "1s"); await observeTradePng(page);
  await page.addInitScript(() => {
    localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true }));
    localStorage.setItem("mm.indParams", JSON.stringify({ largeTrades: { minQuantity: 1000 } }));
  });
  await page.route("**/api/large-trades?**", (route) => route.fulfill({ json: { state: "ready", envelope,
    artifactSha256, servedAtNs: (BigInt(Date.now()) * BigInt(1000000)).toString() } }));
  await page.route("**/api/intraday?**", (route) => route.fulfill({ json: { t: symbol, tf: "1s",
    source: "iex-hist-execution-derived-coordinate-research", bars: [...candles.values()].sort((a, b) => a[0] - b[0]) } }));
  await page.goto("/terminal?symbol=" + encodeURIComponent(symbol));
  await expect(page.getByTestId("large-trades-overlay")).toHaveAttribute("data-mode", "historical", { timeout: 60_000 });
  await expect.poll(() => page.locator('[data-testid="large-trade-marker"]:visible').count()).toBeGreaterThan(0);
  const png = await downloadTradePng(page, info, "large-trades-native-export-real-iex");
  const proof = await page.evaluate((index) => {
    const frame = (window as unknown as { __mmLargeTradesSnapshot: import("../lib/largeTrades/snapshot").LargeTradesExportFrame }).__mmLargeTradesSnapshot;
    return { text: window.__ltPngFrames[index].text.join(" "), sourceSha256: frame.sourceSha256,
      quantities: frame.markers.map((mark) => ({ quantity: mark.quantity, reports: mark.reports })), footer: frame.footer };
  }, png.index);
  expect(proof.text).toContain(envelope.provenance.attribution);
  expect(proof.text).toContain("https://www.iex.io/legal/hist-data-terms");
  expect(proof.text).toContain("Historical");
  expect(proof.text).toContain("IEX");
  expect(proof.text).toContain("This venue only");
  expect(proof.text).toContain("shares");
  expect(proof.text).toContain("Partial coverage");
  expect(proof.text).toContain("Historical reconstruction from a later-acquired archive");
  expect(proof.text).not.toContain("Live");
  expect(proof.sourceSha256).toBe(envelope.provenance.sourceSha256);
  await info.attach("native-iex-export-provenance", { body: JSON.stringify({
    artifactSha256, sourceSha256: envelope.provenance.sourceSha256, sourceRecords: envelope.prints.length,
    range: envelope.range, parameters: { minQuantity: 1000 }, quantities: proof.quantities,
    footer: proof.footer, transport: "Explicit same-origin historical interception, not production publication",
    chartCoordinates: "OHLC from the same partial IEX executions; no candle-derived execution quantities",
  }, null, 2), contentType: "application/json" });
});
