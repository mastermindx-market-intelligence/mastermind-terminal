# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-flowdesk-chainheat-load-failure.spec.ts >> a chain-heat read that answers 5xx is a load error with Retry, never "loading"
- Location: e2e/options-flowdesk-chainheat-load-failure.spec.ts:62:7

# Error details

```
Error: The chainheat 503 reply must actually be served

The chainheat 503 reply must actually be served

expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0

Call Log:
- Timeout 45000ms exceeded while waiting on the predicate
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
          - generic [ref=e80]: as of 11:42:00delayed
        - generic [ref=e83]:
          - generic [ref=e84]:
            - generic [ref=e86]:
              - generic [ref=e87]:
                - generic [ref=e88]: Flow Gauge
                - generic [ref=e89]: Session 72% elapsed
              - generic [ref=e90]: $12.7M
              - generic [ref=e91]:
                - generic [ref=e92]: 85% C
                - generic [ref=e96]: 15% P
              - generic [ref=e97]:
                - generic [ref=e98]:
                  - generic [ref=e99]: Call Prem
                  - generic [ref=e100]: $10.9M
                - generic [ref=e101]:
                  - generic [ref=e102]: Put Prem
                  - generic [ref=e103]: $1.8M
                - generic [ref=e104]:
                  - generic [ref=e105]: P/C Ratio
                  - generic [ref=e106]: "0.17"
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
                    - button "TSLA 88 out of 100" [ref=e143]:
                      - generic [ref=e144]: TSLA
                      - img "88 out of 100" [ref=e146]:
                        - img [ref=e147]
                        - generic [ref=e151]: "88"
                    - button "Add TSLA to watchlist" [ref=e153]: +
                  - generic [ref=e154] [cursor=pointer]:
                    - button "NVDA 77 out of 100" [ref=e155]:
                      - generic [ref=e156]: NVDA
                      - img "77 out of 100" [ref=e158]:
                        - img [ref=e159]
                        - generic [ref=e163]: "77"
                    - button "Add NVDA to watchlist" [ref=e165]: +
                  - generic [ref=e166] [cursor=pointer]:
                    - button "XLF 69 out of 100" [ref=e167]:
                      - generic [ref=e168]: XLF
                      - img "69 out of 100" [ref=e170]:
                        - img [ref=e171]
                        - generic [ref=e175]: "69"
                    - button "Add XLF to watchlist" [ref=e177]: +
                  - generic [ref=e178] [cursor=pointer]:
                    - button "GLD 66 out of 100" [ref=e179]:
                      - generic [ref=e180]: GLD
                      - img "66 out of 100" [ref=e182]:
                        - img [ref=e183]
                        - generic [ref=e187]: "66"
                    - button "Add GLD to watchlist" [ref=e189]: +
                  - generic [ref=e190] [cursor=pointer]:
                    - button "AAPL 64 out of 100" [ref=e191]:
                      - generic [ref=e192]: AAPL
                      - img "64 out of 100" [ref=e194]:
                        - img [ref=e195]
                        - generic [ref=e199]: "64"
                    - button "Add AAPL to watchlist" [ref=e201]: +
            - generic [ref=e202]:
              - generic [ref=e203]:
                - generic [ref=e204]: Smart Money Radar
                - generic [ref=e205]: Baseline derived from prior 252 trading sessions. Direction labels are heuristic and approximate.
              - generic [ref=e206]:
                - generic [ref=e207]: Ticker
                - generic [ref=e208]: Activity
                - generic [ref=e209]: Premium
                - generic [ref=e210]: Calls
              - generic [ref=e211]:
                - generic [ref=e212]:
                  - generic [ref=e213]:
                    - generic [ref=e214]: GLD
                    - generic [ref=e215]: Commodities
                  - generic [ref=e218]: Above avg
                  - generic [ref=e219]: $4.2M
                  - generic [ref=e220]: 88%
                - generic [ref=e221]:
                  - generic [ref=e222]:
                    - generic [ref=e223]: TSLA
                    - generic [ref=e224]: Consumer
                  - generic [ref=e227]: Above avg
                  - generic [ref=e228]: $5.8M
                  - generic [ref=e229]: 55%
                - generic [ref=e230]:
                  - generic [ref=e231]:
                    - generic [ref=e232]: NVDA
                    - generic [ref=e233]: Technology
                  - generic [ref=e236]: Above avg
                  - generic [ref=e237]: $3.1M
                  - generic [ref=e238]: 78%
                - generic [ref=e239]:
                  - generic [ref=e240]:
                    - generic [ref=e241]: SPY
                    - generic [ref=e242]: Index ETF
                  - generic [ref=e245]: Above avg
                  - generic [ref=e246]: $6.8M
                  - generic [ref=e247]: 42%
                - generic [ref=e248]:
                  - generic [ref=e249]:
                    - generic [ref=e250]: QQQ
                    - generic [ref=e251]: Index ETF
                  - generic [ref=e254]: Above avg
                  - generic [ref=e255]: $4.6M
                  - generic [ref=e256]: 58%
                - generic [ref=e257]:
                  - generic [ref=e258]:
                    - generic [ref=e259]: XLF
                    - generic [ref=e260]: Financials
                  - generic [ref=e262]: Unavailable
                  - generic [ref=e263]: $980K
                  - generic [ref=e264]: 92%
                - generic [ref=e265]:
                  - generic [ref=e266]:
                    - generic [ref=e267]: XLV
                    - generic [ref=e268]: Healthcare
                  - generic [ref=e270]: Unavailable
                  - generic [ref=e271]: $1.2M
                  - generic [ref=e272]: 30%
          - generic [ref=e274]:
            - generic [ref=e275]:
              - generic [ref=e276]: 12 SIGNALS
              - textbox "Search ticker…" [ref=e277]
              - generic [ref=e278]:
                - button "NEW" [ref=e279] [cursor=pointer]
                - button "SCORE" [ref=e280] [cursor=pointer]
              - button "Filters" [ref=e281] [cursor=pointer]
            - generic "Updated 2026-07-05T15:42:00Z; Source data 2026-07-05T14:34:51Z — 2026-07-05T15:40:32Z" [ref=e282]:
              - generic [ref=e283]: Connected
              - generic [ref=e285]: · Market closed
              - generic [ref=e286]: · Last session
              - generic [ref=e287]: · Updated 128d 15h ago
              - generic [ref=e288]: · Source data 128d 15h–128d 16h ago
              - generic [ref=e289]: · Refresh cycle 1h 8m
            - generic [ref=e290]:
              - button "ALL" [ref=e291] [cursor=pointer]
              - button "Elite — top 2% of tape" [ref=e292] [cursor=pointer]
              - button "WHALES" [ref=e293] [cursor=pointer]
              - button "0DTE" [ref=e294] [cursor=pointer]
              - button "SWEEPS" [ref=e295] [cursor=pointer]
            - generic [ref=e296]:
              - generic [ref=e297]: 100 % of eligible premium classified · 0 % unknown
              - generic [ref=e298]: Calls $10.9M · Puts $1.8M · unsigned premium, not a direction
            - generic [ref=e299]:
              - option "NVDA 77 out of 100 11:40 $1.2M Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $160 · 2026-07-18 · 13d Size 2,500 · Premium ≥$1M single event · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e300] [cursor=pointer]:
                - generic [ref=e301]:
                  - generic [ref=e302]: NVDA
                  - img "77 out of 100" [ref=e304]:
                    - img [ref=e305]
                    - generic [ref=e309]: "77"
                  - generic [ref=e310]: 11:40
                - generic [ref=e311]:
                  - generic [ref=e312]: $1.2M
                  - generic [ref=e313]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e314]: Leans buy (approximate)
                - generic [ref=e316]: $160 · 2026-07-18 · 13d
                - generic [ref=e317]:
                  - generic [ref=e318]:
                    - generic [ref=e319]: Size 2,500
                    - generic [ref=e320]:
                      - generic [ref=e321]: ·
                      - generic "Premium ≥$1M single event" [ref=e322]: WHALE
                    - generic [ref=e323]:
                      - generic [ref=e324]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e325]: UNUSUAL
                  - button "Show score breakdown" [ref=e326]:
                    - img [ref=e327]
              - option "SPY 26 out of 100 11:38 $99.0K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $545 · 2026-07-05 · 0d Size 1,800 Show score breakdown" [ref=e329] [cursor=pointer]:
                - generic [ref=e330]:
                  - generic [ref=e331]: SPY
                  - img "26 out of 100" [ref=e333]:
                    - img [ref=e334]
                    - generic [ref=e338]: "26"
                  - generic [ref=e339]: 11:38
                - generic [ref=e340]:
                  - generic [ref=e341]: $99.0K
                  - generic [ref=e342]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e343]: Leans buy (approximate)
                - generic [ref=e345]: $545 · 2026-07-05 · 0d
                - generic [ref=e346]:
                  - generic [ref=e348]: Size 1,800
                  - button "Show score breakdown" [ref=e349]:
                    - img [ref=e350]
              - 'option "AAPL 64 out of 100 11:35 $720.0K Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $220 · 2026-08-15 · 41d Size 3,000 · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e352] [cursor=pointer]':
                - generic [ref=e353]:
                  - generic [ref=e354]: AAPL
                  - img "64 out of 100" [ref=e356]:
                    - img [ref=e357]
                    - generic [ref=e361]: "64"
                  - generic [ref=e362]: 11:35
                - generic [ref=e363]:
                  - generic [ref=e364]: $720.0K
                  - generic [ref=e365]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e366]: Leans buy (approximate)
                - generic [ref=e368]: $220 · 2026-08-15 · 41d
                - generic [ref=e369]:
                  - generic [ref=e370]:
                    - generic [ref=e371]: Size 3,000
                    - generic [ref=e372]:
                      - generic [ref=e373]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e374]': CLUSTER
                    - generic [ref=e375]:
                      - generic [ref=e376]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e377]: UNUSUAL
                  - button "Show score breakdown" [ref=e378]:
                    - img [ref=e379]
              - option "XLE 45 out of 100 11:32 $925.0K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $88 · 2026-09-19 · 76d Size 5,000 Show score breakdown" [ref=e381] [cursor=pointer]:
                - generic [ref=e382]:
                  - generic [ref=e383]: XLE
                  - img "45 out of 100" [ref=e385]:
                    - img [ref=e386]
                    - generic [ref=e390]: "45"
                  - generic [ref=e391]: 11:32
                - generic [ref=e392]:
                  - generic [ref=e393]: $925.0K
                  - generic [ref=e394]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e395]: Leans sell (approximate)
                - generic [ref=e397]: $88 · 2026-09-19 · 76d
                - generic [ref=e398]:
                  - generic [ref=e400]: Size 5,000
                  - button "Show score breakdown" [ref=e401]:
                    - img [ref=e402]
              - option "META 59 out of 100 11:29 $984.0K Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $580 · 2026-07-11 · 6d Size 1,200 Show score breakdown" [ref=e404] [cursor=pointer]:
                - generic [ref=e405]:
                  - generic [ref=e406]: META
                  - img "59 out of 100" [ref=e408]:
                    - img [ref=e409]
                    - generic [ref=e413]: "59"
                  - generic [ref=e414]: 11:29
                - generic [ref=e415]:
                  - generic [ref=e416]: $984.0K
                  - generic [ref=e417]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e418]: Mixed
                - generic [ref=e420]: $580 · 2026-07-11 · 6d
                - generic [ref=e421]:
                  - generic [ref=e423]: Size 1,200
                  - button "Show score breakdown" [ref=e424]:
                    - img [ref=e425]
              - option "GLD 66 out of 100 11:25 $2.6M Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $250 · 2026-10-17 · 104d Size 4,000 · Premium ≥$1M single event · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e427] [cursor=pointer]:
                - generic [ref=e428]:
                  - generic [ref=e429]: GLD
                  - img "66 out of 100" [ref=e431]:
                    - img [ref=e432]
                    - generic [ref=e436]: "66"
                  - generic [ref=e437]: 11:25
                - generic [ref=e438]:
                  - generic [ref=e439]: $2.6M
                  - generic [ref=e440]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e441]: Leans buy (approximate)
                - generic [ref=e443]: $250 · 2026-10-17 · 104d
                - generic [ref=e444]:
                  - generic [ref=e445]:
                    - generic [ref=e446]: Size 4,000
                    - generic [ref=e447]:
                      - generic [ref=e448]: ·
                      - generic "Premium ≥$1M single event" [ref=e449]: WHALE
                    - generic [ref=e450]:
                      - generic [ref=e451]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e452]: UNUSUAL
                  - button "Show score breakdown" [ref=e453]:
                    - img [ref=e454]
              - 'option "MSFT 54 out of 100 11:21 $1.5M Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $460 · 2026-07-18 · 13d Size 800 · Premium ≥$1M single event · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) Show score breakdown" [ref=e456] [cursor=pointer]':
                - generic [ref=e457]:
                  - generic [ref=e458]: MSFT
                  - img "54 out of 100" [ref=e460]:
                    - img [ref=e461]
                    - generic [ref=e465]: "54"
                  - generic [ref=e466]: 11:21
                - generic [ref=e467]:
                  - generic [ref=e468]: $1.5M
                  - generic [ref=e469]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e470]: Leans buy (approximate)
                - generic [ref=e472]: $460 · 2026-07-18 · 13d
                - generic [ref=e473]:
                  - generic [ref=e474]:
                    - generic [ref=e475]: Size 800
                    - generic [ref=e476]:
                      - generic [ref=e477]: ·
                      - generic "Premium ≥$1M single event" [ref=e478]: WHALE
                    - generic [ref=e479]:
                      - generic [ref=e480]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e481]': CLUSTER
                  - button "Show score breakdown" [ref=e482]:
                    - img [ref=e483]
              - option "XLF 69 out of 100 11:18 $617.5K Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $46 · 2026-07-25 · 20d Size 6,500 · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e485] [cursor=pointer]:
                - generic [ref=e486]:
                  - generic [ref=e487]: XLF
                  - img "69 out of 100" [ref=e489]:
                    - img [ref=e490]
                    - generic [ref=e494]: "69"
                  - generic [ref=e495]: 11:18
                - generic [ref=e496]:
                  - generic [ref=e497]: $617.5K
                  - generic [ref=e498]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e499]: Leans buy (approximate)
                - generic [ref=e501]: $46 · 2026-07-25 · 20d
                - generic [ref=e502]:
                  - generic [ref=e503]:
                    - generic [ref=e504]: Size 6,500
                    - generic [ref=e505]:
                      - generic [ref=e506]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e507]: UNUSUAL
                  - button "Show score breakdown" [ref=e508]:
                    - img [ref=e509]
              - option "QQQ 14 out of 100 11:14 $26.4K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $490 · 2026-07-05 · 0d Size 2,200 Show score breakdown" [ref=e511] [cursor=pointer]:
                - generic [ref=e512]:
                  - generic [ref=e513]: QQQ
                  - img "14 out of 100" [ref=e515]:
                    - img [ref=e516]
                    - generic [ref=e520]: "14"
                  - generic [ref=e521]: 11:14
                - generic [ref=e522]:
                  - generic [ref=e523]: $26.4K
                  - generic [ref=e524]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e525]: Mixed
                - generic [ref=e527]: $490 · 2026-07-05 · 0d
                - generic [ref=e528]:
                  - generic [ref=e530]: Size 2,200
                  - button "Show score breakdown" [ref=e531]:
                    - img [ref=e532]
              - option "AMZN 58 out of 100 11:10 $795.0K Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $220 · 2026-08-01 · 27d Size 1,500 Show score breakdown" [ref=e534] [cursor=pointer]:
                - generic [ref=e535]:
                  - generic [ref=e536]: AMZN
                  - img "58 out of 100" [ref=e538]:
                    - img [ref=e539]
                    - generic [ref=e543]: "58"
                  - generic [ref=e544]: 11:10
                - generic [ref=e545]:
                  - generic [ref=e546]: $795.0K
                  - generic [ref=e547]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e548]: Leans buy (approximate)
                - generic [ref=e550]: $220 · 2026-08-01 · 27d
                - generic [ref=e551]:
                  - generic [ref=e553]: Size 1,500
                  - button "Show score breakdown" [ref=e554]:
                    - img [ref=e555]
              - option "XLV 44 out of 100 11:06 $798.0K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $148 · 2026-09-19 · 76d Size 3,800 Show score breakdown" [ref=e557] [cursor=pointer]:
                - generic [ref=e558]:
                  - generic [ref=e559]: XLV
                  - img "44 out of 100" [ref=e561]:
                    - img [ref=e562]
                    - generic [ref=e566]: "44"
                  - generic [ref=e567]: 11:06
                - generic [ref=e568]:
                  - generic [ref=e569]: $798.0K
                  - generic [ref=e570]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e571]: Leans buy (approximate)
                - generic [ref=e573]: $148 · 2026-09-19 · 76d
                - generic [ref=e574]:
                  - generic [ref=e576]: Size 3,800
                  - button "Show score breakdown" [ref=e577]:
                    - img [ref=e578]
              - 'option "TSLA 88 out of 100 11:02 $2.5M Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $300 · 2026-07-18 · 13d Size 2,000 · Premium ≥$1M single event · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e580] [cursor=pointer]':
                - generic [ref=e581]:
                  - generic [ref=e582]: TSLA
                  - img "88 out of 100" [ref=e584]:
                    - img [ref=e585]
                    - generic [ref=e589]: "88"
                  - generic [ref=e590]: 11:02
                - generic [ref=e591]:
                  - generic [ref=e592]: $2.5M
                  - generic [ref=e593]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e594]: Leans sell (approximate)
                - generic [ref=e596]: $300 · 2026-07-18 · 13d
                - generic [ref=e597]:
                  - generic [ref=e598]:
                    - generic [ref=e599]: Size 2,000
                    - generic [ref=e600]:
                      - generic [ref=e601]: ·
                      - generic "Premium ≥$1M single event" [ref=e602]: WHALE
                    - generic [ref=e603]:
                      - generic [ref=e604]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e605]': CLUSTER
                    - generic [ref=e606]:
                      - generic [ref=e607]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e608]: UNUSUAL
                  - button "Show score breakdown" [ref=e609]:
                    - img [ref=e610]
          - generic [ref=e612]:
            - generic [ref=e613]:
              - generic [ref=e614]:
                - generic [ref=e615]: Chain Heat
                - generic "2026-07-07T16:00:00-04:00" [ref=e616]: Last session · Data 126d 11h ago
                - generic [ref=e617]: ≥$3M cumul
              - generic [ref=e618]: DISPLAY-ONLY — intraday chain-heat snapshot. Not investment advice.
              - generic [ref=e619]:
                - generic [ref=e620]:
                  - generic [ref=e621]: SMH
                  - generic [ref=e622]: Put
                  - generic [ref=e623]: $530 · 09-18
                  - generic [ref=e624]: $12.0M
                - generic [ref=e625]:
                  - generic [ref=e626]: accumulation
                  - generic [ref=e627]: ask-share derived — not NBBO
                - generic [ref=e628]:
                  - generic [ref=e629]: hits 29
                  - generic [ref=e630]: span 91m
                  - generic [ref=e631]: first seen 09:35 ET
                - generic [ref=e633]:
                  - generic [ref=e634]: Legacy category proxy · coverage unavailable
                  - generic [ref=e635]: 91%
              - generic [ref=e638]:
                - generic [ref=e639]:
                  - generic [ref=e640]: QQQ
                  - generic [ref=e641]: Call
                  - generic [ref=e642]: $640 · 09-18
                  - generic [ref=e643]: $6.4M
                - generic [ref=e644]:
                  - generic [ref=e645]: contested
                  - generic [ref=e646]: ask-share derived — not NBBO
                - generic [ref=e647]:
                  - generic [ref=e648]: hits 14
                  - generic [ref=e649]: span 58m
                  - generic [ref=e650]: first seen 10:11 ET
                - generic [ref=e652]:
                  - generic [ref=e653]: Legacy category proxy · coverage unavailable
                  - generic [ref=e654]: 44%
              - generic [ref=e657]:
                - generic [ref=e658]:
                  - generic [ref=e659]: NVDA
                  - generic [ref=e660]: Call
                  - generic [ref=e661]: $200 · 09-19
                  - generic [ref=e662]: $4.1M
                - generic [ref=e663]:
                  - generic [ref=e664]: accumulation
                  - generic [ref=e665]: ask-share derived — not NBBO
                - generic [ref=e666]:
                  - generic [ref=e667]: hits 11
                  - generic [ref=e668]: span 124m
                  - generic [ref=e669]: first seen 09:42 ET
                - generic [ref=e671]:
                  - generic [ref=e672]: Legacy category proxy · coverage unavailable
                  - generic [ref=e673]: 78%
              - generic [ref=e676]:
                - generic [ref=e677]:
                  - generic [ref=e678]: SPY
                  - generic [ref=e679]: Put
                  - generic [ref=e680]: $530 · 09-18
                  - generic [ref=e681]: $3.8M
                - generic [ref=e682]:
                  - generic [ref=e683]: accumulation
                  - generic [ref=e684]: ask-share derived — not NBBO
                - generic [ref=e685]:
                  - generic [ref=e686]: hits 9
                  - generic [ref=e687]: span 47m
                  - generic [ref=e688]: first seen 11:05 ET
                - generic [ref=e690]:
                  - generic [ref=e691]: Legacy category proxy · coverage unavailable
                  - generic [ref=e692]: 82%
            - generic [ref=e696]:
              - generic [ref=e697]: Select an event to inspect
              - generic [ref=e698]: Click any card in the feed to open its full breakdown — score components, contract fields, detections, and the ticker's session context.
        - generic [ref=e699]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e700]
```

