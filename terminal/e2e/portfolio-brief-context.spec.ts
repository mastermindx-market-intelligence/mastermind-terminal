import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";
import { fixtureUserId } from "../lib/watchlistsFixtureDb";
import { portfolioBookKey } from "../lib/portfolioSnapshot.server";
import { closeInspector } from "./portfolioWorkspaceHelpers";

/**
 * The Portfolio brief renders only for the canonical book the page is showing — native browser
 * proof.
 *
 * WHAT THIS PROVES: in a real browser, at the three contract viewports and in both registers,
 * a committed holding edit retires the previous brief and only a brief that names the NEW
 * canonical book may be presented. The panel's checking and unavailable states are observable,
 * and the deliberate retry goes through the page's own canonical reload.
 *
 * WHAT THIS DOES NOT PROVE: the macro producer's witness is NOT executed here. The producer is
 * not deployed on this host, so the desk endpoint is not reachable; the payload below is the
 * PROXY's own bound response shape, served from the browser so the panel's states are
 * deterministic. It is a fixture, and it is labelled as one. The witness decoder, the
 * compatibility gate and the canonical book key are source-verified in the unit suites
 * (lib/__tests__/portfolioBriefContext.test.ts), which exercise the real exported proxy.
 *
 * The HOLDINGS side is real: the position is written through the product's own route
 * (`POST /api/portfolio` → lib/portfolio.ts → the fixture transport), the edit goes through the
 * workspace's own record inspector and position modal, and the page re-reads the SAME store, so
 * the committed input change and the canonical reread are the real path.
 */

test.setTimeout(120_000);

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", zh: "英伟达", col: "#76b900", last: 175, chg: 1.2, currency: "USD" },
  },
};
const QUOTES = { quotes: { NVDA: { last: 180, chg: 2.5, currency: "USD" } } };

/**
 * The proxy's own bound response: the public brief PLUS the minimal validated context that
 * binds it to a canonical book. The context's book key is the fixture's, because the desk
 * cannot be reached here; the test keeps it equal to the page's real canonical key by
 * reading it back from the product's own route.
 */
const BRIEF = {
  schema: "portfolio_brief.v2",
  asof: "2026-11-02",
  generated_at: "2026-11-02T09:30:00+00:00",
  stale: false,
  weighting: { mode: "positions", label_en: "By cost basis", label_zh: "按成本权重" },
  book: { n: 1, covered: 1, uncovered: [] },
  population: {
    mode: "positions",
    label_en: "Your holdings",
    label_zh: "你的持仓",
    n: 1,
    disclosure_en: "This read describes the 1 name you hold.",
    disclosure_zh: "此判读描述你持有的 1 只个股。",
  },
  headline: { en: "BOUND BRIEF.", zh: "已绑定简报。" },
  sections: [{
    key: "exposure",
    title_en: "Exposure",
    title_zh: "敞口",
    lines: [{ en: "BOUND LINE.", zh: "已绑定内容。" }],
  }],
};

type CanonicalRead = { positions: Record<string, unknown>[]; bookKey: string };

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh: boolean) {
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    const root = document.documentElement;
    if (root) {
      root.setAttribute("data-lang", useZh ? "zh" : "en");
      root.setAttribute("lang", useZh ? "zh-CN" : "en");
    }
  }, zh);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: QUOTES }));
  return { storeKey, owner: fixtureUserId(storeKey) };
}

async function seedPosition(page: Page) {
  const response = await page.request.post("/api/portfolio", {
    data: { action: "create", ticker: "NVDA", shares: "10", entryPrice: "100", entryCurrency: "USD" },
  });
  expect(response.ok(), `seeding NVDA failed: ${response.status()}`).toBe(true);
}

/** The page's own canonical read, and the canonical key recomputed from it. */
async function canonicalRead(page: Page): Promise<CanonicalRead> {
  const response = await page.request.get("/api/portfolio?view=positions");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { positions: Record<string, unknown>[]; bookKey: string };
  // The canonical Node key, recomputed here from the same positions the page reads.
  expect(portfolioBookKey(payload.positions as never)).toBe(payload.bookKey);
  return payload;
}

/** The brief lives inside a collapsed disclosure in the workspace — open it. */
async function openDesk(page: Page) {
  const details = page.locator("details", { has: page.locator(".pbrief") });
  await expect(details).toHaveCount(1);
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
}

/**
 * Open the position editor FROM THE OVERVIEW, so the brief stays on screen for the whole
 * journey. (The workspace keeps every section mounted and hides the inactive one, so a trip to
 * the holdings tab would make the panel invisible exactly while its retirement is under proof.)
 */
