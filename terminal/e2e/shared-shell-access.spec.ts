import { expect, test, type Locator, type Page } from "@playwright/test";

test.skip(process.env.MMX_SHARED_SHELL !== "1", "Shared Shell is an explicit beta opt-in");
test.use({ colorScheme: "dark" });

async function reachableAction(page: Page, action: Locator) {
  await action.scrollIntoViewIfNeeded();
  await action.focus();
  const target = await action.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { width: box.width, height: box.height, left: box.left, right: box.right,
      top: box.top, bottom: box.bottom, reachable: hit === node || node.contains(hit) };
  });
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.left).toBeGreaterThanOrEqual(0);
  expect(target.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(target.top).toBeGreaterThanOrEqual(0);
  expect(target.bottom).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  expect(target.reachable).toBe(true);
  await expect(action).toBeFocused();
}

async function shellStaysInPlace(page: Page) {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const chrome = page.locator(page.viewportSize()!.width <= 900 ? ".mobilebar" : ".topbar");
  await expect(chrome).toBeVisible();
  expect((await chrome.boundingBox())!.y).toBeGreaterThanOrEqual(0);
}

test("guest access actions stay reachable and open their existing dialogs", async ({ page }, info) => {
  await page.goto("/today");
  const gate = page.locator("main#shared-shell-content");
  await expect(gate.getByRole("button", { name: "Create your free account", exact: true })).toBeVisible();
  for (const zh of [false, true]) {
    if (zh) {
      await page.getByRole("button", { name: "Light theme", exact: true }).click();
      await page.getByRole("button", { name: "Chinese language", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
    }
    const signup = gate.getByRole("button", { name: zh ? "创建免费账户" : "Create your free account", exact: true });
    const signin = gate.getByRole("button", { name: zh ? "已有账户？登录" : "Already have an account? Sign in", exact: true });
    let signupVisited = false;
    for (const [action, title] of [
      [signup, zh ? "创建账户" : "Create your account"],
      [signin, zh ? "欢迎回来" : "Welcome back"],
      [signup, zh ? "创建账户" : "Create your account"],
    ] as const) {
      await reachableAction(page, action);
      await shellStaysInPlace(page);
      await action.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: title, exact: true })).toBeVisible();
      if (!zh && title === "Create your account") {
        const firstName = dialog.getByRole("textbox", { name: "First name", exact: true });
        if (signupVisited) await expect(firstName).toHaveValue("Casey");
        else await firstName.fill("Casey");
        signupVisited = true;
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    await gate.evaluate((node) => { node.scrollTop = 0; });
    await page.screenshot({ animations: "disabled", path: info.outputPath(`guest-${zh ? "light-zh" : "dark-en"}.png`) });
  }
});

test("short viewports scroll the access card without displacing shell navigation", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Explicit short-viewport regression");
  for (const viewport of [{ width: 568, height: 320 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/today");
    const gate = page.locator("main#shared-shell-content");
    const signin = gate.getByRole("button", { name: "Already have an account? Sign in", exact: true });
    await expect(signin).toBeVisible();
    await reachableAction(page, signin);
    await shellStaysInPlace(page);
    expect((await gate.boundingBox())!.y).toBeGreaterThanOrEqual(56);
    if (viewport.height === 320) expect(await gate.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`guest-scrolled-${viewport.width}x${viewport.height}.png`) });
    await gate.evaluate((node) => { node.scrollTop = 0; });
    const heading = gate.getByRole("heading", { level: 1 });
    expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(56);
    await expect(heading).toBeInViewport();
    await shellStaysInPlace(page);
  }
});

test("session verification failure keeps usable retry and sign-in actions", async ({ page }) => {
  // The real server returns the anonymous gate. Only this local browser fixture
  // starts in the incumbent recovery cooldown; no new production auth seam.
  await page.addInitScript(() => {
    document.cookie = "sb-local-auth-token=fixture; path=/; SameSite=Lax";
    sessionStorage.setItem("mmx-member-session-restore", String(Date.now()));
  });
  await page.goto("/today");
  const gate = page.locator("main#shared-shell-content");
  await expect(gate.getByRole("heading", { name: "We couldn’t verify your session", exact: true })).toBeVisible();
  await expect(gate.getByRole("button", { name: "Create your free account", exact: true })).toHaveCount(0);
  const signin = gate.getByRole("button", { name: "Already have an account? Sign in", exact: true });
  await reachableAction(page, signin);
  await signin.press("Enter");
  await expect(page.getByRole("dialog", { name: "Welcome back", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const retry = gate.getByRole("button", { name: "Try again", exact: true });
  await reachableAction(page, retry);
  await retry.press("Enter");
  await expect(gate.getByRole("button", { name: "Create your free account", exact: true })).toBeVisible();
  await shellStaysInPlace(page);
});

test("standalone account outage keeps a usable retry without guest chrome", async ({ page, context }, info) => {
  const authHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321").hostname;
  test.skip(!["127.0.0.1", "localhost"].includes(authHost), "Malformed-session fixture is loopback only");
  await page.goto("/today");
  const session = { access_token: "malformed-local-test-token", refresh_token: "local-test-only",
    expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer",
    user: { id: "00000000-0000-4000-8000-000000000001" } };
  await context.addCookies([{ name: `sb-${authHost.split(".")[0]}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    url: new URL(page.url()).origin, sameSite: "Lax" }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Account service unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create your free account", exact: true })).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Retry account verification", exact: true });
  await reachableAction(page, retry);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ animations: "disabled", path: info.outputPath("account-service-unavailable.png") });
});

test("Discover focused workflows retain their destinations and usable touch targets", async ({ page }, info) => {
  if (info.project.name === "desktop") await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  for (const href of ["/us_stocks.html", "/biocatalyst.html", "/confluence_screener.html"]) {
    const link = page.locator(`main a[href="${href}"]`);
    await expect(link).toHaveCount(1);
    await reachableAction(page, link);
    await expect(link).toHaveCSS("outline-style", "solid");
    await expect(link).toHaveCSS("outline-width", "2px");
    await shellStaysInPlace(page);
  }
  await page.screenshot({ animations: "disabled", path: info.outputPath("discover-focused-workflows.png") });
});
