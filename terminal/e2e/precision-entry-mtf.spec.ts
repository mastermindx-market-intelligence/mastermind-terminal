import { expect, test, type Page } from "@playwright/test";

async function armVisualReady(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("3D"));
    localStorage.removeItem("mm.ws");
    const readyWindow = window as Window & { __mmPrecisionVisualReady?: boolean };
    readyWindow.__mmPrecisionVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmPrecisionVisualReady = true;
    }, { once: true });
  });
}

async function waitForVisualReady(page: Page) {
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmPrecisionVisualReady?: boolean }).__mmPrecisionVisualReady)),
    { message: "the real Terminal chart should finish hydrating", timeout: 15_000 },
  ).toBe(true);
}

test("MTF opens the inferred Precision swing ladder and collapses cleanly", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop proves the four-pane Precision grid; <=860px gets a separate compact UX.");

  await armVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await waitForVisualReady(page);

  const grid = page.locator(".pane-grid");
  await expect(grid).toHaveAttribute("data-n", "1");
  await expect(grid.locator(".pane-tf")).toHaveText(["3D"]);

  const mtf = page.locator('[data-toolbar-action="mtf"]');
  await expect(mtf).toBeVisible();
  await expect(mtf).toBeEnabled();
  await expect(mtf).toHaveAttribute("data-precision-horizon", "swing");

  await mtf.click();

  await expect(grid).toHaveAttribute("data-n", "4");
  await expect(grid).toHaveAttribute("data-precision-horizon", "swing");
  await expect(grid.locator(".pane")).toHaveCount(4);
  await expect(grid.locator(".pane-tf")).toHaveText(["4h", "2D", "3D", "2W"]);

  const paneTitles = await grid.locator(".pane-hd b").allTextContents();
  expect(paneTitles).toHaveLength(4);
  expect(new Set(paneTitles).size).toBe(1);

  await expect(page.locator('[data-toolbar-action="sync"]')).toBeDisabled();
  await expect(page.locator('[data-toolbar-action="replay"]')).toBeDisabled();

  await mtf.click();

  await expect(grid).toHaveAttribute("data-n", "1");
  await expect(grid.locator(".pane")).toHaveCount(1);
  await expect(grid.locator(".pane-tf")).toHaveText(["4h"]);
  await expect(grid).not.toHaveAttribute("data-precision-horizon", /.+/);
});


test("Precision MTF is not exposed where the responsive shell hides extra panes", async ({ page }, testInfo) => {
  test.skip(!["tablet", "mobile"].includes(testInfo.project.name), "Only the <=860px responsive shell owns this boundary.");

  await armVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await waitForVisualReady(page);

  await expect(page.locator(".pane-grid")).toHaveAttribute("data-n", "1");
  await expect(page.locator('[data-toolbar-action="mtf"]')).toBeHidden();
  await expect(page.locator('[data-toolbar-menu-action="mtf"]')).toBeHidden();
  await expect(page.locator(".pane-grid .pane")).toHaveCount(1);
});
