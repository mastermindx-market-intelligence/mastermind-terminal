import { expect, test, type Page } from "@playwright/test";
import { briefCopy, degradedLine } from "@/lib/briefs";

const THESIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WATCHLIST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const readyBody = {
  target: { kind: "thesis", id: THESIS, name: "NVDA cycle", version_or_asof: "v3" },
  market_read: [
    { section: "tape", sentence_en: "The close held above last week's range.", sentence_zh: "收盘守住了上周的区间。", asof: "2026-09-11" },
    { section: "flow", sentence_en: "Call buying stayed in the front week.", sentence_zh: "买权仍集中在近月。", asof: "2026-09-11" },
  ],
  monitors: [{ name: "range hold", state_en: "Holding", state_zh: "仍成立" }],
  artifact: { name: "US session digest", asof: "2026-09-11T20:05:00.000Z" },
};

async function mockBriefs(page: Page, deliveries: unknown[], subscriptions: unknown[] = []) {
  let currentSubscriptions = [...subscriptions];
  await page.route("**/api/briefs/deliveries**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ deliveries }),
    });
  });
  await page.route("**/api/briefs/subscriptions**", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ subscriptions: currentSubscriptions }),
      });
      return;
    }
    if (method === "POST") {
      const body = route.request().postDataJSON() as {
        target_kind: "thesis" | "watchlist";
        target_id: string;
        cadence: "daily_after_us_close" | "weekly_saturday";
      };
      currentSubscriptions = [
        ...currentSubscriptions,
        {
          subscriptionId: "33333333-3333-4333-8333-333333333333",
          userId: "u-1",
          targetKind: body.target_kind,
          targetId: body.target_id,
          targetName: body.target_kind === "watchlist" ? "Semis" : "NVDA cycle",
          cadence: body.cadence,
          delivery: "in_product_inbox",
          state: "active",
          createdAt: "2026-09-11T20:00:00.000Z",
        },
      ];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/watchlist", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lists: [{ id: WATCHLIST, name: "Semis", position: 0, symbols: [] }],
        sharedWithMe: [],
      }),
    });
  });
  await page.route("**/api/theses", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        theses: [{
          id: THESIS,
          currentVersion: 3,
          lifecycleState: "active",
          subject: {},
          title: "NVDA cycle",
          updatedAt: "2026-09-11T20:00:00.000Z",
        }],
        truncated: false,
      }),
    });
  });
}

test("Alerts opens on Alerts and switches to Briefs without stacking both surfaces", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
  });
  await mockBriefs(page, []);
  await page.goto("/alerts");
  await expect(page.getByTestId("briefs-inbox")).toHaveCount(0);
  await page.getByRole("link", { name: "Briefs", exact: true }).click();
  await expect(page.getByTestId("briefs-inbox")).toBeVisible();
  await expect(page).toHaveURL(/#briefs$/);
});

test("empty inbox names the in-product destination without promising external delivery", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
  });
  await mockBriefs(page, []);
  await page.goto("/alerts#briefs");
  const inbox = page.getByTestId("briefs-inbox");
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText(briefCopy("empty", "en"))).toBeVisible();
  await expect(inbox.getByTestId("briefs-email-null")).toHaveText(briefCopy("emailNull", "en"));
});

test("a watchlist schedule can be created from Alerts without returning to watchlist chrome", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
  });
  await mockBriefs(page, []);
  await page.goto("/alerts#briefs");

  const composer = page.getByTestId("briefs-new-schedule");
  await composer.getByLabel(briefCopy("scheduleTarget", "en")).selectOption("watchlist:" + WATCHLIST);
  await composer.getByLabel(briefCopy("scheduleCadence", "en")).selectOption("weekly_saturday");
  await composer.getByRole("button", { name: briefCopy("addSchedule", "en") }).click();

  const schedules = page.getByTestId("briefs-schedules");
  await expect(schedules.locator("[data-brief-schedule]")).toHaveCount(1);
  await expect(schedules.getByText("Semis")).toBeVisible();
  await expect(schedules.getByText(briefCopy("subscribeWeekly", "en"))).toBeVisible();
  await expect(composer.getByRole("button", { name: briefCopy("alreadyScheduled", "en") })).toBeDisabled();
});

test("scheduled briefs show their target, cadence, and state on the Alerts surface", async ({ page }) => {
  const subscriptions = [
    {
      subscriptionId: "11111111-1111-4111-8111-111111111111",
      userId: "u-1",
      targetKind: "thesis",
      targetId: THESIS,
      targetName: "NVDA cycle",
      cadence: "daily_after_us_close",
      delivery: "in_product_inbox",
      state: "active",
      createdAt: "2026-09-11T20:00:00.000Z",
    },
    {
      subscriptionId: "22222222-2222-4222-8222-222222222222",
      userId: "u-1",
      targetKind: "watchlist",
      targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      targetName: "Semis",
      cadence: "weekly_saturday",
      delivery: "in_product_inbox",
      state: "paused",
      createdAt: "2026-09-10T20:00:00.000Z",
    },
  ];
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
  });
  await mockBriefs(page, [], subscriptions);
  await page.goto("/alerts#briefs");
  const schedules = page.getByTestId("briefs-schedules");
  await expect(schedules.locator("[data-brief-schedule]")).toHaveCount(2);
  await expect(schedules.getByText("NVDA cycle")).toBeVisible();
  await expect(schedules.getByText("Semis")).toBeVisible();
  await expect(schedules.getByText(briefCopy("subscribeDaily", "en"))).toBeVisible();
  await expect(schedules.getByText(briefCopy("subscribeWeekly", "en"))).toBeVisible();
  await expect(schedules).not.toContainText("daily_after_us_close");
  await expect(schedules).not.toContainText("11111111");
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
  await page.goto("/alerts#briefs");
  const inbox = page.getByTestId("briefs-inbox");
  await expect(inbox.getByText(degradedLine("daily_after_us_close", "en"))).toBeVisible();
  await expect(inbox.getByText("The close held above last week's range.")).toBeVisible();
  await expect(inbox.getByText(briefCopy("lastGood", "en"))).toBeVisible();
  await expect(inbox.locator("[data-brief-name]").first()).toHaveText("NVDA cycle");
  await expect(inbox.locator("[data-brief-cadence]").first()).toHaveText(briefCopy("subscribeDaily", "en"));
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
  await page.goto("/alerts#briefs");
  const inbox = page.getByTestId("briefs-inbox");
  await expect(inbox.getByText("The close held above last week's range.")).toBeVisible();
  const sentence = inbox.locator("[data-brief-sentence]");
  const box = await sentence.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(240);
  const dateBox = await inbox.locator("[data-brief-date]").boundingBox();
  expect(dateBox?.height ?? 99).toBeLessThan(28);
});
