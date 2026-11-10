import { expect, test } from "@playwright/test";

test("drawing tooltip dismissal preserves focus, actions, and touch suppression", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  const viewport = page.viewportSize()!;
  // This is the real desktop dock; tablet/phone cases verify continuation across
  // the existing suppression boundary rather than inventing a touch tooltip.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  const trigger = page.getByTestId("drawing-group-lines-main");
  await expect(trigger).toBeVisible();
  await trigger.focus();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-describedby", await tip.getAttribute("id") ?? "");
  await page.screenshot({ path: info.outputPath(`tooltip-open-${info.project.name}.png`) });
  const pressed = await trigger.getAttribute("aria-pressed");
  await trigger.press("Escape");
  await expect(tip).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-pressed", pressed ?? "false");

  // A fresh focus interaction opens again. A same-breakpoint resize dismisses
  // the fixed label without relying on pointer leave or mobile suppression.
  await page.getByTestId("drawing-tool-cursor").focus();
  await trigger.focus(); await expect(tip).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(tip).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(trigger).toHaveAttribute("aria-pressed", "true");

  if (info.project.name !== "desktop") {
    await page.getByTestId("drawing-tool-cursor").focus();
    await trigger.focus(); await expect(tip).toBeVisible();
    await page.setViewportSize(viewport);
    await expect(tip).toHaveCount(0);
    if (info.project.name === "tablet") {
      await expect(trigger).toBeVisible();
      await trigger.focus(); await expect(tip).toHaveCount(0);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(trigger).toBeVisible(); await expect(tip).toHaveCount(0);
  }
  await page.screenshot({ path: info.outputPath(`tooltip-dismissed-${info.project.name}.png`) });
});

test("navigation tooltip Escape keeps its link ready for keyboard use", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The mobile menu has visible labels instead of the desktop tooltip rail");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await page.goto("/options?tab=screener");
  await expect(page.locator("#wtab-vol")).toBeVisible({ timeout: 30_000 });
  const link = page.locator('.appnav a[href="/dislocations"]');
  await link.focus(); await expect(page.getByRole("tooltip")).toBeVisible();
  await link.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0); await expect(link).toBeFocused();
  await link.press("Enter"); await expect(page).toHaveURL(/\/dislocations$/);
  await expect(page.getByTestId("dislo-status")).toBeVisible({ timeout: 30_000 });
});
