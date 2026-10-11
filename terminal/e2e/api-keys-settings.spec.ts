import { expect, test, type Page } from "@playwright/test";

async function mockKeyApis(page: Page, keys: unknown[] = []) {
  await page.route("**/api/account/api-keys**", async (route) => {
    const method = route.request().method();
    if (method === "POST" && route.request().url().match(/api-keys\/[^/?]+$/)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          key: {
            keyId: "k1",
            keyPrefix: "abcd1234",
            label: "Research laptop",
            scopes: ["read"],
            createdAt: "2026-09-13T00:00:00.000Z",
            lastUsedAt: null,
            revokedAt: "2026-09-13T01:00:00.000Z",
          },
        }),
      });
      return;
    }
    if (method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          key: {
            keyId: "k1",
            keyPrefix: "abcd1234",
            label: "Research laptop",
            scopes: ["read"],
            createdAt: "2026-09-13T00:00:00.000Z",
            lastUsedAt: null,
            revokedAt: null,
          },
          secret: "mmx_" + "c".repeat(40),
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ keys }),
    });
  });
}

test("settings Developer access section is reachable in EN and ZH", async ({ page }, testInfo) => {
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("api-keys-settings.spec.ts requires a project with a fixed viewport");
  }
  expect(["desktop", "tablet", "mobile"], `unexpected project ${testInfo.project.name}`).toContain(
    testInfo.project.name,
  );
  await mockKeyApis(page, []);
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
  });
  await page.goto("/dev/settings?s=developer&lang=en");
  const dialog = page.locator(".acs-overlay.open .acs-card");
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  // The rail now has 13 rows (developer from master + portfolioTargets is the new last tab, added by #586).
  // Assert Sharing is present — order-independent; do not assume it is last().
  await expect(dialog.getByRole("tab", { name: "Sharing" })).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Portfolio targets" })).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Developer access" })).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Developer access" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Developer access" })).toBeVisible();
  await expect(page.getByText("You have not minted a personal API key yet.")).toBeVisible();
  await expect(page.getByText("Team keys aren't available yet — keys are personal for now.")).toBeVisible();

  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "zh");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
  });
  await page.goto("/dev/settings?s=developer&lang=zh");
  const zhDialog = page.locator(".acs-overlay.open .acs-card");
  await expect(zhDialog).toBeVisible({ timeout: 45_000 });
  await expect(zhDialog.getByRole("tab", { name: "共享" })).toBeVisible();
  await expect(zhDialog.getByRole("tab", { name: "组合目标权重" })).toBeVisible();
  await expect(zhDialog.getByRole("tab", { name: "开发者访问" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "开发者访问" })).toBeVisible();
  await expect(page.getByText("你还没有创建个人 API 密钥。")).toBeVisible();
  await expect(page.getByText("团队密钥暂未开放，目前仅支持个人密钥。")).toBeVisible();
});
