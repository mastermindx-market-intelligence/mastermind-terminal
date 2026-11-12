# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-research-continuity.spec.ts >> saved research keeps the Options references and reports each source's state on every reopen
- Location: e2e/options-research-continuity.spec.ts:12:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/analysis\?view=investigations&symbol=MU/
Received string:  "http://127.0.0.1:3641/terminal?symbol=MU&origin=%7B%22v%22%3A1%2C%22kind%22%3A%22sector%22%2C%22returnHref%22%3A%22%2Fdiscover%3Ftab%3Dsectors%26sectorWorkspace%3Ddetail%26sectorDiscoverySort%3Dsource%26sectorCompanyTableSort%3Dsource%26sectorDiscoveryMode%3Dsummary%26sectorMatrixTimeframe%3D1D%26sectorRotationMode%3Dmap%26sectorView%3Dintelligence%26sectorTheme%3Ddark%26sectorCompany%3DMU%26sector%3Dxlk%26group%3Dsemiconductors%26sectorSort%3Dsource%22%2C%22sector%22%3A%22xlk%22%2C%22group%22%3A%22semiconductors%22%2C%22company%22%3A%22MU%22%2C%22index%22%3A2%2C%22count%22%3A14%2C%22sort%22%3A%22source%22%2C%22query%22%3A%22%22%2C%22asOf%22%3A%222026-09-23%22%2C%22contentHash%22%3A%22sha256%3Aa1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718%22%2C%22method%22%3A%22incumbent_rs_63_21%2Fv1%22%2C%22benchmark%22%3A%22SPY%22%7D#exposure=%7B%22v%22%3A1%2C%22root%22%3A%22MU%22%2C%22session%22%3A%222026-10-19%22%2C%22strike%22%3A1110%2C%22archived%22%3Afalse%2C%22metric%22%3A%22gamma%22%2C%22lens%22%3A%7B%22kind%22%3A%22all%22%7D%2C%22shock%22%3A%7B%22spotPercent%22%3A0%2C%22ivPoints%22%3A0%2C%22calendarDays%22%3A0%7D%2C%22fingerprint%22%3A%2236f4ef64a4543b31964dba53e17809b106be5e9b06f7f7ebd184e928dccff317%22%7D"
Timeout: 30000ms

Call log:
  - Expect "toHaveURL" with timeout 30000ms
    53 × unexpected value "http://127.0.0.1:3641/terminal?symbol=MU&origin=%7B%22v%22%3A1%2C%22kind%22%3A%22sector%22%2C%22returnHref%22%3A%22%2Fdiscover%3Ftab%3Dsectors%26sectorWorkspace%3Ddetail%26sectorDiscoverySort%3Dsource%26sectorCompanyTableSort%3Dsource%26sectorDiscoveryMode%3Dsummary%26sectorMatrixTimeframe%3D1D%26sectorRotationMode%3Dmap%26sectorView%3Dintelligence%26sectorTheme%3Ddark%26sectorCompany%3DMU%26sector%3Dxlk%26group%3Dsemiconductors%26sectorSort%3Dsource%22%2C%22sector%22%3A%22xlk%22%2C%22group%22%3A%22semiconductors%22%2C%22company%22%3A%22MU%22%2C%22index%22%3A2%2C%22count%22%3A14%2C%22sort%22%3A%22source%22%2C%22query%22%3A%22%22%2C%22asOf%22%3A%222026-09-23%22%2C%22contentHash%22%3A%22sha256%3Aa1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718%22%2C%22method%22%3A%22incumbent_rs_63_21%2Fv1%22%2C%22benchmark%22%3A%22SPY%22%7D#exposure=%7B%22v%22%3A1%2C%22root%22%3A%22MU%22%2C%22session%22%3A%222026-10-19%22%2C%22strike%22%3A1110%2C%22archived%22%3Afalse%2C%22metric%22%3A%22gamma%22%2C%22lens%22%3A%7B%22kind%22%3A%22all%22%7D%2C%22shock%22%3A%7B%22spotPercent%22%3A0%2C%22ivPoints%22%3A0%2C%22calendarDays%22%3A0%7D%2C%22fingerprint%22%3A%2236f4ef64a4543b31964dba53e17809b106be5e9b06f7f7ebd184e928dccff317%22%7D"

