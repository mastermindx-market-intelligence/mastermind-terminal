# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-plan-compare-mounted.spec.ts >> D08C mounted shortlist → Plan → comparison en dark
- Location: e2e/options-plan-compare-mounted.spec.ts:10:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 0
+ Received  + 1

@@ -2,9 +2,10 @@
    "d_oi": 20,
    "exp": "2026-10-30",
    "mid": 9,
    "oi": 40,
    "oi_prev": 20,
+   "preset": "doi",
    "right": "C",
    "root": "SPY",
    "strike": 765,
  }
```

```
Error: locator.click: Test ended.
Call log:
  - waiting for getByTestId('options-plan-payoff-panel').getByTestId('plan-pin-baseline')

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e5]:
        - img [ref=e6]
        - generic [ref=e10]:
          - generic [ref=e11]: MASTERMIND
          - generic [ref=e12]: TERMINAL
      - navigation [ref=e13]:
        - link "Chart" [ref=e14] [cursor=pointer]:
          - /url: /terminal
          - img [ref=e15]
          - text: Chart
        - link "Analysis" [ref=e17] [cursor=pointer]:
          - /url: /analysis
          - img [ref=e18]
          - text: Analysis
        - link "Discover" [ref=e20] [cursor=pointer]:
          - /url: /discover
          - img [ref=e21]
          - text: Discover
        - link "Dislocations" [ref=e26] [cursor=pointer]:
          - /url: /dislocations
          - img [ref=e27]
          - text: Dislocations
        - link "Options" [ref=e28] [cursor=pointer]:
          - /url: /options
          - img [ref=e29]
          - text: Options
        - link "Scripts" [ref=e32] [cursor=pointer]:
          - /url: /scripts
          - img [ref=e33]
          - text: Scripts
        - link "Portfolio" [ref=e37] [cursor=pointer]:
          - /url: /portfolio
          - img [ref=e38]
          - text: Portfolio
        - link "Alerts" [ref=e40] [cursor=pointer]:
          - /url: /alerts
          - img [ref=e41]
          - text: Alerts
        - button "Mastermind AI" [ref=e44] [cursor=pointer]:
          - img [ref=e45]
          - text: Mastermind AI
      - button "Settings" [ref=e48] [cursor=pointer]: R
    - banner [ref=e49]:
      - generic [ref=e50]:
        - img [ref=e51]
        - generic [ref=e55]:
          - generic [ref=e56]: MASTERMIND
          - generic [ref=e57]: TERMINAL
      - generic [ref=e59]: Options
      - button "Settings" [ref=e60] [cursor=pointer]: R
    - navigation "Primary" [ref=e61]:
      - link "Chart" [ref=e62] [cursor=pointer]:
        - /url: /terminal
        - img [ref=e63]
      - link "Analysis" [ref=e65] [cursor=pointer]:
        - /url: /analysis
        - img [ref=e66]
      - link "Discover" [ref=e68] [cursor=pointer]:
        - /url: /discover
        - img [ref=e69]
      - link "Dislocations" [ref=e74] [cursor=pointer]:
        - /url: /dislocations
        - img [ref=e75]
      - link "Options" [ref=e76] [cursor=pointer]:
        - /url: /options
        - img [ref=e77]
      - link "Scripts" [ref=e80] [cursor=pointer]:
        - /url: /scripts
        - img [ref=e81]
      - link "Portfolio" [ref=e85] [cursor=pointer]:
        - /url: /portfolio
        - img [ref=e86]
      - link "Alerts" [ref=e88] [cursor=pointer]:
        - /url: /alerts
        - img [ref=e89]
      - button "Mastermind AI" [ref=e92] [cursor=pointer]:
        - img [ref=e93]
    - main [ref=e95]:
      - generic [ref=e96]:
        - generic [ref=e97]:
          - generic [ref=e98]: Category
          - generic [ref=e99]:
            - tablist "Options categories" [ref=e100]:
              - tab "Command" [ref=e101] [cursor=pointer]
              - tab "Flow" [selected] [ref=e102] [cursor=pointer]
              - tab "Exposure" [ref=e103] [cursor=pointer]
              - tab "Structure" [ref=e104] [cursor=pointer]
              - tab "Volatility" [ref=e105] [cursor=pointer]
              - tab "Statistics" [ref=e106] [cursor=pointer]
              - tab "Prophet" [ref=e107] [cursor=pointer]
            - link "Futures depth & footprint" [ref=e108] [cursor=pointer]:
              - /url: /options/futures
              - text: Futures
            - button "Open the four-step options workflow · 1/4 viewed" [ref=e109] [cursor=pointer]:
              - img [ref=e110]
              - generic [ref=e113]: Workflow
              - generic [ref=e114]: 1/4 viewed
        - generic [ref=e115]:
          - generic [ref=e116]: View
          - tablist "Options views" [ref=e117]:
            - tab "Options Tape" [ref=e118] [cursor=pointer]
            - tab "Tide" [ref=e119] [cursor=pointer]
            - tab "0DTE" [ref=e120] [cursor=pointer]
            - tab "Largest Events" [ref=e121] [cursor=pointer]
            - tab "Surface" [ref=e122] [cursor=pointer]
            - tab "Options Screener" [selected] [ref=e123] [cursor=pointer]
            - tab "Tickers" [ref=e124] [cursor=pointer]
      - generic [ref=e125]:
        - generic [ref=e126]:
          - 'generic "Market volatility regime: Mixed — normalizing" [ref=e127]':
            - generic [ref=e129]: Vol
            - text: Mixed — normalizing
          - generic [ref=e130]: as of 11:42:00delayed
        - generic [ref=e132]:
          - generic [ref=e133]:
            - generic [ref=e134]:
              - button "Top Premium" [ref=e135] [cursor=pointer]
              - button "Unusual Activity" [ref=e136] [cursor=pointer]
              - button "Volume > OI" [ref=e137] [cursor=pointer]
              - button "ΔOI Builds" [ref=e138] [cursor=pointer]
              - button "0DTE Heavy" [ref=e139] [cursor=pointer]
              - button "Hot Contracts" [ref=e140] [cursor=pointer]
              - generic [ref=e141]: ETF universe · single names expanding
              - 'button "Export CSV: 1" [ref=e142] [cursor=pointer]': Export CSV · 1
            - generic [ref=e143]:
              - generic [ref=e144]: Index
              - button "SPY" [ref=e145] [cursor=pointer]
              - button "QQQ" [ref=e146] [cursor=pointer]
              - button "IWM" [ref=e147] [cursor=pointer]
            - generic [ref=e149]: Nightly close build · as of 2026-10-23
          - generic [ref=e150]:
            - generic [ref=e151]:
              - generic [ref=e152]:
                - generic [ref=e153]: Contract shortlist
                - generic [ref=e154]: 1 of 4 pinned
                - generic [ref=e155]:
                  - button "Compare" [disabled] [ref=e156]
                  - button "Clear" [ref=e157] [cursor=pointer]
              - paragraph [ref=e158]: Pin one more contract to compare.
              - list [ref=e159]:
                - listitem [ref=e160]:
                  - generic [ref=e161]:
                    - generic [ref=e162]: SPY 2026-10-30 765 Call
                    - generic [ref=e163]: Open-interest builds · Session 2026-10-23 · Older copy
                  - button "Show in list" [ref=e164] [cursor=pointer]
                  - button "Remove SPY 2026-10-30 765 Call from the shortlist" [ref=e165] [cursor=pointer]: ✕
              - status [ref=e166]: Pinned SPY 2026-10-30 765 Call.
              - generic [ref=e167]:
                - button "Back to shortlist" [expanded] [ref=e168] [cursor=pointer]
                - paragraph [ref=e169]: Draft only. Choose your own side, quantity and entry; no assumption is taken from a reference mark. Changing the account or pinned selection clears this draft.
                - region "Plan from shortlist" [ref=e170]:
                  - region "Exact-contract Plan" [ref=e171]:
                    - region "Plan draft" [ref=e172]:
                      - generic [ref=e173]:
                        - heading "Plan draft" [level=3] [ref=e174]
                        - paragraph [ref=e175]: Record your research and assumptions. This draft is not saved to your account.
                      - paragraph [ref=e176]: Use your entry assumptions for a conditional expiry outcome. Current executable quotes are unavailable.
                      - generic [ref=e177]:
                        - group "SPY · 2026-10-30 · 765 · Call" [ref=e178]:
                          - generic [ref=e180]: SPY · 2026-10-30 · 765 · Call
                          - paragraph [ref=e181]: "Source as of: 2026-10-23T20:00:00Z · Refresh failed at selection"
                          - generic [ref=e182]:
                            - generic [ref=e183]:
                              - text: Your assumed side
                              - combobox "Your assumed side" [ref=e184]:
                                - option "Not specified"
                                - option "Buy" [selected]
                                - option "Sell"
                            - generic [ref=e185]:
                              - text: Your assumed quantity — contracts
                              - textbox "Your assumed quantity — contracts" [ref=e186]: "1"
                            - generic [ref=e187]:
                              - text: Your entry assumption — premium per unit
                              - textbox "Your entry assumption — premium per unit" [ref=e188]: "2"
                            - generic [ref=e189]:
                              - text: Assumed premium denomination
                              - combobox "Assumed premium denomination" [ref=e190]:
                                - option "Not specified"
                                - option "USD — my assumption" [selected]
                          - group [ref=e191]:
                            - generic "Original source details" [ref=e192] [cursor=pointer]
                        - group [ref=e193]:
                          - generic "Optional research notes" [ref=e194] [cursor=pointer]
                        - generic [ref=e195]:
                          - button "Close draft" [ref=e196] [cursor=pointer]
                          - button "Calculate expiry payoff" [active] [ref=e197] [cursor=pointer]
                    - generic [ref=e198]:
                      - heading "Expiry payoff" [level=2] [ref=e199]
                      - status [ref=e200]: Checking contract terms…
                    - region "Research scenario comparison" [ref=e201]:
                      - generic [ref=e203]:
                        - heading "Compare assumptions" [level=3] [ref=e204]
                        - paragraph [ref=e205]: Same contracts, same dated terms. Hypothetical research only.
                      - paragraph [ref=e206]: Calculate your Plan, then pin a baseline to compare a changed assumption.
            - generic [ref=e207]:
              - generic [ref=e208]:
                - generic [ref=e209]: Open interest builds
                - generic [ref=e210]: Report dated 2026-10-23
              - table [ref=e212]:
                - rowgroup [ref=e213]:
                  - row "Ticker C/P Exp Strike Open interest change Reported open interest Mid" [ref=e214]:
                    - columnheader "Ticker" [ref=e215] [cursor=pointer]
                    - columnheader "C/P" [ref=e216] [cursor=pointer]
                    - columnheader "Exp" [ref=e217] [cursor=pointer]
                    - columnheader "Strike" [ref=e218] [cursor=pointer]
                    - columnheader "Open interest change" [ref=e219] [cursor=pointer]
                    - columnheader "Reported open interest" [ref=e220] [cursor=pointer]
                    - columnheader "Mid" [ref=e221] [cursor=pointer]
                - rowgroup [ref=e222]:
                  - row "Unpin SPY 2026-10-30 765 Call SPY C 10-30 765 +20 40 $9.00" [ref=e223] [cursor=pointer]:
                    - cell "Unpin SPY 2026-10-30 765 Call SPY" [ref=e224]:
                      - button "Unpin SPY 2026-10-30 765 Call" [pressed] [ref=e225]:
                        - img [ref=e226]
                      - text: SPY
                    - cell "C" [ref=e228]
                    - cell "10-30" [ref=e229]
                    - cell "765" [ref=e230]
                    - cell "+20" [ref=e231]
                    - cell "40" [ref=e232]
                    - cell "$9.00" [ref=e233]
              - generic [ref=e234]: Reported open interest reflects positions at the prior trading close. Change is this dated report minus the earlier report; it does not describe current intraday flow.
        - generic [ref=e235]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e236]
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { response } from "../lib/__tests__/fixtures/optionsPlanPayoff";
  3  | import type { PlanExpiryRequest } from "../lib/optionsPlanPayoff";
  4  | 
  5  | // Exercise the production component tree on /options. Auth, source acquisition
  6  | // and the dated reference response are explicit local fixtures, not live proof.
  7  | const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "responsive@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-20T00:00:00Z" };
  8  | const row = { root: "SPY", right: "C", exp: "2026-10-30", strike: 765, mid: 9, oi: 40, oi_prev: 20, d_oi: 20 };
  9  | for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  10 |   test(`D08C mounted shortlist → Plan → comparison ${lang} ${theme}`, async ({ page, context, baseURL }, info) => {
  11 |     test.setTimeout(90_000);
  12 |     const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  13 |     const session = { access_token: "local-plan-fixture-only", refresh_token: "local-plan-fixture-only", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  14 |     await context.addCookies([
  15 |       { name: "mm_e2e_rs30", value: "1", url: baseURL! },
  16 |       { name: "sb-127-auth-token.0", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseURL! },
  17 |     ]);
  18 |     await page.addInitScript(({ lang, theme, user }) => {
  19 |       localStorage.setItem("mm.lang", lang); localStorage.setItem("mmx.shell.theme", theme);
  20 |       const originalFetch = window.fetch.bind(window);
  21 |       window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  22 |         const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), window.location.href);
  23 |         if (url.pathname.startsWith("/auth/v1/")) {
  24 |           if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/user") throw Error("Unexpected fixture Auth operation");
  25 |           return new Response(JSON.stringify(user), { headers: { "content-type": "application/json" } });
  26 |         }
  27 |         return originalFetch(input, init);
  28 |       };
  29 |     }, { lang, theme, user });
  30 |     await page.route(/\/api\/flow\?f=oi$/, route => route.fulfill({ json: { schema: "options_hub.oi_movers/v1", asof: "2026-10-23T20:00:00Z", stale: true, movers: [row] } }));
  31 |     let calculations = 0, persistence = 0;
  32 |     page.on("request", req => { if (/\/api\/(investigations|alerts|orders)(?:[/?]|$)/.test(req.url()) && ["POST", "PUT", "DELETE", "PATCH"].includes(req.method())) persistence++; });
  33 |     await page.route("**/api/options/plan/expiry", route => {
  34 |       calculations++;
  35 |       const request = route.request().postDataJSON() as PlanExpiryRequest;
  36 |       expect(request.draft.legs).toHaveLength(1);
  37 |       const leg = request.draft.legs[0];
  38 |       expect(leg.snapshot.row).toEqual(row);
  39 |       expect(leg.snapshot.sourceStale).toBe(true);
  40 |       expect(leg.snapshot.asofRaw).toBe("2026-10-23T20:00:00Z");
  41 |       expect(leg.assumptions.entry?.premium_per_unit).toBe(calculations === 1 ? 2 : 4);
  42 |       const raw = response(request), entry = leg.assumptions.entry!.premium_per_unit;
  43 |       raw.curve.pnl = request.spots.map(spot => Math.max(spot - 765, 0) * 100 - entry * 100);
  44 |       raw.curve.cost = entry * 100; raw.curve.max_loss = -entry * 100; raw.curve.breakevens = [765 + entry];
  45 |       return route.fulfill({ json: raw });
  46 |     });
  47 |     await page.goto("/options?tab=screener");
  48 |     await page.getByRole("button", { name: t("ΔOI Builds", "持仓增长"), exact: true }).click();
  49 |     const pin = page.locator("table.scr [data-contract-pin]"); await expect(pin).toHaveCount(1); await pin.click();
  50 |     const tray = page.locator("[data-contract-shortlist]");
  51 |     const open = tray.getByRole("button", { name: t("Plan from pinned contracts", "用固定合约创建计划"), exact: true });
  52 |     await open.click();
  53 |     const plan = page.getByTestId("options-plan-payoff-panel");
  54 |     await plan.getByRole("combobox", { name: t("Your assumed side", "假设方向"), exact: true }).selectOption("buy");
  55 |     await plan.getByLabel(t("Your assumed quantity — contracts", "假设数量——张"), { exact: true }).fill("1");
  56 |     const entry = plan.getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true });
  57 |     await entry.fill("2");
  58 |     await plan.getByRole("combobox", { name: t("Assumed premium denomination", "权利金假设币种"), exact: true }).selectOption("USD");
  59 |     const calculate = plan.getByRole("button", { name: t("Calculate expiry payoff", "计算到期损益"), exact: true });
