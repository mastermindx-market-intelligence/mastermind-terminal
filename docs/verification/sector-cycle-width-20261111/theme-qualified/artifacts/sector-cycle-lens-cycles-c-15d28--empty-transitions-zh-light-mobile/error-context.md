# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sector-cycle-lens.spec.ts >> cycles chart measurement survives empty transitions zh light
- Location: e2e/sector-cycle-lens.spec.ts:93:9

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Object {
    "appearance": "1",
    "background": "rgb(255, 255, 255)",
    "backgroundToken": "#f7f8fa",
    "foreground": "rgb(32, 38, 50)",
-   "panelToken": "#ffffff",
+   "panelToken": "#fff",
    "sharedShell": null,
    "textToken": "#202632",
    "theme": "light",
  }

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - strong [ref=e4]: DEV harness · SectorCycleLens
      - generic [ref=e5]: Fixture data — not live evidence
      - generic [ref=e6]:
        - radio "EN" [ref=e7]
        - text: EN
      - generic [ref=e8]:
        - radio "ZH" [checked] [ref=e9]
        - text: ZH
      - generic [ref=e10]:
        - radio "Dark" [ref=e11]
        - text: Dark
      - generic [ref=e12]:
        - radio "Light" [checked] [active] [ref=e13]
        - text: Light
      - generic [ref=e14]:
        - radio "Generation current" [checked] [ref=e15]
        - text: Generation current
      - generic [ref=e16]:
        - radio "Generation replaced" [ref=e17]
        - text: Generation replaced
      - generic [ref=e18]:
        - radio "Heads today" [checked] [ref=e19]
        - text: Heads today
      - generic [ref=e20]:
        - radio "One head withdrawn" [ref=e21]
        - text: One head withdrawn
      - generic [ref=e22]:
        - radio "Heads absent" [ref=e23]
        - text: Heads absent
    - generic [ref=e24]:
      - generic [ref=e26]:
        - heading "板块周期" [level=2] [ref=e27]
        - paragraph [ref=e28]: 科技 XLK · 截至 2026-10-30 · 板块 ETF 对比 SPY · 重构价格历史
      - generic [ref=e29]:
        - complementary "各板块周期阶段" [ref=e30]:
          - heading "各板块周期阶段" [level=3] [ref=e31]
          - paragraph [ref=e32]: 5/5 个有观测 · 板块 ETF 对比 SPY
          - tablist "各板块周期阶段" [ref=e33]:
            - tab "板块 ETF 对比 SPY" [selected] [ref=e34] [cursor=pointer]
            - tab "主题组合对比 SPY" [ref=e35] [cursor=pointer]
          - generic [ref=e36]:
            - generic [ref=e37]: 筛选序列
            - searchbox "筛选序列" [ref=e38]
          - generic [ref=e39]:
            - heading "筑底中 1" [level=4] [ref=e40]:
              - text: 筑底中
              - generic [ref=e41]: "1"
            - button "能源 XLE" [ref=e42] [cursor=pointer]:
              - generic [ref=e43]: 能源
              - generic [ref=e44]: XLE
          - generic [ref=e45]:
            - heading "入场良机 1" [level=4] [ref=e46]:
              - text: 入场良机
              - generic [ref=e47]: "1"
            - button "金融 XLF" [ref=e48] [cursor=pointer]:
              - generic [ref=e49]: 金融
              - generic [ref=e50]: XLF
          - generic [ref=e51]:
            - heading "上行中 1" [level=4] [ref=e52]:
              - text: 上行中
              - generic [ref=e53]: "1"
            - button "科技 XLK" [pressed] [ref=e54] [cursor=pointer]:
              - generic [ref=e55]: 科技
              - generic [ref=e56]: XLK
          - generic [ref=e57]:
            - heading "见顶 · 晚期 1" [level=4] [ref=e58]:
              - text: 见顶 · 晚期
              - generic [ref=e59]: "1"
            - button "医疗保健 XLV" [ref=e60] [cursor=pointer]:
              - generic [ref=e61]: 医疗保健
              - generic [ref=e62]: XLV
          - generic [ref=e63]:
            - heading "回落中 1" [level=4] [ref=e64]:
              - text: 回落中
              - generic [ref=e65]: "1"
            - button "可选消费 XLY" [ref=e66] [cursor=pointer]:
              - generic [ref=e67]: 可选消费
              - generic [ref=e68]: XLY
          - group [ref=e69]:
            - generic "计算方法" [ref=e70] [cursor=pointer]
        - generic [ref=e71]:
          - generic [ref=e72]:
            - generic [ref=e73]:
              - heading "科技 XLK" [level=3] [ref=e74]
              - generic [ref=e75]:
                - generic [ref=e76]: "周期阶段 · 本体框架: 扩张"
                - generic [ref=e77]: 位置 · 本体框架 72
                - generic [ref=e78]:
                  - text: 价格与200日均线
                  - generic [ref=e79]: 高于
              - paragraph [ref=e80]: 0–100刻度，并非概率。
            - button "查看板块档案" [ref=e82] [cursor=pointer]
          - generic [ref=e83]:
            - heading "时钟" [level=4] [ref=e84]
            - generic [ref=e85]:
              - generic [ref=e86]: 阶段时钟
              - generic [ref=e87]: 时序阶梯
              - generic [ref=e88]: 风险时钟
              - generic "各分歧时钟自身的数值保留于来源抽屉。" [ref=e89]: 节律时钟 ⚠
              - generic [ref=e90]: 周期读数
            - paragraph [ref=e91]: 各分歧时钟自身的数值保留于来源抽屉。
          - generic [ref=e92]:
            - heading "相对 SPY 强弱" [level=3] [ref=e94]
            - generic [ref=e95]:
              - button "序列（5）" [ref=e96] [cursor=pointer]: 序列（5）＋
              - generic [ref=e97]:
                - text: 图表范围
                - combobox "图表范围" [ref=e98]:
                  - option "21个交易日"
                  - option "63个交易日" [selected]
                  - option "252个交易日"
                  - option "全部"
              - generic [ref=e99]:
                - text: 刻度
                - combobox "刻度" [ref=e100]:
                  - option "线性" [selected]
                  - option "对数" [disabled]
              - group "相对 SPY 强弱" [ref=e101]:
                - button "图表" [pressed] [ref=e102] [cursor=pointer]
                - button "数据表" [ref=e103] [cursor=pointer]
              - button "全屏" [ref=e104] [cursor=pointer]: 全屏⤢
            - generic [ref=e105]:
              - generic [ref=e106]:
                - text: XLK · 21个交易日
                - generic [ref=e108]: 总回报
              - generic [ref=e109]:
                - text: XLK · 63个交易日
                - generic [ref=e111]: 总回报
            - generic [ref=e112]:
              - generic [ref=e113]:
                - generic [ref=e114]:
                  - text: XLK · 21个交易日
                  - strong [ref=e115]: +4.5%
                - generic [ref=e116]:
                  - text: XLK · 63个交易日
                  - strong [ref=e117]: +1.0%
                - time [ref=e118]: 2026-05-02
              - img "相对 SPY 强弱" [ref=e120]:
                - generic [ref=e122]: "-5"
                - generic [ref=e124]: "0"
                - generic [ref=e126]: "5"
                - generic "2026-03-12 · peak · 暂定" [ref=e129]
                - generic [ref=e131]: 顶部 2026-03-12
                - generic [ref=e134]: 2026-02-28
                - generic [ref=e135]: 2026-03-16
                - generic [ref=e136]: 2026-04-01
                - generic [ref=e137]: 2026-05-02
              - slider "观测日期" [ref=e138]: "63"
              - generic [ref=e139]:
                - generic [ref=e140]: 2026-02-28
                - generic [ref=e141]: 2026-05-02
            - generic [ref=e142]:
              - heading "价格转折" [level=4] [ref=e143]
              - paragraph [ref=e144]: 转折日期为拐点日期。拐点仅在确认后才可知 — 两种日期严格区分。
              - generic [ref=e145]:
                - time [ref=e146]: 2026-03-12
                - generic [ref=e147]: 高点
                - emphasis [ref=e148]: 暂定
            - group [ref=e149]:
              - generic "精确数值" [ref=e150] [cursor=pointer]
            - group [ref=e151]:
              - generic "计算方法" [ref=e152]
          - generic [ref=e153]:
            - heading "周期段 timeline" [level=3] [ref=e154]
            - list [ref=e156]:
              - listitem [ref=e157]:
                - button "2025-09-13 → 2025-11-12" [ref=e158] [cursor=pointer]:
                  - generic [ref=e159]: 2025-09-13 → 2025-11-12
                  - generic [ref=e160]: ▲
              - listitem [ref=e161]:
                - button "2025-11-12 → 2026-01-21" [ref=e162] [cursor=pointer]:
                  - generic [ref=e163]: 2025-11-12 → 2026-01-21
                  - generic [ref=e164]: ▼
              - listitem [ref=e165]:
                - button "2026-01-21 → 2026-03-12 · 暂定" [ref=e166] [cursor=pointer]:
                  - generic [ref=e167]: 2026-01-21 → 2026-03-12 · 暂定
                  - generic [ref=e168]: ▲
              - listitem [ref=e169]:
                - button "2026-03-12 · 开放段 · 开放 · 51 个交易日" [ref=e170] [cursor=pointer]:
                  - generic [ref=e171]: 2026-03-12 · 开放段 · 开放 · 51 个交易日
                  - generic [ref=e172]: ▼
          - generic [ref=e173]:
            - generic [ref=e174]:
              - heading "解读" [level=3] [ref=e175]
              - paragraph [ref=e176]: 生产解读所指阶段族与阶段时钟不同；原文保留于来源抽屉，不作为当前读数显示。
            - generic [ref=e177]:
              - heading "轮动事件" [level=3] [ref=e178]
              - paragraph [ref=e179]: 该窗口内没有已结束的轮动事件
          - generic [ref=e180]:
            - generic [ref=e181]:
              - heading "拐点估计与先验" [level=3] [ref=e182]
              - group "转折风险（仅历史校验）" [ref=e183]:
                - heading "转折风险（仅历史校验）" [level=4] [ref=e184]
                - generic [ref=e185]:
                  - generic [ref=e186]: 转折≤1月
                  - generic [ref=e187]: ≤3月
                  - generic [ref=e188]: ≤6月
                  - generic [ref=e189]: 向上段 · 顶部
                  - generic [ref=e190]:
                    - generic [ref=e191]: 18%
                    - generic [ref=e192]: 模型
                  - generic [ref=e193]:
                    - generic [ref=e194]: 34%
                    - generic [ref=e195]: 先验
                  - generic [ref=e196]:
                    - generic [ref=e197]: 41%
                    - generic [ref=e198]: 模型
                - paragraph [ref=e199]: 先验：历史基准率，并非模型
            - generic [ref=e200]:
              - generic [ref=e201]:
                - heading "方法与限制" [level=3] [ref=e202]
                - list [ref=e203]:
                  - listitem [ref=e204]: 仓位规模：无。信念倍数固定为 1.0，并非仓位大小。
                  - listitem [ref=e205]: 自身节律，描述性，非模型。
                  - listitem [ref=e206]: 领先滞后：不作声明。领先滞后研究已停止；此处不对板块作时间排序。
                  - listitem [ref=e207]: 源数据一致性核验通过，模型资格仍需单独判断
                - group [ref=e208]:
                  - generic "证据详情" [ref=e209] [cursor=pointer]
              - generic [ref=e210]:
                - paragraph [ref=e211]: 判断评分器
                - heading "判断评分器：已衡量命中率" [level=3] [ref=e212]
                - paragraph [ref=e213]: 全部已结算判断（含中性）的条件命中率，并非胜率。
                - paragraph [ref=e214]: 按时间跨度衡量信念判断的已实现方向命中率、横截面秩相关与超越SPY的超额收益。数据累积前较稀疏；绝不回灌入实时评分。
                - paragraph [ref=e215]: 本生成版本暂无评分器
            - generic [ref=e216]:
              - heading "时机与推演" [level=3] [ref=e217]
              - paragraph [ref=e218]: ◷本阶段已持续 18 个交易日
              - paragraph [ref=e219]:
                - text: 价格与200日均线 高于
                - generic [ref=e220]: 上涨趋势
              - paragraph [ref=e221]: 阶段时长是已测量的历史事实 — 并非剩余上行空间，也不是时间限制。
              - generic [ref=e222]:
                - generic [ref=e223]:
                  - generic [ref=e224]: 描述性节律
                  - generic [ref=e225]: 时间窗尚未开启
                - paragraph [ref=e226]: 下次底部 ≈ 2027年2月
                - generic [ref=e227]:
                  - generic [ref=e228]:
                    - term [ref=e229]: 最早
                    - definition [ref=e230]: 2026年12月
                  - generic [ref=e231]:
                    - term [ref=e232]: 中位
                    - definition [ref=e233]: 2027年2月
                  - generic [ref=e234]:
                    - term [ref=e235]: 最晚
                    - definition [ref=e236]: 2027年4月
                - paragraph [ref=e237]: 预计下次底部约在 2027年2月（2026年12月–2027年4月），基于该板块自身的中位半周期：描述性节律而非模型，仅为时间窗口。
          - generic [ref=e238]:
            - heading "剩余机会预测" [level=3] [ref=e239]
            - list [ref=e240]:
              - listitem [ref=e241]:
                - generic [ref=e242]: 剩余回报
                - generic [ref=e243]: 暂缓显示
                - generic [ref=e244]: 暂缓：该预测在当前数据上的研究检验未通过
                - generic [ref=e245]: 时间跨度：20 个已完结交易日
                - group [ref=e246]:
                  - generic "证据" [ref=e247]
              - listitem [ref=e248]:
                - generic [ref=e249]: 不利尾部
                - generic [ref=e250]: 暂缓显示
                - generic [ref=e251]: 暂缓：实时周期状态与研究协议的转折口径不一致
                - generic [ref=e252]: 时间跨度：20 个已完结交易日
                - group [ref=e253]:
                  - generic "证据" [ref=e254]
              - listitem [ref=e255]:
                - generic [ref=e256]: 先达目标还是先失效
                - generic [ref=e257]: 暂缓显示
                - generic [ref=e258]: 暂缓：实时周期状态与研究协议的转折口径不一致
                - generic [ref=e259]: 时间跨度：20 个已完结交易日
                - generic [ref=e260]: 周期段方向事实：描述当前上行/下行段的倾向，并非周期择时边界。
                - group [ref=e261]:
                  - generic "证据" [ref=e262]
              - listitem [ref=e263]:
                - generic [ref=e264]: 转折确认时间
                - generic [ref=e265]: 暂缓显示
                - generic [ref=e266]: 暂缓：实时周期状态与研究协议的转折口径不一致
                - generic [ref=e267]: 时间跨度：20 个已完结交易日
                - group [ref=e268]:
                  - generic "证据" [ref=e269]
            - paragraph [ref=e270]: 暂缓显示的预测不展示任何数值。
            - paragraph [ref=e271]: 每项预测单独判断是否暂缓显示；上方已观测的周期事实不受影响。
          - paragraph [ref=e272]: 描述性证据，不构成个股建议、仓位建议或执行授权。
  - alert [ref=e273]
