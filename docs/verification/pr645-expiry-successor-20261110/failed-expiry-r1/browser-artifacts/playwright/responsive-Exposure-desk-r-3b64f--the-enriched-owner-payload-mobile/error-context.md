# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: responsive.spec.ts >> Exposure desk renders expiry VEX and CHEX from the enriched owner payload
- Location: e2e/responsive.spec.ts:1441:5

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('group', { name: 'Exposure axis' }).getByRole('button', { name: 'By Expiration', exact: true })

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
        - button "Settings" [ref=e12] [cursor=pointer]: U
    - main [ref=e13]:
      - generic [ref=e14]:
        - generic [ref=e15]:
          - generic [ref=e16]:
            - tablist "Options categories" [ref=e17]:
              - tab "Command" [ref=e18] [cursor=pointer]
              - tab "Flow" [ref=e19] [cursor=pointer]
              - tab "Exposure" [selected] [ref=e20] [cursor=pointer]
              - tab "Structure" [ref=e21] [cursor=pointer]
              - tab "Volatility" [ref=e22] [cursor=pointer]
              - tab "Statistics" [ref=e23] [cursor=pointer]
              - tab "Prophet" [ref=e24] [cursor=pointer]
            - link "Futures depth & footprint" [ref=e25] [cursor=pointer]:
              - /url: /options/futures
              - text: Futures
            - button "Open the four-step options workflow · 1/4 viewed" [ref=e26] [cursor=pointer]:
              - img [ref=e27]
              - generic [ref=e30]: 1/4 viewed
          - paragraph [ref=e31]:
            - text: Swipe to browse more categories
            - generic [ref=e32]: ↔
        - tablist "Options views" [ref=e34]:
          - tab "Exposure" [selected] [ref=e35] [cursor=pointer]
          - tab "Positioning" [ref=e36] [cursor=pointer]
          - tab "Levels" [ref=e37] [cursor=pointer]
      - generic [ref=e38]:
        - generic [ref=e39]:
          - 'generic "Market volatility regime: Mixed — normalizing" [ref=e40]':
            - generic [ref=e42]: Vol
            - text: Mixed — normalizing
          - generic [ref=e43]: as of 11:42:00delayed
        - generic [ref=e46]:
          - generic [ref=e47]:
            - generic [ref=e48]:
              - generic [ref=e49]:
                - img
                - combobox "Ticker" [ref=e50]: SPY
              - generic [ref=e51]: "751.71"
              - group [ref=e52]:
                - generic "Roots" [ref=e53] [cursor=pointer]
            - group "Exposure greek" [ref=e54]:
              - generic [ref=e55]: Exposure greek
              - button "Gamma exposure" [ref=e56] [cursor=pointer]: GEX
              - button "Delta exposure" [ref=e57] [cursor=pointer]: DEX
              - button "Vanna exposure" [active] [pressed] [ref=e58] [cursor=pointer]: VEX
              - button "Charm exposure" [ref=e59] [cursor=pointer]: CHEX
            - generic [ref=e60]:
              - generic [ref=e61]: walls & flip apply to gamma only
              - generic [ref=e62]:
                - text: as of Fri, Jul 10, 16:15 ET
                - generic [ref=e63]: · 123d old
            - button "3D Research Lab" [ref=e64] [cursor=pointer]
          - generic [ref=e65]:
            - generic [ref=e66]:
              - generic [ref=e67]:
                - group [ref=e68]:
                  - generic "By Strike" [ref=e69] [cursor=pointer]
                - navigation "Exposure sections" [ref=e70]:
                  - button "Market State" [ref=e71] [cursor=pointer]
                  - button "History" [ref=e72] [cursor=pointer]
              - generic [ref=e74]:
                - generic [ref=e75]:
                  - button "Expiration lens" [ref=e77] [cursor=pointer]:
                    - generic [ref=e78]: All expirations
                    - generic [ref=e79]: ▾
                  - button "0DTE" [disabled] [ref=e80] [cursor=pointer]
                  - group "Ladder side" [ref=e81]:
                    - button "Net" [pressed] [ref=e82] [cursor=pointer]
                    - button "Call/Put" [disabled] [ref=e83] [cursor=pointer]
                  - generic [ref=e84]: per-expiration split is gamma-only — switch to GEX to use the lens
                - group "Strike range" [ref=e86]:
                  - button "±2%" [ref=e87] [cursor=pointer]
                  - button "±5%" [ref=e88] [cursor=pointer]
                  - button "±10%" [ref=e89] [cursor=pointer]
                  - button "All" [pressed] [ref=e90] [cursor=pointer]
                - generic [ref=e91]:
                  - generic [ref=e92]: Strike
                  - generic [ref=e93]: Relative exposure
                  - generic [ref=e94]: Net VEX
                - generic [ref=e95]:
                  - generic [ref=e96]:
                    - generic [ref=e98]: "800"
                    - generic [ref=e101]: +258K
                  - generic [ref=e102]:
                    - generic [ref=e104]: "795"
                    - generic [ref=e107]: +720K
                  - generic [ref=e108]:
                    - generic [ref=e110]: "790"
                    - generic [ref=e113]: +1.4M
                  - generic [ref=e114]:
                    - generic [ref=e116]: "785"
                    - generic [ref=e119]: +12.2M
                  - generic [ref=e120]:
                    - generic [ref=e122]: "780"
                    - generic [ref=e125]: +24.0M
                  - generic [ref=e126]:
                    - generic [ref=e128]: "775"
                    - generic [ref=e131]: +37.2M
                  - generic [ref=e132]:
                    - generic [ref=e134]: "770"
                    - generic [ref=e137]: +65.1M
                  - generic [ref=e138]:
                    - generic [ref=e140]: "766"
                    - generic [ref=e143]: +131.5M
                  - generic [ref=e144]:
                    - generic [ref=e146]: "765"
                    - generic [ref=e149]: +179.4M
                  - generic [ref=e150]:
                    - generic [ref=e152]: "764"
                    - generic [ref=e155]: +239.1M
                  - generic [ref=e156]:
                    - generic [ref=e158]: "763"
                    - generic [ref=e161]: +318.3M
                  - generic [ref=e162]:
                    - generic [ref=e164]: "762"
                    - generic [ref=e167]: +421.1M
                  - generic [ref=e168]:
                    - generic [ref=e170]: "761"
                    - generic [ref=e173]: +503.0M
                  - generic [ref=e174]:
                    - generic [ref=e176]: "760"
                    - generic [ref=e179]: +599.7M
                  - generic [ref=e180]:
                    - generic [ref=e182]: "759"
                    - generic [ref=e185]: +647.6M
                  - generic [ref=e186]:
                    - generic [ref=e188]: "758"
                    - generic [ref=e191]: +619.6M
                  - generic [ref=e192]:
                    - generic [ref=e194]: "757"
                    - generic [ref=e197]: +554.0M
                  - generic [ref=e198]:
                    - generic [ref=e200]: "756"
                    - generic [ref=e203]: +495.9M
                  - generic [ref=e204]:
                    - generic [ref=e206]: "755"
                    - generic [ref=e209]: +446.2M
                  - generic [ref=e210]:
                    - generic [ref=e212]: "754"
                    - generic [ref=e215]: +412.1M
                  - generic [ref=e216]:
                    - generic [ref=e218]: "753"
                    - generic [ref=e221]: +375.0M
                  - generic [ref=e222]:
                    - generic [ref=e223]:
                      - generic [ref=e224]: "752"
                      - generic [ref=e225]: ▶
                    - generic [ref=e228]: +361.5M
                  - generic [ref=e229]:
                    - generic [ref=e231]: "751"
                    - generic [ref=e234]: +352.3M
                  - generic [ref=e235]:
                    - generic [ref=e237]: "750"
                    - generic [ref=e240]: +355.6M
                  - generic [ref=e241]:
                    - generic [ref=e243]: "749"
                    - generic [ref=e246]: +311.3M
                  - generic [ref=e247]:
                    - generic [ref=e249]: "748"
                    - generic [ref=e252]: "-350.3M"
                  - generic [ref=e253]:
                    - generic [ref=e255]: "747"
                    - generic [ref=e258]: "-337.6M"
                  - generic [ref=e259]:
                    - generic [ref=e261]: "746"
                    - generic [ref=e264]: "-380.4M"
                  - generic [ref=e265]:
                    - generic [ref=e267]: "745"
                    - generic [ref=e270]: "-438.2M"
                  - generic [ref=e271]:
                    - generic [ref=e273]: "744"
                    - generic [ref=e276]: "-493.5M"
                  - generic [ref=e277]:
                    - generic [ref=e279]: "743"
                    - generic [ref=e282]: "-539.3M"
                  - generic [ref=e283]:
                    - generic [ref=e285]: "742"
                    - generic [ref=e288]: "-562.7M"
                  - generic [ref=e289]:
                    - generic [ref=e291]: "741"
                    - generic [ref=e294]: "-556.0M"
                  - generic [ref=e295]:
                    - generic [ref=e297]: "740"
                    - generic [ref=e300]: "-560.2M"
                  - generic [ref=e301]:
                    - generic [ref=e303]: "739"
                    - generic [ref=e306]: "-474.5M"
                  - generic [ref=e307]:
                    - generic [ref=e309]: "738"
                    - generic [ref=e312]: "-372.4M"
                  - generic [ref=e313]:
                    - generic [ref=e315]: "737"
                    - generic [ref=e318]: "-303.6M"
                  - generic [ref=e319]:
                    - generic [ref=e321]: "736"
                    - generic [ref=e324]: "-217.2M"
                  - generic [ref=e325]:
                    - generic [ref=e327]: "735"
                    - generic [ref=e330]: "-167.2M"
                  - generic [ref=e331]:
                    - generic [ref=e333]: "730"
                    - generic [ref=e336]: "-62.1M"
                  - generic [ref=e337]:
                    - generic [ref=e339]: "725"
                    - generic [ref=e342]: "-43.6M"
                  - generic [ref=e343]:
                    - generic [ref=e345]: "720"
                    - generic [ref=e348]: "-24.3M"
                  - generic [ref=e349]:
                    - generic [ref=e351]: "715"
                    - generic [ref=e354]: "-20.0M"
                  - generic [ref=e355]:
                    - generic [ref=e357]: "710"
                    - generic [ref=e360]: "-2.0M"
                  - generic [ref=e361]:
                    - generic [ref=e363]: "705"
                    - generic [ref=e366]: "-659K"
                  - generic [ref=e367]:
                    - generic [ref=e369]: "700"
                    - generic [ref=e372]: "-279K"
                - group "Bar scale" [ref=e374]:
                  - button "NOW ±647.6M" [pressed] [ref=e375] [cursor=pointer]
                  - button "LADDER MAX ±647.6M" [ref=e376] [cursor=pointer]
              - generic [ref=e378]:
                - generic [ref=e379]:
                  - generic [ref=e382]: Net GEX
                  - generic [ref=e385]: Put Support
                  - generic [ref=e388]: Magnet / HVL
                  - generic [ref=e391]: Gamma Flip
                - button "How to Read ▼" [ref=e392] [cursor=pointer]
              - button "Exposure by expiry 11 exp · EOD" [ref=e394] [cursor=pointer]:
                - generic [ref=e395]: ▶
                - generic [ref=e396]: Exposure by expiry
                - generic [ref=e397]: 11 exp · EOD
            - generic [ref=e398]:
              - generic [ref=e399]:
                - generic [ref=e400]:
                  - generic [ref=e401]: Market State
                  - time [ref=e402]: Regime as of 2026-07-10
                - generic [ref=e403]:
                  - generic [ref=e404]:
                    - generic [ref=e405]: PIN
                    - generic [ref=e406]: Net γ POSITIVE
                  - generic [ref=e407]: Strong dealer positioning near magnet — bounded range structure.
                  - generic [ref=e408]:
                    - generic [ref=e409]:
                      - generic [ref=e410]: Stability
                      - img "69 out of 100" [ref=e411]:
                        - img [ref=e412]
                        - generic [ref=e416]: "69"
                    - generic [ref=e417]:
                      - generic [ref=e418]:
                        - generic [ref=e419]: Stability
                        - generic [ref=e420]: 69%
                      - generic [ref=e421]:
                        - generic [ref=e422]: Dist to flip
                        - generic [ref=e423]: 0.46% above
                - generic [ref=e425]:
                  - text: Structural Range
                  - generic [ref=e426]:
                    - generic [ref=e427]:
                      - generic [ref=e428]: "740"
                      - generic [ref=e429]: PUT SUPP
                      - generic [ref=e430]: CALL WALL
                      - generic [ref=e431]: "760"
                    - generic [ref=e437]:
                      - generic [ref=e438]: FLIP
                      - generic [ref=e439]: SPOT
                - generic [ref=e441]:
                  - generic [ref=e442]: γ polarity
                  - generic [ref=e443]:
                    - generic [ref=e444]: LONG γ DOMINANT
                    - generic [ref=e445]: 59%
                - generic [ref=e447]:
                  - generic [ref=e448]: Hedge pressure
                  - generic [ref=e449]:
                    - generic [ref=e450]: HIGH
                    - generic [ref=e451]: "|net γ| 4.67B"
                - generic [ref=e453]:
                  - generic [ref=e454]: Pin Target
                  - generic [ref=e455]:
                    - generic [ref=e456]: "750"
                    - generic [ref=e457]: 54% prob
                - group [ref=e458]:
                  - generic "Details and provenance" [ref=e459] [cursor=pointer]
                - generic [ref=e461]:
                  - text: Levels map — dealer-sign assumed; display-only
                  - text: "Forward-vol gate: display-only until ~Sept 2026"
              - generic [ref=e463]:
                - generic [ref=e464]:
                  - generic [ref=e465]: ★
                  - generic [ref=e466]: HeatSeeker Pick
                  - generic [ref=e467]: GEX
                - generic [ref=e468]: descriptive — not a recommendation
                - generic [ref=e469]:
                  - generic [ref=e470]:
                    - generic [ref=e471]:
                      - generic [ref=e472]: $760
                      - generic "+1.1% from spot" [ref=e473]: +1.1%
                    - generic [ref=e474]:
                      - generic [ref=e475]: Standout ratio
                      - generic [ref=e476]: 3.10×
                  - generic [ref=e477]:
                    - generic [ref=e478]: Confidence %
                    - img "70 out of 100" [ref=e479]:
                      - img [ref=e480]
                      - generic [ref=e484]: "70"
                - generic [ref=e485]:
                  - text: Expiry
                  - generic [ref=e486]: Jul 17 · 7d
          - group [ref=e488]:
            - generic "Snapshot levels" [ref=e489] [cursor=pointer]
          - region "History" [ref=e490]:
            - generic [ref=e491]:
              - generic [ref=e492]:
                - generic [ref=e493]: Net GEX — history
                - generic [ref=e494]:
                  - combobox "Archived session" [ref=e495]:
                    - option "Latest snapshot" [selected]
                    - option "2026-07-09"
                    - option "2026-07-08"
                    - option "2026-07-06"
                    - option "2026-07-02"
                  - generic [ref=e496]: drag · ← → keys
                  - generic [ref=e497]: 6 sessions
              - generic [ref=e498]:
                - slider "Net gamma exposure across recent sessions" [ref=e500]:
                  - generic [ref=e502]: +0B
                  - generic [ref=e504]: +5B
                - generic [ref=e508]:
                  - generic [ref=e509]:
                    - generic [ref=e510]: 2026-07-10
                    - generic [ref=e511]: Latest
                  - generic [ref=e512]:
                    - generic [ref=e513]: Net GEX
                    - generic [ref=e514]:
                      - text: +4.7B
                      - generic [ref=e515]: ▲6.0
                  - generic [ref=e516]:
                    - generic [ref=e517]: Flip
                    - generic [ref=e518]: "748.3"
                  - generic [ref=e519]:
                    - generic [ref=e520]: Call Wall
                    - generic [ref=e521]: "760"
                  - generic [ref=e522]:
                    - generic [ref=e523]: Put Support
                    - generic [ref=e524]: "740"
                  - generic [ref=e525]:
                    - generic [ref=e526]: Regime
                    - generic [ref=e527]:
                      - img "γ-polarity shifted this session" [ref=e528]: •
                      - text: long γ
              - generic [ref=e529]: 2026-07-02 → 2026-07-10
            - generic [ref=e530]:
              - region "End-of-day options structure context" [ref=e531]:
                - generic [ref=e532]:
                  - generic [ref=e533]: EOD structure
                  - generic [ref=e534]: settled close — not live
                - generic [ref=e537]:
                  - generic [ref=e538]:
                    - generic [ref=e539]: Call wall
                    - generic [ref=e540]: "760"
                    - generic [ref=e541]: EOD · Jul 10
                  - generic [ref=e542]:
                    - generic [ref=e543]: Put wall
                    - generic [ref=e544]: "740"
                    - generic [ref=e545]: EOD · Jul 10
                  - generic [ref=e546]:
                    - generic [ref=e547]: Gamma flip
                    - generic [ref=e548]: "748.3"
                    - generic [ref=e549]: EOD · Jul 10
                  - generic [ref=e550]:
                    - generic [ref=e551]: Expected move
                    - generic [ref=e552]:
                      - text: ±2.0%
                      - generic [ref=e553]: 723.7 – 752.7
                    - generic [ref=e554]: band ×1.96 · 1d horizon · method not stated by source
                    - generic [ref=e555]: EOD · Jul 23
                  - generic [ref=e556]:
                    - generic [ref=e557]: Max pain
                    - generic [ref=e558]: "745"
                    - generic [ref=e559]: EOD · Jul 10
                  - generic [ref=e560]:
                    - generic [ref=e561]: IV percentile
                    - generic [ref=e562]:
                      - text: "38"
                      - generic [ref=e563]: ATM IV 16.2%
                    - generic [ref=e564]: EOD · Jul 5
                  - generic [ref=e565]:
                    - generic [ref=e566]: OI confirmed
                    - generic [ref=e567]:
                      - text: "1"
                      - generic [ref=e568]: +1,500 OI
                    - generic [ref=e569]: EOD · Jul 23
              - region "Dark pool positioning context" [ref=e570]:
                - generic [ref=e571]:
                  - generic [ref=e572]: Dark pool
                  - generic [ref=e573]: EOD · Jul 24
                - paragraph [ref=e574]: SPY isn't in the off-exchange panel
                - paragraph [ref=e575]: The panel is built from FINRA facility reporting over a fixed list of names — ETFs and thinner tickers aren't in it.
        - generic [ref=e576]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e577]
