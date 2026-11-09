# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-exposure-surface-journey.spec.ts >> synthetic exposure saved theme cold return en
- Location: e2e/options-exposure-surface-journey.spec.ts:1413:7

# Error details

```
Error: canonical fixture account actually loaded

canonical fixture account actually loaded

expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
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
      - button "Settings" [ref=e14] [cursor=pointer]: R
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
      - link "Options" [ref=e30] [cursor=pointer]:
        - /url: /options
        - img [ref=e31]
      - link "Scripts" [ref=e34] [cursor=pointer]:
        - /url: /scripts
        - img [ref=e35]
      - link "Portfolio" [ref=e39] [cursor=pointer]:
        - /url: /portfolio
        - img [ref=e40]
      - link "Alerts" [ref=e42] [cursor=pointer]:
        - /url: /alerts
        - img [ref=e43]
      - button "Mastermind AI" [ref=e46] [cursor=pointer]:
        - img [ref=e47]
    - main [ref=e49]:
      - generic [ref=e50]:
        - generic [ref=e51]:
          - generic [ref=e52]: Category
          - generic [ref=e53]:
            - tablist "Options categories" [ref=e54]:
              - tab "Command" [ref=e55] [cursor=pointer]
              - tab "Flow" [ref=e56] [cursor=pointer]
              - tab "Exposure" [selected] [ref=e57] [cursor=pointer]
              - tab "Structure" [ref=e58] [cursor=pointer]
              - tab "Volatility" [ref=e59] [cursor=pointer]
              - tab "Statistics" [ref=e60] [cursor=pointer]
              - tab "Prophet" [ref=e61] [cursor=pointer]
            - link "Futures depth & footprint" [ref=e62] [cursor=pointer]:
              - /url: /options/futures
              - text: Futures
            - button "Open the four-step options workflow · 1/4 viewed" [ref=e63] [cursor=pointer]:
              - img [ref=e64]
              - generic [ref=e67]: Workflow
              - generic [ref=e68]: 1/4 viewed
        - generic [ref=e69]:
          - generic [ref=e70]: View
          - tablist "Options views" [ref=e71]:
            - tab "Exposure" [selected] [ref=e72] [cursor=pointer]
            - tab "Positioning" [ref=e73] [cursor=pointer]
            - tab "Levels" [ref=e74] [cursor=pointer]
      - generic [ref=e75]:
        - generic [ref=e80]:
          - navigation "Exposure workspace" [ref=e81]:
            - combobox "Exposure symbol" [ref=e82]: SPY
            - button "Structure" [pressed] [ref=e83] [cursor=pointer]
            - button "Compare" [ref=e84] [cursor=pointer]
            - button "Scanner" [ref=e85] [cursor=pointer]
            - generic [ref=e86]:
              - generic [ref=e87]: Data quality · 8
              - group [ref=e89]:
                - generic "Learn the view" [ref=e90] [cursor=pointer]: "?"
            - group [ref=e91]:
              - generic "Tools" [ref=e92] [cursor=pointer]
          - generic [ref=e93]:
            - generic [ref=e94]:
              - generic [ref=e95]:
                - generic [ref=e96]: OPTIONS · EXPOSURE · SPY
                - heading "SPY Exposure map" [level=2] [ref=e97]:
                  - text: SPY
                  - generic [ref=e98]: Exposure map
                - paragraph [ref=e99]:
                  - code [ref=e100]: SEC:SPY · v1
                  - emphasis [ref=e101]: Contract coverage
                - paragraph [ref=e102]: reference spot $100 · 2026-10-19T20:00:00Z · 2 expiries · 2 strikes
                - paragraph [ref=e103]: Per-contract coverage supplied. Unknown terms are withheld; full-market coverage remains unknown. Inventory is modeled.
              - generic [ref=e104]:
                - button "Sources & coverage ↗" [ref=e105] [cursor=pointer]
                - link "Open investigation" [ref=e106] [cursor=pointer]:
                  - /url: /analysis?view=investigations&symbol=SPY
            - generic [ref=e107]:
              - group "Exposure metric" [ref=e108]:
                - button "Gamma" [pressed] [ref=e109] [cursor=pointer]
                - button "Delta EXT" [ref=e110] [cursor=pointer]:
                  - text: Delta
                  - emphasis [ref=e111]: EXT
                - button "Vanna" [ref=e112] [cursor=pointer]
                - button "Charm" [ref=e113] [cursor=pointer]
                - button "Combined" [ref=e114] [cursor=pointer]
              - generic [ref=e115]:
                - text: Expiration scope
                - combobox "Expiration scope" [ref=e116]:
                  - option "All supplied expirations" [selected]
                  - option "Source-session 0DTE"
                  - option "Next live economic expiry"
                  - option "Live expiries this exchange week"
                  - option "2026-10-23"
                  - option "2026-10-30"
              - button "Gamma + Vanna layers" [ref=e117] [cursor=pointer]
              - generic [ref=e118]:
                - button "Signed net" [pressed] [ref=e119] [cursor=pointer]
                - button "Gross gamma" [ref=e120] [cursor=pointer]
          - generic [ref=e121]:
            - generic [ref=e122]:
              - generic [ref=e123]: COVERED BOOK NET
              - strong [ref=e124]: +210 M
              - generic [ref=e125]: per +1% spot
            - button "Largest covered net node 103 +300M · 80.3% of gross" [ref=e126] [cursor=pointer]:
              - generic [ref=e127]: Largest covered net node
              - strong [ref=e128]: "103"
              - generic [ref=e129]: +300M · 80.3% of gross
            - generic [ref=e130]:
              - generic [ref=e131]: CONTESTED · RUNNER-UP
              - strong [ref=e132]:
                - text: "98"
                - generic [ref=e133]: 0.30×
              - generic [ref=e137]: threshold 0.90 · runner-up-ratio/v1
            - generic [ref=e138]:
              - generic [ref=e139]: QUALIFIED CONTRACTS
              - strong [ref=e140]:
                - text: "8"
                - generic [ref=e141]: / 8
              - generic [ref=e142]: 0 without identity
            - generic [ref=e143]:
              - generic [ref=e144]: CLOCKS
              - strong [ref=e145]: Observed 10-19 20:00Z
              - generic [ref=e146]: OI as of 2026-10-19 · published Not supplied
              - generic [ref=e147]: source available 10-19 20:01Z
          - generic [ref=e148]:
            - generic [ref=e149]:
              - generic [ref=e150]:
                - generic "Price timeframe" [ref=e151]:
                  - button "5m" [pressed] [ref=e152] [cursor=pointer]
                  - button "30m" [ref=e153] [cursor=pointer]
                  - button "2h" [ref=e154] [cursor=pointer]
                  - button "D" [ref=e155] [cursor=pointer]
                  - button "W" [ref=e156] [cursor=pointer]
                - generic [ref=e157]:
                  - button "MA references" [pressed] [ref=e158] [cursor=pointer]
                  - button "Reset view" [ref=e159] [cursor=pointer]
              - generic [ref=e160]:
                - generic "SMA 5 · D · 2026-10-19T16:00 ET" [ref=e161]:
                  - text: SMA 5 · D 100.3
                  - time [ref=e162]: 10-19
                - generic "EMA 21 · D · 2026-10-19T16:00 ET" [ref=e163]:
                  - text: EMA 21 · D 100.36
                  - time [ref=e164]: 10-19
                - generic "SMA 55 · D · 2026-10-19T16:00 ET" [ref=e165]:
                  - text: SMA 55 · D 100.18
                  - time [ref=e166]: 10-19
                - generic "SMA 34 · 5m · 2026-10-19T16:00 ET" [ref=e167]:
                  - text: SMA 34 · 5m 99.68
                  - time [ref=e168]: 10-19
                - generic [ref=e169]: Closed-bar snapshot references
              - generic "Price chart" [ref=e170]:
                - generic [ref=e172]:
                  - generic:
                    - generic:
                      - generic:
                        - generic:
                          - generic: S
                        - generic: SPY · 5m
                      - generic:
                        - generic: O100.00H100.12L99.88C100.00
                        - generic: "-0.00 (-0.00%)"
                  - table [ref=e175]:
                    - row [ref=e176]:
                      - cell
                      - cell [ref=e177]
                      - cell [ref=e181]
                    - row [ref=e185]:
                      - cell
                      - cell [ref=e186]
                      - cell [ref=e190]
                  - img
                  - img
                  - img
                  - generic:
                    - generic: SPY
                    - generic:
                      - generic: "100.00"
                      - generic: 00:00
                - generic [ref=e193]:
                  - generic [ref=e194]: + Positive exposure − Negative exposure ◆ Selected node
                  - generic [ref=e195]: Selected snapshot references · not historical evolution or a forecast
              - generic [ref=e196]:
                - generic [ref=e197]:
                  - generic [ref=e198]: CONFIRMED MOMENTUM
                  - button "Refresh" [ref=e199] [cursor=pointer]
                - generic [ref=e200]:
                  - button "5m · Regular bearish · 10 bars since confirmation · 2026-10-19 15:10 ET · rsi14-w2-s60-v1 · Regular only" [pressed] [ref=e201] [cursor=pointer]:
                    - generic [ref=e202]: 5m
                    - strong [ref=e203]: Regular bearish
                    - generic [ref=e204]: 10 bars since confirmation
                  - button "30m · Insufficient history · rsi14-w2-s60-v1 · Regular only" [ref=e205] [cursor=pointer]:
                    - generic [ref=e206]: 30m
                    - strong [ref=e207]: Insufficient history
                  - button "2h · Insufficient history · rsi14-w2-s60-v1 · Regular only" [ref=e208] [cursor=pointer]:
                    - generic [ref=e209]: 2h
                    - strong [ref=e210]: Insufficient history
                  - button "Daily · Regular bearish · 8 bars since confirmation · 2026-10-07 16:00 ET · rsi14-w2-s60-v1 · Regular only" [ref=e211] [cursor=pointer]:
                    - generic [ref=e212]: Daily
                    - strong [ref=e213]: Regular bearish
                    - generic [ref=e214]: 8 bars since confirmation
                  - button "Weekly · Regular bearish · 0 bars since confirmation · 2026-10-16 16:00 ET · rsi14-w2-s60-v1 · Regular only" [ref=e215] [cursor=pointer]:
                    - generic [ref=e216]: Weekly
                    - strong [ref=e217]: Regular bearish
                    - generic [ref=e218]: 0 bars since confirmation
                - generic [ref=e219]: rsi14-w2-s60-v1 · Regular only
                - group [ref=e220]:
                  - generic "Method, confirmation times & price sources" [ref=e221] [cursor=pointer]
            - complementary "Inspect a strike" [ref=e222]:
              - text: STRUCTURE AT A GLANCE
              - heading "Price to positioning" [level=3] [ref=e223]
              - generic [ref=e224]:
                - generic [ref=e225]: $100
                - generic [ref=e226]: →
                - strong [ref=e227]: "103"
              - generic [ref=e228]:
                - term [ref=e229]: Distance from snapshot spot
                - definition [ref=e230]: +3 · +3%
                - term [ref=e231]: Signed net
                - definition [ref=e232]: +300M
                - term [ref=e233]: Gross gamma
                - definition [ref=e234]: 550M
                - term [ref=e235]: Share of covered gross gamma
                - definition [ref=e236]: 80.29%
              - generic [ref=e237]:
                - generic [ref=e238]: IMPLIED-VOLATILITY DISTANCE
                - strong [ref=e239]: 3 σ
                - generic [ref=e240]: 1-day scale · 2026-10-19
                - group [ref=e241]:
                  - generic "Basis" [ref=e242]
              - generic [ref=e243]:
                - generic [ref=e244]: INTERVENING STRIKES
                - paragraph [ref=e245]: No supplied strikes between the reference spot and this node.
                - generic [ref=e246]: Distance investigation; no path or arrival probability.
              - generic [ref=e248]:
                - text: CONFIRMED MOMENTUM
                - heading "SPY · 5m" [level=4] [ref=e249]
                - strong [ref=e250]: Regular bearish
                - generic [ref=e251]:
                  - term [ref=e252]: RSI profile
                  - definition [ref=e253]:
                    - text: RSI(14) · wing 2 · max span 60
                    - text: rsi14-w2-s60-v1 · Regular only
                  - term [ref=e254]: Latest close
                  - definition [ref=e255]: 2026-10-19 16:00 ET
                  - term [ref=e256]: Oscillator pivot
                  - definition [ref=e257]: 2026-10-19 14:55 ET
                  - term [ref=e258]: Confirmed at / bars since
                  - definition [ref=e259]: 2026-10-19 15:10 ET · 10
              - generic [ref=e260]:
                - generic [ref=e261]: LARGEST NET NODES
                - button "01 103 +300M" [ref=e262] [cursor=pointer]:
                  - generic [ref=e263]: 01 103
                  - generic [ref=e264]: +300M
                - button "02 98 -90M" [ref=e265] [cursor=pointer]:
                  - generic [ref=e266]: 02 98
                  - generic [ref=e267]: "-90M"
              - paragraph [ref=e268]: Modeled from open interest. Sign is an inventory assumption, not price direction.
          - generic [ref=e269]:
            - generic [ref=e270]:
              - generic [ref=e271]:
                - text: BOOK ANATOMY
                - heading "Expiration contributions" [level=3] [ref=e272]
              - generic [ref=e273]:
                - button "Compare expiries" [pressed] [ref=e274] [cursor=pointer]
                - button "Changes" [ref=e275] [cursor=pointer]
                - button "Replay" [ref=e276] [cursor=pointer]
                - button "Review" [ref=e277] [cursor=pointer]
                - button "Scenario" [ref=e278] [cursor=pointer]
                - button "Surface" [ref=e279] [cursor=pointer]
                - button "Exact values" [ref=e280] [cursor=pointer]
            - table "Strike × expiry field" [ref=e282]:
              - rowgroup [ref=e283]:
                - row "Selected strike 2026-10-23 +70M Lead node 103 2026-10-30 +140M Lead node 103" [ref=e284]:
                  - columnheader "Selected strike" [ref=e285]
                  - columnheader "2026-10-23 +70M Lead node 103" [ref=e286]:
                    - button "2026-10-23 +70M Lead node 103" [ref=e287] [cursor=pointer]:
                      - generic [ref=e288]: 2026-10-23
                      - strong [ref=e289]: +70M
                      - generic [ref=e290]: Lead node 103
                  - columnheader "2026-10-30 +140M Lead node 103" [ref=e291]:
                    - button "2026-10-30 +140M Lead node 103" [ref=e292] [cursor=pointer]:
                      - generic [ref=e293]: 2026-10-30
                      - strong [ref=e294]: +140M
                      - generic [ref=e295]: Lead node 103
              - rowgroup [ref=e296]:
                - row "103◆ +100 +200" [ref=e297]:
                  - rowheader "103◆" [ref=e298]:
                    - button "103◆" [ref=e299] [cursor=pointer]
                  - cell "+100" [ref=e300] [cursor=pointer]
                  - cell "+200" [ref=e301] [cursor=pointer]
                - row "98 −30 −60" [ref=e302]:
                  - rowheader "98" [ref=e303]:
                    - button "98" [ref=e304] [cursor=pointer]
                  - cell "−30" [ref=e305] [cursor=pointer]
                  - cell "−60" [ref=e306] [cursor=pointer]
            - paragraph [ref=e307]: Exact expiry-cell contributions; missing cells are not inferred from marginal totals. Every supplied date remains available in the scope menu.
          - group [ref=e308]:
            - generic "Stored book snapshots" [ref=e309] [cursor=pointer]
          - group [ref=e310]:
            - generic "Source & coverage" [ref=e311] [cursor=pointer]
        - generic [ref=e312]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e313]
```

