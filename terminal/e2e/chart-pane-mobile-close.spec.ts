import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { expectTapTarget } from "./tapTarget";

// The chart route mounts the research pane (MegaPane) in its workspace mode. At <=860px fin.css
// has no in-flow override for `.fin-pane--workspace`, so the pane falls back to the base
// `.fin-pane` rule: a fixed, full-viewport layer above the phone menu bar. Before this fix the
// workspace mode also dropped the pane's own header and Escape handler, so a phone or tablet
// reader who opened it had no way back to the chart. These cases pin the repaired contract:
//   - phone and tablet: the chart-hosted pane presents as the overlay it visually is, with a
//     labelled "Back to chart" control and Escape, and closing it hands the menu bar back;
//   - /analysis: the route-hosted workspace stays embedded, with no Back control and no Escape;
//   - desktop: the chart-hosted pane stays in its slot, with no overlay semantics; its touch-exit
//     header (#1049) is rendered from first paint but switched off by the >=861px rule.

const OUT = join(process.cwd(), "docs", "pr-crops", "chart-pane-mobile-close");
const CROPS = process.env.TERMINAL_CROPS === "1";
const ACTION = { timeout: 20_000 };
const OVERLAY_PROJECTS = new Set(["mobile", "tablet"]);
const BACK_LABEL = { en: "Back to chart", zh: "返回图表" } as const;
const MENU = '.mobilebar button.m-ic[aria-label="Menu"]';

type Lang = keyof typeof BACK_LABEL;

function presentsAsOverlay(testInfo: TestInfo) {
  return OVERLAY_PROJECTS.has(testInfo.project.name);
}

async function prepare(page: Page, lang: Lang) {
  await page.addInitScript((language) => {
    localStorage.setItem("mm.lang", language);
    const ready = window as Window & { __mmChartPaneReady?: boolean };
    ready.__mmChartPaneReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      ready.__mmChartPaneReady = true;
    }, { once: true });
  }, lang);
}

async function openTerminal(page: Page, lang: Lang, extraQuery = "") {
  await prepare(page, lang);
  await page.goto(`/terminal?symbol=NVDA${extraQuery}`);
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang, ACTION);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible(ACTION);
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmChartPaneReady?: boolean }).__mmChartPaneReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 20_000 },
  ).toBe(true);
}

async function press(target: Locator, testInfo: TestInfo) {
  if (testInfo.project.use.hasTouch) await target.tap(ACTION);
  else await target.click(ACTION);
}

function chartPane(page: Page) {
  return page.locator(".fin-pane.fin-pane--workspace");
}

// The real reader path: on a phone the Analysis hub's "Symbol details" tile scrolls the dossier
// into view; on every width the dossier's expand button opens the research pane.
async function openChartPane(page: Page, testInfo: TestInfo, viaHub: boolean) {
  if (viaHub && testInfo.project.name === "mobile") {
    await press(page.getByTestId("roller-more"), testInfo);
    const hub = page.getByTestId("analysis-hub");
    await expect(hub).toBeVisible(ACTION);
    await press(hub.getByTestId("hub-tile-symbolDetails"), testInfo);
    await expect(hub).toHaveCount(0, ACTION);
  }
  const expand = page.locator(".detail-board .ex-btn");
  await expect(expand).toBeVisible(ACTION);
  await press(expand, testInfo);
  const pane = chartPane(page);
  await expect(pane).toBeVisible(ACTION);
  await expect(pane.locator(".fin-body")).toBeVisible(ACTION);
  return pane;
}

async function expectViewportOverlay(page: Page, pane: Locator) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await expect.poll(() => pane.evaluate((el) => getComputedStyle(el).position), { timeout: 20_000 }).toBe("fixed");
  const box = await pane.boundingBox();
  expect(box, "the chart-hosted pane should have a layout box").not.toBeNull();
  expect({
    x: Math.round(box!.x),
    y: Math.round(box!.y),
    width: Math.round(box!.width),
    height: Math.round(box!.height),
  }).toEqual({ x: 0, y: 0, width: viewport!.width, height: viewport!.height });
}

// What a tap at the centre of the phone menu button would land on, measured from the top of
// the page (the menu bar is in the page flow at <=860px).
async function menuHit(page: Page) {
  return page.evaluate((selector) => {
    window.scrollTo(0, 0);
    const menu = document.querySelector<HTMLElement>(selector);
    if (!menu) return "missing";
    const rect = menu.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit) return "nothing";
    if (hit === menu || menu.contains(hit)) return "menu";
    if (hit.closest(".fin-pane")) return "pane";
    return `other:${hit.tagName.toLowerCase()}.${String(hit.className || "").split(" ")[0]}`;
  }, MENU);
}

async function settle(page: Page) {
  // A negative check ("Escape did NOT close it") needs the handler's render to have had its chance.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 250)));
  }));
}

async function crop(page: Page, file: string) {
  if (!CROPS) return;
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", ACTION);
  mkdirSync(OUT, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(OUT, file), animations: "disabled", caret: "hide" });
}

