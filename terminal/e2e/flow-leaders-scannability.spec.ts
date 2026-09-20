import { expect, test, type Page } from "@playwright/test";
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

async function installLeadersFixture(page: Page): Promise<void> {
  const fixture = leadersFixture();
  await page.route(/\/api\/flow\?f=leaders(?:&.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture) });
  });
}

test("expanded Flow Leaders keeps its collapse control in reach and a board switch resets the preview", async ({ page }) => {
  await installLeadersFixture(page);

  await page.goto("/discover?tab=leaders");
  const showAll = page.getByRole("button", { name: "Show all 133", exact: true });
  await expect(showAll).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("table.scr tbody tr")).toHaveCount(12);
  await expect(page.getByText("145 sessions of history", { exact: false })).toBeVisible();
  await expect(page.getByText(
    "Magnitude is more reliable than direction in this snapshot.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText(/data session|sessions 145\/5|FL-R3/i)).toHaveCount(0);
  const before = await showAll.boundingBox();
  expect(before).not.toBeNull();

  await showAll.click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(133);
  const collapse = page.getByRole("button", { name: "Show top 12", exact: true });
  await expect(collapse).toBeVisible();
  const after = await collapse.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.y, "expanding must not move the collapse control below the viewport").toBeLessThan(
    page.viewportSize()!.height,
  );
  expect(Math.abs(after!.y - before!.y), "the control should stay in the same toolbar").toBeLessThan(80);

  await page.getByRole("button", { name: "Washout Turn", exact: true }).click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Show all 19", exact: true })).toBeVisible();
});


test("ticker search reaches beyond the preview and follows the selected board", async ({ page }) => {
  await installLeadersFixture(page);
  await page.goto("/discover?tab=leaders");

  const search = page.getByRole("searchbox", { name: "Search Flow Leaders", exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  const searchBox = await search.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await search.fill("$a133");
  await expect(page.locator("table.scr tbody tr")).toHaveCount(1);
  await expect(page.getByText("A133", { exact: true })).toBeVisible();
  await expect(page.getByText("1 match in 133 · 368-name universe", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Show all/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Washout Turn", exact: true }).click();
  await expect(page.getByText("No names match “A133”", { exact: true })).toBeVisible();
  await search.fill("b019");
  await expect(page.locator("table.scr tbody tr")).toHaveCount(1);
  await expect(page.getByText("B019", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Clear Flow Leaders search", exact: true }).click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Show all 19", exact: true })).toBeVisible();
});

test("the compact Flow Leaders controls and coverage remain bilingual", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one touch viewport pins the Chinese journey");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
  await installLeadersFixture(page);

  await page.goto("/discover?tab=leaders");
  await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
  await expect(page.getByText("显示 12 / 133 · 368 标的范围", { exact: false })).toBeVisible();
  await expect(page.getByText("145 个历史会话", { exact: false })).toBeVisible();
  await expect(page.getByText("此快照中，幅度比方向更可靠。", { exact: true })).toBeVisible();
  await expect(page.getByText(/数据会话 2026-08-12 · 构建|会话 145\/5|FL-R3/)).toHaveCount(0);
  await expect(page.getByText(/Tape 签名覆盖 387 个标的/)).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "搜索资金流领涨榜", exact: true }))
    .toHaveAttribute("placeholder", "搜索代码…");

  const showAll = page.getByRole("button", { name: "显示全部 133 个", exact: true });
  await expect(showAll).toBeVisible();
  await showAll.click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(133);
  const collapse = page.getByRole("button", { name: "显示前 12 个", exact: true });
  await expect(collapse).toBeVisible();
  const box = await collapse.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeLessThan(page.viewportSize()!.height);
});
