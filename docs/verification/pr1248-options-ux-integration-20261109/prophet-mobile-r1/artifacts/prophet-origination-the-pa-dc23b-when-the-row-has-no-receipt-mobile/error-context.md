# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: prophet-origination.spec.ts >> the panel's disclosure shows the clause alone when the row has no receipt
- Location: e2e/prophet-origination.spec.ts:438:5

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('.obs-prophet-signal').filter({ hasText: 'PLTR' }).first()
    - locator resolved to <div role="option" aria-selected="false" class="obs-card obs-prophet-signal">…</div>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <header class="SelectionCohortCard-module__QmWQaq__head">…</header> from <section data-state="unavailable" data-testid="selection-cohort-card" aria-labelledby="selection-cohort-title" class="obs-card SelectionCohortCard-module__QmWQaq__card SelectionCohortCard-module__QmWQaq__inFlowCard">…</section> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <header class="SelectionCohortCard-module__QmWQaq__head">…</header> from <section data-state="unavailable" data-testid="selection-cohort-card" aria-labelledby="selection-cohort-title" class="obs-card SelectionCohortCard-module__QmWQaq__card SelectionCohortCard-module__QmWQaq__inFlowCard">…</section> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    113 × waiting for element to be visible, enabled and stable
        - element is visible, enabled and stable
        - scrolling into view if needed
        - done scrolling
        - <header class="SelectionCohortCard-module__QmWQaq__head">…</header> from <section data-state="unavailable" data-testid="selection-cohort-card" aria-labelledby="selection-cohort-title" class="obs-card SelectionCohortCard-module__QmWQaq__card SelectionCohortCard-module__QmWQaq__inFlowCard">…</section> subtree intercepts pointer events
      - retrying click action
        - waiting 500ms

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
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
      - generic [ref=e15]:
        - generic [ref=e16] [cursor=pointer]:
          - img [ref=e17]
          - strong [ref=e23]: Prophet
          - img [ref=e24]
          - combobox "Switch Options view" [ref=e26]:
            - option "Flow Desk"
            - option "Options Tape"
            - option "Tide"
            - option "0DTE"
            - option "Largest Events"
            - option "Surface"
            - option "Options Screener"
            - option "Tickers"
            - option "Exposure"
            - option "Positioning"
            - option "Levels"
            - option "Structure"
            - option "Volatility"
            - option "Statistics"
            - option "Prophet" [selected]
        - generic [ref=e27]:
          - link "Futures depth & footprint" [ref=e28] [cursor=pointer]:
            - /url: /options/futures
            - text: Futures
          - button "Open the four-step options workflow · 1/4 viewed" [ref=e29] [cursor=pointer]:
            - img [ref=e30]
            - generic [ref=e33]: 1/4 viewed
      - tabpanel "Prophet" [ref=e34]:
        - generic [ref=e35]:
          - 'generic "Market volatility regime: Mixed — normalizing" [ref=e37]':
            - generic [ref=e39]: Vol
            - text: Mixed — normalizing
          - generic [ref=e42]:
            - tablist "Prophet signal lanes" [ref=e43]:
              - tab "Macro Plans" [selected] [ref=e44] [cursor=pointer]:
                - generic [ref=e45]: Macro Plans
              - tab "Options Alpha" [ref=e46] [cursor=pointer]:
                - generic [ref=e47]: Options Alpha
              - tab "Issue Desk" [ref=e48] [cursor=pointer]:
                - generic [ref=e49]: Issue Desk
            - tabpanel "Macro Plans" [ref=e50]:
              - generic [ref=e51]:
                - generic [ref=e52]:
                  - generic [ref=e54]: ✦
                  - generic [ref=e55]:
                    - generic [ref=e56]: Signal desk · nightly EOD
                    - generic [ref=e57]:
                      - heading "Prophet" [level=2] [ref=e58]
                      - generic [ref=e59]: Mastermind factor engine
                  - generic [ref=e60]:
                    - generic [ref=e61]:
                      - generic [ref=e62]: Active plans
                      - generic [ref=e63]: "3"
                    - generic [ref=e64]:
                      - generic [ref=e65]: In focus
                      - generic [ref=e66]: UBER
                    - generic [ref=e67]:
                      - generic [ref=e68]: Model close
                      - generic [ref=e69]: Aug 10
                    - generic [ref=e70]:
                      - generic [ref=e71]:
                        - generic [ref=e72]: Data through
                        - generic [ref=e73]: —
                      - status [ref=e74]: Source date unknown
                    - generic [ref=e75]:
                      - generic [ref=e76]: Option marks
                      - generic [ref=e77]: Live
                - generic [ref=e79]:
                  - generic [ref=e80]:
                    - generic [ref=e81]:
                      - navigation [ref=e82]:
                        - button "Signals" [ref=e83] [cursor=pointer]
                        - button "PERF" [ref=e84] [cursor=pointer]
                      - generic [ref=e85]: nightly EOD — updates after close
                    - generic [ref=e86]:
                      - button "NEW" [ref=e87] [cursor=pointer]
                      - button "BEST" [ref=e88] [cursor=pointer]
                      - button "GAINERS" [ref=e89] [cursor=pointer]
                    - listbox "Signal Stream" [ref=e90]:
                      - option "UBER ▲ BULL Recovery Triggered Entry $74.43 92d active +4.9%vs plan 31% → T1 92d / 10d min hold ELIGIBLE Reconstructed after an outage" [selected] [ref=e91] [cursor=pointer]:
                        - generic [ref=e92]:
                          - generic [ref=e93]: UBER
                          - generic [ref=e94]: ▲ BULL
                          - generic [ref=e95]: Recovery
                          - generic [ref=e96]: Triggered
                        - generic [ref=e97]:
                          - generic [ref=e98]:
                            - generic [ref=e99]: Entry
                            - generic [ref=e100]: $74.43
                          - generic [ref=e102]: 92d active
                          - generic [ref=e103]: +4.9%vs plan
                        - generic [ref=e106]: 31% → T1
                        - generic [ref=e110]:
                          - generic [ref=e111]: 92d / 10d min hold
                          - generic [ref=e112]: ELIGIBLE
                        - generic [ref=e116]: Reconstructed after an outage
                      - option "PLTR ▲ BULL Breakout Pre-Trigger Entry $61.20 92d active +2.0%vs plan 14% → T1 92d / 10d min hold ELIGIBLE Reconstructed after an outage" [ref=e117] [cursor=pointer]:
                        - generic [ref=e118]:
                          - generic [ref=e119]: PLTR
                          - generic [ref=e120]: ▲ BULL
                          - generic [ref=e121]: Breakout
                          - generic [ref=e122]: Pre-Trigger
                        - generic [ref=e123]:
                          - generic [ref=e124]:
                            - generic [ref=e125]: Entry
                            - generic [ref=e126]: $61.20
                          - generic [ref=e128]: 92d active
                          - generic [ref=e129]: +2.0%vs plan
                        - generic [ref=e132]: 14% → T1
                        - generic [ref=e136]:
                          - generic [ref=e137]: 92d / 10d min hold
                          - generic [ref=e138]: ELIGIBLE
                        - generic [ref=e142]: Reconstructed after an outage
                      - option "NVDA ▲ BULL Resumption Pre-Trigger Entry $182.40 94d active +1.9%vs plan 16% → T1 94d / 10d min hold ELIGIBLE" [ref=e143] [cursor=pointer]:
                        - generic [ref=e144]:
                          - generic [ref=e145]: NVDA
                          - generic [ref=e146]: ▲ BULL
                          - generic [ref=e147]: Resumption
                          - generic [ref=e148]: Pre-Trigger
                        - generic [ref=e149]:
                          - generic [ref=e150]:
                            - generic [ref=e151]: Entry
                            - generic [ref=e152]: $182.40
                          - generic [ref=e154]: 94d active
                          - generic [ref=e155]: +1.9%vs plan
                        - generic [ref=e158]: 16% → T1
                        - generic [ref=e162]:
                          - generic [ref=e163]: 94d / 10d min hold
                          - generic [ref=e164]: ELIGIBLE
                  - generic [ref=e168]:
                    - generic [ref=e169]:
                      - generic [ref=e170]:
                        - generic [ref=e171]: UBER
                        - generic [ref=e172]: ▲ BULL
                        - generic [ref=e173]: Triggered
                      - generic [ref=e174]: Research view — performance history building
                    - generic [ref=e175]:
                      - generic [ref=e176]: Reconstructed after an outage
                      - generic [ref=e177]: 9 Aug 2026
                    - generic [ref=e178]:
                      - generic [ref=e179]:
                        - generic [ref=e180]: What To Do Now
                        - generic [ref=e181]: Phase-keyed action guide — display only
                      - list [ref=e182]:
                        - listitem [ref=e183]:
                          - generic [ref=e184]: "1"
                          - generic [ref=e185]: Hold the position — it is working and has not reached the first target.
                        - listitem [ref=e186]:
                          - generic [ref=e187]: "2"
                          - generic [ref=e188]: Leave the stop at $66.55; moving it up early is what turns a winner into a scratch.
                        - listitem [ref=e189]:
                          - generic [ref=e190]: "3"
                          - generic [ref=e191]: Do not add here. The next decision is at $86.25, not before.
                    - generic [ref=e193]:
                      - generic [ref=e194]:
                        - generic [ref=e195]: Trade Geometry
                        - generic [ref=e196]: R/R 0.47
                      - generic [ref=e205]:
                        - generic [ref=e206]:
                          - generic [ref=e207]: STOP
                          - generic [ref=e208]: $66.55
                        - generic [ref=e209]:
                          - generic [ref=e210]: ENTRY
                          - generic [ref=e211]: $74.43
                        - generic [ref=e212]:
                          - generic [ref=e213]: LAST
                          - generic [ref=e214]: $78.10
                        - generic [ref=e215]:
                          - generic [ref=e216]: T1
                          - generic [ref=e217]: $86.25
                        - generic [ref=e218]:
                          - generic [ref=e219]: T2
                          - generic [ref=e220]: $98.07
                      - generic [ref=e221]:
                        - generic [ref=e222]:
                          - generic [ref=e223]: STOP away
                          - generic [ref=e224]: 1.46R
                        - generic [ref=e225]:
                          - generic [ref=e226]: T1 away
                          - generic [ref=e227]: 0.69R
                        - generic [ref=e228]:
                          - generic [ref=e229]: horizon used
                          - generic [ref=e230]: 38%
                      - generic [ref=e231]: Plan levels on one price axis. R is the entry-to-stop distance.
                    - generic [ref=e232]:
                      - generic [ref=e233]:
                        - generic [ref=e234]: Profit Taking Plan
                        - generic [ref=e235]: Exit levels from engine geometry — display only
                      - generic [ref=e236]:
                        - generic [ref=e237]:
                          - generic [ref=e238]:
                            - generic [ref=e239]: $86.25
                            - generic [ref=e240]: T1
                            - generic [ref=e241]: Trim a third and move the stop to break-even.
                          - generic [ref=e242]: PENDING
                        - generic [ref=e243]:
                          - generic [ref=e244]:
                            - generic [ref=e245]: $98.07
                            - generic [ref=e246]: T2
                            - generic [ref=e247]: Trim another third; let the rest run to the horizon.
                          - generic [ref=e248]: PENDING
                    - generic [ref=e249]:
                      - generic [ref=e250]:
                        - generic [ref=e251]: Signal Thesis
                        - generic [ref=e252]: Built from the plan's published signal inputs
                      - paragraph [ref=e253]: Rideshare take-rate has stabilised for three quarters while insurance costs roll off the comparison base, and the group has been re-rating against a still-cautious sell-side.
                      - paragraph [ref=e254]:
                        - generic [ref=e255]: "Dealer positioning — context overlay:"
                        - text: Dealer positioning is light above the first target, so a move through it meets little resistance from hedging flow.
                    - paragraph [ref=e256]: The nightly run that would have made this pick didn't finish that weekend. It was rebuilt afterwards from the data as it stood on 9 Aug 2026, and its windows are timed from that date. Rebuilt picks are marked, and counted on their own in the record.
                    - button "Daily pivot evidence" [ref=e258] [cursor=pointer]:
                      - generic [ref=e259]: Daily pivot evidence
                      - generic [ref=e260]: +
                  - generic [ref=e262]:
                    - generic [ref=e263]: Confidence Index
                    - generic [ref=e265]:
                      - generic [ref=e266]:
                        - generic [ref=e267]: Management confidence — trade state, not a pick rank
                        - generic [ref=e268]: Triggered
                      - generic [ref=e269]:
                        - img "68 out of 92" [ref=e270]:
                          - img [ref=e271]
                          - generic [ref=e275]: "68"
                        - generic [ref=e276]:
                          - generic [ref=e277]: "Ceiling: 92"
                          - generic [ref=e278]: Uncertainty is honest; certainty is forbidden.
                        - generic [ref=e279]:
                          - text: "68"
                          - generic [ref=e280]: / 92
                      - generic [ref=e282]: "Recommended action: Hold"
                      - generic [ref=e283]:
                        - generic [ref=e285]:
                          - 'generic "Thesis validity: has the invalidation level been breached?" [ref=e286]': Validity
                          - generic [ref=e287]: "74"
                        - generic [ref=e291]:
                          - 'generic "Progress toward T1: how far along the trade path?" [ref=e292]': Progress
                          - generic [ref=e293]: "61"
                        - generic [ref=e297]:
                          - 'generic "Pace vs expected: is the trade moving at the expected rate?" [ref=e298]': Pace
                          - generic [ref=e299]: "55"
                        - generic [ref=e303]:
                          - 'generic "Price retention: is the trade holding its gains?" [ref=e304]': Retention
                          - generic [ref=e305]: "70"
                        - generic [ref=e309]:
                          - 'generic "Market overlay: macro/sector alignment with this trade." [ref=e310]': Overlay
                          - generic [ref=e311]: "62"
                    - generic [ref=e314]:
                      - generic [ref=e315]: R/R at Entry
                      - generic [ref=e316]: "1.50"
                      - generic [ref=e317]: "Risk: $7.88"
                      - generic [ref=e318]: "Reward (T1): $11.82"
                - region "Shared themes · latest U.S. picks" [ref=e319]:
                  - generic [ref=e320]:
                    - heading "Shared themes · latest U.S. picks" [level=3] [ref=e321]
                    - generic [ref=e322]: context only — not a signal
                  - paragraph [ref=e323]: Theme context isn't available for these picks right now.
                  - paragraph [ref=e324]: It hasn't been published yet — it's built after the nightly U.S. run.
          - generic [ref=e325]: Notability and direction labels are heuristic and approximate (~). Display only — not investment advice.
  - alert [ref=e326]
