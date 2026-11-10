# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: drawing-system.spec.ts >> a desktop Path finishes exactly once when its closing double-click has no native dblclick
- Location: e2e/drawing-system.spec.ts:2967:5

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 1
Received length: 0
Received array:  []
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
            - 'button "Magnet mode: Off" [ref=e201] [cursor=pointer]':
              - img [ref=e202]
            - button "Open magnet modes" [ref=e204] [cursor=pointer]:
              - img [ref=e205]
          - group "Drawing history" [ref=e207]:
            - button "Undo drawing change" [ref=e208] [cursor=pointer]:
              - img [ref=e209]
            - button "Redo drawing change" [disabled] [ref=e211]:
              - img [ref=e212]
          - button "Lock 3 drawings" [ref=e214] [cursor=pointer]:
            - img [ref=e215]
          - button "Hide 3 drawings" [ref=e217] [cursor=pointer]:
            - img [ref=e218]
          - button "Remove drawings, 3 drawings" [ref=e221] [cursor=pointer]:
            - img [ref=e222]
            - generic [ref=e224]: "3"
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
              - generic [ref=e296] [cursor=pointer]: 26 bars × +51.35 (+30.98%)
            - generic:
              - generic: NVDA
              - generic:
                - generic: "192.53"
                - generic: 00:00
            - toolbar "Selected drawing properties" [ref=e300]:
              - button "Drag properties" [ref=e301]: ⠿
              - generic [ref=e302]:
                - 'button "Color #4d82ff" [ref=e303] [cursor=pointer]'
                - 'button "Color #26c281" [ref=e304] [cursor=pointer]'
                - 'button "Color #f0566b" [ref=e305] [cursor=pointer]'
                - generic "Custom drawing color" [ref=e306] [cursor=pointer]:
                  - generic [ref=e308]: +
                  - textbox "Custom drawing color" [ref=e309]: "#4d82ff"
              - button "Use 1.5 pixel line width" [ref=e311] [cursor=pointer]
              - button "Use 2.5 pixel line width" [ref=e313] [cursor=pointer]
              - button "Use 4 pixel line width" [ref=e315] [cursor=pointer]
              - button "Solid" [ref=e318] [cursor=pointer]:
                - img [ref=e319]
              - button "Dashed" [ref=e320] [cursor=pointer]:
                - img [ref=e321]
              - button "Dotted" [ref=e322] [cursor=pointer]:
                - img [ref=e323]
              - button "Delete drawing" [ref=e325] [cursor=pointer]:
                - img [ref=e326]
              - button "Lock drawing" [ref=e328] [cursor=pointer]: ○
              - button "Duplicate drawing" [ref=e329] [cursor=pointer]: ⧉
              - button "More properties" [ref=e330] [cursor=pointer]: ⚙
          - generic [ref=e331]:
            - generic [ref=e332]:
              - button "1D" [ref=e333] [cursor=pointer]
              - button "5D" [ref=e334] [cursor=pointer]
              - button "1M" [ref=e335] [cursor=pointer]
              - button "3M" [ref=e336] [cursor=pointer]
              - button "6M" [ref=e337] [cursor=pointer]
              - button "YTD" [ref=e338] [cursor=pointer]
              - button "1Y" [ref=e339] [cursor=pointer]
              - button "5Y" [ref=e340] [cursor=pointer]
              - button "All" [ref=e341] [cursor=pointer]
              - button "Go to date" [ref=e343] [cursor=pointer]:
                - img [ref=e344]
            - generic [ref=e347]:
              - generic [ref=e348]: 10:37:43 UTC-8
              - button "Extended trading hours" [disabled]: ETH
              - button "Data origin for this chart" [ref=e350] [cursor=pointer]: BASIS?
              - generic "Trading currency unavailable" [ref=e351] [cursor=pointer]: CCY?
              - button "Quick settings" [ref=e353] [cursor=pointer]:
                - img [ref=e354]
    - separator "Resize sidebar" [ref=e357]
    - complementary [ref=e359]:
      - group "Options perspective" [ref=e360]:
        - button "Overview" [pressed] [ref=e361] [cursor=pointer]
        - button "Context" [ref=e362] [cursor=pointer]
        - button "Options heatmap" [ref=e363] [cursor=pointer]:
          - img [ref=e364]
          - text: Options
      - generic [ref=e367]:
        - tablist "Rail source" [ref=e368]:
          - tab "Portfolio" [ref=e369] [cursor=pointer]
          - tab "Watchlists" [selected] [ref=e370] [cursor=pointer]
          - tab "News" [ref=e371] [cursor=pointer]
        - tabpanel "Watchlists" [ref=e372]:
          - generic [ref=e373]:
            - button "Default" [ref=e374] [cursor=pointer]:
              - text: Default
              - img [ref=e375]
            - generic [ref=e377]:
              - button "Add symbol" [ref=e378] [cursor=pointer]:
                - img [ref=e379]
              - button "Upcoming events for this list" [ref=e381] [cursor=pointer]:
                - img [ref=e382]
              - button "Settings" [ref=e385] [cursor=pointer]:
                - img [ref=e386]
          - generic [ref=e390]:
            - generic [ref=e391]:
              - generic [ref=e392]:
                - text: Symbol
                - generic "Drag to resize column" [ref=e393]
              - generic [ref=e394]:
                - generic [ref=e395]: Last
                - generic "Drag to resize column" [ref=e396]
              - generic [ref=e397]:
                - generic [ref=e398]: Chg%
                - generic "Drag to resize column" [ref=e399]
              - generic [ref=e400]:
                - generic [ref=e401]: Ext
                - generic "Drag to resize column" [ref=e402]
              - generic [ref=e403]:
                - generic [ref=e404]: Ext %
                - generic "Drag to resize column" [ref=e405]
            - listbox "Watchlists" [ref=e406]:
              - generic: Drop above all sections
              - generic [ref=e407]:
                - generic [ref=e408]:
                  - button "Crypto 2" [expanded] [ref=e409] [cursor=pointer]:
                    - img [ref=e410]
                    - generic [ref=e412]: Crypto
                    - generic [ref=e413]: "2"
                  - button "Drag section Crypto" [ref=e414]:
                    - img [ref=e415]
                  - generic [ref=e422]:
                    - button "Rename section" [ref=e423] [cursor=pointer]:
                      - img [ref=e424]
                    - button "Remove section" [ref=e426] [cursor=pointer]:
                      - img [ref=e427]
                - option "Drag BTC-USD Flag this symbol BTC-USD 60,025.72 +0.35% — —" [ref=e429]:
                  - button "Drag BTC-USD" [ref=e430]:
                    - img [ref=e431]
                  - generic "Flag this symbol" [ref=e438] [cursor=pointer]
                  - generic [ref=e439]:
                    - generic [ref=e441]: B
                    - generic [ref=e443]: BTC-USD
                  - generic [ref=e444]: 60,025.72
                  - generic [ref=e445]: +0.35%
                  - generic [ref=e446]: —
                  - generic [ref=e447]: —
                  - generic "Remove" [ref=e448]:
                    - img [ref=e449]
                - option "Drag ETH-USD Flag this symbol ETH-USD 1,579.00 +0.72% — —" [ref=e451]:
                  - button "Drag ETH-USD" [ref=e452]:
                    - img [ref=e453]
                  - generic "Flag this symbol" [ref=e460] [cursor=pointer]
                  - generic [ref=e461]:
                    - generic [ref=e463]: E
                    - generic [ref=e465]: ETH-USD
                  - generic [ref=e466]: 1,579.00
                  - generic [ref=e467]: +0.72%
                  - generic [ref=e468]: —
                  - generic [ref=e469]: —
                  - generic "Remove" [ref=e470]:
                    - img [ref=e471]
              - generic [ref=e473]:
                - generic [ref=e474]:
                  - button "Equities 4" [expanded] [ref=e475] [cursor=pointer]:
                    - img [ref=e476]
                    - generic [ref=e478]: Equities
                    - generic [ref=e479]: "4"
                  - button "Drag section Equities" [ref=e480]:
                    - img [ref=e481]
                  - generic [ref=e488]:
                    - button "Rename section" [ref=e489] [cursor=pointer]:
                      - img [ref=e490]
                    - button "Remove section" [ref=e492] [cursor=pointer]:
                      - img [ref=e493]
                - option "Drag NVDA Flag this symbol NVDA 192.53 -1.64% — —" [ref=e495]:
                  - button "Drag NVDA" [ref=e496]:
                    - img [ref=e497]
                  - generic "Flag this symbol" [ref=e504] [cursor=pointer]
                  - generic [ref=e505]:
                    - generic [ref=e507]: "N"
                    - generic [ref=e509]: NVDA
                  - generic [ref=e510]: "192.53"
                  - generic [ref=e511]: "-1.64%"
                  - generic [ref=e512]: —
                  - generic [ref=e513]: —
                  - generic "Remove" [ref=e514]:
                    - img [ref=e515]
                - option "Drag AAPL Flag this symbol AAPL 283.78 +3.14% — —" [ref=e517]:
                  - button "Drag AAPL" [ref=e518]:
                    - img [ref=e519]
                  - generic "Flag this symbol" [ref=e526] [cursor=pointer]
                  - generic [ref=e527]:
                    - generic [ref=e529]: A
                    - generic [ref=e531]: AAPL
                  - generic [ref=e532]: "283.78"
                  - generic [ref=e533]: +3.14%
                  - generic [ref=e534]: —
                  - generic [ref=e535]: —
                  - generic "Remove" [ref=e536]:
                    - img [ref=e537]
                - option "Drag MSFT Flag this symbol MSFT 372.97 +5.71% — —" [ref=e539]:
                  - button "Drag MSFT" [ref=e540]:
                    - img [ref=e541]
                  - generic "Flag this symbol" [ref=e548] [cursor=pointer]
                  - generic [ref=e549]:
                    - generic [ref=e551]: M
                    - generic [ref=e553]: MSFT
                  - generic [ref=e554]: "372.97"
                  - generic [ref=e555]: +5.71%
                  - generic [ref=e556]: —
                  - generic [ref=e557]: —
                  - generic "Remove" [ref=e558]:
                    - img [ref=e559]
                - option "Drag QQQ Flag this symbol QQQ 706.52 -1.38% — —" [ref=e561]:
                  - button "Drag QQQ" [ref=e562]:
                    - img [ref=e563]
                  - generic "Flag this symbol" [ref=e570] [cursor=pointer]
                  - generic [ref=e571]:
                    - generic [ref=e573]: Q
                    - generic [ref=e575]: QQQ
                  - generic [ref=e576]: "706.52"
                  - generic [ref=e577]: "-1.38%"
                  - generic [ref=e578]: —
                  - generic [ref=e579]: —
                  - generic "Remove" [ref=e580]:
                    - img [ref=e581]
              - status [ref=e583]
        - generic [ref=e584]:
          - generic [ref=e585]:
            - generic [ref=e587]: "N"
            - generic [ref=e588]:
              - generic [ref=e589]: NVIDIA Corp
              - generic [ref=e590]: NVDA · Equities
            - button "Open full analysis" [ref=e591] [cursor=pointer]:
              - img [ref=e592]
            - generic [ref=e594]:
              - generic [ref=e595]: "192.53"
              - generic [ref=e596]: "-1.64%"
          - generic [ref=e597]:
            - generic [ref=e598]:
              - button "Open Intelligence workspace" [ref=e599] [cursor=pointer]:
                - generic [ref=e600]:
                  - generic [ref=e601]:
                    - img [ref=e602]
                    - text: Intelligence
                  - img [ref=e605]
                - generic [ref=e607]:
                  - generic [ref=e608]:
                    - generic [ref=e609]: Oracle
                    - generic [ref=e610]: Uptrend — no entry signal
                    - generic [ref=e611]: "Historical signal: Structure stop · Signal date unverified"
                  - generic [ref=e612]:
                    - generic [ref=e613]: Research
                    - generic [ref=e614]: No current reading
                    - generic [ref=e615]: View details
                - generic [ref=e616]:
                  - generic [ref=e617]: Prophet
                  - generic [ref=e618]: Sign in to view
                - generic [ref=e620]: Oracle entry unverified · No current data
              - generic [ref=e622]:
                - generic [ref=e623]: Trend
                - generic [ref=e624]: Uptrend
                - generic [ref=e625]: weeks–months
            - generic [ref=e626]:
              - generic [ref=e627]:
                - img [ref=e628]
                - generic [ref=e630]: Deep analysis coming online
                - generic [ref=e631]: This name isn't in the research desk yet — the chart, levels and oracle verdict above are live.
              - generic [ref=e632]:
                - generic [ref=e634]: Key stats
                - generic [ref=e635]:
                  - generic [ref=e636]:
                    - generic [ref=e637]: Volume
                    - generic [ref=e638]: 179.30 M
                  - generic [ref=e639]:
                    - generic [ref=e640]: Avg volume (30D)
                    - generic [ref=e641]: 170.09 M
              - generic [ref=e642]:
                - generic [ref=e644]: Performance
                - generic [ref=e645]:
                  - generic [ref=e646]:
                    - generic [ref=e647]: "-8.62%"
                    - generic [ref=e648]: 1W
                  - generic [ref=e649]:
                    - generic [ref=e650]: "-9.44%"
                    - generic [ref=e651]: 1M
                  - generic [ref=e652]:
                    - generic [ref=e653]: +12.43%
                    - generic [ref=e654]: 3M
                  - generic [ref=e655]:
                    - generic [ref=e656]: +1.75%
                    - generic [ref=e657]: 6M
                  - generic [ref=e658]:
                    - generic [ref=e659]: +3.23%
                    - generic [ref=e660]: YTD
                  - generic [ref=e661]:
                    - generic [ref=e662]: +24.77%
                    - generic [ref=e663]: 1Y
              - generic [ref=e664]:
                - generic [ref=e666]: Technicals
                - generic [ref=e667]:
                  - img "23 of 100" [ref=e668]:
                    - generic [ref=e669]:
                      - img [ref=e670]
                      - generic:
                        - generic: "23"
                        - generic: Strong sell
                  - generic [ref=e674]:
                    - generic [ref=e675]: Sell 17
                    - generic [ref=e676]: Neutral 7
                    - generic [ref=e677]: Buy 2
                - button "More technicals ›" [ref=e678] [cursor=pointer]
              - generic [ref=e679]:
                - generic [ref=e680]:
                  - generic [ref=e681]: Realized volatility
                  - generic [ref=e682]: Historical prices · IV unavailable
                - generic [ref=e684]:
                  - img [ref=e686]:
                    - generic [ref=e688]: 35%
                    - generic [ref=e690]: 40%
                    - generic [ref=e692]: 45%
                    - generic [ref=e694]: 50%
                    - generic [ref=e696]: 55%
                  - generic [ref=e719]:
                    - generic [ref=e720]: 10d
                    - generic [ref=e722]: 42d
                    - generic [ref=e725]: 252d
                  - generic [ref=e726]:
                    - generic [ref=e727]: Current
                    - generic [ref=e729]: Median
              - region "Seasonality view context" [ref=e732]:
                - group "Linking for this view" [ref=e733]:
                  - button "Follow chart" [pressed] [ref=e734] [cursor=pointer]
                  - button "Pin this view" [ref=e735] [cursor=pointer]
                  - button "Unlink" [ref=e736] [cursor=pointer]
                - status [ref=e737]: "Following chart: NVDA"
                - paragraph [ref=e738]: Linking applies to this session only.
                - generic [ref=e739]:
                  - generic [ref=e740]:
                    - img [ref=e741]
                    - text: Seasonality · avg monthly return
                    - generic [ref=e744]: 10y
                  - radiogroup "Seasonality · avg monthly return" [ref=e745]:
                    - radio "Jan · +6.6% avg · WR 60% · n=5" [ref=e746] [cursor=pointer]:
                      - generic [ref=e749]: J
                    - radio "Feb · +8.7% avg · WR 60% · n=5" [ref=e750] [cursor=pointer]:
                      - generic [ref=e753]: F
                    - radio "Mar · +6.2% avg · WR 60% · n=5" [ref=e754] [cursor=pointer]:
                      - generic [ref=e757]: M
                    - radio "Apr · -4.3% avg · WR 40% · n=5" [ref=e758] [cursor=pointer]:
                      - generic [ref=e761]: A
                    - radio "May · +18.8% avg · WR 100% · n=5" [ref=e762] [cursor=pointer]:
                      - generic [ref=e765]: M
                    - radio "Jun · +2.8% avg · WR 60% · n=5" [ref=e766] [cursor=pointer]:
                      - generic [ref=e769]: J
                    - radio "Jul · +7.0% avg · WR 60% · n=5" [ref=e770] [cursor=pointer]:
                      - generic [ref=e773]: J
                    - radio "Aug · +0.7% avg · WR 60% · n=5" [ref=e774] [cursor=pointer]:
                      - generic [ref=e777]: A
                    - radio "Sep · -6.0% avg · WR 40% · n=5" [ref=e778] [cursor=pointer]:
                      - generic [ref=e781]: S
                    - radio "Oct · +9.2% avg · WR 80% · n=5" [ref=e782] [cursor=pointer]:
                      - generic [ref=e785]: O
                    - radio "Nov · +11.9% avg · WR 80% · n=5" [checked] [ref=e786] [cursor=pointer]:
                      - generic [ref=e789]: "N"
                    - radio "Dec · -3.0% avg · WR 40% · n=5" [ref=e790] [cursor=pointer]:
                      - generic [ref=e793]: D
                  - generic [ref=e794]:
                    - combobox "Seasonality · avg monthly return · Jan–Dec" [ref=e795]:
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
                    - status [ref=e796]: Nov · +11.9% avg · WR 80% · n=5
                  - generic [ref=e797]: Current month highlighted · from NVDA history (display-only context).
                  - button "More seasonals ›" [ref=e798] [cursor=pointer]
            - generic [ref=e799]:
              - button "Open full analysis" [ref=e800] [cursor=pointer]
              - button "Ask Mastermind AI about NVDA →" [ref=e801] [cursor=pointer]
    - generic [ref=e802]:
      - generic [ref=e803]: Movers
      - generic [ref=e805]:
        - generic [ref=e806]:
          - generic [ref=e807] [cursor=pointer]:
            - generic [ref=e808]: NVDA
            - generic [ref=e809]: "192.53"
            - generic [ref=e810]: "-1.64%"
          - generic [ref=e811] [cursor=pointer]:
            - generic [ref=e812]: AAPL
            - generic [ref=e813]: "283.78"
            - generic [ref=e814]: +3.14%
          - generic [ref=e815] [cursor=pointer]:
            - generic [ref=e816]: MSFT
            - generic [ref=e817]: "372.97"
            - generic [ref=e818]: +5.71%
          - generic [ref=e819] [cursor=pointer]:
            - generic [ref=e820]: GOOGL
            - generic [ref=e821]: "337.39"
            - generic [ref=e822]: "-1.84%"
          - generic [ref=e823] [cursor=pointer]:
            - generic [ref=e824]: AMZN
            - generic [ref=e825]: "232.69"
            - generic [ref=e826]: +2.50%
          - generic [ref=e827] [cursor=pointer]:
            - generic [ref=e828]: META
            - generic [ref=e829]: "550.25"
            - generic [ref=e830]: +1.36%
          - generic [ref=e831] [cursor=pointer]:
            - generic [ref=e832]: TSLA
            - generic [ref=e833]: "379.71"
            - generic [ref=e834]: +1.22%
          - generic [ref=e835] [cursor=pointer]:
            - generic [ref=e836]: AMD
            - generic [ref=e837]: "521.58"
            - generic [ref=e838]: "-2.06%"
          - generic [ref=e839] [cursor=pointer]:
            - generic [ref=e840]: AVGO
            - generic [ref=e841]: "365.02"
            - generic [ref=e842]: "-3.67%"
          - generic [ref=e843] [cursor=pointer]:
            - generic [ref=e844]: NFLX
            - generic [ref=e845]: "73.81"
            - generic [ref=e846]: +4.10%
          - generic [ref=e847] [cursor=pointer]:
            - generic [ref=e848]: CRM
            - generic [ref=e849]: "158.37"
            - generic [ref=e850]: +5.45%
          - generic [ref=e851] [cursor=pointer]:
            - generic [ref=e852]: SMCI
            - generic [ref=e853]: "30.63"
            - generic [ref=e854]: "-3.31%"
          - generic [ref=e855] [cursor=pointer]:
            - generic [ref=e856]: ARM
            - generic [ref=e857]: "334.27"
            - generic [ref=e858]: "-3.87%"
          - generic [ref=e859] [cursor=pointer]:
            - generic [ref=e860]: PLTR
            - generic [ref=e861]: "112.93"
            - generic [ref=e862]: +5.28%
          - generic [ref=e863] [cursor=pointer]:
            - generic [ref=e864]: MSTR
            - generic [ref=e865]: "82.31"
            - generic [ref=e866]: "-3.54%"
          - generic [ref=e867] [cursor=pointer]:
            - generic [ref=e868]: MU
            - generic [ref=e869]: 1,132.33
            - generic [ref=e870]: "-6.69%"
        - generic [ref=e871]:
          - generic [ref=e872] [cursor=pointer]:
            - generic [ref=e873]: NVDA
            - generic [ref=e874]: "192.53"
            - generic [ref=e875]: "-1.64%"
          - generic [ref=e876] [cursor=pointer]:
            - generic [ref=e877]: AAPL
            - generic [ref=e878]: "283.78"
            - generic [ref=e879]: +3.14%
          - generic [ref=e880] [cursor=pointer]:
            - generic [ref=e881]: MSFT
            - generic [ref=e882]: "372.97"
            - generic [ref=e883]: +5.71%
          - generic [ref=e884] [cursor=pointer]:
            - generic [ref=e885]: GOOGL
            - generic [ref=e886]: "337.39"
            - generic [ref=e887]: "-1.84%"
          - generic [ref=e888] [cursor=pointer]:
            - generic [ref=e889]: AMZN
            - generic [ref=e890]: "232.69"
            - generic [ref=e891]: +2.50%
          - generic [ref=e892] [cursor=pointer]:
            - generic [ref=e893]: META
            - generic [ref=e894]: "550.25"
            - generic [ref=e895]: +1.36%
          - generic [ref=e896] [cursor=pointer]:
            - generic [ref=e897]: TSLA
            - generic [ref=e898]: "379.71"
            - generic [ref=e899]: +1.22%
          - generic [ref=e900] [cursor=pointer]:
            - generic [ref=e901]: AMD
            - generic [ref=e902]: "521.58"
            - generic [ref=e903]: "-2.06%"
          - generic [ref=e904] [cursor=pointer]:
            - generic [ref=e905]: AVGO
            - generic [ref=e906]: "365.02"
            - generic [ref=e907]: "-3.67%"
          - generic [ref=e908] [cursor=pointer]:
            - generic [ref=e909]: NFLX
            - generic [ref=e910]: "73.81"
            - generic [ref=e911]: +4.10%
          - generic [ref=e912] [cursor=pointer]:
            - generic [ref=e913]: CRM
            - generic [ref=e914]: "158.37"
            - generic [ref=e915]: +5.45%
          - generic [ref=e916] [cursor=pointer]:
            - generic [ref=e917]: SMCI
            - generic [ref=e918]: "30.63"
            - generic [ref=e919]: "-3.31%"
          - generic [ref=e920] [cursor=pointer]:
            - generic [ref=e921]: ARM
            - generic [ref=e922]: "334.27"
            - generic [ref=e923]: "-3.87%"
          - generic [ref=e924] [cursor=pointer]:
            - generic [ref=e925]: PLTR
            - generic [ref=e926]: "112.93"
            - generic [ref=e927]: +5.28%
          - generic [ref=e928] [cursor=pointer]:
            - generic [ref=e929]: MSTR
            - generic [ref=e930]: "82.31"
            - generic [ref=e931]: "-3.54%"
          - generic [ref=e932] [cursor=pointer]:
            - generic [ref=e933]: MU
            - generic [ref=e934]: 1,132.33
            - generic [ref=e935]: "-6.69%"
  - alert [ref=e936]
