import { expect, test } from "@playwright/test";
// Synthetic navigation proof: no production admission, calculation or Save.
for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  test(`Lab Scenario to exact Plan ${lang} ${theme}`, async ({ page }, info) => {
    const t = (en: string, zh: string) => lang === "en" ? en : zh;
    await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", domain: "127.0.0.1", path: "/" }]);
    await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), lang);
    let calculations = 0;
    page.on("request", r => { if (r.url().includes("/api/options/plan/expiry")) calculations++; });
    await page.route("**/api/flow?*", async route => {
      const f = new URL(route.request().url()).searchParams.get("f");
      if (f === "matrix:SPY") return route.fulfill({ json: { schema: "options_structure.matrix/v1", root: "SPY", session: "2026-10-05",
        cells: [{ strike: 785, expiry: "2026-10-09", call_vol: 243000, call_oi: 110000, put_vol: 0, put_oi: null }] } });
      if (f === "oi") return route.fulfill({ json: { schema: "options_hub.oi/v1", asof: "2026-10-23T20:00:00Z",
        movers: [{ root: "SPY", exp: "2026-10-30", right: "C", strike: 765, mid: 3, oi: 10, d_oi: 5 }] } });
      return route.fallback();
    });
    await page.goto("/options?tab=gex&view=research&keep=lab");
    const lab = page.getByRole("region", { name: t("3D Research Lab", "3D 期权研究室"), exact: true });
    await expect(lab).toBeVisible({ timeout: 30000 });
    // Presentation fixture only: real account preference hydration is covered separately.
    // Do not claim that a synthetic identity proves account theme synchronization.
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await lab.getByRole("button", { name: t("785 Call · 2026-10-09", "785 看涨 · 2026-10-09"), exact: true }).click();
    await lab.getByRole("button", { name: t("Scenario lab", "情景研究"), exact: true }).click();
    await expect(lab).toContainText(t("Matrix coordinates are not transferred", "矩阵坐标不会转入计划"));
    await expect(lab.getByRole("button", { name: t("Save investigation", "保存研究"), exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`scenario-${lang}-${theme}.png`) });
    await lab.getByRole("button", { name: t("Choose exact contracts for Plan", "前往精确合约候选列表"), exact: true }).click();
    await expect(page).toHaveURL(/tab=vol/);
    expect(new URL(page.url()).searchParams.get("keep")).toBe("lab");
    await expect(lab).toBeHidden();
    const open = page.getByTestId("shortlist-plan-path").getByRole("button", { name: t("Plan from pinned contracts", "用固定合约创建计划"), exact: true });
    // The IW2 composition may retain its native saved-research entry with no
    // pins. The navigation contract forbids an invented Plan, not that entry.
    await expect(page.getByTestId("shortlist-plan-path").getByTestId("options-plan-draft")).toHaveCount(0);
    await page.getByRole("button", { name: t("Pin SPY 2026-10-30 765 Call to compare", "固定 SPY 2026-10-30 765 认购 用于对比"), exact: true }).click();
    await open.click();
    const editor = page.getByTestId("options-plan-draft");
    await expect(editor).toBeVisible(); await expect(editor).toContainText("765"); await expect(editor).not.toContainText("785");
    await expect(editor.locator('input[id*="entry"]')).toHaveValue("");
    await expect(editor.locator('input[id*="quantity"]')).toHaveValue("");
    await editor.locator('input[id*="quantity"]').fill("2");
    await editor.locator('input[id*="entry"]').fill("1.25");
    await page.getByRole("tablist", { name: t("Options categories", "期权类别"), exact: true })
      .getByRole("tab", { name: t("Exposure", "敞口"), exact: true }).click();
    await expect(lab).toBeVisible();
    await lab.getByRole("button", { name: t("Choose exact contracts for Plan", "前往精确合约候选列表"), exact: true }).click();
    await expect(editor).toHaveCount(0); // Existing shortlist unmount clears its draft.
    await expect(open).toBeEnabled(); // Exact-contract pins survive the round trip.
    await open.click();
    await expect(editor).toBeVisible();
    await expect(editor.locator('input[id*="quantity"]')).toHaveValue("");
    await expect(editor.locator('input[id*="entry"]')).toHaveValue("");
    await expect(editor).toContainText("765"); await expect(editor).not.toContainText("785");
    expect(calculations).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`plan-${lang}-${theme}.png`) });
  });
}