for (const lang of ["en", "zh"] as const) {
  test(`chart-hosted research pane at <=860px is a full-screen overlay with a labelled Back to chart (${lang})`, async ({ page }, testInfo) => {
    test.skip(!presentsAsOverlay(testInfo), "the chart-hosted pane is an overlay only at <=860px");
    await openTerminal(page, lang);
    const pane = await openChartPane(page, testInfo, true);

    // The defect premise: the pane really is a fixed layer over the whole viewport, menu included.
    await expectViewportOverlay(page, pane);
    await expect.poll(() => menuHit(page), { timeout: 20_000 }).toBe("pane");

    const back = pane.locator(".fin-head-back");
    await expect(back).toBeVisible(ACTION);
    await expect(back).toHaveText(BACK_LABEL[lang], ACTION);
    await expect(back).toHaveAccessibleName(BACK_LABEL[lang], ACTION);
    await expectTapTarget(back, { width: 24, height: 24 });
    await expect(pane).toHaveAttribute("role", "dialog", ACTION);
    await expect(pane).toHaveAttribute("aria-modal", "true", ACTION);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow), { timeout: 20_000 }).toBe("hidden");
    await crop(page, `${testInfo.project.name}-${lang}-dark.png`);

    await press(back, testInfo);
    await expect(chartPane(page)).toHaveCount(0, ACTION);
    await expect.poll(() => menuHit(page), {
      message: "closing the pane should hand the phone menu button back to the reader",
      timeout: 20_000,
    }).toBe("menu");
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");

    // Reopen and leave with Escape: the keyboard close must survive a remount.
    await openChartPane(page, testInfo, false);
    await page.keyboard.press("Escape");
    await expect(chartPane(page)).toHaveCount(0, ACTION);
    await expect.poll(() => menuHit(page), { timeout: 20_000 }).toBe("menu");
  });
}

test("Escape closes the chart-hosted research pane at <=860px", async ({ page }, testInfo) => {
  test.skip(!presentsAsOverlay(testInfo), "the chart-hosted pane is an overlay only at <=860px");
  await openTerminal(page, "en");
  const pane = await openChartPane(page, testInfo, true);
  await expectViewportOverlay(page, pane);

  await page.keyboard.press("Escape");
  await expect(chartPane(page)).toHaveCount(0, ACTION);
  expect(new URL(page.url()).pathname).toBe("/terminal");
  await expect.poll(() => menuHit(page), { timeout: 20_000 }).toBe("menu");
});

test("a ?pane=overview deep link at <=860px opens the overlay and Back to chart clears it", async ({ page }, testInfo) => {
  test.skip(!presentsAsOverlay(testInfo), "the chart-hosted pane is an overlay only at <=860px");
  await openTerminal(page, "en", "&pane=overview");
  const pane = chartPane(page);
  await expect(pane).toBeVisible(ACTION);
  await expectViewportOverlay(page, pane);

  const back = pane.locator(".fin-head-back");
  await expect(back).toBeVisible(ACTION);
  await expect(back).toHaveText(BACK_LABEL.en, ACTION);
  await press(back, testInfo);
  await expect(chartPane(page)).toHaveCount(0, ACTION);
  await expect.poll(() => new URL(page.url()).searchParams.has("pane"), { timeout: 20_000 }).toBe(false);
  await expect.poll(() => menuHit(page), { timeout: 20_000 }).toBe("menu");
});

test("/analysis keeps its embedded workspace: no Back to chart, and Escape keeps the route", async ({ page }, testInfo) => {
  await prepare(page, "en");
  await page.goto("/analysis?symbol=NVDA&page=overview");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });
  const pane = page.locator(".analysis-shell .fin-pane--workspace");
  await expect(pane).toHaveCount(1, ACTION);
  await expect(pane).toBeVisible(ACTION);
  await expect(page.locator(".fin-head-back")).toHaveCount(0, ACTION);
  await expect(pane).toHaveAttribute("role", "region", ACTION);
  if (testInfo.project.name === "mobile") await crop(page, "analysis-mobile-en-dark.png");

  await page.keyboard.press("Escape");
  await settle(page);
  expect(new URL(page.url()).pathname).toBe("/analysis");
  await expect(pane).toHaveCount(1, ACTION);
  await expect(pane).toBeVisible(ACTION);
  await expect(page.locator(".fin-head-back")).toHaveCount(0, ACTION);
});

test("desktop keeps the chart-hosted research pane in its slot without the overlay header", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop presents the chart-hosted pane in flow");
  await openTerminal(page, "en");
  const pane = await openChartPane(page, testInfo, false);
  await expect(pane.locator(".fin-head--touch-exit")).toHaveCSS("display", "none", ACTION);
  await expect(page.locator(".fin-head-back")).toBeHidden(ACTION);
  await expect.poll(() => pane.evaluate((el) => getComputedStyle(el).position), { timeout: 20_000 }).not.toBe("fixed");
  await expect(pane).toHaveAttribute("role", "region", ACTION);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await crop(page, "desktop-en-dark.png");
});
