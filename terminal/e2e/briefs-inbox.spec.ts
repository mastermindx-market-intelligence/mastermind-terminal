import { expect, test, type Page } from "@playwright/test";
import { briefCopy, degradedLine } from "@/lib/briefs";

const THESIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const readyBody = {
  target: { kind: "thesis", id: THESIS, name: "NVDA cycle", version_or_asof: "v3" },
  market_read: [
    { section: "tape", sentence_en: "The close held above last week's range.", sentence_zh: "收盘守住了上周的区间。", asof: "2026-09-11" },
    { section: "flow", sentence_en: "Call buying stayed in the front week.", sentence_zh: "买权仍集中在近月。", asof: "2026-09-11" },
  ],
  monitors: [{ name: "range hold", state_en: "Holding", state_zh: "仍成立" }],
  artifact: { name: "US session digest", asof: "2026-09-11T20:05:00.000Z" },
};

async function mockBriefs(page: Page, deliveries: unknown[]) {
  await page.route("**/api/briefs/deliveries**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ deliveries }),
    });
  });
  await page.route("**/api/briefs/subscriptions**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ subscriptions: [] }),
      });
      return;
    }
    await route.continue();
  });
}

test("empty inbox shows the subscribe-next-close sentence", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
  });
  await mockBriefs(page, []);
  await page.goto("/alerts");
  const inbox = page.getByTestId("briefs-inbox");
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText(briefCopy("empty", "en"))).toBeVisible();
  await expect(inbox.getByTestId("briefs-email-null")).toHaveText(briefCopy("emailNull", "en"));
});

test("ready and degraded rows render verbatim EN/ZH sentences, never a cadence slug", async ({ page }) => {
  const deliveries = [
    {
      deliveryId: "d-deg",
      subscriptionId: "s1",
      slotAsof: "2026-09-11",
      state: "degraded",
      body: {},
      createdAt: "2026-09-11T20:10:00.000Z",
      subscription: { targetKind: "thesis", targetId: THESIS, cadence: "daily_after_us_close", state: "active", targetName: "NVDA cycle" },
    },
    {
      deliveryId: "d-ready",
      subscriptionId: "s1",
      slotAsof: "2026-09-10",
      state: "ready",
      pinned: true,
      body: readyBody,
      createdAt: "2026-09-10T20:10:00.000Z",
      subscription: { targetKind: "thesis", targetId: THESIS, cadence: "daily_after_us_close", state: "active", targetName: "NVDA cycle" },
    },
  ];
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
  });
  await mockBriefs(page, deliveries);
  await page.goto("/alerts");
  const inbox = page.getByTestId("briefs-inbox");
  await expect(inbox.getByText(degradedLine("daily_after_us_close", "en"))).toBeVisible();
  await expect(inbox.getByText("The close held above last week's range.")).toBeVisible();
  await expect(inbox.getByText(briefCopy("lastGood", "en"))).toBeVisible();
  await expect(inbox.locator("[data-brief-name]").first()).toHaveText("NVDA cycle");
  await expect(inbox).not.toContainText("daily_after_us_close");
});

test("390 list sentences occupy the row width instead of one English word per line", async ({ page }) => {
  const deliveries = [
    {
      deliveryId: "d-ready",
      subscriptionId: "s1",
      slotAsof: "2026-09-10",
      state: "ready",
      pinned: true,
      body: readyBody,
      createdAt: "2026-09-10T20:10:00.000Z",
      subscription: {
        targetKind: "thesis",
        targetId: THESIS,
        cadence: "daily_after_us_close",
        state: "active",
        targetName: "NVDA cycle",
      },
    },
  ];
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
  });
  await mockBriefs(page, deliveries);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/alerts");
  const inbox = page.getByTestId("briefs-inbox");
  await expect(inbox.getByText("The close held above last week's range.")).toBeVisible();
  const sentence = inbox.locator("[data-brief-sentence]");
  const box = await sentence.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(240);
  const dateBox = await inbox.locator("[data-brief-date]").boundingBox();
  expect(dateBox?.height ?? 99).toBeLessThan(28);
});
