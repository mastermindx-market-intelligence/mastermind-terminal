import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { e2eWatchlistOwner, isolateWatchlistStore } from "./watchlistStore";
import { NEWS_VIEW } from "../lib/__tests__/fixtures/newsEditorial";
import { expectTapTarget } from "./tapTarget";

// Journey 6 (E5) — a corrected save. A review mark captures the story's exact evidence basis as
// seen (report key + revision markers + rights receipt) and never overwrites it. When the source
// later presents a newer revision / partial retraction / re-keyed report / new receipt, the rail
// annotates "updated since you saved" with the ORIGINAL basis visible and the current revision one
// action away through the existing ladder toggle. An out-of-order older copy is never an update.
// Over the real `/api/news/<SYM>` snapshot contract, in the real signed-in Terminal shell (fixture
// identity from `mm_e2e_wl`).
//
// Note on the classic review tag: `classifyStory` (frozen by this lane's spec) compares only the
// [sequence, item_count] pair, so an OLDER out-of-order row still reads "updated" there. Journey
// 6's out-of-order guarantee lives at the saved-basis layer: no annotation, basis untouched.

test.setTimeout(150_000);
// Story times render in the browser's zone; pin it so crops do not depend on the host.
test.use({ timezoneId: "America/New_York" });

const OUT = join(process.cwd(), "docs", "pr-crops", "news-corrected-save");
const CROPS = process.env.TERMINAL_CROPS === "1";
const REVIEW_KEY = "mm.newsReview.v1";
// The Terminal ships dark-only (D-W1; light is a specimen), so crops are dark.
const THEME = "dark";

const SYM_S = "ev2_nvda_basis";

const sym = (name: string, zh: string, last: number) => ({
  name, zh, col: "#76b900", last, chg: 1.2, open: last - 2, high: last + 2, low: last - 3, vol: 12000000,
  hi52: last + 20, lo52: last - 80, verdict: null, wr: null, pf: null, cagr: null, regimeBull: null,
  sec: "Equities", mkt: "NASDAQ",
});
const MANIFEST = { symbols: { NVDA: sym("NVIDIA", "英伟达", 175), AAPL: sym("Apple", "苹果", 220) } };

type NewsRow = {
  sequence: number; source: string; source_item_id: string; story_id: string; source_count: number;
  item_count: number; title: string; url: string; teaser: string; published_at: string;
  updated_at: string; received_at: string; universe_revision: string;
};

const story = (
  sequence: number, storyId: string, title: string, receivedAt: string,
  extra: Partial<NewsRow> = {},
): NewsRow => ({
  sequence,
  source: "benzinga",
  source_item_id: String(100 + sequence),
  story_id: storyId,
  source_count: 1,
  item_count: 1,
  title,
  url: `https://www.benzinga.com/news/${100 + sequence}`,
  teaser: "",
  published_at: receivedAt,
  updated_at: receivedAt,
  received_at: receivedAt,
  universe_revision: "sp500-r1",
  ...extra,
});

const RIGHTS_1 = {
  receipt_id: "rr_corr_0001", source: "benzinga", provider: "fixture-provider",
  effective_at: "2026-10-01T00:00:00Z", expires_at: "2027-10-01T00:00:00Z",
};
const RIGHTS_2 = { ...RIGHTS_1, receipt_id: "rr_corr_0002" };

const snapshotFor = (ticker: string, rows: NewsRow[], rights: typeof RIGHTS_1) => ({
  schema: "ticker_news.snapshot.v1",
  editorial_policy: "ticker_news.curated.v1",
  editorial_view: NEWS_VIEW,
  ticker,
  security_id: `SEC:US-XNAS-${ticker}`,
  rights_basis: rights,
  state: "live",
  rows: rows.map((row) => ({ ...row, editorial_view: NEWS_VIEW })),
  next_cursor: rows[rows.length - 1]?.sequence ?? null,
  has_more: false,
  source_health: { state: "live", last_successful_catchup: rows[0]?.received_at ?? null },
});

/** `ticker_news.story.v1` — the ladder detail `/api/news/stories/<id>` serves. */
const storyDetailFor = (members: NewsRow[]) => ({
  schema: "ticker_news.story.v1",
  story_id: SYM_S,
  source_count: new Set(members.map((member) => member.source)).size,
  item_count: members.length,
  members: members.map((row) => ({ ...row, editorial_view: NEWS_VIEW })),
  editorial_view: NEWS_VIEW,
});