```

# Test source

```ts
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
  3054 |   await expect(page.locator(".settings-open")).toHaveCount(0);
  3055 |   await expect(preview).toHaveCount(0);
  3056 | 
  3057 |   // ── Phase 2: magnet off, the unsnapped price path, closing over the seeded drawing again ──
  3058 |   await layer.evaluate(node => {
  3059 |     const record = {
  3060 |       phase: "completion",
  3061 |       events: [] as { phase: string; type: string; trusted: boolean; targetId: string | null }[],
  3062 |     };
  3063 |     (window as unknown as { __pr632Gesture: typeof record }).__pr632Gesture = record;
  3064 |     for (const type of ["pointerdown", "dblclick"]) node.addEventListener(type, event => {
  3065 |       const target = event.target instanceof Element ? event.target : null;
  3066 |       record.events.push({
  3067 |         phase: record.phase, type: event.type, trusted: event.isTrusted,
  3068 |         targetId: target?.closest("g[data-id]")?.getAttribute("data-id") ?? null,
  3069 |       });
  3070 |     }, true);
  3071 |   });
  3072 |   await selectMagnet(page, "off");
  3073 |   await page.getByTestId("drawing-group-freehand-menu-trigger").click();
  3074 |   await page.getByTestId("drawing-tool-path").press("Enter");
  3075 |   await page.mouse.click(near(-200, 60).x, near(-200, 60).y);
  3076 |   await page.mouse.click(near(-110, -30).x, near(-110, -30).y);
  3077 |   await expect(committedPaths).toHaveCount(1);
  3078 |   await page.mouse.dblclick(closing.x, closing.y, { delay: 60 });
  3079 | 
  3080 |   await expect(committedPaths).toHaveCount(2);
  3081 |   await expect(preview).toHaveCount(0);
  3082 |   await expect.poll(
  3083 |     () => savedPaths().at(-1)?.points?.length ?? 0,
  3084 |     { timeout: 5_000, message: "an unsnapped closing click should persist one three-anchor Path" },
  3085 |   ).toBe(3);
  3086 |   await expect(page.locator(".settings-open")).toHaveCount(0);
  3087 |   // A new physical gesture must restore editing after completion with no native tail.
  3088 |   await expect(page.getByTestId("drawing-tool-cursor")).toHaveAttribute("aria-pressed", "true");
  3089 |   const phaseTwoPath = committedPaths.last();
  3090 |   const phaseTwoId = await phaseTwoPath.getAttribute("data-id");
  3091 |   expect(phaseTwoId).toBeTruthy();
  3092 |   const editPoint = await phaseTwoPath.locator('polyline[data-segment="1"]').evaluate((node, expectedId) => {
  3093 |     const hit = node as SVGPolylineElement, matrix = hit.getScreenCTM();
  3094 |     if (!matrix || !hit.isConnected) return null;
  3095 |     for (let i = 1; i < hit.points.numberOfItems; i++) {
  3096 |       const a = hit.points.getItem(i - 1), b = hit.points.getItem(i);
  3097 |       for (const fraction of [0.5, 0.35, 0.65]) {
  3098 |         const point = new DOMPoint(a.x + (b.x - a.x) * fraction, a.y + (b.y - a.y) * fraction).matrixTransform(matrix);
  3099 |         if (point.x <= 0 || point.y <= 0 || point.x >= innerWidth || point.y >= innerHeight) continue;
  3100 |         const target = document.elementFromPoint(point.x, point.y);
  3101 |         if (target?.closest("[data-handle]")) continue;
  3102 |         if (target?.closest("g[data-id]")?.getAttribute("data-id") === expectedId) return { x: point.x, y: point.y };
  3103 |       }
  3104 |     }
  3105 |     return null;
  3106 |   }, phaseTwoId);
  3107 |   expect(editPoint, "an unobstructed physical hit point on the completed Path").not.toBeNull();
  3108 |   await page.evaluate(() => {
  3109 |     (window as unknown as { __pr632Gesture: { phase: string } }).__pr632Gesture.phase = "editing";
  3110 |   });
  3111 |   await page.mouse.dblclick(editPoint!.x, editPoint!.y, { delay: 60 });
  3112 |   const gesture = await page.evaluate(() =>
  3113 |     (window as unknown as { __pr632Gesture: {
  3114 |       phase: string; events: { phase: string; type: string; trusted: boolean; targetId: string | null }[];
  3115 |     } }).__pr632Gesture);
  3116 |   await test.info().attach("path-completion-and-fresh-editing", {
  3117 |     body: Buffer.from(JSON.stringify({ phaseTwoId, editPoint, ...gesture })), contentType: "application/json",
  3118 |   });
  3119 |   expect(gesture.events.filter(event => event.phase === "completion" && event.type === "dblclick" && event.trusted)).toHaveLength(0);
  3120 |   const freshDowns = gesture.events.filter(event => event.phase === "editing" && event.type === "pointerdown" && event.trusted);
  3121 |   expect(freshDowns).toHaveLength(2);
  3122 |   expect(freshDowns[0].targetId).toBe(phaseTwoId);
> 3123 |   expect(gesture.events.filter(event => event.phase === "editing" && event.type === "dblclick" && event.trusted)).toHaveLength(1);
       |                                                                                                                   ^ Error: expect(received).toHaveLength(expected)
  3124 |   await expect(inspector).toBeVisible();
  3125 |   await expect(inspector).toHaveAttribute("data-drawing-id", phaseTwoId!);
  3126 |   await expect(inspector).toHaveClass(/(?:^|\s)settings-open(?:\s|$)/);
  3127 |   await expect(committedPaths).toHaveCount(2);
  3128 |   await expect(preview).toHaveCount(0);
  3129 | 
  3130 | });
  3131 | 
  3132 | 
```