import { expect, test } from "@playwright/test";

// Intentionally discriminating regression tests. Until #603's blocked production
// repair is allowed, these fail on the original behavior. All market inputs below
// are synthetic; screenshots prove the browser defect, not live data or pricing.
for (const lang of ["en", "zh"] as const) {
  test(`surface replay advances and preserves the cursor across layout changes (${lang})`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.addInitScript((value) => { localStorage.setItem("mm.lang", value); }, lang);
    const stamps = ["0930", "0931"];
    const date = "2026-09-17";
    let indexReads = 0;
    const epoch = Date.UTC(2026, 8, 17, 9, 30) / 1000;
    await page.route("**/api/intraday?**", (route) => route.fulfill({ json: {
      bars: [0, 1, 2].map((i) => [epoch + i * 60, 100.1, 100.4, 99.9, 100.2, 20]),
    } }));
    await page.route("**/api/flow?**", async (route) => {
      const f = new URL(route.request().url()).searchParams.get("f") ?? "";
      if (f === "surface_idx:SPY") {
        indexReads++;
        return route.fulfill({ json: { root: "SPY", date, stamps, latest: stamps.at(-1), cadenceSec: 60 } });
      }
      if (f === "surface_dates:SPY") return route.fulfill({ json: { root: "SPY", dates: [date], latest: date, cadenceSec: 60 } });
      if (f.startsWith("surface:SPY:")) {
        const stamp = f.split(":")[2];
        const count = Math.max(1, stamps.indexOf(stamp) + 1);
        return route.fulfill({ json: {
          root: "SPY", session_date: date, spot: 100.2, price_levels: [100, 101, 110],
          time_steps: stamps.slice(0, count).map((s) => `${s.slice(0, 2)}:${s.slice(2)}`),
          grids: Object.fromEntries(["netprem", "gex", "vanna", "charm"].map((m) => [m, [1, -2, 3].map((v) => Array(count).fill(v * 1000))])),
          asof: `${date}T13:${stamp.slice(2)}:00Z`, cadence: "1-min",
        } });
      }
      return route.continue();
    });
    await page.goto("/options?tab=surface");
    const rail = page.locator(".obs-surf-frame-rail");
    await expect(rail).toHaveAttribute("aria-valuemax", "2", { timeout: 30_000 });
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
  });
}
