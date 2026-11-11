import { expect, test } from "@playwright/test";
import feedFixture from "../lib/__tests__/fixtures/candidate_feed.json";
import receiptFixture from "../lib/__tests__/fixtures/candidate_feed.receipt.json";

type ContextMode = "valid" | "absent" | "invalid-ticker" | "wrong-revision";

// Declared synthetic, server-verified response shape, as in the component tests.
// This proves navigation from a formed row, not publisher activation or live data.
function candidateResponse(mode: ContextMode = "valid") {
  const feed = structuredClone(feedFixture);
  const row = feed.formed_candidates[0] as unknown as Record<string, unknown>;
  if (mode !== "absent") {
    row.campaign_context = {
      schema: "options.alpha_candidate_campaign_context/v1",
      campaign_revision_id: mode === "wrong-revision"
        ? "ocrev_aaaaaaaaaaaaaaaaaaaaaaaa"
        : row.first_qualifying_campaign_revision_id,
      group: {
        session_date: "2026-08-13", ticker: mode === "invalid-ticker" ? "SPY&symbol=QQQ" : "SPY",
        right: "C", expiration: "2026-08-15", strike: 450, strike_key: "450",
      },
      flow_side_counts: { "~buy": 2, "~sell": 1, mixed: 1 },
      intent: { opening_closing: "unavailable", direction_reliability: "soft", accumulation_distribution: "unavailable" },
    };
  }
  return {
    feed, receipt: structuredClone(receiptFixture),
    metadata: {
      payload_etag: "synthetic-test-only", payload_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      receipt_etag: "synthetic-test-only", receipt_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      served_at: "2026-08-13T14:30:05Z",
    },
  };
}

test.beforeEach(async ({ context }) => {
  // The acceptance is wholly local; remote scripts/data cannot become evidence.
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    // FLOW_FIXTURE serves the origin's Flow panels. Other API requests, including
    // the popup chart's price routes, are unavailable fixtures and never proxy data.
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/flow")) {
      return route.fulfill({ status: 503, json: { error: "local navigation fixture; no data acquisition" } });
    }
    return route.continue();
  });
});

for (const lang of ["en", "zh"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`formed candidate opens the underlying chart and preserves its source (${lang}, ${theme})`, async ({ page }, testInfo) => {
      await page.route("**/api/flow?f=options_alpha_candidate_feed", route => route.fulfill({ json: candidateResponse() }));
      await page.goto("/options?tab=prophet");
      await page.getByRole("tab", { name: /Options Alpha/ }).click();
      await page.evaluate(({ lang, theme }) => {
        document.documentElement.setAttribute("data-lang", lang);
        document.documentElement.setAttribute("data-theme", theme);
        window.dispatchEvent(new CustomEvent("mm:lang"));
      }, { lang, theme });
      const card = page.getByTestId("options-alpha-candidate-item");
      await expect(card).toBeVisible();
      const link = card.getByTestId("options-alpha-candidate-chart-link");
      await expect(link).toHaveText(lang === "en" ? "Open underlying chart" : "打开标的图表");
      await expect(link).toHaveAttribute("href", "/terminal?symbol=SPY");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(card.getByTestId("options-alpha-candidate-chart-caption")).toContainText(
        lang === "en" ? "not an option fill or a recommended entry" : "并非期权成交价或建议入场价",
      );
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await link.focus();
      await expect(link).toBeFocused();
      const sourceBefore = await card.textContent();
      const originUrl = page.url();
      const [chart] = await Promise.all([page.waitForEvent("popup"), link.click()]);
      await chart.waitForURL(/\/terminal\?symbol=SPY/);
      await chart.waitForLoadState("domcontentloaded");
      expect(await chart.evaluate(() => window.opener === null)).toBe(true);
      await chart.close();
      expect(page.url()).toBe(originUrl);
      expect(await card.textContent()).toBe(sourceBefore);
      await expect(link).toBeVisible();
      await card.screenshot({ path: testInfo.outputPath(`candidate-chart-${lang}-${theme}.png`) });
    });
  }
}

test("unqualified frozen context has no chart action", async ({ page }) => {
  let mode: ContextMode = "absent";
  await page.route("**/api/flow?f=options_alpha_candidate_feed", route => route.fulfill({ json: candidateResponse(mode) }));
  for (const next of ["absent", "invalid-ticker", "wrong-revision"] as const) {
    mode = next;
    await page.goto("/options?tab=prophet");
    await page.getByRole("tab", { name: /Options Alpha/ }).click();
    const card = page.getByTestId("options-alpha-candidate-item");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("options-alpha-candidate-context-absent")).toBeVisible();
    await expect(card.getByTestId("options-alpha-candidate-chart-link")).toHaveCount(0);
  }
});
