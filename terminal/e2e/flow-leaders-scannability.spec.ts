import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

type LeaderRow = Record<string, unknown> & { ticker: string; K_a: number; K_b: number };
type LeadersFixture = Record<string, unknown> & {
  board_a: LeaderRow[];
  board_b: LeaderRow[];
  coverage: Record<string, unknown> & { tape_names: string[] };
};

function leadersFixture(): LeadersFixture {
  const fixture = JSON.parse(
    readFileSync(path.join(process.cwd(), "public", "data", "flow_leaders_fixture.json"), "utf8"),
  ) as LeadersFixture;
  const a = fixture.board_a[0];
  const b = fixture.board_b[0];
  return {
    ...fixture,
    stale: true,
    cold_start: false,
    session_date: "2026-08-12",
    as_of: "2026-08-13T02:00:00Z",
    board_a: Array.from({ length: 133 }, (_, index) => ({
      ...a, ticker: `A${String(index + 1).padStart(3, "0")}`, K_a: 133 - index,
    })),
    board_b: Array.from({ length: 19 }, (_, index) => ({
      ...b, ticker: `B${String(index + 1).padStart(3, "0")}`, K_b: 19 - index,
    })),
    coverage: {
      ...fixture.coverage,
      n_universe: 368,
      n_flow_sessions: 145,
      tape_names: Array.from({ length: 387 }, (_, index) => `S${index}`),
    },
  };
}

async function installLeadersFixture(page: Page, fixture: LeadersFixture = leadersFixture()): Promise<void> {
  await page.route(/\/api\/flow\?f=leaders(?:&.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture), headers: { "cache-control": "no-store" } });
  });
}


async function captureLeaders(page: Page, testInfo: TestInfo, language: "en" | "zh", state: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath(`leaders-${language}-${state}.png`),
    animations: "disabled",
  });
}

test("expanded Flow Leaders keeps its collapse control in reach and a board switch resets the preview", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await installLeadersFixture(page);

  await page.goto("/discover?tab=leaders");
  await expect(page.getByText("Current Flow Leaders unavailable", { exact: true })).toBeVisible();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show all 133", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect historical snapshot", exact: true }).click();
  const showAll = page.getByRole("button", { name: "Show all 133", exact: true });
  await expect(showAll).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("table.scr tbody tr")).toHaveCount(12);
  await expect(page.getByText("145 sessions of history", { exact: false })).toBeVisible();
  await expect(page.getByText(
    "Magnitude is more reliable than direction in this snapshot.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText(/data session|sessions 145\/5|FL-R3/i)).toHaveCount(0);
  await expect(showAll).toHaveAttribute("aria-expanded", "false");
  await showAll.scrollIntoViewIfNeeded();
  await captureLeaders(page, testInfo, "en", "preview");
  const before = await showAll.boundingBox();
  expect(before).not.toBeNull();

  await showAll.click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(133);
  const collapse = page.getByRole("button", { name: "Show top 12", exact: true });
  await expect(collapse).toBeVisible();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  const after = await collapse.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.y, "expanding must not move the collapse control below the viewport").toBeLessThan(
    page.viewportSize()!.height,
  );
  expect(Math.abs(after!.y - before!.y), "the control should stay in the same toolbar").toBeLessThan(80);

  await captureLeaders(page, testInfo, "en", "expanded");
  await collapse.click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(12);
  await expect(showAll).toHaveAttribute("aria-expanded", "false");
  await showAll.click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(133);
  await page.getByRole("button", { name: "Washout Turn", exact: true }).click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Show all 19", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide historical snapshot", exact: true }).click();
  await expect(page.getByText("Current Flow Leaders unavailable", { exact: true })).toBeVisible();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(0);
});


