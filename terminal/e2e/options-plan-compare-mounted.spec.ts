import { expect, test } from "@playwright/test";
import { response } from "../lib/__tests__/fixtures/optionsPlanPayoff";
import type { PlanExpiryRequest } from "../lib/optionsPlanPayoff";

// Exercise the production component tree on /options. Auth, source acquisition
// and the dated reference response are explicit local fixtures, not live proof.
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "responsive@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-20T00:00:00Z" };
const row = { root: "SPY", right: "C", exp: "2026-10-30", strike: 765, mid: 9, oi: 40, oi_prev: 20, d_oi: 20 };
const sharedShell = process.env.MMX_SHARED_SHELL === "1";
const themes = sharedShell ? ["dark", "light"] as const : ["dark"] as const;
for (const lang of ["en", "zh"] as const) for (const theme of themes) {
  test(`D08C mounted shortlist → Plan → comparison ${lang} ${theme}`, async ({ page, context, baseURL }, info) => {
    test.setTimeout(90_000);
    const t = (en: string, zh: string) => lang === "zh" ? zh : en;
    const session = { access_token: "local-plan-fixture-only", refresh_token: "local-plan-fixture-only", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
    await context.addCookies([
      { name: "mm_e2e_rs30", value: "1", url: baseURL! },
      { name: "sb-127-auth-token.0", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseURL! },
    ]);
    await page.addInitScript(({ lang, theme, user }) => {
      localStorage.setItem("mm.lang", lang); localStorage.setItem("mmx.shell.theme", theme);
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), window.location.href);
        if (url.pathname.startsWith("/auth/v1/")) {
          if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/user") throw Error("Unexpected fixture Auth operation");
          return new Response(JSON.stringify(user), { headers: { "content-type": "application/json" } });
        }
        return originalFetch(input, init);
      };
    }, { lang, theme, user });
    await page.route(/\/api\/flow\?f=oi$/, route => route.fulfill({ json: { schema: "options_hub.oi_movers/v1", asof: "2026-10-23T20:00:00Z", stale: true, movers: [row] } }));
    let calculations = 0, persistence = 0;
    page.on("request", req => { if (/\/api\/(investigations|alerts|orders)(?:[/?]|$)/.test(req.url()) && ["POST", "PUT", "DELETE", "PATCH"].includes(req.method())) persistence++; });
    await page.route("**/api/options/plan/expiry", route => {
      calculations++;
      const request = route.request().postDataJSON() as PlanExpiryRequest;
      expect(request.draft.legs).toHaveLength(1);
      const leg = request.draft.legs[0];
      // The incumbent source adapter adds its own DOI preset before pinning.
      expect(leg.snapshot.row).toEqual({ ...row, preset: "doi" });
      expect(leg.snapshot.sourceStale).toBe(true);
      expect(leg.snapshot.asofRaw).toBe("2026-10-23T20:00:00Z");
      expect(leg.assumptions.entry?.premium_per_unit).toBe(calculations === 1 ? 2 : 4);
      const raw = response(request), entry = leg.assumptions.entry!.premium_per_unit;
      raw.curve.pnl = request.spots.map(spot => Math.max(spot - 765, 0) * 100 - entry * 100);
      raw.curve.cost = entry * 100; raw.curve.max_loss = -entry * 100; raw.curve.breakevens = [765 + entry];
      return route.fulfill({ json: raw });
    });
    await page.goto("/options?tab=screener");
    await page.getByRole("button", { name: t("ΔOI Builds", "持仓增长"), exact: true }).click();
    const pin = page.locator("table.scr [data-contract-pin]"); await expect(pin).toHaveCount(1); await pin.click();
    const tray = page.locator("[data-contract-shortlist]");
    const open = tray.getByRole("button", { name: t("Plan from pinned contracts", "用固定合约创建计划"), exact: true });
    await open.click();
    const plan = page.getByTestId("options-plan-payoff-panel");
    await plan.getByRole("combobox", { name: t("Your assumed side", "假设方向"), exact: true }).selectOption("buy");
    await plan.getByLabel(t("Your assumed quantity — contracts", "假设数量——张"), { exact: true }).fill("1");
    const entry = plan.getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true });
    await entry.fill("2");
    await plan.getByRole("combobox", { name: t("Assumed premium denomination", "权利金假设币种"), exact: true }).selectOption("USD");
    const calculate = plan.getByRole("button", { name: t("Calculate expiry payoff", "计算到期损益"), exact: true });
    await calculate.click(); await plan.getByTestId("plan-pin-baseline").click();
    await expect(plan.getByTestId("plan-baseline-pending")).toBeVisible();
    await entry.fill("4"); await calculate.click();
    const comparison = plan.getByTestId("plan-scenario-compare");
    await expect(comparison.getByTestId("plan-compare-overlay")).toBeVisible();
    await expect(comparison.getByTestId("plan-comparison-sample")).toContainText("200.00");
    if (sharedShell) {
      await expect(page.locator("html")).toHaveAttribute("data-mmx-shared-shell", "1");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    }
    await expect(comparison).toHaveCSS("background-color", sharedShell ? (theme === "light" ? "rgb(255, 255, 255)" : "rgb(24, 27, 33)") : "rgb(13, 15, 19)");
    const compareHeading = comparison.getByRole("heading", { name: t("Compare assumptions", "对比假设"), exact: true });
    await compareHeading.scrollIntoViewIfNeeded();
    await expect(compareHeading).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-${info.project.name}-header.png`) });
    await comparison.getByTestId("plan-compare-overlay").scrollIntoViewIfNeeded();
    await expect(comparison.getByTestId("plan-compare-overlay").locator("svg")).toBeInViewport({ ratio: 0.99 });
    await page.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-${info.project.name}-chart.png`) });
    await comparison.getByText(t("All exact scenario prices and P/L", "查看全部精确情景价格与损益"), { exact: true }).click();
    const exact = comparison.getByTestId("plan-comparison-points");
    await expect(exact.locator("tbody tr")).toHaveCount(101);
    await expect(exact.locator("tbody tr").first().locator("td").last()).toHaveText("-200");
    const scroll = exact.locator(".."); await scroll.focus(); await expect(scroll).toBeFocused();
    await page.keyboard.press("End");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (info.project.name === "mobile") {
      await page.setViewportSize({ width: 320, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await comparison.getByText(t("All exact scenario prices and P/L", "查看全部精确情景价格与损益"), { exact: true }).click();
      await comparison.getByTestId("plan-clear-baseline").scrollIntoViewIfNeeded();
      await expect(comparison.getByTestId("plan-clear-baseline")).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-320-controls.png`) });
    }
    const clear = comparison.getByTestId("plan-clear-baseline");
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await clear.click(); await expect(comparison.getByRole("heading", { name: t("Compare assumptions", "对比假设"), exact: true })).toBeFocused();
    await expect(comparison.getByTestId("plan-compare-overlay")).toHaveCount(0);
    await plan.getByRole("button", { name: t("Close draft", "关闭草稿"), exact: true }).click();
    await expect(open).toBeFocused(); await expect(plan).toHaveCount(0);
    await expect(page.locator("table.scr tbody")).toContainText("SPY");
    expect(calculations).toBe(2); expect(persistence).toBe(0);
  });
}
