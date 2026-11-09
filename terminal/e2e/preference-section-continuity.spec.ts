import { expect, test } from "@playwright/test";
import { fixtureUserId } from "../lib/watchlistsFixtureDb";
import { isolateWatchlistStore } from "./watchlistStore";
import { useLang as selectLanguage } from "./layoutStore";

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: trade preferences survive leaving their section and an acknowledged reload`, async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    const key = await isolateWatchlistStore(page, info, baseURL);
    await selectLanguage(page, lang);
    const user = { id: fixtureUserId(key), aud: "authenticated", role: "authenticated", email: "responsive@example.com",
      app_metadata: {}, created_at: "2026-10-19T00:00:00Z",
      user_metadata: { trade_types: ["stocks", "options"], lang, prefs: { lang } } as Record<string, unknown> };
    const session = { access_token: "local-preference-continuity-fixture-only", refresh_token: "local-preference-continuity-fixture-only",
      token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user };
    await page.context().addCookies([{ name: "sb-127-auth-token.0", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseURL! }]);
    let release!: () => void;
    const acknowledgement = new Promise<void>(resolve => { release = resolve; });
    const requested: Record<string, unknown>[] = [], acknowledged: Record<string, unknown>[] = [];
    await page.exposeBinding("preferenceContinuityAccountFixture", async (_source, method: string, body: string | null) => {
      if (method === "PUT") {
        const patch = JSON.parse(body || "{}").data as Record<string, unknown>;
        expect(Object.keys(patch)).toEqual(["trade_types"]);
        requested.push(patch); await acknowledgement;
        user.user_metadata = { ...user.user_metadata, ...patch }; acknowledged.push(patch);
      } else if (method !== "GET") throw new Error("Unexpected local preference fixture operation");
      return user;
    });
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), location.href);
        if (url.pathname.startsWith("/auth/v1/")) {
          if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/user") throw new Error("Unexpected fixture Auth operation");
          const request = input instanceof Request ? input : null;
          const method = init?.method ?? request?.method ?? "GET";
          const body = typeof init?.body === "string" ? init.body : request ? await request.clone().text() : null;
          const fixture = window as unknown as { preferenceContinuityAccountFixture: (method: string, body: string | null) => Promise<unknown> };
          return new Response(JSON.stringify(await fixture.preferenceContinuityAccountFixture(method, body)), { headers: { "content-type": "application/json" } });
        }
        return originalFetch(input, init);
      };
    });
    await page.goto("/terminal?symbol=NVDA");
    await page.locator(".avatar:visible").first().click();
    const panel = page.locator(".acs-overlay.open");
    await expect(panel).toBeVisible();
    const preferences = panel.getByRole("tab", { name: lang === "zh" ? "偏好" : "Preferences", exact: true });
    await preferences.click();
    const group = panel.getByRole("group", { name: lang === "zh" ? "你交易什么" : "What you trade", exact: true });
    const crypto = group.getByRole("button", { name: lang === "zh" ? "你交易什么: 加密货币" : "What you trade: Crypto", exact: true });
    await expect(crypto).toHaveAttribute("aria-pressed", "false");
    await crypto.click();
    await expect(crypto).toHaveAttribute("aria-pressed", "true");
    const feedback = group.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' acs-row ')][1]").locator(".acs-msg");
    await expect(feedback).toHaveText(lang === "zh" ? "保存中…" : "Saving…");
    await expect.poll(() => requested.length).toBe(1); expect(acknowledged).toHaveLength(0);

    await panel.getByRole("tab", { name: lang === "zh" ? "终端" : "Terminal", exact: true }).click();
    await expect(group).toHaveCount(0);
    await preferences.click(); await expect(crypto).toHaveAttribute("aria-pressed", "true");
    const crop = info.outputPath(`preference-section-return-${lang}.png`);
    await page.screenshot({ path: crop }); await info.attach("preference-section-return", { path: crop, contentType: "image/png" });
    release(); await expect.poll(() => acknowledged.length).toBe(1);
    expect(acknowledged).toEqual([{ trade_types: ["stocks", "options", "crypto"] }]);
    await page.reload(); await page.locator(".avatar:visible").first().click();
    await preferences.click(); await expect(crypto).toHaveAttribute("aria-pressed", "true");
    expect(requested).toHaveLength(1);
    await expect(group.getByRole("button", { name: lang === "zh" ? "你交易什么: 股票" : "What you trade: Stocks", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: lang === "zh" ? "你交易什么: 期权" : "What you trade: Options", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
}
