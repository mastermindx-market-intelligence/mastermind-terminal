# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: compare-settings-ux.spec.ts >> [en] comparison settings edit the real overlay without losing modal or saved state
- Location: e2e/compare-settings-ux.spec.ts:87:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - button "Menu" [ref=e4] [cursor=pointer]:
        - img [ref=e5]
      - generic:
        - img
        - generic: MASTERMIND
      - generic [ref=e7]:
        - button "Chart actions" [ref=e8] [cursor=pointer]:
          - img [ref=e9]
        - button "Mastermind AI" [ref=e11] [cursor=pointer]:
          - img [ref=e12]
        - button "Settings" [ref=e15] [cursor=pointer]: R
    - generic [ref=e16]:
      - button "Symbol search — NVDA" [ref=e17] [cursor=pointer]:
        - generic [ref=e18]:
          - generic [ref=e19]: "N"
          - generic [ref=e20]: NVDA
          - img [ref=e21]
        - generic [ref=e24]:
          - generic [ref=e25]: "192.53"
          - generic [ref=e26]: "-1.64%"
      - button "Upcoming events for this list" [ref=e27] [cursor=pointer]:
        - img [ref=e28]
    - generic [ref=e31]:
      - button "Fullscreen chart" [ref=e32] [cursor=pointer]:
        - img [ref=e33]
      - generic [ref=e36]:
        - button "Chart context" [ref=e37] [cursor=pointer]:
          - img [ref=e38]
          - text: Context
        - generic [ref=e42]:
          - button "D" [ref=e43] [cursor=pointer]
          - button "3D" [ref=e44] [cursor=pointer]
          - button "W" [ref=e45] [cursor=pointer]
          - button "1M" [ref=e46] [cursor=pointer]
          - button "Customize timeframes" [ref=e47] [cursor=pointer]:
            - img [ref=e48]
        - button "Candles ▾" [ref=e51] [cursor=pointer]:
          - img [ref=e52]
          - text: Candles
          - generic [ref=e54]: ▾
        - button "Indicators" [ref=e55] [cursor=pointer]:
          - img [ref=e56]
          - text: Indicators
        - button "More" [ref=e59] [cursor=pointer]:
          - img [ref=e60]
          - generic [ref=e64]: More
      - generic [ref=e65]:
        - toolbar "Drawing tools" [ref=e66]:
          - button "Cursor" [pressed] [ref=e67] [cursor=pointer]:
            - img [ref=e68]
          - generic [ref=e71]:
            - button "Trend line, Alt+T" [ref=e72] [cursor=pointer]:
              - img [ref=e73]
            - button "Open Lines, channels & pitchforks tools" [ref=e75] [cursor=pointer]:
              - img [ref=e76]
          - generic [ref=e78]:
            - button "Fibonacci retracement, Alt+F" [ref=e79] [cursor=pointer]:
              - img [ref=e80]
            - button "Open Fibonacci & Gann tools" [ref=e82] [cursor=pointer]:
              - img [ref=e83]
          - generic [ref=e85]:
            - button "XABCD pattern" [ref=e86] [cursor=pointer]:
              - img [ref=e87]
            - button "Open Patterns, Elliott waves & cycles tools" [ref=e89] [cursor=pointer]:
              - img [ref=e90]
          - generic [ref=e92]:
            - button "Long position" [ref=e93] [cursor=pointer]:
              - img [ref=e94]
            - button "Open Forecasting, volume & ranges tools" [ref=e96] [cursor=pointer]:
              - img [ref=e97]
          - generic [ref=e99]:
            - button "Brush" [ref=e100] [cursor=pointer]:
              - img [ref=e101]
            - button "Open Freehand tools" [ref=e103] [cursor=pointer]:
              - img [ref=e104]
          - generic [ref=e106]:
            - button "Rectangle, Alt+Shift+R" [ref=e107] [cursor=pointer]:
              - img [ref=e108]
            - button "Open Shapes & curves tools" [ref=e110] [cursor=pointer]:
              - img [ref=e111]
          - generic [ref=e113]:
            - button "Arrow marker" [ref=e114] [cursor=pointer]:
              - img [ref=e115]
            - button "Open Arrows tools" [ref=e117] [cursor=pointer]:
              - img [ref=e118]
          - generic [ref=e120]:
            - button "Text, Alt+X" [ref=e121] [cursor=pointer]:
              - img [ref=e122]
            - button "Open Text, notes & labels tools" [ref=e124] [cursor=pointer]:
              - img [ref=e125]
          - generic [ref=e127]:
            - button "Emoji" [ref=e128] [cursor=pointer]:
              - img [ref=e129]
            - button "Open Emoji & icons tools" [ref=e131] [cursor=pointer]:
              - img [ref=e132]
          - button "Keep drawing active" [ref=e134] [cursor=pointer]:
            - img [ref=e135]
          - generic [ref=e137]:
            - 'button "Magnet mode: Off" [ref=e138] [cursor=pointer]':
              - img [ref=e139]
            - button "Open magnet modes" [ref=e141] [cursor=pointer]:
              - img [ref=e142]
          - group "Drawing history" [ref=e144]:
            - button "Undo drawing change" [disabled] [ref=e145]:
              - img [ref=e146]
            - button "Redo drawing change" [disabled] [ref=e148]:
              - img [ref=e149]
          - button "Lock 0 drawings" [disabled] [ref=e151]:
            - img [ref=e152]
          - button "Hide 0 drawings" [ref=e154] [cursor=pointer]:
            - img [ref=e155]
          - button "Remove drawings, 0 drawings" [ref=e158] [cursor=pointer]:
            - img [ref=e159]
            - generic [ref=e161]: "0"
          - button "Hide favorites (0)" [disabled] [ref=e163] [cursor=pointer]:
            - img [ref=e164]
        - generic [ref=e167]:
          - region "Comparison anchor and basis" [ref=e168]:
            - generic [ref=e169]:
              - generic [ref=e170]: Comparison anchor
              - list "Auto · each line starts at its first session in common with NVDA" [ref=e171]:
                - listitem [ref=e172]:
                  - generic [ref=e174]: AAPL
                  - generic [ref=e175]: raw scale
              - button "Anchor & basis" [ref=e176] [cursor=pointer]
          - generic [ref=e177]:
            - generic:
              - generic:
                - generic:
                  - generic:
                    - generic: "N"
                  - generic: NVIDIA Corp · 3D · Equities
                - generic:
                  - generic:
                    - generic: O
                    - generic: "200.12"
                    - generic: H
                    - generic: "201.67"
                    - generic: L
                    - generic: "191.22"
                    - generic: C
                    - generic: "192.53"
                  - generic: "-7.51 (-3.75%)"
            - table [ref=e180]:
              - row [ref=e181]:
                - cell
                - cell [ref=e182]
                - cell [ref=e186]
              - row [ref=e190]:
                - cell [ref=e191]
              - row [ref=e193]:
                - cell
                - cell [ref=e194]
                - cell [ref=e198]
              - row [ref=e202]:
                - cell [ref=e203]
              - row [ref=e205]:
                - cell
                - cell [ref=e206]
                - cell [ref=e210]
              - row [ref=e214]:
                - cell
                - cell [ref=e215]
                - cell [ref=e219]
            - generic:
              - generic:
                - generic:
                  - group "Moving Averages" [ref=e222]:
                    - button "Moving Averages" [ref=e223]
                  - group "Volume" [ref=e224]:
                    - button "Volume" [ref=e225]
                  - group "TW · Mastermind Candles" [ref=e226]:
                    - button "TW · Mastermind Candles" [ref=e227]
                  - group "AAPL" [ref=e228]:
                    - button "AAPL" [ref=e229]
                  - button "6" [ref=e230] [cursor=pointer]:
                    - img [ref=e231]
                    - generic [ref=e233]: "6"
              - group "Stochastic RSI" [ref=e234]:
                - button "Stochastic RSI" [ref=e235]
              - group "MACD-RSI" [ref=e236]:
                - button "MACD-RSI" [ref=e237]
            - img
            - img
            - img
            - generic:
              - generic: NVDA
              - generic:
                - generic: "192.53"
                - generic: 00:00
            - generic: "221.81"
          - generic [ref=e238]:
            - generic [ref=e239]:
              - button "1D" [ref=e240] [cursor=pointer]
              - button "5D" [ref=e241] [cursor=pointer]
              - button "1M" [ref=e242] [cursor=pointer]
              - button "3M" [ref=e243] [cursor=pointer]
              - button "6M" [ref=e244] [cursor=pointer]
              - button "YTD" [ref=e245] [cursor=pointer]
              - button "1Y" [ref=e246] [cursor=pointer]
              - button "5Y" [ref=e247] [cursor=pointer]
              - button "All" [ref=e248] [cursor=pointer]
              - button "Go to date" [ref=e250] [cursor=pointer]:
                - img [ref=e251]
            - generic [ref=e254]:
              - generic [ref=e255]: 08:52:55 UTC-8
              - button "Extended trading hours" [disabled]: ETH
              - button "Data origin for this chart" [ref=e257] [cursor=pointer]: BASIS?
              - generic "Trading currency unavailable" [ref=e258] [cursor=pointer]: CCY?
              - button "Quick settings" [ref=e260] [cursor=pointer]:
                - img [ref=e261]
    - complementary [ref=e264]:
      - generic [ref=e266]:
        - button "Review Default 6 symbols, one at a time, in the current order" [ref=e267] [cursor=pointer]:
          - img [ref=e268]
          - generic [ref=e270]:
            - generic [ref=e271]: Review Default
            - generic [ref=e272]: 6 symbols, one at a time, in the current order
        - tablist "Rail source" [ref=e273]:
          - tab "Portfolio" [ref=e274] [cursor=pointer]
          - tab "Watchlists" [selected] [ref=e275] [cursor=pointer]
          - tab "News" [ref=e276] [cursor=pointer]
        - generic [ref=e277]:
          - generic [ref=e278]:
            - generic [ref=e280]: "N"
            - generic [ref=e281]:
              - generic [ref=e282]: NVIDIA Corp
              - generic [ref=e283]: NVDA · Equities
            - button "Open full analysis" [ref=e284] [cursor=pointer]:
              - img [ref=e285]
            - generic [ref=e287]:
              - generic [ref=e288]: "192.53"
              - generic [ref=e289]: "-1.64%"
          - generic [ref=e290]:
            - generic [ref=e291]:
              - button "Open Intelligence workspace" [ref=e292] [cursor=pointer]:
                - generic [ref=e293]:
                  - generic [ref=e294]:
                    - img [ref=e295]
                    - text: Intelligence
                  - img [ref=e298]
                - generic [ref=e300]:
                  - generic [ref=e301]:
                    - generic [ref=e302]: Oracle
                    - generic [ref=e303]: Uptrend — no entry signal
                    - generic [ref=e304]: "Historical signal: Structure stop · Signal date unverified"
                  - generic [ref=e305]:
                    - generic [ref=e306]: Research
                    - generic [ref=e307]: No current reading
                    - generic [ref=e308]: View details
                - generic [ref=e309]:
                  - generic [ref=e310]: Prophet
                  - generic [ref=e311]: Sign in to view
                - generic [ref=e313]: Oracle entry unverified · No current data
              - generic [ref=e315]:
                - generic [ref=e316]: Trend
                - generic [ref=e317]: Uptrend
                - generic [ref=e318]: weeks–months
            - region "Watchlists" [ref=e319]:
              - generic [ref=e320]:
                - generic [ref=e321]: Watchlists
                - combobox "Watchlists" [ref=e322]:
                  - option "Default" [selected]
              - button "Import CSV" [ref=e323] [cursor=pointer]
              - button "Export CSV" [ref=e324] [cursor=pointer]
            - generic [ref=e325]:
              - generic [ref=e326]:
                - img [ref=e327]
                - generic [ref=e329]: Deep analysis coming online
                - generic [ref=e330]: This name isn't in the research desk yet — the chart, levels and oracle verdict above are live.
              - generic [ref=e331]:
                - generic [ref=e333]: Key stats
                - generic [ref=e334]:
                  - generic [ref=e335]:
                    - generic [ref=e336]: Volume
                    - generic [ref=e337]: 179.30 M
                  - generic [ref=e338]:
                    - generic [ref=e339]: Avg volume (30D)
                    - generic [ref=e340]: 170.09 M
              - generic [ref=e341]:
                - generic [ref=e343]: Performance
                - generic [ref=e344]:
                  - generic [ref=e345]:
                    - generic [ref=e346]: "-8.62%"
                    - generic [ref=e347]: 1W
                  - generic [ref=e348]:
                    - generic [ref=e349]: "-9.44%"
                    - generic [ref=e350]: 1M
                  - generic [ref=e351]:
                    - generic [ref=e352]: +12.43%
                    - generic [ref=e353]: 3M
                  - generic [ref=e354]:
                    - generic [ref=e355]: +1.75%
                    - generic [ref=e356]: 6M
                  - generic [ref=e357]:
                    - generic [ref=e358]: +3.23%
                    - generic [ref=e359]: YTD
                  - generic [ref=e360]:
                    - generic [ref=e361]: +24.77%
                    - generic [ref=e362]: 1Y
              - generic [ref=e363]:
                - generic [ref=e365]: Technicals
                - generic [ref=e366]:
                  - img "23 of 100" [ref=e367]:
                    - generic [ref=e368]:
                      - img [ref=e369]
                      - generic:
                        - generic: "23"
                        - generic: Strong sell
                  - generic [ref=e373]:
                    - generic [ref=e374]: Sell 17
                    - generic [ref=e375]: Neutral 7
                    - generic [ref=e376]: Buy 2
                - button "More technicals ›" [ref=e377] [cursor=pointer]
              - generic [ref=e378]:
                - generic [ref=e379]:
                  - generic [ref=e380]: Realized volatility
                  - generic [ref=e381]: Historical prices · IV unavailable
                - generic [ref=e383]:
                  - img [ref=e385]:
                    - generic [ref=e387]: 35%
                    - generic [ref=e389]: 40%
                    - generic [ref=e391]: 45%
                    - generic [ref=e393]: 50%
                    - generic [ref=e395]: 55%
                  - generic [ref=e418]:
                    - generic [ref=e419]: 10d
                    - generic [ref=e420]: 21d
                    - generic [ref=e421]: 42d
                    - generic [ref=e422]: 63d
                    - generic [ref=e423]: 126d
                    - generic [ref=e424]: 252d
                  - generic [ref=e425]:
                    - generic [ref=e426]: Current
                    - generic [ref=e428]: Median
              - region "Seasonality view context" [ref=e431]:
                - group "Linking for this view" [ref=e432]:
                  - button "Follow chart" [pressed] [ref=e433] [cursor=pointer]
                  - button "Pin this view" [ref=e434] [cursor=pointer]
                  - button "Unlink" [ref=e435] [cursor=pointer]
                - status [ref=e436]: "Following chart: NVDA"
                - paragraph [ref=e437]: Linking applies to this session only.
                - generic [ref=e438]:
                  - generic [ref=e439]:
                    - img [ref=e440]
                    - text: Seasonality · avg monthly return
                    - generic [ref=e443]: 10y
                  - radiogroup "Seasonality · avg monthly return" [ref=e444]:
                    - radio "Jan · +6.6% avg · WR 60% · n=5" [ref=e445] [cursor=pointer]:
                      - generic [ref=e448]: J
                    - radio "Feb · +8.7% avg · WR 60% · n=5" [ref=e449] [cursor=pointer]:
                      - generic [ref=e452]: F
                    - radio "Mar · +6.2% avg · WR 60% · n=5" [ref=e453] [cursor=pointer]:
                      - generic [ref=e456]: M
                    - radio "Apr · -4.3% avg · WR 40% · n=5" [ref=e457] [cursor=pointer]:
                      - generic [ref=e460]: A
                    - radio "May · +18.8% avg · WR 100% · n=5" [ref=e461] [cursor=pointer]:
                      - generic [ref=e464]: M
                    - radio "Jun · +2.8% avg · WR 60% · n=5" [ref=e465] [cursor=pointer]:
                      - generic [ref=e468]: J
                    - radio "Jul · +7.0% avg · WR 60% · n=5" [ref=e469] [cursor=pointer]:
                      - generic [ref=e472]: J
                    - radio "Aug · +0.7% avg · WR 60% · n=5" [ref=e473] [cursor=pointer]:
                      - generic [ref=e476]: A
                    - radio "Sep · -6.0% avg · WR 40% · n=5" [ref=e477] [cursor=pointer]:
                      - generic [ref=e480]: S
                    - radio "Oct · +9.2% avg · WR 80% · n=5" [ref=e481] [cursor=pointer]:
                      - generic [ref=e484]: O
                    - radio "Nov · +11.9% avg · WR 80% · n=5" [checked] [ref=e485] [cursor=pointer]:
                      - generic [ref=e488]: "N"
                    - radio "Dec · -3.0% avg · WR 40% · n=5" [ref=e489] [cursor=pointer]:
                      - generic [ref=e492]: D
                  - generic [ref=e493]:
                    - combobox "Seasonality · avg monthly return · Jan–Dec" [ref=e494]:
                      - option "Jan"
                      - option "Feb"
                      - option "Mar"
                      - option "Apr"
                      - option "May"
                      - option "Jun"
                      - option "Jul"
                      - option "Aug"
                      - option "Sep"
                      - option "Oct"
                      - option "Nov" [selected]
                      - option "Dec"
                    - status [ref=e495]: Nov · +11.9% avg · WR 80% · n=5
                  - generic [ref=e496]: Current month highlighted · from NVDA history (display-only context).
                  - button "More seasonals ›" [ref=e497] [cursor=pointer]
            - generic [ref=e498]:
              - button "Open full analysis" [ref=e499] [cursor=pointer]
              - button "Ask Mastermind AI about NVDA →" [ref=e500] [cursor=pointer]
  - alert [ref=e501]
