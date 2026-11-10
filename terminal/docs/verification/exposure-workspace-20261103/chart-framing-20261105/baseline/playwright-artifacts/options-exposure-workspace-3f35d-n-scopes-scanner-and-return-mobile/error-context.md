# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-exposure-workspace.spec.ts >> Connected exposure workspace en: chart, comparison scopes, scanner and return
- Location: e2e/options-exposure-workspace.spec.ts:437:7

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 4
Received:    -28.198085937499286

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
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
        - generic [ref=e60]:
          - generic [ref=e61] [cursor=pointer]:
            - img [ref=e62]
            - strong [ref=e68]: Exposure
            - img [ref=e69]
            - combobox "Switch Options view" [ref=e71]:
              - option "Flow Desk"
              - option "Options Tape"
              - option "Tide"
              - option "0DTE"
              - option "Largest Events"
              - option "Surface"
              - option "Options Screener"
              - option "Tickers"
              - option "Exposure" [selected]
              - option "Positioning"
              - option "Levels"
              - option "Structure"
              - option "Volatility"
              - option "Statistics"
              - option "Prophet"
          - generic [ref=e72]:
            - link "Futures depth & footprint" [ref=e73] [cursor=pointer]:
              - /url: /options/futures
              - text: Futures
            - button "Open the four-step options workflow · 1/4 viewed" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
              - generic [ref=e78]: 1/4 viewed
        - tablist "Options views" [ref=e80]:
          - tab "Exposure" [selected] [ref=e81] [cursor=pointer]
          - tab "Positioning" [ref=e82] [cursor=pointer]
          - tab "Levels" [ref=e83] [cursor=pointer]
      - tabpanel "Exposure" [ref=e84]:
        - generic [ref=e85]:
          - generic [ref=e90]:
            - navigation "Exposure workspace" [ref=e91]:
              - combobox "Exposure symbol" [ref=e92]: SPY
              - button "Structure" [pressed] [ref=e93] [cursor=pointer]
              - button "Compare" [ref=e94] [cursor=pointer]
              - button "Scanner" [ref=e95] [cursor=pointer]
              - group [ref=e97]:
                - generic "Learn the view" [ref=e98] [cursor=pointer]: "?"
              - group [ref=e99]:
                - generic "Tools" [ref=e100] [cursor=pointer]
            - generic [ref=e101]:
              - generic [ref=e102]:
                - generic [ref=e103]:
                  - generic [ref=e104]: OPTIONS · EXPOSURE · SPY
                  - heading "SPY Exposure map" [level=2] [ref=e105]:
                    - text: SPY
                    - generic [ref=e106]: Exposure map
                  - paragraph [ref=e107]:
                    - code [ref=e108]: legacy book
                    - emphasis [ref=e109]: Aggregate snapshot
                  - paragraph [ref=e110]: reference spot $752.35 · 2026-10-19T20:15:00Z · 2 expiries · 29 strikes
                  - paragraph [ref=e111]: Modeled from open interest. Sign is an inventory assumption, not price direction.
                - generic [ref=e112]:
                  - button "Sources & coverage ↗" [ref=e113] [cursor=pointer]
                  - link "Open investigation" [ref=e114] [cursor=pointer]:
                    - /url: /analysis?view=investigations&symbol=SPY
              - generic [ref=e115]:
                - group "Exposure metric" [ref=e116]:
                  - button "Gamma" [pressed] [ref=e117] [cursor=pointer]
                  - button "Delta" [ref=e118] [cursor=pointer]
                  - button "Vanna" [ref=e119] [cursor=pointer]
                  - button "Charm" [ref=e120] [cursor=pointer]
                  - button "Combined" [ref=e121] [cursor=pointer]
                - generic [ref=e122]:
                  - text: Expiration scope
                  - combobox "Expiration scope" [ref=e123]:
                    - option "All supplied expirations" [selected]
                    - option "Source-session 0DTE"
                    - option "Next live economic expiry" [disabled]
                    - option "Live expiries this exchange week" [disabled]
                    - option "2026-10-19"
                    - option "2026-10-23"
                - button "Gamma + Vanna layers" [active] [pressed] [ref=e124] [cursor=pointer]
                - generic [ref=e125]:
                  - button "Signed net" [pressed] [ref=e126] [cursor=pointer]
                  - button "Gross gamma" [ref=e127] [cursor=pointer]
            - paragraph [ref=e128]: "Dual layers: solid Gamma · outlined Vanna · separate scales"
            - generic [ref=e129]:
              - generic [ref=e130]:
                - generic [ref=e131]: COVERED BOOK NET
                - strong [ref=e132]: +1,163.45 M
                - generic [ref=e133]: per +1% spot
              - button "Largest covered net node 756 +624.36M · 7.5% of gross · contested" [ref=e134] [cursor=pointer]:
                - generic [ref=e135]: Largest covered net node
                - strong [ref=e136]: "756"
                - generic [ref=e137]: +624.36M · 7.5% of gross · contested
              - generic [ref=e138]:
                - generic [ref=e139]: CONTESTED · RUNNER-UP
                - strong [ref=e140]:
                  - text: "757"
                  - generic [ref=e141]: 0.94×
                - generic [ref=e145]: threshold 0.90 · runner-up-ratio/v1
              - generic [ref=e146]:
                - generic [ref=e147]: PUBLISHED COVERAGE
                - strong [ref=e148]:
                  - text: "29"
                  - generic [ref=e149]: / 29
                - generic [ref=e150]: published strikes
              - generic [ref=e151]:
                - generic [ref=e152]: CLOCKS
                - strong [ref=e153]: 2026-10-19T20:15:00Z
                - generic [ref=e154]: Source as-of
            - generic [ref=e156]:
              - generic [ref=e157]:
                - generic "Price timeframe" [ref=e158]:
                  - button "5m" [pressed] [ref=e159] [cursor=pointer]
                  - button "30m" [ref=e160] [cursor=pointer]
                  - button "2h" [ref=e161] [cursor=pointer]
                  - button "D" [ref=e162] [cursor=pointer]
                  - button "W" [ref=e163] [cursor=pointer]
                - generic [ref=e164]:
                  - button "MA" [pressed] [ref=e165] [cursor=pointer]
                  - button "Fit" [ref=e166] [cursor=pointer]
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
                - generic "SMA 34 · 5m · 2026-10-19T16:00 ET" [ref=e174]:
                  - text: SMA 34 · 5m 751.83
                  - time [ref=e175]: 10-19
              - generic "Price chart" [ref=e176]:
                - generic [ref=e178]:
                  - generic:
                    - generic:
                      - generic:
                        - generic:
                          - generic: S
                        - generic: SPY · 5m
                      - generic:
                        - generic: O752.75H753.24L752.45C752.99
                        - generic: +0.31 (+0.04%)
                  - table [ref=e181]:
                    - row [ref=e182]:
                      - cell
                      - cell [ref=e183]
                      - cell [ref=e187]
                    - row [ref=e191]:
                      - cell
                      - cell [ref=e192]
                      - cell [ref=e196]
                  - button "Show indicator list" [ref=e199] [cursor=pointer]:
                    - img [ref=e200]
                  - img
                  - img
                  - img
                  - generic:
                    - generic: SPY
                    - generic:
                      - generic: "752.99"
                      - generic: 00:00
                - generic [ref=e202]:
                  - generic [ref=e203]: + Positive exposure − Negative exposure ◆ Selected node
                  - generic [ref=e204]: Selected snapshot references · not historical evolution or a forecast
              - generic [ref=e205]:
                - generic [ref=e206]:
                  - generic [ref=e207]: CONFIRMED MOMENTUM
                  - button "Refresh" [ref=e208] [cursor=pointer]
                - generic [ref=e209]:
                  - generic [ref=e210]:
                    - generic [ref=e211]: 5m
                    - strong [ref=e212]: Stale bars
                  - generic [ref=e213]:
                    - generic [ref=e214]: 30m
                    - strong [ref=e215]: Stale bars
                  - generic [ref=e216]:
                    - generic [ref=e217]: 2h
                    - strong [ref=e218]: Stale bars
                  - generic [ref=e219]:
                    - generic [ref=e220]: Daily
                    - strong [ref=e221]: Stale bars
                  - generic [ref=e222]:
                    - generic [ref=e223]: Weekly
                    - strong [ref=e224]: Stale bars
                - group [ref=e225]:
                  - generic "Method, confirmation times & price sources" [ref=e226] [cursor=pointer]
            - generic [ref=e227]:
              - generic [ref=e228]:
                - generic [ref=e229]:
                  - text: BOOK ANATOMY
                  - heading "Expiration contributions" [level=3] [ref=e230]
                - generic [ref=e231]:
                  - button "Compare expiries" [pressed] [ref=e232] [cursor=pointer]
                  - button "Changes" [ref=e233] [cursor=pointer]
                  - button "Replay" [ref=e234] [cursor=pointer]
                  - button "Review" [ref=e235] [cursor=pointer]
                  - button "Scenario" [ref=e236] [cursor=pointer]
                  - button "Surface" [ref=e237] [cursor=pointer]
                  - button "Exact values" [ref=e238] [cursor=pointer]
              - table "Strike × expiry field" [ref=e240]:
                - rowgroup [ref=e241]:
                  - row "Selected strike 2026-10-19 +756.24M 2026-10-23 +407.21M" [ref=e242]:
                    - columnheader "Selected strike" [ref=e243]
                    - columnheader "2026-10-19 +756.24M" [ref=e244]:
                      - button "2026-10-19 +756.24M" [ref=e245] [cursor=pointer]:
                        - generic [ref=e246]: 2026-10-19
                        - strong [ref=e247]: +756.24M
                    - columnheader "2026-10-23 +407.21M" [ref=e248]:
                      - button "2026-10-23 +407.21M" [ref=e249] [cursor=pointer]:
                        - generic [ref=e250]: 2026-10-23
                        - strong [ref=e251]: +407.21M
                - rowgroup [ref=e252]:
                  - row "764 +10.6 +5.7" [ref=e253]:
                    - rowheader "764" [ref=e254]:
                      - button "764" [ref=e255] [cursor=pointer]
                    - cell "+10.6" [ref=e256] [cursor=pointer]
                    - cell "+5.7" [ref=e257] [cursor=pointer]
                  - row "763 +22.1 +11.9" [ref=e258]:
                    - rowheader "763" [ref=e259]:
                      - button "763" [ref=e260] [cursor=pointer]
                    - cell "+22.1" [ref=e261] [cursor=pointer]
                    - cell "+11.9" [ref=e262] [cursor=pointer]
                  - row "762 +45.7 +24.6" [ref=e263]:
                    - rowheader "762" [ref=e264]:
                      - button "762" [ref=e265] [cursor=pointer]
                    - cell "+45.7" [ref=e266] [cursor=pointer]
                    - cell "+24.6" [ref=e267] [cursor=pointer]
                  - row "761 +87.7 +47.2" [ref=e268]:
                    - rowheader "761" [ref=e269]:
                      - button "761" [ref=e270] [cursor=pointer]
                    - cell "+87.7" [ref=e271] [cursor=pointer]
                    - cell "+47.2" [ref=e272] [cursor=pointer]
                  - row "760 +152 +81.6" [ref=e273]:
                    - rowheader "760" [ref=e274]:
                      - button "760" [ref=e275] [cursor=pointer]
                    - cell "+152" [ref=e276] [cursor=pointer]
                    - cell "+81.6" [ref=e277] [cursor=pointer]
                  - row "759 +233 +125" [ref=e278]:
                    - rowheader "759" [ref=e279]:
                      - button "759" [ref=e280] [cursor=pointer]
                    - cell "+233" [ref=e281] [cursor=pointer]
                    - cell "+125" [ref=e282] [cursor=pointer]
                  - row "758 +317 +171" [ref=e283]:
                    - rowheader "758" [ref=e284]:
                      - button "758" [ref=e285] [cursor=pointer]
                    - cell "+317" [ref=e286] [cursor=pointer]
                    - cell "+171" [ref=e287] [cursor=pointer]
                  - row "757 +382 +206" [ref=e288]:
                    - rowheader "757" [ref=e289]:
                      - button "757" [ref=e290] [cursor=pointer]
                    - cell "+382" [ref=e291] [cursor=pointer]
                    - cell "+206" [ref=e292] [cursor=pointer]
                  - row "756 +406 +219" [ref=e293]:
                    - rowheader "756" [ref=e294]:
                      - button "756" [ref=e295] [cursor=pointer]
                    - cell "+406" [ref=e296] [cursor=pointer]
                    - cell "+219" [ref=e297] [cursor=pointer]
                  - row "755 +380 +205" [ref=e298]:
                    - rowheader "755" [ref=e299]:
                      - button "755" [ref=e300] [cursor=pointer]
                    - cell "+380" [ref=e301] [cursor=pointer]
                    - cell "+205" [ref=e302] [cursor=pointer]
                  - row "754 +311 +168" [ref=e303]:
                    - rowheader "754" [ref=e304]:
                      - button "754" [ref=e305] [cursor=pointer]
                    - cell "+311" [ref=e306] [cursor=pointer]
                    - cell "+168" [ref=e307] [cursor=pointer]
                  - row "753◆ +215 +116" [ref=e308]:
                    - rowheader "753◆" [ref=e309]:
                      - button "753◆" [ref=e310] [cursor=pointer]
                    - cell "+215" [ref=e311] [cursor=pointer]
                    - cell "+116" [ref=e312] [cursor=pointer]
                  - row "752 +107 +57.6" [ref=e313]:
                    - rowheader "752" [ref=e314]:
                      - button "752" [ref=e315] [cursor=pointer]
                    - cell "+107" [ref=e316] [cursor=pointer]
                    - cell "+57.6" [ref=e317] [cursor=pointer]
                  - row "751 −6.5 −3.5" [ref=e318]:
                    - rowheader "751" [ref=e319]:
                      - button "751" [ref=e320] [cursor=pointer]
                    - cell "−6.5" [ref=e321] [cursor=pointer]
                    - cell "−3.5" [ref=e322] [cursor=pointer]
                  - row "750 −123 −66.3" [ref=e323]:
                    - rowheader "750" [ref=e324]:
                      - button "750" [ref=e325] [cursor=pointer]
                    - cell "−123" [ref=e326] [cursor=pointer]
                    - cell "−66.3" [ref=e327] [cursor=pointer]
                  - row "749 −234 −126" [ref=e328]:
                    - rowheader "749" [ref=e329]:
                      - button "749" [ref=e330] [cursor=pointer]
                    - cell "−234" [ref=e331] [cursor=pointer]
                    - cell "−126" [ref=e332] [cursor=pointer]
                  - row "748 −318 −171" [ref=e333]:
                    - rowheader "748" [ref=e334]:
                      - button "748" [ref=e335] [cursor=pointer]
                    - cell "−318" [ref=e336] [cursor=pointer]
                    - cell "−171" [ref=e337] [cursor=pointer]
                  - row "747 −352 −189" [ref=e338]:
                    - rowheader "747" [ref=e339]:
                      - button "747" [ref=e340] [cursor=pointer]
                    - cell "−352" [ref=e341] [cursor=pointer]
                    - cell "−189" [ref=e342] [cursor=pointer]
                  - row "746 −325 −175" [ref=e343]:
                    - rowheader "746" [ref=e344]:
                      - button "746" [ref=e345] [cursor=pointer]
                    - cell "−325" [ref=e346] [cursor=pointer]
                    - cell "−175" [ref=e347] [cursor=pointer]
                  - row "745 −253 −136" [ref=e348]:
                    - rowheader "745" [ref=e349]:
                      - button "745" [ref=e350] [cursor=pointer]
                    - cell "−253" [ref=e351] [cursor=pointer]
                    - cell "−136" [ref=e352] [cursor=pointer]
                  - row "744 −166 −89.2" [ref=e353]:
                    - rowheader "744" [ref=e354]:
                      - button "744" [ref=e355] [cursor=pointer]
                    - cell "−166" [ref=e356] [cursor=pointer]
                    - cell "−89.2" [ref=e357] [cursor=pointer]
                  - row "743 −91 −49" [ref=e358]:
                    - rowheader "743" [ref=e359]:
                      - button "743" [ref=e360] [cursor=pointer]
                    - cell "−91" [ref=e361] [cursor=pointer]
                    - cell "−49" [ref=e362] [cursor=pointer]
                  - row "742 −41.3 −22.2" [ref=e363]:
                    - rowheader "742" [ref=e364]:
                      - button "742" [ref=e365] [cursor=pointer]
                    - cell "−41.3" [ref=e366] [cursor=pointer]
                    - cell "−22.2" [ref=e367] [cursor=pointer]
                  - row "741 −14.5 −7.8" [ref=e368]:
                    - rowheader "741" [ref=e369]:
                      - button "741" [ref=e370] [cursor=pointer]
                    - cell "−14.5" [ref=e371] [cursor=pointer]
                    - cell "−7.8" [ref=e372] [cursor=pointer]
              - paragraph [ref=e373]: Exact expiry-cell contributions; missing cells are not inferred from marginal totals. Every supplied date remains available in the scope menu.
            - group [ref=e374]:
              - generic "Stored book snapshots" [ref=e375] [cursor=pointer]
              - option "Latest snapshot" [selected]
              - option "2026-10-16"
              - option "2026-10-15"
            - group [ref=e376]:
              - generic "Source & coverage" [ref=e377] [cursor=pointer]
          - generic [ref=e378]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e379]
