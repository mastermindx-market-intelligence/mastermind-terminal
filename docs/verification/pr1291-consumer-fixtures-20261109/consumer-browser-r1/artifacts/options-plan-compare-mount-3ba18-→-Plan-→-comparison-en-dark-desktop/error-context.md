# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-plan-compare-mounted.spec.ts >> D08C mounted shortlist → Plan → comparison en dark
- Location: e2e/options-plan-compare-mounted.spec.ts:12:7

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.selectOption: Test timeout of 90000ms exceeded.
Call log:
  - waiting for getByTestId('options-plan-payoff-panel').getByRole('combobox', { name: 'Your assumed side', exact: true })

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
              - tab "Flow" [selected] [ref=e56] [cursor=pointer]
              - tab "Exposure" [ref=e57] [cursor=pointer]
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
            - tab "Options Tape" [ref=e72] [cursor=pointer]
            - tab "Tide" [ref=e73] [cursor=pointer]
            - tab "0DTE" [ref=e74] [cursor=pointer]
            - tab "Largest Events" [ref=e75] [cursor=pointer]
            - tab "Surface" [ref=e76] [cursor=pointer]
            - tab "Options Screener" [selected] [ref=e77] [cursor=pointer]
            - tab "Tickers" [ref=e78] [cursor=pointer]
      - generic [ref=e79]:
        - generic [ref=e80]:
          - 'generic "Market volatility regime: Mixed — normalizing" [ref=e81]':
            - generic [ref=e83]: Vol
            - text: Mixed — normalizing
          - generic [ref=e84]: as of 11:42:00delayed
        - generic [ref=e86]:
          - generic [ref=e87]:
            - generic [ref=e88]:
              - button "Top Premium" [ref=e89] [cursor=pointer]
              - button "Unusual Activity" [ref=e90] [cursor=pointer]
              - button "Volume > OI" [ref=e91] [cursor=pointer]
              - button "ΔOI Builds" [ref=e92] [cursor=pointer]
              - button "0DTE Heavy" [ref=e93] [cursor=pointer]
              - button "Hot Contracts" [ref=e94] [cursor=pointer]
              - generic [ref=e95]: ETF universe · single names expanding
              - 'button "Export CSV: 1" [ref=e96] [cursor=pointer]': Export CSV · 1
            - generic [ref=e97]:
              - generic [ref=e98]: Index
              - button "SPY" [ref=e99] [cursor=pointer]
              - button "QQQ" [ref=e100] [cursor=pointer]
              - button "IWM" [ref=e101] [cursor=pointer]
            - generic [ref=e103]: Nightly close build · as of 2026-10-23
          - generic [ref=e104]:
            - generic [ref=e105]:
              - generic [ref=e106]:
                - generic [ref=e107]: Contract shortlist
                - generic [ref=e108]: 1 of 4 pinned
                - generic [ref=e109]:
                  - button "Compare" [disabled] [ref=e110]
                  - button "Clear" [ref=e111] [cursor=pointer]
              - paragraph [ref=e112]: Pin one more contract to compare.
              - list [ref=e113]:
                - listitem [ref=e114]:
                  - generic [ref=e115]:
                    - generic [ref=e116]: SPY 2026-10-30 765 Call
                    - generic [ref=e117]: Open-interest builds · Session 2026-10-23 · Older copy
                  - button "Show in list" [ref=e118] [cursor=pointer]
                  - button "Remove SPY 2026-10-30 765 Call from the shortlist" [ref=e119] [cursor=pointer]: ✕
              - status [ref=e120]: Pinned SPY 2026-10-30 765 Call.
              - generic [ref=e121]:
                - button "Back to shortlist" [expanded] [ref=e122] [cursor=pointer]
                - paragraph [ref=e123]: Draft only. Choose your own side, quantity and entry; no assumption is taken from a reference mark. Changing the account or pinned selection clears this draft.
                - region "Plan from shortlist" [active]
                - button "Open saved research" [disabled] [ref=e125] [cursor=pointer]
            - generic [ref=e126]:
              - generic [ref=e127]:
                - generic [ref=e128]: Open interest builds
                - generic [ref=e129]: Report dated 2026-10-23
              - table [ref=e131]:
                - rowgroup [ref=e132]:
                  - row "Ticker C/P Exp Strike Open interest change Reported open interest Mid" [ref=e133]:
                    - columnheader "Ticker" [ref=e134] [cursor=pointer]
                    - columnheader "C/P" [ref=e135] [cursor=pointer]
                    - columnheader "Exp" [ref=e136] [cursor=pointer]
                    - columnheader "Strike" [ref=e137] [cursor=pointer]
                    - columnheader "Open interest change" [ref=e138] [cursor=pointer]
                    - columnheader "Reported open interest" [ref=e139] [cursor=pointer]
                    - columnheader "Mid" [ref=e140] [cursor=pointer]
                - rowgroup [ref=e141]:
                  - row "Unpin SPY 2026-10-30 765 Call Open SPY in Tickers C 10-30 765 +20 40 $9.00" [ref=e142] [cursor=pointer]:
                    - cell "Unpin SPY 2026-10-30 765 Call Open SPY in Tickers" [ref=e143]:
                      - button "Unpin SPY 2026-10-30 765 Call" [pressed] [ref=e144]:
                        - img [ref=e145]
                      - button "Open SPY in Tickers" [ref=e147]: SPY
                    - cell "C" [ref=e148]
                    - cell "10-30" [ref=e149]
                    - cell "765" [ref=e150]
                    - cell "+20" [ref=e151]
                    - cell "40" [ref=e152]
                    - cell "$9.00" [ref=e153]
              - generic [ref=e154]: Reported open interest reflects positions at the prior trading close. Change is this dated report minus the earlier report; it does not describe current intraday flow.
        - generic [ref=e155]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e156]
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { response } from "../lib/__tests__/fixtures/optionsPlanPayoff";
  3   | import type { PlanExpiryRequest } from "../lib/optionsPlanPayoff";
  4   | 
  5   | // Exercise the production component tree on /options. Auth, source acquisition
  6   | // and the dated reference response are explicit local fixtures, not live proof.
  7   | const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "responsive@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-20T00:00:00Z" };
  8   | const row = { root: "SPY", right: "C", exp: "2026-10-30", strike: 765, mid: 9, oi: 40, oi_prev: 20, d_oi: 20 };
  9   | const sharedShell = process.env.MMX_SHARED_SHELL === "1";
  10  | const themes = sharedShell ? ["dark", "light"] as const : ["dark"] as const;
  11  | for (const lang of ["en", "zh"] as const) for (const theme of themes) {
  12  |   test(`D08C mounted shortlist → Plan → comparison ${lang} ${theme}`, async ({ page, context, baseURL }, info) => {
  13  |     test.setTimeout(90_000);
  14  |     const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  15  |     const session = { access_token: "local-plan-fixture-only", refresh_token: "local-plan-fixture-only", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  16  |     await context.addCookies([
  17  |       { name: "mm_e2e_rs30", value: "1", url: baseURL! },
  18  |       { name: "sb-127-auth-token.0", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseURL! },
  19  |     ]);
  20  |     await page.addInitScript(({ lang, theme, user }) => {
  21  |       localStorage.setItem("mm.lang", lang); localStorage.setItem("mmx.shell.theme", theme);
  22  |       const originalFetch = window.fetch.bind(window);
  23  |       window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  24  |         const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), window.location.href);
  25  |         if (url.pathname.startsWith("/auth/v1/")) {
  26  |           if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/user") throw Error("Unexpected fixture Auth operation");
  27  |           return new Response(JSON.stringify(user), { headers: { "content-type": "application/json" } });
  28  |         }
  29  |         return originalFetch(input, init);
  30  |       };
  31  |     }, { lang, theme, user });
  32  |     await page.route(/\/api\/flow\?f=oi$/, route => route.fulfill({ json: { schema: "options_hub.oi_movers/v1", asof: "2026-10-23T20:00:00Z", stale: true, movers: [row] } }));
  33  |     let calculations = 0, persistence = 0;
  34  |     page.on("request", req => { if (/\/api\/(investigations|alerts|orders)(?:[/?]|$)/.test(req.url()) && ["POST", "PUT", "DELETE", "PATCH"].includes(req.method())) persistence++; });
  35  |     await page.route("**/api/options/plan/expiry", route => {
  36  |       calculations++;
  37  |       const request = route.request().postDataJSON() as PlanExpiryRequest;
  38  |       expect(request.draft.legs).toHaveLength(1);
  39  |       const leg = request.draft.legs[0];
  40  |       // The incumbent source adapter adds its own DOI preset before pinning.
  41  |       expect(leg.snapshot.row).toEqual({ ...row, preset: "doi" });
  42  |       expect(leg.snapshot.sourceStale).toBe(true);
  43  |       expect(leg.snapshot.asofRaw).toBe("2026-10-23T20:00:00Z");
  44  |       expect(leg.assumptions.entry?.premium_per_unit).toBe(calculations === 1 ? 2 : 4);
  45  |       const raw = response(request), entry = leg.assumptions.entry!.premium_per_unit;
  46  |       raw.curve.pnl = request.spots.map(spot => Math.max(spot - 765, 0) * 100 - entry * 100);
  47  |       raw.curve.cost = entry * 100; raw.curve.max_loss = -entry * 100; raw.curve.breakevens = [765 + entry];
  48  |       return route.fulfill({ json: raw });
  49  |     });
  50  |     await page.goto("/options?tab=screener");
  51  |     await page.getByRole("button", { name: t("ΔOI Builds", "持仓增长"), exact: true }).click();
  52  |     const pin = page.locator("table.scr [data-contract-pin]"); await expect(pin).toHaveCount(1); await pin.click();
  53  |     const tray = page.locator("[data-contract-shortlist]");
  54  |     const open = tray.getByRole("button", { name: t("Plan from pinned contracts", "用固定合约创建计划"), exact: true });
  55  |     await open.click();
  56  |     const plan = page.getByTestId("options-plan-payoff-panel");
> 57  |     await plan.getByRole("combobox", { name: t("Your assumed side", "假设方向"), exact: true }).selectOption("buy");
      |                                                                                             ^ Error: locator.selectOption: Test timeout of 90000ms exceeded.
  58  |     await plan.getByLabel(t("Your assumed quantity — contracts", "假设数量——张"), { exact: true }).fill("1");
  59  |     const entry = plan.getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true });
  60  |     await entry.fill("2");
  61  |     await plan.getByRole("combobox", { name: t("Assumed premium denomination", "权利金假设币种"), exact: true }).selectOption("USD");
  62  |     const calculate = plan.getByRole("button", { name: t("Calculate expiry payoff", "计算到期损益"), exact: true });
  63  |     await calculate.click(); await plan.getByTestId("plan-pin-baseline").click();
  64  |     await expect(plan.getByTestId("plan-baseline-pending")).toBeVisible();
  65  |     await entry.fill("4"); await calculate.click();
  66  |     const comparison = plan.getByTestId("plan-scenario-compare");
  67  |     await expect(comparison.getByTestId("plan-compare-overlay")).toBeVisible();
  68  |     await expect(comparison.getByTestId("plan-comparison-sample")).toContainText("200.00");
  69  |     if (sharedShell) {
  70  |       await expect(page.locator("html")).toHaveAttribute("data-mmx-shared-shell", "1");
  71  |       await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  72  |     }
  73  |     await expect(comparison).toHaveCSS("background-color", sharedShell ? (theme === "light" ? "rgb(255, 255, 255)" : "rgb(24, 27, 33)") : "rgb(13, 15, 19)");
  74  |     const compareHeading = comparison.getByRole("heading", { name: t("Compare assumptions", "对比假设"), exact: true });
  75  |     await compareHeading.scrollIntoViewIfNeeded();
  76  |     await expect(compareHeading).toBeInViewport({ ratio: 1 });
  77  |     await page.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-${info.project.name}-header.png`) });
  78  |     await comparison.getByTestId("plan-compare-overlay").scrollIntoViewIfNeeded();
  79  |     await expect(comparison.getByTestId("plan-compare-overlay").locator("svg")).toBeInViewport({ ratio: 0.99 });
  80  |     await page.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-${info.project.name}-chart.png`) });
  81  |     await comparison.getByText(t("All exact scenario prices and P/L", "查看全部精确情景价格与损益"), { exact: true }).click();
  82  |     const exact = comparison.getByTestId("plan-comparison-points");
  83  |     await expect(exact.locator("tbody tr")).toHaveCount(101);
  84  |     await expect(exact.locator("tbody tr").first().locator("td").last()).toHaveText("-200");
  85  |     const scroll = exact.locator(".."); await scroll.focus(); await expect(scroll).toBeFocused();
  86  |     await page.keyboard.press("End");
  87  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  88  |     if (info.project.name === "mobile") {
  89  |       await page.setViewportSize({ width: 320, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  90  |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  91  |       await comparison.getByText(t("All exact scenario prices and P/L", "查看全部精确情景价格与损益"), { exact: true }).click();
  92  |       await comparison.getByTestId("plan-clear-baseline").scrollIntoViewIfNeeded();
  93  |       await expect(comparison.getByTestId("plan-clear-baseline")).toBeInViewport({ ratio: 1 });
  94  |       await page.screenshot({ path: info.outputPath(`mounted-compare-${lang}-${theme}-320-controls.png`) });
  95  |     }
  96  |     const clear = comparison.getByTestId("plan-clear-baseline");
  97  |     expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  98  |     await clear.click(); await expect(comparison.getByRole("heading", { name: t("Compare assumptions", "对比假设"), exact: true })).toBeFocused();
  99  |     await expect(comparison.getByTestId("plan-compare-overlay")).toHaveCount(0);
  100 |     await plan.getByRole("button", { name: t("Close draft", "关闭草稿"), exact: true }).click();
  101 |     await expect(open).toBeFocused(); await expect(plan).toHaveCount(0);
  102 |     await expect(page.locator("table.scr tbody")).toContainText("SPY");
  103 |     expect(calculations).toBe(2); expect(persistence).toBe(0);
  104 |   });
  105 | }
  106 | 
```