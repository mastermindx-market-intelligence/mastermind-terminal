import { expect, test, type Page } from "@playwright/test";

async function mockWebhookApis(page: Page) {
  await page.route("**/api/teams**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ teams: [{ id: "team-1", name: "Desk", role: "owner" }], truncated: false }),
    });
  });
  await page.route("**/api/webhooks**", async (route) => {
    if (route.request().url().includes("/deliveries")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deliveries: [] }) });
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ endpoints: [], callerRole: "owner", truncated: false }),
      });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });
}

// This spec matches no project's testIgnore, so it runs in the desktop (1440),
// tablet (820) and mobile (390) shards. Every assertion below must therefore
// hold at all three widths: the Settings panel keeps its full nav at 390 (it
// becomes a horizontal scroller, it is not collapsed), so the seventh tab is
// present and selectable everywhere. The guard is explicit rather than
// implied — a project with no fixed viewport would otherwise pass vacuously.
test("settings Webhooks section is reachable in EN and ZH", async ({ page }, testInfo) => {
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("webhooks-settings.spec.ts requires a project with a fixed viewport");
  }
  expect(["desktop", "tablet", "mobile"], `unexpected project ${testInfo.project.name}`).toContain(
    testInfo.project.name,
  );
  await mockWebhookApis(page);
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
  });
  await page.goto("/dev/settings?s=webhooks&lang=en");
  const dialog = page.locator(".acs-overlay.open .acs-card");
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  const tabs = dialog.getByRole("tab");
  // Seven sections, Webhooks last — at 1440, 820 AND 390.
  await expect(tabs).toHaveCount(7);
  await expect(tabs.nth(6)).toHaveText("Webhooks");
  await expect(dialog.getByRole("tab", { name: "Webhooks" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
  await expect(page.getByText("You don't have a team yet")).toHaveCount(0);
  await expect(page.getByText("This team has not registered a webhook endpoint yet.")).toBeVisible();

  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "zh");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
  });
  await page.goto("/dev/settings?s=webhooks&lang=zh");
  const zhDialog = page.locator(".acs-overlay.open .acs-card");
  await expect(zhDialog).toBeVisible({ timeout: 45_000 });
  await expect(zhDialog.getByRole("tab")).toHaveCount(7);
  await expect(zhDialog.getByRole("tab").nth(6)).toHaveText("Webhook 回调");
  await expect(zhDialog.getByRole("tab", { name: "Webhook 回调" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Webhook 回调" })).toBeVisible();
  await expect(page.getByText("您还没有团队")).toHaveCount(0);
  await expect(page.getByText("此团队尚未登记 Webhook 端点。")).toBeVisible();
});