> 60 |     await calculate.click(); await plan.getByTestId("plan-pin-baseline").click();
     |                                                                          ^ Error: locator.click: Test ended.
  61 |     await expect(plan.getByTestId("plan-baseline-pending")).toBeVisible();
  62 |     await entry.fill("4"); await calculate.click();
  63 |     const comparison = plan.getByTestId("plan-scenario-compare");
  64 |     await expect(comparison.getByTestId("plan-compare-overlay")).toBeVisible();
  65 |     await expect(comparison.getByTestId("plan-comparison-sample")).toContainText("200.00");
  66 |     await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
  67 |     await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  68 |     await comparison.scrollIntoViewIfNeeded();
  69 |     await comparison.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-${info.project.name}.png`) });
  70 |     await comparison.getByText(t("All exact scenario prices and P/L", "查看全部精确情景价格与损益"), { exact: true }).click();
  71 |     const exact = comparison.getByTestId("plan-comparison-points");
  72 |     await expect(exact.locator("tbody tr")).toHaveCount(101);
  73 |     await expect(exact.locator("tbody tr").first().locator("td").last()).toHaveText("-200");
  74 |     const scroll = exact.locator(".."); await scroll.focus(); await expect(scroll).toBeFocused();
  75 |     await page.keyboard.press("End");
  76 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  77 |     if (info.project.name === "mobile") {
  78 |       await page.setViewportSize({ width: 320, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  79 |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  80 |       await comparison.getByText(t("All exact scenario prices and P/L", "查看全部精确情景价格与损益"), { exact: true }).click();
  81 |       await comparison.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-320.png`) });
  82 |     }
  83 |     const clear = comparison.getByTestId("plan-clear-baseline");
  84 |     expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  85 |     await clear.click(); await expect(comparison.getByRole("heading", { name: t("Compare assumptions", "对比假设"), exact: true })).toBeFocused();
  86 |     await expect(comparison.getByTestId("plan-compare-overlay")).toHaveCount(0);
  87 |     await plan.getByRole("button", { name: t("Close draft", "关闭草稿"), exact: true }).click();
  88 |     await expect(open).toBeFocused(); await expect(plan).toHaveCount(0);
  89 |     await expect(page.locator("table.scr tbody")).toContainText("SPY");
  90 |     expect(calculations).toBe(2); expect(persistence).toBe(0);
  91 |   });
  92 | }
  93 | 
```