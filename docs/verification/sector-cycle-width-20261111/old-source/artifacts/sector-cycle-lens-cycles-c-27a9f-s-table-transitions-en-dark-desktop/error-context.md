# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sector-cycle-lens.spec.ts >> cycles chart measurement survives table transitions en dark
- Location: e2e/sector-cycle-lens.spec.ts:93:9

# Error details

```
Error: SVG coordinates must follow the current measured content width

SVG coordinates must follow the current measured content width

expect(received).toBeLessThanOrEqual(expected)

Expected: <= 1
Received:    340

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
        - radio "Dark" [checked] [ref=e11]
        - text: Dark
      - generic [ref=e12]:
        - radio "Light" [ref=e13]
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
                - button "Chart" [active] [pressed] [ref=e102] [cursor=pointer]
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
                - text: XLK · 21 sessions
                - strong [ref=e114]: +4.6%
              - generic [ref=e115]:
                - text: XLK · 63 sessions
                - strong [ref=e116]: "-0.0%"
              - time [ref=e117]: 2026-02-28
            - img "Strength vs SPY" [ref=e119]:
              - generic [ref=e121]: "-5"
              - generic [ref=e123]: "0"
              - generic [ref=e125]: "5"
              - generic "2026-03-12 · peak · Provisional" [ref=e128]
              - generic [ref=e130]: peak 2026-03-12
              - generic [ref=e133]: 2026-02-28
              - generic [ref=e134]: 2026-03-05
              - generic [ref=e135]: 2026-03-10
              - generic [ref=e136]: 2026-03-15
              - generic [ref=e137]: 2026-03-20
              - generic [ref=e138]: 2026-03-25
              - generic [ref=e139]: 2026-03-30
              - generic [ref=e140]: 2026-04-04
              - generic [ref=e141]: 2026-04-09
              - generic [ref=e142]: 2026-04-14
              - generic [ref=e143]: 2026-04-19
              - generic [ref=e144]: 2026-04-24
              - generic [ref=e145]: 2026-05-02
            - slider "Observation date" [ref=e146]: "0"
            - generic [ref=e147]:
              - generic [ref=e148]: 2026-02-28
              - generic [ref=e149]: 2026-05-02
            - generic [ref=e150]:
              - heading "Price turns" [level=4] [ref=e151]
              - paragraph [ref=e152]: Turn dates are pivot dates. A turn becomes known only at confirmation — the two dates are kept distinct.
              - text: No turns in this range
            - group [ref=e153]:
              - generic "Exact values" [ref=e154] [cursor=pointer]
            - group [ref=e155]:
              - generic "Method" [ref=e156]
          - generic [ref=e157]:
            - heading "Leg timeline" [level=3] [ref=e158]
            - list [ref=e160]:
              - listitem [ref=e161]:
                - button "2025-09-13 → 2025-11-12" [ref=e162] [cursor=pointer]:
                  - generic [ref=e163]: 2025-09-13 → 2025-11-12
                  - generic [ref=e164]: ▲
              - listitem [ref=e165]:
                - button "2025-11-12 → 2026-01-21" [ref=e166] [cursor=pointer]:
                  - generic [ref=e167]: 2025-11-12 → 2026-01-21
                  - generic [ref=e168]: ▼
              - listitem [ref=e169]:
                - button "2026-01-21 → 2026-03-12 · Provisional" [ref=e170] [cursor=pointer]:
                  - generic [ref=e171]: 2026-01-21 → 2026-03-12 · Provisional
                  - generic [ref=e172]: ▲
              - listitem [ref=e173]:
                - button "2026-03-12 · Open leg · Open · 51 sessions" [ref=e174] [cursor=pointer]:
                  - generic [ref=e175]: 2026-03-12 · Open leg · Open · 51 sessions
                  - generic [ref=e176]: ▼
          - generic [ref=e177]:
            - generic [ref=e178]:
              - heading "The read" [level=3] [ref=e179]
              - paragraph [ref=e180]: The production read names a different phase family than the phase clock; it is kept verbatim in the provenance drawer and is not drawn as the current read.
            - generic [ref=e181]:
              - heading "Rotation events" [level=3] [ref=e182]
              - paragraph [ref=e183]: No closed rotation episodes in this window
          - generic [ref=e184]:
            - generic [ref=e185]:
              - heading "Turn estimate & priors" [level=3] [ref=e186]
              - group "Turn hazard (historical qualification only)" [ref=e187]:
                - heading "Turn hazard (historical qualification only)" [level=4] [ref=e188]
                - generic [ref=e189]:
                  - generic [ref=e190]: P(turn ≤ 1m)
                  - generic [ref=e191]: ≤3m
                  - generic [ref=e192]: ≤6m
                  - generic [ref=e193]: an up leg · peak
                  - generic [ref=e194]:
                    - generic [ref=e195]: 18%
                    - generic [ref=e196]: MODEL
                  - generic [ref=e197]:
                    - generic [ref=e198]: 34%
                    - generic [ref=e199]: PRIOR
                  - generic [ref=e200]:
                    - generic [ref=e201]: 41%
                    - generic [ref=e202]: MODEL
                - paragraph [ref=e203]: "PRIOR: historical base rate, not a model"
            - generic [ref=e204]:
              - generic [ref=e205]:
                - heading "Methods and limits" [level=3] [ref=e206]
                - list [ref=e207]:
                  - listitem [ref=e208]: "Position sizing: none. The conviction multiplier is held at 1.0 and is not a size."
                  - listitem [ref=e209]: Own rhythm, descriptive. Not a model.
                  - listitem [ref=e210]: "Lead-lag: no claim. The lead-lag study stopped; nothing here orders sectors in time."
                  - listitem [ref=e211]: Source parity holds; model qualifications remain separate
                - group [ref=e212]:
                  - generic "Evidence details" [ref=e213] [cursor=pointer]
              - generic [ref=e214]:
                - paragraph [ref=e215]: Conviction-call grader
                - 'heading "Conviction-call grader: measured hit rate" [level=3] [ref=e216]'
                - paragraph [ref=e217]: Conviction-call hit rate over all resolved calls, Neutral included. Not a win rate.
                - paragraph [ref=e218]: Realized directional hit-rate, cross-sectional rank-IC and excess-vs-SPY of the conviction calls, by horizon. Sparse until it accrues; never fed back into the live score.
                - paragraph [ref=e219]: Grader unavailable in this generation
            - generic [ref=e220]:
              - heading "Timing & projection" [level=3] [ref=e221]
              - paragraph [ref=e222]: ◷18 sessions in this phase
              - paragraph [ref=e223]:
                - text: Price vs 200-session average Above
                - generic [ref=e224]: UPTREND
              - paragraph [ref=e225]: Time in phase is a measured historical fact — not remaining upside, and not a time limit.
              - generic [ref=e226]:
                - generic [ref=e227]:
                  - generic [ref=e228]: Descriptive rhythm
                  - generic [ref=e229]: Window has not opened
                - paragraph [ref=e230]: Next trough ≈ Feb ’27
                - generic [ref=e231]:
                  - generic [ref=e232]:
                    - term [ref=e233]: earliest
                    - definition [ref=e234]: Dec ’26
                  - generic [ref=e235]:
                    - term [ref=e236]: central
                    - definition [ref=e237]: Feb ’27
                  - generic [ref=e238]:
                    - term [ref=e239]: latest
                    - definition [ref=e240]: Apr ’27
                - paragraph [ref=e241]: "Projected next trough ≈ Feb ’27 (Dec ’26–Apr ’27), from this sector's own median half-cycle: a descriptive rhythm, not a model, and a timing window, not a guarantee."
          - generic [ref=e242]:
            - heading "Remaining-opportunity forecasts" [level=3] [ref=e243]
            - list [ref=e244]:
              - listitem [ref=e245]:
                - generic [ref=e246]: Remaining return
                - generic [ref=e247]: Withheld
                - generic [ref=e248]: "Withheld: the research test failed this forecast on current data"
                - generic [ref=e249]: "Horizon: 20 completed sessions"
                - group [ref=e250]:
                  - generic "Evidence" [ref=e251]
              - listitem [ref=e252]:
                - generic [ref=e253]: Adverse tail
                - generic [ref=e254]: Withheld
                - generic [ref=e255]: "Withheld: live cycle state does not match the research protocol's turn epoch"
                - generic [ref=e256]: "Horizon: 20 completed sessions"
                - group [ref=e257]:
                  - generic "Evidence" [ref=e258]
              - listitem [ref=e259]:
                - generic [ref=e260]: Target before invalidation
                - generic [ref=e261]: Withheld
                - generic [ref=e262]: "Withheld: live cycle state does not match the research protocol's turn epoch"
                - generic [ref=e263]: "Horizon: 20 completed sessions"
                - generic [ref=e264]: "Leg-direction fact: what the current up/down leg tends to reach, not a cycle-timing edge."
                - group [ref=e265]:
                  - generic "Evidence" [ref=e266]
              - listitem [ref=e267]:
                - generic [ref=e268]: Transition time
                - generic [ref=e269]: Withheld
                - generic [ref=e270]: "Withheld: live cycle state does not match the research protocol's turn epoch"
                - generic [ref=e271]: "Horizon: 20 completed sessions"
                - group [ref=e272]:
                  - generic "Evidence" [ref=e273]
            - paragraph [ref=e274]: No estimate is shown for a withheld forecast.
            - paragraph [ref=e275]: Each forecast is withheld on its own; the observed cycle facts above are unaffected.
          - paragraph [ref=e276]: Descriptive evidence. No stock recommendation, sizing or execution authority.
  - alert [ref=e277]
```

