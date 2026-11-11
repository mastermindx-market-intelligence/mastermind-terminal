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
      - generic [ref=e30]:
        - generic [ref=e31]:
          - generic [ref=e32]:
            - heading "Technology XLK" [level=3] [ref=e33]
            - generic [ref=e34]:
              - generic [ref=e35]: "Cycle phase · ontology: Expansion"
              - generic [ref=e36]: Position · ontology 72
              - generic [ref=e37]:
                - text: Price vs 200-session average
                - generic [ref=e38]: Above
            - paragraph [ref=e39]: 0–100 scale. Not a probability.
          - generic [ref=e40]:
            - button "Change series" [ref=e41] [cursor=pointer]
            - button "Open sector dossier" [ref=e42] [cursor=pointer]
        - generic [ref=e43]:
          - heading "Clocks" [level=4] [ref=e44]
          - generic [ref=e45]:
            - generic [ref=e46]: phase clock
            - generic [ref=e47]: timing ladder
            - generic [ref=e48]: hazard clock
            - generic "Each disagreeing clock's own values are kept in the provenance drawer." [ref=e49]: rhythm clock ⚠
            - generic [ref=e50]: cycle read
          - paragraph [ref=e51]: Each disagreeing clock's own values are kept in the provenance drawer.
        - generic [ref=e52]:
          - heading "Strength vs SPY" [level=3] [ref=e54]
          - generic [ref=e55]:
            - button "Series (5)" [ref=e56] [cursor=pointer]: Series (5)＋
            - generic [ref=e57]:
              - text: Chart range
              - combobox "Chart range" [ref=e58]:
                - option "21 sessions"
                - option "63 sessions" [selected]
                - option "252 sessions"
                - option "All"
            - generic [ref=e59]:
              - text: Scale
              - combobox "Scale" [ref=e60]:
                - option "Linear" [selected]
                - option "Log" [disabled]
            - group "Strength vs SPY" [ref=e61]:
              - button "Chart" [pressed] [ref=e62] [cursor=pointer]
              - button "Data table" [ref=e63] [cursor=pointer]
            - button "Full screen" [ref=e64] [cursor=pointer]: Full screen⤢
          - generic [ref=e65]:
            - generic [ref=e66]:
              - text: XLK · 21 sessions
              - generic [ref=e68]: total return
            - generic [ref=e69]:
              - text: XLK · 63 sessions
              - generic [ref=e71]: total return
          - generic [ref=e72]:
            - generic [ref=e73]:
              - generic [ref=e74]:
                - text: XLK · 21 sessions
                - strong [ref=e75]: +4.5%
              - generic [ref=e76]:
                - text: XLK · 63 sessions
                - strong [ref=e77]: +1.0%
              - time [ref=e78]: 2026-05-02
            - img "Strength vs SPY" [ref=e80]:
              - generic [ref=e82]: "-5"
              - generic [ref=e84]: "0"
              - generic [ref=e86]: "5"
              - generic "2026-03-12 · peak · Provisional" [ref=e89]
              - generic [ref=e91]: peak 2026-03-12
              - generic [ref=e94]: 2026-02-28
              - generic [ref=e95]: 2026-03-06
              - generic [ref=e96]: 2026-03-12
              - generic [ref=e97]: 2026-03-18
              - generic [ref=e98]: 2026-03-24
              - generic [ref=e99]: 2026-03-30
              - generic [ref=e100]: 2026-04-05
              - generic [ref=e101]: 2026-04-11
              - generic [ref=e102]: 2026-04-17
              - generic [ref=e103]: 2026-04-23
              - generic [ref=e104]: 2026-05-02
            - slider "Observation date" [ref=e105]: "63"
            - generic [ref=e106]:
              - generic [ref=e107]: 2026-02-28
              - generic [ref=e108]: 2026-05-02
          - generic [ref=e109]:
            - heading "Price turns" [level=4] [ref=e110]
            - paragraph [ref=e111]: Turn dates are pivot dates. A turn becomes known only at confirmation — the two dates are kept distinct.
            - generic [ref=e112]:
              - time [ref=e113]: 2026-03-12
              - generic [ref=e114]: Peak
              - emphasis [ref=e115]: Provisional
          - group [ref=e116]:
            - generic "Exact values" [ref=e117] [cursor=pointer]
          - group [ref=e118]:
            - generic "Method" [ref=e119]
        - generic [ref=e120]:
          - heading "Leg timeline" [level=3] [ref=e121]
          - list [ref=e123]:
            - listitem [ref=e124]:
              - button "2025-09-13 → 2025-11-12" [ref=e125] [cursor=pointer]:
                - generic [ref=e126]: 2025-09-13 → 2025-11-12
                - generic [ref=e127]: ▲
            - listitem [ref=e128]:
              - button "2025-11-12 → 2026-01-21" [ref=e129] [cursor=pointer]:
                - generic [ref=e130]: 2025-11-12 → 2026-01-21
                - generic [ref=e131]: ▼
            - listitem [ref=e132]:
              - button "2026-01-21 → 2026-03-12 · Provisional" [ref=e133] [cursor=pointer]:
                - generic [ref=e134]: 2026-01-21 → 2026-03-12 · Provisional
                - generic [ref=e135]: ▲
            - listitem [ref=e136]:
              - button "2026-03-12 · Open leg · Open · 51 sessions" [ref=e137] [cursor=pointer]:
                - generic [ref=e138]: 2026-03-12 · Open leg · Open · 51 sessions
                - generic [ref=e139]: ▼
        - generic [ref=e140]:
          - generic [ref=e141]:
            - heading "The read" [level=3] [ref=e142]
            - paragraph [ref=e143]: The production read names a different phase family than the phase clock; it is kept verbatim in the provenance drawer and is not drawn as the current read.
          - generic [ref=e144]:
            - heading "Rotation events" [level=3] [ref=e145]
            - paragraph [ref=e146]: No closed rotation episodes in this window
        - generic [ref=e147]:
          - generic [ref=e148]:
            - heading "Turn estimate & priors" [level=3] [ref=e149]
            - group "Turn hazard (historical qualification only)" [ref=e150]:
              - heading "Turn hazard (historical qualification only)" [level=4] [ref=e151]
              - generic [ref=e152]:
                - generic [ref=e153]: P(turn ≤ 1m)
                - generic [ref=e154]: ≤3m
                - generic [ref=e155]: ≤6m
                - generic [ref=e156]: an up leg · peak
                - generic [ref=e157]:
                  - generic [ref=e158]: 18%
                  - generic [ref=e159]: MODEL
                - generic [ref=e160]:
                  - generic [ref=e161]: 34%
                  - generic [ref=e162]: PRIOR
                - generic [ref=e163]:
                  - generic [ref=e164]: 41%
                  - generic [ref=e165]: MODEL
              - paragraph [ref=e166]: "PRIOR: historical base rate, not a model"
          - generic [ref=e167]:
            - generic [ref=e168]:
              - heading "Methods and limits" [level=3] [ref=e169]
              - list [ref=e170]:
                - listitem [ref=e171]: "Position sizing: none. The conviction multiplier is held at 1.0 and is not a size."
                - listitem [ref=e172]: Own rhythm, descriptive. Not a model.
                - listitem [ref=e173]: "Lead-lag: no claim. The lead-lag study stopped; nothing here orders sectors in time."
                - listitem [ref=e174]: Source parity holds; model qualifications remain separate
              - group [ref=e175]:
                - generic "Evidence details" [ref=e176] [cursor=pointer]
            - generic [ref=e177]:
              - paragraph [ref=e178]: Conviction-call grader
              - 'heading "Conviction-call grader: measured hit rate" [level=3] [ref=e179]'
              - paragraph [ref=e180]: Conviction-call hit rate over all resolved calls, Neutral included. Not a win rate.
              - paragraph [ref=e181]: Realized directional hit-rate, cross-sectional rank-IC and excess-vs-SPY of the conviction calls, by horizon. Sparse until it accrues; never fed back into the live score.
              - paragraph [ref=e182]: Grader unavailable in this generation
          - generic [ref=e183]:
            - heading "Timing & projection" [level=3] [ref=e184]
            - paragraph [ref=e185]: ◷18 sessions in this phase
            - paragraph [ref=e186]:
              - text: Price vs 200-session average Above
              - generic [ref=e187]: UPTREND
            - paragraph [ref=e188]: Time in phase is a measured historical fact — not remaining upside, and not a time limit.
            - generic [ref=e189]:
              - generic [ref=e190]:
                - generic [ref=e191]: Descriptive rhythm
                - generic [ref=e192]: Window has not opened
              - paragraph [ref=e193]: Next trough ≈ Feb ’27
              - generic [ref=e194]:
                - generic [ref=e195]:
                  - term [ref=e196]: earliest
                  - definition [ref=e197]: Dec ’26
                - generic [ref=e198]:
                  - term [ref=e199]: central
                  - definition [ref=e200]: Feb ’27
                - generic [ref=e201]:
                  - term [ref=e202]: latest
                  - definition [ref=e203]: Apr ’27
              - paragraph [ref=e204]: "Projected next trough ≈ Feb ’27 (Dec ’26–Apr ’27), from this sector's own median half-cycle: a descriptive rhythm, not a model, and a timing window, not a guarantee."
        - generic [ref=e205]:
          - heading "Remaining-opportunity forecasts" [level=3] [ref=e206]
          - list [ref=e207]:
            - listitem [ref=e208]:
              - generic [ref=e209]: Remaining return
              - generic [ref=e210]: Withheld
              - generic [ref=e211]: "Withheld: the research test failed this forecast on current data"
              - generic [ref=e212]: "Horizon: 20 completed sessions"
              - group [ref=e213]:
                - generic "Evidence" [ref=e214]
            - listitem [ref=e215]:
              - generic [ref=e216]: Adverse tail
              - generic [ref=e217]: Withheld
              - generic [ref=e218]: "Withheld: live cycle state does not match the research protocol's turn epoch"
              - generic [ref=e219]: "Horizon: 20 completed sessions"
              - group [ref=e220]:
                - generic "Evidence" [ref=e221]
            - listitem [ref=e222]:
              - generic [ref=e223]: Target before invalidation
              - generic [ref=e224]: Withheld
              - generic [ref=e225]: "Withheld: live cycle state does not match the research protocol's turn epoch"
              - generic [ref=e226]: "Horizon: 20 completed sessions"
              - generic [ref=e227]: "Leg-direction fact: what the current up/down leg tends to reach, not a cycle-timing edge."
              - group [ref=e228]:
                - generic "Evidence" [ref=e229]
            - listitem [ref=e230]:
              - generic [ref=e231]: Transition time
              - generic [ref=e232]: Withheld
              - generic [ref=e233]: "Withheld: live cycle state does not match the research protocol's turn epoch"
              - generic [ref=e234]: "Horizon: 20 completed sessions"
              - group [ref=e235]:
                - generic "Evidence" [ref=e236]
          - paragraph [ref=e237]: No estimate is shown for a withheld forecast.
          - paragraph [ref=e238]: Each forecast is withheld on its own; the observed cycle facts above are unaffected.
        - paragraph [ref=e239]: Descriptive evidence. No stock recommendation, sizing or execution authority.
  - alert [ref=e240]
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