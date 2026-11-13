import { expect, test } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";

// Controlled Workspace/gateway presentation, not an authenticated production read.
// The legacy coordinates are synthetic and the native owner is deliberately absent.
for (const language of ["en", "zh"]) for (const theme of ["dark", "light"]) {
  test(`dated Rotation snapshot preserves keyboard return in ${language} and ${theme}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), language);
    await page.route("**/api/sector-intelligence?**", route => {
      const source = new URL(route.request().url()).searchParams.get("source");
      if (source === "generation") return route.fulfill({ status: 404, json: {
        data: null, receipt: { source, status: "unavailable", path: "/api/sector-generation?audience=preview",
          asOf: null, observedAt: null, contentHash: null, stale: false },
      } });
      if (source === "sector") return route.fulfill({ json: {
        data: { as_of: "2026-11-12", sectors: [{ id: "xlk", ticker: "XLK", kind: "sector",
          name: "Synthetic Technology", name_zh: "合成科技", momentum: { rs_21d: 7, rs_63d: 5 }, heat: {}, rotation: {} }] },
        receipt: { source, status: "ready", path: "/sectordata/sector_central.json",
          asOf: "2026-11-12", observedAt: "2026-11-13T00:00:00Z", contentHash: null, stale: false },
      } });
      return sectorFixture(route);
    });
    await page.route("**/api/quote?**", route => route.fulfill({ json: { quotes: {} } }));
    await page.goto(`/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorTheme=${theme}`);
    const rotation = page.getByTestId("sector-rotation");
    const open = rotation.getByTestId("rotation-legacy-open");
    const close = rotation.getByTestId("rotation-legacy-close");
    await expect(open).toContainText("2026-11-12");
    await expect(rotation.getByTestId("rotation-legacy-notice")).toHaveCount(0);
    await open.focus();
    await open.press("Enter");
    await expect(close).toBeFocused();
    await expect(rotation.getByTestId("rotation-legacy-notice")).toContainText("2026-11-12");
    await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(1);
    for (const id of ["rotation-history", "rotation-native-episodes", "rotation-measured-coverage"]) {
      await expect(rotation.getByTestId(id)).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await info.attach(`rotation-snapshot-${language}-${theme}`, { body: await rotation.screenshot(), contentType: "image/png" });
    await close.press("Space");
    await expect(open).toBeFocused();
    await expect(rotation.getByTestId("rotation-legacy-notice")).toHaveCount(0);
    await open.press("Space");
    await expect(close).toBeFocused();
    await close.press("Enter");
    await expect(open).toBeFocused();
    expect(errors).toEqual([]);
  });
}
