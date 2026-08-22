import { expect, test, type Page } from "./fixtures";

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
