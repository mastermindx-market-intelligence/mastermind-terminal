# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sector-exposure-journey.spec.ts >> the main chart carries the origin and Return to Exposure brings it back
- Location: e2e/sector-exposure-journey.spec.ts:100:5

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByTestId('exposure-chart-reference').getByTestId('exposure-reference-sector')
Expected: "/discover?tab=sectors&sectorWorkspace=detail&sectorDiscoverySort=source&sectorCompanyTableSort=source&sectorDiscoveryMode=summary&sectorMatrixTimeframe=1D&sectorRotationMode=map&sectorView=intelligence&sectorTheme=dark&sectorCompany=MU&sector=xlk&group=semiconductors&sectorSort=source"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for getByTestId('exposure-chart-reference').getByTestId('exposure-reference-sector')
    - waiting for navigation to finish...
    - navigated to "http://127.0.0.1:3641/terminal?symbol=MU&origin=%7B%22v%22%3A1%2C%22kind%22%3A%22sector%22%2C%22returnHref%22%3A%22%2Fdiscover%3Ftab%3Dsectors%26sectorWorkspace%3Ddetail%26sectorDiscoverySort%3Dsourc…"

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
  - text: Last Price — 24h Change — Volume — Day Range
  - emphasis: L
  - text: — —
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
- button "Settings": R
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
- text: Price chart
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
- button "1"
- button "2"
- button "4"
- button "MTF":
  - img
  - text: MTF
- button "Day":
  - img
  - text: Day
- button "Replay" [disabled]:
  - img
  - text: Replay
- button "Detect ▾":
  - img
  - text: Detect ▾
- button "Workspaces ▾":
  - img
  - text: Workspaces ▾
- button "Snapshot":
  - img
- button "Fullscreen chart":
  - img
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
- button "Extended trading hours" [disabled]: ETH
- button "Data origin for this chart": —
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
      - option "Drag BTC-USD Flag this symbol BTC-USD — — — —":
        - button "Drag BTC-USD"
        - text: BTC-USD — — — —
        - img
      - option "Drag ETH-USD Flag this symbol ETH-USD — — — —":
        - button "Drag ETH-USD"
        - text: ETH-USD — — — —
        - img
      - button "Equities 4" [expanded]
      - button "Drag section Equities"
      - button "Rename section":
        - img
      - button "Remove section":
        - img
      - option "Drag NVDA Flag this symbol NVDA — — — —":
        - button "Drag NVDA"
        - text: NVDA — — — —
        - img
      - option "Drag AAPL Flag this symbol AAPL — — — —":
        - button "Drag AAPL"
        - text: AAPL — — — —
        - img
      - option "Drag MSFT Flag this symbol MSFT — — — —":
        - button "Drag MSFT"
        - text: MSFT — — — —
        - img
      - option "Drag QQQ Flag this symbol QQQ — — — —":
        - button "Drag QQQ"
        - text: QQQ — — — —
        - img
  - text: MU MU
  - button "Open full analysis":
    - img
  - text: — —
  - button "Open Intelligence workspace": Intelligence Oracle — View details Research No current reading View details Prophet Checking early evidence… Oracle entry unverified · No current data
  - img
  - text: Deep analysis coming online This name isn't in the research desk yet — the chart, levels and oracle verdict above are live.
  - region "Seasonality view context":
    - group "Linking for this view":
      - button "Follow chart" [disabled]
      - button "Pin this view" [disabled]
      - button "Unlink" [disabled]
    - status: Context is unavailable.
    - paragraph: Linking applies to this session only.
  - button "Open full analysis"
  - button "Ask Mastermind AI about MU →"
