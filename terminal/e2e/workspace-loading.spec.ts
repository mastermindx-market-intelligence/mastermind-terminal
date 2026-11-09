import { expect, test } from "@playwright/test";

// Hold the real destination module, rather than rendering a separate preview of
// the fallback. The existing /dislocations fixture owns the eventual ready state.
for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`workspace transition stays visible (${reducedMotion})`, async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
    await page.context().addCookies([{ name: "mm_e2e_dislo", value: "fresh", url: baseURL! }]);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held = 0;
    await page.route(
      (url) => url.pathname.includes("/_next/static/chunks/") && /dislocation/i.test(url.pathname) && url.pathname.endsWith(".js"),
      async (route) => { held += 1; await gate; await route.continue(); },
    );

    try {
      await page.goto("/options?tab=screener");
      await expect(page.locator("#wtab-vol")).toBeVisible({ timeout: 30_000 });
      const narrow = (page.viewportSize()?.width ?? 1440) <= 860;
      if (narrow) {
        await page.locator(".mobilebar").getByRole("button", { name: "Menu", exact: true }).click();
        await page.locator(".m-nav").getByRole("link", { name: "Dislocations", exact: true }).click();
      } else {
        await page.locator(".appnav").getByRole("link", { name: "Dislocations", exact: true }).click();
      }
      await page.mouse.move(0, 0);
      await expect.poll(() => held).toBeGreaterThan(0);

      const loading = page.locator("[data-route-loading]");
      await expect(loading).toHaveCount(1);
      await expect(loading.getByRole("status")).toHaveText("Loading…");
      await expect(loading.getByRole("status")).toBeVisible();
      await expect(page.locator(narrow ? ".mobilebar" : ".appnav")).toBeVisible();

      const geometry = await loading.evaluate((root) => {
        const box = root.getBoundingClientRect();
        const shapes = [...root.querySelectorAll<HTMLElement>('[aria-hidden="true"] div')]
          .filter((el) => getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)" && el.getBoundingClientRect().width > 0);
        return {
          x: box.x, right: box.right, bottom: box.bottom, width: box.width, height: box.height,
          viewportWidth: innerWidth, viewportHeight: innerHeight,
          paintedShapes: shapes.length,
          documentOverflow: document.documentElement.scrollWidth - innerWidth,
          animations: root.getAnimations({ subtree: true }).length,
        };
      });
      expect(geometry.paintedShapes).toBeGreaterThan(10);
      expect(geometry.width).toBeGreaterThan(200);
      expect(geometry.height).toBeGreaterThan(200);
      expect(geometry.x).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
      if (reducedMotion === "reduce") expect(geometry.animations).toBe(0);
      await page.screenshot({ path: info.outputPath(`loading-${info.project.name}-${reducedMotion}.png`) });
    } finally {
      release();
    }

    await expect(page.getByTestId("dislo-status")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-route-loading]")).toHaveCount(0);
  });
}