# Test source

```ts
  1408 | // A separate cold-navigation contract. The original journey deliberately applies
  1409 | // Light on each leg; that does not establish persistence across a document load.
  1410 | // This fixture has no live account service: it qualifies the incumbent local
  1411 | // preference/identity consumer, never real-account or production persistence.
  1412 | for (const lang of ["en", "zh"] as const) {
  1413 |   test(`synthetic exposure saved theme cold return ${lang}`, async ({ page, baseURL }, info) => {
  1414 |     test.setTimeout(90_000);
  1415 |     const origin = new URL(baseURL!).origin;
  1416 |     const outside: string[] = [];
  1417 |     await page.context().route("**/*", route => {
  1418 |       const url = new URL(route.request().url());
  1419 |       if (url.origin === origin) return route.continue();
  1420 |       outside.push(`${url.origin}${url.pathname}`);
  1421 |       return route.abort("blockedbyclient");
  1422 |     });
  1423 |     // Reuse options-shortlist-plan's opaque LOCAL session-cookie pattern and
  1424 |     // the canonical fixture principal. Only this Node-owned auth fixture keeps
  1425 |     // the acknowledged metadata between documents; no live account is used.
  1426 |     const user = { id: fixtureUserId("default"), aud: "authenticated", role: "authenticated",
  1427 |       email: "responsive@example.com", app_metadata: {}, created_at: "2026-10-19T00:00:00Z",
  1428 |       user_metadata: { theme: "dark", theme_auto: "0", lang,
  1429 |         prefs: { theme: "dark", themeAuto: "0", lang } } as Record<string, unknown> };
  1430 |     const session = { access_token: "local-exposure-theme-fixture-only",
  1431 |       refresh_token: "local-exposure-theme-fixture-only", token_type: "bearer",
  1432 |       expires_in: 86_400, expires_at: Math.floor(Date.now() / 1000) + 86_400, user };
  1433 |     await page.context().addCookies([
  1434 |       { name: "mm_e2e_rs30", value: "1", url: baseURL! },
  1435 |       { name: "sb-127-auth-token.0", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseURL! },
  1436 |     ]);
  1437 |     // Opposite to the saved explicit Light choice: auto-mode fallback must not
  1438 |     // make a lost preference appear to survive a cold document load.
  1439 |     await page.emulateMedia({ colorScheme: "dark" });
  1440 |     await page.clock.install({ time: new Date(FIXED_NOW) });
  1441 |     await page.addInitScript(locale => {
  1442 |       // Locale is part of the declared fixture. Theme is NEVER seeded here,
  1443 |       // including after reload: only the reader's Settings action selects it.
  1444 |       (window as unknown as { exposureColdDocumentId: string }).exposureColdDocumentId = crypto.randomUUID();
  1445 |       localStorage.setItem("mm.lang", locale);
  1446 |       Reflect.deleteProperty(window, "EventSource");
  1447 |     }, lang);
  1448 |     expectFixtureInvariants();
  1449 |     await installSyntheticRoutes(page);
  1450 |     let authReads = 0;
  1451 |     const acknowledged: Record<string, unknown>[] = [];
  1452 |     // Reuse the existing options-shortlist-plan in-memory SDK transport seam.
  1453 |     // CSP correctly refuses a real loopback auth connection. This binding never
  1454 |     // requests that connection and changes no policy, cookie guard or app code.
  1455 |     await page.exposeBinding("exposureLocalAccountFixture", async (_source, method: string, body: string | null) => {
  1456 |       if (method === "GET") authReads++;
  1457 |       else if (method === "PUT") {
  1458 |         const patch = JSON.parse(body || "{}").data as Record<string, unknown>;
  1459 |         expect(Object.keys(patch).every(key => ["theme", "theme_auto", "lang", "prefs"].includes(key))).toBe(true);
  1460 |         user.user_metadata = { ...user.user_metadata, ...patch };
  1461 |         acknowledged.push(patch);
  1462 |       } else throw new Error("Unexpected in-memory preference fixture operation");
  1463 |       return user;
  1464 |     });
  1465 |     await page.addInitScript(() => {
  1466 |       const originalFetch = window.fetch.bind(window);
  1467 |       window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  1468 |         const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), location.href);
  1469 |         if (url.pathname.startsWith("/auth/v1/")) {
  1470 |           if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/user") throw new Error("Unexpected fixture Auth operation");
  1471 |           const request = input instanceof Request ? input : null;
  1472 |           const method = init?.method ?? request?.method ?? "GET";
  1473 |           const body = typeof init?.body === "string" ? init.body : request ? await request.clone().text() : null;
  1474 |           const fixture = window as unknown as { exposureLocalAccountFixture: (method: string, body: string | null) => Promise<unknown> };
  1475 |           return new Response(JSON.stringify(await fixture.exposureLocalAccountFixture(method, body)), { headers: { "content-type": "application/json" } });
  1476 |         }
  1477 |         return originalFetch(input, init);
  1478 |       };
  1479 |     });
  1480 |     const mt = exposureMapT(lang);
  1481 |     const map = page.getByTestId("exposure-map");
  1482 |     const inspector = page.getByTestId("exposure-node-inspector");
  1483 |     const witness: Record<string, unknown>[] = [];
  1484 |     const record = async (stage: string) => {
  1485 |       const observed = await page.evaluate(() => ({
  1486 |         theme: document.documentElement.dataset.theme,
  1487 |         bodyBackground: getComputedStyle(document.body).backgroundColor,
  1488 |         osPrefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
  1489 |         appearanceOwner: document.documentElement.dataset.terminalAppearance ?? null,
  1490 |         documentId: (window as unknown as { exposureColdDocumentId: string }).exposureColdDocumentId,
  1491 |       }));
  1492 |       witness.push({ stage, ...observed });
  1493 |       return observed;
  1494 |     };
  1495 |     const expectLight = async (stage: string) => {
  1496 |       await expect(page.locator("html"), `saved Light intent survives ${stage}`)
  1497 |         .toHaveAttribute("data-theme", "light");
  1498 |       const observed = await record(stage);
  1499 |       expect(observed.osPrefersDark, `explicit Light is independent of dark OS at ${stage}`).toBe(true);
  1500 |       const rgb = observed.bodyBackground.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
  1501 |       expect(rgb, `computed body background at ${stage}`).toHaveLength(3);
  1502 |       expect(Math.min(...rgb), `Light body background at ${stage}`).toBeGreaterThan(200);
  1503 |     };
  1504 |     try {
  1505 |       await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  1506 |       await expect(map).toHaveAttribute("data-source-session", SESSION);
  1507 |       await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
> 1508 |       await expect.poll(() => authReads, { message: "canonical fixture account actually loaded" }).toBeGreaterThan(0);
       |                                                                                                    ^ Error: canonical fixture account actually loaded
  1509 |       await selectActualLight(page, lang, "s14-first-intent");
  1510 |       await expect.poll(() => user.user_metadata.theme, { message: "Settings preference write acknowledged by local fixture" }).toBe("light");
  1511 |       expect(user.user_metadata.theme_auto, "explicit Settings choice is acknowledged, not auto mode").toBe("0");
  1512 |       await expectLight("initial Settings choice");
  1513 |       await map.getByLabel(mt("scope"), { exact: true }).selectOption(SELECTED_EXPIRY);
  1514 |       const leader = map.getByRole("button", {
  1515 |         name: lang === "en" ? /Largest covered net node/ : /覆盖范围最大净节点/,
  1516 |       });
  1517 |       await expect(leader.locator("strong")).toContainText(String(SELECTED_STRIKE));
  1518 |       await leader.click();
  1519 |       await expect(inspector).toContainText("+200M");
  1520 |       await inspector.getByRole("button", { name: mt("openOnMainChart"), exact: true }).click();
  1521 |       await expect(page).toHaveURL(/\/terminal\?symbol=SPY#exposure=/);
  1522 |       const request = parseExposureChartRequest(new URL(page.url()).hash);
  1523 |       expect(request).toMatchObject({ root: "SPY", session: SESSION, strike: SELECTED_STRIKE,
  1524 |         metric: "gamma", lens: { kind: "one", exp: SELECTED_EXPIRY } });
  1525 |       const reference = page.getByTestId("exposure-chart-reference");
  1526 |       await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  1527 |       await expectLight("main-chart handoff without another Settings action");
  1528 |       const beforeMainReload = await record("before main reload");
  1529 |       const beforeMainReads = authReads;
  1530 |       const mainResponse = await page.reload();
  1531 |       expect(mainResponse?.request().isNavigationRequest()).toBe(true);
  1532 |       expect(mainResponse?.request().resourceType()).toBe("document");
  1533 |       await expect.poll(() => authReads).toBeGreaterThan(beforeMainReads);
  1534 |       await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  1535 |       expect(parseExposureChartRequest(new URL(page.url()).hash)).toEqual(request);
  1536 |       await expectLight("main-chart document reload");
  1537 |       expect((await record("reload witness")).documentId).not.toBe(beforeMainReload.documentId);
  1538 |       await page.screenshot({ path: info.outputPath("saved-theme-main-reloaded.png") });
  1539 |       await reference.getByRole("link", { name: mt("returnToExposure"), exact: true }).click();
  1540 |       await expect(page.getByTestId("exposure-return-check")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  1541 |       await expect(map).toHaveAttribute("data-source-session", SESSION);
  1542 |       await expect(map.getByLabel(mt("scope"), { exact: true })).toHaveValue(SELECTED_EXPIRY);
  1543 |       await expect(inspector).toContainText("+200M");
  1544 |       await expect(inspector).not.toContainText("+300M");
  1545 |       await expectLight("exact investigation return");
  1546 |       const beforeReturnReload = await record("before return reload");
  1547 |       const beforeReturnReads = authReads;
  1548 |       const returnResponse = await page.reload();
  1549 |       expect(returnResponse?.request().isNavigationRequest()).toBe(true);
  1550 |       expect(returnResponse?.request().resourceType()).toBe("document");
  1551 |       await expect.poll(() => authReads).toBeGreaterThan(beforeReturnReads);
  1552 |       await expect(page.getByTestId("exposure-return-check")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  1553 |       await expectLight("returned investigation document reload");
  1554 |       expect((await record("return reload witness")).documentId).not.toBe(beforeReturnReload.documentId);
  1555 |       await page.screenshot({ path: info.outputPath("saved-theme-return-reloaded.png") });
  1556 |       // The explicit Dark control must remain usable after the retained Light
  1557 |       // choice; neither this test nor the application rewrites custom settings.
  1558 |       if (info.project.name === "mobile") {
  1559 |         await inspector.getByRole("button", { name: mt("close"), exact: true }).click();
  1560 |         await expect(page.locator(".msheet-scrim")).toHaveCount(0);
  1561 |       }
  1562 |       await selectActualLight(page, lang, "s14-dark-control", "dark");
  1563 |       await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  1564 |     } finally {
  1565 |       await retainSyntheticJson("saved-theme-cold-return.json", {
  1566 |         classification: "SYNTHETIC LOCAL — no live account or production claim",
  1567 |         source: SOURCE_REF, session: SESSION, expiry: SELECTED_EXPIRY,
  1568 |         sourceVersion: "existing coherent four-cell fixture", witness, blockedOutside: outside,
  1569 |         authReads, acknowledgedMetadataWrites: acknowledged,
  1570 |       });
  1571 |     }
  1572 |   });
  1573 | }
  1574 | 
```