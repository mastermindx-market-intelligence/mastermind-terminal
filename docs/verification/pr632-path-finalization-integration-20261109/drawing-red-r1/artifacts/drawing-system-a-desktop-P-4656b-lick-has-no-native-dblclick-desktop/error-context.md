# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: drawing-system.spec.ts >> a desktop Path finishes exactly once when its closing double-click has no native dblclick
- Location: e2e/drawing-system.spec.ts:2967:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.settings-open')
Expected: 0
Received: 1
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('.settings-open')
    14 × locator resolved to 1 element
       - unexpected value "1"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - img [ref=e5]
        - generic [ref=e9]:
          - generic [ref=e10]: MASTERMIND
          - generic [ref=e11]: TERMINAL
      - button "Symbol search — NVDA" [ref=e13] [cursor=pointer]:
        - generic [ref=e14]:
          - generic [ref=e15]: "N"
          - generic [ref=e16]: $
        - generic [ref=e17]: NVDA
        - img [ref=e18]
      - button "Compare" [ref=e20] [cursor=pointer]:
        - img [ref=e21]
        - generic [ref=e23]: Compare
      - generic [ref=e24]:
        - generic [ref=e25]:
          - generic [ref=e26]: Last Price
          - generic [ref=e27]: "192.53"
        - generic [ref=e28]:
          - generic [ref=e29]: 24h Change
          - generic [ref=e30]: "-1.64%"
        - generic [ref=e31]:
          - generic [ref=e32]: Volume
          - generic [ref=e33]: 179.3M
        - generic "Day Range" [ref=e34]:
          - generic [ref=e35]:
            - generic [ref=e36]: Day Range
            - generic [ref=e37]: "192.53"
          - generic "Open" [ref=e40]
          - generic [ref=e42]:
            - generic [ref=e43]:
              - emphasis [ref=e44]: L
              - generic [ref=e45]: "191.22"
            - generic [ref=e46]:
              - generic [ref=e47]: "195.55"
              - emphasis [ref=e48]: H
      - generic "Market closed — last session" [ref=e49]: Historical
      - button "Chart actions" [ref=e51] [cursor=pointer]:
        - img [ref=e52]
        - generic [ref=e54]:
          - text: Actions
          - generic [ref=e55]: ">"
      - button "Mastermind AI" [ref=e56] [cursor=pointer]:
        - img [ref=e57]
        - text: Mastermind AI
      - button "Settings" [ref=e59] [cursor=pointer]: R
    - navigation "Primary" [ref=e60]:
      - link "Chart" [ref=e61] [cursor=pointer]:
        - /url: /terminal
        - img [ref=e62]
      - link "Analysis" [ref=e64] [cursor=pointer]:
        - /url: /analysis?symbol=NVDA
        - img [ref=e65]
      - link "Discover" [ref=e67] [cursor=pointer]:
        - /url: /discover
        - img [ref=e68]
      - link "Dislocations" [ref=e73] [cursor=pointer]:
        - /url: /dislocations
        - img [ref=e74]
      - link "Options" [ref=e75] [cursor=pointer]:
        - /url: /options
        - img [ref=e76]
      - link "Scripts" [ref=e79] [cursor=pointer]:
        - /url: /scripts
        - img [ref=e80]
      - link "Portfolio" [ref=e84] [cursor=pointer]:
        - /url: /portfolio
        - img [ref=e85]
      - link "Alerts" [ref=e87] [cursor=pointer]:
        - /url: /alerts
        - img [ref=e88]
      - button "Mastermind AI" [ref=e91] [cursor=pointer]:
        - img [ref=e92]
    - generic [ref=e94]:
      - generic [ref=e96]:
        - button "Chart context" [ref=e97] [cursor=pointer]:
          - img [ref=e98]
          - text: Context
        - generic [ref=e102]:
          - button "D" [ref=e103] [cursor=pointer]
          - button "3D" [ref=e104] [cursor=pointer]
          - button "W" [ref=e105] [cursor=pointer]
          - button "1M" [ref=e106] [cursor=pointer]
          - button "Customize timeframes" [ref=e107] [cursor=pointer]:
            - img [ref=e108]
        - button "Candles ▾" [ref=e111] [cursor=pointer]:
          - img [ref=e112]
          - text: Candles
          - generic [ref=e114]: ▾
        - button "Indicators" [ref=e115] [cursor=pointer]:
          - img [ref=e116]
          - text: Indicators
        - button "MTF" [ref=e118] [cursor=pointer]:
          - img [ref=e119]
          - text: MTF
        - button "More" [ref=e122] [cursor=pointer]:
          - img [ref=e123]
          - generic [ref=e127]: More
      - generic [ref=e128]:
        - toolbar "Drawing tools" [ref=e129]:
          - button "Cursor" [pressed] [ref=e130] [cursor=pointer]:
            - img [ref=e131]
          - generic [ref=e134]:
            - button "Trend line, Alt+T" [ref=e135] [cursor=pointer]:
              - img [ref=e136]
            - button "Open Lines, channels & pitchforks tools" [ref=e138] [cursor=pointer]:
              - img [ref=e139]
          - generic [ref=e141]:
            - button "Fibonacci retracement, Alt+F" [ref=e142] [cursor=pointer]:
              - img [ref=e143]
            - button "Open Fibonacci & Gann tools" [ref=e145] [cursor=pointer]:
              - img [ref=e146]
          - generic [ref=e148]:
            - button "XABCD pattern" [ref=e149] [cursor=pointer]:
              - img [ref=e150]
            - button "Open Patterns, Elliott waves & cycles tools" [ref=e152] [cursor=pointer]:
              - img [ref=e153]
          - generic [ref=e155]:
            - button "Long position" [ref=e156] [cursor=pointer]:
              - img [ref=e157]
            - button "Open Forecasting, volume & ranges tools" [ref=e159] [cursor=pointer]:
              - img [ref=e160]
          - generic [ref=e162]:
            - button "Path" [ref=e163] [cursor=pointer]:
              - img [ref=e164]
            - button "Open Freehand tools" [ref=e166] [cursor=pointer]:
              - img [ref=e167]
          - generic [ref=e169]:
            - button "Rectangle, Alt+Shift+R" [ref=e170] [cursor=pointer]:
              - img [ref=e171]
            - button "Open Shapes & curves tools" [ref=e173] [cursor=pointer]:
              - img [ref=e174]
          - generic [ref=e176]:
            - button "Arrow marker" [ref=e177] [cursor=pointer]:
              - img [ref=e178]
            - button "Open Arrows tools" [ref=e180] [cursor=pointer]:
              - img [ref=e181]
          - generic [ref=e183]:
            - button "Text, Alt+X" [ref=e184] [cursor=pointer]:
              - img [ref=e185]
            - button "Open Text, notes & labels tools" [ref=e187] [cursor=pointer]:
              - img [ref=e188]
          - generic [ref=e190]:
            - button "Emoji" [ref=e191] [cursor=pointer]:
              - img [ref=e192]
            - button "Open Emoji & icons tools" [ref=e194] [cursor=pointer]:
              - img [ref=e195]
          - button "Keep drawing active" [ref=e197] [cursor=pointer]:
            - img [ref=e198]
          - generic [ref=e200]:
            - 'button "Magnet mode: Strong magnet" [ref=e201] [cursor=pointer]':
              - img [ref=e202]
            - button "Open magnet modes" [ref=e204] [cursor=pointer]:
              - img [ref=e205]
          - group "Drawing history" [ref=e207]:
            - button "Undo drawing change" [ref=e208] [cursor=pointer]:
              - img [ref=e209]
            - button "Redo drawing change" [disabled] [ref=e211]:
              - img [ref=e212]
          - button "Lock 2 drawings" [ref=e214] [cursor=pointer]:
            - img [ref=e215]
          - button "Hide 2 drawings" [ref=e217] [cursor=pointer]:
            - img [ref=e218]
          - button "Remove drawings, 2 drawings" [ref=e221] [cursor=pointer]:
            - img [ref=e222]
            - generic [ref=e224]: "2"
          - button "Hide favorites (0)" [disabled] [ref=e226] [cursor=pointer]:
            - img [ref=e227]
        - generic [ref=e230]:
          - generic [ref=e231]:
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
            - table [ref=e234]:
              - row [ref=e235]:
                - cell
                - cell [ref=e236]
                - cell [ref=e240]
              - row [ref=e244]:
                - cell [ref=e245]
              - row [ref=e247]:
                - cell
                - cell [ref=e248]
                - cell [ref=e252]
              - row [ref=e256]:
                - cell [ref=e257]
              - row [ref=e259]:
                - cell
                - cell [ref=e260]
                - cell [ref=e264]
              - row [ref=e268]:
                - cell
                - cell [ref=e269]
                - cell [ref=e273]
            - generic:
              - generic:
                - generic:
                  - group "Moving Averages" [ref=e276]:
                    - generic [ref=e277]: Moving Averages
                    - generic: Hide Settings Source code Remove More
                  - group "Volume" [ref=e278]:
                    - generic [ref=e279]: Volume
                    - generic: Hide Settings Source code Remove More
                  - group "TW · Mastermind Candles" [ref=e280]:
                    - generic [ref=e281]: TW · Mastermind Candles
                    - generic: Hide Settings Remove More
                  - button "Minimize indicator list" [ref=e282] [cursor=pointer]:
                    - img [ref=e283]
              - group "Stochastic RSI" [ref=e285]:
                - generic [ref=e286]: Stochastic RSI
                - generic: Hide Settings Source code Remove More
              - group "MACD-RSI" [ref=e287]:
                - generic [ref=e288]: MACD-RSI
                - generic: Hide Settings Source code Remove More
            - img
            - img
            - img:
              - generic [ref=e293] [cursor=pointer]: 41 bars × +8.09 (+6.05%)
            - generic:
              - generic: NVDA
              - generic:
                - generic: "192.53"
                - generic: 00:00
            - toolbar "Selected drawing properties" [ref=e298]:
              - button "Drag properties" [ref=e299]: ⠿
              - generic [ref=e300]:
                - 'button "Color #4d82ff" [ref=e301] [cursor=pointer]'
                - 'button "Color #26c281" [ref=e302] [cursor=pointer]'
                - 'button "Color #f0566b" [ref=e303] [cursor=pointer]'
                - generic "Custom drawing color" [ref=e304] [cursor=pointer]:
                  - generic [ref=e306]: +
                  - textbox "Custom drawing color" [ref=e307]: "#4d82ff"
              - button "Use 1.5 pixel line width" [ref=e309] [cursor=pointer]
              - button "Use 2.5 pixel line width" [ref=e311] [cursor=pointer]
              - button "Use 4 pixel line width" [ref=e313] [cursor=pointer]
              - button "Solid" [ref=e316] [cursor=pointer]:
                - img [ref=e317]
              - button "Dashed" [ref=e318] [cursor=pointer]:
                - img [ref=e319]
              - button "Dotted" [ref=e320] [cursor=pointer]:
                - img [ref=e321]
              - button "Delete drawing" [ref=e323] [cursor=pointer]:
                - img [ref=e324]
              - button "Lock drawing" [ref=e326] [cursor=pointer]: ○
              - button "Duplicate drawing" [ref=e327] [cursor=pointer]: ⧉
              - button "More properties" [ref=e328] [cursor=pointer]: ⚙
              - generic [ref=e330]:
                - text: Opacity
                - slider "Opacity" [ref=e331]: "100"
          - generic [ref=e332]:
            - generic [ref=e333]:
              - button "1D" [ref=e334] [cursor=pointer]
              - button "5D" [ref=e335] [cursor=pointer]
              - button "1M" [ref=e336] [cursor=pointer]
              - button "3M" [ref=e337] [cursor=pointer]
              - button "6M" [ref=e338] [cursor=pointer]
              - button "YTD" [ref=e339] [cursor=pointer]
              - button "1Y" [ref=e340] [cursor=pointer]
              - button "5Y" [ref=e341] [cursor=pointer]
              - button "All" [ref=e342] [cursor=pointer]
              - button "Go to date" [ref=e344] [cursor=pointer]:
                - img [ref=e345]
            - generic [ref=e348]:
              - generic [ref=e349]: 10:34:19 UTC-8
              - button "Extended trading hours" [disabled]: ETH
              - button "Data origin for this chart" [ref=e351] [cursor=pointer]: BASIS?
              - generic "Trading currency unavailable" [ref=e352] [cursor=pointer]: CCY?
              - button "Quick settings" [ref=e354] [cursor=pointer]:
                - img [ref=e355]
    - separator "Resize sidebar" [ref=e358]
    - complementary [ref=e360]:
      - group "Options perspective" [ref=e361]:
        - button "Overview" [pressed] [ref=e362] [cursor=pointer]
        - button "Context" [ref=e363] [cursor=pointer]
        - button "Options heatmap" [ref=e364] [cursor=pointer]:
          - img [ref=e365]
          - text: Options
      - generic [ref=e368]:
        - tablist "Rail source" [ref=e369]:
          - tab "Portfolio" [ref=e370] [cursor=pointer]
          - tab "Watchlists" [selected] [ref=e371] [cursor=pointer]
          - tab "News" [ref=e372] [cursor=pointer]
        - tabpanel "Watchlists" [ref=e373]:
          - generic [ref=e374]:
            - button "Default" [ref=e375] [cursor=pointer]:
              - text: Default
              - img [ref=e376]
            - generic [ref=e378]:
              - button "Add symbol" [ref=e379] [cursor=pointer]:
                - img [ref=e380]
              - button "Upcoming events for this list" [ref=e382] [cursor=pointer]:
                - img [ref=e383]
              - button "Settings" [ref=e386] [cursor=pointer]:
                - img [ref=e387]
          - generic [ref=e391]:
            - generic [ref=e392]:
              - generic [ref=e393]:
                - text: Symbol
                - generic "Drag to resize column" [ref=e394]
              - generic [ref=e395]:
                - generic [ref=e396]: Last
                - generic "Drag to resize column" [ref=e397]
              - generic [ref=e398]:
                - generic [ref=e399]: Chg%
                - generic "Drag to resize column" [ref=e400]
              - generic [ref=e401]:
                - generic [ref=e402]: Ext
                - generic "Drag to resize column" [ref=e403]
              - generic [ref=e404]:
                - generic [ref=e405]: Ext %
                - generic "Drag to resize column" [ref=e406]
            - listbox "Watchlists" [ref=e407]:
              - generic: Drop above all sections
              - generic [ref=e408]:
                - generic [ref=e409]:
                  - button "Crypto 2" [expanded] [ref=e410] [cursor=pointer]:
                    - img [ref=e411]
                    - generic [ref=e413]: Crypto
                    - generic [ref=e414]: "2"
                  - button "Drag section Crypto" [ref=e415]:
                    - img [ref=e416]
                  - generic [ref=e423]:
                    - button "Rename section" [ref=e424] [cursor=pointer]:
                      - img [ref=e425]
                    - button "Remove section" [ref=e427] [cursor=pointer]:
                      - img [ref=e428]
                - option "Drag BTC-USD Flag this symbol BTC-USD 60,025.72 +0.35% — —" [ref=e430]:
                  - button "Drag BTC-USD" [ref=e431]:
                    - img [ref=e432]
                  - generic "Flag this symbol" [ref=e439] [cursor=pointer]
                  - generic [ref=e440]:
                    - generic [ref=e442]: B
                    - generic [ref=e444]: BTC-USD
                  - generic [ref=e445]: 60,025.72
                  - generic [ref=e446]: +0.35%
                  - generic [ref=e447]: —
                  - generic [ref=e448]: —
                  - generic "Remove" [ref=e449]:
                    - img [ref=e450]
                - option "Drag ETH-USD Flag this symbol ETH-USD 1,579.00 +0.72% — —" [ref=e452]:
                  - button "Drag ETH-USD" [ref=e453]:
                    - img [ref=e454]
                  - generic "Flag this symbol" [ref=e461] [cursor=pointer]
                  - generic [ref=e462]:
                    - generic [ref=e464]: E
                    - generic [ref=e466]: ETH-USD
                  - generic [ref=e467]: 1,579.00
                  - generic [ref=e468]: +0.72%
                  - generic [ref=e469]: —
                  - generic [ref=e470]: —
                  - generic "Remove" [ref=e471]:
                    - img [ref=e472]
              - generic [ref=e474]:
                - generic [ref=e475]:
                  - button "Equities 4" [expanded] [ref=e476] [cursor=pointer]:
                    - img [ref=e477]
                    - generic [ref=e479]: Equities
                    - generic [ref=e480]: "4"
                  - button "Drag section Equities" [ref=e481]:
                    - img [ref=e482]
                  - generic [ref=e489]:
                    - button "Rename section" [ref=e490] [cursor=pointer]:
                      - img [ref=e491]
                    - button "Remove section" [ref=e493] [cursor=pointer]:
                      - img [ref=e494]
                - option "Drag NVDA Flag this symbol NVDA 192.53 -1.64% — —" [ref=e496]:
                  - button "Drag NVDA" [ref=e497]:
                    - img [ref=e498]
                  - generic "Flag this symbol" [ref=e505] [cursor=pointer]
                  - generic [ref=e506]:
                    - generic [ref=e508]: "N"
                    - generic [ref=e510]: NVDA
                  - generic [ref=e511]: "192.53"
                  - generic [ref=e512]: "-1.64%"
                  - generic [ref=e513]: —
                  - generic [ref=e514]: —
                  - generic "Remove" [ref=e515]:
                    - img [ref=e516]
                - option "Drag AAPL Flag this symbol AAPL 283.78 +3.14% — —" [ref=e518]:
                  - button "Drag AAPL" [ref=e519]:
                    - img [ref=e520]
                  - generic "Flag this symbol" [ref=e527] [cursor=pointer]
                  - generic [ref=e528]:
                    - generic [ref=e530]: A
                    - generic [ref=e532]: AAPL
                  - generic [ref=e533]: "283.78"
                  - generic [ref=e534]: +3.14%
                  - generic [ref=e535]: —
                  - generic [ref=e536]: —
                  - generic "Remove" [ref=e537]:
                    - img [ref=e538]
                - option "Drag MSFT Flag this symbol MSFT 372.97 +5.71% — —" [ref=e540]:
                  - button "Drag MSFT" [ref=e541]:
                    - img [ref=e542]
                  - generic "Flag this symbol" [ref=e549] [cursor=pointer]
                  - generic [ref=e550]:
                    - generic [ref=e552]: M
                    - generic [ref=e554]: MSFT
                  - generic [ref=e555]: "372.97"
                  - generic [ref=e556]: +5.71%
                  - generic [ref=e557]: —
                  - generic [ref=e558]: —
                  - generic "Remove" [ref=e559]:
                    - img [ref=e560]
                - option "Drag QQQ Flag this symbol QQQ 706.52 -1.38% — —" [ref=e562]:
                  - button "Drag QQQ" [ref=e563]:
                    - img [ref=e564]
                  - generic "Flag this symbol" [ref=e571] [cursor=pointer]
                  - generic [ref=e572]:
                    - generic [ref=e574]: Q
                    - generic [ref=e576]: QQQ
                  - generic [ref=e577]: "706.52"
                  - generic [ref=e578]: "-1.38%"
                  - generic [ref=e579]: —
                  - generic [ref=e580]: —
                  - generic "Remove" [ref=e581]:
                    - img [ref=e582]
              - status [ref=e584]
        - generic [ref=e585]:
          - generic [ref=e586]:
            - generic [ref=e588]: "N"
            - generic [ref=e589]:
              - generic [ref=e590]: NVIDIA Corp
              - generic [ref=e591]: NVDA · Equities
            - button "Open full analysis" [ref=e592] [cursor=pointer]:
              - img [ref=e593]
            - generic [ref=e595]:
              - generic [ref=e596]: "192.53"
              - generic [ref=e597]: "-1.64%"
          - generic [ref=e598]:
            - generic [ref=e599]:
              - button "Open Intelligence workspace" [ref=e600] [cursor=pointer]:
                - generic [ref=e601]:
                  - generic [ref=e602]:
                    - img [ref=e603]
                    - text: Intelligence
                  - img [ref=e606]
                - generic [ref=e608]:
                  - generic [ref=e609]:
                    - generic [ref=e610]: Oracle
                    - generic [ref=e611]: Uptrend — no entry signal
                    - generic [ref=e612]: "Historical signal: Structure stop · Signal date unverified"
                  - generic [ref=e613]:
                    - generic [ref=e614]: Research
                    - generic [ref=e615]: No current reading
                    - generic [ref=e616]: View details
                - generic [ref=e617]:
                  - generic [ref=e618]: Prophet
                  - generic [ref=e619]: Sign in to view
                - generic [ref=e621]: Oracle entry unverified · No current data
              - generic [ref=e623]:
                - generic [ref=e624]: Trend
                - generic [ref=e625]: Uptrend
                - generic [ref=e626]: weeks–months
            - generic [ref=e627]:
              - generic [ref=e628]:
                - img [ref=e629]
                - generic [ref=e631]: Deep analysis coming online
                - generic [ref=e632]: This name isn't in the research desk yet — the chart, levels and oracle verdict above are live.
              - generic [ref=e633]:
                - generic [ref=e635]: Key stats
                - generic [ref=e636]:
                  - generic [ref=e637]:
                    - generic [ref=e638]: Volume
                    - generic [ref=e639]: 179.30 M
                  - generic [ref=e640]:
                    - generic [ref=e641]: Avg volume (30D)
                    - generic [ref=e642]: 170.09 M
              - generic [ref=e643]:
                - generic [ref=e645]: Performance
                - generic [ref=e646]:
                  - generic [ref=e647]:
                    - generic [ref=e648]: "-8.62%"
                    - generic [ref=e649]: 1W
                  - generic [ref=e650]:
                    - generic [ref=e651]: "-9.44%"
                    - generic [ref=e652]: 1M
                  - generic [ref=e653]:
                    - generic [ref=e654]: +12.43%
                    - generic [ref=e655]: 3M
                  - generic [ref=e656]:
                    - generic [ref=e657]: +1.75%
                    - generic [ref=e658]: 6M
                  - generic [ref=e659]:
                    - generic [ref=e660]: +3.23%
                    - generic [ref=e661]: YTD
                  - generic [ref=e662]:
                    - generic [ref=e663]: +24.77%
                    - generic [ref=e664]: 1Y
              - generic [ref=e665]:
                - generic [ref=e667]: Technicals
                - generic [ref=e668]:
                  - img "23 of 100" [ref=e669]:
                    - generic [ref=e670]:
                      - img [ref=e671]
                      - generic:
                        - generic: "23"
                        - generic: Strong sell
                  - generic [ref=e675]:
                    - generic [ref=e676]: Sell 17
                    - generic [ref=e677]: Neutral 7
                    - generic [ref=e678]: Buy 2
                - button "More technicals ›" [ref=e679] [cursor=pointer]
              - generic [ref=e680]:
                - generic [ref=e681]:
                  - generic [ref=e682]: Realized volatility
                  - generic [ref=e683]: Historical prices · IV unavailable
                - generic [ref=e685]:
                  - img [ref=e687]:
                    - generic [ref=e689]: 35%
                    - generic [ref=e691]: 40%
                    - generic [ref=e693]: 45%
                    - generic [ref=e695]: 50%
                    - generic [ref=e697]: 55%
                  - generic [ref=e720]:
                    - generic [ref=e721]: 10d
                    - generic [ref=e723]: 42d
                    - generic [ref=e726]: 252d
                  - generic [ref=e727]:
                    - generic [ref=e728]: Current
                    - generic [ref=e730]: Median
              - region "Seasonality view context" [ref=e733]:
                - group "Linking for this view" [ref=e734]:
                  - button "Follow chart" [pressed] [ref=e735] [cursor=pointer]
                  - button "Pin this view" [ref=e736] [cursor=pointer]
                  - button "Unlink" [ref=e737] [cursor=pointer]
                - status [ref=e738]: "Following chart: NVDA"
                - paragraph [ref=e739]: Linking applies to this session only.
                - generic [ref=e740]:
                  - generic [ref=e741]:
                    - img [ref=e742]
                    - text: Seasonality · avg monthly return
                    - generic [ref=e745]: 10y
                  - radiogroup "Seasonality · avg monthly return" [ref=e746]:
                    - radio "Jan · +6.6% avg · WR 60% · n=5" [ref=e747] [cursor=pointer]:
                      - generic [ref=e750]: J
                    - radio "Feb · +8.7% avg · WR 60% · n=5" [ref=e751] [cursor=pointer]:
                      - generic [ref=e754]: F
                    - radio "Mar · +6.2% avg · WR 60% · n=5" [ref=e755] [cursor=pointer]:
                      - generic [ref=e758]: M
                    - radio "Apr · -4.3% avg · WR 40% · n=5" [ref=e759] [cursor=pointer]:
                      - generic [ref=e762]: A
                    - radio "May · +18.8% avg · WR 100% · n=5" [ref=e763] [cursor=pointer]:
                      - generic [ref=e766]: M
                    - radio "Jun · +2.8% avg · WR 60% · n=5" [ref=e767] [cursor=pointer]:
                      - generic [ref=e770]: J
                    - radio "Jul · +7.0% avg · WR 60% · n=5" [ref=e771] [cursor=pointer]:
                      - generic [ref=e774]: J
                    - radio "Aug · +0.7% avg · WR 60% · n=5" [ref=e775] [cursor=pointer]:
                      - generic [ref=e778]: A
                    - radio "Sep · -6.0% avg · WR 40% · n=5" [ref=e779] [cursor=pointer]:
                      - generic [ref=e782]: S
                    - radio "Oct · +9.2% avg · WR 80% · n=5" [ref=e783] [cursor=pointer]:
                      - generic [ref=e786]: O
                    - radio "Nov · +11.9% avg · WR 80% · n=5" [checked] [ref=e787] [cursor=pointer]:
                      - generic [ref=e790]: "N"
                    - radio "Dec · -3.0% avg · WR 40% · n=5" [ref=e791] [cursor=pointer]:
                      - generic [ref=e794]: D
                  - generic [ref=e795]:
                    - combobox "Seasonality · avg monthly return · Jan–Dec" [ref=e796]:
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
                    - status [ref=e797]: Nov · +11.9% avg · WR 80% · n=5
                  - generic [ref=e798]: Current month highlighted · from NVDA history (display-only context).
                  - button "More seasonals ›" [ref=e799] [cursor=pointer]
            - generic [ref=e800]:
              - button "Open full analysis" [ref=e801] [cursor=pointer]
              - button "Ask Mastermind AI about NVDA →" [ref=e802] [cursor=pointer]
    - generic [ref=e803]:
      - generic [ref=e804]: Movers
      - generic [ref=e806]:
        - generic [ref=e807]:
          - generic [ref=e808] [cursor=pointer]:
            - generic [ref=e809]: NVDA
            - generic [ref=e810]: "192.53"
            - generic [ref=e811]: "-1.64%"
          - generic [ref=e812] [cursor=pointer]:
            - generic [ref=e813]: AAPL
            - generic [ref=e814]: "283.78"
            - generic [ref=e815]: +3.14%
          - generic [ref=e816] [cursor=pointer]:
            - generic [ref=e817]: MSFT
            - generic [ref=e818]: "372.97"
            - generic [ref=e819]: +5.71%
          - generic [ref=e820] [cursor=pointer]:
            - generic [ref=e821]: GOOGL
            - generic [ref=e822]: "337.39"
            - generic [ref=e823]: "-1.84%"
          - generic [ref=e824] [cursor=pointer]:
            - generic [ref=e825]: AMZN
            - generic [ref=e826]: "232.69"
            - generic [ref=e827]: +2.50%
          - generic [ref=e828] [cursor=pointer]:
            - generic [ref=e829]: META
            - generic [ref=e830]: "550.25"
            - generic [ref=e831]: +1.36%
          - generic [ref=e832] [cursor=pointer]:
            - generic [ref=e833]: TSLA
            - generic [ref=e834]: "379.71"
            - generic [ref=e835]: +1.22%
          - generic [ref=e836] [cursor=pointer]:
            - generic [ref=e837]: AMD
            - generic [ref=e838]: "521.58"
            - generic [ref=e839]: "-2.06%"
          - generic [ref=e840] [cursor=pointer]:
            - generic [ref=e841]: AVGO
            - generic [ref=e842]: "365.02"
            - generic [ref=e843]: "-3.67%"
          - generic [ref=e844] [cursor=pointer]:
            - generic [ref=e845]: NFLX
            - generic [ref=e846]: "73.81"
            - generic [ref=e847]: +4.10%
          - generic [ref=e848] [cursor=pointer]:
            - generic [ref=e849]: CRM
            - generic [ref=e850]: "158.37"
            - generic [ref=e851]: +5.45%
          - generic [ref=e852] [cursor=pointer]:
            - generic [ref=e853]: SMCI
            - generic [ref=e854]: "30.63"
            - generic [ref=e855]: "-3.31%"
          - generic [ref=e856] [cursor=pointer]:
            - generic [ref=e857]: ARM
            - generic [ref=e858]: "334.27"
            - generic [ref=e859]: "-3.87%"
          - generic [ref=e860] [cursor=pointer]:
            - generic [ref=e861]: PLTR
            - generic [ref=e862]: "112.93"
            - generic [ref=e863]: +5.28%
          - generic [ref=e864] [cursor=pointer]:
            - generic [ref=e865]: MSTR
            - generic [ref=e866]: "82.31"
            - generic [ref=e867]: "-3.54%"
          - generic [ref=e868] [cursor=pointer]:
            - generic [ref=e869]: MU
            - generic [ref=e870]: 1,132.33
            - generic [ref=e871]: "-6.69%"
        - generic [ref=e872]:
          - generic [ref=e873] [cursor=pointer]:
            - generic [ref=e874]: NVDA
            - generic [ref=e875]: "192.53"
            - generic [ref=e876]: "-1.64%"
          - generic [ref=e877] [cursor=pointer]:
            - generic [ref=e878]: AAPL
            - generic [ref=e879]: "283.78"
            - generic [ref=e880]: +3.14%
          - generic [ref=e881] [cursor=pointer]:
            - generic [ref=e882]: MSFT
            - generic [ref=e883]: "372.97"
            - generic [ref=e884]: +5.71%
          - generic [ref=e885] [cursor=pointer]:
            - generic [ref=e886]: GOOGL
            - generic [ref=e887]: "337.39"
            - generic [ref=e888]: "-1.84%"
          - generic [ref=e889] [cursor=pointer]:
            - generic [ref=e890]: AMZN
            - generic [ref=e891]: "232.69"
            - generic [ref=e892]: +2.50%
          - generic [ref=e893] [cursor=pointer]:
            - generic [ref=e894]: META
            - generic [ref=e895]: "550.25"
            - generic [ref=e896]: +1.36%
          - generic [ref=e897] [cursor=pointer]:
            - generic [ref=e898]: TSLA
            - generic [ref=e899]: "379.71"
            - generic [ref=e900]: +1.22%
          - generic [ref=e901] [cursor=pointer]:
            - generic [ref=e902]: AMD
            - generic [ref=e903]: "521.58"
            - generic [ref=e904]: "-2.06%"
          - generic [ref=e905] [cursor=pointer]:
            - generic [ref=e906]: AVGO
            - generic [ref=e907]: "365.02"
            - generic [ref=e908]: "-3.67%"
          - generic [ref=e909] [cursor=pointer]:
            - generic [ref=e910]: NFLX
            - generic [ref=e911]: "73.81"
            - generic [ref=e912]: +4.10%
          - generic [ref=e913] [cursor=pointer]:
            - generic [ref=e914]: CRM
            - generic [ref=e915]: "158.37"
            - generic [ref=e916]: +5.45%
          - generic [ref=e917] [cursor=pointer]:
            - generic [ref=e918]: SMCI
            - generic [ref=e919]: "30.63"
            - generic [ref=e920]: "-3.31%"
          - generic [ref=e921] [cursor=pointer]:
            - generic [ref=e922]: ARM
            - generic [ref=e923]: "334.27"
            - generic [ref=e924]: "-3.87%"
          - generic [ref=e925] [cursor=pointer]:
            - generic [ref=e926]: PLTR
            - generic [ref=e927]: "112.93"
            - generic [ref=e928]: +5.28%
          - generic [ref=e929] [cursor=pointer]:
            - generic [ref=e930]: MSTR
            - generic [ref=e931]: "82.31"
            - generic [ref=e932]: "-3.54%"
          - generic [ref=e933] [cursor=pointer]:
            - generic [ref=e934]: MU
            - generic [ref=e935]: 1,132.33
            - generic [ref=e936]: "-6.69%"
  - alert [ref=e937]
