# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-plan-compare-mounted.spec.ts >> D08C mounted shortlist → Plan → comparison zh dark
- Location: e2e/options-plan-compare-mounted.spec.ts:12:7

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.selectOption: Test timeout of 90000ms exceeded.
Call log:
  - waiting for getByTestId('options-plan-payoff-panel').getByRole('combobox', { name: '假设方向', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - img [ref=e5]
        - generic [ref=e9]:
          - generic [ref=e10]: MASTERMIND
          - generic [ref=e11]: TERMINAL
      - generic [ref=e13]: 期权
      - button "设置" [ref=e14] [cursor=pointer]: R
    - navigation "Primary" [ref=e15]:
      - link "图表" [ref=e16] [cursor=pointer]:
        - /url: /terminal
        - img [ref=e17]
      - link "分析" [ref=e19] [cursor=pointer]:
        - /url: /analysis
        - img [ref=e20]
      - link "发现" [ref=e22] [cursor=pointer]:
        - /url: /discover
        - img [ref=e23]
      - link "错位" [ref=e28] [cursor=pointer]:
        - /url: /dislocations
        - img [ref=e29]
      - link "期权" [ref=e30] [cursor=pointer]:
        - /url: /options
        - img [ref=e31]
      - link "脚本" [ref=e34] [cursor=pointer]:
        - /url: /scripts
        - img [ref=e35]
      - link "投资组合" [ref=e39] [cursor=pointer]:
        - /url: /portfolio
        - img [ref=e40]
      - link "提醒" [ref=e42] [cursor=pointer]:
        - /url: /alerts
        - img [ref=e43]
      - button "Mastermind AI" [ref=e46] [cursor=pointer]:
        - img [ref=e47]
    - main [ref=e49]:
      - generic [ref=e50]:
        - generic [ref=e51]:
          - generic [ref=e52]: 类别
          - generic [ref=e53]:
            - tablist "期权类别" [ref=e54]:
              - tab "指挥台" [ref=e55] [cursor=pointer]
              - tab "资金流" [selected] [ref=e56] [cursor=pointer]
              - tab "敞口" [ref=e57] [cursor=pointer]
              - tab "结构" [ref=e58] [cursor=pointer]
              - tab "波动率" [ref=e59] [cursor=pointer]
              - tab "统计" [ref=e60] [cursor=pointer]
              - tab "Prophet" [ref=e61] [cursor=pointer]
            - link "期货深度与足迹" [ref=e62] [cursor=pointer]:
              - /url: /options/futures
              - text: 期货
            - button "打开四步期权工作流程 · 已查看 1/4" [ref=e63] [cursor=pointer]:
              - img [ref=e64]
              - generic [ref=e67]: 流程
              - generic [ref=e68]: 已查看 1/4
        - generic [ref=e69]:
          - generic [ref=e70]: 视图
          - tablist "期权子视图" [ref=e71]:
            - tab "期权逐笔" [ref=e72] [cursor=pointer]
            - tab "资金潮" [ref=e73] [cursor=pointer]
            - tab "0DTE" [ref=e74] [cursor=pointer]
            - tab "最大事件" [ref=e75] [cursor=pointer]
            - tab "曲面" [ref=e76] [cursor=pointer]
            - tab "期权筛选器" [selected] [ref=e77] [cursor=pointer]
            - tab "个股" [ref=e78] [cursor=pointer]
      - generic [ref=e79]:
        - generic [ref=e80]:
          - 'generic "市场波动率体制: 中性 · 修复中" [ref=e81]':
            - generic [ref=e83]: 波动率
            - text: 中性 · 修复中
          - generic [ref=e84]: 更新于 11:42:00延迟
        - generic [ref=e86]:
          - generic [ref=e87]:
            - generic [ref=e88]:
              - button "保费最大" [ref=e89] [cursor=pointer]
              - button "异常活跃" [ref=e90] [cursor=pointer]
              - button "成交量>持仓" [ref=e91] [cursor=pointer]
              - button "持仓增长" [ref=e92] [cursor=pointer]
              - button "高0DTE占比" [ref=e93] [cursor=pointer]
              - button "热门合约" [ref=e94] [cursor=pointer]
              - generic [ref=e95]: ETF品种覆盖，个股扩展中
              - 'button "导出 CSV: 1" [ref=e96] [cursor=pointer]': 导出 CSV · 1
            - generic [ref=e97]:
              - generic [ref=e98]: 指数
              - button "SPY" [ref=e99] [cursor=pointer]
              - button "QQQ" [ref=e100] [cursor=pointer]
              - button "IWM" [ref=e101] [cursor=pointer]
            - generic [ref=e103]: 夜间收盘构建 · 截至 2026-10-23
          - generic [ref=e104]:
            - generic [ref=e105]:
              - generic [ref=e106]:
                - generic [ref=e107]: 合约候选
                - generic [ref=e108]: 已固定 1/4
                - generic [ref=e109]:
                  - button "对比" [disabled] [ref=e110]
                  - button "清空" [ref=e111] [cursor=pointer]
              - paragraph [ref=e112]: 再固定一个合约即可对比。
              - list [ref=e113]:
                - listitem [ref=e114]:
                  - generic [ref=e115]:
                    - generic [ref=e116]: SPY 2026-10-30 765 认购
                    - generic [ref=e117]: 持仓增长 · 交易日 2026-10-23 · 旧副本
                  - button "在列表中查看" [ref=e118] [cursor=pointer]
                  - button "从候选中移除 SPY 2026-10-30 765 认购" [ref=e119] [cursor=pointer]: ✕
              - status [ref=e120]: 已固定 SPY 2026-10-30 765 认购。
              - generic [ref=e121]:
                - button "返回候选列表" [expanded] [ref=e122] [cursor=pointer]
                - paragraph [ref=e123]: 仅为草稿。请自行填写方向、数量及入场价，不会从参考价格推断假设。切换账户或固定合约范围会清除此草稿。
                - region "候选合约计划" [active]
                - button "打开已保存研究" [disabled] [ref=e125] [cursor=pointer]
            - generic [ref=e126]:
              - generic [ref=e127]:
                - generic [ref=e128]: 未平仓增加
                - generic [ref=e129]: 报告日期 2026-10-23
              - table [ref=e131]:
                - rowgroup [ref=e132]:
                  - row "代码 认购/认沽 到期日 行权价 未平仓变动 报告未平仓量 中间价" [ref=e133]:
                    - columnheader "代码" [ref=e134] [cursor=pointer]
                    - columnheader "认购/认沽" [ref=e135] [cursor=pointer]
                    - columnheader "到期日" [ref=e136] [cursor=pointer]
                    - columnheader "行权价" [ref=e137] [cursor=pointer]
                    - columnheader "未平仓变动" [ref=e138] [cursor=pointer]
                    - columnheader "报告未平仓量" [ref=e139] [cursor=pointer]
                    - columnheader "中间价" [ref=e140] [cursor=pointer]
                - rowgroup [ref=e141]:
                  - row "取消固定 SPY 2026-10-30 765 认购 打开 SPY 的个股详情 C 10-30 765 +20 40 $9.00" [ref=e142] [cursor=pointer]:
                    - cell "取消固定 SPY 2026-10-30 765 认购 打开 SPY 的个股详情" [ref=e143]:
                      - button "取消固定 SPY 2026-10-30 765 认购" [pressed] [ref=e144]:
                        - img [ref=e145]
                      - button "打开 SPY 的个股详情" [ref=e147]: SPY
                    - cell "C" [ref=e148]
                    - cell "10-30" [ref=e149]
                    - cell "765" [ref=e150]
                    - cell "+20" [ref=e151]
                    - cell "40" [ref=e152]
                    - cell "$9.00" [ref=e153]
              - generic [ref=e154]: 报告未平仓量反映前一交易日收盘持仓。变动为本期带日期报告减前一期报告，不代表当前盘中资金流。
        - generic [ref=e155]: 标注与方向标签为启发式近似（~），仅供展示，不构成投资建议。
  - alert [ref=e156]
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { response } from "../lib/__tests__/fixtures/optionsPlanPayoff";
  3   | import type { PlanExpiryRequest } from "../lib/optionsPlanPayoff";
  4   | 
  5   | // Exercise the production component tree on /options. Auth, source acquisition
  6   | // and the dated reference response are explicit local fixtures, not live proof.
  7   | const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "responsive@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-20T00:00:00Z" };
  8   | const row = { root: "SPY", right: "C", exp: "2026-10-30", strike: 765, mid: 9, oi: 40, oi_prev: 20, d_oi: 20 };
  9   | const sharedShell = process.env.MMX_SHARED_SHELL === "1";
  10  | const themes = sharedShell ? ["dark", "light"] as const : ["dark"] as const;
  11  | for (const lang of ["en", "zh"] as const) for (const theme of themes) {
  12  |   test(`D08C mounted shortlist → Plan → comparison ${lang} ${theme}`, async ({ page, context, baseURL }, info) => {
  13  |     test.setTimeout(90_000);
  14  |     const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  15  |     const session = { access_token: "local-plan-fixture-only", refresh_token: "local-plan-fixture-only", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  16  |     await context.addCookies([
  17  |       { name: "mm_e2e_rs30", value: "1", url: baseURL! },
  18  |       { name: "sb-127-auth-token.0", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseURL! },
  19  |     ]);
  20  |     await page.addInitScript(({ lang, theme, user }) => {
  21  |       localStorage.setItem("mm.lang", lang); localStorage.setItem("mmx.shell.theme", theme);
  22  |       const originalFetch = window.fetch.bind(window);
  23  |       window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  24  |         const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), window.location.href);
  25  |         if (url.pathname.startsWith("/auth/v1/")) {
  26  |           if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/user") throw Error("Unexpected fixture Auth operation");
  27  |           return new Response(JSON.stringify(user), { headers: { "content-type": "application/json" } });
  28  |         }
  29  |         return originalFetch(input, init);
  30  |       };
  31  |     }, { lang, theme, user });
  32  |     await page.route(/\/api\/flow\?f=oi$/, route => route.fulfill({ json: { schema: "options_hub.oi_movers/v1", asof: "2026-10-23T20:00:00Z", stale: true, movers: [row] } }));
  33  |     let calculations = 0, persistence = 0;
  34  |     page.on("request", req => { if (/\/api\/(investigations|alerts|orders)(?:[/?]|$)/.test(req.url()) && ["POST", "PUT", "DELETE", "PATCH"].includes(req.method())) persistence++; });
  35  |     await page.route("**/api/options/plan/expiry", route => {
  36  |       calculations++;
  37  |       const request = route.request().postDataJSON() as PlanExpiryRequest;
  38  |       expect(request.draft.legs).toHaveLength(1);
  39  |       const leg = request.draft.legs[0];
  40  |       // The incumbent source adapter adds its own DOI preset before pinning.
  41  |       expect(leg.snapshot.row).toEqual({ ...row, preset: "doi" });
  42  |       expect(leg.snapshot.sourceStale).toBe(true);
  43  |       expect(leg.snapshot.asofRaw).toBe("2026-10-23T20:00:00Z");
  44  |       expect(leg.assumptions.entry?.premium_per_unit).toBe(calculations === 1 ? 2 : 4);
  45  |       const raw = response(request), entry = leg.assumptions.entry!.premium_per_unit;
  46  |       raw.curve.pnl = request.spots.map(spot => Math.max(spot - 765, 0) * 100 - entry * 100);
  47  |       raw.curve.cost = entry * 100; raw.curve.max_loss = -entry * 100; raw.curve.breakevens = [765 + entry];
  48  |       return route.fulfill({ json: raw });
  49  |     });
  50  |     await page.goto("/options?tab=screener");
  51  |     await page.getByRole("button", { name: t("ΔOI Builds", "持仓增长"), exact: true }).click();
  52  |     const pin = page.locator("table.scr [data-contract-pin]"); await expect(pin).toHaveCount(1); await pin.click();
  53  |     const tray = page.locator("[data-contract-shortlist]");
  54  |     const open = tray.getByRole("button", { name: t("Plan from pinned contracts", "用固定合约创建计划"), exact: true });
  55  |     await open.click();
  56  |     const plan = page.getByTestId("options-plan-payoff-panel");
> 57  |     await plan.getByRole("combobox", { name: t("Your assumed side", "假设方向"), exact: true }).selectOption("buy");
      |                                                                                             ^ Error: locator.selectOption: Test timeout of 90000ms exceeded.
  58  |     await plan.getByLabel(t("Your assumed quantity — contracts", "假设数量——张"), { exact: true }).fill("1");
  59  |     const entry = plan.getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true });
  60  |     await entry.fill("2");
  61  |     await plan.getByRole("combobox", { name: t("Assumed premium denomination", "权利金假设币种"), exact: true }).selectOption("USD");
  62  |     const calculate = plan.getByRole("button", { name: t("Calculate expiry payoff", "计算到期损益"), exact: true });
  63  |     await calculate.click(); await plan.getByTestId("plan-pin-baseline").click();
  64  |     await expect(plan.getByTestId("plan-baseline-pending")).toBeVisible();
  65  |     await entry.fill("4"); await calculate.click();
  66  |     const comparison = plan.getByTestId("plan-scenario-compare");
  67  |     await expect(comparison.getByTestId("plan-compare-overlay")).toBeVisible();
  68  |     await expect(comparison.getByTestId("plan-comparison-sample")).toContainText("200.00");
  69  |     if (sharedShell) {
  70  |       await expect(page.locator("html")).toHaveAttribute("data-mmx-shared-shell", "1");
  71  |       await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  72  |     }
  73  |     await expect(comparison).toHaveCSS("background-color", sharedShell ? (theme === "light" ? "rgb(255, 255, 255)" : "rgb(24, 27, 33)") : "rgb(13, 15, 19)");
  74  |     const compareHeading = comparison.getByRole("heading", { name: t("Compare assumptions", "对比假设"), exact: true });
  75  |     await compareHeading.scrollIntoViewIfNeeded();
  76  |     await expect(compareHeading).toBeInViewport({ ratio: 1 });
  77  |     await page.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-${info.project.name}-header.png`) });
  78  |     await comparison.getByTestId("plan-compare-overlay").scrollIntoViewIfNeeded();
  79  |     await expect(comparison.getByTestId("plan-compare-overlay").locator("svg")).toBeInViewport({ ratio: 0.99 });
  80  |     await page.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-${info.project.name}-chart.png`) });
  81  |     await comparison.getByText(t("All exact scenario prices and P/L", "查看全部精确情景价格与损益"), { exact: true }).click();
  82  |     const exact = comparison.getByTestId("plan-comparison-points");
  83  |     await expect(exact.locator("tbody tr")).toHaveCount(101);
  84  |     await expect(exact.locator("tbody tr").first().locator("td").last()).toHaveText("-200");
  85  |     const scroll = exact.locator(".."); await scroll.focus(); await expect(scroll).toBeFocused();
  86  |     await page.keyboard.press("End");
  87  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  88  |     if (info.project.name === "mobile") {
  89  |       await page.setViewportSize({ width: 320, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  90  |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  91  |       await comparison.getByText(t("All exact scenario prices and P/L", "查看全部精确情景价格与损益"), { exact: true }).click();
  92  |       await comparison.getByTestId("plan-clear-baseline").scrollIntoViewIfNeeded();
  93  |       await expect(comparison.getByTestId("plan-clear-baseline")).toBeInViewport({ ratio: 1 });
  94  |       await page.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-320-controls.png`) });
  95  |     }
  96  |     const clear = comparison.getByTestId("plan-clear-baseline");
  97  |     expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  98  |     await clear.click(); await expect(comparison.getByRole("heading", { name: t("Compare assumptions", "对比假设"), exact: true })).toBeFocused();
  99  |     await expect(comparison.getByTestId("plan-compare-overlay")).toHaveCount(0);
  100 |     await plan.getByRole("button", { name: t("Close draft", "关闭草稿"), exact: true }).click();
  101 |     await expect(open).toBeFocused(); await expect(plan).toHaveCount(0);
  102 |     await expect(page.locator("table.scr tbody")).toContainText("SPY");
  103 |     expect(calculations).toBe(2); expect(persistence).toBe(0);
  104 |   });
  105 | }
  106 | 
```