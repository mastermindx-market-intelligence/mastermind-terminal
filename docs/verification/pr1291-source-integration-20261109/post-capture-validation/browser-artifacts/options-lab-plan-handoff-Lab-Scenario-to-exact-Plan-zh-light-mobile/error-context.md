# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-lab-plan-handoff.spec.ts >> Lab Scenario to exact Plan zh light
- Location: e2e/options-lab-plan-handoff.spec.ts:4:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('options-plan-draft')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByTestId('options-plan-draft')

```

```yaml
- button "Menu":
  - img
- text: MASTERMIND
- button "Mastermind AI":
  - img
- button "设置": R
- main:
  - tablist "期权类别":
    - tab "指挥台"
    - tab "资金流" [selected]
    - tab "敞口"
    - tab "结构"
    - tab "波动率"
    - tab "统计"
    - tab "Prophet"
  - link "期货深度与足迹":
    - /url: /options/futures
    - text: 期货
  - button "打开四步期权工作流程 · 已查看 2/4"
  - tablist "期权子视图":
    - tab "期权逐笔"
    - tab "资金潮"
    - tab "0DTE"
    - tab "最大事件"
    - tab "曲面"
    - tab "期权筛选器" [selected]
    - tab "个股"
  - text: 波动率 中性 · 修复中 更新于 11:42:00延迟
  - button "保费最大"
  - button "异常活跃"
  - button "成交量>持仓"
  - button "持仓增长"
  - button "高0DTE占比"
  - button "热门合约"
  - text: ETF品种覆盖，个股扩展中
  - 'button "导出 CSV: 1"': 导出 CSV · 1
  - text: 指数
  - button "SPY"
  - button "QQQ"
  - button "IWM"
  - text: 夜间收盘构建 · 截至 2026-10-23 合约候选 已固定 1/4
  - button "对比" [disabled]
  - button "清空"
  - paragraph: 再固定一个合约即可对比。
  - list:
    - listitem:
      - text: SPY 2026-10-30 765 认购 持仓增长 · 交易日 2026-10-23
      - button "在列表中查看"
      - button "从候选中移除 SPY 2026-10-30 765 认购": ✕
  - status: 已固定 SPY 2026-10-30 765 认购。
  - button "返回候选列表" [expanded]
  - paragraph: 仅为草稿。请自行填写方向、数量及入场价，不会从参考价格推断假设。切换账户或固定合约范围会清除此草稿。
  - region "候选合约计划"
  - button "打开已保存研究" [disabled]
  - text: 未平仓增加 报告日期 2026-10-23
  - table:
    - rowgroup:
      - row "代码 认购/认沽 到期日 行权价 未平仓变动 报告未平仓量 中间价":
        - columnheader "代码"
        - columnheader "认购/认沽"
        - columnheader "到期日"
        - columnheader "行权价"
        - columnheader "未平仓变动"
        - columnheader "报告未平仓量"
        - columnheader "中间价"
    - rowgroup:
      - row "取消固定 SPY 2026-10-30 765 认购 打开 SPY 的个股详情 C 10-30 765 +5 10 $3.00":
        - cell "取消固定 SPY 2026-10-30 765 认购 打开 SPY 的个股详情":
          - button "取消固定 SPY 2026-10-30 765 认购" [pressed]
          - button "打开 SPY 的个股详情": SPY
        - cell "C"
        - cell "10-30"
        - cell "765"
        - cell "+5"
        - cell "10"
        - cell "$3.00"
  - text: 报告未平仓量反映前一交易日收盘持仓。变动为本期带日期报告减前一期报告，不代表当前盘中资金流。 标注与方向标签为启发式近似（~），仅供展示，不构成投资建议。
