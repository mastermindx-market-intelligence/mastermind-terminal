import { expect, test, type Page } from "@playwright/test";

// A4 + A5 acceptance, measured on the real waterfall.
//
// A4 — the route canonicalized `?sym=` for its preload while TerminalShell carried the RAW query
// value into dataCache, which concatenated it into `/data/<sym>.json`. `?sym=nvda` therefore
// preloaded `/data/NVDA.json` and then fetched `/data/nvda.json`: the preload missed, and on a
// case-sensitive origin the second URL 404s.
//
// A5 — `criticalTerminalDataUrls(undefined)` is `[]`, so a plain `/terminal` visit — the most
// common entry into the flagship — emitted NO chart-data preload at all while the shell went
// straight on to fetch NVDA. #420 repaired preload REUSE; it only ever applied to deep links.
//
// Both are asserted here as network facts, not as source strings: the preload link tags the server
// emitted, and the count of real transfers per resource.

type Requested = { url: string; resourceType: string };

/** Record every request the page makes, so a duplicate transfer is countable. */
function recordRequests(page: Page): Requested[] {
  const seen: Requested[] = [];
  page.on("request", (request) => seen.push({ url: request.url(), resourceType: request.resourceType() }));
  return seen;
}

const dataRequests = (seen: Requested[], file: string) =>
  seen.filter((entry) => entry.url.includes(`/data/${file}`));

/** The `<link rel=preload>` hrefs the SERVER put in the document. */
const preloadHrefs = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="fetch"]')].map((link) => link.getAttribute("href") ?? ""));

async function paint(page: Page) {
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

/** Same pane probe `no-data-symbol.spec.ts` uses: the badge and the empty panel are toggled by
 *  `style.display`, so presence in the DOM proves nothing on its own. */
const paneState = (page: Page) => page.evaluate(() => {
  const tag = document.querySelector<HTMLElement>(".mm-ptag");
  const empty = document.querySelector<HTMLElement>(".chart-empty");
  return {
    tag: tag && tag.style.display !== "none" ? tag.textContent ?? "" : null,
    emptyShown: !!empty && empty.style.display !== "none",
    emptyMsg: document.querySelector(".chart-empty .ce-msg")?.textContent ?? "",
  };
});

test("A5: a cold /terminal boot preloads the OHLC + slice the first chart actually fetches", async ({ page }) => {
  test.setTimeout(120_000);
  const seen = recordRequests(page);
  await page.goto("/terminal");
  await paint(page);

  // The server named the landing symbol — the shell's own fallback — rather than nothing at all.
  const hrefs = await preloadHrefs(page);
  expect(hrefs).toContain("/data/NVDA.json");
  expect(hrefs).toContain("/data/NVDA.slice.json");

  // …and the chart is genuinely on that symbol, with real bars.
  expect((await paneState(page)).tag).toContain("NVDA");

  // ONE transfer per resource: the preload is reused, not duplicated. This is #420's property,
  // now proven on the entry path #420 never reached.
  await page.waitForTimeout(3_000);
  expect(dataRequests(seen, "NVDA.json")).toHaveLength(1);
  expect(dataRequests(seen, "NVDA.slice.json")).toHaveLength(1);
});

test("A5: the ?sym= deep link keeps #420's single-transfer behaviour", async ({ page }) => {
  test.setTimeout(120_000);
  const seen = recordRequests(page);
  await page.goto("/terminal?sym=AAPL");
  await paint(page);
  const hrefs = await preloadHrefs(page);
  expect(hrefs).toContain("/data/AAPL.json");
  expect(hrefs).toContain("/data/AAPL.slice.json");
  await page.waitForTimeout(3_000);
  expect(dataRequests(seen, "AAPL.json")).toHaveLength(1);
  expect(dataRequests(seen, "AAPL.slice.json")).toHaveLength(1);
});

test("A4: a lowercase deep link resolves to ONE canonical URL on both sides", async ({ page }) => {
  test.setTimeout(120_000);
  const seen = recordRequests(page);
  await page.goto("/terminal?sym=nvda");
  await paint(page);

  // The defect: preload /data/NVDA.json, fetch /data/nvda.json. Both sides must agree now.
  expect(await preloadHrefs(page)).toContain("/data/NVDA.json");
  await page.waitForTimeout(3_000);
  expect(seen.filter((entry) => entry.url.includes("/data/nvda"))).toHaveLength(0);
  expect(dataRequests(seen, "NVDA.json")).toHaveLength(1);
  expect(dataRequests(seen, "NVDA.slice.json")).toHaveLength(1);
  // Real bars, not the no-data state — the whole point of the two sides agreeing.
  const pane = await paneState(page);
  expect(pane.tag).toContain("NVDA");
  expect(pane.emptyShown).toBe(false);
});

test("A4: whitespace and mixed case canonicalize the same way", async ({ page }) => {
  test.setTimeout(120_000);
  const seen = recordRequests(page);
  await page.goto("/terminal?symbol=%20Aapl%20");
  await paint(page);
  expect(await preloadHrefs(page)).toContain("/data/AAPL.json");
  await page.waitForTimeout(3_000);
  expect(dataRequests(seen, "AAPL.json")).toHaveLength(1);
  expect(seen.filter((entry) => /\/data\/(%20|aapl|Aapl)/.test(entry.url))).toHaveLength(0);
});

test("A4: a path-like deep link issues no unintended data fetch", async ({ page }) => {
  test.setTimeout(120_000);
  const seen = recordRequests(page);
  await page.goto("/terminal?sym=..%2F..%2Fsecret");
  await paint(page);
  await page.waitForTimeout(3_000);

  // Nothing DERIVED from the malformed value ever became a URL — no traversal, no encoded
  // remnant, no `/data/secret`. The navigation itself carries the query, so it is excluded: it is
  // the input, not a request the app generated from it.
  const suspicious = seen.filter((entry) => entry.resourceType !== "document"
    && (entry.url.includes("secret") || entry.url.includes("/data/..") || entry.url.includes("%2F")));
  expect(suspicious).toHaveLength(0);
  // The workspace opens on the normal landing symbol instead of a fabricated one.
  expect(await preloadHrefs(page)).toContain("/data/NVDA.json");
});

test("A4: an unknown but well-formed symbol gets the honest empty state, not stale data", async ({ page }) => {
  test.setTimeout(120_000);
  // Synthetic on purpose (same reasoning as no-data-symbol.spec.ts): any real ticker could gain a
  // fixture later and turn this guard vacuous. Lowercase, so canonicalization is exercised too.
  await page.goto("/terminal?sym=nosuch.test");
  // The deep link IS honoured — it is a well-formed symbol, it simply has no history — so the pane
  // must say so rather than silently rendering the landing symbol's data under this ticker.
  await expect.poll(async () => (await paneState(page)).emptyShown, { timeout: 60_000 }).toBe(true);
  const pane = await paneState(page);
  expect(pane.emptyMsg).toContain("NOSUCH.TEST");
  expect(pane.tag).toBeNull();
});
