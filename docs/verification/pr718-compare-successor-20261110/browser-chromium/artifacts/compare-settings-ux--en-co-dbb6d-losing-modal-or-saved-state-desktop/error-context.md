# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: compare-settings-ux.spec.ts >> [en] comparison settings edit the real overlay without losing modal or saved state
- Location: e2e/compare-settings-ux.spec.ts:88:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Cannot read properties of null (reading 'setAttribute')",
+ ]
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
      - button "Symbol search — NVDA" [ref=e13] [cursor=pointer]:
        - generic [ref=e14]:
          - generic [ref=e15]: "N"
          - generic [ref=e16]: $
        - generic [ref=e17]: NVDA
        - img [ref=e18]
      - button "Compare 1" [ref=e20] [cursor=pointer]:
        - img [ref=e21]
        - generic [ref=e23]: Compare
        - generic [ref=e24]: "1"
      - generic [ref=e25]:
        - generic [ref=e26]:
          - generic [ref=e27]: Last Price
          - generic [ref=e28]: "192.53"
        - generic [ref=e29]:
          - generic [ref=e30]: 24h Change
          - generic [ref=e31]: "-1.64%"
        - generic [ref=e32]:
          - generic [ref=e33]: Volume
          - generic [ref=e34]: 179.3M
        - generic "Day Range" [ref=e35]:
          - generic [ref=e36]:
            - generic [ref=e37]: Day Range
            - generic [ref=e38]: "192.53"
          - generic "Open" [ref=e41]
          - generic [ref=e43]:
            - generic [ref=e44]:
              - emphasis [ref=e45]: L
              - generic [ref=e46]: "191.22"
            - generic [ref=e47]:
              - generic [ref=e48]: "195.55"
              - emphasis [ref=e49]: H
      - generic "Market closed — last session" [ref=e50]: Historical
      - button "Chart actions" [ref=e52] [cursor=pointer]:
        - img [ref=e53]
        - generic [ref=e55]:
          - text: Actions
          - generic [ref=e56]: ">"
      - button "Mastermind AI" [ref=e57] [cursor=pointer]:
        - img [ref=e58]
        - text: Mastermind AI
      - button "Settings" [ref=e60] [cursor=pointer]: R
    - navigation "Primary" [ref=e61]:
      - link "Chart" [ref=e62] [cursor=pointer]:
        - /url: /terminal
        - img [ref=e63]
      - link "Analysis" [ref=e65] [cursor=pointer]:
        - /url: /analysis?symbol=NVDA
        - img [ref=e66]
      - link "Discover" [ref=e68] [cursor=pointer]:
        - /url: /discover
        - img [ref=e69]
      - link "Dislocations" [ref=e74] [cursor=pointer]:
        - /url: /dislocations
        - img [ref=e75]
      - link "Options" [ref=e78] [cursor=pointer]:
        - /url: /options
        - img [ref=e79]
      - link "Scripts" [ref=e82] [cursor=pointer]:
        - /url: /scripts
        - img [ref=e83]
      - link "Portfolio" [ref=e87] [cursor=pointer]:
        - /url: /portfolio
        - img [ref=e88]
      - link "Alerts" [ref=e90] [cursor=pointer]:
        - /url: /alerts
        - img [ref=e91]
      - button "Mastermind AI" [ref=e94] [cursor=pointer]:
        - img [ref=e95]
    - generic [ref=e97]:
      - generic [ref=e99]:
        - button "Chart context" [ref=e100] [cursor=pointer]:
          - img [ref=e101]
          - text: Context
        - generic [ref=e105]:
          - button "D" [ref=e106] [cursor=pointer]
          - button "3D" [ref=e107] [cursor=pointer]
          - button "W" [ref=e108] [cursor=pointer]
          - button "1M" [ref=e109] [cursor=pointer]
          - button "Customize timeframes" [ref=e110] [cursor=pointer]:
            - img [ref=e111]
        - button "Candles ▾" [ref=e114] [cursor=pointer]:
          - img [ref=e115]
          - text: Candles
          - generic [ref=e117]: ▾
        - button "Indicators" [ref=e118] [cursor=pointer]:
          - img [ref=e119]
          - text: Indicators
        - button "MTF" [ref=e121] [cursor=pointer]:
          - img [ref=e122]
          - text: MTF
        - button "More" [ref=e125] [cursor=pointer]:
          - img [ref=e126]
          - generic [ref=e130]: More
      - generic [ref=e131]:
        - toolbar "Drawing tools" [ref=e132]:
          - button "Cursor" [pressed] [ref=e133] [cursor=pointer]:
            - img [ref=e134]
          - generic [ref=e137]:
            - button "Trend line, Alt+T" [ref=e138] [cursor=pointer]:
              - img [ref=e139]
            - button "Open Lines, channels & pitchforks tools" [ref=e141] [cursor=pointer]:
              - img [ref=e142]
          - generic [ref=e144]:
            - button "Fibonacci retracement, Alt+F" [ref=e145] [cursor=pointer]:
              - img [ref=e146]
            - button "Open Fibonacci & Gann tools" [ref=e148] [cursor=pointer]:
              - img [ref=e149]
          - generic [ref=e151]:
            - button "XABCD pattern" [ref=e152] [cursor=pointer]:
              - img [ref=e153]
            - button "Open Patterns, Elliott waves & cycles tools" [ref=e155] [cursor=pointer]:
              - img [ref=e156]
          - generic [ref=e158]:
            - button "Long position" [ref=e159] [cursor=pointer]:
              - img [ref=e160]
            - button "Open Forecasting, volume & ranges tools" [ref=e162] [cursor=pointer]:
              - img [ref=e163]
          - generic [ref=e165]:
            - button "Brush" [ref=e166] [cursor=pointer]:
              - img [ref=e167]
            - button "Open Freehand tools" [ref=e169] [cursor=pointer]:
              - img [ref=e170]
          - generic [ref=e172]:
            - button "Rectangle, Alt+Shift+R" [ref=e173] [cursor=pointer]:
              - img [ref=e174]
            - button "Open Shapes & curves tools" [ref=e176] [cursor=pointer]:
              - img [ref=e177]
          - generic [ref=e179]:
            - button "Arrow marker" [ref=e180] [cursor=pointer]:
              - img [ref=e181]
            - button "Open Arrows tools" [ref=e183] [cursor=pointer]:
              - img [ref=e184]
          - generic [ref=e186]:
            - button "Text, Alt+X" [ref=e187] [cursor=pointer]:
              - img [ref=e188]
            - button "Open Text, notes & labels tools" [ref=e190] [cursor=pointer]:
              - img [ref=e191]
          - generic [ref=e193]:
            - button "Emoji" [ref=e194] [cursor=pointer]:
              - img [ref=e195]
            - button "Open Emoji & icons tools" [ref=e197] [cursor=pointer]:
              - img [ref=e198]
          - button "Keep drawing active" [ref=e200] [cursor=pointer]:
            - img [ref=e201]
          - generic [ref=e203]:
            - 'button "Magnet mode: Off" [ref=e204] [cursor=pointer]':
              - img [ref=e205]
            - button "Open magnet modes" [ref=e207] [cursor=pointer]:
              - img [ref=e208]
          - group "Drawing history" [ref=e210]:
            - button "Undo drawing change" [disabled] [ref=e211]:
              - img [ref=e212]
            - button "Redo drawing change" [disabled] [ref=e214]:
              - img [ref=e215]
          - button "Lock 0 drawings" [disabled] [ref=e217]:
            - img [ref=e218]
          - button "Hide 0 drawings" [ref=e220] [cursor=pointer]:
            - img [ref=e221]
          - button "Remove drawings, 0 drawings" [ref=e224] [cursor=pointer]:
            - img [ref=e225]
            - generic [ref=e227]: "0"
          - button "Hide favorites (0)" [disabled] [ref=e229] [cursor=pointer]:
            - img [ref=e230]
        - generic [ref=e233]:
          - region "Comparison anchor and basis" [ref=e234]:
            - generic [ref=e235]:
              - generic [ref=e236]: Comparison anchor
              - list "Auto · each line starts at its first session in common with NVDA" [ref=e237]:
                - listitem [ref=e238]:
                  - generic [ref=e240]: AAPL
                  - generic [ref=e241]: raw scale
              - button "Anchor & basis" [ref=e242] [cursor=pointer]
          - generic [ref=e243]:
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
            - table [ref=e246]:
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
                - cell [ref=e269]
              - row [ref=e271]:
                - cell
                - cell [ref=e272]
                - cell [ref=e276]
              - row [ref=e280]:
                - cell
                - cell [ref=e281]
                - cell [ref=e285]
            - generic:
              - generic:
                - generic:
                  - group "Moving Averages" [ref=e288]:
                    - generic [ref=e289]: Moving Averages
                    - generic: Hide Settings Source code Remove More
                  - group "Volume" [ref=e290]:
                    - generic [ref=e291]: Volume
                    - generic: Hide Settings Source code Remove More
                  - group "TW · Mastermind Candles" [ref=e292]:
                    - generic [ref=e293]: TW · Mastermind Candles
                    - generic: Hide Settings Remove More
                  - group "AAPL" [ref=e294]:
                    - generic [ref=e295]: AAPL
                    - generic [ref=e296]:
                      - button "Hide" [ref=e297] [cursor=pointer]:
                        - img [ref=e298]
                        - text: Hide
                      - button "Settings" [active] [ref=e301] [cursor=pointer]:
                        - img [ref=e302]
                        - text: Settings
                      - button "Remove" [ref=e304] [cursor=pointer]:
                        - img [ref=e305]
                        - text: Remove
                      - button "More" [ref=e307] [cursor=pointer]:
                        - img [ref=e308]
                        - text: More
                  - button "Minimize indicator list" [ref=e309] [cursor=pointer]:
                    - img [ref=e310]
              - group "Stochastic RSI" [ref=e312]:
                - generic [ref=e313]: Stochastic RSI
                - generic: Hide Settings Source code Remove More
              - group "MACD-RSI" [ref=e314]:
                - generic [ref=e315]: MACD-RSI
                - generic: Hide Settings Source code Remove More
            - img
            - img
            - img
            - generic:
              - generic: NVDA
              - generic:
                - generic: "192.53"
                - generic: 00:00
          - generic [ref=e316]:
            - generic [ref=e317]:
              - button "1D" [ref=e318] [cursor=pointer]
              - button "5D" [ref=e319] [cursor=pointer]
              - button "1M" [ref=e320] [cursor=pointer]
              - button "3M" [ref=e321] [cursor=pointer]
              - button "6M" [ref=e322] [cursor=pointer]
              - button "YTD" [ref=e323] [cursor=pointer]
              - button "1Y" [ref=e324] [cursor=pointer]
              - button "5Y" [ref=e325] [cursor=pointer]
              - button "All" [ref=e326] [cursor=pointer]
              - button "Go to date" [ref=e328] [cursor=pointer]:
                - img [ref=e329]
            - generic [ref=e332]:
              - generic [ref=e333]: 08:46:25 UTC-8
              - button "Extended trading hours" [disabled]: ETH
              - button "Data origin for this chart" [ref=e335] [cursor=pointer]: BASIS?
              - generic "Trading currency unavailable" [ref=e336] [cursor=pointer]: CCY?
              - button "Quick settings" [ref=e338] [cursor=pointer]:
                - img [ref=e339]
    - separator "Resize sidebar" [ref=e342]
    - complementary [ref=e344]:
      - group "Options perspective" [ref=e345]:
        - button "Overview" [pressed] [ref=e346] [cursor=pointer]
        - button "Context" [ref=e347] [cursor=pointer]
        - button "Options heatmap" [ref=e348] [cursor=pointer]:
          - img [ref=e349]
          - text: Options
      - generic [ref=e352]:
        - tablist "Rail source" [ref=e353]:
          - tab "Portfolio" [ref=e354] [cursor=pointer]
          - tab "Watchlists" [selected] [ref=e355] [cursor=pointer]
          - tab "News" [ref=e356] [cursor=pointer]
        - tabpanel "Watchlists" [ref=e357]:
          - generic [ref=e358]:
            - button "Default" [ref=e359] [cursor=pointer]:
              - text: Default
              - img [ref=e360]
            - generic [ref=e362]:
              - button "Add symbol" [ref=e363] [cursor=pointer]:
                - img [ref=e364]
              - button "Upcoming events for this list" [ref=e366] [cursor=pointer]:
                - img [ref=e367]
              - button "Settings" [ref=e370] [cursor=pointer]:
                - img [ref=e371]
          - generic [ref=e375]:
            - generic [ref=e376]:
              - generic [ref=e377]:
                - text: Symbol
                - generic "Drag to resize column" [ref=e378]
              - generic [ref=e379]:
                - generic [ref=e380]: Last
                - generic "Drag to resize column" [ref=e381]
              - generic [ref=e382]:
                - generic [ref=e383]: Chg%
                - generic "Drag to resize column" [ref=e384]
              - generic [ref=e385]:
                - generic [ref=e386]: Ext
                - generic "Drag to resize column" [ref=e387]
              - generic [ref=e388]:
                - generic [ref=e389]: Ext %
                - generic "Drag to resize column" [ref=e390]
            - listbox "Watchlists" [ref=e391]:
              - generic: Drop above all sections
              - generic [ref=e392]:
                - generic [ref=e393]:
                  - button "Crypto 2" [expanded] [ref=e394] [cursor=pointer]:
                    - img [ref=e395]
                    - generic [ref=e397]: Crypto
                    - generic [ref=e398]: "2"
                  - button "Drag section Crypto" [ref=e399]:
                    - img [ref=e400]
                  - generic [ref=e407]:
                    - button "Rename section" [ref=e408] [cursor=pointer]:
                      - img [ref=e409]
                    - button "Remove section" [ref=e411] [cursor=pointer]:
                      - img [ref=e412]
                - option "Drag BTC-USD Flag this symbol BTC-USD 60,025.72 +0.35% — —" [ref=e414]:
                  - button "Drag BTC-USD" [ref=e415]:
                    - img [ref=e416]
                  - generic "Flag this symbol" [ref=e423] [cursor=pointer]
                  - generic [ref=e424]:
                    - generic [ref=e426]: B
                    - generic [ref=e428]: BTC-USD
                  - generic [ref=e429]: 60,025.72
                  - generic [ref=e430]: +0.35%
                  - generic [ref=e431]: —
                  - generic [ref=e432]: —
                  - generic "Remove" [ref=e433]:
                    - img [ref=e434]
                - option "Drag ETH-USD Flag this symbol ETH-USD 1,579.00 +0.72% — —" [ref=e436]:
                  - button "Drag ETH-USD" [ref=e437]:
                    - img [ref=e438]
                  - generic "Flag this symbol" [ref=e445] [cursor=pointer]
                  - generic [ref=e446]:
                    - generic [ref=e448]: E
                    - generic [ref=e450]: ETH-USD
                  - generic [ref=e451]: 1,579.00
                  - generic [ref=e452]: +0.72%
                  - generic [ref=e453]: —
                  - generic [ref=e454]: —
                  - generic "Remove" [ref=e455]:
                    - img [ref=e456]
              - generic [ref=e458]:
                - generic [ref=e459]:
                  - button "Equities 4" [expanded] [ref=e460] [cursor=pointer]:
                    - img [ref=e461]
                    - generic [ref=e463]: Equities
                    - generic [ref=e464]: "4"
                  - button "Drag section Equities" [ref=e465]:
                    - img [ref=e466]
                  - generic [ref=e473]:
                    - button "Rename section" [ref=e474] [cursor=pointer]:
                      - img [ref=e475]
                    - button "Remove section" [ref=e477] [cursor=pointer]:
                      - img [ref=e478]
                - option "Drag NVDA Flag this symbol NVDA 192.53 -1.64% — —" [ref=e480]:
                  - button "Drag NVDA" [ref=e481]:
                    - img [ref=e482]
                  - generic "Flag this symbol" [ref=e489] [cursor=pointer]
                  - generic [ref=e490]:
                    - generic [ref=e492]: "N"
                    - generic [ref=e494]: NVDA
                  - generic [ref=e495]: "192.53"
                  - generic [ref=e496]: "-1.64%"
                  - generic [ref=e497]: —
                  - generic [ref=e498]: —
                  - generic "Remove" [ref=e499]:
                    - img [ref=e500]
                - option "Drag AAPL Flag this symbol AAPL 283.78 +3.14% — —" [ref=e502]:
                  - button "Drag AAPL" [ref=e503]:
                    - img [ref=e504]
                  - generic "Flag this symbol" [ref=e511] [cursor=pointer]
                  - generic [ref=e512]:
                    - generic [ref=e514]: A
                    - generic [ref=e516]: AAPL
                  - generic [ref=e517]: "283.78"
                  - generic [ref=e518]: +3.14%
                  - generic [ref=e519]: —
                  - generic [ref=e520]: —
                  - generic "Remove" [ref=e521]:
                    - img [ref=e522]
                - option "Drag MSFT Flag this symbol MSFT 372.97 +5.71% — —" [ref=e524]:
                  - button "Drag MSFT" [ref=e525]:
                    - img [ref=e526]
                  - generic "Flag this symbol" [ref=e533] [cursor=pointer]
                  - generic [ref=e534]:
                    - generic [ref=e536]: M
                    - generic [ref=e538]: MSFT
                  - generic [ref=e539]: "372.97"
                  - generic [ref=e540]: +5.71%
                  - generic [ref=e541]: —
                  - generic [ref=e542]: —
                  - generic "Remove" [ref=e543]:
                    - img [ref=e544]
                - option "Drag QQQ Flag this symbol QQQ 706.52 -1.38% — —" [ref=e546]:
                  - button "Drag QQQ" [ref=e547]:
                    - img [ref=e548]
                  - generic "Flag this symbol" [ref=e555] [cursor=pointer]
                  - generic [ref=e556]:
                    - generic [ref=e558]: Q
                    - generic [ref=e560]: QQQ
                  - generic [ref=e561]: "706.52"
                  - generic [ref=e562]: "-1.38%"
                  - generic [ref=e563]: —
                  - generic [ref=e564]: —
                  - generic "Remove" [ref=e565]:
                    - img [ref=e566]
              - status [ref=e568]
        - generic [ref=e569]:
          - generic [ref=e570]:
            - generic [ref=e572]: "N"
            - generic [ref=e573]:
              - generic [ref=e574]: NVIDIA Corp
              - generic [ref=e575]: NVDA · Equities
            - button "Open full analysis" [ref=e576] [cursor=pointer]:
              - img [ref=e577]
            - generic [ref=e579]:
              - generic [ref=e580]: "192.53"
              - generic [ref=e581]: "-1.64%"
          - generic [ref=e582]:
            - generic [ref=e583]:
              - button "Open Intelligence workspace" [ref=e584] [cursor=pointer]:
                - generic [ref=e585]:
                  - generic [ref=e586]:
                    - img [ref=e587]
                    - text: Intelligence
                  - img [ref=e590]
                - generic [ref=e592]:
                  - generic [ref=e593]:
                    - generic [ref=e594]: Oracle
                    - generic [ref=e595]: Uptrend — no entry signal
                    - generic [ref=e596]: "Historical signal: Structure stop · Signal date unverified"
                  - generic [ref=e597]:
                    - generic [ref=e598]: Research
                    - generic [ref=e599]: No current reading
                    - generic [ref=e600]: View details
                - generic [ref=e601]:
                  - generic [ref=e602]: Prophet
                  - generic [ref=e603]: Sign in to view
                - generic [ref=e605]: Oracle entry unverified · No current data
              - generic [ref=e607]:
                - generic [ref=e608]: Trend
                - generic [ref=e609]: Uptrend
                - generic [ref=e610]: weeks–months
            - generic [ref=e611]:
              - generic [ref=e612]:
                - img [ref=e613]
                - generic [ref=e615]: Deep analysis coming online
                - generic [ref=e616]: This name isn't in the research desk yet — the chart, levels and oracle verdict above are live.
              - generic [ref=e617]:
                - generic [ref=e619]: Key stats
                - generic [ref=e620]:
                  - generic [ref=e621]:
                    - generic [ref=e622]: Volume
                    - generic [ref=e623]: 179.30 M
                  - generic [ref=e624]:
                    - generic [ref=e625]: Avg volume (30D)
                    - generic [ref=e626]: 170.09 M
              - generic [ref=e627]:
                - generic [ref=e629]: Performance
                - generic [ref=e630]:
                  - generic [ref=e631]:
                    - generic [ref=e632]: "-8.62%"
                    - generic [ref=e633]: 1W
                  - generic [ref=e634]:
                    - generic [ref=e635]: "-9.44%"
                    - generic [ref=e636]: 1M
                  - generic [ref=e637]:
                    - generic [ref=e638]: +12.43%
                    - generic [ref=e639]: 3M
                  - generic [ref=e640]:
                    - generic [ref=e641]: +1.75%
                    - generic [ref=e642]: 6M
                  - generic [ref=e643]:
                    - generic [ref=e644]: +3.23%
                    - generic [ref=e645]: YTD
                  - generic [ref=e646]:
                    - generic [ref=e647]: +24.77%
                    - generic [ref=e648]: 1Y
              - generic [ref=e649]:
                - generic [ref=e651]: Technicals
                - generic [ref=e652]:
                  - img "23 of 100" [ref=e653]:
                    - generic [ref=e654]:
                      - img [ref=e655]
                      - generic:
                        - generic: "23"
                        - generic: Strong sell
                  - generic [ref=e659]:
                    - generic [ref=e660]: Sell 17
                    - generic [ref=e661]: Neutral 7
                    - generic [ref=e662]: Buy 2
                - button "More technicals ›" [ref=e663] [cursor=pointer]
              - generic [ref=e664]:
                - generic [ref=e665]:
                  - generic [ref=e666]: Realized volatility
                  - generic [ref=e667]: Historical prices · IV unavailable
                - generic [ref=e669]:
                  - img [ref=e671]:
                    - generic [ref=e673]: 35%
                    - generic [ref=e675]: 40%
                    - generic [ref=e677]: 45%
                    - generic [ref=e679]: 50%
                    - generic [ref=e681]: 55%
                  - generic [ref=e704]:
                    - generic [ref=e705]: 10d
                    - generic [ref=e707]: 42d
                    - generic [ref=e710]: 252d
                  - generic [ref=e711]:
                    - generic [ref=e712]: Current
                    - generic [ref=e714]: Median
              - region "Seasonality view context" [ref=e717]:
                - group "Linking for this view" [ref=e718]:
                  - button "Follow chart" [pressed] [ref=e719] [cursor=pointer]
                  - button "Pin this view" [ref=e720] [cursor=pointer]
                  - button "Unlink" [ref=e721] [cursor=pointer]
                - status [ref=e722]: "Following chart: NVDA"
                - paragraph [ref=e723]: Linking applies to this session only.
                - generic [ref=e724]:
                  - generic [ref=e725]:
                    - img [ref=e726]
                    - text: Seasonality · avg monthly return
                    - generic [ref=e729]: 10y
                  - radiogroup "Seasonality · avg monthly return" [ref=e730]:
                    - radio "Jan · +6.6% avg · WR 60% · n=5" [ref=e731] [cursor=pointer]:
                      - generic [ref=e734]: J
                    - radio "Feb · +8.7% avg · WR 60% · n=5" [ref=e735] [cursor=pointer]:
                      - generic [ref=e738]: F
                    - radio "Mar · +6.2% avg · WR 60% · n=5" [ref=e739] [cursor=pointer]:
                      - generic [ref=e742]: M
                    - radio "Apr · -4.3% avg · WR 40% · n=5" [ref=e743] [cursor=pointer]:
                      - generic [ref=e746]: A
                    - radio "May · +18.8% avg · WR 100% · n=5" [ref=e747] [cursor=pointer]:
                      - generic [ref=e750]: M
                    - radio "Jun · +2.8% avg · WR 60% · n=5" [ref=e751] [cursor=pointer]:
                      - generic [ref=e754]: J
                    - radio "Jul · +7.0% avg · WR 60% · n=5" [ref=e755] [cursor=pointer]:
                      - generic [ref=e758]: J
                    - radio "Aug · +0.7% avg · WR 60% · n=5" [ref=e759] [cursor=pointer]:
                      - generic [ref=e762]: A
                    - radio "Sep · -6.0% avg · WR 40% · n=5" [ref=e763] [cursor=pointer]:
                      - generic [ref=e766]: S
                    - radio "Oct · +9.2% avg · WR 80% · n=5" [ref=e767] [cursor=pointer]:
                      - generic [ref=e770]: O
                    - radio "Nov · +11.9% avg · WR 80% · n=5" [checked] [ref=e771] [cursor=pointer]:
                      - generic [ref=e774]: "N"
                    - radio "Dec · -3.0% avg · WR 40% · n=5" [ref=e775] [cursor=pointer]:
                      - generic [ref=e778]: D
                  - generic [ref=e779]:
                    - combobox "Seasonality · avg monthly return · Jan–Dec" [ref=e780]:
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
                    - status [ref=e781]: Nov · +11.9% avg · WR 80% · n=5
                  - generic [ref=e782]: Current month highlighted · from NVDA history (display-only context).
                  - button "More seasonals ›" [ref=e783] [cursor=pointer]
            - generic [ref=e784]:
              - button "Open full analysis" [ref=e785] [cursor=pointer]
              - button "Ask Mastermind AI about NVDA →" [ref=e786] [cursor=pointer]
    - generic [ref=e787]:
      - generic [ref=e788]: Movers
      - generic [ref=e790]:
        - generic [ref=e791]:
          - generic [ref=e792] [cursor=pointer]:
            - generic [ref=e793]: NVDA
            - generic [ref=e794]: "192.53"
            - generic [ref=e795]: "-1.64%"
          - generic [ref=e796] [cursor=pointer]:
            - generic [ref=e797]: AAPL
            - generic [ref=e798]: "283.78"
            - generic [ref=e799]: +3.14%
          - generic [ref=e800] [cursor=pointer]:
            - generic [ref=e801]: MSFT
            - generic [ref=e802]: "372.97"
            - generic [ref=e803]: +5.71%
          - generic [ref=e804] [cursor=pointer]:
            - generic [ref=e805]: GOOGL
            - generic [ref=e806]: "337.39"
            - generic [ref=e807]: "-1.84%"
          - generic [ref=e808] [cursor=pointer]:
            - generic [ref=e809]: AMZN
            - generic [ref=e810]: "232.69"
            - generic [ref=e811]: +2.50%
          - generic [ref=e812] [cursor=pointer]:
            - generic [ref=e813]: META
            - generic [ref=e814]: "550.25"
            - generic [ref=e815]: +1.36%
          - generic [ref=e816] [cursor=pointer]:
            - generic [ref=e817]: TSLA
            - generic [ref=e818]: "379.71"
            - generic [ref=e819]: +1.22%
          - generic [ref=e820] [cursor=pointer]:
            - generic [ref=e821]: AMD
            - generic [ref=e822]: "521.58"
            - generic [ref=e823]: "-2.06%"
          - generic [ref=e824] [cursor=pointer]:
            - generic [ref=e825]: AVGO
            - generic [ref=e826]: "365.02"
            - generic [ref=e827]: "-3.67%"
          - generic [ref=e828] [cursor=pointer]:
            - generic [ref=e829]: NFLX
            - generic [ref=e830]: "73.81"
            - generic [ref=e831]: +4.10%
          - generic [ref=e832] [cursor=pointer]:
            - generic [ref=e833]: CRM
            - generic [ref=e834]: "158.37"
            - generic [ref=e835]: +5.45%
          - generic [ref=e836] [cursor=pointer]:
            - generic [ref=e837]: SMCI
            - generic [ref=e838]: "30.63"
            - generic [ref=e839]: "-3.31%"
          - generic [ref=e840] [cursor=pointer]:
            - generic [ref=e841]: ARM
            - generic [ref=e842]: "334.27"
            - generic [ref=e843]: "-3.87%"
          - generic [ref=e844] [cursor=pointer]:
            - generic [ref=e845]: PLTR
            - generic [ref=e846]: "112.93"
            - generic [ref=e847]: +5.28%
          - generic [ref=e848] [cursor=pointer]:
            - generic [ref=e849]: MSTR
            - generic [ref=e850]: "82.31"
            - generic [ref=e851]: "-3.54%"
          - generic [ref=e852] [cursor=pointer]:
            - generic [ref=e853]: MU
            - generic [ref=e854]: 1,132.33
            - generic [ref=e855]: "-6.69%"
        - generic [ref=e856]:
          - generic [ref=e857] [cursor=pointer]:
            - generic [ref=e858]: NVDA
            - generic [ref=e859]: "192.53"
            - generic [ref=e860]: "-1.64%"
          - generic [ref=e861] [cursor=pointer]:
            - generic [ref=e862]: AAPL
            - generic [ref=e863]: "283.78"
            - generic [ref=e864]: +3.14%
          - generic [ref=e865] [cursor=pointer]:
            - generic [ref=e866]: MSFT
            - generic [ref=e867]: "372.97"
            - generic [ref=e868]: +5.71%
          - generic [ref=e869] [cursor=pointer]:
            - generic [ref=e870]: GOOGL
            - generic [ref=e871]: "337.39"
            - generic [ref=e872]: "-1.84%"
          - generic [ref=e873] [cursor=pointer]:
            - generic [ref=e874]: AMZN
            - generic [ref=e875]: "232.69"
            - generic [ref=e876]: +2.50%
          - generic [ref=e877] [cursor=pointer]:
            - generic [ref=e878]: META
            - generic [ref=e879]: "550.25"
            - generic [ref=e880]: +1.36%
          - generic [ref=e881] [cursor=pointer]:
            - generic [ref=e882]: TSLA
            - generic [ref=e883]: "379.71"
            - generic [ref=e884]: +1.22%
          - generic [ref=e885] [cursor=pointer]:
            - generic [ref=e886]: AMD
            - generic [ref=e887]: "521.58"
            - generic [ref=e888]: "-2.06%"
          - generic [ref=e889] [cursor=pointer]:
            - generic [ref=e890]: AVGO
            - generic [ref=e891]: "365.02"
            - generic [ref=e892]: "-3.67%"
          - generic [ref=e893] [cursor=pointer]:
            - generic [ref=e894]: NFLX
            - generic [ref=e895]: "73.81"
            - generic [ref=e896]: +4.10%
          - generic [ref=e897] [cursor=pointer]:
            - generic [ref=e898]: CRM
            - generic [ref=e899]: "158.37"
            - generic [ref=e900]: +5.45%
          - generic [ref=e901] [cursor=pointer]:
            - generic [ref=e902]: SMCI
            - generic [ref=e903]: "30.63"
            - generic [ref=e904]: "-3.31%"
          - generic [ref=e905] [cursor=pointer]:
            - generic [ref=e906]: ARM
            - generic [ref=e907]: "334.27"
            - generic [ref=e908]: "-3.87%"
          - generic [ref=e909] [cursor=pointer]:
            - generic [ref=e910]: PLTR
            - generic [ref=e911]: "112.93"
            - generic [ref=e912]: +5.28%
          - generic [ref=e913] [cursor=pointer]:
            - generic [ref=e914]: MSTR
            - generic [ref=e915]: "82.31"
            - generic [ref=e916]: "-3.54%"
          - generic [ref=e917] [cursor=pointer]:
            - generic [ref=e918]: MU
            - generic [ref=e919]: 1,132.33
            - generic [ref=e920]: "-6.69%"
  - alert [ref=e921]