```

# Test source

```ts
  1   | import { expect, test, type Page, type TestInfo } from "@playwright/test";
  2   | 
  3   | async function capture(page: Page, info: TestInfo, name: string) {
  4   |   const path = info.outputPath(name + ".png");
  5   |   await page.screenshot({ path });
  6   |   await info.attach(name, { path, contentType: "image/png" });
  7   | }
  8   | 
  9   | async function openSettings(page: Page, touch: boolean) {
  10  |   const row = page.locator(".lg-row.is-cmp").filter({ hasText: "AAPL" }).first();
  11  |   await expect(row).toBeAttached();
  12  |   const expand = page.getByTitle(/^(Show indicator list|展开指标列表)$/).first();
  13  |   if (await expand.count()) await expand.click();
  14  |   await expect(row).toBeVisible();
  15  |   if (touch) await row.locator(".lg-name").tap(); else await row.hover();
  16  |   const settings = row.getByRole("button", { name: /^(Settings|设置)$/ });
  17  |   if (touch) await settings.tap(); else await settings.click();
  18  |   const dialog = page.getByRole("dialog", { name: "AAPL", exact: true });
  19  |   await expect(dialog).toBeVisible();
  20  |   return dialog;
  21  | }
  22  | 
  23  | async function addComparison(page: Page, width: number, info: TestInfo) {
  24  |   await page.goto("/terminal?symbol=NVDA");
  25  |   await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  26  |   await expect(page.locator(".lg-row.is-cmp")).toHaveCount(0);
  27  |   if (width > 860) {
  28  |     await page.locator(".cmp-btn").first().click();
  29  |   } else if (width <= 640) {
  30  |     await page.getByTestId("roller-more").tap();
  31  |     await page.getByTestId("hub-tile-compare").tap();
  32  |     await expect(page.getByTestId("hub-tile-compare")).not.toBeVisible();
  33  |   } else {
  34  |     await page.getByTestId("toolbar-more").tap();
  35  |     const compare = page.locator('[data-toolbar-menu-action="compare"]');
  36  |     await expect(compare).toBeVisible();
  37  |     const rect = await compare.boundingBox();
  38  |     expect(rect!.height).toBeGreaterThanOrEqual(44);
  39  |     await capture(page, info, "compare-entry");
  40  |     await compare.tap();
  41  |     await expect(page.locator("#chart-toolbar-overflow")).not.toBeVisible();
  42  |   }
  43  |   const picker = page.locator(".smodal-cmp");
  44  |   await expect(picker).toBeVisible();
  45  |   await picker.getByRole("combobox").fill("AAPL");
  46  |   await expect(picker.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
  47  |   const row = picker.locator(".r").filter({ has: page.locator(".tk", { hasText: /^AAPL$/ }) });
  48  |   await expect(row).toHaveCount(1);
  49  |   await row.getByRole("option").click();
  50  |   const percent = row.getByRole("button", { name: /^(Percent|百分比)$/ });
  51  |   await expect(percent).toBeEnabled();
  52  |   await percent.click();
  53  |   await picker.getByRole("button", { name: /^(Close comparison|关闭对比)$/ }).click();
  54  |   await expect(picker).toHaveCount(0);
  55  |   await expect(page.locator(".lg-row.is-cmp").filter({ hasText: "AAPL" })).toHaveCount(1);
  56  | }
  57  | 
  58  | async function returnFocus(page: Page, info: TestInfo, label: string) {
  59  |   const state = () => page.evaluate(() => {
  60  |     const active = document.activeElement;
  61  |     const element = active instanceof HTMLElement ? active : null;
  62  |     const row = element?.closest(".lg-row.is-cmp");
  63  |     const relevant = Boolean(element && (
  64  |       (row && row.textContent?.includes("AAPL")) ||
  65  |       element.matches(".cmp-btn, .lg-collapse")
  66  |     ));
  67  |     return {
  68  |       connected: element?.isConnected ?? false,
  69  |       visible: Boolean(element?.getClientRects().length),
  70  |       relevant,
  71  |       tag: element?.tagName ?? null,
  72  |       className: element?.className ?? null,
  73  |       label: element?.getAttribute("aria-label") ?? null,
  74  |     };
  75  |   });
  76  |   try {
  77  |     await expect.poll(async () => {
  78  |       const value = await state();
  79  |       return value.connected && value.visible && value.relevant;
> 80  |     }).toBe(true);
      |        ^ Error: expect(received).toBe(expected) // Object.is equality
  81  |   } finally {
  82  |     await info.attach(label, { body: JSON.stringify(await state(), null, 2), contentType: "application/json" });
  83  |   }
  84  | }
  85  | 
  86  | for (const lang of ["en", "zh"] as const) {
  87  |   test(`[${lang}] comparison settings edit the real overlay without losing modal or saved state`, async ({ page }, info) => {
  88  |     await page.addInitScript((language) => localStorage.setItem("mm.lang", language), lang);
  89  |     const errors: string[] = [];
  90  |     page.on("pageerror", (error) => errors.push(error.message));
  91  |     const width = page.viewportSize()!.width;
  92  |     await addComparison(page, width, info);
  93  |     const dialog = await openSettings(page, width <= 860);
  94  |     expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  95  |     await expect(dialog).toBeFocused();
  96  |     const thickness = dialog.getByRole("spinbutton", { name: /^(Thickness|粗细)$/ });
  97  |     const previous = await thickness.inputValue();
  98  |     await thickness.fill(""); await expect(thickness).toHaveValue("");
  99  |     await thickness.press("Tab"); await expect(thickness).toHaveValue(previous);
  100 |     await thickness.fill("9"); await expect(thickness).toHaveValue("9");
  101 |     await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL?.lineWidth ?? 2)).toBe(Number(previous));
  102 |     await thickness.press("Enter"); await expect(thickness).toHaveValue("4");
  103 |     const increase = dialog.getByRole("button", { name: /^(Increase thickness|增大粗细)$/ });
  104 |     await expect(increase).toBeDisabled();
  105 |     await dialog.getByRole("button", { name: /^(Dashed|虚线)$/ }).click();
  106 |     await dialog.getByRole("button", { name: /^(Price|价格)$/ }).click();
  107 |     await dialog.getByRole("button", { name: /^(Color|颜色): #26c281$/ }).click();
  108 |     await expect(dialog.locator('input[type="color"]')).toHaveValue("#26c281");
  109 |     await expect(dialog.locator("code")).toHaveText("#26C281");
  110 |     const saved = { color: "#26c281", lineWidth: 4, lineStyle: 2, mode: "price" };
  111 |     await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL)).toEqual(saved);
  112 |     for (const button of await dialog.getByRole("button").all()) {
  113 |       const rect = await button.boundingBox(); expect(rect).not.toBeNull();
  114 |       if (width <= 860) {
  115 |         expect(rect!.width).toBeGreaterThanOrEqual(44);
  116 |         expect(rect!.height).toBeGreaterThanOrEqual(44);
  117 |       }
  118 |       expect(await button.evaluate((element) => {
  119 |         const r = element.getBoundingClientRect();
  120 |         return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  121 |       })).toBe(true);
  122 |     }
  123 |     const close = dialog.getByRole("button", { name: /^(Close|关闭)$/ });
  124 |     const done = dialog.getByRole("button", { name: /^(Done|完成)$/ });
  125 |     await close.focus(); await page.keyboard.press("Shift+Tab"); await expect(done).toBeFocused();
  126 |     await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  127 |     await capture(page, info, "comparison-settings");
  128 |     await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  129 |     await returnFocus(page, info, "escape-return-focus");
  130 |     const reopened = await openSettings(page, width <= 860);
  131 |     await expect(reopened.getByRole("spinbutton")).toHaveValue("4");
  132 |     await expect(reopened.getByRole("button", { name: /^(Dashed|虚线)$/ })).toHaveAttribute("aria-pressed", "true");
  133 |     await reopened.getByRole("button", { name: /^(Done|完成)$/ }).click();
  134 |     await expect(reopened).toHaveCount(0);
  135 |     await returnFocus(page, info, "done-return-focus");
  136 |     const finalDialog = await openSettings(page, width <= 860);
  137 |     await finalDialog.getByRole("button", { name: /^(Close|关闭)$/ }).click();
  138 |     await expect(finalDialog).toHaveCount(0);
  139 |     await returnFocus(page, info, "close-return-focus");
  140 |     await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL)).toEqual(saved);
  141 |     expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  142 |     expect(errors).toEqual([]);
  143 |   });
  144 | }
  145 | 
```