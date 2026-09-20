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


test("the compact Flow Leaders controls and coverage remain bilingual", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one touch viewport pins the Chinese journey");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
  await installLeadersFixture(page);

  await page.goto("/discover?tab=leaders");
  await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
  await expect(page.getByText("显示 12 / 133 · 368 标的范围", { exact: false })).toBeVisible();
  await expect(page.getByText(/Tape 签名覆盖 387 个标的/)).toBeVisible();

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