```

# Test source

```ts
  355 |     await expect(map.getByTestId("exposure-partial-coverage")).toContainText(
  356 |       `${qualified.toLocaleString()} / ${(qualified + missing).toLocaleString()}`);
  357 |     await expect(map).toContainText(lang === "en" ? "MEASURED NET · INCOMPLETE" : "已测净值 · 不完整");
  358 |     const leader = map.getByRole("button", { name: new RegExp(lang === "en" ? "Provisional net leader" : "暂定净值主节点") }).first();
  359 |     await expect(leader).toBeEnabled();
  360 |     if (native && root === "SPY") await expect(leader).toContainText("765");
  361 |     await leader.click();
  362 |     await expect(page.getByTestId("exposure-node-inspector")).toBeVisible();
  363 |     await expect(page.getByTestId("exposure-node-inspector")).toContainText(lang === "en" ? "Measured contributions" : "已测贡献");
  364 |     await page.screenshot({ path: `test-results/exposure-partial-${info.project.name}-${lang}.png` });
  365 |     await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  366 |     await page.getByTestId("exposure-node-inspector").getByRole("button", {
  367 |       name: lang === "en" ? "Open on main chart" : "在主图表打开", exact: true,
  368 |     }).click();
  369 |     await expect(page).toHaveURL(new RegExp(`/terminal\\?symbol=${root}#exposure=`));
  370 |     const reference = page.getByTestId("exposure-chart-reference");
  371 |     await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  372 |     await expect(reference).toContainText(p.clocks.source_session);
  373 |     await expect(reference.getByRole("button", {
  374 |       name: lang === "en" ? "Remove reference" : "移除参考线", exact: true,
  375 |     })).toHaveAttribute("aria-pressed", "true");
  376 |     await reference.getByRole("link", {
  377 |       name: lang === "en" ? "Return to Exposure" : "返回敞口", exact: true,
  378 |     }).click();
  379 |     await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", root);
  380 |     await expect(page.getByTestId("exposure-partial-coverage")).toContainText(
  381 |       `${qualified.toLocaleString()} / ${(qualified + missing).toLocaleString()}`);
  382 |   });
  383 | 
  384 |   test(`Projected exposure memory ${lang} preserves measurements without a false delta`, async ({ page }, info) => {
  385 |     await workspaceSource(page, lang, { SPY: 100 });
  386 |     await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY",
  387 |       route => route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-15",
  388 |         spot_ref: 100, net_gex_bn: 9.9, by_strike: [{ strike: 100, gamma_net: 999 }],
  389 |         exposure_projection: oneSidedWitness } }));
  390 |     await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_dates:SPY",
  391 |       route => route.fulfill({ json: { root: "SPY", dates: ["2026-10-15", "2026-10-14"], latest: "2026-10-15" } }));
  392 |     await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_at:SPY:2026-10-14",
  393 |       route => route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-14",
  394 |         spot_ref: 99, net_gex_bn: .02, by_strike: [{ strike: 100, gamma_net: 20 }] } }));
  395 |     await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  396 |     const map = page.getByTestId("exposure-map");
  397 |     await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  398 |     await map.getByRole("button", { name: lang === "en" ? "Changes" : "变化", exact: true }).click();
  399 |     const memory = map.getByTestId("options-market-memory");
  400 |     await expect(memory).toHaveAttribute("data-memory-status", "ready");
  401 |     await expect(memory.getByRole("status")).toHaveText(optionsT(lang)("memoryMissingComparison"));
  402 |     await memory.getByTestId("options-memory-details").locator("summary").click();
  403 |     await expect(memory).toContainText("+20M → +10K");
  404 |     await expect(memory).not.toContainText("999M");
  405 |     await expect(memory).not.toContainText("9.9B");
  406 |     await expect(memory.getByTestId("options-memory-measurement-basis")).toContainText(optionsT(lang)("memorySeparateTotals"));
  407 |     await expect(memory.getByText(lang === "en" ? "Δ vs prior · —" : "较上一快照 Δ · —", { exact: true })).toHaveCount(2);
  408 |     await memory.screenshot({ path: `test-results/exposure-projected-memory-${info.project.name}-${lang}.png` });
  409 |     await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  410 |   });
  411 | 
  412 |   test(`Archived exposure changes ${lang} compare the selected book`, async ({ page }, info) => {
  413 |     await workspaceSource(page, lang);
  414 |     await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_dates:SPY",
  415 |       route => route.fulfill({ json: { root: "SPY", dates: [SESSION, "2026-10-16", "2026-10-14"], latest: SESSION } }));
  416 |     await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_at:SPY:2026-10-14",
  417 |       route => route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-14",
  418 |         spot_ref: 749, net_gex_bn: .5, by_strike: [{ strike: 753, gamma_net: 22 }] } }));
  419 |     await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  420 |     const map = page.getByTestId("exposure-map");
  421 |     await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  422 |     const stored = map.getByTestId("exposure-stored-snapshots");
  423 |     await stored.locator("summary").click();
  424 |     await stored.locator("select").selectOption("2026-10-16");
  425 |     await expect(map).toHaveAttribute("data-source-session", "2026-10-16");
  426 |     await map.getByRole("button", { name: lang === "en" ? "Changes" : "变化", exact: true }).click();
  427 |     const memory = map.getByTestId("options-market-memory");
  428 |     await expect(memory).toHaveAttribute("data-memory-status", "ready");
  429 |     await expect(memory).toContainText("2026-10-14");
  430 |     await expect(memory).toContainText("2026-10-16");
  431 |     await expect(memory).toContainText("+22M → +88M");
  432 |     await expect(memory).not.toContainText(SESSION);
  433 |     await memory.screenshot({ path: `test-results/exposure-archive-memory-${info.project.name}-${lang}.png` });
  434 |     await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  435 |   });
  436 | 
  437 |   test(`Connected exposure workspace ${lang}: chart, comparison scopes, scanner and return`, async ({ page }, info) => {
  438 |     const errors: string[] = [];
  439 |     page.on("pageerror", e => errors.push(e.message));
  440 |     await observeExposureHeaderClearance(page);
  441 |     await workspaceSource(page, lang);
  442 |     await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  443 |     const map = page.getByTestId("exposure-map");
  444 |     await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  445 |     await expect(map.getByRole("button", { name: lang === "en" ? /Largest covered net node/ : /覆盖范围最大净节点/ })).toBeEnabled();
  446 |     await map.getByRole("button", { name: lang === "en" ? "Gamma + Vanna layers" : "Gamma + Vanna 双层", exact: true }).click();
  447 |     await expect(map.getByText(lang === "en" ? /Dual layers: solid Gamma/ : /双层视图：/)).toBeVisible();
  448 |     if (info.project.name === "mobile") expect((await map.locator(".chart-wrap canvas").first().boundingBox())!.y).toBeLessThan(700);
  449 |     // Every painted ranked label must clear the header; dense secondary labels
  450 |     // retain the renderer's existing collision rule, while the leader stays visible.
  451 |     try {
  452 |       await expect.poll(async () => {
  453 |         const rows = await exposureHeaderClearance(page);
  454 |         return rows.some(row => row.strike === 756) ? Math.min(...rows.map(row => row.gap)) : Number.NEGATIVE_INFINITY;
> 455 |       }).toBeGreaterThanOrEqual(4);
      |          ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  456 |     } finally {
  457 |       await info.attach("exposure-header-clearance-initial", {body:JSON.stringify(
  458 |         await exposureHeaderClearance(page),null,2),contentType:"application/json"});
  459 |     }
  460 |     const initialClearance = await exposureHeaderClearance(page);
  461 |     const primaryPaint = initialClearance.find(row => row.strike === 756)!.paint;
  462 |     const priceHeader = map.locator(".chart-wrap .statusline");
  463 |     await expect(priceHeader.locator(".status-ohlc b")).toHaveCount(4);
  464 |     for (const value of await priceHeader.locator(".status-ohlc b").all()) await expect(value).toBeVisible();
  465 |     await expect(priceHeader.locator(".status-change")).toBeVisible();
  466 |     await map.getByTitle(lang === "en" ? "Reset view" : "重置视图", {exact:true}).click();
  467 |     await expect.poll(async () => (await exposureHeaderClearance(page)).find(row => row.strike === 756)?.paint ?? 0)
  468 |       .toBeGreaterThan(primaryPaint);
  469 |     await expect.poll(async () => {
  470 |       const rows = await exposureHeaderClearance(page);
  471 |       return rows.some(row => row.strike === 756) ? Math.min(...rows.map(row => row.gap)) : Number.NEGATIVE_INFINITY;
  472 |     }).toBeGreaterThanOrEqual(4);
  473 |     await info.attach("exposure-header-clearance", {body:JSON.stringify({
  474 |       initial:initialClearance,afterFit:await exposureHeaderClearance(page),
  475 |     },null,2),contentType:"application/json"});
  476 |     if (info.project.name !== "mobile") await expect(map.getByTestId("exposure-implied-distance")).toContainText("0.49 σ");
  477 |     // Both retained static cells and the protected interactive cells need the
  478 |     // same compact column layout after their shared stylesheet is reconciled.
  479 |     const momentum = map.getByTestId("exposure-divergence");
  480 |     const grid = momentum.locator(":scope > div").nth(1);
  481 |     const cells = grid.locator(":scope > div, :scope > button");
  482 |     await expect(cells).toHaveCount(5);
  483 |     const layout = await cells.evaluateAll(elements => elements.map(element => {
  484 |       const style = getComputedStyle(element);
  485 |       return { tag: element.tagName, display: style.display, direction: style.flexDirection,
  486 |         top: style.paddingTop, left: style.paddingLeft };
  487 |     }));
  488 |     const phone = (page.viewportSize()?.width ?? 1440) <= 540;
  489 |     for (const cell of layout) {
  490 |       expect(cell.display).toBe("flex");
  491 |       expect(cell.direction).toBe("column");
  492 |       expect(cell.top).toBe(phone ? "8px" : "9px");
  493 |       expect(cell.left).toBe(phone ? "4px" : "6px");
  494 |     }
  495 |     const tags = [...new Set(layout.map(cell => cell.tag))];
  496 |     expect(tags.length).toBe(1);
  497 |     expect(["DIV", "BUTTON"]).toContain(tags[0]);
  498 |     if (tags[0] === "BUTTON") {
  499 |       await expect(grid.locator(":scope > button[data-timeframe]")).toHaveCount(5);
  500 |       await expect(grid.locator(':scope > button[aria-pressed="true"]')).toHaveCount(1);
  501 |     }
  502 |     await info.attach("momentum-layout", { body: JSON.stringify(layout, null, 2), contentType: "application/json" });
  503 |     for (const theme of ["dark", "light"]) {
  504 |       await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
  505 |       await page.screenshot({ path: `test-results/exposure-workspace-${info.project.name}-${lang}-${theme}.png` });
  506 |     }
  507 |     const stored = map.getByTestId("exposure-stored-snapshots");
  508 |     await stored.locator("summary").click();
  509 |     const sessions = stored.locator("select");
  510 |     await sessions.selectOption("2026-10-16");
  511 |     await expect(map).toHaveAttribute("data-source-session", "2026-10-16");
  512 |     await expect(map.getByRole("button", {name:lang === "en" ? "Return to latest book" : "返回最新账簿",exact:true})).toBeVisible();
  513 |     await expect(map.getByTestId("exposure-implied-distance")).toHaveCount(info.project.name === "mobile" ? 0 : 1);
  514 |     if (info.project.name !== "mobile") await expect(map.getByTestId("exposure-implied-distance")).toContainText("—");
  515 |     // A wrong-date archive cannot wear the selected session's label or values.
  516 |     await sessions.selectOption("2026-10-15");
  517 |     await expect(map).toHaveAttribute("data-source-session", "");
  518 |     await map.getByRole("button", {name:lang === "en" ? "Return to latest book" : "返回最新账簿",exact:true}).click();
  519 |     await expect(map).toHaveAttribute("data-source-session",SESSION);
  520 |     await map.getByRole("button", { name: lang === "en" ? "Compare" : "多市场对比", exact: true }).click();
  521 |     const board = page.getByTestId("exposure-board");
  522 |     await expect(board.getByTestId("exposure-market-4").locator('[data-leader="true"]')).toBeVisible();
  523 |     await expect(board.locator('[data-testid="exposure-comparison-chart"][data-chart-ready="true"]')).toHaveCount(4,{timeout:30_000});
  524 |     for (const chart of await board.getByTestId("exposure-comparison-chart").all()) {
  525 |       expect((await chart.locator(".chart-wrap").boundingBox())!.height).toBeGreaterThan(200);
  526 |       expect((await chart.locator("canvas").first().boundingBox())!.height).toBeGreaterThan(150);
  527 |     }
  528 |     await board.getByLabel(lang === "en" ? "Shared chart timeframe" : "统一图表周期").selectOption("30m");
  529 |     await expect(board.locator('[data-testid="exposure-comparison-chart"][data-chart-ready="true"]')).toHaveCount(4,{timeout:30_000});
  530 |     await board.getByLabel(lang === "en" ? "Shared chart timeframe" : "统一图表周期").selectOption("5m");
  531 |     await board.getByLabel(lang === "en" ? "Shared expiration scope" : "统一到期范围").selectOption("zero");
  532 |     const first = board.getByTestId("exposure-market-1"), second = board.getByTestId("exposure-market-2");
  533 |     await first.getByLabel(lang === "en" ? "Expiration scope 1" : "到期范围 1").selectOption("2026-10-23");
  534 |     await expect(second.getByLabel(lang === "en" ? "Expiration scope 2" : "到期范围 2")).toHaveValue("zero");
  535 |     // A Gamma-only matrix must not masquerade as an exact-expiry Vanna book.
  536 |     await board.getByRole("button", { name: "Vanna", exact: true }).click();
  537 |     await expect(first.getByText(lang === "en" ? "Metric unavailable" : "此指标不可用")).toBeVisible();
  538 |     await board.getByLabel(lang === "en" ? "Shared expiration scope" : "统一到期范围").selectOption("all");
  539 |     await expect(first.locator('[data-leader="true"]')).toBeVisible();
  540 |     await page.screenshot({ path: `test-results/exposure-comparison-${info.project.name}-${lang}.png` });
  541 |     if (info.project.name === "desktop") {
  542 |       await board.getByRole("button",{name:lang === "en" ? "Full-screen comparison" : "全屏对比",exact:true}).click();
  543 |       await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("data-testid"))).toBe("exposure-board");
  544 |       for (const pane of await board.locator('[data-testid^="exposure-market-"]').all()) {
  545 |         const bounds = (await pane.boundingBox())!;
  546 |         expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y+bounds.height).toBeLessThanOrEqual(901);
  547 |         expect((await pane.locator(".chart-wrap canvas").first().boundingBox())!.height).toBeGreaterThan(175);
  548 |       }
  549 |       await page.screenshot({path:`test-results/exposure-comparison-fullscreen-${lang}.png`});
  550 |       await board.getByRole("button",{name:lang === "en" ? "Exit full screen" : "退出全屏",exact:true}).click();
  551 |       await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  552 |     }
  553 |     await map.getByRole("button", { name: lang === "en" ? "Scanner" : "扫描", exact: true }).click();
  554 |     const scanner = page.getByTestId("exposure-scanner");
  555 |     await expect(scanner.locator("tbody tr")).toHaveCount(4);
```