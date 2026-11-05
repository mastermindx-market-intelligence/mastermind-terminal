# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-exposure-change-exact.spec.ts >> Change en: exact cohort values, source populations and keyboard presentation
- Location: e2e/options-exposure-change-exact.spec.ts:353:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 58

- Array []
+ Array [
+   Object {
+     "height": 44,
+     "minHeight": "44px",
+     "minWidth": "48px",
+     "text": "159",
+     "width": 49.6875,
+   },
+   Object {
+     "height": 44,
+     "minHeight": "44px",
+     "minWidth": "48px",
+     "text": "100",
+     "width": 49.6875,
+   },
+   Object {
+     "height": 44,
+     "minHeight": "44px",
+     "minWidth": "48px",
+     "text": "101",
+     "width": 49.6875,
+   },
+   Object {
+     "height": 44,
+     "minHeight": "44px",
+     "minWidth": "48px",
+     "text": "102",
+     "width": 49.6875,
+   },
+   Object {
+     "height": 44,
+     "minHeight": "44px",
+     "minWidth": "48px",
+     "text": "103",
+     "width": 49.6875,
+   },
+   Object {
+     "height": 44,
+     "minHeight": "44px",
+     "minWidth": "48px",
+     "text": "104",
+     "width": 49.6875,
+   },
+   Object {
+     "height": 44,
+     "minHeight": "44px",
+     "minWidth": "48px",
+     "text": "105",
+     "width": 49.6875,
+   },
+   Object {
+     "height": 44,
+     "minHeight": "44px",
+     "minWidth": "48px",
+     "text": "106",
+     "width": 49.6875,
+   },
+ ]
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
        - button "Settings" [ref=e11] [cursor=pointer]: U
    - generic [ref=e12]:
      - generic [ref=e14]:
        - img [ref=e15]
        - generic [ref=e19]:
          - generic [ref=e20]: MASTERMIND
          - generic [ref=e21]: TERMINAL
      - navigation [ref=e22]:
        - link "Chart" [ref=e23] [cursor=pointer]:
          - /url: /terminal
          - img [ref=e24]
          - text: Chart
        - link "Analysis" [ref=e26] [cursor=pointer]:
          - /url: /analysis
          - img [ref=e27]
          - text: Analysis
        - link "Discover" [ref=e29] [cursor=pointer]:
          - /url: /discover
          - img [ref=e30]
          - text: Discover
        - link "Dislocations" [ref=e35] [cursor=pointer]:
          - /url: /dislocations
          - img [ref=e36]
          - text: Dislocations
        - link "Options" [ref=e37] [cursor=pointer]:
          - /url: /options
          - img [ref=e38]
          - text: Options
        - link "Scripts" [ref=e41] [cursor=pointer]:
          - /url: /scripts
          - img [ref=e42]
          - text: Scripts
        - link "Portfolio" [ref=e46] [cursor=pointer]:
          - /url: /portfolio
          - img [ref=e47]
          - text: Portfolio
        - link "Alerts" [ref=e49] [cursor=pointer]:
          - /url: /alerts
          - img [ref=e50]
          - text: Alerts
        - button "Mastermind AI" [ref=e53] [cursor=pointer]:
          - img [ref=e54]
          - text: Mastermind AI
      - button "Settings" [ref=e57] [cursor=pointer]: U
    - main [ref=e58]:
      - generic [ref=e59]:
        - generic [ref=e61]:
          - tablist "Options categories" [ref=e62]:
            - tab "Command" [ref=e63] [cursor=pointer]
            - tab "Flow" [ref=e64] [cursor=pointer]
            - tab "Exposure" [selected] [ref=e65] [cursor=pointer]
            - tab "Structure" [ref=e66] [cursor=pointer]
            - tab "Volatility" [ref=e67] [cursor=pointer]
            - tab "Statistics" [ref=e68] [cursor=pointer]
            - tab "Prophet" [ref=e69] [cursor=pointer]
          - link "Futures depth & footprint" [ref=e70] [cursor=pointer]:
            - /url: /options/futures
            - text: Futures
          - button "Open the four-step options workflow · 1/4 viewed" [ref=e71] [cursor=pointer]:
            - img [ref=e72]
            - generic [ref=e75]: Workflow
            - generic [ref=e76]: 1/4 viewed
        - tablist "Options views" [ref=e78]:
          - tab "Exposure" [selected] [ref=e79] [cursor=pointer]
          - tab "Positioning" [ref=e80] [cursor=pointer]
          - tab "Levels" [ref=e81] [cursor=pointer]
      - generic [ref=e82]:
        - generic [ref=e87]:
          - navigation "Exposure workspace" [ref=e88]:
            - combobox "Exposure symbol" [ref=e89]: SPY
            - button "Structure" [pressed] [ref=e90] [cursor=pointer]
            - button "Compare" [ref=e91] [cursor=pointer]
            - button "Scanner" [ref=e92] [cursor=pointer]
            - generic [ref=e93]:
              - generic [ref=e94]: Data quality · 119
              - group [ref=e96]:
                - generic "Learn the view" [ref=e97] [cursor=pointer]: "?"
            - group [ref=e98]:
              - generic "Tools" [ref=e99] [cursor=pointer]
          - generic [ref=e100]:
            - generic [ref=e101]:
              - generic [ref=e102]:
                - generic [ref=e103]: OPTIONS · EXPOSURE · SPY
                - heading "SPY Exposure map" [level=2] [ref=e104]:
                  - text: SPY
                  - generic [ref=e105]: Exposure map
                - paragraph [ref=e106]:
                  - code [ref=e107]: SEC:US-ARCX-SPY · v2
                  - emphasis [ref=e108]: Vendor EOD approximation
                - paragraph [ref=e109]: reference spot $100 · 2026-10-19 · 3 expiries · 60 strikes
                - paragraph [ref=e110]: Modeled from open interest. Sign is an inventory assumption, not price direction.
              - generic [ref=e111]:
                - button "Sources & coverage ↗" [ref=e112] [cursor=pointer]
                - link "Open investigation" [ref=e113] [cursor=pointer]:
                  - /url: /analysis?view=investigations&symbol=SPY
            - generic [ref=e114]:
              - group "Exposure metric" [ref=e115]:
                - button "Gamma" [pressed] [ref=e116] [cursor=pointer]
                - button "Delta EXT" [ref=e117] [cursor=pointer]:
                  - text: Delta
                  - emphasis [ref=e118]: EXT
                - button "Vanna" [ref=e119] [cursor=pointer]:
                  - text: Vanna
                  - generic [ref=e120]: 🔒
                - button "Charm" [ref=e121] [cursor=pointer]:
                  - text: Charm
                  - generic [ref=e122]: 🔒
                - button "Combined" [ref=e123] [cursor=pointer]
              - generic [ref=e124]:
                - text: Expiration scope
                - combobox "Expiration scope" [ref=e125]:
                  - option "All supplied expirations" [selected]
                  - option "Source-session 0DTE"
                  - option "Next live economic expiry" [disabled]
                  - option "Live expiries this exchange week" [disabled]
                  - option "2026-10-23"
                  - option "2026-10-30"
                  - option "2026-11-06"
              - button "Gamma + Vanna layers" [ref=e126] [cursor=pointer]
              - generic [ref=e127]:
                - button "Signed net" [pressed] [ref=e128] [cursor=pointer]
                - button "Gross gamma" [ref=e129] [cursor=pointer]
          - paragraph [ref=e130]:
            - strong [ref=e131]: "Qualified / observed contracts: 119 / 120 · Not supplied: 1."
          - generic [ref=e132]:
            - generic [ref=e133]:
              - generic [ref=e134]: MEASURED NET · INCOMPLETE
              - strong [ref=e135]: +2.44e-10 M
              - generic [ref=e136]: per +1% spot
            - button "Provisional net leader 159 +2.44e-10M · 0.8% of gross" [ref=e137] [cursor=pointer]:
              - generic [ref=e138]: Provisional net leader
              - strong [ref=e139]: "159"
              - generic [ref=e140]: +2.44e-10M · 0.8% of gross
            - generic [ref=e141]:
              - generic [ref=e142]: CONTESTED · RUNNER-UP
              - emphasis [ref=e143]: n/a · single node
              - generic [ref=e144]: threshold 0.90 · runner-up-ratio/v1
            - generic [ref=e145]:
              - generic [ref=e146]: QUALIFIED CONTRACTS
              - strong [ref=e147]:
                - text: "119"
                - generic [ref=e148]: / 120
              - generic [ref=e149]: 1 without identity
            - generic [ref=e150]:
              - generic [ref=e151]: CLOCKS
              - strong [ref=e152]: Observed Not supplied
              - generic [ref=e153]: OI as of 2026-10-19 · published Not supplied
              - generic [ref=e154]: source available 10-20 09:00Z
          - generic [ref=e155]:
            - generic [ref=e156]:
              - generic [ref=e157]:
                - generic "Price timeframe" [ref=e158]:
                  - button "5m" [pressed] [ref=e159] [cursor=pointer]
                  - button "30m" [ref=e160] [cursor=pointer]
                  - button "2h" [ref=e161] [cursor=pointer]
                  - button "D" [ref=e162] [cursor=pointer]
                  - button "W" [ref=e163] [cursor=pointer]
                - generic [ref=e164]:
                  - button "MA references" [pressed] [ref=e165] [cursor=pointer]
                  - button "Reset view" [ref=e166] [cursor=pointer]
              - generic [ref=e167]:
                - generic "SMA 5 · D · 2026-06-26T16:00 ET" [ref=e168]:
                  - text: SMA 5 · D 734.9
                  - time [ref=e169]: 06-26
                - generic "EMA 21 · D · 2026-06-26T16:00 ET" [ref=e170]:
                  - text: EMA 21 · D 739.58
                  - time [ref=e171]: 06-26
                - generic "SMA 55 · D · 2026-06-26T16:00 ET" [ref=e172]:
                  - text: SMA 55 · D 730.14
                  - time [ref=e173]: 06-26
                - generic "SMA 34 · 5m · 2026-10-19T15:55 ET" [ref=e174]:
                  - text: SMA 34 · 5m 99.4
                  - time [ref=e175]: 10-19
                - generic [ref=e176]: Closed-bar snapshot references
              - generic "Price chart" [ref=e177]:
                - generic [ref=e179]:
                  - generic:
                    - generic:
                      - generic:
                        - generic:
                          - generic: S
                        - generic: SPY · 5m
                      - generic:
                        - generic: O100.40H100.89L100.10C100.64
                        - generic: +0.31 (+0.31%)
                  - table [ref=e182]:
                    - row [ref=e183]:
                      - cell
                      - cell [ref=e184]
                      - cell [ref=e188]
                    - row [ref=e192]:
                      - cell
                      - cell [ref=e193]
                      - cell [ref=e197]
                  - button "Show indicator list" [ref=e200] [cursor=pointer]:
                    - img [ref=e201]
                  - img
                  - img
                  - img
                  - generic:
                    - generic: SPY
                    - generic:
                      - generic: "100.64"
                      - generic: 00:00
                - generic [ref=e203]:
                  - generic [ref=e204]: + Positive exposure − Negative exposure ◆ Selected node
                  - generic [ref=e205]: Selected snapshot references · not historical evolution or a forecast
              - generic [ref=e206]:
                - generic [ref=e207]:
                  - generic [ref=e208]: CONFIRMED MOMENTUM
                  - button "Refresh" [ref=e209] [cursor=pointer]
                - generic [ref=e210]:
                  - button "5m · Stale bars · rsi14-w2-s60-v1 · Regular only" [pressed] [ref=e211] [cursor=pointer]:
                    - generic [ref=e212]: 5m
                    - strong [ref=e213]: Stale bars
                  - button "30m · Stale bars · rsi14-w2-s60-v1 · Regular only" [ref=e214] [cursor=pointer]:
                    - generic [ref=e215]: 30m
                    - strong [ref=e216]: Stale bars
                  - button "2h · Stale bars · rsi14-w2-s60-v1 · Regular only" [ref=e217] [cursor=pointer]:
                    - generic [ref=e218]: 2h
                    - strong [ref=e219]: Stale bars
                  - button "Daily · Stale bars · rsi14-w2-s60-v1 · Regular only" [ref=e220] [cursor=pointer]:
                    - generic [ref=e221]: Daily
                    - strong [ref=e222]: Stale bars
                  - button "Weekly · Stale bars · rsi14-w2-s60-v1 · Regular only" [ref=e223] [cursor=pointer]:
                    - generic [ref=e224]: Weekly
                    - strong [ref=e225]: Stale bars
                - generic [ref=e226]: rsi14-w2-s60-v1 · Regular only
                - group [ref=e227]:
                  - generic "Method, confirmation times & price sources" [ref=e228] [cursor=pointer]
            - complementary "Inspect a strike" [ref=e229]:
              - generic [ref=e230]: STRUCTURE AT A GLANCE
              - heading "Price to positioning" [level=3] [ref=e231]
              - paragraph [ref=e232]: Measured contributions · Totals, shares and rankings use qualified contributions only. Missing exposure is unknown; the leaders can change when coverage improves.
              - generic [ref=e233]:
                - generic [ref=e234]: $100
                - generic [ref=e235]: →
                - strong [ref=e236]: "159"
              - generic [ref=e237]:
                - term [ref=e238]: Distance from snapshot spot
                - definition [ref=e239]: +59 · +59%
                - term [ref=e240]: Signed net
                - definition [ref=e241]: +2.44e-10M
                - term [ref=e242]: Gross gamma
                - definition [ref=e243]: 2.44e-10M
                - term [ref=e244]: Share of covered gross gamma
                - definition [ref=e245]: 0.84%
              - generic [ref=e246]:
                - generic [ref=e247]: IMPLIED-VOLATILITY DISTANCE
                - strong [ref=e248]: 59 σ
                - generic [ref=e249]: 1-day scale · 2026-10-19
                - group [ref=e250]:
                  - generic "Basis" [ref=e251]
              - generic [ref=e252]:
                - generic [ref=e253]: INTERVENING STRIKES
                - button "101 0M" [ref=e254] [cursor=pointer]:
                  - generic [ref=e255]: "101"
                  - generic [ref=e256]: 0M
                - button "102 0M" [ref=e257] [cursor=pointer]:
                  - generic [ref=e258]: "102"
                  - generic [ref=e259]: 0M
                - button "103 0M" [ref=e260] [cursor=pointer]:
                  - generic [ref=e261]: "103"
                  - generic [ref=e262]: 0M
                - button "104 0M" [ref=e263] [cursor=pointer]:
                  - generic [ref=e264]: "104"
                  - generic [ref=e265]: 0M
                - button "105 0M" [ref=e266] [cursor=pointer]:
                  - generic [ref=e267]: "105"
                  - generic [ref=e268]: 0M
                - generic [ref=e269]: Distance investigation; no path or arrival probability.
              - generic [ref=e271]:
                - text: CONFIRMED MOMENTUM
                - heading "SPY · 5m" [level=4] [ref=e272]
                - strong [ref=e273]: Stale bars
                - generic [ref=e274]:
                  - term [ref=e275]: RSI profile
                  - definition [ref=e276]:
                    - text: RSI(14) · wing 2 · max span 60
                    - text: rsi14-w2-s60-v1 · Regular only
                  - term [ref=e277]: Latest close
                  - definition [ref=e278]: 2026-10-19 15:55 ET
              - generic [ref=e279]:
                - generic [ref=e280]: LARGEST NET NODES
                - button "01 159 +2.44e-10M" [ref=e281] [cursor=pointer]:
                  - generic [ref=e282]: 01 159
                  - generic [ref=e283]: +2.44e-10M
              - paragraph [ref=e284]: Modeled from open interest. Sign is an inventory assumption, not price direction.
          - generic [ref=e285]:
            - generic [ref=e286]:
              - generic [ref=e287]:
                - text: BOOK ANATOMY
                - heading "Observed book changes" [level=3] [ref=e288]
              - generic [ref=e289]:
                - button "Compare expiries" [ref=e290] [cursor=pointer]
                - button "Changes" [pressed] [ref=e291] [cursor=pointer]
                - button "Replay" [ref=e292] [cursor=pointer]
                - button "Review" [ref=e293] [cursor=pointer]
                - button "Scenario" [ref=e294] [cursor=pointer]
                - button "Surface" [ref=e295] [cursor=pointer]
                - button "Exact values" [ref=e296] [cursor=pointer]
            - generic [ref=e297]:
              - generic [ref=e298]:
                - strong [ref=e299]: Market Memory
                - generic [ref=e300]: GAMMA · ALL EXPIRIES
              - generic [ref=e301]:
                - generic [ref=e302]:
                  - strong [ref=e303]: Matched reported contributions
                  - generic [ref=e304]: 119 matched contracts
                - generic [ref=e305]:
                  - time [ref=e306]: 2026-10-16
                  - generic [ref=e307]: →
                  - time [ref=e308]: 2026-10-19
                - paragraph [ref=e309]: USD delta per 1% spot move
                - generic "Reported and qualified coverage" [ref=e310]:
                  - generic [ref=e311]:
                    - term [ref=e312]: Reported contracts
                    - definition [ref=e313]: 120 → 120
                  - generic [ref=e314]:
                    - term [ref=e315]: Qualified contributions
                    - definition [ref=e316]: 119 → 119
                - paragraph [ref=e317]: Covers only matching reported contracts. This does not establish trading flow.
                - region "What changed in reported Gamma?" [ref=e318]:
                  - heading "What changed in reported Gamma?" [level=3] [ref=e319]
                  - generic [ref=e320]: Matched reported Gamma · same contracts on both sessions
                  - paragraph [ref=e321]: 2026-10-16 → 2026-10-19
                  - group "Value display" [ref=e322]:
                    - button "Compact" [ref=e323] [cursor=pointer]
                    - button "Exact USD" [pressed] [ref=e324] [cursor=pointer]
                  - paragraph [ref=e325]: USD amounts without display rounding. The supplied number is preserved; original decimal text is not supplied.
                  - generic [ref=e326]:
                    - heading "Total for the matched contracts" [level=4] [ref=e327]
                    - generic [ref=e328]:
                      - generic [ref=e329]:
                        - generic [ref=e330]: Previous net
                        - strong [ref=e331]: $0.00048828125
                      - generic [ref=e332]:
                        - generic [ref=e333]: Current net
                        - strong [ref=e334]: $0.000244140625
                    - generic [ref=e335]:
                      - generic [ref=e336]:
                        - generic [ref=e337]: Net change
                        - strong [ref=e338]: −$0.000244140625
                      - generic [ref=e339]:
                        - generic [ref=e340]: Net magnitude change
                        - strong [ref=e341]: −$0.000244140625
                      - generic [ref=e342]:
                        - generic [ref=e343]: Gross change
                        - strong [ref=e344]: −$0.029052734375
                    - paragraph [ref=e345]: 119 contracts matched
                    - group [ref=e346]:
                      - generic "Reported membership and qualification" [active] [ref=e347] [cursor=pointer]
                      - generic [ref=e348]:
                        - generic [ref=e349]:
                          - generic [ref=e350]: Matched
                          - strong [ref=e351]: "119"
                        - generic [ref=e352]:
                          - generic [ref=e353]: Only in previous
                          - strong [ref=e354]: "0"
                        - generic [ref=e355]:
                          - generic [ref=e356]: Only in current
                          - strong [ref=e357]: "0"
                        - generic [ref=e358]:
                          - generic [ref=e359]: Lost qualification
                          - strong [ref=e360]: "0"
                        - generic [ref=e361]:
                          - generic [ref=e362]: Gained qualification
                          - strong [ref=e363]: "0"
                        - generic [ref=e364]:
                          - generic [ref=e365]: Reported previously
                          - strong [ref=e366]: "120"
                        - generic [ref=e367]:
                          - generic [ref=e368]: Reported currently
                          - strong [ref=e369]: "120"
                        - generic [ref=e370]:
                          - generic [ref=e371]: Unavailable in either session
                          - strong [ref=e372]: "1"
                      - paragraph [ref=e373]: Counted separately; never added into the change.
                      - paragraph [ref=e374]: Counts describe supplied rows. Categories can overlap and are not summed. Source collection coverage is not supplied.
                    - paragraph [ref=e375]: Shown strikes retain the supplied ranking. A selected strike can appear after that set.
                    - table "Matched reported Gamma by strike · USD" [ref=e377]:
                      - caption [ref=e378]: Matched reported Gamma by strike · USD
                      - rowgroup [ref=e385]:
                        - row "Strike Net change Net magnitude change Gross change Previous net → Current net" [ref=e386]:
                          - columnheader "Strike" [ref=e387]
                          - columnheader "Net change" [ref=e388]
                          - columnheader "Net magnitude change" [ref=e389]
                          - columnheader "Gross change" [ref=e390]
                          - columnheader "Previous net → Current net" [ref=e391]
                      - rowgroup [ref=e392]:
                        - row "Select strike 159 −$0.000244140625 −$0.000244140625 −$0.000244140625 $0.00048828125 $0.000244140625" [ref=e393]:
                          - rowheader "Select strike 159" [ref=e394]:
                            - button "Select strike 159" [pressed] [ref=e395] [cursor=pointer]: "159"
                          - cell "−$0.000244140625" [ref=e396]
                          - cell "−$0.000244140625" [ref=e397]
                          - cell "−$0.000244140625" [ref=e398]
                          - cell "$0.00048828125 $0.000244140625" [ref=e399]:
                            - generic [ref=e400]:
                              - generic [ref=e401]: $0.00048828125
                              - generic [ref=e402]: →
                              - generic [ref=e403]: $0.000244140625
                        - row "Select strike 100 $0 $0 −$0.00048828125 $0 $0" [ref=e404]:
                          - rowheader "Select strike 100" [ref=e405]:
                            - button "Select strike 100" [ref=e406] [cursor=pointer]: "100"
                          - cell "$0" [ref=e407]
                          - cell "$0" [ref=e408]
                          - cell "−$0.00048828125" [ref=e409]
                          - cell "$0 $0" [ref=e410]:
                            - generic [ref=e411]:
                              - generic [ref=e412]: $0
                              - generic [ref=e413]: →
                              - generic [ref=e414]: $0
                        - row "Select strike 101 $0 $0 −$0.00048828125 $0 $0" [ref=e415]:
                          - rowheader "Select strike 101" [ref=e416]:
                            - button "Select strike 101" [ref=e417] [cursor=pointer]: "101"
                          - cell "$0" [ref=e418]
                          - cell "$0" [ref=e419]
                          - cell "−$0.00048828125" [ref=e420]
                          - cell "$0 $0" [ref=e421]:
                            - generic [ref=e422]:
                              - generic [ref=e423]: $0
                              - generic [ref=e424]: →
                              - generic [ref=e425]: $0
                        - row "Select strike 102 $0 $0 −$0.00048828125 $0 $0" [ref=e426]:
                          - rowheader "Select strike 102" [ref=e427]:
                            - button "Select strike 102" [ref=e428] [cursor=pointer]: "102"
                          - cell "$0" [ref=e429]
                          - cell "$0" [ref=e430]
                          - cell "−$0.00048828125" [ref=e431]
                          - cell "$0 $0" [ref=e432]:
                            - generic [ref=e433]:
                              - generic [ref=e434]: $0
                              - generic [ref=e435]: →
                              - generic [ref=e436]: $0
                        - row "Select strike 103 $0 $0 −$0.00048828125 $0 $0" [ref=e437]:
                          - rowheader "Select strike 103" [ref=e438]:
                            - button "Select strike 103" [ref=e439] [cursor=pointer]: "103"
                          - cell "$0" [ref=e440]
                          - cell "$0" [ref=e441]
                          - cell "−$0.00048828125" [ref=e442]
                          - cell "$0 $0" [ref=e443]:
                            - generic [ref=e444]:
                              - generic [ref=e445]: $0
                              - generic [ref=e446]: →
                              - generic [ref=e447]: $0
                        - row "Select strike 104 $0 $0 −$0.00048828125 $0 $0" [ref=e448]:
                          - rowheader "Select strike 104" [ref=e449]:
                            - button "Select strike 104" [ref=e450] [cursor=pointer]: "104"
                          - cell "$0" [ref=e451]
                          - cell "$0" [ref=e452]
                          - cell "−$0.00048828125" [ref=e453]
                          - cell "$0 $0" [ref=e454]:
                            - generic [ref=e455]:
                              - generic [ref=e456]: $0
                              - generic [ref=e457]: →
                              - generic [ref=e458]: $0
                        - row "Select strike 105 $0 $0 −$0.00048828125 $0 $0" [ref=e459]:
                          - rowheader "Select strike 105" [ref=e460]:
                            - button "Select strike 105" [ref=e461] [cursor=pointer]: "105"
                          - cell "$0" [ref=e462]
                          - cell "$0" [ref=e463]
                          - cell "−$0.00048828125" [ref=e464]
                          - cell "$0 $0" [ref=e465]:
                            - generic [ref=e466]:
                              - generic [ref=e467]: $0
                              - generic [ref=e468]: →
                              - generic [ref=e469]: $0
                        - row "Select strike 106 $0 $0 −$0.00048828125 $0 $0" [ref=e470]:
                          - rowheader "Select strike 106" [ref=e471]:
                            - button "Select strike 106" [ref=e472] [cursor=pointer]: "106"
                          - cell "$0" [ref=e473]
                          - cell "$0" [ref=e474]
                          - cell "−$0.00048828125" [ref=e475]
                          - cell "$0 $0" [ref=e476]:
                            - generic [ref=e477]:
                              - generic [ref=e478]: $0
                              - generic [ref=e479]: →
                              - generic [ref=e480]: $0
                    - paragraph [ref=e481]: 52 strikes outside the ranked set
                  - paragraph [ref=e482]: "Two sessions only: no rate, no percent, no attribution."
                  - paragraph [ref=e483]: Reported Gamma is a dated measurement, not observed dealer inventory.
              - group [ref=e484]:
                - generic "Original measurements and comparison details" [ref=e485] [cursor=pointer]
          - group [ref=e486]:
            - generic "Stored book snapshots" [ref=e487] [cursor=pointer]
            - option "Latest (live)" [selected]
            - option "2026-10-16"
          - group [ref=e488]:
            - generic "Source & coverage" [ref=e489] [cursor=pointer]
        - generic [ref=e490]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e491]
