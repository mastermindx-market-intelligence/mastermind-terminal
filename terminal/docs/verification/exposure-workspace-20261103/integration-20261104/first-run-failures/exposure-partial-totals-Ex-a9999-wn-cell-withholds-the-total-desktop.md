# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: exposure-partial-totals.spec.ts >> Exposure 0DTE unknown cell withholds the total
- Location: e2e/exposure-partial-totals.spec.ts:35:7

# Error details

```
Error: expect(locator).not.toHaveAttribute(expected) failed

Locator: locator('.obs-gexdesk-view-chooser')
Expected: not ""
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "not toHaveAttribute" with timeout 5000ms
  - waiting for locator('.obs-gexdesk-view-chooser')

```

```yaml
- text: MASTERMIND TERMINAL
- navigation:
  - link "Chart":
    - /url: /terminal
    - img
    - text: Chart
  - link "Analysis":
    - /url: /analysis
    - img
    - text: Analysis
  - link "Discover":
    - /url: /discover
    - img
    - text: Discover
  - link "Dislocations":
    - /url: /dislocations
    - img
    - text: Dislocations
  - link "Options":
    - /url: /options
    - img
    - text: Options
  - link "Scripts":
    - /url: /scripts
    - img
    - text: Scripts
  - link "Portfolio":
    - /url: /portfolio
    - img
    - text: Portfolio
  - link "Alerts":
    - /url: /alerts
    - img
    - text: Alerts
  - button "Mastermind AI":
    - img
    - text: Mastermind AI
- button "Settings": U
- banner:
  - text: MASTERMIND TERMINAL Options
  - button "Settings": U
- navigation "Primary":
  - link "Chart":
    - /url: /terminal
    - img
  - link "Analysis":
    - /url: /analysis
    - img
  - link "Discover":
    - /url: /discover
    - img
  - link "Dislocations":
    - /url: /dislocations
    - img
  - link "Options":
    - /url: /options
    - img
  - link "Scripts":
    - /url: /scripts
    - img
  - link "Portfolio":
    - /url: /portfolio
    - img
  - link "Alerts":
    - /url: /alerts
    - img
  - button "Mastermind AI":
    - img
- main:
  - combobox "Switch Options view"
  - tablist "Options categories":
    - tab "Command"
    - tab "Flow"
    - tab "Exposure" [selected]
    - tab "Structure"
    - tab "Volatility"
    - tab "Statistics"
    - tab "Prophet"
  - link "Futures depth & footprint":
    - /url: /options/futures
    - text: Futures
  - button "Open the four-step options workflow · 1/4 viewed": Workflow
  - text: View
  - tablist "Options views":
    - tab "Exposure" [selected]
    - tab "Positioning"
    - tab "Levels"
  - tabpanel "Exposure":
    - text: Vol Mixed — normalizing
    - status: Loading…
    - text: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
- alert
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import gexFixture from "../public/data/gex_fixture.json";
  3   | 
  4   | // T09 — expiry partial-total integrity on the mounted Exposure desk. Synthetic source data
  5   | // (not market observations), delivered through the desk's ordinary HTTP/SSE readers.
  6   | // Adapted from the consumed #768 spec onto this carrier's desk.
  7   | const session = "2026-09-25";
  8   | const later = "2026-09-28";
  9   | const gex = {
  10  |   ...gexFixture.SPY, asof: `${session}T20:15:00Z`, spot_ref: 770.5,
  11  |   by_strike: gexFixture.SPY.by_strike.slice(0, 2).map((row, i) => ({ ...row, strike: 770 + i })),
  12  |   // The later expiration has no delta value: it must stay in the population under DEX.
  13  |   by_expiry: [{ exp: session, gamma_net: 10, delta_net: 0 }, { exp: later, gamma_net: 15 }],
  14  | };
  15  | 
  16  | async function openStrikeView(page: Page, zh: boolean) {
  17  |   // The shared live map opens first; its real view chooser discloses the legacy
  18  |   // strike branch. Keep the population/partial-total assertions on that branch.
  19  |   const chooser = page.locator(".obs-gexdesk-view-chooser");
> 20  |   await expect(chooser).not.toHaveAttribute("open", "");
      |                             ^ Error: expect(locator).not.toHaveAttribute(expected) failed
  21  |   await chooser.locator("summary").click();
  22  |   const strike = page.getByRole("button", { name: zh ? "按行权价" : "By Strike", exact: true });
  23  |   await strike.click();
  24  |   await expect(page.locator('[data-tut="gex-ladder"]')).toBeVisible();
  25  |   if (page.viewportSize()!.width <= 640) {
  26  |     const selected = page.locator(".obs-gexdesk-left summary").first();
  27  |     await expect(selected).toHaveText(zh ? "按行权价" : "By Strike");
  28  |     await expect(selected).toBeFocused();
  29  |   } else {
  30  |     await expect(strike).toHaveAttribute("aria-pressed", "true");
  31  |   }
  32  | }
  33  | 
  34  | for (const complete of [false, true]) {
  35  |   test(`Exposure 0DTE ${complete ? "complete grid shows its total" : "unknown cell withholds the total"}`, async ({ page }, info) => {
  36  |     const zh = info.project.name === "tablet";
  37  |     if (zh) await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
  38  |     const errors: string[] = [];
  39  |     page.on("pageerror", (error) => errors.push(error.message));
  40  |     // Built after UTC midnight: the 0DTE anchor must be the source session, not the build clock.
  41  |     const matrix = {
  42  |       schema: "options_structure.matrix/v1", root: "SPY", spot: 770.5,
  43  |       asof: "2026-09-26T00:05:00Z", _build_meta: { asof_date: session },
  44  |       // 900 is inside the matrix's wider strike window but off the displayed ladder: it
  45  |       // must never enter the ladder-scoped total (review P1, probe A).
  46  |       strikes: [770, 771, 900], expiries: [session, later], cells: [
  47  |         { strike: 770, expiry: session, gex: 8e6 },
  48  |         { strike: 771, expiry: session, gex: complete ? -3e6 : null },
  49  |         { strike: 770, expiry: later, gex: 1e6 },
  50  |         { strike: 771, expiry: later, gex: 0 },
  51  |         { strike: 900, expiry: session, gex: -50e6 },
  52  |         { strike: 900, expiry: later, gex: -50e6 },
  53  |       ],
  54  |     };
  55  |     await page.route("**/api/flow?*", async (route) => {
  56  |       const feed = new URL(route.request().url()).searchParams.get("f");
  57  |       if (feed === "matrix:SPY") await route.fulfill({ json: matrix });
  58  |       else if (feed === "gex:SPY") await route.fulfill({ json: gex });
  59  |       else await route.fallback();
  60  |     });
  61  |     await page.route("**/api/flow/stream?*", async (route) => {
  62  |       if (new URL(route.request().url()).searchParams.get("f") === "gex:SPY") {
  63  |         await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(gex)}\n\n` });
  64  |       } else await route.fallback();
  65  |     });
  66  |     await page.goto("/options?tab=prism");
  67  |     await openStrikeView(page, zh);
  68  | 
  69  |     // (a) 0DTE: one unknown required cell withholds the whole selected total.
  70  |     const zero = page.getByRole("button", { name: zh ? "当日到期" : "0DTE", exact: true });
  71  |     await expect(zero).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 });
  72  |     await zero.click();
  73  |     await expect(zero).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  74  |     const summary = page.locator('[data-tut="gex-summary"]').locator(":scope > *").first();
  75  |     await expect(summary.locator(":scope > *").last()).toHaveText(complete ? "+5.0M" : "—", { timeout: 20_000 });
  76  |     await expect(summary).toBeVisible();
  77  |     await expect(page.getByTestId("gex-snapshot-levels")).toHaveCount(0);
  78  |     const partial = page.getByTestId("gex-lens-partial");
  79  |     if (complete) await expect(partial).toHaveCount(0, { timeout: 20_000 });
  80  |     else {
  81  |       await expect(partial).toBeVisible();
  82  |       await expect(partial).toContainText("+8.0M", { timeout: 20_000 });
  83  |       await expect(partial).toContainText(session, { timeout: 20_000 });
  84  |     }
  85  | 
  86  |     // (d) DEX: the 0DTE split is gamma-only, so the lens is released, never relabelled.
  87  |     await page.getByRole("button", { name: zh ? "德尔塔敞口" : "Delta exposure", exact: true }).click();
  88  |     await expect(zero).toHaveAttribute("aria-disabled", "true", { timeout: 20_000 });
  89  |     await expect(zero).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
  90  |     await expect(partial).toHaveCount(0, { timeout: 20_000 });
  91  | 
  92  |     // (c) The expiration drawer counts the same population under DEX as under GEX, and
  93  |     // discloses the expiration that has no delta value instead of dropping it.
  94  |     const count = page.locator(".obs-xdrawer-count");
  95  |     await expect(count).toContainText("2", { timeout: 20_000 });
  96  |     await page.locator(".obs-xdrawer-hd").click();
  97  |     await expect(page.getByTestId("xdrawer-unresolved")).toContainText("1", { timeout: 20_000 });
  98  |     await page.getByRole("button", { name: zh ? "伽马敞口" : "Gamma exposure", exact: true }).click();
  99  |     await expect(count).toContainText("2", { timeout: 20_000 });
  100 |     await expect(page.getByTestId("xdrawer-unresolved")).toHaveCount(0, { timeout: 20_000 });
  101 | 
  102 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  103 |     expect(errors).toEqual([]);
  104 |     const levels = page.locator("details").filter({ has: page.locator('[data-tut="gex-summary"]') });
  105 |     if (await levels.count()) await levels.locator("summary").click();
  106 |     await summary.scrollIntoViewIfNeeded();
  107 |     await page.screenshot({
  108 |       path: info.outputPath(`${info.project.name}-exposure-${complete ? "complete" : "partial"}.png`), fullPage: false,
  109 |     });
  110 |   });
  111 | }
  112 | 
  113 | // Review P1, probe B: the chain (gex `by_expiry`) carries an expiration past the matrix's DTE
  114 | // window. "All except 0DTE" names it, so its missing cells withhold the total — the known
  115 | // part is disclosed as a subtotal, together with how much of the population is outside.
  116 | test("Exposure All except 0DTE withholds the total when a chain expiration is outside the snapshot", async ({ page }, info) => {
  117 |   const zh = info.project.name === "tablet";
  118 |   if (zh) await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
  119 |   const errors: string[] = [];
  120 |   page.on("pageerror", (error) => errors.push(error.message));
```