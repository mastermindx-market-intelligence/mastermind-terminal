import { expect, test } from "@playwright/test";

// Real-route replay regressions. All market inputs are explicitly synthetic;
// browser evidence proves interaction and context handling, not production freshness.
for (const lang of ["en", "zh"] as const) {
  test(`surface replay advances and preserves the cursor across layout changes (${lang})`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.addInitScript((value) => { localStorage.setItem("mm.lang", value); }, lang);
    const stamps = ["0930", "0931"];
    const date = "2026-09-17";
    let indexReads = 0;
    let frameReads = 0;
    let failIndex = false;
    let failFrame = false;
    const epoch = Date.UTC(2026, 8, 17, 9, 30) / 1000;
    await page.route("**/api/intraday?**", (route) => route.fulfill({ json: {
      bars: [0, 1, 2].map((i) => [epoch + i * 60, 100.1, 100.4, 99.9, 100.2, 20]),
    } }));
    await page.route("**/api/flow?**", async (route) => {
      const f = new URL(route.request().url()).searchParams.get("f") ?? "";
      if (f === "surface_idx:SPY") {
        indexReads++;
        if (failIndex) return route.fulfill({ status: 503, body: "fixture unavailable" });
        return route.fulfill({ json: { root: "SPY", date, stamps, latest: stamps.at(-1), cadenceSec: 60 } });
      }
      if (f === "surface_dates:SPY") return route.fulfill({ json: { root: "SPY", dates: [date, "2026-09-16"], latest: date, cadenceSec: 60 } });
      if (f === "surface_idx_at:SPY:2026-09-16") return route.fulfill({ json: {
        root: "SPY", date: "2026-09-16", stamps: ["0930", "0931"], latest: "0931", cadenceSec: 60,
      } });
      if (f.startsWith("surface:SPY:") || f.startsWith("surface_at:SPY:2026-09-16:")) {
        frameReads++;
        if (failFrame && f.startsWith("surface:SPY:")) return route.fulfill({ status: 503, body: "frame refresh unavailable" });
        const archived = f.startsWith("surface_at:");
        const frameDate = archived ? "2026-09-16" : date;
        const stamp = f.split(":").at(-1)!;
        const count = Math.max(1, stamps.indexOf(stamp) + 1);
        return route.fulfill({ json: {
          root: "SPY", session_date: frameDate, spot: 100.2, price_levels: [100, 101, 110],
          time_steps: stamps.slice(0, count).map((s) => `${s.slice(0, 2)}:${s.slice(2)}`),
          grids: Object.fromEntries(["netprem", "gex", "vanna", "charm"].map((m) => [m, [1, -2, 3].map((v) => Array(count).fill(v * 1000))])),
          asof: `${frameDate}T13:${stamp.slice(2)}:00Z`, cadence: "1-min",
        } });
      }
      return route.continue();
    });
    await page.goto("/options?tab=surface");
    const rail = page.locator(".obs-surf-frame-rail");
    await expect(rail).toHaveAttribute("aria-valuemax", "2", { timeout: 30_000 });

    // Greek fields are modeled signed exposure, not premium-flow direction. Pin both the
    // visible legend/provenance and the Style dialog's accessible colour semantics.
    const gamma = page.locator(".obs-surf-controls button").filter({ hasText: lang === "en" ? "Gamma" : "伽马" }).first();
    await gamma.click();
    const strip = page.locator(".obs-surf-data-strip");
    await expect(strip).toContainText(lang === "en" ? "positive exposure" : "正敞口");
    await expect(strip).toContainText(lang === "en" ? "negative exposure" : "负敞口");
    await expect(strip).toContainText(lang === "en" ? "Modeled exposure" : "模型敞口");
    await expect(strip).not.toContainText(lang === "en" ? "inflow" : "流入");
    await expect(strip).not.toContainText(lang === "en" ? "outflow" : "流出");

    await page.locator(".obs-surf-style-wrap button").first().click();
    const gammaStyle = page.locator(".obs-surf-style-row").filter({ hasText: lang === "en" ? "Gamma" : "伽马" });
    await expect(gammaStyle.locator('input[type="color"]').first()).toHaveAttribute(
      "aria-label", new RegExp(lang === "en" ? "Positive exposure" : "正敞口"),
    );
    await page.keyboard.press("Escape");

    await page.locator(".obs-surf-controls button").filter({ hasText: lang === "en" ? "Net Prem" : "净权利金" }).first().click();
    await page.locator(".obs-surf-replay-transport button").first().click();
    await expect(rail).toHaveAttribute("aria-valuetext", /09:30/);
    await page.screenshot({ path: info.outputPath(`${lang}-paused-single.png`), fullPage: false });
    await page.locator(".obs-surf-head-tools [role=group]").first().locator("button").nth(1).click();
    await expect(page.locator(".obs-surf-quad-cell")).toHaveCount(4);
    await page.screenshot({ path: info.outputPath(`${lang}-after-quad.png`), fullPage: false });
    const afterLayout = await rail.getAttribute("aria-valuetext");
    expect.soft(afterLayout, "Changing presentation must not change the selected market time").toContain("09:30");
    // Install the virtual browser clock only after the real route has mounted.
    // The production index refresh (when fixed) registers on mount, so advance via
    // an installed clock established before the next route mount.
    await page.clock.install({ time: new Date("2026-09-17T14:00:00Z") });
    await page.reload();
    await expect(rail).toHaveAttribute("aria-valuemax", "2");
    const before = indexReads;
    stamps.push("0932");
    await page.clock.fastForward(61_000);
    await expect.soft(rail, "An open workspace must discover newly published frames").toHaveAttribute("aria-valuemax", "3", { timeout: 5_000 });
    const count = await rail.getAttribute("aria-valuemax");
    await page.screenshot({ path: info.outputPath(`${lang}-after-index-growth.png`), fullPage: false });
    await info.attach("replay-observations", { body: JSON.stringify({ lang, viewport: info.project.name, afterLayout, before, indexReads, frameCountAfterGrowth: count, synthetic: true }), contentType: "application/json" });
    expect.soft(indexReads, "The existing shared replay owner must refresh its index").toBeGreaterThan(before);
    const replay = page.locator(".obs-surf-replay");
    await expect(replay).toContainText(lang === "en" ? "LATEST STORED" : "最新已存帧");
    await expect(replay.locator(".obs-live-dot")).toHaveCount(0);

    await page.locator(".obs-surf-replay-transport button").first().click();
    stamps.push("0933");
    await page.clock.fastForward(61_000);
    await expect(rail).toHaveAttribute("aria-valuemax", "4");
    await expect(rail).toHaveAttribute("aria-valuetext", /09:30/);

    failIndex = true;
    await page.clock.fastForward(61_000);
    await expect(replay).toContainText(lang === "en" ? "Refresh unavailable" : "刷新暂不可用");
    await expect(rail).toHaveAttribute("aria-valuemax", "4");
    await expect(rail).toHaveAttribute("aria-valuetext", /09:30/);
    await replay.screenshot({ path: info.outputPath(`${lang}-retained-on-error.png`) });

    failIndex = false;
    await page.clock.fastForward(61_000);
    await expect(replay.locator(".obs-surf-replay-error")).toHaveCount(0);

    // A successful index refresh followed by a same-HHMM frame failure must keep the
    // already admitted observation visible and disclose that it is stored, not fresh.
    await page.locator(".obs-surf-replay-transport button").last().click();
    await expect(rail).toHaveAttribute("aria-valuetext", /09:33/);
    const storedStrip = page.locator(".obs-surf-data-strip").first();
    await expect(storedStrip).toBeVisible();
    const beforeFrameRefresh = frameReads;
    failFrame = true;
    await page.clock.fastForward(61_000);
    await expect.poll(() => frameReads, { timeout: 10_000 }).toBeGreaterThan(beforeFrameRefresh);
    await expect(storedStrip).toBeVisible();
    await expect(page.locator(".obs-surf-frame-refresh-error").first()).toContainText(
      lang === "en" ? "Surface refresh unavailable" : "曲面刷新暂不可用",
    );
    await expect(page.locator(".obs-surf-chart-area").first()).not.toContainText(
      lang === "en" ? "No surface data yet" : "暂无曲面数据",
    );
    failFrame = false;
    await page.clock.fastForward(61_000);
    await expect(page.locator(".obs-surf-frame-refresh-error")).toHaveCount(0);

    await page.locator(".obs-surf-replay-session").selectOption("2026-09-16");
    await expect(replay).toContainText("2026-09-16");
    await expect(rail).toHaveAttribute("aria-valuemax", "2");
    const archivedReads = indexReads;
    await page.clock.fastForward(61_000);
    expect(indexReads).toBe(archivedReads);
    await replay.screenshot({ path: info.outputPath(`${lang}-archived-session.png`) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(pageErrors, "Replay interactions must not trip the route error boundary").toEqual([]);

  });
}
