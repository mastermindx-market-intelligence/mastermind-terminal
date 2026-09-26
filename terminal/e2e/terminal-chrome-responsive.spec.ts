import { expect, test, type Page } from "@playwright/test";

type Lang = "en" | "zh";

async function armTerminalVisualReady(page: Page, lang: Lang, favourites: string[]) {
  await page.addInitScript(({ locale, favs }) => {
    localStorage.setItem("mm.lang", locale);
    localStorage.setItem("mm.favtf", JSON.stringify(favs));
    document.documentElement.setAttribute("data-lang", locale);
    document.documentElement.setAttribute("lang", locale === "zh" ? "zh-CN" : "en");
  }, { locale: lang, favs: favourites });
  await page.addInitScript(() => {
    const readyWindow = window as Window & { __mmResponsiveVisualReady?: boolean };
    readyWindow.__mmResponsiveVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmResponsiveVisualReady = true;
    }, { once: true });
  });
}

async function waitForTerminalVisualReady(page: Page) {
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmResponsiveVisualReady?: boolean }).__mmResponsiveVisualReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 15_000 },
  ).toBe(true);
}

const cases: { width: number; height: number; lang: Lang; favourites: string[] }[] = [
  { width: 1180, height: 820, lang: "en", favourites: ["D", "3D", "W", "1M"] },
  { width: 1180, height: 820, lang: "zh", favourites: ["D", "3D", "W", "1M"] },
  { width: 1024, height: 768, lang: "en", favourites: ["1h", "4h", "D", "2D", "W", "2W", "1M", "3M", "6M", "12M"] },
  { width: 1024, height: 768, lang: "zh", favourites: ["1h", "4h", "D", "2D", "W", "2W", "1M", "3M", "6M", "12M"] },
];

