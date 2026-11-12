# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sector-cycle-lens.spec.ts >> cycles chart measurement survives empty transitions en dark
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
        - radio "EN" [checked] [ref=e7]
        - text: EN
      - generic [ref=e8]:
        - radio "ZH" [ref=e9]
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
        - heading "Sector cycles" [level=2] [ref=e27]
        - paragraph [ref=e28]: Technology XLK · As of 2026-10-30 · Sector ETFs vs SPY · reconstructed price history
      - generic [ref=e29]:
        - complementary "Sectors by phase" [ref=e30]:
          - heading "Sectors by phase" [level=3] [ref=e31]
          - paragraph [ref=e32]: 5 of 5 measured · Sector ETFs vs SPY
          - tablist "Sectors by phase" [ref=e33]:
            - tab "Sector ETFs vs SPY" [selected] [ref=e34] [cursor=pointer]
            - tab "Thematic Baskets vs SPY" [ref=e35] [cursor=pointer]
          - generic [ref=e36]:
            - generic [ref=e37]: Filter series
            - searchbox "Filter series" [ref=e38]
          - generic [ref=e39]:
            - heading "Bottoming 1" [level=4] [ref=e40]:
              - text: Bottoming
              - generic [ref=e41]: "1"
            - button "Energy XLE" [ref=e42] [cursor=pointer]:
              - generic [ref=e43]: Energy
              - generic [ref=e44]: XLE
          - generic [ref=e45]:
            - heading "Prime entry 1" [level=4] [ref=e46]:
              - text: Prime entry
              - generic [ref=e47]: "1"
            - button "Financials XLF" [ref=e48] [cursor=pointer]:
              - generic [ref=e49]: Financials
              - generic [ref=e50]: XLF
          - generic [ref=e51]:
            - heading "Trending 1" [level=4] [ref=e52]:
              - text: Trending
              - generic [ref=e53]: "1"
            - button "Technology XLK" [pressed] [ref=e54] [cursor=pointer]:
              - generic [ref=e55]: Technology
              - generic [ref=e56]: XLK
          - generic [ref=e57]:
            - heading "Topping · late 1" [level=4] [ref=e58]:
              - text: Topping · late
              - generic [ref=e59]: "1"
            - button "Health Care XLV" [ref=e60] [cursor=pointer]:
              - generic [ref=e61]: Health Care
              - generic [ref=e62]: XLV
          - generic [ref=e63]:
            - heading "Rolling over 1" [level=4] [ref=e64]:
              - text: Rolling over
              - generic [ref=e65]: "1"
            - button "Cons Discretionary XLY" [ref=e66] [cursor=pointer]:
              - generic [ref=e67]: Cons Discretionary
              - generic [ref=e68]: XLY
          - group [ref=e69]:
            - generic "Method" [ref=e70] [cursor=pointer]
        - generic [ref=e71]:
          - generic [ref=e72]:
            - generic [ref=e73]:
              - heading "Technology XLK" [level=3] [ref=e74]
              - generic [ref=e75]:
                - generic [ref=e76]: "Cycle phase · ontology: Expansion"
                - generic [ref=e77]: Position · ontology 72
                - generic [ref=e78]:
                  - text: Price vs 200-session average
                  - generic [ref=e79]: Above
              - paragraph [ref=e80]: 0–100 scale. Not a probability.
            - button "Open sector dossier" [ref=e82] [cursor=pointer]
          - generic [ref=e83]:
            - heading "Clocks" [level=4] [ref=e84]
            - generic [ref=e85]:
              - generic [ref=e86]: phase clock
              - generic [ref=e87]: timing ladder
              - generic [ref=e88]: hazard clock
              - generic "Each disagreeing clock's own values are kept in the provenance drawer." [ref=e89]: rhythm clock ⚠
              - generic [ref=e90]: cycle read
            - paragraph [ref=e91]: Each disagreeing clock's own values are kept in the provenance drawer.
          - generic [ref=e92]:
            - heading "Strength vs SPY" [level=3] [ref=e94]
            - generic [ref=e95]:
              - button "Series (5)" [ref=e96] [cursor=pointer]: Series (5)＋
              - generic [ref=e97]:
                - text: Chart range
                - combobox "Chart range" [ref=e98]:
                  - option "21 sessions"
                  - option "63 sessions" [selected]
                  - option "252 sessions"
                  - option "All"
              - generic [ref=e99]:
                - text: Scale
                - combobox "Scale" [ref=e100]:
                  - option "Linear" [selected]
                  - option "Log" [disabled]
              - group "Strength vs SPY" [ref=e101]:
                - button "Chart" [pressed] [ref=e102] [cursor=pointer]
                - button "Data table" [ref=e103] [cursor=pointer]
              - button "Full screen" [ref=e104] [cursor=pointer]: Full screen⤢
            - generic [ref=e105]:
              - generic [ref=e106]:
                - text: XLK · 21 sessions
                - generic [ref=e108]: total return
              - generic [ref=e109]:
                - text: XLK · 63 sessions
                - generic [ref=e111]: total return
            - generic [ref=e112]:
              - generic [ref=e113]:
                - generic [ref=e114]:
                  - text: XLK · 21 sessions
                  - strong [ref=e115]: +4.5%
                - generic [ref=e116]:
                  - text: XLK · 63 sessions
                  - strong [ref=e117]: +1.0%
                - time [ref=e118]: 2026-05-02
              - img "Strength vs SPY" [ref=e120]:
                - generic [ref=e122]: "-5"
                - generic [ref=e124]: "0"
                - generic [ref=e126]: "5"
                - generic "2026-03-12 · peak · Provisional" [ref=e129]
                - generic [ref=e131]: peak 2026-03-12
                - generic [ref=e134]: 2026-02-28
                - generic [ref=e135]: 2026-03-05
                - generic [ref=e136]: 2026-03-10
                - generic [ref=e137]: 2026-03-15
                - generic [ref=e138]: 2026-03-20
                - generic [ref=e139]: 2026-03-25
                - generic [ref=e140]: 2026-03-30
                - generic [ref=e141]: 2026-04-04
                - generic [ref=e142]: 2026-04-09
                - generic [ref=e143]: 2026-04-14
                - generic [ref=e144]: 2026-04-19
                - generic [ref=e145]: 2026-04-24
                - generic [ref=e146]: 2026-05-02
              - slider "Observation date" [ref=e147]: "63"
              - generic [ref=e148]:
                - generic [ref=e149]: 2026-02-28
                - generic [ref=e150]: 2026-05-02
            - generic [ref=e151]:
              - heading "Price turns" [level=4] [ref=e152]
              - paragraph [ref=e153]: Turn dates are pivot dates. A turn becomes known only at confirmation — the two dates are kept distinct.
              - generic [ref=e154]:
                - time [ref=e155]: 2026-03-12
                - generic [ref=e156]: Peak
                - emphasis [ref=e157]: Provisional
            - group [ref=e158]:
              - generic "Exact values" [ref=e159] [cursor=pointer]
            - group [ref=e160]:
              - generic "Method" [ref=e161]
          - generic [ref=e162]:
            - heading "Leg timeline" [level=3] [ref=e163]
            - list [ref=e165]:
              - listitem [ref=e166]:
                - button "2025-09-13 → 2025-11-12" [ref=e167] [cursor=pointer]:
                  - generic [ref=e168]: 2025-09-13 → 2025-11-12
                  - generic [ref=e169]: ▲
              - listitem [ref=e170]:
                - button "2025-11-12 → 2026-01-21" [ref=e171] [cursor=pointer]:
                  - generic [ref=e172]: 2025-11-12 → 2026-01-21
                  - generic [ref=e173]: ▼
              - listitem [ref=e174]:
                - button "2026-01-21 → 2026-03-12 · Provisional" [ref=e175] [cursor=pointer]:
                  - generic [ref=e176]: 2026-01-21 → 2026-03-12 · Provisional
                  - generic [ref=e177]: ▲
              - listitem [ref=e178]:
                - button "2026-03-12 · Open leg · Open · 51 sessions" [ref=e179] [cursor=pointer]:
                  - generic [ref=e180]: 2026-03-12 · Open leg · Open · 51 sessions
                  - generic [ref=e181]: ▼
          - generic [ref=e182]:
            - generic [ref=e183]:
              - heading "The read" [level=3] [ref=e184]
              - paragraph [ref=e185]: The production read names a different phase family than the phase clock; it is kept verbatim in the provenance drawer and is not drawn as the current read.
            - generic [ref=e186]:
              - heading "Rotation events" [level=3] [ref=e187]
              - paragraph [ref=e188]: No closed rotation episodes in this window
          - generic [ref=e189]:
            - generic [ref=e190]:
              - heading "Turn estimate & priors" [level=3] [ref=e191]
              - group "Turn hazard (historical qualification only)" [ref=e192]:
                - heading "Turn hazard (historical qualification only)" [level=4] [ref=e193]
                - generic [ref=e194]:
                  - generic [ref=e195]: P(turn ≤ 1m)
                  - generic [ref=e196]: ≤3m
                  - generic [ref=e197]: ≤6m
                  - generic [ref=e198]: an up leg · peak
                  - generic [ref=e199]:
                    - generic [ref=e200]: 18%
                    - generic [ref=e201]: MODEL
                  - generic [ref=e202]:
                    - generic [ref=e203]: 34%
                    - generic [ref=e204]: PRIOR
                  - generic [ref=e205]:
                    - generic [ref=e206]: 41%
                    - generic [ref=e207]: MODEL
                - paragraph [ref=e208]: "PRIOR: historical base rate, not a model"
            - generic [ref=e209]:
              - generic [ref=e210]:
                - heading "Methods and limits" [level=3] [ref=e211]
                - list [ref=e212]:
                  - listitem [ref=e213]: "Position sizing: none. The conviction multiplier is held at 1.0 and is not a size."
                  - listitem [ref=e214]: Own rhythm, descriptive. Not a model.
                  - listitem [ref=e215]: "Lead-lag: no claim. The lead-lag study stopped; nothing here orders sectors in time."
                  - listitem [ref=e216]: Source parity holds; model qualifications remain separate
                - group [ref=e217]:
                  - generic "Evidence details" [ref=e218] [cursor=pointer]
              - generic [ref=e219]:
                - paragraph [ref=e220]: Conviction-call grader
                - 'heading "Conviction-call grader: measured hit rate" [level=3] [ref=e221]'
                - paragraph [ref=e222]: Conviction-call hit rate over all resolved calls, Neutral included. Not a win rate.
                - paragraph [ref=e223]: Realized directional hit-rate, cross-sectional rank-IC and excess-vs-SPY of the conviction calls, by horizon. Sparse until it accrues; never fed back into the live score.
                - paragraph [ref=e224]: Grader unavailable in this generation
            - generic [ref=e225]:
              - heading "Timing & projection" [level=3] [ref=e226]
              - paragraph [ref=e227]: ◷18 sessions in this phase
              - paragraph [ref=e228]:
                - text: Price vs 200-session average Above
                - generic [ref=e229]: UPTREND
              - paragraph [ref=e230]: Time in phase is a measured historical fact — not remaining upside, and not a time limit.
              - generic [ref=e231]:
                - generic [ref=e232]:
                  - generic [ref=e233]: Descriptive rhythm
                  - generic [ref=e234]: Window has not opened
                - paragraph [ref=e235]: Next trough ≈ Feb ’27
                - generic [ref=e236]:
                  - generic [ref=e237]:
                    - term [ref=e238]: earliest
                    - definition [ref=e239]: Dec ’26
                  - generic [ref=e240]:
                    - term [ref=e241]: central
                    - definition [ref=e242]: Feb ’27
                  - generic [ref=e243]:
                    - term [ref=e244]: latest
                    - definition [ref=e245]: Apr ’27
                - paragraph [ref=e246]: "Projected next trough ≈ Feb ’27 (Dec ’26–Apr ’27), from this sector's own median half-cycle: a descriptive rhythm, not a model, and a timing window, not a guarantee."
          - generic [ref=e247]:
            - heading "Remaining-opportunity forecasts" [level=3] [ref=e248]
            - list [ref=e249]:
              - listitem [ref=e250]:
                - generic [ref=e251]: Remaining return
                - generic [ref=e252]: Withheld
                - generic [ref=e253]: "Withheld: the research test failed this forecast on current data"
                - generic [ref=e254]: "Horizon: 20 completed sessions"
                - group [ref=e255]:
                  - generic "Evidence" [ref=e256]
              - listitem [ref=e257]:
                - generic [ref=e258]: Adverse tail
                - generic [ref=e259]: Withheld
                - generic [ref=e260]: "Withheld: live cycle state does not match the research protocol's turn epoch"
                - generic [ref=e261]: "Horizon: 20 completed sessions"
                - group [ref=e262]:
                  - generic "Evidence" [ref=e263]
              - listitem [ref=e264]:
                - generic [ref=e265]: Target before invalidation
                - generic [ref=e266]: Withheld
                - generic [ref=e267]: "Withheld: live cycle state does not match the research protocol's turn epoch"
                - generic [ref=e268]: "Horizon: 20 completed sessions"
                - generic [ref=e269]: "Leg-direction fact: what the current up/down leg tends to reach, not a cycle-timing edge."
                - group [ref=e270]:
                  - generic "Evidence" [ref=e271]
              - listitem [ref=e272]:
                - generic [ref=e273]: Transition time
                - generic [ref=e274]: Withheld
                - generic [ref=e275]: "Withheld: live cycle state does not match the research protocol's turn epoch"
                - generic [ref=e276]: "Horizon: 20 completed sessions"
                - group [ref=e277]:
                  - generic "Evidence" [ref=e278]
            - paragraph [ref=e279]: No estimate is shown for a withheld forecast.
            - paragraph [ref=e280]: Each forecast is withheld on its own; the observed cycle facts above are unaffected.
          - paragraph [ref=e281]: Descriptive evidence. No stock recommendation, sizing or execution authority.
  - alert [ref=e282]
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