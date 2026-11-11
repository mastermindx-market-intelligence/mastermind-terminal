# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: issue1201-inspector-empty-capture.spec.ts >> N3 width 1440 >> baseline: Inspector empty light/en/1440
- Location: e2e/issue1201-inspector-empty-capture.spec.ts:61:11

# Error details

```
TypeError: Cannot read properties of undefined (reading '0')
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - link "Skip to content" [ref=e3] [cursor=pointer]:
      - /url: "#shared-shell-content"
    - banner [ref=e4]:
      - generic [ref=e5]:
        - button "Compact" [ref=e6] [cursor=pointer]:
          - img [ref=e7]
        - generic [ref=e9]:
          - img [ref=e10]
          - generic [ref=e15]: MASTERMIND
        - generic [ref=e16]: Beta
      - generic [ref=e17]:
        - button "Search companies and tools" [ref=e18] [cursor=pointer]:
          - img [ref=e20]
          - strong [ref=e24]: Search companies and tools
        - button "All tools" [ref=e25] [cursor=pointer]:
          - img [ref=e26]
          - generic [ref=e31]: All tools
          - generic [ref=e32]: ⌘ K
        - group "Appearance and language" [ref=e33]:
          - button "Light theme" [active] [pressed] [ref=e34] [cursor=pointer]:
            - img [ref=e35]
            - generic [ref=e38]: Light
          - button "Chinese language" [ref=e39] [cursor=pointer]:
            - generic [ref=e40]: EN
        - link "Open current chart" [ref=e41] [cursor=pointer]:
          - /url: /terminal?from=macro&ret=http%3A%2F%2F127.0.0.1%3A63838%2Foptions%3Ftab%3Ddesk
          - img [ref=e42]
          - generic [ref=e44]: Open current chart
          - generic [ref=e45]: ↗
      - button "Settings" [ref=e46] [cursor=pointer]: U
    - navigation "Main navigation" [ref=e47]:
      - link "Today" [ref=e48] [cursor=pointer]:
        - /url: /today
        - img [ref=e49]
        - generic [ref=e53]: Today
      - link "Discover" [ref=e54] [cursor=pointer]:
        - /url: /discover
        - img [ref=e55]
        - generic [ref=e60]: Discover
      - link "Analysis" [ref=e61] [cursor=pointer]:
        - /url: /analysis
        - img [ref=e62]
        - generic [ref=e64]: Analysis
      - link "Monitor" [ref=e65] [cursor=pointer]:
        - /url: /monitor
        - img [ref=e66]
        - generic [ref=e68]: Monitor
      - link "Research" [ref=e69] [cursor=pointer]:
        - /url: /research
        - img [ref=e70]
        - generic [ref=e72]: Research
      - link "Portfolio" [ref=e73] [cursor=pointer]:
        - /url: /portfolio
        - img [ref=e74]
        - generic [ref=e76]: Portfolio
      - group "Market Intelligence" [ref=e77]:
        - heading "Market Intelligence" [level=2] [ref=e78]
        - generic [ref=e79]:
          - link "Overview" [ref=e80] [cursor=pointer]:
            - /url: /intelligence
            - img [ref=e81]
            - generic [ref=e83]: Overview
          - link "Macro Dashboard" [ref=e84] [cursor=pointer]:
            - /url: /macro.html
            - img [ref=e85]
            - generic [ref=e87]: Macro Dashboard
          - link "Prophet" [ref=e88] [cursor=pointer]:
            - /url: /us_stocks.html
            - img [ref=e89]
            - generic [ref=e91]: Prophet
          - link "Sector Cycles" [ref=e92] [cursor=pointer]:
            - /url: /sector_cycles.html
            - img [ref=e93]
            - generic [ref=e95]: Sector Cycles
          - link "Sector Intelligence" [ref=e96] [cursor=pointer]:
            - /url: /sectors
            - img [ref=e97]
            - generic [ref=e99]: Sector Intelligence
      - generic [ref=e100]:
        - heading "Markets" [level=2] [ref=e101]
        - link "United States" [ref=e102] [cursor=pointer]:
          - /url: /us_stocks.html
          - generic [ref=e103]: US
          - generic [ref=e104]: United States
        - link "China" [ref=e105] [cursor=pointer]:
          - /url: /china.html
          - generic [ref=e106]: CN
          - generic [ref=e107]: China
        - link "Hong Kong" [ref=e108] [cursor=pointer]:
          - /url: /hk.html
          - generic [ref=e109]: HK
          - generic [ref=e110]: Hong Kong
        - link "Canada" [ref=e111] [cursor=pointer]:
          - /url: /canada.html
          - generic [ref=e112]: CA
          - generic [ref=e113]: Canada
        - link "International" [ref=e114] [cursor=pointer]:
          - /url: /intl.html
          - generic [ref=e115]: INTL
          - generic [ref=e116]: International
      - button "All tools" [ref=e118] [cursor=pointer]:
        - img [ref=e119]
        - generic [ref=e124]: All tools
      - button "Mastermind AI" [ref=e125] [cursor=pointer]:
        - img [ref=e126]
        - generic [ref=e128]: Mastermind AI
    - status [ref=e129]
    - main [ref=e130]:
      - generic [ref=e131]:
        - generic [ref=e132]:
          - generic [ref=e133]: Category
          - generic [ref=e134]:
            - tablist "Options categories" [ref=e135]:
              - tab "Command" [selected] [ref=e136] [cursor=pointer]
              - tab "Flow" [ref=e137] [cursor=pointer]
              - tab "Exposure" [ref=e138] [cursor=pointer]
              - tab "Structure" [ref=e139] [cursor=pointer]
              - tab "Volatility" [ref=e140] [cursor=pointer]
              - tab "Statistics" [ref=e141] [cursor=pointer]
              - tab "Prophet" [ref=e142] [cursor=pointer]
            - link "Futures depth & footprint" [ref=e143] [cursor=pointer]:
              - /url: /options/futures
              - text: Futures
            - button "Open the four-step options workflow · 0/4 viewed" [ref=e144] [cursor=pointer]:
              - img [ref=e145]
              - generic [ref=e148]: Workflow
              - generic [ref=e149]: 0/4 viewed
        - generic [ref=e150]:
          - generic [ref=e151]: View
          - tablist "Options views" [ref=e152]:
            - tab "Flow Desk" [selected] [ref=e153] [cursor=pointer]
      - generic [ref=e154]:
        - generic [ref=e155]:
          - 'generic "Market volatility regime: Mixed — normalizing" [ref=e156]':
            - generic [ref=e158]: Vol
            - text: Mixed — normalizing
          - generic [ref=e159]: as of 11:42:00delayed
        - generic [ref=e162]:
          - generic [ref=e163]:
            - generic [ref=e165]:
              - generic [ref=e166]:
                - generic [ref=e167]: Flow Gauge
                - generic [ref=e168]: Session 72% elapsed
              - generic [ref=e169]: $12.7M
              - generic [ref=e170]:
                - generic [ref=e171]: 85% C
                - generic [ref=e175]: 15% P
              - generic [ref=e176]:
                - generic [ref=e177]:
                  - generic [ref=e178]: Call Prem
                  - generic [ref=e179]: $10.9M
                - generic [ref=e180]:
                  - generic [ref=e181]: Put Prem
                  - generic [ref=e182]: $1.8M
                - generic [ref=e183]:
                  - generic [ref=e184]: P/C Ratio
                  - generic [ref=e185]: "0.17"
                - generic [ref=e186]:
                  - generic [ref=e187]: Tone
                  - generic [ref=e188]: CALL-HEAVY
            - complementary [ref=e189]:
              - generic [ref=e190]:
                - generic [ref=e191]:
                  - generic [ref=e192]: Session overview
                  - generic [ref=e193]:
                    - generic [ref=e194]: nightly + intraday
                    - button "Open tutorial" [ref=e195] [cursor=pointer]: "?"
                - generic [ref=e197]:
                  - generic [ref=e198]:
                    - generic [ref=e199]: Premium
                    - generic [ref=e200]: $638.5M
                  - generic [ref=e201]:
                    - generic [ref=e202]: Calls
                    - generic [ref=e203]: 52%
                  - generic [ref=e204]:
                    - generic [ref=e205]: P/C
                    - generic [ref=e206]: "0.91"
                - generic [ref=e210]:
                  - generic [ref=e211]: Calls
                  - generic [ref=e212]: Puts
              - generic [ref=e213]:
                - generic [ref=e214]:
                  - generic [ref=e215]: Watchlist
                  - generic [ref=e216]: Score
                - generic [ref=e218]:
                  - generic [ref=e219]: Click a ticker to watch
                  - generic [ref=e220]: Active today
                  - generic [ref=e221] [cursor=pointer]:
                    - button "TSLA 88 out of 100" [ref=e222]:
                      - generic [ref=e223]: TSLA
                      - img "88 out of 100" [ref=e225]:
                        - img [ref=e226]
                        - generic [ref=e230]: "88"
                    - button "Add TSLA to watchlist" [ref=e232]: +
                  - generic [ref=e233] [cursor=pointer]:
                    - button "NVDA 77 out of 100" [ref=e234]:
                      - generic [ref=e235]: NVDA
                      - img "77 out of 100" [ref=e237]:
                        - img [ref=e238]
                        - generic [ref=e242]: "77"
                    - button "Add NVDA to watchlist" [ref=e244]: +
                  - generic [ref=e245] [cursor=pointer]:
                    - button "XLF 69 out of 100" [ref=e246]:
                      - generic [ref=e247]: XLF
                      - img "69 out of 100" [ref=e249]:
                        - img [ref=e250]
                        - generic [ref=e254]: "69"
                    - button "Add XLF to watchlist" [ref=e256]: +
                  - generic [ref=e257] [cursor=pointer]:
                    - button "GLD 66 out of 100" [ref=e258]:
                      - generic [ref=e259]: GLD
                      - img "66 out of 100" [ref=e261]:
                        - img [ref=e262]
                        - generic [ref=e266]: "66"
                    - button "Add GLD to watchlist" [ref=e268]: +
                  - generic [ref=e269] [cursor=pointer]:
                    - button "AAPL 64 out of 100" [ref=e270]:
                      - generic [ref=e271]: AAPL
                      - img "64 out of 100" [ref=e273]:
                        - img [ref=e274]
                        - generic [ref=e278]: "64"
                    - button "Add AAPL to watchlist" [ref=e280]: +
            - generic [ref=e281]:
              - generic [ref=e282]:
                - generic [ref=e283]: Smart Money Radar
                - generic [ref=e284]: Baseline derived from prior 252 trading sessions. Direction labels are heuristic and approximate.
              - generic [ref=e285]:
                - generic [ref=e286]: Ticker
                - generic [ref=e287]: Activity
                - generic [ref=e288]: Premium
                - generic [ref=e289]: Calls
              - generic [ref=e290]:
                - generic [ref=e291]:
                  - generic [ref=e292]:
                    - generic [ref=e293]: GLD
                    - generic [ref=e294]: Commodities
                  - generic [ref=e297]: Above avg
                  - generic [ref=e298]: $4.2M
                  - generic [ref=e299]: 88%
                - generic [ref=e300]:
                  - generic [ref=e301]:
                    - generic [ref=e302]: TSLA
                    - generic [ref=e303]: Consumer
                  - generic [ref=e306]: Above avg
                  - generic [ref=e307]: $5.8M
                  - generic [ref=e308]: 55%
                - generic [ref=e309]:
                  - generic [ref=e310]:
                    - generic [ref=e311]: NVDA
                    - generic [ref=e312]: Technology
                  - generic [ref=e315]: Above avg
                  - generic [ref=e316]: $3.1M
                  - generic [ref=e317]: 78%
                - generic [ref=e318]:
                  - generic [ref=e319]:
                    - generic [ref=e320]: SPY
                    - generic [ref=e321]: Index ETF
                  - generic [ref=e324]: Above avg
                  - generic [ref=e325]: $6.8M
                  - generic [ref=e326]: 42%
                - generic [ref=e327]:
                  - generic [ref=e328]:
                    - generic [ref=e329]: QQQ
                    - generic [ref=e330]: Index ETF
                  - generic [ref=e333]: Above avg
                  - generic [ref=e334]: $4.6M
                  - generic [ref=e335]: 58%
                - generic [ref=e336]:
                  - generic [ref=e337]:
                    - generic [ref=e338]: XLF
                    - generic [ref=e339]: Financials
                  - generic [ref=e341]: Unavailable
                  - generic [ref=e342]: $980K
                  - generic [ref=e343]: 92%
                - generic [ref=e344]:
                  - generic [ref=e345]:
                    - generic [ref=e346]: XLV
                    - generic [ref=e347]: Healthcare
                  - generic [ref=e349]: Unavailable
                  - generic [ref=e350]: $1.2M
                  - generic [ref=e351]: 30%
          - generic [ref=e353]:
            - generic [ref=e354]:
              - generic [ref=e355]: 12 SIGNALS
              - textbox "Search ticker…" [ref=e356]
              - generic [ref=e357]:
                - button "NEW" [ref=e358] [cursor=pointer]
                - button "SCORE" [ref=e359] [cursor=pointer]
              - button "Filters" [ref=e360] [cursor=pointer]
            - generic "Updated 2026-07-05T15:42:00Z; Source data 2026-07-05T14:34:51Z — 2026-07-05T15:40:32Z" [ref=e361]:
              - generic [ref=e362]: Connected
              - generic [ref=e364]: · Market closed
              - generic [ref=e365]: · Last session
              - generic [ref=e366]: · Updated 128d 16h ago
              - generic [ref=e367]: · Source data 128d 16h–128d 17h ago
              - generic [ref=e368]: · Refresh cycle 1h 8m
            - generic [ref=e369]:
              - button "ALL" [ref=e370] [cursor=pointer]
              - button "Elite — top 2% of tape" [ref=e371] [cursor=pointer]
              - button "WHALES" [ref=e372] [cursor=pointer]
              - button "0DTE" [ref=e373] [cursor=pointer]
              - button "SWEEPS" [ref=e374] [cursor=pointer]
            - generic [ref=e375]:
              - generic [ref=e376]: 100 % of eligible premium classified · 0 % unknown
              - generic [ref=e377]: Calls $10.9M · Puts $1.8M · unsigned premium, not a direction
            - generic [ref=e378]:
              - option "NVDA 77 out of 100 11:40 $1.2M Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $160 · 2026-07-18 · 13d Size 2,500 · Premium ≥$1M single event · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e379] [cursor=pointer]:
                - generic [ref=e380]:
                  - generic [ref=e381]: NVDA
                  - img "77 out of 100" [ref=e383]:
                    - img [ref=e384]
                    - generic [ref=e388]: "77"
                  - generic [ref=e389]: 11:40
                - generic [ref=e390]:
                  - generic [ref=e391]: $1.2M
                  - generic [ref=e392]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e393]: Leans buy (approximate)
                - generic [ref=e395]: $160 · 2026-07-18 · 13d
                - generic [ref=e396]:
                  - generic [ref=e397]:
                    - generic [ref=e398]: Size 2,500
                    - generic [ref=e399]:
                      - generic [ref=e400]: ·
                      - generic "Premium ≥$1M single event" [ref=e401]: WHALE
                    - generic [ref=e402]:
                      - generic [ref=e403]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e404]: UNUSUAL
                  - button "Show score breakdown" [ref=e405]:
                    - img [ref=e406]
              - option "SPY 26 out of 100 11:38 $99.0K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $545 · 2026-07-05 · 0d Size 1,800 Show score breakdown" [ref=e408] [cursor=pointer]:
                - generic [ref=e409]:
                  - generic [ref=e410]: SPY
                  - img "26 out of 100" [ref=e412]:
                    - img [ref=e413]
                    - generic [ref=e417]: "26"
                  - generic [ref=e418]: 11:38
                - generic [ref=e419]:
                  - generic [ref=e420]: $99.0K
                  - generic [ref=e421]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e422]: Leans buy (approximate)
                - generic [ref=e424]: $545 · 2026-07-05 · 0d
                - generic [ref=e425]:
                  - generic [ref=e427]: Size 1,800
                  - button "Show score breakdown" [ref=e428]:
                    - img [ref=e429]
              - 'option "AAPL 64 out of 100 11:35 $720.0K Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $220 · 2026-08-15 · 41d Size 3,000 · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e431] [cursor=pointer]':
                - generic [ref=e432]:
                  - generic [ref=e433]: AAPL
                  - img "64 out of 100" [ref=e435]:
                    - img [ref=e436]
                    - generic [ref=e440]: "64"
                  - generic [ref=e441]: 11:35
                - generic [ref=e442]:
                  - generic [ref=e443]: $720.0K
                  - generic [ref=e444]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e445]: Leans buy (approximate)
                - generic [ref=e447]: $220 · 2026-08-15 · 41d
                - generic [ref=e448]:
                  - generic [ref=e449]:
                    - generic [ref=e450]: Size 3,000
                    - generic [ref=e451]:
                      - generic [ref=e452]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e453]': CLUSTER
                    - generic [ref=e454]:
                      - generic [ref=e455]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e456]: UNUSUAL
                  - button "Show score breakdown" [ref=e457]:
                    - img [ref=e458]
              - option "XLE 45 out of 100 11:32 $925.0K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $88 · 2026-09-19 · 76d Size 5,000 Show score breakdown" [ref=e460] [cursor=pointer]:
                - generic [ref=e461]:
                  - generic [ref=e462]: XLE
                  - img "45 out of 100" [ref=e464]:
                    - img [ref=e465]
                    - generic [ref=e469]: "45"
                  - generic [ref=e470]: 11:32
                - generic [ref=e471]:
                  - generic [ref=e472]: $925.0K
                  - generic [ref=e473]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e474]: Leans sell (approximate)
                - generic [ref=e476]: $88 · 2026-09-19 · 76d
                - generic [ref=e477]:
                  - generic [ref=e479]: Size 5,000
                  - button "Show score breakdown" [ref=e480]:
                    - img [ref=e481]
              - option "META 59 out of 100 11:29 $984.0K Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $580 · 2026-07-11 · 6d Size 1,200 Show score breakdown" [ref=e483] [cursor=pointer]:
                - generic [ref=e484]:
                  - generic [ref=e485]: META
                  - img "59 out of 100" [ref=e487]:
                    - img [ref=e488]
                    - generic [ref=e492]: "59"
                  - generic [ref=e493]: 11:29
                - generic [ref=e494]:
                  - generic [ref=e495]: $984.0K
                  - generic [ref=e496]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e497]: Mixed
                - generic [ref=e499]: $580 · 2026-07-11 · 6d
                - generic [ref=e500]:
                  - generic [ref=e502]: Size 1,200
                  - button "Show score breakdown" [ref=e503]:
                    - img [ref=e504]
              - option "GLD 66 out of 100 11:25 $2.6M Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $250 · 2026-10-17 · 104d Size 4,000 · Premium ≥$1M single event · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e506] [cursor=pointer]:
                - generic [ref=e507]:
                  - generic [ref=e508]: GLD
                  - img "66 out of 100" [ref=e510]:
                    - img [ref=e511]
                    - generic [ref=e515]: "66"
                  - generic [ref=e516]: 11:25
                - generic [ref=e517]:
                  - generic [ref=e518]: $2.6M
                  - generic [ref=e519]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e520]: Leans buy (approximate)
                - generic [ref=e522]: $250 · 2026-10-17 · 104d
                - generic [ref=e523]:
                  - generic [ref=e524]:
                    - generic [ref=e525]: Size 4,000
                    - generic [ref=e526]:
                      - generic [ref=e527]: ·
                      - generic "Premium ≥$1M single event" [ref=e528]: WHALE
                    - generic [ref=e529]:
                      - generic [ref=e530]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e531]: UNUSUAL
                  - button "Show score breakdown" [ref=e532]:
                    - img [ref=e533]
              - 'option "MSFT 54 out of 100 11:21 $1.5M Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $460 · 2026-07-18 · 13d Size 800 · Premium ≥$1M single event · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) Show score breakdown" [ref=e535] [cursor=pointer]':
                - generic [ref=e536]:
                  - generic [ref=e537]: MSFT
                  - img "54 out of 100" [ref=e539]:
                    - img [ref=e540]
                    - generic [ref=e544]: "54"
                  - generic [ref=e545]: 11:21
                - generic [ref=e546]:
                  - generic [ref=e547]: $1.5M
                  - generic [ref=e548]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e549]: Leans buy (approximate)
                - generic [ref=e551]: $460 · 2026-07-18 · 13d
                - generic [ref=e552]:
                  - generic [ref=e553]:
                    - generic [ref=e554]: Size 800
                    - generic [ref=e555]:
                      - generic [ref=e556]: ·
                      - generic "Premium ≥$1M single event" [ref=e557]: WHALE
                    - generic [ref=e558]:
                      - generic [ref=e559]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e560]': CLUSTER
                  - button "Show score breakdown" [ref=e561]:
                    - img [ref=e562]
              - option "XLF 69 out of 100 11:18 $617.5K Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $46 · 2026-07-25 · 20d Size 6,500 · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e564] [cursor=pointer]:
                - generic [ref=e565]:
                  - generic [ref=e566]: XLF
                  - img "69 out of 100" [ref=e568]:
                    - img [ref=e569]
                    - generic [ref=e573]: "69"
                  - generic [ref=e574]: 11:18
                - generic [ref=e575]:
                  - generic [ref=e576]: $617.5K
                  - generic [ref=e577]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e578]: Leans buy (approximate)
                - generic [ref=e580]: $46 · 2026-07-25 · 20d
                - generic [ref=e581]:
                  - generic [ref=e582]:
                    - generic [ref=e583]: Size 6,500
                    - generic [ref=e584]:
                      - generic [ref=e585]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e586]: UNUSUAL
                  - button "Show score breakdown" [ref=e587]:
                    - img [ref=e588]
              - option "QQQ 14 out of 100 11:14 $26.4K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $490 · 2026-07-05 · 0d Size 2,200 Show score breakdown" [ref=e590] [cursor=pointer]:
                - generic [ref=e591]:
                  - generic [ref=e592]: QQQ
                  - img "14 out of 100" [ref=e594]:
                    - img [ref=e595]
                    - generic [ref=e599]: "14"
                  - generic [ref=e600]: 11:14
                - generic [ref=e601]:
                  - generic [ref=e602]: $26.4K
                  - generic [ref=e603]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e604]: Mixed
                - generic [ref=e606]: $490 · 2026-07-05 · 0d
                - generic [ref=e607]:
                  - generic [ref=e609]: Size 2,200
                  - button "Show score breakdown" [ref=e610]:
                    - img [ref=e611]
              - option "AMZN 58 out of 100 11:10 $795.0K Call Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $220 · 2026-08-01 · 27d Size 1,500 Show score breakdown" [ref=e613] [cursor=pointer]:
                - generic [ref=e614]:
                  - generic [ref=e615]: AMZN
                  - img "58 out of 100" [ref=e617]:
                    - img [ref=e618]
                    - generic [ref=e622]: "58"
                  - generic [ref=e623]: 11:10
                - generic [ref=e624]:
                  - generic [ref=e625]: $795.0K
                  - generic [ref=e626]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e627]: Leans buy (approximate)
                - generic [ref=e629]: $220 · 2026-08-01 · 27d
                - generic [ref=e630]:
                  - generic [ref=e632]: Size 1,500
                  - button "Show score breakdown" [ref=e633]:
                    - img [ref=e634]
              - option "XLV 44 out of 100 11:06 $798.0K Put Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $148 · 2026-09-19 · 76d Size 3,800 Show score breakdown" [ref=e636] [cursor=pointer]:
                - generic [ref=e637]:
                  - generic [ref=e638]: XLV
                  - img "44 out of 100" [ref=e640]:
                    - img [ref=e641]
                    - generic [ref=e645]: "44"
                  - generic [ref=e646]: 11:06
                - generic [ref=e647]:
                  - generic [ref=e648]: $798.0K
                  - generic [ref=e649]: Put
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e650]: Leans buy (approximate)
                - generic [ref=e652]: $148 · 2026-09-19 · 76d
                - generic [ref=e653]:
                  - generic [ref=e655]: Size 3,800
                  - button "Show score breakdown" [ref=e656]:
                    - img [ref=e657]
              - 'option "TSLA 88 out of 100 11:02 $2.5M Call Lean is inferred from the last trade''s price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side. $300 · 2026-07-18 · 13d Size 2,000 · Premium ≥$1M single event · Repeat-root: multiple prints on this underlying this session (not a $-sized campaign) · Premium activity is much higher than its typical one-year level Show score breakdown" [ref=e659] [cursor=pointer]':
                - generic [ref=e660]:
                  - generic [ref=e661]: TSLA
                  - img "88 out of 100" [ref=e663]:
                    - img [ref=e664]
                    - generic [ref=e668]: "88"
                  - generic [ref=e669]: 11:02
                - generic [ref=e670]:
                  - generic [ref=e671]: $2.5M
                  - generic [ref=e672]: Call
                  - generic "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side." [ref=e673]: Leans sell (approximate)
                - generic [ref=e675]: $300 · 2026-07-18 · 13d
                - generic [ref=e676]:
                  - generic [ref=e677]:
                    - generic [ref=e678]: Size 2,000
                    - generic [ref=e679]:
                      - generic [ref=e680]: ·
                      - generic "Premium ≥$1M single event" [ref=e681]: WHALE
                    - generic [ref=e682]:
                      - generic [ref=e683]: ·
                      - 'generic "Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)" [ref=e684]': CLUSTER
                    - generic [ref=e685]:
                      - generic [ref=e686]: ·
                      - generic "Premium activity is much higher than its typical one-year level" [ref=e687]: UNUSUAL
                  - button "Show score breakdown" [ref=e688]:
                    - img [ref=e689]
          - generic [ref=e691]:
            - generic [ref=e692]:
              - generic [ref=e693]:
                - generic [ref=e694]: Chain Heat
                - generic "2026-07-07T16:00:00-04:00" [ref=e695]: Last session · Data 126d 11h ago
                - generic [ref=e696]: ≥$3M cumul
              - generic [ref=e697]: DISPLAY-ONLY — intraday chain-heat snapshot. Not investment advice.
              - generic [ref=e698]:
                - generic [ref=e699]:
                  - generic [ref=e700]: SMH
                  - generic [ref=e701]: Put
                  - generic [ref=e702]: $530 · 09-18
                  - generic [ref=e703]: $12.0M
                - generic [ref=e704]:
                  - generic [ref=e705]: accumulation
                  - generic [ref=e706]: ask-share derived — not NBBO
                - generic [ref=e707]:
                  - generic [ref=e708]: hits 29
                  - generic [ref=e709]: span 91m
                  - generic [ref=e710]: first seen 09:35 ET
                - generic [ref=e712]:
                  - generic [ref=e713]: Legacy category proxy · coverage unavailable
                  - generic [ref=e714]: 91%
              - generic [ref=e717]:
                - generic [ref=e718]:
                  - generic [ref=e719]: QQQ
                  - generic [ref=e720]: Call
                  - generic [ref=e721]: $640 · 09-18
                  - generic [ref=e722]: $6.4M
                - generic [ref=e723]:
                  - generic [ref=e724]: contested
                  - generic [ref=e725]: ask-share derived — not NBBO
                - generic [ref=e726]:
                  - generic [ref=e727]: hits 14
                  - generic [ref=e728]: span 58m
                  - generic [ref=e729]: first seen 10:11 ET
                - generic [ref=e731]:
                  - generic [ref=e732]: Legacy category proxy · coverage unavailable
                  - generic [ref=e733]: 44%
              - generic [ref=e736]:
                - generic [ref=e737]:
                  - generic [ref=e738]: NVDA
                  - generic [ref=e739]: Call
                  - generic [ref=e740]: $200 · 09-19
                  - generic [ref=e741]: $4.1M
                - generic [ref=e742]:
                  - generic [ref=e743]: accumulation
                  - generic [ref=e744]: ask-share derived — not NBBO
                - generic [ref=e745]:
                  - generic [ref=e746]: hits 11
                  - generic [ref=e747]: span 124m
                  - generic [ref=e748]: first seen 09:42 ET
                - generic [ref=e750]:
                  - generic [ref=e751]: Legacy category proxy · coverage unavailable
                  - generic [ref=e752]: 78%
              - generic [ref=e755]:
                - generic [ref=e756]:
                  - generic [ref=e757]: SPY
                  - generic [ref=e758]: Put
                  - generic [ref=e759]: $530 · 09-18
                  - generic [ref=e760]: $3.8M
                - generic [ref=e761]:
                  - generic [ref=e762]: accumulation
                  - generic [ref=e763]: ask-share derived — not NBBO
                - generic [ref=e764]:
                  - generic [ref=e765]: hits 9
                  - generic [ref=e766]: span 47m
                  - generic [ref=e767]: first seen 11:05 ET
                - generic [ref=e769]:
                  - generic [ref=e770]: Legacy category proxy · coverage unavailable
                  - generic [ref=e771]: 82%
            - generic [ref=e775]:
              - generic [ref=e776]: Select an event to inspect
              - generic [ref=e777]: Click any card in the feed to open its full breakdown — score components, contract fields, detections, and the ticker's session context.
        - generic [ref=e778]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e779]
```

