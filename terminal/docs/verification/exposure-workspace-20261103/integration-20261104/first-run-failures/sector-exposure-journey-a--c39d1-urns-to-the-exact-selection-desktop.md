# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sector-exposure-journey.spec.ts >> a holding opens its exposure with a bounded sector origin and returns to the exact selection
- Location: e2e/sector-exposure-journey.spec.ts:12:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/options\?tab=prism&symbol=MU&view=chart&origin=/
Received string:  "http://127.0.0.1:3641/discover?tab=sectors&sector=xlk&group=semiconductors&sectorWorkspace=detail&sectorDiscoverySort=source&sectorCompanyTableSort=source&sectorDiscoveryMode=summary&sectorMatrixTimeframe=1D&sectorRotationMode=map&sectorView=intelligence&sectorTheme=dark&sectorCompany=MU&sectorSort=source"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    14 × unexpected value "http://127.0.0.1:3641/discover?tab=sectors&sector=xlk&group=semiconductors&sectorWorkspace=detail&sectorDiscoverySort=source&sectorCompanyTableSort=source&sectorDiscoveryMode=summary&sectorMatrixTimeframe=1D&sectorRotationMode=map&sectorView=intelligence&sectorTheme=dark&sectorCompany=MU&sectorSort=source"

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
  - text: MASTERMIND TERMINAL Discover
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
- tablist "Discover tabs":
  - tab "Stock Screener"
  - tab "Heatmap"
  - tab "Sector Central" [selected]
  - tab "Leaders"
  - tab "Leader Radar"
  - tab "RS · 30m Pivot"
- main:
  - paragraph: UNITED STATES · SECTOR CENTRAL
  - heading "Sector Central" [level=1]
  - paragraph: Leadership, timing and the companies behind it.
  - text: Sector
  - combobox "Sector":
    - option "Technology · XLK" [selected]
  - text: Source group
  - button "Browse company groups": Semiconductors ▾
  - button "Use light view"
  - button "Refresh"
  - navigation "Sector workspace views":
    - button "Rotation"
    - button "Discover"
    - button "Market breadth"
  - button "← Back to Rotation"
  - text: Selected-sector research · Technology
  - tablist "Sector intelligence views":
    - tab "Overview" [selected]
    - tab "Companies"
    - tab "Signals"
    - tab "Drivers"
    - tab "History"
  - button "Sources"
  - text: Research context Dated snapshot · 2026-09-23
  - status:
    - strong: Some sources are unavailable.
    - button "Review sources →"
  - tabpanel "Overview":
    - paragraph: Technology
    - heading "Leading, with mixed timing" [level=2]
    - paragraph: Entry timing is not confirmed here.
    - button "Explore companies →"
    - text: 21D relative-strength rank
    - strong: "#1"
    - text: "63D rank #3 Advancing participation"
    - strong: 58%
    - text: 46 advancing / 33 declining 1M sector heat
    - strong: +7.01%
    - text: Cap-weighted source field Top-five cap share
    - strong: —
    - text: Not connected
    - region "Compare the companies":
      - heading "Compare the companies" [level=2]
      - paragraph: Semiconductors · 20 trading days · versus the selected group
      - paragraph:
        - text: Covers 20 of 68 holdings · 71.4% of fund weight · top 3 = 22% of fund · holdings as of
        - time: 2026-10-15
      - button "Open company table →"
      - group "Compare the companies":
        - text: Ticker Versus group · pp 20D return
        - 'button "Select company: MPWR; Versus group -9.0pp; 20D return +3.9%"': MPWR -9.0 +3.9%
        - 'button "Select company: MCHP; Versus group -10.2pp; 20D return +2.8%"': MCHP -10.2 +2.8%
        - 'button "Select company: MU; Versus group +1.9pp; 20D return +14.9%" [pressed]': MU +1.9 +14.9%
        - 'button "Select company: NXPI; Versus group -7.7pp; 20D return +5.2%"': NXPI -7.7 +5.2%
        - 'button "Select company: TXN; Versus group -8.1pp; 20D return +4.8%"': TXN -8.1 +4.8%
        - 'button "Select company: ADI; Versus group -9.5pp; 20D return +3.4%"': ADI -9.5 +3.4%
      - text: 6 / 14 shown
      - button "Show all companies"
      - complementary "Selected company":
        - paragraph: Selected company
        - heading "MU" [level=3]
        - term: Company return
        - definition: +14.9%
        - term: Versus group
        - definition: +1.9pp
        - paragraph: Group snapshot · 2026-09-23
        - link "Open company research ↗":
          - /url: /analysis?symbol=MU&page=overview
        - link "Open options exposure →":
          - /url: /options?tab=prism&symbol=MU&view=chart&origin=%7B%22v%22%3A1%2C%22kind%22%3A%22sector%22%2C%22returnHref%22%3A%22%2Fdiscover%3Ftab%3Dsectors%26sectorWorkspace%3Ddetail%26sectorDiscoverySort%3Dsource%26sectorCompanyTableSort%3Dsource%26sectorDiscoveryMode%3Dsummary%26sectorMatrixTimeframe%3D1D%26sectorRotationMode%3Dmap%26sectorView%3Dintelligence%26sectorTheme%3Ddark%26sectorCompany%3DMU%26sector%3Dxlk%26group%3Dsemiconductors%26sectorSort%3Dsource%22%2C%22sector%22%3A%22xlk%22%2C%22group%22%3A%22semiconductors%22%2C%22company%22%3A%22MU%22%2C%22index%22%3A2%2C%22count%22%3A14%2C%22sort%22%3A%22source%22%2C%22query%22%3A%22%22%2C%22asOf%22%3A%222026-09-23%22%2C%22contentHash%22%3A%22sha256%3Aa1b2c3d4e5f60718%22%2C%22method%22%3A%22incumbent_rs_63_21%2Fv1%22%2C%22benchmark%22%3A%22SPY%22%7D
        - group: Signal details
      - group: Comparison details
    - region "Intraday relative moves":
      - heading "Intraday relative moves" [level=2]
      - paragraph: Observed interval between two benchmark source clocks, matched members only.
      - paragraph:
        - text: "Quote source:"
        - time: 2026-11-04T11:34:15.571Z
      - paragraph:
        - text: "Evaluated at:"
        - time: 2026-11-04T11:35:15.571Z
      - group:
        - text: ai_infra Observed interval
        - strong: +2.00%
        - text: Interval vs SPY
        - strong: +1.49%
        - text: Positive relative breadth
        - strong: +62.50%
        - text: Day
        - strong: −1.25%
      - group:
        - text: mag7 Observed interval
        - strong: −1.75%
        - text: Interval vs SPY
        - strong: −2.24%
        - text: Positive relative breadth
        - strong: +25.00%
        - text: Day
        - strong: +3.50%
      - group: ai_software Waiting for another observation.
      - group: clean_energy Comparable observations are unavailable.
      - paragraph: Observed by the data owner. Not a forecast, target or signal.
    - group: Read the evidence
  - text: Source signals are shown separately. This view does not create a buy signal or position size.
