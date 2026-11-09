import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { toggleToolbarReplay } from "./terminalToolbar";

async function armVisualReady(page: Page, lang: "en" | "zh" = "en") {
  await page.addInitScript((language) => {
    localStorage.setItem("mm.lang", language);
    localStorage.setItem("mm.startTf", JSON.stringify("3D"));
    localStorage.removeItem("mm.ws");
    const readyWindow = window as Window & { __mmPrecisionVisualReady?: boolean };
    readyWindow.__mmPrecisionVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmPrecisionVisualReady = true;
    }, { once: true });
  }, lang);
}

async function waitForVisualReady(page: Page) {
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmPrecisionVisualReady?: boolean }).__mmPrecisionVisualReady)),
    { message: "the real Terminal chart should finish hydrating", timeout: 15_000 },
  ).toBe(true);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await info.attach(name, {
    body: await page.screenshot({ path: info.outputPath(name + ".png"), animations: "disabled" }),
    contentType: "image/png",
  });
}

for (const lang of ["en", "zh"] as const) {
  test("MTF opens the Precision swing ladder, retires Replay and collapses cleanly (" + lang + ")", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop proves the four-pane Precision grid; <=860px has a separate compact UX.");
    test.slow(); // One real route, active Replay, four charts, collapse and two evidence captures.
    await armVisualReady(page, lang);
    await page.goto("/terminal?symbol=NVDA");
    await waitForVisualReady(page);
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);

    const grid = page.locator(".pane-grid");
    await expect(grid).toHaveAttribute("data-n", "1");
    await expect(grid.locator(".pane-tf")).toHaveText(["3D"]);

    const mtf = page.locator('[data-toolbar-action="mtf"]');
    await expect(mtf).toBeVisible();
    await expect(mtf).toBeEnabled();
    await expect(mtf).toHaveAttribute("data-precision-horizon", "swing");
    await expect(mtf).toHaveAttribute("title", new RegExp(lang === "zh" ? "根据当前图表周期" : "current chart horizon"));

    // Prove that entering the grid clears an actual historical session, not only an idle flag.
    const replay = page.locator('[data-toolbar-action="replay"]');
    await expect(replay).toBeEnabled({ timeout: 45_000 });
    await toggleToolbarReplay(page);
    await expect(page.locator("[data-replay-rail]")).toBeVisible();

    await mtf.focus();
    await page.keyboard.press("Enter");
    await expect(grid).toHaveAttribute("data-n", "4");
    await expect(grid).toHaveAttribute("data-precision-horizon", "swing");
    await expect(grid.locator(".pane")).toHaveCount(4);
    await expect(grid.locator(".pane-tf")).toHaveText(["4h", "2D", "3D", "2W"]);
    const paneTitles = await grid.locator(".pane-hd b").allTextContents();
    expect(paneTitles).toHaveLength(4);
    expect(new Set(paneTitles).size).toBe(1);
    await expect(page.locator('[data-toolbar-action="sync"]')).toBeDisabled();
    await expect(page.locator('[data-toolbar-action="sync"]')).toHaveAttribute("data-sync-on", "0");
    await expect(replay).toBeDisabled();
    await expect(replay).toHaveAttribute("data-replay-blocked", "multi-chart");
    await expect(page.locator("[data-replay-rail]")).toHaveCount(0);
    await expect(page.locator(".pane .mm", { hasText: /^REPLAY$/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture(page, testInfo, "precision-swing-" + lang);

    await mtf.click();
    await expect(grid).toHaveAttribute("data-n", "1");
    await expect(grid.locator(".pane")).toHaveCount(1);
    await expect(grid.locator(".pane-tf")).toHaveText(["4h"]);
    await expect(grid).not.toHaveAttribute("data-precision-horizon", /.+/);
    await expect(page.locator("[data-replay-rail]")).toHaveCount(0);
    await expect(replay).not.toHaveClass(/\bon\b/);
    await capture(page, testInfo, "precision-collapsed-" + lang);
  });

  test("Precision MTF is hidden where the responsive shell cannot show four panes (" + lang + ")", async ({ page }, testInfo) => {
    test.skip(!["tablet", "mobile"].includes(testInfo.project.name), "Only the <=860px responsive shell owns this boundary.");
    await armVisualReady(page, lang);
    await page.goto("/terminal?symbol=NVDA");
    await waitForVisualReady(page);
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);

    await expect(page.locator(".pane-grid")).toHaveAttribute("data-n", "1");
    await expect(page.locator('[data-toolbar-action="mtf"]')).toBeHidden();
    await expect(page.locator('[data-toolbar-menu-action="mtf"]')).toBeHidden();
    await expect(page.locator(".pane-grid .pane")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture(page, testInfo, "precision-compact-" + lang);
  });
}

test("Precision replaces a restored explicit link plan with independent views", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The explicit linked-pane precondition requires the desktop grid.");
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("mm.startTf", JSON.stringify("3D"));
    localStorage.setItem("mm.ws", JSON.stringify({
      panes: ["NVDA", "AAPL"], paneTfs: ["3D", "3D"], split: 2, activePane: 0,
      lockedVLine: null, sync: false,
      links: {
        v: 1, panes: ["A", "A"],
        share: {
          A: { crosshair: true, window: true },
          B: { crosshair: true, window: true },
          C: { crosshair: true, window: true },
        },
      },
    }));
  });
  await page.goto("/terminal");
  const grid = page.locator(".pane-grid");
  await expect(grid).toHaveAttribute("data-n", "2", { timeout: 45_000 });
  await expect(grid.locator(".pane-tf")).toHaveText(["3D", "3D"]);
  await expect(page.locator("[data-chart-link-chip='0']")).toHaveAttribute("data-group", "A");
  await expect(page.locator("[data-chart-link-chip='1']")).toHaveAttribute("data-group", "A");
  await expect(page.locator("[data-chart-link='0']")).toHaveAttribute("data-link-status", "active", { timeout: 20_000 });

  await page.locator('[data-toolbar-action="mtf"]').click();
  await expect(grid).toHaveAttribute("data-n", "4");
  await expect(grid.locator(".pane-tf")).toHaveText(["4h", "2D", "3D", "2W"]);
  for (const pane of [0, 1, 2, 3]) {
    await expect(page.locator("[data-chart-link-chip='" + pane + "']")).toHaveAttribute("data-group", "off");
  }
  await expect(page.locator('[data-toolbar-action="sync"]')).toHaveAttribute("data-sync-on", "0");
  await expect(page.locator('[data-toolbar-action="sync"]')).toBeDisabled();
  // The incumbent persistence owner must save the same independent state the controls show.
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("mm.ws") || "null");
    return saved ? { sync: saved.sync, links: saved.links ?? null } : null;
  })).toEqual({ sync: false, links: null });
});
