import { expect, test } from "@playwright/test";
import { chartContextReturnTarget, openChartContext } from "./phoneChrome";
import { useLang } from "./layoutStore";

for (const lang of ["en", "zh"] as const) {
  for (const choice of ["useful", "unclear"] as const) {
    test(`feedback acknowledgement keeps keyboard focus and Escape return in ${lang} / ${choice}`, async ({ page }, info) => {
      await useLang(page, lang);
      await page.goto("/terminal?symbol=NVDA");
      const reader = await openChartContext(page, lang);
      await expect(reader.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20_000 });
      await reader.locator('[data-context-focus="previous"]').click();
      const selected = await reader.locator("[data-context-bar-time]").innerText();
      await reader.locator('[data-context-focus="help"]').click();
      const action = reader.locator(`[data-context-focus="${choice}"]`);
      await action.focus();
      await expect(action).toBeFocused();
      await page.keyboard.press("Enter");
      const thanks = lang === "zh" ? "感谢你的反馈" : "Thank you for the feedback";
      await expect(reader.getByText(thanks, { exact: true }).first()).toBeVisible();
      // Focus includes the 2px outline and 3px offset, even at a scroller edge.
      await expect.poll(() => action.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top >= 5 && rect.bottom <= innerHeight - 5;
      })).toBe(true);

      const capture = info.outputPath(`feedback-${info.project.name}-${lang}-${choice}.png`);
      await page.screenshot({ path: capture, animations: "disabled" });
      await info.attach("feedback-success", { path: capture, contentType: "image/png" });
      await info.attach("focus-after-feedback", {
        body: Buffer.from(JSON.stringify(await reader.evaluate((node) => ({
          activeTag: document.activeElement?.tagName,
          activeKey: (document.activeElement as HTMLElement | null)?.dataset.contextFocus ?? null,
          readerOwnsFocus: node.contains(document.activeElement),
          viewport: { width: innerWidth, height: innerHeight },
          documentWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          focusedBounds: (document.activeElement as HTMLElement | null)?.getBoundingClientRect().toJSON() ?? null,
        })), null, 2)),
        contentType: "application/json",
      });
      await expect.poll(() => reader.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      await expect(action).toBeFocused();
      await expect(action).toHaveAttribute("aria-disabled", "true");
      await expect(action).toHaveText(thanks);
      await expect(reader.getByRole("status")).toHaveText(thanks);
      await expect(reader.locator(`[data-context-focus="${choice === "useful" ? "unclear" : "useful"}"]`)).toBeHidden();

      // Acknowledgement is inert; repeated activation must not restart the flow.
      await page.keyboard.press("Space");
      await page.keyboard.press("Enter");
      await expect(action).toBeFocused();
      await expect(action).toHaveText(thanks);
      await expect(reader.locator("[data-context-bar-time]")).toHaveText(selected);
      await expect(reader.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "withheld");
      await expect(reader.locator("details").nth(2)).toHaveAttribute("open", "");
      await page.keyboard.press("Tab");
      await expect(reader.locator('[data-context-focus="hide"]')).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(action).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(reader).toHaveCount(0);
      await expect(chartContextReturnTarget(page, lang)).toBeFocused();
    });
  }
}