```

# Test source

```ts
  1349 |           ts: stopTs, known_ts: stopTs, bar_index: 420, type: "SELL", price: 440.6,
  1350 |           basis: "structure_stop", stop_level: 456.2,
  1351 |           reasons: ["distribution_confirmed", "structure_break"],
  1352 |         },
  1353 |         {
  1354 |           // still typed BUY on purpose — additive contract; `blocked` is the render key
  1355 |           ts: blockedTs, known_ts: blockedTs, bar_index: 424, type: "BUY", price: 110.7,
  1356 |           quality: "regime_blocked", blocked: true, tier: null, score: null,
  1357 |           quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull",
  1358 |         },
  1359 |       ],
  1360 |       early_dots: [],
  1361 |       warnings: [],
  1362 |     },
  1363 |     backtest: { metrics: { n_trades: 10, win_rate: 0.3, profit_factor: 1.4, cagr: 0.05 } },
  1364 |   };
  1365 |   await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, async (route) => {
  1366 |     await route.fulfill({ contentType: "application/json", body: JSON.stringify(slice) });
  1367 |   });
  1368 |   await armTerminalVisualReady(page);
  1369 |   await page.goto("/terminal?symbol=COST");
  1370 |   await expect(page.locator(".workspace")).toBeVisible();
  1371 |   await waitForTerminalVisualReady(page);
  1372 | 
  1373 |   // NOT asserted here: the on-chart "GOLDEN ORACLE · STOP" chip. The Golden Oracle is an
  1374 |   // opt-in study, and its chip text repaints on the next data render rather than on the
  1375 |   // indicator toggle, so driving it from this test would be timing-dependent in the shared
  1376 |   // CI lane. Its label derives from the same isStructureStop() helper asserted here and unit-
  1377 |   // tested in lib/__tests__/signalVerdict.test.ts.
  1378 | 
  1379 |   const signalButton = page.locator(".sig-btn");
  1380 |   await signalButton.scrollIntoViewIfNeeded();
  1381 |   if (zh) {
  1382 |     await page.locator(".mobilebar button.avatar").click();
  1383 |     const settings = page.locator(".acs-card");
  1384 |     await settings.getByRole("tab", { name: "Preferences" }).click();
  1385 |     const zhButton = settings.getByRole("button", { name: "中文" });
  1386 |     await zhButton.click();
  1387 |     await expect(zhButton).toHaveAttribute("aria-pressed", "true");
  1388 |     await page.keyboard.press("Escape");
  1389 |     await expect(settings).toBeHidden();
  1390 |     await signalButton.scrollIntoViewIfNeeded();
  1391 |   }
  1392 | 
  1393 |   // ── the rail card: the stop names itself, and the refusal rides with it ──
  1394 |   await expect(signalButton.locator(".sig-btn-go .sig-btn-vd")).toHaveText(zh ? "结构止损" : "Structure stop");
  1395 |   await expect(signalButton.locator(".sig-btn-go .sig-btn-sub")).toContainText(shortDate(stopTs));
  1396 |   await expect(signalButton.locator(".sig-btn-go .sig-btn-sub")).toContainText(zh ? "入场被拦截" : "entry blocked");
  1397 |   await signalButton.screenshot({
  1398 |     path: testInfo.outputPath(`${testInfo.project.name}-hko1-rail-card.png`),
  1399 |   });
  1400 | 
  1401 |   await signalButton.click();
  1402 |   const dialog = page.getByTestId("intelligence-workspace");
  1403 |   await expect(dialog).toBeVisible();
  1404 | 
  1405 |   await expect(dialog.getByTestId("workspace-summary")).toContainText(zh ? "入场被拦截" : "entry blocked");
  1406 |   await dialog.getByRole("tab", { name: zh ? "神谕" : "Oracle", exact: true }).click();
  1407 |   // ── the refused entry gets its own disclosure, never the entry scorecard ──
  1408 |   await expect(dialog.locator(".sd-go .sig-conflict").filter({ hasText: zh ? "非入场信号" : "not an entry" }))
  1409 |     .toBeVisible();
  1410 |   // no tier/score row for a marker the engine refused
  1411 |   await expect(dialog.locator(".sd-go .sig-dims")).toHaveCount(0);
  1412 | 
  1413 |   // ── signal history: BLOCKED (newest) above STOP, neither wearing a buy pill ──
  1414 |   await dialog.getByRole("tab", { name: zh ? "动态" : "Activity", exact: true }).click();
  1415 |   const rows = dialog.locator(".sd-go .sd-sigrow");
  1416 |   const blockedRow = rows.first();
  1417 |   await blockedRow.scrollIntoViewIfNeeded();
  1418 |   await expect(blockedRow.locator(".sd-sig-badge")).toHaveText(zh ? "已拦截" : "BLOCKED");
  1419 |   await expect(blockedRow.locator(".sd-sig-badge")).toHaveClass(/hollow/);
  1420 |   await expect(blockedRow.locator(".sd-sig-q")).toHaveText(zh ? "非入场信号" : "not an entry");
  1421 |   await expect(blockedRow).toHaveAttribute("title", zh ? /入场被趋势闸拒绝/ : /Entry refused by the regime gate/);
  1422 | 
  1423 |   const stopRow = rows.nth(1);
  1424 |   await expect(stopRow.locator(".sd-sig-badge")).toHaveText(zh ? "止损" : "STOP");
  1425 |   await expect(stopRow.locator(".sd-sig-q")).toHaveText(zh ? "跌破前低" : "swing-low break");
  1426 |   await expect(stopRow).toHaveAttribute("title", zh ? /结构止损 — 日线收盘跌破前低 456.2/ : /Structure stop — the daily close broke the prior swing low at 456.2/);
  1427 |   // PIT price: the confirm session's own daily close, as emitted
  1428 |   await expect(stopRow.locator(".sd-sig-price")).toHaveText("440.60");
  1429 | 
  1430 |   await dialog.locator(".sd-go").screenshot({
  1431 |     path: testInfo.outputPath(`${testInfo.project.name}-hko1-signal-history.png`),
  1432 |   });
  1433 | 
  1434 |   const overflow = await page.evaluate(() => ({
  1435 |     viewport: window.innerWidth,
  1436 |     document: document.documentElement.scrollWidth,
  1437 |   }));
  1438 |   expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  1439 | });
  1440 | 
  1441 | test("Exposure desk renders expiry VEX and CHEX from the enriched owner payload", async ({ page }, testInfo) => {
  1442 |   await page.goto("/options?tab=gex");
  1443 | 
  1444 |   const vanna = page.getByRole("button", { name: "Vanna exposure", exact: true });
  1445 |   await expect(vanna).toBeVisible({ timeout: 15_000 });
  1446 |   await vanna.click();
  1447 | 
  1448 |   const axis = page.getByRole("group", { name: "Exposure axis" });
> 1449 |   await axis.getByRole("button", { name: "By Expiration", exact: true }).click();
       |                                                                          ^ Error: locator.click: Test timeout of 60000ms exceeded.
  1450 | 
  1451 |   const expiryRegion = page.locator(".obs-gexdesk-ladder-region");
  1452 |   await expect(expiryRegion).toBeVisible();
  1453 |   await expect(expiryRegion.getByText("-2.4M", { exact: true })).toBeVisible();
  1454 |   await expect(expiryRegion.getByText("+2.1M", { exact: true })).toBeVisible();
  1455 |   await expect(page.getByText("This snapshot does not provide Vanna or Charm by expiration."))
  1456 |     .toHaveCount(0);
  1457 | 
  1458 |   const drawerHeader = page.locator(".obs-xdrawer-hd");
  1459 |   await expect(drawerHeader).toContainText("11 exp");
  1460 |   await drawerHeader.click();
  1461 | 
  1462 |   const term = page.getByRole("img", { name: "Exposure by expiry term structure" });
  1463 |   await expect(term).toBeVisible();
  1464 |   await expect(term.getByText("-2.4M", { exact: true })).toBeVisible();
  1465 |   await expect(term.getByText("+2.1M", { exact: true })).toBeVisible();
  1466 | 
  1467 |   const charm = page.getByRole("button", { name: "Charm exposure", exact: true });
  1468 |   await charm.click();
  1469 |   await expect(expiryRegion.getByText("+700K", { exact: true })).toBeVisible();
  1470 |   await expect(expiryRegion.getByText("-400K", { exact: true })).toBeVisible();
  1471 |   await expect(term.getByText("+700K", { exact: true })).toBeVisible();
  1472 |   await expect(page.getByText("This snapshot does not provide Vanna or Charm by expiration."))
  1473 |     .toHaveCount(0);
  1474 | 
  1475 |   const overflow = await page.evaluate(() => ({
  1476 |     viewport: window.innerWidth,
  1477 |     document: document.documentElement.scrollWidth,
  1478 |   }));
  1479 |   expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  1480 | 
  1481 |   await drawerHeader.click();
  1482 |   await expect(drawerHeader).toHaveAttribute("aria-expanded", "false");
  1483 |   for (const label of ["+700K", "-400K"]) {
  1484 |     const value = expiryRegion.getByText(label, { exact: true });
  1485 |     await value.scrollIntoViewIfNeeded();
  1486 |     await expect(value).toBeInViewport();
  1487 |   }
  1488 |   await page.screenshot({
  1489 |     path: testInfo.outputPath(`${testInfo.project.name}-expiry-vex-chex.png`),
  1490 |     fullPage: false,
  1491 |   });
  1492 | });
  1493 | 
  1494 | test("Exposure desk replays an archived session's full ladder at every supported width", async ({ page }, testInfo) => {
  1495 |   await page.goto("/options?tab=gex");
  1496 | 
  1497 |   // Live desk up first: the ladder and the session dropdown (driven by the
  1498 |   // gex_history dates.json index — R0.10) are both on screen, no archived chip yet.
  1499 |   const picker = page.getByRole("combobox", { name: "Archived session" });
  1500 |   await expect(picker).toBeVisible({ timeout: 15_000 });
  1501 |   await expect(page.getByRole("group", { name: "Strike range" })).toBeVisible();
  1502 |   await expect(page.getByTestId("gex-archived-chip")).toHaveCount(0);
  1503 | 
  1504 |   // Child rows can be technically visible while a flex container collapses to zero height.
  1505 |   // Guard the actual ladder-region band at desktop, tablet and phone widths.
  1506 |   const ladderRegionH = await page.locator(".obs-gexdesk-ladder-region")
  1507 |     .evaluate((el) => el.getBoundingClientRect().height);
  1508 |   expect(ladderRegionH).toBeGreaterThanOrEqual(150);
  1509 | 
  1510 |   // exposure-workspace.spec.ts measures fully visible rows before interacting with this picker.
  1511 | 
  1512 |   // Pick an archived session → that session's FULL ladder, labelled as archived.
  1513 |   await picker.selectOption("2026-07-02");
  1514 |   const chip = page.getByTestId("gex-archived-chip");
  1515 |   await expect(chip).toBeVisible();
  1516 |   await expect(chip).toContainText("archived session · 2026-07-02");
  1517 |   await expect(page.getByRole("group", { name: "Strike range" })).toBeVisible();
  1518 |   // The replay withdraws the current-session rail and says so, instead of leaving
  1519 |   // an empty column that reads as breakage.
  1520 |   await expect(page.getByText("Archived session", { exact: true })).toBeVisible();
  1521 | 
  1522 |   // Conditional replay actions must not resize the history strip. The original
  1523 |   // implementation added the button as another readout row and shifted the entire
  1524 |   // ladder section whenever keyboard or pointer scrubbing entered a prior session.
  1525 |   const historyCard = page.locator(".obs-gex-history");
  1526 |   const latestHeight = await historyCard.evaluate((el) => el.getBoundingClientRect().height);
  1527 | 
  1528 |   // The scrubber probes a session the index does NOT list (2026-07-07 — the fixture's
  1529 |   // deliberate accrual hole, the prod 07-18/07-20 class): honest missing-session state,
  1530 |   // never a fabricated ladder.
  1531 |   const scrubber = page.locator('svg[role="slider"]');
  1532 |   await scrubber.focus();
  1533 |   await page.keyboard.press("Home");
  1534 |   await page.keyboard.press("ArrowRight");
  1535 |   await page.keyboard.press("ArrowRight");
  1536 |   const loadFullLadder = page.getByRole("button", { name: "Load full ladder" });
  1537 |   await expect(loadFullLadder).toBeVisible();
  1538 |   const replayHeight = await historyCard.evaluate((el) => el.getBoundingClientRect().height);
  1539 |   expect(Math.abs(replayHeight - latestHeight)).toBeLessThanOrEqual(1);
  1540 |   await loadFullLadder.click();
  1541 |   await expect(chip).toContainText("archived session · 2026-07-07");
  1542 |   const missing = page.getByTestId("gex-archived-missing");
  1543 |   await expect(missing).toBeVisible();
  1544 |   await expect(missing).toContainText("No archived snapshot for 2026-07-07");
  1545 | 
  1546 |   // Back to the live session: chip gone, live ladder back.
  1547 |   await page.getByRole("button", { name: "Back to latest" }).first().click();
  1548 |   await expect(page.getByTestId("gex-archived-chip")).toHaveCount(0);
  1549 |   await expect(page.getByRole("group", { name: "Strike range" })).toBeVisible();
```