import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"] as const) for (const lang of ["en", "zh"] as const) {
  test(`position opportunity is inspectable and bounded: ${theme}/${lang}`, async ({ page }, testInfo) => {
    const saves: unknown[] = [];
    await page.route("**/api/drawings**", async route => {
      if (route.request().method() !== "GET") saves.push(route.request().postData());
      await route.fulfill({ json: route.request().method() === "GET" ? { drawings: [{
        id: "opportunity-plan", kind: "longposition", source: "user",
        points: [{ t: "2026-06-03", p: 198 }, { t: "2026-06-24", p: 216 }, { t: "2026-06-24", p: 189 }],
        color: "var(--up)", fillOpacity: .16,
      }] } : { ok: true } });
    });
    await page.addInitScript(({ theme, lang }) => {
      localStorage.removeItem("mm.draw");
      localStorage.setItem("mm.lang", lang);
      localStorage.setItem("mm.theme", theme);
      localStorage.setItem("mm.inds", JSON.stringify([]));
    }, { theme, lang });
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
    const drawing = page.locator('.pane.on g[data-drawing-id="opportunity-plan"]');
    await expect(drawing).toBeVisible();
    const chip = drawing.locator('[data-position-opportunity="1"]');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-original-r", "2");
    await expect(chip).toHaveAttribute("pointer-events", "none");
    await expect(chip).toHaveAttribute("aria-label", new RegExp(lang === "en" ? "Planning geometry only" : "仅为计划几何"));
    await expect(chip.locator('[data-opportunity-basis="1"]')).toContainText(lang === "en" ? "Last chart price" : "图表末价");
    const ref = Number(await chip.getAttribute("data-reference-price"));
    expect(Number.isFinite(ref) && ref > 0).toBe(true);
    const remaining = await chip.getAttribute("data-remaining-r");
    if (ref > 189 && ref < 216) expect(Number(remaining)).toBeCloseTo((216 - ref) / (ref - 189), 9);
    else expect(remaining).toBe("");
    await expect(chip.locator('[data-opportunity-summary="1"]')).toContainText(lang === "en" ? "Plan 2.00R" : "计划 2.00R");
    const box = await chip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(saves, "reading geometry must not author or migrate a user's drawing").toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath(`position-opportunity-${theme}-${lang}.png`), fullPage: true });
  });
}
