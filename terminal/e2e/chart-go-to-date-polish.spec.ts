import { expect, test } from "@playwright/test";
import { useLang as selectLanguage } from "./layoutStore";

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: go-to-date supports deliberate focus, dismissal and command handoff`, async ({ page }, info) => {
    test.skip(page.viewportSize()!.width <= 640, "The existing phone chart intentionally has no date-range row or go-to-date action.");
    test.setTimeout(90_000); await selectLanguage(page, lang);
    await page.addInitScript(() => { localStorage.removeItem("mm.ws"); localStorage.setItem("mm.startTf", JSON.stringify("D")); });
    await page.goto("/terminal?symbol=NVDA");
    const calendar = page.locator(".cfb-cal").first();
    await expect(calendar).toBeVisible({ timeout: 30_000 });
    await calendar.click();
    const popup = page.locator(".cfb-goto-pop");
    const input = popup.locator('input[type="date"]');
    const go = popup.locator(".cfb-goto-go");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-label", await calendar.getAttribute("aria-label") as string);
    await expect(calendar).toHaveAttribute("aria-controls", await popup.getAttribute("id") as string);
    await expect(go).toBeDisabled();
    await input.fill("2025-01-15"); await expect(go).toBeEnabled();
    await go.focus(); await page.keyboard.press("A");
    await expect(page.locator(".smodal")).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(popup).toHaveCount(0); await expect(calendar).toBeFocused();

    await calendar.click(); await expect(input).toBeFocused();
    await calendar.click(); await expect(popup).toHaveCount(0);
    await calendar.click(); await expect(input).toBeFocused();
    await input.fill("2025-01-15"); await go.focus(); await page.keyboard.press("Tab");
    await expect(popup).toHaveCount(0);
    await expect(calendar).not.toBeFocused();
    await calendar.click(); await expect(input).toBeFocused();
    const outside = page.locator(".cfb-range").first();
    await outside.click(); await expect(popup).toHaveCount(0); await expect(outside).toBeFocused();

    // The command palette hands focus to the same existing disclosure.
    await outside.evaluate(el => (el as HTMLElement).blur()); await page.keyboard.press(">");
    const palette = page.locator("[data-command-palette]");
    await expect(palette).toBeVisible();
    await palette.locator("input[role=combobox]").fill("Go to date");
    await palette.locator('[data-action-id="chart:goto-date"]').click();
    await expect(palette).toHaveCount(0); await expect(input).toBeFocused();
    const box = await popup.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if (info.project.use.hasTouch) {
      for (const control of [calendar, input, go]) {
        const b = await control.boundingBox(); expect(b!.height).toBeGreaterThanOrEqual(44);
      }
    }
    const crop = info.outputPath(`chart-go-to-date-${lang}.png`);
    await page.screenshot({ path: crop }); await info.attach("chart-go-to-date", { path: crop, contentType: "image/png" });
    await input.fill("2025-01-15"); await go.click();
    await expect(popup).toHaveCount(0); await expect(calendar).toBeFocused();
  });
}