```

```yaml
- banner:
  - text: MASTERMIND TERMINAL
  - button "Symbol search — MU":
    - text: M $ MU
    - img
  - button "Compare":
    - img
    - text: Compare
  - text: Last Price 1,132.33 24h Change -6.69% Volume 86.6M Day Range 1,132.33
  - emphasis: L
  - text: 1,121.36 1,198.71
  - emphasis: H
  - text: Historical
  - button "Chart actions": Actions >
  - button "Mastermind AI":
    - img
    - text: Mastermind AI
  - button "Settings": R
- text: MASTERMIND TERMINAL
- navigation:
  - link "Chart":
    - /url: /terminal
    - img
    - text: Chart
  - link "Analysis":
    - /url: /analysis?symbol=MU
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
- button "Settings": R
- navigation "Primary":
  - link "Chart":
    - /url: /terminal
    - img
  - link "Analysis":
    - /url: /analysis?symbol=MU
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
- button "Chart context": Context
- button "D"
- button "3D"
- button "W"
- button "1M"
- button "Customize timeframes":
  - img
- button "Candles ▾"
- button "Indicators":
  - img
  - text: Indicators
- button "More"
- toolbar "Drawing tools":
  - button "Cursor" [pressed]
  - button "Trend line, Alt+T"
  - button "Open Lines, channels & pitchforks tools"
  - button "Fibonacci retracement, Alt+F"
  - button "Open Fibonacci & Gann tools"
  - button "XABCD pattern"
  - button "Open Patterns, Elliott waves & cycles tools"
  - button "Long position"
  - button "Open Forecasting, volume & ranges tools"
  - button "Brush"
  - button "Open Freehand tools"
  - button "Rectangle, Alt+Shift+R"
  - button "Open Shapes & curves tools"
  - button "Arrow marker"
  - button "Open Arrows tools"
  - button "Text, Alt+X"
  - button "Open Text, notes & labels tools"
  - button "Emoji"
  - button "Open Emoji & icons tools"
  - button "Keep drawing active"
  - 'button "Magnet mode: Off"'
  - button "Open magnet modes"
  - group "Drawing history":
    - button "Undo drawing change" [disabled]
    - button "Redo drawing change" [disabled]
  - button "Lock 0 drawings" [disabled]
  - button "Hide 0 drawings"
  - button "Remove drawings, 0 drawings"
  - button "Hide favorites (0)" [disabled]
- text: M Micron Technology · 3D · Equities O 1082.22 H 1255.00 L 991.10 C 1132.33 +80.56 (+7.66%)
- table:
  - row:
    - cell
    - cell
    - cell
  - row:
    - cell
  - row:
    - cell
    - cell
    - cell
  - row:
    - cell
  - row:
    - cell
    - cell
    - cell
  - row:
    - cell
    - cell
    - cell
- text: Moving Averages Volume TW · Mastermind Candles
- button "Minimize indicator list":
  - img
- text: Stochastic RSI MACD-RSI
- img
- img
- img
- text: MU 1,132.33 00:00
- button "1D"
- button "5D"
- button "1M"
- button "3M"
- button "6M"
- button "YTD"
- button "1Y"
- button "5Y"
- button "All"
- button "Go to date":
  - img
- text: 03:36:10 UTC-8
- button "Extended trading hours" [disabled]: ETH
- button "Data origin for this chart": BASIS?
- button "Quick settings":
  - img
