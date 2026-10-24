import { expect, test, type Page } from "@playwright/test";
import { response } from "../lib/__tests__/fixtures/optionsPlanPayoff";
import type { PlanExpiryRequest } from "../lib/optionsPlanPayoff";

// Actual /options → incumbent DOI shortlist → canonical editor → payoff panel.
// Discovery, Auth and private API transport below are explicit local fixtures,
// not authenticated production, source authenticity, current-chain or Save proof.
const rows = [
  { root: "SPY", right: "C", exp: "2026-10-23", strike: 763, mid: 9, oi: 40, oi_prev: 20, d_oi: 20 },
  { root: "SPY", right: "P", exp: "2026-11-06", strike: 764, mid: null, oi: 30, oi_prev: 15, d_oi: 15 },
  { root: "SPY", right: "C", exp: "2026-10-23", strike: 900, mid: 1, oi: 20, oi_prev: 10, d_oi: 10 },
];
const userA = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "responsive@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-20T00:00:00Z" };
const userB = { ...userA, id: "00000000-0000-4000-8000-000000000002" };
const session = (user = userA) => ({ access_token: "local-plan-fixture-only", refresh_token: "local-plan-fixture-only", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
async function changeFixtureAccount(page: Page, user: typeof userA) {
  await page.evaluate(({ session }) => {
    const channel = new BroadcastChannel("sb-127-auth-token");
    channel.postMessage({ event: "SIGNED_IN", session }); channel.close();
  }, { session: session(user) });
}
const pins = (page: Page) => page.locator("table.scr [data-contract-pin]");
const tray = (page: Page) => page.locator("[data-contract-shortlist]");
for (const lang of ["en", "zh"] as const) {
  test(`mounted dated shortlist → authored Plan → curve/unavailable/scope reset ${lang}`, async ({ page, context, baseURL }, info) => {
    test.setTimeout(90_000);
    const t = (en: string, zh: string) => lang === "zh" ? zh : en;
    await context.addCookies([{ name: "sb-127-auth-token.0", value: "base64-" + Buffer.from(JSON.stringify(session())).toString("base64url"), url: baseURL! }]);
    await page.addInitScript(({ lang, user }) => {
      localStorage.setItem("mm.lang", lang);
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), window.location.href);
        if (url.pathname.startsWith("/auth/v1/")) {
          if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/user") throw Error("Unexpected fixture Auth operation");
          return new Response(JSON.stringify(user), { headers: { "content-type": "application/json" } });
        }
        return originalFetch(input, init);
      };
    }, { lang, user: userA });
    await page.route(/\/api\/flow\?f=oi$/, route => route.fulfill({ json: { schema: "options_hub.oi_movers/v1", asof: "2026-10-20T08:43:25Z", stale: true, movers: rows } }));
    let requests = 0;
    await page.route("**/api/options/plan/expiry", route => {
      requests++;
      const request = route.request().postDataJSON() as PlanExpiryRequest;
      expect(request.draft.legs).toHaveLength(1);
      const leg = request.draft.legs[0];
      expect(leg.assumptions).toEqual({ side: "buy", quantity: 1, entry: { kind: "user_assumption", premium_per_unit: 3, currency: "USD" } });
      expect(leg.snapshot.sourceStale).toBe(true);
      const result = response(request);
      result.contract_expirations = ["2026-10-23"];
      Object.assign(result.source_boundary, { reference_as_of: "2026-10-19", reference_observed_at: "2026-10-20T08:43:25.307134+00:00", reference_expirations: ["2026-10-23"] });
      if (leg.snapshot.identity.strike === 900) return route.fulfill({ status: 422, json: { status: "UNAVAILABLE", coverage: { root: "SPY", contract_count: 20, expirations: ["2026-10-23"], as_of: "2026-10-19", captured_at: "2026-10-20T08:43:25.307134+00:00" } } });
      expect(leg.snapshot.identity.strike).toBe(763); expect(leg.snapshot.row.mid).toBe(9);
      result.curve = { spots: request.spots, pnl: request.spots.map(s => Math.max(s - 763, 0) * 100 - 300), cost: 300, max_gain: "UNBOUNDED", max_loss: -300, breakevens: [766] };
      return route.fulfill({ json: result });
    });
    await page.goto("/options?tab=screener");
    await page.getByRole("button", { name: t("ΔOI Builds", "持仓增长"), exact: true }).click();
    await expect(pins(page)).toHaveCount(3);
    const before = await page.locator("table.scr tbody").innerText();
    await pins(page).nth(0).click();
    const open = () => tray(page).getByRole("button", { name: t("Plan from pinned contracts", "用固定合约创建计划"), exact: true });
    const calculate = () => page.getByRole("button", { name: t("Calculate expiry payoff", "计算到期损益"), exact: true });
    const panel = () => page.getByTestId("options-plan-payoff-panel");
    const author = async () => {
      for (const control of await panel().getByRole("combobox", { name: t("Your assumed side", "假设方向"), exact: true }).all()) await control.selectOption("buy");
      for (const control of await panel().getByLabel(t("Your assumed quantity — contracts", "假设数量——张"), { exact: true }).all()) await control.fill("1");
      for (const control of await panel().getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true }).all()) await control.fill("3");
      for (const control of await panel().getByRole("combobox", { name: t("Assumed premium denomination", "权利金假设币种"), exact: true }).all()) await control.selectOption("USD");
    };
    await open().click();
    await expect(panel().getByRole("combobox", { name: t("Your assumed side", "假设方向"), exact: true })).toHaveValue("");
    await expect(panel().getByLabel(t("Your assumed quantity — contracts", "假设数量——张"), { exact: true })).toHaveValue("");
    await expect(panel().getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true })).toHaveValue("");
    await calculate().click(); expect(requests).toBe(0);
    await author(); await calculate().click();
    await expect(panel().locator('svg[role="img"]')).toBeVisible();
    await expect(panel().getByTestId("plan-reference-coverage")).toContainText("20 SPY");
    await expect(panel().getByTestId("plan-reference-basis")).toContainText("2026-10-19");
    await expect(panel().getByTestId("plan-breakeven-marker")).toContainText("766.00");
    expect(requests).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // The editor is deliberately long. Use the actual results scroller to
    // inspect the whole curve rather than claiming a clipped viewport proves it.
    await panel().locator('svg[role="img"]').scrollIntoViewIfNeeded();
    await expect(panel().locator('svg[role="img"]')).toBeInViewport({ ratio: 0.99 });
    await page.screenshot({ path: info.outputPath(`mounted-plan-${lang}-${info.project.name}.png`), fullPage: true });
    await panel().getByRole("button", { name: t("Close draft", "关闭草稿"), exact: true }).click();
    await expect(open()).toBeFocused(); await expect(panel()).toHaveCount(0);
    expect(await page.locator("table.scr tbody").innerText()).toBe(before);
    await tray(page).getByRole("button", { name: t("Show in list", "在列表中查看"), exact: true }).click();
    await expect(pins(page).nth(0)).toBeFocused();
    // Two exact pins remain comparable; a mixed expiry has no compatible curve.
    await pins(page).nth(1).click();
    await tray(page).getByRole("button", { name: t("Compare", "对比"), exact: true }).click();
    await expect(tray(page).locator("[data-like-for-like]")).toHaveCount(1);
    await open().click(); await expect(panel().locator("fieldset")).toHaveCount(2);
    await author(); await calculate().click();
    await expect(panel().getByRole("alert")).toContainText(t("same expiry", "相同到期日"));
    expect(requests).toBe(1);
    // Removing a selected pin destroys the whole old draft, rather than reviving it.
    await pins(page).nth(1).click(); await expect(panel()).toHaveCount(0);
    await open().click(); await expect(panel().getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true })).toHaveValue("");
    await tray(page).getByRole("button", { name: t("Back to shortlist", "返回候选列表"), exact: true }).click();
    await expect(open()).toBeFocused();
    await pins(page).nth(0).click(); await pins(page).nth(2).click();
    await open().click(); await author(); await calculate().click();
    await expect(panel().getByRole("alert")).toContainText(t("Contract terms unavailable", "合约条款暂不可用"));
    await expect(panel().locator('svg[role="img"]')).toHaveCount(0);
    await expect(panel().getByTestId("plan-reference-coverage")).toContainText("20 SPY");
    expect(requests).toBe(2);
    // Account departure must also destroy an actually visible numeric result.
    await pins(page).nth(2).click(); await pins(page).nth(0).click();
    await open().click(); await author(); await calculate().click();
    await expect(panel().locator('svg[role="img"]')).toBeVisible(); expect(requests).toBe(3);
    await changeFixtureAccount(page, userB);
    await expect(panel()).toHaveCount(0); await expect(tray(page).locator("li[data-pin-key]")).toHaveCount(0);
    await changeFixtureAccount(page, userA);
    await expect(panel()).toHaveCount(0); await expect(tray(page).locator("li[data-pin-key]")).toHaveCount(0);
    expect(requests).toBe(3);
  });
}