const R1 = "2026-10-05T19:31:01+00:00";
const R2 = "2026-10-06T12:40:01+00:00";
const FILLER = story(4, "ev2_nvda_fill", "Nvidia fills remaining packaging capacity", "2026-10-05T18:50:01+00:00");

// First visit: the marked story S at sequence 5 / item_count 3 under receipt r1.
const FIRST = snapshotFor("NVDA", [
  story(5, SYM_S, "Nvidia wins multi-year supply agreement", R1,
    { item_count: 3, teaser: "The company signed a multi-year supply agreement for advanced packaging." }),
  FILLER,
], RIGHTS_1);

// The return: a partial retraction on a newer revision, under a new rights receipt.
const CORRECTED = snapshotFor("NVDA", [
  story(9, SYM_S, "Nvidia wins multi-year supply agreement (corrected)", R2,
    { item_count: 2, teaser: "Corrected: one of the three original reports was retracted by its outlet." }),
  FILLER,
], RIGHTS_2);

// An out-of-order older copy of the same story.
const OLDER = snapshotFor("NVDA", [
  story(3, SYM_S, "Nvidia wins multi-year supply agreement", "2026-10-05T17:20:01+00:00",
    { item_count: 3, teaser: "The company signed a multi-year supply agreement for advanced packaging." }),
  FILLER,
], RIGHTS_1);

const DETAIL = storyDetailFor([
  story(9, SYM_S, "Nvidia wins multi-year supply agreement (corrected)", R2),
  story(8, SYM_S, "Partner confirms the supply agreement", "2026-10-06T12:10:01+00:00",
    { source: "reuters", url: "https://www.reuters.com/technology/nvda-supply" }),
]);

type Feed = { nvda: ReturnType<typeof snapshotFor>; story: ReturnType<typeof storyDetailFor> };

async function installEventSourceStub(page: Page) {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    class QuietEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string = "";
      readonly withCredentials = false;
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(url: string | URL, options?: EventSourceInit) {
        const value = String(url);
        if (!value.includes("/api/news/stream")) {
          return new NativeEventSource(url, options) as unknown as QuietEventSource;
        }
        this.url = value;
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return true; }
      close() { this.readyState = QuietEventSource.CLOSED; }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, writable: true, value: QuietEventSource });
  });
}

/** Serves the feed from `feed`, so a test can change what the source returns between visits. */
async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, feed: Feed) {
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  await installEventSourceStub(page);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180.2, chg: 2.5 }, AAPL: { last: 221.1, chg: 0.9 } } },
  }));
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => route.fulfill({ json: feed.nvda }));
  await page.route(/\/api\/news\/AAPL(?:\?.*)?$/, (route) => route.fulfill({ json: FIRST }));
  await page.route(/\/api\/news\/stories\/[^/?]+/, (route) => route.fulfill({ json: feed.story }));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  return storeKey;
}

async function setPresentation(page: Page, lang: "en" | "zh") {
  await page.evaluate((l) => localStorage.setItem("mm.lang", l), lang);
  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), THEME);
  await expect(page.locator("html")).toHaveAttribute("data-theme", THEME);
}

async function openNews(page: Page, expectedState = "live") {
  const tab = page.locator("#rail-tab-news");
  await tab.scrollIntoViewIfNeeded();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  const panel = page.getByTestId("ticker-news-panel");
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel).toHaveAttribute("data-news-state", expectedState, { timeout: 20_000 });
  return panel;
}

const reviewOf = (panel: Locator, id: string) => panel.locator(`article[data-story-id="${id}"]`);
const storedReview = (page: Page) => page.evaluate((key) => localStorage.getItem(key), REVIEW_KEY);
const savedBasis = (page: Page, owner: string, id: string) => page.evaluate(
  ([key, ownerKey, storyId]) => {
    const envelope = JSON.parse(localStorage.getItem(key!) || "{}");
    return envelope[ownerKey!]?.NVDA?.basis?.[storyId!] ?? null;
  },
  [REVIEW_KEY, owner, id],
);

