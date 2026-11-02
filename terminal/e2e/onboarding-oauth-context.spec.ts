import { expect, test } from "@playwright/test";

// Exercise the real Google kickoff and resume consumer. Only the external
// provider navigation is intercepted; no production account or token is used.
for (const lang of ["en", "zh"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`Google handoff retains company research and dashboard return (${lang}, ${theme} system preference)`, async ({ page }, info) => {
      // The shipped reduced-motion mode stops the return button's decorative pulse.
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(({ lang }) => localStorage.setItem("mm.lang", lang), { lang });
      const ret = "https://www.mastermind-x.com/commodities.html#cw/relationships/oil?window=60&compare=oil%2Cgold&hypothesis=supply";
      const query = new URLSearchParams({
        signin: "1", symbol: "A", page: "intelligence", from: "macro", ret,
        mo_from: "transmission", mo_chain: "oil_inflation_duration_derate",
        mo_channel: "long_duration_valuation", mo_asof: "2026-10-16",
        mo_security: "SEC:US-XNYS-A",
      });
      await page.goto("/analysis?" + query);
      const origin = new URL(page.url()).origin;
      // Match the SAME gated, same-origin Supabase fixture base configured by
      // playwright.config.ts. No production provider or second auth port is used.
      const authorizePath = "/api/__e2e__/supabase/auth/v1/authorize";
      await page.route(`${origin}${authorizePath}?**`, (route) =>
        route.fulfill({ contentType: "text/html", body: "<p>Local OAuth handoff fixture</p>" }));
      const sheet = page.getByRole("dialog", { name: lang === "zh" ? "欢迎回来" : "Welcome back" });
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await sheet.screenshot({ path: info.outputPath(`${info.project.name}-${lang}-${theme}-oauth.png`) });

      const authorizeRequest = page.waitForRequest((request) =>
        new URL(request.url()).origin === origin && new URL(request.url()).pathname === authorizePath);
      await sheet.getByRole("button", { name: lang === "zh" ? "使用 Google 继续" : "Continue with Google", exact: true }).click();
      const authorize = new URL((await authorizeRequest).url());
      expect(authorize.origin).toBe(origin);
      expect(authorize.pathname).toBe(authorizePath);
      expect(authorize.searchParams.get("provider")).toBe("google");
      const callback = new URL(authorize.searchParams.get("redirect_to")!);
      expect(callback.origin + callback.pathname).toBe(origin + "/auth/callback");
      const relativeNext = callback.searchParams.get("next")!;
      const next = new URL(relativeNext, origin);
      expect(next.pathname).toBe("/analysis");
      expect(next.searchParams.get("symbol")).toBe("A");
      expect(next.searchParams.get("page")).toBe("intelligence");
      expect(next.searchParams.get("from")).toBe("macro");
      expect(next.searchParams.get("ret")).toBe(ret);
      expect(next.searchParams.get("mo_from")).toBe("transmission");
      expect(next.searchParams.get("mo_chain")).toBe("oil_inflation_duration_derate");
      expect(next.searchParams.get("mo_channel")).toBe("long_duration_valuation");
      expect(next.searchParams.get("mo_asof")).toBe("2026-10-16");
      expect(next.searchParams.get("mo_security")).toBe("SEC:US-XNYS-A");
      expect(next.searchParams.getAll("onboard")).toEqual(["resume"]);
      await info.attach("oauth-navigation", { body: JSON.stringify({ next: relativeNext }), contentType: "application/json" });

      // The fixture server already supplies a signed-in session. The real
      // callback's code-exchange behavior is covered by authCallbackRecovery;
      // here its admitted next goes through the actual resume UI and cleanup.
      await page.goto(callback.toString());
      await expect(page.getByRole("heading", { name: lang === "zh" ? "布置你的工作台" : "Set up your desk", exact: true })).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => new URL(page.url()).searchParams.has("onboard")).toBe(false);
      const resumed = new URL(page.url());
      expect(resumed.pathname).toBe("/analysis");
      for (const [key, value] of query) {
        if (key !== "signin") expect(resumed.searchParams.get(key)).toBe(value);
      }
      expect(resumed.searchParams.has("signin")).toBe(false);
      expect(await page.evaluate(() => localStorage.getItem("mm.onboardResume"))).toBeNull();
      await page.getByRole("dialog").getByRole("button", { name: lang === "zh" ? "关闭" : "Close", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${info.project.name}-${lang}-${theme}-research-resumed.png`) });
      await page.route("https://www.mastermind-x.com/commodities.html**", (route) =>
        route.fulfill({ contentType: "text/html", body: "<p>Local Commodities return fixture</p>" }));
      const dashboardReturn = page.getByRole("button", { name: lang === "zh" ? "返回宏观仪表盘" : "Back to the Macro Dashboard", exact: true });
      await expect(dashboardReturn).toBeVisible();
      await dashboardReturn.click();
      await expect(page).toHaveURL(ret);
      await info.attach("company-return", { body: JSON.stringify({ href: page.url() }), contentType: "application/json" });
    });
  }
}
