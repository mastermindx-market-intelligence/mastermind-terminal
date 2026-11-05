import { expect, test } from "@playwright/test";

test("Largest Events keeps mobile summary labels readable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only receipt regression");

  await page.goto("/options?tab=largest");

  const receipts = page.locator(".options-flow-board-receipts");
  await expect(receipts).toBeVisible({ timeout: 15_000 });

  for (const label of ["Underlying prints", "Call prem share"]) {
    const el = receipts.getByText(label, { exact: true });
    await expect(el).toBeVisible();
    const geometry = await el.evaluate((node) => {
      const e = node as HTMLElement;
      const style = getComputedStyle(e);
      return {
        clientWidth: e.clientWidth,
        scrollWidth: e.scrollWidth,
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
      };
    });

    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.whiteSpace).not.toBe("nowrap");
    expect(geometry.textOverflow).not.toBe("ellipsis");
  }

  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client + 1);
});
