import { expect, test, type Locator, type Page } from "@playwright/test";

// The chart's research pane (TerminalShell → MegaPane mode="workspace") sits in-flow beside the
// chart above 860px. At ≤860px fin.css falls back to the .fin-pane base — position:fixed; inset:0;
// z-index:90 — so the pane paints over `.mobilebar`, the only other way off the screen. A touch
// user who opened it from the rail's "Open full analysis" button had no way back to the chart.
// The pane must therefore carry its own ≥44px exit at those widths, and that exit must take the
// pane's own close path (the classic header's): strip `pane`/`tx` from the URL, then drop the pane,
// leaving the same research-free URL the desktop rail's Chart exit lands on.

async function armVisualReady(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __mmMegaPaneReady?: boolean };
    w.__mmMegaPaneReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { w.__mmMegaPaneReady = true; }, { once: true });
  });
}

async function openResearchPane(page: Page, touch: boolean): Promise<Locator> {
  await armVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmMegaPaneReady?: boolean }).__mmMegaPaneReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 20_000 },
  ).toBe(true);

  const open = page.locator(".detail-hd .ex-btn");
  await open.scrollIntoViewIfNeeded({ timeout: 20_000 });
  if (touch) await open.tap({ timeout: 20_000 });
  else await open.click({ timeout: 20_000 });

  const pane = page.locator(".fin-pane");
  await expect(pane).toBeVisible({ timeout: 20_000 });
  return pane;
}

/** Which element actually receives a tap at the centre of `target` — the stacking truth. */
async function hitTestCentre(page: Page, target: Locator) {
  const box = await target.boundingBox();
  expect(box, "hit-test target must be laid out").not.toBeNull();
  return page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return {
      insidePane: Boolean(hit?.closest(".fin-pane")),
      insideMobilebar: Boolean(hit?.closest(".mobilebar")),
      label: hit?.closest("button")?.getAttribute("aria-label") ?? hit?.closest("button")?.textContent?.trim() ?? null,
    };
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
}

for (const { lang, label } of [
  { lang: "en", label: "Back to chart" },
  { lang: "zh", label: "返回图表" },
] as const) {
  test(`touch layouts can leave the chart's research pane (${lang})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "≤860px touch trap; desktop has its own case below");
    await page.addInitScript((l) => { localStorage.setItem("mm.lang", l); }, lang);

    const pane = await openResearchPane(page, true);
    const viewport = page.viewportSize()!;

    // The trap this spec guards: the pane covers the whole viewport, mobilebar included.
    const paneBox = await pane.boundingBox();
    expect(paneBox).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    const hamburger = page.locator(".mobilebar .m-ic[aria-label='Menu']").first();
    expect((await hitTestCentre(page, hamburger)).insidePane, "the pane paints over the mobile menu").toBe(true);

    // The pane's own exit: visible, on screen, ≥44px, and actually the topmost element.
    const back = pane.getByRole("button", { name: label, exact: true });
    await expect(back).toBeVisible({ timeout: 20_000 });
    const backBox = (await back.boundingBox())!;
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    expect(backBox.width).toBeGreaterThanOrEqual(44);
    expect(backBox.y).toBeGreaterThanOrEqual(0);
    expect(backBox.y + backBox.height).toBeLessThanOrEqual(viewport.height);
    const backHit = await hitTestCentre(page, back);
    expect(backHit.insidePane).toBe(true);
    expect(backHit.label).toBe(label);

    // Same close path as desktop: transient research params leave the URL with the pane.
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("pane", "overview");
      url.searchParams.set("tx", "2026Q1");
      window.history.replaceState(window.history.state, "", url.toString());
    });
    await back.tap({ timeout: 20_000 });

    await expect(page.locator(".fin-pane")).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return { pane: params.get("pane"), tx: params.get("tx"), symbol: params.get("symbol") };
    }).toEqual({ pane: null, tx: null, symbol: "NVDA" });
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
    await expect.poll(async () => (await hitTestCentre(page, hamburger)).insideMobilebar,
      { message: "the mobile menu is reachable again" }).toBe(true);
  });
}

test("desktop keeps the in-flow research pane without the touch exit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only contract");
  const pane = await openResearchPane(page, false);

  await expect.poll(() => pane.evaluate((el) => getComputedStyle(el).position)).toBe("relative");
  // Rendered (the chart hosts this pane) but switched off by the ≥861px rule, not merely absent.
  const touchExit = pane.locator(".fin-head--touch-exit");
  await expect(touchExit).toHaveCount(1);
  await expect(touchExit).toHaveCSS("display", "none");
  await expect(pane.getByRole("button", { name: "Back to chart", exact: true })).toBeHidden();

  // The desktop exit is unchanged: the left rail's Chart button closes the pane in place.
  await page.locator(".appnav a[aria-label='Chart']").click({ timeout: 20_000 });
  await expect(page.locator(".fin-pane")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("pane")).toBeNull();
});

test("/analysis keeps its own chrome without the chart's touch exit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "the touch exit only renders at ≤860px");
  // AnalysisWorkspace hosts the same workspace-mode MegaPane but is not chart-hosted: its context
  // bar and the mobile nav stay reachable, so a second "Back to chart" header would be a duplicate.
  await page.goto("/analysis?symbol=NVDA&page=overview");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });
  await expect(page.locator(".fin-pane")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".fin-pane .fin-head")).toHaveCount(0);
  // Exactly one exit on the page, and it is the context bar's own.
  const backs = page.getByRole("button", { name: "Back to chart", exact: true });
  await expect(backs).toHaveCount(1);
  await expect(page.locator(".analysis-context-bar").getByRole("button", { name: "Back to chart", exact: true })).toBeVisible();
});