# Test source

```ts
  1   | import { test, expect, type Locator } from "@playwright/test";
  2   | 
  3   | /* Cycles lane e2e — the /dev/sector-cycles harness (deterministic inline
  4   |  * fixtures, no network, clearly labelled as fixture data on the page itself).
  5   |  *
  6   |  * Charter gate 4: keyboard and touch through family/phase/range/scale/leg
  7   |  * selection, chart↔table equivalence, capture→navigate→apply return, at
  8   |  * 1440×900, 820×1180 and 390×844 (desktop/tablet/mobile), light+dark, EN+ZH.
  9   |  * The self-bound return router is exercised for real: leaving a subject
  10  |  * pushes its captured view onto the history entry being left; the browser
  11  |  * back button rebinds that subject (donor #10707 host contract) and the
  12  |  * two-phase codec restores the captured fields. */
  13  | 
  14  | const cases = [
  15  |   ["en", "dark"],
  16  |   ["zh", "light"],
  17  | ] as const;
  18  | 
  19  | const T = (lang: "en" | "zh") => ({
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
> 85  |   }, { message: "SVG coordinates must follow the current measured content width" }).toBeLessThanOrEqual(1);
      |                                                                                     ^ Error: SVG coordinates must follow the current measured content width
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
  105 |       const initial = await expectMeasuredPlot(svg);
  106 |       const originalPanel = await panel.elementHandle();
  107 |       const contentHost = await svg.locator("..").locator("..").elementHandle();
  108 |       expect(originalPanel).not.toBeNull();
  109 |       expect(contentHost).not.toBeNull();
  110 | 
  111 |       const observation = page.getByTestId("cycle-observation");
  112 |       if (transition === "table") {
  113 |         await panel.getByLabel(L.obs).focus();
  114 |         await page.keyboard.press("Home");
  115 |       }
  116 |       const date = (await observation.locator("time").textContent())!.trim();
  117 |       const value = (await observation.locator("strong").first().textContent())!.trim();
  118 |       const selectFamily = async (label: string) => {
  119 |         if (initialViewport.width >= 641 && initialViewport.width <= 980) {
  120 |           await page.getByTestId("sector-cycle-lens").getByRole("button", { name: L.changeSeries, exact: true }).click();
  121 |           const sheet = page.getByRole("dialog");
  122 |           await expect(sheet).toBeVisible();
  123 |           await sheet.getByRole("button", { name: label, exact: true }).click();
  124 |           await expect(sheet).toBeHidden();
  125 |         } else {
  126 |           await page.getByTestId("cycle-phase-rail").getByRole("tab", { name: label }).click();
  127 |         }
  128 |       };
  129 | 
  130 |       if (transition === "table") {
  131 |         await panel.getByRole("button", { name: L.table, exact: true }).click();
  132 |         const row = panel.locator(`table tbody tr:has(> th:text-is("${date}"))`).first();
  133 |         await expect(row.locator("td").first()).toHaveText(value);
  134 |       } else {
  135 |         await selectFamily(L.baskets);
  136 |         await expect(panel.getByRole("status")).toBeVisible();
  137 |       }
  138 |       await expect(svg).toHaveCount(0);
  139 |       await page.setViewportSize({ ...initialViewport, width: widths[0] });
  140 |       expect(await originalPanel!.evaluate(node => node.isConnected)).toBe(true);
  141 |       expect(await contentHost!.evaluate(node => node.isConnected)).toBe(true);
  142 | 
  143 |       if (transition === "table") {
  144 |         await panel.getByRole("button", { name: L.chart, exact: true }).click();
  145 |       } else {
  146 |         await selectFamily(L.sectorsTab);
  147 |       }
  148 |       const restored = await expectMeasuredPlot(svg);
  149 |       expect(Math.abs(restored.container - initial.container)).toBeGreaterThan(1);
  150 |       expect(await svg.evaluate((node, original) => node.parentElement!.parentElement === original, contentHost)).toBe(true);
  151 |       expect(await panel.evaluate((node, original) => node === original, originalPanel)).toBe(true);
  152 |       await expect(observation.locator("time")).toHaveText(date);
  153 |       await expect(observation.locator("strong").first()).toHaveText(value);
  154 | 
  155 |       await page.setViewportSize({ ...initialViewport, width: widths[1] });
  156 |       await expectMeasuredPlot(svg);
  157 |       await page.setViewportSize(initialViewport);
  158 |       await expectMeasuredPlot(svg);
  159 |       await expect(observation.locator("time")).toHaveText(date);
  160 |       await expect(observation.locator("strong").first()).toHaveText(value);
  161 |       expect(await panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  162 |       await panel.screenshot({
  163 |         path: info.outputPath(`cycles-measurement-${transition}-${lang}-${info.project.name}.png`),
  164 |         animations: "disabled",
  165 |       });
  166 |     });
  167 |   }
  168 | 
  169 | 
  170 |   test(`cycles core journey ${lang} ${theme}`, async ({ page }, info) => {
  171 |     await page.goto("/dev/sector-cycles");
  172 |     await page.getByRole("radio", { name: lang === "zh" ? "ZH" : "EN", exact: true }).check();
  173 |     await page.getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true }).check();
  174 | 
  175 |     const lens = page.getByTestId("sector-cycle-lens");
  176 |     await expect(lens).toBeVisible();
  177 |     // Fixture honesty is visible on the harness itself.
  178 |     await expect(page.getByText(/Fixture data/)).toBeVisible();
  179 | 
  180 |     const rail = page.getByTestId("cycle-phase-rail");
  181 |     const panel = page.getByTestId("cycle-chart-panel");
  182 |     // R5-Y04 replaces the rail with the real picker only in the tablet band.
  183 |     const width = page.viewportSize()!.width;
  184 |     const usesPicker = width >= 641 && width <= 980;
  185 |     const heroTicker = page.getByTestId("cycle-hero").locator("h3 > b");
```