- separator "Resize sidebar"
- complementary:
  - group "Options perspective":
    - button "Overview" [pressed]
    - button "Context"
    - button "Options heatmap": Options
  - tablist "Rail source":
    - tab "Portfolio"
    - tab "Watchlists" [selected]
    - tab "News"
  - tabpanel "Watchlists":
    - button "Default":
      - text: Default
      - img
    - button "Add symbol":
      - img
    - button "Upcoming events for this list"
    - button "Settings":
      - img
    - text: Symbol Last Chg% Ext Ext %
    - listbox "Watchlists":
      - button "Crypto 2" [expanded]
      - button "Drag section Crypto"
      - button "Rename section":
        - img
      - button "Remove section":
        - img
      - option "Drag BTC-USD Flag this symbol BTC-USD 60,025.72 +0.35% — —":
        - button "Drag BTC-USD"
        - text: BTC-USD 60,025.72 +0.35% — —
        - img
      - option "Drag ETH-USD Flag this symbol ETH-USD 1,579.00 +0.72% — —":
        - button "Drag ETH-USD"
        - text: ETH-USD 1,579.00 +0.72% — —
        - img
      - button "Equities 4" [expanded]
      - button "Drag section Equities"
      - button "Rename section":
        - img
      - button "Remove section":
        - img
      - option "Drag NVDA Flag this symbol NVDA 192.53 -1.64% — —":
        - button "Drag NVDA"
        - text: NVDA 192.53 -1.64% — —
        - img
      - option "Drag AAPL Flag this symbol AAPL 283.78 +3.14% — —":
        - button "Drag AAPL"
        - text: AAPL 283.78 +3.14% — —
        - img
      - option "Drag MSFT Flag this symbol MSFT 372.97 +5.71% — —":
        - button "Drag MSFT"
        - text: MSFT 372.97 +5.71% — —
        - img
      - option "Drag QQQ Flag this symbol QQQ 706.52 -1.38% — —":
        - button "Drag QQQ"
        - text: QQQ 706.52 -1.38% — —
        - img
      - status
  - text: Micron Technology MU · Equities
  - button "Open full analysis":
    - img
  - text: 1,132.33 -6.69% Closed
  - button "Open Intelligence workspace": "Intelligence Oracle Uptrend — no entry signal Historical signal: Structure stop · Signal date unverified Research No current reading View details Prophet Sign in to view Oracle entry unverified · No current data"
  - text: Trend Uptrend weeks–months
  - img
  - text: Deep analysis coming online This name isn't in the research desk yet — the chart, levels and oracle verdict above are live. Key stats Volume 86.55 M Avg volume (30D) 56.74 M Performance -0.15% 1W +21.96% 1M +218.55% 3M +309.86% 6M +296.74% YTD +789.85% 1Y Technicals
  - img "69 of 100":
    - img
    - text: 69 Buy
  - text: Sell 3 Neutral 8 Buy 15
  - button "More technicals ›"
  - text: Realized volatility cone 10d 42d 252d Current Median
  - region "Seasonality view context":
    - group "Linking for this view":
      - button "Follow chart" [pressed]
      - button "Pin this view"
      - button "Unlink"
    - status: "Following chart: MU"
    - paragraph: Linking applies to this session only.
    - text: Seasonality · avg monthly return 10y
    - radiogroup "Seasonality · avg monthly return":
      - radio "Jan · +12.6% avg · WR 80% · n=5": J
      - radio "Feb · +2.3% avg · WR 60% · n=5": F
      - radio "Mar · -0.6% avg · WR 40% · n=5": M
      - radio "Apr · +6.3% avg · WR 40% · n=5": A
      - radio "May · +27.1% avg · WR 100% · n=5": M
      - radio "Jun · +3.9% avg · WR 60% · n=5": J
      - radio "Jul · -2.3% avg · WR 40% · n=5": J
      - radio "Aug · -3.8% avg · WR 20% · n=5": A
      - radio "Sep · +6.1% avg · WR 40% · n=5": S
      - radio "Oct · +6.7% avg · WR 40% · n=5": O
      - radio "Nov · +9.2% avg · WR 80% · n=5" [checked]: "N"
      - radio "Dec · +3.3% avg · WR 60% · n=5": D
    - combobox "Seasonality · avg monthly return · Jan–Dec":
      - option "Jan"
      - option "Feb"
      - option "Mar"
      - option "Apr"
      - option "May"
      - option "Jun"
      - option "Jul"
      - option "Aug"
      - option "Sep"
      - option "Oct"
      - option "Nov" [selected]
      - option "Dec"
    - status: Nov · +9.2% avg · WR 80% · n=5
    - text: Current month highlighted · from MU history (display-only context).
    - button "More seasonals ›"
  - button "Open full analysis"
  - button "Ask Mastermind AI about MU →"