async function openEditorFromOverview(page: Page, ticker: string) {
  const row = page.locator(`tr[data-ticker="${ticker}"]`).filter({ visible: true }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button").first().click();
  const inspector = page.getByRole("dialog").filter({ has: page.locator("#portfolio-record-title") });
  await expect(inspector).toBeVisible();
  await inspector.locator(`button[aria-label$=" ${ticker}"]`).first().click();
  const editor = page.getByRole("dialog").filter({ has: page.locator("input[name='ticker']") });
  await expect(editor).toBeVisible();
  return editor;
}

test.describe("Portfolio brief renders only for the canonical book", () => {
  for (const lang of ["en", "zh"] as const) {
    test(`${lang}: a committed edit retires the previous brief and only the new book's brief renders`, async ({ page, baseURL }, testInfo) => {
      const zh = lang === "zh";
      const { owner } = await prepare(page, testInfo, baseURL, zh);

      // The served context names the canonical book the page is showing. The fixture starts
      // with the book's key and the test moves it after the edit, exactly as the desk would.
      // The marker names the book the payload describes, so a stale answer is visible as a
      // DIFFERENT string and not merely as a different length.
      let servedBookKey = "";
      let servedMarker = "BOOK-1";
      let reads = 0;
      await page.route("**/api/portfolio-brief", async (route) => {
        reads += 1;
        const read = reads;
        // Every read after the first is deliberately SLOW, so the window between the committed
        // edit and the fresh read is observable rather than instantaneous.
        if (read > 1) await new Promise((done) => setTimeout(done, 1500));
        await route.fulfill({
          json: {
            ...BRIEF,
            headline: { en: `BOUND BRIEF — ${servedMarker}.`, zh: `已绑定简报 —— ${servedMarker}。` },
            sections: [{
              ...BRIEF.sections[0],
              lines: [{ en: `BOUND LINE — ${servedMarker}.`, zh: `已绑定内容 —— ${servedMarker}。` }],
            }],
            context: {
              version: "snapshot-v1",
              owner,
              bookKey: servedBookKey,
              population: "positions",
            },
          },
        });
      });

      await seedPosition(page);
      const canonical = await canonicalRead(page);
      servedBookKey = canonical.bookKey;

      await page.goto("/portfolio");
      await openDesk(page);

      // The bound brief renders: the facts, in the active register.
      const brief = page.locator(".pbrief");
      const firstMarker = "BOOK-1";
      await expect(brief.locator(".pbrief-headline")).toHaveText(
        zh ? `已绑定简报 —— ${firstMarker}。` : `BOUND BRIEF — ${firstMarker}.`,
      );
      await expect(brief).toContainText(
        zh ? `已绑定内容 —— ${firstMarker}。` : `BOUND LINE — ${firstMarker}.`,
      );

      // The population disclosure names the desk's NAMES and the page's POSITIONS, and does
      // not claim they are equal: one name, one position record.
      const disclosure = brief.getByTestId("brief-population");
      await expect(disclosure).toContainText("1");
      await expect(disclosure).toContainText(zh ? "持仓位" : "open positions");

      const shot = page.locator(".pbrief");
      await shot.screenshot({
        path: `docs/verification/portfolio-brief-context-20261102/browser/${testInfo.project.name}-${lang}-bound.png`,
      });

      // The real edit: the workspace's record inspector → the position modal → save.
      const edit = await openEditorFromOverview(page, "NVDA");
      await edit.locator("input[name='shares']").fill("25");
      await edit.getByRole("button", { name: /^(Save position|保存持仓)$/ }).click();
      await expect(edit).not.toBeVisible();
      await closeInspector(page);

      // The committed input changed, so the canonical book changed and the previous brief is
      // RETIRED. The served context still names the old book, so the panel must not present
      // the old facts: it says the brief is unavailable.
      await expect(brief).not.toContainText(firstMarker);
      await expect(brief).toContainText(zh ? "暂时无法加载" : "unavailable right now");
      await brief.screenshot({
        path: `docs/verification/portfolio-brief-context-20261102/browser/${testInfo.project.name}-${lang}-unavailable.png`,
      });

      // The desk answers for the NEW book: the context names it, and the deliberate retry
      // goes through the page's own canonical reload first.
      const updated = await canonicalRead(page);
      expect(updated.bookKey).not.toBe(canonical.bookKey);
      servedBookKey = updated.bookKey;
      servedMarker = "BOOK-2";
      await brief.getByRole("button", { name: /^(Try again|重试)$/ }).click();

      await expect(brief.locator(".pbrief-headline")).toHaveText(
        zh ? `已绑定简报 —— ${servedMarker}。` : `BOUND BRIEF — ${servedMarker}.`,
      );
      await expect(brief).not.toContainText(zh ? "暂时无法加载" : "unavailable right now");
      await expect(brief).not.toContainText(firstMarker);

      // Responsive finding: the brief adds no horizontal document overflow at this viewport.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await shot.screenshot({
        path: `docs/verification/portfolio-brief-context-20261102/browser/${testInfo.project.name}-${lang}-rebound.png`,
      });
    });
  }

  test("a payload with no context is never presented as the brief", async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL, false);
    // The OLD producer's answer: an ordinary brief with no context at all. It is an explicit
    // unavailable state, never a silently accepted payload.
    await page.route("**/api/portfolio-brief", (route) => route.fulfill({ json: BRIEF }));
    await seedPosition(page);
    await page.goto("/portfolio");
    await openDesk(page);
    const brief = page.locator(".pbrief");
    await expect(brief).toContainText("unavailable right now");
    await expect(brief).not.toContainText("BOUND BRIEF");
  });
});