```

# Test source

```ts
  57  | }
  58  | 
  59  | /** The CENTER column — the detail panel for whichever plan is selected. */
  60  | function panel(page: Page): Locator {
  61  |   return page.locator(".obs-prophet-analysis");
  62  | }
  63  | 
  64  | /**
  65  |  * A colour-token guard has to compare like with like.
  66  |  *
  67  |  * `getComputedStyle(el).color` is always a resolved `rgb(…)`, while
  68  |  * `getPropertyValue("--down")` hands back whatever the stylesheet literally wrote —
  69  |  * here a hex (globals.css:15,22). `"rgb(239, 68, 68)" !== "#ef4444"` is true for every
  70  |  * element on the page, so the earlier version of this guard could not fail even on an
  71  |  * element literally coloured `var(--down)`. It passed for two revisions saying nothing.
  72  |  *
  73  |  * Resolving the token through a throwaway element inside the SAME SUBTREE fixes both
  74  |  * halves: the comparison is rgb-to-rgb, and the value is whatever that subtree's theme
  75  |  * currently resolves to — so the east-flip (`html[data-updown="east"]`, which swaps
  76  |  * --up/--down at globals.css:117,124) is honoured instead of hard-coded.
  77  |  */
  78  | async function directionalInks(scope: Locator): Promise<{ up: string; down: string; warn: string }> {
  79  |   return scope.evaluate((el) => {
  80  |     const probe = document.createElement("span");
  81  |     probe.style.display = "none";
  82  |     el.appendChild(probe);
  83  |     const resolve = (token: string) => {
  84  |       probe.style.color = `var(${token})`;
  85  |       return getComputedStyle(probe).color;
  86  |     };
  87  |     const inks = { up: resolve("--up"), down: resolve("--down"), warn: resolve("--warn") };
  88  |     probe.remove();
  89  |     return inks;
  90  |   });
  91  | }
  92  | 
  93  | /** Fails with a readable message instead of a TypeError when the box is missing. */
  94  | async function boxOf(locator: Locator, what: string) {
  95  |   const box = await locator.boundingBox();
  96  |   expect(box, `${what} has no bounding box — it is not laid out`).not.toBeNull();
  97  |   return box!;
  98  | }
  99  | 
  100 | /**
  101 |  * The RENDERED colour of one pixel, decoded from a 1×1 screenshot.
  102 |  *
  103 |  * Contrast has to be measured against what the eye receives, and the eye receives
  104 |  * composited pixels. Walking `getComputedStyle().backgroundColor` up the tree cannot
  105 |  * see this panel's backdrop at all: every layer here is a `linear-gradient` /
  106 |  * `radial-gradient`, which lives in `background-image` and reports `backgroundColor:
  107 |  * rgba(0,0,0,0)`. A DOM-composited estimate therefore reads the near-black page canvas
  108 |  * (#0a0b0e) and scores everything ~8% too generously — enough to let a token that
  109 |  * genuinely fails AA pass the guard, which is how the first version of this check
  110 |  * survived a deliberate mutation.
  111 |  *
  112 |  * Decoding is `node:zlib` only — no image dependency. A 1×1 clip is one scanline of
  113 |  * one pixel, so every PNG filter type degrades to "no predictor" (the Sub/Paeth left
  114 |  * neighbour and the Up/Average upper neighbour are all outside the image, i.e. zero).
  115 |  */
  116 | function decodeSinglePixel(png: Buffer): [number, number, number] {
  117 |   let pos = 8; // skip the PNG signature
  118 |   let bitDepth = 8, colorType = 6;
  119 |   const idat: Buffer[] = [];
  120 |   while (pos < png.length) {
  121 |     const len = png.readUInt32BE(pos);
  122 |     const type = png.toString("ascii", pos + 4, pos + 8);
  123 |     const data = png.subarray(pos + 8, pos + 8 + len);
  124 |     if (type === "IHDR") { bitDepth = data[8]; colorType = data[9]; }
  125 |     else if (type === "IDAT") idat.push(data);
  126 |     else if (type === "IEND") break;
  127 |     pos += len + 12;
  128 |   }
  129 |   expect(bitDepth, "unexpected PNG bit depth").toBe(8);
  130 |   const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  131 |   expect(channels, `unexpected PNG colour type ${colorType}`).toBeGreaterThan(0);
  132 |   // eslint-disable-next-line @typescript-eslint/no-require-imports
  133 |   const raw = (require("node:zlib") as typeof import("node:zlib")).inflateSync(Buffer.concat(idat));
  134 |   // byte 0 of the scanline is the filter type; with one pixel every predictor is 0.
  135 |   return [raw[1], raw[2], raw[3]];
  136 | }
  137 | 
  138 | async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  139 |   const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  140 |   return decodeSinglePixel(shot);
  141 | }
  142 | 
  143 | function contrastRatio(fg: number[], bg: number[]): number {
  144 |   const lum = (c: number[]) => {
  145 |     const a = c.slice(0, 3).map((v) => {
  146 |       const s = v / 255;
  147 |       return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  148 |     });
  149 |     return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  150 |   };
  151 |   const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  152 |   return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  153 | }
  154 | 
  155 | /** Select a plan and wait for the panel to actually be showing it. */
  156 | async function openPlan(page: Page, asset: string): Promise<void> {
> 157 |   await card(page, asset).click();
      |                           ^ Error: locator.click: Test timeout of 60000ms exceeded.
  158 |   await expect(panel(page).getByText(asset, { exact: true }).first()).toBeVisible();
  159 | }
  160 | 
  161 | async function openProphet(page: Page, lang: "en" | "zh"): Promise<void> {
  162 |   // Predicate rather than a glob: the `?` in `/api/flow?f=…` is ambiguous in URL globs.
  163 |   await page.route(
  164 |     (url) => url.pathname === "/api/flow" && url.searchParams.get("f") === "prophet_idx",
  165 |     async (route) => { await route.fulfill({ json: fixture }); },
  166 |   );
  167 |   await page.goto("/options?tab=prophet");
  168 |   await expect(card(page, "UBER")).toBeVisible({ timeout: 20_000 });
  169 |   if (lang === "zh") {
  170 |     // The house switch: LangProvider re-reads the attribute on every `mm:lang`.
  171 |     await page.evaluate(() => {
  172 |       window.localStorage.setItem("mm.lang", "zh");
  173 |       document.documentElement.setAttribute("data-lang", "zh");
  174 |       window.dispatchEvent(new CustomEvent("mm:lang"));
  175 |     });
  176 |   }
  177 | }
  178 | 
  179 | for (const lang of ["en", "zh"] as const) {
  180 |   test(`Prophet marks a reconstructed plan with the row's own ${lang} disclosure`, async ({ page }, testInfo) => {
  181 |     test.setTimeout(60_000);
  182 |     await openProphet(page, lang);
  183 | 
  184 |     const rebuilt = planFor("UBER");
  185 |     const note = rebuilt.origination_note!;
  186 |     const chipCopy = lang === "zh" ? note.zh : note.en;
  187 |     const tipCopy = (lang === "zh" ? note.tip_zh : note.tip_en)!;
  188 | 
  189 |     const rebuiltCard = card(page, "UBER");
  190 |     const chip = rebuiltCard.locator(".obs-tag", { hasText: chipCopy });
  191 |     await expect(chip).toHaveCount(1);
  192 |     await expect(chip).toBeVisible();
  193 | 
  194 |     // The control: a live plan is untouched. Absence is the whole safety property.
  195 |     const liveCard = card(page, "NVDA");
  196 |     await expect(liveCard).toBeVisible();
  197 |     await expect(liveCard.locator(".obs-tag", { hasText: chipCopy })).toHaveCount(0);
  198 | 
  199 |     // The internal name of the event never reaches a reader, in either tier.
  200 |     await expect(page.locator("body")).not.toContainText("outage_backfill");
  201 | 
  202 |     // SUBORDINATE, MEASURED. The chip must read quieter than the direction badge it
  203 |     // sits under — smaller and lighter, and wearing the neutral token rather than a
  204 |     // directional or warning one. "Quiet" is a claim; these are the numbers behind it.
  205 |     const tone = await chip.evaluate((el) => {
  206 |       const cs = getComputedStyle(el);
  207 |       return { fontSize: parseFloat(cs.fontSize), fontWeight: Number(cs.fontWeight), color: cs.color };
  208 |     });
  209 |     const badge = await rebuiltCard.locator(".obs-tag").first().evaluate((el) => ({
  210 |       fontSize: parseFloat(getComputedStyle(el).fontSize),
  211 |       fontWeight: Number(getComputedStyle(el).fontWeight),
  212 |     }));
  213 |     const inks = await directionalInks(rebuiltCard);
  214 |     expect(tone.fontSize).toBeLessThan(badge.fontSize);
  215 |     expect(tone.fontWeight).toBeLessThan(badge.fontWeight);
  216 |     expect(tone.color).not.toBe(inks.down);
  217 |     expect(tone.color).not.toBe(inks.warn);
  218 |     // The guard can actually fire: the resolver returns the same shape it compares.
  219 |     expect(inks.down).toMatch(/^rgba?\(/);
  220 | 
  221 |     // Tier 2 — the receipt, through the house tooltip primitive.
  222 |     await chip.hover();
  223 |     const tip = page.locator('[role="tooltip"]');
  224 |     await expect(tip).toContainText(tipCopy, { timeout: 5_000 });
  225 | 
  226 |     if (EVIDENCE) {
  227 |       // The chip is captured at every viewport (the house 3-viewport rule); the
  228 |       // receipt and the two control cases are the same pixels at every width, so
  229 |       // desktop carries them once rather than three near-identical times.
  230 |       const stem = `${testInfo.project.name}-${lang}`;
  231 |       const isDesktop = testInfo.project.name === "desktop";
  232 |       if (isDesktop) {
  233 |         const cardBox = await rebuiltCard.boundingBox();
  234 |         const tipBox = await tip.boundingBox();
  235 |         if (cardBox && tipBox) {
  236 |           const left = Math.max(0, Math.min(cardBox.x, tipBox.x) - 12);
  237 |           const top = Math.max(0, Math.min(cardBox.y, tipBox.y) - 12);
  238 |           const right = Math.max(cardBox.x + cardBox.width, tipBox.x + tipBox.width) + 12;
  239 |           const bottom = Math.max(cardBox.y + cardBox.height, tipBox.y + tipBox.height) + 12;
  240 |           await page.screenshot({
  241 |             path: path.join(CROP_DIR, `${stem}-receipt.png`),
  242 |             clip: { x: left, y: top, width: right - left, height: bottom - top },
  243 |           });
  244 |         }
  245 |       }
  246 |       await page.mouse.move(0, 0);
  247 |       await expect(tip).toHaveCount(0);
  248 |       await rebuiltCard.screenshot({ path: path.join(CROP_DIR, `${stem}-chip.png`) });
  249 |       if (isDesktop) {
  250 |         await liveCard.screenshot({ path: path.join(CROP_DIR, `${stem}-control-live-plan.png`) });
  251 |         await card(page, "PLTR").screenshot({ path: path.join(CROP_DIR, `${stem}-no-receipt.png`) });
  252 |       }
  253 |     }
  254 |   });
  255 | }
  256 | 
  257 | // ── The detail panel ──────────────────────────────────────────────────────────
```