# Test source

```ts
  148 |   chainHeatPut:      ["Put", "认沽"],
  149 |   chainHeatLeanNote:  ["ask-share derived — not NBBO", "基于卖价成交比 — 非NBBO"],
  150 |   chainHeatEmpty:     ["No campaigns today — accumulation threshold ≥$3M", "今日无集群 — 累计阈值≥300万美元"],
  151 |   chainHeatLoading:   ["Loading chain heat…", "加载链式热度中…"],
  152 |   // A read that did not land is not "still loading", and a 404 is not a failure.
  153 |   chainHeatError:     ["Could not load chain heat", "无法加载链式热度"],
  154 |   chainHeatErrorWhy:  [
  155 |     "The read did not reach the store, so this says nothing about today's campaigns.",
  156 |     "读取未能到达数据源，因此无法判断今日的集群情况。",
  157 |   ],
  158 |   chainHeatAbsent:    ["No chain heat published for this session yet", "本交易时段尚未发布链式热度"],
  159 |   chainHeatRefreshFailed: [
  160 |     "Could not refresh chain heat — showing the last read.",
  161 |     "无法刷新链式热度——显示的是上次读取的数据。",
  162 |   ],
  163 | 
  164 |   // ── Soft-direction tooltip (HONESTY DOCTRINE — the key required copy) ──────
  165 |   leanTooltip: [
  166 |     "Lean is inferred from the last trade's price change, not confirmed by the official bid and ask, so direction is approximate; size is the reliable read. Colour and rank use premium size, not the inferred side.",
  167 |     "方向倾向由成交价变动规则推断，未经官方买卖报价确认（方向正确率约0.41）；权利金规模才是可靠读数。颜色与排名基于权利金规模，而非推断出的买卖方向。",
  168 |   ],
  169 | 
  170 |   // ── Empty / loading states ─────────────────────────────────────────────────
  171 |   loading:       ["Loading…", "加载中…"],
  172 |   loadingFeed:   ["Loading flow feed…", "加载资金流中…"],
  173 |   loadingRadar:  ["Loading radar…", "加载雷达中…"],
  174 |   emptyFeed:     ["No events match the current filters", "当前筛选无匹配事件"],
  175 |   emptyFeedHint: ["Try clearing filters or lowering the min-premium threshold", "尝试清除筛选条件或降低最低权利金阈值"],
  176 |   errFeed:       ["Could not load flow feed", "无法加载资金流"],
  177 |   errRetry:      ["Retry", "重试"],
  178 |   // A feed read that did not land is not "still loading", and a 404 is not a failure —
  179 |   // same doctrine as the chain-heat rail, applied to the flow feed and its rail.
  180 |   scoreUnavailable: ["Score unavailable", "评分不可用"],
  181 |   feedErrorWhy: [
  182 |     "The read did not reach the store, so this says nothing about today's flow. Chain heat loads on its own read.",
  183 |     "读取未能到达数据源，因此无法判断今日的资金流。链式热度单独读取。",
  184 |   ],
  185 |   feedAbsent: ["No flow feed published for this session yet", "本交易时段尚未发布资金流数据"],
  186 |   feedRefreshFailed: [
  187 |     "Could not refresh the flow feed — showing the last read.",
  188 |     "无法刷新资金流 — 显示上次读取的数据。",
  189 |   ],
  190 |   feedRefreshAbsent: [
  191 |     "The latest read found no flow feed published — showing the last read.",
  192 |     "最新读取未发现已发布的资金流数据 — 显示上次读取的数据。",
  193 |   ],
  194 |   watchlistFeedUnavailable: ["Session flow totals and the watchlist need the flow feed, which did not load.", "本时段资金流合计与观察列表依赖资金流数据，目前未能加载。"],
  195 |   // Toolbar with no feed: the held state takes the count's place (no count of a tape
  196 |   // that never loaded); the list below carries the reason.
  197 |   countHeldUnavailable: ["Feed not loaded", "资金流未加载"],
  198 |   countHeldAbsent:      ["No feed published", "资金流未发布"],
  199 |   // Session gauge components the feed does not establish are unavailable, not zero.
  200 |   gaugeNa:            ["N/A", "不可用"],
  201 |   gaugeTotalsNa:      ["Session totals unavailable", "时段合计不可用"],
  202 |   gaugeNoPrints: [
  203 |     "No prints in this feed yet, so there is no premium to total or split.",
  204 |     "本数据暂无成交记录，无可合计或拆分的权利金。",
  205 |   ],
  206 |   gaugeNoSplit:       ["No premium to split.", "无可拆分的权利金。"],
  207 |   // A held feed (the latest read did not land): the gauge's totals are the last read's.
  208 |   gaugeHeld:          ["Totals are from the last read", "合计为上次读取的数据"],
  209 | 
  210 |   // ── Misc ───────────────────────────────────────────────────────────────────
  211 |   scoreLabel:       ["Score", "评分"],
  212 |   premiumLabel:     ["Prem", "权利金"],
  213 |   sideLabel:        ["Side", "方向"],
  214 |   sizeLabel:        ["Size", "数量"],
  215 |   dteLabel:         ["DTE", "到期天数"],
  216 |   strikeLabel:      ["Strike", "行权价"],
  217 |   expLabel:         ["Exp", "到期日"],
  218 |   typeCall:         ["Call", "认购"],
  219 |   typePut:          ["Put", "认沽"],
  220 |   displayOnly:      ["Display-only — not investment advice", "仅供展示 — 非投资建议"],
  221 |   spreadUnreliable: ["Direction unverified", "方向未经确认"],
  222 |   scoreHonesty:     [
  223 |     "The score reflects size, activity, and how unusual the print is — not a predicted win rate. The tiers describe the print; they do not claim a historical edge until a live track record exists.",
  224 |     "评分反映规模、活跃度和异常程度，不是胜率预测。等级只是描述；在有实盘记录之前，不代表历史预测效力。",
  225 |   ],
  226 |   directionLean:    ["Direction lean", "方向倾向"],
  227 |   tickRuleInferred: ["inferred from the last trade’s price change, not confirmed by the official bid and ask", "由成交价变动规则推断，未经官方买卖报价确认"],
  228 |   softDirection:    ["~soft direction", "~软性方向"],
  229 |   noNbbo:           ["Direction without NBBO is approximate", "无NBBO时方向为近似值"],
  230 |   baselineWarming:  ["baseline warming (<30 sessions)", "基线积累中（<30个交易日）"],
  231 | } as const;
  232 | 
  233 | // ─── Typed getter ─────────────────────────────────────────────────────────────
  234 | 
  235 | /**
  236 |  * Get a localized string from the Flow Desk string table.
  237 |  *
  238 |  * @param lang - "en" | "zh"
  239 |  * @param key  - A key from FLOW_LEX
  240 |  * @returns The localized string for the given language.
  241 |  *
  242 |  * Usage:
  243 |  *   const t = (key: FlowDeskKey) => getFlowStr(lang, key);
  244 |  *   t("leanTooltip") // returns the EN or ZH string depending on lang
  245 |  */
  246 | export function getFlowStr(lang: Lang, key: FlowDeskKey): string {
  247 |   const entry = FLOW_LEX[key];
> 248 |   return lang === "zh" ? entry[1] : entry[0];
      |                                          ^ TypeError: Cannot read properties of undefined (reading '0')
  249 | }
  250 | 
  251 | /**
  252 |  * Returns a bound getter for a fixed language — useful inside components.
  253 |  *
  254 |  * @param lang - "en" | "zh"
  255 |  * @returns (key: FlowDeskKey) => string
  256 |  *
  257 |  * Usage:
  258 |  *   const t = makeFlowT(lang);
  259 |  *   t("tierElite") // "ELITE" or "顶级"
  260 |  */
  261 | export function makeFlowT(lang: Lang): (key: FlowDeskKey) => string {
  262 |   return (key: FlowDeskKey) => getFlowStr(lang, key);
  263 | }
  264 | 
  265 | // Export the key type for consuming components
  266 | export type { FlowDeskKey };
  267 | 
  268 | // ─── Compat exports for pre-generated component stubs ────────────────────────
  269 | // Components under terminal/components/flowdesk/ import `FD` (an object with
  270 | // { en, zh } per key) and `strings` (imported but currently unused).
  271 | // These aliases keep those imports compiling without modifying components.
  272 | 
  273 | type BiStr = { en: string; zh: string };
  274 | 
  275 | function bi(en: string, zh: string): BiStr { return { en, zh }; }
  276 | 
  277 | /**
  278 |  * FD — flat object of bilingual string pairs, for components that use the
  279 |  * `FD.keyName.en` / `FD.keyName.zh` access pattern.
  280 |  */
  281 | export const FD = {
  282 |   // Used in RadarStrip
  283 |   smartMoneyRadar: bi(...FLOW_LEX.radarTitle),
  284 |   radarBaseline:   bi(...FLOW_LEX.radarBaseline),
  285 |   // Used in FlowGauge
  286 |   sessionGauge:    bi(...FLOW_LEX.gaugeTitle),
  287 |   sessionOverview: bi("Session overview", "盘中概览"),
  288 |   // Used in InspectorPane
  289 |   inspectorEmpty:  bi("Select an event to inspect", "选择事件查看详情"),
  290 |   // Used in watchlist rail
  291 |   watchlist:       bi(...FLOW_LEX.watchlistTitle),
  292 | 
  293 |   // ── v7 institutional pass (additive) ─────────────────────────────────────
  294 |   // Inspector: the blank-until-selection state now says what a selection buys you.
  295 |   inspectorEmptyWhy: bi(
  296 |     "Click any card in the feed to open its full breakdown — score components, contract fields, detections, and the ticker's session context.",
  297 |     "点击信息流中的任意卡片，即可展开完整拆解——评分分项、合约字段、检测信号，以及该标的当日概况。",
  298 |   ),
  299 | 
  300 |   // Watchlist rail column label (was an untranslated literal).
  301 |   watchlistScoreCol: bi(...FLOW_LEX.scoreLabel),
  302 | 
  303 |   // Radar empty state — states WHY the list is empty, never a bare "no data".
  304 |   radarEmpty:    bi("No unusual activity", "暂无异常活动"),
  305 |   radarEmptyWhy: bi(
  306 |     "Nothing on the tape is running far enough above its one-year premium norm to rank yet.",
  307 |     "目前尚无标的的权利金明显高于其一年常态水平，故暂无排名。",
  308 |   ),
  309 | 
  310 |   // Feed empty / loading states — each branch names the real reason.
  311 |   feedLoading:      bi(...FLOW_LEX.loadingFeed),
  312 |   scoreUnavailable:    bi(...FLOW_LEX.scoreUnavailable),
  313 |   errFeed:             bi(...FLOW_LEX.errFeed),
  314 |   errRetry:            bi(...FLOW_LEX.errRetry),
  315 |   feedErrorWhy:        bi(...FLOW_LEX.feedErrorWhy),
  316 |   feedAbsent:          bi(...FLOW_LEX.feedAbsent),
  317 |   feedRefreshFailed:   bi(...FLOW_LEX.feedRefreshFailed),
  318 |   feedRefreshAbsent:   bi(...FLOW_LEX.feedRefreshAbsent),
  319 |   countHeldUnavailable: bi(...FLOW_LEX.countHeldUnavailable),
  320 |   countHeldAbsent:      bi(...FLOW_LEX.countHeldAbsent),
  321 |   gaugeNa:              bi(...FLOW_LEX.gaugeNa),
  322 |   gaugeTotalsNa:        bi(...FLOW_LEX.gaugeTotalsNa),
  323 |   gaugeNoPrints:        bi(...FLOW_LEX.gaugeNoPrints),
  324 |   gaugeNoSplit:         bi(...FLOW_LEX.gaugeNoSplit),
  325 |   gaugeHeld:            bi(...FLOW_LEX.gaugeHeld),
  326 |   feedEmptyFiltered: bi("No signals match your filters", "无符合筛选条件的信号"),
  327 |   feedEmptyFilteredWhy: bi(
  328 |     "Every event on today's tape is excluded by the active filters. Clear them, or lower the min-premium / min-score threshold.",
  329 |     "当前筛选条件排除了今日磁带上的所有事件。请清除筛选，或降低最低权利金／最低评分阈值。",
  330 |   ),
  331 |   feedEmptyQuiet: bi("No signals yet", "暂无信号"),
  332 |   feedEmptyClosedWhy: bi(
  333 |     "Market closed — showing the last session outside US options regular hours (09:30–16:00 ET). New source snapshots resume after the next open.",
  334 |     "市场休市 — 美股期权常规交易时段（美东 09:30–16:00）之外显示上一交易时段。下次开盘后恢复新的源数据快照。",
  335 |   ),
  336 |   feedEmptyOpenWhy: bi(
  337 |     "The regular-hours session is current, but nothing has cleared the desk's magnitude bar in the latest published source snapshot.",
  338 |     "当前常规交易时段仍在进行，但最新发布的源数据快照中尚无事件达到本台的规模门槛。",
  339 |   ),
  340 |   feedEmptyStaleWhy: bi(
  341 |     "The last payload is stale, so this is the previous session's tape rather than today's.",
  342 |     "最新数据已过期，此处显示的是上一交易时段的磁带，而非今日数据。",
  343 |   ),
  344 | 
  345 |   // Filter-panel badge tooltips — EN text unchanged; zh added so the aria-label
  346 |   // no longer leaks English into the 中文 view.
  347 |   filterTipWhale: bi(
  348 |     "Premium ≥$1M (magnitude gate — reliable)",
```