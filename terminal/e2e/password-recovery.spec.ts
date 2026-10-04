import { expect, test } from "@playwright/test";

test("the canonical sign-in sheet has a recoverable password path at every supported width", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  if (zh) {
    await page.addInitScript(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      document.documentElement.setAttribute("lang", "zh-CN");
    });
  }

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();
      if (!url.includes("/auth/v1/recover")) return originalFetch(input, init);

      let rawBody = init?.body;
      if (!rawBody && input instanceof Request) rawBody = await input.clone().text();
      let email: string | undefined;
      if (typeof rawBody === "string") {
        try { email = (JSON.parse(rawBody) as { email?: string }).email; } catch { /* test captures URL even without body */ }
      }
      (window as unknown as { __mmRecoveryRequest?: { email?: string; url: string } }).__mmRecoveryRequest = {
        email,
        url,
      };
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  });

  await page.goto("/terminal?signin=1");

  const dialog = page.getByRole("dialog", { name: zh ? "欢迎回来" : "Welcome back" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole("heading", { name: zh ? "欢迎回来" : "Welcome back" })).toBeVisible();

  const email = dialog.getByLabel(zh ? "邮箱" : "Email");
  await email.fill("admin@mastermind-x.com");
  await dialog.getByRole("button", { name: zh ? "忘记密码？" : "Forgot password?" }).click();

  await expect(dialog.getByRole("status")).toHaveText(
    zh
      ? "如果该邮箱已注册，我们已发送密码重置链接。"
      : "If that email is registered, we sent a password-reset link.",
  );

  const recoveryRequest = await page.evaluate(() =>
    (window as unknown as { __mmRecoveryRequest?: { email?: string; url: string } }).__mmRecoveryRequest,
  );
  expect(recoveryRequest?.email).toBe("admin@mastermind-x.com");
  expect(new URL(recoveryRequest?.url || "").searchParams.get("redirect_to")).toBe(
    new URL("/auth/callback?next=%2Freset-password", page.url()).toString(),
  );

  const geometry = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);

  await dialog.screenshot({
    path: testInfo.outputPath(testInfo.project.name + "-password-recovery.png"),
  });
});

test("an expired or directly-opened reset link fails closed instead of showing a password form", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  if (zh) {
    await page.addInitScript(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      document.documentElement.setAttribute("lang", "zh-CN");
    });
  }

  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: zh ? "重置密码" : "Reset your password" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(
    zh
      ? "此重置链接无效或已过期。请从登录界面重新申请。"
      : "This reset link is invalid or expired. Request a new one from sign in.",
  )).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: zh ? "登录" : "Sign in" })).toHaveAttribute(
    "href",
    "/terminal?signin=1",
  );

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);

  await page.locator(".authcard").screenshot({
    path: testInfo.outputPath(testInfo.project.name + "-password-reset-invalid.png"),
  });
});
