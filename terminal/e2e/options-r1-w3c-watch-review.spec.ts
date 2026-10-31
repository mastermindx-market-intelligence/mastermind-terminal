import { expect, test, type Page } from "@playwright/test";
import { ResearchStore, routeResearch } from "./helpers/optionsR1Research";
import { FIRE_EVENT_ID, INVESTIGATION_ID, WatchStore, routeWatch, seedInvestigation } from "./helpers/optionsR1Watch";

// Options R1 W3C — a saved question gets a falsifiable watch the existing alerts owner can
// evaluate, the watch fires once with a receipt, and the user records what the evidence did as
// the NEXT immutable revision. Synthetic fixtures on the local-preview owner; the alerts owner
// is an in-memory store shaped like /api/alerts. Written to be read at the three contract
// viewports (desktop/tablet/mobile) and in Chinese; a viewport alone is never persistence
// proof — every reopen is a fresh read from an independent context.
test.setTimeout(300_000);

const noOverflow = async (target: Page) => {
  const width = await target.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(width).toBeLessThanOrEqual(1);
};
/** Switch language the way the account-prefs store does (lib/i18n applyLang) — no reload. */
async function switchLang(page: Page, l: "en" | "zh") {
  await page.evaluate((lang) => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement.setAttribute("data-lang", lang);
    window.dispatchEvent(new CustomEvent("mm:lang"));
  }, l);
}
const detailUrl = (revision?: number) =>
  `/analysis?view=investigations&investigation=${INVESTIGATION_ID}${revision ? `&revision=${revision}` : ""}`;

test("a saved question gets a watch, a receipt and an assessment as the next revision", async ({ page, context, browser }, testInfo) => {
  const research = new ResearchStore();
  await routeResearch(context, research);
  const watches = new WatchStore();
  await routeWatch(context, watches);
  seedInvestigation(research);
  await page.goto(detailUrl());
  await expect(page.getByText("Saved · Revision 1")).toBeVisible({ timeout: 30_000 });

  // The watch entry names what it can and cannot offer, before anything is armed.
  const watch = page.getByTestId("investigation-watch");
  await expect(watch).toBeVisible();
  await expect(watch.getByTestId("investigation-watch-kinds")).toContainText("exposure change");
  await expect(watch.getByTestId("investigation-watch-kinds")).toContainText("no evaluator in the alerts owner · follow-on L-W3C-ENG");
  await expect(watch.getByTestId("investigation-watch-state")).toHaveText("NOT ARMED");
  await expect(watch).toContainText("A watch is not an order and implies no profitable signal.");
  await noOverflow(page);

  // Arm a price touch at 230: the owner receives the linked condition and stores it armed.
  await watch.getByTestId("investigation-watch-threshold").fill("230");
  await watch.getByTestId("investigation-watch-arm").click();
  await expect(watch.getByTestId("investigation-watch-state")).toHaveText(/ARMED · WAITING/);
  expect(watches.alerts).toHaveLength(1);
  expect(watches.alerts[0].condition).toMatchObject({ type: "price", op: "above", value: 230, evidence: { investigation_id: INVESTIGATION_ID, revision: 1 } });

  // The engine fires once and disarms; a fresh read shows the fired state and the receipt.
  watches.fireFixture();
  await page.reload();
  await expect(page.getByTestId("investigation-watch-state")).toHaveText(/FIRED · 15:40:03Z · now disarmed/);
  await expect(page.locator("main")).toContainText("230.12");
  const review = page.getByTestId("investigation-review");
  const receiptTable = review.getByTestId("investigation-review-receipts");
  await expect(receiptTable).toContainText(FIRE_EVENT_ID);
  await expect(receiptTable).toContainText("sent");
  await noOverflow(page);

  // The assessment is recorded as the NEXT revision through the existing command.
  await review.getByTestId("investigation-review-assessment").getByRole("button", { name: "Inconclusive" }).click();
  await review.getByTestId("investigation-review-note").fill("The wall held through the session; the firing quote arrived after the rotation faded.");
  await review.getByTestId("investigation-review-save").click();
  await expect(page.getByText("Saved · Revision 2")).toBeVisible({ timeout: 30_000 });
  const command = research.commands.at(-1)!;
  expect(command.expected_revision).toBe(1);
  expect((command.manifest as { review?: unknown }).review).toEqual({ assessment: "inconclusive", fire_event_id: FIRE_EVENT_ID, note: expect.stringContaining("wall held") });
  await expect(review.getByTestId("investigation-review-revisions")).toContainText("r2");

  // An independent context with its own storage reopens revision 2 and reads the same facts.
  const { viewport, hasTouch, isMobile, baseURL, deviceScaleFactor, userAgent } = testInfo.project.use;
  const fresh = async (access: "granted" | "plan" = "granted") => {
    const otherContext = await browser.newContext({ viewport: viewport ?? undefined, hasTouch, isMobile, baseURL, deviceScaleFactor, userAgent });
    await routeResearch(otherContext, research);
    await routeWatch(otherContext, watches, access);
    const otherPage = await otherContext.newPage();
    return { otherContext, otherPage };
  };
  {
    const { otherContext, otherPage } = await fresh();
    await otherPage.goto(detailUrl(2));
    await expect(otherPage.getByText("Saved · Revision 2")).toBeVisible({ timeout: 30_000 });
    await expect(otherPage.locator("main")).toContainText("Inconclusive");
    await expect(otherPage.getByTestId("investigation-review-revisions")).toContainText("r2");
    await expect(otherPage.getByTestId("investigation-watch-state")).toHaveText(/FIRED · 15:40:03Z · now disarmed/);
    await noOverflow(otherPage);
    await otherContext.close();
  }

  // The same surface in Chinese carries real words and never the raw kinds.
  await switchLang(page, "zh");
  await page.reload();
  await expect(page.getByTestId("investigation-watch-state")).toHaveText(/已触发/);
  const mainZh = await page.locator("main").textContent();
  expect(mainZh).toContain("监测不是订单，也不暗示任何盈利信号。");
  expect(mainZh).not.toContain("price_touch");
  expect(mainZh).not.toContain("opt_wall_touch");

  // A revoked entitlement (403 on arm) renders the owner's own plan sentence, no invented tier.
  {
    const { otherContext, otherPage } = await fresh("plan");
    await otherPage.goto(detailUrl(1));
    await expect(otherPage.getByTestId("investigation-watch-state")).toHaveText(/FIRED · 15:40:03Z · now disarmed/, { timeout: 30_000 });
    await otherPage.getByTestId("investigation-watch-threshold").fill("240");
    await otherPage.getByTestId("investigation-watch-arm").click();
    await expect(otherPage.getByTestId("investigation-watch")).toContainText("This watch kind is not included in your plan");
    expect(watches.alerts).toHaveLength(1);
    await otherContext.close();
  }

  await page.screenshot({ path: testInfo.outputPath(`watch-review-${testInfo.project.name}.png`), fullPage: true });
});
