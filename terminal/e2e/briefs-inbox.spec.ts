import { expect, test, type Page } from "@playwright/test";
import { briefCopy, degradedLine, BRIEFS_EXPLICIT_LANGUAGE_CONTRACT } from "@/lib/briefs";

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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


async function languageCrop(page: Page, lang: "en" | "zh", state: string) {
  if (process.env.BRIEFS_LANGUAGE_CROPS !== "1") return;
  const repo = resolve(process.cwd(), "..");
  const out = join(repo, "terminal/docs/pr-crops/briefs-explicit-language");
  mkdirSync(out, { recursive: true });
  const viewport = page.viewportSize()!;
  const stem = `${state}-${viewport.width}-${lang}-dark`;
  const png = await page.getByTestId("briefs-inbox").screenshot({ path: join(out, stem + ".png") });
  const sourceFiles = [
    "terminal/lib/briefs.ts",
    "terminal/app/api/briefs/deliveries/route.ts",
    "terminal/components/briefs/BriefsInbox.tsx",
    "terminal/components/briefs/briefs.module.css",
    "terminal/components/alerts/AlertsCockpit.tsx",
    "terminal/e2e/briefs-inbox.spec.ts",
  ];
  writeFileSync(join(out, stem + ".json"), JSON.stringify({
    proof: "Actual Alerts inbox with controlled delivery responses; route ownership separately unit-tested.",
    capturedAtHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    capturedAt: new Date().toISOString(), route: "/alerts", lang, viewport, state,
    requestedContract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT,
    sourceHashes: Object.fromEntries(sourceFiles.map((file) => [
      file, createHash("sha256").update(readFileSync(join(repo, file))).digest("hex"),
    ])),
    png: stem + ".png", sha256: createHash("sha256").update(png).digest("hex"),
    productionAcceptance: false, producerActivation: false,
  }, null, 2) + "\n");
}

for (const lang of ["en", "zh"] as const) {
  test(`actual inbox preserves partial Chinese and full-body coverage in ${lang}`, async ({ page }) => {
    const row = {
      deliveryId: "language-ready", subscriptionId: "s1", slotAsof: "2026-10-17",
      state: "ready", createdAt: "2026-10-17T07:00:00.000Z",
      body: {
        ...readyBody,
        market_read: [
          { ...readyBody.market_read[0], translation_status: "available" },
          { ...readyBody.market_read[1], sentence_zh: null, translation_status: "unavailable" },
          { section: "watch_items", sentence_en: "Watch credit.", sentence_zh: null, translation_status: "unavailable", asof: "2026-10-17" },
        ],
      },
      subscription: { targetKind: "thesis", targetId: THESIS, cadence: "weekly_saturday", state: "active" },
    };
    await page.addInitScript((locale) => {
      localStorage.setItem("mm.lang", locale);
      localStorage.setItem("theme", "dark");
    }, lang);
    await page.route("**/api/briefs/deliveries**", async (route) => {
      expect(new URL(route.request().url()).searchParams.get("contract")).toBe(BRIEFS_EXPLICIT_LANGUAGE_CONTRACT);
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ contract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT, deliveries: [row] }) });
    });
    await page.goto("/alerts");
    const inbox = page.getByTestId("briefs-inbox");
    await expect(inbox.locator("[data-brief-language-availability]")).toContainText(lang === "zh" ? "1/3" : "1 of 3");
    await expect(inbox).toContainText(lang === "zh"
      ? `英文原文：${readyBody.market_read[1].sentence_en}` : readyBody.market_read[1].sentence_en);
    await expect(inbox).toContainText(lang === "zh" ? readyBody.market_read[0].sentence_zh : readyBody.market_read[0].sentence_en);
    await expect(inbox).not.toContainText("Watch credit.");
    await expect(inbox).not.toContainText("翻译待补");
    await expect(inbox.locator("[data-brief-name]")).toHaveText("NVDA cycle");
    await expect(inbox.locator("[data-brief-date]")).toHaveText("2026-10-17");
    await expect(inbox.locator("[data-brief-miss], [data-brief-pinned]")).toHaveCount(0);
    await inbox.scrollIntoViewIfNeeded();
    expect(await inbox.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await languageCrop(page, lang, "partial");
  });

  test(`actual inbox refreshes the page after a typed upgrade response in ${lang}`, async ({ page }) => {
    let serveCurrent = false;
    await page.addInitScript((locale) => {
      localStorage.setItem("mm.lang", locale);
      localStorage.setItem("theme", "dark");
    }, lang);
    await page.route("**/api/briefs/deliveries**", async (route) => {
      await route.fulfill({
        status: serveCurrent ? 200 : 409, contentType: "application/json",
        body: JSON.stringify(serveCurrent
          ? { contract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT, deliveries: [] }
          : { error: "UPGRADE_REQUIRED", requiredContract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT, reloadRequired: true }),
      });
    });
    await page.goto("/alerts");
    const inbox = page.getByTestId("briefs-inbox");
    await expect(inbox).toContainText(briefCopy("upgradeRequired", lang));
    await inbox.scrollIntoViewIfNeeded();
    await languageCrop(page, lang, "upgrade");
    serveCurrent = true;
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      inbox.getByRole("button", { name: briefCopy("refresh", lang), exact: true }).click(),
    ]);
    await expect(page.getByTestId("briefs-inbox")).toContainText(briefCopy("empty", lang));
  });
}