```

# Test source

```ts
  43  |   }
  44  |   const picker = page.locator(".smodal-cmp");
  45  |   await expect(picker).toBeVisible();
  46  |   await picker.getByRole("combobox").fill("AAPL");
  47  |   await expect(picker.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
  48  |   const row = picker.locator(".r").filter({ has: page.locator(".tk", { hasText: /^AAPL$/ }) });
  49  |   await expect(row).toHaveCount(1);
  50  |   await row.getByRole("option").click();
  51  |   const percent = row.getByRole("button", { name: /^(Percent|百分比)$/ });
  52  |   await expect(percent).toBeEnabled();
  53  |   await percent.click();
  54  |   await picker.getByRole("button", { name: /^(Close comparison|关闭对比)$/ }).click();
  55  |   await expect(picker).toHaveCount(0);
  56  |   await expect(page.locator(".lg-row.is-cmp").filter({ hasText: "AAPL" })).toHaveCount(1);
  57  | }
  58  | 
  59  | async function returnFocus(page: Page, info: TestInfo, label: string) {
  60  |   const state = () => page.evaluate(() => {
  61  |     const active = document.activeElement;
  62  |     const element = active instanceof HTMLElement ? active : null;
  63  |     const row = element?.closest(".lg-row.is-cmp");
  64  |     const relevant = Boolean(element && (
  65  |       (row && row.textContent?.includes("AAPL")) ||
  66  |       element.matches(".cmp-btn, .lg-collapse")
  67  |     ));
  68  |     return {
  69  |       connected: element?.isConnected ?? false,
  70  |       visible: Boolean(element?.getClientRects().length),
  71  |       relevant,
  72  |       tag: element?.tagName ?? null,
  73  |       className: element?.className ?? null,
  74  |       label: element?.getAttribute("aria-label") ?? null,
  75  |     };
  76  |   });
  77  |   try {
  78  |     await expect.poll(async () => {
  79  |       const value = await state();
  80  |       return value.connected && value.visible && value.relevant;
  81  |     }).toBe(true);
  82  |   } finally {
  83  |     await info.attach(label, { body: JSON.stringify(await state(), null, 2), contentType: "application/json" });
  84  |   }
  85  | }
  86  | 
  87  | for (const lang of ["en", "zh"] as const) {
  88  |   test(`[${lang}] comparison settings edit the real overlay without losing modal or saved state`, async ({ page }, info) => {
  89  |     await useLang(page, lang);
  90  |     const errors: string[] = [];
  91  |     page.on("pageerror", (error) => errors.push(error.message));
  92  |     const width = page.viewportSize()!.width;
  93  |     await addComparison(page, width, info);
  94  |     const dialog = await openSettings(page, width <= 860);
  95  |     expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  96  |     await expect(dialog).toBeFocused();
  97  |     const thickness = dialog.getByRole("spinbutton", { name: /^(Thickness|粗细)$/ });
  98  |     const previous = await thickness.inputValue();
  99  |     await thickness.fill(""); await expect(thickness).toHaveValue("");
  100 |     await thickness.press("Tab"); await expect(thickness).toHaveValue(previous);
  101 |     await thickness.fill("9"); await expect(thickness).toHaveValue("9");
  102 |     await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL?.lineWidth ?? 2)).toBe(Number(previous));
  103 |     await thickness.press("Enter"); await expect(thickness).toHaveValue("4");
  104 |     const increase = dialog.getByRole("button", { name: /^(Increase thickness|增大粗细)$/ });
  105 |     await expect(increase).toBeDisabled();
  106 |     await dialog.getByRole("button", { name: /^(Dashed|虚线)$/ }).click();
  107 |     await dialog.getByRole("button", { name: /^(Price|价格)$/ }).click();
  108 |     await dialog.getByRole("button", { name: /^(Color|颜色): #26c281$/ }).click();
  109 |     await expect(dialog.locator('input[type="color"]')).toHaveValue("#26c281");
  110 |     await expect(dialog.locator("code")).toHaveText("#26C281");
  111 |     const saved = { color: "#26c281", lineWidth: 4, lineStyle: 2, mode: "price" };
  112 |     await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL)).toEqual(saved);
  113 |     for (const button of await dialog.getByRole("button").all()) {
  114 |       const rect = await button.boundingBox(); expect(rect).not.toBeNull();
  115 |       if (width <= 860) {
  116 |         expect(rect!.width).toBeGreaterThanOrEqual(44);
  117 |         expect(rect!.height).toBeGreaterThanOrEqual(44);
  118 |       }
  119 |       expect(await button.evaluate((element) => {
  120 |         const r = element.getBoundingClientRect();
  121 |         return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  122 |       })).toBe(true);
  123 |     }
  124 |     const close = dialog.getByRole("button", { name: /^(Close|关闭)$/ });
  125 |     const done = dialog.getByRole("button", { name: /^(Done|完成)$/ });
  126 |     await close.focus(); await page.keyboard.press("Shift+Tab"); await expect(done).toBeFocused();
  127 |     await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  128 |     await capture(page, info, "comparison-settings");
  129 |     await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  130 |     await returnFocus(page, info, "escape-return-focus");
  131 |     const reopened = await openSettings(page, width <= 860);
  132 |     await expect(reopened.getByRole("spinbutton")).toHaveValue("4");
  133 |     await expect(reopened.getByRole("button", { name: /^(Dashed|虚线)$/ })).toHaveAttribute("aria-pressed", "true");
  134 |     await reopened.getByRole("button", { name: /^(Done|完成)$/ }).click();
  135 |     await expect(reopened).toHaveCount(0);
  136 |     await returnFocus(page, info, "done-return-focus");
  137 |     const finalDialog = await openSettings(page, width <= 860);
  138 |     await finalDialog.getByRole("button", { name: /^(Close|关闭)$/ }).click();
  139 |     await expect(finalDialog).toHaveCount(0);
  140 |     await returnFocus(page, info, "close-return-focus");
  141 |     await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL)).toEqual(saved);
  142 |     expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
> 143 |     expect(errors).toEqual([]);
      |                    ^ Error: expect(received).toEqual(expected) // deep equality
  144 |   });
  145 | }
  146 | 
```