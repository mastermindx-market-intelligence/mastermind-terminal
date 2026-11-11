import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectBottomPivotFeed } from "../lib/bottomPivotSelection";

const pivotFixture: unknown = JSON.parse(readFileSync(
  join(process.cwd(), "lib", "__tests__", "fixtures", "nw_bottom_pivot_fixture.json"), "utf8",
));
const isPivotRequest = (url: URL) =>
  url.pathname === "/api/nw" && url.searchParams.get("f") === "bottom_sensors";

/**
 * Browser proof of the real Prophet drawer with an explicit selected-feed fixture.
 * Proxy authentication and single-symbol filtering are covered by nwRoute.test.ts;
 * these UI cases neither require a paid session nor enable a global NW auth bypass.
 * Macro remains the producer; the Terminal never creates pivot probabilities,
 * ranks, entry clocks, positions or execution instructions.
 */
test("Prophet daily pivot evidence is opt-in, single-symbol and bilingual", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.route(isPivotRequest, async (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol") ?? "";
    const selected = selectBottomPivotFeed(pivotFixture, symbol);
    expect(selected).not.toBeNull();
    expect(JSON.stringify(selected)).not.toContain("NEVER-SEND-OTHER-SYMBOL");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
      body: JSON.stringify(selected),
    });
  });
  const intercepted: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/nw?f=bottom_sensors")) intercepted.push(request.url());
  });
  await page.goto("/options?tab=prophet");
  const drawer = page.getByTestId("bottom-pivot-evidence");
  const toggle = page.getByTestId("bottom-pivot-toggle");
  await expect(toggle).toBeAttached({ timeout: 25_000 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(intercepted, "no paid feed fetch during Prophet first paint").toHaveLength(0);

  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(drawer).toContainText("Daily single-stock source context for UBER", { timeout: 20_000 });
  await expect(drawer).toContainText("Not a live entry trigger");
  await expect(drawer).toContainText("Evidence quality: partial");
  expect(intercepted).toHaveLength(1);
  expect(new URL(intercepted[0]).searchParams.get("symbol")).toBe("UBER");
  await expect(drawer).not.toContainText("NEVER-SEND-OTHER-SYMBOL");
  expect(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-bottom-pivot-en.png`),
    fullPage: false,
  });
  await drawer.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-bottom-pivot-detail-en.png`),
  });

  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await expect(drawer).toContainText("日频底部转折证据");
  await expect(drawer).toContainText("仅限日频快照");
  await expect(drawer).toContainText("UBER 日频个股来源背景");
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-bottom-pivot-zh.png`),
    fullPage: false,
  });
  await drawer.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-bottom-pivot-detail-zh.png`),
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(intercepted).toHaveLength(1);
});

for (const [status, message] of [
  [401, "Sign in to view this entitled research."],
  [403, "Your session does not have access to this research."],
] as const) {
  test(`Prophet daily pivot evidence preserves the ${status} refusal`, async ({ page }) => {
    await page.route(isPivotRequest, (route) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: status === 401 ? "sign_in_required" : "not_entitled" }),
    }));
    await page.goto("/options?tab=prophet");
    const drawer = page.getByTestId("bottom-pivot-evidence");
    const toggle = page.getByTestId("bottom-pivot-toggle");
    await expect(toggle).toBeAttached({ timeout: 25_000 });
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(drawer).toContainText(message);
    await expect(drawer).not.toContainText("Evidence quality:");
    await expect(drawer).not.toContainText("Recorded observations");
    await expect(drawer.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  });
}
