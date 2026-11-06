# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-lab-source-state.spec.ts >> Research Lab withdraws a retained unavailable source and restores the exact pin on recovery
- Location: e2e/options-lab-source-state.spec.ts:25:7

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('region', { name: '3D Research Lab', exact: true }).getByTestId('research-reported-gamma')
Expected: 0
Received: 1
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for getByRole('region', { name: '3D Research Lab', exact: true }).getByTestId('research-reported-gamma')
    14 × locator resolved to 1 element
       - unexpected value "1"

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
              - tab "Flow" [ref=e102] [cursor=pointer]
              - tab "Exposure" [selected] [ref=e103] [cursor=pointer]
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
            - tab "Exposure" [selected] [ref=e118] [cursor=pointer]
            - tab "Positioning" [ref=e119] [cursor=pointer]
            - tab "Levels" [ref=e120] [cursor=pointer]
      - generic [ref=e121]:
        - generic [ref=e122]:
          - 'generic "Market volatility regime: Mixed — normalizing" [ref=e123]':
            - generic [ref=e125]: Vol
            - text: Mixed — normalizing
          - generic [ref=e126]: as of 11:42:00delayed
        - region "3D Research Lab" [ref=e129]:
          - generic [ref=e130]:
            - generic [ref=e131]:
              - button "Back to Exposure" [ref=e132] [cursor=pointer]
              - heading "3D Research Lab SPY" [level=2] [ref=e133]
            - generic [ref=e134]:
              - generic [ref=e135]: "Source session: 2026-10-19"
              - generic [ref=e136]: OI reference session unknown
              - link "Sources & coverage" [ref=e137] [cursor=pointer]:
                - /url: "#research-sources"
          - generic [ref=e138]:
            - strong [ref=e139]: Inspect concentration. Keep the exact evidence.
            - paragraph [ref=e140]: Published volume and OI may describe different sessions. Their ratio does not confirm opening trades or direction.
          - navigation "3D Research Lab" [ref=e141]:
            - button "Chain landscape" [ref=e142] [cursor=pointer]
            - button "Volatility terrain" [ref=e143] [cursor=pointer]
            - button "Replay & change" [active] [pressed] [ref=e144] [cursor=pointer]
            - button "Flow & packages" [ref=e145] [cursor=pointer]
            - button "Scenario lab" [ref=e146] [cursor=pointer]
          - generic [ref=e147]:
            - generic [ref=e148]:
              - generic [ref=e149]:
                - generic [ref=e150]:
                  - strong [ref=e151]: Market Memory
                  - generic [ref=e152]: GAMMA · ALL EXPIRIES
                - generic [ref=e153]:
                  - generic [ref=e154]:
                    - strong [ref=e155]: Reported Gamma comparison
                    - generic [ref=e156]: 119 matched contracts
                  - generic [ref=e157]:
                    - time [ref=e158]: 2026-10-16
                    - generic [ref=e159]: →
                    - time [ref=e160]: 2026-10-19
                  - paragraph [ref=e161]: Matched reported contracts · reported Gamma dollars · USD delta per 1% spot move
                  - generic [ref=e162]:
                    - generic [ref=e163]:
                      - generic [ref=e164]: Selected contract · 100 Call · 2026-10-23
                      - generic [ref=e165]: +20K → +30K
                      - generic [ref=e166]: Δ vs prior · +10K
                    - generic [ref=e167]:
                      - generic [ref=e168]: Matched net
                      - generic [ref=e169]: +20K → +30K
                      - generic [ref=e170]: Δ vs prior · +10K
                  - paragraph [ref=e171]: Covers only matching reported contracts. This does not establish trading flow.
                  - paragraph [ref=e172]: Same reported contract keys, not proven unchanged economics or model history. OI positioning comparability and correction completeness remain unestablished. Reported-set changes do not establish entries or exits. No flow attribution, velocity, percentage change or historical PIT claim.
                  - group [ref=e173]:
                    - generic "Original measurements and comparison details" [ref=e174] [cursor=pointer]
              - generic [ref=e175]:
                - generic [ref=e176]: Replay & change
                - heading "This lens needs additional admitted evidence" [level=3] [ref=e177]
                - paragraph [ref=e178]: This matrix is a single session. Dated chain frames and availability times are not supplied by the shared replay owner.
                - paragraph [ref=e179]: Build time is not availability time. OI session, settlement time, multiplier and deliverable are unknown.
              - region "Exact slice" [ref=e180]:
                - generic [ref=e181]:
                  - heading "Exact slice" [level=3] [ref=e182]
                  - generic [ref=e183]: "2 · Counts: contracts · ΔOI: signed contracts"
                - generic "Exact slice" [ref=e184]:
                  - table [ref=e185]:
                    - rowgroup [ref=e186]:
                      - row "Strike · Expiry Volume Open interest ΔOI" [ref=e187]:
                        - columnheader "Strike · Expiry" [ref=e188]
                        - columnheader "Volume" [ref=e189]
                        - columnheader "Open interest" [ref=e190]
                        - columnheader "ΔOI" [ref=e191]
                    - rowgroup [ref=e192]:
                      - row "100 Call · 2026-10-23 243 110 Unavailable" [ref=e193]:
                        - rowheader "100 Call · 2026-10-23" [ref=e194]:
                          - button "100 Call · 2026-10-23" [pressed] [ref=e195] [cursor=pointer]
                        - cell "243" [ref=e196]
                        - cell "110" [ref=e197]
                        - cell "Unavailable" [ref=e198]
                      - row "100 Put · 2026-10-23 9 2 Unavailable" [ref=e199]:
                        - rowheader "100 Put · 2026-10-23" [ref=e200]:
                          - button "100 Put · 2026-10-23" [ref=e201] [cursor=pointer]
                        - cell "9" [ref=e202]
                        - cell "2" [ref=e203]
                        - cell "Unavailable" [ref=e204]
                - generic [ref=e205]:
                  - button "Previous" [disabled] [ref=e206]
                  - generic [ref=e207]: 1 / 1
                  - button "Next" [disabled] [ref=e208]
            - complementary "Pinned selection" [ref=e209]:
              - generic [ref=e210]: Pinned selection · 0 / 3
              - heading "SPY 100 Call · 2026-10-23" [level=3] [ref=e211]
              - paragraph [ref=e212]: Source coordinate · instrument identity unverified
              - generic [ref=e213]:
                - term [ref=e214]: Volume
                - definition [ref=e215]: "243"
                - term [ref=e216]: Open interest
                - definition [ref=e217]: "110"
                - term [ref=e218]: ΔOI
                - definition [ref=e219]: Unavailable
                - term [ref=e220]: Published volume / published OI
                - definition [ref=e221]: 2.21×
                - term [ref=e222]: Gamma, bid/ask, trade direction
                - definition [ref=e223]: Not in this snapshot
              - paragraph [ref=e224]: Published volume and OI may describe different sessions. Their ratio does not confirm opening trades or direction.
              - generic [ref=e225]:
                - term [ref=e226]: Published IV · matching source session
                - definition [ref=e227]: Unavailable
              - button "Compare selection" [ref=e228] [cursor=pointer]
              - button "Dismiss selection" [ref=e229] [cursor=pointer]
              - generic [ref=e230]:
                - button "Save investigation" [disabled] [ref=e231]
                - paragraph [ref=e232]: Options evidence is not yet admitted by Saved Research
          - group [ref=e233]:
            - generic "Sources & coverage" [ref=e234] [cursor=pointer]
        - generic [ref=e235]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e236]
