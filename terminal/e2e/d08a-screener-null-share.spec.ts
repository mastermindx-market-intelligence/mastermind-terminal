import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/** D08A G01: null denominator is neither 0% nor an inferred market statistic. */
test("0DTE Screener exposes an unavailable zero-denominator ratio and leaves its CSV blank", async ({ page }) => {
  const fixture = JSON.parse(
    readFileSync(path.join(process.cwd(), "public/data/flow_fixture.json"), "utf8"),
  ) as { feed: Record<string, unknown> & { events: Array<Record<string, unknown>>; session_date: string } };
  const feed = {
    ...fixture.feed,
    events: [
      ...fixture.feed.events,
      {
        ...fixture.feed.events[0],
        id: "zero-denom-001",
        root: "ZERO_DENOM",
        group: "Index",
        group_zh: "指数",
        exp: fixture.feed.session_date,
        zerodte: true,
        dte: 0,
        dte_bucket: "0d",
        premium: 0,
        size: 1,
        n_prints: 1,
        avg_price: 0,
      },
    ],
  };
  await page.route(/\/api\/flow\/stream\?f=feed$/, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
      body: `retry: 60000\n\ndata: ${JSON.stringify(feed)}\n\n`,
    });
  });

  await page.goto("/options?tab=vol");
  await page.getByRole("button", { name: "0DTE Heavy" }).click();
  const missingRow = page.locator("table.scr tbody tr").filter({ hasText: "ZERO_DENOM" });
  await expect(missingRow).toBeVisible();
  await expect(missingRow).toContainText("Unavailable");
  await expect(missingRow).not.toContainText("0.0%");

  const exportButton = page.locator('[data-options-export="screener-csv-v1"]');
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Missing download stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const lines = Buffer.concat(chunks).toString("utf8").slice(1).split("\r\n");
  const cols = lines[0].split(",");
  const rootCol = cols.indexOf("root");
  const shareCol = cols.indexOf("zerodte_share");
  expect(rootCol).toBeGreaterThan(-1);
  expect(shareCol).toBeGreaterThan(-1);
  const exported = lines.slice(1).map((line) => line.split(",")).find((cells) => cells[rootCol] === "ZERO_DENOM");
  expect(exported).toBeDefined();
  expect(exported?.[shareCol]).toBe("");

  await page.evaluate(() => window.localStorage.setItem("mm.lang", "zh"));
  await page.reload();
  await page.getByRole("button", { name: "高0DTE占比" }).click();
  await expect(page.locator("table.scr tbody tr").filter({ hasText: "ZERO_DENOM" })).toContainText("不可用");
});