- alert
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | // Synthetic navigation proof: no production admission, calculation or Save.
  3  | for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  4  |   test(`Lab Scenario to exact Plan ${lang} ${theme}`, async ({ page }, info) => {
  5  |     const t = (en: string, zh: string) => lang === "en" ? en : zh;
  6  |     await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", domain: "127.0.0.1", path: "/" }]);
  7  |     await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), lang);
  8  |     let calculations = 0;
  9  |     page.on("request", r => { if (r.url().includes("/api/options/plan/expiry")) calculations++; });
  10 |     await page.route("**/api/flow?*", async route => {
  11 |       const f = new URL(route.request().url()).searchParams.get("f");
  12 |       if (f === "matrix:SPY") return route.fulfill({ json: { schema: "options_structure.matrix/v1", root: "SPY", session: "2026-10-05",
  13 |         cells: [{ strike: 785, expiry: "2026-10-09", call_vol: 243000, call_oi: 110000, put_vol: 0, put_oi: null }] } });
  14 |       if (f === "oi") return route.fulfill({ json: { schema: "options_hub.oi/v1", asof: "2026-10-23T20:00:00Z",
  15 |         movers: [{ root: "SPY", exp: "2026-10-30", right: "C", strike: 765, mid: 3, oi: 10, d_oi: 5 }] } });
  16 |       return route.fallback();
  17 |     });
  18 |     await page.goto("/options?tab=gex&view=research&keep=lab");
  19 |     const lab = page.getByRole("region", { name: t("3D Research Lab", "3D 期权研究室"), exact: true });
  20 |     await expect(lab).toBeVisible({ timeout: 30000 });
  21 |     // Presentation fixture only: real account preference hydration is covered separately.
  22 |     // Do not claim that a synthetic identity proves account theme synchronization.
  23 |     await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
  24 |     await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  25 |     await lab.getByRole("button", { name: t("785 Call · 2026-10-09", "785 看涨 · 2026-10-09"), exact: true }).click();
  26 |     await lab.getByRole("button", { name: t("Scenario lab", "情景研究"), exact: true }).click();
  27 |     await expect(lab).toContainText(t("Matrix coordinates are not transferred", "矩阵坐标不会转入计划"));
  28 |     await expect(lab.getByRole("button", { name: t("Save investigation", "保存研究"), exact: true })).toBeDisabled();
  29 |     await page.screenshot({ path: info.outputPath(`scenario-${lang}-${theme}.png`) });
  30 |     await lab.getByRole("button", { name: t("Choose exact contracts for Plan", "前往精确合约候选列表"), exact: true }).click();
  31 |     await expect(page).toHaveURL(/tab=vol/);
  32 |     expect(new URL(page.url()).searchParams.get("keep")).toBe("lab");
  33 |     await expect(lab).toBeHidden();
  34 |     const open = page.getByTestId("shortlist-plan-path").getByRole("button", { name: t("Plan from pinned contracts", "用固定合约创建计划"), exact: true });
  35 |     // The IW2 composition may retain its native saved-research entry with no
  36 |     // pins. The navigation contract forbids an invented Plan, not that entry.
  37 |     await expect(page.getByTestId("shortlist-plan-path").getByTestId("options-plan-draft")).toHaveCount(0);
  38 |     await page.getByRole("button", { name: t("Pin SPY 2026-10-30 765 Call to compare", "固定 SPY 2026-10-30 765 认购 用于对比"), exact: true }).click();
  39 |     await open.click();
  40 |     const editor = page.getByTestId("options-plan-draft");
> 41 |     await expect(editor).toBeVisible(); await expect(editor).toContainText("765"); await expect(editor).not.toContainText("785");
     |                          ^ Error: expect(locator).toBeVisible() failed
  42 |     await expect(editor.locator('input[id*="entry"]')).toHaveValue("");
  43 |     await expect(editor.locator('input[id*="quantity"]')).toHaveValue("");
  44 |     await editor.locator('input[id*="quantity"]').fill("2");
  45 |     await editor.locator('input[id*="entry"]').fill("1.25");
  46 |     await page.getByRole("tablist", { name: t("Options categories", "期权类别"), exact: true })
  47 |       .getByRole("tab", { name: t("Exposure", "敞口"), exact: true }).click();
  48 |     await expect(lab).toBeVisible();
  49 |     await lab.getByRole("button", { name: t("Choose exact contracts for Plan", "前往精确合约候选列表"), exact: true }).click();
  50 |     await expect(editor).toHaveCount(0); // Existing shortlist unmount clears its draft.
  51 |     await expect(open).toBeEnabled(); // Exact-contract pins survive the round trip.
  52 |     await open.click();
  53 |     await expect(editor).toBeVisible();
  54 |     await expect(editor.locator('input[id*="quantity"]')).toHaveValue("");
  55 |     await expect(editor.locator('input[id*="entry"]')).toHaveValue("");
  56 |     await expect(editor).toContainText("765"); await expect(editor).not.toContainText("785");
  57 |     expect(calculations).toBe(0);
  58 |     expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  59 |     await page.screenshot({ path: info.outputPath(`plan-${lang}-${theme}.png`) });
  60 |   });
  61 | }
  62 | 
```