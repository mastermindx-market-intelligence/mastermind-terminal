import { expect, test, type Page } from "@playwright/test";
import { useLang as selectLanguage } from "./layoutStore";

const actualTimeframe = (page: Page) => page.evaluate(() =>
  (window as unknown as { __mmPaneSync?: () => { panes: { id: number; tf: string }[] } }).__mmPaneSync?.().panes.find(pane => pane.id === 0)?.tf ?? null);

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: timeframe picker separates native selection and favorites`, async ({ page }, info) => {
    test.setTimeout(90_000); await selectLanguage(page, lang);
    await page.addInitScript(() => {
      const fixture = window as Window & { timeframePickerReady?: boolean }; fixture.timeframePickerReady = false;
      window.addEventListener("mm:terminal-visual-ready", () => { fixture.timeframePickerReady = true; }, { once: true });
      localStorage.setItem("mm.startTf", JSON.stringify("D"));
      if (!sessionStorage.getItem("timeframe-picker-fixture")) {
        sessionStorage.setItem("timeframe-picker-fixture", "seeded");
        localStorage.setItem("mm.favtf", JSON.stringify(["D", "3D", "W", "1M"]));
      }
    });
    await page.goto("/terminal?symbol=NVDA");
    const ready = () => expect.poll(() => page.evaluate(() => Boolean((window as Window & { timeframePickerReady?: boolean }).timeframePickerReady))).toBe(true);
    await ready(); await expect.poll(() => actualTimeframe(page)).toBe("D");
    if (info.project.name === "mobile") {
      await expect(page.locator(".chart-tabs")).toBeHidden();
      await expect(page.getByTestId("roller-interval")).toBeVisible();
      await expect(page.getByTestId("roller-interval")).toContainText("D");
      await expect(page.getByRole("dialog", { name: lang === "zh" ? "时间周期" : "Timeframe", exact: true })).toHaveCount(0);
      return;
    }

    const trigger = page.locator(".tfbtn-edit");
    const picker = info.project.name === "desktop" ? page.locator(".tfgrid.show")
      : page.getByRole("dialog", { name: lang === "zh" ? "时间周期" : "Timeframe", exact: true });
    const interval = (value: string) => picker.getByRole("button", { name: value, exact: true });
    const favorite = (value: string) => picker.locator(`[data-timeframe-row="${value}"] [data-timeframe-action="favorite"]`);
    await trigger.focus(); await page.keyboard.press("Enter"); await expect(picker).toBeVisible();
    await expect(interval("D")).toBeFocused(); await expect(interval("D")).toBeInViewport();
    await expect(interval("D")).toHaveAttribute("aria-pressed", "true");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown"); await expect(interval("2D")).toBeFocused();
    await expect.poll(() => actualTimeframe(page)).toBe("D");

    await favorite("2D").focus(); await page.keyboard.press("Space");
    await expect(favorite("2D")).toHaveAttribute("aria-pressed", "true"); await expect(favorite("2D")).toBeFocused();
    await expect(favorite("2D")).toHaveAccessibleName(lang === "zh" ? "从收藏中移除 2D" : "Remove 2D from favorites");
    await expect.poll(() => actualTimeframe(page)).toBe("D");
    await page.keyboard.press("Space"); await expect(favorite("2D")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Space"); await expect(favorite("2D")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.favtf") || "[]"))).toEqual(["D", "3D", "W", "1M", "2D"]);
    // The favorite for an unavailable second interval remains independent from admission.
    const second = picker.locator('[data-timeframe-row="1s"] [data-timeframe-action="select"]');
    await expect(second).toBeDisabled();
    await favorite("1s").focus(); await page.keyboard.press("Space"); await expect(favorite("1s")).toHaveAttribute("aria-pressed", "true");
    await expect(second).toBeDisabled(); await expect.poll(() => actualTimeframe(page)).toBe("D");
    await page.keyboard.press("Space"); await expect(favorite("1s")).toHaveAttribute("aria-pressed", "false");

    if (info.project.name === "tablet") {
      expect((await interval("W").boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const target = (await favorite("2D").boundingBox())!;
      expect(target.height).toBeGreaterThanOrEqual(44); expect(target.width).toBeGreaterThanOrEqual(44);
    }
    await interval("W").focus(); await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0); await expect(trigger).toBeFocused();
    await expect(page.locator(".pane.on .pane-tf")).toHaveText("W"); await expect.poll(() => actualTimeframe(page)).toBe("W");
    await page.keyboard.press("Enter"); await expect(interval("W")).toBeFocused(); await expect(interval("W")).toBeInViewport();
    const crop = info.outputPath(`timeframe-picker-${lang}.png`);
    await page.screenshot({ path: crop, animations: "disabled" }); await info.attach("timeframe-picker", { path: crop, contentType: "image/png" });
    await page.keyboard.press("Escape"); await expect(picker).toHaveCount(0); await expect(trigger).toBeFocused();

    // A responsive mode change deliberately closes the old presentation, avoiding two focus owners.
    const original = page.viewportSize()!;
    const alternate = info.project.name === "desktop" ? { width: 820, height: 1180 } : { width: 1100, height: 900 };
    await trigger.click(); await page.setViewportSize(alternate);
    await expect(page.getByRole("dialog", { name: lang === "zh" ? "时间周期" : "Timeframe", exact: true })).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false"); await expect(trigger).toBeFocused();
    await trigger.click(); await page.setViewportSize(original);
    await expect(page.getByRole("dialog", { name: lang === "zh" ? "时间周期" : "Timeframe", exact: true })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.reload(); await ready(); await trigger.click();
    await expect(favorite("2D")).toHaveAttribute("aria-pressed", "true");
    await expect(favorite("1s")).toHaveAttribute("aria-pressed", "false");
  });
}
