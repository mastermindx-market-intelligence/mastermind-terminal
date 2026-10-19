import { expect, test } from "@playwright/test";

// The fixture server already supplies this signed-in email. A refresh therefore
// cannot produce the empty→populated transition the old completion path awaited.
for (const lang of ["en", "zh"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`acknowledged sign-in closes without an email transition (${lang}, ${theme} system preference)`, async ({ page }, info) => {
      // Terminal currently has one dark art direction. Exercise both system
      // preferences without claiming that a localStorage key supplies a light UI.
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(({ lang }) => {
        localStorage.setItem("mm.lang", lang);
      }, { lang });
      const user = {
        id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated",
        email: "responsive@example.com", app_metadata: {}, user_metadata: {},
        created_at: "2026-10-11T00:00:00Z",
      };
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`;
      // Match the existing password-recovery fixture seam. Chromium may reject
      // a cross-port local request before route interception, so supply the
      // Auth response at fetch while keeping the real SDK and form path intact.
      await page.addInitScript(({ user, token }) => {
        const state = window as unknown as { __mmSigninSubmissions: number; __mmResolveSignin?: () => void };
        state.__mmSigninSubmissions = 0;
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const raw = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
          const url = new URL(raw, window.location.href);
          if (!url.pathname.startsWith("/auth/v1/")) return originalFetch(input, init);
          if (url.origin !== "http://127.0.0.1:54321") throw new Error("Unexpected auth fixture origin");
          if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
            state.__mmSigninSubmissions += 1;
            await new Promise<void>((resolve) => { state.__mmResolveSignin = resolve; });
            return new Response(JSON.stringify({ access_token: token, token_type: "bearer",
              expires_in: 3600, refresh_token: "local-fixture-only", user }),
            { status: 200, headers: { "content-type": "application/json" } });
          }
          if (url.pathname === "/auth/v1/user") return new Response(JSON.stringify(user),
            { status: 200, headers: { "content-type": "application/json" } });
          throw new Error("Unexpected auth fixture operation");
        };
      }, { user, token });

      await page.goto("/terminal?signin=1&sym=NVDA&from=press-signin-regression");
      const sheet = page.getByRole("dialog", { name: lang === "zh" ? "欢迎回来" : "Welcome back" });
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await sheet.getByLabel(lang === "zh" ? "邮箱" : "Email", { exact: true }).fill(user.email);
      await sheet.getByLabel(lang === "zh" ? "密码" : "Password", { exact: true }).fill("local-fixture-password");
      await sheet.screenshot({ path: info.outputPath(`${info.project.name}-${lang}-${theme}-signin.png`) });
      await sheet.getByRole("button", { name: lang === "zh" ? "登录" : "Sign in", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __mmSigninSubmissions: number }).__mmSigninSubmissions)).toBe(1);
      await expect(sheet.getByRole("button", { name: lang === "zh" ? "新用户？创建账户" : "New here? Create your account", exact: true })).toBeDisabled();
      await expect(sheet).toBeVisible();
      await page.evaluate(() => (window as unknown as { __mmResolveSignin?: () => void }).__mmResolveSignin?.());
      await expect(sheet).toBeHidden({ timeout: 15_000 });
      expect(await page.evaluate(() => (window as unknown as { __mmSigninSubmissions: number }).__mmSigninSubmissions)).toBe(1);
      const url = new URL(page.url());
      expect(url.searchParams.get("sym")).toBe("NVDA");
      expect(url.searchParams.get("from")).toBe("press-signin-regression");
      expect(url.searchParams.has("signin")).toBe(false);
      await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${info.project.name}-${lang}-${theme}-continued.png`) });
    });
  }
}
