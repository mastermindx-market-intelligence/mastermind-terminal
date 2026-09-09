import { expect, test } from "@playwright/test";

test("settings Webhooks section is reachable in EN and ZH", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
  });
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
  await page.goto("/dev/settings?s=webhooks&lang=en");
  const dialog = page.locator(".acs-overlay.open .acs-card");
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByRole("tab", { name: "Webhooks" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
  await expect(page.getByText("You don't have a team yet")).toHaveCount(0);
  await expect(page.getByText("This team has not registered a webhook endpoint yet.")).toBeVisible();
});