```

# Test source

```ts
  20  |   chart: lang === "zh" ? "图表" : "Chart",
  21  |   table: lang === "zh" ? "数据表" : "Data table",
  22  |   range: lang === "zh" ? "图表范围" : "Chart range",
  23  |   log: lang === "zh" ? "对数" : "Log",
  24  |   series: lang === "zh" ? "序列" : "Series",
  25  |   obs: lang === "zh" ? "观测日期" : "Observation date",
  26  |   exact: lang === "zh" ? "精确数值" : "Exact values",
  27  |   baskets: lang === "zh" ? "主题组合对比 SPY" : "Thematic Baskets vs SPY",
  28  |   sectorsTab: lang === "zh" ? "板块 ETF 对比 SPY" : "Sector ETFs vs SPY",
  29  |   apply: lang === "zh" ? "应用" : "Apply",
  30  |   legDetails: lang === "zh" ? "周期段详情" : "Leg details",
  31  |   fullscreen: lang === "zh" ? "周期全屏" : "Cycles fullscreen",
  32  |   openFullscreen: lang === "zh" ? "打开全屏" : "Open fullscreen",
  33  |   fullscreenBtn: lang === "zh" ? "全屏" : "Full screen",
  34  |   changeSeries: lang === "zh" ? "更换序列" : "Change series",
  35  |   phaseAll: lang === "zh" ? "全部阶段" : "All phases",
  36  |   expansion: lang === "zh" ? "扩张" : "Expansion",
  37  |   selectedFoot: lang === "zh" ? "已选" : "Selected",
  38  |   troughWord: lang === "zh" ? "底部" : "trough",
  39  |   prov: lang === "zh" ? "暂定" : "Provisional",
  40  |   rs63: lang === "zh" ? "63个交易日" : "63 sessions",
  41  |   trough: lang === "zh" ? "底部" : "Trough",
  42  |   recovery: lang === "zh" ? "复苏" : "Recovery",
  43  |   energy: lang === "zh" ? "能源" : "Energy",
  44  |   financials: lang === "zh" ? "金融" : "Financials",
  45  |   aiInfra: lang === "zh" ? "AI 基础设施" : "AI Infrastructure",
  46  |   story: lang === "zh" ? "趋成熟" : "matured",
  47  |   mismatch: lang === "zh" ? "快照版本不一致" : "Snapshots do not match",
  48  |   /* v1.1 per-head forecast capabilities + SP11 dates + honest windows */
  49  |   range21: lang === "zh" ? "21个交易日" : "21 sessions",
  50  |   range252: lang === "zh" ? "252个交易日" : "252 sessions",
  51  |   range1mWord: lang === "zh" ? "1个月" : "1 month",
  52  |   durationWord: lang === "zh" ? "并非剩余上行空间" : "not remaining upside",
  53  |   firstKnown: lang === "zh" ? "最早可知" : "first known",
  54  |   pivotNote: lang === "zh" ? "转折日期为拐点日期" : "Turn dates are pivot dates",
  55  |   headWithheld: lang === "zh" ? "暂缓显示" : "Withheld",
  56  |   headWithdrawnWord: lang === "zh" ? "已撤回" : "Withdrawn",
  57  |   reasonUnknown: lang === "zh" ? "因未说明的原因暂缓显示" : "Withheld for an unstated reason",
  58  |   reasonFailed: lang === "zh" ? "研究检验未通过" : "research test failed",
  59  |   reasonEpoch: lang === "zh" ? "与研究协议的转折口径不一致" : "does not match the research protocol",
  60  |   horizon20: lang === "zh" ? "20 个已完结交易日" : "20 completed sessions",
  61  |   directional: lang === "zh" ? "周期段方向事实" : "Leg-direction fact",
  62  |   headsAbsent: lang === "zh" ? "未附带预测能力分块" : "No forecast capability block",
  63  | });
  64  | 
  65  | 
  66  | async function expectMeasuredPlot(svg: Locator) {
  67  |   await expect(svg).toBeVisible();
  68  |   const geometry = () => svg.evaluate((element) => {
  69  |     const chart = element as SVGSVGElement;
  70  |     return {
  71  |       container: chart.parentElement!.clientWidth,
  72  |       width: Number(chart.getAttribute("width")),
  73  |       viewBox: chart.viewBox.baseVal.width,
  74  |       rendered: chart.getBoundingClientRect().width,
  75  |     };
  76  |   });
  77  |   expect((await geometry()).container).toBeGreaterThanOrEqual(240);
  78  |   await expect.poll(async () => {
  79  |     const value = await geometry();
  80  |     return Math.max(
  81  |       Math.abs(value.width - value.container),
  82  |       Math.abs(value.viewBox - value.container),
  83  |       Math.abs(value.rendered - value.container),
  84  |     );
  85  |   }, { message: "SVG coordinates must follow the current measured content width" }).toBeLessThanOrEqual(1);
  86  |   return geometry();
  87  | }
  88  | 
  89  | for (const [lang, theme] of cases) {
  90  |   const L = T(lang);
  91  | 
  92  |   for (const transition of ["table", "empty"] as const) {
  93  |     test(`cycles chart measurement survives ${transition} transitions ${lang} ${theme}`, async ({ page }, info) => {
  94  |       await page.goto("/dev/sector-cycles");
  95  |       await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
  96  |       await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true }).check();
  97  | 
  98  |       const initialViewport = page.viewportSize()!;
  99  |       // Remain in the same responsive band, so a remounted panel cannot hide
  100 |       // the lost observer. The final capture returns to the contract viewport.
  101 |       const widths = initialViewport.width >= 981 ? [1100, 1280]
  102 |         : initialViewport.width >= 641 ? [700, 900] : [510, 430];
  103 |       const panel = page.getByTestId("cycle-chart-panel");
  104 |       const svg = panel.locator("svg");
  105 |       const expectThemePaint = async (selected: "light" | "dark") => {
  106 |         await expect.poll(() => panel.evaluate(element => {
  107 |           const root = document.documentElement;
  108 |           const tokens = getComputedStyle(root);
  109 |           const paint = getComputedStyle(element);
  110 |           return {
  111 |             theme: root.dataset.theme,
  112 |             appearance: root.dataset.terminalAppearance,
  113 |             sharedShell: root.dataset.mmxSharedShell ?? null,
  114 |             backgroundToken: tokens.getPropertyValue("--bg").trim(),
  115 |             panelToken: tokens.getPropertyValue("--panel").trim(),
  116 |             textToken: tokens.getPropertyValue("--text").trim(),
  117 |             background: paint.backgroundColor,
  118 |             foreground: paint.color,
  119 |           };
> 120 |         })).toEqual({
      |             ^ Error: expect(received).toEqual(expected) // deep equality
  121 |           theme: selected, appearance: "1", sharedShell: null,
  122 |           backgroundToken: selected === "light" ? "#f7f8fa" : "#0a0b0e",
  123 |           panelToken: selected === "light" ? "#ffffff" : "#0d0f13",
  124 |           textToken: selected === "light" ? "#202632" : "#d6dae3",
  125 |           background: selected === "light" ? "rgb(255, 255, 255)" : "rgb(13, 15, 19)",
  126 |           foreground: selected === "light" ? "rgb(32, 38, 50)" : "rgb(214, 218, 227)",
  127 |         });
  128 |       };
  129 |       await expectThemePaint(theme);
  130 |       const otherTheme = theme === "light" ? "dark" : "light";
  131 |       await page.getByRole("radio", { name: otherTheme === "light" ? "Light" : "Dark", exact: true }).check();
  132 |       await expectThemePaint(otherTheme);
  133 |       await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true }).check();
  134 |       await expectThemePaint(theme);
  135 |       const initial = await expectMeasuredPlot(svg);
  136 |       const originalPanel = await panel.elementHandle();
  137 |       const contentHost = await svg.locator("..").locator("..").elementHandle();
  138 |       expect(originalPanel).not.toBeNull();
  139 |       expect(contentHost).not.toBeNull();
  140 | 
  141 |       const observation = page.getByTestId("cycle-observation");
  142 |       if (transition === "table") {
  143 |         await panel.getByLabel(L.obs).focus();
  144 |         await page.keyboard.press("Home");
  145 |       }
  146 |       const date = (await observation.locator("time").textContent())!.trim();
  147 |       const value = (await observation.locator("strong").first().textContent())!.trim();
  148 |       const selectFamily = async (label: string) => {
  149 |         if (initialViewport.width >= 641 && initialViewport.width <= 980) {
  150 |           await page.getByTestId("sector-cycle-lens").getByRole("button", { name: L.changeSeries, exact: true }).click();
  151 |           const sheet = page.getByRole("dialog");
  152 |           await expect(sheet).toBeVisible();
  153 |           await sheet.getByRole("button", { name: label, exact: true }).click();
  154 |           await expect(sheet).toBeHidden();
  155 |         } else {
  156 |           await page.getByTestId("cycle-phase-rail").getByRole("tab", { name: label }).click();
  157 |         }
  158 |       };
  159 | 
  160 |       if (transition === "table") {
  161 |         await panel.getByRole("button", { name: L.table, exact: true }).click();
  162 |         const row = panel.locator(`table tbody tr:has(> th:text-is("${date}"))`).first();
  163 |         await expect(row.locator("td").first()).toHaveText(value);
  164 |       } else {
  165 |         await selectFamily(L.baskets);
  166 |         await expect(panel.getByRole("status")).toBeVisible();
  167 |       }
  168 |       await expect(svg).toHaveCount(0);
  169 |       await page.setViewportSize({ ...initialViewport, width: widths[0] });
  170 |       expect(await originalPanel!.evaluate(node => node.isConnected)).toBe(true);
  171 |       expect(await contentHost!.evaluate(node => node.isConnected)).toBe(true);
  172 | 
  173 |       if (transition === "table") {
  174 |         await panel.getByRole("button", { name: L.chart, exact: true }).click();
  175 |       } else {
  176 |         await selectFamily(L.sectorsTab);
  177 |       }
  178 |       const restored = await expectMeasuredPlot(svg);
  179 |       expect(Math.abs(restored.container - initial.container)).toBeGreaterThan(1);
  180 |       expect(await svg.evaluate((node, original) => node.parentElement!.parentElement === original, contentHost)).toBe(true);
  181 |       expect(await panel.evaluate((node, original) => node === original, originalPanel)).toBe(true);
  182 |       await expect(observation.locator("time")).toHaveText(date);
  183 |       await expect(observation.locator("strong").first()).toHaveText(value);
  184 | 
  185 |       await page.setViewportSize({ ...initialViewport, width: widths[1] });
  186 |       await expectMeasuredPlot(svg);
  187 |       await page.setViewportSize(initialViewport);
  188 |       await expectMeasuredPlot(svg);
  189 |       await expect(observation.locator("time")).toHaveText(date);
  190 |       await expect(observation.locator("strong").first()).toHaveText(value);
  191 |       expect(await panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  192 |       await expectThemePaint(theme);
  193 |       await panel.screenshot({
  194 |         path: info.outputPath(`cycles-measurement-${transition}-${lang}-${info.project.name}.png`),
  195 |         animations: "disabled",
  196 |       });
  197 |     });
  198 |   }
  199 | 
  200 | 
  201 |   test(`cycles core journey ${lang} ${theme}`, async ({ page }, info) => {
  202 |     await page.goto("/dev/sector-cycles");
  203 |     await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
  204 |     await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true }).check();
  205 | 
  206 |     const lens = page.getByTestId("sector-cycle-lens");
  207 |     await expect(lens).toBeVisible();
  208 |     // Fixture honesty is visible on the harness itself.
  209 |     await expect(page.getByText(/Fixture data/)).toBeVisible();
  210 | 
  211 |     const rail = page.getByTestId("cycle-phase-rail");
  212 |     const panel = page.getByTestId("cycle-chart-panel");
  213 |     // R5-Y04 replaces the rail with the real picker only in the tablet band.
  214 |     const width = page.viewportSize()!.width;
  215 |     const usesPicker = width >= 641 && width <= 980;
  216 |     const heroTicker = page.getByTestId("cycle-hero").locator("h3 > b");
  217 |     const openPicker = async () => {
  218 |       await expect(rail).toBeHidden();
  219 |       await lens.getByRole("button", { name: L.changeSeries, exact: true }).click();
  220 |       const sheet = page.getByRole("dialog");
```