```

# Test source

```ts
  249 |   await page.screenshot({ path: `test-results/${name}.png`, fullPage: false });
  250 |   expect(page.viewportSize()).toEqual(viewport);
  251 |   writeFileSync(`test-results/${name}-capture.json`, JSON.stringify({ schema: "d08b.viewport_capture.v1", viewport, fullPage: false, ...observed }, null, 2));
  252 | }
  253 | 
  254 | test("baseline: existing change inspector phone presentation", async ({ page }, info) => {
  255 |   test.skip(process.env.D08B_CHANGE_BEFORE !== "1" || info.project.name !== "desktop", "Explicit before-change evidence only.");
  256 |   await page.setViewportSize({ width: 320, height: 844 });
  257 |   const panel = await enter(page, "zh");
  258 |   const table = panel.locator("table");
  259 |   await capture(page, table.locator("tbody tr").first().getByRole("button"), "d08b-change-before-320-zh");
  260 |   const bounds = await panel.evaluate(root => {
  261 |     const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
  262 |     return { viewport: innerWidth, panel: rect(root), table: rect(root.querySelector("table")!),
  263 |       buttons: [...root.querySelectorAll("button")].map(el => ({ text: el.textContent, ...rect(el) })),
  264 |       headers: [...root.querySelectorAll("th")].map(el => ({ text: el.textContent, ...rect(el) })) };
  265 |   });
  266 |   writeFileSync("test-results/d08b-change-before-320-zh-bounds.json", JSON.stringify(bounds, null, 2));
  267 | });
  268 | 
  269 | 
  270 | async function fit(panel: Locator) {
  271 |   const bad = await panel.evaluate(root => {
  272 |     const box = root.getBoundingClientRect(); let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
  273 |     for (let parent = root.parentElement; parent; parent = parent.parentElement) {
  274 |       if (!/hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
  275 |       const r = parent.getBoundingClientRect(); left = Math.max(left, r.left); right = Math.min(right, r.right);
  276 |     }
  277 |     const failures: string[] = [];
  278 |     for (const el of root.querySelectorAll("button,summary,table,th,td,p,dt,dd,h3,h4,span,strong")) {
  279 |       if (!el.getClientRects().length) continue;
  280 |       const disclosure = el.closest("details:not([open])");
  281 |       if (disclosure && !disclosure.querySelector("summary")?.contains(el)) continue;
  282 |       const rects = [el.getBoundingClientRect()];
  283 |       for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
  284 |         const range = document.createRange(); range.selectNodeContents(node); rects.push(...range.getClientRects());
  285 |       }
  286 |       if (rects.some(r => r.width && (r.left < left - 1 || r.right > right + 1))) failures.push(`${el.tagName}: ${el.textContent?.slice(0, 60)}`);
  287 |     }
  288 |     return failures;
  289 |   });
  290 |   expect(bad).toEqual([]);
  291 | }
  292 | 
  293 | async function measureContrast(panel: Locator) {
  294 |   return panel.evaluate(root => {
  295 |     const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  296 |     const ctx = canvas.getContext("2d")!;
  297 |     const rgba = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
  298 |     const background = (el: Element): number[] => {
  299 |       for (let node: Element | null = el; node; node = node.parentElement) {
  300 |         const c = rgba(getComputedStyle(node).backgroundColor); if (c[3] === 255) return c;
  301 |       }
  302 |       throw new Error("No opaque background found for contrast sample");
  303 |     };
  304 |     const luminance = (color: number[]) => color.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  305 |     const ratio = (a: number[], b: number[]) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  306 |     const texts = [...root.querySelectorAll("button,summary,p,th,td,dt,dd,h3,h4,span,strong")].filter(el => {
  307 |       const disclosure = el.closest("details:not([open])");
  308 |       return el.getClientRects().length && (!disclosure || disclosure.querySelector("summary")?.contains(el));
  309 |     });
  310 |     const text = texts.map(el => ({ text: el.textContent?.slice(0, 70), ratio: ratio(rgba(getComputedStyle(el)[el instanceof SVGElement ? "fill" : "color"]), background(el)) }));
  311 |     const marks = [...root.querySelectorAll("svg path,svg line[stroke-dasharray]")].filter(el => el.getClientRects().length).map(el => ({
  312 |       shape: el.tagName, ratio: ratio(rgba(getComputedStyle(el).stroke), background(el)),
  313 |     }));
  314 |     return { text, marks };
  315 |   });
  316 | }
  317 | 
  318 | function visibleRow(panel: Locator, strike: number) {
  319 |   return panel.locator('[data-strike="' + strike + '"]:visible');
  320 | }
  321 | function valueControls(panel: Locator, lang: "en" | "zh") {
  322 |   const group = panel.getByTestId("change-values-controls");
  323 |   return {
  324 |     compact: group.getByRole("button", { name: lang === "en" ? "Compact" : "紧凑", exact: true }),
  325 |     exact: group.getByRole("button", { name: lang === "en" ? "Exact USD" : "精确美元", exact: true }),
  326 |   };
  327 | }
  328 | async function exactRow(row: Locator, values: Record<string, string>) {
  329 |   for (const [key, value] of Object.entries(values)) await expect(row.locator('[data-field="' + key + '"]')).toHaveText(value);
  330 | }
  331 | async function populationCounts(panel: Locator, counts: Record<string, number>) {
  332 |   const disclosure = panel.locator("details");
  333 |   if (!await disclosure.getAttribute("open").then(value => value !== null)) {
  334 |     await disclosure.locator("summary").focus();
  335 |     await panel.page().keyboard.press("Enter");
  336 |   }
  337 |   await expect(disclosure).toHaveAttribute("open", "");
  338 |   for (const [key, value] of Object.entries(counts)) await expect(panel.locator('[data-population="' + key + '"] strong')).toHaveText(String(value));
  339 | }
  340 | async function controlsFit(panel: Locator) {
  341 |   const small = await panel.locator("button:visible,summary:visible").evaluateAll(elements => elements.filter(el => {
  342 |     const r = el.getBoundingClientRect();
  343 |     const minimum = el.hasAttribute("data-strike-choice") ? 48 : 44;
  344 |     return r.width < minimum || r.height < minimum;
  345 |   }).map(el => {
  346 |     const r = el.getBoundingClientRect(), style = getComputedStyle(el);
  347 |     return { text: el.textContent, width: r.width, height: r.height, minWidth: style.minWidth, minHeight: style.minHeight };
  348 |   }));
> 349 |   expect(small).toEqual([]);
      |                 ^ Error: expect(received).toEqual(expected) // deep equality
  350 | }
  351 | 
  352 | for (const lang of ["en", "zh"] as const) {
  353 |   test("Change " + lang + ": exact cohort values, source populations and keyboard presentation", async ({ page }, info) => {
  354 |     const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  355 |     const pair = changeSourcePair();
  356 |     const panel = await enter(page, lang, { current: () => pair.current, previous: () => pair.previous });
  357 |     const controls = valueControls(panel, lang);
  358 |     const initialSelection = await panel.locator("button[data-strike-choice][aria-pressed=true]:visible").evaluateAll(elements => elements.map(el => el.getAttribute("data-strike-choice")));
  359 |     for (const theme of ["dark", "light-tokens"] as const) {
  360 |       await applyD08BPanelPresentation(panel, theme);
  361 |       await controls.compact.focus(); await page.keyboard.press("Enter");
  362 |       await expect(controls.compact).toBeFocused();
  363 |       await expect(visibleRow(panel, 159).locator('[data-field="signedChangeUsd"]')).toHaveText("−$0");
  364 |       await fit(panel);
  365 |       await controls.exact.focus(); await page.keyboard.press("Enter");
  366 |       await expect(controls.exact).toBeFocused();
  367 |       await expect(controls.exact).toHaveAttribute("aria-pressed", "true");
  368 |       await expect(panel).toContainText("2026-10-16 → 2026-10-19");
  369 |       expect(await panel.locator("[data-strike]:visible").evaluateAll(elements => elements.map(el => Number(el.getAttribute("data-strike"))))).toEqual([...CHANGE_EXPECTED.precision.topStrikes]);
  370 |       await exactRow(visibleRow(panel, 159), {
  371 |         previousNetUsd: "$0.00048828125", currentNetUsd: "$0.000244140625",
  372 |         signedChangeUsd: "−$0.000244140625", netMagnitudeChangeUsd: "−$0.000244140625", grossChangeUsd: "−$0.000244140625",
  373 |       });
  374 |       await exactRow(visibleRow(panel, 100), {
  375 |         previousNetUsd: "$0", currentNetUsd: "$0", signedChangeUsd: "$0", netMagnitudeChangeUsd: "$0", grossChangeUsd: "−$0.00048828125",
  376 |       });
  377 |       for (const [key, value] of Object.entries({
  378 |         previousNetUsd: "$0.00048828125", currentNetUsd: "$0.000244140625",
  379 |         signedChangeUsd: "−$0.000244140625", netMagnitudeChangeUsd: "−$0.000244140625", grossChangeUsd: "−$0.029052734375",
  380 |       })) await expect(panel.getByTestId("change-aggregate-" + key)).toHaveText(value);
  381 |       expect(await panel.locator("button[data-strike-choice][aria-pressed=true]:visible").evaluateAll(elements => elements.map(el => el.getAttribute("data-strike-choice")))).toEqual(initialSelection);
  382 |       await populationCounts(panel, { matched: 119, previousOnly: 0, currentOnly: 0, qualificationLost: 0, qualificationGained: 0, previousObserved: 120, currentObserved: 120, unavailableEither: 1 });
  383 |       await fit(panel); await controlsFit(panel);
  384 |       const measured = await measureContrast(panel);
  385 |       writeFileSync("test-results/d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-contrast.json", JSON.stringify(measured, null, 2));
  386 |       expect(measured.text.filter(item => item.ratio < 4.5)).toEqual([]);
  387 |       await capture(page, controls.exact, "d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-controls");
  388 |       await capture(page, panel.locator('[data-population="unavailableEither"]'), "d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-population");
  389 |       await capture(page, visibleRow(panel, 159).locator('[data-field="currentNetUsd"]'), "d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-exact");
  390 |       await capture(page, visibleRow(panel, 106).getByRole("button"), "d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-last");
  391 |     }
  392 |     await controls.compact.focus(); await page.keyboard.press("Enter");
  393 |     await expect(visibleRow(panel, 159).locator('[data-field="signedChangeUsd"]')).toHaveText("−$0");
  394 |     await expect(panel.getByTestId("change-outside-rank")).toContainText("52");
  395 |     expect(errors).toEqual([]);
  396 |   });
  397 | }
  398 | 
  399 | test("Change: preserved selected strike, unmatched focus and access loss on the actual route", async ({ page }, info) => {
  400 |   test.skip(info.project.name !== "desktop", "One parent-selection and source-loss journey; every layout is covered above.");
  401 |   const pair = changeSourcePair("population");
  402 |   let status = 200;
  403 |   const panel = await enter(page, "en", { current: () => pair.current, previous: () => pair.previous, status: () => status });
  404 |   const map = page.getByTestId("exposure-map");
  405 |   const controls = valueControls(panel, "en");
  406 |   await controls.exact.click();
  407 |   await populationCounts(panel, { matched: 77, previousOnly: 40, currentOnly: 40, qualificationLost: 1, qualificationGained: 1, previousObserved: 120, currentObserved: 120, unavailableEither: 3 });
  408 |   await expect(panel.getByTestId("change-aggregate-previousNetUsd")).toHaveText("−$0.00048828125");
  409 |   await expect(panel.getByTestId("change-aggregate-currentNetUsd")).toHaveText("−$0.000244140625");
  410 |   await expect(panel.getByTestId("change-aggregate-signedChangeUsd")).toHaveText("+$0.000244140625");
  411 |   await expect(panel.getByTestId("change-aggregate-netMagnitudeChangeUsd")).toHaveText("−$0.000244140625");
  412 |   await expect(panel.getByTestId("change-aggregate-grossChangeUsd")).toHaveText("−$0.018798828125");
  413 |   await exactRow(visibleRow(panel, 101), { previousNetUsd: "−$0.00048828125", currentNetUsd: "−$0.000244140625", signedChangeUsd: "+$0.000244140625", netMagnitudeChangeUsd: "−$0.000244140625", grossChangeUsd: "−$0.000244140625" });
  414 |   await capture(page, visibleRow(panel, 101).getByRole("button"), "d08b-change-distinct-signs");
  415 | 
  416 |   // Invoke the actual parent callback from this inspector.
  417 |   await visibleRow(panel, 104).getByRole("button").focus(); await page.keyboard.press("Enter");
  418 |   await expect(visibleRow(panel, 104).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  419 |   await expect(map.getByTestId("exposure-node-inspector")).toBeVisible();
  420 |   await controls.compact.click(); await controls.exact.click();
  421 |   await expect(visibleRow(panel, 104).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  422 | 
  423 |   // Select outside the ranked set using the incumbent full strike table.
  424 |   await map.getByRole("button", { name: "Exact values", exact: true }).click();
  425 |   await map.getByRole("button", { name: "111", exact: true }).click();
  426 |   await map.getByRole("button", { name: "Changes", exact: true }).click();
  427 |   await expect(panel).toBeVisible();
  428 |   await valueControls(panel, "en").exact.click();
  429 |   expect(await panel.locator("[data-strike]:visible").evaluateAll(elements => elements.map(el => Number(el.getAttribute("data-strike"))))).toEqual([...CHANGE_EXPECTED.population.focusedRows]);
  430 |   await expect(visibleRow(panel, 111).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  431 |   await expect(panel.getByTestId("change-outside-rank")).toHaveText("32 strikes outside the ranked set");
  432 |   await capture(page, visibleRow(panel, 111).getByRole("button"), "d08b-change-appended-selected");
  433 | 
  434 |   await map.getByRole("button", { name: "Exact values", exact: true }).click();
  435 |   await map.getByRole("button", { name: "100", exact: true }).click();
  436 |   await map.getByRole("button", { name: "Changes", exact: true }).click();
  437 |   await expect(panel.getByTestId("change-focus-unavailable")).toHaveText("Selected strike 100 is outside this matched comparison.");
  438 |   await expect(panel.locator("button[data-strike-choice][aria-pressed=true]:visible")).toHaveCount(0);
  439 |   await capture(page, panel.getByTestId("change-focus-unavailable"), "d08b-change-unmatched-focus");
  440 | 
  441 |   status = 403; await page.clock.fastForward(30_001);
  442 |   await expect(panel).toHaveCount(0, { timeout: 20_000 });
  443 |   await expect(map).not.toContainText("0.000244140625");
  444 |   await expect(map.getByRole("button", { name: "Retry source read" })).toBeVisible();
  445 |   await capture(page, map.getByRole("button", { name: "Retry source read" }), "d08b-change-access-withdrawn");
  446 | });
  447 | 
  448 | test("Change: 320px, magnification, narrow pane and focus continuity", async ({ page }, info) => {
  449 |   test.skip(info.project.name !== "desktop", "Extra widths are exercised once.");
```