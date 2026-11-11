# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: exposure-expiry-greeks.spec.ts >> Exposure desk carries expiry Vanna/Charm through bars and drawer in zh
- Location: e2e/exposure-expiry-greeks.spec.ts:74:5

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '按到期日', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - button "Menu" [ref=e4] [cursor=pointer]:
        - img [ref=e5]
      - generic:
        - img
        - generic: MASTERMIND
      - generic [ref=e7]:
        - button "Mastermind AI" [ref=e8] [cursor=pointer]:
          - img [ref=e9]
        - button "设置" [ref=e12] [cursor=pointer]: U
    - main [ref=e13]:
      - generic [ref=e14]:
        - generic [ref=e15]:
          - generic [ref=e16]:
            - tablist "期权类别" [ref=e17]:
              - tab "指挥台" [ref=e18] [cursor=pointer]
              - tab "资金流" [ref=e19] [cursor=pointer]
              - tab "敞口" [selected] [ref=e20] [cursor=pointer]
              - tab "结构" [ref=e21] [cursor=pointer]
              - tab "波动率" [ref=e22] [cursor=pointer]
              - tab "统计" [ref=e23] [cursor=pointer]
              - tab "Prophet" [ref=e24] [cursor=pointer]
            - link "期货深度与足迹" [ref=e25] [cursor=pointer]:
              - /url: /options/futures
              - text: 期货
            - button "打开四步期权工作流程 · 已查看 1/4" [ref=e26] [cursor=pointer]:
              - img [ref=e27]
              - generic [ref=e30]: 已查看 1/4
          - paragraph [ref=e31]:
            - text: 左右滑动查看更多类别
            - generic [ref=e32]: ↔
        - tablist "期权子视图" [ref=e34]:
          - tab "敞口" [selected] [ref=e35] [cursor=pointer]
          - tab "持仓结构" [ref=e36] [cursor=pointer]
          - tab "价位图" [ref=e37] [cursor=pointer]
      - generic [ref=e38]:
        - generic [ref=e39]:
          - 'generic "市场波动率体制: 中性 · 修复中" [ref=e40]':
            - generic [ref=e42]: 波动率
            - text: 中性 · 修复中
          - generic [ref=e43]: 更新于 11:42:00延迟
        - generic [ref=e46]:
          - generic [ref=e47]:
            - generic [ref=e48]:
              - generic [ref=e49]:
                - img
                - combobox "代码" [ref=e50]: SPY
              - generic [ref=e51]: "660.00"
              - group [ref=e52]:
                - generic "标的" [ref=e53] [cursor=pointer]
            - group "敞口希腊值" [ref=e54]:
              - generic [ref=e55]: 敞口希腊值
              - button "伽马敞口" [ref=e56] [cursor=pointer]: GEX
              - button "德尔塔敞口" [ref=e57] [cursor=pointer]: DEX
              - button "Vanna 敞口" [active] [pressed] [ref=e58] [cursor=pointer]: VEX
              - button "Charm 敞口" [ref=e59] [cursor=pointer]: CHEX
            - generic [ref=e60]:
              - generic [ref=e61]: 墙与翻转仅适用于伽马
              - generic [ref=e62]:
                - text: 更新于 Fri, Sep 18, 16:00 ET
                - generic [ref=e63]: · 53天前
            - button "3D 期权研究室" [ref=e64] [cursor=pointer]
          - generic [ref=e65]:
            - generic [ref=e66]:
              - generic [ref=e67]:
                - group [ref=e68]:
                  - generic "按行权价" [ref=e69] [cursor=pointer]
                - navigation "敞口分区" [ref=e70]:
                  - button "市场状态" [ref=e71] [cursor=pointer]
                  - button "历史记录" [ref=e72] [cursor=pointer]
              - generic [ref=e74]:
                - generic [ref=e75]:
                  - button "到期日视角" [ref=e77] [cursor=pointer]:
                    - generic [ref=e78]: 全部到期日
                    - generic [ref=e79]: ▾
                  - group "梯图方向" [ref=e80]:
                    - button "净值" [pressed] [ref=e81] [cursor=pointer]
                    - button "认购/认沽" [disabled] [ref=e82] [cursor=pointer]
                  - generic [ref=e83]: 按到期日拆分仅支持伽马 — 切换到 GEX 使用该视角
                - group "行权价范围" [ref=e85]:
                  - button "±2%" [ref=e86] [cursor=pointer]
                  - button "±5%" [ref=e87] [cursor=pointer]
                  - button "±10%" [ref=e88] [cursor=pointer]
                  - button "全部" [pressed] [ref=e89] [cursor=pointer]
                - generic [ref=e90]:
                  - generic [ref=e91]: 行权价
                  - generic [ref=e92]: 相对敞口
                  - generic [ref=e93]: 净 VEX
                - generic [ref=e94]:
                  - generic [ref=e95]:
                    - generic [ref=e96]:
                      - generic [ref=e97]: "660"
                      - generic [ref=e98]: ▶
                    - generic [ref=e101]: "-600K"
                  - generic [ref=e102]:
                    - generic [ref=e104]: "650"
                    - generic [ref=e107]: +1.2M
                - group "柱状刻度" [ref=e109]:
                  - button "当前 ±1.2M" [pressed] [ref=e110] [cursor=pointer]
                  - button "全梯最大 ±1.2M" [ref=e111] [cursor=pointer]
              - generic [ref=e113]:
                - generic [ref=e114]:
                  - generic [ref=e117]: 净GEX
                  - generic [ref=e120]: 看跌墙
                  - generic [ref=e123]: 磁吸 / 高量位
                  - generic [ref=e126]: 伽马翻转
                - button "解读指南 ▼" [ref=e127] [cursor=pointer]
              - button "各到期日敞口 5 到期 · 收盘数据" [ref=e129] [cursor=pointer]:
                - generic [ref=e130]: ▶
                - generic [ref=e131]: 各到期日敞口
                - generic [ref=e132]: 5 到期 · 收盘数据
            - generic [ref=e133]:
              - generic [ref=e134]:
                - generic [ref=e135]:
                  - generic [ref=e136]: 市场状态
                  - time [ref=e137]: 状态更新于 2026-07-10
                - generic [ref=e138]:
                  - generic [ref=e139]:
                    - generic [ref=e140]: 锁定
                    - generic [ref=e141]: 净伽马 正值
                  - generic [ref=e142]: 做市商持仓集中于磁吸附近，区间结构稳固。
                  - generic [ref=e143]:
                    - generic [ref=e144]:
                      - generic [ref=e145]: 稳定性
                      - img "69 out of 100" [ref=e146]:
                        - img [ref=e147]
                        - generic [ref=e151]: "69"
                    - generic [ref=e152]:
                      - generic [ref=e153]:
                        - generic [ref=e154]: 稳定性
                        - generic [ref=e155]: 69%
                      - generic [ref=e156]:
                        - generic [ref=e157]: 距翻转
                        - generic [ref=e158]: 0.46% 上方
                - generic [ref=e160]:
                  - text: 结构区间
                  - generic [ref=e161]:
                    - generic [ref=e162]:
                      - generic [ref=e163]: "740"
                      - generic [ref=e164]: 看跌墙
                      - generic [ref=e165]: 看涨墙
                      - generic [ref=e166]: "760"
                    - generic [ref=e172]:
                      - generic [ref=e173]: 翻转
                      - generic [ref=e174]: 现价
                - generic [ref=e176]:
                  - generic [ref=e177]: 伽马极性
                  - generic [ref=e178]:
                    - generic [ref=e179]: 多头伽马主导
                    - generic [ref=e180]: 75%
                - generic [ref=e182]:
                  - generic [ref=e183]: 对冲压力
                  - generic [ref=e184]:
                    - generic [ref=e185]: 高
                    - generic [ref=e186]: "|净伽马| 4.67B"
                - generic [ref=e188]:
                  - generic [ref=e189]: 锁定目标
                  - generic [ref=e190]:
                    - generic [ref=e191]: "750"
                    - generic [ref=e192]: 54% 概率
                - group [ref=e193]:
                  - generic "详情与来源" [ref=e194] [cursor=pointer]
                - generic [ref=e196]:
                  - text: 水平图 — 假定做市商符号；仅供展示
                  - text: 前向波动率验证中：~2026年9月前仅供展示
              - generic [ref=e198]:
                - generic [ref=e199]:
                  - generic [ref=e200]: ★
                  - generic [ref=e201]: 热点精选
                  - generic [ref=e202]: GEX
                - generic [ref=e203]: 仅供描述 — 非交易建议
                - generic [ref=e204]:
                  - generic [ref=e205]:
                    - generic [ref=e206]:
                      - generic [ref=e207]: $760
                      - generic "+1.1% 距现价" [ref=e208]: +1.1%
                    - generic [ref=e209]:
                      - generic [ref=e210]: 突出比率
                      - generic [ref=e211]: 3.10×
                  - generic [ref=e212]:
                    - generic [ref=e213]: 置信度 %
                    - img "70 out of 100" [ref=e214]:
                      - img [ref=e215]
                      - generic [ref=e219]: "70"
                - generic [ref=e220]:
                  - text: 到期日
                  - generic [ref=e221]: Jul 17 · 7d
          - group [ref=e223]:
            - generic "快照关键位" [ref=e224] [cursor=pointer]
          - region "历史记录" [ref=e225]:
            - generic [ref=e226]:
              - generic [ref=e227]:
                - generic [ref=e228]: 净GEX — 历史
                - generic [ref=e229]:
                  - combobox "已归档交易日" [ref=e230]:
                    - option "最新快照" [selected]
                    - option "2026-07-10"
                    - option "2026-07-09"
                    - option "2026-07-08"
                    - option "2026-07-06"
                    - option "2026-07-02"
                  - generic [ref=e231]: 0 个交易日
              - generic [ref=e234]:
                - generic [ref=e235]: 暂无已结算交易日
                - generic [ref=e236]: 历史条形图需要至少两个已归档交易日才能绘制趋势。
            - generic [ref=e237]:
              - region "收盘期权结构背景" [ref=e238]:
                - generic [ref=e239]:
                  - generic [ref=e240]: 收盘结构
                  - generic [ref=e241]: 结算收盘 — 非实时
                - generic [ref=e244]:
                  - generic [ref=e245]:
                    - generic [ref=e246]: 看涨墙
                    - generic [ref=e247]: "760"
                    - generic [ref=e248]: 收盘 · 7月10日
                  - generic [ref=e249]:
                    - generic [ref=e250]: 看跌墙
                    - generic [ref=e251]: "740"
                    - generic [ref=e252]: 收盘 · 7月10日
                  - generic [ref=e253]:
                    - generic [ref=e254]: 伽马翻转
                    - generic [ref=e255]: "748.3"
                    - generic [ref=e256]: 收盘 · 7月10日
                  - generic [ref=e257]:
                    - generic [ref=e258]: 预期波动
                    - generic [ref=e259]:
                      - text: ±2.0%
                      - generic [ref=e260]: 723.7 – 752.7
                    - generic [ref=e261]: 区间 ×1.96 · 1日 · 来源未说明方法
                    - generic [ref=e262]: 收盘 · 7月23日
                  - generic [ref=e263]:
                    - generic [ref=e264]: 最大痛苦点
                    - generic [ref=e265]: "745"
                    - generic [ref=e266]: 收盘 · 7月10日
                  - generic [ref=e267]:
                    - generic [ref=e268]: IV 百分位
                    - generic [ref=e269]:
                      - text: "38"
                      - generic [ref=e270]: ATM IV 16.2%
                    - generic [ref=e271]: 收盘 · 7月5日
                  - generic [ref=e272]:
                    - generic [ref=e273]: 持仓确认
                    - generic [ref=e274]:
                      - text: "1"
                      - generic [ref=e275]: +1,500 OI
                    - generic [ref=e276]: 收盘 · 7月23日
              - region "暗池仓位背景" [ref=e277]:
                - generic [ref=e278]:
                  - generic [ref=e279]: 暗池
                  - generic [ref=e280]: 收盘 · 7月24日
                - paragraph [ref=e281]: SPY 不在场外成交面板中
                - paragraph [ref=e282]: 该面板基于 FINRA 设施上报数据、覆盖固定的个股名单构建——ETF 与流动性较弱的代码不在其中。
        - generic [ref=e283]: 标注与方向标签为启发式近似（~），仅供展示，不构成投资建议。
  - alert [ref=e284]