```

# Test source

```ts
  1  | import { expect, test, type Page } from "@playwright/test";
  2  | import { reportedGammaBook } from "../lib/__tests__/fixtures/reportedGammaBooks";
  3  | 
  4  | // Exercise the incumbent EventSource owner, including its retained-data failure state.
  5  | // No mock replaces useFlowStream, the host source gate, memory owner, or comparison panel.
  6  | test.setTimeout(120_000);
  7  | 
  8  | async function installReads(page: Page) {
  9  |   const reads: string[] = [];
  10 |   await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", domain: "127.0.0.1", path: "/" }]);
  11 |   await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  12 |   await page.route("**/api/flow?*", async route => {
  13 |     const feed = new URL(route.request().url()).searchParams.get("f");
  14 |     if (feed) reads.push(feed);
  15 |     if (feed === "matrix:SPY") return route.fulfill({ json: { schema: "options_structure.matrix/v1", root: "SPY", session: "2026-10-19", cells: [{ strike: 100, expiry: "2026-10-23", call_vol: 243, call_oi: 110, put_vol: 9, put_oi: 2 }] } });
  16 |     if (feed === "gex:SPY") return route.fulfill({ json: reportedGammaBook("2026-10-19") });
  17 |     if (feed === "gex_dates:SPY") return route.fulfill({ json: { root: "SPY", dates: ["2026-10-19", "2026-10-16"], latest: "2026-10-19" } });
  18 |     if (feed === "gex_at:SPY:2026-10-16") return route.fulfill({ json: reportedGammaBook("2026-10-16", 2) });
  19 |     return route.fallback();
  20 |   });
  21 |   return reads;
  22 | }
  23 | 
  24 | for (const status of ["unavailable", "absent"] as const) {
  25 |   test("Research Lab withdraws a retained " + status + " source and restores the exact pin on recovery", async ({ page }, info) => {
  26 |     const reads = await installReads(page);
  27 |     let releaseFailure!: () => void, releaseRecovery!: () => void;
  28 |     const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
  29 |     const recoveryGate = new Promise<void>(resolve => { releaseRecovery = resolve; });
  30 |     let connections = 0, failureDelivered = false;
  31 |     await page.route("**/api/flow/stream?*", async route => {
  32 |       if (new URL(route.request().url()).searchParams.get("f") !== "gex:SPY") return route.fallback();
  33 |       const connection = ++connections;
  34 |       if (connection === 1) return route.fulfill({ contentType: "text/event-stream", body: "retry: 250\n\ndata: " + JSON.stringify(reportedGammaBook("2026-10-19")) + "\n\n" });
  35 |       if (connection === 2) {
  36 |         await failureGate;
  37 |         await route.fulfill({ contentType: "text/event-stream", body: "retry: 250\n\nevent: status\ndata: " + JSON.stringify({ status }) + "\n\n" });
  38 |         failureDelivered = true;
  39 |         return;
  40 |       }
  41 |       await recoveryGate;
  42 |       return route.fulfill({ contentType: "text/event-stream", body: "retry: 60000\n\ndata: " + JSON.stringify(reportedGammaBook("2026-10-19", 3)) + "\n\n" });
  43 |     });
  44 |     try {
  45 |       await page.goto("/options?tab=gex&view=research");
  46 |       const lab = page.getByRole("region", { name: "3D Research Lab", exact: true });
  47 |       await expect(lab).toBeVisible({ timeout: 45_000 });
  48 |       await lab.getByRole("button", { name: "100 Call · 2026-10-23", exact: true }).click();
  49 |       await lab.getByRole("button", { name: "Replay & change", exact: true }).click();
  50 |       const panel = lab.getByTestId("research-reported-gamma");
  51 |       await expect(panel).toHaveAttribute("data-comparison-state", "data");
  52 |       await expect(panel).toContainText("+20K → +10K");
  53 |       await expect(panel.getByTestId("research-reported-gamma-pin")).toHaveAttribute("data-pin-state", "pinned");
  54 |       const liveReads = reads.filter(x => x === "gex:SPY").length;
  55 |       const archiveReads = reads.filter(x => x === "gex_at:SPY:2026-10-16").length;
  56 |       releaseFailure();
  57 |       await expect.poll(() => failureDelivered).toBe(true);
> 58 |       await expect(panel).toHaveCount(0);
     |                           ^ Error: expect(locator).toHaveCount(expected) failed
  59 |       await expect(lab).toContainText("No current all-expiry GEX source is supplied");
  60 |       expect(reads.filter(x => x === "gex:SPY")).toHaveLength(liveReads);
  61 |       expect(reads.filter(x => x === "gex_at:SPY:2026-10-16")).toHaveLength(archiveReads);
  62 |       await lab.screenshot({ path: info.outputPath(status + "-withdrawn.png") });
  63 |       releaseRecovery();
  64 |       await expect(panel).toHaveAttribute("data-comparison-state", "data");
  65 |       await expect(panel).toContainText("+20K → +30K");
  66 |       await expect(panel.getByTestId("research-reported-gamma-pin")).toHaveAttribute("data-pin-state", "pinned");
  67 |       expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  68 |       await panel.screenshot({ path: info.outputPath(status + "-recovered.png") });
  69 |     } finally {
  70 |       releaseFailure();
  71 |       releaseRecovery();
  72 |     }
  73 |   });
  74 | }
  75 | 
```