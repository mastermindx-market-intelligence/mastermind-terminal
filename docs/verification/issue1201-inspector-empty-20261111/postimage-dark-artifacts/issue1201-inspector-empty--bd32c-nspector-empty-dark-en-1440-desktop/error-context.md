# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: issue1201-inspector-empty-capture.spec.ts >> N3 width 1440 >> postimage: Inspector empty dark/en/1440
- Location: e2e/issue1201-inspector-empty-capture.spec.ts:61:11

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
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - img [ref=e5]
        - generic [ref=e9]:
          - generic [ref=e10]: MASTERMIND
          - generic [ref=e11]: TERMINAL
      - generic [ref=e13]: Options
      - button "Settings" [ref=e14] [cursor=pointer]: U
    - navigation "Primary" [ref=e15]:
      - link "Chart" [ref=e16] [cursor=pointer]:
        - /url: /terminal
        - img [ref=e17]
      - link "Analysis" [ref=e19] [cursor=pointer]:
        - /url: /analysis
        - img [ref=e20]
      - link "Discover" [ref=e22] [cursor=pointer]:
        - /url: /discover
        - img [ref=e23]
      - link "Dislocations" [ref=e28] [cursor=pointer]:
        - /url: /dislocations
        - img [ref=e29]
      - link "Options" [ref=e32] [cursor=pointer]:
        - /url: /options
        - img [ref=e33]
      - link "Scripts" [ref=e36] [cursor=pointer]:
        - /url: /scripts
        - img [ref=e37]
      - link "Portfolio" [ref=e41] [cursor=pointer]:
        - /url: /portfolio
        - img [ref=e42]
      - link "Alerts" [ref=e44] [cursor=pointer]:
        - /url: /alerts
        - img [ref=e45]
      - button "Mastermind AI" [ref=e48] [cursor=pointer]:
        - img [ref=e49]
    - main [ref=e51]:
      - generic [ref=e52]:
        - generic [ref=e53]:
          - generic [ref=e54]: Category
          - generic [ref=e55]:
            - tablist "Options categories" [ref=e56]:
              - tab "Command" [selected] [ref=e57] [cursor=pointer]
              - tab "Flow" [ref=e58] [cursor=pointer]
              - tab "Exposure" [ref=e59] [cursor=pointer]
              - tab "Structure" [ref=e60] [cursor=pointer]
              - tab "Volatility" [ref=e61] [cursor=pointer]
              - tab "Statistics" [ref=e62] [cursor=pointer]
              - tab "Prophet" [ref=e63] [cursor=pointer]
            - link "Futures depth & footprint" [ref=e64] [cursor=pointer]:
              - /url: /options/futures
              - text: Futures
            - button "Open the four-step options workflow · 0/4 viewed" [ref=e65] [cursor=pointer]:
              - img [ref=e66]
              - generic [ref=e69]: Workflow
              - generic [ref=e70]: 0/4 viewed
        - generic [ref=e71]:
          - generic [ref=e72]: View
          - tablist "Options views" [ref=e73]:
            - tab "Flow Desk" [selected] [ref=e74] [cursor=pointer]
      - generic [ref=e75]:
        - generic [ref=e76]:
          - 'generic "Market volatility regime: Mixed — normalizing" [ref=e77]':
            - generic [ref=e79]: Vol
            - text: Mixed — normalizing
          - generic [ref=e80]: as of 10:40:13delayed
        - generic [ref=e83]:
          - generic [ref=e84]:
            - generic [ref=e86]:
              - generic [ref=e87]:
                - generic [ref=e88]: Flow Gauge
                - generic [ref=e89]: Session 55% elapsed
              - generic [ref=e90]: $3.1M
              - generic [ref=e91]:
                - generic [ref=e92]: 76% C
                - generic [ref=e96]: 24% P
              - generic [ref=e97]:
                - generic [ref=e98]:
                  - generic [ref=e99]: Call Prem
                  - generic [ref=e100]: $2.3M
                - generic [ref=e101]:
                  - generic [ref=e102]: Put Prem
                  - generic [ref=e103]: $750K
                - generic [ref=e104]:
                  - generic [ref=e105]: P/C Ratio
                  - generic [ref=e106]: "0.32"
                - generic [ref=e107]:
                  - generic [ref=e108]: Tone
                  - generic [ref=e109]: CALL-HEAVY
            - complementary [ref=e110]:
              - generic [ref=e111]:
                - generic [ref=e112]:
                  - generic [ref=e113]: Session overview
                  - generic [ref=e114]:
                    - generic [ref=e115]: nightly + intraday
                    - button "Open tutorial" [ref=e116] [cursor=pointer]: "?"
                - generic [ref=e118]:
                  - generic [ref=e119]:
                    - generic [ref=e120]: Premium
                    - generic [ref=e121]: $638.5M
                  - generic [ref=e122]:
                    - generic [ref=e123]: Calls
                    - generic [ref=e124]: 52%
                  - generic [ref=e125]:
                    - generic [ref=e126]: P/C
                    - generic [ref=e127]: "0.91"
                - generic [ref=e131]:
                  - generic [ref=e132]: Calls
                  - generic [ref=e133]: Puts
              - generic [ref=e134]:
                - generic [ref=e135]:
                  - generic [ref=e136]: Watchlist
                  - generic [ref=e137]: Score
                - generic [ref=e139]:
                  - generic [ref=e140]: Click a ticker to watch
                  - generic [ref=e141]: Active today
                  - generic [ref=e142] [cursor=pointer]:
                    - button "AAPL Score unavailable" [ref=e143]:
                      - generic [ref=e144]: AAPL
                      - img "Score unavailable" [ref=e146]:
                        - img [ref=e147]
                        - generic [ref=e150]: —
                    - button "Add AAPL to watchlist" [ref=e152]: +
                  - generic [ref=e153] [cursor=pointer]:
                    - button "NVDA Score unavailable" [ref=e154]:
                      - generic [ref=e155]: NVDA
                      - img "Score unavailable" [ref=e157]:
                        - img [ref=e158]
                        - generic [ref=e161]: —
                    - button "Add NVDA to watchlist" [ref=e163]: +
            - generic [ref=e164]:
              - generic [ref=e165]:
                - generic [ref=e166]: Smart Money Radar
                - generic [ref=e167]: Baseline derived from prior 252 trading sessions. Direction labels are heuristic and approximate.
              - generic [ref=e168]:
                - generic [ref=e169]: Ticker
                - generic [ref=e170]: Activity
                - generic [ref=e171]: Premium
                - generic [ref=e172]: Calls
              - generic [ref=e174]:
                - generic [ref=e175]:
                  - generic [ref=e176]: AAPL
                  - generic [ref=e177]: Technology
                - generic [ref=e180]: Above avg
                - generic [ref=e181]: $2.4M
                - generic [ref=e182]: 76%
          - generic [ref=e184]:
            - generic [ref=e185]:
              - generic [ref=e186]: 9 SIGNALS
              - textbox "Search ticker…" [ref=e187]
              - generic [ref=e188]:
                - button "NEW" [ref=e189] [cursor=pointer]
                - button "SCORE" [ref=e190] [cursor=pointer]
              - button "Filters" [ref=e191] [cursor=pointer]
            - generic "Updated 2026-07-05T15:42:00Z; Source data 2026-07-05T14:34:51Z — 2026-07-05T15:40:32Z" [ref=e192]:
              - generic [ref=e193]: Market closed
              - generic [ref=e194]: · Last session
              - generic [ref=e195]: · Updated 128d 16h ago
              - generic [ref=e196]: · Source data 128d 16h–128d 17h ago
              - generic [ref=e197]: · Refresh cycle 1h 8m
            - generic [ref=e198]:
              - button "ALL" [ref=e199] [cursor=pointer]
              - button "Elite — top 2% of tape" [ref=e200] [cursor=pointer]
              - button "WHALES" [ref=e201] [cursor=pointer]
              - button "0DTE" [ref=e202] [cursor=pointer]
              - button "SWEEPS" [ref=e203] [cursor=pointer]
            - generic [ref=e204]:
              - generic [ref=e205]: 88 % of eligible premium classified · 12 % unknown
              - generic [ref=e206]: Calls $2.3M · Puts $750.0K · unsigned premium, not a direction
            - generic [ref=e207]:
              - 'option "AAPL Score unavailable 10:40 $216.0K Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $235 · 2026-10-23 · 2d Size 6,000 · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) Show score breakdown" [ref=e208] [cursor=pointer]':
                - generic [ref=e209]:
                  - generic [ref=e210]: AAPL
                  - img "Score unavailable" [ref=e212]:
                    - img [ref=e213]
                    - generic [ref=e216]: —
                  - generic [ref=e217]: 10:40
                - generic [ref=e218]:
                  - generic [ref=e219]: $216.0K
                  - generic [ref=e220]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e221]: Leans buy (approximate)
                - generic [ref=e223]: $235 · 2026-10-23 · 2d
                - generic [ref=e224]:
                  - generic [ref=e225]:
                    - generic [ref=e226]: Size 6,000
                    - generic [ref=e227]:
                      - generic [ref=e228]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e229]': CLUSTER
                  - button "Show score breakdown" [ref=e230]:
                    - img [ref=e231]
              - 'option "AAPL Score unavailable 10:40 $504.0K Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $230 · 2026-10-23 · 2d Size 6,000 · Open interest 3,680 · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) · Premium activity is much higher than its typical one-year level Show score breakdown" [selected] [ref=e233] [cursor=pointer]':
                - generic [ref=e234]:
                  - generic [ref=e235]: AAPL
                  - img "Score unavailable" [ref=e237]:
                    - img [ref=e238]
                    - generic [ref=e241]: —
                  - generic [ref=e242]: 10:40
                - generic [ref=e243]:
                  - generic [ref=e244]: $504.0K
                  - generic [ref=e245]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e246]: Leans buy (approximate)
                - generic [ref=e248]: $230 · 2026-10-23 · 2d
                - generic [ref=e249]:
                  - generic [ref=e250]:
                    - generic [ref=e251]: Size 6,000
                    - generic [ref=e252]: ·
                    - generic [ref=e253]: Open interest 3,680
                    - generic [ref=e254]:
                      - generic [ref=e255]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e256]': CLUSTER
                    - generic [ref=e257]:
                      - generic [ref=e258]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e259]: UNUSUAL
                  - button "Show score breakdown" [ref=e260]:
                    - img [ref=e261]
              - option "AAPL Score unavailable 10:39 $355.0K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $225 · 2026-10-23 · 2d Size 2,500 Show score breakdown" [ref=e263] [cursor=pointer]:
                - generic [ref=e264]:
                  - generic [ref=e265]: AAPL
                  - img "Score unavailable" [ref=e267]:
                    - img [ref=e268]
                    - generic [ref=e271]: —
                  - generic [ref=e272]: 10:39
                - generic [ref=e273]:
                  - generic [ref=e274]: $355.0K
                  - generic [ref=e275]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e276]: Not classified
                - generic [ref=e278]: $225 · 2026-10-23 · 2d
                - generic [ref=e279]:
                  - generic [ref=e281]: Size 2,500
                  - button "Show score breakdown" [ref=e282]:
                    - img [ref=e283]
              - 'option "AAPL Score unavailable 10:38 $259.2K Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $230 · 2026-10-23 · 2d Size 3,200 · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) Show score breakdown" [ref=e285] [cursor=pointer]':
                - generic [ref=e286]:
                  - generic [ref=e287]: AAPL
                  - img "Score unavailable" [ref=e289]:
                    - img [ref=e290]
                    - generic [ref=e293]: —
                  - generic [ref=e294]: 10:38
                - generic [ref=e295]:
                  - generic [ref=e296]: $259.2K
                  - generic [ref=e297]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e298]: Leans sell (approximate)
                - generic [ref=e300]: $230 · 2026-10-23 · 2d
                - generic [ref=e301]:
                  - generic [ref=e302]:
                    - generic [ref=e303]: Size 3,200
                    - generic [ref=e304]:
                      - generic [ref=e305]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e306]': CLUSTER
                  - button "Show score breakdown" [ref=e307]:
                    - img [ref=e308]
              - option "AAPL Score unavailable 10:37 $395.0K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $220 · 2026-10-23 · 2d Size 4,100 Show score breakdown" [ref=e310] [cursor=pointer]:
                - generic [ref=e311]:
                  - generic [ref=e312]: AAPL
                  - img "Score unavailable" [ref=e314]:
                    - img [ref=e315]
                    - generic [ref=e318]: —
                  - generic [ref=e319]: 10:37
                - generic [ref=e320]:
                  - generic [ref=e321]: $395.0K
                  - generic [ref=e322]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e323]: Mixed
                - generic [ref=e325]: $220 · 2026-10-23 · 2d
                - generic [ref=e326]:
                  - generic [ref=e328]: Size 4,100
                  - button "Show score breakdown" [ref=e329]:
                    - img [ref=e330]
              - 'option "AAPL Score unavailable 10:36 $266.8K Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $230 · 2026-10-23 · 2d Size 2,900 · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) Show score breakdown" [ref=e332] [cursor=pointer]':
                - generic [ref=e333]:
                  - generic [ref=e334]: AAPL
                  - img "Score unavailable" [ref=e336]:
                    - img [ref=e337]
                    - generic [ref=e340]: —
                  - generic [ref=e341]: 10:36
                - generic [ref=e342]:
                  - generic [ref=e343]: $266.8K
                  - generic [ref=e344]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e345]: Leans buy (approximate)
                - generic [ref=e347]: $230 · 2026-10-23 · 2d
                - generic [ref=e348]:
                  - generic [ref=e349]:
                    - generic [ref=e350]: Size 2,900
                    - generic [ref=e351]:
                      - generic [ref=e352]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e353]': CLUSTER
                  - button "Show score breakdown" [ref=e354]:
                    - img [ref=e355]
              - 'option "AAPL Score unavailable 10:36 $80.0K Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $230 · 2026-10-23 · 2d Size 1,000 · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) Show score breakdown" [ref=e357] [cursor=pointer]':
                - generic [ref=e358]:
                  - generic [ref=e359]: AAPL
                  - img "Score unavailable" [ref=e361]:
                    - img [ref=e362]
                    - generic [ref=e365]: —
                  - generic [ref=e366]: 10:36
                - generic [ref=e367]:
                  - generic [ref=e368]: $80.0K
                  - generic [ref=e369]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e370]: Leans buy (approximate)
                - generic [ref=e372]: $230 · 2026-10-23 · 2d
                - generic [ref=e373]:
                  - generic [ref=e374]:
                    - generic [ref=e375]: Size 1,000
                    - generic [ref=e376]:
                      - generic [ref=e377]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e378]': CLUSTER
                  - button "Show score breakdown" [ref=e379]:
                    - img [ref=e380]
              - option "AAPL Score unavailable 10:35 $315.0K Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $240 · 2026-11-20 · 30d Size 1,500 Show score breakdown" [ref=e382] [cursor=pointer]:
                - generic [ref=e383]:
                  - generic [ref=e384]: AAPL
                  - img "Score unavailable" [ref=e386]:
                    - img [ref=e387]
                    - generic [ref=e390]: —
                  - generic [ref=e391]: 10:35
                - generic [ref=e392]:
                  - generic [ref=e393]: $315.0K
                  - generic [ref=e394]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e395]: Leans buy (approximate)
                - generic [ref=e397]: $240 · 2026-11-20 · 30d
                - generic [ref=e398]:
                  - generic [ref=e400]: Size 1,500
                  - button "Show score breakdown" [ref=e401]:
                    - img [ref=e402]
              - option "NVDA Score unavailable 10:34 $680.0K Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $190 · 2026-10-23 · 2d Size 2,000 · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e404] [cursor=pointer]:
                - generic [ref=e405]:
                  - generic [ref=e406]: NVDA
                  - img "Score unavailable" [ref=e408]:
                    - img [ref=e409]
                    - generic [ref=e412]: —
                  - generic [ref=e413]: 10:34
                - generic [ref=e414]:
                  - generic [ref=e415]: $680.0K
                  - generic [ref=e416]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e417]: Leans sell (approximate)
                - generic [ref=e419]: $190 · 2026-10-23 · 2d
                - generic [ref=e420]:
                  - generic [ref=e421]:
                    - generic [ref=e422]: Size 2,000
                    - generic [ref=e423]:
                      - generic [ref=e424]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e425]: UNUSUAL
                  - button "Show score breakdown" [ref=e426]:
                    - img [ref=e427]
          - generic [ref=e429]:
            - generic [ref=e430]:
              - generic [ref=e431]:
                - generic [ref=e432]: Chain Heat
                - generic "2026-07-07T16:00:00-04:00" [ref=e433]: Last session · Data 126d 11h ago
                - generic [ref=e434]: ≥$3M cumul
              - generic [ref=e435]: DISPLAY-ONLY — intraday chain-heat snapshot. Not investment advice.
              - generic [ref=e436]:
                - generic [ref=e437]:
                  - generic [ref=e438]: SMH
                  - generic [ref=e439]: Put
                  - generic [ref=e440]: $530 · 09-18
                  - generic [ref=e441]: $12.0M
                - generic [ref=e442]:
                  - generic [ref=e443]: accumulation
                  - generic [ref=e444]: ask-share derived — not NBBO
                - generic [ref=e445]:
                  - generic [ref=e446]: hits 29
                  - generic [ref=e447]: span 91m
                  - generic [ref=e448]: first seen 09:35 ET
                - generic [ref=e450]:
                  - generic [ref=e451]: Legacy category proxy · coverage unavailable
                  - generic [ref=e452]: 91%
              - generic [ref=e455]:
                - generic [ref=e456]:
                  - generic [ref=e457]: QQQ
                  - generic [ref=e458]: Call
                  - generic [ref=e459]: $640 · 09-18
                  - generic [ref=e460]: $6.4M
                - generic [ref=e461]:
                  - generic [ref=e462]: contested
                  - generic [ref=e463]: ask-share derived — not NBBO
                - generic [ref=e464]:
                  - generic [ref=e465]: hits 14
                  - generic [ref=e466]: span 58m
                  - generic [ref=e467]: first seen 10:11 ET
                - generic [ref=e469]:
                  - generic [ref=e470]: Legacy category proxy · coverage unavailable
                  - generic [ref=e471]: 44%
              - generic [ref=e474]:
                - generic [ref=e475]:
                  - generic [ref=e476]: NVDA
                  - generic [ref=e477]: Call
                  - generic [ref=e478]: $200 · 09-19
                  - generic [ref=e479]: $4.1M
                - generic [ref=e480]:
                  - generic [ref=e481]: accumulation
                  - generic [ref=e482]: ask-share derived — not NBBO
                - generic [ref=e483]:
                  - generic [ref=e484]: hits 11
                  - generic [ref=e485]: span 124m
                  - generic [ref=e486]: first seen 09:42 ET
                - generic [ref=e488]:
                  - generic [ref=e489]: Legacy category proxy · coverage unavailable
                  - generic [ref=e490]: 78%
              - generic [ref=e493]:
                - generic [ref=e494]:
                  - generic [ref=e495]: SPY
                  - generic [ref=e496]: Put
                  - generic [ref=e497]: $530 · 09-18
                  - generic [ref=e498]: $3.8M
                - generic [ref=e499]:
                  - generic [ref=e500]: accumulation
                  - generic [ref=e501]: ask-share derived — not NBBO
                - generic [ref=e502]:
                  - generic [ref=e503]: hits 9
                  - generic [ref=e504]: span 47m
                  - generic [ref=e505]: first seen 11:05 ET
                - generic [ref=e507]:
                  - generic [ref=e508]: Legacy category proxy · coverage unavailable
                  - generic [ref=e509]: 82%
            - generic [ref=e512]:
              - generic [ref=e513]:
                - generic [ref=e514]:
                  - generic [ref=e515]: AAPL
                  - generic [ref=e516]: 230C · Oct 23
                - generic [ref=e517]:
                  - img "Score unavailable" [ref=e518]:
                    - img [ref=e519]
                    - generic [ref=e522]: —
                  - generic [ref=e523]:
                    - generic [ref=e524]: $504K
                    - generic [ref=e525]: 6,000 ct · 2d · ~Buy lean
              - generic [ref=e526]:
                - generic [ref=e527]:
                  - generic [ref=e528]: SELECTED PRINT
                  - generic [ref=e529]: AAPL 230 C · Oct 23, 2026
                  - generic [ref=e530]: Event 10:40:12 ET · receipt not supplied by the flow owner · exchange and conditions not supplied
                  - generic [ref=e531]: $504,000 = 6,000 × $0.84 × 100
                  - generic [ref=e532]:
                    - generic [ref=e533]: SIDE · ESTIMATE
                    - generic [ref=e534]: Bought · estimate
                    - generic [ref=e535]: "method: tick rule on the tape"
                    - generic [ref=e536]: confidence not supplied by the flow owner
                  - generic [ref=e537]:
                    - generic [ref=e538]: LINEAGE
                    - generic [ref=e539]: original, corrected or cancelled — not supplied by the flow owner
                    - generic [ref=e540]: quote at trade not supplied by the flow owner
                  - generic [ref=e541]:
                    - generic [ref=e542]: PACKAGES
                    - generic [ref=e543]: No package source is admitted. Similar timestamps alone never group prints.
                  - generic [ref=e544]:
                    - generic [ref=e545]: CONTRACT ACTIVITY
                    - generic [ref=e546]: 1.63× prior open interest · OI date not supplied by the flow owner
                - generic [ref=e548]: Score components
                - generic [ref=e549]:
                  - generic [ref=e550]: Session context
                  - generic [ref=e551]:
                    - generic [ref=e552]: Gross$3.8M
                    - generic [ref=e553]: Call%50%
                    - generic [ref=e554]: Events162
                    - generic [ref=e555]:
                      - text: Day activity
                      - generic [ref=e556]:
                        - text: Above avg
                        - generic [ref=e557]: (Premium so far today compared with the past 252 full trading days; not adjusted for the time of day.)
                - generic [ref=e558]:
                  - generic [ref=e559]: Direction lean
                  - generic [ref=e560]: ~Buy lean
                - generic [ref=e561]: Direction is inferred from the last trade’s price change — not confirmed by the official bid and ask
                - generic [ref=e562]:
                  - generic [ref=e563]: Event Fields
                  - generic [ref=e564]:
                    - generic [ref=e565]: Time10:40:12 ET
                    - generic [ref=e566]: TickerAAPL
                    - generic [ref=e567]: GroupTechnology
                    - generic [ref=e568]: TypeCall
                    - generic [ref=e569]: Strike$230
                    - generic [ref=e570]: ExpiryOct 23
                    - generic [ref=e571]: DTE2
                    - generic [ref=e572]: DTE Bucket1_7d
                    - generic [ref=e573]: Moneynessatm
                    - generic [ref=e574]: Size (ct)6,000
                    - generic [ref=e575]: Avg Price$0.84
                    - generic [ref=e576]: Premium$504K
                    - generic [ref=e577]: N Prints4
                    - generic [ref=e578]: RepeatedYes
                    - generic [ref=e579]: Zero DTENo
                    - generic [ref=e580]:
                      - text: Premium activity
                      - generic [ref=e581]:
                        - text: Above avg
                        - generic [ref=e582]: (z252)
                    - generic [ref=e583]: Vol > OIYes — volume exceeded open interest
                    - generic [ref=e584]: Signingtape
                - generic [ref=e585]:
                  - generic [ref=e586]: AAPL — Top Contracts
                  - generic [ref=e587]:
                    - generic [ref=e588]: C 345 Aug 21
                    - generic [ref=e589]: $652K
                  - generic [ref=e590]:
                    - generic [ref=e591]: C 345 Jul 31
                    - generic [ref=e592]: $619K
                  - generic [ref=e593]:
                    - generic [ref=e594]: P 506 Jul 31
                    - generic [ref=e595]: $471K
                  - generic [ref=e596]:
                    - generic [ref=e597]: C 437 Aug 21
                    - generic [ref=e598]: $148K
                  - generic [ref=e599]:
                    - generic [ref=e600]: P 414 Jul 10
                    - generic [ref=e601]: $620K
        - generic [ref=e602]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e603]