test("Run A — a corrected save keeps the original basis and opens the current revision", async ({ page, baseURL }, testInfo) => {
  const feed: Feed = { nvda: FIRST, story: DETAIL };
  const storeKey = await prepare(page, testInfo, baseURL, feed);
  const owner = e2eWatchlistOwner(storeKey);
  await setPresentation(page, "en");

  // ── Mark S reviewed: the mark captures its exact evidence basis as seen.
  let panel = await openNews(page);
  if (CROPS) {
    // Journey step "encounter/inspect": the row before any mark exists. Wipe only this
    // project's stale `a-` crops — a whole-dir rm here would delete the before-save crops
    // taken below (and race the sibling project/test writing its own).
    mkdirSync(OUT, { recursive: true });
    for (const name of readdirSync(OUT)) {
      if (name.startsWith(`${testInfo.project.name}-a-`) && name.endsWith(".png")) rmSync(join(OUT, name));
    }
    for (const lang of ["en", "zh"] as const) {
      await setPresentation(page, lang);
      panel = await openNews(page);
      await page.mouse.move(0, 0);
      await panel.screenshot({
        path: join(OUT, `${testInfo.project.name}-a-before-save-${lang}-${THEME}.png`),
        animations: "disabled",
      });
    }
    // The assertions below read EN copy; return the presentation to EN before the mark.
    await setPresentation(page, "en");
    panel = await openNews(page);
  }
  await reviewOf(panel, SYM_S).locator("[data-news-mark-one]").click();
  const basis = await savedBasis(page, owner, SYM_S);
  expect(basis).toEqual({
    report_key: "benzinga:105",
    sequence: 5,
    item_count: 3,
    view_revision: NEWS_VIEW.revision,
    rights: RIGHTS_1,
    at: R1,
  });
  await test.step("proof read: basis after first mark", async () => {
    console.log(`[proof] runA ${testInfo.project.name} basis.afterMark=${JSON.stringify(basis)}`);
  });
  // Only references were kept: no headline, teaser or URL reaches storage.
  expect(await storedReview(page)).not.toContain("supply agreement");
  expect(await storedReview(page)).not.toContain("benzinga.com");
  // The presentation still matches the saved basis, so nothing is annotated yet.
  await expect(panel.locator("[data-news-saved-basis]")).toHaveCount(0);

  // ── The source partially retracts on a newer revision, under a new rights receipt.
  feed.nvda = CORRECTED;
  await page.reload();
  panel = await openNews(page);
  const note = reviewOf(panel, SYM_S).locator("[data-news-saved-basis]");
  await expect(note).toBeVisible({ timeout: 20_000 });
  await expect(note).toContainText("Updated since you saved");
  // The ORIGINAL basis values stay visible — never the current ones on that line.
  await expect(note).toContainText("revision 5");
  await expect(note).toContainText("3 reports");
  await expect(note).toContainText("rr_corr_0001".slice(-6));
  await expect(reviewOf(panel, SYM_S).locator("[data-news-change]")).toHaveText("Revised since your review");
  if (testInfo.project.name !== "desktop") {
    // Tablet (820px) and phone sit under the 860px touch breakpoint.
    await expectTapTarget(reviewOf(panel, SYM_S).locator("[data-news-open-current]"), { height: 44 });
  }

  // ── The current revision is one action away, through the EXISTING ladder toggle.
  await test.step("proof read: annotation after correction", async () => {
    const basisAgain = await savedBasis(page, owner, SYM_S);
    console.log(`[proof] runA ${testInfo.project.name} basis.afterReopen=${JSON.stringify(basisAgain)}`);
    console.log(`[proof] runA ${testInfo.project.name} basis.deepEqual=${JSON.stringify(basisAgain) === JSON.stringify(basis)}`);
    console.log(`[proof] runA ${testInfo.project.name} note.en=${JSON.stringify(await note.textContent())}`);
    console.log(`[proof] runA ${testInfo.project.name} openCurrent.aria.en=${JSON.stringify(await reviewOf(panel, SYM_S).locator("[data-news-open-current]").getAttribute("aria-label"))}`);
  });
  const storyRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/news/stories/")) storyRequests.push(request.url());
  });
  await reviewOf(panel, SYM_S).locator("[data-news-open-current]").click();
  await expect(reviewOf(panel, SYM_S).locator("[data-news-ladder]")).toHaveAttribute("aria-expanded", "true", { timeout: 20_000 });
  await expect(reviewOf(panel, SYM_S).locator('[role="group"][aria-label="2 reports"]')).toBeVisible();
  await test.step("proof read: ladder request url", async () => {
    console.log(`[proof] runA ${testInfo.project.name} ladder.requests=${JSON.stringify(storyRequests)}`);
  });

  // ── Opening the current revision wrote nothing: the first capture stands.
  expect(await savedBasis(page, owner, SYM_S)).toEqual(basis);

  if (CROPS) {
    mkdirSync(OUT, { recursive: true });
    for (const lang of ["en", "zh"] as const) {
      await setPresentation(page, lang);
      panel = await openNews(page);
      const langNote = reviewOf(panel, SYM_S).locator("[data-news-saved-basis]");
      await expect(langNote).toBeVisible({ timeout: 20_000 });
      await test.step("proof read: annotation per lang", async () => {
        console.log(`[proof] runA ${testInfo.project.name} note.${lang}=${JSON.stringify(await langNote.textContent())}`);
        console.log(`[proof] runA ${testInfo.project.name} openCurrent.aria.${lang}=${JSON.stringify(await reviewOf(panel, SYM_S).locator("[data-news-open-current]").getAttribute("aria-label"))}`);
      });
      await page.mouse.move(0, 0);
      await panel.screenshot({
        path: join(OUT, `${testInfo.project.name}-a-annotated-${lang}-${THEME}.png`),
        animations: "disabled",
      });
    }
  }
});