- alert
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { HASH_A, HASH_B, exposureHrefFor, originStrip as strip, prepareSectorJourney as prepare } from "./helpers/optionsR1Journey";
  3   | import { makeGexT } from "@/components/gexdesk/gexStrings";
  4   | import { exposureMapT } from "@/components/exposure-map/exposureMapStrings";
  5   | 
  6   | // Options R1 W1A — one continuous journey: Sector Central holding → Exposure → main
  7   | // chart → back to the exact holding. Synthetic sources; this exercises product
  8   | // behavior (origin envelope, stepping, return), not provider qualification.
  9   | test.setTimeout(120_000);
  10  | 
  11  | 
  12  | test("a holding opens its exposure with a bounded sector origin and returns to the exact selection", async ({ page }) => {
  13  |   await prepare(page);
  14  |   const { href, origin } = await exposureHrefFor(page, "MU");
  15  |   expect(href).toMatch(/^\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  16  |   expect(origin).toMatchObject({ v: 1, kind: "sector", sector: "xlk", group: "semiconductors", company: "MU", index: 2, count: 14, sort: "source", query: "", asOf: "2026-09-23", contentHash: HASH_A, method: "incumbent_rs_63_21/v1", benchmark: "SPY" });
  17  |   expect(String(origin.returnHref)).toMatch(/^\/discover\?tab=sectors&/);
  18  |   expect(String(origin.returnHref)).toContain("sectorCompany=MU");
  19  |   await expect(page.getByTestId("sector-company-inspector").getByTestId("sector-open-exposure")).toHaveText(/Open options exposure/);
  20  |   await page.getByTestId("sector-company-inspector").getByTestId("sector-open-exposure").click();
> 21  |   await expect(page).toHaveURL(/\/options\?tab=prism&symbol=MU&view=chart&origin=/);
      |                      ^ Error: expect(page).toHaveURL(expected) failed
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
  112 |   await expect(reference.getByTestId("exposure-reference-sector")).toHaveAttribute("href", String(origin.returnHref));
  113 |   const returnLink = reference.getByRole("link", { name: "Return to Exposure", exact: true });
  114 |   expect(await returnLink.getAttribute("href")).toMatch(/^\/options\?tab=prism&symbol=MU&view=chart&origin=.*#exposure=/);
  115 |   await returnLink.click();
  116 |   await expect(page).toHaveURL(/\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  117 |   await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  118 |   await expect(strip(page)).toContainText("3 of 14");
  119 | });
  120 | 
  121 | 
```