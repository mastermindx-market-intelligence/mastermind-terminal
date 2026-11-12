import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { makeFlowT } from "@/lib/flowdeskStrings";

/**
 * Unknown is not zero on the Flow Desk, from the user's side, over the real transport.
 *
 * The desk reads the flow feed through useFlowStream: an EventSource on
 * /api/flow/stream?f=feed, falling back to polling /api/flow?f=feed. With no feed the
 * left rail used to draw FlowGauge over an invented empty feed — "$0" of session flow
 * and a 50% call/put split — while the read was still in flight or had failed. A feed
 * the desk holds from an earlier read, whose latest read found nothing published, said
 * nothing about that. These cases drive both routes:
 *   unavailable       — the stream is refused and the poll answers 503: a load error,
 *                       the watchlist states the feed did not load, and no gauge;
 *   absent-after-data — the stream sends a frame and then a named `status: absent`
 *                       event: the cards stay and a status note says the latest read
 *                       found nothing published;
 *   loading           — both routes are held: the skeleton, and no gauge.
 */

test.setTimeout(90_000);

const isFeedRead = (url: URL) =>
  (url.pathname === "/api/flow/stream" || url.pathname === "/api/flow") && url.searchParams.get("f") === "feed";
const isFeedStream = (url: URL) => url.pathname === "/api/flow/stream" && url.searchParams.get("f") === "feed";
const isFeedPoll = (url: URL) => url.pathname === "/api/flow" && url.searchParams.get("f") === "feed";

async function setLang(page: Page, lang: "en" | "zh") {
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("flowdesk.tutorial.seen", "1");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
}

const langFor = (project: string): "en" | "zh" => (project === "mobile" ? "zh" : "en");

// The invented-empty-feed gauge printed these; with no feed the left rail must not.
async function expectNoGaugeWithoutFeed(page: Page) {
  const rail = page.locator(".obs-fd-left");
  await expect(rail.getByTestId("flow-gauge-slot")).toHaveCount(0);
  await expect(rail).not.toContainText("$0");
  await expect(rail).not.toContainText("50%");
}

test("an unavailable feed read is a load error with no flow gauge, never $0 or 50%", async ({ page }, testInfo) => {
  const lang = langFor(testInfo.project.name);
  const t = makeFlowT(lang);
  await setLang(page, lang);
  await page.route(isFeedStream, (route: Route) => route.abort("failed"));
  await page.route(isFeedPoll, (route: Route) => route.fulfill({ status: 503, json: { error: "feed unavailable" } }));

  await page.goto("/options?tab=desk");
  await expect(page.getByTestId("flowfeed-load-error")).toBeVisible({ timeout: 45_000 });
  const watchlist = page.locator(".obs-fd-left").getByTestId("watchlist-feed-unavailable");
  await expect(watchlist).toBeVisible();
  await expect(watchlist).toHaveText(t("watchlistFeedUnavailable"));
  await expectNoGaugeWithoutFeed(page);
});

test("a held feed whose latest read found nothing published keeps the cards and says so", async ({ page }, testInfo) => {
  const lang = langFor(testInfo.project.name);
  const t = makeFlowT(lang);
  await setLang(page, lang);
  // The frame is the fixture server's own feed; only the transport is scripted here.
  const feedRes = await page.request.get("/api/flow?f=feed");
  expect(feedRes.ok()).toBe(true);
  const feed = JSON.stringify(await feedRes.json());
  // A long reconnect interval keeps EventSource from re-reading after the body ends, so the
  // absent status is the latest read the desk holds.
  const body = `retry: 3600000\n\ndata: ${feed}\n\nevent: status\ndata: {"status":"absent"}\n\n`;
  await page.route(isFeedStream, (route: Route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" }, body }),
  );

  await page.goto("/options?tab=desk");
  const note = page.getByTestId("flowfeed-refresh-absent");
  await expect(note).toBeVisible({ timeout: 45_000 });
  await expect(note).toHaveAttribute("role", "status");
  await expect(note).toHaveText(t("feedRefreshAbsent"));
  await expect(note.getByRole("button")).toHaveCount(0); // nothing to retry: the read landed
  await expect(page.locator(".obs-fc-card").first()).toBeVisible();
  await expect(page.getByTestId("flowfeed-refresh-failed")).toHaveCount(0);
  await expect(page.locator(".obs-fd-left").getByTestId("flow-gauge-slot")).toHaveCount(1);
});

test("a feed read still in flight is the loading skeleton with no flow gauge", async ({ page }, testInfo) => {
  const lang = langFor(testInfo.project.name);
  await setLang(page, lang);
  const held: Route[] = [];
  await page.route(isFeedRead, (route: Route) => { held.push(route); });
  try {
    const streamRead = page.waitForRequest((req: Request) => isFeedStream(new URL(req.url())), { timeout: 45_000 });
    await page.goto("/options?tab=desk");
    await streamRead;
    await expect(page.locator(".obs-fd-left .fin-skel").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".obs-fd-card-skel").first()).toBeVisible();
    await expect(page.getByTestId("flowfeed-load-error")).toHaveCount(0);
    await expectNoGaugeWithoutFeed(page);
  } finally {
    for (const route of held) await route.abort("aborted").catch(() => {});
  }
});
