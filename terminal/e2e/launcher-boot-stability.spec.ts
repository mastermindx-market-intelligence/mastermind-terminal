import { expect, test } from "@playwright/test";
import { MARKET_RISK_NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "../lib/__tests__/marketRiskFixture";

// The Intelligence launcher stays where it first paints. The /terminal boundary hydrates at a
// deferred priority, so client-only chrome above the launcher (the watchlist review card, the phone
// roller strip, the measured sub-pane count) lands seconds after the server paint. Each one holds its
// slot from the server HTML. Without that, the stacked tablet layout moved the launcher 829 → 887 →
// 1123, and clicks aimed at the first box were lost (PR #960). Every frame records the launcher's
// top. A 3x CPU throttle keeps the boot window open long enough to sample, as on the CI runners.
test.setTimeout(90_000);
for (const lang of ["en", "zh"] as const) {
  test(`intelligence launcher keeps its first-paint position / ${lang}`, async ({ page }, testInfo) => {
    await page.addInitScript(({ lang, now }) => {
      localStorage.setItem("mm.lang", lang); localStorage.setItem("theme", "dark"); localStorage.setItem("theme_auto", "0");
      Date.now = () => now;
      const w = window as Window & { __launcherTops?: number[]; __mmResponsiveVisualReady?: boolean };
      w.__launcherTops = []; w.__mmResponsiveVisualReady = false;
      window.addEventListener("mm:terminal-visual-ready", () => { w.__mmResponsiveVisualReady = true; }, { once: true });
      const sample = () => {
        const box = document.querySelector('[data-testid="intelligence-launcher"]')?.getBoundingClientRect();
        if (box && box.height > 0) {
          const top = Math.round(box.top + window.scrollY);
          if (w.__launcherTops!.at(-1) !== top) w.__launcherTops!.push(top);
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, { lang, now: MARKET_RISK_NOW });
    await page.route("**/data/market_risk.json", route => route.fulfill({ json: { ...marketRiskSourceFixture(), schema: "market_risk/v1", risk_envelope: riskEnvelopeFixture() } }));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 3 });
    await page.goto("/terminal?symbol=NVDA");

    await expect.poll(
      () => page.evaluate(() => Boolean((window as Window & { __mmResponsiveVisualReady?: boolean }).__mmResponsiveVisualReady)),
      { message: "the interactive Terminal should finish hydrating", timeout: 45_000 },
    ).toBe(true);
    // Everything that used to land late has landed: the stored review has loaded, and on a phone
    // the strip has mounted.
    await expect(page.locator("[data-review-reserve]")).toHaveCount(0, { timeout: 30_000 });
    if (testInfo.project.name === "mobile") await expect(page.getByTestId("roller-strip")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const tops = await page.evaluate(() => (window as Window & { __launcherTops?: number[] }).__launcherTops);
    expect(tops?.length, `launcher tops after first paint: ${JSON.stringify(tops)}`).toBe(1);
  });
}
