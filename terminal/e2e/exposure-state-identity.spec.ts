import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fixture = JSON.parse(readFileSync("public/data/gexstate_fixture.json", "utf8"));
// These are synthetic source values for response ordering, not market observations.
for (const oldFails of [false, true]) {
  test(`Exposure preserves selected QQQ after delayed SPY ${oldFails ? "failure" : "success"}`, async ({ page }, info) => {
    const zh = info.project.name === "tablet";
    if (zh) await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let spyWaiting = false;
    await page.route("**/api/flow?*", async (route) => {
      const f = new URL(route.request().url()).searchParams.get("f");
      if (f === "gexstate:SPY") {
        spyWaiting = true;
        await hold;
        await route.fulfill({ status: oldFails ? 503 : 200, json: oldFails ? {} : { ...fixture, root: "SPY", gamma_flip: 760 } });
      } else if (f === "gexstate:QQQ") {
        await route.fulfill({ json: { ...fixture, root: "QQQ", gamma_flip: 701, call_wall: 710, put_wall: 690 } });
      } else await route.fallback();
    });
    try {
      await page.goto("/options?tab=prism");
      await expect.poll(() => spyWaiting).toBe(true);
      await page.getByRole("button", { name: "QQQ", exact: true }).click();
      const belt = page.getByRole("region", { name: zh ? "收盘期权结构背景" : "End-of-day options structure context", exact: true });
      const flip = belt.getByText(zh ? "伽马翻转" : "Gamma flip", { exact: true }).locator("..");
      await expect(flip).toContainText("701");
      const response = page.waitForResponse((r) => new URL(r.url()).searchParams.get("f") === "gexstate:SPY");
      release();
      await (await response).finished();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByRole("button", { name: "QQQ", exact: true })).toHaveClass(/\bon\b/);
      await expect(flip).toContainText("701");
      await expect(flip).not.toContainText("760");
      await flip.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${info.project.name}-exposure-state-${oldFails ? "error" : "success"}.png`), fullPage: false });
    } finally {
      release();
    }
  });
}