```

# Test source

```ts
  38  |   }
  39  |   await expect(page.locator("html")).toHaveAttribute("data-mmx-shared-shell", "1");
  40  |   const host = page.locator(width === 390 ? ".mobilebar" : "header.topbar");
  41  |   await expect(host).toBeVisible();
  42  |   const controls = host.getByRole("group", { name: /^(Appearance and language|外观与语言)$/ });
  43  |   await expect(controls).toBeVisible();
  44  |   const chinese = controls.getByRole("button", { name: /^(Chinese language|中文界面)$/ });
  45  |   const wantsChinese = String(lang === "zh");
  46  |   if (await chinese.getAttribute("aria-pressed") !== wantsChinese) await chinese.click();
  47  |   await expect(chinese).toHaveAttribute("aria-pressed", wantsChinese);
  48  |   await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  49  |   const light = controls.getByRole("button", { name: /^(Light theme|浅色主题)$/ });
  50  |   if (await light.getAttribute("aria-pressed") !== "true") await light.click();
  51  |   await expect(light).toHaveAttribute("aria-pressed", "true");
  52  |   await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  53  | }
  54  | 
  55  | for (const width of [1440, 390] as const) {
  56  |   test.describe(`N3 width ${width}`, () => {
  57  |     test.use({ viewport: { width, height: width === 1440 ? 900 : 844 }, hasTouch: width === 390 });
  58  |     for (const theme of ["dark", "light"] as const) for (const lang of ["en", "zh"] as const) {
  59  |       if (theme !== requestedTheme) continue;
  60  |       if (phase === "baseline" && !(width === 1440 && theme === "light" && lang === "en")) continue;
  61  |       test(`${phase}: Inspector empty ${theme}/${lang}/${width}`, async ({ page }, testInfo) => {
  62  |         const before = hashes();
  63  |         const errors: string[] = [];
  64  |         page.on("pageerror", error => errors.push(error.message));
  65  |         await page.addInitScript(locale => {
  66  |           localStorage.setItem("mm.lang", locale);
  67  |           localStorage.setItem("flowdesk.tutorial.seen", "1");
  68  |           document.documentElement.setAttribute("data-lang", locale);
  69  |         }, lang);
  70  |         const feed = (flowFixture as { feed: unknown }).feed;
  71  |         await page.route(url => (url.pathname === "/api/flow" || url.pathname === "/api/flow/stream") && url.searchParams.get("f") === "feed", async route => {
  72  |           if (new URL(route.request().url()).pathname.endsWith("/stream")) {
  73  |             await route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify(feed)}\n\n` });
  74  |           } else {
  75  |             await route.fulfill({ status: 200, json: feed });
  76  |           }
  77  |         });
  78  |         await page.goto("/options?tab=desk");
  79  |         await expect(page.getByTestId("flow-coverage")).toBeVisible({ timeout: 45_000 });
  80  |         await selectPublicPresentation(page, width, lang, theme);
  81  |         const card = page.locator('[data-tut="flow-inspector"]');
  82  |         const empty = card.locator(".obs-insp-empty");
  83  |         const title = empty.locator(".obs-insp-empty-title");
  84  |         const why = empty.locator(".obs-insp-empty-why");
  85  |         await expect(empty).toBeVisible();
  86  |         await expect(card).not.toHaveClass(/has-event/);
  87  |         await expect(title).toHaveText(FD.inspectorEmpty[lang]);
  88  |         await expect(why).toHaveText(FD.inspectorEmptyWhy[lang]);
  89  |         await card.scrollIntoViewIfNeeded();
  90  |         await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  91  |         const geometry = await card.evaluate(el => {
  92  |           const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  93  |           const container = el.querySelector(".obs-insp-empty") as HTMLElement;
  94  |           const titleEl = el.querySelector(".obs-insp-empty-title") as HTMLElement;
  95  |           const whyEl = el.querySelector(".obs-insp-empty-why") as HTMLElement;
  96  |           const rail = el.parentElement!;
  97  |           return {
  98  |             card: rect(el), rail: rect(rail), title: rect(titleEl), explanation: rect(whyEl),
  99  |             flexDirection: getComputedStyle(container).flexDirection,
  100 |             titleText: titleEl.textContent, explanationText: whyEl.textContent,
  101 |             explanationClientWidth: whyEl.clientWidth, explanationScrollWidth: whyEl.scrollWidth,
  102 |             pageClientWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth,
  103 |             theme: document.documentElement.getAttribute("data-theme"), lang: document.documentElement.getAttribute("data-lang"),
  104 |             viewport: { width: innerWidth, height: innerHeight },
  105 |           };
  106 |         });
  107 |         expect(geometry.theme).toBe(theme);
  108 |         expect(geometry.lang).toBe(lang);
  109 |         expect(geometry.card.x).toBeGreaterThanOrEqual(Math.max(0, geometry.rail.x) - 1);
  110 |         expect(geometry.card.right).toBeLessThanOrEqual(Math.min(width, geometry.rail.right) + 1);
  111 |         expect(geometry.card.y).toBeGreaterThanOrEqual(-1);
  112 |         expect(geometry.card.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
  113 |         expect(geometry.pageScrollWidth).toBeLessThanOrEqual(geometry.pageClientWidth + 1);
  114 |         if (phase === "postimage") {
  115 |           expect(geometry.flexDirection).toBe("column");
  116 |           expect(geometry.explanation.y).toBeGreaterThanOrEqual(geometry.title.bottom + 7);
  117 |           expect(geometry.explanation.width).toBeGreaterThanOrEqual(220);
  118 |           expect(geometry.explanationScrollWidth).toBeLessThanOrEqual(geometry.explanationClientWidth + 1);
  119 |           expect(geometry.explanation.x).toBeGreaterThanOrEqual(geometry.card.x + 15);
  120 |           expect(geometry.explanation.right).toBeLessThanOrEqual(geometry.card.right - 15);
  121 |         }
  122 |         const filename = `inspector-empty-${theme}-${lang}-${width}.png`;
  123 |         const imagePath = path.join(out, filename);
  124 |         await card.screenshot({ path: imagePath });
  125 |         await testInfo.attach(filename, { path: imagePath, contentType: "image/png" });
  126 |         let selectedEventCheck: null | { viewport: number; visible: boolean } = null;
  127 |         if (phase === "postimage" && lang === "en" && theme === "dark") {
  128 |           await page.locator('[data-tut="flow-card"]', { hasText: "$504.0K" }).click();
  129 |           await expect(card).toHaveClass(/has-event/);
  130 |           await expect(page.getByTestId("flow-print-inspector")).toBeVisible();
  131 |           await expect(empty).toHaveCount(0);
  132 |           const selectedWidth = await card.evaluate(el => el.getBoundingClientRect().width);
  133 |           expect(selectedWidth).toBeLessThanOrEqual(width);
  134 |           const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  135 |           expect(overflow).toBeLessThanOrEqual(1);
  136 |           selectedEventCheck = { viewport: width, visible: true };
  137 |         }
> 138 |         expect(errors).toEqual([]);
      |                        ^ Error: expect(received).toEqual(expected) // deep equality
  139 |         const after = hashes();
  140 |         expect(after).toEqual(before);
  141 |         writeFileSync(path.join(out, filename.replace(/\.png$/, ".json")), JSON.stringify({
  142 |           phase, shellVariant: theme === "light" ? "shared-shell" : "default-shell", route: "/options?tab=desk", syntheticFeedFixture: "options-r1-w3a-flow.json",
  143 |           viewport: page.viewportSize(), hasTouch: width === 390, theme, lang, geometry,
  144 |           selectedEventCheck, pageErrors: errors, sourceHashes: before,
  145 |           screenshotSha256: digest(readFileSync(imagePath)),
  146 |         }, null, 2) + "\n");
  147 |       });
  148 |     }
  149 |   });
  150 | }
  151 | 
```