```

# Test source

```ts
  2954 |     return element?.closest("g[data-id]")?.getAttribute("data-id") ?? element?.tagName ?? "none";
  2955 |   }, [p4.x, p4.y]);
  2956 |   expect(finishTarget, "the finishing click has to land on another drawing's hit area").toBe("halo");
  2957 |   await page.mouse.dblclick(p4.x, p4.y, { delay: 60 });
  2958 | 
  2959 |   const path = layer.locator('g[data-drawing-kind="path"]:not([data-id="_p"])').last();
  2960 |   await expect(path).toBeVisible();
  2961 |   await expect.poll(
  2962 |     () => saves.flatMap((payload) => payload.drawings ?? []).filter((drawing) => drawing.kind === "path").at(-1)?.points?.length ?? 0,
  2963 |     { timeout: 5_000, message: "the double-click must persist four control anchors, not repeat the fourth" },
  2964 |   ).toBe(4);
  2965 | });
  2966 | 
  2967 | test("a desktop Path finishes exactly once when its closing double-click has no native dblclick", async ({ page }) => {
  2968 |   test.slow();
  2969 |   test.skip(
  2970 |     (page.viewportSize()?.width ?? 1440) <= 860,
  2971 |     "Desktop precision geometry; the coarse-pointer finish is covered above.",
  2972 |   );
  2973 |   const saves: DrawingSavePayload[] = [];
  2974 |   await openTerminal(page, {
  2975 |     drawings: [
  2976 |       {
  2977 |         id: "closing-target",
  2978 |         kind: "trendline",
  2979 |         source: "user",
  2980 |         points: [{ t: "2026-05-01", p: 200 }, { t: "2026-07-01", p: 200 }],
  2981 |         color: "#26c281",
  2982 |         width: 2,
  2983 |         dash: "solid",
  2984 |       },
  2985 |     ],
  2986 |     onPut: (payload) => saves.push(payload),
  2987 |   });
  2988 | 
  2989 |   const layer = page.locator(".pane.on .drawing-layer");
  2990 |   const layerBox = await layer.boundingBox();
  2991 |   expect(layerBox).not.toBeNull();
  2992 |   const committedPaths = layer.locator('g[data-drawing-kind="path"]:not([data-id="_p"])');
  2993 |   const preview = layer.locator('g[data-id="_p"]');
  2994 |   const inspector = page.getByRole("toolbar", { name: "Selected drawing properties" });
  2995 |   const savedPaths = () => saves.flatMap((payload) => payload.drawings ?? []).filter((drawing) => drawing.kind === "path");
  2996 | 
  2997 |   // The seeded object's own hit line is the close target, so the press really does land on a
  2998 |   // node this layer is about to detach. Read it from the DOM rather than guessing a pixel.
  2999 |   const closingHit = layer.locator('g[data-id="closing-target"] line[stroke="transparent"]').first();
  3000 |   await expect(closingHit).toHaveCount(1);
  3001 |   // Read the line's own attributes and offset them by the already-stabilized layer box. A quote
  3002 |   // repaint can replace the SVG subtree between locator resolution and evaluation, which makes
  3003 |   // `ownerSVGElement` transiently null even though the geometry is valid — the same hazard the
  3004 |   // vertical-line assertion above documents.
  3005 |   const closingLocal = await closingHit.evaluate((node) => {
  3006 |     const line = node as SVGLineElement;
  3007 |     return {
  3008 |       x: (Number(line.getAttribute("x1")) + Number(line.getAttribute("x2"))) / 2,
  3009 |       y: (Number(line.getAttribute("y1")) + Number(line.getAttribute("y2"))) / 2,
  3010 |     };
  3011 |   });
  3012 |   const closing = { x: layerBox!.x + closingLocal.x, y: layerBox!.y + closingLocal.y };
  3013 |   // Every anchor is placed in a band around the seeded object's own row so the whole gesture
  3014 |   // stays inside the PRICE pane. Anchors that stray into an indicator sub-pane carry that
  3015 |   // pane's reading rather than a price, which is a different contract (see the sub-pane
  3016 |   // rescale test below) and not what this one is measuring.
  3017 |   const near = (dx: number, dy: number) => ({ x: closing.x + dx, y: closing.y + dy });
  3018 |   expect(closing.x - 560).toBeGreaterThan(layerBox!.x);
  3019 | 
  3020 |   // ── Phase 1: Strong magnet, so the committed anchor is deliberately NOT under the cursor ──
  3021 |   // The magnet parks each price on an OHLC level, so the closing click's raw coordinates sit
  3022 |   // well outside the 3px desktop radius from the previous PROJECTED anchor while meaning
  3023 |   // exactly it. Closing over the seeded drawing removes the native-dblclick rescue at the same
  3024 |   // time, which is what makes this the discriminating case rather than a cosmetic one.
  3025 |   await selectMagnet(page, "strong");
  3026 |   await page.getByTestId("drawing-group-freehand-menu-trigger").click();
  3027 |   await page.getByTestId("drawing-tool-path").press("Enter");
  3028 |   await page.mouse.click(near(-560, 70).x, near(-560, 70).y);
  3029 |   await page.mouse.click(near(-420, -50).x, near(-420, -50).y);
  3030 |   await page.mouse.click(near(-280, 40).x, near(-280, 40).y);
  3031 |   // Nothing may commit before the closing gesture; a swallowed anchor must report as a
  3032 |   // setup failure here rather than impersonating the finish defect below.
  3033 |   await expect(committedPaths).toHaveCount(0);
  3034 |   await page.mouse.dblclick(closing.x, closing.y, { delay: 60 });
  3035 | 
  3036 |   await expect(committedPaths).toHaveCount(1);
  3037 |   await expect(preview).toHaveCount(0);
  3038 |   await expect.poll(
  3039 |     () => savedPaths().at(-1)?.points?.length ?? 0,
  3040 |     { timeout: 5_000, message: "the closing double-click should persist one four-anchor Path" },
  3041 |   ).toBe(4);
  3042 |   // The completion must not fall through into editing: no settings editor, and the seeded
  3043 |   // object under the closing anchor must not have been selected by the finishing gesture.
  3044 |   await expect(page.locator(".settings-open")).toHaveCount(0);
  3045 |   await expect(page.locator(".text-edit")).toHaveCount(0);
  3046 |   if (await inspector.count()) {
  3047 |     await expect(inspector).not.toHaveAttribute("data-drawing-id", "closing-target");
  3048 |   }
  3049 | 
  3050 |   // A native `dblclick` that arrives after the gesture already committed is the tail of that
  3051 |   // same gesture. It must be consumed: no editor, and above all no second Path.
  3052 |   await committedPaths.first().dispatchEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 });
  3053 |   await expect(committedPaths).toHaveCount(1);