- text: Movers
- alert
```

# Test source

```ts
  12  | test("a holding opens its exposure with a bounded sector origin and returns to the exact selection", async ({ page }) => {
  13  |   await prepare(page);
  14  |   const { href, origin } = await exposureHrefFor(page, "MU");
  15  |   expect(href).toMatch(/^\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  16  |   expect(origin).toMatchObject({ v: 1, kind: "sector", sector: "xlk", group: "semiconductors", company: "MU", index: 2, count: 14, sort: "source", query: "", asOf: "2026-09-23", contentHash: HASH_A, method: "incumbent_rs_63_21/v1", benchmark: "SPY" });
  17  |   expect(String(origin.returnHref)).toMatch(/^\/discover\?tab=sectors&/);
  18  |   expect(String(origin.returnHref)).toContain("sectorCompany=MU");
  19  |   await expect(page.getByTestId("sector-company-inspector").getByTestId("sector-open-exposure")).toHaveText(/Open options exposure/);
  20  |   await page.getByTestId("sector-company-inspector").getByTestId("sector-open-exposure").click();
  21  |   await expect(page).toHaveURL(/\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  22  |   await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  23  |   await expect(strip(page)).toContainText("From Sector Central");
  24  |   await expect(strip(page)).toContainText("Semiconductors");
  25  |   await expect(strip(page)).toContainText("3 of 14");
  26  |   await expect(strip(page)).toContainText("as of 2026-09-23");
  27  |   await expect(strip(page)).toContainText("relative to SPY");
  28  |   await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "MU");
  29  |   const back = strip(page).getByTestId("exposure-origin-back");
  30  |   expect(await back.getAttribute("href")).toBe(origin.returnHref);
  31  |   await back.click();
  32  |   await expect(page).toHaveURL(/\/discover\?tab=sectors&.*sectorCompany=MU/);
  33  |   const inspector = page.getByTestId("sector-company-inspector");
  34  |   await expect(inspector.getByRole("heading", { name: "MU", exact: true })).toBeVisible();
  35  |   await expect(page.locator('[data-company-choice="MU"]')).toBeFocused({ timeout: 15_000 });
  36  | });
  37  | 
  38  | test("a deep link survives reload and steps the same cohort through Back and Forward", async ({ page }) => {
  39  |   await prepare(page);
  40  |   const { href } = await exposureHrefFor(page, "MU");
  41  |   await page.goto(href);
  42  |   await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  43  |   await expect(strip(page)).toContainText("3 of 14");
  44  |   await page.reload();
  45  |   await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  46  |   await expect(strip(page)).toContainText("3 of 14");
  47  |   await expect(strip(page).getByTestId("exposure-origin-prev")).toHaveText(/MCHP/);
  48  |   await expect(strip(page).getByTestId("exposure-origin-next")).toHaveText(/NXPI/);
  49  |   await strip(page).getByTestId("exposure-origin-next").click();
  50  |   await expect(page).toHaveURL(/symbol=NXPI/);
  51  |   await expect(strip(page)).toContainText("4 of 14", { timeout: 30_000 });
  52  |   await expect(strip(page).getByTestId("exposure-origin-back")).toHaveAttribute("href", /sectorCompany=NXPI/);
  53  |   await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "NXPI");
  54  |   await page.goBack();
  55  |   await expect(page).toHaveURL(/symbol=MU/);
  56  |   await expect(strip(page)).toContainText("3 of 14", { timeout: 30_000 });
  57  |   await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "MU");
  58  |   await page.goForward();
  59  |   await expect(page).toHaveURL(/symbol=NXPI/);
  60  |   await expect(strip(page)).toContainText("4 of 14", { timeout: 30_000 });
  61  |   await strip(page).getByTestId("exposure-origin-prev").click();
  62  |   await expect(strip(page)).toContainText("3 of 14", { timeout: 30_000 });
  63  |   await expect(page).toHaveURL(/symbol=MU/);
  64  | });
  65  | 
  66  | test("a changed sector roster pauses stepping but keeps the way back", async ({ page }) => {
  67  |   let hash = HASH_A;
  68  |   await prepare(page, { hash: () => hash });
  69  |   const { href, origin } = await exposureHrefFor(page, "MU");
  70  |   hash = HASH_B;
  71  |   await page.goto(href);
  72  |   await expect(strip(page)).toHaveAttribute("data-state", "changed", { timeout: 30_000 });
  73  |   await expect(strip(page)).toContainText("The sector roster changed since you left.");
  74  |   await expect(strip(page).getByTestId("exposure-origin-prev")).toBeDisabled();
  75  |   await expect(strip(page).getByTestId("exposure-origin-next")).toBeDisabled();
  76  |   await expect(strip(page).getByTestId("exposure-origin-back")).toHaveAttribute("href", String(origin.returnHref));
  77  | });
  78  | 
  79  | test("an absent options source keeps the origin and the return address", async ({ page }) => {
  80  |   await prepare(page, { absent: ["ADI"] });
  81  |   const { href, origin } = await exposureHrefFor(page, "ADI");
  82  |   await page.goto(href);
  83  |   await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  84  |   await expect(strip(page)).toContainText("6 of 14");
  85  |   await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "ADI");
  86  |   await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-session", "");
  87  |   await expect(strip(page).getByTestId("exposure-origin-back")).toHaveAttribute("href", String(origin.returnHref));
  88  | });
  89  | 
  90  | test("an unsupported origin schema is ignored without touching the exposure view", async ({ page }) => {
  91  |   await prepare(page);
  92  |   const { href } = await exposureHrefFor(page, "MU");
  93  |   expect(href).toContain("%22v%22%3A1");
  94  |   await page.goto(href.replace("%22v%22%3A1", "%22v%22%3A2"));
  95  |   await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "MU", { timeout: 30_000 });
  96  |   await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  97  |   await expect(strip(page)).toHaveCount(0);
  98  | });
  99  | 
  100 | test("the main chart carries the origin and Return to Exposure brings it back", async ({ page }) => {
  101 |   await prepare(page);
  102 |   const { href, origin } = await exposureHrefFor(page, "MU");
  103 |   await page.goto(href);
  104 |   const map = page.getByTestId("exposure-map");
  105 |   await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  106 |   await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  107 |   await map.getByRole("button", { name: /Largest covered net node/ }).click();
  108 |   await page.getByTestId("exposure-node-inspector").getByRole("button", { name: "Open on main chart", exact: true }).click();
  109 |   await expect(page).toHaveURL(/\/terminal\?symbol=MU&origin=.*#exposure=/, { timeout: 30_000 });
  110 |   const reference = page.getByTestId("exposure-chart-reference");
  111 |   await expect(reference).toBeVisible({ timeout: 30_000 });
> 112 |   await expect(reference.getByTestId("exposure-reference-sector")).toHaveAttribute("href", String(origin.returnHref));
      |                                                                    ^ Error: expect(locator).toHaveAttribute(expected) failed
  113 |   const returnLink = reference.getByRole("link", { name: "Return to Exposure", exact: true });
  114 |   expect(await returnLink.getAttribute("href")).toMatch(/^\/options\?tab=prism&symbol=MU&view=chart&origin=.*#exposure=/);
  115 |   await returnLink.click();
  116 |   await expect(page).toHaveURL(/\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  117 |   await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  118 |   await expect(strip(page)).toContainText("3 of 14");
  119 | });
  120 | 
  121 | 
  122 | // Cross-feature composition: Sector-origin navigation must not carry an archived
  123 | // MU book into NXPI, while Back and a deliberate revisit must consume fresh
  124 | // corrected bytes for MU. This is a fixture-only non-merge integration proof.
  125 | for (const lang of ["en", "zh"] as const) {
  126 |   test(`archived Exposure replay and sector cohort navigation stay source-bound (${lang})`, async ({ page }) => {
  127 |     await prepare(page, { lang });
  128 |     const archivedDate = "2026-10-16";
  129 |     let archiveReads = 0;
  130 |     // Keep the existing Sector Central fixture and override only the dated MU
  131 |     // archive feeds. A source correction affects the same key on its second read.
  132 |     await page.route((url) => url.pathname === "/api/flow" &&
  133 |       new URL(url).searchParams.get("f") === "gex_dates:MU", route =>
  134 |         route.fulfill({ json: { root: "MU", latest: "2026-10-19", dates: ["2026-10-19", archivedDate] } }));
  135 |     await page.route((url) => url.pathname === "/api/flow" &&
  136 |       new URL(url).searchParams.get("f") === `gex_at:MU:${archivedDate}`, route => {
  137 |         archiveReads++;
  138 |         const strike = archiveReads === 1 ? 1070 : 1080;
  139 |         return route.fulfill({ json: {
  140 |           schema: "options_hub.gex/v1", root: "MU", asof: archivedDate,
  141 |           spot_ref: 1071.88, by_strike_full_n: 1,
  142 |           by_strike: [{ strike, gamma_net: 50, gamma_call: 60, gamma_put: -10 }],
  143 |           by_expiry: [{ exp: "2026-10-23", gamma_net: 50 }],
  144 |         } });
  145 |       });
  146 | 
  147 |     const { href } = await exposureHrefFor(page, "MU");
  148 |     await page.goto(href);
  149 |     const map = page.getByTestId("exposure-map");
  150 |     const origin = strip(page);
  151 |     await expect(origin).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  152 |     await expect(map).toHaveAttribute("data-source-root", "MU");
  153 |     // Use the same visible exact-values panel on desktop and phone. The
  154 |     // ranked-node inspector is intentionally a sheet on compact screens.
  155 |     await map.getByRole("button", { name: exposureMapT(lang)("exactValues"), exact: true }).click();
  156 |     const stored = map.getByTestId("exposure-stored-snapshots");
  157 |     await stored.locator("summary").click();
  158 |     const picker = stored.getByRole("combobox", { name: makeGexT(lang)("sessionPickerAria") });
  159 |     await expect(picker).toBeVisible();
  160 |     await picker.selectOption(archivedDate);
  161 |     await expect(map).toHaveAttribute("data-source-session", archivedDate, { timeout: 20_000 });
  162 |     await expect(map.locator('[class*="archiveNotice"]')).toContainText(archivedDate);
  163 |     // The visible node, not only the request counter, must be source-correct.
  164 |     await expect(map.getByRole("button", { name: "1070", exact: true })).toBeVisible();
  165 |     expect(archiveReads).toBe(1);
  166 | 
  167 |     await origin.getByTestId("exposure-origin-next").click();
  168 |     await expect(page).toHaveURL(/symbol=NXPI/);
  169 |     await expect(map).toHaveAttribute("data-source-root", "NXPI");
  170 |     await expect(map.locator('[class*="archiveNotice"]')).toHaveCount(0);
  171 |     await expect(origin).toHaveAttribute("data-state", "exact");
  172 |     await expect(origin.getByTestId("exposure-origin-back")).toHaveAttribute("href", /sectorCompany=NXPI/);
  173 | 
  174 |     await page.goBack();
  175 |     await expect(page).toHaveURL(/symbol=MU/);
  176 |     await expect(map).toHaveAttribute("data-source-root", "MU");
  177 |     await expect(map.locator('[class*="archiveNotice"]')).toHaveCount(0);
  178 |     await expect(origin).toHaveAttribute("data-state", "exact");
  179 |     if (await stored.getAttribute("open") === null) await stored.locator("summary").click();
  180 |     await picker.selectOption(archivedDate);
  181 |     await expect.poll(() => archiveReads, { timeout: 15_000 }).toBe(2);
  182 |     await expect(map).toHaveAttribute("data-source-session", archivedDate);
  183 |     await expect(map.getByRole("button", { name: "1080", exact: true })).toBeVisible();
  184 |     await expect(map.getByRole("button", { name: "1070", exact: true })).toHaveCount(0);
  185 |     await expect(origin.getByTestId("exposure-origin-back")).toHaveAttribute("href", /sectorCompany=MU/);
  186 |     await origin.getByTestId("exposure-origin-back").click();
  187 |     await expect(page).toHaveURL(/\/discover\?tab=sectors&.*sectorCompany=MU/);
  188 |   });
  189 | }
  190 | 
```