```

# Test source

```ts
  8   |   spot_ref: 660,
  9   |   net_gex_bn: 1.25,
  10  |   gamma_flip: 655,
  11  |   call_wall: 675,
  12  |   put_wall: 645,
  13  |   convention: "synthetic-e2e-owner-native",
  14  |   coverage: { n_days: 1, since: "2026-09-18" },
  15  |   by_strike: [
  16  |     {
  17  |       strike: 650,
  18  |       gamma_net: 12,
  19  |       gamma_call: 20,
  20  |       gamma_put: -8,
  21  |       delta_net: 150,
  22  |       vanna_net: 1.2,
  23  |       charm_net: -0.3,
  24  |     },
  25  |     {
  26  |       strike: 660,
  27  |       gamma_net: -4,
  28  |       gamma_call: 6,
  29  |       gamma_put: -10,
  30  |       delta_net: -40,
  31  |       vanna_net: -0.6,
  32  |       charm_net: 0.2,
  33  |     },
  34  |   ],
  35  |   by_expiry: [
  36  |     {
  37  |       exp: "2026-09-19",
  38  |       gamma_net: 10,
  39  |       delta_net: 120,
  40  |       vanna_net: 2.4,
  41  |       charm_net: -0.6,
  42  |     },
  43  |     {
  44  |       exp: "2026-09-26",
  45  |       gamma_net: -5,
  46  |       delta_net: -30,
  47  |       vanna_net: -1.2,
  48  |       charm_net: 0.4,
  49  |     },
  50  |     {
  51  |       exp: "2026-10-17",
  52  |       gamma_net: 0,
  53  |       delta_net: 0,
  54  |       vanna_net: 0,
  55  |       charm_net: 0,
  56  |     },
  57  |     {
  58  |       exp: "2026-10-24",
  59  |       gamma_net: 4,
  60  |       delta_net: 2,
  61  |       vanna_net: null,
  62  |       charm_net: 0.2,
  63  |       exposure_support: {
  64  |         basis: "admitted_input_contracts",
  65  |         vanna: { known_contracts: 1, admitted_contracts: 2, known_net: -0.25 },
  66  |         charm: { known_contracts: 2, admitted_contracts: 2, known_net: 0.2 },
  67  |       },
  68  |     },
  69  |     { exp: "2026-10-31", gamma_net: 1, delta_net: 4, vanna_net: null, charm_net: 0.3 },
  70  |   ],
  71  | };
  72  | 
  73  | for (const lang of ["en", "zh"] as const) {
  74  | test(`Exposure desk carries expiry Vanna/Charm through bars and drawer in ${lang}`, async ({ page }, testInfo) => {
  75  |   test.setTimeout(60_000);
  76  |   const t = makeGexT(lang);
  77  |   await page.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
  78  | 
  79  |   // Exercise the real GexDeskView transport entry point. EventSource requests and
  80  |   // the polling fallback receive the same deterministic enriched payload.
  81  |   await page.route("**/api/flow**", async (route) => {
  82  |     const url = new URL(route.request().url());
  83  |     const f = url.searchParams.get("f");
  84  |     if (f !== "gex:SPY") {
  85  |       await route.fallback();
  86  |       return;
  87  |     }
  88  | 
  89  |     if (url.pathname.endsWith("/stream")) {
  90  |       await route.fulfill({
  91  |         status: 200,
  92  |         headers: {
  93  |           "content-type": "text/event-stream",
  94  |           "cache-control": "no-cache",
  95  |         },
  96  |         body: `data: ${JSON.stringify(GEX)}\n\n`,
  97  |       });
  98  |       return;
  99  |     }
  100 | 
  101 |     await route.fulfill({ status: 200, json: GEX });
  102 |   });
  103 | 
  104 |   await page.goto("/options?tab=gex");
  105 |   await expect(page.locator("#wtab-gex")).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
  106 | 
  107 |   await page.getByRole("button", { name: t("greekVannaFull"), exact: true }).click();
> 108 |   await page.getByRole("button", { name: t("viewByExpiry"), exact: true }).click();
      |                                                                            ^ Error: locator.click: Test timeout of 60000ms exceeded.
  109 | 
  110 |   // The existing expiry bar view must consume the enriched by_expiry fields rather
  111 |   // than fall back to the legacy "gamma & delta only" state.
  112 |   await expect(page.getByText("+2.4M", { exact: true }).first()).toBeVisible();
  113 |   await expect(page.getByText("-1.2M", { exact: true }).first()).toBeVisible();
  114 |   await expect(
  115 |     page.getByText(t("expiryLensNA"), { exact: true }),
  116 |   ).toHaveCount(0);
  117 | 
  118 |   const expiryRegion = page.locator(".obs-gexdesk-ladder-region");
  119 |   await expect(expiryRegion.locator("[data-expiry]")).toHaveCount(5);
  120 |   const missing = expiryRegion.locator('[data-expiry="2026-10-31"]');
  121 |   await expect(missing.locator(".num")).toHaveText("—");
  122 |   expect(await missing.evaluate(row => row.children[1].childElementCount)).toBe(0);
  123 |   const zero = expiryRegion.locator('[data-expiry="2026-10-17"]');
  124 |   await expect(zero.locator(".num")).toHaveText("0");
  125 |   expect(await zero.evaluate(row => row.children[1].childElementCount)).toBe(0);
  126 |   const partial = expiryRegion.locator('[data-expiry="2026-10-24"]');
  127 |   await expect(partial).toHaveAttribute("data-partial", "true");
  128 |   await expect(partial).toContainText(t("expiryKnownSubtotal"));
  129 |   await expect(partial).toContainText("-250K");
  130 |   await expect(expiryRegion.getByTestId("expiry-support")).toContainText("4/5");
  131 | 
  132 |   // Follow the actual scroll container and require the values to reach the viewport.
  133 |   // DOM visibility alone can pass for clipped/off-screen rows.
  134 |   for (const exp of GEX.by_expiry.map(row => row.exp)) {
  135 |     const value = expiryRegion.locator(`[data-expiry="${exp}"] .num`);
  136 |     await value.scrollIntoViewIfNeeded();
  137 |     await expect(value).toBeInViewport();
  138 |   }
  139 |   await expiryRegion.scrollIntoViewIfNeeded();
  140 |   await page.screenshot({
  141 |     path: testInfo.outputPath(`${testInfo.project.name}-${lang}-expiry-vanna-bars.png`),
  142 |     fullPage: false,
  143 |   });
  144 | 
  145 |   // Open the existing term-structure drawer: it must consume the SAME selected
  146 |   // Greek and the SAME by_expiry payload, not a parallel derived fixture.
  147 |   const drawer = page.locator(".obs-xdrawer-hd");
  148 |   await expect(drawer).toBeVisible();
  149 |   await drawer.click();
  150 |   await expect(drawer).toHaveAttribute("aria-expanded", "true");
  151 |   await expect(page.getByRole("img", { name: t("exposureByExpiry") })).toBeVisible();
  152 |   await expect(page.getByText("+2.4M", { exact: true }).last()).toBeVisible();
  153 |   await expect(page.getByText("-1.2M", { exact: true }).last()).toBeVisible();
  154 | 
  155 |   const headerCount = await page.locator(".obs-xdrawer-count").textContent();
  156 |   expect(headerCount).toContain("5");
  157 |   await expect(page.getByTestId("xdrawer-unresolved")).toContainText("1");
  158 |   const plot = page.locator(".obs-xdrawer-plot");
  159 |   for (const exp of ["2026-09-19", "2026-09-26", "2026-10-17", "2026-10-24"]) {
  160 |     const value = plot.locator(`[data-expiry="${exp}"] text`).first();
  161 |     await value.scrollIntoViewIfNeeded();
  162 |     await expect(value).toBeInViewport();
  163 |   }
  164 |   await page.screenshot({
  165 |     path: testInfo.outputPath(`${testInfo.project.name}-${lang}-expiry-vanna-drawer.png`),
  166 |     fullPage: false,
  167 |   });
  168 | 
  169 |   // Change only the lens. Both the bars and drawer must now show owner-native CHEX.
  170 |   await page.getByRole("button", { name: t("greekCharmFull"), exact: true }).click();
  171 |   await expect(page.getByText("-600K", { exact: true }).first()).toBeVisible();
  172 |   await expect(page.getByText("+400K", { exact: true }).first()).toBeVisible();
  173 | 
  174 |   await expect(page.locator(".obs-xdrawer-count")).toHaveText(headerCount!);
  175 |   await expect(expiryRegion.locator("[data-expiry]")).toHaveCount(5);
  176 |   await expect(expiryRegion.locator('[data-expiry="2026-10-31"] .num')).toHaveText("+300K");
  177 |   await expect(page.getByTestId("xdrawer-unresolved")).toHaveCount(0);
  178 |   await expect(expiryRegion.getByTestId("expiry-support")).toHaveCount(0);
  179 | 
  180 |   // Exact zero is a third, neutral state — it must remain visually/data-distinct
  181 |   // from an unavailable field and from a directional +/- exposure.
  182 |   await expect(page.getByText("0", { exact: true }).first()).toBeVisible();
  183 | 
  184 |   for (const exp of GEX.by_expiry.map(row => row.exp)) {
  185 |     const value = plot.locator(`[data-expiry="${exp}"] text`).first();
  186 |     await value.scrollIntoViewIfNeeded();
  187 |     await expect(value).toBeInViewport();
  188 |   }
  189 |   await page.screenshot({
  190 |     path: testInfo.outputPath(`${testInfo.project.name}-${lang}-expiry-charm-drawer.png`),
  191 |     fullPage: false,
  192 |   });
  193 |   await drawer.click();
  194 |   await expect(drawer).toHaveAttribute("aria-expanded", "false");
  195 |   for (const exp of GEX.by_expiry.map(row => row.exp)) {
  196 |     const value = expiryRegion.locator(`[data-expiry="${exp}"] .num`);
  197 |     await value.scrollIntoViewIfNeeded();
  198 |     await expect(value).toBeInViewport();
  199 |   }
  200 |   await expiryRegion.scrollIntoViewIfNeeded();
  201 |   await page.screenshot({
  202 |     path: testInfo.outputPath(`${testInfo.project.name}-${lang}-expiry-charm-bars.png`),
  203 |     fullPage: false,
  204 |   });
  205 | });
  206 | }
  207 | 
```