test("Run B — an out-of-order older presentation is never an update", async ({ page, baseURL }, testInfo) => {
  const feed: Feed = { nvda: FIRST, story: DETAIL };
  const storeKey = await prepare(page, testInfo, baseURL, feed);
  const owner = e2eWatchlistOwner(storeKey);
  await setPresentation(page, "en");

  const panel = await openNews(page);
  await reviewOf(panel, SYM_S).locator("[data-news-mark-one]").click();
  const basis = await savedBasis(page, owner, SYM_S);
  expect(basis?.sequence).toBe(5);

  // ── The feed serves an OLDER copy of the same story: no annotation, basis untouched.
  feed.nvda = OLDER;
  await page.reload();
  const reloaded = await openNews(page);
  await expect(reviewOf(reloaded, SYM_S)).toBeVisible({ timeout: 20_000 });
  await expect(reloaded.locator("[data-news-saved-basis]")).toHaveCount(0);
  expect(await savedBasis(page, owner, SYM_S)).toEqual(basis);
  await test.step("proof read: out-of-order presentation", async () => {
    const basisAgain = await savedBasis(page, owner, SYM_S);
    console.log(`[proof] runB ${testInfo.project.name} basis.afterReopen=${JSON.stringify(basisAgain)}`);
    console.log(`[proof] runB ${testInfo.project.name} basis.deepEqual=${JSON.stringify(basisAgain) === JSON.stringify(basis)}`);
    console.log(`[proof] runB ${testInfo.project.name} savedBasis.count=${await reloaded.locator("[data-news-saved-basis]").count()}`);
    // The classic pair tag is frozen by this spec's header note: it compares only
    // [sequence, item_count], so the older copy still reads "updated" THERE. Record what
    // the DOM shows — the Journey 6 guarantee is the saved-basis layer above.
    const classicChange = reviewOf(reloaded, SYM_S).locator("[data-news-change]");
    const classicCount = await classicChange.count();
    console.log(`[proof] runB ${testInfo.project.name} classicChange.count=${classicCount} text=${JSON.stringify(classicCount ? await classicChange.first().textContent() : null)}`);
  });

  if (CROPS) {
    mkdirSync(OUT, { recursive: true });
    for (const lang of ["en", "zh"] as const) {
      await setPresentation(page, lang);
      const langPanel = await openNews(page);
      await expect(reviewOf(langPanel, SYM_S)).toBeVisible({ timeout: 20_000 });
      await expect(langPanel.locator("[data-news-saved-basis]")).toHaveCount(0);
      expect(await savedBasis(page, owner, SYM_S)).toEqual(basis);
      await page.mouse.move(0, 0);
      await langPanel.screenshot({
        path: join(OUT, `${testInfo.project.name}-b-out-of-order-${lang}-${THEME}.png`),
        animations: "disabled",
      });
    }
  }
});
