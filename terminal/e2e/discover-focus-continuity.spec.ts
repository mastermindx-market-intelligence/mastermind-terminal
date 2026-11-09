import { expect, test } from "@playwright/test";

// The chooser exists only in the established beta presentation. CI runs this
// specification in its explicit Shared Shell qualification as well as discovery.
test.skip(process.env.MMX_SHARED_SHELL !== "1", "Shared Shell is an explicit beta opt-in");

for (const lang of ["en", "zh"] as const) {
  test(`Discover chooser keeps keyboard focus with the selected task (${lang})`, async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    await page.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
    await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL! }]);
    await page.goto("/discover");
    const heading = page.getByRole("heading", { name: lang === "zh" ? "发现" : "Discover", exact: true });
    await expect(heading).toBeVisible({ timeout: 30_000 });

    for (const [label, key] of [[lang === "zh" ? "打开热图" : "Open Heatmap", "heatmap"], [lang === "zh" ? "打开研究" : "Open study", "rs-pivot"]]) {
      const launch = page.getByRole("button", { name: label, exact: true });
      await launch.focus();
      const outerScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
      await launch.press("Enter");
      const tab = page.locator(`#wtab-${key}`);
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(tab).toBeFocused();
      await expect.poll(() => tab.evaluate(node => {
        const rail = node.closest('[role="tablist"]')!.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        return box.left >= rail.left - 1 && box.right <= rail.right + 1;
      })).toBe(true);
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(outerScroll);
      await page.screenshot({ path: info.outputPath(`discover-${key}-${lang}-${info.project.name}.png`) });

      const back = page.locator(".discover-chooser-back");
      await back.focus(); await back.press("Enter");
      await expect(heading).toBeFocused(); await expect(heading).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.locator(".discover-chooser-shell").getByRole("button", { name: lang === "zh" ? "搜索公司" : "Search companies", exact: true })).toBeFocused();
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(outerScroll);
    }
  });
}