# Test source

```ts
  1   | import { expect, test, type Page, type Route } from "@playwright/test";
  2   | import { makeFlowT } from "@/lib/flowdeskStrings";
  3   | import { expectTapTarget } from "./tapTarget";
  4   | 
  5   | /**
  6   |  * Failure-state truth on the Flow Desk's Chain Heat rail, from the user's side.
  7   |  *
  8   |  * The rail read `chainheat` through flowGet, which turns every outcome that is not data into
  9   |  * null, so a 5xx or a refused request left it on "Loading chain heat…" until the next 45 s
  10  |  * poll — and, under a lasting failure, for ever. A read that did not land now renders a
  11  |  * load error with a Retry that re-reads in place; only a 404 says nothing is published.
  12  |  */
  13  | 
  14  | test.setTimeout(90_000);
  15  | 
  16  | type Reply = "503" | "abort" | "404" | "fixture";
  17  | 
  18  | async function installFlowReplies(page: Page, replies: Record<string, Reply>) {
  19  |   const served: { feed: string; reply: Exclude<Reply, "fixture"> }[] = [];
  20  |   await page.route(
  21  |     (url) => url.pathname === "/api/flow/intentional-b9-miss" && (replies[url.searchParams.get("f") ?? ""] ?? "fixture") !== "fixture",
  22  |     async (route: Route) => {
  23  |       // Snapshot the selected reply before awaiting it: Retry can later restore fixtures.
  24  |       const feed = new URL(route.request().url()).searchParams.get("f") ?? "";
  25  |       const reply = replies[feed];
  26  |       switch (reply) {
  27  |         case "503":
  28  |           await route.fulfill({ status: 503, json: { error: "feed unavailable" } });
  29  |           break;
  30  |         case "404":
  31  |           await route.fulfill({ status: 404, json: { error: "not published" } });
  32  |           break;
  33  |         case "abort":
  34  |           await route.abort("failed");
  35  |           break;
  36  |         default: return route.fallback();
  37  |       }
  38  |       // A matching request alone is insufficient: record only completed injection.
  39  |       served.push({ feed, reply });
  40  |     },
  41  |   );
  42  |   return served;
  43  | }
  44  | 
  45  | async function setLang(page: Page, lang: "en" | "zh") {
  46  |   await page.addInitScript((l) => {
  47  |     localStorage.setItem("mm.lang", l);
  48  |     localStorage.setItem("flowdesk.tutorial.seen", "1");
  49  |     document.documentElement.setAttribute("data-lang", l);
  50  |   }, lang);
  51  | }
  52  | 
  53  | async function expectNoPageOverflow(page: Page) {
  54  |   const doc = await page.evaluate(() => ({
  55  |     client: document.documentElement.clientWidth,
  56  |     scroll: document.documentElement.scrollWidth,
  57  |   }));
  58  |   expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
  59  | }
  60  | 
  61  | for (const failure of ["503", "abort"] as const) {
  62  |   test(`a chain-heat read that ${failure === "503" ? "answers 5xx" : "is refused"} is a load error with Retry, never "loading"`, async ({ page }, testInfo) => {
  63  |     const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  64  |     const t = makeFlowT(lang);
  65  |     const replies: Record<string, Reply> = { chainheat: failure };
  66  |     await setLang(page, lang);
  67  |     const served = await installFlowReplies(page, replies);
  68  | 
  69  |     await page.goto("/options?tab=desk");
  70  |     await expect.poll(
  71  |       () => served.filter((entry) => entry.feed === "chainheat" && entry.reply === failure).length,
  72  |       { message: `The chainheat ${failure} reply must actually be served`, timeout: 45_000 },
> 73  |     ).toBeGreaterThan(0);
      |       ^ Error: The chainheat 503 reply must actually be served
  74  |     const rail = page.locator('[data-tut="chain-heat"]');
  75  |     const loadError = rail.getByTestId("chainheat-load-error");
  76  |     await expect(loadError).toBeVisible({ timeout: 45_000 });
  77  |     await expect(loadError).toContainText(t("chainHeatError"));
  78  |     await expect(rail).not.toContainText(t("chainHeatLoading")); // the lie the bug told
  79  |     const retry = loadError.getByRole("button", { name: t("errRetry"), exact: true });
  80  |     await expect(retry).toBeVisible({ timeout: 20_000 });
  81  |     if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });
  82  |     await expectNoPageOverflow(page);
  83  | 
  84  |     // Retry into a healthy store: the same document recovers, with no reload.
  85  |     await page.evaluate(() => { (window as unknown as { __chainSameDocument?: boolean }).__chainSameDocument = true; });
  86  |     replies.chainheat = "fixture";
  87  |     await retry.click({ timeout: 20_000 });
  88  |     await expect(loadError).toHaveCount(0, { timeout: 20_000 });
  89  |     await expect(rail.locator(".obs-fd-chain-row").first()).toBeVisible({ timeout: 20_000 });
  90  |     expect(await page.evaluate(() => (window as unknown as { __chainSameDocument?: boolean }).__chainSameDocument)).toBe(true);
  91  |   });
  92  | }
  93  | 
  94  | test("nothing published for the session is shown only on a 404, with nothing to retry", async ({ page }, testInfo) => {
  95  |   const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  96  |   const t = makeFlowT(lang);
  97  |   await setLang(page, lang);
  98  |   const served = await installFlowReplies(page, { chainheat: "404" });
  99  | 
  100 |   await page.goto("/options?tab=desk");
  101 |   await expect.poll(
  102 |     () => served.filter((entry) => entry.feed === "chainheat" && entry.reply === "404").length,
  103 |     { message: "The chainheat 404 reply must actually be served", timeout: 45_000 },
  104 |   ).toBeGreaterThan(0);
  105 |   const rail = page.locator('[data-tut="chain-heat"]');
  106 |   await expect(rail.getByText(t("chainHeatAbsent"))).toBeVisible({ timeout: 45_000 });
  107 |   await expect(rail).not.toContainText(t("chainHeatLoading"));
  108 |   await expect(rail.getByText(t("chainHeatError"))).toHaveCount(0);
  109 |   await expect(rail.getByRole("button", { name: t("errRetry"), exact: true })).toHaveCount(0);
  110 |   await expectNoPageOverflow(page);
  111 | });
  112 | 
```