for (const entry of cases) {
  test(`Terminal chrome fits ${entry.width}px in ${entry.lang}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: entry.width, height: entry.height });
    await armTerminalVisualReady(page, entry.lang, entry.favourites);
    await page.goto("/terminal?symbol=NVDA&from=macro&ret=https%3A%2F%2Fmastermind-x.com%2Fdashboard");
    await waitForTerminalVisualReady(page);

    const toolbar = page.locator(".chart-tabs");
    await expect(toolbar).toBeVisible();
    await expect.poll(() => toolbar.getAttribute("data-toolbar-mode")).not.toBe("full");

    const visibleFit = await toolbar.evaluate((root) => {
      const rootBox = root.getBoundingClientRect();
      const visibleButtons = Array.from(root.querySelectorAll<HTMLElement>(".tbtn,.tfbtn,.seg button"))
        .filter((element) => {
          const style = getComputedStyle(element);
          const popup = element.closest<HTMLElement>(".pop");
          return style.display !== "none"
            && style.visibility !== "hidden"
            && element.getBoundingClientRect().width > 0
            && (!popup || popup.classList.contains("show"));
        });
      return visibleButtons.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim() || element.getAttribute("aria-label") || "control",
          inside: box.left >= rootBox.left - 1 && box.right <= rootBox.right + 1,
          oneLine: element.scrollHeight <= element.clientHeight + 1,
        };
      });
    });
    expect(visibleFit.filter((result) => !result.inside || !result.oneLine)).toEqual([]);

    const more = page.getByTestId("toolbar-more");
    await expect(more).toBeVisible();
    if (entry.width === 1024) await expect(page.locator(".tfbtn-current")).toHaveText("3D");
    await more.click();
    const overflow = page.locator(".toolbar-overflow-pop.show");
    await expect(overflow).toBeVisible();
    await expect(overflow.locator('[data-toolbar-menu-action="mtf"]')).toBeVisible();
    await expect(overflow.locator('[data-toolbar-menu-action="replay"]')).toBeVisible();
    await overflow.locator('[data-toolbar-menu-action="detect"]').click();
    await expect(overflow.locator('[data-toolbar-menu-action="detect-trendlines"]')).toBeVisible();
    await overflow.locator(".toolbar-overflow-back").click();
    await overflow.locator('[data-toolbar-menu-action="snapshot"]').click();
    await expect(overflow.locator('[data-toolbar-menu-action="snapshot-download"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overflow).toBeHidden();

    const back = page.locator(".topbar .brand-back");
    await expect(back).toBeVisible();
    await expect(back.locator(".wm")).toBeHidden();
    const backFit = await back.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const host = element.closest<HTMLElement>(".topbar")!.getBoundingClientRect();
      return { height: box.height, inside: box.top >= host.top && box.bottom <= host.bottom };
    });
    expect(backFit).toEqual({ height: 40, inside: true });

    const dayRange = page.locator(".topbar .dayrange");
    await expect(dayRange).toBeVisible();
    const rangeFit = await dayRange.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const host = element.closest<HTMLElement>(".topbar")!.getBoundingClientRect();
      const label = element.querySelector<HTMLElement>(".dr-lab")!.getBoundingClientRect();
      const low = element.querySelector<HTMLElement>(".dr-end.lo")!.getBoundingClientRect();
      const high = element.querySelector<HTMLElement>(".dr-end.hi")!.getBoundingClientRect();
      return {
        inside: box.top >= host.top && box.bottom <= host.bottom,
        labelOneLine: label.height <= 10,
        endpointsSeparated: low.right <= high.left,
      };
    });
    expect(rangeFit).toEqual({ inside: true, labelOneLine: true, endpointsSeparated: true });

    const documentWidth = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(documentWidth.document).toBeLessThanOrEqual(documentWidth.viewport + 1);
    await page.screenshot({
      path: testInfo.outputPath(`${entry.lang}-${entry.width}-terminal-chrome.png`),
      fullPage: false,
    });
  });
}


test("Precision MTF maps the default 3D chart to the swing ladder and collapses cleanly", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await armTerminalVisualReady(page, "en", ["D", "3D", "W", "1M"]);
  await page.goto("/terminal?symbol=NVDA");
  await waitForTerminalVisualReady(page);

  const more = page.getByTestId("toolbar-more");
  await more.click();
  let overflow = page.locator(".toolbar-overflow-pop.show");
  let mtf = overflow.locator('[data-toolbar-menu-action="mtf"]');
  await expect(mtf).toBeVisible();
  await expect(mtf).toHaveAttribute("data-precision-horizon", "swing");
  await expect(mtf).toHaveAttribute("aria-pressed", "false");
  await mtf.click();

  const paneGrid = page.locator(".pane-grid");
  const panes = paneGrid.locator(".pane");
  await expect(paneGrid).toHaveAttribute("data-n", "4");
  await expect(panes).toHaveCount(4);
  await expect(paneGrid.locator(".pane-tf")).toHaveText(["4h", "2D", "3D", "2W"]);
  const paneTitles = await paneGrid.locator(".pane-hd b").allTextContents();
  expect(paneTitles).toHaveLength(4);
  expect(new Set(paneTitles).size).toBe(1);

  await more.click();
  overflow = page.locator(".toolbar-overflow-pop.show");
  mtf = overflow.locator('[data-toolbar-menu-action="mtf"]');
  await expect(mtf).toHaveAttribute("data-precision-horizon", "swing");
  await expect(mtf).toHaveAttribute("aria-pressed", "true");
  await mtf.click();

  await expect(paneGrid).toHaveAttribute("data-n", "1");
  await expect(panes).toHaveCount(1);
  await expect(paneGrid.locator(".pane-tf")).toHaveText(["4h"]);
});


test("Precision MTF intelligence strip renders canonical context above the chart grid", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await armTerminalVisualReady(page, "en", ["D", "3D", "W", "1M"]);
  await page.route("**/data/NVDA.intel.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema: "intel/v1",
        ticker: "NVDA",
        asof: "2026-09-23",
        analysis: {
          entry: {
            headline: "Awaiting confluence",
            confidence: 72.4,
            next_trigger: "2D MACD cross with 3D confirmation",
            buy_zone: [181.2, 185.4],
            chase_above: 189.0,
            stop: 176.8,
          },
          confluence: {
            tier: "T3",
            bars_to_cross: 1.4,
            provisional: true,
            htf_s1: true,
          },
          sniper: {
            w2_washout: true,
            w2_stoch_d: 22.4,
            days_since_63d_low: 5,
            coiled: true,
          },
        },
      }),
    });
  });

  await page.goto("/terminal?symbol=NVDA");
  await waitForTerminalVisualReady(page);
  await page.getByTestId("toolbar-more").click();
  await page.locator('.toolbar-overflow-pop.show [data-toolbar-menu-action="mtf"]').click();

  const strip = page.getByTestId("precision-entry-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute("data-horizon", "swing");
  await expect(strip.locator('[data-role="execution"]')).toContainText("Awaiting confluence");
  await expect(strip.locator('[data-role="trigger"]')).toContainText("T3 · ≈ 1.4 bars · Provisional");
  await expect(strip.locator('[data-role="durability"]')).toContainText("72/100");
  await expect(strip.locator('[data-role="durability"]')).toContainText("durability, not return");
  await expect(strip.locator('[data-role="structure"]')).toContainText("Higher-TF support");
  await expect(strip.locator('[data-role="structure"]')).toContainText("2W washout ctx");
  await expect(strip.locator('[data-role="structure"]')).toContainText("Context only · not a buy signal");

  const paneGrid = page.locator(".pane-grid");
  const horizonSelect = page.getByTestId("precision-horizon-select");
  await expect(horizonSelect).toHaveValue("swing");

  await horizonSelect.selectOption("deep");
  await expect(strip).toHaveAttribute("data-horizon", "deep");
  await expect(paneGrid.locator(".pane-tf")).toHaveText(["3D", "W", "2W", "1M"]);

  await horizonSelect.selectOption("day");
  await expect(strip).toHaveAttribute("data-horizon", "day");
  await expect(paneGrid.locator(".pane-tf")).toHaveText(["5m", "15m", "1h", "4h"]);

  const geometry = await page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>('[data-testid="precision-entry-strip"]')!;
    const firstPane = document.querySelector<HTMLElement>(".pane-grid > .pane")!;
    const grid = document.querySelector<HTMLElement>(".pane-grid")!;
    const stripBox = strip.getBoundingClientRect();
    const paneBox = firstPane.getBoundingClientRect();
    const gridBox = grid.getBoundingClientRect();
    return {
      stripTop: Math.round(stripBox.top),
      stripBottom: Math.round(stripBox.bottom),
      paneTop: Math.round(paneBox.top),
      gridTop: Math.round(gridBox.top),
      stripHeight: Math.round(stripBox.height),
    };
  });
  expect(geometry.stripTop).toBe(geometry.gridTop);
  expect(geometry.stripHeight).toBe(58);
  expect(geometry.paneTop).toBeGreaterThanOrEqual(geometry.stripBottom - 1);
});