- text: Movers NVDA 192.53 -1.64% AAPL 283.78 +3.14% MSFT 372.97 +5.71% GOOGL 337.39 -1.84% AMZN 232.69 +2.50% META 550.25 +1.36% TSLA 379.71 +1.22% AMD 521.58 -2.06% AVGO 365.02 -3.67% NFLX 73.81 +4.10% CRM 158.37 +5.45% SMCI 30.63 -3.31% ARM 334.27 -3.87% PLTR 112.93 +5.28% MSTR 82.31 -3.54% MU 1,132.33 -6.69%
- alert
- region "Exposure reference":
  - strong: Exposure reference · MU 1110
  - status: The selected book and scope match. This dated level can be shown on the chart.
  - text: 2026-10-19 · Gamma · All supplied expirations Dated reference; not historical positioning
  - button "Remove reference" [pressed]
  - link "Save to research":
    - /url: /analysis?view=investigations&symbol=MU&origin=%7B%22v%22%3A1%2C%22kind%22%3A%22sector%22%2C%22returnHref%22%3A%22%2Fdiscover%3Ftab%3Dsectors%26sectorWorkspace%3Ddetail%26sectorDiscoverySort%3Dsource%26sectorCompanyTableSort%3Dsource%26sectorDiscoveryMode%3Dsummary%26sectorMatrixTimeframe%3D1D%26sectorRotationMode%3Dmap%26sectorView%3Dintelligence%26sectorTheme%3Ddark%26sectorCompany%3DMU%26sector%3Dxlk%26group%3Dsemiconductors%26sectorSort%3Dsource%22%2C%22sector%22%3A%22xlk%22%2C%22group%22%3A%22semiconductors%22%2C%22company%22%3A%22MU%22%2C%22index%22%3A2%2C%22count%22%3A14%2C%22sort%22%3A%22source%22%2C%22query%22%3A%22%22%2C%22asOf%22%3A%222026-09-23%22%2C%22contentHash%22%3A%22sha256%3Aa1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718%22%2C%22method%22%3A%22incumbent_rs_63_21%2Fv1%22%2C%22benchmark%22%3A%22SPY%22%7D#exposure=%7B%22v%22%3A1%2C%22root%22%3A%22MU%22%2C%22session%22%3A%222026-10-19%22%2C%22strike%22%3A1110%2C%22archived%22%3Afalse%2C%22metric%22%3A%22gamma%22%2C%22lens%22%3A%7B%22kind%22%3A%22all%22%7D%2C%22shock%22%3A%7B%22spotPercent%22%3A0%2C%22ivPoints%22%3A0%2C%22calendarDays%22%3A0%7D%2C%22fingerprint%22%3A%2236f4ef64a4543b31964dba53e17809b106be5e9b06f7f7ebd184e928dccff317%22%7D
  - link "Return to Exposure":
    - /url: /options?tab=prism&symbol=MU&view=chart&origin=%7B%22v%22%3A1%2C%22kind%22%3A%22sector%22%2C%22returnHref%22%3A%22%2Fdiscover%3Ftab%3Dsectors%26sectorWorkspace%3Ddetail%26sectorDiscoverySort%3Dsource%26sectorCompanyTableSort%3Dsource%26sectorDiscoveryMode%3Dsummary%26sectorMatrixTimeframe%3D1D%26sectorRotationMode%3Dmap%26sectorView%3Dintelligence%26sectorTheme%3Ddark%26sectorCompany%3DMU%26sector%3Dxlk%26group%3Dsemiconductors%26sectorSort%3Dsource%22%2C%22sector%22%3A%22xlk%22%2C%22group%22%3A%22semiconductors%22%2C%22company%22%3A%22MU%22%2C%22index%22%3A2%2C%22count%22%3A14%2C%22sort%22%3A%22source%22%2C%22query%22%3A%22%22%2C%22asOf%22%3A%222026-09-23%22%2C%22contentHash%22%3A%22sha256%3Aa1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718%22%2C%22method%22%3A%22incumbent_rs_63_21%2Fv1%22%2C%22benchmark%22%3A%22SPY%22%7D#exposure=%7B%22v%22%3A1%2C%22root%22%3A%22MU%22%2C%22session%22%3A%222026-10-19%22%2C%22strike%22%3A1110%2C%22archived%22%3Afalse%2C%22metric%22%3A%22gamma%22%2C%22lens%22%3A%7B%22kind%22%3A%22all%22%7D%2C%22shock%22%3A%7B%22spotPercent%22%3A0%2C%22ivPoints%22%3A0%2C%22calendarDays%22%3A0%7D%2C%22fingerprint%22%3A%2236f4ef64a4543b31964dba53e17809b106be5e9b06f7f7ebd184e928dccff317%22%7D
  - link "Back to Sector Central":
    - /url: /discover?tab=sectors&sectorWorkspace=detail&sectorDiscoverySort=source&sectorCompanyTableSort=source&sectorDiscoveryMode=summary&sectorMatrixTimeframe=1D&sectorRotationMode=map&sectorView=intelligence&sectorTheme=dark&sectorCompany=MU&sector=xlk&group=semiconductors&sectorSort=source
  - button "Dismiss exposure reference": ×
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { exposureHrefFor, prepareSectorJourney } from "./helpers/optionsR1Journey";
  3   | import { CORRECTED_HASH, ResearchStore, SAVED_HASH, digest, routeResearch } from "./helpers/optionsR1Research";
  4   | 
  5   | // Options R1 W2C — "Save to research" from the chart reference, then the same revision reopened after a reload, from an
  6   | // independent browser context with its own storage, against a corrected source, after a revoked read and after an
  7   | // edited thesis. Synthetic fixtures on the local-preview owner: product proof of references and digests, not market,
  8   | // backtest or auth-provider proof. A viewport alone is never persistence proof; every reopen is a fresh read.
  9   | const MATCHES = "Matches the saved source", CORRECTED = "Source corrected since this revision";
  10  | test.setTimeout(300_000);
  11  | 
  12  | test("saved research keeps the Options references and reports each source's state on every reopen", async ({ page, context, browser }, testInfo) => {
  13  |   const store = new ResearchStore();
  14  |   await routeResearch(context, store);
  15  |   await prepareSectorJourney(page, { hash: () => SAVED_HASH });
  16  |   const { href } = await exposureHrefFor(page, "MU");
  17  |   await page.goto(href);
  18  |   const map = page.getByTestId("exposure-map");
  19  |   await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  20  |   await map.getByRole("button", { name: /Largest covered net node/ }).click();
  21  |   await page.getByTestId("exposure-node-inspector").getByRole("button", { name: "Open on main chart", exact: true }).click();
  22  |   await expect(page).toHaveURL(/\/terminal\?symbol=MU&origin=.*#exposure=/, { timeout: 30_000 });
  23  |   const reference = page.getByTestId("exposure-chart-reference");
  24  |   await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  25  |   const save = reference.getByTestId("exposure-reference-save");
  26  |   const saveHref = (await save.getAttribute("href"))!;
  27  |   expect(saveHref).toMatch(/^\/analysis\?view=investigations&symbol=MU&origin=.*#exposure=/);
  28  |   const request = JSON.parse(decodeURIComponent(saveHref.slice(saveHref.indexOf("#exposure=") + "#exposure=".length))) as { root: string; session: string; strike: number; fingerprint: string };
  29  |   await save.click();
> 30  |   await expect(page).toHaveURL(/\/analysis\?view=investigations&symbol=MU/, { timeout: 30_000 });
      |                      ^ Error: expect(page).toHaveURL(expected) failed
  31  | 
  32  |   // The draft opens with both references already named; nothing is saved until the question is.
  33  |   const card = page.getByTestId("options-evidence");
  34  |   const requestItem = card.locator('[data-options-ref="exposure_chart_request"]'), originItem = card.locator('[data-options-ref="sector_origin"]');
  35  |   await expect(card.locator("[data-options-ref]")).toHaveCount(2);
  36  |   await expect(requestItem).toContainText(`${request.root}/${request.session}/${request.strike}/`);
  37  |   await expect(requestItem).toContainText(request.fingerprint);
  38  |   await expect(originItem).toContainText("xlk/semiconductors/MU");
  39  |   await expect(originItem).toContainText(digest(SAVED_HASH));
  40  |   expect(store.commands).toHaveLength(0);
  41  |   await page.getByLabel("Title", { exact: true }).fill("MU dealer positioning into expiry");
  42  |   await page.getByLabel("Research question", { exact: true }).fill("Does the largest covered net node hold through the next session?");
  43  |   await page.getByRole("button", { name: "Save research", exact: true }).click();
  44  |   await expect(page.getByText("Saved · Revision 1")).toBeVisible({ timeout: 30_000 });
  45  |   expect(store.commands).toHaveLength(1);
  46  |   const savedRefs = store.commands[0].manifest.evidence_refs;
  47  |   expect(savedRefs).toHaveLength(2);
  48  |   expect(savedRefs.find(ref => ref.object_type === "exposure_chart_request")).toMatchObject({ owner: "terminal.options_exposure", mode: "pinned", fingerprint: request.fingerprint });
  49  |   expect(savedRefs.find(ref => ref.object_type === "sector_origin")).toMatchObject({ owner: "terminal.options_exposure", mode: "pinned", object_id: "xlk/semiconductors/MU", version_ref: "exposure_origin.v1@2026-09-23", fingerprint: digest(SAVED_HASH) });
  50  |   const states = card.getByTestId("options-evidence-state");
  51  |   await expect(states).toHaveCount(2, { timeout: 30_000 });
  52  |   await expect(states.nth(0)).toHaveText(MATCHES); await expect(states.nth(1)).toHaveText(MATCHES);
  53  |   await expect(requestItem.getByRole("link", { name: "Open this exposure read →" })).toHaveAttribute("href", /^\/terminal\?symbol=MU#exposure=/);
  54  |   const revisionUrl = page.url();
  55  |   expect(revisionUrl).toMatch(/\/analysis\?view=investigations&investigation=[^&]+&revision=1$/);
  56  |   const id = new URL(revisionUrl).searchParams.get("investigation")!;
  57  |   const noOverflow = async (target: typeof page) => {
  58  |     const width = await target.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  59  |     expect(width).toBeLessThanOrEqual(1);
  60  |   };
  61  |   await noOverflow(page);
  62  |   await card.scrollIntoViewIfNeeded();
  63  |   await page.screenshot({ path: testInfo.outputPath(`research-saved-${testInfo.project.name}.png`), fullPage: true });
  64  | 
  65  |   // Reload: the same revision, re-read, not remembered.
  66  |   await page.reload();
  67  |   await expect(page.getByText("Saved · Revision 1")).toBeVisible({ timeout: 30_000 });
  68  |   await expect(states).toHaveCount(2, { timeout: 30_000 });
  69  |   for (const state of await states.all()) await expect(state).toHaveText(MATCHES);
  70  | 
  71  |   const { viewport, hasTouch, isMobile, baseURL, deviceScaleFactor, userAgent } = testInfo.project.use;
  72  |   const fresh = async (hash: string, access: "granted" | "revoked" = "granted") => {
  73  |     const other = await browser.newContext({ viewport: viewport ?? undefined, hasTouch, isMobile, baseURL, deviceScaleFactor, userAgent });
  74  |     await routeResearch(other, store, access);
  75  |     const otherPage = await other.newPage();
  76  |     await prepareSectorJourney(otherPage, { hash: () => hash });
  77  |     return { other, otherPage };
  78  |   };
  79  | 
  80  |   // An independent context with its own storage reopens the exact revision by address and reads the same states.
  81  |   {
  82  |     const { other, otherPage } = await fresh(SAVED_HASH);
  83  |     await otherPage.goto(revisionUrl);
  84  |     await expect(otherPage.getByText("Saved · Revision 1")).toBeVisible({ timeout: 30_000 });
  85  |     const otherStates = otherPage.getByTestId("options-evidence").getByTestId("options-evidence-state");
  86  |     await expect(otherStates).toHaveCount(2, { timeout: 30_000 });
  87  |     for (const state of await otherStates.all()) await expect(state).toHaveText(MATCHES);
  88  |     await noOverflow(otherPage);
  89  |     await other.close();
  90  |   }
  91  | 
  92  |   // A corrected source: the saved digest stays; the current one is shown beside it. The other reference still matches.
  93  |   {
  94  |     const { other, otherPage } = await fresh(CORRECTED_HASH);
  95  |     await otherPage.goto(revisionUrl);
  96  |     const otherCard = otherPage.getByTestId("options-evidence");
  97  |     const origin = otherCard.locator('[data-options-ref="sector_origin"]');
  98  |     await expect(origin.getByTestId("options-evidence-state")).toHaveText(CORRECTED, { timeout: 30_000 });
  99  |     await expect(origin).toContainText(digest(SAVED_HASH));
  100 |     await expect(origin).toContainText(digest(CORRECTED_HASH));
  101 |     await expect(otherCard.locator('[data-options-ref="exposure_chart_request"]').getByTestId("options-evidence-state")).toHaveText(MATCHES);
  102 |     expect(store.records.get(id)![0].manifest.evidence_refs).toEqual(savedRefs);
  103 |     await noOverflow(otherPage);
  104 |     await otherCard.scrollIntoViewIfNeeded();
  105 |     await otherPage.screenshot({ path: testInfo.outputPath(`research-corrected-${testInfo.project.name}.png`), fullPage: true });
  106 |     await other.close();
  107 |   }
  108 | 
  109 |   // A revoked read is refused with an explanation and a way back in; nothing saved is shown or changed.
  110 |   {
  111 |     const { other, otherPage } = await fresh(SAVED_HASH, "revoked");
  112 |     await otherPage.goto(revisionUrl);
  113 |     await expect(otherPage.getByText("Sign in again to open saved research.")).toBeVisible({ timeout: 30_000 });
  114 |     await expect(otherPage.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  115 |     await expect(otherPage.getByTestId("options-evidence")).toHaveCount(0);
  116 |     expect(store.records.get(id)).toHaveLength(1);
  117 |     await other.close();
  118 |   }
  119 | 
  120 |   // An edited thesis is a new immutable revision that retains the same references and digests.
  121 |   await page.getByRole("button", { name: "Edit saved question", exact: true }).click();
  122 |   await page.getByLabel("Research question", { exact: true }).fill("Does the largest covered net node hold through the next two sessions?");
  123 |   await page.getByRole("button", { name: "Save research", exact: true }).click();
  124 |   await expect(page.getByText("Saved · Revision 2")).toBeVisible({ timeout: 30_000 });
  125 |   expect(store.commands).toHaveLength(2);
  126 |   expect(store.commands[1].expected_revision).toBe(1);
  127 |   expect(store.commands[1].manifest.evidence_refs).toEqual(savedRefs);
  128 |   await expect(states).toHaveCount(2, { timeout: 30_000 });
  129 |   for (const state of await states.all()) await expect(state).toHaveText(MATCHES);
  130 |   await page.getByRole("button", { name: "Previous revision", exact: true }).click();
```