test("the compact Flow Leaders controls and coverage remain bilingual", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one touch viewport pins the Chinese journey");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
  await installLeadersFixture(page);

  await page.goto("/discover?tab=leaders");
  await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
  await expect(page.getByText("当前资金流领涨榜不可用", { exact: true })).toBeVisible();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(0);
  await page.getByRole("button", { name: "查看历史快照", exact: true }).click();
  await expect(page.getByText("显示 12 / 133 · 368 标的范围", { exact: false })).toBeVisible();
  await expect(page.getByText("145 个历史会话", { exact: false })).toBeVisible();
  await expect(page.getByText("此快照中，幅度比方向更可靠。", { exact: true })).toBeVisible();
  await expect(page.getByText(/数据会话 2026-08-12 · 构建|会话 145\/5|FL-R3/)).toHaveCount(0);
  await expect(page.getByText(/Tape 签名覆盖 387 个标的/)).toBeVisible();

  const showAll = page.getByRole("button", { name: "显示全部 133 个", exact: true });
  await expect(showAll).toBeVisible();
  await expect(showAll).toHaveAttribute("aria-expanded", "false");
  await showAll.scrollIntoViewIfNeeded();
  await captureLeaders(page, testInfo, "zh", "preview");
  await showAll.click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(133);
  const collapse = page.getByRole("button", { name: "显示前 12 个", exact: true });
  await expect(collapse).toBeVisible();
  const box = await collapse.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeLessThan(page.viewportSize()!.height);
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await captureLeaders(page, testInfo, "zh", "expanded");
  await collapse.click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(12);
  await expect(showAll).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "收起历史快照", exact: true }).click();
  await expect(page.getByText("当前资金流领涨榜不可用", { exact: true })).toBeVisible();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(0);
});

test("fresh Flow Leaders keeps its preview available without historical inspection", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one fresh-data presentation contract is sufficient");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await installLeadersFixture(page, {
    ...leadersFixture(),
    stale: false,
    session_date: "2026-11-06",
    as_of: "2026-11-06T21:30:00Z",
  });
  await page.goto("/discover?tab=leaders");
  await expect(page.locator("table.scr tbody tr")).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Show all 133", exact: true })).toBeVisible();
  await expect(page.getByText("Current Flow Leaders unavailable", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Inspect historical snapshot", exact: true })).toHaveCount(0);
  await expect(page.getByText("Updated 16:30:00 ET", { exact: true })).toBeVisible();
  await expect(page.locator("table.scr tbody tr").first().getByText("accruing", { exact: true })).toBeVisible();
  await captureLeaders(page, testInfo, "en", "fresh");
});

for (const locale of [
  { language: "en", project: "desktop", unavailable: "Current Flow Leaders unavailable", inspect: "Inspect incomplete snapshot", coverage: "Incomplete ThetaData coverage · 5/368 roots", missing: "unavailable", historical: "historical", disclosure: "Direction is withheld until coverage is complete." },
  { language: "zh", project: "mobile", unavailable: "当前资金流领涨榜不可用", inspect: "查看不完整快照", coverage: "ThetaData 覆盖不足 · 5/368 个股票", missing: "暂无", historical: "历史", disclosure: "覆盖完整之前，暂不提供方向解读。" },
] as const) {
  test(`incomplete current-session Leaders preserves coverage and producer qualifications (${locale.language})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== locale.project, "one incomplete-data contract per locale is sufficient");
    await page.addInitScript((language) => localStorage.setItem("mm.lang", language), locale.language);
    const fixture = leadersFixture();
    const partialRows = fixture.board_a.slice(0, 5).map((row) => ({ ...row, recurrence_count: null }));
    await installLeadersFixture(page, {
      ...fixture,
      session_date: "2026-11-06",
      as_of: "2026-11-06T21:30:00Z",
      stale_reason: "insufficient_same_session_coverage",
      direction_note: locale.disclosure,
      board_a: partialRows,
      board_b: partialRows,
      coverage: { ...fixture.coverage, n_current_roots: 5, n_expected_roots: 368, tape_names: partialRows.map((row) => row.ticker) },
    });
    await page.goto("/discover?tab=leaders");
    await expect(page.getByText(locale.unavailable, { exact: true })).toBeVisible();
    await expect(page.locator("table.scr tbody tr")).toHaveCount(0);
    await page.getByRole("button", { name: locale.inspect, exact: true }).click();
    await expect(page.getByText(locale.coverage, { exact: true })).toBeVisible();
    await expect(page.getByText(locale.disclosure, { exact: true })).toBeVisible();
    const rows = page.locator("table.scr tbody tr");
    await expect(rows).toHaveCount(5);
    const missing = rows.first().getByText(locale.missing, { exact: true });
    await expect(missing).toBeVisible();
    await expect(rows.getByText(locale.historical, { exact: true })).toHaveCount(0);
    await missing.scrollIntoViewIfNeeded();
    await captureLeaders(page, testInfo, locale.language, "incomplete");
  });
}