> 3054 |   await expect(page.locator(".settings-open")).toHaveCount(0);
       |                                                ^ Error: expect(locator).toHaveCount(expected) failed
  3055 |   await expect(preview).toHaveCount(0);
  3056 | 
  3057 |   // ── Phase 2: magnet off, the unsnapped price path, closing over the seeded drawing again ──
  3058 |   await selectMagnet(page, "off");
  3059 |   await page.getByTestId("drawing-group-freehand-menu-trigger").click();
  3060 |   await page.getByTestId("drawing-tool-path").press("Enter");
  3061 |   await page.mouse.click(near(-200, 60).x, near(-200, 60).y);
  3062 |   await page.mouse.click(near(-110, -30).x, near(-110, -30).y);
  3063 |   await expect(committedPaths).toHaveCount(1);
  3064 |   await page.mouse.dblclick(closing.x, closing.y, { delay: 60 });
  3065 | 
  3066 |   await expect(committedPaths).toHaveCount(2);
  3067 |   await expect(preview).toHaveCount(0);
  3068 |   await expect.poll(
  3069 |     () => savedPaths().at(-1)?.points?.length ?? 0,
  3070 |     { timeout: 5_000, message: "an unsnapped closing click should persist one three-anchor Path" },
  3071 |   ).toBe(3);
  3072 |   await expect(page.locator(".settings-open")).toHaveCount(0);
  3073 | });
  3074 | 
  3075 | 
```